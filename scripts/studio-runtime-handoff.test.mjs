/** Independent protected FRO1 operational tests. Synthetic private files only.
 * Native rows/supervisor are injected; no native/helper/provider proof is claimed.
 * Runtime holder records are explicit foreign-process fixtures, never capabilities.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireOperation, guardedBackup, readCurrent, readRelease, transitionRelease, withOperation } from './studio-operation-guard.mjs';
import { ADAPTIVE_RELEASE_CAPABILITIES } from './studio-adaptive-compatibility.mjs';
import { FILE_RUNTIME_OWNER_GUARD, FILE_RUNTIME_OWNER_MARKER, FILE_RUNTIME_OWNER_MARKER_BYTES, inspectFileRuntimeOwner } from './studio-file-runtime-owner.mjs';
import { captureRuntimeProcessTree, createRuntimeHandoff, createRuntimeProcessLifecycle, parseRuntimeRecoveryExpected,
  readRuntimeProcessReceipt, readStoppedRuntimeReceipt, recoverStoppedRuntimeOwner, snapshotProductionData } from './studio-production.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const ident = path => { const s = lstatSync(path, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs) }; };
const tuple = r => ({ revision: r.revision, sourceTree: r.sourceTree, buildId: r.buildId });
const wrapperPid = 1540000001, childPid = 1540000002;
const proofRow = r => [r.pid, r.ppid, r.uid, r.pgid, r.startAbsTicks, r.startSeconds, r.startMicroseconds];
const terminalPath = base => join(base, 'runtime-process-v1.json');
const stoppedPath = base => join(base, 'runtime-owner-recovery-v1.json');
function makeRelease(base, name, digit) {
  const path = join(base, 'releases', name); mkdirSync(join(path, '.next'), { recursive: true, mode: 0o700 });
  const r = { revision: digit.repeat(40), sourceTree: 'd'.repeat(40), buildId: `synthetic-${name}`, ...ADAPTIVE_RELEASE_CAPABILITIES };
  writeFileSync(join(path, 'revision'), r.revision + '\n', { mode: 0o600 });
  writeFileSync(join(path, 'studio-release.json'), JSON.stringify(r), { mode: 0o600 });
  writeFileSync(join(path, '.next', 'BUILD_ID'), r.buildId, { mode: 0o600 });
  writeFileSync(join(path, 'server.js'), '// synthetic; never executed\n', { mode: 0o600 });
  return readRelease(path);
}
async function fixture(run) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vox-fro1-handoff-'))), dataRoot = join(base, 'data');
  mkdirSync(join(dataRoot, 'adaptive'), { recursive: true, mode: 0o700 });
  const marker = join(dataRoot, 'adaptive', FILE_RUNTIME_OWNER_MARKER);
  writeFileSync(marker, FILE_RUNTIME_OWNER_MARKER_BYTES, { mode: 0o600 });
  const payload = Buffer.from('{"synthetic":"preserve-authority-and-tombstones"}\n');
  writeFileSync(join(dataRoot, 'synthetic-authority.json'), payload, { mode: 0o600 });
  const old = makeRelease(base, 'old', 'a'), next = makeRelease(base, 'next', 'b'), foreign = makeRelease(base, 'foreign', 'c');
  let serial = 0, loaded = null, alive = false, lifecycle = null, active = old;
  const pointTo = path => { const p = join(base, `pointer-${serial++}`); symlinkSync(path, p); renameSync(p, join(base, 'current')); };
  pointTo(old.path);
  const configuration = `STUDIO_DATA_DIR='${dataRoot}'\nSTUDIO_ASSISTANT_TEXT_INTEGRATION=''\nSTUDIO_ARCHIVE_SNAPSHOTS=''\n`;
  writeFileSync(join(base, 'production.env'), configuration, { mode: 0o600 });
  const configurationDigest = sha(configuration), calls = [];
  const row = (pid, release = active) => {
    const cwd = pid === wrapperPid ? base : release.path, i = ident(cwd);
    return { version: 1, status: 'ok', pid, ppid: pid === wrapperPid ? 1 : wrapperPid, uid: process.geteuid?.() ?? process.getuid(),
      pgid: wrapperPid, startAbsTicks: pid === wrapperPid ? '101' : '102', startSeconds: '1000', startMicroseconds: '1',
      executablePath: process.execPath, cwdPath: cwd, cwdDevice: i.dev, cwdInode: i.ino,
      childPids: pid === wrapperPid ? [childPid] : [], processGroupPids: [wrapperPid, childPid] };
  };
  const nativeQuery = pid => alive ? row(pid) : { version: 1, status: 'absent', processGroupPids: [] };
  const boot = (guard, release = readCurrent(base).release) => {
    active = release; alive = true; loaded = wrapperPid;
    const record = { version: 1, kind: 'studio-file-runtime-owner', role: 'runtime', nonce: 'e'.repeat(64), pid: childPid,
      startedAt: 1000, release: tuple(release) };
    const operationDigest = guard ? sha(readFileSync(join(base, '.studio-operation.lock', 'owner.json'))) : null;
    lifecycle = createRuntimeProcessLifecycle({ base, dataRoot, release, wrapperPid, processProof: [proofRow(row(wrapperPid))], operationDigest, now: () => 1000 });
    lifecycle.spawned(childPid);
    writeFileSync(join(dataRoot, FILE_RUNTIME_OWNER_GUARD), JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
    assert.equal(lifecycle.observeOwner([proofRow(row(wrapperPid)), proofRow(row(childPid))]), true);
    calls.push(`boot:${release.buildId}`);
  };
  const terminate = () => { lifecycle.exited(0, null); loaded = null; alive = false; calls.push('stop'); };
  const handoff = (guard, extra = {}) => createRuntimeHandoff({ base, dataRoot, guard, maintenanceRelease: next, nativeQuery,
    configurationDigest, supervisor: () => loaded, portClosed: () => !alive, stopSupervisor: terminate, launchBinding: () => true,
    pause: async () => { throw new Error('unexpected_wait'); }, ...extra });
  const expected = () => { const receipt = readRuntimeProcessReceipt(base), owner = inspectFileRuntimeOwner(dataRoot); return {
    rootIdentity: ident(dataRoot), receiptDigest: receipt.digest, holderIdentity: owner?.guardIdentity ?? null, holderDigest: owner?.digest ?? null }; };
  const recover = (guard, overrides = {}) => recoverStoppedRuntimeOwner({ base, dataRoot, guard, release: readCurrent(base).release,
    expected: expected(), nativeQuery, configurationDigest, supervisor: () => loaded, portClosed: () => !alive, ...overrides });
  const f = { base, dataRoot, marker, payload, old, next, foreign, configuration, configurationDigest, pointTo, row, nativeQuery,
    boot, terminate, handoff, recover, expected, calls, setLoaded: value => { loaded = value; }, setAlive: value => { alive = value; } };
  try { return await run(f); }
  finally { rmSync(base, { recursive: true, force: true }); }
}

test('actual controller stops, retires only captured holder, backs up permanent controls and consumes witnesses before start', () => fixture(async f => {
  f.boot();
  await withOperation(f.base, 'backup', undefined, async guard => {
    const h = f.handoff(guard), initial = inspectFileRuntimeOwner(f.dataRoot);
    await h.stop(); assert.equal(readRuntimeProcessReceipt(f.base).value.phase, 'exited');
    assert.deepEqual(inspectFileRuntimeOwner(f.dataRoot), initial);
    h.acquireStopped(); assert.equal(inspectFileRuntimeOwner(f.dataRoot).record.role, 'maintenance');
    assert.throws(() => h.beforeStart(), /maintenance_held/);
    const destination = join(f.base, 'backup'); mkdirSync(destination, { mode: 0o700 });
    snapshotProductionData(f.dataRoot, destination);
    assert.equal(existsSync(join(destination, 'data', FILE_RUNTIME_OWNER_GUARD)), false);
    assert.equal(readFileSync(join(destination, 'data', 'adaptive', FILE_RUNTIME_OWNER_MARKER), 'utf8'), FILE_RUNTIME_OWNER_MARKER_BYTES);
    assert.deepEqual(readFileSync(join(destination, 'data', 'synthetic-authority.json')), f.payload);
    h.releaseStopped(); const saved = readStoppedRuntimeReceipt(f.base);
    assert.equal(saved.value.revision, 0); assert.equal(saved.value.retiredHolderDigest, initial.digest);
    assert.equal(saved.value.configurationDigest, f.configurationDigest); assert.equal(inspectFileRuntimeOwner(f.dataRoot), null);
    h.beforeStart(); assert.equal(existsSync(stoppedPath(f.base)), false); assert.equal(existsSync(terminalPath(f.base)), false);
    assert.equal(readFileSync(f.marker, 'utf8'), FILE_RUNTIME_OWNER_MARKER_BYTES);
  });
}));

test('explicit recovery pins expected root/holder/terminal and permits a later real operation to consume stopped state', () => fixture(async f => {
  f.boot(); f.terminate(); const terminal = readRuntimeProcessReceipt(f.base);
  await withOperation(f.base, 'recover-runtime-owner', undefined, guard => {
    assert.equal(f.recover(guard).status, 'stopped_owner_retired');
    assert.equal(inspectFileRuntimeOwner(f.dataRoot), null); assert.deepEqual(readRuntimeProcessReceipt(f.base), terminal);
    assert.equal(readFileSync(f.marker, 'utf8'), FILE_RUNTIME_OWNER_MARKER_BYTES);
  });
  await withOperation(f.base, 'backup', undefined, async guard => {
    const h = f.handoff(guard); await h.stop(); h.acquireStopped(); h.releaseStopped();
    h.beforeStart(); assert.equal(readRuntimeProcessReceipt(f.base), null); assert.equal(readStoppedRuntimeReceipt(f.base), null);
  });
}));

for (const drift of ['root', 'holder', 'terminal', 'configuration', 'current', 'supervisor', 'listener', 'remaining-group', 'recycled-pid']) {
  test(`explicit recovery refuses ${drift} drift without retiring its captured holder`, () => fixture(async f => {
    f.boot(); f.terminate(); const expected = f.expected(), guardBytes = readFileSync(join(f.dataRoot, FILE_RUNTIME_OWNER_GUARD));
    await withOperation(f.base, 'recover-runtime-owner', undefined, guard => {
      const overrides = { expected };
      if (drift === 'root') overrides.expected = { ...expected, rootIdentity: { ...expected.rootIdentity, ino: '0' } };
      if (drift === 'holder') overrides.expected = { ...expected, holderDigest: '0'.repeat(64) };
      if (drift === 'terminal') overrides.expected = { ...expected, receiptDigest: '0'.repeat(64) };
      if (drift === 'configuration') overrides.configurationDigest = '0'.repeat(64);
      if (drift === 'current') overrides.release = f.foreign;
      if (drift === 'supervisor') overrides.supervisor = () => wrapperPid;
      if (drift === 'listener') overrides.portClosed = () => false;
      if (drift === 'remaining-group') overrides.nativeQuery = pid => ({ version: 1, status: 'absent', processGroupPids: pid === wrapperPid ? [childPid] : [] });
      if (drift === 'recycled-pid') overrides.nativeQuery = pid => ({ ...f.row(pid), startAbsTicks: '999' });
      assert.throws(() => f.recover(guard, overrides), /Studio runtime lifecycle unavailable/);
      assert.deepEqual(readFileSync(join(f.dataRoot, FILE_RUNTIME_OWNER_GUARD)), guardBytes);
      assert.equal(existsSync(stoppedPath(f.base)), false);
    });
  }));
}

for (const drift of ['partial-terminal', 'partial-holder', 'partial-stopped', 'new-holder', 'configuration', 'pointer', 'terminal-replacement', 'stopped-replacement']) {
  test(`saved stopped receipt refuses ${drift} before authority or start`, () => fixture(async f => {
    f.boot(); f.terminate();
    await withOperation(f.base, 'recover-runtime-owner', undefined, guard => f.recover(guard));
    const terminal = readFileSync(terminalPath(f.base)), stopped = readFileSync(stoppedPath(f.base));
    await withOperation(f.base, 'backup', undefined, async guard => {
      if (drift === 'partial-terminal') writeFileSync(terminalPath(f.base), '{', { mode: 0o600 });
      if (drift === 'partial-holder') writeFileSync(join(f.dataRoot, FILE_RUNTIME_OWNER_GUARD), '{', { mode: 0o600 });
      if (drift === 'partial-stopped') writeFileSync(stoppedPath(f.base), '{', { mode: 0o600 });
      if (drift === 'new-holder') writeFileSync(join(f.dataRoot, FILE_RUNTIME_OWNER_GUARD), JSON.stringify({ version: 1, kind: 'studio-file-runtime-owner', role: 'runtime', nonce: 'f'.repeat(64), pid: childPid, startedAt: 2000, release: tuple(f.old) }), { mode: 0o600 });
      const h = f.handoff(guard);
      if (drift === 'configuration') writeFileSync(join(f.base, 'production.env'), f.configuration + 'DRIFT=1\n', { mode: 0o600 });
      if (drift === 'pointer') f.pointTo(f.foreign.path);
      if (drift === 'terminal-replacement') { unlinkSync(terminalPath(f.base)); writeFileSync(terminalPath(f.base), terminal, { mode: 0o600 }); }
      if (drift === 'stopped-replacement') { unlinkSync(stoppedPath(f.base)); writeFileSync(stoppedPath(f.base), stopped, { mode: 0o600 }); }
      // Replacements are detected after a valid controller snapshot, below.
      if (drift.endsWith('replacement')) {
        await h.stop();
        const path = drift === 'terminal-replacement' ? terminalPath(f.base) : stoppedPath(f.base), bytes = readFileSync(path);
        unlinkSync(path); writeFileSync(path, bytes, { mode: 0o600 });
        assert.throws(() => h.acquireStopped(), /changed|invalid_stopped_receipt/);
      } else await assert.rejects(h.stop());
      assert.equal(existsSync(stoppedPath(f.base)), true); assert.equal(readFileSync(f.marker, 'utf8'), FILE_RUNTIME_OWNER_MARKER_BYTES);
    });
  }));
}

test('stopped receipt pointer successors have finite revisions and refuse before a third pointer mutation', () => fixture(async f => {
  f.boot(); f.terminate();
  await withOperation(f.base, 'recover-runtime-owner', undefined, guard => f.recover(guard));
  await withOperation(f.base, 'install', undefined, async guard => {
    const h = f.handoff(guard); await h.stop(); h.acquireStopped();
    const first = readStoppedRuntimeReceipt(f.base); h.pointTo(f.next.path);
    const second = readStoppedRuntimeReceipt(f.base); assert.equal(second.value.revision, 1); assert.equal(second.value.previousDigest, first.digest);
    h.pointTo(f.old.path); const third = readStoppedRuntimeReceipt(f.base), current = readCurrent(f.base);
    assert.equal(third.value.revision, 2); assert.equal(third.value.previousDigest, second.digest);
    assert.throws(() => h.pointTo(f.foreign.path), /rebind_refused/); assert.deepEqual(readCurrent(f.base), current);
    h.releaseStopped();
  });
}));

for (const mode of ['success', 'snapshot-failure', 'cancel']) {
  test(`real handoff backup ${mode} restores exact baseline before releasing operation lock`, () => fixture(async f => {
    f.boot(); const signals = new EventEmitter();
    const promise = withOperation(f.base, 'backup', undefined, async guard => {
      const h = f.handoff(guard);
      await guardedBackup(guard, { running: () => inspectFileRuntimeOwner(f.dataRoot)?.record.role === 'runtime', stop: h.stop,
        acquireStopped: h.acquireStopped, releaseStopped: h.releaseStopped, compatible: () => h.assertStopped(),
        snapshot: () => { h.assertStopped(); if (mode === 'snapshot-failure') throw new Error('snapshot_failure'); if (mode === 'cancel') signals.emit('SIGTERM'); },
        start: () => { h.beforeStart(); f.boot(guard); }, ready: async (revision, checkpoint) => {
          assert.equal(revision, f.old.revision); checkpoint(); assert.throws(() => acquireOperation(f.base, 'stop'), /stale lock/);
          assert.equal(readRuntimeProcessReceipt(f.base).value.phase, 'running');
        } });
    }, { signals });
    if (mode === 'success') await promise; else await assert.rejects(promise, mode === 'cancel' ? /cancelled/ : /snapshot_failure/);
    assert.equal(readCurrent(f.base).release.path, f.old.path); assert.equal(inspectFileRuntimeOwner(f.dataRoot).record.role, 'runtime');
    assert.equal(existsSync(join(f.base, '.studio-operation.lock')), false); assert.equal(existsSync(stoppedPath(f.base)), false);
  }));
}

test('real handoff candidate readiness failure rolls back through a second stopped owner epoch', () => fixture(async f => {
  f.boot(); const baseline = readCurrent(f.base);
  await assert.rejects(withOperation(f.base, 'install', undefined, async guard => {
    const h = f.handoff(guard);
    await transitionRelease(guard, baseline, f.next, { running: () => true, stop: h.stop, acquireStopped: h.acquireStopped,
      releaseStopped: h.releaseStopped, compatible: () => h.assertStopped(), snapshot: () => h.assertStopped(), pointTo: h.pointTo,
      start: () => { h.beforeStart(); f.boot(guard); }, ready: async (revision, checkpoint) => {
        checkpoint(); if (revision === f.next.revision) throw new Error('candidate_health_failure');
        assert.equal(revision, f.old.revision); assert.throws(() => acquireOperation(f.base, 'stop'), /stale lock/);
      } });
  }), /candidate_health_failure/);
  assert.equal(readCurrent(f.base).release.path, f.old.path); assert.equal(inspectFileRuntimeOwner(f.dataRoot).record.release.revision, f.old.revision);
  assert.equal(readFileSync(f.marker, 'utf8'), FILE_RUNTIME_OWNER_MARKER_BYTES);
}));

test('first marker blocks incompatible baseline recovery and leaves exact candidate stopped with recovery receipt', () => fixture(async f => {
  f.boot(); const baseline = readCurrent(f.base);
  await assert.rejects(withOperation(f.base, 'install', undefined, async guard => {
    const h = f.handoff(guard);
    await transitionRelease(guard, baseline, f.next, { running: () => true, stop: h.stop, acquireStopped: h.acquireStopped,
      releaseStopped: h.releaseStopped, compatible: r => { h.assertStopped(); if (r.revision === f.old.revision) throw new Error('prior_reader_incompatible'); },
      snapshot: () => h.assertStopped(), pointTo: h.pointTo, start: () => { h.beforeStart(); f.boot(guard); },
      ready: async (_revision, checkpoint) => { checkpoint(); throw new Error('candidate_health_failure'); } });
  }), /Baseline is incompatible/);
  assert.equal(readCurrent(f.base).release.path, f.next.path); assert.equal(inspectFileRuntimeOwner(f.dataRoot), null);
  assert.equal(readRuntimeProcessReceipt(f.base).value.phase, 'exited'); assert.ok(readStoppedRuntimeReceipt(f.base));
  assert.equal(readFileSync(f.marker, 'utf8'), FILE_RUNTIME_OWNER_MARKER_BYTES);
  assert.deepEqual(readFileSync(join(f.dataRoot, 'synthetic-authority.json')), f.payload);
}));

for (const processName of ['wrapper', 'child']) {
  test(`precise native topology refuses stable wrong ${processName} cwd vnode identity`, () => fixture(async f => {
    f.boot();
    assert.throws(() => captureRuntimeProcessTree({ base: f.base, release: f.old, wrapperPid, childPid,
      nativeQuery: pid => { const row = f.row(pid); return pid === (processName === 'wrapper' ? wrapperPid : childPid) ? { ...row, cwdInode: '0' } : row; } }),
    /managed_launch_binding|managed_process_tree|cwd|identity/);
  }));
}

test('recovery CLI expected identity is complete and rejects duplicate, unknown and conflicting holder options', () => {
  const flags = ['--expect-current', '/synthetic/release', '--expect-revision', 'a'.repeat(40), '--expect-build', 'synthetic',
    '--expect-root', '/synthetic/data', '--expect-root-dev', '1', '--expect-root-ino', '2', '--expect-root-birth', '3',
    '--expect-receipt-digest', 'd'.repeat(64), '--expect-no-holder'];
  assert.equal(parseRuntimeRecoveryExpected(flags).holderIdentity, null);
  for (const extra of [['--expect-no-holder'], ['--unknown', 'x'], ['--expect-holder-digest', 'e'.repeat(64)]]) assert.throws(() => parseRuntimeRecoveryExpected([...flags, ...extra]));
  assert.throws(() => parseRuntimeRecoveryExpected(flags.slice(0, -3)));
});
