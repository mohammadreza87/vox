/** Build-emitted MI1 entry: actual FILE repository in the controller's shared owner/time realm. */
import { createHash } from 'node:crypto';
import * as readonlyFs from 'node:fs';
import { join } from 'node:path';
import { inspectManagedMemoryAccountPreflightTransients, readManagedMemoryAccountPreflight, readManagedMemoryAccountOperation, inspectManagedMemoryAccountRoot, type ManagedMemoryAccountOperation, type ManagedMemoryAccountPreflight } from '../../../scripts/studio-memory-account-operation.mjs';
import { publishMemoryAccountRoot, readMemoryAccountRoot, readMemoryAccountPrivateFile } from '../adaptive/memory-account-lifecycle-file';
import { isMemoryAccountErasing, assertMemoryAccountId, memoryAccountTimeSchema, MEMORY_ACCOUNT_TIME, MEMORY_ACCOUNT_MARKER, MEMORY_ACCOUNT_MARKER_BYTES } from '../adaptive/memory-account-lifecycle';
import { AdaptiveRepository, prepareExistingMemoryAccountMigration } from '../adaptive/persistence/repository';
import { FileAdaptiveStorage, MAX_ADAPTIVE_DOCUMENT_BYTES } from '../adaptive/persistence/storage';
import { fileRuntimeFs as fs, FILE_RUNTIME_OWNER_MARKER, FILE_RUNTIME_OWNER_MARKER_BYTES } from './file-runtime-owner';
import { assertQualifiedMemoryPreflightTime, type QualifiedMemoryPreflightTime } from '../adaptive/memory-account-time';
const MIGRATION_SCAN_BYTES=64*1024*1024,MIGRATION_ACCOUNTS=10000;
const PROSPECTIVE_INCARNATION='0'.repeat(64); // Nonpersisted size/validation placeholder, never reserved authority.
const fixedControls=new Map([
  [FILE_RUNTIME_OWNER_MARKER,FILE_RUNTIME_OWNER_MARKER_BYTES],
  [MEMORY_ACCOUNT_MARKER,MEMORY_ACCOUNT_MARKER_BYTES],
  [FileAdaptiveStorage.assistantControlMarker,FileAdaptiveStorage.assistantControlMarkerBytes],
  [FileAdaptiveStorage.assistantControlV2Marker,FileAdaptiveStorage.assistantControlV2MarkerBytes],
]);
const unavailable=()=>{throw new Error('memory_account_migration_preflight_unavailable');};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function readonlyIdentity(stat:readonlyFs.BigIntStats){return [stat.dev,stat.ino,stat.birthtimeNs,stat.uid,stat.mode].map(String);}
function readonlyMetadata(stat:readonlyFs.BigIntStats){return [...readonlyIdentity(stat),...['nlink','size','ctimeNs','mtimeNs'].map(key=>String(stat[key as keyof readonlyFs.BigIntStats]))];}
function readonlyPrivateFile(path:string,maximum:number,expected?:{dev:string;ino:string;birth:string}):string {
  const before=readonlyFs.lstatSync(path,{bigint:true});
  if(expected&&!same({dev:String(before.dev),ino:String(before.ino),birth:String(before.birthtimeNs)},expected))return unavailable();
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==BigInt(1)||before.uid!==BigInt(process.geteuid!())||(before.mode&BigInt(0o777))!==BigInt(0o600)||before.size>BigInt(maximum))return unavailable();
  const descriptor=readonlyFs.openSync(path,readonlyFs.constants.O_RDONLY|readonlyFs.constants.O_NOFOLLOW|readonlyFs.constants.O_NONBLOCK);
  try{
    const held=readonlyFs.fstatSync(descriptor,{bigint:true}),buffer=Buffer.alloc(maximum+1);let length=0,read;
    do{read=readonlyFs.readSync(descriptor,buffer,length,buffer.length-length,null);length+=read;}while(read&&length<buffer.length);
    const after=readonlyFs.fstatSync(descriptor,{bigint:true}),named=readonlyFs.lstatSync(path,{bigint:true});
    if(length>maximum||!same(readonlyMetadata(before),readonlyMetadata(held))||!same(readonlyMetadata(held),readonlyMetadata(after))||!same(readonlyMetadata(after),readonlyMetadata(named)))return unavailable();
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));
  }finally{readonlyFs.closeSync(descriptor);}
}
function readonlyNames(directory:string,controlTransients=0):string[] {
  const handle=readonlyFs.opendirSync(directory),names:string[]=[];
  try{let row;while((row=handle.readSync())!==null){if(!row.isFile()||names.length>=MIGRATION_ACCOUNTS+5+controlTransients)return unavailable();names.push(row.name);}}
  finally{handle.closeSync();}
  return names.sort();
}
type MigrationReadAuthority={kind:'preflight';binding:ManagedMemoryAccountPreflight;preflight:QualifiedMemoryPreflightTime}|{kind:'stopped';operation:ManagedMemoryAccountOperation};
/** Private scan receives only real registered read or stopped authority, never arbitrary callbacks. */
function prospectiveMigrationInventory(authority:MigrationReadAuthority):{inventoryDigest:string} {
  const bound=authority.kind==='preflight'?readManagedMemoryAccountPreflight(authority.binding):readManagedMemoryAccountOperation(authority.operation);
  const root=bound.dataRoot,directory=join(root,'adaptive');
  const classification=authority.kind==='preflight'?inspectManagedMemoryAccountPreflightTransients({binding:authority.binding,preflight:authority.preflight}):{snapshotDigest:'',transients:[]};
  const controlTransients=new Map(classification.transients.map(row=>[row.name,row]));
  const sample=()=>{
    if(authority.kind==='preflight'){
      const current=readManagedMemoryAccountPreflight(authority.binding);
      if(current.dataRoot!==root)return unavailable();
      assertQualifiedMemoryPreflightTime(authority.preflight,{binding:authority.binding,dataRoot:root,artifactDigest:current.artifactDigest});
      return authority.preflight.sampleNow();
    }
    const current=readManagedMemoryAccountOperation(authority.operation);
    if(current.dataRoot!==root)return unavailable();return current.checkDeadline();
  };
  const rootFd=readonlyFs.openSync(root,readonlyFs.constants.O_RDONLY|readonlyFs.constants.O_NOFOLLOW);
  let directoryFd:number|undefined;
  try{
    directoryFd=readonlyFs.openSync(directory,readonlyFs.constants.O_RDONLY|readonlyFs.constants.O_NOFOLLOW);
    const rootIdentity=readonlyIdentity(readonlyFs.fstatSync(rootFd,{bigint:true})),directoryIdentity=readonlyIdentity(readonlyFs.fstatSync(directoryFd,{bigint:true}));
    const assertDirectories=()=>{
      for(const [path,fd,identity] of [[root,rootFd,rootIdentity],[directory,directoryFd!,directoryIdentity]] as const){
        const named=readonlyFs.lstatSync(path,{bigint:true}),held=readonlyFs.fstatSync(fd,{bigint:true});
        if(!named.isDirectory()||named.isSymbolicLink()||named.uid!==BigInt(process.geteuid!())||(named.mode&BigInt(0o077))!==BigInt(0)||!same(readonlyIdentity(named),identity)||!same(readonlyIdentity(held),identity))return unavailable();
      }
    };
    assertDirectories();const names=readonlyNames(directory,controlTransients.size);
    let expectedDigest:string|undefined;
    for(let pass=0;pass<2;pass++){
      const stream=createHash('sha256');let actualBytes=0,projectedBytes=256+128,accounts=0,marker=false,highWater:number|undefined;
      // Controls are validated before any account candidate; high-water is not UTC authority.
      const controlTexts=new Map<string,string>();
      for(const name of names)if(fixedControls.has(name)||name===MEMORY_ACCOUNT_TIME){
        const text=readonlyPrivateFile(join(directory,name),name===MEMORY_ACCOUNT_TIME?256:128);controlTexts.set(name,text);
        if(name===MEMORY_ACCOUNT_TIME){const parsed=memoryAccountTimeSchema.parse(JSON.parse(text));if(text!==`${JSON.stringify(parsed)}\n`)return unavailable();highWater=parsed.highWaterMs;}
        else if(text!==fixedControls.get(name))return unavailable();
        if(name===MEMORY_ACCOUNT_MARKER)marker=true;
      }
      if(!controlTexts.has(FILE_RUNTIME_OWNER_MARKER)||marker&&highWater===undefined)return unavailable();
      const observed=sample();if(highWater!==undefined&&observed.utcUpperMs<highWater)return unavailable();
      for(const name of names){
        assertDirectories();const transient=controlTransients.get(name);
        if(transient){const text=readonlyPrivateFile(join(directory,name),transient.purpose==='time'?256:128,transient.identity);if(createHash('sha256').update(text).digest('hex')!==transient.digest)return unavailable();continue;}
        const control=controlTexts.get(name),isAccount=/^[a-f0-9]{64}\.json(?![\s\S])/.test(name);
        if(control===undefined&&!isAccount)return unavailable();
        const text=control??readonlyPrivateFile(join(directory,name),MAX_ADAPTIVE_DOCUMENT_BYTES),length=Buffer.byteLength(text);
        actualBytes+=length;if(actualBytes>MIGRATION_SCAN_BYTES)return unavailable();
        stream.update(`${Buffer.byteLength(name)}:${name}:${length}:`);stream.update(text);
        if(control!==undefined){if(name!==MEMORY_ACCOUNT_TIME&&name!==MEMORY_ACCOUNT_MARKER)projectedBytes+=length;}
        else{
          if(++accounts>MIGRATION_ACCOUNTS)return unavailable();
          const current=JSON.parse(text) as {accountId?:unknown;memoryLifecycle?:unknown};
          if(typeof current.accountId!=='string'||createHash('sha256').update(current.accountId).digest('hex')!==name.slice(0,-5)||!marker&&current.memoryLifecycle!==undefined)return unavailable();
          const prospective=prepareExistingMemoryAccountMigration(current,current.accountId,sample().utcUpperMs,PROSPECTIVE_INCARNATION);
          // Already qualified rows are not rewritten: retain their exact raw byte footprint.
          projectedBytes+=current.memoryLifecycle===undefined?Buffer.byteLength(prospective.encoded):length;
        }
        if(projectedBytes>MIGRATION_SCAN_BYTES)return unavailable();
      }
      assertDirectories();if(!same(readonlyNames(directory,controlTransients.size),names))return unavailable();
      const digest=stream.digest('hex');if(expectedDigest!==undefined&&digest!==expectedDigest)return unavailable();expectedDigest=digest;
    }
    assertDirectories();
    if(authority.kind==='preflight'&&!same(inspectManagedMemoryAccountPreflightTransients({binding:authority.binding,preflight:authority.preflight}),classification))return unavailable();
    sample();return {inventoryDigest:expectedDigest!};
  }finally{if(directoryFd!==undefined)readonlyFs.closeSync(directoryFd);readonlyFs.closeSync(rootFd);}
}
/** Readonly actual pre-stop admission. Never constructs a FILE writer or returns account data. */
export function preflightManagedMemoryAccountMigration(input:{binding:ManagedMemoryAccountPreflight;preflight:QualifiedMemoryPreflightTime}) {
  try{
    if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='binding,preflight')return unavailable();
    return {version:1 as const,status:'eligible' as const,...prospectiveMigrationInventory({kind:'preflight',binding:input.binding,preflight:input.preflight})};
  }
  catch{return unavailable();}
}

export const memoryAccountMaintenanceVersion = 1;
export { publishMemoryAccountRoot };

/** Metadata-only inspection does not mint an operation or admit partial roots. */
export function inspectMemoryAccountMaintenance({dataRoot}:{dataRoot:string}) {
  return readMemoryAccountRoot(join(dataRoot,'adaptive'));
}
export async function migrateMemoryAccountRoot({operation}:{operation:ManagedMemoryAccountOperation}) {
  const context=readManagedMemoryAccountOperation(operation),directory=join(context.dataRoot,'adaptive');
  inspectManagedMemoryAccountRoot(operation,{stage:'before-migration'});
  const storage=new FileAdaptiveStorage(directory),repository=new AdaptiveRepository(storage),clock=()=>context.checkDeadline().nowMs;
  // Bound retained enumeration keys; payloads are validated/current only and discarded per row.
  const names=fs.readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort();
  if(names.length>10000)throw new Error('Memory account capacity unavailable');
  let aggregate=0;
  for(const name of names){
    context.assertCurrent();context.checkDeadline();
    const path=join(directory,name),bytes=readMemoryAccountPrivateFile(path,MAX_ADAPTIVE_DOCUMENT_BYTES);
    if(bytes===null)continue; // True absence cannot be reconstructed by migration.
    aggregate+=Buffer.byteLength(bytes);if(aggregate>64*1024*1024)throw new Error('Memory account capacity unavailable');
    const current=JSON.parse(bytes) as {accountId?:unknown};
    if(typeof current.accountId!=='string'||isMemoryAccountErasing(current))throw new Error('Memory account migration unavailable');
    assertMemoryAccountId(current.accountId);
    if(createHash('sha256').update(current.accountId).digest('hex')!==name.slice(0,-5))throw new Error('Memory account identity unavailable');
    // This method reacquires the actual account lock and rereads current bytes.
    // An absent row stays absent even if it disappears after enumeration.
    try{await repository.migrateExistingMemoryAccount(current.accountId,clock);}
    catch(error){if(readMemoryAccountPrivateFile(path,MAX_ADAPTIVE_DOCUMENT_BYTES)!==null)throw error;}
    context.assertCurrent();context.checkDeadline();
  }
  return inspectManagedMemoryAccountRoot(operation,{stage:'accounts-qualified'});
}
export async function runManagedMemoryAccountMaintenance({operation}:{operation:ManagedMemoryAccountOperation}) {
  const context=readManagedMemoryAccountOperation(operation);
  if(context.action!=='initialize'&&context.action!=='resume')throw new Error('Memory account operation unavailable');
  inspectManagedMemoryAccountRoot(operation,{stage:'before-publication'});
  try{prospectiveMigrationInventory({kind:'stopped',operation});}catch{return unavailable();}
  publishMemoryAccountRoot(operation);
  const result=await migrateMemoryAccountRoot({operation});
  return {version:1 as const,status:'accounts_qualified' as const,...result};
}
