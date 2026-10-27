/** Cooperative single-host coordination. Crash-stale locks require explicit recovery. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readlinkSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { acquireFileRuntimeOperationGuard } from './studio-file-runtime-owner.mjs';

const fail = message => { throw new Error(message); };
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs) });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stat = path => lstatSync(path, { bigint: true, throwIfNoEntry: false });
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const build = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);

function regular(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) fail('Invalid release or operation metadata.');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0, bytes;
    do { bytes = readSync(fd, buffer, length, buffer.length - length, null); length += bytes; } while (bytes && length < buffer.length);
    const text = buffer.subarray(0, length).toString('utf8');
    const after = fstatSync(fd, { bigint: true }), named = stat(path);
    if (!named?.isFile() || !equal(identity(before), identity(after)) || !equal(identity(after), identity(named)) ||
        before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs || after.size !== before.size ||
        length > limit) fail('Release or operation metadata changed while reading.');
    return { text, identity: identity(after), digest: createHash('sha256').update(text).digest('hex') };
  } finally { closeSync(fd); }
}

export const readControlText = path => regular(path, 4096).text;

export function readRelease(path) {
  if (!isAbsolute(path) || realpathSync(path) !== path) fail('Release path must be its absolute resolved directory.');
  const before = stat(path);
  if (!before?.isDirectory()) fail('Invalid release directory.');
  const revision = regular(join(path, 'revision'), 128);
  const manifest = regular(join(path, 'studio-release.json'), 65536);
  const buildFile = regular(join(path, '.next', 'BUILD_ID'), 256);
  let data;
  try { data = JSON.parse(manifest.text); } catch { fail('Invalid installed release manifest.'); }
  if (!sha(revision.text.trim()) || !data || !sha(data.revision) || !sha(data.sourceTree) || !build(data.buildId) ||
      data.revision !== revision.text.trim() || data.buildId !== buildFile.text.trim()) fail('Installed release provenance is invalid.');
  const after = stat(path);
  if (!after?.isDirectory() || !equal(identity(before), identity(after))) fail('Release directory changed while reading.');
  return { path, identity: identity(after), revision: data.revision, sourceTree: data.sourceTree, buildId: data.buildId,
    files: { revision, manifest, build: buildFile } };
}

export function readCurrent(base) {
  const path = join(base, 'current'), before = stat(path);
  if (!before) return { absent: true };
  if (!before.isSymbolicLink()) fail('Current release must be a symlink.');
  const link = readlinkSync(path), target = realpathSync(path), release = readRelease(target);
  const after = stat(path);
  if (!after?.isSymbolicLink() || !equal(identity(before), identity(after)) || before.ctimeNs !== after.ctimeNs ||
      readlinkSync(path) !== link || realpathSync(path) !== target) fail('Current release changed while reading.');
  return { absent: false, link, identity: identity(after), changed: String(after.ctimeNs), release };
}

export function assertCurrent(base, baseline) {
  if (!equal(readCurrent(base), baseline)) fail('Installed baseline changed; refusing to mutate or recover another release.');
}

export function assertRelease(release) {
  if (!equal(readRelease(release.path), release)) fail('Release artifact changed during the operation.');
}

export function releaseDirectoryIdentity(path) {
  const current = stat(path);
  if (!current?.isDirectory() || realpathSync(path) !== path) fail('Release directory must be resolved and cannot be a symlink.');
  return identity(current);
}

export function assertReleaseDirectory(path, expected) {
  if (!equal(releaseDirectoryIdentity(path), expected)) fail('Owned candidate directory was replaced while copying.');
}

export function assertIdentifiedRuntime(baseline, isRunning) {
  if (baseline.absent && isRunning) fail('A loaded runtime has no identified current release; explicit reconciliation is required.');
}

export function parseExpected(args, command) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--expect-current', '--expect-revision', '--expect-build', '--expect-absent'].includes(key) || Object.hasOwn(options, key)) {
      fail('Use one explicit expected installed baseline; unknown or duplicate option.');
    }
    if (key === '--expect-absent') options[key] = true;
    else {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) fail('Expected baseline option is missing its value.');
      options[key] = args[++i];
    }
  }
  if (options['--expect-absent']) {
    if (Object.keys(options).length !== 1 || command !== 'install') fail('--expect-absent is only valid for an initial install.');
    return { absent: true };
  }
  const path = options['--expect-current'], revision = options['--expect-revision'], buildId = options['--expect-build'];
  if (!path || !isAbsolute(path) || resolve(path) !== path || !sha(revision) || !build(buildId)) {
    fail('Install/rollback requires --expect-current <resolved-path> --expect-revision <full-sha> --expect-build <build-id>.');
  }
  return { absent: false, path, revision, buildId };
}

export function matchExpected(baseline, expected) {
  if (!expected || baseline.absent !== expected.absent || !baseline.absent &&
      (baseline.release.path !== expected.path || baseline.release.revision !== expected.revision || baseline.release.buildId !== expected.buildId)) {
    fail('Installed baseline does not match the explicitly expected release.');
  }
}

export function acquireOperation(input, operation) {
  // The shared factory performs the exclusive mkdir/open and retains its owner
  // FD. No callback, borrowed FD, or cloned object can mint this identity.
  return acquireFileRuntimeOperationGuard(input, operation);
}

export async function withOperation(base, operation, expected, task, { signals = process, onCancel = () => {} } = {}) {
  const lock = acquireOperation(base, operation), controller = new AbortController();
  const cancel = signal => {
    if (!controller.signal.aborted) { controller.abort(new Error('Studio operation cancelled.')); onCancel(signal); }
  };
  const interrupt = () => cancel('SIGINT'), terminate = () => cancel('SIGTERM');
  signals.on('SIGINT', interrupt); signals.on('SIGTERM', terminate);
  const guard = { base: lock.base, operationIdentity: lock, signal: controller.signal, assertOwned: lock.assertOwned,
    check() { lock.assertOwned(); controller.signal.throwIfAborted(); } };
  try {
    // Cancellation never races the task: wait for its operation/children and recovery to settle.
    guard.check();
    const baseline = expected ? readCurrent(lock.base) : undefined;
    if (expected) matchExpected(baseline, expected);
    const result = await task(guard, baseline);
    guard.check();
    return result;
  } finally {
    try { lock.release(); }
    finally { signals.off('SIGINT', interrupt); signals.off('SIGTERM', terminate); }
  }
}

async function restoredReadiness(guard, baseline, ops) {
  // A handled cancellation must still await recovery. Never use guard.check here.
  const checkpoint = () => { guard.assertOwned(); assertCurrent(guard.base, baseline); };
  try {
    checkpoint();
    await ops.ready(baseline.release.revision, checkpoint);
    checkpoint();
  } catch (error) {
    throw new Error('Restored baseline readiness failed; explicit reconciliation is required.', { cause: error });
  }
}

/** The same transition/recovery fence serves both install and explicit rollback. */
export async function transitionRelease(guard, baseline, target, ops) {
  const checkBaseline = () => { guard.check(); assertCurrent(guard.base, baseline); assertRelease(target); };
  checkBaseline();
  const wasRunning = ops.running();
  assertIdentifiedRuntime(baseline, wasRunning);
  let stopped = false, switched = false, active;
  try {
    checkBaseline(); // Immediately before stop.
    await ops.stop(); stopped = true;
    checkBaseline();
    await ops.acquireStopped?.();
    checkBaseline();
    await ops.compatible(target);
    checkBaseline();
    await ops.snapshot();
    checkBaseline();
    await ops.beforeSwitch?.();
    checkBaseline(); // Immediately before the pointer switch, after all preparation.
    ops.pointTo(target.path); switched = true;
    active = readCurrent(guard.base);
    if (active.absent || !equal(active.release, target)) fail('Activated release does not match the owned candidate.');
    const checkActive = () => { guard.check(); assertCurrent(guard.base, active); };
    checkActive();
    await ops.afterSwitch?.();
    checkActive();
    await ops.releaseStopped?.();
    checkActive();
    await ops.start();
    checkActive();
    await ops.ready(target.revision, checkActive);
    checkActive();
  } catch (error) {
    // A failed ownership/pointer check must happen BEFORE even stopping a possibly foreign service.
    guard.assertOwned();
    if (switched) {
      if (!active || active.absent || !equal(active.release, target)) fail('Activation identity is uncertain; refusing automatic recovery.');
      assertCurrent(guard.base, active);
      await ops.stop();
      guard.assertOwned(); assertCurrent(guard.base, active);
      await ops.acquireStopped?.();
      guard.assertOwned(); assertCurrent(guard.base, active);
      if (!baseline.absent) {
        assertRelease(baseline.release);
        try { await ops.compatible(baseline.release); }
        catch (recovery) {
          await ops.releaseStopped?.();
          throw new Error('Baseline is incompatible with current stopped data; runtime remains stopped.', { cause: new AggregateError([error, recovery]) });
        }
        guard.assertOwned(); assertCurrent(guard.base, active); assertRelease(baseline.release);
        ops.pointTo(baseline.release.path);
        const restored = readCurrent(guard.base);
        if (restored.absent || !equal(restored.release, baseline.release)) fail('Restored baseline identity is uncertain.');
        if (wasRunning) {
          guard.assertOwned(); assertCurrent(guard.base, restored);
          await ops.releaseStopped?.();
          await ops.start();
          await restoredReadiness(guard, restored, ops);
        } else await ops.releaseStopped?.();
      } else {
        guard.assertOwned(); assertCurrent(guard.base, active);
        ops.clearCurrent();
        await ops.releaseStopped?.();
      }
    } else if (stopped && wasRunning) {
      guard.assertOwned(); assertCurrent(guard.base, baseline);
      await ops.acquireStopped?.();
      if (!baseline.absent) {
        try { await ops.compatible(baseline.release); }
        catch (recovery) {
          await ops.releaseStopped?.();
          throw new Error('Baseline is incompatible with current stopped data; runtime remains stopped.', { cause: new AggregateError([error, recovery]) });
        }
      }
      await ops.releaseStopped?.();
      if (!ops.running()) {
        await ops.start();
      }
      await restoredReadiness(guard, baseline, ops);
    } else if (stopped) {
      guard.assertOwned(); assertCurrent(guard.base, baseline);
      await ops.acquireStopped?.();
      await ops.releaseStopped?.();
    }
    throw error;
  }
}

export async function guardedBackup(guard, ops) {
  const baseline = readCurrent(guard.base), wasRunning = ops.running();
  assertIdentifiedRuntime(baseline, wasRunning);
  let stopped = false;
  try {
    guard.check(); assertCurrent(guard.base, baseline);
    await ops.stop(); stopped = true;
    guard.check(); assertCurrent(guard.base, baseline);
    await ops.acquireStopped?.();
    guard.check(); assertCurrent(guard.base, baseline);
    if (!baseline.absent) await ops.compatible?.(baseline.release);
    guard.check(); assertCurrent(guard.base, baseline);
    await ops.snapshot();
    guard.check(); assertCurrent(guard.base, baseline);
  } finally {
    if (stopped && wasRunning) {
      guard.assertOwned(); assertCurrent(guard.base, baseline);
      await ops.acquireStopped?.();
      try { if (!baseline.absent) await ops.compatible?.(baseline.release); }
      catch (recovery) { await ops.releaseStopped?.(); throw new Error('Stopped data is incompatible; backup recovery remains stopped.', { cause: recovery }); }
      await ops.releaseStopped?.();
      if (!ops.running()) {
        await ops.start();
      }
      await restoredReadiness(guard, baseline, ops);
    } else if (stopped) { guard.assertOwned(); assertCurrent(guard.base, baseline); await ops.acquireStopped?.(); await ops.releaseStopped?.(); }
  }
}
