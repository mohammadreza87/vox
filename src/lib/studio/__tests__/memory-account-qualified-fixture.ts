/** Independent same-root FILE/Studio/qualified-time fixture. Initial state is
 * synthetic; this is not the managed/native publication or runtime startup. */
import {readFileSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createManagedTimeFixture} from '../../../../scripts/fixtures/memory-account-managed-fixture.mjs';
import {qualifiedMemoryClock} from '../../adaptive/memory-account-time';
import {AdaptiveRepository,accountIdFor,type AdaptiveDocument} from '../../adaptive/persistence/repository';
import {FileAdaptiveStorage} from '../../adaptive/persistence/storage';
import {AdaptiveService} from '../../adaptive/persistence/service';
import {adaptiveOptionsFromManifest} from '../../adaptive/persistence/config';
import {AdaptiveRelationshipService} from '../../adaptive/relationships/service';
import {Studio} from '../service';
import {StudioStore} from '../store';
import {StudioMemoryAccount} from '../memory-account';
import {handleMemoryAccountRequest} from '../memory-account-http';
import {agentInit} from './initdata-keys';
import {makeStudio,seedOrg,ID} from './helpers';

export const MI1_MANAGER='710001:MI1_SYNTHETIC_MANAGER_TEST_ONLY';
export const MI1_ORIGIN='https://mi1.example';
export async function qualifiedAccountFixture(options:{marked?:boolean;seed?:boolean;manual?:boolean;shortLease?:boolean;wideInterval?:boolean}={}) {
  const f=createManagedTimeFixture({manual:options.manual,assertionLifetimeMs:options.shortLease?5000:60000,
    uncertaintyMs:options.wideInterval?2500:25,
    policy:{...(options.shortLease?{}:{maxExtrapolationAgeMs:60000,maxAssertionLifetimeMs:120000}),...(options.wideInterval?{maxUncertaintyMs:5000}:{})}});
  const permit=await f.acquire(),clock1=qualifiedMemoryClock(permit),clock2=qualifiedMemoryClock(permit);
  let businessClock:()=>number=clock2,manager=MI1_MANAGER;
  const h=makeStudio({adaptive:false}),unusedDirectory=h.dir;
  const capabilities=['core_text','personalization','auto_memory'];
  const config=adaptiveOptionsFromManifest(JSON.stringify({schemaVersion:1,configurationVersion:'mi1-independent',enabledCapabilities:capabilities,
    accounts:[ID.alice,ID.bob].map(id=>({accountId:accountIdFor(id),jurisdictionKeys:['SYNTHETIC'],allowDeclaredAdult:true})),
    approvals:capabilities.map((capability,n)=>({schemaVersion:1,id:`mi1-independent-${n}`,revision:1,createdAt:f.now(),updatedAt:f.now(),
      jurisdiction:'SYNTHETIC',capability,state:'approved',configurationVersion:'mi1-independent',effectiveAt:f.now()-1000,
      reviewExpiresAt:f.now()+30*86400000,owner:'synthetic',approvalReference:'synthetic-only'}))}));
  const repository=new AdaptiveRepository(new FileAdaptiveStorage(f.directory));
  const adaptive=new AdaptiveService(repository,{...config,now:()=>businessClock()});
  const store=new StudioStore(f.dataRoot);
  const studio=new Studio({...h.studio.deps,store,adaptive,fileRuntimeOwner:f.owner,
    relationshipAuthority:new AdaptiveRelationshipService(adaptive),managerBot:h.studio.deps.managerBot,
    webAppUrl:MI1_ORIGIN+'/studio',now:()=>new Date(businessClock())});
  h.studio=studio;h.store=store;h.dir=f.dataRoot;h.adaptive=adaptive;
  Object.defineProperty(h.clock,'now',{get:()=>new Date(businessClock()),configurable:true});
  if(options.seed!==false){
    await seedOrg(h);
    for(const owner of [ID.alice,ID.bob])await adaptive.confirm(owner,{confirm:true,adultConfirmed:true});
  }else await store.read();
  if(options.marked!==false){
    f.mark();
    if(options.seed!==false)for(const owner of [ID.alice,ID.bob])await repository.migrateExistingMemoryAccount(accountIdFor(owner),clock1);
  }
  // Match actual runtime composition: a changed configured token requires a
  // reload instead of presenting the old manager instance as the new one.
  const account=new StudioMemoryAccount(studio,{time:permit,managerToken:()=>manager===MI1_MANAGER?manager:''});studio.deps.memoryAccount=account;
  const path=(owner=ID.alice)=>join(f.directory,createHash('sha256').update(accountIdFor(owner)).digest('hex')+'.json');
  const raw=(owner=ID.alice)=>readFileSync(path(owner),'utf8');
  const document=(owner=ID.alice)=>JSON.parse(raw(owner)) as AdaptiveDocument;
  const init=(owner=ID.alice,date=Math.floor(account.now()/1000),extra:Record<string,string>={})=>agentInit({id:owner,first_name:'MI1 QA'},manager,date,extra);
  const request=(part='',o:{owner?:number;body?:unknown;method?:string;initData?:string;signal?:AbortSignal;headers?:Record<string,string>}={})=>{
    const method=o.method??(o.body===undefined?'GET':'POST');
    return handleMemoryAccountRequest(studio,new Request(MI1_ORIGIN+'/api/studio/memory-account'+(part?'/'+part:''),{
      method,headers:{origin:MI1_ORIGIN,'content-type':'application/json','x-telegram-init-data':o.initData??init(o.owner),...o.headers},
      signal:o.signal,...(method==='GET'?{}:{body:JSON.stringify(o.body??{})}),}),part?part.split('/'):[],()=>manager);
  };
  return {f,h,studio,store,adaptive,repository,account,permit,clock1,clock2,path,raw,document,init,request,
    setBusinessClock:(clock:()=>number)=>{businessClock=clock;},rotateManager:()=>{manager='710002:MI1_ROTATED_SYNTHETIC_MANAGER';},
    remove:(owner=ID.alice)=>unlinkSync(path(owner)),replace:(value:AdaptiveDocument,owner=ID.alice)=>writeFileSync(path(owner),JSON.stringify(value),{mode:0o600}),
    close:()=>{try{f.close();}finally{rmSync(unusedDirectory,{recursive:true,force:true});}},
  };
}
export type QualifiedAccountFixture=Awaited<ReturnType<typeof qualifiedAccountFixture>>;
