/** Independent QA transport acceptance. All HTTP is an injected local function;
 * this exercises the real publisher -> archive transport -> Telegram client.
 * No token, user content, or request can reach a real network endpoint. */
import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from '../../telegram/client';
import { TelegramArchiveTransport } from './transport';
import { TelegramMemoryArchive } from './service';
import { archiveDigest, archiveScopeKey, archiveStateSchema, type ArchiveAuthority,
  type ArchiveRepository, type ArchiveScope, type ArchiveState } from './contracts';

const UUID = '01234567-89ab-4cde-8f01-23456789abcd';
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  // TextEncoder and the DOM/client can construct views in different realms.
  // Compare every byte and length, then independently compare content digests;
  // constructor/prototype identity is not the transport integrity criterion.
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(Array.from(actual)).toEqual(Array.from(expected));
  expect(archiveDigest(actual)).toBe(archiveDigest(expected));
}
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  });
}

function httpFixture() {
  let current = true, lostSnapshotResponse = false, wrongSnapshotReceipt = false, revokeAtGetFile = false;
  const files = new Map<string, Uint8Array>();
  const requests: Array<{ method: 'sendDocument' | 'getFile' | 'download'; filename?: string; fileId?: string; bytes?: number }> = [];
  const posted: Array<{ filename: string; fileId: string; data: Uint8Array }> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'api.telegram.org') throw new Error('QA unexpected host; no network fallback');
    if (url.pathname.endsWith('/sendDocument')) {
      expect(init?.method).toBe('POST'); expect(init?.headers).toBeUndefined();
      const form = init?.body as FormData;
      expect(form.get('chat_id')).toBe('42'); expect(form.get('disable_notification')).toBe('true');
      const attachment = form.get('document') as File;
      expect(attachment).toBeInstanceOf(Blob); expect(attachment.type).toBe('application/json');
      const data = await blobBytes(attachment), filename = attachment.name, fileId = `qa-http-file-${posted.length + 1}`;
      files.set(fileId, new Uint8Array(data)); posted.push({ filename, fileId, data });
      requests.push({ method: 'sendDocument', filename, fileId, bytes: data.byteLength });
      if (filename.startsWith('vox-snapshot-') && lostSnapshotResponse) return new Response('unreadable-success-body', { status: 200 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: posted.length,
        from: { id: 7, is_bot: true, first_name: 'Synthetic' },
        chat: { id: filename.startsWith('vox-snapshot-') && wrongSnapshotReceipt ? 43 : 42, type: 'private' },
        document: { file_id: fileId }, date: 1 } }));
    }
    if (url.pathname.endsWith('/getFile')) {
      const body = JSON.parse(String(init?.body)) as { file_id: string }, data = files.get(body.file_id);
      requests.push({ method: 'getFile', fileId: body.file_id });
      if (revokeAtGetFile) current = false;
      if (!data) throw new Error('QA missing file');
      return new Response(JSON.stringify({ ok: true, result: { file_path: `qa/${body.file_id}`, file_size: data.byteLength } }));
    }
    if (url.pathname.includes('/qa/')) {
      const fileId = url.pathname.split('/').at(-1)!, data = files.get(fileId);
      requests.push({ method: 'download', fileId });
      if (!data) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(data), { status: 200, headers: { 'content-length': String(data.byteLength) } });
    }
    throw new Error('QA unexpected method; no network fallback');
  });
  const outerGate = vi.fn(() => current);
  const bot = new TelegramBotClient('7:qa-synthetic-only', fetcher);
  const transport = new TelegramArchiveTransport(bot, outerGate);
  return { bot, fetcher, transport, requests, posted, files, outerGate,
    get current() { return current; }, set current(value: boolean) { current = value; },
    set loseSnapshot(value: boolean) { lostSnapshotResponse = value; },
    set wrongReceipt(value: boolean) { wrongSnapshotReceipt = value; },
    set revokeOnGetFile(value: boolean) { revokeAtGetFile = value; },
  };
}

async function publicationFixture() {
  const h = httpFixture(); let state: ArchiveState | null = null;
  const scope: ArchiveScope = { accountId: 'telegram-account:42', personId: 'qa-http-person',
    agentId: 'qa-http-agent', space: 'work', containerId: 'qa-private-http' };
  const authority: ArchiveAuthority = { scope, botId: 7, allowed: true, revision: 'qa-current-policy',
    expiresAt: 900_000, suppressedEventIds: [] };
  const repo: ArchiveRepository = {
    read: async () => structuredClone(state),
    isPublicationCurrent(key, claim) {
      if (!state || archiveScopeKey(key) !== archiveScopeKey(scope)) return false;
      const op = state.publication;
      if (!op || op.id !== claim.id || op.stage !== claim.stage || op.ordinal !== claim.ordinal ||
        op.authorityRevision !== claim.authorityRevision || op.sourceStateDigest !== claim.sourceStateDigest) return false;
      const original = structuredClone(state); delete original.publication; original.revision = op.sourceRevision;
      return archiveDigest(encode(original)) === claim.sourceStateDigest;
    },
    async transact(_key, mutate, beforeCommit) {
      const next = mutate(structuredClone(state)); beforeCommit(); state = archiveStateSchema.parse(structuredClone(next.state)); return next.result;
    },
  };
  const create = () => new TelegramMemoryArchive(repo, { read: async () => structuredClone(authority),
    isCurrent: snapshot => h.current && snapshot.revision === authority.revision }, h.transport,
  { now: () => 1000, snapshotPublicationEnabled: () => true });
  const expected = Array.from({ length: 8 }, (_, n) => ({ eventId: `qa-http-event-${n}`, logicalId: `qa-http-message-${n}`,
    revision: 1, occurredAt: 100 + n, receivedAt: 1000, expiresAt: 800_000, role: 'user' as const, text: `QA_HTTP_SOURCE_${n}` }));
  for (const event of expected) await create().capture(scope, event);
  await create().checkpoint(scope, { force: true });
  return { ...h, scope, expected, create,
    get state() { return structuredClone(state); },
    // Preserve accessors rather than spreading their current values.
    set loseSnapshot(value: boolean) { h.loseSnapshot = value; },
    set wrongReceipt(value: boolean) { h.wrongReceipt = value; },
    set revokeOnGetFile(value: boolean) { h.revokeOnGetFile = value; },
  };
}

describe('independent snapshot publisher through actual Telegram client and injected HTTP', () => {
  it('publishes real snapshot multipart names, verifies provider receipts/readbacks, and recovers without original files', async () => {
    const h = await publicationFixture(), original = h.state!.head, oldFiles = [...h.files.keys()];
    expect(h.posted.map(row => row.filename)).toEqual([expect.stringMatching(/^vox-events-/), expect.stringMatching(/^vox-manifest-/)]);
    expect(await h.create().compact(h.scope)).toMatchObject({ status: 'published', chunks: 1 });
    const newFiles = h.posted.slice(2);
    expect(newFiles.map(row => row.filename)).toEqual([
      expect.stringMatching(/^vox-snapshot-[0-9a-f-]{36}-0\.json$/),
      expect.stringMatching(/^vox-snapshot-[0-9a-f-]{36}-manifest\.json$/),
    ]);
    expect(newFiles.every(row => row.data.byteLength <= 128 * 1024)).toBe(true);
    expect(h.state!.snapshot!.manifest.fileId).toBe(newFiles[1].fileId);
    expect(h.state!.head).toEqual(original);
    for (const file of newFiles) {
      expect(h.requests.some(request => request.method === 'getFile' && request.fileId === file.fileId)).toBe(true);
      expect(h.requests.some(request => request.method === 'download' && request.fileId === file.fileId)).toBe(true);
    }
    for (const id of oldFiles) h.files.delete(id);
    expect((await h.create().recover(h.scope)).events).toEqual(h.expected);
    const sent = h.posted.length; expect((await h.create().compact(h.scope)).status).toBe('already_published');
    expect(h.posted).toHaveLength(sent);
  });

  it('admits each bounded chunk ordinal and manifest with exact byte round trips while preserving legacy document names', async () => {
    const h = httpFixture();
    const names = [...Array.from({ length: 16 }, (_, ordinal) => `vox-snapshot-${UUID}-${ordinal}.json`),
      `vox-snapshot-${UUID}-manifest.json`, 'vox-events-legacy-123.json', 'vox-manifest-LEGACY123.json'];
    for (const [index, filename] of names.entries()) {
      const data = encode({ ordinal: index, fixture: 'synthetic-only' });
      const file = await h.transport.upload(42, filename, data, () => true);
      expect(file.messageId).toBe(index + 1); expect(h.posted[index].filename).toBe(filename);
      expectSameBytes(h.posted[index].data, data);
      expectSameBytes(await h.transport.download(file.fileId, 128 * 1024), data);
    }
    expect(h.requests.filter(row => row.method === 'sendDocument')).toHaveLength(names.length);
    expect(h.requests.filter(row => row.method === 'getFile')).toHaveLength(names.length);
    expect(h.requests.filter(row => row.method === 'download')).toHaveLength(names.length);
  });

  it.each([
    `vox-snapshot-${UUID}-16.json`, `vox-snapshot-${UUID}-17.json`, `vox-snapshot-${UUID}-00.json`,
    `vox-snapshot-${UUID}-01.json`, `vox-snapshot-${UUID}--1.json`, `vox-snapshot-${UUID}-1.0.json`,
    `vox-snapshot-${UUID}-1e1.json`, `vox-snapshot-${UUID}-Manifest.json`, `vox-snapshot-${UUID.toUpperCase()}-0.json`,
    'vox-snapshot-arbitrary-0.json', 'vox-snapshot--manifest.json', `vox-snapshot-${UUID}/0.json`,
    `../vox-snapshot-${UUID}-0.json`, `vox-snapshot-${UUID}-0.json/../x`, `vox-snapshot-${UUID}\\0.json`,
    `vox-snapshot-${UUID.replace('-4cde-', '-1cde-')}-0.json`, `vox-snapshot-${UUID}-0.json\u0000`,
    `vox-snapshot-${UUID}-0.json\n`, `vox-snapshot-${UUID}-0.json?x=1`,
  ])('rejects malformed or out-of-range snapshot filename before POST: %s', async filename => {
    const h = httpFixture();
    await expect(h.transport.upload(42, filename, new Uint8Array([1]), () => true)).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('keeps the same 128KiB bound and checks both synchronous dispatch authorities immediately before fetch', async () => {
    const h = httpFixture(), filename = `vox-snapshot-${UUID}-0.json`;
    const atBound = httpFixture(), largest = new Uint8Array(128 * 1024);
    const accepted = await atBound.transport.upload(42, filename, largest, () => true);
    expectSameBytes(await atBound.transport.download(accepted.fileId, 128 * 1024), largest);
    await expect(h.transport.upload(42, filename, new Uint8Array(128 * 1024 + 1), () => true)).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
    const inner = vi.fn(() => { expect(h.fetcher).not.toHaveBeenCalled(); return false; });
    await expect(h.transport.upload(42, filename, new Uint8Array([1]), inner)).rejects.toThrow();
    expect(h.outerGate).toHaveBeenCalledOnce(); expect(inner).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled();
    let claimCurrent = true; const finalClaim = vi.fn(() => claimCurrent);
    h.outerGate.mockImplementationOnce(() => { claimCurrent = false; return true; });
    await expect(h.transport.upload(42, filename, new Uint8Array([1]), finalClaim)).rejects.toThrow();
    expect(finalClaim).toHaveBeenCalledOnce(); expect(h.fetcher).not.toHaveBeenCalled();
    h.current = false; inner.mockClear();
    await expect(h.transport.upload(42, filename, new Uint8Array([1]), inner)).rejects.toThrow();
    expect(inner).not.toHaveBeenCalled(); expect(h.fetcher).not.toHaveBeenCalled();
  });

  it.each(['unreadable-response', 'wrong-destination'] as const)('preserves uncertain %s from the actual client without a retry or trusted snapshot', async reason => {
    const h = await publicationFixture();
    if (reason === 'unreadable-response') h.loseSnapshot = true; else h.wrongReceipt = true;
    await expect(h.create().compact(h.scope)).rejects.toBeDefined();
    expect(h.state!.snapshot).toBeUndefined(); expect(h.state!.publication!.stage).toBe('unknown');
    expect(h.posted).toHaveLength(3);
    const count = h.fetcher.mock.calls.length;
    expect((await h.create().compact(h.scope)).status).toBe('unknown'); expect(h.fetcher).toHaveBeenCalledTimes(count);
  });

  it('withholds snapshot text and avoids the content download when authority changes at getFile', async () => {
    const h = await publicationFixture(); await h.create().compact(h.scope);
    h.revokeOnGetFile = true; const reads = h.requests.filter(row => row.method === 'download').length;
    await expect(h.create().recover(h.scope)).rejects.toBeDefined();
    expect(h.requests.filter(row => row.method === 'download')).toHaveLength(reads);
  });
});
