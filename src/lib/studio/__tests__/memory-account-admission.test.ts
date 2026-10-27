/** Independent ER1 real update/gateway/FILE path; all model/provider work synthetic. */
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {accountIdFor} from '../../adaptive/persistence/repository';
import {handleAgentUpdate} from '../updates';
import {SourceFencePendingError} from '../assistant-text-integration';
import {memoryAccountFixture,type MemoryAccountFixture} from './memory-account-fixture';
import {ID} from './helpers';
const fixtures:MemoryAccountFixture[]=[],counts:Array<{case:string;models:number;posts:number}>=[];
async function setup(o:Parameters<typeof memoryAccountFixture>[0]={}){const f=await memoryAccountFixture(o);fixtures.push(f);return f;}
const effects=(f:MemoryAccountFixture)=>f.calls.filter(c=>/^send/.test(c.method));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function holdGeneration(f:MemoryAccountFixture){const entered=deferred(),release=deferred(),original=f.h.chatLLM.complete.bind(f.h.chatLLM);
 vi.spyOn(f.h.chatLLM,'complete').mockImplementation(async request=>{const result=await original(request);if(!String(request.system).startsWith('You extract long-term memories')){entered.resolve();await release.promise;}return result;});return {entered,release};}
function record(f:MemoryAccountFixture,name:string){counts.push({case:name,models:f.h.chatLLM.replyRequests.length+f.h.chatLLM.extractionRequests.length,posts:effects(f).length});}
afterEach(async()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))await f.closeOwned();});
afterAll(()=>console.info('ER1_SYNTHETIC_UPDATE_COUNTS',JSON.stringify(counts)));
describe('ER1 actual poller/update/gateway admission',()=>{
 it('marked current original Work-DM reaches actual poller reply with no legacy context/history import',async()=>{
  const f=await setup();await f.h.memory.history.append(f.agentId,`private-tg-${ID.alice}`,{role:'user',text:'ER1_OLD_PRIVATE_CANARY فارسی',at:new Date(f.clock.now())});
  f.clearCalls();await f.throughPoller(f.update('What should we do next? قدم بعدی چیست؟'));
  expect(f.h.chatLLM.replyRequests).toHaveLength(1);expect(effects(f).filter(x=>x.method==='sendMessage')).toHaveLength(1);
  expect(JSON.stringify(f.h.chatLLM.replyRequests)).not.toContain('ER1_OLD_PRIVATE_CANARY');expect(JSON.stringify(f.calls)).not.toContain('ER1_OLD_PRIVATE_CANARY');
  expect(f.h.chatLLM.extractionRequests).toEqual([]);expect((await f.h.memory.history.recent(f.agentId,`private-tg-${ID.alice}`,20)).map(x=>x.text)).toEqual(['ER1_OLD_PRIVATE_CANARY فارسی']);record(f,'actual-poller-current');
 });
 it.each(['missing','forged'] as const)('%s poller never generates, sends or autocreates in marked private scope',async kind=>{
  const f=await setup();f.clearCalls();if(kind==='missing')await f.unbound(f.update());else await f.handle(f.update(),{});
  expect(f.h.chatLLM.replyRequests).toEqual([]);expect(effects(f)).toEqual([]);record(f,kind+'-poller');
 });
 it('original batch capabilities cannot bind to a same-ID/revision replacement after another update waits',async()=>{
  const f=await setup(),first=f.update('First original queued message'),second=f.update('Second original queued message');
  const a=f.account.captureUpdate(f.agentId,first,f.poller),b=f.account.captureUpdate(f.agentId,second,f.poller),hold=holdGeneration(f);
  const pending=handleAgentUpdate(f.h.studio,f.agentId,first,f.h.studio.relationshipEndpointId(f.token),f.poller,a);
  await Promise.race([hold.entered.promise,pending.then(()=>{throw Error('actual model was not reached');})]);
  const d=JSON.parse(f.raw());d.memoryLifecycle.incarnation=randomBytes(32).toString('hex');writeFileSync(f.path(),JSON.stringify(d),{mode:0o600});f.clearCalls();hold.release.resolve();await pending;
  await handleAgentUpdate(f.h.studio,f.agentId,second,f.h.studio.relationshipEndpointId(f.token),f.poller,b);
  expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toHaveLength(1);record(f,'queued-ABA');
 });
 it.each(['canonical-removed','core-expired','poller-stopped','member-removed'] as const)('%s during model await denies actual late reply and canonical recreation',async kind=>{
  const f=await setup(),hold=holdGeneration(f),pending=f.handle(f.update());await Promise.race([hold.entered.promise,pending.then(()=>{throw Error('actual model was not reached');})]);
  if(kind==='canonical-removed')f.removeCanonical();if(kind==='core-expired')f.clock.advance(31*86400000);if(kind==='poller-stopped')f.active(false);
  if(kind==='member-removed')await f.h.store.update(s=>{s.members=s.members.filter(m=>m.telegramId!==ID.alice);});
  f.clearCalls();hold.release.resolve();await pending;expect(effects(f)).toEqual([]);if(kind==='canonical-removed')expect(f.repository.memoryAccountStatus(accountIdFor(ID.alice),f.clock.now).state).toBe('missing');record(f,'late-'+kind);
 });
 it('actual final synchronous Studio authority I/O cannot mask an expired core deadline',async()=>{
  const f=await setup(),u=f.update(),cap=f.account.captureUpdate(f.agentId,u,f.poller),original=f.h.studio.replyAuthorityNow.bind(f.h.studio);
  vi.spyOn(f.h.studio,'replyAuthorityNow').mockImplementation((...args)=>{const value=original(...args);f.clock.advance(31*86400000);return value;});
  await expect(f.account.runUpdate(f.agentId,u,f.poller,async()=>f.account.contextState(),cap)).rejects.toThrow();expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);record(f,'final-IO-expiry');
 });
 it('actual qualified context carries finite core/binding expiry and no stored context adapters',async()=>{
  const f=await setup(),u=f.update();const result=await f.account.runUpdate(f.agentId,u,f.poller,async()=>f.account.contextState());
  expect(result!.validUntil).toBeGreaterThan(f.clock.now());expect(result!.validUntil).toBeLessThan(Number.MAX_SAFE_INTEGER);expect(result).toMatchObject({context:[],priorityContext:[],reviewedContext:[],memoryEnabled:false,historyEnabled:false,storedContextAllowed:false});
 });
 it.each(['/start','/memories','/connectors','hello'] as const)('missing canonical %s cannot reach early command/greeting/legacy fallbacks',async text=>{
  const f=await setup();f.removeCanonical();f.clearCalls();await f.handle(f.update(text));expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);expect(f.repository.memoryAccountStatus(accountIdFor(ID.alice),f.clock.now).state).toBe('missing');record(f,'missing-'+text);
 });
 it.each(['voice','callback'] as const)('unqualified marked %s adapter is held without text/model effects',async kind=>{
  const f=await setup(),u=f.update();if(kind==='voice'){delete u.message!.text;u.message!.voice={file_id:'QA_SYNTHETIC_VOICE',duration:1};}
  else {u.callback_query={id:'QA_CALLBACK',from:u.message!.from!,data:'qa',message:u.message};delete u.message;}
  f.clearCalls();await f.handle(u);expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);record(f,'unsupported-'+kind);
 });
 it('stateless public outsider text uses current input without creating or borrowing a private canonical account',async()=>{
  const f=await setup();await f.h.store.update(s=>{s.agents.find(a=>a.id===f.agentId)!.visibility='public';});
  await f.h.memory.history.append(f.agentId,'private-tg-999',{role:'user',text:'ER1_OUTSIDER_OLD_CONTEXT_CANARY',at:new Date(f.clock.now())});
  const beforeA=f.raw(),beforeB=f.raw(ID.bob);f.clearCalls();await f.handle(f.update('Hello, what can you help with?',ID.stranger));
  expect(f.h.chatLLM.replyRequests.length).toBeGreaterThan(0);expect(effects(f).filter(c=>c.method==='sendMessage')).toHaveLength(1);
  expect(f.repository.memoryAccountStatus(accountIdFor(ID.stranger),f.clock.now).state).toBe('missing');expect(f.raw()).toBe(beforeA);expect(f.raw(ID.bob)).toBe(beforeB);
  expect(JSON.stringify(f.h.chatLLM.replyRequests)).not.toContain('ER1_OUTSIDER_OLD_CONTEXT_CANARY');record(f,'stateless-public');
 });
 it('registered stateless group uses current addressed text without borrowing a member private account',async()=>{
  const f=await setup(),chatId=-991991;await f.h.store.update(s=>{s.groups.push({chatId,title:'ER1 synthetic group',memberIds:[ID.alice,ID.bob],hasGuests:false,agentIds:[f.agentId],addedBy:ID.alice,addedAt:new Date(f.clock.now()).toISOString()});});
  const live=(await f.h.store.read()).agents.find(a=>a.id===f.agentId)!,u=f.update('@'+live.bot!.username+' please answer this current question');u.message!.chat={id:chatId,type:'group',title:'ER1 synthetic group'};
  await f.h.memory.history.append(f.agentId,'group-chat-991991',{role:'user',text:'ER1_OLD_GROUP_HISTORY_CANARY',at:new Date(f.clock.now()),groupPolicyVersion:1,telegramMessageId:1});
  u.message!.reply_to_message={message_id:1,date:u.message!.date-20,chat:u.message!.chat,from:{id:ID.bob,is_bot:false,first_name:'QA'},text:'ER1_OLD_QUOTED_CONTEXT_CANARY'};
  const beforeA=f.raw(),beforeB=f.raw(ID.bob);f.clearCalls();await f.handle(u);
  expect(JSON.stringify(f.h.chatLLM.replyRequests)).not.toContain('ER1_OLD_GROUP_HISTORY_CANARY');expect(JSON.stringify(f.h.chatLLM.replyRequests)).not.toContain('ER1_OLD_QUOTED_CONTEXT_CANARY');
  expect(f.h.chatLLM.replyRequests.length).toBeGreaterThan(0);expect(effects(f).filter(c=>c.method==='sendMessage')).toHaveLength(1);expect(f.raw()).toBe(beforeA);expect(f.raw(ID.bob)).toBe(beforeB);record(f,'stateless-group');
 });
 it.each(['public-visibility','group-speaker','group-agent'] as const)('stateless %s authority change during model await denies late generated effects',async kind=>{
  const f=await setup(),chatId=-991992;await f.h.store.update(s=>{if(kind==='public-visibility')s.agents.find(a=>a.id===f.agentId)!.visibility='public';else s.groups.push({chatId,title:'ER1 late-route group',memberIds:[ID.alice,ID.bob],hasGuests:false,agentIds:[f.agentId],addedBy:ID.alice,addedAt:new Date(f.clock.now()).toISOString()});});
  const live=(await f.h.store.read()).agents.find(a=>a.id===f.agentId)!,u=f.update(kind==='public-visibility'?'Current public question':'@'+live.bot!.username+' current group question',kind==='public-visibility'?ID.stranger:ID.alice);
  if(kind!=='public-visibility')u.message!.chat={id:chatId,type:'group'};
  const hold=holdGeneration(f),pending=f.handle(u);await Promise.race([hold.entered.promise,pending.then(()=>{throw Error('actual current stateless model did not run');})]);
  await f.h.store.update(s=>{if(kind==='public-visibility')s.agents.find(a=>a.id===f.agentId)!.visibility='private';else if(kind==='group-speaker')s.groups.find(g=>g.chatId===chatId)!.memberIds=[ID.bob];else s.groups.find(g=>g.chatId===chatId)!.agentIds=[];});
  f.clearCalls();hold.release.resolve();await pending;expect(effects(f)).toEqual([]);record(f,'late-stateless-'+kind);
 });
 it('direct gateway without original ambient work cannot bypass marked admission',async()=>{
  const f=await setup(),{gateway}=await f.h.studio.gateway();f.clearCalls();await gateway.handleUpdate(f.agentId,f.update());expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);
 });
 it.each(['blocked','removed','core-expired'] as const)('known-source edited message still reaches protective invalidation when %s',async kind=>{
  const f=await setup(),u=f.update(),edit={update_id:u.update_id+100,edited_message:{...u.message!,text:'corrected synthetic source',edit_date:Math.floor(f.clock.now()/1000)}};
  const invalidate=vi.spyOn(f.integration,'invalidateEdit');
  if(kind==='blocked')await f.h.store.update(s=>{s.agents.find(a=>a.id===f.agentId)!.blocked=[ID.alice];});
  if(kind==='removed')await f.h.store.update(s=>{s.members=s.members.filter(m=>m.telegramId!==ID.alice);});
  if(kind==='core-expired')f.clock.advance(31*86400000);
  f.clearCalls();await f.handle(edit);expect(invalidate).toHaveBeenCalledOnce();expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);
 });
 it.each(['blocked','removed'] as const)('actual retained ADP receipt is invalidated despite %s reply authority',async kind=>{
  const f=await setup({marked:false});await f.integration.enroll({...f.controlInput(),requestId:randomUUID(),expectedEnrollmentRevision:null});f.clock.advance(2000);
  const u=f.update();await f.handle(u);expect(f.document().assistantDeliveryControl!.effects[0].state.phase).toBe('sent');
  f.mark();for(const owner of [ID.alice,ID.bob])await f.repository.migrateExistingMemoryAccount(accountIdFor(owner),f.clock.now);
  if(kind==='blocked')await f.h.store.update(s=>{s.agents.find(a=>a.id===f.agentId)!.blocked=[ID.alice];});else await f.h.store.update(s=>{s.members=s.members.filter(m=>m.telegramId!==ID.alice);});
  f.clearCalls();const beforeModels=f.h.chatLLM.replyRequests.length;
  await f.handle({update_id:u.update_id+100,edited_message:{...u.message!,text:'corrected original source'}});
  expect(f.document().assistantDeliveryControl!.effects[0].state.contentEligible).toBe(false);expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toHaveLength(beforeModels);
 });
 it('protective edit ignores a fresh-account reply floor but cannot send or restore old content',async()=>{
  const f=await setup();f.removeCanonical();const c=await f.challenge();expect((await f.request('confirm',{body:{action:'fresh-bootstrap',previewDigest:c.preview.previewDigest,nonce:c.nonce}})).status).toBe(200);
  const u=f.update(),invalidate=vi.spyOn(f.integration,'invalidateEdit');u.message!.date=Math.floor(JSON.parse(f.raw()).memoryLifecycle.sourceCutoffMs/1000)-100;
  await f.handle({update_id:u.update_id+1,edited_message:{...u.message!,text:'old source corrected'}});expect(invalidate).toHaveBeenCalledOnce();expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);
 });
 it('protective captured edit refuses same-ID incarnation ABA instead of silently acknowledging it',async()=>{
  const f=await setup(),u=f.update(),edit={update_id:u.update_id+1,edited_message:{...u.message!,text:'corrected source'}},cap=f.account.captureUpdate(f.agentId,edit,f.poller);
  const d=JSON.parse(f.raw());d.memoryLifecycle.incarnation=randomBytes(32).toString('hex');writeFileSync(f.path(),JSON.stringify(d),{mode:0o600});
  await expect(handleAgentUpdate(f.h.studio,f.agentId,edit,f.h.studio.relationshipEndpointId(f.token),f.poller,cap)).rejects.toThrow();expect(effects(f)).toEqual([]);
 });
 it.each(['missing','corrupt'] as const)('protective %s canonical state has an honest acknowledgment outcome',async kind=>{
  const f=await setup(),u=f.update(),edit={update_id:u.update_id+1,edited_message:{...u.message!,text:'corrected source'}};
  if(kind==='missing')f.removeCanonical();else writeFileSync(f.path(),'{corrupt',{mode:0o600});
  if(kind==='missing')await expect(f.handle(edit)).resolves.toBeUndefined();else await expect(f.handle(edit)).rejects.toThrow();expect(effects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toEqual([]);
 });
 it('protective suppression persistence rejection reaches poller caller instead of a successful silent ACK',async()=>{
  const f=await setup(),u=f.update(),edit={update_id:u.update_id+100,edited_message:{...u.message!,text:'corrected synthetic source'}};
  vi.spyOn(f.integration,'invalidateEdit').mockRejectedValue(new Error('QA_DURABLE_SOURCE_SUPPRESSION_FAILED'));
  await expect(f.handle(edit)).rejects.toBeInstanceOf(SourceFencePendingError);expect(effects(f)).toEqual([]);
 });
});
