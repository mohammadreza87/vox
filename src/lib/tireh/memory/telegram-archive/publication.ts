import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { archiveDigest, archiveFileSchema, archiveHeadSchema, archiveRetiredOperationSchema, archiveScopeKey,
  archiveScopeSchema, archiveStateSchema, ArchiveUnavailableError, type ArchiveAuthority, type ArchiveFile,
  type ArchivePublicationClaim, type ArchiveRepository, type ArchiveRetiredOperation, type ArchiveScope, type ArchiveSnapshotDescriptor,
  type ArchiveSnapshotOperation, type ArchiveState, type ArchiveTransport } from './contracts';
import { planArchiveSnapshot, readPublishedSnapshotArtifacts, readSnapshotPlanMetadata, type ArchiveSnapshotFile, type ArchiveSnapshotPlan } from './compaction';
import { MAX_ARCHIVE_CHECKPOINTS, MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_STATE_BYTES, MAX_PUBLICATION_CHUNKS } from './limits';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (code: ConstructorParameters<typeof ArchiveUnavailableError>[0]): never => { throw new ArchiveUnavailableError(code); };
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const wrapperSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('published-snapshot'), scope: archiveScopeSchema,
  botId: integer.min(1), operationId: z.string().min(1).max(200), baseHead: archiveHeadSchema,
  receiptCount: integer.min(1).max(1024), receiptDigest: digest, sourceStateDigest: digest, planDigest: digest,
  planJson: z.string().min(1).max(MAX_ARCHIVE_FILE_BYTES), chunks: z.array(archiveFileSchema).min(1).max(MAX_PUBLICATION_CHUNKS),
}).strict();
const immutableReceipt = (r: ArchiveState['receipts'][number]) => [r.eventId, r.logicalId, r.sourceRevision, r.fingerprint];
export const snapshotReceiptDigest = (receipts: ArchiveState['receipts']) => archiveDigest(encode(receipts.map(immutableReceipt)));
const authorityDigest = (auth: ArchiveAuthority) => archiveDigest(encode({ scope: archiveScopeSchema.parse(auth.scope), revision: auth.revision,
  allowed: auth.allowed, botId: auth.botId, expiresAt: auth.expiresAt, suppressedEventIds: [...new Set(auth.suppressedEventIds)].sort() }));

/** The operation occupies its actual reserved state bytes. Other writers cannot
 * spend a number declared as a budget. Padding shrinks as known receipts grow. */
export function padSnapshotPublicationReservation(state: ArchiveState): void {
  const op = state.publication;
  if (!op) return;
  op.reservation = '';
  const remaining = op.budgetBytes - encode(state).byteLength;
  if (remaining < 0 || op.budgetBytes > MAX_ARCHIVE_STATE_BYTES) fail('capacity');
  op.reservation = '0'.repeat(remaining);
}

/** Content-free retirement; callers preserve any existing retired row and must
 * block new external claims until explicit owner acknowledgement. */
export function retireArchiveOperation(state: ArchiveState): ArchiveRetiredOperation | undefined {
  const publication = state.publication;
  if (publication && (publication.stage !== 'prepared' || publication.chunkRefs.length || publication.manifest)) {
    return archiveRetiredOperationSchema.parse({ kind: 'snapshot', id: publication.id, scope: state.scope, botId: state.botId,
      createdAt: publication.createdAt, stage: 'unknown', files: [...publication.chunkRefs, ...(publication.manifest ? [publication.manifest] : [])] });
  }
  const checkpoint = state.operation;
  if (checkpoint && checkpoint.stage !== 'prepared') return archiveRetiredOperationSchema.parse({ kind: 'checkpoint',
    id: checkpoint.id, scope: state.scope, botId: state.botId, createdAt: checkpoint.createdAt,
    stage: 'unknown', files: checkpoint.bundle ? [checkpoint.bundle] : [] });
  return undefined;
}

export interface PublicationContext {
  scope: ArchiveScope; auth: ArchiveAuthority; repo: ArchiveRepository; transport: ArchiveTransport;
  now: () => number; fence: () => void; enabled: () => boolean;
  read: () => Promise<ArchiveState>;
  mutate: <T>(apply: (state: ArchiveState) => T) => Promise<T>;
  download: (file: { fileId: string; digest: string }) => Promise<Uint8Array>;
}
function sourceProjection(state: ArchiveState, op: ArchiveSnapshotOperation): ArchiveState {
  const source = archiveStateSchema.parse(state);
  delete source.publication; source.revision = op.sourceRevision;
  if (source.operation || source.snapshot || source.pending.length || !equal(source.head, op.sourceHead) ||
    source.receipts.length !== op.receiptCount || snapshotReceiptDigest(source.receipts) !== op.receiptDigest ||
    archiveDigest(encode(source)) !== op.sourceStateDigest) fail('authority');
  return source;
}
/** Adapter calls this only on a ready committed canonical row, never a draft. */
export function isCurrentPublicationClaim(raw: ArchiveState | null, claim: ArchivePublicationClaim): boolean {
  try {
    if (!raw) return false;
    const state = archiveStateSchema.parse(raw), op = state.publication;
    if (!op || op.id !== claim.id || op.stage !== claim.stage || op.ordinal !== claim.ordinal ||
      op.sourceStateDigest !== claim.sourceStateDigest || op.authorityRevision !== claim.authorityRevision) return false;
    sourceProjection(state, op); return true;
  } catch { return false; }
}
function fence(c: PublicationContext, op?: ArchiveSnapshotOperation): void {
  c.fence();
  if (!c.enabled() || op && (c.now() >= op.validUntil || authorityDigest(c.auth) !== op.authorityDigest)) fail('authority');
}
async function sourceFiles(c: PublicationContext, state: ArchiveState, op?: ArchiveSnapshotOperation): Promise<ArchiveSnapshotFile[]> {
  const files: ArchiveSnapshotFile[] = [], seen = new Set<string>();
  let head = state.head, count = 0;
  while (head) {
    if (++count > MAX_ARCHIVE_CHECKPOINTS || seen.has(head.fileId)) fail('integrity');
    seen.add(head.fileId); fence(c, op);
    const bytes = await c.download(head); fence(c, op); files.push({ fileId: head.fileId, bytes });
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // Full strict chain/event/receipt validation is performed by the pure planner.
    const bundle = archiveFileSchema.parse(manifest.bundle);
    if (seen.has(bundle.fileId)) fail('integrity');
    seen.add(bundle.fileId);
    const bundleBytes = await c.download(bundle); fence(c, op); files.push({ fileId: bundle.fileId, bytes: bundleBytes });
    head = manifest.previous === null ? undefined : archiveHeadSchema.parse(manifest.previous);
  }
  return files;
}
function wrapper(state: ArchiveState, op: ArchiveSnapshotOperation, chunks = op.chunkRefs) {
  return wrapperSchema.parse({ schemaVersion: 1, kind: 'published-snapshot', scope: state.scope, botId: state.botId,
    operationId: op.id, baseHead: op.sourceHead, receiptCount: op.receiptCount, receiptDigest: op.receiptDigest,
    sourceStateDigest: op.sourceStateDigest, planDigest: op.planDigest, planJson: op.planJson, chunks });
}
function descriptor(op: ArchiveSnapshotOperation, manifest: ArchiveFile): ArchiveSnapshotDescriptor {
  return { version: 1, manifest, baseHead: op.sourceHead, receiptCount: op.receiptCount,
    receiptDigest: op.receiptDigest, sourceStateDigest: op.sourceStateDigest, planDigest: op.planDigest, chunks: op.chunkRefs.length };
}
async function retainUnknown(c: PublicationContext, id: string, claimed?: string) {
  if (!claimed) return;
  await c.repo.transact(c.scope, raw => {
    if (!raw) return fail('authority');
    const state = archiveStateSchema.parse(raw), op = state.publication;
    if (op?.id === id && op.stage === claimed) { op.stage = 'unknown'; state.revision++; padSnapshotPublicationReservation(state); }
    return { state, result: undefined };
  }, () => {}).catch(() => undefined);
}
async function cancelStalePublication(c: PublicationContext, id: string) {
  await c.repo.transact(c.scope, raw => {
    if (!raw) return fail('authority');
    const state = archiveStateSchema.parse(raw), op = state.publication;
    if (op?.id === id) {
      if (op.stage === 'prepared' && !op.chunkRefs.length && !op.manifest) delete state.publication;
      else op.stage = 'unknown';
      state.revision++; padSnapshotPublicationReservation(state);
    }
    return { state, result: undefined };
  }, () => {}).catch(() => undefined);
}

/** Explicit-only publication. No caller may invoke this from automatic drain.
 * A persisted sending claim is an uncertain provider outcome, never a retry. */
export async function publishArchiveSnapshot(c: PublicationContext): Promise<{ status: 'published' | 'already_published' | 'unknown'; sequence?: number; chunks?: number }> {
  let claimed: string | undefined, operationId: string | undefined, operationPlanDigest: string | undefined;
  let readyPlan: ArchiveSnapshotPlan | undefined;
  try {
    fence(c);
    if (!c.repo.isPublicationCurrent) fail('authority');
    let state = await c.read(); fence(c);
    if (state.snapshot) return { status: 'already_published', sequence: state.snapshot.baseHead.sequence, chunks: state.snapshot.chunks };
    if (state.operation || state.pending.length || !state.head || !state.receipts.length) fail('unknown_delivery');
    let op = state.publication;
    if (op && ['unknown', 'chunk_sending', 'manifest_sending'].includes(op.stage)) {
      await retainUnknown(c, op.id, op.stage);
      return { status: 'unknown' };
    }
    if (!op) {
      const createdAt = c.now(), files = await sourceFiles(c, state);
      const plan = planArchiveSnapshot({ state, authority: c.auth, now: createdAt, files });
      readyPlan = plan;
      if (!plan.chunks.length || plan.chunks.length > MAX_PUBLICATION_CHUNKS) fail('capacity');
      if (state.revision > Number.MAX_SAFE_INTEGER - (3 * plan.chunks.length + 10)) fail('capacity');
      const planJson = new TextDecoder('utf-8', { fatal: true }).decode(plan.manifest);
      const decoded = readPublishedSnapshotArtifacts(planJson, plan.chunks, plan.digest);
      const validUntil = Math.min(c.auth.expiresAt, ...decoded.entries.flatMap(entry => entry.event ? [entry.event.expiresAt] : []));
      const sourceStateDigest = archiveDigest(encode(archiveStateSchema.parse(state)));
      const prepared: ArchiveSnapshotOperation = { id: randomUUID(), stage: 'prepared', authorityRevision: c.auth.revision,
        authorityDigest: authorityDigest(c.auth), sourceRevision: state.revision, sourceStateDigest,
        sourceHead: state.head!, receiptCount: state.receipts.length, receiptDigest: snapshotReceiptDigest(state.receipts),
        createdAt, validUntil, planJson, planDigest: plan.digest, chunkRefs: [], ordinal: 0,
        budgetBytes: MAX_ARCHIVE_STATE_BYTES, reservation: '' };
      // IDs accept arbitrary 200-code-unit strings. JSON control escaping is
      // six bytes per unit, larger than an ASCII or UTF-8 provider identifier.
      const placeholder: ArchiveFile = { fileId: '\u0000'.repeat(200), messageId: Number.MAX_SAFE_INTEGER, digest: 'f'.repeat(64) };
      const refs = Array.from({ length: plan.chunks.length }, () => ({ ...placeholder }));
      if (encode(wrapper(state, prepared, refs)).byteLength > MAX_ARCHIVE_FILE_BYTES) fail('capacity');
      const worst = { ...prepared, stage: 'manifest_uploaded' as const, ordinal: Number.MAX_SAFE_INTEGER,
        chunkRefs: refs, manifest: placeholder };
      // Include maximum state revision digits and the final descriptor footprint.
      prepared.budgetBytes = encode({ ...state, revision: Number.MAX_SAFE_INTEGER, publication: worst }).byteLength +
        encode(descriptor({ ...prepared, chunkRefs: refs }, placeholder)).byteLength + 64;
      if (prepared.budgetBytes > MAX_ARCHIVE_STATE_BYTES) fail('capacity');
      fence(c, prepared);
      await c.mutate(current => {
        if (current.publication || current.snapshot || archiveDigest(encode(current)) !== sourceStateDigest) fail('authority');
        current.publication = prepared;
      });
      state = await c.read(); op = state.publication;
    }
    if (!op) return fail('integrity');
    operationId = op.id; operationPlanDigest = op.planDigest; fence(c, op);
    const persistedPlan = readSnapshotPlanMetadata(op.planJson);
    if (archiveDigest(new TextEncoder().encode(op.planJson)) !== op.planDigest || persistedPlan.stateDigest !== op.sourceStateDigest ||
      persistedPlan.authorityDigest !== op.authorityDigest || persistedPlan.sourceRevision !== op.sourceRevision ||
      persistedPlan.createdAt !== op.createdAt || persistedPlan.receiptCount !== op.receiptCount ||
      !equal(persistedPlan.sourceHead, op.sourceHead) || persistedPlan.chunks.length > MAX_PUBLICATION_CHUNKS) fail('integrity');
    const currentOperation = (current: ArchiveState, expectedStage?: ArchiveSnapshotOperation['stage']) => {
      const found = current.publication;
      if (!found || found.id !== operationId || expectedStage && found.stage !== expectedStage) return fail('unknown_delivery');
      sourceProjection(current, found); fence(c, found); return found;
    };
    const source = sourceProjection(state, op);
    const plan = readyPlan ?? planArchiveSnapshot({ state: source, authority: c.auth, now: op.createdAt,
      files: await sourceFiles(c, source, op) });
    if (plan.digest !== op.planDigest || new TextDecoder().decode(plan.manifest) !== op.planJson || plan.chunks.length > MAX_PUBLICATION_CHUNKS) fail('integrity');
    const restored = readPublishedSnapshotArtifacts(op.planJson, plan.chunks, op.planDigest);
    if (op.validUntil !== Math.min(c.auth.expiresAt, ...restored.entries.flatMap(entry => entry.event ? [entry.event.expiresAt] : []))) fail('integrity');
    fence(c, op);
    if (op.ordinal > plan.chunks.length || op.chunkRefs.length > plan.chunks.length ||
      new Set(op.chunkRefs.map(file => file.fileId)).size !== op.chunkRefs.length ||
      op.chunkRefs.some((file, ordinal) => file.digest !== archiveDigest(plan.chunks[ordinal])) ||
      op.stage === 'prepared' && op.chunkRefs.length !== op.ordinal ||
      op.stage === 'chunk_uploaded' && op.chunkRefs.length !== op.ordinal + 1 ||
      ['manifest_uploaded', 'ready'].includes(op.stage) && (op.ordinal !== plan.chunks.length || op.chunkRefs.length !== plan.chunks.length)) fail('integrity');
    const upload = async (filename: string, bytes: Uint8Array) => {
      if (bytes.byteLength > MAX_ARCHIVE_FILE_BYTES) return fail('capacity');
      fence(c, op);
      const receipt = await c.transport.upload(Number(c.scope.accountId.slice('telegram-account:'.length)), filename, bytes, () => {
        try {
          fence(c, op);
          if (!op || !claimed || !['chunk_sending', 'manifest_sending'].includes(claimed)) return false;
          return c.repo.isPublicationCurrent?.(c.scope, { id: op.id, stage: claimed as ArchivePublicationClaim['stage'],
            ordinal: op.ordinal, sourceStateDigest: op.sourceStateDigest, authorityRevision: op.authorityRevision }) === true;
        } catch { return false; }
      });
      return archiveFileSchema.parse({ ...receipt, digest: archiveDigest(bytes) });
    };
    while (op.ordinal < plan.chunks.length) {
      const ordinal = op.ordinal;
      if (op.stage === 'prepared') {
        await c.mutate(current => { currentOperation(current, 'prepared').stage = 'chunk_sending'; });
        claimed = 'chunk_sending';
        const file = await upload(`vox-snapshot-${op.id}-${ordinal}.json`, plan.chunks[ordinal]);
        await c.mutate(current => { const active = currentOperation(current, 'chunk_sending');
          if (active.ordinal !== ordinal || active.chunkRefs.length !== ordinal) fail('integrity');
          active.chunkRefs.push(file); active.stage = 'chunk_uploaded'; });
        claimed = undefined;
      }
      state = await c.read(); op = currentOperation(state, 'chunk_uploaded');
      if (op.ordinal !== ordinal || op.chunkRefs.length !== ordinal + 1) fail('integrity');
      await c.download(op.chunkRefs[ordinal]); fence(c, op);
      await c.mutate(current => { const active = currentOperation(current, 'chunk_uploaded');
        if (active.ordinal !== ordinal) fail('integrity'); active.ordinal++; active.stage = 'prepared'; });
      state = await c.read(); op = currentOperation(state);
    }
    const bytes = encode(wrapper(state, op));
    if (op.stage === 'prepared') {
      await c.mutate(current => { currentOperation(current, 'prepared').stage = 'manifest_sending'; });
      claimed = 'manifest_sending';
      const file = await upload(`vox-snapshot-${op.id}-manifest.json`, bytes);
      await c.mutate(current => { const active = currentOperation(current, 'manifest_sending'); active.manifest = file; active.stage = 'manifest_uploaded'; });
      claimed = undefined;
    }
    state = await c.read(); op = currentOperation(state);
    if (op.stage === 'manifest_uploaded') {
      if (!op.manifest || op.manifest.digest !== archiveDigest(bytes)) return fail('integrity');
      await c.download(op.manifest); fence(c, op);
      await c.mutate(current => { currentOperation(current, 'manifest_uploaded').stage = 'ready'; });
    }
    state = await c.read(); op = currentOperation(state, 'ready');
    if (!op.manifest || op.chunkRefs.length !== plan.chunks.length || op.ordinal !== plan.chunks.length) return fail('integrity');
    const published = descriptor(op, op.manifest);
    await c.mutate(current => { currentOperation(current, 'ready'); current.snapshot = published; delete current.publication; });
    return { status: 'published', sequence: published.baseHead.sequence, chunks: published.chunks };
  } catch (error) {
    if (operationId) {
      await retainUnknown(c, operationId, claimed);
      // A commit may have succeeded even if the repository response was lost.
      try { const current = await c.read(); fence(c); if (current.snapshot && !current.publication && current.snapshot.planDigest === operationPlanDigest) return { status: 'already_published',
        sequence: current.snapshot.baseHead.sequence, chunks: current.snapshot.chunks }; } catch { /* No fresh proof: fail closed. */ }
      if (error instanceof ArchiveUnavailableError && error.code === 'authority') await cancelStalePublication(c, operationId);
    }
    if (error instanceof ArchiveUnavailableError) throw error;
    return fail(claimed ? 'unknown_delivery' : 'integrity');
  }
}

/** Current policy and final revision fencing belong to the service caller. */
export async function readPublishedArchiveSnapshot(state: ArchiveState, download: (file: ArchiveFile) => Promise<Uint8Array>, now: () => number) {
  const snapshot = state.snapshot;
  if (!snapshot) return fail('integrity');
  try {
    const bytes = await download(snapshot.manifest);
    const published = wrapperSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (archiveScopeKey(published.scope) !== archiveScopeKey(state.scope) || published.botId !== state.botId ||
      !equal(published.baseHead, snapshot.baseHead) || published.receiptCount !== snapshot.receiptCount ||
      published.receiptDigest !== snapshot.receiptDigest || published.sourceStateDigest !== snapshot.sourceStateDigest ||
      published.planDigest !== snapshot.planDigest || published.chunks.length !== snapshot.chunks ||
      snapshot.receiptCount > state.receipts.length || snapshotReceiptDigest(state.receipts.slice(0, snapshot.receiptCount)) !== snapshot.receiptDigest) fail('integrity');
    const chunks: Uint8Array[] = [];
    for (const file of published.chunks) chunks.push(await download(file));
    const decoded = readPublishedSnapshotArtifacts(published.planJson, chunks, snapshot.planDigest);
    if (now() < decoded.manifest.createdAt) fail('authority');
    if (!equal(decoded.manifest.sourceHead, snapshot.baseHead) || decoded.manifest.receiptCount !== snapshot.receiptCount ||
      decoded.manifest.stateDigest !== snapshot.sourceStateDigest || archiveScopeKey(decoded.manifest.scope) !== archiveScopeKey(state.scope) ||
      decoded.manifest.botId !== state.botId) fail('integrity');
    for (let index = 0; index < decoded.entries.length; index++) {
      const original = decoded.entries[index].receipt, current = state.receipts[index];
      if (!equal(immutableReceipt(original), immutableReceipt(current)) || original.suppressed && !current.suppressed) fail('authority');
    }
    return decoded.entries;
  } catch (error) { if (error instanceof ArchiveUnavailableError) throw error; return fail('integrity'); }
}
