import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor, digest, containerIdFor, spaceIdFor, tenantIdFor, upgradeLegacyAdaptiveDocumentV1ForProductPause, validateAdaptiveDocument } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage, type ManagedAdaptiveStorage } from '../persistence/indexed/managed-storage';
import { ProductPauseService } from './service';
const dirs: string[] = [], stores: ManagedAdaptiveStorage[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const command = (id: string, seq: number, action: 'pause' | 'resume', space: 'work' | 'personal' = 'work') => ({ version: 1, eventId: id.repeat(22), expectedCommandSeq: seq, action, space });
const accountId = accountIdFor(123);
function policy(now: () => number) { return { ...adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-pause', enabledCapabilities: ['core_text', 'personalization'],
  accounts: [{ accountId, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }], approvals: ['core_text', 'personalization'].map(capability => ({ schemaVersion: 1, id: `synthetic-${capability}`, revision: 1, createdAt: 1000, updatedAt: 1000, jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-pause', effectiveAt: 1000, reviewExpiresAt: 1000000, owner: 'synthetic', approvalReference: 'synthetic' })) })), now }; }
function fixture(format: 'sqlite' | 'file') {
  const dir = mkdtempSync(join(tmpdir(), 'vox-product-pause-')); dirs.push(dir); let now = 2000;
  const path = join(dir, format === 'sqlite' ? 'state.sqlite' : 'file');
  const open = () => { const storage = format === 'sqlite' ? new SqliteAdaptiveStorage(path, { now: () => now, ...(!active ? { newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 as const } } : {}) }) : new ManagedFileV2Storage(path, { now: () => now, ...(!active ? { newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 as const } } : {}) }); stores.push(storage); active = storage; return storage; };
  let active: ManagedAdaptiveStorage | undefined;
  const storage = open();
  const services = (s: ManagedAdaptiveStorage) => { const repository = new AdaptiveRepository(s), adaptive = new AdaptiveService(repository, policy(() => now)); return { repository, adaptive, pause: new ProductPauseService(adaptive) }; };
  return { storage, path, services, ...services(storage), reopen: () => { active!.close(); return open(); }, now: () => now, setNow: (v: number) => { now = v; } };
}
for (const format of ['sqlite', 'file'] as const) it(`${format}: pauses without profile, reconciles exact latest, preserves B across restart, no-op epoch and other account/space`, async () => {
  const f = fixture(format);
  expect(await f.pause.read(123, 'work')).toMatchObject({ available: true, productPaused: false, commandSeq: 0, canPause: true, canResume: false });
  expect(f.storage.readCommittedForEffect(accountId)).toEqual({ status: 'ready', document: null });
  const a = command('a', 0, 'pause'); const result = await f.pause.command(123, a);
  expect(result).toMatchObject({ status: { productPaused: true, useEpoch: 1, commandSeq: 1 }, replayed: false });
  f.setNow(2100); expect(await f.pause.command(123, a)).toEqual({ ...result, replayed: true });
  expect(await f.pause.read(123, 'work')).toMatchObject({ latest: result.receipt });
  await expect(f.pause.command(123, { ...a, action: 'resume' })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
  await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  const beforeConsent = f.adaptive.readCommittedForEffect(123, d => digest(d.permissions));
  const b = await f.pause.command(123, command('b', 1, 'resume'));
  expect(b.receipt).toMatchObject({ seq: 2, resultingUseEpoch: 2 });
  expect(f.adaptive.readCommittedForEffect(123, d => digest(d.permissions))).toEqual(beforeConsent);
  const reopened = f.reopen(), services = f.services(reopened);
  await expect(services.pause.command(123, a)).rejects.toMatchObject({ code: 'product_pause_stale' });
  expect(await services.pause.read(123, 'work')).toMatchObject({ productPaused: false, useEpoch: 2, commandSeq: 2, latest: b.receipt });
  expect((await services.pause.command(123, command('c', 2, 'resume'))).receipt).toMatchObject({ result: 'unchanged', seq: 3, resultingUseEpoch: 2 });
  expect(await services.pause.read(123, 'personal')).toMatchObject({ productPaused: false, commandSeq: 0 });
  expect(await services.pause.read(456, 'work')).toMatchObject({ productPaused: false, commandSeq: 0 });
  await services.pause.command(456, command('d', 0, 'pause', 'personal'));
  expect(await services.pause.read(456, 'work')).toMatchObject({ productPaused: false, commandSeq: 0 });
  await expect(services.pause.command(0, command('e', 0, 'pause'))).rejects.toMatchObject({ code: 'authentication_required' });
});
it('inactive v1 GET preserves exact bytes and missing account absence; v2 missing block never defaults', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vox-inactive-pause-')); dirs.push(dir);
  const storage = new FileAdaptiveStorage(dir), repo = new AdaptiveRepository(storage), adaptive = new AdaptiveService(repo, { now: () => 2000 }), pause = new ProductPauseService(adaptive);
  expect(await pause.read(123, 'work')).toMatchObject({ available: false, productPaused: null, reason: 'missing' });
  await repo.transaction(accountId, 2000, () => undefined);
  const actual = join(dir, (await import('node:crypto')).createHash('sha256').update(accountId).digest('hex') + '.json');
  const before = readFileSync(actual, 'utf8'); expect(await pause.read(123, 'work')).toMatchObject({ available: false, reason: 'store_not_prepared' });
  expect(readFileSync(actual, 'utf8')).toBe(before);
  const raw = JSON.parse(before), converted = upgradeLegacyAdaptiveDocumentV1ForProductPause(raw, accountId, 2000);
  const missing = { ...converted }; delete missing.productPause;
  expect(() => validateAdaptiveDocument(missing, accountId, 2000)).toThrow();
  expect(() => upgradeLegacyAdaptiveDocumentV1ForProductPause(missing, accountId, 2000)).toThrow();
  expect(() => upgradeLegacyAdaptiveDocumentV1ForProductPause({ ...raw, productPause: {} }, accountId, 2000)).toThrow();
  const fourteen = { ...raw, permissions: raw.permissions.filter((p: { purpose: string }) => p.purpose !== 'optional.relationship_outreach') };
  expect(upgradeLegacyAdaptiveDocumentV1ForProductPause(fourteen, accountId, 2000).permissions).toHaveLength(16);
});
it('SQLite denies paused IDs and bodies with zero corpus loads, keeps core and no-op catalog semantic stability', async () => {
  const f = fixture('sqlite'), storage = f.storage as SqliteAdaptiveStorage;
  await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  await f.repository.transaction(accountId, f.now, d => {
    d.agentGrants.push({ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: 2000 });
    const p = d.permissions.find(p => p.id === 'permission:work:optional.personalization')!; p.state = 'granted'; p.expiresAt = 100000;
    d.memories.push({ id: 'source', revision: 1, space: 'work', text: 'canary source', status: 'active', createdAt: 2000, updatedAt: 2000, expiresAt: 100000, revocationEpoch: 0 });
  });
  const d = f.adaptive.readCommittedForEffect(123, d => d); if (d.status !== 'ready') throw Error('missing');
  const scope = { accountId, personId: d.value.personId, tenantId: tenantIdFor(accountId), space: 'work' as const, spaceId: spaceIdFor(accountId, 'work'), containerId: containerIdFor(accountId, 'work'), agentId: 'agent', purpose: 'optional.personalization' as const };
  const before = storage.indexed.readRuntimeAuthority(scope); if (before.status !== 'ready') throw Error('denied');
  const ids = storage.indexed.queryCandidateIds(scope, 'canary', before.receipt); if (ids.status !== 'ready') throw Error('denied');
  await f.pause.command(123, command('a', 0, 'pause'));
  for (const k of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[k] = 0;
  expect(storage.indexed.readRuntimeAuthority(scope)).toMatchObject({ status: 'unavailable', reason: 'denied' });
  expect(storage.indexed.loadCandidateBodies(before.receipt, ids.handles)).toMatchObject({ status: 'unavailable' });
  expect(storage.io.canonicalImageReads).toBe(0); expect(storage.io.bodyRowsRead).toBe(0); expect(storage.io.postingRowsRead).toBe(0);
  expect(storage.indexed.readRuntimeAuthority({ ...scope, purpose: 'core_text' }).status).toBe('ready');
  await f.pause.command(123, command('b', 1, 'resume'));
  const resumed = storage.indexed.readRuntimeAuthority(scope); if (resumed.status !== 'ready') throw Error('denied');
  await f.pause.command(123, command('c', 2, 'resume'));
  const noop = storage.indexed.readRuntimeAuthority(scope); if (noop.status !== 'ready') throw Error('denied');
  expect(noop.receipt.catalogDigest).toBe(resumed.receipt.catalogDigest); expect(noop.receipt.catalogVersion).toBe(resumed.receipt.catalogVersion);
  expect(storage.indexed.validateRuntimeReceiptNow(before.receipt).status).toBe('unavailable');
  expect(JSON.stringify(noop.controls)).not.toContain('latest'); expect(noop.controls.productPause).toBeDefined();
});
for (const format of ['sqlite', 'file'] as const) it(`${format}: rollback guard denial and committed response loss retain correct state/time`, async () => {
  const f = fixture(format); let calls = 0;
  await expect(f.pause.command(123, command('a', 0, 'pause'), () => { calls++; throw Error('precommit stop'); })).rejects.toThrow();
  expect(await f.pause.read(123, 'work')).toMatchObject({ productPaused: false, commandSeq: 0 });
  await expect(f.pause.command(123, command('b', 0, 'pause'), () => { if (++calls === 3) { f.setNow(3000); throw Error('lost response'); } })).rejects.toMatchObject({ committed: true });
  const reopened = f.reopen(), services = f.services(reopened);
  expect(await services.pause.read(123, 'work')).toMatchObject({ productPaused: true, commandSeq: 1 });
  expect((await services.pause.command(123, command('b', 0, 'pause'))).replayed).toBe(true);
});
for (const format of ['sqlite', 'file'] as const) it(`${format}: reserved command proof ignores full generic ledgers and survives clear/reconfirmation`, async () => {
  const f = fixture(format); await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  await f.repository.transaction(accountId, f.now, d => {
    d.events = Array.from({ length: 2000 }, (_, i) => ({ eventId: `full-${i}`, fingerprint: 'f', kind: 'synthetic', resultId: 'x', revision: 1 }));
    d.outbox = Array.from({ length: 2000 }, (_, i) => ({ eventId: `outbox-${i}`, kind: 'consent_changed', space: 'work', personId: d.personId, revision: 1, epoch: 0, createdAt: 2000 }));
  });
  const a = await f.pause.command(123, command('a', 0, 'pause'));
  expect(a.status).toMatchObject({ productPaused: true, commandSeq: 1 });
  const before = f.adaptive.readCommittedForEffect(123, d => ({ proof: digest(d.productPause), events: d.events.length, outbox: d.outbox.length }));
  await f.repository.transaction(accountId, f.now, d => { delete d.binding; });
  expect(await f.pause.read(123, 'work')).toMatchObject({ productPaused: true, commandSeq: 1, canResume: false });
  await f.adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  expect(f.adaptive.readCommittedForEffect(123, d => ({ proof: digest(d.productPause), events: d.events.length, outbox: d.outbox.length }))).toEqual(before);
  await expect(f.pause.command(123, { ...command('a', 0, 'pause'), expectedCommandSeq: 1 })).rejects.toMatchObject({ code: 'product_pause_conflict' });
});
it('global revision overflow cannot establish a false successful receipt or reset an existing proof', async () => {
  const f = fixture('sqlite'); await f.repository.transaction(accountId, f.now, d => { d.revision = Number.MAX_SAFE_INTEGER; });
  await expect(f.pause.command(123, command('a', 0, 'pause'))).rejects.toMatchObject({ code: 'revision_exhausted' });
  expect(await f.pause.read(123, 'work')).toMatchObject({ productPaused: false, commandSeq: 0 });
});
it('atomically cancels selected-space transient work without removing saved directives or other-space work', async () => {
  const f = fixture('sqlite');
  await f.repository.transaction(accountId, f.now, d => {
    d.experience.preferences.push({ id: 'saved', revision: 1, space: 'work', agentId: 'agent', setting: { key: 'language', value: 'fa' }, status: 'active', updatedAt: 2000 });
    d.experience.preferenceLearning = { version: 'preference-learning-v1', presentations: [], candidates: [], suppressions: [], intents: ['work', 'personal'].map(space => ({ version: 'preference-learning-v1', id: `intent-${space}`, revision: 1, space: space as 'work' | 'personal', agentId: 'agent', studioFingerprint: 'a'.repeat(64), personId: d.personId, bindingId: 'old-binding', permissionRevision: 1, consentEpoch: 0, grantRevision: 1, createdAt: 2000, expiresAt: 3000 })) };
    d.experience.predictionTurns = ['work', 'personal'].map(space => ({ space: space as 'work' | 'personal', agentId: 'agent', sessionId: 'session', turnId: 'turn', revision: 0, evaluations: 0, inFlightUntil: 3000, expiresAt: 3000 }));
  });
  await f.pause.command(123, command('a', 0, 'pause'));
  const result = f.adaptive.readCommittedForEffect(123, d => d.experience); if (result.status !== 'ready') throw Error('missing');
  expect(result.value.preferences[0].setting).toEqual({ key: 'language', value: 'fa' });
  expect(result.value.preferenceLearning!.intents.map(i => i.space)).toEqual(['personal']);
  expect(result.value.predictionTurns.map(i => i.space)).toEqual(['personal']);
});
