/** Explicit local format management. This module never selects a format from a
 * feature flag and never migrates on open. Quiescence is an operator assertion,
 * not something a JavaScript boolean can prove about an old runtime.
 *
 * Residual policy: legacy archives and retired stores remain private named
 * artifacts until an operator-approved retention/backup cleanup. FILEv2 removes
 * superseded account images after pointer publication; a crash can leave named
 * orphan images for explicit cleanup. Unlink/secure_delete is not secure erasure
 * of filesystem snapshots, journals, SSD blocks, backups or copied source files.
 */
import { randomUUID } from 'crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmdirSync, unlinkSync, writeFileSync, readSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { z } from 'zod';
import type { AdaptiveStorage, AdaptiveAccountPage, AdaptiveAccountPageInput } from '../storage';
import { directAuthorityControls, validateRuntimeControlEvaluation, type DirectAuthorityEvaluator } from '../authority';
import { digest, validateAdaptiveDocument, type SpaceKind } from '../repository';
import { accountKey, validateAccountId, projectDocument, parseDirectAuthorityControls, directAuthorityControlsSchema } from './projection';
import { INDEXED_LIMITS, IndexedStorageError } from './contracts';
import { SqliteAdaptiveStorage } from './sqlite-storage';
const integer = z.number().int().nonnegative().safe(), uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MAX_TRANSITION_BYTES = 64 * 1024 * 1024;
export const MAX_MANAGED_ACCOUNTS = 10_000;
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
export const managedIdentitySchema = z.object({ incarnation: uuid, generation: integer.min(1) }).strict();
const legacyManagedReadySchema = z.object({ version: z.literal(1), state: z.literal('ready'), rootId: uuid,
  format: z.enum(['sqlite-v1', 'file-v2']), store: uuid, identity: managedIdentitySchema,
  watermarkFloor: integer }).strict();
const pauseCapabilities = { canonicalSchemaVersion: z.literal(2), controlsSchemaVersion: z.literal(2), productPauseEnforcementVersion: z.literal(1) };
export const managedReadySchema = z.union([legacyManagedReadySchema, legacyManagedReadySchema.extend({ version: z.literal(2), ...pauseCapabilities, fileAuthorityProjectionVersion: z.literal(1).optional() }).strict()]).refine(marker => !('fileAuthorityProjectionVersion' in marker) || marker.format === 'file-v2');
export type ManagedReady = z.infer<typeof managedReadySchema>;
export function requiredCanonicalSchema(marker: { version: 1 | 2 }): 1 | 2 { return marker.version === 2 ? 2 : 1; }
const legacyTransitionSchema = z.object({ version: z.literal(1), state: z.literal('transition'), rootId: uuid,
  id: uuid, phase: z.enum(['prepared', 'verified', 'poisoned']), sourceFormat: z.enum(['legacy-file', 'sqlite-v1', 'file-v2']),
  previous: managedReadySchema.optional(), sourceDigest: hash, sourceWatermark: integer,
  legacyArchive: uuid.optional(), targetFormat: z.enum(['sqlite-v1', 'file-v2']), targetStore: uuid,
  targetIdentity: managedIdentitySchema.optional(), targetDigest: hash.optional(), generation: integer.min(1),
}).strict();
export const transitionSchema = z.union([legacyTransitionSchema, legacyTransitionSchema.extend({ version: z.literal(2),
  ...pauseCapabilities, fileAuthorityProjectionVersion: z.literal(1).optional(), expectedTargetDigest: hash }).strict()]).refine(marker => !('fileAuthorityProjectionVersion' in marker) || marker.targetFormat === 'file-v2');
export type ManagedTransition = z.infer<typeof transitionSchema>;
export const markerSchema = z.union([managedReadySchema, transitionSchema]);
export interface ManagedStorageOptions { format: 'sqlite-v1' | 'file-v2'; now?: () => number }
export type ManagedAdaptiveStorage = (SqliteAdaptiveStorage | ManagedFileV2Storage) & { close(): void };
export const managedDirectory = (root: string): string => `${resolve(root)}.managed`;
export const markerPath = (root: string): string => join(managedDirectory(root), 'format.json');
export function noSymlink(path: string, kind?: 'file' | 'directory'): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || kind === 'file' && !stat.isFile() || kind === 'directory' && !stat.isDirectory()) throw new IndexedStorageError('corrupt');
}
export function syncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function readJson(path: string, maxBytes = MAX_HEAD_BYTES): unknown {
  noSymlink(dirname(path), 'directory'); noSymlink(path, 'file'); const stat = lstatSync(path);
  if (stat.size > maxBytes) throw new IndexedStorageError('capacity');
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new IndexedStorageError('corrupt'); }
}
export function writeDurableJson(path: string, value: unknown, beforePublish?: () => void, published?: () => void): void {
  noSymlink(dirname(path), 'directory');
  if (existsSync(path)) noSymlink(path, 'file');
  const temporary = join(dirname(path), `.temporary-${randomUUID()}`); let renamed = false;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
    beforePublish?.(); renameSync(temporary, path); renamed = true; published?.(); syncDirectory(dirname(path));
  } catch (error) {
    if (renamed) throw new IndexedStorageError('commit_uncertain', 'unknown'); throw error;
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
const leaseSchema = z.object({ version: z.literal(1), pid: integer.min(1), token: uuid }).strict();
export function acquireLease(path: string, reclaimDead = false): () => void {
  if (existsSync(path)) {
    noSymlink(path, 'directory');
    const owner = leaseSchema.parse(readJson(join(path, 'owner.json')));
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw new IndexedStorageError('busy'); }
    if (!reclaimDead || alive) throw new IndexedStorageError('busy');
    // Explicit recovery only: retain the abandoned lease as named evidence.
    renameSync(path, `${path}.abandoned-${randomUUID()}`); syncDirectory(dirname(path));
  }
  try { mkdirSync(path, { mode: 0o700 }); } catch { throw new IndexedStorageError('busy'); }
  const token = randomUUID();
  try { writeDurableJson(join(path, 'owner.json'), { version: 1, pid: process.pid, token }); syncDirectory(dirname(path)); }
  catch (error) { try { if (existsSync(join(path, 'owner.json'))) unlinkSync(join(path, 'owner.json')); rmdirSync(path); } catch {} throw error; }
  return () => {
    const owner = leaseSchema.parse(readJson(join(path, 'owner.json')));
    if (owner.token !== token) throw new IndexedStorageError('busy');
    unlinkSync(join(path, 'owner.json')); rmdirSync(path); syncDirectory(dirname(path));
  };
}
export function validateManagedLayout(root: string): void {
  noSymlink(managedDirectory(root), 'directory'); noSymlink(join(managedDirectory(root), 'stores'), 'directory');
  // All ancestor components are server paths, never client-controlled imports.
  let ancestor = dirname(resolve(root));
  while (true) { noSymlink(ancestor, 'directory'); const next = dirname(ancestor); if (next === ancestor) break; ancestor = next; }
}
export function readMarker(root: string): ManagedReady | ManagedTransition {
  validateManagedLayout(root); const parsed = markerSchema.safeParse(readJson(markerPath(root)));
  if (!parsed.success) throw new IndexedStorageError('corrupt'); return parsed.data;
}
export function storePath(root: string, id: string): string {
  if (!uuid.safeParse(id).success) throw new IndexedStorageError('invalid_scope');
  const path = join(managedDirectory(root), 'stores', id);
  noSymlink(join(managedDirectory(root), 'stores'), 'directory'); return path;
}
export function poisonText(rootId: string): string { return `VOX_MANAGED_STORAGE_V1:${rootId}\n`; }
export function verifyPoison(root: string, rootId: string): void {
  noSymlink(root, 'file'); if (readFileSync(root, 'utf8') !== poisonText(rootId)) throw new IndexedStorageError('corrupt');
}
export function metadataOf(storage: ManagedAdaptiveStorage): { incarnation: string; generation: number; lifecycleWatermark: number } {
  return storage instanceof SqliteAdaptiveStorage ? storage.readMetadata() : storage.readMetadata();
}
export function openRawManagedStore(root: string, ready: Pick<ManagedReady, 'format' | 'store'> & { version?: 1 | 2; fileAuthorityProjectionVersion?: 1 },
  now: () => number, seed?: { generation: number; lifecycleWatermark: number; schemaVersion?: 1 | 2 }, reclaimDead = false, legacyAuthoritySource = false): ManagedAdaptiveStorage {
  const path = storePath(root, ready.store);
  if (seed) { if (existsSync(path)) throw new IndexedStorageError('corrupt'); }
  else {
    if (!existsSync(path)) throw new IndexedStorageError('missing');
    noSymlink(path, ready.format === 'sqlite-v1' ? 'file' : 'directory');
    if (ready.format === 'file-v2') {
      if (!existsSync(join(path, 'head.json')) || !existsSync(join(path, 'records'))) throw new IndexedStorageError('missing');
      noSymlink(join(path, 'head.json'), 'file'); noSymlink(join(path, 'records'), 'directory');
    } else {
      // Refuse empty/foreign published files before a writable constructor could
      // initialize them. The qualified schema version is immutable after create.
      const header = Buffer.alloc(100), fd = openSync(path, 'r'); let bytes: number;
      try { bytes = readSync(fd, header, 0, header.length, 0); } finally { closeSync(fd); }
      if (bytes !== 100 || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0' || header.readUInt32BE(60) !== (ready.version ?? 1)) throw new IndexedStorageError('corrupt');
    }
  }
  const storage = ready.format === 'sqlite-v1' ? new SqliteAdaptiveStorage(path, { now, ...(seed ? { newStoreSeed: seed } : {}) })
    : new ManagedFileV2Storage(path, { now, ...(seed ? { newStoreSeed: seed } : {}), reclaimDeadLease: reclaimDead, legacyAuthoritySource });
  if (!seed && storage instanceof ManagedFileV2Storage && ready.format === 'file-v2' && ready.version === 2 &&
      (ready.fileAuthorityProjectionVersion !== storage.fileAuthorityProjectionVersion || !legacyAuthoritySource && ready.fileAuthorityProjectionVersion !== 1)) { storage.close(); throw new IndexedStorageError('invalid_controls'); }
  if (!seed && storage.canonicalSchemaVersion !== (ready.version ?? 1)) { storage.close(); throw new IndexedStorageError('corrupt'); }
  return storage;
}
export function openManagedAdaptiveStorage(root: string, options: ManagedStorageOptions): ManagedAdaptiveStorage {
  root = resolve(root); validateManagedLayout(root);
  const release = acquireLease(`${root}.managed.lock`); let storage: ManagedAdaptiveStorage | undefined;
  try {
    const marker = readMarker(root);
    if (marker.state !== 'ready' || marker.format !== options.format) throw new IndexedStorageError('corrupt');
    verifyPoison(root, marker.rootId);
    storage = openRawManagedStore(root, marker, options.now ?? Date.now);
    const metadata = metadataOf(storage);
    if (metadata.incarnation !== marker.identity.incarnation || metadata.generation !== marker.identity.generation || metadata.lifecycleWatermark < marker.watermarkFloor || storage.canonicalSchemaVersion !== requiredCanonicalSchema(marker)) throw new IndexedStorageError('corrupt');
    const close = storage.close.bind(storage); let closed = false;
    storage.close = () => { if (closed) return; close(); closed = true; release(); };
    return storage;
  } catch (error) { storage?.close(); release(); throw error; }
}
const referenceSchema = z.object({ key: hash, accountId: z.string().max(200), file: uuid, digest: hash }).strict();
const legacyHeadSchema = z.object({ formatVersion: z.literal(2), incarnation: uuid, generation: integer.min(1),
  lifecycleWatermark: integer, accounts: z.array(referenceSchema).max(MAX_MANAGED_ACCOUNTS) }).strict();
const pauseHeadSchema = legacyHeadSchema.extend({ schemaVersion: z.literal(2) }).strict();
const projectedReferenceSchema = referenceSchema.extend({ authorityFile: uuid, authorityDigest: hash }).strict();
const projectedHeadSchema = pauseHeadSchema.extend({ authorityProjectionVersion: z.literal(1), accounts: z.array(projectedReferenceSchema).max(MAX_MANAGED_ACCOUNTS) }).strict();
const headSchema = z.union([legacyHeadSchema, pauseHeadSchema, projectedHeadSchema]);
const authorityImageSchema = z.object({ version: z.literal(1), schemaVersion: z.literal(2), incarnation: uuid, generation: integer.min(1),
  key: hash, accountId: z.string().max(200), canonicalFile: uuid, canonicalDigest: hash, controls: directAuthorityControlsSchema,
  catalogs: z.tuple([z.object({ space: z.literal('work'), digest: hash }).strict(), z.object({ space: z.literal('personal'), digest: hash }).strict()]) }).strict();
type FileHead = z.infer<typeof headSchema>;
export interface ManagedFileOptions { now?: () => number; newStoreSeed?: { generation: number; lifecycleWatermark: number; schemaVersion?: 1 | 2 }; reclaimDeadLease?: boolean;
  /** Explicit transition source only; never enables provider-facing authority or writes. */
  legacyAuthoritySource?: boolean }
/** Rollback format, with compatibility aggregate callbacks. Atomic head publish
 * couples current canonical account image and durable lifecycle time. This is
 * not an indexed query adapter. Prepared stores expose a separate narrow body-free authority channel. */
export class ManagedFileV2Storage implements AdaptiveStorage {
  private transactionClock?: (clock: () => number) => number;
  readonly supportsCommittedWriteFence = true as const;
  readonly canonicalSchemaVersion: 1 | 2;
  readonly fileAuthorityProjectionVersion?: 1;
  private readonly legacyAuthoritySource: boolean;
  readonly identity: Readonly<{ incarnation: string; generation: number }>;
  readonly io = { canonicalImageReads: 0, authorityImageReads: 0, watermarkWrites: 0 };
  private readonly now: () => number;
  private readonly release: () => void;
  private writer = false;
  private closed = false;
  constructor(readonly directory: string, options: ManagedFileOptions = {}) {
    this.now = options.now ?? Date.now;
    this.legacyAuthoritySource = options.legacyAuthoritySource === true;
    if (existsSync(directory)) noSymlink(directory, 'directory'); else { mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); }
    this.release = acquireLease(`${directory}.owner`, options.reclaimDeadLease);
    try {
      const head = join(directory, 'head.json');
      if (!existsSync(head)) {
        if (readdirSync(directory).length) throw new IndexedStorageError('corrupt');
        const seed = z.object({ generation: integer.min(1), lifecycleWatermark: integer, schemaVersion: z.union([z.literal(1), z.literal(2)]).optional() }).strict().parse(options.newStoreSeed ?? { generation: 1, lifecycleWatermark: 0 });
        if (this.legacyAuthoritySource) throw new IndexedStorageError('invalid_scope');
        this.sample(seed.lifecycleWatermark); mkdirSync(join(directory, 'records'), { mode: 0o700 });
        if (seed.schemaVersion === 2) mkdirSync(join(directory, 'authority'), { mode: 0o700 });
        syncDirectory(directory);
        writeDurableJson(head, { formatVersion: 2, ...(seed.schemaVersion === 2 ? { schemaVersion: 2, authorityProjectionVersion: 1 } : {}), incarnation: randomUUID(), generation: seed.generation,
          lifecycleWatermark: seed.lifecycleWatermark, accounts: [] });
      } else if (options.newStoreSeed) throw new IndexedStorageError('corrupt');
      noSymlink(join(directory, 'records'), 'directory'); const metadata = this.head();
      this.canonicalSchemaVersion = 'schemaVersion' in metadata ? metadata.schemaVersion : 1;
      this.fileAuthorityProjectionVersion = 'authorityProjectionVersion' in metadata ? metadata.authorityProjectionVersion : undefined;
      if (this.canonicalSchemaVersion === 2 && !this.fileAuthorityProjectionVersion && !this.legacyAuthoritySource) throw new IndexedStorageError('invalid_controls');
      if (this.legacyAuthoritySource && (this.canonicalSchemaVersion !== 2 || this.fileAuthorityProjectionVersion)) throw new IndexedStorageError('invalid_scope');
      if (this.fileAuthorityProjectionVersion) noSymlink(join(directory, 'authority'), 'directory');
      this.identity = Object.freeze({ incarnation: metadata.incarnation, generation: metadata.generation });
    } catch (error) { this.release(); throw error; }
  }
  private assert(): void { if (this.closed) throw new IndexedStorageError('closed'); if (this.writer) throw new IndexedStorageError('busy'); }
  private sample(watermark: number, at = this.now()): number {
    if (!Number.isSafeInteger(at) || at < watermark || at < 0) throw new IndexedStorageError('clock_regression'); return at;
  }
  private head(): FileHead {
    const head = headSchema.parse(readJson(join(this.directory, 'head.json')));
    if (this.identity && ('authorityProjectionVersion' in head ? head.authorityProjectionVersion : undefined) !== this.fileAuthorityProjectionVersion) throw new IndexedStorageError('corrupt');
    if (this.canonicalSchemaVersion && ('schemaVersion' in head ? head.schemaVersion : 1) !== this.canonicalSchemaVersion) throw new IndexedStorageError('corrupt');
    if (this.identity && (head.incarnation !== this.identity.incarnation || head.generation !== this.identity.generation) ||
        new Set(head.accounts.map(a => a.key)).size !== head.accounts.length || new Set(head.accounts.map(a => a.file)).size !== head.accounts.length ||
        'authorityProjectionVersion' in head && new Set(head.accounts.map(a => a.authorityFile)).size !== head.accounts.length ||
        head.accounts.some((row, i) => i > 0 && head.accounts[i - 1].key >= row.key)) throw new IndexedStorageError('corrupt');
    for (const row of head.accounts) { validateAccountId(row.accountId); if (accountKey(row.accountId) !== row.key) throw new IndexedStorageError('corrupt'); }
    return head;
  }
  readMetadata(): { incarnation: string; generation: number; lifecycleWatermark: number } {
    if (this.closed) throw new IndexedStorageError('closed');
    const h = this.head(); return { incarnation: h.incarnation, generation: h.generation, lifecycleWatermark: h.lifecycleWatermark };
  }
  private record(head: FileHead, accountId: string, now: number): unknown | null {
    const row = head.accounts.find(row => row.key === accountKey(accountId)); if (!row) return null;
    const raw = readJson(join(this.directory, 'records', `${row.file}.json`), INDEXED_LIMITS.canonicalBytes); this.io.canonicalImageReads++;
    if (digest(raw) !== row.digest) throw new IndexedStorageError('corrupt'); if (validateAdaptiveDocument(raw, accountId, now).schemaVersion !== this.canonicalSchemaVersion) throw new IndexedStorageError('invalid_controls'); return raw;
  }
  private publishTime(at: number): void {
    const head = this.head(); this.sample(head.lifecycleWatermark, at);
    if (at > head.lifecycleWatermark) { head.lifecycleWatermark = at; writeDurableJson(join(this.directory, 'head.json'), head); this.io.watermarkWrites++; }
    this.sample(head.lifecycleWatermark);
  }
  observeLifecycleTime(observedAt: number): void {
    this.assert(); this.writer = true; try { this.publishTime(observedAt); } finally { this.writer = false; }
  }
  sampleClock(clock: () => number): number {
    if (this.transactionClock) return this.transactionClock(clock);
    this.assert(); this.writer = true;
    let observed: number;
    try { observed = this.sample(0, clock()); }
    finally { this.writer = false; }
    this.observeLifecycleTime(observed); return observed;
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T> {
    validateAccountId(accountId); this.assert(); if (this.legacyAuthoritySource) throw new IndexedStorageError('invalid_scope'); this.writer = true;
    let published = false, recordFile: string | undefined, authorityFile: string | undefined, observedTime: number | undefined;
    try {
      const head = this.head(), now = this.sample(head.lifecycleWatermark);
      observedTime = now;
      this.transactionClock = clock => { observedTime = this.sample(observedTime!, clock()); return observedTime; };
      const current = this.record(head, accountId, now);
      const output = mutate(current), outputAt = this.sample(observedTime); observedTime = outputAt;
      const document = validateAdaptiveDocument(output.document, accountId, outputAt);
      if (document.schemaVersion !== this.canonicalSchemaVersion) throw new IndexedStorageError('invalid_controls');
      const canonical = JSON.stringify(output.document);
      const serializedAt = this.sample(observedTime); observedTime = serializedAt;
      if (Buffer.byteLength(canonical) > INDEXED_LIMITS.canonicalBytes || digest(document) !== digest(validateAdaptiveDocument(JSON.parse(canonical), accountId, serializedAt))) throw new IndexedStorageError('capacity');
      const prior = head.accounts.find(row => row.key === accountKey(accountId)), file = randomUUID();
      recordFile = join(this.directory, 'records', `${file}.json`); writeDurableJson(recordFile, output.document);
      const reference = { key: accountKey(accountId), accountId, file, digest: digest(output.document) };
      if ('authorityProjectionVersion' in head) {
        const projection = projectDocument(document, canonical), authorityId = randomUUID();
        const image = authorityImageSchema.parse({ version: 1, schemaVersion: 2, incarnation: head.incarnation, generation: head.generation,
          key: reference.key, accountId, canonicalFile: file, canonicalDigest: reference.digest,
          controls: directAuthorityControls(document), catalogs: projection.catalogs });
        authorityFile = join(this.directory, 'authority', `${authorityId}.json`); writeDurableJson(authorityFile, image);
        head.accounts = [...head.accounts.filter(row => row.key !== reference.key), { ...reference, authorityFile: authorityId, authorityDigest: digest(image) }].sort((a, b) => a.key < b.key ? -1 : 1);
      } else head.accounts = [...head.accounts.filter(row => row.key !== reference.key), reference].sort((a, b) => a.key < b.key ? -1 : 1);
      if (head.accounts.length > MAX_MANAGED_ACCOUNTS || Buffer.byteLength(JSON.stringify(head)) > MAX_HEAD_BYTES) throw new IndexedStorageError('capacity');
      head.lifecycleWatermark = serializedAt;
      writeDurableJson(join(this.directory, 'head.json'), head, () => { observedTime = this.sample(observedTime!); beforeCommit?.(); }, () => { published = true; });
      this.io.watermarkWrites++;
      if (prior && 'authorityFile' in prior) { unlinkSync(join(this.directory, 'authority', `${prior.authorityFile}.json`)); syncDirectory(join(this.directory, 'authority')); }
      if (prior) { unlinkSync(join(this.directory, 'records', `${prior.file}.json`)); syncDirectory(join(this.directory, 'records')); }
      const result = output.result === undefined ? output.result : structuredClone(output.result);
      observedTime = this.sample(observedTime);
      try { beforeCommit?.(); } catch { throw new IndexedStorageError('denied', true); }
      return result;
    } catch (error) {
      if (!published && authorityFile && existsSync(authorityFile)) unlinkSync(authorityFile);
      if (!published && recordFile && existsSync(recordFile)) unlinkSync(recordFile);
      try {
        const watermark = this.head().lifecycleWatermark;
        let publicationAt = Math.max(watermark, observedTime ?? watermark);
        try { publicationAt = Math.max(publicationAt, this.sample(0)); } catch { /* Preserve valid observations before the fresh-clock denial. */ }
        this.publishTime(publicationAt);
      }
      catch (timeError) { throw new IndexedStorageError(timeError instanceof IndexedStorageError ? timeError.reason : 'corrupt', published); }
      if (error instanceof IndexedStorageError && error.committed === 'unknown') throw error;
      if (published && (!(error instanceof IndexedStorageError) || error.committed !== true)) throw new IndexedStorageError(error instanceof IndexedStorageError ? error.reason : 'corrupt', true);
      throw error;
    } finally { this.transactionClock = undefined; this.writer = false; }
  }
  /** Same current atomic FILE head, without opening any canonical image. */
  readDirectAuthorityForEffect<T>(accountId: string, space: SpaceKind, evaluate: DirectAuthorityEvaluator<T>):
    { status: 'ready'; value: T } | { status: 'busy' | 'unsupported' | 'missing' } {
    validateAccountId(accountId);
    if (space !== 'work' && space !== 'personal') throw new IndexedStorageError('invalid_scope');
    if (this.writer) return { status: 'busy' }; this.assert();
    if (!this.fileAuthorityProjectionVersion || this.legacyAuthoritySource) return { status: 'unsupported' };
    this.writer = true; let observed: number | undefined;
    try {
      const head = this.head(); if (!('authorityProjectionVersion' in head)) throw new IndexedStorageError('invalid_controls');
      observed = this.sample(head.lifecycleWatermark);
      const row = head.accounts.find(row => row.key === accountKey(accountId));
      if (!row) { this.publishTime(observed); return { status: 'missing' }; }
      noSymlink(join(this.directory, 'records'), 'directory');
      noSymlink(join(this.directory, 'records', `${row.file}.json`), 'file');
      const raw = readJson(join(this.directory, 'authority', `${row.authorityFile}.json`), INDEXED_LIMITS.canonicalBytes);
      this.io.authorityImageReads++;
      const image = authorityImageSchema.parse(raw);
      if (digest(image) !== row.authorityDigest || image.incarnation !== head.incarnation || image.generation !== head.generation ||
          image.key !== row.key || image.accountId !== accountId || image.canonicalFile !== row.file || image.canonicalDigest !== row.digest) throw new IndexedStorageError('invalid_controls');
      const controls = directAuthorityControls(parseDirectAuthorityControls(image.controls, accountId));
      if (controls.schemaVersion !== 2) throw new IndexedStorageError('invalid_controls');
      observed = this.sample(observed);
      if (controls.createdAt > observed || controls.updatedAt > observed) throw new IndexedStorageError('clock_regression');
      const catalog = image.catalogs.find(c => c.space === space)!;
      const stamp = Object.freeze({ incarnation: head.incarnation, generation: head.generation, catalogVersion: controls.revision, catalogDigest: catalog.digest });
      const result = validateRuntimeControlEvaluation<T>(evaluate(controls, observed, digest([head.incarnation, head.generation]), stamp));
      const fresh = () => { observed = this.sample(observed!); return observed; };
      const checkDeadline = () => { if (!result.denied && result.deadline !== undefined && result.deadline <= fresh()) throw new IndexedStorageError('expired'); };
      checkDeadline(); this.publishTime(observed); fresh(); checkDeadline();
      if (result.denied || result.observedDenial) { this.publishTime(observed); fresh(); checkDeadline(); }
      // Compare again after all durable clock publication, then check time after this final head I/O.
      const current = this.head();
      if (digest(current.accounts) !== digest(head.accounts)) throw new IndexedStorageError('stale_receipt');
      fresh(); checkDeadline();
      return { status: 'ready', value: result.value };
    } catch (error) {
      // Retain every valid trusted observation even when projection/schema/deadline validation denies.
      const watermark = this.head().lifecycleWatermark;
      let at = Math.max(watermark, observed ?? watermark);
      try { at = Math.max(at, this.sample(0)); } catch { /* A regressed clock cannot erase previous observations. */ }
      this.publishTime(at); throw error;
    } finally { this.writer = false; }
  }
  readCommittedForEffect(accountId: string): { status: 'ready'; document: unknown | null } | { status: 'busy' } {
    validateAccountId(accountId); if (this.writer) return { status: 'busy' }; this.assert(); this.writer = true;
    try { const head = this.head(), now = this.sample(head.lifecycleWatermark), document = this.record(head, accountId, now); this.publishTime(now); return { status: 'ready', document }; }
    finally { this.writer = false; }
  }
  async listAccounts(input: AdaptiveAccountPageInput): Promise<AdaptiveAccountPage> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 || input.after !== undefined && !/^[a-f0-9]{64}$/.test(input.after)) throw new IndexedStorageError('invalid_scope');
    this.assert(); this.writer = true;
    try {
      const h = this.head(); this.publishTime(this.sample(h.lifecycleWatermark));
      const rows = h.accounts.filter(r => !input.after || r.key > input.after).slice(0, input.limit + 1);
      return { accountIds: rows.slice(0, input.limit).map(r => r.accountId), ...(rows.length > input.limit ? { next: rows[input.limit - 1].key } : {}) };
    } finally { this.writer = false; }
  }
  close(): void { if (this.closed) return; if (this.writer) throw new IndexedStorageError('busy'); this.release(); this.closed = true; }
}
