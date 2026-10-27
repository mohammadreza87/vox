/** Original FILE ER1 format/time admission. Initialization belongs to managed offline migration. */
import { randomUUID, createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileRuntimeFs as fs, assertFileRuntimePath, commitFileRuntimeRename, prepareFileRuntimeTransient, openFileRuntimeDescriptor } from '../studio/file-runtime-owner';
import { MEMORY_ACCOUNT_MARKER, MEMORY_ACCOUNT_MARKER_BYTES, MEMORY_ACCOUNT_TIME, memoryAccountTimeSchema } from './memory-account-lifecycle';

function same(a: ReturnType<typeof fs.fstatSync>, b: ReturnType<typeof fs.fstatSync>): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
/** Reject links, replacement, unexpected owner/mode and noncanonical UTF-8. */
export function readMemoryAccountPrivateFile(path: string, maxBytes: number): string | null {
  const before = fs.lstatSync(path, { throwIfNoEntry: false });
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes ||
      before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o600) throw new Error('Memory account file unavailable');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const held = fs.fstatSync(fd), bytes = fs.readFileSync(fd);
    const after = fs.lstatSync(path);
    if (!same(before, held) || !same(held, fs.fstatSync(fd)) || !same(held, after) || bytes.byteLength > maxBytes || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw new Error('Memory account file changed');
    return bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
}
export function readMemoryAccountRoot(directory: string): { marked: false } | { marked: true; highWaterMs: number } {
  const key = resolve(directory), states = sequencers(), state = states.get(key);
  const marker = readMemoryAccountPrivateFile(join(directory, MEMORY_ACCOUNT_MARKER), 128);
  const time = readMemoryAccountPrivateFile(join(directory, MEMORY_ACCOUNT_TIME), 256);
  if (marker === null && time === null) {
    if (state?.marked) throw new Error('Memory account format removed');
    return { marked: false };
  }
  const parent = fs.lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Memory account root unavailable');
  if (marker !== MEMORY_ACCOUNT_MARKER_BYTES || time === null) throw new Error('Memory account format unavailable');
  const record = memoryAccountTimeSchema.parse(JSON.parse(time));
  if (time !== `${JSON.stringify(record)}\n`) throw new Error('Memory account time unavailable');
  if (state?.highWater !== undefined && record.highWaterMs < state.highWater) throw new Error('Memory account time regressed');
  const current: RootTime = state ?? { busy: false };
  current.marked = true; current.highWater = record.highWaterMs; states.set(key, current);
  return { marked: true, highWaterMs: record.highWaterMs };
}
interface RootTime { busy: boolean; marked?: boolean; highWater?: number; wall?: number; monotonic?: number; latestWall?: number; latestMonotonic?: number }
const slot = Symbol.for('vox.memory-account-root-time.v1');
function sequencers(): Map<string, RootTime> {
  const global = globalThis as typeof globalThis & { [slot]?: Map<string, RootTime> };
  return global[slot] ??= new Map();
}
function sampleMemoryAccountTime(directory: string, clock: () => number): { observed: number; monotonic: number } {
  const root = readMemoryAccountRoot(directory);
  if (!root.marked) throw new Error('Memory account migration required');
  const observed = clock(), monotonic = performance.now(), state = sequencers().get(resolve(directory));
  if (!Number.isSafeInteger(observed) || observed < root.highWaterMs || Object.is(observed, -0) ||
      state?.wall !== undefined && observed < state.wall || state?.monotonic !== undefined && monotonic < state.monotonic ||
      state?.latestWall !== undefined && observed < state.latestWall || state?.latestMonotonic !== undefined && monotonic < state.latestMonotonic ||
      state?.wall !== undefined && state.monotonic !== undefined && observed - state.wall + 1 < Math.floor(monotonic - state.monotonic)) throw new Error('Memory account clock unavailable');
  // One millisecond covers the quantization of integer UTC samples; it is not a provider-skew/readiness bound.
  return { observed, monotonic };
}
export function checkMemoryAccountTime(directory: string, clock: () => number): number {
  const sample = sampleMemoryAccountTime(directory, clock);
  const state = sequencers().get(resolve(directory))!;
  // Read observations cannot regress, but do not reset the durable sample's
  // elapsed-time anchor or repeatedly renew its one-millisecond allowance.
  state.latestWall = sample.observed; state.latestMonotonic = sample.monotonic;
  return sample.observed;
}
/** Called while holding an account lock. One nonawaiting section per actual root/realm. */
export function observeMemoryAccountTime(directory: string, clock: () => number): number {
  const key = resolve(directory), states = sequencers(), state: RootTime = states.get(key) ?? { busy: false };
  states.set(key, state);
  if (state.busy) throw new Error('Memory account time busy');
  state.busy = true;
  const path = join(directory, MEMORY_ACCOUNT_TIME), temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const owner = assertFileRuntimePath(directory);
    if (!owner) throw new Error('Memory account runtime owner required');
    const { observed, monotonic } = sampleMemoryAccountTime(directory, clock);
    const prior = readMemoryAccountPrivateFile(path, 256);
    const bytes = `${JSON.stringify({ version: 1, highWaterMs: observed })}\n`;
    prepareFileRuntimeTransient(temporary);
    const fd = openFileRuntimeDescriptor(temporary, 'wx', 0o600);
    try { fd.writeFile(bytes); fd.sync(); } finally { fd.close(); }
    commitFileRuntimeRename(temporary, path, () => {
      if (readMemoryAccountPrivateFile(path, 256) !== prior) throw new Error('Memory account time changed');
      const final = clock();
      if (!Number.isSafeInteger(final) || final < observed || Object.is(final, -0)) throw new Error('Memory account clock unavailable');
    });
    const parent = fs.openSync(directory, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    state.wall = observed; state.monotonic = monotonic;
    state.latestWall = observed; state.latestMonotonic = monotonic;
    return observed;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    finally { state.busy = false; }
  }
}
export function memoryAccountFileDigest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
