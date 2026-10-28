/** Independent MI1 Phase-B preload and preparation helpers. This file is NOT a
 * default server launcher. Its copied fixed-name preload is used only by an
 * explicitly bound private fixture/native/artifact packet after root GO. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,createPrivateKey,createPublicKey,randomUUID,sign} from 'node:crypto';
import {dirname,join,basename,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';

const PRELOAD='mi1-fixture-preload-v1.mjs',INPUT='mi1-qa-time-input-v1.json';
const REAL_BASE='/Users/reza/Library/Application Support/Vox Studio';
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&same(Object.keys(o).sort(),[...fields].sort());
const uint=n=>Number.isSafeInteger(n)&&n>=0&&!Object.is(n,-0);
const identity=s=>({dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)});
const digest=s=>typeof s==='string'&&/^[a-f0-9]{64}(?![\s\S])/.test(s);
const uid=()=>BigInt(process.getuid());
function directory(path){const s=fs.lstatSync(path,{bigint:true});assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid()&&(s.mode&0o777n)===0o700n,'qa_private_directory');return identity(s);}
function privateFile(path,maximum=65536,privateMode=true){
  const s=fs.lstatSync(path,{bigint:true});assert(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.uid===uid()&&(privateMode?(s.mode&0o777n)===0o600n:(s.mode&0o022n)===0n)&&s.size<=BigInt(maximum),'qa_private_file');
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const held=fs.fstatSync(fd,{bigint:true}),bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(path,{bigint:true});
    const stamp=v=>[identity(v),String(v.size),String(v.ctimeNs),String(v.mtimeNs)];
    assert(same(stamp(s),stamp(held))&&same(stamp(held),stamp(after))&&same(stamp(after),stamp(named))&&bytes.length<=maximum,'qa_file_changed');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert(Buffer.from(text).equals(bytes),'qa_utf8');return {text,bytes,digest:hash(bytes),identity:identity(after)};
  }finally{fs.closeSync(fd);}
}
function canonical(path,maximum){const f=privateFile(path,maximum),value=JSON.parse(f.text);assert(f.text===JSON.stringify(value)+'\n','qa_noncanonical_input');return {...f,value};}
function syntheticPair(fixtureId){
  const seed=createHash('sha256').update('mi1-independent-utc-key:'+fixtureId).digest();
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32).toString('hex');return {privateKey,publicKey};
}
/** Public deterministic synthetic input; no qualification result or capability. */
export function managedFixtureTimeInput({fixtureId,fixtureReceiptDigest,artifactDigest,epochMs,scenario='protective'}){
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(fixtureId));
  assert(digest(fixtureReceiptDigest)&&digest(artifactDigest)&&uint(epochMs)&&epochMs>=60000&&uint(epochMs+3600000)&&['protective','ati-unknown'].includes(scenario));
  const {publicKey}=syntheticPair(fixtureId);
  return {version:1,kind:'mi1-independent-time-input',scope:'synthetic',status:'unverified',fixtureId,fixtureReceiptDigest,artifactDigest,epochMs,scenario,
    policy:{version:1,scope:'synthetic',providerId:'mi1-independent-provider',keyId:'mi1-'+fixtureId,algorithm:'Ed25519',publicKey,
      keyNotBeforeMs:epochMs-60000,keyNotAfterMs:epochMs+3600000,maxUncertaintyMs:100,maxRequestElapsedMs:2000,maxAssertionLifetimeMs:120000,
      maxExtrapolationAgeMs:60000,maxDriftPpm:0,maxSuspendGapMs:10000,sourcePositiveSkewMs:2000,sourceQuantumMs:1000,sourceNegativeSkewMs:null,
      utcEvidenceDigest:hash('MI1_UNVERIFIED_SYNTHETIC_UTC:'+fixtureId),sourceEvidenceDigest:hash('MI1_UNVERIFIED_SYNTHETIC_SOURCE:'+fixtureId)}};
}

async function registerCopiedPreload(){
  const self=fileURLToPath(import.meta.url),parent=fs.realpathSync(dirname(self));
  assert(/^\/(?:private\/)?tmp\//.test(parent)&&basename(self)===PRELOAD&&fs.realpathSync(self)===join(parent,PRELOAD),'qa_preload_not_fixed_private_fixture');
  directory(parent);const input=canonical(join(parent,INPUT),8192),receipt=canonical(join(parent,'file-runtime-owner-fixture-v1.json'),4096),v=input.value,r=receipt.value;
  assert(exact(v,['version','kind','scope','status','fixtureId','fixtureReceiptDigest','artifactDigest','epochMs','scenario','policy']));
  assert(same(v,managedFixtureTimeInput(v))&&v.fixtureId===r.fixtureId&&v.fixtureReceiptDigest===receipt.digest,'qa_time_input_binding');
  const dataRoot=join(parent,'data'),artifact=join(parent,'artifact'),base=join(parent,'base');
  assert(r.root===dataRoot&&r.artifact===artifact&&r.providerBlocking===true&&r.metadataSource==='next-build-source-binding','qa_fixture_receipt');
  assert(same(directory(dataRoot),r.rootIdentity)&&same(directory(artifact),r.artifactIdentity));directory(base);
  assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&same(process.execArgv,['--import',self]),'qa_preload_arguments');
  assert(process.env.VOX_PRODUCTION_DIR===base&&(!process.env.STUDIO_DATA_DIR||process.env.STUDIO_DATA_DIR===dataRoot),'qa_process_fixture_binding');
  assert(fs.realpathSync(join(base,'current'))===artifact,'qa_current_artifact');
  const manifest=privateFile(join(artifact,'studio-release.json'),65536,false),m=JSON.parse(manifest.text);
  assert(manifest.digest===v.artifactDigest&&m.revision===r.revision&&m.sourceTree===r.sourceTree&&m.buildId===r.buildId,'qa_manifest_binding');
  const closure=m.memoryAccountManagedRuntime;assert(closure?.version===1&&closure.entry==='studio-memory-account-maintenance.mjs'&&digest(closure.entrySha256),'qa_actual_managed_entry');
  assert(exact(closure.helpers,['studio-runtime.mjs','studio-adaptive-compatibility.mjs','studio-operation-guard.mjs','studio-file-runtime-owner.mjs','studio-memory-account-operation.mjs','studio-memory-account-time.mjs']),'qa_helper_inventory');
  assert(privateFile(join(artifact,closure.entry),16*1024*1024,false).digest===closure.entrySha256,'qa_entry_bytes');
  for(const [name,sha]of Object.entries(closure.helpers)){assert(!name.includes('/')&&digest(sha));assert(privateFile(join(artifact,name),2*1024*1024,false).digest===sha,'qa_helper_bytes');}
  const observerRoot=join(parent,'qa-observations');directory(observerRoot);
  const previousObservers=fs.readdirSync(observerRoot);assert(previousObservers.length<16&&previousObservers.every(n=>/^realm-[1-9]\d{0,9}\.jsonl(?![\s\S])/.test(n)),'qa_realm_capacity');
  const observerPath=join(observerRoot,`realm-${process.pid}.jsonl`);assert(!fs.existsSync(observerPath),'qa_observer_already_exists');
  let events=0,bytesWritten=0;const observer=fs.openSync(observerPath,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  const observerIdentity=identity(fs.fstatSync(observer,{bigint:true}));
  function observe(kind,method=null){
    const held=fs.fstatSync(observer,{bigint:true}),named=fs.lstatSync(observerPath,{bigint:true});assert(held.nlink===1n&&(held.mode&0o777n)===0o600n&&same(identity(held),observerIdentity)&&same(identity(named),observerIdentity),'qa_observer_changed');
    assert(events<512,'qa_event_capacity');const text=JSON.stringify({version:1,pid:process.pid,event:kind,method,sequence:++events})+'\n';
    bytesWritten+=Buffer.byteLength(text);assert(bytesWritten<=65536,'qa_observer_byte_capacity');fs.writeSync(observer,text);
  }
  // Block providers and unexpected listeners BEFORE importing application
  // helpers. Only the controller's exact own health GET may use loopback.
  const port=49152+(parseInt(r.fixtureId.slice(0,4),16)%16384),allowHealth=new AsyncLocalStorage(),originalFetch=globalThis.fetch;
  const deny=kind=>{observe('denied',kind);throw Error('MI1_QA_UNEXPECTED_NETWORK');};
  const originalConnect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(...args){const first=args[0],o=(Array.isArray(first)?first[0]:first)??{};if(!allowHealth.getStore()||typeof o!=='object'||String(o.port)!==String(port)||o.host!=='127.0.0.1')return deny('socket');return originalConnect.apply(this,args);};
  const originalListen=net.Server.prototype.listen;
  net.Server.prototype.listen=function(...args){const o=args[0],p=typeof o==='object'?o?.port:o,host=typeof o==='object'?o?.host:args[1];if(Number(p)!==port||host!=='127.0.0.1')return deny('listen');observe('listen','fixture');return originalListen.apply(this,args);};
  for(const module of [http,https]){module.request=()=>deny('http-request');module.get=()=>deny('http-get');}
  tls.connect=()=>deny('tls');dgram.createSocket=()=>deny('udp');dns.lookup=()=>deny('dns');dns.resolve=()=>deny('dns');
  syncBuiltinESMExports();
  globalThis.fetch=async(resource,init)=>{
    const request=resource instanceof Request?resource:undefined,url=new URL(request?.url??String(resource)),method=String(init?.method??request?.method??'GET').toUpperCase();
    if(url.origin===`http://127.0.0.1:${port}`&&url.pathname==='/api/studio/health'&&!url.search&&method==='GET'){
      observe('health-attempt','GET');return allowHealth.run(true,()=>originalFetch(resource,init));
    }
    const managerToken='900000000:'+hash('mi1-synthetic-manager:'+r.fixtureId).slice(0,32);
    if(url.origin==='https://api.telegram.org'&&url.pathname===`/bot${managerToken}/getMe`&&!url.search&&method==='POST'){
      observe('injected-telegram','getMe');return Response.json({ok:true,result:{id:900000000,is_bot:true,first_name:'MI1 Synthetic',username:'mi1_'+r.fixtureId.replaceAll('-','').slice(0,20)+'_bot'}});
    }
    // BOTS1 and C60 require separately reviewed exact injection/kill counters.
    // Refuse until that actual scenario adapter is implemented; never fake a
    // successful polling process or silently let a provider request escape.
    return deny(url.hostname==='api.telegram.org'?'telegram':'provider');
  };
  // Refuse real managed private paths without inspecting those paths.
  const checkPrivatePaths=args=>{for(const arg of args){const p=typeof arg==='string'?resolve(arg):arg instanceof URL&&arg.protocol==='file:'?fileURLToPath(arg):'';if(p===REAL_BASE||p.startsWith(REAL_BASE+'/')){observe('denied','real-root');throw Error('MI1_QA_REAL_ROOT_DENIED');}}};
  for(const name of ['readFileSync','openSync','lstatSync','statSync','realpathSync','readdirSync','readlinkSync','writeFileSync','appendFileSync','renameSync','unlinkSync','rmSync','rmdirSync','mkdirSync','symlinkSync','linkSync','chmodSync']){
    const original=fs[name],check=args=>checkPrivatePaths(args.slice(0,['renameSync','linkSync','symlinkSync'].includes(name)?2:1));
    fs[name]=(...args)=>{check(args);return original(...args);};
    if(typeof original.native==='function')fs[name].native=(...args)=>{check(args);return original.native(...args);};
  }
  for(const name of ['readFile','open','lstat','stat','realpath','readdir','readlink','writeFile','appendFile','rename','unlink','rm','rmdir','mkdir','symlink','link','chmod','opendir']){
    const original=fsp[name];fsp[name]=async(...args)=>{checkPrivatePaths(args.slice(0,['rename','link','symlink'].includes(name)?2:1));return original(...args);};
  }
  syncBuiltinESMExports();
  const owner=await import(pathToFileURL(join(artifact,'studio-file-runtime-owner.mjs')).href);
  owner.registerFileRuntimeFixture({dataRoot,artifactRoot:artifact,release:{revision:r.revision,sourceTree:r.sourceTree,buildId:r.buildId}});
  const topology=owner.fileRuntimeFixtureSupervisor(dataRoot);assert(topology.preload===self&&topology.port===port&&topology.base===base,'qa_topology_binding');
  const time=await import(pathToFileURL(join(artifact,'studio-memory-account-time.mjs')).href),keys=syntheticPair(r.fixtureId),generation=randomUUID();let sequence=0;
  time.registerSyntheticMemoryTimePolicy({dataRoot,policy:v.policy,bootIdentity:()=>`mi1-independent-${process.pid}-${generation}`,
    provider:{async acquire(request,signal){
      assert(!signal.aborted&&privateFile(join(parent,INPUT),8192).digest===input.digest,'qa_time_input_changed');
      observe('injected-time','assertion');const now=Date.now();assert(now>=v.epochMs-60000&&now<v.epochMs+3600000,'qa_fixture_time_window');
      const value={version:1,requestDigest:hash(JSON.stringify(request)),providerId:v.policy.providerId,keyId:v.policy.keyId,utcMs:now,uncertaintyMs:25,sequence:++sequence,issuedAtMs:now-1000,expiresAtMs:Math.min(now+60000,v.policy.keyNotAfterMs)};
      return {...value,signature:sign(null,Buffer.from(JSON.stringify(value)),keys.privateKey).toString('base64url')};
    }}});
  observe('realm-registered',basename(process.argv[1]??''));
  process.once('exit',()=>{try{observe('realm-exit');fs.closeSync(observer);}catch{/* Process death yields explicitly incomplete observation. */}});
}

// Importing the authored source as a preparation helper is pure. Only its
// strict copied fixture pathname performs realm registration under a B packet.
if(basename(fileURLToPath(import.meta.url))===PRELOAD)await registerCopiedPreload();
