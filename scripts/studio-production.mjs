#!/usr/bin/env node
/** Single-host Vox Studio releases. Secrets stay in an owner-only env file. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, symlinkSync, renameSync, realpathSync, rmSync, unlinkSync,
  constants, openSync, closeSync, readSync, lstatSync, fstatSync, fsyncSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { assertReleaseAdaptiveCompatibility, readInstalledReleaseManifest } from './studio-adaptive-compatibility.mjs';
import { assertCurrent, assertIdentifiedRuntime, assertReleaseDirectory, guardedBackup, parseExpected, readControlText, readCurrent, readRelease, releaseDirectoryIdentity, transitionRelease, withOperation } from './studio-operation-guard.mjs';
import { FILE_RUNTIME_OWNER_GUARD, FILE_RUNTIME_OWNER_MARKER, inspectFileRuntimeOwner, acquireFileRuntimeOwner,
  createMaintenanceAuthorization, retireStoppedFileRuntimeOwner, releaseMaintenanceFileRuntimeOwner } from './studio-file-runtime-owner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let base = process.env.VOX_PRODUCTION_DIR ?? join(homedir(), 'Library', 'Application Support', 'Vox Studio');
let envFile = join(base, 'production.env');
const label = 'io.ludaxis.vox-studio';
const domain = `gui/${process.getuid()}`;
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_TTS_MODEL', 'VOXX_BOT_TOKEN', 'VOXX_BOT_USERNAME', 'STUDIO_SECRET', 'STUDIO_SUPERADMIN_IDS', 'STUDIO_WEBAPP_URL', 'STUDIO_DATA_DIR', 'STUDIO_ORG_NAME', 'STUDIO_CHAT_MODEL', 'STUDIO_VOICE_MODEL', 'STUDIO_PERSONA_MODEL', 'STUDIO_DECISIONS', 'OPENAI_DECISION_MODEL', 'STUDIO_GROUP_OBSERVATION',
  'OPENAI_IMAGE_MODEL', 'OPENAI_STT_MODEL', 'STUDIO_WEB_SEARCH', 'STUDIO_DECISIONS_ENABLED', 'STUDIO_SKILL_ROUTING',
  'STUDIO_RELATIONSHIPS', 'STUDIO_RELATIONSHIP_ROLES', 'STUDIO_RELATIONSHIP_AGENTS', 'STUDIO_RELATIONSHIP_PEOPLE', 'STUDIO_RELATIONSHIP_WORKER_SECRET',
  'STUDIO_SCOPED_RELATIONSHIPS', 'STUDIO_ADAPTIVE_POLICY_JSON', 'STUDIO_MAINTENANCE', 'STUDIO_REMINDER_DELIVERY', 'STUDIO_IMPROVEMENT_TRUST_JSON'];
keys.push('STUDIO_CONNECTIONS_CONFIG_FILE', 'STUDIO_CONNECTIONS_BROKER_URL', 'STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE');
keys.push('STUDIO_ADAPTIVE_FORMAT', 'STUDIO_PET_DISABLED');
keys.push('STUDIO_REQUESTED_ROUTINES', 'STUDIO_RIGHTS_POLICY_JSON', 'STUDIO_RIGHTS_KEY_BASE64');
const readEnv = (file) => existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const PROCESS_RECEIPT = 'runtime-process-v1.json';
const STOPPED_RECEIPT = 'runtime-owner-recovery-v1.json';
const LEGACY_REVISION = 'f895ba59fc43fe9677e08fa602cc48c08ccdf3f8';
const LEGACY_WRAPPER_SHA = '823941896eb833bc5a2b44616a941444607dfecd55bdb6baeb2a50d90e94fb84';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uint = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
const positive = n => uint(n) && n > 0;
const pidNumber = n => positive(n) && n <= 2147483647;
const uint64 = s => typeof s === 'string' && /^(0|[1-9]\d{0,19})$/.test(s) && BigInt(s) <= 18446744073709551615n;
const digest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const identity = info => ({ dev: String(info.dev), ino: String(info.ino), birth: String(info.birthtimeNs) });
const info = path => lstatSync(path, { bigint: true, throwIfNoEntry: false });
const closed = reason => { throw new Error(`Studio runtime lifecycle unavailable: ${reason}`); };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...fields].sort());
const pathIdentity = value => exact(value, ['dev','ino','birth']) && Object.values(value).every(v => typeof v === 'string' && /^\d+$/.test(v));
const releaseIdentity = value => exact(value, ['revision','sourceTree','buildId']) && /^[a-f0-9]{40}$/.test(value.revision) && /^[a-f0-9]{40}$/.test(value.sourceTree) &&
  typeof value.buildId === 'string' && value.buildId.length > 0 && value.buildId.length <= 200 && value.buildId.trim() === value.buildId && !/[\x00-\x1f\x7f]/.test(value.buildId);
const tuple = release => ({ revision: release.revision, sourceTree: release.sourceTree, buildId: release.buildId });
const cwdMatches = (row,path,pinned) => row.cwdPath===path && row.cwdDevice===pinned.dev && row.cwdInode===pinned.ino;

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function privateMetadataBase(path) {
  const s = info(path);
  if (!isAbsolute(path) || realpathSync(path) !== path || !s?.isDirectory() || s.uid !== BigInt(process.geteuid?.() ?? process.getuid()) || (s.mode & 0o077n)) closed('invalid_metadata_base');
  return identity(s);
}
function metadataFile(path, maximum = 4096, privateOnly = true) {
  const before = info(path);
  if (!before) return null;
  if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.geteuid?.() ?? process.getuid()) || privateOnly && (before.mode & 0o077n) || before.size > BigInt(maximum)) closed('invalid_metadata');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd, { bigint: true }), buffer = Buffer.alloc(maximum + 1); let length = 0, n;
    do { n = readSync(fd, buffer, length, buffer.length - length, null); length += n; } while (n && length < buffer.length);
    const after = fstatSync(fd, { bigint: true }), named = info(path);
    if (!named?.isFile() || length > maximum || !same(identity(before), identity(opened)) || !same(identity(opened), identity(after)) || !same(identity(after), identity(named)) ||
        after.nlink !== 1n || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs || named.ctimeNs !== after.ctimeNs || opened.size !== after.size) closed('metadata_changed');
    const bytes = buffer.subarray(0, length);
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), digest: hash(bytes), identity: identity(after) };
  } finally { closeSync(fd); }
}
function atomicControl(basePath, name, expected, bytes,maximum=4096) {
  const baseIdentity = privateMetadataBase(basePath), path = join(basePath, name);
  if (Buffer.byteLength(bytes)>maximum||!same(metadataFile(path,maximum), expected)) closed('metadata_compare_failed');
  const temporary = join(basePath, `.${name}-${randomBytes(16).toString('hex')}.tmp`);
  let fd, temporaryIdentity;
  try {
    fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    temporaryIdentity = identity(fstatSync(fd, { bigint: true })); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    if (!same(identity(info(basePath)), baseIdentity) || !same(metadataFile(path,maximum), expected)) closed('metadata_compare_failed');
    renameSync(temporary, path); syncDirectory(basePath);
  } finally {
    if (fd !== undefined) closeSync(fd);
    const current = info(temporary);
    if (temporaryIdentity && current?.isFile() && same(identity(current), temporaryIdentity)) unlinkSync(temporary);
  }
}

/** Strict private lifecycle ABI. Parsing a record alone is never exit proof. */
export function parseRuntimeProcessReceipt(text) {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 4096) closed('invalid_receipt');
    const r = JSON.parse(text), common = ['version','kind','spawnId','revision','previousDigest','phase','wrapperPid','childPid','startedAt','release',
      'artifactIdentity','rootIdentity','operationDigest','holderIdentity','holderDigest','holderNonce','processProof'];
    const terminal = r?.phase === 'exited' ? ['endedAt', ...(Object.hasOwn(r,'exitCode') ? ['exitCode'] : ['signal'])] : r?.phase === 'spawn_failed' ? ['endedAt','failure'] : [];
    if (!exact(r, [...common, ...terminal]) || r.version !== 1 || r.kind !== 'studio-runtime-process' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(r.spawnId) ||
        !uint(r.revision) || (r.revision === 0 ? r.previousDigest !== null : !digest(r.previousDigest)) || !['starting','running','exited','spawn_failed'].includes(r.phase) ||
        !pidNumber(r.wrapperPid) || !(r.childPid === null || pidNumber(r.childPid)) || !uint(r.startedAt) || !releaseIdentity(r.release) || !pathIdentity(r.artifactIdentity) || !pathIdentity(r.rootIdentity) ||
        !(r.operationDigest === null || digest(r.operationDigest)) || !Array.isArray(r.processProof) || r.processProof.length > 64) closed('invalid_receipt');
    const holderAbsent = r.holderIdentity === null && r.holderDigest === null && r.holderNonce === null;
    if (!holderAbsent && (!pathIdentity(r.holderIdentity) || !digest(r.holderDigest) || !digest(r.holderNonce))) closed('invalid_receipt');
    if (r.phase === 'starting' && !holderAbsent || r.phase === 'running' && (!r.childPid || holderAbsent) || r.phase === 'exited' && !r.childPid || r.phase === 'spawn_failed' && (r.childPid !== null || !holderAbsent || r.failure !== 'spawn_error')) closed('invalid_receipt');
    if (terminal.length && (!uint(r.endedAt) || r.endedAt < r.startedAt)) closed('invalid_receipt');
    if (r.phase === 'exited' && (Object.hasOwn(r,'exitCode') ? !uint(r.exitCode) || r.exitCode > 255 : !['SIGTERM','SIGINT','SIGKILL','SIGABRT','SIGSEGV','SIGBUS','SIGHUP','SIGPIPE'].includes(r.signal))) closed('invalid_receipt');
    for (const row of r.processProof) if (!Array.isArray(row) || row.length !== 7 || !pidNumber(row[0]) || !uint(row[1]) || row[1]>2147483647 || !uint(row[2]) || row[2]>4294967295 || !pidNumber(row[3]) || !row.slice(4).every(uint64) || row[4]==='0' || BigInt(row[6])>=1000000n) closed('invalid_receipt');
    if (new Set(r.processProof.map(row => row[0])).size !== r.processProof.length) closed('invalid_receipt');
    return r;
  } catch { return closed('invalid_receipt'); }
}
export function readRuntimeProcessReceipt(basePath) {
  privateMetadataBase(basePath);
  const found = metadataFile(join(basePath, PROCESS_RECEIPT));
  return found ? { ...found, value: parseRuntimeProcessReceipt(found.text) } : null;
}
function receiptFile(snapshot) { if (!snapshot) return null; return { text: snapshot.text, digest: snapshot.digest, identity: snapshot.identity }; }
export function commitRuntimeProcessReceipt(basePath, expected, next) {
  const value = parseRuntimeProcessReceipt(JSON.stringify(next));
  if (!expected) {
    if (value.phase !== 'starting' || value.revision !== 0 || value.childPid !== null) closed('invalid_initial_receipt');
  } else {
    assertRuntimeProcessSuccessor(expected, value);
  }
  atomicControl(basePath, PROCESS_RECEIPT, receiptFile(expected), JSON.stringify(value) + '\n');
  return readRuntimeProcessReceipt(basePath);
}
export function assertRuntimeProcessSuccessor(expected, next) {
  const old = parseRuntimeProcessReceipt(expected.text), value = parseRuntimeProcessReceipt(JSON.stringify(next));
  for (const key of ['version','kind','spawnId','wrapperPid','startedAt','release','artifactIdentity','rootIdentity','operationDigest']) if (!same(old[key], value[key])) closed('receipt_identity_changed');
  if (value.revision !== old.revision + 1 || value.previousDigest !== expected.digest || ['exited','spawn_failed'].includes(old.phase)) closed('receipt_transition_refused');
  if (old.childPid !== null && value.childPid !== old.childPid || old.holderIdentity !== null && !['holderIdentity','holderDigest','holderNonce'].every(k => same(old[k], value[k]))) closed('receipt_identity_changed');
  const allowed = old.phase === 'starting' ? ['starting','running','exited','spawn_failed'] : ['exited'];
  if (!allowed.includes(value.phase) || value.phase === 'starting' && (old.childPid !== null || !value.childPid) || value.phase === 'spawn_failed' && old.childPid !== null) closed('receipt_transition_refused');
  if(old.phase==='starting'&&value.phase==='running'&&old.childPid===null||old.phase==='starting'&&value.phase!=='running'&&value.holderIdentity!==null)closed('receipt_transition_refused');
  if(value.phase!=='running'&&!same(old.processProof,value.processProof))closed('receipt_identity_changed');
  for(const row of old.processProof)if(!same(value.processProof.find(found=>found[0]===row[0]),row))closed('receipt_identity_changed');
}

/** Only run() connects these methods to its actual ChildProcess events. The
 * controller never invents a holder, an exit, or a successful spawn. */
export function createRuntimeProcessLifecycle({base: basePath, release, dataRoot, operationDigest = null, wrapperPid = process.pid, processProof = [], now = Date.now, readOwner = inspectFileRuntimeOwner}) {
  const rootIdentity = privateMetadataBase(dataRoot);
  if (readRuntimeProcessReceipt(basePath)) closed('unretired_runtime_receipt');
  let snapshot = commitRuntimeProcessReceipt(basePath,null,{version:1,kind:'studio-runtime-process',spawnId:randomUUID(),revision:0,previousDigest:null,
    phase:'starting',wrapperPid,childPid:null,startedAt:now(),release:tuple(release),artifactIdentity:release.identity,rootIdentity,operationDigest,
    holderIdentity:null,holderDigest:null,holderNonce:null,processProof});
  const next = fields => {
    if (!same(privateMetadataBase(dataRoot),rootIdentity)) closed('runtime_root_changed');
    snapshot = commitRuntimeProcessReceipt(basePath,snapshot,{...snapshot.value,...fields,revision:snapshot.value.revision+1,previousDigest:snapshot.digest});
    return snapshot;
  };
  return Object.freeze({
    snapshot: () => snapshot,
    spawned(pid) { if (!positive(pid) || snapshot.value.phase!=='starting' || snapshot.value.childPid!==null) closed('invalid_spawn_event'); return next({childPid:pid}); },
    observeOwner(processProof = []) {
      if (snapshot.value.phase!=='starting' || !snapshot.value.childPid) closed('invalid_running_event');
      const owner=readOwner(dataRoot); if (!owner) return false;
      if (owner.record.role!=='runtime' || owner.record.pid!==snapshot.value.childPid || !same(owner.rootIdentity,rootIdentity) || !same(owner.record.release,tuple(release))) closed('runtime_holder_mismatch');
      next({phase:'running',holderIdentity:owner.guardIdentity,holderDigest:owner.digest,holderNonce:owner.record.nonce,processProof}); return true;
    },
    exited(code,signal) {
      if (!snapshot.value.childPid || !['starting','running'].includes(snapshot.value.phase)) closed('invalid_exit_event');
      return next({phase:'exited',endedAt:now(),...(code===null ? {signal} : {exitCode:code})});
    },
    spawnFailed() { if (snapshot.value.childPid!==null) closed('invalid_spawn_error_event'); return next({phase:'spawn_failed',endedAt:now(),failure:'spawn_error'}); },
  });
}

/** Native ABI validation is pure. Raw paths are compared internally, not logged. */
export function parseProcessMetadata(bytes, expectedPid) {
  try {
    const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (Buffer.byteLength(text) > 16384 || !pidNumber(expectedPid)) closed('invalid_process_metadata');
    const r = JSON.parse(text);
    if (r?.version !== 1 || !['ok','absent','unavailable','changed','invalid','overflow'].includes(r.status)) closed('invalid_process_metadata');
    if (r.status !== 'ok') {
      if (r.status==='absent') {
        if (!exact(r,['version','status','processGroupPids']) || !Array.isArray(r.processGroupPids) || r.processGroupPids.length>64 || !r.processGroupPids.every(pidNumber) || new Set(r.processGroupPids).size!==r.processGroupPids.length) closed('invalid_process_metadata');
      } else if (!exact(r,['version','status'])) closed('invalid_process_metadata');
      return r;
    }
    if (!exact(r,['version','status','pid','ppid','uid','pgid','startAbsTicks','startSeconds','startMicroseconds','executablePath','cwdPath','cwdDevice','cwdInode','childPids','processGroupPids']) ||
        r.pid !== expectedPid || !pidNumber(r.pid) || !uint(r.ppid) || r.ppid>2147483647 || !uint(r.uid) || r.uid>4294967295 || !pidNumber(r.pgid) ||
        !['startAbsTicks','startSeconds','startMicroseconds','cwdDevice','cwdInode'].every(k => uint64(r[k])) || r.startAbsTicks === '0' || BigInt(r.startMicroseconds)>=1000000n ||
        !['executablePath','cwdPath'].every(k => typeof r[k] === 'string' && isAbsolute(r[k]) && r[k].length <= 4096 && !r[k].includes('\0'))) closed('invalid_process_metadata');
    for (const key of ['childPids','processGroupPids']) if (!Array.isArray(r[key]) || r[key].length > 64 || !r[key].every(pidNumber) || new Set(r[key]).size !== r[key].length) closed('invalid_process_metadata');
    return r;
  } catch { return closed('invalid_process_metadata'); }
}
function metadataArtifact(artifactRoot){
  if(!isAbsolute(artifactRoot)||realpathSync(artifactRoot)!==artifactRoot||!info(artifactRoot)?.isDirectory())closed('native_process_artifact_unavailable');
  const directoryIdentity=identity(info(artifactRoot)),manifestFile=metadataFile(join(artifactRoot,'studio-release.json'),65536,false);
  let manifest;try{manifest=JSON.parse(manifestFile?.text);}catch{closed('native_process_artifact_unavailable');}
  const m=manifest?.runtimeProcessMetadata;
  if(!releaseIdentity(tuple(manifest??{}))||!exact(m,['version','abi','available','platform','arch','file','bytes','binarySha256','sourceSha256','compilerPath','compilerSha256','compilerVersionSha256','sdkVersion','deploymentTarget'])||
    m.version!==1||m.abi!==1||m.available!==true||m.platform!=='darwin'||m.arch!=='arm64'||m.file!=='studio-process-metadata'||!positive(m.bytes)||m.bytes>1024*1024||
    !['binarySha256','sourceSha256','compilerSha256','compilerVersionSha256'].every(k=>digest(m[k]))||typeof m.compilerPath!=='string'||!isAbsolute(m.compilerPath)||m.compilerPath.length>4096||m.compilerPath.includes('\0')||
    typeof m.sdkVersion!=='string'||!/^\d{1,3}(?:\.\d{1,3}){0,3}$/.test(m.sdkVersion)||m.deploymentTarget!=='11.0')closed('native_process_artifact_unavailable');
  const path=join(artifactRoot,m.file),before=info(path);
  if(!before?.isFile()||before.nlink!==1n||before.uid!==BigInt(process.geteuid?.()??process.getuid())||(before.mode&0o077n)||!(before.mode&0o100n)||before.size!==BigInt(m.bytes))closed('native_process_artifact_changed');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let binaryHash;
  try{
    const opened=fstatSync(fd,{bigint:true}),bytes=Buffer.alloc(m.bytes+1);let length=0,n;
    do{n=readSync(fd,bytes,length,bytes.length-length,null);length+=n;}while(n&&length<bytes.length);
    const after=fstatSync(fd,{bigint:true}),named=info(path);
    if(!named?.isFile()||!same(identity(before),identity(opened))||!same(identity(opened),identity(after))||!same(identity(after),identity(named))||opened.ctimeNs!==after.ctimeNs||opened.mtimeNs!==after.mtimeNs||after.ctimeNs!==named.ctimeNs||length!==m.bytes)closed('native_process_artifact_changed');
    binaryHash=hash(bytes.subarray(0,length));if(binaryHash!==m.binarySha256)closed('native_process_artifact_changed');
  }finally{closeSync(fd);}
  if(!same(identity(info(artifactRoot)),directoryIdentity))closed('native_process_artifact_changed');
  return {path,directoryIdentity,manifestFile,manifest,binaryHash,binaryIdentity:identity(before)};
}
export function nativeProcessQuery(artifactRoot, pid,timeout=2000) {
  if(!uint(timeout)||timeout<1||timeout>2000)closed('native_process_deadline_invalid');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') closed('native_process_adapter_unsupported');
  if(!pidNumber(pid))closed('invalid_process_metadata');
  const pinned=metadataArtifact(artifactRoot),path=pinned.path;
  const result = spawnSync(path, [String(pid)], { env: {}, detached:true, timeout, maxBuffer: 16384, stdio: ['ignore','pipe','ignore'] });
  if (result.error || result.signal || !same(metadataArtifact(artifactRoot),pinned)) closed('native_process_query_unavailable');
  const parsed = parseProcessMetadata(result.stdout, pid);
  if (result.status !== {ok:0,absent:3,unavailable:4,changed:5,invalid:64,overflow:6}[parsed.status]) closed('native_process_query_unavailable');
  // The completed, hash-pinned observer is this wrapper's actual child, in a
  // separate group. Only self-query removes that exact spawnSync child PID.
  return normalizeProcessObserver(parsed,pid,result.pid);
}
export function normalizeProcessObserver(parsed,targetPid,observerPid,selfPid=process.pid){
  const value=parseProcessMetadata(JSON.stringify(parsed),targetPid);
  if(targetPid===selfPid&&value.status==='ok'){
    if(!pidNumber(observerPid)||observerPid===selfPid||value.childPids.filter(p=>p===observerPid).length!==1||value.processGroupPids.includes(observerPid))closed('native_observer_identity_unavailable');
    value.childPids=value.childPids.filter(p=>p!==observerPid);
  }
  if(value.status==='ok'){value.childPids.sort((a,b)=>a-b);value.processGroupPids.sort((a,b)=>a-b);}
  return value;
}
export function parseLaunchdList(text, target = label) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || !/^[A-Za-z0-9.-]{1,200}$/.test(target)) closed('supervisor_metadata_unavailable');
  const matches = text.split('\n').map(line => line.trim().split(/\s+/)).filter(row => row.length === 3 && row[2] === target);
  if (matches.length > 1) closed('supervisor_identity_ambiguous');
  if (!matches.length) return null;
  if (!/^[1-9]\d*$/.test(matches[0][0]) || !positive(Number(matches[0][0]))) closed('supervisor_not_running');
  return Number(matches[0][0]);
}
function supervisorPid() {
  const r = spawnSync('/bin/launchctl', ['list'], { encoding:'utf8', timeout:2000, maxBuffer:65536, stdio:['ignore','pipe','ignore'] });
  if (r.status !== 0) closed('supervisor_metadata_unavailable');
  return parseLaunchdList(r.stdout);
}
/** Known-label output only. Keep no environment/unrelated values or raw error
 * output. Duplicate, nested, shortened, or changed bindings fail closed. */
export function parseLoadedLaunchdBinding(text,{service=`${domain}/${label}`,plistPath=plist,basePath,nodeExecutable=process.execPath,wrapperPid}){
  if(typeof text!=='string'||Buffer.byteLength(text)>65536||!pidNumber(wrapperPid)||!isAbsolute(basePath))closed('loaded_launch_binding_unavailable');
  const lines=text.split('\n');if(lines.length>4096)closed('loaded_launch_binding_unavailable');
  const expectedArguments=[nodeExecutable,join(basePath,'current','studio-runtime.mjs'),'run'],found={},argumentsSeen=[];let depth=0,started=false,ended=false,argumentDepth=0;
  for(const raw of lines){
    const line=raw.trim();if(!line)continue;
    if(!started){if(line!==`${service} = {`)closed('loaded_launch_binding_unavailable');started=true;depth=1;continue;}
    if(ended)closed('loaded_launch_binding_unavailable');
    if(line==='}'){
      if(argumentDepth===depth){if(!same(argumentsSeen,expectedArguments))closed('loaded_launch_arguments_mismatch');argumentDepth=0;found.arguments=true;}
      if(--depth===0)ended=true;continue;
    }
    if(argumentDepth){if(depth!==argumentDepth||argumentsSeen.length>=3||line.includes('\0')||line.endsWith('= {'))closed('loaded_launch_arguments_mismatch');argumentsSeen.push(line);continue;}
    if(depth===1){
      if(line==='arguments = {'){if(found.arguments||argumentsSeen.length)closed('loaded_launch_duplicate');argumentDepth=++depth;continue;}
      for(const [key,expected] of [['path',plistPath],['program',nodeExecutable],['pid',String(wrapperPid)]]){
        if(line.startsWith(`${key} = `)){if(Object.hasOwn(found,key)||line!==`${key} = ${expected}`)closed('loaded_launch_binding_mismatch');found[key]=true;}
      }
    }
    if(line.endsWith('= {')&&++depth>8)closed('loaded_launch_binding_unavailable');
  }
  if(!ended||depth!==0||argumentDepth||!['path','program','pid','arguments'].every(k=>found[k]===true))closed('loaded_launch_binding_unavailable');
  return {pathMatches:true,programMatches:true,argumentsMatch:true,pidMatches:true};
}
function loadedLaunchBinding(basePath){
  if(metadataFile(plist,16384)?.text!==launchAgentContents(basePath,process.execPath))closed('launch_plist_binding_mismatch');
  const pid=supervisorPid();if(pid===null)closed('loaded_launch_binding_unavailable');
  const r=spawnSync('/bin/launchctl',['print',`${domain}/${label}`],{env:{},encoding:'utf8',timeout:2000,maxBuffer:65536,stdio:['ignore','pipe','ignore']});
  if(r.error||r.signal||r.status!==0)closed('loaded_launch_binding_unavailable');
  parseLoadedLaunchdBinding(r.stdout,{basePath,wrapperPid:pid});if(supervisorPid()!==pid)closed('loaded_launch_binding_changed');return true;
}
const processIdentity = row => [row.pid,row.ppid,row.uid,row.pgid,row.startAbsTicks,row.startSeconds,row.startMicroseconds];
export function captureLegacyRuntimeIdentity({ base: basePath, release, nativeQuery, supervisorPid: loadedPid, launchBinding = () => loadedLaunchBinding(basePath) }) {
  if (release.revision !== LEGACY_REVISION || hash(readFileSync(join(release.path,'studio-runtime.mjs'))) !== LEGACY_WRAPPER_SHA) closed('legacy_launch_binding_unavailable');
  if (!launchBinding()) closed('legacy_launch_binding_unavailable');
  const pidFile = metadataFile(join(basePath,'server.pid'),128);
  if (!pidFile || !/^[1-9]\d*$/.test(pidFile.text.trim())) closed('legacy_child_identity_unavailable');
  const childPid = Number(pidFile.text.trim()), wrapperPid = loadedPid();
  if (!positive(childPid) || !positive(wrapperPid)) closed('legacy_process_identity_unavailable');
  const rows=captureRuntimeProcessTree({base:basePath,release,wrapperPid,childPid,nativeQuery});
  if (!same(metadataFile(join(basePath,'server.pid'),128),pidFile) || loadedPid()!==wrapperPid) closed('legacy_process_identity_changed');
  return { kind:'legacy', release:tuple(release), artifactIdentity:release.identity, pidFile, rows, wrapperPid, childPid };
}
export function captureRuntimeProcessTree({base:basePath,release,wrapperPid,childPid,nativeQuery}) {
  const baseIdentity=privateMetadataBase(basePath);
  assertReleaseDirectory(release.path,release.identity);
  const wrapper=nativeQuery(wrapperPid), child=childPid===null ? null : nativeQuery(childPid);
  if (wrapper.status!=='ok' || wrapper.uid!==(process.geteuid?.()??process.getuid()) || wrapper.executablePath!==process.execPath || !cwdMatches(wrapper,basePath,baseIdentity) || wrapper.pgid!==wrapper.pid ||
      !same(wrapper.childPids,childPid===null?[]:[childPid]) || child && (child.status!=='ok' || child.ppid!==wrapper.pid)) closed('managed_launch_binding_unavailable');
  const rows = [wrapper], queue = child ? [[child,1]] : [], seen = new Set([wrapper.pid]); const started = Date.now(); let bytes=Buffer.byteLength(JSON.stringify(wrapper));
  while (queue.length) {
    const [row,depth] = queue.shift();
    bytes+=Buffer.byteLength(JSON.stringify(row));
    if (depth > 8 || rows.length >= 64 || bytes>65536 || Date.now()-started > 2000 || row.status !== 'ok' || seen.has(row.pid) || row.uid !== wrapper.uid || row.pgid !== wrapper.pgid || row.executablePath !== process.execPath || !cwdMatches(row,release.path,release.identity)) closed('managed_process_tree_unavailable');
    rows.push(row); seen.add(row.pid);
    for (const pid of row.childPids) { const next = nativeQuery(pid); if (next.status !== 'ok' || next.ppid !== row.pid) closed('legacy_process_tree_changed'); queue.push([next,depth+1]); }
  }
  if (!same([...wrapper.processGroupPids].sort((a,b)=>a-b), [...seen].sort((a,b)=>a-b))) closed('legacy_process_group_ambiguous');
  for (const row of rows) { const latest=nativeQuery(row.pid); if (latest.status!=='ok'||!same(latest,row)) closed('legacy_process_tree_changed'); }
  if(!same(privateMetadataBase(basePath),baseIdentity))closed('managed_base_identity_changed');
  assertReleaseDirectory(release.path,release.identity);
  return rows;
}
export function assertLegacyRuntimeStopped(snapshot, { nativeQuery, supervisorPid: loadedPid, listening: portOpen }) {
  if (loadedPid() !== null || portOpen) closed('legacy_process_tree_not_stopped');
  for (const row of snapshot.rows) if (parseProcessMetadata(JSON.stringify(nativeQuery(row.pid)),row.pid).status !== 'absent') closed('legacy_process_tree_not_stopped');
  const group=parseProcessMetadata(JSON.stringify(nativeQuery(snapshot.wrapperPid)),snapshot.wrapperPid);
  if (group.status!=='absent' || group.processGroupPids.length) closed('legacy_process_group_not_stopped');
}
/** Later independently dispatched host gate only. No operation acquisition,
 * record admission, provider call, stop, signal, receipt write or retirement. */
export function qualifyLegacyRuntimePreflight({base:basePath,expected,artifactRoot,expectedArtifact,expectedConfigurationDigest}){
  privateMetadataBase(basePath);
  if(!digest(expectedConfigurationDigest)||!expected||!releaseIdentity(tuple(expected))||expected.revision!==LEGACY_REVISION||!expectedArtifact||!releaseIdentity(tuple(expectedArtifact))||!digest(expectedArtifact.manifestDigest)||!digest(expectedArtifact.binaryDigest))closed('preflight_expected_binding_invalid');
  const current=readCurrent(basePath),configuration=metadataFile(join(basePath,'production.env'),65536),artifact=metadataArtifact(artifactRoot);
  if(current.absent||current.release.path!==expected.path||!same(tuple(current.release),tuple(expected))||configuration?.digest!==expectedConfigurationDigest||artifact.manifestFile.digest!==expectedArtifact.manifestDigest||artifact.binaryHash!==expectedArtifact.binaryDigest||!same(tuple(artifact.manifest),tuple(expectedArtifact)))closed('preflight_expected_binding_mismatch');
  const env=parseEnv(configuration.text),dataRoot=env.STUDIO_DATA_DIR,rootIdentity=privateMetadataBase(dataRoot);
  const fence=()=>{
    if(info(join(basePath,'.studio-operation.lock'))||inspectFileRuntimeOwner(dataRoot)||info(join(dataRoot,'adaptive',FILE_RUNTIME_OWNER_MARKER))||readRuntimeProcessReceipt(basePath)||metadataFile(join(basePath,STOPPED_RECEIPT),16384))closed('preflight_ownership_or_operation_changed');
    assertCurrent(basePath,current);
    if(!same(metadataFile(join(basePath,'production.env'),65536),configuration)||!same(privateMetadataBase(dataRoot),rootIdentity)||!same(metadataArtifact(artifactRoot),artifact))closed('preflight_metadata_changed');
  };
  fence();
  const captured=captureLegacyRuntimeIdentity({base:basePath,release:current.release,nativeQuery:pid=>nativeProcessQuery(artifactRoot,pid),supervisorPid});
  fence();
  return {version:1,status:'read_only_legacy_identity_qualified',release:tuple(current.release),artifact:tuple(artifact.manifest),manifestDigest:artifact.manifestFile.digest,binaryDigest:artifact.binaryHash,
    configurationDigest:configuration.digest,rootIdentityDigest:hash(JSON.stringify(rootIdentity)),preciseProcessIdentityDigest:hash(JSON.stringify(captured.rows.map(processIdentity))),
    processCount:captured.rows.length,loadedBindingMatches:true,sourceWrapperMatches:true,privateRecordsRead:false,stopped:false};
}
function envLine(key, value) {
  // Dotenv does not use JSON string escapes. Verify exact round trips before
  // replacing a configuration containing the token encryption key.
  for (const quote of ["'", '"', '`']) {
    if (value.includes(quote)) continue;
    const line = `${key}=${quote}${value}${quote}`;
    if (parseEnv(line)[key] === value) return line;
  }
  throw new Error(`${key} cannot be safely encoded as dotenv; the existing file was preserved.`);
}
function privateDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  privateMetadataBase(realpathSync(path));
  if (realpathSync(path)!==resolve(path)) closed('directory_alias_refused');
}
function config() {
  if (!existsSync(envFile)) throw new Error('Run prepare first, then fill in production.env.');
  return { ...readEnv(envFile), NODE_ENV: 'production', STUDIO_STORAGE: 'file', STUDIO_PUBLIC_URL: '', STUDIO_ONLY: '1', STUDIO_BOTS: '1' };
}
function prepare() {
  privateDir(base);
  const source = readEnv(resolve(process.argv[3] ?? join(root, '.env.local')));
  const env = readEnv(envFile);
  // Existing values, including an intentional empty/off setting, take priority.
  // Only allowlisted source values are imported; existing private extensions
  // are retained so preparing a release cannot silently erase configured policy.
  for (const key of keys) if (!Object.hasOwn(env, key) && Object.hasOwn(source, key)) env[key] = source[key];
  env.STUDIO_SECRET ||= randomBytes(32).toString('hex');
  env.STUDIO_DATA_DIR ||= join(base, 'data');
  env.VOXX_BOT_USERNAME ||= 'VoxxBot';
  env.STUDIO_ORG_NAME ||= 'HOOR';
  const contents = [...new Set([...keys, ...Object.keys(env)])].map(k => envLine(k, env[k] ?? '')).join('\n') + '\n';
  const temporary = `${envFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, envFile);
  } finally { rmSync(temporary, { force: true }); }
  chmodSync(envFile, 0o600);
  privateDir(env.STUDIO_DATA_DIR);
  return `Production configuration prepared: ${envFile}\nExisting secret values were preserved. No service has been started.`;
}
async function check() {
  const env = config();
  const missing = ['STUDIO_SECRET', 'VOXX_BOT_TOKEN', 'STUDIO_SUPERADMIN_IDS', 'STUDIO_WEBAPP_URL', 'STUDIO_DATA_DIR', 'ANTHROPIC_API_KEY'].filter(k => !env[k]);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  if (env.STUDIO_SECRET.length < 32) throw new Error('STUDIO_SECRET must have at least 32 characters.');
  if (!env.STUDIO_DATA_DIR.startsWith('/') || env.STUDIO_DATA_DIR === '/') throw new Error('STUDIO_DATA_DIR must be an absolute private directory.');
  if (!env.STUDIO_SUPERADMIN_IDS.split(/[,\s]+/).filter(Boolean).every(x => /^[1-9]\d*$/.test(x) && Number.isSafeInteger(Number(x)))) throw new Error('Invalid STUDIO_SUPERADMIN_IDS.');
  const url = new URL(env.STUDIO_WEBAPP_URL);
  if (url.protocol !== 'https:' || !/^\/studio\/?$/.test(url.pathname) || url.username || url.password || url.search || url.hash) throw new Error('STUDIO_WEBAPP_URL must be a public HTTPS URL ending in /studio.');
  // Never log URLs or exception objects containing the Telegram token.
  const response = await fetch(`https://api.telegram.org/bot${env.VOXX_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const bot = response ? await response.json().catch(() => null) : null;
  if (!bot?.ok) throw new Error('VoxxBot authentication failed. Check VOXX_BOT_TOKEN.');
  if (bot.result.username?.toLowerCase() !== env.VOXX_BOT_USERNAME.toLowerCase()) throw new Error('VOXX_BOT_TOKEN belongs to a different bot than VOXX_BOT_USERNAME.');
  const modelsResponse = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const models = modelsResponse?.ok ? await modelsResponse.json() : null;
  if (!models?.data) throw new Error('Anthropic authentication/model lookup failed.');
  for (const model of new Set([env.STUDIO_CHAT_MODEL || 'claude-sonnet-5-5', env.STUDIO_VOICE_MODEL || 'claude-haiku-5-5', env.STUDIO_PERSONA_MODEL || 'claude-sonnet-5-5'])) {
    if (!models.data.some(x => x.id === model)) throw new Error(`Anthropic model unavailable: ${model}`);
  }
  console.log(`✓ Telegram: @${bot.result.username}`);
  console.log('✓ Anthropic: key valid, chat and persona models available');
  // A webhook on the manager bot means another deployment (e.g. Firebase) owns
  // its updates; long polling here would fight it.
  const hook = await fetch(`https://api.telegram.org/bot${env.VOXX_BOT_TOKEN}/getWebhookInfo`, { signal: AbortSignal.timeout(15_000) })
    .then(r => r.json()).catch(() => null);
  if (hook?.result?.url) {
    throw new Error(`@${bot.result.username} has a webhook (${new URL(hook.result.url).host}). Another deployment owns this bot; run only one.`);
  }
  // Read-only provider checks: no images, transcriptions or speech are generated.
  if (env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response?.ok) throw new Error(`OpenAI authentication failed${response ? ` (HTTP ${response.status})` : ''}. Check OPENAI_API_KEY.`);
    const ids = new Set(((await response.json().catch(() => null))?.data ?? []).map(m => m.id));
    for (const model of [env.OPENAI_IMAGE_MODEL || 'gpt-image-1', env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe']) {
      if (!ids.has(model)) throw new Error(`OpenAI model unavailable to this key: ${model}`);
    }
    console.log('✓ OpenAI: key valid, image and transcription models available');
    // Reply triage uses the Decisions API; replies still work without it, just slower.
    const decisions = env.STUDIO_DECISIONS === 'off' ? null : env.OPENAI_DECISION_MODEL || 'gpt-6-luna';
    if (decisions && ids.has(decisions)) console.log(`✓ OpenAI Decisions: ${decisions} available for fast reply triage`);
    else if (decisions) console.log(`  ! OpenAI Decisions model ${decisions} not available to this key (needs the Decisions permission): replies skip triage.`);
  } else console.log('– OpenAI: OPENAI_API_KEY absent (no avatars, no calls)');
  if (env.ELEVENLABS_API_KEY) {
    const headers = { 'xi-api-key': env.ELEVENLABS_API_KEY };
    const response = await fetch('https://api.elevenlabs.io/v1/models', { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response?.ok) throw new Error(`ElevenLabs authentication failed${response ? ` (HTTP ${response.status})` : ''}. Check ELEVENLABS_API_KEY.`);
    const models = (await response.json().catch(() => null)) ?? [];
    const tts = env.ELEVENLABS_TTS_MODEL || 'eleven_v4';
    const speechModel = models.find(m => m.model_id === tts && m.can_do_text_to_speech);
    if (!speechModel) throw new Error(`ElevenLabs speech model unavailable to this key: ${tts}`);
    if (!speechModel.languages?.some(language => language.language_id === 'fa')) {
      console.log(`  ! ${tts} does not advertise Persian support. Set ELEVENLABS_TTS_MODEL=eleven_v4 for Persian agents.`);
    }
    const user = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const sub = user?.ok ? await user.json().catch(() => null) : null;
    if (sub && typeof sub.character_limit === 'number') {
      const left = sub.character_limit - (sub.character_count ?? 0);
      console.log(`✓ ElevenLabs: key valid, ${tts} available, ${left.toLocaleString('en-US')} characters left this period`);
      if (sub.tier === 'free') console.log('  ! ElevenLabs free plans cannot use Voice Library voices through the API. Choose a default voice or upgrade.');
      if (left < 1000) console.log('  ! ElevenLabs is nearly out of characters: voice replies will fail soon.');
    } else console.log(`✓ ElevenLabs: key valid, ${tts} available (subscription details not readable with this key)`);
    // Live calls create and use an ElevenLabs agent: the key needs the Agents permission.
    const agents = await fetch('https://api.elevenlabs.io/v1/convai/agents?page_size=1', { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (agents?.ok) console.log('✓ ElevenLabs Agents: available for live calls');
    else console.log(`  ! ElevenLabs Agents not accessible${agents ? ` (HTTP ${agents.status})` : ''}: give the key the "ElevenLabs Agents" permission for live calls.`);
  } else console.log('– ElevenLabs: ELEVENLABS_API_KEY absent (no voices)');
  console.log(`Preflight passed for @${bot.result.username} at ${url.origin}/studio.`);
  return env;
}
function running() { return spawnSync('/bin/launchctl', ['print', `${domain}/${label}`], { timeout:2000,stdio:'ignore' }).status === 0; }
function bootout() {
  const result=spawnSync('/bin/launchctl',['bootout',`${domain}/${label}`],{timeout:10000,stdio:'ignore'});
  if (result.status!==0) closed('supervisor_stop_failed');
}
function listenerClosed() {
  // PIDs only; never print socket owners, command lines, paths, or environments.
  const r=spawnSync('/usr/sbin/lsof',['-nP','-iTCP:3107','-sTCP:LISTEN','-t'],{encoding:'utf8',timeout:2000,maxBuffer:4096,stdio:['ignore','pipe','ignore']});
  if (r.error || r.signal || ![0,1].includes(r.status)) closed('listener_metadata_unavailable');
  return r.status===1 && r.stdout==='';
}
function removeReceipt(basePath,expected) {
  privateMetadataBase(basePath);
  if (!expected || !['exited','spawn_failed'].includes(expected.value.phase) || !same(readRuntimeProcessReceipt(basePath),expected)) closed('unretired_runtime_receipt');
  unlinkSync(join(basePath,PROCESS_RECEIPT)); syncDirectory(basePath);
}
export function readStoppedRuntimeReceipt(basePath){
  privateMetadataBase(basePath);const saved=metadataFile(join(basePath,STOPPED_RECEIPT),16384);if(!saved)return null;
  try{
    const r=JSON.parse(saved.text);
    if(!exact(r,['version','kind','revision','previousDigest','release','artifactIdentity','currentDigest','rootIdentity','terminalDigest','retiredHolderIdentity','retiredHolderDigest','configurationDigest','operationDigest','createdAt','processProof'])||
      r.version!==1||r.kind!=='studio-stopped-runtime'||!(r.release===null&&r.artifactIdentity===null||releaseIdentity(r.release)&&pathIdentity(r.artifactIdentity))||!digest(r.currentDigest)||!pathIdentity(r.rootIdentity)||!digest(r.terminalDigest)||
      !uint(r.revision)||r.revision>2||(r.revision===0?r.previousDigest!==null:!digest(r.previousDigest))||
      !(r.retiredHolderIdentity===null&&r.retiredHolderDigest===null||pathIdentity(r.retiredHolderIdentity)&&digest(r.retiredHolderDigest))||!digest(r.configurationDigest)||!digest(r.operationDigest)||!uint(r.createdAt))closed('invalid_stopped_receipt');
    // Reuse the exact strict native-row ABI, without accepting receipt strings
    // as runtime or maintenance authority.
    const terminal=readRuntimeProcessReceipt(basePath);if(!terminal||!['exited','spawn_failed'].includes(terminal.value.phase)||terminal.digest!==r.terminalDigest)closed('stopped_terminal_mismatch');
    parseRuntimeProcessReceipt(JSON.stringify({...terminal.value,processProof:r.processProof}));
    const wrapper=r.processProof.find(row=>row[0]===terminal.value.wrapperPid),originalWrapper=terminal.value.processProof.find(row=>row[0]===terminal.value.wrapperPid);
    if(!same(r.rootIdentity,terminal.value.rootIdentity)||!same(r.retiredHolderIdentity,terminal.value.holderIdentity)||r.retiredHolderDigest!==terminal.value.holderDigest||!wrapper||wrapper[3]!==terminal.value.wrapperPid||!same(wrapper,originalWrapper))closed('stopped_terminal_identity_mismatch');
    return {...saved,value:r};
  }catch{closed('invalid_stopped_receipt');}
}
function publishStoppedReceipt(basePath,value){
  if(metadataFile(join(basePath,STOPPED_RECEIPT),16384))closed('unconsumed_stopped_receipt');
  const bytes=JSON.stringify(value)+'\n';if(Buffer.byteLength(bytes)>16384)closed('stopped_receipt_capacity');
  atomicControl(basePath,STOPPED_RECEIPT,null,bytes,16384);return readStoppedRuntimeReceipt(basePath);
}
function removeStoppedReceipt(basePath,expected){
  if(!expected||!same(readStoppedRuntimeReceipt(basePath),expected))closed('stopped_receipt_changed');
  unlinkSync(join(basePath,STOPPED_RECEIPT));syncDirectory(basePath);
}
function ownerMatchesReceipt(owner,receipt) {
  const r=receipt.value;
  return owner===null ? r.holderIdentity===null : owner.record.role==='runtime' && owner.record.pid===r.childPid && same(owner.record.release,r.release) &&
    same(owner.rootIdentity,r.rootIdentity) && same(owner.guardIdentity,r.holderIdentity) && owner.digest===r.holderDigest && owner.record.nonce===r.holderNonce;
}
/** Injectable supervisor/native boundaries; filesystem ownership and operation
 * authorization remain the actual shared implementation, including in QA. */
export function createRuntimeHandoff({base:basePath,dataRoot,guard,maintenanceRelease,nativeQuery,supervisor=supervisorPid,portClosed=listenerClosed,
  stopSupervisor=bootout,pause=ms=>new Promise(done=>setTimeout(done,ms)),checkpoint=()=>{},configurationDigest,
  launchBinding=()=>loadedLaunchBinding(basePath),setCurrent=path=>pointToAt(basePath,path),clearSelected=()=>{unlinkSync(join(basePath,'current'));syncDirectory(basePath);}}) {
  const rootIdentity=privateMetadataBase(dataRoot), authorization=createMaintenanceAuthorization(guard.operationIdentity);
  const configuration=metadataFile(join(basePath,'production.env'),65536);
  if(!digest(configurationDigest)||configuration?.digest!==configurationDigest)closed('handoff_configuration_binding_mismatch');
  let proof=null, maintenance=null, retired=false,stoppedReceipt=null,launchExpectation=null;
  const fence=()=>{guard.assertOwned();checkpoint();if(!same(privateMetadataBase(dataRoot),rootIdentity)||!same(metadataFile(join(basePath,'production.env'),65536),configuration))closed('handoff_root_or_configuration_changed');};
  const absentProof=pid=>{const row=parseProcessMetadata(JSON.stringify(nativeQuery(pid)),pid);if(row.status!=='absent')closed('managed_process_not_stopped');return row;};
  const assertStopped=()=>{
    fence(); if(!proof||supervisor()!==null||!portClosed())closed('managed_runtime_not_stopped');
    if(proof.tree){for(const row of proof.tree.rows)absentProof(row.pid);if(absentProof(proof.tree.wrapperPid).processGroupPids.length)closed('managed_group_not_stopped');}
    if(proof.terminal?.value.childPid!==undefined&&proof.terminal.value.childPid!==null)absentProof(proof.terminal.value.childPid);
    if(proof.terminal&&!same(readRuntimeProcessReceipt(basePath),proof.terminal))closed('terminal_witness_changed');
    if(stoppedReceipt&&!same(readStoppedRuntimeReceipt(basePath),stoppedReceipt))closed('stopped_receipt_changed');
    if(stoppedReceipt&&stoppedReceipt.value.currentDigest!==hash(JSON.stringify(readCurrent(basePath))))closed('stopped_control_changed');
    const owner=inspectFileRuntimeOwner(dataRoot);
    if(maintenance){maintenance.assertCurrent();if(!same(owner,maintenance.snapshot()))closed('maintenance_holder_changed');}
    else if(!same(owner,retired?null:proof.owner))closed('stopped_holder_changed');
    fence();
  };
  const changeCurrent=(path)=>{
    assertStopped();if(!maintenance)closed('pointer_change_requires_maintenance');
    if(stoppedReceipt&&stoppedReceipt.value.revision>=2)closed('stopped_receipt_rebind_refused');
    const target=path===null?null:readRelease(path);
    if(path===null)clearSelected();else setCurrent(path);
    fence();const current=readCurrent(basePath);
    if(target?current.absent||!same(current.release,target):!current.absent)closed('selected_release_mismatch');
    if(stoppedReceipt){
      const old=stoppedReceipt;if(old.value.revision>=2||!same(readStoppedRuntimeReceipt(basePath),old))closed('stopped_receipt_rebind_refused');
      const next={...old.value,revision:old.value.revision+1,previousDigest:old.digest,release:current.absent?null:tuple(current.release),artifactIdentity:current.absent?null:current.release.identity,currentDigest:hash(JSON.stringify(current))};
      atomicControl(basePath,STOPPED_RECEIPT,receiptFile(old),JSON.stringify(next)+'\n',16384);stoppedReceipt=readStoppedRuntimeReceipt(basePath);
    }
    assertStopped();
  };
  return Object.freeze({
    assertStopped,
    pointTo:path=>changeCurrent(path),clearCurrent:()=>changeCurrent(null),
    async stop(){
      fence();
      // Cancellation between releasing maintenance and starting a child is an
      // already-proven stopped interval, never authority to stop a foreign job.
      if(proof&&supervisor()===null){assertStopped();return;}
      const current=readCurrent(basePath), owner=inspectFileRuntimeOwner(dataRoot), captured=readRuntimeProcessReceipt(basePath), loaded=supervisor();
      if(loaded===null){
        stoppedReceipt=readStoppedRuntimeReceipt(basePath);
        if(launchExpectation&&captured&&!stoppedReceipt){
          const r=captured.value,wrapper=r.processProof.find(row=>row[0]===r.wrapperPid);
          if(!['exited','spawn_failed'].includes(r.phase)||current.absent||!same(current,launchExpectation.current)||r.operationDigest!==launchExpectation.operationDigest||!same(r.release,tuple(current.release))||!same(r.artifactIdentity,current.release.identity)||!same(r.rootIdentity,rootIdentity)||!ownerMatchesReceipt(owner,captured)||!wrapper||wrapper[3]!==r.wrapperPid)closed('startup_terminal_witness_mismatch');
          const rows=r.processProof.map(row=>({pid:row[0],ppid:row[1],uid:row[2],pgid:row[3],startAbsTicks:row[4],startSeconds:row[5],startMicroseconds:row[6]}));
          proof={owner,terminal:captured,release:current.release,tree:{wrapperPid:r.wrapperPid,rows}};retired=false;assertStopped();return;
        }
        if(current.absent&&!stoppedReceipt){if(owner||captured||!portClosed())closed('unidentified_initial_runtime');proof={owner:null,tree:null,terminal:null};retired=false;return;}
        const r=stoppedReceipt?.value;
        if(!r||owner||!captured||r.currentDigest!==hash(JSON.stringify(current))||!same(r.release,current.absent?null:tuple(current.release))||!same(r.artifactIdentity,current.absent?null:current.release.identity)||!same(r.rootIdentity,rootIdentity)||r.configurationDigest!==configurationDigest||!same(r.retiredHolderIdentity,captured.value.holderIdentity)||r.retiredHolderDigest!==captured.value.holderDigest)closed('missing_explicit_stopped_witness');
        const wrapper=r.processProof.find(row=>row[0]===captured.value.wrapperPid);if(!wrapper||wrapper[3]!==captured.value.wrapperPid)closed('stopped_precise_wrapper_proof_unavailable');
        proof={owner:null,terminal:captured,release:current.release,tree:{wrapperPid:captured.value.wrapperPid,rows:r.processProof.map(row=>({pid:row[0]}))}};retired=true;assertStopped();return;
      }
      if(current.absent)closed('unidentified_live_runtime');
      if(readStoppedRuntimeReceipt(basePath))closed('unconsumed_stopped_receipt');
      let tree, cursor=captured;
      if(!captured){
        if(owner)closed('missing_runtime_receipt');
        tree=captureLegacyRuntimeIdentity({base:basePath,release:current.release,nativeQuery,supervisorPid:supervisor,launchBinding});
      }else{
        const r=captured.value;
        if(launchExpectation&&(!same(current,launchExpectation.current)||r.operationDigest!==launchExpectation.operationDigest))closed('startup_operation_witness_mismatch');
        if(!['starting','running'].includes(r.phase)||r.wrapperPid!==loaded||!same(r.release,tuple(current.release))||!same(r.artifactIdentity,current.release.identity)||!same(r.rootIdentity,rootIdentity)||!ownerMatchesReceipt(owner,captured)||!launchBinding())closed('runtime_witness_mismatch');
        const rows=captureRuntimeProcessTree({base:basePath,release:current.release,wrapperPid:r.wrapperPid,childPid:r.childPid,nativeQuery});
        tree={kind:'witness',rows,wrapperPid:r.wrapperPid,childPid:r.childPid};
      }
      fence();assertCurrent(basePath,current);
      if(!same(inspectFileRuntimeOwner(dataRoot),owner)||!same(readRuntimeProcessReceipt(basePath),captured)||supervisor()!==loaded||!launchBinding())closed('runtime_changed_before_stop');
      stopSupervisor();
      for(let attempt=0;attempt<60;attempt++){
        fence();assertCurrent(basePath,current);
        if(cursor){const latest=readRuntimeProcessReceipt(basePath);if(!latest)closed('missing_terminal_witness');if(latest.digest!==cursor.digest){assertRuntimeProcessSuccessor(cursor,latest.value);cursor=latest;}}
        const terminal=!cursor||['exited','spawn_failed'].includes(cursor.value.phase);
        if(terminal&&supervisor()===null&&portClosed()){
          proof={owner,tree,terminal:cursor,release:current.release};retired=false;assertStopped();return;
        }
        await pause(250);
      }
      closed('managed_stop_deadline');
    },
    acquireStopped(){
      assertStopped();if(maintenance)return;
      if(proof.owner&&!retired){retireStoppedFileRuntimeOwner({dataRoot,expected:proof.owner,authorization,assertStopped});retired=true;}
      if(inspectFileRuntimeOwner(dataRoot)!==null)closed('unexpected_stopped_holder');
      maintenance=acquireFileRuntimeOwner({dataRoot,release:tuple(maintenanceRelease),role:'maintenance',authorization});assertStopped();
    },
    releaseStopped(){
      assertStopped();if(!maintenance)return;
      if(proof.terminal&&!stoppedReceipt){
        const operation=metadataFile(join(basePath,'.studio-operation.lock','owner.json'));
        if(!operation||!digest(configurationDigest))closed('stopped_operation_binding_unavailable');
        const processProof=proof.tree.rows.map(row=>Array.isArray(row)?row:processIdentity(row));
        const current=readCurrent(basePath);
        stoppedReceipt=publishStoppedReceipt(basePath,{version:1,kind:'studio-stopped-runtime',revision:0,previousDigest:null,release:current.absent?null:tuple(current.release),artifactIdentity:current.absent?null:current.release.identity,currentDigest:hash(JSON.stringify(current)),rootIdentity,
          terminalDigest:proof.terminal.digest,retiredHolderIdentity:proof.owner?.guardIdentity??null,retiredHolderDigest:proof.owner?.digest??null,
          configurationDigest,operationDigest:operation.digest,createdAt:Date.now(),processProof});
      }
      releaseMaintenanceFileRuntimeOwner(maintenance,authorization);maintenance=null;retired=true;assertStopped();
    },
    beforeStart(){
      assertStopped();if(maintenance)closed('maintenance_held_during_start');
      if(inspectFileRuntimeOwner(dataRoot)!==null)closed('runtime_holder_not_retired');
      if(stoppedReceipt){removeStoppedReceipt(basePath,stoppedReceipt);stoppedReceipt=null;}
      if(proof.terminal)removeReceipt(basePath,proof.terminal);
      const current=readCurrent(basePath),operation=metadataFile(join(basePath,'.studio-operation.lock','owner.json'));
      if(current.absent||!operation)closed('launch_expectation_unavailable');
      launchExpectation={current,operationDigest:operation.digest};
      proof=null;retired=false;
    },
    snapshot:()=>proof,
  });
}
export function recoverStoppedRuntimeOwner({base:basePath,dataRoot,guard,release,expected,nativeQuery,configurationDigest,supervisor=supervisorPid,portClosed=listenerClosed,checkpoint=()=>{}}){
  const authorization=createMaintenanceAuthorization(guard.operationIdentity),receipt=readRuntimeProcessReceipt(basePath),rootIdentity=privateMetadataBase(dataRoot),owner=inspectFileRuntimeOwner(dataRoot);
  const current=readCurrent(basePath),configuration=metadataFile(join(basePath,'production.env'),65536);
  if(current.absent||!same(current.release,release)||!digest(configurationDigest)||configuration?.digest!==configurationDigest)closed('recovery_current_or_configuration_mismatch');
  if(!receipt||!['exited','spawn_failed'].includes(receipt.value.phase)||receipt.digest!==expected.receiptDigest||!same(rootIdentity,expected.rootIdentity)||
    !same(receipt.value.rootIdentity,rootIdentity)||!same(receipt.value.release,tuple(release))||!same(receipt.value.artifactIdentity,release.identity)||!ownerMatchesReceipt(owner,receipt)||
    !same(owner?.guardIdentity??null,expected.holderIdentity)|| (owner?.digest??null)!==expected.holderDigest)closed('recovery_expected_identity_mismatch');
  const wrapper=receipt.value.processProof.find(row=>row[0]===receipt.value.wrapperPid);
  if(!wrapper||wrapper[3]!==receipt.value.wrapperPid)closed('recovery_precise_wrapper_proof_unavailable');
  const assertStopped=()=>{
    guard.assertOwned();checkpoint();assertCurrent(basePath,current);
    if(!same(metadataFile(join(basePath,'production.env'),65536),configuration))closed('recovery_configuration_changed');
    if(supervisor()!==null||!portClosed()||!same(privateMetadataBase(dataRoot),rootIdentity)||!same(readRuntimeProcessReceipt(basePath),receipt)||!same(inspectFileRuntimeOwner(dataRoot),owner))closed('recovery_state_changed');
    for(const row of receipt.value.processProof){const found=nativeQuery(row[0]);if(found.status!=='absent'||!Array.isArray(found.processGroupPids))closed('recovery_process_not_absent');}
    const group=nativeQuery(receipt.value.wrapperPid);
    if(group.status!=='absent'||!Array.isArray(group.processGroupPids)||group.processGroupPids.length)closed('recovery_group_not_empty');
    if(receipt.value.childPid!==null&&nativeQuery(receipt.value.childPid).status!=='absent')closed('recovery_child_not_absent');
    guard.assertOwned();checkpoint();
  };
  assertStopped();if(readStoppedRuntimeReceipt(basePath))closed('unconsumed_stopped_receipt');
  if(owner)retireStoppedFileRuntimeOwner({dataRoot,expected:owner,authorization,assertStopped});
  else if(inspectFileRuntimeOwner(dataRoot)!==null)closed('recovery_new_holder');
  guard.assertOwned();checkpoint();
  if(inspectFileRuntimeOwner(dataRoot)!==null||!same(privateMetadataBase(dataRoot),rootIdentity)||supervisor()!==null||!portClosed())closed('recovery_state_changed');
  const operation=metadataFile(join(basePath,'.studio-operation.lock','owner.json'));
  if(!operation||!digest(configurationDigest))closed('recovery_operation_binding_unavailable');
  assertCurrent(basePath,current);
  publishStoppedReceipt(basePath,{version:1,kind:'studio-stopped-runtime',revision:0,previousDigest:null,release:tuple(release),artifactIdentity:release.identity,currentDigest:hash(JSON.stringify(current)),rootIdentity,terminalDigest:receipt.digest,
    retiredHolderIdentity:owner?.guardIdentity??null,retiredHolderDigest:owner?.digest??null,configurationDigest,operationDigest:operation.digest,createdAt:Date.now(),processProof:receipt.value.processProof});
  return {version:1,status:'stopped_owner_retired',release:tuple(release),receiptDigest:receipt.digest,markerPreserved:true};
}
export function parseRuntimeRecoveryExpected(args){
  const allowed=['--expect-current','--expect-revision','--expect-build','--expect-root','--expect-root-dev','--expect-root-ino','--expect-root-birth',
    '--expect-holder-dev','--expect-holder-ino','--expect-holder-birth','--expect-holder-digest','--expect-no-holder','--expect-receipt-digest'];
  const flags={};for(let i=0;i<args.length;i++){
    const key=args[i];if(!allowed.includes(key)||Object.hasOwn(flags,key))closed('invalid_recovery_options');
    if(key==='--expect-no-holder')flags[key]=true;else{const value=args[++i];if(!value||value.startsWith('--'))closed('invalid_recovery_options');flags[key]=value;}
  }
  const baseline=parseExpected(['--expect-current',flags['--expect-current']??'','--expect-revision',flags['--expect-revision']??'','--expect-build',flags['--expect-build']??''],'recover-runtime-owner');
  const root=flags['--expect-root'],rootIdentity=Object.fromEntries(['dev','ino','birth'].map(key=>[key,flags[`--expect-root-${key}`]]));
  if(!root||!isAbsolute(root)||resolve(root)!==root||!pathIdentity(rootIdentity)||!digest(flags['--expect-receipt-digest']))closed('invalid_recovery_options');
  const noHolder=flags['--expect-no-holder']===true,holderIdentity=noHolder?null:Object.fromEntries(['dev','ino','birth'].map(key=>[key,flags[`--expect-holder-${key}`]]));
  if(noHolder?['dev','ino','birth','digest'].some(key=>Object.hasOwn(flags,`--expect-holder-${key}`)):!pathIdentity(holderIdentity)||!digest(flags['--expect-holder-digest']))closed('invalid_recovery_options');
  return {baseline,root,rootIdentity,holderIdentity,holderDigest:noHolder?null:flags['--expect-holder-digest'],receiptDigest:flags['--expect-receipt-digest']};
}
function start() {
  const result = spawnSync('/bin/launchctl', ['bootstrap', domain, plist], { timeout:10000,stdio:'ignore' });
  if (result.status !== 0) throw new Error('Could not start launch agent; inspect launchctl status.');
}
export function snapshotProductionData(dataRoot, destination) {
  const rootIdentity=privateMetadataBase(dataRoot);
  cpSync(dataRoot,join(destination,'data'),{recursive:true,filter:source=>source!==join(dataRoot,FILE_RUNTIME_OWNER_GUARD)});
  if (!same(privateMetadataBase(dataRoot),rootIdentity) || existsSync(join(destination,'data',FILE_RUNTIME_OWNER_GUARD))) closed('backup_owner_changed');
}
function snapshot() {
  const env = config();
  if (!existsSync(env.STUDIO_DATA_DIR)) return;
  privateDir(join(base, 'backups'));
  const dest = join(base, 'backups', stamp());
  privateDir(dest);
  snapshotProductionData(env.STUDIO_DATA_DIR,dest);
  cpSync(envFile, join(dest, 'production.env'));
  chmodSync(join(dest, 'production.env'), 0o600);
  console.log(`Stopped-process backup: ${dest}`);
}
function pointToAt(basePath,path) {
  const temp = join(basePath, `current-${process.pid}-${randomBytes(8).toString('hex')}`);
  try {
    symlinkSync(path, temp);
    renameSync(temp, join(basePath, 'current'));syncDirectory(basePath);
  } finally { rmSync(temp, { force: true }); }
}
function xml(value) { return String(value).replace(/[<>&"']/g, x => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[x]); }
export function launchAgentContents(base, executable) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(executable)}</string><string>${xml(join(base, 'current', 'studio-runtime.mjs'))}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict><key>VOX_PRODUCTION_DIR</key><string>${xml(base)}</string></dict>
<key>WorkingDirectory</key><string>${xml(base)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(base, 'logs', 'server.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(base, 'logs', 'error.log'))}</string>
</dict></plist>\n`;
}
function installPlist() {
  privateDir(join(base, 'logs'));
  mkdirSync(dirname(plist), { recursive: true });
  const contents=launchAgentContents(base,process.execPath);
  const temporary = `${plist}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, plist);
  } finally { rmSync(temporary, { force: true }); }
}
export function verifyRuntimeReadiness({base:basePath,dataRoot,release,operationDigest,supervisor=supervisorPid}) {
  const receipt=readRuntimeProcessReceipt(basePath);
  if(!receipt||receipt.value.phase==='starting')return false;
  const owner=inspectFileRuntimeOwner(dataRoot),r=receipt.value;
  if(r.phase!=='running'||!same(r.release,tuple(release))||!same(r.artifactIdentity,release.identity)||!same(r.rootIdentity,privateMetadataBase(dataRoot))||
    !ownerMatchesReceipt(owner,receipt)||!owner||r.wrapperPid!==supervisor()||operationDigest!==undefined&&r.operationDigest!==operationDigest)closed('runtime_readiness_identity_mismatch');
  return true;
}
async function ready(revision, checkpoint) {
  const current=readCurrent(base);if(current.absent||current.release.revision!==revision)closed('readiness_release_mismatch');
  const env=config(),operation=metadataFile(join(base,'.studio-operation.lock','owner.json'));
  for (let attempt = 0; attempt < 15; attempt++) {
    checkpoint();
    const response = await fetch('http://127.0.0.1:3107/api/studio/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
    const health = response?.ok ? await response.json().catch(() => null) : null;
    checkpoint();
    if(health?.status==='healthy'&&health.bots&&health.revision===revision){
      if(current.release.revision===LEGACY_REVISION){
        assertReleaseAdaptiveCompatibility(env,readInstalledReleaseManifest(current.release.path));
        if(inspectFileRuntimeOwner(env.STUDIO_DATA_DIR)||readRuntimeProcessReceipt(base))closed('legacy_readiness_owner_mismatch');
        captureLegacyRuntimeIdentity({base,release:current.release,nativeQuery:pid=>nativeProcessQuery(metadataArtifactDirectory(),pid),supervisorPid});return;
      }
      if(verifyRuntimeReadiness({base,dataRoot:env.STUDIO_DATA_DIR,release:current.release,operationDigest:operation?.digest??null}))return;
    }
    await new Promise(done => setTimeout(done, 2000));
  }
  throw new Error('New release failed its readiness check.');
}
function metadataArtifactDirectory(){return basename(fileURLToPath(import.meta.url))==='studio-runtime.mjs'?dirname(fileURLToPath(import.meta.url)):join(root,'.next');}
function transitionOperations(guard,baseline,target=baseline?.release) {
  const env=config(),configuration=metadataFile(envFile,65536),dataRoot=env.STUDIO_DATA_DIR;
  if(!target)closed('missing_maintenance_release');
  privateMetadataBase(dataRoot);
  const metadataArtifactRoot=metadataArtifactDirectory();
  const checkpoint=()=>{if(!same(metadataFile(envFile,65536),configuration))closed('handoff_configuration_changed');};
  const handoff=createRuntimeHandoff({base,dataRoot,guard,maintenanceRelease:target,nativeQuery:pid=>nativeProcessQuery(metadataArtifactRoot,pid),checkpoint,configurationDigest:configuration?.digest});
  return {
    running, stop:handoff.stop, acquireStopped:handoff.acquireStopped,releaseStopped:handoff.releaseStopped,
    start:()=>{handoff.beforeStart();start();},snapshot:()=>{handoff.assertStopped();snapshot();handoff.assertStopped();},pointTo:handoff.pointTo,ready,
    clearCurrent:handoff.clearCurrent,
    compatible: release => {handoff.assertStopped();assertReleaseAdaptiveCompatibility(env,readInstalledReleaseManifest(release.path));handoff.assertStopped();},
  };
}
async function install(guard, baseline) {
  guard.check(); assertCurrent(base, baseline);
  const env = config();
  const artifact = join(root, '.next', 'standalone');
  if (!existsSync(join(artifact, 'server.js'))) throw new Error('Run npm run build first; standalone/server.js is missing.');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (!revision || dirty) throw new Error('Commit the tested release before installing it.');
  const sourceTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const manifest = existsSync(join(root, '.next', 'studio-release.json')) ? JSON.parse(readFileSync(join(root, '.next', 'studio-release.json'), 'utf8')) : null;
  const buildId = readFileSync(join(artifact, '.next', 'BUILD_ID'), 'utf8').trim();
  if (!manifest || manifest.revision !== revision || manifest.sourceTree !== sourceTree || manifest.buildId !== buildId || buildId !== readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim()) {
    throw new Error('Build provenance does not match this committed source. Run npm run studio:build.');
  }
  const nativeArtifact=manifest.runtimeProcessMetadata?.available===true?metadataArtifact(join(root,'.next')):null;
  if(nativeArtifact&&(!same(nativeArtifact.manifest,manifest)||hash(readFileSync(join(root,'scripts','native','studio-process-metadata-darwin.c')))!==manifest.runtimeProcessMetadata.sourceSha256))closed('native_process_artifact_changed');
  if(process.platform==='darwin'&&!nativeArtifact)closed('native_process_artifact_unavailable');
  assertReleaseAdaptiveCompatibility(env, manifest);
  await check();
  guard.check(); assertCurrent(base, baseline); // No release/config/previous mutation before this fence.
  const release = join(base, 'releases', `${stamp()}-${revision.slice(0, 12)}`);
  privateDir(join(base, 'releases'));
  mkdirSync(release, { mode: 0o700 }); // Exclusive creation: never adopt another operation's candidate.
  const createdIdentity = releaseDirectoryIdentity(release);
  cpSync(artifact, release, { recursive: true, filter: source => !/^\.env(?:\.|$)/.test(basename(source)) });
  cpSync(join(root, '.next', 'static'), join(release, '.next', 'static'), { recursive: true });
  cpSync(join(root, 'public'), join(release, 'public'), { recursive: true });
  cpSync(fileURLToPath(import.meta.url), join(release, 'studio-runtime.mjs'));
  cpSync(new URL('./studio-adaptive-compatibility.mjs', import.meta.url), join(release, 'studio-adaptive-compatibility.mjs'));
  cpSync(new URL('./studio-operation-guard.mjs', import.meta.url), join(release, 'studio-operation-guard.mjs'));
  cpSync(new URL('./studio-file-runtime-owner.mjs', import.meta.url), join(release, 'studio-file-runtime-owner.mjs'));
  if(manifest.runtimeProcessMetadata?.available===true){
    const metadata=manifest.runtimeProcessMetadata,path=nativeArtifact.path,s=info(path);
    if(metadata.version!==1||metadata.abi!==1||metadata.platform!=='darwin'||metadata.arch!=='arm64'||metadata.file!=='studio-process-metadata'||
      !s?.isFile()||s.nlink!==1n||(s.mode&0o077n)||!(s.mode&0o100n)||s.size!==BigInt(metadata.bytes)||hash(readFileSync(path))!==metadata.binarySha256||
      hash(readFileSync(join(root,'scripts','native','studio-process-metadata-darwin.c')))!==metadata.sourceSha256)closed('native_process_artifact_changed');
    cpSync(path,join(release,'studio-process-metadata'));chmodSync(join(release,'studio-process-metadata'),0o700);
    if(hash(readFileSync(join(release,'studio-process-metadata')))!==metadata.binarySha256)closed('native_process_copy_changed');
  }else if(process.platform==='darwin')closed('native_process_artifact_unavailable');
  cpSync(join(root, '.next', 'studio-release.json'), join(release, 'studio-release.json'));
  writeFileSync(join(release, 'revision'), revision + '\n');
  assertReleaseDirectory(release, createdIdentity);
  const target = readRelease(release);
  if (target.revision !== revision || target.sourceTree !== sourceTree || target.buildId !== buildId) throw new Error('Copied release provenance changed.');
  await transitionRelease(guard, baseline, target, {
    ...transitionOperations(guard,baseline,target),
    beforeSwitch: () => { if (!baseline.absent) writeFileSync(join(base, 'previous'), baseline.release.path); },
    afterSwitch: installPlist,
  });
  return `Installed revision ${revision}. Run status, then verify the public HTTPS endpoint and Telegram.`;
}
async function rollback(guard, baseline) {
  guard.check(); assertCurrent(base, baseline);
  const previous = readControlText(join(base, 'previous'));
  if (!existsSync(join(previous, 'server.js'))) throw new Error('Previous release is unavailable.');
  const target = readRelease(previous);
  assertReleaseAdaptiveCompatibility(config(), readInstalledReleaseManifest(previous));
  await transitionRelease(guard, baseline, target, transitionOperations(guard,baseline,target));
  return 'Previous release restored; verify status.';
}
async function status() {
  console.log(`Launch agent: ${running() ? 'loaded' : 'not loaded'}`);
  const response = await fetch('http://127.0.0.1:3107/api/studio/health', { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response) throw new Error('Studio is not reachable on 127.0.0.1:3107.');
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify(body));
  const expected = readFileSync(join(base, 'current', 'revision'), 'utf8').trim();
  if (!response.ok || body?.status !== 'healthy' || !body?.bots || body.revision !== expected) throw new Error('Studio readiness check failed.');
  const current=readCurrent(base);
  if(!current.absent&&readInstalledReleaseManifest(current.release.path).supportedFileRuntimeOwnerVersions?.includes(1)&&!verifyRuntimeReadiness({base,dataRoot:config().STUDIO_DATA_DIR,release:current.release}))closed('runtime_not_ready');
}
/** Attach only to the actual original ChildProcess. There is deliberately no
 * public finish/exit-witness method: terminal publication stays in its events. */
export function attachRuntimeProcessLifecycle({child,lifecycle,query,wrapper,base:basePath,release,dataRoot,exit=code=>process.exit(code),log=()=>console.error('Studio runtime witness unavailable; explicit reconciliation is required.')}){
  const baseIdentity=privateMetadataBase(basePath);
  const assertPaths=()=>{if(!same(privateMetadataBase(basePath),baseIdentity))closed('wrapper_base_identity_changed');assertReleaseDirectory(release.path,release.identity);};
  assertPaths();
  if(!(child instanceof ChildProcess)||wrapper.pid!==process.pid||!cwdMatches(wrapper,basePath,baseIdentity))closed('invalid_child_process_binding');
  let timer,terminal=false,stoppingSignal=null;
  let resolveSettled;const settled=new Promise(done=>{resolveSettled=done;});
  const failure=()=>{log();resolveSettled({status:'unavailable'});exit(1);};
  const finish=async(code,signal,spawnError=false)=>{
    if(terminal)return;terminal=true;clearInterval(timer);
    try{
      // Observations only: allow already exiting descendants to settle. Never
      // signal a discovered PID, retry an effect, or invent an exit witness.
      let drained=false;const deadline=Date.now()+2000;
      for(let attempt=0;attempt<40;attempt++){
        const remaining=deadline-Date.now();if(remaining<1)closed('managed_group_drain_deadline');
        assertPaths();
        const row=query(process.pid,Math.min(remaining,500));
        assertPaths();
        if(row.status!=='ok'||!same(processIdentity(row),processIdentity(wrapper))||!cwdMatches(row,basePath,baseIdentity))closed('wrapper_identity_changed');
        if(!row.childPids.length&&same(row.processGroupPids,[process.pid])){drained=true;break;}
        await new Promise(done=>setTimeout(done,50));
      }
      if(!drained)closed('managed_descendants_not_drained');
      if(spawnError)lifecycle.spawnFailed();else lifecycle.exited(code,signal);
      resolveSettled({status:'terminal',phase:spawnError?'spawn_failed':'exited'});exit(spawnError?1:code??1);
    }catch{failure();}
  };
  child.once('spawn',()=>{
    try{
      lifecycle.spawned(child.pid);
      atomicControl(basePath,'server.pid',metadataFile(join(basePath,'server.pid'),128),String(child.pid));
      timer=setInterval(()=>{
        try{
          const owner=inspectFileRuntimeOwner(dataRoot);if(!owner)return;
          const rows=captureRuntimeProcessTree({base:basePath,release,wrapperPid:process.pid,childPid:child.pid,nativeQuery:query});
          if(lifecycle.observeOwner(rows.map(processIdentity)))clearInterval(timer);
        }catch{clearInterval(timer);child.kill('SIGTERM');}
      },50);
      if(stoppingSignal)child.kill(stoppingSignal);
    }catch{child.kill('SIGTERM');}
  });
  child.once('error',()=>{void finish(null,null,true);});
  child.once('exit',(code,signal)=>{void finish(code,signal);});
  return Object.freeze({settled,signal(signal){if(!['SIGTERM','SIGINT'].includes(signal))closed('invalid_runtime_signal');stoppingSignal=signal;child.kill(signal);}});
}
export function run() {
  const env = config();
  const installed=readCurrent(base);if(installed.absent)closed('missing_runtime_release');
  const current=installed.release.path,revision=installed.release.revision;
  const baseIdentity=privateMetadataBase(base);privateMetadataBase(env.STUDIO_DATA_DIR);
  if(metadataFile(join(base,STOPPED_RECEIPT),16384))closed('unconsumed_stopped_receipt');
  if(inspectFileRuntimeOwner(env.STUDIO_DATA_DIR))closed('runtime_holder_already_exists');
  const query=(pid,timeout=2000)=>nativeProcessQuery(current,pid,timeout),wrapper=query(process.pid);
  if(wrapper.status!=='ok'||wrapper.pgid!==process.pid||!cwdMatches(wrapper,base,baseIdentity)||wrapper.executablePath!==process.execPath||wrapper.childPids.length||!same(wrapper.processGroupPids,[process.pid]))closed('wrapper_process_identity_unavailable');
  if(!same(privateMetadataBase(base),baseIdentity))closed('wrapper_base_identity_changed');
  assertCurrent(base,installed);assertReleaseDirectory(current,installed.release.identity);
  const operation=info(join(base,'.studio-operation.lock'))?metadataFile(join(base,'.studio-operation.lock','owner.json')):null;
  if(info(join(base,'.studio-operation.lock'))&&!operation)closed('operation_metadata_unavailable');
  const lifecycle=createRuntimeProcessLifecycle({base,release:installed.release,dataRoot:env.STUDIO_DATA_DIR,operationDigest:operation?.digest??null,processProof:[processIdentity(wrapper)]});
  process.umask(0o077);
  const child=spawn(process.execPath,[join(current,'server.js')],{cwd:current,stdio:'inherit',env:{...process.env,...env,HOSTNAME:'127.0.0.1',PORT:'3107',STUDIO_REVISION:revision}});
  const attached=attachRuntimeProcessLifecycle({child,lifecycle,query,wrapper,base,release:installed.release,dataRoot:env.STUDIO_DATA_DIR});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>attached.signal(signal));
}

async function dispatch(command, guard, baseline) {
  switch (command) {
    case 'prepare': return prepare();
    case 'check': await check(); break;
    case 'install': return install(guard, baseline);
    case 'status': await status(); break;
    case 'stop': {
      const current = readCurrent(base);
      assertIdentifiedRuntime(current, running());
      guard.check(); assertCurrent(base, current);
      const ops=transitionOperations(guard,current);
      await ops.stop();await ops.acquireStopped();await ops.releaseStopped();
      guard.check(); assertCurrent(base, current); break;
    }
    case 'run': run(); break;
    case 'backup': {const current=readCurrent(base);await guardedBackup(guard,transitionOperations(guard,current));break;}
    case 'rollback': return rollback(guard, baseline);
    case 'recover-runtime-owner': {
      const expected=parseRuntimeRecoveryExpected(process.argv.slice(3)),env=config(),configuration=metadataFile(envFile,65536);
      if(env.STUDIO_DATA_DIR!==expected.root)closed('recovery_root_mismatch');
      const checkpoint=()=>{guard.assertOwned();assertCurrent(base,baseline);if(!same(metadataFile(envFile,65536),configuration))closed('recovery_configuration_changed');};
      checkpoint();assertReleaseAdaptiveCompatibility(env,readInstalledReleaseManifest(baseline.release.path));checkpoint();
      return JSON.stringify(recoverStoppedRuntimeOwner({base,dataRoot:env.STUDIO_DATA_DIR,guard,release:baseline.release,expected,nativeQuery:pid=>nativeProcessQuery(metadataArtifactDirectory(),pid),checkpoint,configurationDigest:configuration?.digest}));
    }
    default: console.log('Usage: node scripts/studio-production.mjs prepare|check|install|status|stop|backup|rollback|recover-runtime-owner\nInstall/rollback: --expect-current <resolved-path> --expect-revision <full-sha> --expect-build <build-id>\nInitial install only: --expect-absent\nRecovery additionally requires --expect-root, --expect-root-dev/ino/birth, --expect-receipt-digest and either --expect-holder-dev/ino/birth/digest or --expect-no-holder. Incomplete/unknown holders require separately reviewed offline reconciliation.'); process.exitCode = 1;
  }
}
export async function productionMain() {
try {
  const command = process.argv[2];
  if (['prepare', 'install', 'stop', 'backup', 'rollback','recover-runtime-owner'].includes(command)) {
    const expected = command==='recover-runtime-owner'?parseRuntimeRecoveryExpected(process.argv.slice(3)).baseline:['install', 'rollback'].includes(command) ? parseExpected(process.argv.slice(3), command) : undefined;
    const receipt = await withOperation(base, command, expected, async (guard, baseline) => {
      base = guard.base; envFile = join(base, 'production.env');
      return dispatch(command, guard, baseline);
    }, { onCancel: signal => { process.exitCode = signal === 'SIGINT' ? 130 : 143; } });
    if (receipt) console.log(receipt);
  } else {
    // launchd's run child must start while install owns the operation lock and awaits health.
    await dispatch(command);
  }
} catch (error) { console.error(error.message); process.exitCode ||= 1; }
}
// launchd invokes current/studio-runtime.mjs through the managed symlink.
if(process.argv[1]&&existsSync(process.argv[1])&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url))await productionMain();
