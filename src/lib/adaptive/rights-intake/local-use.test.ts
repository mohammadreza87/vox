import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {accountIdFor,digest} from '../persistence/repository';
import {RightsIntakeService} from './service';
import {localUseFixture,RF1_NOW,syntheticLocalUsePolicy} from './local-use-fixtures';
import {localUseIntentDigest,requireLocalUseCapacity} from './local-use-state';
import {localUseStatusSchema} from './local-use-contracts';
const closes:Array<()=>Promise<void>>=[];afterEach(async()=>{vi.restoreAllMocks();for(const close of closes.splice(0))await close();});
const scope={space:'work',purpose:'optional.personalization'} as const;
async function fixture(format:'sqlite'|'file'='file'){const f=await localUseFixture(format);closes.push(f.close);const row=await f.create();return{...f,row};}
const input=(planHandle:string,action:'apply'|'release'='apply',eventId=randomUUID())=>({version:1 as const,action,eventId,planHandle});
for(const format of ['sqlite','file'] as const)it(`${format}: explicit conversion, real intent/effect/ack and release/replay retain consent and records`,async()=>{
 const f=await fixture(format),before=f.repository.read(accountIdFor(101))!;
 expect(f.service.localUseStatus(101,f.row.requestId,scope).status).toMatchObject({technical:{current:'unknown'},reason:'storage_unsupported'});
 expect(()=>f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'})).toThrow();
 await f.prepare();const converted=f.repository.read(accountIdFor(101))!;expect(converted.requests).toEqual(before.requests);expect(converted.commandReceipts).toEqual(before.commandReceipts);expect(converted).toMatchObject({version:3,localUse:{version:1,intents:[],acknowledgements:[]}});
 const prior=JSON.stringify(converted);await f.prepare();expect(JSON.stringify(f.repository.read(accountIdFor(101)))).toBe(prior);
 const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'}),command=input(plan.planHandle);
 const result=await f.service.localUseAction(101,f.row.requestId,'work',command);expect(result).toMatchObject({status:{technical:{current:'active',reconciliation:'recorded'},useEpoch:1,effectiveBlocked:true}});
 const d=f.repository.read(accountIdFor(101))!;if(d.version!==3)throw Error('missing');expect(d.localUse.intents).toHaveLength(1);expect(d.localUse.acknowledgements).toHaveLength(1);expect(d.localUse.intents[0].intentDigest).toBe(localUseIntentDigest(d.accountId,d.localUse.intents[0]));
 const current=f.storage.readCommittedForEffect(accountIdFor(101));expect(current).toMatchObject({status:'ready',document:{rightsUseHolds:{effects:[{state:'active'}]}}});
 const release=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'fa'});
 expect(await f.service.localUseAction(101,f.row.requestId,'work',input(release.planHandle,'release'))).toMatchObject({status:{technical:{current:'released',reconciliation:'recorded'},useEpoch:2,effectiveBlocked:false}});
 expect(await f.service.localUseAction(101,f.row.requestId,'work',command)).toMatchObject({replayed:true,status:{technical:{current:'released'},useEpoch:2}});
 const restarted=new RightsIntakeService(f.repository,f.serviceOptions);expect(restarted.localUseStatus(101,f.row.requestId,scope).status.technical.current).toBe('released');
});
it('keeps a canonical hold active after failed ack, supports exact explicit operator reconciliation and policy-off status',async()=>{
 const f=await fixture();await f.prepare();const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});
 const transact=f.repository.transaction.bind(f.repository);let calls=0;
 vi.spyOn(f.repository,'transaction').mockImplementation(async(...args)=>{if(++calls===2)throw Error('TEST ONLY ack fault');return transact(...args);});
 const result=await f.service.localUseAction(101,f.row.requestId,'work',input(plan.planHandle));expect(result.status).toMatchObject({technical:{current:'active',reconciliation:'failed'},effectiveBlocked:true});
 const d=f.repository.read(accountIdFor(101))!;if(d.version!==3)throw Error('missing');expect(d.localUse.acknowledgements).toEqual([]);
 f.setPolicy(undefined);expect(f.service.localUseStatus(101,f.row.requestId,scope)).toMatchObject({status:{technical:{current:'active'},effectiveBlocked:true},availableActions:[]});
 f.setPolicy(syntheticLocalUsePolicy());vi.restoreAllMocks();const ops=await f.service.operations(999),row=ops.requests[0];
 await f.service.reconcileLocalUse(999,f.row.requestId,row.operationHandle,d.localUse.intents[0].eventId);
 expect(f.service.localUseStatus(101,f.row.requestId,scope).status.technical).toEqual({current:'active',reconciliation:'recorded'});
 expect(f.backend.inspectNow(101,scope,()=>{})).toMatchObject({status:'ready',value:{useEpoch:1}});
});
it('rejects expired, changed-scope, foreign and closed-request new commands without applying a hold',async()=>{
 const f=await fixture();await f.prepare();const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});
 await expect(f.service.localUseAction(102,f.row.requestId,'work',input(plan.planHandle))).rejects.toThrow('operation_handle_invalid');
 await expect(f.service.localUseAction(101,f.row.requestId,'personal',input(plan.planHandle))).rejects.toThrow('rights_conflict');
 f.setNow(RF1_NOW+30000);await expect(f.service.localUseAction(101,f.row.requestId,'work',input(plan.planHandle))).rejects.toThrow('operation_handle_invalid');
 expect(f.backend.inspectNow(101,scope,()=>{})).toMatchObject({status:'ready',value:{useEpoch:0,effectiveBlocked:false}});
 const fresh=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});
 await f.service.requesterAction(101,'work',f.row.requestId,{version:1,eventId:randomUUID(),expectedRevision:1,action:'withdraw_request'});
 await expect(f.service.localUseAction(101,f.row.requestId,'work',input(fresh.planHandle))).rejects.toThrow('rights_conflict');
});
it('reserves maximum future release+both missing ack slots on every ordinary RI write without evicting intent dependencies',async()=>{
 const f=await fixture();await f.prepare();const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});
 await f.service.localUseAction(101,f.row.requestId,'work',input(plan.planHandle));const before=f.repository.read(accountIdFor(101))!;
 const full=structuredClone(before);for(let i=0;i<100;i++){const row=structuredClone(full.requests[0]);row.requestId=randomUUID();full.requests.push(row);}expect(()=>requireLocalUseCapacity(full)).toThrow('rights_capacity');
 const boundary=structuredClone(before);let safe=structuredClone(boundary);
 while(true){const r=structuredClone(boundary.requests[0]);r.requestId=randomUUID();r.intakePolicy.id='\u0000'.repeat(100);boundary.requests.push(r);try{requireLocalUseCapacity(boundary);safe=structuredClone(boundary);}catch{break;}}
 expect(Buffer.byteLength(JSON.stringify(boundary))).toBeLessThan(65536);
 await expect(f.repository.transaction(before.accountId,()=>RF1_NOW,d=>{d.requests=boundary.requests;},()=>{})).rejects.toThrow('rights_capacity');
 expect(digest(f.repository.read(before.accountId))).toBe(digest(before));
 await f.repository.transaction(before.accountId,()=>RF1_NOW,d=>{d.requests=safe.requests;},()=>{});
 const release=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'});
 expect(await f.service.localUseAction(101,f.row.requestId,'work',input(release.planHandle,'release'))).toMatchObject({status:{technical:{current:'released',reconciliation:'recorded'}}});
});
it('requires explicit reviewed conversion authority and validates impossible current proof',async()=>{
 const f=await fixture(),p=syntheticLocalUsePolicy();delete p.localFulfillment.ledgerConversion;f.setPolicy(p);await expect(f.prepare()).rejects.toThrow('reviewed_policy_unavailable');expect(f.repository.read(accountIdFor(101))!.version).toBe(2);
 expect(localUseStatusSchema.safeParse({version:1,scope,technical:{current:'unknown',reconciliation:'none'},effectiveBlocked:false,observedAt:null,useEpoch:null,reason:null}).success).toBe(false);
 expect(localUseStatusSchema.safeParse({version:1,scope,technical:{current:'active',reconciliation:'recorded'},effectiveBlocked:false,observedAt:1,useEpoch:1,reason:null}).success).toBe(false);
});
it('releases despite missing apply ack, then records the actual current released proof for a delayed apply acknowledgement',async()=>{
 const f=await fixture();await f.prepare();const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'}),command=input(plan.planHandle);
 const transact=f.repository.transaction.bind(f.repository);let calls=0;vi.spyOn(f.repository,'transaction').mockImplementation(async(...args)=>{if(++calls===2)throw Error('TEST ONLY missing apply ack');return transact(...args);});
 const first=await f.service.localUseAction(101,f.row.requestId,'work',command);expect(first.availableActions).toContain('release');vi.restoreAllMocks();
 f.setNow(RF1_NOW+1000);const planRelease=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'});
 expect(await f.service.localUseAction(101,f.row.requestId,'work',input(planRelease.planHandle,'release'))).toMatchObject({status:{technical:{current:'released',reconciliation:'pending'},useEpoch:2}});
 f.setNow(RF1_NOW+2000);const ops=await f.service.operations(999),row=ops.requests[0];await f.service.reconcileLocalUse(999,f.row.requestId,row.operationHandle,command.eventId);
 const ledger=f.repository.read(accountIdFor(101))!;if(ledger.version!==3)throw Error('missing');const ack=ledger.localUse.acknowledgements.find(a=>a.eventId===command.eventId)!;
 expect(ack).toMatchObject({effectState:'released',effectRevision:2,useEpoch:2,observedAt:RF1_NOW+2000,recordedAt:RF1_NOW+2000});
 expect(await f.service.localUseAction(101,f.row.requestId,'work',command)).toMatchObject({replayed:true,status:{technical:{current:'released',reconciliation:'recorded'},useEpoch:2}});
});
it('retained released+acknowledged dependencies refuse terminal purge after minimum floors without generic storage failure',async()=>{
 const f=await fixture();await f.prepare();const p=syntheticLocalUsePolicy();p.retentionOperations={terminalRetentionMs:1000,continuityRetentionMs:1000};p.retention={requestReviewAfterMs:1000,auditRetentionMs:1000,receiptRetentionMs:1000};f.setPolicy(p);
 const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});await f.service.localUseAction(101,f.row.requestId,'work',input(plan.planHandle));
 const release=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'});await f.service.localUseAction(101,f.row.requestId,'work',input(release.planHandle,'release'));
 await f.service.requesterAction(101,'work',f.row.requestId,{version:1,eventId:randomUUID(),expectedRevision:1,action:'withdraw_request'});
 const later=RF1_NOW+172800001;f.setNow(later);p.expiresAt=later+3600000;f.setPolicy(p);const ops=await f.service.operations(999),row=ops.requests[0],before=digest(f.repository.read(accountIdFor(101)));
 await expect(f.service.retentionAction(999,row.requestId,{version:1,eventId:randomUUID(),expectedRevision:row.revision,expectedPolicyRevision:p.revision,action:'purge_terminal_record',operationHandle:row.operationHandle})).rejects.toThrow('rights_retention_not_eligible');
 expect(digest(f.repository.read(accountIdFor(101)))).toBe(before);expect(f.service.localUseStatus(101,f.row.requestId,scope).status.technical.current).toBe('released');
});
it('conversion of an absent ledger does not create a root or clock; replay may advance only the sticky clock',async()=>{
 const {join}=await import('node:path'),{existsSync,readFileSync}=await import('node:fs'),{RightsRepository}=await import('./repository'),{RightsFileStorage}=await import('./storage'),{prepareRightsLocalUseLedger}=await import('./conversion');
 const f=await fixture(),missing=join(f.directory,'absent-rights'),repository=new RightsRepository(new RightsFileStorage(missing));
 await expect(prepareRightsLocalUseLedger({repository,accountId:accountIdFor(101),policy:syntheticLocalUsePolicy,clock:()=>RF1_NOW,assertLocalAdministrationNow:()=>{},assertQuiescedNow:()=>{}})).rejects.toThrow('rights_conversion_not_eligible');expect(existsSync(missing)).toBe(false);
 await f.prepare();const before=JSON.stringify(f.repository.read(accountIdFor(101)));f.setNow(RF1_NOW+1);await f.prepare();expect(JSON.stringify(f.repository.read(accountIdFor(101)))).toBe(before);
 expect(JSON.parse(readFileSync(join(f.directory,'rights-intake','v1','.clock-v1.json'),'utf8')).observedServerTime).toBe(RF1_NOW+1);
});
for(const format of ['sqlite','file'] as const)it(`${format}: fresh requester confirmation supersedes stale uncommitted release after an unrelated write; late old worker and replay cannot execute`,async()=>{
 const f=await fixture(format);await f.prepare();const apply=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});await f.service.localUseAction(101,f.row.requestId,'work',input(apply.planHandle));
 const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'}),old=input(plan.planHandle,'release'),release=f.backend.release.bind(f.backend);let oldArgs!:Parameters<typeof release>;
 vi.spyOn(f.backend,'release').mockImplementationOnce(async(...args)=>{oldArgs=args;throw Error('TEST ONLY crash after release intent');});
 await expect(f.service.localUseAction(101,f.row.requestId,'work',old)).rejects.toThrow('TEST ONLY');vi.restoreAllMocks();
 const state=await f.adaptive.read(101,'work');await f.adaptive.createMemory(101,{space:'work',text:'TEST ONLY unrelated retained note',eventId:randomUUID(),expectedRevision:state.revision});
 await expect(f.service.localUseAction(101,f.row.requestId,'work',old)).rejects.toThrow('conflict');
 const replacement=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'fa'}),fresh=input(replacement.planHandle,'release');
 expect(await f.service.localUseAction(101,f.row.requestId,'work',fresh)).toMatchObject({status:{technical:{current:'released',reconciliation:'recorded'},useEpoch:2}});
 const d=f.repository.read(accountIdFor(101))!;if(d.version!==3)throw Error('missing');const releases=d.localUse.intents.filter(i=>i.action==='release');expect(releases).toHaveLength(2);expect(releases[1].supersedesEventId).toBe(old.eventId);expect(d.localUse.acknowledgements.some(a=>a.eventId===old.eventId)).toBe(false);
 await expect(release(...oldArgs)).rejects.toThrow('rights_conflict');const count=vi.spyOn(f.backend,'release');expect(await f.service.localUseAction(101,f.row.requestId,'work',old)).toMatchObject({replayed:true,status:{technical:{current:'released'},useEpoch:2}});expect(count).not.toHaveBeenCalled();
 const ops=await f.service.operations(999);await expect(f.service.reconcileLocalUse(999,f.row.requestId,ops.requests[0].operationHandle,old.eventId)).rejects.toThrow('rights_conflict');
});
it('an exact explicitly requested release retry retains its original CAS and command identity when still current',async()=>{
 const f=await fixture();await f.prepare();const a=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});await f.service.localUseAction(101,f.row.requestId,'work',input(a.planHandle));const p=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'}),command=input(p.planHandle,'release');
 vi.spyOn(f.backend,'release').mockRejectedValueOnce(Error('TEST ONLY before canonical dispatch'));await expect(f.service.localUseAction(101,f.row.requestId,'work',command)).rejects.toThrow('TEST ONLY');vi.restoreAllMocks();
 expect(await f.service.localUseAction(101,f.row.requestId,'work',command)).toMatchObject({replayed:true,status:{technical:{current:'released',reconciliation:'recorded'},useEpoch:2}});
 const d=f.repository.read(accountIdFor(101))!;if(d.version!==3)throw Error('missing');expect(d.localUse.intents.filter(i=>i.action==='release')).toHaveLength(1);
});
it.each(['old-first','replacement-first'] as const)('release supersession race %s has one canonical winner and preserves the losing intent exclusion',async order=>{
 const f=await fixture();await f.prepare();const a=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});await f.service.localUseAction(101,f.row.requestId,'work',input(a.planHandle));
 const p=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'}),old=input(p.planHandle,'release'),release=f.backend.release.bind(f.backend);let held!:Parameters<typeof release>;
 vi.spyOn(f.backend,'release').mockImplementationOnce(async(...args)=>{held=args;throw Error('TEST ONLY paused old worker');});await expect(f.service.localUseAction(101,f.row.requestId,'work',old)).rejects.toThrow('TEST ONLY');vi.restoreAllMocks();
 const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'release',purpose:scope.purpose,locale:'en'}),fresh=input(plan.planHandle,'release');
 if(order==='old-first'){
   const transact=f.repository.transaction.bind(f.repository);vi.spyOn(f.repository,'transaction').mockImplementationOnce(async(...args)=>{await release(...held);return transact(...args);});
   await expect(f.service.localUseAction(101,f.row.requestId,'work',fresh)).rejects.toThrow('rights_conflict');
   const d=f.repository.read(accountIdFor(101))!;if(d.version!==3)throw Error('missing');expect(d.localUse.intents.some(i=>i.eventId===fresh.eventId)).toBe(false);
 }else{
   vi.spyOn(f.backend,'release').mockImplementationOnce(async(...args)=>{await expect(release(...held)).rejects.toThrow('rights_conflict');return release(...args);});
   expect(await f.service.localUseAction(101,f.row.requestId,'work',fresh)).toMatchObject({status:{technical:{current:'released'},useEpoch:2}});
 }
 expect(f.backend.inspectNow(101,scope,()=>{})).toMatchObject({status:'ready',value:{useEpoch:2,effectiveBlocked:false}});
});
it('own management/export retains lawful note data and scoped restriction metadata while automatic use is held',async()=>{
 const f=await fixture();await f.prepare();const read=await f.adaptive.read(101,'work');await f.adaptive.createMemory(101,{space:'work',text:'TEST ONLY retained own note',eventId:randomUUID(),expectedRevision:read.revision});
 const plan=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});await f.service.localUseAction(101,f.row.requestId,'work',input(plan.planHandle));
 const {AdaptiveLifecycleService}=await import('../lifecycle/service'),{rightsExportSchema}=await import('@/app/studio/_lib/rights-client');
 const prepared=await new AdaptiveLifecycleService(f.adaptive).prepareAccountExport(101,'work');prepared.revalidate();const exported=rightsExportSchema.parse(prepared.data);
 expect(exported.memories[0].text).toBe('TEST ONLY retained own note');expect(exported.rightsUseHolds).toMatchObject({version:1,effects:[{state:'active',space:'work',purpose:'optional.personalization'}]});expect(exported.rightsUseHolds!.scopes).toHaveLength(2);
 expect(f.service.localUseStatus(101,f.row.requestId,scope).status.effectiveBlocked).toBe(true);
});
for(const format of ['sqlite','file'] as const)it(`${format}: expired ABSENT apply permits only a fresh confirmed command at equality; old worker/clock rollback never revives and actual hold never expires`,async()=>{
 const f=await fixture(format);await f.prepare();const p=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'}),old=input(p.planHandle),apply=f.backend.apply.bind(f.backend);let held!:Parameters<typeof apply>;
 vi.spyOn(f.backend,'apply').mockImplementationOnce(async(...args)=>{held=args;throw Error('TEST ONLY paused apply worker');});await expect(f.service.localUseAction(101,f.row.requestId,'work',old)).rejects.toThrow('TEST ONLY');vi.restoreAllMocks();
 f.setNow(RF1_NOW+59999);expect(f.service.localUseStatus(101,f.row.requestId,scope)).toMatchObject({status:{technical:{current:'not_applied',reconciliation:'pending'}},availableActions:[]});
 f.setNow(RF1_NOW+60000);expect(f.service.localUseStatus(101,f.row.requestId,scope)).toMatchObject({status:{technical:{current:'not_applied',reconciliation:'none'}},availableActions:['apply']});
 const fresh=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'fa'});expect(await f.service.localUseAction(101,f.row.requestId,'work',input(fresh.planHandle))).toMatchObject({status:{technical:{current:'active',reconciliation:'recorded'},useEpoch:1}});
 await expect(apply(...held)).rejects.toThrow('rights_conflict');const ledger=f.repository.read(accountIdFor(101))!;if(ledger.version!==3)throw Error('missing');expect(ledger.localUse.intents).toHaveLength(2);expect(ledger.localUse.intents.every(i=>i.supersedesEventId===undefined)).toBe(true);expect(ledger.localUse.acknowledgements).toHaveLength(1);
 f.setNow(RF1_NOW);await expect(apply(...held)).rejects.toThrow('rights_clock_unavailable');
 f.setNow(RF1_NOW+120000);expect(f.service.localUseStatus(101,f.row.requestId,scope).status).toMatchObject({technical:{current:'active'},effectiveBlocked:true,useEpoch:1});
 expect(()=>f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'})).toThrow('rights_conflict');
});
it('expired apply admission rejects busy/unknown proof and repeats ready absence at final RI publication',async()=>{
 const f=await fixture();await f.prepare();const p=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'});vi.spyOn(f.backend,'apply').mockRejectedValueOnce(Error('TEST ONLY before apply'));await expect(f.service.localUseAction(101,f.row.requestId,'work',input(p.planHandle))).rejects.toThrow('TEST ONLY');vi.restoreAllMocks();f.setNow(RF1_NOW+60000);
 const inspect=vi.spyOn(f.backend,'inspectNow').mockReturnValue({status:'busy'});expect(f.service.localUseStatus(101,f.row.requestId,scope)).toMatchObject({status:{technical:{current:'unknown'},effectiveBlocked:null},availableActions:[]});expect(()=>f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'})).toThrow();inspect.mockRestore();
 const fresh=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'}),before=digest(f.repository.read(accountIdFor(101))),transact=f.rightsStorage.transact.bind(f.rightsStorage);
 vi.spyOn(f.rightsStorage,'transact').mockImplementationOnce((id,mutate,fence)=>transact(id,mutate,()=>{vi.spyOn(f.backend,'inspectNow').mockReturnValueOnce({status:'busy'});fence?.();}));
 await expect(f.service.localUseAction(101,f.row.requestId,'work',input(fresh.planHandle))).rejects.toThrow('rights_conflict');expect(digest(f.repository.read(accountIdFor(101)))).toBe(before);
});
it('an old apply that actually commits before deadline remains active after review time and cannot qualify as absent recovery',async()=>{
 const f=await fixture();await f.prepare();const p=f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'}),apply=f.backend.apply.bind(f.backend);let held!:Parameters<typeof apply>;
 vi.spyOn(f.backend,'apply').mockImplementationOnce(async(...args)=>{held=args;throw Error('TEST ONLY old dispatch barrier');});await expect(f.service.localUseAction(101,f.row.requestId,'work',input(p.planHandle))).rejects.toThrow('TEST ONLY');vi.restoreAllMocks();f.setNow(RF1_NOW+59999);await apply(...held);
 f.setNow(RF1_NOW+60000);expect(f.service.localUseStatus(101,f.row.requestId,scope)).toMatchObject({status:{technical:{current:'active',reconciliation:'pending'},effectiveBlocked:true},availableActions:['release']});expect(()=>f.service.localUsePlan(101,f.row.requestId,'work',{version:1,action:'apply',purpose:scope.purpose,locale:'en'})).toThrow('rights_conflict');
});
