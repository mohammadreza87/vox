/** Independent MI1 source/FILE boundaries. Initial marked data is a synthetic
 * fixture, not evidence that the managed publication/restart journey ran. */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {AdaptiveLifecycleService} from '../lifecycle/service';
import {accountIdFor,prepareExistingMemoryAccountMigration,validateAdaptiveDocument,type AdaptiveDocument} from '../persistence/repository';
import {encodeAdaptiveStorageDocument,MAX_ADAPTIVE_DOCUMENT_BYTES} from '../persistence/storage';
import {emptyAssistantDeliveryControl,assistantCapacityProjection} from '../assistant-delivery-control';
import {runWithMemoryAccountWork,assertMemoryAccountSource} from '../memory-account-lifecycle';
import {qualifiedMemoryClock,qualifiedMemoryInterval} from '../memory-account-time';
import {qualifiedAccountFixture,type QualifiedAccountFixture} from '../../studio/__tests__/memory-account-qualified-fixture';
import {ID} from '../../studio/__tests__/helpers';
import {resetFileRuntimeIoHooks,setFileRuntimeIoHooks} from '../../../test/fro1-io-fixture';
vi.mock('../../studio/file-runtime-owner',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../studio/file-runtime-owner')>();
  const {instrumentFileRuntime}=await import('../../../test/fro1-io-fixture');return instrumentFileRuntime(actual);
});

/** Uses only bounded, unique canonical event fields. There are no unknown
 * padding properties or invented consent evidence. ASCII width is UTF8 width. */
function exactEventBytes(source:AdaptiveDocument,target:number):AdaptiveDocument {
  const d=structuredClone(source);d.events=Array.from({length:1400},(_,n)=>({eventId:`mi1-capacity-${n}`,fingerprint:'x',kind:'k',resultId:'r',revision:1}));
  let remaining=target-Buffer.byteLength(JSON.stringify(d));
  if(remaining<0)throw Error('independent capacity target below valid fixture base');
  for(const row of d.events)for(const key of ['fingerprint','kind','resultId'] as const){const add=Math.min(199,remaining);row[key]+='x'.repeat(add);remaining-=add;}
  if(remaining!==0||Buffer.byteLength(JSON.stringify(d))!==target)throw Error('independent capacity target outside bounded fields');
  return d;
}
describe('MI1 actual shared prospective migration capacity',()=>{
  it('exact700000-byte post-lifecycle candidate passes actual encoder and locked migration without omitting payload',async()=>{
    const f=await setup({marked:false}),now=f.clock2(),legacy=validateAdaptiveDocument(f.document(),alice,now);delete legacy.memoryLifecycle;
    const life={version:1,mode:'legacy-current',incarnation:'a'.repeat(64),revision:1} as const;
    const delta=Buffer.byteLength(JSON.stringify({...legacy,memoryLifecycle:life}))-Buffer.byteLength(JSON.stringify(legacy));
    const current=exactEventBytes(legacy,MAX_ADAPTIVE_DOCUMENT_BYTES-delta),before=JSON.stringify(current);
    expect(()=>validateAdaptiveDocument(current,alice,now)).not.toThrow();expect(encodeAdaptiveStorageDocument(current)).toBe(before);
    const prepared=prepareExistingMemoryAccountMigration(current,alice,now,'a'.repeat(64));
    expect(Buffer.byteLength(prepared.encoded)).toBe(700000);expect(prepared.encoded).toBe(encodeAdaptiveStorageDocument(prepared.document));
    expect(JSON.stringify(current)).toBe(before);const {memoryLifecycle:onlyAdded,...projection}=prepared.document;expect(projection).toEqual(current);expect(onlyAdded).toEqual(life);
    f.replace(current);f.f.mark();const actual=await f.repository.migrateExistingMemoryAccount(alice,f.clock1),after=f.document();
    expect(Buffer.byteLength(f.raw())).toBe(700000);expect(after.memoryLifecycle).toEqual(actual);
    const {memoryLifecycle:discard,...preserved}=after;expect(discard).toEqual(actual);expect(preserved).toEqual(current);
  });
  it('a current valid sub700000-byte row refuses when adding lifecycle crosses encoder limit, with no canonical write',async()=>{
    const f=await setup({marked:false}),now=f.clock2(),legacy=validateAdaptiveDocument(f.document(),alice,now);delete legacy.memoryLifecycle;
    const life={version:1,mode:'legacy-current',incarnation:'a'.repeat(64),revision:1} as const,delta=Buffer.byteLength(JSON.stringify({...legacy,memoryLifecycle:life}))-Buffer.byteLength(JSON.stringify(legacy));
    const current=exactEventBytes(legacy,700000-delta+1),bytes=encodeAdaptiveStorageDocument(current);
    expect(Buffer.byteLength(bytes)).toBeLessThan(700000);expect(()=>validateAdaptiveDocument(current,alice,now)).not.toThrow();
    expect(()=>prepareExistingMemoryAccountMigration(current,alice,now,'a'.repeat(64))).toThrow('Adaptive account storage capacity reached');
    f.replace(current);f.f.mark();const before=f.raw();await expect(f.repository.migrateExistingMemoryAccount(alice,f.clock1)).rejects.toThrow('Adaptive account storage capacity reached');expect(f.raw()).toBe(before);
  });
  it('ARC future-reservation boundary participates after lifecycle addition even though actual stored bytes remain below700000',async()=>{
    const f=await setup({marked:false}),now=f.clock2(),base=validateAdaptiveDocument(f.document(),alice,now);delete base.memoryLifecycle;base.assistantDeliveryControl=emptyAssistantDeliveryControl(now-1000);
    const normalized=validateAdaptiveDocument(base,alice,now),size=(v:unknown)=>Buffer.byteLength(JSON.stringify(v)),reserveDelta=size(assistantCapacityProjection(normalized))-size(normalized),
      life={version:1,mode:'legacy-current',incarnation:'a'.repeat(64),revision:1} as const,lifeDelta=size({...normalized,memoryLifecycle:life})-size(normalized);
    const valid=exactEventBytes(normalized,700000-reserveDelta-lifeDelta),invalid=exactEventBytes(normalized,700000-reserveDelta);
    expect(size(assistantCapacityProjection({...valid,memoryLifecycle:life} as AdaptiveDocument))).toBe(700000);
    expect(()=>validateAdaptiveDocument(valid,alice,now)).not.toThrow();expect(()=>prepareExistingMemoryAccountMigration(valid,alice,now,'a'.repeat(64))).not.toThrow();
    expect(size(assistantCapacityProjection(invalid))).toBe(700000);expect(()=>validateAdaptiveDocument(invalid,alice,now)).not.toThrow();
    expect(size({...invalid,memoryLifecycle:life})).toBeLessThan(700000);expect(()=>encodeAdaptiveStorageDocument({...invalid,memoryLifecycle:life})).not.toThrow();
    const before=JSON.stringify(invalid);expect(()=>prepareExistingMemoryAccountMigration(invalid,alice,now,'a'.repeat(64))).toThrow('Assistant control reserved capacity exceeded');expect(JSON.stringify(invalid)).toBe(before);
  });
  it('already-qualified raw omissions and lifecycle identity remain exact in the shared readonly candidate',async()=>{
    const f=await setup(),now=f.clock2(),current=f.document(),before=f.raw(),p=prepareExistingMemoryAccountMigration(current,alice,now,'f'.repeat(64));
    expect(p.encoded).toBe(before);expect(p.result).toEqual(current.memoryLifecycle);expect(p.document).toEqual(current);expect(f.raw()).toBe(before);
    expect(()=>prepareExistingMemoryAccountMigration(null,alice,now,'a'.repeat(64))).toThrow();
    const legacy={...current};delete legacy.memoryLifecycle;expect(()=>prepareExistingMemoryAccountMigration(legacy,alice,now)).toThrow();
  });
});
const fixtures:QualifiedAccountFixture[]=[];
async function setup(o:Parameters<typeof qualifiedAccountFixture>[0]={}){const f=await qualifiedAccountFixture(o);fixtures.push(f);return f;}
afterEach(()=>{resetFileRuntimeIoHooks();vi.restoreAllMocks();for(const f of fixtures.splice(0))f.close();});
const alice=accountIdFor(ID.alice);
function advanceBusinessClock(f:QualifiedAccountFixture){
  let samples=0;
  f.setBusinessClock(()=>{samples++;f.f.control.offsetMs+=3;return f.clock2();});
  return ()=>samples;
}
function holdCanonical(f:QualifiedAccountFixture){
  let entered!:()=>void,release!:()=>void,once=true;
  const entry=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  setFileRuntimeIoHooks({afterTemporarySync:async path=>{if(once&&path.startsWith(f.path()+'.')){once=false;entered();await gate;}}});
  return {entry,release};
}
describe('MI1 actual qualified original-work FILE authority',()=>{
  it('two genuinely registered advancing clocks do not confuse committed original-work intervals',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(alice,f.clock1),first=f.clock1();
    f.f.control.offsetMs+=3;const second=f.clock2();expect(second).toBeGreaterThan(first);
    expect(()=>qualifiedMemoryInterval(f.clock1,second)).toThrow();
    const wrongBusiness=vi.fn(()=>f.clock2());
    const read=runWithMemoryAccountWork(work,()=>f.repository.readCommittedForEffect(alice,wrongBusiness));
    expect(read.status).toBe('ready');if(read.status!=='ready')throw Error('committed read unavailable');
    expect(read.document?.memoryLifecycle?.incarnation).toBe(f.document().memoryLifecycle?.incarnation);
    expect(wrongBusiness).not.toHaveBeenCalled();
    const samples=advanceBusinessClock(f);
    const serviceRead=runWithMemoryAccountWork(work,()=>f.adaptive.readCommittedForEffect(ID.alice,(d,now)=>({id:d.accountId,now})));
    expect(serviceRead.status).toBe('ready');expect(samples()).toBeGreaterThan(0);
  });
  it('marked reconciliation succeeds with distinct advancing registered clocks and imports zero old content',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(alice,f.clock1),before=f.document();advanceBusinessClock(f);
    const result=await runWithMemoryAccountWork(work,()=>new AdaptiveLifecycleService(f.adaptive).reconcileSnapshot(ID.alice,{
      accountId:alice,revision:before.revision,memoryLifecycle:before.memoryLifecycle,
      memories:[{id:'MI1_OLD_PAYLOAD_CANARY',text:'DO_NOT_IMPORT_PRIVATE_PAST'}],permissions:[{state:'granted'}],binding:{expiresAt:Number.MAX_SAFE_INTEGER},
    }));
    expect(result).toMatchObject({importedPayloads:0,acceptedMemoryIds:[],suppressedMemoryIds:['MI1_OLD_PAYLOAD_CANARY'],permissions:'current_authority_only'});
    const after=f.document();expect(after.memories).toEqual(before.memories);expect(after.permissions).toEqual(before.permissions);expect(after.binding).toEqual(before.binding);
    expect(f.raw()).not.toContain('DO_NOT_IMPORT_PRIVATE_PAST');
  });
  it.each(['other-account','future-revision','different-incarnation'] as const)('recovery %s refuses without importing or rewriting the account',async mode=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(alice,f.clock1),before=f.raw(),d=f.document();
    const snapshot={accountId:mode==='other-account'?accountIdFor(ID.bob):alice,revision:d.revision+(mode==='future-revision'?1:0),memories:[],
      memoryLifecycle:mode==='different-incarnation'?{...d.memoryLifecycle,incarnation:'f'.repeat(64)}:d.memoryLifecycle};
    await expect(runWithMemoryAccountWork(work,()=>new AdaptiveLifecycleService(f.adaptive).reconcileSnapshot(ID.alice,snapshot))).rejects.toThrow();
    expect(f.raw()).toBe(before);
  });
  it('same-ID/revision replacement cannot inherit captured original work or recovery authority',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(alice,f.clock1),snapshot=f.document(),replacement=f.document();
    replacement.memoryLifecycle!.incarnation=randomBytes(32).toString('hex');f.replace(replacement);const bytes=f.raw();
    expect(()=>runWithMemoryAccountWork(work,()=>f.repository.readCommittedForEffect(alice,f.clock2))).toThrow();
    await expect(runWithMemoryAccountWork(work,()=>new AdaptiveLifecycleService(f.adaptive).reconcileSnapshot(ID.alice,snapshot))).rejects.toThrow();expect(f.raw()).toBe(bytes);
  });
  it('a newly acquired lease cannot rescue expired original captured work',async()=>{
    const f=await setup({shortLease:true}),work=f.repository.captureMemoryAccountWork(alice,f.clock1),before=f.raw();
    f.f.control.offsetMs+=5100;const fresh=await f.f.acquire({purpose:'runtime'}),newClock=qualifiedMemoryClock(fresh);expect(newClock()).toBeGreaterThan(0);
    expect(()=>runWithMemoryAccountWork(work,()=>f.repository.readCommittedForEffect(alice,newClock))).toThrow();expect(f.raw()).toBe(before);
  });
  it('post-temp-fsync lease expiry refuses actual FILE commit without renewing the old permit',async()=>{
    const f=await setup({shortLease:true}),work=f.repository.captureMemoryAccountWork(alice,f.clock1),before=f.raw(),hold=holdCanonical(f);
    const pending=runWithMemoryAccountWork(work,()=>f.repository.transaction(alice,f.clock2,(d,now)=>{d.updatedAt=now;}));
    await Promise.race([hold.entry,pending.then(()=>{throw Error('actual canonical temporary fsync not reached');})]);
    f.f.control.offsetMs+=5100;hold.release();await expect(pending).rejects.toThrow();expect(f.raw()).toBe(before);
  });
  it('actual post-fsync committed-byte reread rejects an incarnation replacement',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(alice,f.clock1),hold=holdCanonical(f);
    const pending=runWithMemoryAccountWork(work,()=>f.repository.transaction(alice,f.clock2,(d,now)=>{d.updatedAt=now;}));
    await Promise.race([hold.entry,pending.then(()=>{throw Error('actual canonical temporary fsync not reached');})]);
    const replacement=f.document();replacement.memoryLifecycle!.incarnation=randomBytes(32).toString('hex');writeFileSync(f.path(),JSON.stringify(replacement),{mode:0o600});
    const bytes=f.raw();hold.release();await expect(pending).rejects.toThrow();expect(f.raw()).toBe(bytes);
  });
  it('source-future admission uses conservative interval lower, while the expiry scalar remains upper',async()=>{
    const f=await setup({wideInterval:true}),n=f.clock1(),i=qualifiedMemoryInterval(f.clock1,n),d=f.document();expect(i.utcLowerMs).toBeLessThan(i.utcUpperMs);
    const source=Math.floor(f.f.now()/1000)+1;
    expect(source*1000).toBeGreaterThan(i.utcLowerMs+2000);expect(source*1000).toBeLessThanOrEqual(i.utcUpperMs+2000);
    expect(()=>assertMemoryAccountSource(d.memoryLifecycle!,source,n,i.utcLowerMs)).toThrow();
    expect(()=>assertMemoryAccountSource(d.memoryLifecycle!,source,n,n)).not.toThrow();
    expect(()=>f.repository.captureMemoryAccountWork(alice,f.clock1,source)).toThrow();
  });
  it('unmarked committed reads keep the original caller clock behavior without publishing MI1 controls',async()=>{
    const f=await setup({marked:false}),at=vi.fn(()=>f.clock2()),before=f.f.control.providerCalls;
    expect(f.repository.readCommittedForEffect(alice,at).status).toBe('ready');expect(at).toHaveBeenCalledOnce();
    expect(f.repository.memoryAccountMarked()).toBe(false);expect(f.f.control.providerCalls).toBe(before);
  });
  it('migration of already qualified rows retains incarnation and exact canonical bytes',async()=>{
    const f=await setup(),before=f.raw(),lifecycle=f.document().memoryLifecycle;
    expect(await f.repository.migrateExistingMemoryAccount(alice,f.clock2)).toEqual(lifecycle);expect(f.raw()).toBe(before);
  });
});
