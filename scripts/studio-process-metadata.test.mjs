/** Protected native ABI packet. Portable parsing always; real Darwin only with explicit frozen binary/hash. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseProcessMetadata, parseCurrentFixtureCensus } from './studio-production.mjs';
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

// Census is a present-only ABI. Its independent switch never piggybacks on the
// older FRO1 binary gate, and portable fixtures are not kernel observations.
const censusExpected = { uid: 501, baseDevice: '1', baseInode: '9007199254740993', artifactDevice: '1', artifactInode: '9007199254740995' };
const censusWire = value => Buffer.from(JSON.stringify(value) + '\n');
const censusRow = (pid = 701, cwd = 'base') => ({ identity: [pid, 1, 501, pid, '9007199254740993', '1793016000', '999999'], cwd });
const censusComplete = (matches = []) => ({ version: 1, status: 'complete', ...censusExpected, matches });

test('MI1 current census portable empty and matching outputs preserve present-only scope and uint64 precision', () => {
  for (const matches of [[], [censusRow()], Array.from({ length: 16 }, (_, i) => censusRow(701 + i, i % 2 ? 'artifact' : 'base'))]) {
    const expected = censusComplete(matches);
    assert.deepEqual(parseCurrentFixtureCensus(censusWire(expected), censusExpected), expected);
  }
  const maximum = censusComplete([{ ...censusRow(), identity: [701, 1, 501, 701, MAX64, MAX64, '999999'] }]);
  assert.deepEqual(parseCurrentFixtureCensus(censusWire(maximum), censusExpected), maximum);
});

for (const status of ['invalid', 'unavailable', 'changed', 'overflow']) test(`MI1 current census portable ${status} cannot become an empty proof`, () => {
  const failure = { version: 1, status };
  const parsed = parseCurrentFixtureCensus(censusWire(failure), censusExpected);
  assert.deepEqual(parsed, failure); assert.equal(Object.hasOwn(parsed, 'matches'), false);
  assert.throws(() => parseCurrentFixtureCensus(censusWire({ ...failure, matches: [] }), censusExpected));
});

const censusDamage = {
  'extra history assertion': row => { row.totalAttempts = 0; },
  'foreign uid': row => { row.uid++; },
  'base device': row => { row.baseDevice = '2'; },
  'base inode': row => { row.baseInode = '9007199254740992'; },
  'artifact inode': row => { row.artifactInode = '8'; },
  'numeric inode rounding': row => { row.baseInode = 9007199254740992; },
  'noncanonical inode': row => { row.baseInode = '01'; },
  'uint64 overflow': row => { row.artifactInode = '18446744073709551616'; },
  'seventeen matches': row => { row.matches = Array.from({ length: 17 }, (_, i) => censusRow(701 + i)); },
  'duplicate pid with different birth': row => { row.matches.push({ ...censusRow(), identity: [701, 1, 501, 701, '2', '1793016000', '999999'] }); },
  'unsorted pids': row => { row.matches = [censusRow(702), censusRow(701)]; },
  'tuple uid': row => { row.matches[0].identity[2]++; },
  'zero pid': row => { row.matches[0].identity[0] = 0; },
  'pid overflow': row => { row.matches[0].identity[0] = 2147483648; },
  'parent overflow': row => { row.matches[0].identity[1] = 2147483648; },
  'zero pgid': row => { row.matches[0].identity[3] = 0; },
  'numeric birth rounding': row => { row.matches[0].identity[4] = 9007199254740992; },
  'zero birth': row => { row.matches[0].identity[4] = '0'; },
  'invalid microseconds': row => { row.matches[0].identity[6] = '1000000'; },
  'extra tuple field': row => { row.matches[0].identity.push('unrelated'); },
  'foreign cwd role': row => { row.matches[0].cwd = 'elsewhere'; },
  'unrelated path disclosure': row => { row.matches[0].cwdPath = '/unrelated/private/path'; },
};
for (const [name, mutate] of Object.entries(censusDamage)) test(`MI1 current census portable refuses ${name}`, () => {
  const value = censusComplete([censusRow()]); mutate(value);
  assert.throws(() => parseCurrentFixtureCensus(censusWire(value), censusExpected));
});

test('MI1 current census portable rejects malformed wire and invalid expected selector before returning a proof', () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('{'), Buffer.alloc(16385, 32),
    Buffer.from(JSON.stringify(censusComplete())), Buffer.from(JSON.stringify(censusComplete()) + '\n '),
    Buffer.from('{"version":1,"version":1,"status":"invalid"}\n')]) {
    assert.throws(() => parseCurrentFixtureCensus(bytes, censusExpected));
  }
  for (const expected of [null, { ...censusExpected, arbitrarySelector: '/elsewhere' }, { ...censusExpected, uid: -1 },
    { ...censusExpected, uid: 4294967296 }, { ...censusExpected, baseInode: 9007199254740992 }]) {
    assert.throws(() => parseCurrentFixtureCensus(censusWire(censusComplete()), expected));
  }
});

const censusBinary = process.env.MI1_CENSUS_NATIVE_TEST_BINARY;
const censusBinaryHash = process.env.MI1_CENSUS_NATIVE_TEST_SHA256;
const censusNodeHash = process.env.MI1_CENSUS_NATIVE_NODE_SHA256;
const censusNativeAvailable = process.platform === 'darwin' && process.arch === 'arm64' && Boolean(censusBinary && censusBinaryHash && censusNodeHash);
const censusNativeSkip = censusNativeAvailable ? false : 'UNAVAILABLE: explicit frozen census Darwin arm64 binary/hash and Node hash required; portable results are separate';

function censusNativeCall(args) {
  assert.ok(censusBinary && isAbsolute(censusBinary)); assert.match(censusBinaryHash ?? '', /^[a-f0-9]{64}$/); assert.match(censusNodeHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(readFileSync(realpathSync(process.execPath))).digest('hex'), censusNodeHash);
  const stamp = path => { const s = lstatSync(path, { bigint: true }); return [String(s.dev), String(s.ino), String(s.birthtimeNs), String(s.size), String(s.mtimeNs), String(s.ctimeNs)]; };
  const stat = lstatSync(censusBinary); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid() && !(stat.mode & 0o077) && (stat.mode & 0o100));
  const before = stamp(censusBinary); assert.equal(createHash('sha256').update(readFileSync(censusBinary)).digest('hex'), censusBinaryHash);
  const result = spawnSync(censusBinary, args, { env: {}, timeout: 2000, maxBuffer: 16384, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.stderr.length, 0);
  assert.deepEqual(stamp(censusBinary), before); assert.equal(createHash('sha256').update(readFileSync(censusBinary)).digest('hex'), censusBinaryHash);
  return result;
}

async function censusNativeFixture(run) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'vox-mi1-b-'))), base = join(parent, 'base'), artifact = join(parent, 'artifact'), unrelated = join(parent, 'unrelated');
  for (const directory of [base, artifact, unrelated]) mkdirSync(directory, { mode: 0o700 });
  const b = lstatSync(base, { bigint: true }), a = lstatSync(artifact, { bigint: true });
  const expected = { uid: process.getuid(), baseDevice: String(b.dev), baseInode: String(b.ino), artifactDevice: String(a.dev), artifactInode: String(a.ino) };
  const args = ['--current-fixture-census-v1', realpathSync(process.execPath), base, artifact, expected.baseDevice, expected.baseInode, expected.artifactDevice, expected.artifactInode];
  const children = [];
  const start = async cwd => {
    const child = spawn(process.execPath, ['-e', "process.title='next-server (census synthetic title)';process.on('message',()=>process.exit(0));setTimeout(()=>process.exit(0),8000);process.send('ready');"], { cwd, detached: true, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    children.push(child); await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(Error('census_fixture_exited_before_ready'))); });
    return child;
  };
  const stop = async child => { if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }); };
  let failure;
  try { await run({ parent, base, artifact, unrelated, expected, args, start, stop }); }
  catch (error) { failure = error; }
  try {
    await Promise.all(children.map(stop));
    // This is one additional real census request, included in the future
    // packet's native-call denominator. Never replace the first test failure.
    const result = censusNativeCall(args), census = parseCurrentFixtureCensus(result.stdout, expected);
    assert.equal(result.status, 0); assert.equal(census.status, 'complete'); assert.deepEqual(census.matches, []);
    rmSync(parent, { recursive: true, force: true });
  }
  catch (error) {
    console.info('MI1_CENSUS_NATIVE_RETAINED_UNSETTLED_FIXTURE', parent);
    failure = failure ? new AggregateError([failure, error], 'census test failed; subsequent teardown proof also failed') : error;
  }
  if (failure) throw failure;
}

test('MI1 current census Darwin actual renamed base/artifact Node matches exclude unrelated cwd and become empty after shutdown', { skip: censusNativeSkip, timeout: 15000 }, () => censusNativeFixture(async f => {
  const base = await f.start(f.base), artifact = await f.start(f.artifact), unrelated = await f.start(f.unrelated);
  const result = censusNativeCall(f.args); assert.equal(result.status, 0);
  const value = parseCurrentFixtureCensus(result.stdout, f.expected);
  assert.equal(value.status, 'complete'); assert.deepEqual(value.matches.map(row => row.identity[0]), [base.pid, artifact.pid].sort((x, y) => x - y));
  for (const [child, cwd] of [[base, 'base'], [artifact, 'artifact']]) {
    const row = value.matches.find(row => row.identity[0] === child.pid); assert.equal(row.cwd, cwd); assert.equal(row.identity[1], process.pid); assert.equal(row.identity[2], process.getuid()); assert.equal(row.identity[3], child.pid);
  }
  assert.ok(!result.stdout.includes(Buffer.from(f.unrelated))); assert.ok(!result.stdout.includes(Buffer.from('executablePath'))); assert.ok(!value.matches.some(row => row.identity[0] === unrelated.pid));
  await f.stop(base); await f.stop(artifact);
  const emptyResult = censusNativeCall(f.args); assert.equal(emptyResult.status, 0);
  assert.deepEqual(parseCurrentFixtureCensus(emptyResult.stdout, f.expected).matches, []);
}));

test('MI1 current census Darwin actual invalid selector identities and extra arguments return no partial matches', { skip: censusNativeSkip, timeout: 10000 }, () => censusNativeFixture(async f => {
  await f.start(f.base);
  for (const [args, status, exit] of [[[...f.args, 'extra'], 'invalid', 64],
    [f.args.map((arg, index) => index === 5 ? '18446744073709551615' : arg), 'changed', 5],
    [f.args.map((arg, index) => index === 1 ? join(f.parent, 'missing-node') : arg), 'unavailable', 4]]) {
    const result = censusNativeCall(args); assert.equal(result.status, exit);
    const value = parseCurrentFixtureCensus(result.stdout, f.expected); assert.deepEqual(value, { version: 1, status }); assert.equal(Object.hasOwn(value, 'matches'), false);
  }
}));
