/** MI1 admitted UTC intervals. Import is pure; production providers are deliberately unadmitted. */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { assertFileRuntimeFixture, fileRuntimeArtifactDigest, assertFileRuntimePath } from './studio-file-runtime-owner.mjs';
import { readManagedMemoryAccountPreflight } from './studio-memory-account-operation.mjs';

const SLOT = Symbol.for('vox.memory-account-qualified-time.v1');
const fail = () => { throw new Error('Memory account qualified time unavailable'); };
const integer = n => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
const hex = n => typeof n === 'string' && /^[a-f0-9]{64}(?![\s\S])/.test(n);
const identifier = n => typeof n === 'string' && /^[A-Za-z0-9._-]{1,64}(?![\s\S])/.test(n);
const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const policyFields = ['version','scope','providerId','keyId','algorithm','publicKey','keyNotBeforeMs','keyNotAfterMs','maxUncertaintyMs','maxRequestElapsedMs','maxAssertionLifetimeMs','maxExtrapolationAgeMs','maxDriftPpm','maxSuspendGapMs','sourcePositiveSkewMs','sourceQuantumMs','sourceNegativeSkewMs','utcEvidenceDigest','sourceEvidenceDigest'];
const assertionFields = ['version','requestDigest','providerId','keyId','utcMs','uncertaintyMs','sequence','issuedAtMs','expiresAtMs','signature'];
function plain(value, fields) {
  if (!value || typeof value !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || !equal(Object.keys(value).sort(), [...fields].sort())) fail();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (!Object.hasOwn(descriptor, 'value')) fail();
}
function registry() {
  let r = globalThis[SLOT];
  if (r) { if (r.version !== 1 || !(r.policies instanceof Map) || !(r.permits instanceof WeakMap) || !(r.clocks instanceof WeakMap)) fail(); return r; }
  r = { version:1, generation:randomBytes(32).toString('hex'), policies:new Map(), permits:new WeakMap(), preflight:new WeakMap(), clocks:new WeakMap(), roots:new Map(), sequences:new Map() };
  Object.defineProperty(globalThis,SLOT,{value:r,writable:false,configurable:false}); return r;
}
function policy(value) {
  plain(value,policyFields);
  if (value.version !== 1 || value.scope !== 'synthetic' || !identifier(value.providerId) || !identifier(value.keyId) || value.algorithm !== 'Ed25519' || !hex(value.publicKey) || !hex(value.utcEvidenceDigest) || !hex(value.sourceEvidenceDigest)) fail();
  for (const name of ['keyNotBeforeMs','keyNotAfterMs','maxUncertaintyMs','maxRequestElapsedMs','maxAssertionLifetimeMs','maxExtrapolationAgeMs','maxDriftPpm','maxSuspendGapMs','sourcePositiveSkewMs','sourceQuantumMs']) if (!integer(value[name])) fail();
  if (value.sourceNegativeSkewMs !== null && !integer(value.sourceNegativeSkewMs)) fail();
  if (value.keyNotBeforeMs >= value.keyNotAfterMs || !value.maxRequestElapsedMs || value.maxRequestElapsedMs > 2147483647 || !value.maxAssertionLifetimeMs || !value.maxExtrapolationAgeMs || !value.maxSuspendGapMs || value.maxDriftPpm > 1000000 || value.sourcePositiveSkewMs !== 2000 || value.sourceQuantumMs !== 1000) fail();
  return Object.freeze(Object.fromEntries(policyFields.map(name => [name,value[name]])));
}
/** Test-only admission requires the real FRO fixture registry; env/file/receipt alone never qualifies. */
export function registerSyntheticMemoryTimePolicy({dataRoot,policy:input,provider,monotonic=()=>performance.now(),bootIdentity=()=>registry().generation}={}) {
  assertFileRuntimeFixture(dataRoot);
  const root = fs.realpathSync(dataRoot), p = policy(input), artifactDigest = fileRuntimeArtifactDigest(root), r=registry();
  if (r.policies.get(root)?.active || !provider || typeof provider.acquire !== 'function' || typeof monotonic !== 'function' || typeof bootIdentity !== 'function') fail();
  const entry = {root,policy:p,policyDigest:hash(JSON.stringify(p)),provider,monotonic,bootIdentity,artifactDigest,active:true};
  r.policies.set(root,entry);
  return Object.freeze({policyDigest:entry.policyDigest,revoke(){entry.active=false;}});
}
function admitted(root) {
  root=fs.realpathSync(root); const entry=registry().policies.get(root);
  // There is no production registration path or provider selected by environment.
  if (!entry?.active) fail(); assertFileRuntimeFixture(root);
  if(fileRuntimeArtifactDigest(root)!==entry.artifactDigest)fail(); return entry;
}
function monotonic(entry) { const n=entry.monotonic(); if(typeof n!=='number'||!Number.isFinite(n)||n<0||Object.is(n,-0))fail();return n; }
function boot(entry) { const n=entry.bootIdentity(); if(typeof n!=='string'||!n||n.length>128)fail();return n; }
function highWater(root) {
  const parent=join(root,'adaptive'), parentStat=fs.lstatSync(parent,{throwIfNoEntry:false});
  if(!parentStat)return undefined;
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink()||parentStat.uid!==process.getuid?.()||(parentStat.mode&0o077)!==0)fail();
  const path=join(parent,'memory-account-time-v1.json'), before=fs.lstatSync(path,{throwIfNoEntry:false});
  if(!before)return undefined;
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>256||before.uid!==process.getuid?.()||(before.mode&0o777)!==0o600)fail();
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const held=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.lstatSync(path),stable=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];
    if(!equal(stable(before),stable(held))||!equal(stable(held),stable(after))||!equal(stable(held),stable(fs.fstatSync(fd)))||bytes.length>256)fail();
    const text=bytes.toString('utf8'),value=JSON.parse(text);plain(value,['version','highWaterMs']);
    if(value.version!==1||!integer(value.highWaterMs)||text!==`${JSON.stringify(value)}\n`)fail();return value.highWaterMs;
  }finally{fs.closeSync(fd);}
}
function bindingCurrent(row) {
  if (row.generation!==registry().generation || !row.entry.active || admitted(row.root)!==row.entry || boot(row.entry)!==row.boot) fail();
  if(row.binding){const actual=readManagedMemoryAccountPreflight(row.binding);if(fs.realpathSync(actual.dataRoot)!==row.root||actual.artifactDigest!==row.artifactDigest)fail();}
  else {if(assertFileRuntimePath(row.root)!==row.owner)fail();row.owner.assertCurrent();row.owner.assertActive();if(!equal(row.owner.snapshot(),row.ownerSnapshot))fail();}
}
function sample(row) {
  // All actual owner/artifact/root/high-water I/O precedes the final clock observation.
  bindingCurrent(row);const floor=row.binding?undefined:highWater(row.root);
  const at=monotonic(row.entry),wall=Date.now();
  if(at<row.lastMonotonic||wall<row.lastWall||Math.abs((wall-row.lastWall)-(at-row.lastMonotonic))>row.entry.policy.maxSuspendGapMs)fail();
  const elapsed=at-row.received,drift=elapsed*row.entry.policy.maxDriftPpm/1000000;
  if(elapsed<0||elapsed>row.entry.policy.maxExtrapolationAgeMs)fail();
  const lower=Math.floor(row.lower+elapsed-drift),upper=Math.ceil(row.upper+elapsed+drift);
  if(!integer(lower)||!integer(upper)||lower>upper||lower<row.issuedAt||lower<row.entry.policy.keyNotBeforeMs||upper>=row.expiresAt||upper>=row.entry.policy.keyNotAfterMs||floor!==undefined&&upper<floor||row.lastUpper!==undefined&&upper<row.lastUpper)fail();
  row.lastMonotonic=at;row.lastWall=wall;row.lastUpper=upper;
  return Object.freeze({nowMs:upper,utcLowerMs:lower,utcUpperMs:upper});
}
async function acquire({dataRoot,owner,artifactDigest,purpose,signal,binding}) {
  if(!['initialize','resume','runtime'].includes(purpose)||signal?.aborted)fail();
  const root=fs.realpathSync(dataRoot),entry=admitted(root);
  if(!hex(artifactDigest)||artifactDigest!==entry.artifactDigest)fail();
  if(binding){const actual=readManagedMemoryAccountPreflight(binding);if(fs.realpathSync(actual.dataRoot)!==root||actual.artifactDigest!==artifactDigest||purpose==='runtime')fail();}
  else {if(!owner||assertFileRuntimePath(root)!==owner)fail();owner.assertCurrent();owner.assertActive();}
  const ownerSnapshot=owner?.snapshot(),initialBoot=boot(entry),request={version:1,nonce:randomBytes(32).toString('hex'),rootBinding:randomBytes(32).toString('hex'),artifactDigest,policyDigest:entry.policyDigest,purpose};
  const requestDigest=hash(JSON.stringify(request)),sent=monotonic(entry),controller=new AbortController();
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let timer;
  try {
    const assertion=await Promise.race([Promise.resolve().then(()=>entry.provider.acquire(Object.freeze(request),combined)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Memory account qualified time unavailable'));},entry.policy.maxRequestElapsedMs);}),new Promise((_,reject)=>{combined.addEventListener('abort',()=>reject(new Error('Memory account qualified time unavailable')),{once:true});})]);
    const received=monotonic(entry),elapsed=received-sent;
    if(combined.aborted||elapsed<0||elapsed>entry.policy.maxRequestElapsedMs||initialBoot!==boot(entry))fail();
    plain(assertion,assertionFields);if(Buffer.byteLength(JSON.stringify(assertion),'utf8')>4096)fail();
    if(assertion.version!==1||assertion.requestDigest!==requestDigest||assertion.providerId!==entry.policy.providerId||assertion.keyId!==entry.policy.keyId||!hex(assertion.requestDigest))fail();
    for(const name of ['utcMs','uncertaintyMs','sequence','issuedAtMs','expiresAtMs'])if(!integer(assertion[name]))fail();
    if(assertion.uncertaintyMs>entry.policy.maxUncertaintyMs||assertion.issuedAtMs>assertion.utcMs||assertion.issuedAtMs<entry.policy.keyNotBeforeMs||assertion.issuedAtMs>=entry.policy.keyNotAfterMs||assertion.expiresAtMs<=assertion.issuedAtMs||assertion.expiresAtMs-assertion.issuedAtMs>entry.policy.maxAssertionLifetimeMs||typeof assertion.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(assertion.signature))fail();
    const signature=Buffer.from(assertion.signature,'base64url');if(signature.length!==64||signature.toString('base64url')!==assertion.signature)fail();
    const message=JSON.stringify(Object.fromEntries(assertionFields.filter(name=>name!=='signature').map(name=>[name,assertion[name]])));
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(entry.policy.publicKey,'hex')]),format:'der',type:'spki'});
    if(!verify(null,Buffer.from(message),key,signature))fail();
    const sequenceKey=JSON.stringify([root,entry.policyDigest,entry.policy.providerId,entry.policy.keyId]),prior=registry().sequences.get(sequenceKey);
    if(prior!==undefined&&assertion.sequence<=prior)fail();
    const row={root,entry,artifactDigest,owner,ownerSnapshot,binding,generation:registry().generation,boot:initialBoot,received,lower:Math.floor(assertion.utcMs-assertion.uncertaintyMs),upper:Math.ceil(assertion.utcMs+assertion.uncertaintyMs+elapsed),issuedAt:assertion.issuedAtMs,expiresAt:assertion.expiresAtMs,lastMonotonic:received,lastWall:Date.now()};
    sample(row);registry().sequences.set(sequenceKey,assertion.sequence);
    const capability=Object.freeze({sampleNow:()=>sample(row),assertCurrent:()=>{sample(row);}});
    (binding?registry().preflight:registry().permits).set(capability,row);
    if(!binding)registry().roots.set(root,capability);
    return capability;
  }finally{clearTimeout(timer);controller.abort();}
}
export function acquireQualifiedMemoryTime(input={}) { return acquire(input); }
export function acquireQualifiedMemoryPreflightTime({binding,purpose,signal}={}) {
  const actual=readManagedMemoryAccountPreflight(binding);
  return acquire({dataRoot:actual.dataRoot,artifactDigest:actual.artifactDigest,binding,purpose,signal});
}
export function assertQualifiedMemoryTime(capability,{dataRoot,owner}={}) {
  const row=registry().permits.get(capability);if(!row||dataRoot&&fs.realpathSync(dataRoot)!==row.root||owner&&row.owner!==owner)fail();sample(row);
}
export function assertQualifiedMemoryPreflightTime(capability,{binding,dataRoot,artifactDigest}={}) {
  const row=registry().preflight.get(capability);if(!row||binding&&binding!==row.binding||dataRoot&&fs.realpathSync(dataRoot)!==row.root||artifactDigest&&artifactDigest!==row.artifactDigest)fail();sample(row);
}
export function qualifiedMemoryTimeForRoot(dataRoot) {
  const value=registry().roots.get(fs.realpathSync(dataRoot));if(!value)fail();assertQualifiedMemoryTime(value,{dataRoot});return value;
}
export function qualifiedMemoryClock(capability) {
  assertQualifiedMemoryTime(capability);const clock=()=>{const value=capability.sampleNow();registry().clocks.get(clock).last=value;return value.nowMs;};
  registry().clocks.set(clock,{capability});return clock;
}
/** Pure exact-sample lookup: no owner I/O is introduced after the final clock. */
export function qualifiedMemoryInterval(clock,observed) {
  const row=registry().clocks.get(clock);
  if(row){if(!row.last||row.last.nowMs!==observed)fail();return row.last;}
  if(!integer(observed))fail();return {nowMs:observed,utcLowerMs:observed,utcUpperMs:observed};
}
export function qualifiedMemoryTimePolicy(capability) {
  const row=registry().permits.get(capability);if(!row)fail();sample(row);return row.entry.policy;
}
/** Restricted policy introspection never promotes preflight time to FILE/account authority. */
export function qualifiedMemoryPreflightTimePolicy(capability) {
  const row=registry().preflight.get(capability);if(!row)fail();sample(row);return row.entry.policy;
}
