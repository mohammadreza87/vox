/** Descriptor-only acquisition. No paths, discovery, runtime stores, or writes. */
import { close, fstat, read, type BigIntStats } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { geteuid } from 'node:process';
import { parseBoundedJson } from '../codec';
import { LIMITS } from '../contracts';
import { OFFLINE_LIMITS, OfflineError, checkCancelled, fixedStop, validDescriptor, type AcquisitionProgress, type OfflineSelectionV1 } from './contracts';

const stats = (fd: number): Promise<BigIntStats> => new Promise((resolve, reject) => {
  fstat(fd, { bigint: true }, (error, value) => error ? reject(new OfflineError('invalid_descriptor')) : resolve(value));
});
const closeFd = (fd: number): Promise<void> => new Promise((resolve, reject) => {
  close(fd, error => error ? reject(new OfflineError('reader_failed')) : resolve());
});
function readAt(fd: number, buffer: Uint8Array, length: number, position: number): Promise<number> {
  return new Promise((resolve, reject) => {
    read(fd, buffer, 0, length, position, (error, size) => error ? reject(new OfflineError('reader_failed')) : resolve(size));
  });
}
function validateStat(value: BigIntStats): void {
  if (typeof geteuid !== 'function' || typeof value.mtimeNs !== 'bigint' || typeof value.ctimeNs !== 'bigint') throw new OfflineError('unsupported_platform');
  if (!value.isFile() || value.uid !== BigInt(geteuid()) || value.nlink !== BigInt(1) ||
      ![BigInt(0o400), BigInt(0o600)].includes(value.mode & BigInt(0o7777))) throw new OfflineError('invalid_descriptor');
}
const sameObject = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
function unchanged(a: BigIntStats, b: BigIntStats): boolean {
  return sameObject(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs &&
    a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink;
}
function selection(bytes: Uint8Array): OfflineSelectionV1 {
  try {
    // Offsets enforce the selector's stricter limits without changing accepted codec.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = parseBoundedJson(text, { tokens: LIMITS.tokens - OFFLINE_LIMITS.selectionTokens, depth: LIMITS.depth - OFFLINE_LIMITS.selectionDepth });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OfflineError('invalid_selection');
    const v = value as Record<string, unknown>;
    const keys = ['schema', 'format', 'purpose', 'expectedBytes', 'expectedSha256', 'provenance'];
    if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) ||
        v.schema !== 'vox.legacy-offline-selection/1' || v.format !== 'tireh-file-state/1' ||
        v.purpose !== 'offline-deny-all-inventory' || v.provenance !== 'operator_asserted_offline_copy' ||
        !Number.isSafeInteger(v.expectedBytes) || Number(v.expectedBytes) < 1 || Number(v.expectedBytes) > OFFLINE_LIMITS.snapshotBytes ||
        typeof v.expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.expectedSha256)) throw new OfflineError('invalid_selection');
    return { schema: 'vox.legacy-offline-selection/1', format: 'tireh-file-state/1', purpose: 'offline-deny-all-inventory',
      expectedBytes: v.expectedBytes as number, expectedSha256: v.expectedSha256, provenance: 'operator_asserted_offline_copy' };
  } catch { throw new OfflineError('invalid_selection'); }
}
async function readExact(fd: number, size: number, kind: 'selection' | 'snapshot', progress: AcquisitionProgress, signal?: AbortSignal): Promise<Uint8Array> {
  const bytes = new Uint8Array(size), scratch = new Uint8Array(Math.min(size, OFFLINE_LIMITS.chunkBytes));
  let position = 0;
  try {
    while (true) {
      checkCancelled(signal);
      const counter = kind === 'selection' ? 'selectionReadCalls' : 'snapshotReadCalls';
      if (progress[counter] === OFFLINE_LIMITS.readCalls) throw new OfflineError('capacity_exceeded');
      progress[counter]++;
      const count = await readAt(fd, scratch, Math.min(scratch.length, Math.max(1, size - position)), position);
      checkCancelled(signal);
      if (kind === 'selection') progress.selectionBytesRead += count; else progress.snapshotBytesRead += count;
      if (count === 0) {
        if (kind === 'selection') progress.selectionEof = true; else progress.snapshotEof = true;
        if (position !== size) throw new OfflineError('input_truncated');
        return bytes;
      }
      if (position + count > size) throw new OfflineError('source_changed');
      bytes.set(scratch.subarray(0, count), position); position += count;
    }
  } catch (error) { bytes.fill(0); throw error; }
  finally { scratch.fill(0); }
}

/** Transfers all supplied valid descriptor numbers, including rejection paths. */
export async function acquireOfflineSnapshot(snapshotFd: number, selectionFd: number, progress: AcquisitionProgress, signal?: AbortSignal): Promise<Uint8Array> {
  const owned = new Set([snapshotFd, selectionFd].filter(validDescriptor));
  let bytes: Uint8Array | undefined, selectorBytes: Uint8Array | undefined, error: OfflineError | undefined;
  try {
    checkCancelled(signal);
    if (!validDescriptor(snapshotFd) || !validDescriptor(selectionFd) || snapshotFd === selectionFd) throw new OfflineError('invalid_descriptor');
    if (typeof geteuid !== 'function') throw new OfflineError('unsupported_platform');
    const snapshotBefore = await stats(snapshotFd), selectionBefore = await stats(selectionFd);
    validateStat(snapshotBefore); validateStat(selectionBefore);
    if (sameObject(snapshotBefore, selectionBefore)) throw new OfflineError('invalid_descriptor');
    if (selectionBefore.size < BigInt(1) || selectionBefore.size > BigInt(OFFLINE_LIMITS.selectionBytes)) throw new OfflineError('invalid_selection');
    selectorBytes = await readExact(selectionFd, Number(selectionBefore.size), 'selection', progress, signal);
    if (!unchanged(selectionBefore, await stats(selectionFd))) throw new OfflineError('source_changed');
    const selected = selection(selectorBytes);
    selectorBytes.fill(0); selectorBytes = undefined;
    if (snapshotBefore.size !== BigInt(selected.expectedBytes)) throw new OfflineError('source_changed');
    progress.acquisition = 'failed';
    bytes = await readExact(snapshotFd, selected.expectedBytes, 'snapshot', progress, signal);
    const digest = createHash('sha256').update(bytes).digest();
    const expected = Buffer.from(selected.expectedSha256, 'hex');
    const matches = timingSafeEqual(digest, expected); digest.fill(0); expected.fill(0);
    if (!unchanged(snapshotBefore, await stats(snapshotFd))) throw new OfflineError('source_changed');
    checkCancelled(signal);
    if (!matches) throw new OfflineError('integrity_mismatch');
  } catch (cause) { error = new OfflineError(fixedStop(cause, 'reader_failed')); }
  finally {
    selectorBytes?.fill(0);
    // Close before a successful byte acquisition can be admitted by the inspector.
    for (const fd of owned) {
      try { await closeFd(fd); } catch { error ??= new OfflineError('reader_failed'); }
    }
  }
  if (error || !bytes) {
    bytes?.fill(0);
    if (progress.acquisition !== 'not_started') progress.acquisition = 'failed';
    throw error ?? new OfflineError('internal_failed');
  }
  progress.acquisition = 'verified_selected_bytes';
  return bytes;
}
