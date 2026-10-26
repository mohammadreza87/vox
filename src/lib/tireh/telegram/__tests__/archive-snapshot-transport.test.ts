import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from '../client';
import { TelegramArchiveTransport } from '../../memory/telegram-archive/transport';
import { TelegramMemoryArchive } from '../../memory/telegram-archive/service';
import { archiveStateSchema, type ArchiveAuthority, type ArchiveRepository, type ArchiveState } from '../../memory/telegram-archive/contracts';
import { isCurrentPublicationClaim } from '../../memory/telegram-archive/publication';

const UUID = '11111111-1111-4111-8111-111111111111';
const snapshotName = (suffix: string | number) => `vox-snapshot-${UUID}-${suffix}.json`;
const scope = { accountId: 'telegram-account:42', personId: 'p42', agentId: 'a', space: 'work' as const, containerId: 'c42' };

// jsdom's Blob has no arrayBuffer method. Only synthetic multipart bytes enter
// this reader; every HTTP route is handled by the injected function below.
const readBlob = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});
function httpFixture() {
  const files = new Map<string, Uint8Array>(), uploadedNames: string[] = [], methods: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.telegram.org');
    if (url.pathname === '/bot7:synthetic/sendDocument') {
      methods.push('sendDocument');
      const form = init!.body as FormData, file = form.get('document') as File;
      expect(form.get('chat_id')).toBe('42'); expect(form.get('disable_notification')).toBe('true');
      expect(file.type).toBe('application/json'); expect(init!.headers).toBeUndefined();
      const fileId = `synthetic-file-${uploadedNames.length + 1}`;
      files.set(fileId, await readBlob(file)); uploadedNames.push(file.name);
      return new Response(JSON.stringify({ ok: true, result: { message_id: uploadedNames.length,
        chat: { id: 42, type: 'private' }, document: { file_id: fileId } } }));
    }
    if (url.pathname === '/bot7:synthetic/getFile') {
      methods.push('getFile');
      const { file_id: fileId } = JSON.parse(String(init!.body));
      const bytes = files.get(fileId); if (!bytes) throw new Error('Synthetic file unavailable');
      return new Response(JSON.stringify({ ok: true, result: { file_path: `archive/${fileId}`, file_size: bytes.byteLength } }));
    }
    const download = /^\/file\/bot7:synthetic\/archive\/(synthetic-file-\d+)$/.exec(url.pathname);
    if (download) {
      methods.push('download');
      const bytes = files.get(download[1]); if (!bytes) throw new Error('Synthetic file unavailable');
      return new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.byteLength) } });
    }
    throw new Error('Unexpected synthetic HTTP route');
  });
  let allowed = true;
  const transport = new TelegramArchiveTransport(new TelegramBotClient('7:synthetic', fetcher), () => allowed);
  return { fetcher, files, uploadedNames, methods, transport, set allowed(value: boolean) { allowed = value; } };
}

describe('actual Telegram archive snapshot HTTP boundary', () => {
  it('publishes through the real adapter/client and recovers snapshot plus later bundles after original files disappear', async () => {
    const h = httpFixture(); let state: ArchiveState | null = null;
    const auth: ArchiveAuthority = { scope, revision: 'authority', allowed: true, botId: 7, expiresAt: 900_000, suppressedEventIds: [] };
    const repo: ArchiveRepository = { read: async () => structuredClone(state),
      isPublicationCurrent: (_scope, claim) => isCurrentPublicationClaim(state, claim),
      transact: async (_scope, mutate, beforeCommit) => {
        const next = mutate(structuredClone(state)); beforeCommit(); state = archiveStateSchema.parse(next.state); return next.result;
      } };
    const service = () => new TelegramMemoryArchive(repo, { read: async () => structuredClone(auth),
      isCurrent: current => current.revision === auth.revision }, h.transport, { now: () => 1000, snapshotPublicationEnabled: () => true });
    const source = (id: number) => ({ eventId: `e${id}`, logicalId: `l${id}`, revision: 1, occurredAt: 100 + id, receivedAt: 1000,
      expiresAt: 800_000, role: 'user' as const, text: `SYNTHETIC_HTTP_SOURCE_${id}` });
    for (let id = 1; id <= 8; id++) await service().capture(scope, source(id));
    await service().checkpoint(scope, { force: true });
    const originalFiles = [...h.files.keys()]; expect(h.uploadedNames).toHaveLength(2);
    expect(await service().compact(scope)).toEqual({ status: 'published', sequence: 1, chunks: 1 });
    expect(h.uploadedNames[2]).toMatch(/^vox-snapshot-[0-9a-f-]{36}-0\.json$/);
    expect(h.uploadedNames[3]).toMatch(/^vox-snapshot-[0-9a-f-]{36}-manifest\.json$/);
    for (const fileId of originalFiles) h.files.delete(fileId);
    expect((await service().recover(scope)).events.map(event => event.text)).toEqual(Array.from({ length: 8 }, (_, id) => source(id + 1).text));
    await service().capture(scope, source(9)); await service().checkpoint(scope, { force: true });
    expect((await service().recover(scope)).events.map(event => event.text)).toEqual(Array.from({ length: 9 }, (_, id) => source(id + 1).text));
    expect(h.uploadedNames).toHaveLength(6);
    expect(h.methods.filter(method => method === 'sendDocument')).toHaveLength(6);
    expect(h.methods.filter(method => method === 'getFile').length).toBeGreaterThanOrEqual(6);
    expect(h.methods.filter(method => method === 'download').length).toBe(h.methods.filter(method => method === 'getFile').length);
  });

  it('admits exactly the sixteen runtime chunk ordinals and manifest while retaining legacy document names', async () => {
    const h = httpFixture(), bytes = new Uint8Array([123, 125]);
    const names = [...Array.from({ length: 16 }, (_, ordinal) => snapshotName(ordinal)), snapshotName('manifest'), 'vox-events-legacy-1.json', 'vox-manifest-legacy-1.json'];
    for (const name of names) expect(await h.transport.upload(42, name, bytes, () => true)).toMatchObject({ fileId: expect.any(String) });
    expect(h.uploadedNames).toEqual(names);
  });

  it('rejects arbitrary, malformed, non-runtime and out-of-range names before an HTTP call', async () => {
    const h = httpFixture();
    for (const name of ['anything.json', '../vox-events-1.json', snapshotName(-1), snapshotName(16), snapshotName('00'), snapshotName('01'),
      snapshotName('1.0'), snapshotName('Manifest'), `${snapshotName(1)}.json`, `${snapshotName(1)}\n`, `${snapshotName(1)}\r\n`, snapshotName(1).replace('.json', '.JSON'),
      `vox-snapshot-not-a-uuid-0.json`, snapshotName(1).replace('-4111-', '-5111-'), snapshotName(1).replace('-8111-', '-7111-')]) {
      await expect(h.transport.upload(42, name, new Uint8Array([1]), () => true)).rejects.toThrow('Invalid archive document');
    }
    await expect(h.transport.upload(42, undefined as unknown as string, new Uint8Array([1]), () => true)).rejects.toThrow('Invalid archive document');
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('preserves the 128KiB ceiling and both dispatch authority checks for snapshot names', async () => {
    const h = httpFixture();
    await expect(h.transport.upload(42, snapshotName(0), new Uint8Array(128 * 1024 + 1), () => true)).rejects.toThrow('Invalid archive document');
    h.allowed = false;
    await expect(h.transport.upload(42, snapshotName(0), new Uint8Array([1]), () => true)).rejects.toThrow();
    h.allowed = true;
    await expect(h.transport.upload(42, snapshotName(0), new Uint8Array([1]), () => false)).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
    await expect(h.transport.upload(42, snapshotName(15), new Uint8Array(128 * 1024), () => true)).resolves.toMatchObject({ fileId: expect.any(String) });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
});
