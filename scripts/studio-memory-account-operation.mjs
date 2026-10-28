/** MI1 managed operation authority. Pure on import; no production provider defaults. */
import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, isAbsolute, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { parseEnv } from 'node:util';
import { assertManagedMemoryAccountCanonical } from './studio-adaptive-compatibility.mjs';
import { readCurrent, assertCurrent, readRelease } from './studio-operation-guard.mjs';
import { acquireFileRuntimeOperationGuard, inspectFileRuntimeOperationGuard, assertMaintenanceAuthorization,
  inspectFileRuntimeOwner, assertFileRuntimeFixture, fileRuntimeFixtureProvenance, registerFileRuntimeManagedArtifact } from './studio-file-runtime-owner.mjs';
import { assertQualifiedMemoryTime, assertQualifiedMemoryPreflightTime, qualifiedMemoryTimePolicy, qualifiedMemoryPreflightTimePolicy } from './studio-memory-account-time.mjs';

export const MEMORY_ACCOUNT_OPERATION_FILE='memory-account-initialization-v1.json';
export const MEMORY_ACCOUNT_OPERATION_LIMIT=16384;
export const MEMORY_ACCOUNT_OPERATION_RETENTION_MS=86400000;
const MAX_SCAN=64*1024*1024, MAX_ACCOUNT=700000, MAX_ACCOUNTS=10000;
const TIME='memory-account-time-v1.json',MARKER='memory-account-lifecycle-v1.json';
const MARKER_BYTES='{"version":1,"kind":"memory-account-lifecycle"}\n';
const FIXED_CONTROLS=new Set([TIME,MARKER,'file-runtime-owner-v1.json','assistant-delivery-control-v1.json','assistant-delivery-control-v2.json']);
const phases=['prepared','stopped','time_published','marker_published','accounts_qualified','starting','completed','held'];
const reasons=['none','cancelled','changed','time_unavailable','io_unknown','process_unproved','capacity','retention_overdue'];
const preflights=new WeakMap(),guardTokens=new WeakMap(),contexts=new WeakMap(),guardState=new WeakMap(),qualifications=new WeakMap();
const fail=reason=>{throw new Error(`Memory account managed operation unavailable: ${reason}`);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&equal(Object.keys(v).sort(),[...keys].sort());
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}(?![\s\S])/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(v);
const ident=s=>({dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)});
const identity=v=>exact(v,['dev','ino','birth'])&&Object.values(v).every(s=>typeof s==='string'&&/^(0|[1-9]\d*)(?![\s\S])/.test(s));
const stat=p=>fs.lstatSync(p,{bigint:true,throwIfNoEntry:false});
const tuple=r=>({revision:r.revision,sourceTree:r.sourceTree,buildId:r.buildId});
const validRelease=r=>exact(r,['revision','sourceTree','buildId'])&&/^[a-f0-9]{40}(?![\s\S])/.test(r.revision)&&/^[a-f0-9]{40}(?![\s\S])/.test(r.sourceTree)&&typeof r.buildId==='string'&&r.buildId.length>0&&r.buildId.length<=200&&r.buildId.trim()===r.buildId&&!/[\x00-\x1f\x7f]/.test(r.buildId);
function privateDirectory(p){const s=stat(p);if(!isAbsolute(p)||fs.realpathSync(p)!==p||!s?.isDirectory()||s.uid!==BigInt(process.geteuid())||(s.mode&0o077n))fail('private_directory');return ident(s);}
function readFile(p,maximum,optional=true,privateOnly=true){
  const before=stat(p);if(!before){if(optional)return null;fail('missing_metadata');}
  if(!before.isFile()||before.uid!==BigInt(process.geteuid())||before.nlink!==1n||privateOnly&&(before.mode&0o777n)!==0o600n||before.size>BigInt(maximum))fail('invalid_metadata');
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const held=fs.fstatSync(fd,{bigint:true}),buffer=Buffer.alloc(maximum+1);let size=0,n;
    do{n=fs.readSync(fd,buffer,size,buffer.length-size,null);size+=n;}while(n&&size<buffer.length);
    const after=fs.fstatSync(fd,{bigint:true}),named=stat(p);
    if(size>maximum||!named||!equal(ident(before),ident(held))||!equal(ident(held),ident(after))||!equal(ident(after),ident(named))||held.ctimeNs!==after.ctimeNs||held.mtimeNs!==after.mtimeNs||named.ctimeNs!==after.ctimeNs||held.size!==after.size)fail('metadata_changed');
    const bytes=buffer.subarray(0,size),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {text,digest:hash(bytes),identity:ident(after)};
  }finally{fs.closeSync(fd);}
}
function syncDir(p){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const processTuple=r=>[r.pid,r.ppid,r.uid,r.pgid,r.startAbsTicks,r.startSeconds,r.startMicroseconds];
function nativeTuple(v){return Array.isArray(v)&&v.length===7&&v.slice(0,4).every(uint)&&v[0]>0&&v[3]>0&&v[0]<=2147483647&&v[1]<=2147483647&&v[2]<=4294967295&&v[3]<=2147483647&&v.slice(4).every(s=>typeof s==='string'&&/^(0|[1-9]\d{0,19})(?![\s\S])/.test(s)&&BigInt(s)<=18446744073709551615n)&&v[4]!=='0'&&BigInt(v[6])<1000000n;}
async function runtimeModule(){const directory=dirname(fileURLToPath(import.meta.url));return import(pathToFileURL(join(directory,basename(directory)==='scripts'?'studio-production.mjs':'studio-runtime.mjs')).href);}
function nativeRoot(){const d=dirname(fileURLToPath(import.meta.url));return basename(d)==='scripts'?join(dirname(d),'.next'):d;}
function readConfig(base){const found=readFile(join(base,'production.env'),65536,false),env=parseEnv(found.text);if(typeof env.STUDIO_DATA_DIR!=='string'||!isAbsolute(env.STUDIO_DATA_DIR)||(env.STUDIO_ADAPTIVE_FORMAT?.trim()||'file')!=='file')fail('original_file_required');return {found,env};}
export async function prepareManagedMemoryAccountPreflight({base,action}){
  if(!['initialize','resume','expire','finalize'].includes(action))fail('action');
  base=resolve(base);const baseIdentity=privateDirectory(base),current=readCurrent(base);if(current.absent)fail('current_release_required');
  const {found:configuration,env}=readConfig(base),dataRoot=fs.realpathSync(env.STUDIO_DATA_DIR),rootIdentity=privateDirectory(dataRoot),adaptiveIdentity=privateDirectory(join(dataRoot,'adaptive'));
  const runtime=await runtimeModule();runtime.configureManagedMemoryAccountTopology();const nativeQuery=pid=>runtime.nativeProcessQuery(nativeRoot(),pid);
  const self=nativeQuery(process.pid);
  if(self.status!=='ok'||self.pgid!==process.pid||self.childPids.length||!equal(self.processGroupPids,[process.pid])||self.executablePath!==process.execPath||self.cwdPath!==base||self.cwdDevice!==baseIdentity.dev||self.cwdInode!==baseIdentity.ino)fail('dedicated_controller_required');
  runtime.qualifyManagedFixtureSupervisorPreflight();
  const manifestPath=join(current.release.path,'studio-release.json'),artifactDigest=readFile(manifestPath,65536,false,false).digest;
  readManagedMemoryAccountArtifact(current.release.path,JSON.parse(readFile(manifestPath,65536,false,false).text));
  const binding=Object.freeze({});preflights.set(binding,{base,baseIdentity,current,configuration,env,dataRoot,rootIdentity,adaptiveIdentity,artifact:current.release.path,artifactIdentity:current.release.identity,artifactDigest,release:tuple(current.release),controllerIdentity:processTuple(self),nativeQuery,runtime,action});
  readManagedMemoryAccountPreflight(binding);registerFileRuntimeManagedArtifact(binding);return binding;
}
export function readManagedMemoryAccountPreflight(binding){
  const b=preflights.get(binding);if(!b||!validRelease(b.release))fail('preflight_identity');
  if(!equal(privateDirectory(b.base),b.baseIdentity)||!equal(privateDirectory(b.dataRoot),b.rootIdentity)||!equal(privateDirectory(join(b.dataRoot,'adaptive')),b.adaptiveIdentity)||!equal(readConfig(b.base).found,b.configuration))fail('preflight_changed');
  assertCurrent(b.base,b.current);const release=readRelease(b.artifact);
  if(!equal(release,b.current.release)||readFile(join(b.artifact,'studio-release.json'),65536,false,false).digest!==b.artifactDigest)fail('artifact_changed');
  readManagedMemoryAccountArtifact(b.artifact,JSON.parse(readFile(join(b.artifact,'studio-release.json'),65536,false,false).text));
  const self=b.nativeQuery(process.pid);if(self.status!=='ok'||!equal(processTuple(self),b.controllerIdentity)||self.pgid!==process.pid||self.childPids.length||!equal(self.processGroupPids,[process.pid])||self.executablePath!==process.execPath||self.cwdPath!==b.base||self.cwdDevice!==b.baseIdentity.dev||self.cwdInode!==b.baseIdentity.ino)fail('controller_changed');
  return {...b,assertCurrent:()=>{readManagedMemoryAccountPreflight(binding);}};
}
export const assertManagedMemoryAccountPreflight=binding=>{readManagedMemoryAccountPreflight(binding);};
/** Metadata expiry is independent of payload admission; refusal precedes recovery/guard writes. */
export function assertManagedMemoryAccountExpiryDue(binding,preflight){
  const b=readManagedMemoryAccountPreflight(binding);assertQualifiedMemoryPreflightTime(preflight,{binding,dataRoot:b.dataRoot,artifactDigest:b.artifactDigest});
  const old=readManagedMemoryAccountOperationRecord(b.base),sample=preflight.sampleNow();
  if(old&&(!equal(old.value.rootIdentity,b.rootIdentity)||old.value.configurationDigest!==b.configuration.digest||old.value.targetArtifactDigest!==b.artifactDigest))fail('pending_operation_binding');
  if(b.action==='expire'&&old&&sample.utcUpperMs<old.value.retainUntil)fail('not_expired');
}
export function acquireManagedMemoryAccountOperationGuard(binding,preflight,qualification){
  const b=readManagedMemoryAccountPreflight(binding);assertSyntheticManagedMemoryAccountQualification(qualification,{binding,preflight});assertQualifiedMemoryPreflightTime(preflight,{binding,dataRoot:b.dataRoot,artifactDigest:b.artifactDigest});
  if(b.action==='expire')assertManagedMemoryAccountExpiryDue(binding,preflight);
  const sample=preflight.sampleNow(),old=readManagedMemoryAccountOperationRecord(b.base);
  if(old&&(!equal(old.value.rootIdentity,b.rootIdentity)||old.value.configurationDigest!==b.configuration.digest||old.value.targetArtifactDigest!==b.artifactDigest))fail('pending_operation_binding');
  const continuing=old&&b.action!=='initialize',createdAt=continuing?old.value.createdAt:sample.utcLowerMs,retainUntil=createdAt+MEMORY_ACCOUNT_OPERATION_RETENTION_MS,cleanupOnly=sample.utcUpperMs>=retainUntil;
  if(!uint(retainUntil)||cleanupOnly&&(!continuing||b.action==='initialize'))fail('retention_overdue');
  const token=Object.freeze({}),operationId=continuing?old.value.operationId:randomUUID(),operation=`${b.action==='initialize'?'initialize':b.action==='expire'?'expire':'resume'}-memory-account${b.action==='expire'?'-operation':''}`;
  guardTokens.set(token,{binding,preflight,operation,cleanupOnly,fields:{version:1,operationId,recordDigest:null,controllerIdentity:b.controllerIdentity,baseIdentity:b.baseIdentity,rootIdentity:b.rootIdentity,currentDigest:hash(JSON.stringify(b.current)),configurationDigest:b.configuration.digest,targetArtifactDigest:b.artifactDigest,targetRelease:b.release,createdAt,retainUntil}});
  const guard=acquireFileRuntimeOperationGuard(b.base,operation,token),state={binding,preflight,qualification,deadline:performance.now()+Math.max(0,retainUntil-sample.utcUpperMs),timer:null,expired:cleanupOnly,cleanupOnly};
  guardState.set(guard,state);
  state.timer=setTimeout(()=>{latchExpiry(state);},Math.max(1,state.deadline-performance.now()));state.timer.unref?.();
  return guard;
}
export function readManagedMemoryGuardToken(token,base,operation){const t=guardTokens.get(token);if(!t||t.operation!==operation)fail('guard_token');const b=readManagedMemoryAccountPreflight(t.binding);if(b.base!==base)fail('guard_base');assertQualifiedMemoryPreflightTime(t.preflight,{binding:t.binding});const sample=t.preflight.sampleNow();if(sample.utcUpperMs>=t.fields.retainUntil&&!t.cleanupOnly)fail('retention_overdue');return structuredClone(t.fields);}
export function parseManagedMemoryAccountOperation(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>MEMORY_ACCOUNT_OPERATION_LIMIT)fail('record_capacity');let r;try{r=JSON.parse(text);}catch{fail('record_schema');}
  const fields=['version','kind','operationId','revision','previousDigest','phase','baseIdentity','rootIdentity','adaptiveIdentity','currentDigest','configurationDigest','targetArtifactDigest','targetRelease','operationGuardDigest','controllerIdentity','terminalWitnessDigest','maintenanceHolderDigest','timePolicyDigest','protectiveQualificationDigest','initialControlDigest','observedControlDigest','inventoryDigest','createdAt','retainUntil','reason','transients'];
  if(!exact(r,fields)||r.version!==1||r.kind!=='memory-account-initialization'||!uuid(r.operationId)||!uint(r.revision)||(r.revision===0?r.previousDigest!==null:!sha(r.previousDigest))||!phases.includes(r.phase)||!identity(r.baseIdentity)||!identity(r.rootIdentity)||!identity(r.adaptiveIdentity)||!validRelease(r.targetRelease)||!nativeTuple(r.controllerIdentity)||!uint(r.createdAt)||!uint(r.retainUntil)||r.retainUntil!==r.createdAt+MEMORY_ACCOUNT_OPERATION_RETENTION_MS||!reasons.includes(r.reason))fail('record_schema');
  for(const k of ['currentDigest','configurationDigest','targetArtifactDigest','operationGuardDigest','timePolicyDigest','protectiveQualificationDigest','initialControlDigest','observedControlDigest','inventoryDigest'])if(!sha(r[k]))fail('record_schema');
  for(const k of ['terminalWitnessDigest','maintenanceHolderDigest'])if(r[k]!==null&&!sha(r[k]))fail('record_schema');
  if(!Array.isArray(r.transients)||r.transients.length>2||new Set(r.transients.map(x=>x.purpose)).size!==r.transients.length)fail('record_schema');
  for(const t of r.transients)if(!exact(t,['purpose','basename','state','identity','digest'])||!['time','marker'].includes(t.purpose)||!uuid(t.basename)||!['planned','created'].includes(t.state)||(t.state==='planned'?t.identity!==null||t.digest!==null:!identity(t.identity)||!sha(t.digest)))fail('record_schema');
  if(text!==JSON.stringify(r)+'\n')fail('record_canonical');return r;
}
export function readManagedMemoryAccountOperationRecord(base){privateDirectory(base);const f=readFile(join(base,MEMORY_ACCOUNT_OPERATION_FILE),MEMORY_ACCOUNT_OPERATION_LIMIT);return f?{...f,value:parseManagedMemoryAccountOperation(f.text)}:null;}
function operationTemps(base){const names=[],directory=fs.opendirSync(base);try{let row;while((row=directory.readSync())!==null){if(row.name.startsWith('.memory-account-initialization-v1.')){names.push(row.name);if(names.length>1)fail('unproved_record_temporary');}}}finally{directory.closeSync();}return names;}
function assertNoUnknownRecordTemporary(base){if(operationTemps(base).length)fail('unproved_record_temporary');}
function controlState(dataRoot){const adaptive=join(dataRoot,'adaptive'),time=readFile(join(adaptive,TIME),256),marker=readFile(join(adaptive,MARKER),128);let highWaterMs=null;
  if(marker&&marker.text!==MARKER_BYTES)fail('invalid_marker');if(time){let t;try{t=JSON.parse(time.text);}catch{fail('invalid_time');}if(!exact(t,['version','highWaterMs'])||t.version!==1||!uint(t.highWaterMs)||time.text!==JSON.stringify(t)+'\n')fail('invalid_time');highWaterMs=t.highWaterMs;}
  if(marker&&!time)fail('marker_without_time');return {time,marker,highWaterMs,digest:hash(JSON.stringify({time:time?.digest??null,marker:marker?.digest??null}))};
}
function inspectManagedMemoryAccountRootRaw(dataRoot,{allowPartial=false,allowLegacy=false}={}){
  const rootIdentity=privateDirectory(dataRoot),adaptive=join(dataRoot,'adaptive'),adaptiveIdentity=privateDirectory(adaptive),controls=controlState(dataRoot);
  if(!allowPartial&&Boolean(controls.time)!==Boolean(controls.marker))fail('partial_controls');
  const stream=createHash('sha256');let bytes=0,count=0;const names=boundedNames(adaptive,MAX_ACCOUNTS+5).sort();if(names.length>MAX_ACCOUNTS+5)fail('capacity');
  for(const name of names){if(FIXED_CONTROLS.has(name)){const f=readFile(join(adaptive,name),name===TIME?256:128,false);bytes+=Buffer.byteLength(f.text);if(bytes>MAX_SCAN)fail('capacity');stream.update(`${Buffer.byteLength(name)}:${name}:${Buffer.byteLength(f.text)}:`);stream.update(f.text);continue;}
    if(!/^[a-f0-9]{64}\.json(?![\s\S])/.test(name))fail('unknown_adaptive_entry');if(++count>MAX_ACCOUNTS)fail('capacity');const f=readFile(join(adaptive,name),MAX_ACCOUNT,false);bytes+=Buffer.byteLength(f.text);if(bytes>MAX_SCAN)fail('capacity');
    let doc;try{doc=JSON.parse(f.text);}catch{fail('canonical_schema');}if(!doc||typeof doc.accountId!=='string'||!/^telegram-account:[1-9]\d{0,15}(?![\s\S])/.test(doc.accountId)||hash(doc.accountId)!==name.slice(0,-5)||doc.schemaVersion!==1||doc.mode==='ERASING')fail('canonical_schema');
    assertManagedMemoryAccountCanonical(doc,name.slice(0,-5),{marked:Boolean(controls.marker),allowLegacy});
    if(!controls.marker&&doc.memoryLifecycle!==undefined)fail('lifecycle_before_marker');if(controls.marker&&!allowLegacy&&doc.memoryLifecycle===undefined)fail('legacy_account');
    stream.update(`${Buffer.byteLength(name)}:${name}:${Buffer.byteLength(f.text)}:`);stream.update(f.text);
  }
  if(!equal(privateDirectory(dataRoot),rootIdentity)||!equal(privateDirectory(adaptive),adaptiveIdentity)||!equal(boundedNames(adaptive,MAX_ACCOUNTS+5).sort(),names)||controlState(dataRoot).digest!==controls.digest)fail('inventory_changed');
  return {controlDigest:controls.digest,inventoryDigest:stream.digest('hex'),controls};
}
function recordBytes(value){const bytes=JSON.stringify(value)+'\n';parseManagedMemoryAccountOperation(bytes);return bytes;}
function replaceRecord(base,expected,value,assertStructural,sampleDeadline){
  const bytes=recordBytes(value),path=join(base,MEMORY_ACCOUNT_OPERATION_FILE),temporary=join(base,`.memory-account-initialization-v1.${value.operationId}.${value.revision}.tmp`),baseIdentity=privateDirectory(base);
  if(expected?(value.operationId!==expected.value.operationId||value.revision!==expected.value.revision+1||value.previousDigest!==expected.digest):(value.revision!==0||value.previousDigest!==null))fail('record_chain');
  const parent=fs.openSync(base,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const assertParent=()=>{if(!equal(ident(fs.fstatSync(parent,{bigint:true})),baseIdentity)||!equal(privateDirectory(base),baseIdentity))fail('record_parent_changed');};
  try{
    assertParent();assertNoUnknownRecordTemporary(base);assertStructural();if(!equal(readManagedMemoryAccountOperationRecord(base),expected))fail('record_changed');
    const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);let owned;
    try{owned=ident(fs.fstatSync(fd,{bigint:true}));fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    assertParent();if(!equal(readFile(temporary,MEMORY_ACCOUNT_OPERATION_LIMIT),{text:bytes,digest:hash(bytes),identity:owned})||!equal(readManagedMemoryAccountOperationRecord(base),expected))fail('record_changed');
    assertStructural();assertParent();sampleDeadline();fs.renameSync(temporary,path);fs.fsyncSync(parent);
    const next=readManagedMemoryAccountOperationRecord(base);if(next?.digest!==hash(bytes))fail('io_unknown');return next;
  }finally{fs.closeSync(parent);}
}
function stateOf(guard){const s=guardState.get(guard);if(!s)fail('managed_guard_identity');return s;}
function preflightDeadline(guard,preflight){const s=stateOf(guard),g=inspectFileRuntimeOperationGuard(guard);assertQualifiedMemoryPreflightTime(preflight,{dataRoot:g.record.managedMemory.rootIdentity?readManagedMemoryAccountPreflight(s.binding).dataRoot:undefined});const n=preflight.sampleNow();if(s.expired||performance.now()>=s.deadline||n.utcUpperMs>=g.record.managedMemory.retainUntil){latchExpiry(s);fail('retention_overdue');}return n;}
export function prepareManagedMemoryAccountJournal({guard,preflight}){
  const s=stateOf(guard),b=readManagedMemoryAccountPreflight(s.binding),g=inspectFileRuntimeOperationGuard(guard),m=g.record.managedMemory;
  if(!m)fail('managed_guard_required');assertNoUnknownRecordTemporary(b.base);const old=readManagedMemoryAccountOperationRecord(b.base);if(old)fail('pending_operation');
  assertFileRuntimeFixture(b.dataRoot); // Production policy/qualification registry is deliberately unavailable.
  const qualification=assertSyntheticManagedMemoryAccountQualification(s.qualification,{binding:s.binding,preflight});
  const scan=inspectManagedMemoryAccountRootRaw(b.dataRoot,{allowPartial:b.action!=='initialize',allowLegacy:true});if(b.action==='initialize'&&(scan.controls.time||scan.controls.marker))fail('already_marked');
  const value={version:1,kind:'memory-account-initialization',operationId:m.operationId,revision:0,previousDigest:null,phase:'prepared',baseIdentity:b.baseIdentity,rootIdentity:b.rootIdentity,adaptiveIdentity:b.adaptiveIdentity,currentDigest:m.currentDigest,configurationDigest:m.configurationDigest,targetArtifactDigest:m.targetArtifactDigest,targetRelease:m.targetRelease,operationGuardDigest:g.digest,controllerIdentity:m.controllerIdentity,terminalWitnessDigest:null,maintenanceHolderDigest:null,timePolicyDigest:qualification.policyDigest,protectiveQualificationDigest:qualification.digest,initialControlDigest:scan.controlDigest,observedControlDigest:scan.controlDigest,inventoryDigest:scan.inventoryDigest,createdAt:m.createdAt,retainUntil:m.retainUntil,reason:'none',transients:[]};
  const next=replaceRecord(b.base,null,value,()=>readManagedMemoryAccountPreflight(s.binding),()=>preflightDeadline(guard,preflight));s.record=next;return next;
}
function assertContext(c){
  const x=contexts.get(c);if(!x)fail('operation_identity');const s=stateOf(x.guard),g=inspectFileRuntimeOperationGuard(x.guard),b=readManagedMemoryAccountPreflight(s.binding);
  assertMaintenanceAuthorization(b.dataRoot,x.authorization,x.owner);if(!equal(x.owner.snapshot(),x.ownerSnapshot)||g.digest!==x.guardSnapshot.digest||!equal(readManagedMemoryAccountOperationRecord(b.base),s.record))fail('operation_changed');
  const controls=controlState(b.dataRoot);if(x.markerIdentity&&(!controls.marker||!equal(controls.marker.identity,x.markerIdentity)))fail('marker_changed');
  for(const row of s.record?.value.transients??[]){
    if(row.state!=='created')continue;
    const temporary=readFile(tempPath(b.dataRoot,row.purpose,row.basename),row.purpose==='time'?256:128),published=row.purpose==='time'?controls.time:controls.marker,actual=temporary??published;
    if(!actual||actual.digest!==row.digest||!equal(actual.identity,row.identity))fail('registered_transient_changed');
  }
  if(x.highWater!==null&&(controls.highWaterMs===null||controls.highWaterMs<x.highWater))fail('time_regressed');if(controls.highWaterMs!==null)x.highWater=controls.highWaterMs;
  return {x,s,g,b};
}
function checkContextDeadline(c){const {x,s}=assertContext(c);assertQualifiedMemoryTime(x.time,{dataRoot:x.owner.root,owner:x.owner});const sample=x.time.sampleNow();if(s.expired||performance.now()>=s.deadline||sample.utcUpperMs>=s.record.value.retainUntil){latchExpiry(s);fail('retention_overdue');}return sample;}
function updateContext(c,fields){const {s,b}=assertContext(c);const next={...s.record.value,...fields,revision:s.record.value.revision+1,previousDigest:s.record.digest};s.record=replaceRecord(b.base,s.record,next,()=>assertContext(c),()=>checkContextDeadline(c));return s.record;}
export function createManagedMemoryAccountOperation({guard,owner,authorization,time,action}){
  if(!['initialize','resume'].includes(action))fail('action');const s=stateOf(guard),b=readManagedMemoryAccountPreflight(s.binding),g=inspectFileRuntimeOperationGuard(guard);
  assertMaintenanceAuthorization(b.dataRoot,authorization,owner);assertQualifiedMemoryTime(time,{dataRoot:b.dataRoot,owner});const policy=qualifiedMemoryTimePolicy(time);if(policy.scope!=='synthetic')fail('production_qualification_unavailable');assertFileRuntimeFixture(b.dataRoot);
  const stopped=b.runtime.readStoppedRuntimeReceipt(b.base),terminal=b.runtime.readRuntimeProcessReceipt(b.base);if(!stopped||!terminal||!['exited','spawn_failed'].includes(terminal.value.phase)||stopped.value.terminalDigest!==terminal.digest)fail('stopped_witness_required');
  if(!s.record||s.record.value.operationGuardDigest!==g.digest||!equal(s.record.value.rootIdentity,b.rootIdentity))fail('record_binding');
  const stoppedScan=inspectManagedMemoryAccountRootRaw(b.dataRoot,{allowPartial:action==='resume',allowLegacy:true});if(stoppedScan.controlDigest!==s.record.value.observedControlDigest||stoppedScan.inventoryDigest!==s.record.value.inventoryDigest)fail('stopped_inventory_changed');
  const controls=controlState(b.dataRoot),context=Object.freeze({});contexts.set(context,{guard,owner,authorization,time,action,ownerSnapshot:owner.snapshot(),guardSnapshot:g,markerIdentity:controls.marker?.identity??null,highWater:controls.highWaterMs});
  updateContext(context,{phase:'stopped',terminalWitnessDigest:terminal.digest,maintenanceHolderDigest:owner.snapshot().digest,timePolicyDigest:hash(JSON.stringify(policy))});
  return context;
}
export function assertManagedMemoryAccountOperation(context,{dataRoot,owner,authorization,time,action}={}){const {x,b}=assertContext(context);if(dataRoot!==undefined&&resolve(dataRoot)!==b.dataRoot||owner!==undefined&&owner!==x.owner||authorization!==undefined&&authorization!==x.authorization||time!==undefined&&time!==x.time||action!==undefined&&action!==x.action)fail('operation_binding');}
const tempPath=(root,purpose,base)=>join(root,'adaptive',`${purpose==='time'?TIME:MARKER}.${base}.tmp`);
export function readManagedMemoryAccountOperationContext(context){
  const {x,b}=assertContext(context);
  return {dataRoot:b.dataRoot,owner:x.owner,authorization:x.authorization,time:x.time,action:x.action,assertCurrent:()=>{assertContext(context);},checkDeadline:()=>checkContextDeadline(context),
    reserveTransient({purpose,basename}){if(!['time','marker'].includes(purpose)||!uuid(basename))fail('transient_schema');const {s}=assertContext(context);if(s.record.value.transients.some(t=>t.purpose===purpose)||stat(tempPath(b.dataRoot,purpose,basename)))fail('transient_exists');updateContext(context,{transients:[...s.record.value.transients,{purpose,basename,state:'planned',identity:null,digest:null}]});},
    createdTransient({purpose,basename,digest}){const {s}=assertContext(context),row=s.record.value.transients.find(t=>t.purpose===purpose&&t.basename===basename),f=readFile(tempPath(b.dataRoot,purpose,basename),purpose==='time'?256:128,false);if(!row||row.state!=='planned'||f.digest!==digest)fail('transient_changed');updateContext(context,{transients:s.record.value.transients.map(t=>t===row?{...t,state:'created',identity:f.identity,digest}:t)});},
    published({purpose,digest}){const {s}=assertContext(context),row=s.record.value.transients.find(t=>t.purpose===purpose),controls=controlState(b.dataRoot),f=purpose==='time'?controls.time:controls.marker;if(!row||row.state!=='created'||!f||f.digest!==digest||!equal(f.identity,row.identity)||stat(tempPath(b.dataRoot,purpose,row.basename)))fail('publication_unknown');if(purpose==='marker')x.markerIdentity=f.identity;x.highWater=controls.highWaterMs;updateContext(context,{phase:purpose==='time'?'time_published':'marker_published',observedControlDigest:controls.digest,transients:s.record.value.transients.filter(t=>t!==row)});}
  };
}
// Public getter returns in-process references only after opaque identity checks.
export { readManagedMemoryAccountOperationContext as readManagedMemoryAccountOperation };

export function inspectManagedMemoryAccountRoot(operation,{stage}={}) {
  if(!['before-publication','before-migration','accounts-qualified'].includes(stage))fail('scan_stage');
  const {b}=assertContext(operation),scan=inspectManagedMemoryAccountRootRaw(b.dataRoot,{allowPartial:stage==='before-publication',allowLegacy:stage!=='accounts-qualified'});
  if(stage==='accounts-qualified'){updateContext(operation,{phase:'accounts_qualified',observedControlDigest:scan.controlDigest,inventoryDigest:scan.inventoryDigest});}
  return {controlDigest:scan.controlDigest,inventoryDigest:scan.inventoryDigest};
}

export const MEMORY_ACCOUNT_MANAGED_HELPERS=Object.freeze({
  'studio-runtime.mjs':'studio-production.mjs','studio-adaptive-compatibility.mjs':'studio-adaptive-compatibility.mjs',
  'studio-operation-guard.mjs':'studio-operation-guard.mjs','studio-file-runtime-owner.mjs':'studio-file-runtime-owner.mjs',
  'studio-memory-account-operation.mjs':'studio-memory-account-operation.mjs','studio-memory-account-time.mjs':'studio-memory-account-time.mjs'
});
/** A parser capability alone cannot qualify an operational artifact. */
export function readManagedMemoryAccountArtifact(artifact,manifest,{helpersDirectory=artifact}={}) {
  const m=manifest?.memoryAccountManagedRuntime;
  if(!exact(m,['version','entry','entrySha256','sourceDigest','lockfileSha256','bundlerVersion','helpers'])||m.version!==1||m.entry!=='studio-memory-account-maintenance.mjs'||!sha(m.entrySha256)||!sha(m.sourceDigest)||!sha(m.lockfileSha256)||m.bundlerVersion!=='0.28.2'||!exact(m.helpers,Object.keys(MEMORY_ACCOUNT_MANAGED_HELPERS))||!Object.values(m.helpers).every(sha))fail('managed_artifact_unqualified');
  const path=join(artifact,m.entry);if(readFile(path,16*1024*1024,false,false).digest!==m.entrySha256)fail('managed_entry_changed');
  for(const name of Object.keys(MEMORY_ACCOUNT_MANAGED_HELPERS)){const p=join(helpersDirectory,helpersDirectory===artifact?name:MEMORY_ACCOUNT_MANAGED_HELPERS[name]);if(readFile(p,2*1024*1024,false,false).digest!==m.helpers[name])fail('managed_helper_changed');}
  return {path,manifest:m};
}
/** Ordinary operations must never consume partial/pending MI1 state. */
export function assertNoPendingMemoryAccountOperation(base) {privateDirectory(base);if(readManagedMemoryAccountOperationRecord(base)||operationTemps(base).length)fail('pending_operation');}
export function markManagedMemoryAccountStarting(operation) {const {s}=assertContext(operation);if(s.record.value.phase!=='accounts_qualified'||s.record.value.transients.length)fail('accounts_not_qualified');return updateContext(operation,{phase:'starting'});}

function inspectRegisteredControlTransient(dataRoot,row){
  const path=tempPath(dataRoot,row.purpose,row.basename),file=readFile(path,row.purpose==='time'?256:128);
  if(!file)return null;if(row.state!=='created'||!equal(file.identity,row.identity)||file.digest!==row.digest)fail('unproved_transient');
  return {name:basename(path),file};
}
function cleanupRegisteredTransients(base,dataRoot,record,authorize=()=>{}){
  for(const row of record.value.transients){const found=inspectRegisteredControlTransient(dataRoot,row);if(!found)continue;
    if(!equal(readManagedMemoryAccountOperationRecord(base),record))fail('record_changed');authorize();const path=join(dataRoot,'adaptive',found.name);fs.unlinkSync(path);syncDir(dirname(path));
  }
}
function removeExpectedRecord(base,record,authorize=()=>{}){if(!equal(readManagedMemoryAccountOperationRecord(base),record))fail('record_changed');authorize();fs.unlinkSync(join(base,MEMORY_ACCOUNT_OPERATION_FILE));syncDir(base);}
export function cancelManagedMemoryAccountOperation({guard,preflight}){
  const s=stateOf(guard),b=readManagedMemoryAccountPreflight(s.binding);preflightDeadline(guard,preflight);const r=readManagedMemoryAccountOperationRecord(b.base);if(!r||r.value.operationGuardDigest!==inspectFileRuntimeOperationGuard(guard).digest)fail('record_binding');
  const controls=controlState(b.dataRoot);if(controls.time||controls.marker)fail('forward_resume_required');cleanupRecordReplacement(b,r,()=>preflightDeadline(guard,preflight));cleanupRegisteredTransients(b.base,b.dataRoot,r,()=>preflightDeadline(guard,preflight));removeExpectedRecord(b.base,r,()=>preflightDeadline(guard,preflight));clearTimeout(s.timer);s.record=null;
}
export function expireManagedMemoryAccountOperation({guard,owner,authorization,time}){
  const s=stateOf(guard),b=readManagedMemoryAccountPreflight(s.binding),r=readManagedMemoryAccountOperationRecord(b.base);
  assertMaintenanceAuthorization(b.dataRoot,authorization,owner);assertQualifiedMemoryTime(time,{dataRoot:b.dataRoot,owner});const interval=time.sampleNow();
  if(r&&!s.expired&&interval.utcUpperMs<r.value.retainUntil&&performance.now()<s.deadline)fail('not_expired');
  cleanupRecordReplacement(b,r,()=>{assertMaintenanceAuthorization(b.dataRoot,authorization,owner);time.sampleNow();});
  if(r){if(!equal(r.value.rootIdentity,b.rootIdentity)||r.value.configurationDigest!==b.configuration.digest||r.value.targetArtifactDigest!==b.artifactDigest)fail('record_binding');cleanupRegisteredTransients(b.base,b.dataRoot,r,()=>{assertMaintenanceAuthorization(b.dataRoot,authorization,owner);time.sampleNow();});removeExpectedRecord(b.base,r,()=>{assertMaintenanceAuthorization(b.dataRoot,authorization,owner);time.sampleNow();});}
  s.expired=true;clearTimeout(s.timer);s.record=null;return {version:1,status:r&&interval.utcUpperMs>=r.value.retainUntil?'retention_overdue':'expired_metadata_removed',controlsPreserved:true};
}
export async function finalizeManagedMemoryAccountOperation({guard,preflight,expectedRecord}){
  const s=stateOf(guard),b=readManagedMemoryAccountPreflight(s.binding),g=inspectFileRuntimeOperationGuard(guard),r=readManagedMemoryAccountOperationRecord(b.base);
  if(!r||!equal(r,expectedRecord)||r.value.phase!=='starting'||r.value.operationGuardDigest!==g.digest||r.value.transients.length)fail('starting_record_required');
  if(b.runtime.verifyRuntimeReadiness({base:b.base,dataRoot:b.dataRoot,release:b.current.release,operationDigest:g.digest})!==true)fail('runtime_not_ready');
  await verifyManagedMemoryAccountOperationalHealth(s.binding,g.digest);
  preflightDeadline(guard,preflight);
  const next={...r.value,phase:'completed',revision:r.value.revision+1,previousDigest:r.digest};
  s.record=replaceRecord(b.base,r,next,()=>{readManagedMemoryAccountPreflight(s.binding);if(b.runtime.verifyRuntimeReadiness({base:b.base,dataRoot:b.dataRoot,release:b.current.release,operationDigest:g.digest})!==true)fail('runtime_not_ready');},()=>preflightDeadline(guard,preflight));
  removeExpectedRecord(b.base,s.record,()=>preflightDeadline(guard,preflight));clearTimeout(s.timer);s.record=null;return {version:1,status:'completed',controlsPreserved:true};
}
/** Strict pending-start allowlist, independent of env flags or caller capabilities. */
export function assertManagedMemoryAccountStartup({base,dataRoot,release,nativeQuery}){
  const r=readManagedMemoryAccountOperationRecord(base);if(!r){assertNoPendingMemoryAccountOperation(base);return;}
  assertNoUnknownRecordTemporary(base);if(r.value.phase!=='starting'||r.value.transients.length)fail('pending_operation');
  const lock=readFile(join(base,'.studio-operation.lock','owner.json'),4096,false),directory=privateDirectory(join(base,'.studio-operation.lock'));let value;try{value=JSON.parse(lock.text);}catch{fail('guard_schema');}
  value=parseManagedGuard(lock.text);const m=value.managedMemory;if(!m||m.operationId!==r.value.operationId||lock.digest!==r.value.operationGuardDigest||!equal(m.controllerIdentity,r.value.controllerIdentity)||m.recordDigest!==null)fail('starting_guard_binding');
  const current=readCurrent(base),configuration=readConfig(base);if(current.absent||!equal(tuple(current.release),tuple(release))||hash(JSON.stringify(current))!==r.value.currentDigest||configuration.found.digest!==r.value.configurationDigest||!equal(privateDirectory(base),r.value.baseIdentity)||!equal(privateDirectory(dataRoot),r.value.rootIdentity)||!equal(privateDirectory(join(dataRoot,'adaptive')),r.value.adaptiveIdentity)||hash(fs.readFileSync(join(release.path,'studio-release.json')))!==r.value.targetArtifactDigest)fail('starting_current_binding');
  const controller=nativeQuery(m.controllerIdentity[0]);if(controller.status!=='ok'||!equal(processTuple(controller),m.controllerIdentity)||controller.pgid!==controller.pid||controller.childPids.length||!equal(controller.processGroupPids,[controller.pid]))fail('starting_controller_unproved');
  const stopped=readFile(join(base,'runtime-owner-recovery-v1.json'),16384,false),sv=JSON.parse(stopped.text),terminal=readFile(join(base,'runtime-process-v1.json'),4096,false),sm=sv.managedMemory;
  if(!sm||sm.operationId!==r.value.operationId||sm.operationGuardDigest!==lock.digest||!equal(sm.operationGuardIdentity,{directory,owner:lock.identity})||!equal(sm.controllerIdentity,r.value.controllerIdentity)||sm.createdAt!==r.value.createdAt||sm.retainUntil!==r.value.retainUntil||terminal.digest!==r.value.terminalWitnessDigest||sv.terminalDigest!==terminal.digest||inspectFileRuntimeOwner(dataRoot))fail('starting_handoff_not_proved');
  const scan=inspectManagedMemoryAccountRootRaw(dataRoot);if(!scan.controls.marker||scan.inventoryDigest!==r.value.inventoryDigest)fail('starting_inventory_changed');
  readManagedMemoryAccountArtifact(release.path,JSON.parse(fs.readFileSync(join(release.path,'studio-release.json'),'utf8')));
  return {stoppedDigest:stopped.digest,terminalDigest:terminal.digest};
}

function qualificationFiles(binding,preflight){
  const b=readManagedMemoryAccountPreflight(binding);assertQualifiedMemoryPreflightTime(preflight,{binding,dataRoot:b.dataRoot,artifactDigest:b.artifactDigest});
  const policy=qualifiedMemoryPreflightTimePolicy(preflight);if(policy.scope!=='synthetic')fail('production_qualification_unavailable');
  const provenance=fileRuntimeFixtureProvenance(b.dataRoot),policyDigest=hash(JSON.stringify(policy)),manifest=JSON.parse(fs.readFileSync(join(b.artifact,'studio-release.json'),'utf8'));
  const candidateSourceDigest=hash(JSON.stringify({revision:manifest.revision,sourceTree:manifest.sourceTree,buildId:manifest.buildId,memoryAccountManagedRuntime:manifest.memoryAccountManagedRuntime}));
  const scenario=readFile(join(provenance.parent,'mi1-synthetic-scenarios-v1.json'),65536,false),scenarioValue=JSON.parse(scenario.text);
  if(!exact(scenarioValue,['version','kind','scope','status','scenarioId'])||scenarioValue.version!==1||scenarioValue.kind!=='mi1-synthetic-scenarios'||scenarioValue.scope!=='synthetic'||scenarioValue.status!=='unverified'||!uuid(scenarioValue.scenarioId)||scenario.text!==JSON.stringify(scenarioValue)+'\n')fail('scenario_fixture');
  const top=readFile(join(provenance.parent,'mi1-synthetic-qualification-v1.json'),4096,false),v=JSON.parse(top.text),common=['version','kind','scope','status','fixtureId','artifactDigest','configurationDigest','policyDigest','candidateSourceDigest','scenarioDigest'];
  if(!exact(v,[...common,'fixtureReceiptDigest','rehearsalDigest','cleanupDigest','recoveryDigest'])||v.version!==1||v.kind!=='mi1-synthetic-fixture-prerequisite'||v.scope!=='synthetic'||v.status!=='unverified'||v.fixtureId!==provenance.fixtureId||v.fixtureReceiptDigest!==provenance.receiptDigest||v.artifactDigest!==b.artifactDigest||v.configurationDigest!==b.configuration.digest||v.policyDigest!==policyDigest||v.candidateSourceDigest!==candidateSourceDigest||v.scenarioDigest!==scenario.digest||top.text!==JSON.stringify(v)+'\n')fail('qualification_fixture');
  const files=[scenario,top];
  for(const purpose of ['rehearsal','cleanup','recovery']){const f=readFile(join(provenance.parent,`mi1-synthetic-${purpose}-v1.json`),4096,false),row=JSON.parse(f.text);
    if(!exact(row,[...common,'purpose'])||row.purpose!==purpose||f.digest!==v[`${purpose}Digest`]||f.text!==JSON.stringify(row)+'\n')fail('qualification_fixture');
    for(const key of common)if(!equal(row[key],v[key]))fail('qualification_fixture');files.push(f);
  }
  return {binding,preflight,files,digest:top.digest,policyDigest,scope:'synthetic',status:'unverified'};
}
export function registerSyntheticManagedMemoryAccountQualification({binding,preflight}){const q=qualificationFiles(binding,preflight),token=Object.freeze({});qualifications.set(token,q);return token;}
export function assertSyntheticManagedMemoryAccountQualification(token,{binding,preflight}){const q=qualifications.get(token);if(!q||q.binding!==binding)fail('qualification_identity');const fresh=qualificationFiles(binding,preflight);if(!equal(q.files,fresh.files)||q.policyDigest!==fresh.policyDigest)fail('qualification_changed');return {digest:q.digest,policyDigest:q.policyDigest,scope:'synthetic',status:'unverified'};}

function parseManagedGuard(text){let r;try{r=JSON.parse(text);}catch{fail('guard_schema');}const keys=['version','token','pid','startedAt','operation','managedMemory'],m=r?.managedMemory;
  if(!exact(r,keys)||r.version!==1||!sha(r.token)||!uint(r.pid)||r.pid<1||typeof r.startedAt!=='string'||new Date(r.startedAt).toISOString()!==r.startedAt||!['initialize-memory-account','resume-memory-account','expire-memory-account-operation'].includes(r.operation)||
    !exact(m,['version','operationId','recordDigest','controllerIdentity','baseIdentity','rootIdentity','currentDigest','configurationDigest','targetArtifactDigest','targetRelease','createdAt','retainUntil'])||m.version!==1||!uuid(m.operationId)||m.recordDigest!==null||!nativeTuple(m.controllerIdentity)||m.controllerIdentity[0]!==r.pid||m.controllerIdentity[3]!==r.pid||!identity(m.baseIdentity)||!identity(m.rootIdentity)||!sha(m.currentDigest)||!sha(m.configurationDigest)||!sha(m.targetArtifactDigest)||!validRelease(m.targetRelease)||!uint(m.createdAt)||m.retainUntil!==m.createdAt+MEMORY_ACCOUNT_OPERATION_RETENTION_MS)fail('guard_schema');return r;
}
/** Explicit expected stale recovery. No TTL, PID-only or journal-preimage dependence. */
export function recoverManagedMemoryAccountController(binding,expected){
  if(expected?.operationAbsent)return recoverManagedMemoryAccountWithoutOperation(binding,expected);
  const b=readManagedMemoryAccountPreflight(binding),lockPath=join(b.base,'.studio-operation.lock'),lockIdentity=privateDirectory(lockPath),ownerPath=join(lockPath,'owner.json'),lock=readFile(ownerPath,4096,false),r=parseManagedGuard(lock.text),m=r.managedMemory;
  let stopped=b.runtime.readStoppedRuntimeReceipt(b.base);const terminal=b.runtime.readRuntimeProcessReceipt(b.base),holder=inspectFileRuntimeOwner(b.dataRoot);
  if(!expected||b.dataRoot!==expected.root||!equal(b.rootIdentity,expected.rootIdentity)||lock.digest!==expected.operationDigest||!equal(lockIdentity,expected.operationDirectoryIdentity)||!equal(lock.identity,expected.operationOwnerIdentity)||stopped?.digest!==expected.stoppedDigest||terminal?.digest!==expected.receiptDigest||!equal(holder?.guardIdentity??null,expected.holderIdentity)|| (holder?.digest??null)!==expected.holderDigest)fail('recovery_expected_identity');
  if(!stopped||!terminal||!['exited','spawn_failed'].includes(terminal.value.phase)||stopped.value.terminalDigest!==terminal.digest||!equal(m.baseIdentity,b.baseIdentity)||!equal(m.rootIdentity,b.rootIdentity)||m.currentDigest!==hash(JSON.stringify(b.current))||m.configurationDigest!==b.configuration.digest||m.targetArtifactDigest!==b.artifactDigest||!equal(m.targetRelease,b.release)||!equal(stopped.value.rootIdentity,b.rootIdentity)||stopped.value.currentDigest!==m.currentDigest||stopped.value.configurationDigest!==m.configurationDigest)fail('recovery_current_binding');
  if(holder&&(holder.record.pid!==m.controllerIdentity[0]&&holder.record.pid!==terminal.value.childPid||!equal(holder.record.release,b.release)))fail('recovery_holder_binding');
  const exclusion=()=>{
    readManagedMemoryAccountPreflight(binding);const live=b.runtime.managedRuntimeExclusionState();if(live.supervisorPid!==null||!live.listenerClosed||!equal(inspectFileRuntimeOwner(b.dataRoot),holder)||!equal(b.runtime.readRuntimeProcessReceipt(b.base),terminal)||!equal(b.runtime.readStoppedRuntimeReceipt(b.base),stopped))fail('recovery_state_changed');
    for(const row of [m.controllerIdentity,...terminal.value.processProof]){const p=b.nativeQuery(row[0]);if(p.status!=='absent')fail('recovery_process_not_absent');if((row[0]===m.controllerIdentity[0]||row[0]===terminal.value.wrapperPid)&&p.processGroupPids.length)fail('recovery_group_not_empty');}
    if(terminal.value.childPid!==null&&b.nativeQuery(terminal.value.childPid).status!=='absent')fail('recovery_child_not_absent');
  };
  const lockCheck=()=>{exclusion();if(!equal(privateDirectory(lockPath),lockIdentity)||!equal(readFile(ownerPath,4096,false),lock)||!equal(fs.readdirSync(lockPath),['owner.json']))fail('recovery_lock_changed');};
  lockCheck();fs.unlinkSync(ownerPath);fs.rmdirSync(lockPath);syncDir(b.base);
  // Redact MI1-only metadata with the exact stopped/runtime proof still intact.
  if(stopped.value.managedMemory){b.runtime.redactManagedStoppedRuntimeReceipt(b.base,stopped);stopped=b.runtime.readStoppedRuntimeReceipt(b.base);}
  exclusion();return {holder,assertStopped:exclusion,terminalDigest:terminal.digest};
}
function recoverManagedMemoryAccountWithoutOperation(binding,expected){
  const b=readManagedMemoryAccountPreflight(binding);if(stat(join(b.base,'.studio-operation.lock')))fail('recovery_operation_present');
  let stopped=b.runtime.readStoppedRuntimeReceipt(b.base);const terminal=b.runtime.readRuntimeProcessReceipt(b.base),holder=inspectFileRuntimeOwner(b.dataRoot);
  if(b.dataRoot!==expected.root||!equal(b.rootIdentity,expected.rootIdentity)||!stopped||stopped.digest!==expected.stoppedDigest||!terminal||terminal.digest!==expected.receiptDigest||!['exited','spawn_failed'].includes(terminal.value.phase)||stopped.value.terminalDigest!==terminal.digest||!equal(holder?.guardIdentity??null,expected.holderIdentity)||(holder?.digest??null)!==expected.holderDigest||!equal(stopped.value.rootIdentity,b.rootIdentity)||stopped.value.configurationDigest!==b.configuration.digest||stopped.value.currentDigest!==hash(JSON.stringify(b.current)))fail('recovery_expected_identity');
  if(holder&&!equal(holder.record.release,b.release))fail('recovery_holder_binding');
  const exclusion=()=>{readManagedMemoryAccountPreflight(binding);const live=b.runtime.managedRuntimeExclusionState();if(live.supervisorPid!==null||!live.listenerClosed||!equal(inspectFileRuntimeOwner(b.dataRoot),holder)||!equal(b.runtime.readRuntimeProcessReceipt(b.base),terminal)||!equal(b.runtime.readStoppedRuntimeReceipt(b.base),stopped))fail('recovery_state_changed');
    for(const row of terminal.value.processProof){const p=b.nativeQuery(row[0]);if(p.status!=='absent'||row[0]===terminal.value.wrapperPid&&p.processGroupPids.length)fail('recovery_process_not_absent');}
    if(holder){const p=b.nativeQuery(holder.record.pid);if(p.status!=='absent'||p.processGroupPids.length)fail('recovery_holder_not_absent');}
    if(stopped.value.managedMemory){const p=b.nativeQuery(stopped.value.managedMemory.controllerIdentity[0]);if(p.status!=='absent'||p.processGroupPids.length)fail('recovery_controller_not_absent');}
  };
  exclusion();if(stat(join(b.base,'.studio-operation.lock')))fail('recovery_operation_changed');
  if(stopped.value.managedMemory){b.runtime.redactManagedStoppedRuntimeReceipt(b.base,stopped);stopped=b.runtime.readStoppedRuntimeReceipt(b.base);}exclusion();
  return {holder,assertStopped:exclusion,terminalDigest:terminal.digest};
}
export function reconcileManagedMemoryAccountJournal({guard,owner,authorization,time,preflight}){
  const s=stateOf(guard),b=readManagedMemoryAccountPreflight(s.binding);assertMaintenanceAuthorization(b.dataRoot,authorization,owner);assertQualifiedMemoryTime(time,{dataRoot:b.dataRoot,owner});
  const old=readManagedMemoryAccountOperationRecord(b.base),overdue=old!==null&&time.sampleNow().utcUpperMs>=old.value.retainUntil;
  cleanupRecordReplacement(b,old,()=>{assertMaintenanceAuthorization(b.dataRoot,authorization,owner);time.sampleNow();});
  if(old){
    if(!equal(old.value.rootIdentity,b.rootIdentity)||!equal(old.value.baseIdentity,b.baseIdentity)||old.value.configurationDigest!==b.configuration.digest||old.value.targetArtifactDigest!==b.artifactDigest||old.value.currentDigest!==hash(JSON.stringify(b.current)))fail('recovery_record_binding');
    cleanupRegisteredTransients(b.base,b.dataRoot,old,()=>{assertMaintenanceAuthorization(b.dataRoot,authorization,owner);time.sampleNow();});assertMaintenanceAuthorization(b.dataRoot,authorization,owner);
    if(overdue){removeExpectedRecord(b.base,old,()=>{assertMaintenanceAuthorization(b.dataRoot,authorization,owner);time.sampleNow();});fail('retention_overdue');}
    const g=inspectFileRuntimeOperationGuard(guard),m=g.record.managedMemory,q=assertSyntheticManagedMemoryAccountQualification(s.qualification,{binding:s.binding,preflight}),scan=inspectManagedMemoryAccountRootRaw(b.dataRoot,{allowPartial:true,allowLegacy:true});
    if(m.operationId!==old.value.operationId||m.createdAt!==old.value.createdAt||m.retainUntil!==old.value.retainUntil)fail('resume_deadline_changed');
    const next={...old.value,revision:old.value.revision+1,previousDigest:old.digest,phase:'prepared',operationGuardDigest:g.digest,controllerIdentity:m.controllerIdentity,terminalWitnessDigest:null,maintenanceHolderDigest:null,timePolicyDigest:q.policyDigest,protectiveQualificationDigest:q.digest,observedControlDigest:scan.controlDigest,inventoryDigest:scan.inventoryDigest,transients:[],reason:'none'};
    s.record=replaceRecord(b.base,old,next,()=>{readManagedMemoryAccountPreflight(s.binding);assertMaintenanceAuthorization(b.dataRoot,authorization,owner);},()=>preflightDeadline(guard,preflight));return s.record;
  }
  return prepareManagedMemoryAccountJournal({guard,preflight});
}


/** Lost completion response: observe the successful current runtime without stopping/replaying it. */
export async function reconcileRunningManagedMemoryAccountOperation(binding){
  const b=readManagedMemoryAccountPreflight(binding),r=readManagedMemoryAccountOperationRecord(b.base);
  if(r&&!['starting','completed'].includes(r.value.phase))return null;
  const holder=inspectFileRuntimeOwner(b.dataRoot);if(!holder||holder.record.role!=='runtime')return null;
  if(r&&(!equal(r.value.rootIdentity,b.rootIdentity)||r.value.currentDigest!==hash(JSON.stringify(b.current))||r.value.configurationDigest!==b.configuration.digest||r.value.targetArtifactDigest!==b.artifactDigest))fail('running_reconciliation_binding');
  const receipt=b.runtime.readRuntimeProcessReceipt(b.base),operationDigest=r?.value.operationGuardDigest??receipt?.value.operationDigest;
  if(b.runtime.verifyRuntimeReadiness({base:b.base,dataRoot:b.dataRoot,release:b.current.release,operationDigest})!==true)fail('runtime_not_ready');
  const scan=inspectManagedMemoryAccountRootRaw(b.dataRoot);if(!scan.controls.marker)return null;
  await verifyManagedMemoryAccountOperationalHealth(binding,operationDigest);
  return {version:1,status:'current_runtime_verified',operationMetadata:r?'pending_cleanup':'absent',importedPayloads:0,controlsPreserved:true};
}

export async function verifyManagedMemoryAccountOperationalHealth(binding,operationDigest){
  const b=readManagedMemoryAccountPreflight(binding),before=b.runtime.readRuntimeProcessReceipt(b.base),owner=inspectFileRuntimeOwner(b.dataRoot);
  if(b.runtime.verifyRuntimeReadiness({base:b.base,dataRoot:b.dataRoot,release:b.current.release,operationDigest})!==true)fail('runtime_not_ready');
  let response,value;try{
    response=await fetch(b.runtime.managedMemoryAccountHealthUrl(),{headers:{'x-vox-memory-account-readiness':'1'},redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(2000)});
    if(!response.ok||!response.body)fail('protective_health_unavailable');
    const reader=response.body.getReader(),chunks=[];let length=0;try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>4096)fail('protective_health_capacity');chunks.push(Buffer.from(next.value));}}finally{await reader.cancel();}
    value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }catch{fail('protective_health_unavailable');}
  readManagedMemoryAccountPreflight(binding);
  if(!equal(b.runtime.readRuntimeProcessReceipt(b.base),before)||!equal(inspectFileRuntimeOwner(b.dataRoot),owner)||b.runtime.verifyRuntimeReadiness({base:b.base,dataRoot:b.dataRoot,release:b.current.release,operationDigest})!==true)fail('runtime_changed_after_health');
  if(!exact(value,['status','revision','transport','bots','memoryAccount'])||value.status!=='healthy'||value.revision!==b.release.revision||!['polling','webhook'].includes(value.transport)||typeof value.bots!=='boolean'||!exact(value.memoryAccount,['version','state'])||value.memoryAccount.version!==1||value.memoryAccount.state!=='available')fail('protective_health_unavailable');
  return {version:1,state:'available'};
}

export function managedMemoryAccountCleanupOnly(guard){return stateOf(guard).cleanupOnly;}

function latchExpiry(state){state.expired=true;try{state.onDeadline?.();}catch{/* Revocation remains latched; changed authority cannot authorize cleanup. */}}

/** Revocation notification only; callbacks cannot mint operation/time authority. */
export function registerManagedMemoryAccountDeadlineAbort(guard,callback){const state=stateOf(guard);inspectFileRuntimeOperationGuard(guard);if(typeof callback!=='function'||state.onDeadline)fail('deadline_observer');state.onDeadline=callback;if(state.expired||performance.now()>=state.deadline)latchExpiry(state);}
export function managedMemoryAccountDeadlineExpired(guard){return stateOf(guard).expired;}
export function holdManagedMemoryAccountOperation(context,reason){if(!reasons.includes(reason)||reason==='none')fail('hold_reason');return updateContext(context,{phase:'held',reason});}
export function revokeManagedMemoryAccountGuard(guard){const state=guardState.get(guard);if(state){clearTimeout(state.timer);state.expired=true;state.onDeadline=undefined;}}

/** The same exact predecessor proof classifies readonly and authorized cleanup paths. */
function inspectRecordReplacement(b,old){
  const temps=operationTemps(b.base);if(!temps.length)return null;
  const name=temps[0],path=join(b.base,name),file=readFile(path,MEMORY_ACCOUNT_OPERATION_LIMIT,false),value=parseManagedMemoryAccountOperation(file.text);
  if(!old||name!==`.memory-account-initialization-v1.${old.value.operationId}.${old.value.revision+1}.tmp`||value.operationId!==old.value.operationId||value.revision!==old.value.revision+1||value.previousDigest!==old.digest)fail('unproved_record_temporary');
  for(const key of ['version','kind','operationId','baseIdentity','rootIdentity','adaptiveIdentity','currentDigest','configurationDigest','targetArtifactDigest','targetRelease','operationGuardDigest','controllerIdentity','timePolicyDigest','protectiveQualificationDigest','initialControlDigest','createdAt','retainUntil'])if(!equal(value[key],old.value[key]))fail('unproved_record_temporary');
  if(!equal(readFile(path,MEMORY_ACCOUNT_OPERATION_LIMIT,false),file)||!equal(readManagedMemoryAccountOperationRecord(b.base),old))fail('recovery_record_changed');
  return {name,file};
}
function cleanupRecordReplacement(b,old,authorize){
  const found=inspectRecordReplacement(b,old);if(found){authorize();fs.unlinkSync(join(b.base,found.name));syncDir(b.base);}
}
/** Readonly classification grants no mutation, recovery or prefix-based exception. */
export function inspectManagedMemoryAccountPreflightTransients({binding,preflight}){
  const b=readManagedMemoryAccountPreflight(binding);assertQualifiedMemoryPreflightTime(preflight,{binding,dataRoot:b.dataRoot,artifactDigest:b.artifactDigest});
  const record=readManagedMemoryAccountOperationRecord(b.base);
  if(record){const r=record.value;if(!equal(r.baseIdentity,b.baseIdentity)||!equal(r.rootIdentity,b.rootIdentity)||!equal(r.adaptiveIdentity,b.adaptiveIdentity)||r.currentDigest!==hash(JSON.stringify(b.current))||r.configurationDigest!==b.configuration.digest||r.targetArtifactDigest!==b.artifactDigest||!equal(r.targetRelease,b.release))fail('record_binding');}
  const next=inspectRecordReplacement(b,record),transients=[];
  for(const row of record?.value.transients??[]){const found=inspectRegisteredControlTransient(b.dataRoot,row);
    if(!found)continue;if(b.action!=='resume')fail('unproved_transient');
    transients.push({name:found.name,purpose:row.purpose,identity:found.file.identity,digest:found.file.digest});
  }
  if(next&&b.action!=='resume')fail('unproved_record_temporary');
  if(!equal(readManagedMemoryAccountOperationRecord(b.base),record)||!equal(inspectRecordReplacement(b,record),next))fail('record_changed');
  for(const row of transients){const file=readFile(join(b.dataRoot,'adaptive',row.name),row.purpose==='time'?256:128,false);if(!equal(file.identity,row.identity)||file.digest!==row.digest)fail('transient_changed');}
  readManagedMemoryAccountPreflight(binding);preflight.sampleNow();
  return {snapshotDigest:hash(JSON.stringify({record,next,transients})),transients};
}

function boundedNames(path,maximum){const names=[],directory=fs.opendirSync(path);try{let row;while((row=directory.readSync())!==null){if(names.length>=maximum)fail('capacity');names.push(row.name);}}finally{directory.closeSync();}return names;}
