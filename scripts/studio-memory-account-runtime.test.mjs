/** Portable reader/exclusion portion of MI1. No native proof or compiled
 * runtime is inferred from these checks. Actual C73-C76 need artifact GO. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ADAPTIVE_RELEASE_CAPABILITIES, assertReleaseAdaptiveCompatibility } from './studio-adaptive-compatibility.mjs';
import { assertReleaseAdaptiveCompatibility as old9e } from './fixtures/memory-account-prior-reader/studio-adaptive-compatibility.mjs';
import { assertReleaseAdaptiveCompatibility as oldAe } from './fixtures/memory-account-managed-prior-reader/studio-adaptive-compatibility.mjs';
import { hash, image, withManagedTimeFixture } from './fixtures/memory-account-managed-fixture.mjs';
import {FILE_RUNTIME_OWNER_GUARD} from './studio-file-runtime-owner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const oracle = name => {
  const directory = join(root, 'scripts', 'fixtures', name), frozen = JSON.parse(fs.readFileSync(join(directory, 'manifest.json'), 'utf8'));
  for (const [file, meta] of Object.entries(frozen.files)) assert.equal(hash(fs.readFileSync(join(directory, file))), meta.sha256, `frozen_oracle_changed:${file}`);
  return JSON.parse(fs.readFileSync(join(directory, 'studio-release.json'), 'utf8'));
};
const nine = oracle('memory-account-prior-reader'), ae = oracle('memory-account-managed-prior-reader');

test('C67/C71: actual frozen9e and ae readers admit a valid unmarked FILE root', () => withManagedTimeFixture(f => {
  const before = image(f.parent), env = { STUDIO_DATA_DIR: f.dataRoot };
  assert.doesNotThrow(() => old9e(env, nine)); assert.doesNotThrow(() => oldAe(env, ae));
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));
test('C68: ae lifecycle parser can read a pair but cannot satisfy the new operational capability requirement', () => withManagedTimeFixture(f => {
  f.mark(); const before = image(f.parent), env = { STUDIO_DATA_DIR: f.dataRoot };
  assert.doesNotThrow(() => oldAe(env, ae));
  assert.throws(() => old9e(env, nine));
  assert.throws(() => assertReleaseAdaptiveCompatibility(env, ae));
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));
test('C69: every prior ae capability is preserved; the managed parser flag alone claims no qualified runtime', () => {
  for (const [name, value] of Object.entries(ae)) if (name.startsWith('supported') || name.endsWith('EnforcementVersion')) assert.deepEqual(ADAPTIVE_RELEASE_CAPABILITIES[name], value, `prior_capability_changed:${name}`);
  assert.deepEqual(ADAPTIVE_RELEASE_CAPABILITIES.supportedMemoryAccountManagedRuntimeVersions, [1]);
});
for (const state of ['time-only', 'marker-only', 'bad-marker', 'bad-time', 'future-time', 'noncanonical-time', 'linked-time', 'public-time']) {
  test(`C70: actual readers refuse ${state} even with feature switches off and no accounts`, () => withManagedTimeFixture(f => {
    f.mark(); const marker = join(f.directory, 'memory-account-lifecycle-v1.json'), time = join(f.directory, 'memory-account-time-v1.json');
    if (state === 'time-only') fs.unlinkSync(marker);
    if (state === 'marker-only') fs.unlinkSync(time);
    if (state === 'bad-marker') fs.writeFileSync(marker, '{}\n', { mode: 0o600 });
    if (state === 'bad-time') fs.writeFileSync(time, '{', { mode: 0o600 });
    if (state === 'future-time') fs.writeFileSync(time, '{"version":2,"highWaterMs":1}\n', { mode: 0o600 });
    if (state === 'noncanonical-time') fs.writeFileSync(time, fs.readFileSync(time, 'utf8') + '\n', { mode: 0o600 });
    if (state === 'linked-time') fs.linkSync(time, join(f.parent, 'time-hardlink'));
    if (state === 'public-time') fs.chmodSync(time, 0o640);
    const before = image(f.parent), env = { STUDIO_DATA_DIR: f.dataRoot, STUDIO_ASSISTANT_TEXT_DELIVERY: '0', STUDIO_TELEGRAM_ARCHIVE_SNAPSHOTS: '0' };
    assert.throws(() => old9e(env, nine)); assert.throws(() => oldAe(env, ae));
    assert.throws(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
    assert.deepEqual(image(f.parent), before);
  }));
}
test('C70: paired empty-root admission is only a reader shape, not proof of physical erasure or enrollment', () => withManagedTimeFixture(f => {
  f.mark(); const before = image(f.parent);
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility({ STUDIO_DATA_DIR: f.dataRoot }, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));
test('C70: removing already observed permanent controls is refused rather than resetting to legacy', () => withManagedTimeFixture(f => {
  f.mark(); const env = { STUDIO_DATA_DIR: f.dataRoot };
  assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES);
  fs.unlinkSync(join(f.directory, 'memory-account-lifecycle-v1.json')); fs.unlinkSync(join(f.directory, 'memory-account-time-v1.json'));
  const before = image(f.parent); assert.throws(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));

test('C05/C06: a real separate source process cannot acquire the held FILE writer; no native identity proof is claimed', () => withManagedTimeFixture(f => {
  const before = image(f.parent), url = new URL('./studio-file-runtime-owner.mjs', import.meta.url).href;
  const code = `import net from'node:net';import http from'node:http';import https from'node:https';
    let denied=0;const deny=()=>{denied++;throw Error('QA_NETWORK_DENIED')};globalThis.fetch=deny;net.Socket.prototype.connect=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;
    const api=await import(${JSON.stringify(url)});let admitted=false;try{api.acquireFileRuntimeOwner({dataRoot:${JSON.stringify(f.dataRoot)},release:${JSON.stringify(f.release)}});admitted=true}catch{}
    process.stdout.write(JSON.stringify({admitted,denied}));process.exitCode=admitted?9:0;`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: f.base, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { admitted: false, denied: 0 });
  assert.deepEqual(image(f.parent), before); f.owner.assertCurrent();
}));


function boundMetadata(paths){return paths.map(path=>{const v=fs.lstatSync(path,{bigint:true});return {path,dev:String(v.dev),ino:String(v.ino),birth:String(v.birthtimeNs),mode:String(v.mode),uid:String(v.uid),nlink:String(v.nlink),size:String(v.size),mtime:String(v.mtimeNs),ctime:String(v.ctimeNs)};});}
function maintenanceContender(f,{release=f.release,dataRoot=f.dataRoot}={}){
  const ownerUrl=new URL('./studio-file-runtime-owner.mjs',import.meta.url).href,timeUrl=new URL('./studio-memory-account-time.mjs',import.meta.url).href,operationUrl=new URL('./studio-memory-account-operation.mjs',import.meta.url).href;
  const code=`import assert from'node:assert/strict';import net from'node:net';import http from'node:http';import https from'node:https';import fs from'node:fs';
    let denied=0,providerCalls=0;const deny=()=>{denied++;throw Error('QA_NETWORK_DENIED')};globalThis.fetch=deny;net.Socket.prototype.connect=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;
    const api=await import(${JSON.stringify(ownerUrl)}),time=await import(${JSON.stringify(timeUrl)}),operation=await import(${JSON.stringify(operationUrl)}),root=${JSON.stringify(dataRoot)},release=${JSON.stringify(release)},refused=[];
    let registered=false;try{api.registerFileRuntimeFixture({dataRoot:root,artifactRoot:${JSON.stringify(f.artifact)},release});registered=true}catch{}
    if(registered){
      api.assertFileRuntimeFixture(root);assert.equal(api.inspectFileRuntimeOwner(root).record.role,'maintenance');
      const no=(name,fn)=>{assert.throws(fn,undefined,name);refused.push(name);};
      no('runtime-owner',()=>api.acquireFileRuntimeOwner({dataRoot:root,release}));
      no('maintenance-owner-without-authorization',()=>api.acquireFileRuntimeOwner({dataRoot:root,release,role:'maintenance'}));
      no('maintenance-owner-forged-authorization',()=>api.acquireFileRuntimeOwner({dataRoot:root,release,role:'maintenance',authorization:{}}));
      no('borrowed-operation-authorization',()=>api.createMaintenanceAuthorization({base:${JSON.stringify(f.base)},assertOwned(){},release(){}}));
      no('actual-operation-exclusion',()=>api.acquireFileRuntimeOperationGuard(${JSON.stringify(f.base)},'backup'));
      const ownGuard=api.acquireFileRuntimeOperationGuard(${JSON.stringify(join(f.parent,'contender-base'))},'backup');
      try{const ownAuthorization=api.createMaintenanceAuthorization(ownGuard);no('maintenance-owner-real-contender-authorization',()=>api.acquireFileRuntimeOwner({dataRoot:root,release,role:'maintenance',authorization:ownAuthorization}));no('copied-real-operation-authorization',()=>api.createMaintenanceAuthorization({...ownGuard}));}finally{ownGuard.release();}
      no('guarded-read',()=>api.fileRuntimeFs.readFileSync(${JSON.stringify(join(f.directory,'file-runtime-owner-v1.json'))}));
      no('guarded-write',()=>api.fileRuntimeFs.writeFileSync(${JSON.stringify(join(f.directory,'contender.json'))},'{}'));
      no('guarded-open',()=>api.fileRuntimeFs.openSync(${JSON.stringify(join(f.directory,'file-runtime-owner-v1.json'))},'r+'));
      no('guarded-delete',()=>api.fileRuntimeFs.unlinkSync(${JSON.stringify(join(f.directory,'file-runtime-owner-v1.json'))}));
      no('guarded-transient',()=>api.prepareFileRuntimeTransient(${JSON.stringify(join(f.directory,'contender.tmp'))}));
      no('guarded-transient-directory',()=>api.createFileRuntimeTransientDirectory(${JSON.stringify(join(f.directory,'contender-directory'))}));
      no('forged-managed-context',()=>operation.createManagedMemoryAccountOperation({guard:{},owner:{},authorization:{},time:{},action:'resume'}));
      time.registerSyntheticMemoryTimePolicy({dataRoot:root,policy:${JSON.stringify(f.policy)},provider:{async acquire(){providerCalls++;throw Error('PROVIDER_MUST_NOT_RUN')}},bootIdentity:()=> 'MI1-independent-contender'});
      for(const [name,candidate]of [['omitted',undefined],['inspection',api.inspectFileRuntimeOwner(root)],['copied-inspection',structuredClone(api.inspectFileRuntimeOwner(root))],['forged',{assertCurrent(){},assertActive(){},snapshot(){return {}}}]]){await assert.rejects(time.acquireQualifiedMemoryTime({dataRoot:root,owner:candidate,artifactDigest:${JSON.stringify(f.artifactDigest)},purpose:'runtime'}));refused.push('qualified-clock-with-'+name+'-owner');}
    }
    process.stdout.write(JSON.stringify({registered,refused,denied,providerCalls}));`;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:f.base,env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('C05/C06: fresh source-process maintenance provenance registers without granting any writer, read, transient, clock or operation authority',()=>withManagedTimeFixture(f=>{
  fs.mkdirSync(join(f.parent,'contender-base'),{mode:0o700});
  const paths=[f.parent,f.base,f.dataRoot,f.directory,f.receiptPath,join(f.dataRoot,FILE_RUNTIME_OWNER_GUARD),join(f.base,'.studio-operation.lock'),join(f.base,'.studio-operation.lock','owner.json')],
    before=image(f.parent),metadata=boundMetadata(paths),result=maintenanceContender(f);
  assert.deepEqual(result,{registered:true,refused:['runtime-owner','maintenance-owner-without-authorization','maintenance-owner-forged-authorization','borrowed-operation-authorization','actual-operation-exclusion','maintenance-owner-real-contender-authorization','copied-real-operation-authorization','guarded-read','guarded-write','guarded-open','guarded-delete','guarded-transient','guarded-transient-directory','forged-managed-context','qualified-clock-with-omitted-owner','qualified-clock-with-inspection-owner','qualified-clock-with-copied-inspection-owner','qualified-clock-with-forged-owner'],denied:0,providerCalls:0});
  assert.deepEqual(image(f.parent),before);assert.deepEqual(boundMetadata(paths),metadata);f.owner.assertCurrent();f.guard.assertOwned();
}));
for(const variant of ['missing-receipt','foreign-receipt-root','foreign-receipt-release','copied-release-input','foreign-root-input']){
  test(`C05/C06: maintenance provenance registration rejects ${variant} without changing the actual held root`,()=>withManagedTimeFixture(f=>{
    const args={};
    if(variant==='missing-receipt')fs.unlinkSync(f.receiptPath);
    if(variant.startsWith('foreign-receipt')){const receipt=JSON.parse(fs.readFileSync(f.receiptPath,'utf8'));if(variant==='foreign-receipt-root')receipt.root=join(f.parent,'foreign-data');else receipt.sourceTree='c'.repeat(40);fs.writeFileSync(f.receiptPath,JSON.stringify(receipt)+'\n',{mode:0o600});}
    if(variant==='copied-release-input')args.release={...f.release,revision:'c'.repeat(40)};
    if(variant==='foreign-root-input')args.dataRoot=join(f.parent,'foreign-data');
    const before=image(f.parent),result=maintenanceContender(f,args);
    assert.deepEqual(result,{registered:false,refused:[],denied:0,providerCalls:0});assert.deepEqual(image(f.parent),before);f.owner.assertCurrent();f.guard.assertOwned();
  }));
}

// No default .next/current/3107 or real launchd label is selected here.
// Actual built C73-C76 and all native managed positives are a separately
// frozen Phase-B command packet after registered topology/isolation review.
