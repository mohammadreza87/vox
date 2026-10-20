import {it,expect,vi} from 'vitest';import {rm} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {preferenceFixture,NOW} from '@/lib/adaptive/personalization/__tests__/fixtures';
import {makeStudio,seedOrg,hire,ID} from '@/lib/studio/__tests__/helpers';
import {AnthropicLLM} from '@/lib/tireh/llm';import {handleAdaptiveRequest} from '@/lib/adaptive/persistence/http';import {signInitData} from '@/lib/studio/auth';
it('a real block/unblock round trip invalidates the previously signed summary preview',async()=>{
 const h=makeStudio({adaptive:false});const users=await seedOrg(h);const {agent}=await hire(h,users.alice,{},undefined,'private');
 const f=await preferenceFixture({file:true,telegramId:ID.alice,agentId:agent.id});
 try{
 h.studio.deps.adaptive=f.adaptive;h.studio.deps.now=()=>new Date(NOW);await f.agent();await h.store.update(s=>{s.agents.find(a=>a.id===agent.id)!.blocked=[]});
 const llm=new AnthropicLLM('synthetic-not-real','synthetic-model');Object.assign(llm,{client:{messages:{create:vi.fn(async()=>({content:[{type:'text',text:'Synthetic reviewed draft.'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}))}}});h.studio.deps.chatLLM=llm;
 for(const text of ['Source one.','Source two.'])await f.adaptive.createMemory(ID.alice,{space:'work',text,expectedRevision:(await f.adaptive.read(ID.alice,'work')).revision,eventId:randomUUID()});
 const token='123:synthetic-summary-aba';const send=(route:string,body:unknown)=>handleAdaptiveRequest(h.studio,f.adaptive,new Request('https://vox.synthetic/api/studio/adaptive/reviewed/'+route,{method:'POST',headers:{origin:'https://vox.synthetic','content-type':'application/json','x-telegram-init-data':signInitData({id:ID.alice,first_name:'Alice'},token)},body:JSON.stringify(body)}),['reviewed',route],token);
 const sources=(await f.adaptive.read(ID.alice,'work')).memories.map(({id,revision})=>({id,revision}));const previewResponse=await send('preview',{space:'work',agentId:agent.id,locale:'en',sourceRefs:sources});expect(previewResponse.status).toBe(200);const preview=await previewResponse.json();
 await h.studio.blockByAgent(agent.id,ID.alice);await h.studio.unblock(users.superadmin,agent.id,ID.alice);
 const accepted=await send('accept',{space:'work',agentId:agent.id,text:preview.text,receipt:preview.receipt});const body=await accepted.json();
 console.log(JSON.stringify({previewStatus:previewResponse.status,postRestoreStatus:accepted.status,postRestoreCode:body.error,storedNotes:(await f.adaptive.read(ID.alice,'work')).memories.length}));
 expect(accepted.status).toBe(409);expect(body).toEqual({error:'reviewed_memory_changed'});expect((await f.adaptive.read(ID.alice,'work')).memories).toHaveLength(2);
 }finally{await f.close();await rm(h.dir,{recursive:true,force:true})}
});
