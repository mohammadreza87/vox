import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { AdaptiveRepository, accountIdFor, digest, type AdaptiveDocument } from '../persistence/repository';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { FileAdaptiveStorage } from '../persistence/storage';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { AdaptiveExperienceService } from '../runtime/service';
import { AdaptiveRelationshipService } from './service';
import { PreferenceLearningService } from '../personalization/learning/service';
import { learningAuthority, learningStudioFingerprint } from '../personalization/learning/state';
import { explicitPreferenceContextSnapshot } from '../personalization/explicit';
import { DecisionService, type DecisionInput } from '../decisions';
import { LEARNING_VERSION } from '../personalization/learning/contracts';
const NOW = 1_800_000_000_000, account = accountIdFor(123), scope = { space: 'work' as const, agentId: 'agent' };
type Kind = 'indexed' | 'managed-file' | 'legacy-file';
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
async function fixture(kind: Kind) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-sync-authority-')); let now = NOW, policyUntil = NOW + 100_000;
  const storage = kind === 'indexed' ? new SqliteAdaptiveStorage(join(dir, 'db.sqlite'), { now: () => now }) : new FileAdaptiveStorage(dir);
  // Synthetic FILE identity seam only: the managed transition/durability adapter
  // is independently reviewed. This proves caller namespace semantics on real FILE.
  if (kind === 'managed-file') Object.defineProperty(storage, 'identity', { value: Object.freeze({ incarnation: randomUUID(), generation: 2 }) });
  const repo = new AdaptiveRepository(storage), caps = ['core_text', 'personalization', 'auto_memory', 'proactive_suggestions', 'relationship_outreach'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-sync', enabledCapabilities: caps,
    accounts: [{ accountId: account, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }], approvals: caps.map(capability => ({ schemaVersion: 1, id: 'approval-' + capability,
      revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-sync', effectiveAt: NOW,
      reviewExpiresAt: NOW + 100_000, owner: 'synthetic', approvalReference: 'synthetic' })) }));
  const adaptive = new AdaptiveService(repo, { ...options, scopedRelationshipsEnabled: true, now: () => now,
    capabilityPolicy: (input, at) => { const p = options.capabilityPolicy!(input, at); return { ...p, approvals: p.approvals.map(a => ({ ...a, reviewExpiresAt: policyUntil })) }; } });
  const studio = digest('synthetic-studio'); adaptive.setPreferenceLearningAuthority(() => studio);
  const experience = new AdaptiveExperienceService(adaptive), relationships = new AdaptiveRelationshipService(adaptive);
  const write = (fn: (d: AdaptiveDocument) => void) => repo.transaction(account, () => now, d => { fn(d); d.revision++; d.updatedAt = now; });
  await write(d => {
    d.binding = { schemaVersion: 1, id: 'interactive-binding', revision: 1, accountId: account, personId: d.personId, status: 'verified', method: 'account_confirmation', createdAt: now, updatedAt: now, verifiedAt: now, expiresAt: now + 90_000 };
    d.declaration = { adultConfirmed: true, declaredAt: now }; for (const p of d.permissions) { p.state = 'granted'; p.expiresAt = now + 80_000; }
    d.agentGrants = [{ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: now }];
    d.relationships.bindings = [{ id: 'durable-binding', revision: 1, accountId: account, personId: d.personId, space: 'work', status: 'active', confirmedAt: now, expiresAt: now + 85_000, originBindingId: d.binding.id }];
    d.experience.settings.timezone = 'UTC'; d.experience.settings.quietStartHour = 0; d.experience.settings.quietEndHour = 0;
    d.experience.settings.work = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false }; d.relationships.externalSettings.work = true;
    d.experience.preferences = [{ id: 'explicit', revision: 1, space: 'work', agentId: 'agent', setting: { key: 'response_length', value: 'brief' }, status: 'active', updatedAt: now }];
    d.memories = Array.from({ length: 300 }, (_, i) => ({ id: 'm' + i, revision: 1, space: 'work', text: 'Synthetic private body ' + i, status: 'active', createdAt: now, updatedAt: now, expiresAt: now + 70_000, revocationEpoch: 0 }));
  });
  const provider = { committedExportFence: true as const, evaluate: vi.fn(async (input: DecisionInput, _signal: AbortSignal, guard?: () => boolean) => {
    if (!guard?.()) throw Error('denied'); return { model: 'gpt-6-luna', answers: input.questions.map(q => {
      if (q.type !== 'choice') throw Error('synthetic choices'); const choice = q.name === 'language' ? 'fa' : 'unknown';
      return { name: q.name, type: q.type, choice, confidence: 0.99, probabilities: q.choices.map(c => ({ value: c.value, probability: c.value === choice ? 1 : 0 })) };
    }) };
  }) };
  const learning = new PreferenceLearningService(adaptive, { secret: 'synthetic-secret-'.repeat(3), decisions: new DecisionService(provider), agentAuthorityNow: () => studio, now: () => now });
  const raw = () => { const r = adaptive.readCommittedForEffect(123, d => d); if (r.status !== 'ready') throw Error('fixture missing'); return r.value; };
  const command = async () => ({ ...scope, expectedRevision: (await learning.view(123, scope)).revision, eventId: randomUUID() });
  const enable = async () => { await learning.present(123, { ...await command(), locale: 'en' }); const view = await learning.view(123, scope); await learning.toggle(123, { ...await command(), enabled: true, receipt: view.presentation!.receipt, version: LEARNING_VERSION }); };
  const input = () => ({ telegramId: 123, ...scope, turn: { sessionId: randomUUID(), turnId: randomUUID(), revision: 1, contextKey: randomUUID() }, text: 'Please use Persian in future.' });
  const f = { dir, kind, storage, repo, adaptive, experience, relationships, learning, provider, raw, write, enable, input, studio, setNow: (at: number) => { now = at; }, setPolicy: (at: number) => { policyUntil = at; },
    close: async () => { await learning.tasks.close(); await learning.tasks.settle(); if (storage instanceof SqliteAdaptiveStorage) storage.close(); rmSync(dir, { recursive: true, force: true }); } };
  fixtures.push(f); return f;
}
it.each(['indexed', 'managed-file', 'legacy-file'] as const)('sync preference/relationship receipts equal async snapshots on %s', async kind => {
  const f = await fixture(kind), prefs = await f.experience.readPreferences(123, 'work', 'agent'), permit = (await f.relationships.resolve(123, 'agent', 'work'))!;
  expect(prefs.settings).toEqual([{ key: 'response_length', value: 'brief' }]);
  const source = (await f.relationships.acceptSource(permit, { id: 'source', at: NOW, channel: 'telegram' }))!;
  const asyncPermit = await f.relationships.authorize(permit.key, [source.id], 'external', permit.fingerprint);
  const before = f.storage instanceof SqliteAdaptiveStorage ? { ...f.storage.io } : undefined;
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')).toEqual({ revision: prefs.revision, validUntil: NOW + 80_000 });
  expect(f.relationships.resolveNow(123, 'agent', 'work')).toEqual(await f.relationships.resolve(123, 'agent', 'work'));
  expect(f.relationships.authorizeNow(permit.key, [source.id], 'external', permit.fingerprint)).toEqual(asyncPermit);
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'other-binding')).toBeNull();
  if (before && f.storage instanceof SqliteAdaptiveStorage) { expect(f.storage.io.canonicalImageReads).toBe(before.canonicalImageReads); expect(f.storage.io.bodyRowsRead).toBe(before.bodyRowsRead); }
});
it.each(['indexed', 'managed-file'] as const)('sync helpers fail closed on busy %s and preserve valid empty optional context', async kind => {
  const f = await fixture(kind), permit = (await f.relationships.resolve(123, 'agent', 'work'))!;
  const check = () => { expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')).toBeNull(); expect(f.relationships.resolveNow(123, 'agent', 'work')).toBeNull(); expect(f.relationships.authorizeNow(permit.key, [], 'context')).toBeNull(); };
  if (f.storage instanceof SqliteAdaptiveStorage) await f.storage.transact(account, d => { check(); return { document: d, result: undefined }; });
  else { const lock = join(f.dir, createHash('sha256').update(account).digest('hex') + '.json.lock'); mkdirSync(lock); try { check(); } finally { rmSync(lock, { recursive: true }); } }
  await f.write(d => { d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.state = 'withdrawn'; });
  const empty = await f.experience.readPreferences(123, 'work', 'agent'); expect(empty.settings).toEqual([]);
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')?.revision).toBe(empty.revision);
});
it('synchronous deadlines reflect sources/outreach and expire during indexed native work', async () => {
  const f = await fixture('indexed'), permit = (await f.relationships.resolve(123, 'agent', 'work'))!;
  await f.relationships.acceptSource(permit, { id: 'source', at: NOW, channel: 'telegram' });
  await f.write(d => { d.relationships.sources[0].expiresAt = NOW + 100; d.permissions.find(p => p.id === 'permission:work:optional.relationship_outreach')!.expiresAt = NOW + 50; });
  expect(f.relationships.authorizeNow(permit.key, ['source'], 'context')!.expiresAt).toBe(NOW + 100);
  expect(f.relationships.authorizeNow(permit.key, ['source'], 'external')!.expiresAt).toBe(NOW + 50);
  const storage = f.storage as SqliteAdaptiveStorage, exec = storage.database.exec.bind(storage.database);
  f.setPolicy(NOW + 5); const beforeExpiry = f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')!;
  vi.spyOn(storage.database, 'exec').mockImplementation(sql => { const result = exec(sql); if (sql === 'COMMIT') f.setNow(NOW + 6); return result; });
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')?.revision).not.toBe(beforeExpiry.revision);
  expect(f.relationships.resolveNow(123, 'agent', 'work')).toBeNull();
});
it('managed FILE committed reads reject a deadline crossed during control evaluation', async () => {
  const f = await fixture('managed-file'), original = f.adaptive.capabilityStatus.bind(f.adaptive); f.setPolicy(NOW + 5);
  vi.spyOn(f.adaptive, 'capabilityStatus').mockImplementation((...args) => { const value = original(...args); f.setNow(NOW + 6); return value; });
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')).toBeNull();
  expect(f.relationships.resolveNow(123, 'agent', 'work')).toBeNull();
});
it('same-data new managed FILE identity invalidates preference/relationship/learning receipts and admits a genuine new workflow', async () => {
  const first = await fixture('managed-file'); await first.enable(); const permit = (await first.relationships.resolve(123, 'agent', 'work'))!;
  await first.relationships.acceptSource(permit, { id: 'old-source', at: NOW, channel: 'telegram' }); const data = structuredClone(first.raw()), oldPrefs = await first.experience.readPreferences(123, 'work', 'agent');
  const next = await fixture('managed-file'); await next.write(d => { Object.assign(d, data); });
  expect(next.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')!.revision).not.toBe(oldPrefs.revision);
  expect(next.relationships.authorizeNow(permit.key, ['old-source'], 'context', permit.fingerprint)).toBeNull();
  expect(next.learning.enqueue(next.input())).toBe(false);
  await next.enable(); expect(next.learning.enqueue(next.input())).toBe(true); await next.learning.tasks.settle();
  expect(next.provider.evaluate).toHaveBeenCalledTimes(1); expect((await next.learning.view(123, scope)).candidates).toHaveLength(1);
  const fresh = (await next.relationships.resolve(123, 'agent', 'work'))!; expect(next.relationships.resolveNow(123, 'agent', 'work')).toEqual(fresh);
  expect(await next.relationships.acceptSource(fresh, { id: 'new-source', at: NOW, channel: 'telegram' })).not.toBeNull();
});
it('legacy FILE retains original opaque hash inputs rather than adding canonical as a namespace', async () => {
  const f = await fixture('legacy-file'), permit = (await f.relationships.resolve(123, 'agent', 'work'))!, d = f.raw();
  const p = d.permissions.find(p => p.id === 'permission:work:optional.personalization')!;
  const context = [f.adaptive.purposeFingerprint(d, 'work', 'optional.personalization', NOW, 'agent'), true, d.experience.preferences.map(p => [p.id, p.revision, p.status])];
  expect(explicitPreferenceContextSnapshot(f.adaptive, d, 'work', 'agent', NOW).contextReceipt).toBe(digest(context));
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')!.revision).toBe(digest(context));
  expect(learningStudioFingerprint(f.adaptive, f.studio)).toBe(f.studio);
  expect(learningAuthority(f.adaptive, d, scope, NOW)!.fingerprint).toBe(digest([f.adaptive.purposeFingerprint(d, 'work', 'optional.personalization', NOW, 'agent'), f.adaptive.coreFingerprint(d, NOW)]));
  const purposes = ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'] as const;
  const binding = d.relationships.bindings[0], key = permit.key.scope!;
  expect(permit.sourceFence).toBe(digest([key, binding, f.adaptive.capabilityStatus(d, 'core_text', NOW), purposes.map(purpose => [d.permissions.find(c => c.spaceId === key.spaceId && c.purpose === purpose), f.adaptive.capabilityStatus(d, purpose === 'optional.auto_memory' ? 'auto_memory' : purpose === 'optional.personalization' ? 'personalization' : 'proactive_suggestions', NOW)]), d.agentGrants]));
  expect(p.state).toBe('granted');
});

it('publishes optional preference denial after native commit while retaining the binding bound', async () => {
  const f = await fixture('indexed'); f.setPolicy(NOW + 10);
  const storage = f.storage as SqliteAdaptiveStorage, exec = storage.database.exec.bind(storage.database); let commits = 0;
  vi.spyOn(storage.database, 'exec').mockImplementation(sql => {
    const result = exec(sql); if (sql === 'COMMIT' && ++commits === 2) f.setNow(NOW + 11); return result;
  });
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')).not.toBeNull();
  expect(storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(NOW + 11);
  vi.restoreAllMocks(); f.setNow(NOW + 5);
  expect(f.experience.readPreferencesAuthorityNow(123, 'work', 'agent', 'interactive-binding')).toBeNull();
});
