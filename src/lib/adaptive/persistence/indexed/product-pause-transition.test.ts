import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor, digest, normalizeLegacyAdaptiveDocument, upgradeLegacyAdaptiveDocumentV1ForProductPause, validateAdaptiveDocument, type AdaptiveDocument } from '../repository';
import { FileAdaptiveStorage } from '../storage';
import { AdaptiveService } from '../service';
import { ProductPauseService } from '../../product-pause/service';
import { markerPath, readMarker, storePath, openManagedAdaptiveStorage, type ManagedAdaptiveStorage } from './managed-storage';
import { accountKey } from './projection';
import { migrateAdaptiveStorage, prepareProductPauseAdaptiveStorage, finalizeManagedTransition, abortPreparedManagedTransition } from './migration';
import { rollbackAdaptiveStorage } from './rollback';
import { SqliteAdaptiveStorage } from './sqlite-storage';
const paths: string[] = [], stores: ManagedAdaptiveStorage[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
const accountId = accountIdFor(123);
async function fixture(empty = false) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'vox-pause-transition-')); paths.push(directory);
  const root = join(directory, 'legacy'), repository = new AdaptiveRepository(new FileAdaptiveStorage(root));
  mkdirSync(root);
  if (!empty) await repository.transaction(accountId, 1000, d => { d.memories.push({ id: 'note', revision: 1, space: 'work', text: 'retained synthetic note', status: 'active', createdAt: 1000, updatedAt: 1000, expiresAt: 100000, revocationEpoch: 0 }); });
  const open = (format: 'sqlite-v1' | 'file-v2') => { const s = openManagedAdaptiveStorage(root, { format, now: () => 2000 }); stores.push(s); return s; };
  return { root, repository, open };
}
function current(s: ManagedAdaptiveStorage): AdaptiveDocument { const result = s.readCommittedForEffect(accountId); if (result.status !== 'ready' || !result.document) throw Error('missing'); return result.document as AdaptiveDocument; }
for (const format of ['sqlite-v1', 'file-v2'] as const) it(`explicit legacy→${format} P preparation preserves normalized state, early v2 markers, current rollback and fresh namespaces`, async () => {
  const f = await fixture(), raw = JSON.parse(readFileSync(join(f.root, `${accountKey(accountId)}.json`), 'utf8'));
  const expected = upgradeLegacyAdaptiveDocumentV1ForProductPause(raw, accountId, 2000);
  const prepared = await prepareProductPauseAdaptiveStorage(f.root, format, { quiesced: true, now: () => 2000 });
  expect(readMarker(f.root)).toMatchObject({ version: 2, canonicalSchemaVersion: 2, controlsSchemaVersion: 2, productPauseEnforcementVersion: 1, state: 'ready' });
  let storage = f.open(format); expect(digest(current(storage))).toBe(digest(expected)); expect(storage.canonicalSchemaVersion).toBe(2);
  if (storage instanceof SqliteAdaptiveStorage) { expect(storage.readMetadata().schemaVersion).toBe(2); expect(storage.database.pragma('user_version', { simple: true })).toBe(2); }
  else { const marker = readMarker(f.root); if (marker.state !== 'ready') throw Error('missing'); expect(JSON.parse(readFileSync(join(storePath(f.root, marker.store), 'head.json'), 'utf8'))).toMatchObject({ formatVersion: 2, schemaVersion: 2 }); }
  const repository = new AdaptiveRepository(storage), pause = new ProductPauseService(new AdaptiveService(repository, { now: () => 2000 }));
  await pause.command(123, { version: 1, eventId: 'a'.repeat(22), expectedCommandSeq: 0, space: 'work', action: 'pause' });
  const latest = current(storage); storage.close();
  const target = format === 'sqlite-v1' ? 'file-v2' : 'sqlite-v1';
  const transitioned = await (target === 'file-v2' ? rollbackAdaptiveStorage : migrateAdaptiveStorage)(f.root, { quiesced: true, now: () => 2000 });
  expect(transitioned.identity.incarnation).not.toBe(prepared.identity.incarnation); expect(transitioned.identity.generation).toBe(2);
  storage = f.open(target); expect(digest(current(storage))).toBe(digest(latest)); expect(current(storage).productPause!.scopes[0]).toMatchObject({ productPaused: true, commandSeq: 1, useEpoch: 1 });
  await new AdaptiveRepository(storage).transaction(accountIdFor(456), 2000, d => { expect(d.schemaVersion).toBe(2); expect(d.productPause).toBeDefined(); });
});
it('same-format legacy-managed store conversion requires explicit preparation and never happens on ordinary open', async () => {
  const f = await fixture(); await migrateAdaptiveStorage(f.root, { quiesced: true, now: () => 2000 });
  const legacy = f.open('sqlite-v1'); expect(legacy.canonicalSchemaVersion).toBe(1); expect(current(legacy).schemaVersion).toBe(1); legacy.close();
  await expect(migrateAdaptiveStorage(f.root, { quiesced: true, now: () => 2000 })).rejects.toThrow();
  await prepareProductPauseAdaptiveStorage(f.root, 'sqlite-v1', { quiesced: true, now: () => 2000 });
  expect(f.open('sqlite-v1').canonicalSchemaVersion).toBe(2);
});
it('explicit empty store preparation creates only v2 accounts; legacy original FILE stays v1', async () => {
  const f = await fixture(true); await prepareProductPauseAdaptiveStorage(f.root, 'file-v2', { quiesced: true, now: () => 2000 });
  const managed = f.open('file-v2'); await new AdaptiveRepository(managed).transaction(accountId, 2000, d => { expect(d.schemaVersion).toBe(2); });
  const other = await fixture(true); await other.repository.transaction(accountId, 1000, d => { expect(d.schemaVersion).toBe(1); expect(d.productPause).toBeUndefined(); });
});
it('verified conversion recovery compares exact normalized target, never source digest equality or guessed P initialization', async () => {
  const f = await fixture();
  await expect(prepareProductPauseAdaptiveStorage(f.root, 'sqlite-v1', { quiesced: true, now: () => 2000, afterPhase: phase => { if (phase === 'verified') throw Error('synthetic interruption'); } })).rejects.toThrow('synthetic interruption');
  const marker = readMarker(f.root); if (marker.state !== 'transition' || marker.version !== 2) throw Error('missing');
  expect(marker.targetDigest).toBe(marker.expectedTargetDigest); expect(marker.targetDigest).not.toBe(marker.sourceDigest);
  expect(() => f.open('sqlite-v1')).toThrow();
  await finalizeManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: () => 2000 });
  expect(current(f.open('sqlite-v1')).productPause!.scopes[0].commandSeq).toBe(0);
});
it('prepared conversion abort restores source without controls, quarantining target instead of partial adoption', async () => {
  const f = await fixture();
  await expect(prepareProductPauseAdaptiveStorage(f.root, 'sqlite-v1', { quiesced: true, now: () => 2000, afterPhase: phase => { if (phase === 'imported') throw Error('synthetic interruption'); } })).rejects.toThrow();
  const marker = readMarker(f.root); if (marker.state !== 'transition') throw Error('missing');
  const result = await abortPreparedManagedTransition(f.root, { quiesced: true, transitionId: marker.id, sourceDigest: marker.sourceDigest, now: () => 2000 });
  expect(result).toMatchObject({ state: 'aborted', restored: 'legacy-file' });
  const raw = JSON.parse(readFileSync(join(f.root, `${accountKey(accountId)}.json`), 'utf8'));
  expect(raw.schemaVersion).toBe(1); expect(raw.productPause).toBeUndefined();
});
it('too-large legacy conversion fails before publishing a transition and never truncates source to reserve capacity', async () => {
  const f = await fixture();
  await f.repository.transaction(accountId, 1000, d => { const initial = Buffer.byteLength(JSON.stringify(d)); d.consentEvents = ['x'.repeat(699000 - initial - 2)] as unknown as AdaptiveDocument['consentEvents']; });
  const file = join(f.root, `${accountKey(accountId)}.json`), before = readFileSync(file, 'utf8'); expect(Buffer.byteLength(before)).toBeGreaterThan(697952);
  await expect(prepareProductPauseAdaptiveStorage(f.root, 'sqlite-v1', { quiesced: true, now: () => 2000 })).rejects.toThrow('Product pause reserved capacity exceeded');
  expect(readFileSync(file, 'utf8')).toBe(before); expect(() => readFileSync(markerPath(f.root))).toThrow();
});
it('native format/cohort marker mismatch and unknown v2 capability combinations refuse startup', async () => {
  const f = await fixture(); await prepareProductPauseAdaptiveStorage(f.root, 'file-v2', { quiesced: true, now: () => 2000 });
  const marker = readMarker(f.root); expect(marker.version).toBe(2);
  writeFileSync(markerPath(f.root), JSON.stringify({ ...marker, productPauseEnforcementVersion: 2 })); expect(() => f.open('file-v2')).toThrow();
  writeFileSync(markerPath(f.root), JSON.stringify(marker));
  if (marker.state !== 'ready') throw Error('missing');
  const headFile = join(storePath(f.root, marker.store), 'head.json'), head = JSON.parse(readFileSync(headFile, 'utf8')); delete head.schemaVersion;
  writeFileSync(headFile, JSON.stringify(head)); expect(() => f.open('file-v2')).toThrow();
});
it('converted v2 reserved block cannot be dropped through a content callback', async () => {
  const f = await fixture(); await prepareProductPauseAdaptiveStorage(f.root, 'sqlite-v1', { quiesced: true, now: () => 2000 });
  const s = f.open('sqlite-v1'), repo = new AdaptiveRepository(s), before = digest(current(s));
  await expect(repo.transaction(accountId, 2000, d => { delete d.productPause; })).rejects.toThrow(); expect(digest(current(s))).toBe(before);
  const raw = current(s); expect(() => upgradeLegacyAdaptiveDocumentV1ForProductPause(raw, accountId, 2000)).toThrow();
  expect(validateAdaptiveDocument(normalizeLegacyAdaptiveDocument(raw, accountId, 2000), accountId, 2000)).toEqual(raw);
});
