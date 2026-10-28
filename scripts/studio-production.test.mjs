import {unitManagedDescriptor,unitFixturePrelude,writeUnitFixtureEpoch,assertUnitEpochClosed,renderUnitLaunchPlist,captureUnitRuntimeBoundary,assertUnitRuntimeBoundary} from './fixtures/studio-cli-unit-fixture.mjs';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { acquireOperation, assertCurrent, assertIdentifiedRuntime, assertReleaseDirectory, guardedBackup, parseExpected, readControlText, readCurrent, readRelease, releaseDirectoryIdentity, transitionRelease, withOperation } from './studio-operation-guard.mjs';
import { ADAPTIVE_RELEASE_CAPABILITIES } from './studio-adaptive-compatibility.mjs';
import { createHash,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRuntimeProcessLifecycle, readRuntimeProcessReceipt, parseRuntimeProcessReceipt, commitRuntimeProcessReceipt,
  createRuntimeHandoff, attachRuntimeProcessLifecycle, normalizeProcessObserver, parseCurrentFixtureCensusDescriptor,
  nativeCurrentFixtureCensus } from './studio-production.mjs';
import { FILE_RUNTIME_OWNER_GUARD, FILE_RUNTIME_OWNER_MARKER, FILE_RUNTIME_OWNER_MARKER_BYTES } from './studio-file-runtime-owner.mjs';

const script = fileURLToPath(new URL('./studio-production.mjs', import.meta.url));
function fixture(run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vox-prepare-test-')));
  const source = join(dir, 'source.env'), destination = join(dir, 'production.env');
  const base = `STUDIO_SECRET='synthetic-only-secret-more-than-32-characters'\nSTUDIO_DATA_DIR='${join(dir, 'data')}'\n`;
  const prepare = () => spawnSync(process.execPath, [script, 'prepare', source], {
    env: { PATH: process.env.PATH, VOX_PRODUCTION_DIR: dir }, encoding: 'utf8', timeout: 10000,
  });
  try { run({ dir, source, destination, base, prepare }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('prepare imports reviewed feature settings, round trips JSON and keeps the private file mode', () => fixture(f => {
  const trust = JSON.stringify({ author: 'synthetic-public-key', note: 'quote " and slash \\n' });
  const manifest = JSON.stringify({ schemaVersion: 1, syntheticOnly: true });
  writeFileSync(f.source, f.base + `STUDIO_MAINTENANCE='1'\nSTUDIO_REMINDER_DELIVERY='1'\nSTUDIO_IMPROVEMENT_TRUST_JSON='${trust}'\nSTUDIO_ADAPTIVE_POLICY_JSON='${manifest}'\nSTUDIO_SCOPED_RELATIONSHIPS='1'\nSTUDIO_RELATIONSHIP_ROLES='owner,superadmin'\nSTUDIO_RELATIONSHIP_AGENTS='*'\nUNLISTED_SOURCE_VALUE='must-not-import'\n`);
  const result = f.prepare();
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(readFileSync(f.destination, 'utf8'));
  assert.equal(env.STUDIO_MAINTENANCE, '1');
  assert.equal(env.STUDIO_REMINDER_DELIVERY, '1');
  assert.equal(env.STUDIO_IMPROVEMENT_TRUST_JSON, trust);
  assert.equal(env.STUDIO_ADAPTIVE_POLICY_JSON, manifest);
  assert.equal(env.STUDIO_SCOPED_RELATIONSHIPS, '1');
  assert.equal(env.STUDIO_RELATIONSHIP_ROLES, 'owner,superadmin');
  assert.equal(env.STUDIO_RELATIONSHIP_AGENTS, '*');
  assert.equal(env.UNLISTED_SOURCE_VALUE, undefined);
  assert.equal(statSync(f.destination).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes('synthetic-public-key'));
}));

test('prepare imports explicit routine and rights configuration without replacing existing choices or leaking the key', () => fixture(f => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const policy = JSON.stringify({ version: 1, id: 'synthetic-fixture-only' });
  writeFileSync(f.source, f.base + `STUDIO_REQUESTED_ROUTINES='1'\nSTUDIO_RIGHTS_POLICY_JSON='${policy}'\nSTUDIO_RIGHTS_KEY_BASE64='${key}'\n`);
  const result = f.prepare();
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(readFileSync(f.destination, 'utf8'));
  assert.equal(env.STUDIO_REQUESTED_ROUTINES, '1');
  assert.equal(env.STUDIO_RIGHTS_POLICY_JSON, policy);
  assert.equal(env.STUDIO_RIGHTS_KEY_BASE64, key);
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key));
  writeFileSync(f.source, f.base + "STUDIO_REQUESTED_ROUTINES='0'\nSTUDIO_RIGHTS_POLICY_JSON='changed'\nSTUDIO_RIGHTS_KEY_BASE64='changed'\n");
  assert.equal(f.prepare().status, 0);
  assert.deepEqual(parseEnv(readFileSync(f.destination, 'utf8')), env);
}));

test('repeated prepare preserves current disabled flags, blank trust, credentials and private extensions', () => fixture(f => {
  writeFileSync(f.destination, f.base + "STUDIO_MAINTENANCE='0'\nSTUDIO_REMINDER_DELIVERY=''\nSTUDIO_IMPROVEMENT_TRUST_JSON=''\nOPENAI_API_KEY=''\nSTUDIO_RELATIONSHIPS='off'\nSTUDIO_RELATIONSHIP_ROLES='owner,superadmin'\nPRIVATE_EXTENSION='preserve-this'\n");
  writeFileSync(f.source, f.base + "STUDIO_MAINTENANCE='1'\nSTUDIO_REMINDER_DELIVERY='1'\nSTUDIO_IMPROVEMENT_TRUST_JSON='new-trust'\nOPENAI_API_KEY='synthetic-key'\nSTUDIO_RELATIONSHIPS='live'\nSTUDIO_RELATIONSHIP_ROLES='owner'\nPRIVATE_EXTENSION='overwrite-attempt'\n");
  for (let i = 0; i < 2; i++) {
    const result = f.prepare(); assert.equal(result.status, 0, result.stderr);
    const env = parseEnv(readFileSync(f.destination, 'utf8'));
    assert.equal(env.STUDIO_MAINTENANCE, '0');
    assert.equal(env.STUDIO_REMINDER_DELIVERY, '');
    assert.equal(env.STUDIO_IMPROVEMENT_TRUST_JSON, '');
    assert.equal(env.OPENAI_API_KEY, '');
    assert.equal(env.STUDIO_RELATIONSHIPS, 'off');
    assert.equal(env.STUDIO_RELATIONSHIP_ROLES, 'owner,superadmin');
    assert.equal(env.PRIVATE_EXTENSION, 'preserve-this');
    assert.equal(env.STUDIO_SECRET, 'synthetic-only-secret-more-than-32-characters');
  }
}));

test('prepare carries explicit storage selection and preserves an existing legacy selection without conversion', () => fixture(f => {
  writeFileSync(f.source, f.base + "STUDIO_ADAPTIVE_FORMAT='file-v2'\n");
  assert.equal(f.prepare().status, 0);
  assert.equal(parseEnv(readFileSync(f.destination, 'utf8')).STUDIO_ADAPTIVE_FORMAT, 'file-v2');
  assert.equal(existsSync(join(f.dir, 'data', 'adaptive.managed')), false);
  writeFileSync(f.destination, f.base + "STUDIO_ADAPTIVE_FORMAT=''\n");
  assert.equal(f.prepare().status, 0);
  assert.equal(parseEnv(readFileSync(f.destination, 'utf8')).STUDIO_ADAPTIVE_FORMAT, '');
  assert.equal(existsSync(join(f.dir, 'data', 'adaptive.managed')), false);
}));

function release(base, name, digit) {
  const path = join(base, 'releases', name);
  mkdirSync(join(path, '.next'), { recursive: true });
  const metadata = { revision: digit.repeat(40), sourceTree: 'd'.repeat(40), buildId: `build-${name}`,
    builtAt: '2026-10-20T00:00:00.000Z', ...ADAPTIVE_RELEASE_CAPABILITIES };
  writeFileSync(join(path, 'revision'), metadata.revision + '\n');
  writeFileSync(join(path, 'studio-release.json'), JSON.stringify(metadata));
  writeFileSync(join(path, '.next', 'BUILD_ID'), metadata.buildId);
  writeFileSync(join(path, 'server.js'), '// synthetic, never executed\n');
  return readRelease(path);
}
async function operationFixture(run,{nested=false}={}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'vox-operation-test-'))),base=nested?join(parent,'base'):parent;
  if(nested)mkdirSync(base,{mode:0o700});
  // The installer treats its existing releases container as private metadata.
  // Create it explicitly; recursive artifact creation otherwise inherits 0755.
  mkdirSync(join(base, 'releases'), { mode: 0o700 });
  const old = release(base, 'old', 'a'), next = release(base, 'next', 'b'), foreign = release(base, 'foreign', 'c');
  let serial = 0;
  const pointTo = path => {
    const temp = join(base, `pointer-${serial++}`);
    symlinkSync(path, temp); renameSync(temp, join(base, 'current'));
  };
  pointTo(old.path);
  const expected = { absent: false, path: old.path, revision: old.revision, buildId: old.buildId };
  const lockPath = join(base, '.studio-operation.lock');
  try { return await run({ parent,base, old, next, foreign, pointTo, expected, lockPath }); }
  finally { rmSync(parent, { recursive: true, force: true }); }
}
const deferred = () => {
  let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve };
};
function operations(f, overrides = {}) {
  const calls = []; let running = true;
  const ops = {
    running: () => running,
    stop: async () => { calls.push('stop'); running = false; },
    start: async () => { calls.push('start'); running = true; },
    compatible: async () => { calls.push('compatible'); },
    snapshot: async () => { calls.push('snapshot'); },
    pointTo: path => { calls.push(`switch:${path}`); f.pointTo(path); },
    clearCurrent: () => { calls.push('clear'); unlinkSync(join(f.base, 'current')); },
    ready: async (_, checkpoint) => { calls.push('ready'); checkpoint(); },
    ...overrides,
  };
  return { calls, ops };
}
const invokeTransition = (f, ops, options, command = 'install') =>
  withOperation(f.base, command, f.expected, (guard, baseline) => transitionRelease(guard, baseline, f.next, ops), options);

// FRO1 protected packet. Native observations below are explicitly synthetic;
// the separate Darwin packet qualifies the real production observer adapter.
const froProof = pid => [pid,1,501,pid,'9007199254740993','1793016000','1'];
function froRoot(f) { const root=join(f.base,'data');mkdirSync(root,{mode:0o700});return root; }
function froConfiguration(f) { const text='STUDIO_BOTS=0\nSTUDIO_ASSISTANT_TEXT_DELIVERY=0\n';writeFileSync(join(f.base,'production.env'),text,{mode:0o600});return createHash('sha256').update(text).digest('hex'); }

test('FRO1 lifecycle strict CAS preserves actual spawn child and terminal chain without inventing running',()=>operationFixture(async f=>{
  const root=froRoot(f), lifecycle=createRuntimeProcessLifecycle({base:f.base,release:f.old,dataRoot:root,wrapperPid:701,processProof:[froProof(701)],now:()=>123});
  const initial=lifecycle.snapshot();assert.equal(initial.value.phase,'starting');assert.equal(initial.value.childPid,null);
  assert.throws(()=>lifecycle.exited(0,null));
  const spawned=lifecycle.spawned(702);assert.equal(spawned.value.phase,'starting');assert.equal(spawned.value.previousDigest,initial.digest);
  assert.throws(()=>lifecycle.spawnFailed());assert.throws(()=>lifecycle.spawned(703));
  const terminal=lifecycle.exited(7,null);assert.equal(terminal.value.phase,'exited');assert.equal(terminal.value.holderIdentity,null);assert.equal(terminal.value.childPid,702);
  assert.throws(()=>commitRuntimeProcessReceipt(f.base,initial,{...terminal.value}));
  assert.throws(()=>lifecycle.exited(0,null));assert.deepEqual(readRuntimeProcessReceipt(f.base),terminal);
  assert.throws(()=>parseRuntimeProcessReceipt(JSON.stringify({...terminal.value,environment:'synthetic-must-refuse'})));
}));

for(const kind of ['spawn_failed','exit_no_holder','partial_holder','new_holder','wrong_operation','changed_config','remaining_group','recycled_pid','missing_terminal'])test(`FRO1 operation-bound fast startup ${kind}`,()=>operationFixture(async f=>{
  const dataRoot=froRoot(f),configurationDigest=froConfiguration(f);unlinkSync(join(f.base,'current'));
  await withOperation(f.base,'install',{absent:true},async guard=>{
    const nativeQuery=pid=>kind==='recycled_pid'?{version:1,status:'unavailable'}:{version:1,status:'absent',processGroupPids:kind==='remaining_group'&&pid===701?[703]:[]};
    const handoff=createRuntimeHandoff({base:f.base,dataRoot,guard,maintenanceRelease:f.old,nativeQuery,configurationDigest,supervisor:()=>null,portClosed:()=>true});
    await handoff.stop();handoff.acquireStopped();handoff.pointTo(f.old.path);handoff.releaseStopped();handoff.beforeStart();
    const operationDigest=createHash('sha256').update(readFileSync(join(f.base,'.studio-operation.lock','owner.json'))).digest('hex');
    if(kind!=='missing_terminal'){
      const lifecycle=createRuntimeProcessLifecycle({base:f.base,release:f.old,dataRoot,wrapperPid:701,processProof:[froProof(701)],operationDigest:kind==='wrong_operation'?'0'.repeat(64):operationDigest,now:()=>123});
      if(kind==='spawn_failed')lifecycle.spawnFailed();else{lifecycle.spawned(702);lifecycle.exited(0,null);}
    }
    if(kind==='partial_holder'||kind==='new_holder')writeFileSync(join(dataRoot,'.studio-runtime-owner-v1.lock'),kind==='partial_holder'?'{' : '{}\n',{mode:0o600});
    if(kind==='changed_config')writeFileSync(join(f.base,'production.env'),'STUDIO_BOTS=1\n',{mode:0o600});
    if(kind==='spawn_failed'||kind==='exit_no_holder'){
      await handoff.stop();handoff.assertStopped();assert.equal(handoff.snapshot().owner,null);
      assert.equal(readRuntimeProcessReceipt(f.base).value.phase,kind==='spawn_failed'?'spawn_failed':'exited');
    }else{
      const before=existsSync(join(dataRoot,'.studio-runtime-owner-v1.lock'))?readFileSync(join(dataRoot,'.studio-runtime-owner-v1.lock')):null;
      await assert.rejects(()=>handoff.stop());
      if(before)assert.deepEqual(readFileSync(join(dataRoot,'.studio-runtime-owner-v1.lock')),before);
    }
  });
}));

for(const spawnError of [false,true])test(`FRO1 real ChildProcess event adapter terminal, spawnError=${spawnError}`,{timeout:10000},()=>operationFixture(async f=>{
  const baseInfo=statSync(f.base,{bigint:true});
  const dataRoot=froRoot(f), wrapper={version:1,status:'ok',pid:process.pid,ppid:process.ppid,uid:process.getuid(),pgid:process.pid,startAbsTicks:'1',startSeconds:'1',startMicroseconds:'0',executablePath:process.execPath,cwdPath:f.base,cwdDevice:String(baseInfo.dev),cwdInode:String(baseInfo.ino),childPids:[],processGroupPids:[process.pid]};
  const lifecycle=createRuntimeProcessLifecycle({base:f.base,release:f.old,dataRoot,processProof:[[process.pid,process.ppid,process.getuid(),process.pid,'1','1','0']]});
  const child=spawn(spawnError?join(f.base,'missing-executable'):process.execPath,spawnError?[]:['-e','process.exit(7)'],{env:{},stdio:'ignore'});
  let exitCode;const adapter=attachRuntimeProcessLifecycle({child,lifecycle,query:()=>wrapper,wrapper,base:f.base,release:f.old,dataRoot,exit:code=>{exitCode=code;},log:()=>{}});
  const result=await adapter.settled;assert.equal(result.status,'terminal');assert.equal(result.phase,spawnError?'spawn_failed':'exited');
  const receipt=readRuntimeProcessReceipt(f.base);assert.equal(receipt.value.phase,result.phase);assert.equal(receipt.value.holderIdentity,null);
  assert.equal(receipt.value.childPid,spawnError?null:child.pid);assert.equal(exitCode,spawnError?1:7);
  assert.throws(()=>attachRuntimeProcessLifecycle({child:new EventEmitter(),lifecycle,wrapper,base:f.base,release:f.old,dataRoot,query:()=>wrapper}));
}));

test('FRO1 observer normalization removes only the completed exact detached self observer',()=>{
  const row={version:1,status:'ok',pid:701,ppid:700,uid:501,pgid:701,startAbsTicks:'1',startSeconds:'1',startMicroseconds:'0',executablePath:'/synthetic/node',cwdPath:'/synthetic/runtime',cwdDevice:'1',cwdInode:'1',childPids:[702,703],processGroupPids:[701,703]};
  const normalized=normalizeProcessObserver(row,701,702,701);assert.deepEqual(normalized.childPids,[703]);assert.deepEqual(normalized.processGroupPids,[701,703]);
  for(const observer of [undefined,701,704,703])assert.throws(()=>normalizeProcessObserver(row,701,observer,701));
  assert.deepEqual(normalizeProcessObserver(row,701,702,999).childPids,[702,703]);
});

test('expected baseline CLI requires a complete unambiguous present tuple or explicit initial absence', () => {
  assert.deepEqual(parseExpected(['--expect-absent'], 'install'), { absent: true });
  assert.deepEqual(parseExpected(['--expect-current', '/tmp/release', '--expect-revision', 'a'.repeat(40), '--expect-build', 'one'], 'rollback'),
    { absent: false, path: '/tmp/release', revision: 'a'.repeat(40), buildId: 'one' });
  for (const args of [[], ['--expect-absent', '--expect-build', 'one'], ['--expect-absent', '--expect-absent'],
    ['--other'], ['--expect-current'], ['--expect-current', '/tmp/x', '--expect-revision', 'short', '--expect-build', 'one']]) {
    assert.throws(() => parseExpected(args, 'install'));
  }
  assert.throws(() => parseExpected(['--expect-absent'], 'rollback'), /initial install/);
});

test('all cooperating operations and canonical aliases contend for one atomic lock', () => operationFixture(async f => {
  const entered = deferred(), finish = deferred();
  const first = withOperation(f.base, 'install', f.expected, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  const alias = join(f.base, 'alias'); symlinkSync(f.base, alias);
  for (const command of ['prepare', 'install', 'stop', 'backup', 'rollback']) {
    assert.throws(() => acquireOperation(alias, command), /operation or a stale lock/);
  }
  finish.resolve(); await first;
  assert.equal(existsSync(f.lockPath), false);
  const nextLock = acquireOperation(f.base, 'backup'); nextLock.release();
}));

test('stale expected baseline aborts before any task effects and releases only its own lock', () => operationFixture(async f => {
  let entered = false;
  await assert.rejects(withOperation(f.base, 'install', { ...f.expected, revision: 'e'.repeat(40) }, () => { entered = true; }), /explicitly expected/);
  assert.equal(entered, false); assert.equal(existsSync(f.lockPath), false);
}));

test('same-target pointer, metadata and release-directory replacement invalidate the baseline', () => operationFixture(async f => {
  let baseline = readCurrent(f.base);
  f.pointTo(f.old.path);
  assert.throws(() => assertCurrent(f.base, baseline), /baseline changed/);
  baseline = readCurrent(f.base);
  const metadata = join(f.old.path, 'studio-release.json'), replacement = `${metadata}.replacement`;
  writeFileSync(replacement, readFileSync(metadata)); renameSync(replacement, metadata);
  assert.throws(() => assertCurrent(f.base, baseline), /baseline changed/);
  baseline = readCurrent(f.base);
  const identity = releaseDirectoryIdentity(f.old.path);
  renameSync(f.old.path, `${f.old.path}.old`);
  cpSync(`${f.old.path}.old`, f.old.path, { recursive: true });
  assert.throws(() => assertCurrent(f.base, baseline), /baseline changed/);
  assert.throws(() => assertReleaseDirectory(f.old.path, identity), /replaced while copying/);
}));

test('malformed, symlinked or replaced lock owners are preserved and never auto-reclaimed', () => operationFixture(async f => {
  for (const change of ['corrupt', 'symlink', 'directory', 'extra']) {
    const lock = acquireOperation(f.base, 'install');
    const owner = join(f.lockPath, 'owner.json'), original = readFileSync(owner, 'utf8');
    if (change === 'corrupt') writeFileSync(owner, '{}');
    if (change === 'symlink') { unlinkSync(owner); symlinkSync(join(f.old.path, 'studio-release.json'), owner); }
    if (change === 'directory') {
      renameSync(f.lockPath, `${f.lockPath}.old`); mkdirSync(f.lockPath); writeFileSync(owner, original);
    }
    if (change === 'extra') writeFileSync(join(f.lockPath, 'foreign'), 'preserve');
    assert.throws(() => lock.release());
    assert.equal(existsSync(owner), true);
    assert.throws(() => acquireOperation(f.base, 'backup'), /stale lock/);
    rmSync(f.lockPath, { recursive: true }); // Explicit fixture teardown only.
    rmSync(`${f.lockPath}.old`, { recursive: true, force: true });
  }
  mkdirSync(f.lockPath); // Crash between directory acquisition and owner write.
  assert.throws(() => acquireOperation(f.base, 'install'), /stale lock/);
  assert.equal(existsSync(f.lockPath), true);
}));

test('a base alias to filesystem root is refused before lock creation', () => operationFixture(async f => {
  const alias = join(f.base, 'root-alias'); symlinkSync('/', alias);
  assert.throws(() => acquireOperation(alias, 'stop'), /filesystem root/);
}));

test('cancellation holds ownership until the active task settles, then reports cancellation and releases', () => operationFixture(async f => {
  const signals = new EventEmitter(), entered = deferred(), finish = deferred();
  let complete = false;
  const operation = withOperation(f.base, 'backup', undefined, async () => {
    entered.resolve(); await finish.promise; complete = true;
  }, { signals });
  const rejected = assert.rejects(operation, /cancelled/);
  await entered.promise; signals.emit('SIGTERM');
  assert.equal(complete, false);
  assert.throws(() => acquireOperation(f.base, 'install'), /stale lock/);
  finish.resolve(); await rejected;
  assert.equal(complete, true); assert.equal(existsSync(f.lockPath), false);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
}));

test('lock remains held through readiness and the runtime readiness callback needs no operation lock', () => operationFixture(async f => {
  const entered = deferred(), finish = deferred();
  const { ops } = operations(f, { ready: async (_, checkpoint) => {
    checkpoint(); entered.resolve(); await finish.promise; checkpoint();
  } });
  const operation = invokeTransition(f, ops);
  await entered.promise;
  assert.equal(readCurrent(f.base).release.path, f.next.path);
  assert.throws(() => acquireOperation(f.base, 'stop'), /stale lock/);
  finish.resolve(); await operation;
  assert.equal(existsSync(f.lockPath), false);
}));

test('pre-stop and immediately pre-switch fences reject a changed baseline without stopping/restarting foreign current', () => operationFixture(async f => {
  const before = operations(f, { running: () => { f.pointTo(f.foreign.path); return true; } });
  await assert.rejects(invokeTransition(f, before.ops), /baseline changed/);
  assert.deepEqual(before.calls, []);
  f.pointTo(f.old.path);
  const during = operations(f, { beforeSwitch: async () => { f.pointTo(f.foreign.path); } });
  await assert.rejects(invokeTransition(f, during.ops), /baseline changed/);
  assert.equal(during.calls.filter(x => x === 'stop').length, 1);
  assert.equal(during.calls.includes('start'), false);
  assert.equal(during.calls.some(x => x.startsWith('switch:')), false);
  assert.equal(readCurrent(f.base).release.path, f.foreign.path);
}));

test('partial stop failure has no snapshot, switch or speculative restart', () => operationFixture(async f => {
  const { ops, calls } = operations(f, { stop: async () => { calls.push('partial-stop'); throw new Error('stop not confirmed'); } });
  await assert.rejects(invokeTransition(f, ops), /stop not confirmed/);
  assert.deepEqual(calls, ['partial-stop']);
  assert.equal(readCurrent(f.base).release.path, f.old.path);
  assert.equal(existsSync(f.lockPath), false);
}));

test('install and explicit rollback keep ownership through failure recovery and restore only their baseline', () => operationFixture(async f => {
  for (const command of ['install', 'rollback']) {
    f.pointTo(f.old.path);
    const revisions = [];
    const { ops, calls } = operations(f, { ready: async (revision, checkpoint) => {
      revisions.push(revision);
      if (revision === f.next.revision) throw new Error('synthetic readiness failure');
      assert.equal(revision, f.old.revision); checkpoint();
    } });
    const stop = ops.stop;
    ops.stop = async () => {
      assert.throws(() => acquireOperation(f.base, 'prepare'), /stale lock/);
      await stop();
    };
    await assert.rejects(invokeTransition(f, ops, undefined, command), /readiness failure/);
    assert.equal(readCurrent(f.base).release.path, f.old.path);
    assert.equal(calls.filter(x => x === 'stop').length, 2);
    assert.equal(calls.filter(x => x === 'start').length, 2);
    assert.deepEqual(revisions, [f.next.revision, f.old.revision]);
    assert.equal(existsSync(f.lockPath), false);
  }
}));

test('foreign current appearing during readiness is never stopped or overwritten by install/rollback recovery', () => operationFixture(async f => {
  for (const command of ['install', 'rollback']) {
    f.pointTo(f.old.path);
    const { ops, calls } = operations(f, { ready: async (revision) => {
      assert.equal(revision, f.next.revision); f.pointTo(f.foreign.path); throw new Error('failed');
    } });
    await assert.rejects(invokeTransition(f, ops, undefined, command), /baseline changed/);
    assert.equal(calls.filter(x => x === 'stop').length, 1);
    assert.equal(calls.filter(x => x.startsWith('switch:')).length, 1);
    assert.equal(readCurrent(f.base).release.path, f.foreign.path);
  }
}));

test('foreign current appearing while candidate stops for recovery is not overwritten', () => operationFixture(async f => {
  const { ops, calls } = operations(f, { ready: async (revision, checkpoint) => {
    if (revision === f.next.revision) throw new Error('failed');
    assert.equal(revision, f.old.revision); checkpoint();
  } });
  const stop = ops.stop; let count = 0;
  ops.stop = async () => { await stop(); if (++count === 2) f.pointTo(f.foreign.path); };
  await assert.rejects(invokeTransition(f, ops), /baseline changed/);
  assert.equal(calls.filter(x => x.startsWith('switch:')).length, 1);
  assert.equal(readCurrent(f.base).release.path, f.foreign.path);
}));

test('handled cancellation during readiness performs guarded recovery before releasing', () => operationFixture(async f => {
  const signals = new EventEmitter();
  const revisions = [];
  const { ops, calls } = operations(f, { ready: async (revision, checkpoint) => {
    revisions.push(revision);
    if (revision === f.next.revision) signals.emit('SIGINT');
    else assert.equal(revision, f.old.revision);
    assert.throws(() => acquireOperation(f.base, 'backup'), /stale lock/);
    checkpoint();
  } });
  await assert.rejects(invokeTransition(f, ops, { signals }), /cancelled/);
  assert.equal(readCurrent(f.base).release.path, f.old.path);
  assert.equal(calls.filter(x => x === 'stop').length, 2);
  assert.deepEqual(revisions, [f.next.revision, f.old.revision]);
  assert.equal(existsSync(f.lockPath), false);
}));

test('backup failure restores an unchanged stopped runtime, but never restarts a foreign baseline', () => operationFixture(async f => {
  const stable = operations(f, { snapshot: async () => { throw new Error('snapshot failed'); } });
  await assert.rejects(withOperation(f.base, 'backup', undefined, guard => guardedBackup(guard, stable.ops)), /snapshot failed/);
  assert.equal(stable.calls.includes('start'), true);
  assert.equal(stable.calls.includes('ready'), true);
  const foreign = operations(f, { snapshot: async () => { f.pointTo(f.foreign.path); throw new Error('snapshot failed'); } });
  await assert.rejects(withOperation(f.base, 'backup', undefined, guard => guardedBackup(guard, foreign.ops)), /baseline changed/);
  assert.equal(foreign.calls.includes('start'), false);
}));

test('explicit initial absence restores absence after failed activation', () => operationFixture(async f => {
  unlinkSync(join(f.base, 'current'));
  const { ops } = operations(f, { running: () => false, ready: async revision => {
    assert.equal(revision, f.next.revision); throw new Error('failed');
  } });
  await assert.rejects(withOperation(f.base, 'install', { absent: true },
    (guard, baseline) => transitionRelease(guard, baseline, f.next, ops)), /failed/);
  assert.deepEqual(readCurrent(f.base), { absent: true });
}));

test('an absent baseline never authorizes stopping an unidentified loaded service', () => operationFixture(async f => {
  unlinkSync(join(f.base, 'current'));
  const { ops, calls } = operations(f);
  await assert.rejects(withOperation(f.base, 'install', { absent: true },
    (guard, baseline) => transitionRelease(guard, baseline, f.next, ops)), /no identified current/);
  await assert.rejects(withOperation(f.base, 'backup', undefined, guard => guardedBackup(guard, ops)), /no identified current/);
  assert.throws(() => assertIdentifiedRuntime(readCurrent(f.base), true), /no identified current/);
  assert.deepEqual(calls, []);
}));

test('rollback control records reject oversized files, symlinks and FIFOs without following or blocking', () => operationFixture(async f => {
  const control = join(f.base, 'previous');
  writeFileSync(control, 'x'.repeat(4097));
  assert.throws(() => readControlText(control), /Invalid/);
  unlinkSync(control); symlinkSync(join(f.old.path, 'revision'), control);
  assert.throws(() => readControlText(control));
  unlinkSync(control);
  assert.equal(spawnSync('mkfifo', [control], { encoding: 'utf8' }).status, 0);
  assert.throws(() => readControlText(control), /Invalid/);
}));

function syntheticNativeDescriptor(project) {
  // A unit-only executable inventory, never compiled or executed. The isolated
  // preload supplies simulated macOS observations on every supported test host.
  const bytes = Buffer.from('# SYNTHETIC FRO1 unit native observation fixture; never execute\n');
  const sha = value => createHash('sha256').update(value).digest('hex');
  writeFileSync(join(project, '.next', 'studio-process-metadata'), bytes, { mode: 0o700 });
  return { version: 1, abi: 1, available: true, platform: 'darwin', arch: 'arm64', file: 'studio-process-metadata',
    bytes: bytes.length, binarySha256: sha(bytes), sourceSha256: sha(readFileSync(join(project, 'scripts', 'native', 'studio-process-metadata-darwin.c'))),
    compilerPath: '/synthetic/unit-only-not-a-compiler', compilerSha256: sha('synthetic compiler'),
    compilerVersionSha256: sha('synthetic compiler version'), sdkVersion: '0.0', deploymentTarget: '11.0' };
}
function syntheticRows(base, release, wrapperPid, childPid) {
  const uid = process.geteuid?.() ?? process.getuid();
  return [wrapperPid, childPid].map(pid => {
    const cwd = pid === wrapperPid ? base : release.path, info = statSync(cwd, { bigint: true });
    return { version: 1, status: 'ok', pid, ppid: pid === wrapperPid ? 1 : wrapperPid, uid, pgid: wrapperPid,
      startAbsTicks: pid === wrapperPid ? '101' : '102', startSeconds: '1000', startMicroseconds: '1',
      executablePath: process.execPath, cwdPath: cwd, cwdDevice: String(info.dev), cwdInode: String(info.ino),
      childPids: pid === wrapperPid ? [childPid] : [], processGroupPids: [wrapperPid, childPid] };
  });
}
const syntheticProof = row => [row.pid, row.ppid, row.uid, row.pgid, row.startAbsTicks, row.startSeconds, row.startMicroseconds];

/** Serialized into a separate Node preload, never applied to the test runner.
 * These are explicitly simulated Darwin observations, not real host evidence.
 * File validation, operation/maintenance capabilities and receipt CAS stay real.
 */
async function syntheticMacPreload(config) {
  const { default: fs } = await import('node:fs');
  const { default: cp } = await import('node:child_process');
  const { default: os } = await import('node:os');
  const { default: net } = await import('node:net');
  const { default: http } = await import('node:http');
  const { default: https } = await import('node:https');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { syncBuiltinESMExports } = await import('node:module');
  const {assertUnitRuntimeBoundary}=await import(config.unitHelperURL);
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });
  os.homedir = () => config.home;
  const base = config.base, dataRoot = config.dataRoot, label = config.topology.label;
  const record = value => fs.appendFileSync(config.effects, value + '\n');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const readJSON = path => JSON.parse(fs.readFileSync(path, 'utf8'));
  const tuple = release => ({ revision: release.revision, sourceTree: release.sourceTree, buildId: release.buildId });
  const receiptPath = join(base, 'runtime-process-v1.json'), guardPath = join(dataRoot, '.studio-runtime-owner-v1.lock');
  const originalSync = cp.spawnSync, originalSpawn = cp.spawn;
  let api, child = null, childAlive = false;
  let loaded = !config.copiedRun && fs.existsSync(receiptPath) && readJSON(receiptPath).phase === 'running';
  let servedRevision = fs.readFileSync(join(base, 'current', 'revision'), 'utf8').trim();
  const wrapperPid = 1540000001, childPid = 1540000002, observerPid = 1900000000;
  const proof = row => [row.pid, row.ppid, row.uid, row.pgid, row.startAbsTicks, row.startSeconds, row.startMicroseconds];
  const releaseNow = () => {
    const path = fs.realpathSync(join(base, 'current')), manifest = readJSON(join(path, 'studio-release.json'));
    return { path, ...tuple(manifest) };
  };
  const nativeRow = pid => {
    const wp = config.copiedRun ? process.pid : wrapperPid;
    const ch = config.copiedRun ? child?.pid : childPid;
    const live = config.copiedRun ? childAlive : loaded;
    if (!config.copiedRun && !loaded) return { version: 1, status: 'absent', processGroupPids: [] };
    if (pid !== wp && (!live || pid !== ch)) return { version: 1, status: 'absent', processGroupPids: [] };
    const cwd = pid === wp ? base : releaseNow().path, info = fs.lstatSync(cwd, { bigint: true });
    const children = pid === wp && live ? [ch] : [];
    // The real production adapter must remove only its own exact completed
    // observer PID on a self query. The synthetic observer is never in-group.
    if (pid === process.pid) children.push(observerPid);
    return { version: 1, status: 'ok', pid, ppid: pid === wp ? config.copiedRun ? process.ppid : 1 : wp,
      uid: process.geteuid?.() ?? process.getuid(), pgid: wp,
      startAbsTicks: pid === wp ? '101' : '102', startSeconds: '1000', startMicroseconds: '1',
      executablePath: process.execPath, cwdPath: cwd, cwdDevice: String(info.dev), cwdInode: String(info.ino),
      childPids: children, processGroupPids: live ? [wp, ch] : [wp] };
  };
  const deny = () => { record('unexpected-effect'); throw new Error('unexpected synthetic subprocess or network'); };
  const boot = () => {
    const release = operationApi.readCurrent(base).release;
    const operationDigest = sha(fs.readFileSync(join(base, '.studio-operation.lock', 'owner.json')));
    const lifecycle = api.createRuntimeProcessLifecycle({ base, dataRoot, release, wrapperPid, operationDigest,
      processProof: [proof(nativeRow(wrapperPid))] });
    lifecycle.spawned(childPid);
    fs.writeFileSync(guardPath, JSON.stringify({ version: 1, kind: 'studio-file-runtime-owner', role: 'runtime',
      nonce: 'e'.repeat(64), pid: childPid, startedAt: Date.now(), release: tuple(release) }) + '\n', { mode: 0o600, flag: 'wx' });
    if (!lifecycle.observeOwner([proof(nativeRow(wrapperPid)), proof(nativeRow(childPid))])) throw new Error('synthetic owner observation failed');
    servedRevision = release.revision;
  };
  cp.spawnSync = (command, args, options) => {
    if (command === 'git' && !config.copiedRun) return originalSync(command, args, options);
    const nativePath = config.copiedRun ? join(releaseNow().path, 'studio-process-metadata') : join(config.project, '.next', 'studio-process-metadata');
    if (command === nativePath) {
      if (!options.detached || Object.keys(options.env).length || !(options.timeout > 0 && options.timeout <= 2000)) return deny();
      const row = nativeRow(Number(args[0]));
      return { status: row.status === 'ok' ? 0 : 3, stdout: Buffer.from(JSON.stringify(row)), stderr: Buffer.alloc(0), pid: observerPid };
    }
    if (!config.copiedRun && command === '/usr/sbin/lsof') return { status: loaded ? 0 : 1, stdout: loaded ? String(wrapperPid) : '', stderr: '' };
    if (!config.copiedRun && command === '/bin/launchctl') {
      record('launch:' + args[0]);
      if (args[0] === 'list') return { status: 0, stdout: loaded ? `${wrapperPid}\t0\t${label}\n` : '', stderr: '' };
      if (args[0] === 'print') return { status: loaded ? 0 : 113, stdout: loaded ?
        `gui/${process.getuid()}/${label} = {\npath = ${config.topology.plist}\nprogram = ${process.execPath}\npid = ${wrapperPid}\narguments = {\n${process.execPath}\n--import\n${config.topology.preload}\n${join(base, 'current', 'studio-runtime.mjs')}\nrun\n}\n}\n` : '', stderr: loaded?'':`Could not find service "${label}" in domain for gui: ${process.getuid()}` };
      if (args[0] === 'bootout') {
        const old = api.readRuntimeProcessReceipt(base);
        api.commitRuntimeProcessReceipt(base, old, { ...old.value, phase: 'exited', revision: old.value.revision + 1,
          previousDigest: old.digest, endedAt: Date.now(), exitCode: 0 });
        loaded = false;
      } else if (args[0] === 'bootstrap') { loaded = true; boot(); }
      else return deny();
      return { status: 0, stdout: '', stderr: '' };
    }
    return deny();
  };
  cp.spawn = config.copiedRun ? (...args) => {
    assertUnitRuntimeBoundary({base,dataRoot,current:operationApi.readCurrent(base),expected:config.expectedRuntime});
    const [command,argv,options]=args,expected=['--import',config.topology.preload,config.expectedRuntime.server.path];
    if(command!==process.execPath||JSON.stringify(argv)!==JSON.stringify(expected)||options?.cwd!==config.expectedRuntime.server.cwd||options.shell||options.env?.ANTHROPIC_API_KEY!=='mi1-synthetic-no-provider-credential'||child)return deny();
    child = originalSpawn(...args); childAlive = true;
    child.once('exit', () => { childAlive = false; });
    child.once('error', () => { childAlive = false; });
    return child;
  } : deny;
  net.createConnection = deny; net.connect = deny; http.request = deny; https.request = deny;
  globalThis.fetch = async (url,init) => {
    if (config.copiedRun) return deny();
    record('fetch-stub');
    if (url===`https://api.telegram.org/bot${config.managerToken}/getMe`) return Response.json({ ok: true, result: { username: config.managerUsername } });
    if (url===`https://api.telegram.org/bot${config.managerToken}/getWebhookInfo`) return Response.json({ ok: true, result: {} });
    if (url === 'https://api.anthropic.com/v1/models?limit=100'&&init?.headers?.['x-api-key']==='mi1-synthetic-no-provider-credential') return Response.json({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }] });
    if (url === `http://127.0.0.1:${config.topology.port}/api/studio/health`) {
      record('health:' + servedRevision);
      if (config.mode === 'foreign') { const tmp = join(base, 'foreign-pointer'); fs.symlinkSync(config.foreignPath, tmp); fs.renameSync(tmp, join(base, 'current')); }
      if (config.mode === 'release-failure') fs.writeFileSync(join(base, '.studio-operation.lock', 'unexpected'), 'preserve');
      if (config.mode === 'cancel' && servedRevision === config.revision) process.emit('SIGTERM');
      return Response.json({ status: 'healthy', bots: true, revision: servedRevision });
    }
    return deny();
  };
  syncBuiltinESMExports();
  const operationApi = await import(config.operationURL);
  if (!config.copiedRun) {
    // Import the same unchanged implementation at its original path so its CLI
    // guard cannot run recursively; the copied CLI uses byte-identical exports.
    api = await import(config.apiURL);
  } else assertUnitRuntimeBoundary({base,dataRoot,current:operationApi.readCurrent(base),expected:config.expectedRuntime});
}

/** Real CLI/controller wiring under synthetic files and simulated macOS process
 * observations. Only the copied-run check spawns a real harmless Node child;
 * no Darwin helper, launchctl, listener or provider is actually queried. */
function installerFixture(run,{mode:fixtureMode='healthy'}={}) {
  return operationFixture(async f => {
    const project = join(f.base, 'source'), home = join(f.base, 'home'), effects = join(f.base, 'effects');
    mkdirSync(join(project, 'scripts'), { recursive: true }); mkdirSync(home);
    for (const file of ['studio-production.mjs', 'studio-operation-guard.mjs', 'studio-adaptive-compatibility.mjs', 'studio-file-runtime-owner.mjs', 'studio-memory-account-operation.mjs', 'studio-memory-account-time.mjs']) {
      cpSync(join(dirname(script), file), join(project, 'scripts', file));
      assert.deepEqual(readFileSync(join(project, 'scripts', file)), readFileSync(join(dirname(script), file)));
    }
    mkdirSync(join(project, 'scripts', 'native'));
    cpSync(new URL('./native/studio-process-metadata-darwin.c', import.meta.url), join(project, 'scripts', 'native', 'studio-process-metadata-darwin.c'));
    writeFileSync(join(project, '.gitignore'), '.next/\n');
    mkdirSync(join(project, 'public')); writeFileSync(join(project, 'public', 'fixture.txt'), 'synthetic');
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.test', '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'synthetic installer fixture');
    const revision = git('rev-parse', 'HEAD');
    mkdirSync(join(project, '.next', 'standalone', '.next'), { recursive: true });
    mkdirSync(join(project, '.next', 'static'));
    const metadata = { revision, sourceTree: git('rev-parse', 'HEAD^{tree}'), buildId: 'fixture-build',
      builtAt: '2026-10-20T00:00:00.000Z', ...ADAPTIVE_RELEASE_CAPABILITIES,
      syntheticOnly: true, runtimeProcessMetadata: syntheticNativeDescriptor(project),memoryAccountManagedRuntime:unitManagedDescriptor(project) };
    writeFileSync(join(project, '.next', 'standalone', 'server.js'), 'console.log("SYNTHETIC_RUNTIME_READY");\n');
    for (const dir of [join(project, '.next'), join(project, '.next', 'standalone', '.next')]) {
      writeFileSync(join(dir, 'BUILD_ID'), metadata.buildId);
    }
    writeFileSync(join(project, '.next', 'studio-release.json'), JSON.stringify(metadata));
    const dataRoot=join(f.parent,'data'),fixtureId=randomUUID(),secret=name=>createHash('sha256').update(`mi1-synthetic-${name}:${fixtureId}`).digest('hex'),managerUsername=`mi1_${fixtureId.replaceAll('-','').slice(0,20)}_bot`;
    mkdirSync(dataRoot, { mode: 0o700 });
    mkdirSync(join(dataRoot, 'adaptive'), { mode: 0o700 });
    writeFileSync(join(dataRoot, 'adaptive', FILE_RUNTIME_OWNER_MARKER), FILE_RUNTIME_OWNER_MARKER_BYTES, { mode: 0o600 });
    writeFileSync(join(f.base, 'production.env'), `STUDIO_SECRET='${secret('secret')}'\nVOXX_BOT_TOKEN='900000000:${secret('manager').slice(0,32)}'\nVOXX_BOT_USERNAME='${managerUsername}'\nSTUDIO_SUPERADMIN_IDS='900000002'\nSTUDIO_WEBAPP_URL='https://mi1.invalid/studio'\nANTHROPIC_API_KEY='mi1-synthetic-no-provider-credential'\nSTUDIO_BOTS='1'\nSTUDIO_DATA_DIR='${dataRoot}'\n`, { mode: 0o600 });
    const wrapperPid = 1540000001, childPid = 1540000002;
    for (const path of [f.base, join(f.base, 'releases'), dataRoot]) {
      const info = statSync(path);
      assert.equal(realpathSync(path), path, 'fixture metadata directory must be canonical');
      assert.equal(info.uid, process.geteuid?.() ?? process.getuid(), 'fixture metadata directory must be owned by the test UID');
      assert.equal(info.mode & 0o077, 0, 'fixture metadata directory must be private');
    }
    const initialRows = syntheticRows(f.base, f.old, wrapperPid, childPid);
    const initial = createRuntimeProcessLifecycle({ base: f.base, dataRoot, release: f.old, wrapperPid, processProof: [syntheticProof(initialRows[0])] });
    initial.spawned(childPid);
    writeFileSync(join(dataRoot, FILE_RUNTIME_OWNER_GUARD), JSON.stringify({ version: 1, kind: 'studio-file-runtime-owner', role: 'runtime',
      nonce: 'e'.repeat(64), pid: childPid, startedAt: Date.now(), release: { revision: f.old.revision, sourceTree: f.old.sourceTree, buildId: f.old.buildId } }) + '\n', { mode: 0o600, flag: 'wx' });
    assert.equal(initial.observeOwner(initialRows.map(syntheticProof)), true);
    const preload = join(f.parent, 'mi1-fixture-preload-v1.mjs'),topology={parent:f.parent,base:f.base,dataRoot,fixtureId,label:`io.ludaxis.vox-studio.fixture.${fixtureId}`,port:49152+(parseInt(fixtureId.slice(0,4),16)%16384),preload,plist:join(f.parent,'launch-agents',`io.ludaxis.vox-studio.fixture.${fixtureId}.plist`)};
    const preloadConfig = { base: f.base,dataRoot,topology,managerUsername,managerToken:`900000000:${secret('manager').slice(0,32)}`, home, effects, project, revision, foreignPath: f.foreign.path,mode:fixtureMode,
      unitHelperURL:new URL('./fixtures/studio-cli-unit-fixture.mjs',import.meta.url).href,apiURL: new URL('./studio-production.mjs', import.meta.url).href, operationURL: new URL('./studio-operation-guard.mjs', import.meta.url).href };
    const makePreload=c=>unitFixturePrelude({parent:f.parent,ownerPath:join(project,'scripts','studio-file-runtime-owner.mjs')})+`await (${syntheticMacPreload.toString()})(${JSON.stringify(c)});\n`;
    writeUnitFixtureEpoch({parent:f.parent,release:f.old,helpersDirectory:join(project,'scripts'),fixtureId,preloadText:makePreload(preloadConfig)});
    renderUnitLaunchPlist({topology,controllerPath:join(project,'scripts','studio-production.mjs'),epoch:'old'});
    function invoke(command, { mode = fixtureMode, flags,inheritedKey } = {}) {
      assert.equal(mode,fixtureMode,'unit mode fixed before child starts');
      return spawnSync(process.execPath, ['--import', preload, join(project, 'scripts', 'studio-production.mjs'), command,
        ...(flags ?? (['install', 'rollback'].includes(command) ? ['--expect-current', f.old.path,
          '--expect-revision', f.old.revision, '--expect-build', f.old.buildId] : []))],
      { cwd: project, env: { PATH: process.env.PATH, VOX_PRODUCTION_DIR: f.base,...(inheritedKey?{ANTHROPIC_API_KEY:inheritedKey}:{}) }, encoding: 'utf8', timeout: 10000 });
    }
    async function prepareCopiedRun() {
      const lock=acquireOperation(f.base,'backup');
      let current;
      try {
      current = readCurrent(f.base).release;const rows = syntheticRows(f.base, current, wrapperPid, childPid);
      let loaded = true;
      const guard = { base: lock.base, operationIdentity: lock, assertOwned: lock.assertOwned };
      const handoff = createRuntimeHandoff({ base: f.base, dataRoot, guard, maintenanceRelease: current,
        configurationDigest: createHash('sha256').update(readFileSync(join(f.base, 'production.env'))).digest('hex'),
        nativeQuery: pid => loaded ? rows.find(row => row.pid === pid) : { version: 1, status: 'absent', processGroupPids: [] },
        supervisor: () => loaded ? wrapperPid : null, portClosed: () => !loaded, launchBinding: () => true,
        stopSupervisor: () => {
          const old = readRuntimeProcessReceipt(f.base);
          commitRuntimeProcessReceipt(f.base, old, { ...old.value, phase: 'exited', revision: old.value.revision + 1,
            previousDigest: old.digest, endedAt: Date.now(), exitCode: 0 }); loaded = false;
        } });
      await handoff.stop(); handoff.acquireStopped(); handoff.releaseStopped(); handoff.beforeStart();
      } finally { lock.release(); }
      assertUnitEpochClosed({parent:f.parent,base:f.base,dataRoot});
      assert.equal(readCurrent(f.base).release.path,current.path);
      const snapshot={current:readCurrent(f.base),configuration:readFileSync(join(f.base,'production.env')),root:releaseDirectoryIdentity(dataRoot)},expectedRuntime=captureUnitRuntimeBoundary({base:f.base,dataRoot,current:readCurrent(f.base)});
      writeUnitFixtureEpoch({parent:f.parent,release:current,helpersDirectory:join(project,'scripts'),fixtureId,preloadText:makePreload({...preloadConfig,copiedRun:true,expectedRuntime}),refresh:true});
      renderUnitLaunchPlist({topology,controllerPath:join(current.path,'studio-runtime.mjs'),epoch:'new'});
      assert.deepEqual(readCurrent(f.base),snapshot.current);assert.deepEqual(readFileSync(join(f.base,'production.env')),snapshot.configuration);assert.deepEqual(releaseDirectoryIdentity(dataRoot),snapshot.root);
      assertUnitEpochClosed({parent:f.parent,base:f.base,dataRoot});
      return {preload,expectedRuntime,assertCaptured:()=>assertUnitRuntimeBoundary({base:f.base,dataRoot,current:readCurrent(f.base),expected:expectedRuntime})};
    }
    await run({ ...f, project, home, effects, revision, invoke, prepareCopiedRun,topology,dataRoot });
  },{nested:true});
}

// These are artificial portable metadata fixtures; all provider/native/service
// observations are denied or explicitly simulated, never real qualification.
for(const key of ['', 'not-a-real-synthetic-provider-key'])test(`fixture install rejects configured provider key ${key?'foreign':'empty'} before metadata or stop`,()=>installerFixture(async f=>{
  const path=join(f.base,'production.env'),text=readFileSync(path,'utf8').replace("ANTHROPIC_API_KEY='mi1-synthetic-no-provider-credential'",`ANTHROPIC_API_KEY='${key}'`);writeFileSync(path,text);
  const before=readCurrent(f.base),result=f.invoke('install');assert.equal(result.status,1);assert.match(result.stderr,/fixture_credential_unqualified/);assert.equal(existsSync(f.effects),false);assert.deepEqual(readCurrent(f.base),before);assert.equal(readFileSync(path,'utf8'),text);assert.equal(existsSync(f.lockPath),false);
}));
test('fixture install refuses an extra provider credential before metadata or stop',()=>installerFixture(async f=>{
  const path=join(f.base,'production.env'),text=readFileSync(path,'utf8')+"OPENAI_API_KEY='synthetic-forbidden-extra'\n";writeFileSync(path,text);const before=readCurrent(f.base),result=f.invoke('install');assert.equal(result.status,1);assert.match(result.stderr,/fixture_environment_unqualified/);assert.equal(existsSync(f.effects),false);assert.deepEqual(readCurrent(f.base),before);assert.equal(readFileSync(path,'utf8'),text);assert.equal(existsSync(f.lockPath),false);
}));
test('fixture install never imports inherited provider credential into configured metadata request',()=>installerFixture(async f=>{
  const before=readFileSync(join(f.base,'production.env')),result=f.invoke('install',{inheritedKey:'synthetic-inherited-must-not-authorize'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Installed revision/);assert.deepEqual(readFileSync(join(f.base,'production.env')),before);assert.equal(readCurrent(f.base).release.revision,f.revision);assert.equal(readFileSync(f.effects,'utf8').includes('unexpected-effect'),false);
}));
for(const mutation of ['receipt','preload','source-build'])test(`fixture topology ${mutation} change refuses before provider or stop`,()=>installerFixture(async f=>{
  if(mutation==='receipt'){const path=join(f.parent,'mi1-synthetic-supervisor-v1.json'),v=JSON.parse(readFileSync(path,'utf8'));writeFileSync(path,JSON.stringify({...v,fixtureReceiptDigest:'0'.repeat(64)})+'\n');}
  if(mutation==='preload')writeFileSync(f.topology.preload,readFileSync(f.topology.preload,'utf8')+'\n// changed fixture bytes\n');
  if(mutation==='source-build')writeFileSync(join(f.parent,'baseline-source','.next','BUILD_ID'),'foreign-build');
  const before=readCurrent(f.base),result=f.invoke('install');assert.equal(result.status,1);assert.match(result.stderr,/unavailable/);assert.equal(existsSync(f.effects),false);assert.deepEqual(readCurrent(f.base),before);assert.equal(existsSync(f.lockPath),false);
}));
test('fixture epoch refresh refuses live operation or recovery witnesses without changing inputs',()=>installerFixture(async f=>{
  const receipt=join(f.parent,'file-runtime-owner-fixture-v1.json'),before=readFileSync(receipt),guard=acquireOperation(f.base,'backup');
  try{assert.throws(()=>assertUnitEpochClosed({parent:f.parent,base:f.base,dataRoot:f.dataRoot}),/still owned or witnessed/);assert.deepEqual(readFileSync(receipt),before);guard.assertOwned();}finally{guard.release();}
  // Original fake running holder is deliberately still present and must refuse.
  assert.throws(()=>assertUnitEpochClosed({parent:f.parent,base:f.base,dataRoot:f.dataRoot}),/still owned or witnessed/);assert.deepEqual(readFileSync(receipt),before);assert.equal(existsSync(f.effects),false);
}));

test('unit epoch publication preserves exact inputs on an actual operation guard or recovery witness',()=>{
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'vox-unit-epoch-negative-'))),base=join(parent,'base'),dataRoot=join(parent,'data'),helpersDirectory=dirname(script),release={revision:'a'.repeat(40),sourceTree:'b'.repeat(40),buildId:'synthetic-unit-epoch'};
  try{
    const topology=writeUnitFixtureEpoch({parent,release,helpersDirectory,preloadText:'// inert unit input; never loaded\n'}),paths=[join(parent,'file-runtime-owner-fixture-v1.json'),join(parent,'mi1-synthetic-supervisor-v1.json'),topology.preload],before=paths.map(path=>readFileSync(path));
    const unchanged=()=>paths.forEach((path,i)=>assert.deepEqual(readFileSync(path),before[i]));
    const guard=acquireOperation(base,'backup');try{assert.throws(()=>writeUnitFixtureEpoch({parent,release,helpersDirectory,fixtureId:topology.fixtureId,preloadText:'// must not replace\n',refresh:true}),/still owned or witnessed/);guard.assertOwned();unchanged();}finally{guard.release();}
    for(const name of ['runtime-process-v1.json','runtime-owner-recovery-v1.json','memory-account-initialization-v1.json']){
      const path=join(base,name);writeFileSync(path,'{}\n',{mode:0o600});assert.throws(()=>writeUnitFixtureEpoch({parent,release,helpersDirectory,fixtureId:topology.fixtureId,preloadText:'// must not replace\n',refresh:true}),/still owned or witnessed/);unchanged();unlinkSync(path);
    }
    const temporary=join(base,'.memory-account-initialization-v1.unknown.tmp');writeFileSync(temporary,'{}\n',{mode:0o600});assert.throws(()=>assertUnitEpochClosed({parent,base,dataRoot}),/unknown MI1 temporary/);unchanged();
  }finally{rmSync(parent,{recursive:true,force:true});}
});

test('actual CLI mutators fail on an existing lock before any provider, port or launchctl operation', () => installerFixture(async f => {
  const lock = acquireOperation(f.base, 'install');
  try {
    for (const command of ['prepare', 'install', 'stop', 'backup', 'rollback']) {
      const result = f.invoke(command);
      assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /stale lock/);
    }
    assert.equal(existsSync(f.effects), false);
  } finally { lock.release(); }
}));

test('actual CLI stale expected baseline has no configuration, provider or service effects', () => installerFixture(async f => {
  const result = f.invoke('install', { flags: ['--expect-current', f.old.path, '--expect-revision', 'e'.repeat(40), '--expect-build', f.old.buildId] });
  assert.equal(result.status, 1); assert.match(result.stderr, /explicitly expected/);
  assert.equal(existsSync(f.effects), false); assert.equal(existsSync(f.lockPath), false);
}));

test('actual synthetic install packages its helper and copied run boots a harmless fixture while the operation lock is held', () => installerFixture(async f => {
  const result = f.invoke('install');
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Installed revision/);
  const current = readCurrent(f.base);
  assert.equal(current.release.revision, f.revision);
  assert.equal(readFileSync(join(current.release.path, 'studio-operation-guard.mjs'), 'utf8'),
    readFileSync(join(dirname(script), 'studio-operation-guard.mjs'), 'utf8'));
  assert.deepEqual(readFileSync(join(current.release.path, 'studio-file-runtime-owner.mjs')),
    readFileSync(join(dirname(script), 'studio-file-runtime-owner.mjs')));
  assert.deepEqual(readFileSync(join(current.release.path, 'studio-process-metadata')),
    readFileSync(join(f.project, '.next', 'studio-process-metadata')));
  const prepared = await f.prepareCopiedRun(),runtimePreload=prepared.preload;
  const lock = acquireOperation(f.base, 'install');
  try {
    prepared.assertCaptured();
    const runtime = spawnSync(process.execPath, ['--import', runtimePreload, join(current.release.path, 'studio-runtime.mjs'), 'run'], {
      cwd: f.base, detached: true,
      env: { PATH: dirname(process.execPath), VOX_PRODUCTION_DIR: f.base }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(runtime.status, 0, runtime.stderr);
    assert.match(runtime.stdout, /SYNTHETIC_RUNTIME_READY/);
    lock.assertOwned();
  } finally { lock.release(); }
}));

for(const mutation of ['current','configuration','root'])test(`copied run refuses ${mutation} replacement in the closed-gap before final guard`,()=>installerFixture(async f=>{
  const installed=f.invoke('install');assert.equal(installed.status,0,installed.stderr);const prepared=await f.prepareCopiedRun();
  if(mutation==='current')f.pointTo(f.foreign.path);
  if(mutation==='configuration')writeFileSync(join(f.base,'production.env'),readFileSync(join(f.base,'production.env'),'utf8')+'\n');
  if(mutation==='root'){renameSync(f.dataRoot,join(f.parent,'known-old-data'));mkdirSync(f.dataRoot,{mode:0o700});}
  const guard=acquireOperation(f.base,'install');try{
    assert.throws(prepared.assertCaptured,/unit captured (?:current|configuration|root) changed/);
    const runtime=spawnSync(process.execPath,['--import',prepared.preload,join(prepared.expectedRuntime.current.release.path,'studio-runtime.mjs'),'run'],{cwd:f.base,detached:true,env:{PATH:dirname(process.execPath),VOX_PRODUCTION_DIR:f.base},encoding:'utf8',timeout:10000});
    assert.equal(runtime.status,1);assert.match(runtime.stderr,/unit captured (?:current|configuration|root) changed|FILE runtime ownership unavailable/);assert.doesNotMatch(runtime.stdout,/SYNTHETIC_RUNTIME_READY/);assert.equal(existsSync(join(f.base,'runtime-process-v1.json')),false);assert.equal(existsSync(join(f.dataRoot,FILE_RUNTIME_OWNER_GUARD)),false);guard.assertOwned();
  }finally{guard.release();}
}));

test('actual CLI never prints successful install receipt if owned lock release fails', () => installerFixture(async f => {
  const result = f.invoke('install', { mode: 'release-failure' });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout, /Installed revision/);
  assert.match(result.stderr, /unknown files/);
  assert.equal(existsSync(join(f.lockPath, 'owner.json')), true);
  assert.equal(readFileSync(join(f.lockPath, 'unexpected'), 'utf8'), 'preserve');
},{mode:'release-failure'}));

test('actual CLI cancellation waits for recovery and emits no success receipt', () => installerFixture(async f => {
  const result = f.invoke('install', { mode: 'cancel' });
  assert.equal(result.status, 143, result.stderr);
  assert.doesNotMatch(result.stdout, /Installed revision/);
  assert.equal(readCurrent(f.base).release.path, f.old.path);
  assert.equal(existsSync(f.lockPath), false);
  assert.equal(readFileSync(f.effects, 'utf8').split('\n').filter(x => x === 'launch:bootout').length, 2);
  assert.deepEqual(readFileSync(f.effects, 'utf8').split('\n').filter(x => x.startsWith('health:')),
    [`health:${f.revision}`, `health:${f.old.revision}`]);
},{mode:'cancel'}));

test('actual CLI failure after an uncooperative pointer change leaves foreign current and its service alone', () => installerFixture(async f => {
  const result = f.invoke('install', { mode: 'foreign' });
  assert.equal(result.status, 1); assert.match(result.stderr, /baseline changed/);
  assert.doesNotMatch(result.stdout, /Installed revision/);
  assert.equal(readCurrent(f.base).release.path, f.foreign.path);
  assert.equal(readFileSync(f.effects, 'utf8').split('\n').filter(x => x === 'launch:bootout').length, 1);
},{mode:'foreign'}));

test('install and rollback retain the lock through deferred restored-baseline health, including a failure before switching', () => operationFixture(async f => {
  for (const command of ['install', 'rollback']) for (const failure of ['candidate', 'snapshot']) {
    f.pointTo(f.old.path);
    const entered = deferred(), finish = deferred(); let completed = false;
    const { ops } = operations(f, {
      snapshot: async () => { if (failure === 'snapshot') throw new Error('synthetic snapshot failure'); },
      ready: async (revision, checkpoint) => {
        if (revision === f.next.revision) throw new Error('synthetic candidate failure');
        assert.equal(revision, f.old.revision); checkpoint();
        entered.resolve(); await finish.promise; checkpoint(); completed = true;
      },
    });
    const rejected = assert.rejects(invokeTransition(f, ops, undefined, command), new RegExp(`synthetic ${failure} failure`));
    await entered.promise;
    assert.equal(completed, false);
    assert.equal(readCurrent(f.base).release.path, f.old.path);
    assert.throws(() => acquireOperation(f.base, 'prepare'), /stale lock/);
    finish.resolve(); await rejected;
    assert.equal(completed, true); assert.equal(existsSync(f.lockPath), false);
  }
}));

test('cancelled recovery awaits baseline health without rethrowing cancellation from its checkpoint', () => operationFixture(async f => {
  const signals = new EventEmitter(), entered = deferred(), finish = deferred(); let healthy = false;
  const { ops } = operations(f, { ready: async (revision, checkpoint) => {
    if (revision === f.next.revision) { signals.emit('SIGTERM'); checkpoint(); return; }
    assert.equal(revision, f.old.revision); checkpoint();
    entered.resolve(); await finish.promise; checkpoint(); healthy = true;
  } });
  const rejected = assert.rejects(invokeTransition(f, ops, { signals }), /cancelled/);
  await entered.promise; signals.emit('SIGINT');
  assert.equal(healthy, false);
  assert.throws(() => acquireOperation(f.base, 'stop'), /stale lock/);
  finish.resolve(); await rejected;
  assert.equal(healthy, true); assert.equal(existsSync(f.lockPath), false);
}));

test('foreign current during restored health fails recovery without further stop or pointer changes, including cancellation', () => operationFixture(async f => {
  for (const cancelled of [false, true]) {
    f.pointTo(f.old.path);
    const signals = new EventEmitter(), entered = deferred(), finish = deferred();
    const { ops, calls } = operations(f, { ready: async (revision, checkpoint) => {
      if (revision === f.next.revision) {
        if (cancelled) { signals.emit('SIGTERM'); checkpoint(); }
        throw new Error('candidate unavailable');
      }
      assert.equal(revision, f.old.revision); checkpoint();
      entered.resolve(); await finish.promise; checkpoint();
    } });
    const rejected = assert.rejects(invokeTransition(f, ops, { signals }), error =>
      /Restored baseline readiness failed/.test(error.message) && /baseline changed/.test(error.cause?.message));
    await entered.promise;
    assert.throws(() => acquireOperation(f.base, 'rollback'), /stale lock/);
    f.pointTo(f.foreign.path); finish.resolve(); await rejected;
    assert.equal(readCurrent(f.base).release.path, f.foreign.path);
    assert.equal(calls.filter(x => x === 'stop').length, 2);
    assert.equal(calls.filter(x => x === 'start').length, 2);
    assert.equal(calls.filter(x => x.startsWith('switch:')).length, 2);
    assert.equal(existsSync(f.lockPath), false);
  }
}));

test('unhealthy restored baselines produce an explicit recovery error for transition and backup', () => operationFixture(async f => {
  for (const kind of ['install', 'backup']) {
    f.pointTo(f.old.path);
    const { ops, calls } = operations(f, { ready: async (revision, checkpoint) => {
      checkpoint();
      if (revision === f.next.revision) throw new Error('candidate unavailable');
      assert.equal(revision, f.old.revision); throw new Error('baseline unavailable');
    } });
    const operation = kind === 'install' ? invokeTransition(f, ops) :
      withOperation(f.base, 'backup', undefined, guard => guardedBackup(guard, ops));
    await assert.rejects(operation, error =>
      /Restored baseline readiness failed/.test(error.message) && error.cause?.message === 'baseline unavailable');
    assert.equal(readCurrent(f.base).release.path, f.old.path);
    assert.equal(calls.filter(x => x === 'stop').length, kind === 'install' ? 2 : 1);
    assert.equal(existsSync(f.lockPath), false);
  }
}));

test('backup holds the operation lock until restored health settles for success, snapshot failure and cancellation', () => operationFixture(async f => {
  for (const mode of ['success', 'snapshot-failure', 'cancel']) {
    const signals = new EventEmitter(), entered = deferred(), finish = deferred(); let healthy = false;
    const { ops } = operations(f, {
      snapshot: async () => { if (mode === 'snapshot-failure') throw new Error('snapshot unavailable'); },
      ready: async (revision, checkpoint) => {
        assert.equal(revision, f.old.revision); checkpoint();
        entered.resolve(); await finish.promise; checkpoint(); healthy = true;
      },
    });
    const operation = withOperation(f.base, 'backup', undefined, guard => guardedBackup(guard, ops), { signals });
    const result = mode === 'success' ? operation :
      assert.rejects(operation, mode === 'cancel' ? /cancelled/ : /snapshot unavailable/);
    await entered.promise;
    if (mode === 'cancel') signals.emit('SIGTERM');
    assert.equal(healthy, false);
    assert.throws(() => acquireOperation(f.base, 'install'), /stale lock/);
    finish.resolve(); await result;
    assert.equal(healthy, true); assert.equal(existsSync(f.lockPath), false);
  }
}));

test('backup recovery health detects foreign current without stopping or restarting it', () => operationFixture(async f => {
  const entered = deferred(), finish = deferred();
  const { ops, calls } = operations(f, { ready: async (revision, checkpoint) => {
    assert.equal(revision, f.old.revision); checkpoint();
    entered.resolve(); await finish.promise; checkpoint();
  } });
  const rejected = assert.rejects(withOperation(f.base, 'backup', undefined, guard => guardedBackup(guard, ops)), error =>
    /Restored baseline readiness failed/.test(error.message) && /baseline changed/.test(error.cause?.message));
  await entered.promise; f.pointTo(f.foreign.path); finish.resolve(); await rejected;
  assert.equal(readCurrent(f.base).release.path, f.foreign.path);
  assert.deepEqual(calls.filter(x => ['stop', 'start'].includes(x)), ['stop', 'start']);
}));

test('actual synthetic backup checks the restarted baseline revision before completing', () => installerFixture(async f => {
  const result = f.invoke('backup');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(f.effects, 'utf8').split('\n').filter(x => x.startsWith('health:')), [`health:${f.old.revision}`]);
  assert.equal(existsSync(f.lockPath), false);
}));

test('MI1 current census portable descriptor requires its exact own version and pinned ABI1 binary digest', () => {
  const hash = 'a'.repeat(64), descriptor = { version: 1, selectorVersion: 1, metadataBinarySha256: hash };
  assert.deepEqual(parseCurrentFixtureCensusDescriptor(descriptor, hash), descriptor);
  for (const value of [undefined, null, { ...descriptor, version: 2 }, { ...descriptor, selectorVersion: 0 },
    { ...descriptor, metadataBinarySha256: 'b'.repeat(64) }, { ...descriptor, available: true }]) {
    assert.throws(() => parseCurrentFixtureCensusDescriptor(value, hash));
  }
  assert.throws(() => parseCurrentFixtureCensusDescriptor(descriptor, hash.toUpperCase()));
});

test('MI1 current census portable adapter invalid deadline refuses before reading any caller path or spawning', () => {
  for (const timeout of [0, -1, 2001, 1.5, NaN, Infinity]) assert.throws(() => nativeCurrentFixtureCensus('/unread-caller-artifact', null, timeout), /native_process_deadline_invalid/);
});

/** Deterministic adapter failure model. The only native-shaped spawn is
 * intercepted before source import; no binary, service, listener or provider
 * executes. Actual Darwin cases live behind a different explicit binary gate. */
async function currentCensusAdapterModel(config) {
  const assert = (await import('node:assert/strict')).default, fs = await import('node:fs');
  const cp = (await import('node:child_process')).default, { syncBuiltinESMExports } = await import('node:module');
  const { createHash } = await import('node:crypto'), { join } = await import('node:path');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const identity = path => { const s = fs.lstatSync(path, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs) }; };
  Object.defineProperty(process, 'platform', { value: 'darwin' }); Object.defineProperty(process, 'arch', { value: 'arm64' });
  let calls = 0;
  const deny = () => { throw Error('CENSUS_MODEL_UNEXPECTED_EFFECT'); };
  cp.spawn = deny; cp.exec = deny; cp.execSync = deny; cp.execFile = deny; cp.execFileSync = deny; cp.fork = deny;
  cp.spawnSync = (file, args, options) => {
    calls++; assert.equal(file, join(config.topology.artifact, 'studio-process-metadata'));
    assert.deepEqual(args, ['--current-fixture-census-v1', process.execPath, config.topology.base, config.topology.artifact,
      binding.base.identity.dev, binding.base.identity.ino, binding.artifactIdentity.dev, binding.artifactIdentity.ino]);
    assert.deepEqual(options, { env: {}, cwd: config.topology.parent, detached: true, shell: false, timeout: 1234, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'] });
    if (config.mode === 'changed-config-after') fs.appendFileSync(join(config.topology.base, 'production.env'), 'STUDIO_BOTS=0\n');
    const expected = { uid: process.getuid(), baseDevice: binding.base.identity.dev, baseInode: binding.base.identity.ino, artifactDevice: binding.artifactIdentity.dev, artifactInode: binding.artifactIdentity.ino };
    const status = ['invalid', 'unavailable', 'changed', 'overflow'].includes(config.mode) ? config.mode : 'complete';
    const value = status === 'complete' ? { version: 1, status, ...expected, matches: [] } : { version: 1, status };
    return { status: config.mode === 'wrong-exit' ? 5 : { complete: 0, invalid: 64, unavailable: 4, changed: 5, overflow: 6 }[status],
      stdout: Buffer.from(JSON.stringify(value) + '\n'), stderr: config.mode === 'stderr' ? Buffer.from('model diagnostic') : Buffer.alloc(0),
      signal: config.mode === 'signal' ? 'SIGTERM' : null, error: config.mode === 'timeout' ? Object.assign(Error('model timeout'), { code: 'ETIMEDOUT' }) : undefined };
  };
  const net = (await import('node:net')).default, http = (await import('node:http')).default, https = (await import('node:https')).default;
  net.connect = deny; net.createConnection = deny; net.Server.prototype.listen = deny; http.request = deny; https.request = deny; globalThis.fetch = deny;
  syncBuiltinESMExports();
  const api = await import(config.apiURL), owner = await import(config.ownerURL), operations = await import(config.operationsURL);
  const t = config.topology, manifest = JSON.parse(fs.readFileSync(join(t.artifact, 'studio-release.json')));
  if (config.mode !== 'unregistered') owner.registerFileRuntimeFixture({ dataRoot: t.dataRoot, artifactRoot: t.artifact, release: config.release });
  const current = operations.readCurrent(t.base), nodePath = fs.realpathSync(process.execPath), nodeStat = fs.lstatSync(nodePath);
  const binding = { version: 1, fixtureId: t.fixtureId, fixtureReceiptDigest: sha(fs.readFileSync(join(t.parent, 'file-runtime-owner-fixture-v1.json'))), fixtureReceiptIdentity: identity(join(t.parent, 'file-runtime-owner-fixture-v1.json')),
    source: { root: t.sourceRoot, revision: manifest.revision, sourceTree: manifest.sourceTree, controllerSha256: sha(fs.readFileSync(join(t.sourceRoot, 'scripts', 'studio-production.mjs'))) },
    artifactManifestSha256: sha(fs.readFileSync(join(t.artifact, 'studio-release.json'))), base: { path: t.base, identity: identity(t.base) }, dataRoot: { path: t.dataRoot, identity: identity(t.dataRoot) }, artifactIdentity: identity(t.artifact),
    current: { digest: sha(JSON.stringify(current)), identity: current.identity }, configuration: { digest: sha(fs.readFileSync(join(t.base, 'production.env'))), identity: identity(join(t.base, 'production.env')) },
    node: { path: nodePath, bytes: nodeStat.size, sha256: sha(fs.readFileSync(nodePath)), identity: identity(nodePath) } };
  if (config.mode === 'stale-config') binding.configuration.digest = 'f'.repeat(64);
  if (config.mode === 'stale-current') binding.current.digest = 'f'.repeat(64);
  if (config.mode === 'wrong-node') binding.node.sha256 = 'f'.repeat(64);
  if (config.mode === 'extra-binding') binding.excludedPids = [];
  if (config.mode === 'missing-descriptor') { delete manifest.runtimeCurrentProcessCensus; fs.writeFileSync(join(t.artifact, 'studio-release.json'), JSON.stringify(manifest)); }
  const failures = ['unregistered', 'stale-config', 'stale-current', 'wrong-node', 'extra-binding', 'missing-descriptor', 'changed-config-after', 'wrong-exit', 'timeout', 'signal', 'stderr'];
  if (failures.includes(config.mode)) assert.throws(() => api.nativeCurrentFixtureCensus(t.artifact, binding, 1234));
  else {
    const value = api.nativeCurrentFixtureCensus(t.artifact, binding, 1234);
    assert.equal(value.status, config.mode === 'complete' ? 'complete' : config.mode);
    if (value.status === 'complete') assert.deepEqual(value.matches, []);
    else assert.equal(Object.hasOwn(value, 'matches'), false);
  }
  const preRefusal = ['unregistered', 'stale-config', 'stale-current', 'wrong-node', 'extra-binding', 'missing-descriptor'].includes(config.mode);
  assert.equal(calls, preRefusal ? 0 : 1);
  for (const name of ['runtime-process-v1.json', 'runtime-owner-recovery-v1.json', 'memory-account-initialization-v1.json', '.studio-operation.lock']) assert.equal(fs.existsSync(join(t.base, name)), false);
  assert.equal(fs.existsSync(join(t.dataRoot, '.studio-runtime-owner-v1.lock')), false);
  process.stdout.write(JSON.stringify({ evidence: 'DETERMINISTIC_ADAPTER_MODEL_NOT_KERNEL', mode: config.mode, calls }) + '\n');
}

const censusAdapterModelSkip = existsSync('/private/tmp') && realpathSync('/private/tmp') === '/private/tmp' ? false : 'UNAVAILABLE: exact private Darwin fixture path unavailable for deterministic adapter model';
for (const mode of ['complete', 'invalid', 'unavailable', 'changed', 'overflow', 'unregistered', 'stale-config', 'stale-current', 'wrong-node', 'extra-binding', 'missing-descriptor', 'changed-config-after', 'wrong-exit', 'timeout', 'signal', 'stderr']) {
  test(`MI1 current census simulated adapter ${mode}`, { skip: censusAdapterModelSkip, timeout: 10000 }, () => {
    const parent = realpathSync(mkdtempSync('/private/tmp/vox-mi1-b-'));
    try {
      const release = { revision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), buildId: 'census-unit-only' };
      const topology = writeUnitFixtureEpoch({ parent, release, helpersDirectory: dirname(script), preloadText: '// Inert provenance only; never imported.\n' });
      mkdirSync(join(topology.sourceRoot, 'scripts')); cpSync(script, join(topology.sourceRoot, 'scripts', 'studio-production.mjs'));
      writeFileSync(join(topology.base, 'production.env'), `STUDIO_DATA_DIR='${topology.dataRoot}'\n`, { mode: 0o600 });
      symlinkSync(topology.artifact, join(topology.base, 'current'));
      const binaryBytes = Buffer.from('INERT CENSUS MODEL BINARY; MUST NEVER EXECUTE\n'), binaryHash = createHash('sha256').update(binaryBytes).digest('hex');
      writeFileSync(join(topology.artifact, 'studio-process-metadata'), binaryBytes, { mode: 0o700 }); chmodSync(join(topology.artifact, 'studio-process-metadata'), 0o700);
      const manifestPath = join(topology.artifact, 'studio-release.json'), manifest = JSON.parse(readFileSync(manifestPath));
      manifest.runtimeProcessMetadata = { version: 1, abi: 1, available: true, platform: 'darwin', arch: 'arm64', file: 'studio-process-metadata', bytes: binaryBytes.length, binarySha256: binaryHash,
        sourceSha256: 'c'.repeat(64), compilerPath: '/synthetic/non-executed-compiler', compilerSha256: 'd'.repeat(64), compilerVersionSha256: 'e'.repeat(64), sdkVersion: '0.0', deploymentTarget: '11.0' };
      manifest.runtimeCurrentProcessCensus = { version: 1, selectorVersion: 1, metadataBinarySha256: binaryHash };
      writeFileSync(manifestPath, JSON.stringify(manifest) + '\n', { mode: 0o600 });
      const config = { mode, release, topology, apiURL: new URL('./studio-production.mjs', import.meta.url).href, ownerURL: new URL('./studio-file-runtime-owner.mjs', import.meta.url).href, operationsURL: new URL('./studio-operation-guard.mjs', import.meta.url).href };
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await (${currentCensusAdapterModel.toString()})(${JSON.stringify(config)});`], { cwd: parent, env: {}, timeout: 9000, maxBuffer: 8192, encoding: 'utf8' });
      assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout); assert.equal(receipt.evidence, 'DETERMINISTIC_ADAPTER_MODEL_NOT_KERNEL'); assert.equal(receipt.mode, mode);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
}
