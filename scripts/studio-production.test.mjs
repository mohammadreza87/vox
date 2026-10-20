import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { acquireOperation, assertCurrent, assertIdentifiedRuntime, assertReleaseDirectory, guardedBackup, parseExpected, readControlText, readCurrent, readRelease, releaseDirectoryIdentity, transitionRelease, withOperation } from './studio-operation-guard.mjs';
import { ADAPTIVE_RELEASE_CAPABILITIES } from './studio-adaptive-compatibility.mjs';

const script = fileURLToPath(new URL('./studio-production.mjs', import.meta.url));
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-prepare-test-'));
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
async function operationFixture(run) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vox-operation-test-')));
  const old = release(base, 'old', 'a'), next = release(base, 'next', 'b'), foreign = release(base, 'foreign', 'c');
  let serial = 0;
  const pointTo = path => {
    const temp = join(base, `pointer-${serial++}`);
    symlinkSync(path, temp); renameSync(temp, join(base, 'current'));
  };
  pointTo(old.path);
  const expected = { absent: false, path: old.path, revision: old.revision, buildId: old.buildId };
  const lockPath = join(base, '.studio-operation.lock');
  try { return await run({ base, old, next, foreign, pointTo, expected, lockPath }); }
  finally { rmSync(base, { recursive: true, force: true }); }
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

/** Real CLI wiring under a synthetic root. launchctl, sockets and providers are
 * intercepted before module imports; no real Studio process or provider runs. */
function installerFixture(run) {
  return operationFixture(async f => {
    const project = join(f.base, 'source'), home = join(f.base, 'home'), effects = join(f.base, 'effects');
    mkdirSync(join(project, 'scripts'), { recursive: true }); mkdirSync(home);
    for (const file of ['studio-production.mjs', 'studio-operation-guard.mjs', 'studio-adaptive-compatibility.mjs']) {
      cpSync(join(dirname(script), file), join(project, 'scripts', file));
    }
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
    const metadata = { revision, sourceTree: git('rev-parse', 'HEAD^{tree}'), buildId: 'fixture-build',
      builtAt: '2026-10-20T00:00:00.000Z', ...ADAPTIVE_RELEASE_CAPABILITIES };
    mkdirSync(join(project, '.next', 'standalone', '.next'), { recursive: true });
    mkdirSync(join(project, '.next', 'static'));
    writeFileSync(join(project, '.next', 'standalone', 'server.js'), 'console.log("SYNTHETIC_RUNTIME_READY");\n');
    for (const dir of [join(project, '.next'), join(project, '.next', 'standalone', '.next')]) {
      writeFileSync(join(dir, 'BUILD_ID'), metadata.buildId);
    }
    writeFileSync(join(project, '.next', 'studio-release.json'), JSON.stringify(metadata));
    mkdirSync(join(f.base, 'data'));
    writeFileSync(join(f.base, 'production.env'), `STUDIO_SECRET='synthetic-fixture-secret-more-than-32-characters'\nVOXX_BOT_TOKEN='synthetic'\nVOXX_BOT_USERNAME='FixtureBot'\nSTUDIO_SUPERADMIN_IDS='123'\nSTUDIO_WEBAPP_URL='https://fixture.invalid/studio'\nANTHROPIC_API_KEY='synthetic'\nSTUDIO_DATA_DIR='${join(f.base, 'data')}'\n`);
    const preload = join(f.base, 'synthetic-preload.mjs');
    function invoke(command, { mode = 'healthy', flags } = {}) {
      writeFileSync(preload, `
import fs from 'node:fs'; import cp from 'node:child_process'; import net from 'node:net'; import os from 'node:os';
import { EventEmitter } from 'node:events'; import { syncBuiltinESMExports } from 'node:module';
const base=${JSON.stringify(f.base)}, effects=${JSON.stringify(effects)}, mode=${JSON.stringify(mode)};
const record=x=>fs.appendFileSync(effects,x+'\\n');
os.homedir=()=>${JSON.stringify(home)};
let loaded=true, servedRevision=${JSON.stringify(f.old.revision)};
const original=cp.spawnSync;
cp.spawnSync=(command,args,options)=>{
  if(command==='git') return original(command,args,options);
  if(command!=='launchctl') throw new Error('unexpected subprocess');
  record('launch:'+args[0]);
  if(args[0]==='print') return {status:loaded?0:113,stdout:'',stderr:''};
  if(args[0]==='bootout') loaded=false;
  else if(args[0]==='bootstrap') {loaded=true;servedRevision=fs.readFileSync(fs.realpathSync(base+'/current')+'/revision','utf8').trim();}
  else throw new Error('unexpected launch operation');
  return {status:0,stdout:'',stderr:''};
};
cp.spawn=()=>{throw new Error('unexpected child server in installer fixture')};
net.createConnection=()=>{record('socket-stub');const s=new EventEmitter();s.setTimeout=()=>{};s.destroy=()=>{};queueMicrotask(()=>s.emit('error',new Error('synthetic closed port')));return s};
syncBuiltinESMExports();
globalThis.fetch=async url=>{
  record('fetch-stub');
  if(url.endsWith('/getMe')) return Response.json({ok:true,result:{username:'FixtureBot'}});
  if(url.endsWith('/getWebhookInfo')) return Response.json({ok:true,result:{}});
  if(url==='https://api.anthropic.com/v1/models?limit=100') return Response.json({data:[{id:'claude-sonnet-5-5'},{id:'claude-haiku-5-5'}]});
  if(url==='http://127.0.0.1:3107/api/studio/health') {
    record('health:'+servedRevision);
    if(mode==='foreign') {const tmp=base+'/foreign-pointer';fs.symlinkSync(${JSON.stringify(f.foreign.path)},tmp);fs.renameSync(tmp,base+'/current');}
    if(mode==='release-failure') fs.writeFileSync(base+'/.studio-operation.lock/unexpected','preserve');
    if(mode==='cancel' && servedRevision===${JSON.stringify(revision)}) process.emit('SIGTERM');
    return Response.json({status:'healthy',bots:true,revision:servedRevision});
  }
  throw new Error('unexpected provider request');
};`);
      return spawnSync(process.execPath, ['--import', preload, join(project, 'scripts', 'studio-production.mjs'), command,
        ...(flags ?? (['install', 'rollback'].includes(command) ? ['--expect-current', f.old.path,
          '--expect-revision', f.old.revision, '--expect-build', f.old.buildId] : []))],
      { cwd: project, env: { PATH: process.env.PATH, VOX_PRODUCTION_DIR: f.base }, encoding: 'utf8', timeout: 10000 });
    }
    await run({ ...f, project, home, effects, revision, invoke });
  });
}

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
  const lock = acquireOperation(f.base, 'install');
  try {
    const runtime = spawnSync(process.execPath, [join(current.release.path, 'studio-runtime.mjs'), 'run'], {
      env: { PATH: dirname(process.execPath), VOX_PRODUCTION_DIR: f.base }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(runtime.status, 0, runtime.stderr);
    assert.match(runtime.stdout, /SYNTHETIC_RUNTIME_READY/);
    lock.assertOwned();
  } finally { lock.release(); }
}));

test('actual CLI never prints successful install receipt if owned lock release fails', () => installerFixture(async f => {
  const result = f.invoke('install', { mode: 'release-failure' });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout, /Installed revision/);
  assert.match(result.stderr, /unknown files/);
  assert.equal(existsSync(join(f.lockPath, 'owner.json')), true);
  assert.equal(readFileSync(join(f.lockPath, 'unexpected'), 'utf8'), 'preserve');
}));

test('actual CLI cancellation waits for recovery and emits no success receipt', () => installerFixture(async f => {
  const result = f.invoke('install', { mode: 'cancel' });
  assert.equal(result.status, 143, result.stderr);
  assert.doesNotMatch(result.stdout, /Installed revision/);
  assert.equal(readCurrent(f.base).release.path, f.old.path);
  assert.equal(existsSync(f.lockPath), false);
  assert.equal(readFileSync(f.effects, 'utf8').split('\n').filter(x => x === 'launch:bootout').length, 2);
  assert.deepEqual(readFileSync(f.effects, 'utf8').split('\n').filter(x => x.startsWith('health:')),
    [`health:${f.revision}`, `health:${f.old.revision}`]);
}));

test('actual CLI failure after an uncooperative pointer change leaves foreign current and its service alone', () => installerFixture(async f => {
  const result = f.invoke('install', { mode: 'foreign' });
  assert.equal(result.status, 1); assert.match(result.stderr, /baseline changed/);
  assert.doesNotMatch(result.stdout, /Installed revision/);
  assert.equal(readCurrent(f.base).release.path, f.foreign.path);
  assert.equal(readFileSync(f.effects, 'utf8').split('\n').filter(x => x === 'launch:bootout').length, 1);
}));

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
