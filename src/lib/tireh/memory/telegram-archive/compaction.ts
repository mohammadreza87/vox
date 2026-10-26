import { z } from 'zod';
import { types } from 'node:util';
import { archiveDigest, archiveEventSchema, archiveFileSchema, archiveHeadSchema, archiveScopeKey,
  archiveScopeSchema, archiveStateSchema, ArchiveUnavailableError, type ArchiveAuthority,
  type ArchiveEvent, type ArchiveState } from './contracts';
import { MAX_ARCHIVE_CHECKPOINTS, MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_STATE_BYTES } from './service';

/** Offline prerequisite only. This format is NOT an archive head understood by
 * TelegramMemoryArchive. Nothing here uploads, publishes, prunes or frees capacity.
 * Callers must establish a committed CURRENT canonical state and authority before
 * calling, and recheck both at any later use/publication boundary. Supplied values
 * and hashes alone cannot establish authority freshness or disaster recovery. */
export interface ArchiveSnapshotContext { state: ArchiveState; authority: ArchiveAuthority; now: number }
export interface ArchiveSnapshotFile { fileId: string; bytes: Uint8Array }
export interface ArchiveSnapshotArtifacts { manifest: Uint8Array; chunks: readonly Uint8Array[] }
export interface ArchiveSnapshotMetrics {
  sourceFiles: number; sourceBytes: number; chunks: number; snapshotBytes: number;
  receipts: number; activeEvents: number; networkRequests: 0;
}
export interface ArchiveSnapshotPlan extends ArchiveSnapshotArtifacts { digest: string; metrics: ArchiveSnapshotMetrics }
export const MAX_SNAPSHOT_SOURCE_FILES = MAX_ARCHIVE_CHECKPOINTS * 2;
export const MAX_SNAPSHOT_SOURCE_BYTES = MAX_SNAPSHOT_SOURCE_FILES * MAX_ARCHIVE_FILE_BYTES;
export const MAX_SNAPSHOT_CHUNKS = MAX_ARCHIVE_CHECKPOINTS;
const MAX_RECEIPTS = 1024;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const common = { schemaVersion: z.literal(1), scope: archiveScopeSchema, botId: integer.min(1),
  sequence: integer.min(1), operationId: id };
const bundleSchema = z.object({ ...common, kind: z.literal('events'), events: z.array(archiveEventSchema).min(1).max(8) }).strict();
const sourceManifestSchema = z.object({ ...common, kind: z.literal('manifest'), authorityRevision: id,
  createdAt: integer, bundle: archiveFileSchema, previous: archiveHeadSchema.nullable() }).strict();
const authoritySchema = z.object({ scope: archiveScopeSchema, revision: id, allowed: z.literal(true),
  botId: integer.min(1), expiresAt: integer, suppressedEventIds: z.array(id).max(MAX_RECEIPTS) });
const receiptSchema = archiveStateSchema.shape.receipts.element;
const timingSchema = z.object({ occurredAt: integer, receivedAt: integer, expiresAt: integer }).strict();
const entrySchema = z.object({ receipt: receiptSchema,
  disposition: z.enum(['active', 'suppressed', 'expired', 'superseded']),
  timing: timingSchema.optional(), event: archiveEventSchema.optional() }).strict();
type SnapshotEntry = z.infer<typeof entrySchema>;
const chunkSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('snapshot-chunk'),
  ordinal: integer, entries: z.array(entrySchema).min(1).max(MAX_RECEIPTS) }).strict();
const snapshotManifestSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('snapshot-plan'),
  scope: archiveScopeSchema, botId: integer.min(1), createdAt: integer, sourceRevision: integer,
  authorityRevision: id, authorityExpiresAt: integer, suppressedEventIds: z.array(id).max(MAX_RECEIPTS),
  sourceHead: archiveHeadSchema.nullable(), stateDigest: digest, authorityDigest: digest,
  receiptCount: integer.max(MAX_RECEIPTS), sourceFiles: integer.max(MAX_SNAPSHOT_SOURCE_FILES),
  sourceBytes: integer.max(MAX_SNAPSHOT_SOURCE_BYTES),
  chunks: z.array(z.object({ ordinal: integer, digest, bytes: integer.min(1).max(MAX_ARCHIVE_FILE_BYTES),
    entries: integer.min(1).max(MAX_RECEIPTS) }).strict()).max(MAX_SNAPSHOT_CHUNKS) }).strict();
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const fail = (code: 'authority' | 'scope' | 'capacity' | 'integrity' | 'unknown_delivery'): never => { throw new ArchiveUnavailableError(code); };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fingerprint = (event: ArchiveEvent) => archiveDigest(encode([event.eventId, event.logicalId, event.revision,
  event.occurredAt, event.role, event.text, event.sourceMessageId ?? null]));
const parseFile = (bytes: Uint8Array): unknown => {
  if (!types.isUint8Array(bytes) || bytes.byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return fail('integrity'); }
};
function context(input: ArchiveSnapshotContext) {
  const now = integer.parse(input.now), state = archiveStateSchema.parse(input.state), authority = authoritySchema.parse(input.authority);
  if (encode(state).byteLength > MAX_ARCHIVE_STATE_BYTES || (state.head?.sequence ?? 0) > MAX_ARCHIVE_CHECKPOINTS) fail('capacity');
  if (state.operation) fail('unknown_delivery');
  if (archiveScopeKey(state.scope) !== archiveScopeKey(authority.scope) || state.botId !== authority.botId ||
    !/^telegram-account:[1-9]\d{0,15}$/.test(state.scope.accountId) || !Number.isSafeInteger(Number(state.scope.accountId.slice(17)))) fail('scope');
  if (authority.expiresAt <= now) fail('authority');
  const suppressed = new Set(authority.suppressedEventIds);
  // A retained suppression marker cannot be ignored by an incomplete authority
  // projection, even if the caller claims its revision is current.
  for (const receipt of state.receipts) if (receipt.suppressed && !suppressed.has(receipt.logicalId) && !suppressed.has(receipt.eventId)) fail('authority');
  const authorityDigest = archiveDigest(encode({ ...authority, suppressedEventIds: [...suppressed].sort() }));
  return { now, state, authority, authorityDigest, stateDigest: archiveDigest(encode(state)), suppressed };
}
function receiptIndex(state: ArchiveState) {
  const receipts = new Map<string, ArchiveState['receipts'][number]>(), versions = new Set<string>(), latest = new Map<string, number>();
  for (const receipt of state.receipts) {
    const versionKey = JSON.stringify([receipt.logicalId, receipt.sourceRevision]);
    if (receipts.has(receipt.eventId) || versions.has(versionKey)) fail('integrity');
    receipts.set(receipt.eventId, receipt); versions.add(versionKey);
    latest.set(receipt.logicalId, Math.max(latest.get(receipt.logicalId) ?? 0, receipt.sourceRevision));
  }
  return { receipts, latest };
}
function isSuppressed(receipt: ArchiveState['receipts'][number], suppressed: Set<string>): boolean {
  return !!receipt.suppressed || suppressed.has(receipt.eventId) || suppressed.has(receipt.logicalId);
}
function disposition(receipt: ArchiveState['receipts'][number], timing: z.infer<typeof timingSchema> | undefined,
  latest: Map<string, number>, suppressed: Set<string>, at: number): SnapshotEntry['disposition'] {
  if (isSuppressed(receipt, suppressed)) return 'suppressed';
  if (!timing) return fail('integrity');
  if (receipt.sourceRevision < latest.get(receipt.logicalId)!) return 'superseded';
  return timing.expiresAt <= at ? 'expired' : 'active';
}

/** Supply exactly the immutable v1 files reachable from canonical state.head.
 * The filtered recover() result and freestanding source events are insufficient:
 * receipt fingerprints intentionally do not authenticate receipt/expiry times.
 * Suppressed receipts whose never-uploaded pending text was removed need no
 * payload. Every other receipt must resolve to head-rooted or canonical text. */
function plan(input: ArchiveSnapshotContext & { files: readonly ArchiveSnapshotFile[] }): ArchiveSnapshotPlan {
  const c = context(input), { state, authority, now, suppressed } = c, { receipts, latest } = receiptIndex(state);
  if (!Array.isArray(input.files) || input.files.length > MAX_SNAPSHOT_SOURCE_FILES) fail('capacity');
  const files = new Map<string, Uint8Array>(), used = new Set<string>();
  let sourceBytes = 0;
  for (const file of input.files) {
    id.parse(file.fileId);
    if (!types.isUint8Array(file.bytes) || file.bytes.byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
    sourceBytes += file.bytes.byteLength;
    if (sourceBytes > MAX_SNAPSHOT_SOURCE_BYTES) fail('capacity');
    if (files.has(file.fileId)) fail('integrity');
    // Copy before BOTH hashing and decoding, including SharedArrayBuffer-backed
    // views. A concurrent writer cannot change the bytes between those checks.
    files.set(file.fileId, new Uint8Array(file.bytes));
  }
  const read = (file: { fileId: string; digest: string }) => {
    const bytes = files.get(file.fileId);
    if (!bytes || used.has(file.fileId) || archiveDigest(bytes) !== file.digest) return fail('integrity');
    used.add(file.fileId); return parseFile(bytes);
  };
  const events = new Map<string, ArchiveEvent>();
  const accept = (event: ArchiveEvent) => {
    const receipt = receipts.get(event.eventId);
    if (!receipt || events.has(event.eventId) || receipt.logicalId !== event.logicalId || receipt.sourceRevision !== event.revision ||
      receipt.fingerprint !== fingerprint(event) || event.receivedAt > now || event.expiresAt <= event.receivedAt) fail('integrity');
    events.set(event.eventId, event);
  };
  let head = state.head, checkpoints = 0;
  while (head) {
    if (++checkpoints > MAX_ARCHIVE_CHECKPOINTS) fail('capacity');
    const manifest = sourceManifestSchema.parse(read(head));
    if (archiveScopeKey(manifest.scope) !== archiveScopeKey(state.scope) || manifest.botId !== authority.botId ||
      manifest.sequence !== head.sequence || (manifest.previous?.sequence ?? 0) !== manifest.sequence - 1 || manifest.createdAt > now) fail('integrity');
    const bundle = bundleSchema.parse(read(manifest.bundle));
    if (archiveScopeKey(bundle.scope) !== archiveScopeKey(state.scope) || bundle.botId !== authority.botId ||
      bundle.sequence !== manifest.sequence || bundle.operationId !== manifest.operationId) fail('integrity');
    for (const event of bundle.events) accept(event);
    head = manifest.previous ?? undefined;
  }
  for (const event of state.pending) accept(event);
  if (used.size !== files.size) fail('integrity');
  const entries: SnapshotEntry[] = state.receipts.map(receipt => {
    const event = events.get(receipt.eventId);
    const timing = event && { occurredAt: event.occurredAt, receivedAt: event.receivedAt, expiresAt: event.expiresAt };
    const reason = disposition(receipt, timing, latest, suppressed, now);
    return { receipt, disposition: reason, ...(reason === 'suppressed' ? {} : { timing }), ...(reason === 'active' ? { event } : {}) };
  });
  const chunks: Uint8Array[] = [];
  let batch: SnapshotEntry[] = [];
  const chunkBytes = (rows: SnapshotEntry[]) => encode({ schemaVersion: 1, kind: 'snapshot-chunk', ordinal: chunks.length, entries: rows });
  const flush = () => { if (batch.length) { chunks.push(chunkBytes(batch)); batch = []; } };
  for (const entry of entries) {
    if (chunkBytes([...batch, entry]).byteLength > MAX_ARCHIVE_FILE_BYTES) flush();
    batch.push(entry);
    if (chunkBytes(batch).byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
  }
  flush();
  if (chunks.length > MAX_SNAPSHOT_CHUNKS) fail('capacity');
  const manifest = encode(snapshotManifestSchema.parse({ schemaVersion: 1, kind: 'snapshot-plan', scope: state.scope,
    botId: state.botId, createdAt: now, sourceRevision: state.revision, sourceHead: state.head ?? null,
    authorityRevision: authority.revision, authorityExpiresAt: authority.expiresAt, suppressedEventIds: [...suppressed].sort(),
    stateDigest: c.stateDigest, authorityDigest: c.authorityDigest, receiptCount: entries.length,
    sourceFiles: files.size, sourceBytes,
    chunks: chunks.map((bytes, ordinal) => ({ ordinal, digest: archiveDigest(bytes), bytes: bytes.byteLength,
      entries: chunkSchema.parse(parseFile(bytes)).entries.length })) }));
  if (manifest.byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
  return { manifest, chunks, digest: archiveDigest(manifest), metrics: { sourceFiles: files.size, sourceBytes,
    chunks: chunks.length, snapshotBytes: manifest.byteLength + chunks.reduce((sum, bytes) => sum + bytes.byteLength, 0),
    receipts: entries.length, activeEvents: entries.filter(e => e.disposition === 'active').length, networkRequests: 0 } };
}

/** expectedManifestDigest must come from the trusted planner result (or a future
 * qualified canonical publication), independently of the supplied artifact bytes.
 * This verifier validates an offline plan, not a runtime producer or a fresh
 * authority source. It cannot publish or restore canonical authority from files. */
function verify(input: ArchiveSnapshotContext, artifacts: ArchiveSnapshotArtifacts,
  expectedManifestDigest: string): { events: ArchiveEvent[]; receipts: ArchiveState['receipts']; metrics: ArchiveSnapshotMetrics } {
  const c = context(input), { state, now, suppressed } = c, { latest } = receiptIndex(state);
  digest.parse(expectedManifestDigest);
  if (!types.isUint8Array(artifacts.manifest) || artifacts.manifest.byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
  const manifestBytes = new Uint8Array(artifacts.manifest);
  if (archiveDigest(manifestBytes) !== expectedManifestDigest) fail('integrity');
  const manifest = snapshotManifestSchema.parse(parseFile(manifestBytes));
  if (manifest.stateDigest !== c.stateDigest || manifest.authorityDigest !== c.authorityDigest || now < manifest.createdAt ||
    manifest.sourceRevision !== state.revision || !equal(manifest.sourceHead, state.head ?? null) ||
    manifest.authorityRevision !== c.authority.revision || manifest.authorityExpiresAt !== c.authority.expiresAt ||
    !equal(manifest.suppressedEventIds, [...suppressed].sort())) fail('authority');
  if (archiveScopeKey(manifest.scope) !== archiveScopeKey(state.scope) || manifest.botId !== state.botId) fail('scope');
  if (!Array.isArray(artifacts.chunks) || artifacts.chunks.length > MAX_SNAPSHOT_CHUNKS) fail('capacity');
  if (artifacts.chunks.length !== manifest.chunks.length || manifest.receiptCount !== state.receipts.length) fail('integrity');
  const entries: SnapshotEntry[] = [];
  let snapshotBytes = manifestBytes.byteLength;
  for (let ordinal = 0; ordinal < artifacts.chunks.length; ordinal++) {
    const suppliedBytes = artifacts.chunks[ordinal], ref = manifest.chunks[ordinal];
    if (!types.isUint8Array(suppliedBytes) || suppliedBytes.byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
    const bytes = new Uint8Array(suppliedBytes);
    if (ref.ordinal !== ordinal || ref.bytes !== bytes.byteLength || archiveDigest(bytes) !== ref.digest) fail('integrity');
    const chunk = chunkSchema.parse(parseFile(bytes));
    if (chunk.ordinal !== ordinal || chunk.entries.length !== ref.entries || entries.length + chunk.entries.length > MAX_RECEIPTS) fail('integrity');
    entries.push(...chunk.entries); snapshotBytes += bytes.byteLength;
  }
  if (entries.length !== state.receipts.length) fail('integrity');
  const events: ArchiveEvent[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], receipt = state.receipts[index];
    if (!equal(entry.receipt, receipt) || entry.disposition !== disposition(receipt, entry.timing, latest, suppressed, manifest.createdAt)) fail('integrity');
    if (entry.disposition === 'suppressed') {
      if (entry.timing || entry.event) fail('integrity');
      continue;
    }
    if (!entry.timing || entry.timing.receivedAt > manifest.createdAt || entry.timing.expiresAt <= entry.timing.receivedAt) fail('integrity');
    if (entry.disposition !== 'active') { if (entry.event) fail('integrity'); continue; }
    const event = entry.event;
    if (!event || event.eventId !== receipt.eventId || event.logicalId !== receipt.logicalId || event.revision !== receipt.sourceRevision ||
      fingerprint(event) !== receipt.fingerprint || !equal(entry.timing, { occurredAt: event.occurredAt, receivedAt: event.receivedAt, expiresAt: event.expiresAt })) return fail('integrity');
    if (event.expiresAt > now) events.push(event);
  }
  events.sort((a, b) => a.occurredAt - b.occurredAt || a.receivedAt - b.receivedAt || a.eventId.localeCompare(b.eventId));
  return { events, receipts: entries.map(entry => entry.receipt), metrics: { sourceFiles: manifest.sourceFiles,
    sourceBytes: manifest.sourceBytes, chunks: artifacts.chunks.length, snapshotBytes, receipts: entries.length,
    activeEvents: events.length, networkRequests: 0 } };
}

// Errors must not expose decoded source fragments (including JSON parse errors
// or attacker-controlled schema keys). Return no partial result on any failure.
function guarded<T>(action: () => T): T {
  try { return action(); }
  catch (error) { if (error instanceof ArchiveUnavailableError) throw error; return fail('integrity'); }
}
export function planArchiveSnapshot(input: ArchiveSnapshotContext & { files: readonly ArchiveSnapshotFile[] }): ArchiveSnapshotPlan {
  return guarded(() => plan(input));
}
/** See the trusted-digest and current-authority obligations above. Returns only
 * the latest usable source per logical ID; all source receipts remain separate.
 * Latest revision is selected before expiry/suppression, so old text cannot revive. */
export function verifyArchiveSnapshot(input: ArchiveSnapshotContext, artifacts: ArchiveSnapshotArtifacts,
  expectedManifestDigest: string): { events: ArchiveEvent[]; receipts: ArchiveState['receipts']; metrics: ArchiveSnapshotMetrics } {
  return guarded(() => verify(input, artifacts, expectedManifestDigest));
}
