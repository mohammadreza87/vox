import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { learningFixture } from '@/lib/adaptive/personalization/learning/fixtures';
import { NOW } from '@/lib/adaptive/personalization/__tests__/fixtures';
import { ID } from '@/lib/studio/__tests__/helpers';
import { signInitData } from '@/lib/studio/auth';
import { handleExperienceRequest } from '@/lib/adaptive/runtime/http';
import { experienceApi } from './experience-client';
import { preferenceLearningApi } from './preference-learning-client';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[]=[];
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();delete(window as unknown as{Telegram?:unknown}).Telegram;await Promise.all(fixtures.splice(0).map(x=>x.close()));});
async function setup(){const x=await learningFixture();fixtures.push(x);await x.enable();return x;}
it.each(['ordinary','learning'] as const)('a genuine concurrent FILE read causes one safe %s conflict then a fresh authorized GET succeeds',async kind=>{
 const x=await setup(),token='123:synthetic-read-overlap',initData=signInitData({id:ID.alice,first_name:'Synthetic'},token);(window as unknown as{Telegram:unknown}).Telegram={WebApp:{initData}};
 const name=kind==='ordinary'?'preferences':'preference-learning',otherName=kind==='ordinary'?'preference-learning':'preferences';
 const send=(part:string)=>handleExperienceRequest(x.h.studio,x.experience,new Request(`https://vox.synthetic/api/studio/experience/${part}?space=work&agentId=${x.agent.id}`,{headers:{'x-telegram-init-data':initData}}),[part],token);
 let release=()=>{},observed!:()=>void,other!:Promise<Response>,held=false;const gate=new Promise<void>(r=>release=r),reached=new Promise<void>(r=>observed=r),rename=fs.rename.bind(fs);
 const overlap=async()=>{vi.spyOn(fs,'rename').mockImplementation(async(...args)=>{if(!held&&String(args[1]).startsWith(x.f.directory!)){held=true;observed();await gate;}return rename(...args);});other=send(otherName);await reached;};
 if(kind==='learning'){const view=x.learning.view.bind(x.learning);vi.spyOn(x.learning,'view').mockImplementationOnce(async(...args)=>{const result=await view(...args);await overlap();return result;});}
 else{const view=x.experience.readPreferenceState.bind(x.experience);vi.spyOn(x.experience,'readPreferenceState').mockImplementationOnce(async(...args)=>{const result=await view(...args);await overlap();return result;});}
 const statuses:number[]=[];vi.stubGlobal('fetch',async(path:string,options:RequestInit)=>{expect(options.method).toBe('GET');expect(path).toContain(name);const url=new URL(path,'https://vox.synthetic'),response=await handleExperienceRequest(x.h.studio,x.experience,new Request(url,options),[name],token);statuses.push(response.status);if(response.status===409){release();expect((await other).status).toBe(200);}return response;});
 try{const result=kind==='ordinary'?await experienceApi.preferenceState('work',x.agent.id):await preferenceLearningApi.read('work',x.agent.id);expect(result.agentId).toBe(x.agent.id);expect(statuses).toEqual([409,200]);expect(held).toBe(true);}
 finally{release();if(other)await other;}
});
it.each(['current','expired'] as const)('samples queued FILE transaction time after a newer commit (%s binding), including validation and expiry callbacks',async binding=>{
 const x=await setup(),token='123:synthetic-read-clock';
 if(binding==='expired')await x.f.adaptive.withAccountDocument(ID.alice,d=>{d.binding!.expiresAt=NOW+1;});
 const storage=x.f.adaptive.repository.storage,original=storage.transact.bind(storage);let release=()=>{},entered!:()=>void;const reached=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 vi.spyOn(storage,'transact').mockImplementationOnce(async(...args)=>{entered();await gate;return original(...args);});
 const request=new Request(`https://vox.synthetic/api/studio/experience/preference-learning?space=work&agentId=${x.agent.id}`,{headers:{'x-telegram-init-data':signInitData({id:ID.alice,first_name:'Synthetic'},token)}});
 const pending=handleExperienceRequest(x.h.studio,x.experience,request,['preference-learning'],token);await reached;
 try{x.setNow(NOW+5);await x.f.adaptive.withAccountDocument(ID.alice,(d,now)=>{d.revision++;d.updatedAt=now;});release();const response=await pending;expect(response.status).toBe(200);const view=await response.json();expect(view.enabled).toBe(binding==='current');if(binding==='expired')expect(view).toMatchObject({reason:'profile_confirmation_required',candidates:[]});}
 finally{release();await pending;}
});
it('a genuinely future canonical document remains rejected rather than being retried or clock-clamped',async()=>{
 const x=await setup(),storage=x.f.adaptive.repository.storage;
 await storage.transact(`telegram-account:${ID.alice}`,current=>({document:{...(current as object),updatedAt:NOW+1000},result:undefined}));
 await expect(x.f.adaptive.read(ID.alice,'work')).rejects.toThrow('Invalid adaptive document');
});
it('the committed-read validator and effect callback sample after synchronous FILE loading',async()=>{
 const x=await setup(),storage=x.f.adaptive.repository.storage,read=storage.readCommittedForEffect!.bind(storage);
 await storage.transact(`telegram-account:${ID.alice}`,current=>({document:{...(current as object),updatedAt:NOW+5},result:undefined}));
 vi.spyOn(storage,'readCommittedForEffect').mockImplementation(account=>{const snapshot=read(account);x.setNow(NOW+5);return snapshot;});
 const result=x.f.adaptive.readCommittedForEffect(ID.alice,(document,now)=>({updatedAt:document.updatedAt,now}));
 expect(result).toEqual({status:'ready',value:{updatedAt:NOW+5,now:NOW+5}});
});
