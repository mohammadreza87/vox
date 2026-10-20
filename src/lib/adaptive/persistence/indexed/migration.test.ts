import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, symlinkSync, lstatSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { AdaptiveRepository, accountIdFor, digest, tenantIdFor, spaceIdFor, containerIdFor, type AdaptiveDocument } from '../repository';
import { FileAdaptiveStorage } from '../storage';
import { SqliteAdaptiveStorage } from './sqlite-storage';
import { ManagedFileV2Storage, openManagedAdaptiveStorage, markerPath, readMarker,
  storePath, type ManagedAdaptiveStorage } from './managed-storage';
import { migrateAdaptiveStorage, finalizeManagedTransition, inspectManagedTransition, recoverManagedReadyStorage, abortPreparedManagedTransition } from './migration';
import { rollbackAdaptiveStorage } from './rollback';
import type { IndexedScope } from './contracts';
import { accountKey } from './projection';
const paths: string[] = [], stores: ManagedAdaptiveStorage[] = [];
afterEach(() => { for (const storage of stores.splice(0)) storage.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'vox-managed-synthetic-')); paths.push(directory);
  const root = join(directory, 'legacy'), repo = new AdaptiveRepository(new FileAdaptiveStorage(root));
  const accountId = accountIdFor(123); let now = 1000;
  await repo.transaction(accountId, now, d => {
    d.binding = { schemaVersion: 1, id: 'synthetic-binding', revision: 1, accountId, personId: d.personId, status: 'verified',
      method: 'account_confirmation', createdAt: now, updatedAt: now, verifiedAt: now, expiresAt: 100_000 };
    for (const permission of d.permissions) { permission.state = 'granted'; permission.expiresAt = 90_000; }
    d.agentGrants.push({ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: now });
    d.memories = [{ id: 'source', revision: 1, space: 'work', text: 'Synthetic original source', status: 'active', createdAt: now, updatedAt: now, expiresAt: 80_000, revocationEpoch: 0 },
      { id: 'derived', revision: 1, space: 'work', text: 'Synthetic derived source', sourceRefs: [{ id: 'source', revision: 1 }], status: 'active', createdAt: now, updatedAt: now, expiresAt: 80_000, revocationEpoch: 0 }];
  });
  const scope: IndexedScope = { accountId, personId: `account-profile:${digest(accountId).slice(0, 32)}`, tenantId: tenantIdFor(accountId),
    space: 'work', spaceId: spaceIdFor(accountId, 'work'), containerId: containerIdFor(accountId, 'work'), agentId: 'agent', purpose: 'optional.personalization' };
  now = 2000;
  return { root, directory, repo, accountId, scope, now: () => now, setNow: (value: number) => { now = value; },
    open: (format: 'sqlite-v1' | 'file-v2') => { const storage = openManagedAdaptiveStorage(root, { format, now: () => now }); stores.push(storage); return storage; } };
}
function document(storage: ManagedAdaptiveStorage, accountId: string): AdaptiveDocument {
  const snapshot = storage.readCommittedForEffect(accountId); expect(snapshot.status).toBe('ready');
  if (snapshot.status !== 'ready' || !snapshot.document) throw Error('missing synthetic state'); return snapshot.document as AdaptiveDocument;
}
it('migrates current legacy FILE with atomic ready marker and no old-binary writable fork', async () => {
  const f = await fixture(); const original = JSON.parse(readFileSync(join(f.root, `${accountKey(f.accountId)}.json`), 'utf8'));
  const result = await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  expect(result.accounts).toBe(1); expect(result.identity.generation).toBe(1); expect(lstatSync(f.root).isFile()).toBe(true);
  const storage = f.open('sqlite-v1'); expect(digest(document(storage, f.accountId))).toBe(digest(original));
  await expect(new FileAdaptiveStorage(f.root).transact(f.accountId, () => ({ document: {}, result: undefined }))).rejects.toThrow();
  expect(() => f.open('sqlite-v1')).toThrow(/busy/);
  storage.close(); expect(() => f.open('file-v2')).toThrow();
  const marker = readMarker(f.root); expect(marker).toMatchObject({ state: 'ready', format: 'sqlite-v1', identity: result.identity });
  expect(result.lifecycleWatermark).toBe(2000);
});
it('rolls back latest corrections, consent epochs, tombstones, replay/outbox and preferences, then remigrates with fresh identity', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  const sqlite = f.open('sqlite-v1') as SqliteAdaptiveStorage;
  const old = sqlite.indexed.readRuntimeAuthority(f.scope); expect(old.status).toBe('ready'); if (old.status !== 'ready') return;
  const repo = new AdaptiveRepository(sqlite);
  await repo.transaction(f.accountId, 2000, d => {
    d.revision++; d.updatedAt = 2000; d.memories[0].text = 'CURRENT corrected source'; d.memories[0].revision++;
    d.memories[1].status = 'deleted'; delete d.memories[1].text; d.memories[1].revision++; d.memories[1].revocationEpoch++;
    const p = d.permissions.find(p => p.id === 'permission:work:optional.personalization')!; p.state = 'withdrawn'; p.revision++; p.epoch++;
    d.events.push({ eventId: 'correction-event', fingerprint: digest('correction'), kind: 'correction', resultId: 'source', revision: 2 });
    d.outbox.push({ eventId: 'derived-deleted', kind: 'memory_deleted', space: 'work', personId: d.personId, revision: 2, memoryId: 'derived', epoch: 1, createdAt: 2000 });
    d.experience.preferences.push({ id: 'preference-event', revision: 1, space: 'work', agentId: 'agent', setting: { key: 'language', value: 'fa' }, status: 'reset', updatedAt: 2000 });
  });
  const current = digest(document(sqlite, f.accountId)); sqlite.close();
  const rollback = await rollbackAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  expect(rollback.identity.generation).toBe(2); expect(rollback.identity.incarnation).not.toBe(old.receipt.incarnation);
  const file = f.open('file-v2'); expect(file).toBeInstanceOf(ManagedFileV2Storage); expect(digest(document(file, f.accountId))).toBe(current);
  expect(document(file, f.accountId).memories[0].text).toBe('CURRENT corrected source'); file.close();
  const remigration = await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  expect(remigration.identity.generation).toBe(3); expect(remigration.identity.incarnation).not.toBe(old.receipt.incarnation);
  const final = f.open('sqlite-v1') as SqliteAdaptiveStorage; expect(digest(document(final, f.accountId))).toBe(current);
  expect(final.indexed.validateRuntimeReceiptNow(old.receipt)).toMatchObject({ status: 'unavailable', reason: 'stale_receipt' });
  expect(final.database.prepare("SELECT id FROM bodies WHERE id='derived'").all()).toHaveLength(0);
  expect(final.database.prepare("SELECT event_id FROM outbox").all()).toEqual([{ event_id: 'derived-deleted' }]);
});
it('carries an observed expiry watermark into FILEv2 and refuses restart regression without body reads', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  const sqlite = f.open('sqlite-v1') as SqliteAdaptiveStorage; f.setNow(100_000);
  expect(sqlite.indexed.readRuntimeAuthority(f.scope)).toMatchObject({ status: 'unavailable', reason: 'expired' }); sqlite.close();
  f.setNow(100_001); await rollbackAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  f.setNow(3000); const file = f.open('file-v2') as ManagedFileV2Storage;
  expect(() => file.readCommittedForEffect(f.accountId)).toThrow(/clock_regression/); expect(file.io.canonicalImageReads).toBe(0);
});
it('stops incomplete publication and explicitly finalizes only matching verified source and target manifests', async () => {
  const f = await fixture();
  await expect(migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now, afterPhase: phase => { if (phase === 'verified') throw Error('synthetic crash boundary'); } })).rejects.toThrow('synthetic crash boundary');
  expect(() => f.open('sqlite-v1')).toThrow(); const marker = inspectManagedTransition(f.root); if (marker.state !== 'transition') throw Error('missing transition');
  await expect(finalizeManagedTransition(f.root, { quiesced: true, transitionId: 'wrong', sourceDigest: marker.sourceDigest, now: f.now })).rejects.toThrow();
  const finished = await finalizeManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now });
  expect(finished.stateDigest).toBe(marker.sourceDigest); const current = f.open('sqlite-v1'); expect(document(current, f.accountId).memories[0].text).toContain('original');
});
it('refuses to guess after divergent source changes during an incomplete transition', async () => {
  const f = await fixture();
  await expect(migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now, afterPhase: phase => { if (phase === 'verified') throw Error('synthetic pause'); } })).rejects.toThrow();
  const marker = inspectManagedTransition(f.root); if (marker.state !== 'transition') throw Error('missing transition');
  await f.repo.transaction(f.accountId, 2000, d => { d.memories[0].text = 'new rights-bearing source revision'; d.memories[0].revision++; d.revision++; d.updatedAt = 2000; });
  await expect(finalizeManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now })).rejects.toThrow();
  expect(() => f.open('sqlite-v1')).toThrow(); expect(readMarker(f.root).state).toBe('transition');
});
it('recovers a real killed child only with explicit dead-lease reclamation and exact manifest', async () => {
  const f = await fixture(); const moduleUrl = pathToFileURL(join(process.cwd(), 'src/lib/adaptive/persistence/indexed/migration.ts')).href;
  const script = `import { migrateAdaptiveStorage } from ${JSON.stringify(moduleUrl)};
    await migrateAdaptiveStorage(${JSON.stringify(f.root)}, { quiesced:true, now:()=>2000, afterPhase:phase=>{if(phase==='verified')process.kill(process.pid,'SIGKILL')} });`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
  expect(child.signal, child.stderr).toBe('SIGKILL'); expect(() => f.open('sqlite-v1')).toThrow(/busy/);
  const marker = inspectManagedTransition(f.root); if (marker.state !== 'transition') throw Error('missing transition');
  await expect(finalizeManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now })).rejects.toThrow(/busy/);
  const final = await finalizeManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now, reclaimDeadLease: true });
  expect(final.stateDigest).toBe(marker.sourceDigest); expect(f.open('sqlite-v1').identity).toEqual(final.identity);
});
it('rejects malformed marker formats, wrong identity, symlink store paths and unquiesced transitions', async () => {
  const f = await fixture(); await expect(migrateAdaptiveStorage(f.root, { quiesced: false as true, now: f.now })).rejects.toThrow();
  await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now }); const marker = readMarker(f.root); if (marker.state !== 'ready') throw Error('not ready');
  const original = readFileSync(markerPath(f.root), 'utf8');
  writeFileSync(markerPath(f.root), JSON.stringify({ ...marker, format: 'file' })); expect(() => f.open('sqlite-v1')).toThrow();
  writeFileSync(markerPath(f.root), JSON.stringify({ ...marker, identity: { ...marker.identity, generation: 999 } })); expect(() => f.open('sqlite-v1')).toThrow();
  writeFileSync(markerPath(f.root), original); const target = storePath(f.root, marker.store), renamed = `${target}.original`;
  const { renameSync } = await import('fs'); renameSync(target, renamed); symlinkSync(renamed, target); expect(() => f.open('sqlite-v1')).toThrow();
});
it('FILEv2 rollback keeps current transaction atomic, records failed guard time, and refuses busy effect reads', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now }); await rollbackAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  const file = f.open('file-v2') as ManagedFileV2Storage, repo = new AdaptiveRepository(file);
  const before = digest(document(file, f.accountId));
  await expect(repo.transaction(f.accountId, f.now, d => { d.memories[0].text = 'must roll back'; }, () => { f.setNow(3000); throw Error('synthetic guard'); })).rejects.toThrow('synthetic guard');
  expect(digest(document(file, f.accountId))).toBe(before); expect(file.readMetadata().lifecycleWatermark).toBe(3000);
  let busy: unknown; await repo.transaction(f.accountId, f.now, () => { busy = file.readCommittedForEffect(f.accountId); });
  expect(busy).toEqual({ status: 'busy' }); file.close(); f.setNow(2500);
  const reopen = f.open('file-v2') as ManagedFileV2Storage; expect(() => reopen.readCommittedForEffect(f.accountId)).toThrow(/clock_regression/);
});

it('validates and imports every current account and exposes bounded metadata-only enumeration', async () => {
  const f = await fixture(); const second = accountIdFor(124);
  await f.repo.transaction(second, 1000, d => { d.declaration = { adultConfirmed: true, declaredAt: 1000 }; });
  const result = await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now }); expect(result.accounts).toBe(2);
  const sqlite = f.open('sqlite-v1'); const first = await sqlite.listAccounts!({ limit: 1 });
  expect(first.accountIds).toHaveLength(1); expect(first.next).toBeDefined();
  const next = await sqlite.listAccounts!({ limit: 1, after: first.next });
  expect([...first.accountIds, ...next.accountIds].sort()).toEqual([f.accountId, second].sort());
  expect(document(sqlite, second).declaration?.adultConfirmed).toBe(true);
});
it('rejects malformed source account hashes and partial imports before any ready pointer can appear', async () => {
  const f = await fixture(); const original = readFileSync(join(f.root, `${accountKey(f.accountId)}.json`));
  writeFileSync(join(f.root, `${'a'.repeat(64)}.json`), original);
  await expect(migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now })).rejects.toThrow();
  expect(() => f.open('sqlite-v1')).toThrow();
  rmSync(join(f.root, `${'a'.repeat(64)}.json`));
  await expect(migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now, afterPhase: phase => { if (phase === 'prepared') throw Error('synthetic pre-import termination'); } })).rejects.toThrow();
  const marker = readMarker(f.root); expect(marker).toMatchObject({ state: 'transition', phase: 'prepared' });
  if (marker.state !== 'transition') throw Error('not preparing');
  await expect(finalizeManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now })).rejects.toThrow();
});
it('CLI inspection emits only format evidence and requires explicit quiescence for writes', async () => {
  const f = await fixture(); const script = join(process.cwd(), 'scripts/adaptive-storage.ts');
  const denied = spawnSync(process.execPath, ['--import', 'tsx', script, 'migrate', '--root', f.root], { encoding: 'utf8', timeout: 10_000 });
  expect(denied.status).toBe(1); expect(denied.stderr).toContain('invalid_scope');
  await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  const inspected = spawnSync(process.execPath, ['--import', 'tsx', script, 'inspect', '--root', f.root], { encoding: 'utf8', timeout: 10_000 });
  expect(inspected.status, inspected.stderr).toBe(0); expect(JSON.parse(inspected.stdout)).toMatchObject({ state: 'ready', format: 'sqlite-v1' });
  expect(inspected.stdout).not.toContain('Synthetic original source');
});

it('recovers the exact CURRENT FILEv2 ready target after killed post-publication response without touching archived state', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  const sqlite = f.open('sqlite-v1');
  await new AdaptiveRepository(sqlite).transaction(f.accountId, f.now, d => { d.memories[0].text = 'CURRENT prior-to-crash correction'; d.memories[0].revision++; d.revision++; d.updatedAt = 2000; });
  const expected = digest(document(sqlite, f.accountId)); sqlite.close();
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/lib/adaptive/persistence/indexed/rollback.ts')).href;
  const script = `import { rollbackAdaptiveStorage } from ${JSON.stringify(moduleUrl)};
    await rollbackAdaptiveStorage(${JSON.stringify(f.root)}, { quiesced:true, now:()=>2000, afterPhase:phase=>{if(phase==='published')process.kill(process.pid,'SIGKILL')} });`;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
  expect(child.signal, child.stderr).toBe('SIGKILL'); const marker = readMarker(f.root); if (marker.state !== 'ready') throw Error('missing published pointer');
  expect(marker.format).toBe('file-v2'); expect(() => f.open('file-v2')).toThrow(/busy/);
  await expect(recoverManagedReadyStorage(f.root, { quiesced: true, format: 'file-v2', identity: { ...marker.identity, generation: 999 }, now: f.now, reclaimDeadLease: true })).rejects.toThrow();
  const recovered = await recoverManagedReadyStorage(f.root, { quiesced: true, format: 'file-v2', identity: marker.identity, now: f.now, reclaimDeadLease: true });
  expect(recovered.identity).toEqual(marker.identity); expect(recovered.accounts).toBe(1);
  const current = f.open('file-v2'); expect(digest(document(current, f.accountId))).toBe(expected);
});

it('refuses missing published SQLite and FILEv2 components without initializing replacements', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  let marker = readMarker(f.root); if (marker.state !== 'ready') throw Error('not ready');
  const sqlite = storePath(f.root, marker.store), hold = `${sqlite}.held`;
  const { renameSync, existsSync, readdirSync } = await import('fs'); renameSync(sqlite, hold);
  const before = readdirSync(join(f.root + '.managed', 'stores')).sort(); expect(() => f.open('sqlite-v1')).toThrow();
  expect(existsSync(sqlite)).toBe(false); expect(readdirSync(join(f.root + '.managed', 'stores')).sort()).toEqual(before);
  renameSync(hold, sqlite); await rollbackAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  marker = readMarker(f.root); if (marker.state !== 'ready') throw Error('not ready');
  const file = storePath(f.root, marker.store), head = join(file, 'head.json'); renameSync(head, join(file, 'head.held'));
  expect(() => f.open('file-v2')).toThrow(); expect(existsSync(head)).toBe(false);
});
it('aborts only an exact unchanged prepared import, quarantines target bytes and retries legacy migration safely', async () => {
  const f = await fixture();
  await expect(migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now, afterPhase: phase => { if (phase === 'imported') throw Error('synthetic partial import'); } })).rejects.toThrow();
  const marker = readMarker(f.root); if (marker.state !== 'transition') throw Error('not preparing');
  await expect(abortPreparedManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: 'wrong', now: f.now })).rejects.toThrow();
  const aborted = await abortPreparedManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now });
  expect(aborted).toMatchObject({ state: 'aborted', restored: 'legacy-file' }); expect(aborted.quarantine).toBeDefined();
  expect(lstatSync(f.root).isDirectory()).toBe(true);
  const retry = await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now }); expect(retry.accounts).toBe(1);
});
it('aborts prepared rollback to the exact current source ready pointer rather than a target or initial backup', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: f.now });
  const old = readMarker(f.root); if (old.state !== 'ready') throw Error('not ready');
  await expect(rollbackAdaptiveStorage(f.root, { quiesced: true, now: f.now, afterPhase: phase => { if (phase === 'imported') throw Error('synthetic interrupted rollback'); } })).rejects.toThrow();
  const marker = readMarker(f.root); if (marker.state !== 'transition') throw Error('not preparing');
  const aborted = await abortPreparedManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: f.now });
  expect(aborted.restored).toBe('sqlite-v1'); expect(readMarker(f.root)).toMatchObject({ state: 'ready', identity: old.identity, store: old.store });
  expect(document(f.open('sqlite-v1'), f.accountId).memories[0].text).toContain('original');
});
