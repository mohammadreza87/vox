/** Independent synthetic ATI1 harness: concrete StudioStore and canonical FILE,
 * actual Studio/update/gateway/poller/client/transport; all model/HTTP injected. */
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {vi} from 'vitest';
import {AdaptiveService} from '../../adaptive/persistence/service';
import {AdaptiveRepository,accountIdFor,type AdaptiveDocument} from '../../adaptive/persistence/repository';
import {FileAdaptiveStorage} from '../../adaptive/persistence/storage';
import {adaptiveOptionsFromManifest} from '../../adaptive/persistence/config';
import {AdaptiveRelationshipService} from '../../adaptive/relationships/service';
import {TelegramBotClient,type TelegramUpdate} from '../../tireh/telegram/client';
import {StudioAssistantTextIntegration} from '../assistant-text-integration';
import {handleAgentUpdate} from '../updates';
import {startBots} from '../bots';
import {acquireFileRuntimeOwner,installFileRuntimeOwnerMarker,type FileRuntimeOwner} from '../file-runtime-owner';
import {hire,ID,makeStudio,seedOrg} from './helpers';

export const ATI_NOW=Date.parse('2026-10-27T12:00:00Z');
export const ATI_GENERATED='ATI1_PRIVATE_GENERATED_فارسی';
export interface AtiHttpCall {method:string;body:Record<string,unknown>;bytes:number}
export async function atiFixture(enroll=true,owned=false) {
  let fileOwner:FileRuntimeOwner|undefined;
  const h=makeStudio(owned?{beforeStore:dir=>{fileOwner=acquireFileRuntimeOwner({dataRoot:dir,release:{revision:'f895ba59fc43fe9677e08fa602cc48c08ccdf3f8',sourceTree:'9dddab6c6d5ed02ced0ac7f011cfb64f83f3cd44',buildId:'synthetic-owned-ati'}});installFileRuntimeOwnerMarker(fileOwner);}}:{});
  if(fileOwner)h.studio.deps.fileRuntimeOwner=fileOwner;
  h.clock.now=new Date(ATI_NOW);const org=await seedOrg(h);
  h.manager.getManagedBotToken.mockImplementation(async(botId:number)=>`${botId}:ATI1_SYNTHETIC_CREDENTIAL_FOR_TEST_ONLY`);
  const hired=await hire(h,org.alice),agentId=hired.agent.id,botId=hired.botId,token=h.studio.botToken(hired.agent)!;
  const capabilities=['core_text','personalization','auto_memory'];
  const options=adaptiveOptionsFromManifest(JSON.stringify({schemaVersion:1,configurationVersion:'qa-ati1',enabledCapabilities:capabilities,
    accounts:[ID.alice,ID.bob].map(owner=>({accountId:accountIdFor(owner),jurisdictionKeys:['SYNTHETIC'],allowDeclaredAdult:true})),
    approvals:capabilities.map((capability,n)=>({schemaVersion:1,id:`qa-ati1-${n}`,revision:1,createdAt:ATI_NOW,updatedAt:ATI_NOW,
      jurisdiction:'SYNTHETIC',capability,state:'approved',configurationVersion:'qa-ati1',effectiveAt:ATI_NOW,reviewExpiresAt:ATI_NOW+30*86400000,owner:'synthetic',approvalReference:'synthetic'}))}));
  const adaptive=new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(h.dir,'adaptive'))),{...options,scopedRelationshipsEnabled:true,now:()=>h.clock.now.getTime()});
  h.adaptive=adaptive;h.studio.deps.adaptive=adaptive;h.studio.deps.relationshipAuthority=new AdaptiveRelationshipService(adaptive);
  for(const owner of [ID.alice,ID.bob]){
    await adaptive.confirm(owner,{confirm:true,adultConfirmed:true});
    for(const purpose of ['optional.personalization','optional.auto_memory'] as const){const view=await adaptive.read(owner,'work');
      const shown=await adaptive.present(owner,{space:'work',purpose,locale:'en',expectedRevision:view.purposes.find(p=>p.purpose===purpose)!.revision,eventId:randomUUID()});
      await adaptive.changeConsent(owner,{space:'work',purpose,state:'granted',expectedRevision:shown.purposes.find(p=>p.purpose===purpose)!.revision,eventId:randomUUID(),receipt:shown.receipt});}
    await adaptive.setAgentAccess(owner,agentId,{space:'work',allowed:true,expectedRevision:(await adaptive.read(owner,'work')).revision,eventId:randomUUID()});
  }
  Object.assign(h.chatLLM,{committedExportFence:true});
  h.chatLLM.nextReply=ATI_GENERATED;
  // These are unrelated profile provisioning jobs, already completed by hire.
  vi.spyOn(h.studio,'nudgeBotProfile').mockImplementation(()=>undefined);
  h.studio.deps.managerBot=null;
  const calls:AtiHttpCall[]=[],pollOffsets:Array<number|undefined>=[],batches:TelegramUpdate[][]=[];
  let pendingPoll:((updates:TelegramUpdate[])=>void)|undefined,stop:(()=>void)|undefined;
  let enabled=true,active=true,nextOutbound=91000;
  const keys=new Map([['qa-ati-key',new Uint8Array(32).fill(201)]]);
  let replyHook:((call:AtiHttpCall)=>Promise<Response>)|undefined;
  const fetchFn:typeof fetch=async(url,init)=>{
    const method=String(url).split('/').at(-1)!,raw=typeof init?.body==='string'?init.body:Buffer.from(init?.body as Uint8Array).toString('utf8');
    const body=raw?JSON.parse(raw) as Record<string,unknown>:{},call={method,body,bytes:Buffer.byteLength(raw)};
    if(method==='getUpdates'){
      pollOffsets.push(body.offset as number|undefined);
      const batch=batches.shift()??await new Promise<TelegramUpdate[]>(resolve=>{pendingPoll=resolve;});
      return Response.json({ok:true,result:batch});
    }
    if(method==='deleteWebhook')return Response.json({ok:true,result:true});
    if(method==='getWebhookInfo')return Response.json({ok:true,result:{url:''}});
    calls.push(call);
    if(method==='sendMessage'){
      if(replyHook)return replyHook(call);
      return Response.json({ok:true,result:{message_id:nextOutbound++,date:Math.floor(h.clock.now.getTime()/1000),from:{id:botId,is_bot:true},chat:{id:body.chat_id,type:'private'},text:body.text}});
    }
    return Response.json({ok:true,result:true});
  };
  const clients=new Map<string,TelegramBotClient>();
  h.studio.deps.botFor=(credential:string)=>{let client=clients.get(credential);if(!client){client=new TelegramBotClient(credential,fetchFn,fileOwner?{beforeAuthorize:()=>fileOwner!.assertCurrent(),assertActive:()=>fileOwner!.assertActive(),signal:fileOwner.signal}:undefined);clients.set(credential,client);}return client;};
  const serviceOptions={enabled:()=>enabled,keys:{current:()=>({keyId:'qa-ati-key',key:keys.get('qa-ati-key')!}),resolve:(id:string)=>keys.get(id)},fetchFn,now:()=>h.clock.now.getTime()};
  let integration=new StudioAssistantTextIntegration(h.studio,serviceOptions);h.studio.deps.assistantText=integration;
  let poller=integration.poller(agentId,botId,token,()=>active);
  const controlInput=()=>({ownerId:ID.alice,agentId,botId});
  if(enroll)await integration.enroll({...controlInput(),requestId:randomUUID(),expectedEnrollmentRevision:null});
  h.clock.now=new Date(h.clock.now.getTime()+2000);
  let nextMessage=11;
  const update=(text='A synthetic ordinary question',owner=ID.alice):TelegramUpdate=>{const n=nextMessage++;return {update_id:n,message:{message_id:n,date:Math.floor((h.clock.now.getTime()-1000)/1000),from:{id:owner,is_bot:false,first_name:'QA'},chat:{id:owner,type:'private'},text}};};
  const path=(owner=ID.alice)=>join(h.dir,'adaptive',`${createHash('sha256').update(accountIdFor(owner)).digest('hex')}.json`);
  const document=(owner=ID.alice)=>JSON.parse(readFileSync(path(owner),'utf8')) as AdaptiveDocument;
  const handle=(u:TelegramUpdate,capability:typeof poller|undefined=poller)=>handleAgentUpdate(h.studio,agentId,u,h.studio.relationshipEndpointId(token),capability);
  const unbound=(u:TelegramUpdate)=>handleAgentUpdate(h.studio,agentId,u);
  const push=(u:TelegramUpdate)=>{if(pendingPoll){const resolve=pendingPoll;pendingPoll=undefined;resolve([u]);}else batches.push([u]);};
  async function throughPoller(u:TelegramUpdate){if(!stop)stop=startBots(h.studio).stop;push(u);for(let i=0;i<2000;i++){if(pollOffsets.some(n=>n===u.update_id+1))return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('QA poller did not acknowledge within fixed local budget');}
  return {h,org,agentId,botId,token,keys,calls,pollOffsets,update,document,path,handle,unbound,push,throughPoller,controlInput,fileOwner,
    get integration(){return integration;},get poller(){return poller;},get adaptive(){return adaptive;},
    enabled:(value:boolean)=>{enabled=value;},active:(value:boolean)=>{active=value;},
    replyHook:(hook:typeof replyHook)=>{replyHook=hook;},clearCalls:()=>{calls.length=0;},
    recreateService:()=>{integration=new StudioAssistantTextIntegration(h.studio,serviceOptions);h.studio.deps.assistantText=integration;poller=integration.poller(agentId,botId,token,()=>active);},
    cleanup:()=>{stop?.();active=false;pendingPoll?.([]);rmSync(h.dir,{recursive:true,force:true});},
    closeOwned:async()=>{active=false;pendingPoll?.([]);await stop?.();fileOwner?.beginDrain();rmSync(h.dir,{recursive:true,force:true});},
  };
}
export type AtiFixture=Awaited<ReturnType<typeof atiFixture>>;
