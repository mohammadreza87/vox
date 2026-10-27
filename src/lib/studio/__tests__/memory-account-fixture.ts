/** Independent ER1 fixture: real owner/FILE/Studio/update/gateway; synthetic auth/HTTP/clock only. */
import {performance} from 'node:perf_hooks';
import {readFileSync,readdirSync,lstatSync,writeFileSync,unlinkSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {accountIdFor} from '../../adaptive/persistence/repository';
import {MEMORY_ACCOUNT_MARKER,MEMORY_ACCOUNT_MARKER_BYTES,MEMORY_ACCOUNT_TIME} from '../../adaptive/memory-account-lifecycle';
import {setFileRuntimeIoHooks} from '../../../test/fro1-io-fixture';
import {StudioMemoryAccount,type MemoryAccountSession} from '../memory-account';
import {handleMemoryAccountRequest,verifyMemoryAccountInitData} from '../memory-account-http';
import {agentInit} from './initdata-keys';
import {atiFixture} from './assistant-text-integration-fixture';
import {ID} from './helpers';

export const MEMORY_MANAGER='710001:ER1_SYNTHETIC_MANAGER_TEST_ONLY';
export const MEMORY_ORIGIN='https://vox.example';
export function directoryImage(root:string){
  const rows:Array<{path:string;mode:number;bytes?:number;sha256?:string}>=[];
  const visit=(path:string)=>{const s=lstatSync(path);if(s.isDirectory()){rows.push({path:relative(root,path),mode:s.mode&0o777});for(const n of readdirSync(path).sort())visit(join(path,n));}
    else {const b=readFileSync(path);rows.push({path:relative(root,path),mode:s.mode&0o777,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}};
  visit(root);return rows;
}
export async function memoryAccountFixture(options:{marked?:boolean;migrate?:boolean;qualifiedClock?:boolean}={}){
  const f=await atiFixture(false,true),start=f.h.clock.now.getTime(),anchor=performance.now();let shift=0,managerToken=MEMORY_MANAGER;
  const clock={now:()=>Math.floor(start+performance.now()-anchor+shift),advance:(ms:number)=>{shift+=ms;}};
  Object.defineProperty(f.h.clock,'now',{configurable:true,get:()=>new Date(clock.now()),set:(at:Date)=>{shift+=at.getTime()-clock.now();}});
  f.h.studio.deps.webAppUrl=MEMORY_ORIGIN+'/studio';
  const directory=join(f.h.dir,'adaptive'),repository=f.adaptive.repository;
  const mark=()=>{writeFileSync(join(directory,MEMORY_ACCOUNT_MARKER),MEMORY_ACCOUNT_MARKER_BYTES,{flag:'wx',mode:0o600});writeFileSync(join(directory,MEMORY_ACCOUNT_TIME),JSON.stringify({version:1,highWaterMs:clock.now()})+'\n',{flag:'wx',mode:0o600});};
  if(options.marked!==false){mark();if(options.migrate!==false)for(const id of [ID.alice,ID.bob])await repository.migrateExistingMemoryAccount(accountIdFor(id),clock.now);}
  const account=new StudioMemoryAccount(f.h.studio,options.qualifiedClock===false?{}:{clock:clock.now});f.h.studio.deps.memoryAccount=account;
  const init=(owner=ID.alice,at=Math.floor(clock.now()/1000),extra:Record<string,string>={})=>agentInit({id:owner,first_name:'ER1 QA'},managerToken,at,extra);
  const request=(path='',o:{owner?:number;body?:unknown;method?:string;initData?:string;headers?:Record<string,string>;signal?:AbortSignal;raw?:string;query?:string}={})=>{
    const method=o.method??(o.body===undefined&&o.raw===undefined?'GET':'POST');
    return handleMemoryAccountRequest(f.h.studio,new Request(MEMORY_ORIGIN+'/api/studio/memory-account'+(path?'/'+path:'')+(o.query??''),{
      method,headers:{origin:MEMORY_ORIGIN,'content-type':'application/json','x-telegram-init-data':o.initData??init(o.owner),...o.headers},signal:o.signal,
      ...(method==='GET'?{}:{body:o.raw??JSON.stringify(o.body??{})}),}),path?path.split('/'):[],()=>managerToken);
  };
  const session=(owner=ID.alice):MemoryAccountSession=>{const signed=init(owner);return {ownerId:owner,session:account.session(signed),deadline:Number(new URLSearchParams(signed).get('auth_date'))*1000+300000,authenticate:at=>verifyMemoryAccountInitData(f.h.studio,signed,managerToken,at)?.id===owner,cancelled:()=>false};};
  const challenge=async(owner=ID.alice)=>{const p=await request('preview',{owner,body:{}});if(p.status!==200)throw Error('QA preview unavailable '+p.status);const preview=await p.json();const c=await request('challenge',{owner,body:{action:'fresh-bootstrap',previewDigest:preview.previewDigest}});if(c.status!==200)throw Error('QA challenge unavailable '+c.status);return await c.json() as {nonce:string;expiresAt:number;preview:{previewDigest:string}};};
  return {...f,clock,directory,repository,account,mark,init,request,session,challenge,rotateManager:()=>{managerToken='710002:ER1_ROTATED_SYNTHETIC_MANAGER_TEST_ONLY';},
    removeCanonical:(owner=ID.alice)=>unlinkSync(f.path(owner)),raw:(owner=ID.alice)=>readFileSync(f.path(owner),'utf8')};
}
export type MemoryAccountFixture=Awaited<ReturnType<typeof memoryAccountFixture>>;
export function holdNextCanonicalSync(f:MemoryAccountFixture){
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),released=new Promise<void>(r=>{release=r;});
  let once=true;
  setFileRuntimeIoHooks({afterTemporarySync:async path=>{
    if(!once||!path.startsWith(f.path()+'.')||!path.endsWith('.tmp'))return;
    once=false;enter();await released;
  }});
  return {entered,release};
}
