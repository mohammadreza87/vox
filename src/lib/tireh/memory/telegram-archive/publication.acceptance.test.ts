/** Independent AM-05/AM-12 publication acceptance. QA-owned synthetic fixtures;
 * implementation authors must not change these criteria to accept a candidate. */
import { describe, expect, it } from 'vitest';
import { archiveDigest, archiveScopeKey, archiveStateSchema, type ArchiveAuthority,
  type ArchiveEvent, type ArchiveRepository, type ArchiveScope, type ArchiveState,
  type ArchiveTransport } from './contracts';
import { TelegramMemoryArchive, MAX_ARCHIVE_STATE_BYTES } from './service';

const AT = Date.parse('2026-10-26T12:00:00Z');
const scope: ArchiveScope = { accountId: 'telegram-account:101', personId: 'qa-publication-person',
  agentId: 'qa-publication-agent', space: 'work', containerId: 'qa-private-publication' };
const clone = <T>(value: T): T => structuredClone(value);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const fingerprint = (event: ArchiveEvent) => archiveDigest(bytes([event.eventId, event.logicalId,
  event.revision, event.occurredAt, event.role, event.text, event.sourceMessageId ?? null]));
const source = (n: number, patch: Partial<ArchiveEvent> = {}): ArchiveEvent => ({ eventId: `qa-source-${n}`,
  logicalId: `qa-logical-${n}`, revision: 1, occurredAt: AT - 100, receivedAt: AT,
  expiresAt: AT + 86_400_000, role: 'user', text: `QA_SOURCE_${n}: پروژه synthetic Friday.`, ...patch });
const stage = (state: ArchiveState | null) => state?.publication?.stage;
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

function fixture() {
  let state: ArchiveState | null = null, now = AT, flag = true, busy = false;
  const authority: ArchiveAuthority = { scope: clone(scope), revision: 'qa-authority-1', allowed: true,
    botId: 7011, expiresAt: AT + 86_400_000, suppressedEventIds: [] };
  const files = new Map<string, Uint8Array>(), uploads: Array<{ id: string; data: Uint8Array }> = [];
  const downloads: string[] = [], commits: ArchiveState[] = [];
  let beforeCommit: ((next: ArchiveState) => void) | undefined;
  let afterCommit: ((next: ArchiveState) => void) | undefined;
  let beforeUpload: ((attempt: number) => Promise<void>) | undefined;
  let afterUpload: ((attempt: number) => Promise<void>) | undefined;
  let beforeDownload: ((id: string) => Promise<void>) | undefined;
  let fileIdFor = (attempt: number) => `qa-upload-${attempt}`;
  const repo: ArchiveRepository = {
    read: async key => { expect(archiveScopeKey(key)).toBe(archiveScopeKey(scope)); return clone(state); },
    isPublicationCurrent(key, claim) {
      if (busy || !state || archiveScopeKey(key) !== archiveScopeKey(scope)) return false;
      const op = state.publication;
      if (!op || op.id !== claim.id || op.stage !== claim.stage || op.ordinal !== claim.ordinal ||
        op.authorityRevision !== claim.authorityRevision || op.sourceStateDigest !== claim.sourceStateDigest) return false;
      const original = clone(state); delete original.publication; original.revision = op.sourceRevision;
      return archiveDigest(bytes(original)) === claim.sourceStateDigest;
    },
    async transact(key, mutate, fence) {
      expect(archiveScopeKey(key)).toBe(archiveScopeKey(scope));
      const next = mutate(clone(state)); beforeCommit?.(next.state); fence();
      state = archiveStateSchema.parse(clone(next.state)); commits.push(clone(state));
      afterCommit?.(clone(state)); return next.result;
    },
  };
  const transport: ArchiveTransport = {
    async upload(chatId, _filename, data, authorizeNow) {
      expect(chatId).toBe(101); await beforeUpload?.(uploads.length + 1);
      if (!authorizeNow()) throw new Error('QA_EFFECT_DENIED');
      const id = fileIdFor(uploads.length + 1);
      files.set(id, new Uint8Array(data)); uploads.push({ id, data: new Uint8Array(data) });
      await afterUpload?.(uploads.length); return { fileId: id, messageId: uploads.length };
    },
    async download(id, maxBytes) {
      downloads.push(id); await beforeDownload?.(id);
      const file = files.get(id); if (!file || file.byteLength > maxBytes) throw new Error('QA_FILE_UNAVAILABLE');
      return new Uint8Array(file);
    },
  };
  const create = (configured = true) => new TelegramMemoryArchive(repo, {
    read: async () => clone(authority), isCurrent: prior => authority.allowed && prior.revision === authority.revision &&
      prior.botId === authority.botId && prior.expiresAt > now && archiveScopeKey(prior.scope) === archiveScopeKey(authority.scope),
  }, transport, { now: () => now, ...(configured ? { snapshotPublicationEnabled: () => flag } : {}) });
  /** Seed the original public v1 file protocol independently of publication.
   * This avoids hundreds of setup sends for boundary and corruption fixtures. */
  const seed = (events: ArchiveEvent[], group = 8) => {
    let head: ArchiveState['head'];
    for (let offset = 0, sequence = 1; offset < events.length; offset += group, sequence++) {
      const operationId = `qa-source-op-${sequence}`, bundleId = `qa-origin-bundle-${sequence}`;
      const bundle = bytes({ schemaVersion: 1, kind: 'events', scope, botId: authority.botId, sequence,
        operationId, events: events.slice(offset, offset + group) });
      files.set(bundleId, bundle);
      const manifestId = `qa-origin-manifest-${sequence}`;
      const manifest = bytes({ schemaVersion: 1, kind: 'manifest', scope, botId: authority.botId, sequence,
        operationId, authorityRevision: authority.revision, createdAt: now,
        bundle: { fileId: bundleId, messageId: sequence * 2 - 1, digest: archiveDigest(bundle) }, previous: head ?? null });
      files.set(manifestId, manifest); head = { fileId: manifestId, messageId: sequence * 2, digest: archiveDigest(manifest), sequence };
    }
    state = archiveStateSchema.parse({ schemaVersion: 1, scope, botId: authority.botId, revision: 1,
      ...(head ? { head } : {}), pending: [], receipts: events.map(event => ({ eventId: event.eventId,
        logicalId: event.logicalId, sourceRevision: event.revision, fingerprint: fingerprint(event) })) });
  };
  return { files, uploads, downloads, commits, authority, repo, transport, create, seed,
    get state() { return clone(state); }, set state(value: ArchiveState | null) { state = clone(value); },
    get now() { return now; }, set now(value: number) { now = value; },
    set flag(value: boolean) { flag = value; },
    set busy(value: boolean) { busy = value; },
    beforeCommit: (fn?: typeof beforeCommit) => { beforeCommit = fn; },
    afterCommit: (fn?: typeof afterCommit) => { afterCommit = fn; },
    beforeUpload: (fn?: typeof beforeUpload) => { beforeUpload = fn; },
    afterUpload: (fn?: typeof afterUpload) => { afterUpload = fn; },
    beforeDownload: (fn?: typeof beforeDownload) => { beforeDownload = fn; },
    fileIds: (fn: typeof fileIdFor) => { fileIdFor = fn; },
  };
}

describe('AM-05/12 independently selected snapshot publication acceptance', () => {
  it('publishes complete source evidence once and recovers from the snapshot after original files disappear', async () => {
    const f = fixture(), expected = Array.from({ length: 24 }, (_, i) => source(i + 1, { occurredAt: AT - 1000 + i })); f.seed(expected);
    const originalHead = f.state!.head, originalReceipts = f.state!.receipts;
    expect((await f.create().recover(scope)).events).toEqual(expected);
    const oldReads = f.downloads.length; f.downloads.length = 0;
    const started = performance.now();
    expect(await f.create().compact(scope)).toMatchObject({ status: 'published' });
    const publicationMs = performance.now() - started;
    expect(f.state!.snapshot).toMatchObject({ baseHead: originalHead, receiptCount: expected.length });
    expect(f.state!.head).toEqual(originalHead); expect(f.state!.receipts).toEqual(originalReceipts);
    expect(f.state!.publication).toBeUndefined();
    expect(f.uploads.length).toBeGreaterThanOrEqual(2);
    for (const key of f.files.keys()) if (key.startsWith('qa-origin-')) f.files.delete(key);
    f.downloads.length = 0;
    expect((await f.create().recover(scope)).events).toEqual(expected);
    expect(f.downloads.length).toBeLessThan(oldReads);
    const snapshotReads = f.downloads.length;
    const count = f.uploads.length;
    expect(await f.create().compact(scope)).toMatchObject({ status: 'already_published' });
    expect(f.uploads).toHaveLength(count);
    expect(f.commits.every(state => bytes(state).byteLength <= MAX_ARCHIVE_STATE_BYTES)).toBe(true);
    console.info('Independent synthetic snapshot publication metrics', JSON.stringify({ receipts: expected.length,
      originalRecoveryRequests: oldReads, snapshotRecoveryRequests: snapshotReads,
      publicationUploads: count, uploadedBytes: f.uploads.reduce((total, upload) => total + upload.data.byteLength, 0),
      maximumReservedStateBytes: Math.max(...f.commits.map(state => bytes(state).byteLength)), publicationMs, paidModelCalls: 0 }));
  });

  it('preserves the established deterministic event-ID ordering when original occurrence and receipt times tie', async () => {
    const f = fixture(); f.seed([source(2), source(10), source(1)]);
    const expected = [source(1), source(10), source(2)];
    expect((await f.create().recover(scope)).events).toEqual(expected);
    await f.create().compact(scope);
    expect((await f.create().recover(scope)).events).toEqual(expected);
  });

  it('supports a later checkpoint suffix with original expiry and never revives an older revision', async () => {
    const f = fixture(); f.seed([source(1), source(2)]); await f.create().compact(scope);
    const replacement = source(3, { logicalId: source(1).logicalId, revision: 2, expiresAt: AT + 1000, text: 'QA_NEW_DATE Friday.' });
    await f.create().capture(scope, replacement); await f.create().checkpoint(scope, { force: true });
    expect(f.state!.head!.sequence).toBe(2);
    expect((await f.create().recover(scope)).events).toEqual([source(2), replacement]);
    f.now = AT + 1000;
    expect((await f.create().recover(scope)).events).toEqual([source(2)]);
    f.authority.suppressedEventIds = [source(2).logicalId]; f.authority.revision = 'qa-authority-suppressed';
    const state = f.state!; state.receipts[1].suppressed = true; state.revision++; f.state = state;
    expect((await f.create().recover(scope)).events).toEqual([]);
  });

  it('does no publication I/O by default, with pending input, or without a verified head', async () => {
    const f = fixture(); f.seed([source(1)]);
    await expect(f.create(false).compact(scope)).rejects.toMatchObject({ code: 'authority' });
    expect(f.uploads).toEqual([]); expect(f.downloads).toEqual([]);
    await f.create().capture(scope, source(2));
    await expect(f.create().compact(scope)).rejects.toBeDefined();
    expect(f.uploads).toEqual([]); expect(f.state!.pending).toEqual([source(2)]);
    const empty = fixture(); empty.seed([]);
    await expect(empty.create().compact(scope)).rejects.toBeDefined(); expect(empty.uploads).toEqual([]);
  });

  it('requires a committed synchronous claim capability before any source or effect I/O', async () => {
    const f = fixture(); f.seed([source(1)]); delete f.repo.isPublicationCurrent;
    await expect(f.create().compact(scope)).rejects.toBeDefined();
    expect(f.downloads).toEqual([]); expect(f.uploads).toEqual([]); expect(f.state!.publication).toBeUndefined();
  });

  it.each(['chunk', 'manifest'] as const)('retains a lost %s upload response and never automatically sends it again', async lost => {
    const f = fixture(); f.seed([source(1)]); const at = lost === 'chunk' ? 1 : 2;
    f.afterUpload(async attempt => { if (attempt === at) throw new Error('QA_SECRET_LOST_RESPONSE'); });
    await expect(f.create().compact(scope)).rejects.toBeDefined();
    expect(f.state!.snapshot).toBeUndefined(); expect(f.state!.publication).toBeDefined();
    expect(['unknown', 'chunk_sending', 'manifest_sending']).toContain(f.state!.publication!.stage);
    expect(JSON.stringify(f.state)).not.toContain('QA_SECRET_LOST_RESPONSE');
    f.afterUpload(); const sent = f.uploads.length;
    expect(await f.create().compact(scope)).toMatchObject({ status: 'unknown' });
    expect(f.uploads).toHaveLength(sent);
    expect((await f.create().recover(scope)).events).toEqual([source(1)]);
  });

  it('resolves a lost final commit response from the canonical descriptor without another upload', async () => {
    const f = fixture(); f.seed([source(1)]); let thrown = false;
    f.afterCommit(next => { if (next.snapshot && !thrown) { thrown = true; throw new Error('QA_COMMIT_RESPONSE_LOST'); } });
    try { await f.create().compact(scope); } catch { /* durable commit is the oracle */ }
    expect(thrown).toBe(true); expect(f.state!.snapshot).toBeDefined();
    f.afterCommit(); const sent = f.uploads.length;
    expect(await f.create().compact(scope)).toMatchObject({ status: 'already_published' });
    expect(f.uploads).toHaveLength(sent); expect((await f.create().recover(scope)).events).toEqual([source(1)]);
  });

  it.each(['prepared', 'chunk_sending', 'chunk_uploaded', 'manifest_sending', 'manifest_uploaded', 'ready'] as const)(
    'survives an interruption immediately after durable %s without duplicating known artifact bytes', async interrupted => {
      const f = fixture(); f.seed([source(1)]); let tripped = false;
      f.afterCommit(next => { if (!tripped && stage(next) === interrupted) { tripped = true; throw new Error('QA_SIMULATED_PROCESS_BOUNDARY'); } });
      await f.create().compact(scope).catch(() => undefined);
      expect(tripped).toBe(true); expect(f.commits.some(next => stage(next) === interrupted)).toBe(true);
      expect(f.state!.snapshot).toBeUndefined();
      f.afterCommit();
      const before = f.uploads.length, uncertain = ['unknown', 'chunk_sending', 'manifest_sending'].includes(stage(f.state)!);
      const result = await f.create().compact(scope);
      if (uncertain) { expect(result.status).toBe('unknown'); expect(f.uploads).toHaveLength(before); }
      else { expect(result.status).toBe('published'); expect((await f.create().recover(scope)).events).toEqual([source(1)]); }
      const writtenDigests = f.uploads.map(upload => archiveDigest(upload.data));
      expect(new Set(writtenDigests).size).toBe(writtenDigests.length);
    });

  it('has one effect owner during concurrent compact calls and visibly pauses new durable capture', async () => {
    const f = fixture(); f.seed([source(1)]);
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { release = done; });
    f.beforeUpload(async attempt => { if (attempt === 1) { entered(); await held; } });
    const running = f.create().compact(scope); await entry;
    expect(stage(f.state)).toBe('chunk_sending');
    await expect(f.create().capture(scope, source(2))).rejects.toBeDefined();
    expect(await f.create().compact(scope)).toMatchObject({ status: 'unknown' });
    release(); await running.catch(() => undefined);
    expect(f.uploads.length).toBeLessThanOrEqual(1);
    expect(f.state!.receipts.map(row => row.eventId)).toEqual([source(1).eventId]);
  });

  it('rejects an old dispatch callback after explicit abandonment and a new operation claim under unchanged authority', async () => {
    const f = fixture(); f.seed([source(1)]);
    let entered!: () => void, release!: () => void;
    const entry = new Promise<void>(done => { entered = done; }), held = new Promise<void>(done => { release = done; });
    f.beforeUpload(async () => { entered(); await held; });
    const original = f.create().compact(scope); await entry;
    const old = f.state!.publication!; expect(old.stage).toBe('chunk_sending');
    await f.create().abandonUnknown(scope);
    const next = f.state!;
    next.publication = { ...old, id: 'qa-new-publication-owner', stage: 'prepared', ordinal: 0, chunkRefs: [] };
    next.revision++; f.state = next;
    const replacement = f.state;
    release(); await original.catch(() => undefined);
    expect(f.uploads).toEqual([]); expect(f.state).toEqual(replacement);
    expect(f.state!.publication!.id).not.toBe(old.id);
  });

  it.each(['flag', 'grant', 'source-expiry', 'committed-store-busy'] as const)('stops before content dispatch when %s changes inside transport preparation', async reason => {
    const f = fixture(); f.seed([source(1, { expiresAt: AT + 100 })]);
    f.beforeUpload(async () => {
      if (reason === 'flag') f.flag = false;
      else if (reason === 'grant') { f.authority.allowed = false; f.authority.revision = 'qa-withdrawn'; }
      else if (reason === 'source-expiry') f.now = AT + 100;
      else f.busy = true;
    });
    await expect(f.create().compact(scope)).rejects.toBeDefined();
    expect(f.uploads).toEqual([]); expect(f.state!.snapshot).toBeUndefined();
  });

  it('cannot publish if the synchronous final commit fence loses current authority', async () => {
    const f = fixture(); f.seed([source(1)]); const head = f.state!.head;
    f.beforeCommit(next => { if (next.snapshot) { f.authority.revision = 'qa-changed-before-commit'; } });
    await expect(f.create().compact(scope)).rejects.toBeDefined();
    expect(f.state!.snapshot).toBeUndefined(); expect(f.state!.head).toEqual(head);
  });

  it.each(['manifest', 'chunk', 'prefix', 'base-root', 'extra-receipt'] as const)('rejects %s corruption without returning usable snapshot text', async corruption => {
    const f = fixture(); f.seed([source(1)]); await f.create().compact(scope);
    if (corruption === 'manifest') f.files.set(f.state!.snapshot!.manifest.fileId, bytes({ PRIVATE_ERROR_CANARY: 'tampered' }));
    else if (corruption === 'chunk') f.files.set(f.uploads[0].id, bytes({ PRIVATE_ERROR_CANARY: 'tampered' }));
    else {
      const state = f.state!;
      if (corruption === 'prefix') state.receipts[0].fingerprint = 'a'.repeat(64);
      if (corruption === 'base-root') state.head = { ...state.head!, fileId: 'qa-wrong-root', digest: 'b'.repeat(64) };
      if (corruption === 'extra-receipt') state.receipts.push({ eventId: 'qa-missing', logicalId: 'qa-missing', sourceRevision: 1, fingerprint: 'c'.repeat(64) });
      state.revision++; f.state = state;
    }
    let error: unknown;
    try { await f.create().recover(scope); } catch (failure) { error = failure; }
    expect(error).toBeDefined(); expect(String(error)).not.toContain('PRIVATE_ERROR_CANARY');
  });

  it('rejects runtime plans above sixteen chunks before any external write', async () => {
    const f = fixture(); f.seed(Array.from({ length: 100 }, (_, i) => source(i + 1, { text: '\u0000'.repeat(4096) })), 2);
    const before = f.state;
    await expect(f.create().compact(scope)).rejects.toMatchObject({ code: 'capacity' });
    expect(f.uploads).toEqual([]); expect(f.state).toEqual(before);
  });

  it('does not raise the original receipt or monotonic checkpoint horizon after publication', async () => {
    const f = fixture(); f.seed(Array.from({ length: 1024 }, (_, i) => source(i + 1))); await f.create().compact(scope);
    expect(f.state!.head!.sequence).toBe(128); expect(f.state!.receipts).toHaveLength(1024);
    await expect(f.create().capture(scope, source(1025))).rejects.toMatchObject({ code: 'capacity' });
    expect(f.state!.receipts).toHaveLength(1024); expect(f.state!.head!.sequence).toBe(128);
  });

  it('reserves actual worst-case serialized file identifiers before dispatch and retains every returned receipt', async () => {
    const f = fixture(); f.seed([source(1)]);
    f.fileIds(attempt => '\u0000'.repeat(200 - String(attempt).length) + String(attempt));
    expect(await f.create().compact(scope)).toMatchObject({ status: 'published' });
    expect(f.uploads).toHaveLength(2); expect(f.uploads.every(upload => upload.id.length === 200)).toBe(true);
    for (const committed of f.commits) {
      expect(bytes(committed).byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_STATE_BYTES);
      if (committed.publication) expect(bytes(committed).byteLength).toBe(committed.publication.budgetBytes);
    }
    expect(f.state!.snapshot!.manifest.fileId).toBe(f.uploads[1].id);
    expect((await f.create().recover(scope)).events).toEqual([source(1)]);
  });

  it('withholds a complete recovered result if current state changes during snapshot download', async () => {
    const f = fixture(); f.seed([source(1)]); await f.create().compact(scope);
    let changed = false;
    f.beforeDownload(async () => { if (!changed) { const next = f.state!; next.revision++; f.state = next; changed = true; } await tick(); });
    await expect(f.create().recover(scope)).rejects.toMatchObject({ code: 'authority' });
  });

  it.each(['accountId', 'personId', 'agentId', 'space', 'containerId', 'botId'] as const)(
    'rejects changed %s before exposing published content', async field => {
      const f = fixture(); f.seed([source(1)]); await f.create().compact(scope); f.downloads.length = 0;
      if (field === 'botId') f.authority.botId++;
      else f.authority.scope = { ...f.authority.scope, [field]: field === 'space' ? 'personal' : 'qa-other' } as ArchiveScope;
      await expect(f.create().recover(scope)).rejects.toMatchObject({ code: 'scope' });
      expect(f.downloads).toEqual([]);
    });
});
