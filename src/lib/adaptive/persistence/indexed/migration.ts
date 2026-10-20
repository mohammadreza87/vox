/** Quiesced, explicit current-state transitions. All source text stays in private
 * local files/memory. No background migration or divergent-store merge exists. */
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { validateAdaptiveDocument, normalizeLegacyAdaptiveDocument, upgradeLegacyAdaptiveDocumentV1ForProductPause, digest } from '../repository';
import { directAuthorityControls } from '../authority';
import { accountKey, projectDocument } from './projection';
import { INDEXED_LIMITS, IndexedStorageError } from './contracts';
import { acquireLease, managedDirectory, markerPath, readMarker, readJson, noSymlink, storePath, openRawManagedStore,
  metadataOf, writeDurableJson, syncDirectory, verifyPoison, poisonText, MAX_TRANSITION_BYTES, MAX_MANAGED_ACCOUNTS,
  requiredCanonicalSchema, type ManagedAdaptiveStorage, type ManagedReady, type ManagedTransition } from './managed-storage';
export interface TransitionOptions {
  /** Operator assertion; this boolean is not proof an old runtime was stopped. */
  quiesced: true; now?: () => number;
  /** Explicit current-state conversion; never selected on runtime open. */
  prepareProductPause?: true;
  /** Explicit same-format FILE authority-layout conversion; no normal-open repair. */
  prepareFileAuthority?: true;
  /** Synthetic fault/crash seam; never a provider or feature callback. */
  afterPhase?: (phase: 'prepared' | 'imported' | 'verified' | 'poisoned' | 'published', transitionId: string) => void;
}
export interface TransitionResult { format: 'sqlite-v1' | 'file-v2'; identity: { incarnation: string; generation: number };
  accounts: number; stateDigest: string; lifecycleWatermark: number; transitionId: string }
interface Row { accountId: string; document: unknown; digest: string }
interface Snapshot { rows: Row[]; digest: string; watermark: number; generation: number }
function time(now: () => number): number { const value = now(); if (!Number.isSafeInteger(value) || value < 0) throw new IndexedStorageError('clock_regression'); return value; }
function snapshotRows(rows: Row[], watermark: number, generation: number): Snapshot {
  rows.sort((a, b) => accountKey(a.accountId) < accountKey(b.accountId) ? -1 : 1);
  if (rows.length > MAX_MANAGED_ACCOUNTS || new Set(rows.map(r => r.accountId)).size !== rows.length ||
      rows.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify(r.document)), 0) > MAX_TRANSITION_BYTES) throw new IndexedStorageError('capacity');
  return { rows, watermark, generation, digest: digest(rows.map(r => [r.accountId, r.digest])) };
}
async function snapshotStore(storage: ManagedAdaptiveStorage, now: number): Promise<Snapshot> {
  const rows: Row[] = []; let bytes = 0, after: string | undefined;
  do {
    const page = await storage.listAccounts({ limit: 100, ...(after ? { after } : {}) });
    for (const accountId of page.accountIds) {
      const record = storage.readCommittedForEffect(accountId);
      if (record.status !== 'ready' || record.document === null) throw new IndexedStorageError('busy');
      const validated = validateAdaptiveDocument(record.document, accountId, now);
      if ('fileAuthorityProjectionVersion' in storage && storage.fileAuthorityProjectionVersion === 1) {
        const expected = projectDocument(validated, JSON.stringify(record.document));
        for (const space of ['work', 'personal'] as const) {
          const projection = storage.readDirectAuthorityForEffect(accountId, space, (controls, _now, _identity, stamp) => ({
            value: digest(controls) === digest(directAuthorityControls(validated)) && stamp?.catalogDigest === expected.catalogs.find(c => c.space === space)!.digest,
            denied: true,
          }));
          if (projection.status !== 'ready' || !projection.value) throw new IndexedStorageError('invalid_controls');
        }
      }
      bytes += Buffer.byteLength(JSON.stringify(record.document)); if (bytes > MAX_TRANSITION_BYTES) throw new IndexedStorageError('capacity');
      rows.push({ accountId, document: record.document, digest: digest(record.document) });
      if (rows.length > MAX_MANAGED_ACCOUNTS) throw new IndexedStorageError('capacity');
    }
    after = page.next;
  } while (after);
  const meta = metadataOf(storage); if (meta.lifecycleWatermark > now) throw new IndexedStorageError('clock_regression');
  return snapshotRows(rows, meta.lifecycleWatermark, meta.generation);
}
function snapshotLegacy(directory: string, now: number, reclaimDead = false): Snapshot {
  noSymlink(directory, 'directory'); const rows: Row[] = [], releases: (() => void)[] = [];
  try {
    const entries = readdirSync(directory);
    for (const name of entries) {
      noSymlink(join(directory, name));
      if (/^[a-f0-9]{64}\.json\.lock\.abandoned-[a-f0-9-]{36}$/.test(name)) continue;
      if (/^[a-f0-9]{64}\.json\.lock$/.test(name)) {
        if (!entries.includes(name.slice(0, -5))) throw new IndexedStorageError('busy');
        // Acquiring below either rejects a live/unknown lock or explicitly
        // retains a dead transition-owned lease as recovery evidence.
        continue;
      }
      if (!/^[a-f0-9]{64}\.json$/.test(name) || !lstatSync(join(directory, name)).isFile()) throw new IndexedStorageError('corrupt');
    }
    const files = entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    if (files.length > MAX_MANAGED_ACCOUNTS) throw new IndexedStorageError('capacity');
    for (const name of files) releases.push(acquireLease(join(directory, `${name}.lock`), reclaimDead));
    let watermark = 0, bytes = 0;
    for (const name of files) {
      const raw = readJson(join(directory, name), INDEXED_LIMITS.canonicalBytes);
      if (!raw || typeof raw !== 'object' || !('accountId' in raw) || typeof raw.accountId !== 'string' || `${accountKey(raw.accountId)}.json` !== name) throw new IndexedStorageError('corrupt');
      bytes += Buffer.byteLength(JSON.stringify(raw)); if (bytes > MAX_TRANSITION_BYTES) throw new IndexedStorageError('capacity');
      const validated = validateAdaptiveDocument(normalizeLegacyAdaptiveDocument(raw, raw.accountId, now), raw.accountId, now); watermark = Math.max(watermark, validated.updatedAt);
      rows.push({ accountId: raw.accountId, document: raw, digest: digest(raw) });
    }
    // A concurrent insert by an unquiesced legacy process cannot be silently
    // omitted; the final archive is checked again after poisoning its old path.
    const final = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    if (JSON.stringify(final) !== JSON.stringify(files)) throw new IndexedStorageError('busy');
    return snapshotRows(rows, watermark, 0);
  } finally { for (const release of releases.reverse()) release(); }
}
function prepareDirectory(root: string): void {
  noSymlink(dirname(root), 'directory'); const directory = managedDirectory(root);
  if (!existsSync(directory)) { mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); }
  noSymlink(directory, 'directory');
  for (const name of ['stores', 'legacy-archives']) {
    const path = join(directory, name); if (!existsSync(path)) { mkdirSync(path, { mode: 0o700 }); syncDirectory(directory); }
    noSymlink(path, 'directory');
  }
}
function archivePath(root: string, transition: ManagedTransition): string {
  if (!transition.legacyArchive) throw new IndexedStorageError('corrupt');
  noSymlink(join(managedDirectory(root), 'legacy-archives'), 'directory'); return join(managedDirectory(root), 'legacy-archives', transition.legacyArchive);
}
function legacyLocation(root: string, transition: ManagedTransition): string {
  const archive = archivePath(root, transition), rootExists = existsSync(root), archived = existsSync(archive);
  if (rootExists) {
    noSymlink(root);
    if (lstatSync(root).isDirectory()) { if (archived) throw new IndexedStorageError('corrupt'); return root; }
    verifyPoison(root, transition.rootId); if (!archived) throw new IndexedStorageError('corrupt');
  }
  if (!archived) throw new IndexedStorageError('corrupt'); return archive;
}
function poisonLegacy(root: string, transition: ManagedTransition, now: number, reclaimDead: boolean): void {
  const archive = archivePath(root, transition);
  if (existsSync(root) && lstatSync(root).isDirectory()) {
    noSymlink(root, 'directory'); if (existsSync(archive)) throw new IndexedStorageError('corrupt');
    renameSync(root, archive); syncDirectory(dirname(root)); syncDirectory(dirname(archive));
  }
  if (!existsSync(root)) {
    const fd = openSync(root, 'wx', 0o400);
    try { writeFileSync(fd, poisonText(transition.rootId)); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(dirname(root));
  }
  verifyPoison(root, transition.rootId);
  if (snapshotLegacy(archive, now, reclaimDead).digest !== transition.sourceDigest) throw new IndexedStorageError('corrupt');
}
function expectedTargetDigest(transition: ManagedTransition): string { return transition.version === 2 ? transition.expectedTargetDigest : transition.sourceDigest; }
function targetSnapshot(source: Snapshot, schema: 1 | 2, now: number): Snapshot {
  const rows = source.rows.map(row => {
    const normalized = validateAdaptiveDocument(normalizeLegacyAdaptiveDocument(row.document, row.accountId, now), row.accountId, now);
    if (schema === 1) { if (normalized.schemaVersion !== 1) throw new IndexedStorageError('invalid_controls'); return row; }
    const document = normalized.schemaVersion === 1 ? upgradeLegacyAdaptiveDocumentV1ForProductPause(row.document, row.accountId, now) : row.document;
    return { accountId: row.accountId, document, digest: digest(document) };
  });
  return snapshotRows(rows, source.watermark, source.generation);
}
function readyFor(transition: ManagedTransition, watermark: number): ManagedReady {
  if (!transition.targetIdentity || transition.targetDigest !== expectedTargetDigest(transition)) throw new IndexedStorageError('corrupt');
  return { ...(transition.version === 2 ? { version: 2 as const, canonicalSchemaVersion: 2 as const, controlsSchemaVersion: 2 as const, productPauseEnforcementVersion: 1 as const, ...(transition.targetFormat === 'file-v2' ? { fileAuthorityProjectionVersion: 1 as const } : {}) } : { version: 1 as const }), state: 'ready', rootId: transition.rootId, format: transition.targetFormat,
    store: transition.targetStore, identity: transition.targetIdentity, watermarkFloor: watermark };
}
async function currentSource(root: string, transition: ManagedTransition, now: number, reclaimDead: boolean): Promise<{ snapshot: Snapshot; storage?: ManagedAdaptiveStorage }> {
  if (transition.sourceFormat === 'legacy-file') return { snapshot: snapshotLegacy(legacyLocation(root, transition), now, reclaimDead) };
  if (!transition.previous || transition.previous.format !== transition.sourceFormat) throw new IndexedStorageError('corrupt');
  verifyPoison(root, transition.rootId);
  const storage = openRawManagedStore(root, transition.previous, () => now, undefined, reclaimDead, transition.previous.version === 2 && transition.previous.format === 'file-v2' && transition.previous.fileAuthorityProjectionVersion === undefined);
  try {
    const metadata = metadataOf(storage);
    if (metadata.incarnation !== transition.previous.identity.incarnation || metadata.generation !== transition.previous.identity.generation || metadata.lifecycleWatermark < transition.previous.watermarkFloor) throw new IndexedStorageError('corrupt');
    return { snapshot: await snapshotStore(storage, now), storage };
  } catch (error) { storage.close(); throw error; }
}
export async function transitionAdaptiveStorage(root: string, targetFormat: 'sqlite-v1' | 'file-v2', options: TransitionOptions): Promise<TransitionResult> {
  if (options.quiesced !== true || !['sqlite-v1', 'file-v2'].includes(targetFormat)) throw new IndexedStorageError('invalid_scope');
  root = resolve(root); prepareDirectory(root); const release = acquireLease(`${root}.managed.lock`);
  let source: ManagedAdaptiveStorage | undefined, target: ManagedAdaptiveStorage | undefined;
  try {
    const at = time(options.now ?? Date.now); let previous: ManagedReady | undefined, sourceSnapshot: Snapshot, sourceFormat: ManagedTransition['sourceFormat'];
    if (existsSync(markerPath(root))) {
      const marker = readMarker(root); if (marker.state !== 'ready' || marker.format === targetFormat && !(options.prepareProductPause === true && marker.version === 1) && !(options.prepareFileAuthority === true && marker.version === 2 && marker.format === 'file-v2' && marker.fileAuthorityProjectionVersion === undefined)) throw new IndexedStorageError('corrupt');
      if (options.prepareFileAuthority && (marker.version !== 2 || marker.format !== 'file-v2' || marker.fileAuthorityProjectionVersion !== undefined || targetFormat !== 'file-v2')) throw new IndexedStorageError('invalid_scope');
      previous = marker; sourceFormat = marker.format; verifyPoison(root, marker.rootId);
      source = openRawManagedStore(root, marker, () => at, undefined, false, marker.version === 2 && marker.format === 'file-v2' && marker.fileAuthorityProjectionVersion === undefined);
      const metadata = metadataOf(source);
      if (metadata.incarnation !== marker.identity.incarnation || metadata.generation !== marker.identity.generation || metadata.lifecycleWatermark < marker.watermarkFloor) throw new IndexedStorageError('corrupt');
      sourceSnapshot = await snapshotStore(source, at);
    } else {
      if (options.prepareFileAuthority) throw new IndexedStorageError('invalid_scope');
      if (targetFormat !== 'sqlite-v1' && !options.prepareProductPause || readdirSync(join(managedDirectory(root), 'stores')).length || readdirSync(join(managedDirectory(root), 'legacy-archives')).length) throw new IndexedStorageError('corrupt');
      sourceFormat = 'legacy-file'; sourceSnapshot = snapshotLegacy(root, at);
    }
    if (sourceSnapshot.generation >= Number.MAX_SAFE_INTEGER) throw new IndexedStorageError('capacity');
    const schema: 1 | 2 = options.prepareProductPause || previous?.version === 2 ? 2 : 1;
    const desired = targetSnapshot(sourceSnapshot, schema, at);
    const transition: ManagedTransition = { ...(schema === 2 ? { version: 2 as const, canonicalSchemaVersion: 2 as const, controlsSchemaVersion: 2 as const, productPauseEnforcementVersion: 1 as const, ...(targetFormat === 'file-v2' ? { fileAuthorityProjectionVersion: 1 as const } : {}), expectedTargetDigest: desired.digest } : { version: 1 as const }), state: 'transition', rootId: previous?.rootId ?? randomUUID(), id: randomUUID(), phase: 'prepared',
      sourceFormat, ...(previous ? { previous } : { legacyArchive: randomUUID() }), sourceDigest: sourceSnapshot.digest,
      sourceWatermark: sourceSnapshot.watermark, targetFormat, targetStore: randomUUID(), generation: sourceSnapshot.generation + 1 };
    writeDurableJson(markerPath(root), transition); options.afterPhase?.('prepared', transition.id);
    const targetPath = storePath(root, transition.targetStore); if (existsSync(targetPath)) throw new IndexedStorageError('corrupt');
    target = openRawManagedStore(root, { format: targetFormat, store: transition.targetStore }, () => at,
      { generation: transition.generation, lifecycleWatermark: sourceSnapshot.watermark, schemaVersion: schema });
    for (const row of desired.rows) await target.transact(row.accountId, () => ({ document: row.document, result: undefined }));
    options.afterPhase?.('imported', transition.id);
    const actual = await snapshotStore(target, at);
    if (actual.digest !== desired.digest || actual.watermark < sourceSnapshot.watermark) throw new IndexedStorageError('corrupt');
    const current = source ? await snapshotStore(source, at) : snapshotLegacy(root, at);
    if (current.digest !== sourceSnapshot.digest) throw new IndexedStorageError('corrupt');
    transition.targetIdentity = target.identity; transition.targetDigest = actual.digest; transition.phase = 'verified';
    writeDurableJson(markerPath(root), transition); options.afterPhase?.('verified', transition.id);
    if (sourceFormat === 'legacy-file') poisonLegacy(root, transition, at, false); else verifyPoison(root, transition.rootId);
    transition.phase = 'poisoned'; writeDurableJson(markerPath(root), transition); options.afterPhase?.('poisoned', transition.id);
    const ready = readyFor(transition, Math.max(current.watermark, actual.watermark));
    writeDurableJson(markerPath(root), ready); options.afterPhase?.('published', transition.id);
    return { format: targetFormat, identity: ready.identity, accounts: actual.rows.length, stateDigest: actual.digest,
      lifecycleWatermark: ready.watermarkFloor, transitionId: transition.id };
  } finally { target?.close(); source?.close(); release(); }
}
/** Explicit FILE/current FILEv2 -> new SQLite target. This function does not
 * activate optional memory/analytics/learning features or change server policy. */
export function prepareProductPauseAdaptiveStorage(root: string, targetFormat: 'sqlite-v1' | 'file-v2', options: TransitionOptions): Promise<TransitionResult> {
  return transitionAdaptiveStorage(root, targetFormat, { ...options, prepareProductPause: true });
}
/** Convert an already prepared pre-projection FILE store, preserving current canonical state exactly. */
export function prepareFileAuthorityAdaptiveStorage(root: string, options: TransitionOptions): Promise<TransitionResult> {
  return transitionAdaptiveStorage(root, 'file-v2', { ...options, prepareFileAuthority: true });
}
export function migrateAdaptiveStorage(root: string, options: TransitionOptions): Promise<TransitionResult> {
  return transitionAdaptiveStorage(root, 'sqlite-v1', options);
}
export function inspectManagedTransition(root: string): ManagedReady | ManagedTransition { return readMarker(resolve(root)); }
/** Finish only a fully verified transition with exact externally selected ID and
 * manifest. Earlier partial imports remain unavailable for operator inspection;
 * recovery never chooses or merges divergent snapshots. */
export async function finalizeManagedTransition(root: string, options: { quiesced: true; transitionId: string; sourceDigest: string;
  now?: () => number; reclaimDeadLease?: boolean }): Promise<TransitionResult> {
  if (options.quiesced !== true) throw new IndexedStorageError('invalid_scope'); root = resolve(root);
  const release = acquireLease(`${root}.managed.lock`, options.reclaimDeadLease); let source: ManagedAdaptiveStorage | undefined, target: ManagedAdaptiveStorage | undefined;
  try {
    const transition = readMarker(root);
    if (transition.state !== 'transition' || transition.phase === 'prepared' || transition.id !== options.transitionId || transition.sourceDigest !== options.sourceDigest ||
      transition.targetDigest !== expectedTargetDigest(transition) || !transition.targetIdentity) throw new IndexedStorageError('corrupt');
    const at = time(options.now ?? Date.now), current = await currentSource(root, transition, at, options.reclaimDeadLease === true); source = current.storage;
    if (current.snapshot.digest !== transition.sourceDigest || current.snapshot.watermark < transition.sourceWatermark) throw new IndexedStorageError('corrupt');
    target = openRawManagedStore(root, { format: transition.targetFormat, store: transition.targetStore, version: transition.version, ...('fileAuthorityProjectionVersion' in transition ? { fileAuthorityProjectionVersion: transition.fileAuthorityProjectionVersion } : {}) }, () => at, undefined, options.reclaimDeadLease);
    const targetMetadata = metadataOf(target);
    if (targetMetadata.incarnation !== transition.targetIdentity.incarnation || targetMetadata.generation !== transition.targetIdentity.generation) throw new IndexedStorageError('corrupt');
    const actual = await snapshotStore(target, at);
    if (actual.digest !== transition.targetDigest || actual.digest !== targetSnapshot(current.snapshot, requiredCanonicalSchema(transition), at).digest || actual.watermark < transition.sourceWatermark) throw new IndexedStorageError('corrupt');
    if (transition.sourceFormat === 'legacy-file') poisonLegacy(root, transition, at, options.reclaimDeadLease === true); else verifyPoison(root, transition.rootId);
    const ready = readyFor(transition, Math.max(current.snapshot.watermark, actual.watermark)); writeDurableJson(markerPath(root), ready);
    return { format: ready.format, identity: ready.identity, accounts: actual.rows.length, stateDigest: actual.digest,
      lifecycleWatermark: ready.watermarkFloor, transitionId: transition.id };
  } finally { target?.close(); source?.close(); release(); }
}

/** Explicit recovery after ready publication/response loss. Select only the
 * already-published identity, validate its CURRENT state and release dead leases.
 * No retired store, source archive or migration-time image is consulted. */
export async function recoverManagedReadyStorage(root: string, options: { quiesced: true; format: 'sqlite-v1' | 'file-v2';
  identity: { incarnation: string; generation: number }; now?: () => number; reclaimDeadLease: true }): Promise<Omit<TransitionResult, 'transitionId'>> {
  if (options.quiesced !== true || options.reclaimDeadLease !== true) throw new IndexedStorageError('invalid_scope');
  root = resolve(root); const release = acquireLease(`${root}.managed.lock`, true); let storage: ManagedAdaptiveStorage | undefined;
  try {
    const marker = readMarker(root);
    if (marker.state !== 'ready' || marker.format !== options.format || marker.identity.incarnation !== options.identity.incarnation ||
        marker.identity.generation !== options.identity.generation) throw new IndexedStorageError('corrupt');
    verifyPoison(root, marker.rootId); const at = time(options.now ?? Date.now);
    storage = openRawManagedStore(root, marker, () => at, undefined, true);
    const meta = metadataOf(storage);
    if (meta.incarnation !== marker.identity.incarnation || meta.generation !== marker.identity.generation || meta.lifecycleWatermark < marker.watermarkFloor) throw new IndexedStorageError('corrupt');
    const actual = await snapshotStore(storage, at);
    return { format: marker.format, identity: marker.identity, accounts: actual.rows.length,
      stateDigest: actual.digest, lifecycleWatermark: actual.watermark };
  } finally { storage?.close(); release(); }
}


/** Abort only an unpublished prepared import, with the exact unchanged current
 * source. Partial target artifacts are quarantined, never selected or deleted. */
export async function abortPreparedManagedTransition(root: string, options: { quiesced: true; transitionId: string; sourceDigest: string;
  now?: () => number; reclaimDeadLease?: boolean }): Promise<{ state: 'aborted'; restored: 'legacy-file' | 'sqlite-v1' | 'file-v2'; quarantine?: string }> {
  if (options.quiesced !== true) throw new IndexedStorageError('invalid_scope'); root = resolve(root);
  const release = acquireLease(`${root}.managed.lock`, options.reclaimDeadLease); let source: ManagedAdaptiveStorage | undefined;
  try {
    const transition = readMarker(root);
    if (transition.state !== 'transition' || transition.phase !== 'prepared' || transition.id !== options.transitionId || transition.sourceDigest !== options.sourceDigest) throw new IndexedStorageError('corrupt');
    const at = time(options.now ?? Date.now), current = await currentSource(root, transition, at, options.reclaimDeadLease === true); source = current.storage;
    if (current.snapshot.digest !== transition.sourceDigest || current.snapshot.watermark < transition.sourceWatermark) throw new IndexedStorageError('corrupt');
    if (transition.sourceFormat === 'legacy-file') {
      noSymlink(root, 'directory'); if (existsSync(archivePath(root, transition))) throw new IndexedStorageError('corrupt');
    }
    const target = storePath(root, transition.targetStore), owner = `${target}.owner`;
    if (existsSync(owner)) { const releaseTarget = acquireLease(owner, options.reclaimDeadLease); releaseTarget(); }
    const stores = join(managedDirectory(root), 'stores');
    const artifacts = readdirSync(stores).filter(name => name === transition.targetStore ||
      ['-journal', '-wal', '-shm'].some(suffix => name === `${transition.targetStore}${suffix}`) ||
      new RegExp(`^${transition.targetStore}\\.owner\\.abandoned-[a-f0-9-]{36}$`).test(name));
    let quarantine: string | undefined;
    if (artifacts.length) {
      const parent = join(managedDirectory(root), 'abandoned-targets');
      if (!existsSync(parent)) { mkdirSync(parent, { mode: 0o700 }); syncDirectory(managedDirectory(root)); }
      noSymlink(parent, 'directory'); quarantine = randomUUID(); const directory = join(parent, quarantine); mkdirSync(directory, { mode: 0o700 }); syncDirectory(parent);
      for (const name of artifacts) { noSymlink(join(stores, name)); renameSync(join(stores, name), join(directory, name)); }
      syncDirectory(directory); syncDirectory(stores);
    }
    if (transition.previous) writeDurableJson(markerPath(root), { ...transition.previous,
      watermarkFloor: Math.max(transition.previous.watermarkFloor, current.snapshot.watermark) });
    else { unlinkSync(markerPath(root)); syncDirectory(managedDirectory(root)); }
    return { state: 'aborted', restored: transition.sourceFormat, ...(quarantine ? { quarantine } : {}) };
  } finally { source?.close(); release(); }
}
