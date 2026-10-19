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
  renameSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { z } from 'zod';
import type { AdaptiveStorage, AdaptiveAccountPage, AdaptiveAccountPageInput } from '../storage';
import { digest, validateAdaptiveDocument } from '../repository';
import { accountKey, validateAccountId } from './projection';
import { INDEXED_LIMITS, IndexedStorageError } from './contracts';
import { SqliteAdaptiveStorage } from './sqlite-storage';
const integer = z.number().int().nonnegative().safe(), uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MAX_TRANSITION_BYTES = 64 * 1024 * 1024;
export const MAX_MANAGED_ACCOUNTS = 10_000;
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
export const managedIdentitySchema = z.object({ incarnation: uuid, generation: integer.min(1) }).strict();
export const managedReadySchema = z.object({ version: z.literal(1), state: z.literal('ready'), rootId: uuid,
  format: z.enum(['sqlite-v1', 'file-v2']), store: uuid, identity: managedIdentitySchema,
  watermarkFloor: integer }).strict();
export type ManagedReady = z.infer<typeof managedReadySchema>;
export const transitionSchema = z.object({ version: z.literal(1), state: z.literal('transition'), rootId: uuid,
  id: uuid, phase: z.enum(['prepared', 'verified', 'poisoned']), sourceFormat: z.enum(['legacy-file', 'sqlite-v1', 'file-v2']),
  previous: managedReadySchema.optional(), sourceDigest: hash, sourceWatermark: integer,
  legacyArchive: uuid.optional(), targetFormat: z.enum(['sqlite-v1', 'file-v2']), targetStore: uuid,
  targetIdentity: managedIdentitySchema.optional(), targetDigest: hash.optional(), generation: integer.min(1),
}).strict();
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
export function openRawManagedStore(root: string, ready: Pick<ManagedReady, 'format' | 'store'>,
  now: () => number, seed?: { generation: number; lifecycleWatermark: number }, reclaimDead = false): ManagedAdaptiveStorage {
  const path = storePath(root, ready.store);
  if (existsSync(path)) noSymlink(path, ready.format === 'sqlite-v1' ? 'file' : 'directory');
  return ready.format === 'sqlite-v1' ? new SqliteAdaptiveStorage(path, { now, ...(seed ? { newStoreSeed: seed } : {}) })
    : new ManagedFileV2Storage(path, { now, ...(seed ? { newStoreSeed: seed } : {}), reclaimDeadLease: reclaimDead });
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
    if (metadata.incarnation !== marker.identity.incarnation || metadata.generation !== marker.identity.generation || metadata.lifecycleWatermark < marker.watermarkFloor) throw new IndexedStorageError('corrupt');
    const close = storage.close.bind(storage); let closed = false;
    storage.close = () => { if (closed) return; close(); closed = true; release(); };
    return storage;
  } catch (error) { storage?.close(); release(); throw error; }
}
const referenceSchema = z.object({ key: hash, accountId: z.string().max(200), file: uuid, digest: hash }).strict();
const headSchema = z.object({ formatVersion: z.literal(2), incarnation: uuid, generation: integer.min(1),
  lifecycleWatermark: integer, accounts: z.array(referenceSchema).max(MAX_MANAGED_ACCOUNTS) }).strict();
type FileHead = z.infer<typeof headSchema>;
export interface ManagedFileOptions { now?: () => number; newStoreSeed?: { generation: number; lifecycleWatermark: number }; reclaimDeadLease?: boolean }
/** Rollback format, with compatibility aggregate callbacks. Atomic head publish
 * couples current canonical account image and durable lifecycle time. This is
 * intentionally not an indexed query adapter and makes no no-body-load claim. */
export class ManagedFileV2Storage implements AdaptiveStorage {
  readonly supportsCommittedWriteFence = true as const;
  readonly identity: Readonly<{ incarnation: string; generation: number }>;
  readonly io = { canonicalImageReads: 0, watermarkWrites: 0 };
  private readonly now: () => number;
  private readonly release: () => void;
  private writer = false;
  private closed = false;
  constructor(readonly directory: string, options: ManagedFileOptions = {}) {
    this.now = options.now ?? Date.now;
    if (existsSync(directory)) noSymlink(directory, 'directory'); else { mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); }
    this.release = acquireLease(`${directory}.owner`, options.reclaimDeadLease);
    try {
      const head = join(directory, 'head.json');
      if (!existsSync(head)) {
        if (readdirSync(directory).length) throw new IndexedStorageError('corrupt');
        const seed = z.object({ generation: integer.min(1), lifecycleWatermark: integer }).strict().parse(options.newStoreSeed ?? { generation: 1, lifecycleWatermark: 0 });
        this.sample(seed.lifecycleWatermark); mkdirSync(join(directory, 'records'), { mode: 0o700 }); syncDirectory(directory);
        writeDurableJson(head, { formatVersion: 2, incarnation: randomUUID(), generation: seed.generation,
          lifecycleWatermark: seed.lifecycleWatermark, accounts: [] });
      } else if (options.newStoreSeed) throw new IndexedStorageError('corrupt');
      noSymlink(join(directory, 'records'), 'directory'); const metadata = this.head();
      this.identity = Object.freeze({ incarnation: metadata.incarnation, generation: metadata.generation });
    } catch (error) { this.release(); throw error; }
  }
  private assert(): void { if (this.closed) throw new IndexedStorageError('closed'); if (this.writer) throw new IndexedStorageError('busy'); }
  private sample(watermark: number, at = this.now()): number {
    if (!Number.isSafeInteger(at) || at < watermark || at < 0) throw new IndexedStorageError('clock_regression'); return at;
  }
  private head(): FileHead {
    const head = headSchema.parse(readJson(join(this.directory, 'head.json')));
    if (this.identity && (head.incarnation !== this.identity.incarnation || head.generation !== this.identity.generation) ||
        new Set(head.accounts.map(a => a.key)).size !== head.accounts.length || new Set(head.accounts.map(a => a.file)).size !== head.accounts.length ||
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
    if (digest(raw) !== row.digest) throw new IndexedStorageError('corrupt'); validateAdaptiveDocument(raw, accountId, now); return raw;
  }
  private publishTime(at: number): void {
    const head = this.head(); this.sample(head.lifecycleWatermark, at);
    if (at > head.lifecycleWatermark) { head.lifecycleWatermark = at; writeDurableJson(join(this.directory, 'head.json'), head); this.io.watermarkWrites++; }
    this.sample(head.lifecycleWatermark);
  }
  observeLifecycleTime(observedAt: number): void {
    this.assert(); this.writer = true; try { this.publishTime(observedAt); } finally { this.writer = false; }
  }
  async transact<T>(accountId: string, mutate: (current: unknown | null) => { document: unknown; result: T }, beforeCommit?: () => void): Promise<T> {
    validateAccountId(accountId); this.assert(); this.writer = true;
    let published = false, recordFile: string | undefined;
    try {
      const head = this.head(), now = this.sample(head.lifecycleWatermark), current = this.record(head, accountId, now);
      const output = mutate(current); const document = validateAdaptiveDocument(output.document, accountId, now);
      const canonical = JSON.stringify(output.document);
      if (Buffer.byteLength(canonical) > INDEXED_LIMITS.canonicalBytes || digest(document) !== digest(validateAdaptiveDocument(JSON.parse(canonical), accountId, now))) throw new IndexedStorageError('capacity');
      const prior = head.accounts.find(row => row.key === accountKey(accountId)), file = randomUUID();
      recordFile = join(this.directory, 'records', `${file}.json`); writeDurableJson(recordFile, output.document);
      head.accounts = [...head.accounts.filter(row => row.key !== accountKey(accountId)), { key: accountKey(accountId), accountId, file, digest: digest(output.document) }].sort((a, b) => a.key < b.key ? -1 : 1);
      if (head.accounts.length > MAX_MANAGED_ACCOUNTS || Buffer.byteLength(JSON.stringify(head)) > MAX_HEAD_BYTES) throw new IndexedStorageError('capacity');
      head.lifecycleWatermark = now;
      writeDurableJson(join(this.directory, 'head.json'), head, () => { this.sample(head.lifecycleWatermark); beforeCommit?.(); }, () => { published = true; });
      this.io.watermarkWrites++;
      if (prior) { unlinkSync(join(this.directory, 'records', `${prior.file}.json`)); syncDirectory(join(this.directory, 'records')); }
      const result = output.result === undefined ? output.result : structuredClone(output.result);
      this.sample(head.lifecycleWatermark);
      try { beforeCommit?.(); } catch { throw new IndexedStorageError('denied', true); }
      return result;
    } catch (error) {
      if (!published && recordFile && existsSync(recordFile)) unlinkSync(recordFile);
      try { this.publishTime(this.sample(this.head().lifecycleWatermark)); }
      catch (timeError) { throw new IndexedStorageError(timeError instanceof IndexedStorageError ? timeError.reason : 'corrupt', published); }
      if (error instanceof IndexedStorageError && error.committed === 'unknown') throw error;
      if (published && (!(error instanceof IndexedStorageError) || error.committed !== true)) throw new IndexedStorageError(error instanceof IndexedStorageError ? error.reason : 'corrupt', true);
      throw error;
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
