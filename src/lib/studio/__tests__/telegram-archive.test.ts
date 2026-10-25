import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../../adaptive/relationships/service';
import type { ArchiveTransport } from '../../tireh/memory/telegram-archive/contracts';
import type { TelegramMessage, TelegramBotClient } from '../../tireh/telegram/client';
import { ArchiveCapturePendingError, StudioTelegramArchive } from '../telegram-archive';
import { pollLoop } from '../bots';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const path of dirs.splice(0)) rmSync(path, {recursive:true, force:true}); });
async function setup() {
  const h = makeStudio(); dirs.push(h.dir);
  const users = await seedOrg(h), hired = await hire(h, users.alice);
  const start = h.clock.now.getTime(), capabilities = ['core_text','auto_memory','personalization'];
  const policy = adaptiveOptionsFromManifest(JSON.stringify({schemaVersion:1,configurationVersion:'synthetic-only',enabledCapabilities:capabilities,
    accounts:[{accountId:accountIdFor(ID.alice),jurisdictionKeys:['SYNTHETIC'],allowDeclaredAdult:true}],
    approvals:capabilities.map((capability,index)=>({schemaVersion:1,id:`synthetic-${index}`,revision:1,createdAt:start,updatedAt:start,jurisdiction:'SYNTHETIC',capability,state:'approved',configurationVersion:'synthetic-only',effectiveAt:start,reviewExpiresAt:start+86400_000,owner:'synthetic',approvalReference:'synthetic'}))}));
  const reopen = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(h.dir,'archive-adaptive'))), {...policy,scopedRelationshipsEnabled:true,now:()=>h.clock.now.getTime()});
  let adaptive = reopen(); h.studio.deps.adaptive=adaptive; h.studio.deps.relationshipAuthority=new AdaptiveRelationshipService(adaptive);
  await adaptive.confirm(ID.alice,{confirm:true,adultConfirmed:true});
  for (const purpose of ['optional.auto_memory','optional.personalization'] as OptionalPurpose[]) {
    const initial = await adaptive.read(ID.alice,'work'), shown = await adaptive.present(ID.alice,{space:'work',purpose,locale:'en',expectedRevision:initial.purposes.find(p=>p.purpose===purpose)!.revision,eventId:randomUUID(),deliberateReopen:true});
    await adaptive.changeConsent(ID.alice,{space:'work',purpose,state:'granted',expectedRevision:shown.purposes.find(p=>p.purpose===purpose)!.revision,receipt:shown.receipt,eventId:randomUUID()});
  }
  await adaptive.setAgentAccess(ID.alice,hired.agent.id,{space:'work',allowed:true,expectedRevision:(await adaptive.read(ID.alice,'work')).revision,eventId:randomUUID()});
  const files = new Map<string,Uint8Array>(); let number=0, enabled=true;
  const transport: ArchiveTransport={upload:vi.fn(async (_chat,_name,bytes,authorizeNow)=>{if(!authorizeNow())throw Error('authority');const fileId=`file-${++number}`;files.set(fileId,new Uint8Array(bytes));return {fileId,messageId:number};}),download:vi.fn(async id=>files.get(id)!)};
  const runtime = () => new StudioTelegramArchive(h.studio,()=>enabled,()=>transport);
  let archive=runtime(); h.studio.deps.telegramArchive=archive;
  const message = (text:string,id=1):TelegramMessage=>({message_id:id,date:Math.floor(h.clock.now.getTime()/1000),chat:{id:ID.alice,type:'private'},from:{id:ID.alice,is_bot:false,first_name:'Synthetic'},text});
  const command = (text:string)=>archive.command(hired.agent.id,message(`/archive ${text}`,999));
  await command('enable');
  h.clock.now=new Date(start+2000);
  return {h,hired,message,command,transport,files,get adaptive(){return adaptive;},get archive(){return archive;},disable:()=>{enabled=false;},restart:()=>{adaptive=reopen();h.studio.deps.adaptive=adaptive;archive=runtime();h.studio.deps.telegramArchive=archive;}};
}

describe('FILE Telegram user-message archive runtime',()=>{
  it('retains pending text across FILE restart, supplies later context without Telegram downloads, and age-flushes',async()=>{
    const x=await setup(); const scope=await x.archive.scope(ID.alice,x.hired.agent.id);
    await x.archive.capture(x.hired.agent.id,x.message('SYNTHETIC_OLD_PROJECT',10),10);
    expect((await x.archive.archive(scope).status(scope)).pending).toBe(1);
    x.restart();
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text.join()).toContain('SYNTHETIC_OLD_PROJECT');
    expect(x.transport.download).not.toHaveBeenCalled();
    x.h.clock.now=new Date(x.h.clock.now.getTime()+61_000); await x.archive.drain();
    expect(await x.archive.archive(scope).status(scope)).toMatchObject({pending:0,head:{sequence:1}});
    expect(x.transport.upload).toHaveBeenCalledTimes(2);
  });
  it('adds received eligible evidence to the actual gateway prompt without enabling legacy history',async()=>{
    const x=await setup(); await x.archive.capture(x.hired.agent.id,x.message('SYNTHETIC_PROJECT_FERN',10),10);
    const {gateway}=await x.h.studio.gateway();
    await gateway.converse(x.hired.agent.id,`tg-${ID.alice}`,'Continue my project discussion');
    expect(JSON.stringify(x.h.chatLLM.replyRequests.at(-1))).toContain('SYNTHETIC_PROJECT_FERN');
    expect(await x.h.memory.history.recent(x.hired.agent.id,`private-tg-${ID.alice}`,20)).toEqual([]);
  });
  it('keeps off-record messages out, and observed edits clear the whole archive',async()=>{
    const x=await setup();await x.archive.capture(x.hired.agent.id,x.message("Don't remember this SECRET",10),10);
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
    await x.archive.capture(x.hired.agent.id,x.message('OLD_EDIT',11),11);
    await handleAgentUpdate(x.h.studio,x.hired.agent.id,{update_id:12,edited_message:x.message('new text',11)});
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
  });
  it('clear survives restart and suppresses stale captured text after re-enable',async()=>{
    const x=await setup(); const scope=await x.archive.scope(ID.alice,x.hired.agent.id);
    await x.archive.capture(x.hired.agent.id,x.message('FORGET_CANARY',10),10); await x.archive.archive(scope).checkpoint(scope,{force:true});
    const old=x.message('FORGET_CANARY',10); x.h.clock.now=new Date(x.h.clock.now.getTime()+2000);
    await x.command('clear'); x.restart(); await x.command('enable'); await x.archive.capture(x.hired.agent.id,old,10);
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
    expect(await x.archive.archive(scope).recover(scope)).toMatchObject({events:[]});
  });
  it('corrects a saved fact, fences the entire source archive, and never resurrects it after restart',async()=>{
    const x=await setup();
    const saved=await x.adaptive.createMemory(ID.alice,{space:'work',text:'The project is called WRONG_PROJECT',expectedRevision:(await x.adaptive.read(ID.alice,'work')).revision,eventId:randomUUID()});
    const memory=saved.memories[0];
    await x.archive.capture(x.hired.agent.id,x.message('WRONG_PROJECT_ARCHIVE_SOURCE',10),10);
    await x.adaptive.correctMemory(ID.alice,memory.id,{space:'work',text:'The project is called CORRECT_PROJECT',expectedRevision:memory.revision,eventId:randomUUID()},{authorizeNow:()=>true});
    x.restart();
    const {gateway}=await x.h.studio.gateway();await gateway.converse(x.hired.agent.id,`tg-${ID.alice}`,'What is my project called?');
    const prompt=JSON.stringify(x.h.chatLLM.replyRequests.at(-1));expect(prompt).toContain('CORRECT_PROJECT');expect(prompt).not.toContain('WRONG_PROJECT');
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
  });
  it('refuses before acceptance when overdue, retains no refused text, and leaves clear reachable',async()=>{
    const x=await setup();await x.archive.capture(x.hired.agent.id,x.message('ACCEPTED_SOURCE',10),10);
    vi.mocked(x.transport.upload).mockRejectedValueOnce(new Error('synthetic outage'));
    const scope=await x.archive.scope(ID.alice,x.hired.agent.id);
    await expect(x.archive.archive(scope).checkpoint(scope,{force:true})).rejects.toMatchObject({code:'unknown_delivery'});
    x.h.clock.now=new Date(x.h.clock.now.getTime()+61_000);
    await handleAgentUpdate(x.h.studio,x.hired.agent.id,{update_id:20,message:x.message('REJECTED_TEXT_CANARY',20)});
    expect(x.hired.bot().sendMessage.mock.calls.at(-1)?.[1]).toContain('not saved or processed');
    expect(JSON.stringify(await x.adaptive.withAccountView(ID.alice,d=>d))).not.toContain('REJECTED_TEXT_CANARY');
    expect(await x.adaptive.withAccountView(ID.alice,d=>d.events.some(e=>e.kind==='archive_admission_refused'))).toBe(true);
    await handleAgentUpdate(x.h.studio,x.hired.agent.id,{update_id:21,message:x.message('/archive clear',21)});
    expect(x.hired.bot().sendMessage.mock.calls.at(-1)?.[1]).toContain('removed from agent use');
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
  });
  it('withdrawal blocks use while clear and disable remain available with capture flag off',async()=>{
    const x=await setup();await x.archive.capture(x.hired.agent.id,x.message('PRIVATE',10),10);
    const current=await x.adaptive.read(ID.alice,'work');
    await x.adaptive.changeConsent(ID.alice,{space:'work',purpose:'optional.auto_memory',state:'withdrawn',expectedRevision:current.purposes.find(p=>p.purpose==='optional.auto_memory')!.revision,eventId:randomUUID()});
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
    x.disable();expect(await x.command('disable')).toBe(true);x.restart();
    expect((await x.archive.context(ID.alice,x.hired.agent.id,'work')).text).toEqual([]);
  });
});

describe('Telegram polling durable capture barrier',()=>{
  it('does not advance offset or handle later updates before failed capture is service-durable',async()=>{
    vi.useFakeTimers();let attempt=0;const later=vi.fn();
    const getUpdates=vi.fn().mockResolvedValueOnce([{update_id:10},{update_id:11}]).mockImplementationOnce(async(offset:number|undefined)=>{expect(offset).toBeUndefined();return [{update_id:10},{update_id:11}];}).mockImplementation(async()=>new Promise(()=>{}));
    const handle=vi.fn(async(u:{update_id:number})=>{if(u.update_id===10&&attempt++===0)throw new ArchiveCapturePendingError();if(u.update_id===11)later();});
    const loop=pollLoop({getUpdates,deleteWebhook:async()=>true} as unknown as TelegramBotClient,[],handle,{info:vi.fn(),warn:vi.fn(),error:vi.fn()});
    await vi.advanceTimersByTimeAsync(0);expect(later).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);expect(later).toHaveBeenCalledOnce();loop.stop();
  });
});
