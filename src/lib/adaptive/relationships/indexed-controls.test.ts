import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor, digest, type AdaptiveDocument } from '../persistence/repository';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveRelationshipService } from './service';
import { PreferenceLearningService } from '../personalization/learning/service';
import { learningStudioFingerprint } from '../personalization/learning/state';
import { DecisionService, OpenAIDecisionProvider, type DecisionInput } from '../decisions';
import { LEARNING_VERSION } from '../personalization/learning/contracts';

const NOW = 1_800_000_000_000, scope = { space: 'work' as const, agentId: 'agent' };
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'vox-indexed-relationship-learning-'));
  let now = NOW, approvalUntil = NOW + 1_000_000, studio: string | null = digest('synthetic-studio');
  const storage = new SqliteAdaptiveStorage(join(directory, 'private.sqlite'), { now: () => now });
  const repo = new AdaptiveRepository(storage), accountId = accountIdFor(123);
  const capabilities = ['core_text', 'auto_memory', 'personalization', 'proactive_suggestions', 'relationship_outreach'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-only', enabledCapabilities: capabilities,
    accounts: [{ accountId, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-only', effectiveAt: NOW,
      reviewExpiresAt: NOW + 1_000_000, owner: 'synthetic', approvalReference: 'synthetic' })) }));
  const adaptive = new AdaptiveService(repo, { ...options, now: () => now, scopedRelationshipsEnabled: true,
    capabilityPolicy: (input, at) => { const p = options.capabilityPolicy!(input, at); return { ...p, approvals: p.approvals.map(a => ({ ...a, reviewExpiresAt: approvalUntil })) }; } });
  adaptive.setPreferenceLearningAuthority(() => studio);
  await repo.transaction(accountId, () => now, d => {
    d.binding = { schemaVersion: 1, id: 'interactive-binding', revision: 1, accountId, personId: d.personId,
      status: 'verified', method: 'account_confirmation', createdAt: now, updatedAt: now, verifiedAt: now, expiresAt: now + 900_000 };
    d.declaration = { adultConfirmed: true, declaredAt: now };
    for (const p of d.permissions) { p.state = 'granted'; p.expiresAt = now + 800_000; }
    d.agentGrants = [{ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: now }];
    d.relationships.bindings = [{ id: 'durable-relationship', revision: 1, accountId, personId: d.personId, space: 'work', status: 'active', confirmedAt: now, expiresAt: now + 850_000, originBindingId: d.binding.id }];
    d.experience.settings.timezone = 'UTC'; d.experience.settings.quietStartHour = 0; d.experience.settings.quietEndHour = 0;
    d.experience.settings.work = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false };
    d.relationships.externalSettings.work = true;
    d.memories = Array.from({ length: 300 }, (_, i) => ({ id: `memory-${i}`, revision: 1, space: 'work', text: `Synthetic private body ${i}`,
      status: 'active', createdAt: now, updatedAt: now, expiresAt: now + 700_000, revocationEpoch: 0 }));
  });
  const relationships = new AdaptiveRelationshipService(adaptive);
  let providerHook: ((guard: () => boolean) => Promise<void> | void) | undefined;
  const provider = { committedExportFence: true as const, evaluate: vi.fn(async (input: DecisionInput, _signal: AbortSignal, guard?: () => boolean) => {
    expect(guard).toBeDefined(); expect(guard!()).toBe(true);
    await providerHook?.(guard!);
    return { model: 'gpt-6-luna', answers: input.questions.map(q => {
      if (q.type !== 'choice') throw Error('synthetic choice expected');
      const choice = q.name === 'response_length' ? 'brief' : 'unknown';
      return { name: q.name, type: q.type, choice, confidence: 0.99, probabilities: q.choices.map(c => ({ value: c.value, probability: c.value === choice ? 1 : 0 })) };
    }) };
  }) };
  const learning = new PreferenceLearningService(adaptive, { secret: 'synthetic-secret-'.repeat(3), now: () => now, agentAuthorityNow: () => studio, decisions: new DecisionService(provider) });
  const raw = () => (storage.readCommittedForEffect(accountId) as { status: 'ready'; document: AdaptiveDocument }).document;
  const mutate = (fn: (d: AdaptiveDocument) => void) => repo.transaction(accountId, () => now, d => { fn(d); d.revision++; d.updatedAt = now; });
  const command = async () => ({ ...scope, expectedRevision: (await learning.view(123, scope)).revision, eventId: randomUUID() });
  const turn = () => ({ sessionId: randomUUID(), turnId: randomUUID(), revision: 1, contextKey: randomUUID() });
  const input = () => ({ telegramId: 123, ...scope, turn: turn(), text: 'Please use brief replies for me.' });
  async function enable() { await learning.present(123, { ...await command(), locale: 'en' }); const v = await learning.view(123, scope);
    expect(v.presentation).toBeDefined(); await learning.toggle(123, { ...await command(), enabled: true, version: LEARNING_VERSION, receipt: v.presentation!.receipt }); }
  const f = { directory, storage, adaptive, repo, relationships, learning, provider, raw, mutate, command, input, enable,
    setNow: (at: number) => { now = at; }, now: () => now, setStudio: (value: string | null) => { studio = value; },
    setApproval: (at: number) => { approvalUntil = at; }, onProvider: (hook: typeof providerHook) => { providerHook = hook; },
    close: async () => { await learning.tasks.close(); await learning.tasks.settle(); storage.close(); rmSync(directory, { recursive: true, force: true }); } };
  fixtures.push(f); return f;
}
function pureIo(f: Awaited<ReturnType<typeof fixture>>) { const before = { ...f.storage.io }; return () => {
  expect(f.storage.io.canonicalImageReads - before.canonicalImageReads).toBe(0);
  expect(f.storage.io.bodyRowsRead - before.bodyRowsRead).toBe(0);
}; }
it('resolves and authorizes real 300-body SQLite controls without canonical/body loads or prune-on-read', async () => {
  const f = await fixture(), permit = (await f.relationships.resolve(123, 'agent', 'work'))!;
  expect(permit.key.scope!.bindingId).toBe('durable-relationship');
  const source = (await f.relationships.acceptSource(permit, { id: 'source', at: NOW, channel: 'telegram' }))!;
  expect(source).not.toBeNull(); const revision = f.raw().revision, check = pureIo(f);
  expect(await f.relationships.resolve(123, 'agent', 'work')).toMatchObject({ fingerprint: permit.fingerprint });
  expect(await f.relationships.authorize(permit.key, [source.id], 'external', permit.fingerprint)).not.toBeNull(); check();
  expect(f.raw().revision).toBe(revision);
  await f.mutate(d => { d.binding!.expiresAt = NOW + 1; }); f.setNow(NOW + 2);
  const after = pureIo(f); expect(await f.relationships.resolve(123, 'agent', 'work')).not.toBeNull(); after();
});
it('denies relationship wrong space, source expiry, revoked source and grant ABA without canonical reads', async () => {
  const f = await fixture(), permit = (await f.relationships.resolve(123, 'agent', 'work'))!;
  await f.relationships.acceptSource(permit, { id: 'source', at: NOW, channel: 'telegram' });
  const check = pureIo(f); expect(await f.relationships.resolve(123, 'agent', 'personal')).toBeNull();
  expect(await f.relationships.authorize({ ...permit.key, scope: { ...permit.key.scope!, space: 'personal' } }, ['source'], 'context')).toBeNull(); check();
  await f.mutate(d => { d.relationships.sources[0].expiresAt = NOW + 1; }); f.setNow(NOW + 2);
  expect(await f.relationships.authorize(permit.key, ['source'], 'context')).toBeNull();
  await f.mutate(d => { d.agentGrants[0].allowed = false; d.agentGrants[0].revision++; });
  expect(await f.relationships.resolve(123, 'agent', 'work')).toBeNull();
  await f.mutate(d => { d.agentGrants[0].allowed = true; d.agentGrants[0].revision++; });
  expect(await f.relationships.authorize(permit.key, [], 'context', permit.fingerprint)).toBeNull();
  const fresh = (await f.relationships.resolve(123, 'agent', 'work'))!;
  await f.relationships.acceptSource(fresh, { id: 'fresh-source', at: f.now(), channel: 'telegram' });
  await f.mutate(d => { d.relationships.sources.find(s => s.id === 'fresh-source')!.status = 'deleted'; });
  expect(await f.relationships.authorize(fresh.key, ['fresh-source'], 'context')).toBeNull();
});
it('denies a capability deadline crossed in relationship control COMMIT and durably fences restart regression', async () => {
  const f = await fixture(); f.setApproval(NOW + 5);
  const exec = f.storage.database.exec.bind(f.storage.database);
  vi.spyOn(f.storage.database, 'exec').mockImplementation(sql => { const result = exec(sql); if (sql === 'COMMIT') f.setNow(NOW + 6); return result; });
  const check = pureIo(f); expect(await f.relationships.resolve(123, 'agent', 'work')).toBeNull(); check();
  f.storage.close(); const reopened = new SqliteAdaptiveStorage(join(f.directory, 'private.sqlite'), { now: () => NOW + 4 });
  try { expect(reopened.indexed.readControls(accountIdFor(123), 'work')).toMatchObject({ status: 'unavailable', reason: 'clock_regression' }); } finally { reopened.close(); }
});
it('uses compact learning current/enqueue and provider guards, then genuinely creates and explicitly uses a candidate', async () => {
  const f = await fixture(); await f.enable();
  const enqueue = vi.spyOn(f.learning.tasks, 'enqueue').mockReturnValue(true), check = pureIo(f);
  expect(f.learning.enqueue(f.input())).toBe(true); check(); enqueue.mockRestore();
  f.onProvider(guard => { const checkGuard = pureIo(f); expect(guard()).toBe(true); checkGuard(); });
  expect(f.learning.enqueue(f.input())).toBe(true); await f.learning.tasks.settle();
  expect(f.provider.evaluate).toHaveBeenCalledTimes(1);
  const view = await f.learning.view(123, scope); expect(view.enabled).toBe(true); expect(view.candidates).toHaveLength(1);
  await f.learning.review(123, { ...await f.command(), candidateId: view.candidates[0].id, action: 'use' });
  expect(f.raw().experience.preferences[0].setting).toEqual({ key: 'response_length', value: 'brief' });
});
it.each(['intent', 'turn', 'capability', 'studio', 'grant'] as const)('blocks late learning provider completion after %s changes', async kind => {
  const f = await fixture(); await f.enable();
  f.onProvider(async guard => {
    if (kind === 'studio') f.setStudio(null);
    else if (kind === 'capability') f.setApproval(NOW);
    else await f.mutate(d => {
      if (kind === 'intent') d.experience.preferenceLearning!.intents[0].expiresAt = NOW;
      if (kind === 'turn') d.experience.predictionTurns[0].expiresAt = NOW;
      if (kind === 'grant') { d.agentGrants[0].allowed = false; d.agentGrants[0].revision++; }
    });
    const check = pureIo(f); expect(guard()).toBe(false); check();
  });
  expect(f.learning.enqueue(f.input())).toBe(true); await f.learning.tasks.settle();
  expect(f.raw().experience.preferenceLearning?.candidates ?? []).toEqual([]);
});
it('denies wrong-space and revoked/ABA learning intents before retaining text', async () => {
  const f = await fixture(); await f.enable(); const enqueue = vi.spyOn(f.learning.tasks, 'enqueue').mockReturnValue(true);
  const check = pureIo(f); expect(f.learning.enqueue({ ...f.input(), space: 'personal' })).toBe(false); check(); expect(enqueue).not.toHaveBeenCalled();
  await f.mutate(d => { d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.epoch++; });
  expect(f.learning.enqueue(f.input())).toBe(false); expect(enqueue).not.toHaveBeenCalled();
});
it('same-data new store invalidates relationship and learning receipts, while a fresh workflow still succeeds', async () => {
  const f = await fixture(); await f.enable(); const permit = (await f.relationships.resolve(123, 'agent', 'work'))!;
  await f.relationships.acceptSource(permit, { id: 'old-source', at: NOW, channel: 'telegram' });
  const data = structuredClone(f.raw()), next = await fixture();
  await next.repo.transaction(accountIdFor(123), next.now, d => { Object.assign(d, data); });
  expect(next.adaptive.storeIdentity).not.toBe(f.adaptive.storeIdentity);
  expect(await next.relationships.authorize(permit.key, ['old-source'], 'context', permit.fingerprint)).toBeNull();
  const stopped = vi.spyOn(next.learning.tasks, 'enqueue').mockReturnValue(true); expect(next.learning.enqueue(next.input())).toBe(false); expect(stopped).not.toHaveBeenCalled(); stopped.mockRestore();
  expect(learningStudioFingerprint(next.adaptive, digest('synthetic-studio'))).not.toBe(data.experience.preferenceLearning!.intents[0].studioFingerprint);
  await next.enable(); expect(next.learning.enqueue(next.input())).toBe(true); await next.learning.tasks.settle();
  expect((await next.learning.view(123, scope)).candidates).toHaveLength(1);
  const fresh = (await next.relationships.resolve(123, 'agent', 'work'))!;
  expect(await next.relationships.acceptSource(fresh, { id: 'new-source', at: NOW, channel: 'telegram' })).not.toBeNull();
});
it('the configured SDK final fetch fence denies an expiry between provider dispatch and actual transport', async () => {
  const f = await fixture(); await f.enable(); const transport = vi.fn<typeof fetch>();
  const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-unused', dangerouslyAllowBrowser: true }, transport);
  const evaluate = provider.evaluate.bind(provider);
  vi.spyOn(provider, 'evaluate').mockImplementation((input, signal, guard) => { f.setApproval(NOW); return evaluate(input, signal, guard); });
  const learning = new PreferenceLearningService(f.adaptive, { secret: 'synthetic-secret-'.repeat(3), decisions: new DecisionService(provider), now: f.now, agentAuthorityNow: () => digest('synthetic-studio') });
  try { expect(learning.enqueue(f.input())).toBe(true); await learning.tasks.settle(); expect(provider.evaluate).toHaveBeenCalledTimes(1); expect(transport).not.toHaveBeenCalled(); }
  finally { await learning.tasks.close(); await learning.tasks.settle(); }
});
it('reads the learning current state through immutable controls without loading 300 canonical bodies', async () => {
  const f = await fixture(); await f.enable();
  const current = f.learning as unknown as { currentNow(id: number, scope: { space: 'work'; agentId: string }): { fingerprint: string; expiresAt: number } };
  const check = pureIo(f); expect(current.currentNow(123, scope)).toMatchObject({ expiresAt: NOW + 800_000 }); check();
  f.setApproval(NOW); const denied = pureIo(f); expect(() => current.currentNow(123, scope)).toThrow(); denied();
});
it('does not release queued text under a replacement learning intent with the same authority', async () => {
  const f = await fixture(); await f.enable();
  const queued = vi.spyOn(f.learning.tasks, 'enqueue').mockReturnValue(true); const input = f.input();
  expect(f.learning.enqueue(input)).toBe(true); const retained = queued.mock.calls[0][0];
  input.turn.revision = 99; expect(retained.turn.revision).toBe(1); queued.mockRestore();
  await f.mutate(d => { d.experience.preferenceLearning!.intents[0].id = randomUUID(); });
  expect(f.learning.tasks.enqueue(retained)).toBe(true); await f.learning.tasks.settle();
  expect(f.provider.evaluate).not.toHaveBeenCalled();
});
it.each(['binding', 'permission', 'intent'] as const)('denies learning enqueue when %s expires during native COMMIT', async kind => {
  const f = await fixture(); await f.enable();
  await f.mutate(d => {
    if (kind === 'binding') d.binding!.expiresAt = NOW + 5;
    if (kind === 'permission') d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.expiresAt = NOW + 5;
    if (kind === 'intent') d.experience.preferenceLearning!.intents[0].expiresAt = NOW + 5;
  });
  const exec = f.storage.database.exec.bind(f.storage.database);
  vi.spyOn(f.storage.database, 'exec').mockImplementation(sql => { const value = exec(sql); if (sql === 'COMMIT') f.setNow(NOW + 6); return value; });
  const queued = vi.spyOn(f.learning.tasks, 'enqueue').mockReturnValue(true), check = pureIo(f);
  expect(f.learning.enqueue(f.input())).toBe(false); expect(queued).not.toHaveBeenCalled(); check();
});
