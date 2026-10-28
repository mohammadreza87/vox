/** Artificial portable CLI fixtures only. No native/maintenance bytes execute.
 * This metadata does not qualify a genuine build, provider, supervisor or MI1 runtime.
 * Registration is emitted for a fresh child realm; the test parent never registers.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
export const CLI_UNIT_HELPERS=Object.freeze({'studio-runtime.mjs':'studio-production.mjs','studio-adaptive-compatibility.mjs':'studio-adaptive-compatibility.mjs','studio-operation-guard.mjs':'studio-operation-guard.mjs','studio-file-runtime-owner.mjs':'studio-file-runtime-owner.mjs','studio-memory-account-operation.mjs':'studio-memory-account-operation.mjs','studio-memory-account-time.mjs':'studio-memory-account-time.mjs'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const identity=path=>{const s=fs.lstatSync(path,{bigint:true});return {dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)};};
const present=path=>{try{fs.lstatSync(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const privateDir=(path,create=true)=>{if(!present(path)){assert(create,'unit directory missing');fs.mkdirSync(path,{mode:0o700});}const s=fs.lstatSync(path);assert(s.isDirectory()&&!s.isSymbolicLink()&&fs.realpathSync(path)===path&&s.uid===process.getuid()&&(s.mode&0o777)===0o700,'unit private directory');};
const json=(path,v)=>{fs.writeFileSync(path,JSON.stringify(v)+'\n',{mode:0o600});fs.chmodSync(path,0o600);};
/** Actual byte-bound but deliberately inert fixture entry, never a bundle claim. */
export function unitManagedDescriptor(project,helpersDirectory=join(project,'scripts')){
 const entry=join(project,'.next','studio-memory-account-maintenance.mjs'),bytes=Buffer.from('throw new Error("INERT_SYNTHETIC_UNIT_MAINTENANCE_MUST_NOT_EXECUTE");\n');
 fs.mkdirSync(dirname(entry),{recursive:true});fs.writeFileSync(entry,bytes,{mode:0o600});
 return {version:1,entry:'studio-memory-account-maintenance.mjs',entrySha256:sha(bytes),sourceDigest:sha('ARTIFICIAL UNIT SOURCE; NOT A NEXT BUILD'),lockfileSha256:sha('ARTIFICIAL UNIT LOCK; NOT A LOCKFILE'),bundlerVersion:'0.28.2',helpers:Object.fromEntries(Object.entries(CLI_UNIT_HELPERS).map(([name,source])=>[name,sha(fs.readFileSync(join(helpersDirectory,source)))]))};
}
export function unitFixturePrelude({parent,ownerPath,selectorText}){
 const registration="owner.registerFileRuntimeFixture({dataRoot:r.root,artifactRoot:r.artifact,release:{revision:r.revision,sourceTree:r.sourceTree,buildId:r.buildId}}); owner.assertFileRuntimeFixture(r.root);";
 if(selectorText===undefined)return `{ const fs=await import('node:fs'),owner=await import(${JSON.stringify(pathToFileURL(ownerPath).href)}),r=JSON.parse(fs.readFileSync(${JSON.stringify(join(parent,'file-runtime-owner-fixture-v1.json'))},'utf8')); ${registration} }\n`;
 assert.match(selectorText,/^VOX_MANAGED_STORAGE_V1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\n$/);
 // Deliberate legacy-format fault is restored unchanged AFTER fresh provenance
 // registration and before actual CLI; no owner/operation/time authority exists.
 return `{ const fs=await import('node:fs'),assert=(await import('node:assert/strict')).default,owner=await import(${JSON.stringify(pathToFileURL(ownerPath).href)}),r=JSON.parse(fs.readFileSync(${JSON.stringify(join(parent,'file-runtime-owner-fixture-v1.json'))},'utf8'));
 const parent=${JSON.stringify(parent)},root=parent+'/data',path=root+'/adaptive',stage=parent+'/unit-adaptive-selector-stage-'+process.pid,ident=s=>({dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)}),present=p=>{try{fs.lstatSync(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 assert.equal(r.root,root);for(const p of [parent,root]){const s=fs.lstatSync(p);assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o700&&fs.realpathSync(p)===p);}assert.deepEqual(ident(fs.lstatSync(root,{bigint:true})),r.rootIdentity);
 for(const p of [stage,root+'/.studio-runtime-owner-v1.lock',parent+'/base/.studio-operation.lock',parent+'/base/memory-account-initialization-v1.json'])assert.equal(present(p),false);
 const before=fs.lstatSync(path,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.uid===BigInt(process.getuid())&&before.size<128n);const expected=Buffer.from(${JSON.stringify(selectorText)}),fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{assert.deepEqual(ident(fs.fstatSync(fd,{bigint:true})),ident(before));assert(fs.readFileSync(fd).equals(expected));}finally{fs.closeSync(fd);}
 const stamp=s=>[ident(s),String(s.size),String(s.mode),String(s.uid),String(s.nlink)];let moved=false;
 try{fs.renameSync(path,stage);moved=true;assert.deepEqual(stamp(fs.lstatSync(stage,{bigint:true})),stamp(before));${registration}}
 finally{if(moved){assert.equal(present(path),false);assert.deepEqual(stamp(fs.lstatSync(stage,{bigint:true})),stamp(before));assert(fs.readFileSync(stage).equals(expected));fs.renameSync(stage,path);assert.deepEqual(stamp(fs.lstatSync(path,{bigint:true})),stamp(before));assert(fs.readFileSync(path).equals(expected));}}
 owner.assertFileRuntimeFixture(r.root); }\n`;
}
/** Fail before touching any epoch inputs if the closed refresh boundary is absent. */
export function assertUnitEpochClosed({parent,base=join(parent,'base'),dataRoot=join(parent,'data')}){
 for(const path of [join(dataRoot,'.studio-runtime-owner-v1.lock'),join(base,'.studio-operation.lock'),join(base,'runtime-process-v1.json'),join(base,'runtime-owner-recovery-v1.json'),join(base,'memory-account-initialization-v1.json')])assert(!present(path),'unit epoch still owned or witnessed: '+path);
 assert(!fs.readdirSync(base).some(n=>n.startsWith('.memory-account-initialization-v1.')),'unit unknown MI1 temporary');
 const adaptive=join(dataRoot,'adaptive');if(present(adaptive)){privateDir(adaptive,false);assert(fs.readdirSync(adaptive).every(n=>n==='file-runtime-owner-v1.json'),'unit unknown canonical data or temporary');}
}
export function writeUnitFixtureEpoch({parent,release,helpersDirectory,preloadText,fixtureId=randomUUID(),refresh=false}){
 const base=join(parent,'base'),dataRoot=join(parent,'data'),artifact=join(parent,'artifact'),sourceRoot=join(parent,'baseline-source');
 privateDir(parent,false);for(const path of [base,dataRoot,artifact,sourceRoot])privateDir(path,!refresh);
 if(refresh)assertUnitEpochClosed({parent,base,dataRoot});else assert(!fs.existsSync(join(parent,'file-runtime-owner-fixture-v1.json')),'unit epoch exists');
 for(const path of [join(artifact,'.next'),join(sourceRoot,'.next')])privateDir(path,!refresh);
 const allowed=new Set(['server.js','studio-release.json','revision','studio-memory-account-maintenance.mjs',...Object.keys(CLI_UNIT_HELPERS)]);
 assert(fs.readdirSync(artifact).every(n=>n==='.next'||allowed.has(n)),'unit unknown artifact file');
 for(const [name,source]of Object.entries(CLI_UNIT_HELPERS))fs.copyFileSync(join(helpersDirectory,source),join(artifact,name));
 fs.writeFileSync(join(artifact,'server.js'),'throw new Error("INERT_SYNTHETIC_PROVENANCE_NOT_A_RUNTIME");\n');
 fs.writeFileSync(join(artifact,'.next','BUILD_ID'),release.buildId);fs.writeFileSync(join(sourceRoot,'.next','BUILD_ID'),release.buildId);
 const descriptor=unitManagedDescriptor(artifact,helpersDirectory);fs.copyFileSync(join(artifact,'.next',descriptor.entry),join(artifact,descriptor.entry));json(join(artifact,'studio-release.json'),{...release,memoryAccountManagedRuntime:descriptor,syntheticOnly:true});
 fs.writeFileSync(join(artifact,'revision'),release.revision+'\n');
 const receipt={version:1,kind:'studio-file-runtime-fixture',fixtureId,root:dataRoot,artifact,sourceRoot,rootIdentity:identity(dataRoot),artifactIdentity:identity(artifact),revision:release.revision,sourceTree:release.sourceTree,buildId:release.buildId,providerBlocking:true,metadataSource:'next-build-source-binding'};
 json(join(parent,'file-runtime-owner-fixture-v1.json'),receipt);const preload=join(parent,'mi1-fixture-preload-v1.mjs');fs.writeFileSync(preload,preloadText,{mode:0o600});fs.chmodSync(preload,0o600);
 const receiptDigest=sha(fs.readFileSync(join(parent,'file-runtime-owner-fixture-v1.json')));
 json(join(parent,'mi1-synthetic-supervisor-v1.json'),{version:1,kind:'mi1-synthetic-supervisor',scope:'synthetic',status:'unverified',fixtureId,fixtureReceiptDigest:receiptDigest,baseIdentity:identity(base),rootIdentity:identity(dataRoot),artifactIdentity:identity(artifact),preloadIdentity:identity(preload),preloadDigest:sha(fs.readFileSync(preload))});
 const label=`io.ludaxis.vox-studio.fixture.${fixtureId}`,port=49152+(parseInt(fixtureId.slice(0,4),16)%16384);
 return {parent,base,dataRoot,artifact,sourceRoot,preload,fixtureId,label,port,plist:join(parent,'launch-agents',label+'.plist'),receiptDigest};
}

/** Render the unchanged production serializer in a fresh registered unit realm. */
export function renderUnitLaunchPlist({topology,controllerPath,epoch}){
 const entry=join(topology.parent,`unit-render-plist-${epoch}.mjs`);assert(!fs.existsSync(entry));
 fs.writeFileSync(entry,`const api=await import(${JSON.stringify(pathToFileURL(controllerPath).href)});api.configureManagedMemoryAccountTopology();process.stdout.write(api.launchAgentContents(${JSON.stringify(topology.base)},process.execPath));\n`,{mode:0o600});
 const r=spawnSync(process.execPath,['--import',topology.preload,entry],{cwd:topology.base,env:{PATH:dirname(process.execPath),VOX_PRODUCTION_DIR:topology.base},encoding:'utf8',timeout:10000,maxBuffer:32768});
 assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);assert(!r.error);assert(r.stdout.includes(topology.label)&&r.stdout.includes(topology.preload));
 privateDir(join(topology.parent,'launch-agents'));fs.writeFileSync(topology.plist,r.stdout,{mode:0o600});return r.stdout;
}

function unitBoundFile(path,privateMode=false){
 const a=fs.lstatSync(path);assert(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1&&a.uid===process.getuid()&&(privateMode?(a.mode&0o777)===0o600:!(a.mode&0o022))&&a.size<=262144,'unit captured file');
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const held=fs.fstatSync(fd),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd),named=fs.lstatSync(path),stamp=v=>[v.dev,v.ino,v.birthtimeMs,v.size,v.mode,v.uid,v.nlink,v.mtimeMs,v.ctimeMs];assert.deepEqual(stamp(a),stamp(held));assert.deepEqual(stamp(held),stamp(after));assert.deepEqual(stamp(after),stamp(named));return {path,bytes:bytes.length,sha256:sha(bytes),metadata:stamp(after)};}finally{fs.closeSync(fd);}
}
export function captureUnitRuntimeBoundary({base,dataRoot,current}){
 privateDir(dataRoot,false);const cwd=current.release.path,entry=join(cwd,'server.js');
 return {current,configuration:unitBoundFile(join(base,'production.env'),true),rootIdentity:identity(dataRoot),server:{...unitBoundFile(entry),cwd}};
}
export function assertUnitRuntimeBoundary({base,dataRoot,current,expected}){
 privateDir(dataRoot,false);assert.deepEqual(identity(dataRoot),expected.rootIdentity,'unit captured root changed');assert.deepEqual(current,expected.current,'unit captured current changed');
 assert.deepEqual(unitBoundFile(join(base,'production.env'),true),expected.configuration,'unit captured configuration changed');
 assert.equal(expected.server.path,join(expected.current.release.path,'server.js'));assert.equal(expected.server.cwd,expected.current.release.path);
 assert.deepEqual({...unitBoundFile(expected.server.path),cwd:expected.server.cwd},expected.server,'unit captured server changed');
}
