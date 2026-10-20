import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import type { AdaptiveSnapshot } from '../persistence/contracts';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const NOW = 1_800_000_000_000;
const PURPOSE = 'optional.personalization' as const;
async function setup(enabled = true, approvalDuration = 400 * 86400_000) {
  const directory = await mkdtemp(join(tmpdir(), 'vox-adaptive-')); directories.push(directory);
  let now = NOW;
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-config',
    enabledCapabilities: ['core_text', 'personalization', 'auto_memory', 'product_analytics'],
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: ['core_text', 'personalization', 'auto_memory', 'product_analytics'].map((capability, index) => ({
      schemaVersion: 1, id: `synthetic-approval-${index}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-config',
      effectiveAt: NOW, reviewExpiresAt: NOW + approvalDuration, owner: 'synthetic-owner', approvalReference: 'synthetic-only',
    })),
  });
  const factory = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), {
    ...(enabled ? adaptiveOptionsFromManifest(manifest) : {}), now: () => now,
  });
  return { service: factory(), factory, directory, setNow: (value: number) => { now = value; } };
}
function permission(snapshot: AdaptiveSnapshot) { return snapshot.purposes.find(p => p.purpose === PURPOSE)!; }
async function confirm(service: AdaptiveService) {
  return service.confirm(123, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
}
async function grant(service: AdaptiveService) {
  const initial = await service.read(123, 'work');
  const presented = await service.present(123, { space: 'work', purpose: PURPOSE, locale: 'en',
    expectedRevision: permission(initial).revision, eventId: 'present-0001' });
  return service.changeConsent(123, { space: 'work', purpose: PURPOSE, state: 'granted',
    expectedRevision: permission(presented).revision, eventId: 'grant-000001', receipt: presented.receipt });
}
describe('durable adaptive account boundaries', () => {
  it('defaults every optional purpose off, requires explicit account confirmation, and has no registry fallback', async () => {
    const { service } = await setup(false);
    const initial = await service.read(123, 'work');
    expect(initial.identity.confirmed).toBe(false);
    expect(initial.purposes.every(p => p.state === 'not_asked' && !p.available)).toBe(true);
    await expect(service.createMemory(123, { space: 'work', text: 'private', eventId: 'memory-00001', expectedRevision: 1 })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    const confirmed = await confirm(service);
    expect(confirmed.identity.verification).toBe('account_confirmation');
    expect(confirmed.identity.adultDeclared).toBe(true);
    expect(confirmed.explicitMemoryAvailable).toBe(false);
    await expect(grant(service)).rejects.toMatchObject({ code: 'capability_unavailable' });
  });
  it('commits permission, immutable receipt event and invalidation atomically; historical replay stays deduplicated after later transitions', async () => {
    const { service, factory, directory } = await setup();
    await confirm(service);
    const granted = await grant(service);
    expect(permission(granted).state).toBe('granted');
    const command = { space: 'work' as const, purpose: PURPOSE, state: 'withdrawn' as const,
      expectedRevision: permission(granted).revision, eventId: 'withdraw-001' };
    const withdrawn = await service.changeConsent(123, command);
    expect(permission(withdrawn).state).toBe('withdrawn');
    expect((await factory().changeConsent(123, command)).revision).toBe(withdrawn.revision);
    await expect(service.changeConsent(123, { ...command, state: 'declined' })).rejects.toMatchObject({ code: 'event_conflict' });
    const stored = JSON.parse(await readFile(join(directory, (await readdir(directory)).find(f => f.endsWith('.json'))!), 'utf8'));
    expect(stored.consentEvents).toHaveLength(3);
    expect(stored.outbox).toHaveLength(2);
    expect(stored.outbox.every((e: object) => !('text' in e))).toBe(true);
    expect((await factory().read(123, 'personal')).purposes.every(p => p.state === 'not_asked')).toBe(true);
  });
  it('requires exact current presentation, rejects stale revisions, and races consent by CAS across independent stores', async () => {
    const { service, factory } = await setup(); await confirm(service);
    const shown = await service.present(123, { space: 'work', purpose: PURPOSE, locale: 'fa', expectedRevision: 1, eventId: 'present-0001' });
    expect(shown.notice.locale).toBe('fa');
    const command = { space: 'work' as const, purpose: PURPOSE, state: 'granted' as const, expectedRevision: 2, eventId: 'grant-000001', receipt: shown.receipt };
    await expect(service.changeConsent(123, { ...command, space: 'personal' })).rejects.toMatchObject({ code: 'presentation_required' });
    const outcomes = await Promise.allSettled([service.changeConsent(123, command), factory().changeConsent(123, { ...command, eventId: 'grant-000002' })]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(permission(await service.read(123, 'work')).revision).toBe(3);
  });
  it('stores explicit private requests without auto-memory opt-in, separates spaces/accounts, and erases content with durable tombstones', async () => {
    const { service, factory, directory } = await setup(); const initial = await confirm(service);
    const command = { space: 'work' as const, text: 'SYNTHETIC_PRIVATE_ONLY', expectedRevision: initial.revision, eventId: 'memory-00001' };
    const created = await service.createMemory(123, command);
    expect(created.memories).toHaveLength(1);
    expect(created.purposes.find(p => p.purpose === 'optional.auto_memory')!.state).toBe('not_asked');
    expect((await factory().read(123, 'work')).memories).toHaveLength(1);
    expect((await service.read(123, 'personal')).memories).toEqual([]);
    expect((await service.read(124, 'work')).memories).toEqual([]);
    const memory = created.memories[0];
    const deleted = await service.deleteMemory(123, memory.id, { space: 'work', expectedRevision: memory.revision, eventId: 'delete-00001' });
    expect(deleted.memories).toEqual([]);
    expect((await factory().createMemory(123, command)).memories).toEqual([]);
    const raw = await readFile(join(directory, (await readdir(directory)).find(f => f.endsWith('.json'))!), 'utf8');
    expect(raw).not.toContain('SYNTHETIC_PRIVATE_ONLY');
    expect(raw).toContain('"status":"deleted"');
  });
  it('makes writes transactional on failure and survives separate repository instances without lost writes', async () => {
    const { service, factory } = await setup(); const initial = await confirm(service);
    const results = await Promise.allSettled([service.createMemory(123, { space: 'work', text: 'first', expectedRevision: initial.revision, eventId: 'memory-00001' }),
      factory().createMemory(123, { space: 'work', text: 'second', expectedRevision: initial.revision, eventId: 'memory-00002' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await service.read(123, 'work')).memories).toHaveLength(1);
  });
  it('materializes consent expiry transactionally and permits deliberate fresh presentation without auto-regrant', async () => {
    const { service, setNow } = await setup(); await confirm(service); await grant(service);
    setNow(NOW + 366 * 86400_000); await confirm(service);
    const expired = await service.read(123, 'work');
    expect(permission(expired).state).toBe('expired');
    const presented = await service.present(123, { space: 'work', purpose: PURPOSE, locale: 'en',
      expectedRevision: permission(expired).revision, eventId: 'reopen-00001', deliberateReopen: true });
    expect(permission(presented).state).toBe('presented');
  });
  it('retention removes source text while retaining replay suppression, and expired confirmation cannot read it', async () => {
    const { service, setNow } = await setup(); const initial = await confirm(service);
    await service.createMemory(123, { space: 'work', text: 'expires', expectedRevision: initial.revision, eventId: 'memory-00001' });
    setNow(NOW + 13 * 3600_000);
    expect((await service.read(123, 'work')).memories).toEqual([]);
    await expect(service.createMemory(123, { space: 'work', text: 'new', expectedRevision: 3, eventId: 'memory-00002' })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    setNow(NOW + 91 * 86400_000); await confirm(service);
    expect((await service.read(123, 'work')).memories).toEqual([]);
  });
  it('requires exact per-agent grants and personalization, and a revoke/regrant cannot validate prepared context', async () => {
    const { service } = await setup(); const initial = await confirm(service);
    const saved = await service.createMemory(123, { space: 'work', text: 'SYNTHETIC agent fact', expectedRevision: initial.revision, eventId: 'memory-00001' });
    expect((await service.readPrivateContext(123, 'work', 'allowed-agent')).memories).toEqual([]);
    await grant(service);
    expect((await service.readPrivateContext(123, 'work', 'allowed-agent')).memories).toEqual([]);
    const current = await service.read(123, 'work');
    const allowed = await service.setAgentAccess(123, 'allowed-agent', { space: 'work', allowed: true, expectedRevision: current.revision, eventId: 'agent-grant-01' });
    const context = await service.readPrivateContext(123, 'work', 'allowed-agent');
    expect(context.memories).toEqual([{ id: saved.memories[0].id, text: 'SYNTHETIC agent fact' }]);
    expect((await service.readPrivateContext(123, 'work', 'other-agent')).memories).toEqual([]);
    expect((await service.readPrivateContext(123, 'personal', 'allowed-agent')).memories).toEqual([]);
    const revoked = await service.setAgentAccess(123, 'allowed-agent', { space: 'work', allowed: false, expectedRevision: allowed.revision, eventId: 'agent-revoke01' });
    expect((await service.readPrivateContext(123, 'work', 'allowed-agent')).memories).toEqual([]);
    await service.setAgentAccess(123, 'allowed-agent', { space: 'work', allowed: true, expectedRevision: revoked.revision, eventId: 'agent-regrant1' });
    expect((await service.readPrivateContext(123, 'work', 'allowed-agent')).revision).not.toBe(context.revision);
  });
  it('invalidates prepared private context when a registry approval expires without a stored record changing', async () => {
    const { service, setNow } = await setup(true, 3600_000); const initial = await confirm(service);
    await service.createMemory(123, { space: 'work', text: 'short approval', expectedRevision: initial.revision, eventId: 'memory-00001' });
    const granted = await grant(service);
    await service.setAgentAccess(123, 'agent', { space: 'work', allowed: true, expectedRevision: granted.revision, eventId: 'agent-grant-01' });
    const prepared = await service.readPrivateContext(123, 'work', 'agent');
    expect(prepared.memories).toHaveLength(1);
    setNow(NOW + 2 * 3600_000);
    const current = await service.readPrivateContext(123, 'work', 'agent');
    expect(current.memories).toEqual([]); expect(current.revision).not.toBe(prepared.revision);
  });
  it('does not give the legacy runtime consent-based access to unscoped memory or history', async () => {
    const { service } = await setup(); await confirm(service); await grant(service);
    expect(await service.runtimePrivacy.read('agent', 'tg-123')).toMatchObject({ memoryEnabled: false, historyEnabled: false });
    expect(await service.runtimePrivacy.read('agent', 'guessed-person')).toMatchObject({ memoryEnabled: false, historyEnabled: false });
  });
  it('serves the legacy runtime privacy read from the committed document without rewriting it', async () => {
    const { service, directory } = await setup(); await confirm(service); await grant(service);
    const first = await service.runtimePrivacy.read('agent', 'tg-123');
    const [file] = (await readdir(directory)).filter(name => name.endsWith('.json'));
    const before = await readFile(join(directory, file));
    const second = await service.runtimePrivacy.read('agent', 'tg-123', 'work');
    expect(second).toEqual(first);
    expect(await readFile(join(directory, file))).toEqual(before);
    // A missing account still goes through the transaction, which creates it.
    expect(await service.runtimePrivacy.read('agent', 'tg-124')).toMatchObject({ memoryEnabled: false, historyEnabled: false });
    expect((await readdir(directory)).filter(name => name.endsWith('.json'))).toHaveLength(2);
    expect((await service.readPrivateContext(123, 'personal', 'agent')).memories).toEqual([]);
  });
});
