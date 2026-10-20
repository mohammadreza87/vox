import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveExperienceService } from '../runtime/service';
import { AdaptiveRelationshipService } from '../relationships/service';
import type { SpaceKind } from '../persistence/repository';
const NOW = 1_800_000_000_000;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup(scopedEnabled = true, approvalMs = 100 * 86_400_000) {
  const directory = await mkdtemp(join(tmpdir(), 'vox-scoped-relationship-')); directories.push(directory);
  let now = NOW;
  const capabilities = ['core_text', 'personalization', 'auto_memory', 'proactive_suggestions', 'relationship_outreach'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-only',
    enabledCapabilities: capabilities, accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, index) => ({ schemaVersion: 1, id: `approval-${index}`, revision: 1,
      createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-only',
      effectiveAt: NOW, reviewExpiresAt: NOW + approvalMs, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) }));
  const factory = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), { ...options, scopedRelationshipsEnabled: scopedEnabled, now: () => now });
  const adaptive = factory();
  const service = new AdaptiveRelationshipService(adaptive);
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  async function grant(purpose: OptionalPurpose, space: SpaceKind = 'work') {
    const initial = await adaptive.read(123, space);
    const row = initial.purposes.find(p => p.purpose === purpose)!;
    const presented = await adaptive.present(123, { space, purpose, locale: 'en', expectedRevision: row.revision, eventId: randomUUID(), deliberateReopen: true });
    const command = { space, purpose, state: 'granted' as const, expectedRevision: presented.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), receipt: presented.receipt };
    return adaptive.changeConsent(123, command);
  }
  async function enable(space: SpaceKind = 'work') {
    for (const purpose of ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'] as const) await grant(purpose, space);
    const snapshot = await adaptive.read(123, space);
    await adaptive.setAgentAccess(123, 'agent', { space, allowed: true, expectedRevision: snapshot.revision, eventId: randomUUID() });
    await adaptive.withAccountDocument(123, d => {
      d.experience.settings.timezone = 'UTC'; d.experience.settings.quietStartHour = 0; d.experience.settings.quietEndHour = 0;
      d.experience.settings[space] = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false };
    });
    const permit = (await service.resolve(123, 'agent', space))!;
    expect(permit).not.toBeNull();
    const source = (await service.acceptSource(permit, { id: `${space}-source`, at: now, channel: 'telegram' }))!;
    return { permit, source };
  }
  const raw = async () => JSON.parse(await readFile(join(directory, (await readdir(directory)).find(f => f.endsWith('.json'))!), 'utf8'));
  return { adaptive, service, factory, enable, grant, directory, raw, setNow: (value: number) => { now = value; } };
}

describe('scoped relationship authority and private delivery', () => {
  it('keeps dismissed check-ins terminal and repeated dismissal idempotent after file restart', async () => {
    const { service, enable, factory, raw } = await setup(); const { permit, source } = await enable();
    await service.publish(permit.key, 'feedback-check-in', 'Synthetic check-in.', [source.id], permit.fingerprint);
    await service.feedback(123, 'agent', 'work', 'feedback-check-in', 'read');
    expect((await service.inbox(123, 'agent', 'work'))[0]).toMatchObject({ status: 'read', text: 'Synthetic check-in.' });
    await service.feedback(123, 'agent', 'work', 'feedback-check-in', 'dismissed');
    const dismissed = await raw();
    expect(dismissed.relationships.inbox[0]).toMatchObject({ status: 'dismissed', text: '' });
    const restarted = new AdaptiveRelationshipService(factory());
    await restarted.feedback(123, 'agent', 'work', 'feedback-check-in', 'read');
    expect(await restarted.inbox(123, 'agent', 'work')).toEqual([]);
    await restarted.feedback(123, 'agent', 'work', 'feedback-check-in', 'dismissed');
    await restarted.feedback(123, 'agent', 'work', 'feedback-check-in', 'dismissed');
    expect(await raw()).toEqual(dismissed);
  });
  it('preserves feedback scope and source-cancellation fences', async () => {
    const { service, enable, raw } = await setup(); const { permit, source } = await enable();
    await service.publish(permit.key, 'cancelled-check-in', 'Synthetic check-in.', [source.id], permit.fingerprint);
    await expect(service.feedback(123, 'agent', 'personal', 'cancelled-check-in', 'read')).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.feedback(123, 'other-agent', 'work', 'cancelled-check-in', 'read')).rejects.toMatchObject({ code: 'not_found' });
    await service.invalidate(123, 'work', { sourceIds: [source.id], reason: 'source_deleted' });
    const cancelled = await raw();
    expect(cancelled.relationships.inbox[0]).toMatchObject({ status: 'cancelled', text: '' });
    await expect(service.feedback(123, 'agent', 'work', 'cancelled-check-in', 'read')).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.feedback(123, 'agent', 'work', 'cancelled-check-in', 'dismissed')).rejects.toMatchObject({ code: 'not_found' });
    expect(await raw()).toEqual(cancelled);
  });
  it('keeps auto memory disabled without an explicit scoped implementation switch', async () => {
    const { adaptive, service } = await setup(false);
    expect((await adaptive.read(123, 'work')).purposes.find(p => p.purpose === 'optional.auto_memory')!.available).toBe(false);
    expect(await service.resolve(123, 'agent', 'work')).toBeNull();
    expect(await adaptive.runtimePrivacy.read('agent', 'tg-123')).toMatchObject({ memoryEnabled: false, historyEnabled: false });
  });
  it('migrates exactly valid fourteen-purpose documents without changing existing decisions', async () => {
    const { adaptive, factory, directory, raw } = await setup();
    await adaptive.read(123, 'work');
    const document = await raw();
    document.permissions = document.permissions.filter((p: { purpose: string }) => p.purpose !== 'optional.relationship_outreach');
    delete document.relationships;
    const old = structuredClone(document.permissions);
    const file = join(directory, (await readdir(directory)).find(f => f.endsWith('.json'))!);
    await writeFile(file, JSON.stringify(document));
    await factory().read(123, 'work');
    const migrated = await raw();
    expect(migrated.permissions.filter((p: { purpose: string }) => p.purpose !== 'optional.relationship_outreach')).toEqual(old);
    expect(migrated.permissions.filter((p: { purpose: string }) => p.purpose === 'optional.relationship_outreach').map((p: { state: string }) => p.state)).toEqual(['not_asked', 'not_asked']);
    document.permissions[0].purpose = 'optional.relationship_outreach';
    await writeFile(file, JSON.stringify(document));
    await expect(factory().read(123, 'work')).rejects.toThrow();
  });
  it('separates accounts, spaces, bindings and source lineage while never retaining raw input', async () => {
    const { service, enable, raw } = await setup(); const { permit, source } = await enable();
    expect(await service.authorize(permit.key, [source.id], 'context', permit.fingerprint)).not.toBeNull();
    expect(await service.authorize({ ...permit.key, scope: { ...permit.key.scope!, space: 'personal' } }, [source.id], 'context')).toBeNull();
    expect(await service.authorize({ ...permit.key, scope: { ...permit.key.scope!, accountId: accountIdFor(124) } }, [source.id], 'context')).toBeNull();
    expect(await service.authorize(permit.key, ['unknown-source'], 'context')).toBeNull();
    expect(await service.acceptSource(permit, { id: source.id, at: NOW + 1, channel: 'call' })).toBeNull();
    expect(JSON.stringify((await raw()).relationships.sources)).not.toContain('text');
  });
  it('publishes the exact reviewed draft once and requires separate consent and setting for generic external delivery', async () => {
    const { service, enable, grant } = await setup(); const { permit, source } = await enable();
    expect(await service.publish(permit.key, 'intention-1', 'How did the discussion go?', [source.id], permit.fingerprint)).toEqual({ id: 'intention-1', external: false });
    expect(await service.publish(permit.key, 'intention-1', 'How did the discussion go?', [source.id], permit.fingerprint)).toEqual({ id: 'intention-1', external: false });
    expect(await service.publish(permit.key, 'intention-1', 'Changed content', [source.id], permit.fingerprint)).toBeNull();
    expect((await service.inbox(123, 'agent', 'work'))[0].text).toBe('How did the discussion go?');
    expect(await service.reserveExternal(permit.key, 'intention-1', permit.fingerprint)).toBeNull();
    await grant('optional.relationship_outreach'); await service.configureExternal(123, 'work', true);
    const fresh = (await service.authorize(permit.key, [source.id], 'external'))!;
    const reservation = (await service.reserveExternal(permit.key, 'intention-1', fresh.fingerprint))!;
    expect(reservation.text).toBe('You have an update in Vox.');
    expect(await service.maySendExternal(permit.key, 'intention-1', reservation.reservationId)).toBe(true);
    await service.recordExternal(permit.key, 'intention-1', reservation.reservationId, 'unknown');
    expect(await service.reserveExternal(permit.key, 'intention-1', fresh.fingerprint)).toBeNull();
    expect(await service.maySendExternal(permit.key, 'intention-1', reservation.reservationId)).toBe(false);
  });
  it('reserves one cross-space budget transactionally across independent writers', async () => {
    const { service, adaptive, factory, enable } = await setup();
    const work = await enable('work'), personal = await enable('personal');
    await adaptive.withAccountDocument(123, d => { d.experience.settings.dailyCap = 1; d.experience.settings.revision++; });
    const workPermit = (await service.resolve(123, 'agent', 'work'))!, personalPermit = (await service.resolve(123, 'agent', 'personal'))!;
    const peer = new AdaptiveRelationshipService(factory());
    const results = await Promise.all([service.publish(workPermit.key, 'work-intent', 'Work check-in', [work.source.id], workPermit.fingerprint),
      peer.publish(personalPermit.key, 'personal-intent', 'Personal check-in', [personal.source.id], personalPermit.fingerprint)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('withdraws and purges before acknowledgement, and regrant never revives a source', async () => {
    const { service, adaptive, enable, grant, raw } = await setup(); const { permit, source } = await enable();
    await service.publish(permit.key, 'private-intent', 'PRIVATE_CHECK_IN_CANARY', [source.id], permit.fingerprint);
    const invalidator = vi.fn().mockResolvedValue(undefined); adaptive.setRelationshipInvalidator(invalidator);
    const snapshot = await adaptive.read(123, 'work');
    await adaptive.changeConsent(123, { space: 'work', purpose: 'optional.auto_memory', state: 'withdrawn',
      expectedRevision: snapshot.purposes.find(p => p.purpose === 'optional.auto_memory')!.revision, eventId: randomUUID() });
    expect(invalidator).toHaveBeenCalled();
    expect(JSON.stringify(await raw())).not.toContain('PRIVATE_CHECK_IN_CANARY');
    expect(await service.authorize(permit.key, [source.id], 'context')).toBeNull();
    await grant('optional.auto_memory');
    expect(await service.authorize(permit.key, [source.id], 'context')).toBeNull();
    expect(await service.acceptSource((await service.resolve(123, 'agent', 'work'))!, { id: source.id, at: NOW, channel: 'telegram' })).toBeNull();
  });
  it('keeps authority revoked if the derived-state purge hook fails', async () => {
    const { service, adaptive, enable, raw } = await setup(); const { permit, source } = await enable();
    adaptive.setRelationshipInvalidator(async () => { throw new Error('synthetic purge failure'); });
    await expect(service.invalidate(123, 'work', { sourceIds: [source.id], reason: 'forget' })).rejects.toThrow('synthetic purge failure');
    expect((await raw()).relationships.sources[0].status).toBe('deleted');
    expect(await service.authorize(permit.key, [source.id], 'context')).toBeNull();
  });
  it('suppresses unknown-timezone external alerts and invalidates a reservation after a source deletion', async () => {
    const { service, adaptive, enable, grant } = await setup(); const { source } = await enable();
    await grant('optional.relationship_outreach'); await service.configureExternal(123, 'work', true);
    await adaptive.withAccountDocument(123, d => { delete d.experience.settings.timezone; d.experience.settings.revision++; });
    const fresh = (await service.resolve(123, 'agent', 'work'))!;
    expect(await service.publish(fresh.key, 'inbox-only', 'A private update.', [source.id], fresh.fingerprint)).toEqual({ id: 'inbox-only', external: false });
    expect(await service.authorize(fresh.key, [source.id], 'external')).toBeNull();
    await adaptive.withAccountDocument(123, d => { d.experience.settings.timezone = 'UTC'; d.experience.settings.revision++; });
    const external = (await service.authorize(fresh.key, [source.id], 'external'))!;
    const reservation = (await service.reserveExternal(fresh.key, 'inbox-only', external.fingerprint))!;
    await service.invalidate(123, 'work', { sourceIds: [source.id], reason: 'source_deleted' });
    expect(await service.maySendExternal(fresh.key, 'inbox-only', reservation.reservationId)).toBe(false);
    expect(await service.inbox(123, 'agent', 'work')).toEqual([]);
  });
  it('supports next-day background delivery with a 30-day link while inbox and new source capture still need fresh core confirmation', async () => {
    const { service, adaptive, enable, grant, setNow } = await setup(); const { permit, source } = await enable();
    await grant('optional.relationship_outreach'); await service.configureExternal(123, 'work', true);
    setNow(NOW + 25 * 3600_000);
    expect((await adaptive.read(123, 'work')).identity.confirmed).toBe(false);
    const nextDay = (await service.authorize(permit.key, [source.id], 'external'))!;
    expect(nextDay).not.toBeNull();
    expect(await service.publish(nextDay.key, 'next-day', 'How was the meeting?', [source.id], nextDay.fingerprint)).toEqual({ id: 'next-day', external: true });
    expect(await service.inbox(123, 'agent', 'work')).toEqual([]);
    expect(await service.acceptSource(nextDay, { id: 'new-unconfirmed', at: NOW + 25 * 3600_000, channel: 'telegram' })).toBeNull();
    await adaptive.confirm(123, { confirm: true });
    expect((await service.authorize(permit.key, [source.id], 'context'))?.key.scope?.bindingId).toBe(permit.key.scope?.bindingId);
    expect((await service.inbox(123, 'agent', 'work'))[0].text).toBe('How was the meeting?');
    setNow(NOW + 31 * 86_400_000);
    expect(await service.authorize(permit.key, [source.id], 'context')).toBeNull();
    await adaptive.confirm(123, { confirm: true });
    expect((await adaptive.read(123, 'work')).purposes.find(p => p.purpose === 'optional.auto_memory')!.state).toBe('reconsent_required');
  });
  it('requires a recorded new disclosure for earlier automatic-memory grants and never mints a durable link from migration', async () => {
    const { adaptive, factory, enable, raw, directory } = await setup(); await enable();
    const before = await raw();
    const priorConsentEvents = structuredClone(before.consentEvents);
    before.relationships.bindings = [];
    const file = join(directory, (await readdir(directory)).find(f => f.endsWith('.json'))!);
    await writeFile(file, JSON.stringify(before));
    const snapshot = await factory().read(123, 'work');
    expect(snapshot.purposes.find(p => p.purpose === 'optional.auto_memory')!.state).toBe('reconsent_required');
    const migrated = await raw();
    expect(migrated.relationships.bindings).toEqual([]);
    expect(migrated.consentEvents.slice(0, priorConsentEvents.length)).toEqual(priorConsentEvents);
    expect(migrated.events.at(-1).kind).toBe('relationship_reconsent');
    expect((await adaptive.read(123, 'work')).purposes.find(p => p.purpose === 'optional.auto_memory')!.notice.version).toBe('adaptive-relationship-memory-v1');
  });
  it('keeps stop durable before enrollment, across new bindings and while optional features are off', async () => {
    const { service, adaptive, enable, grant, setNow } = await setup();
    await service.control(123, 'agent', 'work', 'stop');
    const { permit } = await enable();
    expect(await service.acceptSource(permit, { id: 'stopped-source', at: NOW, channel: 'telegram' })).toBeNull();
    setNow(NOW + 31 * 86_400_000); await adaptive.confirm(123, { confirm: true });
    await grant('optional.auto_memory');
    const fresh = (await service.resolve(123, 'agent', 'work'))!;
    expect(fresh.key.scope!.bindingId).not.toBe(permit.key.scope!.bindingId);
    expect(await service.acceptSource(fresh, { id: 'stopped-new-binding', at: NOW + 31 * 86_400_000, channel: 'call' })).toBeNull();
    await service.control(123, 'agent', 'work', 'resume');
    expect(await service.acceptSource((await service.resolve(123, 'agent', 'work'))!, { id: 'after-resume', at: NOW + 31 * 86_400_000, channel: 'call' })).not.toBeNull();
    const off = await setup(false);
    await off.service.control(123, 'agent', 'personal', 'pause', NOW + 86_400_000);
    expect((await off.raw()).relationships.controls[0].pausedUntil).toBe(NOW + 86_400_000);
  });
  it('applies the same cross-space interruption cap to the existing failure suggestion producer', async () => {
    const { service, adaptive, enable } = await setup(); const { source } = await enable();
    await adaptive.withAccountDocument(123, d => { d.experience.settings.dailyCap = 1; d.experience.settings.revision++; });
    const fresh = (await service.resolve(123, 'agent', 'work'))!;
    await service.publish(fresh.key, 'only-slot', 'Private check-in.', [source.id], fresh.fingerprint);
    const experience = new AdaptiveExperienceService(adaptive);
    expect(await experience.recordTurn(123, { space: 'work', agentId: 'agent', turnId: 'failed-turn', channel: 'telegram', durationMs: 5, status: 'failed' })).toMatchObject({ inboxCreated: false });
  });
  it('binds trusted endpoint identity to an accepted Telegram event and rejects changed endpoint replay', async () => {
    const { service, enable, raw } = await setup(); const { permit } = await enable();
    const input = { id: 'endpoint-event', at: NOW, channel: 'telegram' as const, endpointId: 'opaque-current-endpoint' };
    const source = await service.acceptSource(permit, input);
    expect(source?.endpointId).toBe('opaque-current-endpoint');
    expect(await service.acceptSource(permit, input)).toEqual(source);
    expect(await service.acceptSource(permit, { ...input, endpointId: 'opaque-different-endpoint' })).toBeNull();
    expect(await service.acceptSource(permit, { ...input, id: 'invalid-endpoint', endpointId: '' })).toBeNull();
    expect(await service.acceptSource(permit, { ...input, id: 'voice-with-endpoint', channel: 'call' })).toBeNull();
    expect((await raw()).relationships.sources.find((s: { id: string }) => s.id === input.id).endpointId).toBe(input.endpointId);
    // Old/no-endpoint receipts remain useful only as inbox/context evidence.
    expect(await service.acceptSource(permit, { id: 'without-endpoint', at: NOW, channel: 'telegram' })).not.toBeNull();
  });
  it('fails quiet when approvals expire and keeps ordinary core confirmation expiry intact', async () => {
    const { service, adaptive, enable, setNow } = await setup(true, 1000); const { permit, source } = await enable();
    setNow(NOW + 1000);
    expect(await service.authorize(permit.key, [source.id], 'context')).toBeNull();
    setNow(NOW + 13 * 3600_000);
    expect((await adaptive.read(123, 'work')).identity.confirmed).toBe(false);
  });
});
