/** Independent ATI1 actual composition oracle. No external requests/data. */
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {atiFixture,ATI_GENERATED,type AtiFixture} from './assistant-text-integration-fixture';
import {ID} from './helpers';
import {SourceFencePendingError} from '../assistant-text-integration';
import {PersonaGateway} from '../../tireh/gateway';
import {AdaptiveExperienceService} from '../../adaptive/runtime/service';
import {StudioTelegramArchive} from '../telegram-archive';
import {SharedMemoryService} from '../../adaptive/shared/service';
import {SharedMemoryRepository} from '../../adaptive/shared/repository';
import {FileAdaptiveStorage} from '../../adaptive/persistence/storage';
import {sharedAuthorityFromStudioStore} from '../shared-authority';

const fixtures:AtiFixture[]=[],metrics:Array<{case:string;posts:number;generations:number;bodyBytes:number;accountBefore:number;accountAfter:number;elapsedMs:number}>=[];
afterEach(()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))f.cleanup();});
afterAll(()=>console.info('ATI1_COMPOSITION_SYNTHETIC_METRICS',JSON.stringify(metrics)));
async function setup(enroll=true){const f=await atiFixture(enroll);fixtures.push(f);return f;}
const sends=(f:AtiFixture)=>f.calls.filter(c=>c.method==='sendMessage');
const allPayloadEffects=(f:AtiFixture)=>f.calls.filter(c=>['sendMessage','sendVoice','sendPhoto','sendDocument','sendChatAction'].includes(c.method));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function holdGeneration(f:AtiFixture){const entered=deferred(),release=deferred(),original=f.h.chatLLM.complete.bind(f.h.chatLLM);
  vi.spyOn(f.h.chatLLM,'complete').mockImplementation(async request=>{const result=await original(request);if(!String(request.system).startsWith('You extract long-term memories')){entered.resolve();await release.promise;}return result;});return {entered,release};}

describe('ATI1 independent actual poller/update/gateway/FILE/transport composition',()=>{
  it('real polling composition commits one exact text POST/outbound receipt and retains no assistant payload/history',async()=>{
    const f=await setup(),u=f.update(),before=readFileSync(f.path()).byteLength,start=performance.now();f.clearCalls();
    await f.throughPoller(u);
    const posts=sends(f),d=f.document(),c=d.assistantDeliveryControl!;expect(posts).toHaveLength(1);expect(allPayloadEffects(f)).toHaveLength(1);
    expect(c.effects).toHaveLength(1);expect(c.effects[0].state.phase).toBe('sent');
    expect(c.effects[0].state.outcome).toMatchObject({receipt:{messageId:91000}});expect(c.effects[0].state.source.messageId).toBe(u.message!.message_id);
    expect(posts[0].body).toEqual({chat_id:ID.alice,text:ATI_GENERATED});
    expect(f.h.chatLLM.replyRequests).toHaveLength(1);
    expect(await f.h.memory.history.recent(f.agentId,`private-tg-${ID.alice}`,20)).toEqual([]);
    for(const text of [ATI_GENERATED,JSON.stringify(posts[0].body)])expect(readFileSync(f.path(),'utf8')).not.toContain(text);
    expect(JSON.stringify(f.h.chatLLM.extractionRequests)).not.toContain(ATI_GENERATED);
    metrics.push({case:'actual-poller-success',posts:posts.length,generations:f.h.chatLLM.replyRequests.length,bodyBytes:posts[0].bytes,accountBefore:before,accountAfter:readFileSync(f.path()).byteLength,elapsedMs:performance.now()-start});
  });

  it('durable duplicate/replayed source with changed update correlation does not generate or POST again',async()=>{
    const f=await setup(),u=f.update();await f.handle(u);f.clearCalls();const generations=f.h.chatLLM.replyRequests.length;
    await f.handle({...u,update_id:u.update_id+100});expect(allPayloadEffects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toHaveLength(generations);
    expect(f.document().assistantDeliveryControl!.effects).toHaveLength(1);
  });

  it('mode-off enrolled relationship refuses with zero generation/POST while unrelated unenrolled chat preserves ordinary behavior',async()=>{
    const f=await setup();f.enabled(false);f.clearCalls();await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);
    await f.handle(f.update('A fresh unrelated synthetic question',ID.bob));
    expect(f.h.chatLLM.replyRequests).toHaveLength(1);expect(sends(f)).toHaveLength(1);
    expect(f.document(ID.bob).assistantDeliveryControl).toBeUndefined();
  });

  it('never-enrolled default-off account does not create control/markers or change its ordinary reply count',async()=>{
    const f=await setup(false);f.enabled(false);const before=f.document();f.clearCalls();await f.handle(f.update());
    expect(f.document().assistantDeliveryControl).toBeUndefined();expect(before.assistantDeliveryControl).toBeUndefined();
    expect(f.h.chatLLM.replyRequests).toHaveLength(1);expect(sends(f)).toHaveLength(1);
    for(const version of [1,2])expect(existsSync(join(f.h.dir,'adaptive',`assistant-delivery-control-v${version}.json`))).toBe(false);
  });

  it.each(['missing','forged'])('%s poller capability cannot use enrolled legacy fallback',async mode=>{
    const f=await setup();f.clearCalls();
    if(mode==='missing')await f.unbound(f.update());else await f.handle(f.update(),{});
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);
  });

  it('explicit disable persists and switch restoration/restart cannot silently reenable it',async()=>{
    const f=await setup(),row=f.integration.control.getEnrollment(ID.alice,f.botId)!;
    await f.integration.disable({...f.controlInput(),requestId:randomUUID(),expectedEnrollmentRevision:row.revision});
    f.enabled(false);f.enabled(true);f.recreateService();f.clearCalls();await f.handle(f.update());
    expect(f.integration.status(f.controlInput()).status).toBe('disabled');expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);
  });

  it.each(['stopped','rotated','duplicate-route','removed-member'])('%s current binding denies old in-flight generated text',async mode=>{
    const f=await setup(),held=holdGeneration(f),pending=f.handle(f.update());await held.entered.promise;
    if(mode==='stopped')f.active(false);
    else await f.h.store.update(state=>{
      const agent=state.agents.find(a=>a.id===f.agentId)!;
      if(mode==='rotated')agent.tokenEnc=agent.tokenEnc!.slice(0,-2)+'XX';
      if(mode==='duplicate-route')state.agents.push({...agent,id:'qa-duplicate-agent'});
      if(mode==='removed-member')state.members=state.members.filter(m=>m.telegramId!==ID.alice);
    });
    f.clearCalls();held.release.resolve();await pending;expect(allPayloadEffects(f)).toEqual([]);
  });

  it('enrollment committed during an unenrolled legacy generation denies its old untracked send',async()=>{
    const f=await setup(false),held=holdGeneration(f),pending=f.handle(f.update());await held.entered.promise;
    await f.integration.enroll({...f.controlInput(),requestId:randomUUID(),expectedEnrollmentRevision:null});
    f.clearCalls();held.release.resolve();await pending;expect(sends(f)).toEqual([]);
  });

  it('edit fences without archive even after member removal and re-add cannot send the old generated reply',async()=>{
    const f=await setup(),u=f.update(),held=holdGeneration(f),pending=f.handle(u);await held.entered.promise;
    const alice=(await f.h.store.read()).members.find(m=>m.telegramId===ID.alice)!;
    await f.h.store.update(state=>{state.members=state.members.filter(m=>m.telegramId!==ID.alice);});
    f.clearCalls();await f.handle({update_id:u.update_id+100,edited_message:{...u.message!,edit_date:u.message!.date+1,text:'QA corrected source'}});
    expect(allPayloadEffects(f)).toEqual([]);
    await f.h.store.update(state=>{state.members.push({...alice,joinedAt:new Date(f.h.clock.now.getTime()+1).toISOString()});});
    f.clearCalls();held.release.resolve();await pending;expect(allPayloadEffects(f)).toEqual([]);
    expect(f.document().assistantDeliveryControl!.noReplayBefore).toBeGreaterThanOrEqual(u.message!.date*1000);
  });

  it('required source-fence commit failure raises only the narrow retry error and a replay persists safety',async()=>{
    const f=await setup(),u=f.update();await f.handle(u);f.clearCalls();
    const edit={update_id:u.update_id+100,edited_message:{...u.message!,text:'QA source edit'}};
    vi.spyOn(f.integration.control,'invalidateSource').mockRejectedValueOnce(new Error('QA_PRIVATE_FENCE_FAILURE'));
    await expect(f.handle(edit)).rejects.toBeInstanceOf(SourceFencePendingError);expect(allPayloadEffects(f)).toEqual([]);
    await f.handle(edit);expect(f.document().assistantDeliveryControl!.effects[0].state.contentEligible).toBe(false);expect(allPayloadEffects(f)).toEqual([]);
  });

  it.each(['transport-lost','wrong-chat','terminal-commit-lost'])('%s is durable uncertainty without automatic retry or responded evidence',async mode=>{
    const f=await setup(),u=f.update();f.clearCalls();
    if(mode==='transport-lost')f.replyHook(async()=>{throw new TypeError('QA_PRIVATE_LOST_RESPONSE');});
    if(mode==='wrong-chat')f.replyHook(async call=>Response.json({ok:true,result:{message_id:99001,date:u.message!.date,from:{id:f.botId,is_bot:true},chat:{id:ID.bob,type:'private'},text:call.body.text}}));
    if(mode==='terminal-commit-lost')vi.spyOn(f.integration.control,'recordResponse').mockRejectedValueOnce(new Error('QA_PRIVATE_RESULT_COMMIT'));
    const before=readFileSync(f.path()).byteLength,start=performance.now();await f.handle(u);
    expect(sends(f)).toHaveLength(1);expect(f.document().assistantDeliveryControl!.effects[0].state.phase).toBe('unknown');
    f.recreateService();await f.handle({...u,update_id:u.update_id+100});expect(sends(f)).toHaveLength(1);expect(f.h.chatLLM.replyRequests).toHaveLength(1);
    metrics.push({case:mode,posts:sends(f).length,generations:f.h.chatLLM.replyRequests.length,bodyBytes:sends(f)[0].bytes,accountBefore:before,accountAfter:readFileSync(f.path()).byteLength,elapsedMs:performance.now()-start});
  });

  it('a source edit after sending before response preserves sent metadata with content ineligible and no assistant reuse',async()=>{
    const f=await setup(),u=f.update();
    f.replyHook(async call=>{await f.handle({update_id:u.update_id+100,edited_message:{...u.message!,text:'QA edit during HTTP'}});
      return Response.json({ok:true,result:{message_id:99001,date:u.message!.date,from:{id:f.botId,is_bot:true},chat:{id:ID.alice,type:'private'},text:call.body.text}});});
    await f.handle(u);const row=f.document().assistantDeliveryControl!.effects[0].state;
    expect(row.phase).toBe('sent');expect(row.contentEligible).toBe(false);expect(sends(f)).toHaveLength(1);expect(JSON.stringify(f.h.chatLLM.extractionRequests)).not.toContain(ATI_GENERATED);
  });

  it('actual final committed claim fence refuses stale durable sending before HTTP',async()=>{
    const f=await setup(),begin=f.integration.control.beginDispatch.bind(f.integration.control);
    vi.spyOn(f.integration.control,'beginDispatch').mockImplementation(async(...args)=>{const result=await begin(...args);await f.integration.control.invalidateSource(ID.alice,f.botId,ID.alice,result.source.messageId);return result;});
    await f.handle(f.update());expect(allPayloadEffects(f)).toEqual([]);expect(f.document().assistantDeliveryControl!.effects[0].state.phase).toBe('unknown');
  });

  it('busy final canonical read cannot dispatch even with a previously committed exact sending claim',async()=>{
    const f=await setup(),begin=f.integration.control.beginDispatch.bind(f.integration.control);let lock:string|undefined,busySeen=false;
    const storage=f.adaptive.repository.storage as FileAdaptiveStorage,current=storage.readCommittedForEffect.bind(storage);
    vi.spyOn(storage,'readCommittedForEffect').mockImplementation(account=>{const result=current(account);
      if(lock&&result.status==='busy'){busySeen=true;rmSync(lock,{recursive:true,force:true});}return result;});
    vi.spyOn(f.integration.control,'beginDispatch').mockImplementation(async(...args)=>{const result=await begin(...args);lock=f.path()+'.lock';mkdirSync(lock,{mode:0o700});return result;});
    await f.handle(f.update());expect(busySeen).toBe(true);expect(allPayloadEffects(f)).toEqual([]);
    expect(f.document().assistantDeliveryControl!.effects[0].state.phase).toBe('unknown');
    // Fixture removes its real-style lock only after the actual committed read
    // reports busy. Either combined authority fence may deny first.
  });
});


describe('ATI1 inbound-only continuation and content-free timing',()=>{
  it('confirmed sent preserves the existing inbound formMemories path without assistant generated/submitted payload',async()=>{
    const f=await setup();
    const prototype=PersonaGateway.prototype as unknown as {formMemories(...args:unknown[]):Promise<void>};
    const observe=vi.spyOn(prototype,'formMemories');const text='QA incoming fact: the notebook is blue';
    await f.handle(f.update(text));expect(sends(f)).toHaveLength(1);expect(observe).toHaveBeenCalledTimes(1);
    const currentTurn=observe.mock.calls[0][4] as Array<{role:string;text:string}>;
    expect(currentTurn).toHaveLength(1);expect(currentTurn[0]).toMatchObject({role:'user',text});
    expect(JSON.stringify(currentTurn)).not.toContain(ATI_GENERATED);expect(f.h.chatLLM.extractionRequests).toEqual([]);
  });

  it('qualified sent marks total timing while refused turns do not report responded timing',async()=>{
    const f=await setup();f.h.studio.deps.stageTimings=true;await f.handle(f.update());
    const events=f.h.logger.info.mock.calls.map(call=>call[0]);
    expect(events).toContainEqual(expect.objectContaining({type:'telegram_ingress',reason:'timing',stage:'total'}));
    f.h.logger.info.mockClear();f.enabled(false);await f.handle(f.update());
    expect(f.h.logger.info.mock.calls.map(call=>call[0])).not.toContainEqual(expect.objectContaining({type:'telegram_ingress',reason:'timing',stage:'total'}));
  });
});


describe('ATI1 protected bounded preflight admission',()=>{
  it('missing current key material refuses before any generation or POST',async()=>{
    const f=await setup();f.keys.clear();f.clearCalls();await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);
  });
  it('a full32row ledger refuses the next source before generation without evicting uncertainty',async()=>{
    const f=await setup();
    for(let n=0;n<32;n++){const ingress={botId:f.botId,chatId:ID.alice,fromId:ID.alice,isBot:false as const,chatType:'private' as const,kind:'initial-text' as const,
      messageId:1000+n,updateId:1000+n,dateSeconds:Math.floor((f.h.clock.now.getTime()-1000)/1000)};
      const prepared=f.integration.control.prepare({ownerId:ID.alice,ingress,generatedText:'QA bounded slot',decoratedText:'QA bounded slot',generationId:randomUUID(),attemptId:randomUUID()});
      await f.integration.control.claim(prepared,ingress);}
    const before=f.document().assistantDeliveryControl!;f.clearCalls();await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);expect(f.document().assistantDeliveryControl!.effects).toEqual(before.effects);
  });
  it('four current streams refuse a fifth stream before generation and do not lower barriers',async()=>{
    const f=await setup(),d=f.document(),c=d.assistantDeliveryControl!;
    c.streams=Array.from({length:4},(_,n)=>({botId:f.botId+100+n,destinationChatId:ID.alice,agentId:`qa-old-${n}`,space:'work' as const,
      containerId:c.version===2?c.enrollments[0].containerId:'unreachable',messageFloor:0,highMessageId:0,lastAcceptedAt:f.h.clock.now.getTime()}));
    writeFileSync(f.path(),JSON.stringify(d));f.clearCalls();await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);expect(f.document().assistantDeliveryControl!.streams).toEqual(c.streams);
  });
  it('existing ARC replay barriers still deny old no-enrollment input but admit fresh ordinary sources',async()=>{
    const f=await setup(false);await f.integration.control.initialize(ID.alice);const old=f.update();
    f.clearCalls();await f.handle(old);expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);
    f.h.clock.now=new Date(f.h.clock.now.getTime()+2000);await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(1);expect(sends(f)).toHaveLength(1);expect(f.document().assistantDeliveryControl!.version).toBe(1);
  });
});


describe('ATI1 protected edits after ordinary membership withdrawal',()=>{
  it('durably fences an authentic own-private edit with no member row and emits no greeting or other reply',async()=>{
    const f=await setup(),u=f.update(),before=f.document().assistantDeliveryControl!;
    await f.h.store.update(state=>{state.members=state.members.filter(m=>m.telegramId!==ID.alice);});f.clearCalls();
    await f.handle({update_id:u.update_id+100,edited_message:{...u.message!,text:'QA source edit after removal'}});
    expect(allPayloadEffects(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toHaveLength(0);
    const after=f.document().assistantDeliveryControl!;expect(after.sourceFenceSequence).toBeGreaterThan(before.sourceFenceSequence);expect(after.noReplayBefore).toBeGreaterThanOrEqual(u.message!.date*1000);
  });
});


async function seedPrivateMemory(f:AtiFixture,text='QA_APPROVED_PRIVATE_CONTEXT_BLUE_NOTEBOOK'){
  await f.adaptive.createMemory(ID.alice,{space:'work',text,expectedRevision:(await f.adaptive.read(ID.alice,'work')).revision,eventId:randomUUID()});
  const memory=f.document().memories.find(m=>m.text===text);if(!memory)throw Error('QA expected authorized private memory');return memory;
}

describe('ATI1 protected selected original-FILE context bridge',()=>{
  it('preserves real private memory, explicit preference and received-user archive context with exactly one reply',async()=>{
    const f=await setup(),privateText='QA_APPROVED_PRIVATE_CONTEXT_BLUE_NOTEBOOK',archiveText='QA_ARCHIVE_USER_CONTEXT_GREEN_NOTEBOOK';
    const shared=new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(f.h.dir,'shared'))),f.adaptive,sharedAuthorityFromStudioStore(f.h.store));
    f.h.studio.deps.shared=shared;const sharedNow=vi.spyOn(shared,'readContextAuthorityNow');
    await seedPrivateMemory(f,privateText);const experience=new AdaptiveExperienceService(f.adaptive);f.h.studio.deps.experience=experience;
    await experience.savePreference(ID.alice,{space:'work',agentId:f.agentId,setting:{key:'response_length',value:'brief'},action:'set',
      expectedRevision:f.document().revision,eventId:randomUUID()});
    const archive=new StudioTelegramArchive(f.h.studio,()=>true);f.h.studio.deps.telegramArchive=archive;
    const enable=f.update('/archive enable');await archive.command(f.agentId,enable.message!);
    f.h.clock.now=new Date(f.h.clock.now.getTime()+2000);const seed=f.update(archiveText);await archive.capture(f.agentId,seed.message!,seed.update_id);
    f.h.clock.now=new Date(f.h.clock.now.getTime()+1000);f.clearCalls();await f.handle(f.update());
    expect(sends(f)).toHaveLength(1);expect(f.h.chatLLM.replyRequests).toHaveLength(1);
    const provider=JSON.stringify(f.h.chatLLM.replyRequests);expect(provider).toContain(privateText);expect(provider).toContain(archiveText);
    expect(provider).toContain('response_length');expect(provider).toContain('brief');expect(sharedNow).toHaveBeenCalled();
    expect(f.document().assistantDeliveryControl!.effects[0].state.phase).toBe('sent');
    expect(JSON.stringify(f.document().telegramArchives)).not.toContain(ATI_GENERATED);
    expect(f.h.chatLLM.extractionRequests).toEqual([]);
  });

  it('actual current memory correction during asynchronous context body read discards the stale body',async()=>{
    const f=await setup(),memory=await seedPrivateMemory(f),original=f.h.studio.adaptiveContext.bind(f.h.studio);let changed=false;
    vi.spyOn(f.h.studio,'adaptiveContext').mockImplementation(async(...args)=>{const context=await original(...args);if(!changed){changed=true;
      await f.adaptive.correctMemory(ID.alice,memory.id,{space:'work',text:'QA_CORRECTED_CURRENT_CONTEXT',expectedRevision:memory.revision,eventId:randomUUID()},{authorizeNow:()=>true});}return context;});
    await f.handle(f.update());expect(changed).toBe(true);expect(sends(f)).toEqual([]);expect(f.h.chatLLM.replyRequests).toHaveLength(0);
    expect(f.integration.control.getEnrollment(ID.alice,f.botId)?.enabled).toBe(true);
  });

  it('retained private source expiry during generation denies delivery under current source policy',async()=>{
    const f=await setup(),memory=await seedPrivateMemory(f);
    await f.adaptive.withAccountDocument(ID.alice,d=>{d.memories.find(m=>m.id===memory.id)!.expiresAt=f.h.clock.now.getTime()+1000;d.revision++;});
    const held=holdGeneration(f),pending=f.handle(f.update());await held.entered.promise;f.h.clock.now=new Date(f.h.clock.now.getTime()+1000);
    f.clearCalls();held.release.resolve();await pending;expect(allPayloadEffects(f)).toEqual([]);
  });

  it('configured preference context without its genuine synchronous current authority refuses before generation',async()=>{
    const f=await setup(),experience=new AdaptiveExperienceService(f.adaptive);f.h.studio.deps.experience=experience;
    vi.spyOn(experience,'readPreferencesAuthorityNow').mockReturnValue(null);await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);expect(allPayloadEffects(f)).toEqual([]);
  });
});

describe('ATI1 protected archive retention edge at actual final fetch',()=>{
  it('an archive source expiring after sending commit changes authority even while raw canonical archive remains unchanged',async()=>{
    const f=await setup(),archive=new StudioTelegramArchive(f.h.studio,()=>true);f.h.studio.deps.telegramArchive=archive;
    await archive.command(f.agentId,f.update('/archive enable').message!);f.h.clock.now=new Date(f.h.clock.now.getTime()+2000);
    const seed=f.update('QA_EXPIRING_ARCHIVE_SOURCE'),expiresAt=f.h.clock.now.getTime()+1000;
    await archive.capture(f.agentId,seed.message!,seed.update_id);
    // Synthetic shortened retention uses the actual strict event schema/readers.
    await f.adaptive.withAccountDocument(ID.alice,d=>{const row=d.telegramArchives!.find(r=>r.agentId===f.agentId)!;
      for(const event of [...row.index,...(row.state?.pending??[])])if(event.logicalId===`telegram:${seed.message!.message_id}`)event.expiresAt=expiresAt;
      d.revision++;});
    const begin=f.integration.control.beginDispatch.bind(f.integration.control);
    vi.spyOn(f.integration.control,'beginDispatch').mockImplementation(async(...args)=>{const result=await begin(...args);f.h.clock.now=new Date(expiresAt);return result;});
    f.clearCalls();await f.handle(f.update());
    expect(f.h.chatLLM.replyRequests).toHaveLength(1);expect(JSON.stringify(f.h.chatLLM.replyRequests)).toContain('QA_EXPIRING_ARCHIVE_SOURCE');
    expect(allPayloadEffects(f)).toEqual([]);expect(f.document().assistantDeliveryControl!.effects[0].state.phase).toBe('unknown');
    expect(f.document().telegramArchives![0].index.some(e=>e.text==='QA_EXPIRING_ARCHIVE_SOURCE'&&e.expiresAt===expiresAt)).toBe(true);
  });
});
