/** Protected native ABI packet. Portable parsing always; real Darwin only with explicit frozen binary/hash. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseProcessMetadata } from './studio-production.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const MAX64 = '18446744073709551615';
function valid() {
  return { version: 1, status: 'ok', pid: 701, ppid: 700, uid: 501, pgid: 700,
    startAbsTicks: '9007199254740993', startSeconds: '1793016000', startMicroseconds: '999999',
    executablePath: '/synthetic/node', cwdPath: '/synthetic/runtime', cwdDevice: '1', cwdInode: '9007199254740995',
    childPids: [702], processGroupPids: [700, 701, 702] };
}
const parse = value => parseProcessMetadata(JSON.stringify(value), 701);

test('native ABI preserves exact uint64 strings above JavaScript integer precision', () => {
  const expected = valid(), actual = parse(expected);
  assert.deepEqual(actual, expected); assert.equal(actual.startAbsTicks, '9007199254740993');
  assert.equal(parse({ ...expected, startAbsTicks: MAX64, cwdInode: MAX64 }).cwdInode, MAX64);
});

for (const state of ['changed', 'unavailable', 'invalid', 'overflow']) test(`closed native status ${state} never becomes partial process identity`, () => {
  assert.deepEqual(parse({ version: 1, status: state }), { version: 1, status: state });
  assert.throws(() => parse({ version: 1, status: state, pid: 701 }));
});

test('kernel absence preserves explicit empty or surviving process-group observation, never two-field inference', () => {
  for (const processGroupPids of [[], [702]]) assert.deepEqual(parse({ version: 1, status: 'absent', processGroupPids }), { version: 1, status: 'absent', processGroupPids });
  assert.throws(() => parse({ version: 1, status: 'absent' }));
  for (const processGroupPids of [[0], [2147483648], [702, 702], Array.from({ length: 65 }, (_, i) => i + 1)]) {
    assert.throws(() => parse({ version: 1, status: 'absent', processGroupPids }));
  }
});

const damage = {
  'unknown field': row => { row.environment = 'SYNTHETIC_MUST_NOT_BE_ACCEPTED'; },
  'wrong pid': row => { row.pid = 702; },
  'overflow pid': row => { row.pid = 2147483648; },
  'overflow parent': row => { row.ppid = 2147483648; },
  'overflow uid': row => { row.uid = 4294967296; },
  'overflow process group': row => { row.pgid = 2147483648; },
  'zero birth': row => { row.startAbsTicks = '0'; },
  'rounded numeric birth': row => { row.startAbsTicks = 9007199254740992; },
  'uint64 overflow': row => { row.startAbsTicks = '18446744073709551616'; },
  'twenty digit overflow': row => { row.cwdInode = '99999999999999999999'; },
  'noncanonical uint64': row => { row.startSeconds = '01'; },
  'negative uint64': row => { row.cwdDevice = '-1'; },
  'invalid microsecond': row => { row.startMicroseconds = '1000000'; },
  'relative executable': row => { row.executablePath = 'node'; },
  'relative cwd': row => { row.cwdPath = 'runtime'; },
  'nul path': row => { row.cwdPath = '/synthetic/\0runtime'; },
  'too many children': row => { row.childPids = Array.from({ length: 65 }, (_, i) => i + 1000); },
  'duplicate child': row => { row.childPids = [702, 702]; },
  'invalid child pid': row => { row.childPids = [0]; },
  'overflow group member': row => { row.processGroupPids = [2147483648]; },
};
for (const [name, mutate] of Object.entries(damage)) test(`native ABI refuses ${name}`, () => {
  const row = valid(); mutate(row); assert.throws(() => parse(row));
});

test('native ABI rejects malformed UTF-8, oversized and truncated outputs', () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('{'), Buffer.alloc(16385, 32)]) {
    assert.throws(() => parseProcessMetadata(bytes, 701));
  }
});

const binary = process.env.FRO1_NATIVE_TEST_BINARY;
const expectedHash = process.env.FRO1_NATIVE_TEST_SHA256;
const nativeAvailable = process.platform === 'darwin' && process.arch === 'arm64' && Boolean(binary && expectedHash);
const nativeSkip = nativeAvailable ? false : 'UNAVAILABLE: explicit frozen Darwin arm64 native binary/hash not supplied; portable parsing is separate';

function nativeQuery(pid, extra = []) {
  assert.ok(binary && isAbsolute(binary), 'explicit_native_binary_required');
  assert.match(expectedHash ?? '', /^[a-f0-9]{64}$/);
  const before = lstatSync(binary);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.uid===process.getuid() && !(before.mode&0o077) && (before.mode & 0o100), 'unsafe_native_binary');
  assert.equal(createHash('sha256').update(readFileSync(binary)).digest('hex'), expectedHash);
  const result = spawnSync(binary, [String(pid), ...extra], { env: {}, encoding: 'utf8', timeout: 2000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.error, undefined, 'native_helper_failed'); assert.equal(result.signal, null);
  assert.equal(result.stderr, '', 'native_helper_must_not_emit_raw_metadata_errors');
  const after = lstatSync(binary); assert.ok(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'native_binary_changed');
  return result;
}

async function syntheticProcess(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vox-fro1-native-')));
  const code = `import {spawn} from 'node:child_process';process.title='next-server (synthetic renamed title)';
    const nested=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:process.cwd(),env:{},stdio:'ignore'});
    nested.once('spawn',()=>process.send({childPid:nested.pid}));process.on('message',()=>{nested.kill('SIGTERM');nested.once('exit',()=>process.exit(0));});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: root, detached: true,
    env: { NODE_ENV: 'test', HOME: root, TMPDIR: root }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let nested, nestedIdentity;
  try {
    nested = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('synthetic_child_exited_before_ready'))); });
    nestedIdentity = parseProcessMetadata(nativeQuery(nested.childPid).stdout, nested.childPid);
    await run({ child, childPid: nested.childPid, root });
  } finally {
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('exit', resolve); child.send('stop'); });
    if (nested && nestedIdentity?.status === 'ok') {
      const current = parseProcessMetadata(nativeQuery(nested.childPid).stdout, nested.childPid);
      if (current.status === 'ok' && current.startAbsTicks === nestedIdentity.startAbsTicks && current.startSeconds === nestedIdentity.startSeconds && current.startMicroseconds === nestedIdentity.startMicroseconds) {
        process.kill(nested.childPid, 'SIGTERM');
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test('Darwin actual renamed Node wrapper/child retain precise birth, parent, cwd and process-group identity', { skip: nativeSkip, timeout: 10000 }, () => syntheticProcess(async ({ child, childPid, root }) => {
  const firstResult = nativeQuery(child.pid), secondResult = nativeQuery(child.pid);
  assert.equal(firstResult.status, 0); assert.equal(secondResult.status, 0);
  const first = parseProcessMetadata(firstResult.stdout, child.pid), second = parseProcessMetadata(secondResult.stdout, child.pid);
  assert.equal(first.status, 'ok'); assert.equal(second.status, 'ok');
  for (const field of ['pid', 'ppid', 'uid', 'pgid', 'startAbsTicks', 'startSeconds', 'startMicroseconds', 'cwdDevice', 'cwdInode']) assert.equal(first[field], second[field]);
  assert.ok(first.executablePath === realpathSync(process.execPath), 'wrong_synthetic_executable');
  assert.ok(first.cwdPath === root, 'wrong_synthetic_cwd');
  assert.ok(first.childPids.includes(childPid), 'missing_synthetic_descendant');
  assert.ok(first.processGroupPids.includes(child.pid) && first.processGroupPids.includes(childPid), 'missing_synthetic_process_group');
  assert.equal(first.uid, process.getuid());
}));

test('Darwin absent wrapper with a surviving cooperative descendant is distinguishable from an empty group', { skip: nativeSkip, timeout: 10000 }, () => syntheticProcess(async ({ child, childPid }) => {
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });
  const result = nativeQuery(child.pid); assert.equal(result.status, 3);
  const absent = parseProcessMetadata(result.stdout, child.pid);
  assert.equal(absent.status, 'absent'); assert.ok(absent.processGroupPids.includes(childPid), 'surviving_descendant_must_hold');
}));

test('Darwin absent wrapper after its actual child is reaped reports an empty dedicated group', { skip: nativeSkip, timeout: 10000 }, () => syntheticProcess(async ({ child }) => {
  await new Promise(resolve => { child.once('exit', resolve); child.send('stop'); });
  const result = nativeQuery(child.pid); assert.equal(result.status, 3);
  const absent = parseProcessMetadata(result.stdout, child.pid);
  assert.equal(absent.status, 'absent'); assert.deepEqual(absent.processGroupPids, []);
}));

for (const argument of ['0', '-1', '+1', '1x', '2147483648', '99999999999999999999']) test(`Darwin actual helper refuses invalid PID argument ${argument}`, { skip: nativeSkip }, () => {
  const result = nativeQuery(argument); assert.equal(result.status, 64);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, status: 'invalid' });
});
test('Darwin actual helper refuses extra arguments without querying another PID', { skip: nativeSkip }, () => {
  const result = nativeQuery(process.pid, ['extra']); assert.equal(result.status, 64);
  assert.deepEqual(JSON.parse(result.stdout), { version: 1, status: 'invalid' });
});

const artifactRoot=process.env.FRO1_NATIVE_ARTIFACT_ROOT;
test('Darwin actual production observer and ChildProcess adapter publish terminal only after wrapper-only group',{
  skip:nativeAvailable&&artifactRoot?false:'UNAVAILABLE: frozen actual Darwin artifact/binary required for production adapter',timeout:15000,
},async()=>{
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'vox-fro1-native-wrapper-'))),base=join(parent,'base'),data=join(parent,'data');
  mkdirSync(base,{mode:0o700});mkdirSync(data,{mode:0o700});
  const productionUrl=pathToFileURL(fileURLToPath(new URL('./studio-production.mjs',import.meta.url))).href;
  const code=`import{spawn}from'node:child_process';import{readFileSync,lstatSync}from'node:fs';import{join}from'node:path';
    import{nativeProcessQuery,createRuntimeProcessLifecycle,attachRuntimeProcessLifecycle,readRuntimeProcessReceipt}from ${JSON.stringify(productionUrl)};
    const [base,data,artifact,expectedBinary]=process.argv.slice(1);const manifest=JSON.parse(readFileSync(join(artifact,'studio-release.json')));
    if(manifest.runtimeProcessMetadata.binarySha256!==expectedBinary)throw Error('unbound native artifact');
    const s=lstatSync(artifact,{bigint:true}),release={path:artifact,...manifest,identity:{dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)}};
    const query=(pid,timeout)=>nativeProcessQuery(artifact,pid,timeout);const wrapper=query(process.pid);
    if(wrapper.status!=='ok'||wrapper.childPids.length||wrapper.pgid!==process.pid||JSON.stringify(wrapper.processGroupPids)!==JSON.stringify([process.pid]))throw Error('observer leaked or group not dedicated');
    const proof=[[wrapper.pid,wrapper.ppid,wrapper.uid,wrapper.pgid,wrapper.startAbsTicks,wrapper.startSeconds,wrapper.startMicroseconds]];
    const lifecycle=createRuntimeProcessLifecycle({base,release,dataRoot:data,processProof:proof});
    const child=spawn(process.execPath,['-e','process.exit(7)'],{env:{},stdio:'ignore'});
    const adapter=attachRuntimeProcessLifecycle({child,lifecycle,query,wrapper,base,release,dataRoot:data,exit:code=>{
      process.send({code,receipt:readRuntimeProcessReceipt(base),childPid:child.pid,observerChildren:wrapper.childPids},()=>process.exit(code));},log:()=>{}});
    await adapter.settled;`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,base,data,artifactRoot,expectedHash],{cwd:base,detached:true,env:{},stdio:['ignore','pipe','pipe','ipc']});
  let stdout='',stderr='';child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{
    const message=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error(`native_wrapper_no_terminal:${stderr.length}`)));});
    const outcome=await exited;assert.equal(outcome.code,7);assert.equal(outcome.signal,null);assert.equal(message.code,7);
    assert.equal(message.receipt.value.phase,'exited');assert.equal(message.receipt.value.childPid,message.childPid);assert.equal(message.receipt.value.exitCode,7);
    assert.equal(message.receipt.value.holderIdentity,null);assert.deepEqual(message.observerChildren,[]);
    const absent=parseProcessMetadata(nativeQuery(child.pid).stdout,child.pid);assert.equal(absent.status,'absent');assert.deepEqual(absent.processGroupPids,[]);
    writeFileSync(join(parent,'qualified-wrapper.json'),JSON.stringify({outcome,message})+'\n',{mode:0o600});
  }finally{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
    writeFileSync(join(parent,'stdout.log'),stdout,{mode:0o600});writeFileSync(join(parent,'stderr.log'),stderr,{mode:0o600});
    console.info('FRO1_NATIVE_WRAPPER_RETAINED_EVIDENCE',parent);
  }
});
