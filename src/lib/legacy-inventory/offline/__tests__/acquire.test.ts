import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, chmodSync, linkSync, renameSync, truncateSync } from 'node:fs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { initialProgress } from '../contracts';

const actualRead = fs.read;
const actualStat = fs.fstat;
const native = Buffer.from('{"memories":[],"offers":[],"chats":{}}\r\n');
const selector = (bytes = native, patch: object = {}) => JSON.stringify({ schema: 'vox.legacy-offline-selection/1', format: 'tireh-file-state/1',
  purpose: 'offline-deny-all-inventory', expectedBytes: bytes.length, expectedSha256: createHash('sha256').update(bytes).digest('hex'),
  provenance: 'operator_asserted_offline_copy', ...patch });
let dir: string;
let opened: number[];
let acquireOfflineSnapshot: typeof import('../acquire')['acquireOfflineSnapshot'];
function pair(selection = selector(), bytes: Uint8Array = native) {
  const sourcePath = join(dir, 'synthetic-source.json'), selectionPath = join(dir, 'synthetic-selection.json');
  writeFileSync(sourcePath, bytes, { mode: 0o600 }); writeFileSync(selectionPath, selection, { mode: 0o600 });
  const source = openSync(sourcePath, 'r'), selectionFd = openSync(selectionPath, 'r');
  opened.push(source, selectionFd);
  return { source, selectionFd, sourcePath, selectionPath };
}
beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(fs, 'read'); vi.spyOn(fs, 'close'); vi.spyOn(fs, 'fstat'); syncBuiltinESMExports();
  ({ acquireOfflineSnapshot } = await import('../acquire'));
  dir = mkdtempSync(join(tmpdir(), 'vox-lia1-acquire-')); opened = [];
});
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  for (const fd of opened) { try { closeSync(fd); } catch { /* Acquisition normally owns cleanup. */ } }
  rmSync(dir, { recursive: true, force: true });
});
describe('LIA1 descriptor acquisition', () => {
  it('reads exact positional bytes, observes EOF, closes both and preserves input', async () => {
    const p = pair(), progress = initialProgress();
    expect(Buffer.from(await acquireOfflineSnapshot(p.source, p.selectionFd, progress))).toEqual(native);
    expect(progress).toMatchObject({ snapshotBytesRead: native.length, snapshotReadCalls: 2, snapshotEof: true, acquisition: 'verified_selected_bytes', selectionEof: true });
    expect(readFileSync(p.sourcePath)).toEqual(native);
    expect(() => fstatSync(p.source)).toThrow(); expect(() => fstatSync(p.selectionFd)).toThrow();
    expect(fs.close).toHaveBeenCalledTimes(2);
  });
  it.each([0, 1, 2, -1, 3.5, NaN, Infinity, 2147483648, '3'])('does not close invalid descriptor %s or read content', async value => {
    const p = pair(), progress = initialProgress();
    await expect(acquireOfflineSnapshot(value as number, p.selectionFd, progress)).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(fs.read).not.toHaveBeenCalled(); expect(fs.close).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fs.close).mock.calls[0][0]).toBe(p.selectionFd);
  });
  it('same-number rejection closes exactly once', async () => {
    const p = pair();
    await expect(acquireOfflineSnapshot(p.source, p.source, initialProgress())).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(fs.close).toHaveBeenCalledTimes(1); expect(fs.read).not.toHaveBeenCalled();
  });
  it('same-file object rejection closes each distinct descriptor', async () => {
    const p = pair(), alias = openSync(p.sourcePath, 'r'); opened.push(alias);
    await expect(acquireOfflineSnapshot(p.source, alias, initialProgress())).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(fs.close).toHaveBeenCalledTimes(2); expect(fs.read).not.toHaveBeenCalled();
  });
  it('rejects directory before content read', async () => {
    const p = pair(), directory = openSync(dir, 'r'); opened.push(directory);
    await expect(acquireOfflineSnapshot(directory, p.selectionFd, initialProgress())).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(fs.read).not.toHaveBeenCalled();
  });
  it.each([0o644, 0o440, 0o640, 0o700])('rejects input mode %s', async mode => {
    const p = pair(); chmodSync(p.sourcePath, mode);
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress())).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(fs.read).not.toHaveBeenCalled();
  });
  it('accepts mode0400 without changing bytes or mode', async () => {
    const p = pair(); chmodSync(p.sourcePath, 0o400);
    expect(Buffer.from(await acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress()))).toEqual(native);
    expect(readFileSync(p.sourcePath)).toEqual(native);
  });
  it('rejects multiple hard links', async () => {
    const p = pair(); linkSync(p.sourcePath, join(dir, 'synthetic-link'));
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress())).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(fs.read).not.toHaveBeenCalled();
  });
  it.each([
    '{"schema":"private_canary"}', selector(native, { extra: 'private_canary' }), selector(native, { expectedBytes: 0 }),
    selector(native, { expectedBytes: 524289 }), selector(native, { expectedSha256: 'PRIVATE_CANARY' }),
    selector(native, { format: 'studio-state/1' }), selector(native, { expectedBytes: '10' }),
    '{"schema":1,"schema":2}', '{"__proto__":{}}', '\ufeff' + selector(), ' '.repeat(4097), '',
  ])('refuses selector before source content read', async selection => {
    const p = pair(selection), progress = initialProgress();
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, progress)).rejects.toMatchObject({ code: 'invalid_selection' });
    expect(progress.snapshotReadCalls).toBe(0); expect(fs.close).toHaveBeenCalledTimes(2);
  });
  it('length and digest disagreement never admit bytes', async () => {
    const p = pair(selector(native, { expectedBytes: native.length + 1 }));
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress())).rejects.toMatchObject({ code: 'source_changed' });
    const q = pair(selector(native, { expectedSha256: '0'.repeat(64) }));
    await expect(acquireOfflineSnapshot(q.source, q.selectionFd, initialProgress())).rejects.toMatchObject({ code: 'integrity_mismatch' });
  });
  it('pre-abort still closes both transferred descriptors without reading', async () => {
    const p = pair(), controller = new AbortController(); controller.abort();
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress(), controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(fs.close).toHaveBeenCalledTimes(2); expect(fs.read).not.toHaveBeenCalled();
  });
  it('one-byte short reads reconcile actual delivered bytes', async () => {
    vi.mocked(fs.read).mockImplementation(((fd, buf, offset, _length, pos, cb) => actualRead(fd, buf, offset, 1, pos, cb)) as typeof fs.read);
    const p = pair(), progress = initialProgress();
    expect(Buffer.from(await acquireOfflineSnapshot(p.source, p.selectionFd, progress))).toEqual(native);
    expect(progress.snapshotReadCalls).toBe(native.length + 1);
  });
  it('read-call cap stops a productive synthetic short-reader', async () => {
    const bytes = Buffer.alloc(5000, 32), p = pair(selector(bytes), bytes), progress = initialProgress();
    vi.mocked(fs.read).mockImplementation(((fd, buf, offset, length, pos, cb) => actualRead(fd, buf, offset, fd === p.source ? 1 : length, pos, cb)) as typeof fs.read);
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, progress)).rejects.toMatchObject({ code: 'capacity_exceeded' });
    expect(progress.snapshotReadCalls).toBe(4096);
  });
  it('read exception canary stays inside the trusted reader boundary', async () => {
    const p = pair(); vi.mocked(fs.read).mockImplementationOnce(((_fd, _b, _o, _l, _p, callback) => callback(new Error('PRIVATE_CANARY'))) as typeof fs.read);
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress())).rejects.toMatchObject({ message: 'reader_failed' });
  });
  it('cleanup failure prevents successful byte admission', async () => {
    const p = pair(); vi.mocked(fs.close).mockImplementationOnce(((_fd, cb) => cb(new Error('PRIVATE_CANARY'))) as typeof fs.close);
    const progress = initialProgress();
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, progress)).rejects.toMatchObject({ code: 'reader_failed' });
    expect(progress.acquisition).toBe('failed'); expect(fs.close).toHaveBeenCalledTimes(2);
  });
  it.each(['grow', 'truncate', 'rewrite', 'mode'])('detects source %s after descriptor read', async change => {
    const p = pair(); let changed = false;
    vi.mocked(fs.read).mockImplementation(((fd, buf, offset, length, pos, callback) => {
      actualRead(fd, buf, offset, length, pos, (error, count, result) => {
        if (fd === p.source && !changed && count > 0) {
          changed = true;
          if (change === 'grow') writeFileSync(p.sourcePath, Buffer.concat([native, Buffer.from(' ')]));
          if (change === 'truncate') truncateSync(p.sourcePath, 0);
          if (change === 'rewrite') writeFileSync(p.sourcePath, Buffer.alloc(native.length, 32));
          if (change === 'mode') chmodSync(p.sourcePath, 0o644);
        }
        callback(error, count, result);
      });
    }) as typeof fs.read);
    const progress = initialProgress();
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, progress)).rejects.toMatchObject({ code: 'source_changed' });
    expect(changed).toBe(true); expect(progress.acquisition).toBe('failed'); expect(fs.close).toHaveBeenCalledTimes(2);
  });
  it('selected path replacement never redirects the pinned descriptor', async () => {
    const p = pair(); let replaced = false;
    vi.mocked(fs.read).mockImplementation(((fd, buf, offset, length, pos, callback) => {
      actualRead(fd, buf, offset, length, pos, (error, count, result) => {
        if (fd === p.selectionFd && !replaced && count > 0) {
          replaced = true; renameSync(p.sourcePath, join(dir, 'pinned-original.json'));
          writeFileSync(p.sourcePath, 'PRIVATE_REPLACEMENT', { mode: 0o600 });
        }
        callback(error, count, result);
      });
    }) as typeof fs.read);
    try { expect(Buffer.from(await acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress()))).toEqual(native); }
    catch (error) { expect(error).toMatchObject({ code: 'source_changed' }); }
    expect(readFileSync(p.sourcePath, 'utf8')).toBe('PRIVATE_REPLACEMENT');
  });
  it('cancellation after read delivers no acquisition and still closes', async () => {
    const p = pair(), controller = new AbortController();
    vi.mocked(fs.read).mockImplementation(((fd, buf, offset, length, pos, callback) => {
      actualRead(fd, buf, offset, length, pos, (error, count, result) => {
        if (fd === p.source) controller.abort(); callback(error, count, result);
      });
    }) as typeof fs.read);
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress(), controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(fs.close).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['selection', 'positive'], ['selection', 'eof'], ['snapshot', 'positive'], ['snapshot', 'eof'],
  ] as const)('accounts observed successful %s %s before cancellation drops the plan', async (kind, phase) => {
    const p = pair(), controller = new AbortController(), target = kind === 'selection' ? p.selectionFd : p.source;
    const expectedBytes = kind === 'selection' ? readFileSync(p.selectionPath).length : native.length;
    let interrupted = false;
    vi.mocked(fs.read).mockImplementation(((fd, buf, offset, length, pos, callback) => {
      actualRead(fd, buf, offset, length, pos, (error, count, result) => {
        if (!error && fd === target && (phase === 'positive' ? count > 0 : count === 0)) {
          interrupted = true; controller.abort();
        }
        callback(error, count, result);
      });
    }) as typeof fs.read);
    const { inspectOfflineTirehSnapshot } = await import('../inspect');
    const result = await inspectOfflineTirehSnapshot(p.source, p.selectionFd, { signal: controller.signal });
    expect(interrupted).toBe(true); expect(result.stop).toBe('cancelled'); expect(result.rows).toEqual([]);
    expect(result.counts.consumedUnits).toBe(0); expect(result.counts.inventoriedUnits).toBe(0);
    expect(result.acquisition[kind === 'selection' ? 'selectionBytesRead' : 'snapshotBytesRead']).toBe(expectedBytes);
    expect(result.acquisition[kind === 'selection' ? 'selectionEof' : 'snapshotEof']).toBe(phase === 'eof');
    expect(fs.close).toHaveBeenCalledTimes(2);
    expect(readFileSync(p.sourcePath)).toEqual(native);
  });
  it.each(['uid', 'time'])('rejects invalid %s metadata before content read', async field => {
    const p = pair();
    vi.mocked(fs.fstat).mockImplementation(((fd, options, callback) => actualStat(fd, options, (error, stat) => {
      if (error) return callback(error);
      const modified = Object.assign(Object.create(Object.getPrototypeOf(stat)), stat,
        field === 'uid' ? { uid: stat.uid + BigInt(1) } : { mtimeNs: undefined });
      callback(null, modified);
    })) as typeof fs.fstat);
    await expect(acquireOfflineSnapshot(p.source, p.selectionFd, initialProgress())).rejects.toMatchObject({ code: field === 'uid' ? 'invalid_descriptor' : 'unsupported_platform' });
    expect(fs.read).not.toHaveBeenCalled();
  });
});
