import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { accountIdFor, type AdaptiveDocument } from '../persistence/repository';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { localUseFixture, syntheticLocalUsePolicy, RF1_NOW } from './local-use-fixtures';
import { RightsIntakeService } from './service';
import { prepareRightsLocalErasureLedger } from './conversion';
import { localErasureNotice, LOCAL_ERASURE_NOTICE_VERSION } from './local-erasure-notice';
import { rightsPolicySchema } from './policy';
import { requireLocalUseCapacity } from './local-use-state';
const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of closes.splice(0))await close();});
function policy(){return {...syntheticLocalUsePolicy(),version:3 as const,localErasure:{version:1 as const,approvalReference:'TEST ONLY',decisionReference:'TEST ONLY',assurance:'signed_account_own_private_note' as const,topology:'single_persistent_process' as const,scope:'selected_manual_private_note_and_canonical_descendants' as const,allowedActions:['plan','execute','reconcile'] as Array<'plan'|'execute'|'reconcile'>,noticeVersion:LOCAL_ERASURE_NOTICE_VERSION,noticeHashes:{en:createHash('sha256').update(JSON.stringify(localErasureNotice.en)).digest('hex'),fa:createHash('sha256').update(JSON.stringify(localErasureNotice.fa)).digest('hex')},planLifetimeMs:30000,executionWindowMs:60000,metadataRetentionMs:86400000,replayRetentionMs:86400000,receiptRetentionMs:86400000}};}
async function fixture(format:'file'|'sqlite'='file'){
 const f=await localUseFixture(format);closes.push(f.close);await f.create();await f.prepare();f.setPolicy(policy());
 const backend=new AdaptiveLifecycleService(f.adaptive),options={...f.serviceOptions,localErasure:backend,assertPrivateMemoryNow:(id:number)=>{if(id!==101)throw Error('TEST ONLY denied subject');}};
 const service=new RightsIntakeService(f.repository,options);
 const row=(await service.create(101,{version:1,eventId:randomUUID(),space:'work',kind:'erasure',locale:'en',expectedIntakePolicyRevision:1})).request;
 await prepareRightsLocalErasureLedger({repository:f.repository,accountId:accountIdFor(101),policy,clock:()=>RF1_NOW,assertLocalAdministrationNow:()=>{},assertQuiescedNow:()=>{}});
 const state=await f.adaptive.read(101,'work');await f.adaptive.createMemory(101,{eventId:randomUUID(),space:'work',expectedRevision:state.revision,text:'TEST ONLY PRIVATE RF2 SOURCE'});
 const read=()=>{const r=f.storage.readCommittedForEffect(accountIdFor(101));if(r.status!=='ready'||!r.document)throw Error('missing');return r.document as AdaptiveDocument;};
 const memory=read().memories.find(m=>m.text==='TEST ONLY PRIVATE RF2 SOURCE')!;
 const write=(fn:(d:AdaptiveDocument)=>void)=>f.storage.transact(accountIdFor(101),raw=>{const d=raw as AdaptiveDocument;fn(d);return {document:d,result:undefined};});
 const plan=()=>service.privateNoteErasurePlan(101,row.requestId,'work',{version:1,eventId:randomUUID(),expectedRequestRevision:row.revision,space:'work',memoryId:memory.id,expectedMemoryRevision:memory.revision,locale:'en'});
 const execute=(p:ReturnType<typeof plan>)=>service.privateNoteErasureExecute(101,row.requestId,'work',{version:1,eventId:p.eventId,planHandle:p.planHandle});
 return {...f,service,options,backend,row,memory,read,write,plan,execute};
}
for(const format of ['file','sqlite'] as const)it(`${format}: exact narrow cascade, durable witness, restart GET and expired replay`,async()=>{
 const f=await fixture(format);const child=randomUUID(),other=randomUUID();await f.write(d=>{
   d.memories.push({...structuredClone(f.memory),id:child,text:'TEST ONLY DERIVED',sourceRefs:[{id:f.memory.id,revision:f.memory.revision}]});
   d.memories.push({...structuredClone(f.memory),id:other,space:'personal',text:'TEST ONLY UNRELATED EXPIRED',expiresAt:RF1_NOW-1});
 });
 const before=f.read(),p=f.plan(),result=await f.execute(p);expect(result).toMatchObject({operations:[{technical:'note_content_removed',recording:'recorded'}]});
 const after=f.read();expect(after.memories.find(m=>m.id===other)).toEqual(before.memories.find(m=>m.id===other));
 expect(after.memories.filter(m=>[child,f.memory.id].includes(m.id)).every(m=>m.status==='deleted'&&m.text===undefined&&m.revision===2&&m.revocationEpoch===1)).toBe(true);
 expect({...after,memories:before.memories,outbox:before.outbox,events:before.events,revision:before.revision,updatedAt:before.updatedAt}).toEqual(before);
 expect(after.revision).toBe(before.revision+1);expect(after.outbox.length).toBe(before.outbox.length+2);
 const ledger=f.repository.read(accountIdFor(101))!;expect(ledger.version).toBe(4);if(ledger.version!==4)throw Error('missing');expect(ledger.localErasure.operations[0].witness).toHaveLength(2);
 const restarted=new RightsIntakeService(f.repository,f.options),stable=JSON.stringify(ledger);
 expect(restarted.privateNoteErasureStatus(101,f.row.requestId,'work').operations[0].technical).toBe('note_content_removed');expect(JSON.stringify(f.repository.read(accountIdFor(101)))).toBe(stable);
 f.setNow(RF1_NOW+30001);expect(await f.execute(p)).toMatchObject({replayed:true,operations:[{technical:'note_content_removed'}]});expect(f.read()).toEqual(after);expect(JSON.stringify(f.repository.read(accountIdFor(101)))).toBe(stable);
 expect(JSON.stringify(result)).not.toContain(f.memory.id);expect(JSON.stringify(result)).not.toContain('TEST ONLY PRIVATE');
});
it('lost acknowledgement survives restart and fresh operator reconcile without reapplying deletion',async()=>{
 const f=await fixture(),p=f.plan(),transaction=f.repository.transaction.bind(f.repository);let calls=0;
 vi.spyOn(f.repository,'transaction').mockImplementation(async(...args)=>{if(++calls===2)throw Error('TEST ONLY ACK CRASH');return transaction(...args);});
 expect(await f.execute(p)).toMatchObject({operations:[{technical:'note_content_removed',recording:'acknowledgement_pending'}]});vi.restoreAllMocks();
 const before=f.read(),ops=await f.service.operations(999);await f.service.reconcilePrivateNoteErasure(999,f.row.requestId,ops.requests.find(r=>r.requestId===f.row.requestId)!.operationHandle,p.eventId,randomUUID());
 expect(f.service.privateNoteErasureStatus(101,f.row.requestId,'work').operations[0]).toMatchObject({technical:'note_content_removed',recording:'recorded'});expect(f.read()).toEqual(before);
});
for(const drift of ['missing','refs','revision','payload','event','new-dependent'] as const)it(`restart proof is unknown on ${drift}, without repairing or deleting anything`,async()=>{
 const f=await fixture(),child=randomUUID();await f.write(d=>d.memories.push({...structuredClone(f.memory),id:child,text:'TEST ONLY CHILD',sourceRefs:[{id:f.memory.id,revision:1}]}));await f.execute(f.plan());
 await f.write(d=>{const m=d.memories.find(m=>m.id===child)!;if(drift==='missing')d.memories=d.memories.filter(m=>m.id!==child);if(drift==='refs')delete m.sourceRefs;if(drift==='revision')m.revision++;if(drift==='payload')m.text='TEST ONLY RESTORED';if(drift==='event')d.events=d.events.filter(e=>e.kind!=='rights_private_note_erased');if(drift==='new-dependent')d.memories.push({...structuredClone(f.memory),id:randomUUID(),text:'TEST ONLY LATE',sourceRefs:[{id:f.memory.id,revision:1}]});});
 const before=f.read(),ledger=f.repository.read(accountIdFor(101));expect(f.service.privateNoteErasureStatus(101,f.row.requestId,'work').operations[0]).toMatchObject({technical:'unknown',observedAt:null,effectRevision:null});expect(f.read()).toEqual(before);expect(f.repository.read(accountIdFor(101))).toEqual(ledger);
});
it('policy withdrawal during canonical staging aborts before publication; intent remains and expired replay is read-only',async()=>{
 const f=await fixture(),p=f.plan(),transact=f.storage.transact.bind(f.storage);
 vi.spyOn(f.storage,'transact').mockImplementationOnce((id,mutate,before)=>transact(id,mutate,()=>{f.setPolicy(undefined);before?.();}));
 await expect(f.execute(p)).rejects.toThrow();expect(f.read().memories.find(m=>m.id===f.memory.id)?.text).toBe(f.memory.text);vi.restoreAllMocks();
 f.setNow(RF1_NOW+30001);const before=f.read(),ledger=f.repository.read(accountIdFor(101));expect(await f.execute(p)).toMatchObject({replayed:true,operations:[{technical:'not_applied',recording:'intent_recorded'}]});expect(f.read()).toEqual(before);expect(f.repository.read(accountIdFor(101))).toEqual(ledger);
});
it('rejects unsupported target, stale plan, wrong account and foreign request/space',async()=>{
 const f=await fixture(),p=f.plan();expect(()=>f.service.privateNoteErasureStatus(102,f.row.requestId,'work')).toThrow();expect(()=>f.service.privateNoteErasureStatus(101,f.row.requestId,'personal')).toThrow();
 await f.write(d=>{d.memories.find(m=>m.id===f.memory.id)!.revision++;});await expect(f.execute(p)).rejects.toThrow();
 await f.write(d=>{const m=d.memories.find(m=>m.id===f.memory.id)!;m.revision=1;m.origin='user_reviewed_claim';});expect(()=>f.plan()).toThrow();expect(f.repository.read(accountIdFor(101))?.version).toBe(4);
});
it('refuses actual witness bytes and joint RF1/RF2 headroom without partial payload drop',async()=>{
 const f=await fixture();await f.write(d=>{for(let i=0;i<200;i++)d.memories.push({...structuredClone(f.memory),id:`${i.toString().padStart(3,'0')}${'x'.repeat(197)}`,sourceRefs:[{id:f.memory.id,revision:1}]});});
 const before=f.read(),p=f.plan();await expect(f.execute(p)).rejects.toThrow();expect(f.read()).toEqual(before);
 const ledger=f.repository.read(accountIdFor(101))!;expect(()=>requireLocalUseCapacity(ledger)).not.toThrow();if(ledger.version!==4)throw Error('missing');expect(ledger.localErasure.operations).toEqual([]);
});
it('strict policy rejects notice tampering and insufficient explicit floors',()=>{const p=policy();expect(rightsPolicySchema.safeParse(p).success).toBe(true);p.localErasure.noticeHashes.en='0'.repeat(64);expect(rightsPolicySchema.safeParse(p).success).toBe(false);const short=policy();short.localErasure.replayRetentionMs=1;expect(rightsPolicySchema.safeParse(short).success).toBe(false);});
it('the final canonical fence uses committed read-only clock authority, never the clock writer lock',async()=>{
 const f=await fixture(),transact=f.storage.transact.bind(f.storage);let inFence=false,observedWriter=false;
 const observe=f.rightsStorage.observeRightsTime.bind(f.rightsStorage);vi.spyOn(f.rightsStorage,'observeRightsTime').mockImplementation(now=>{if(inFence)observedWriter=true;observe(now);});
 vi.spyOn(f.storage,'transact').mockImplementationOnce((id,mutate,before)=>transact(id,mutate,()=>{inFence=true;try{before?.();}finally{inFence=false;}}));
 await f.execute(f.plan());expect(observedWriter).toBe(false);
});
it('cancellation before publication keeps source, and cancellation after publication never restores it',async()=>{
 const f=await fixture(),p=f.plan(),transact=f.storage.transact.bind(f.storage);
 vi.spyOn(f.storage,'transact').mockImplementationOnce((id,mutate,before)=>transact(id,mutate,()=>{f.deny();before?.();}));
 await expect(f.execute(p)).rejects.toThrow();expect(f.read().memories.find(m=>m.id===f.memory.id)?.text).toBe(f.memory.text);
 vi.restoreAllMocks();const g=await fixture(),erase=g.backend.eraseSelectedPrivateNote.bind(g.backend);
 vi.spyOn(g.backend,'eraseSelectedPrivateNote').mockImplementationOnce(async(...args)=>{await erase(...args);g.deny();});
 await expect(g.execute(g.plan())).rejects.toThrow();expect(g.read().memories.find(m=>m.id===g.memory.id)).toMatchObject({status:'deleted',revision:2});
});
it('joint future RF1+RF2 headroom is enforced on later ordinary rights writes',async()=>{
 const f=await fixture();vi.spyOn(f.backend,'eraseSelectedPrivateNote').mockRejectedValueOnce(Error('TEST ONLY stopped after RF2 intent'));await expect(f.execute(f.plan())).rejects.toThrow();
 const scope={space:'work',purpose:'optional.personalization'} as const,restriction=(f.repository.read(accountIdFor(101))!).requests.find(r=>r.kind==='restriction')!;
 const plan=f.service.localUsePlan(101,restriction.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});
 // RF1 has its own canonical backend; leave its durable intent unresolved too.
 vi.spyOn(f.options.localUse,'apply').mockRejectedValueOnce(Error('TEST ONLY stopped after RF1 intent'));
 await expect(f.service.localUseAction(101,restriction.requestId,'work',{version:1,eventId:randomUUID(),action:'apply',planHandle:plan.planHandle})).rejects.toThrow();
 const ledger=f.repository.read(accountIdFor(101))!;if(ledger.version!==4)throw Error('missing');
 expect(ledger.localUse.intents.length).toBe(1);expect(ledger.localErasure.operations.length).toBe(1);
 const extra=[] as typeof ledger.commandReceipts;let found=false;
 for(let i=0;i<120;i++) {extra.push({eventId:randomUUID(),fingerprint:'f'.repeat(64),requestId:f.row.requestId,resultingRequestRevision:1,action:'\u0000'.repeat(50),recordedAt:RF1_NOW,retainUntil:RF1_NOW+100000});const candidate=structuredClone(ledger);candidate.commandReceipts.push(...extra);try{requireLocalUseCapacity(candidate);}catch{expect(Buffer.byteLength(JSON.stringify(candidate))).toBeLessThan(65536);found=true;break;}}
 expect(found).toBe(true);await expect(f.repository.transaction(accountIdFor(101),()=>RF1_NOW,d=>{d.commandReceipts.push(...extra);d.revision++;},()=>{})).rejects.toThrow('rights_capacity');expect(f.repository.read(accountIdFor(101))).toEqual(ledger);
});
it('operator recovery metadata binds the exact intent and final current proof without exposing note identity',async()=>{
 const f=await fixture(),p=f.plan(),transaction=f.repository.transaction.bind(f.repository);let calls=0;
 vi.spyOn(f.repository,'transaction').mockImplementation(async(...args)=>{if(++calls===2)throw Error('TEST ONLY ACK LOSS');return transaction(...args);});await f.execute(p);vi.restoreAllMocks();
 const operations=await f.service.operations(999),row=operations.requests.find(r=>r.requestId===f.row.requestId)!;
 expect(row.localErasures).toMatchObject([{commandEventId:p.eventId,reconcileAllowed:true,view:{technical:'note_content_removed',recording:'acknowledgement_pending'}}]);
 expect(JSON.stringify(operations)).not.toContain(f.memory.id);expect(JSON.stringify(operations)).not.toContain('TEST ONLY PRIVATE');
 expect(()=>f.service.assertErasureOperationsPublication(999,operations)).not.toThrow();
 await f.write(d=>{d.events=d.events.filter(e=>e.eventId!==p.eventId);});expect(()=>f.service.assertErasureOperationsPublication(999,operations)).toThrow('rights_conflict');
 await expect(f.service.reconcilePrivateNoteErasure(999,f.row.requestId,row.operationHandle,p.eventId,randomUUID())).rejects.toThrow();
});
it('complete canonical outbox capacity refuses a multi-row unit without partial tombstones',async()=>{
 const f=await fixture(),child=randomUUID();await f.write(d=>{d.memories.push({...structuredClone(f.memory),id:child,sourceRefs:[{id:f.memory.id,revision:1}]});while(d.outbox.length<1999)d.outbox.push({eventId:randomUUID(),kind:'memory_deleted',space:'work',personId:d.personId,revision:d.revision,memoryId:'TEST ONLY unrelated',epoch:0,createdAt:RF1_NOW});});
 const before=f.read();await expect(f.execute(f.plan())).rejects.toThrow();expect(f.read()).toEqual(before);
});
