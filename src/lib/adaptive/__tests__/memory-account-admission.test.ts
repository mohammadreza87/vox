/** Independent ER1 actual FILE/admission tests. Synthetic unlink/replacement is a fault, not a shipped erasure API. */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync,unlinkSync,symlinkSync,linkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ADAPTIVE_RELEASE_CAPABILITIES,assertReleaseAdaptiveCompatibility} from '../../../../scripts/studio-adaptive-compatibility.mjs';
import {assertReleaseAdaptiveCompatibility as assertPriorCompatibility} from '../../../../scripts/fixtures/memory-account-prior-reader/studio-adaptive-compatibility.mjs';
import {prepareAssistantText,reduceDelivery} from '../../tireh/delivery/assistant-text-protocol';
import {accountIdFor} from '../persistence/repository';
import {runWithMemoryAccountWork,memoryAccountCutoff,parseMemoryLifecycle,parseMemoryAccountErasing,MEMORY_ACCOUNT_TIME,MEMORY_ACCOUNT_MARKER} from '../memory-account-lifecycle';
import {checkMemoryAccountTime,observeMemoryAccountTime} from '../memory-account-lifecycle-file';
import {memoryAccountFixture,directoryImage,holdNextCanonicalSync,type MemoryAccountFixture} from '../../studio/__tests__/memory-account-fixture';
import {ID} from '../../studio/__tests__/helpers';
import {resetFileRuntimeIoHooks} from '../../../test/fro1-io-fixture';
vi.mock('../../studio/file-runtime-owner',async importOriginal=>{
  const actual=await importOriginal<typeof import('../../studio/file-runtime-owner')>();
  const {instrumentFileRuntime}=await import('../../../test/fro1-io-fixture');
  return instrumentFileRuntime(actual);
});
const fixtures:MemoryAccountFixture[]=[];
async function setup(o:Parameters<typeof memoryAccountFixture>[0]={}){const f=await memoryAccountFixture(o);fixtures.push(f);return f;}
afterEach(async()=>{resetFileRuntimeIoHooks();vi.restoreAllMocks();for(const f of fixtures.splice(0))await f.closeOwned();});
const account=accountIdFor(ID.alice);
describe('ER1 independent original FILE admission',()=>{
  it('unmarked existing caller retains ordinary behavior and imports create no ER1 marker',async()=>{
    const f=await setup({marked:false}),before=directoryImage(f.directory);
    expect(f.repository.memoryAccountStatus(account).state).toBe('unmarked');
    await f.repository.transaction(account,f.clock.now,(d,now)=>{d.updatedAt=now;});
    expect(directoryImage(f.directory).some(x=>x.path===MEMORY_ACCOUNT_MARKER)).toBe(false);expect(before.length).toBeGreaterThan(0);
  });
  it('marked status is read-only, and ordinary reads/writes cannot autocreate an absent account',async()=>{
    const f=await setup();f.removeCanonical();const before=directoryImage(f.directory);
    expect(f.repository.memoryAccountStatus(account,f.clock.now).state).toBe('missing');
    expect(()=>f.repository.captureMemoryAccountWork(account,f.clock.now)).toThrow();
    await expect(Promise.resolve().then(()=>f.repository.transaction(account,f.clock.now,(d,now)=>{d.updatedAt=now;}))).rejects.toThrow();
    expect(directoryImage(f.directory)).toEqual(before);
  });
  it('migration preserves canonical values/omissions and gives each account a distinct incarnation',async()=>{
    const f=await setup({migrate:false}),a=JSON.parse(f.raw()),b=JSON.parse(f.raw(ID.bob));
    const aa=await f.repository.migrateExistingMemoryAccount(account,f.clock.now),bb=await f.repository.migrateExistingMemoryAccount(accountIdFor(ID.bob),f.clock.now);
    const {memoryLifecycle:ignored,...rest}=JSON.parse(f.raw());expect(rest).toEqual(a);expect(ignored).toEqual(aa);
    const {memoryLifecycle:other,...restB}=JSON.parse(f.raw(ID.bob));expect(restB).toEqual(b);expect(other).toEqual(bb);expect(aa.incarnation).not.toBe(bb.incarnation);
    expect(aa.mode).toBe('legacy-current');
  });
  it('only branded original work enters marked ordinary writes; clone and other-owner reuse refuse',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(account,f.clock.now);
    expect(()=>runWithMemoryAccountWork({} as typeof work,()=>undefined)).toThrow();
    await expect(runWithMemoryAccountWork(work,()=>f.repository.transaction(accountIdFor(ID.bob),f.clock.now,()=>undefined))).rejects.toThrow();
    await runWithMemoryAccountWork(work,()=>f.repository.transaction(account,f.clock.now,()=>undefined));
  });
  it('ordinary marked mutation cannot change a valid lifecycle field',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(account,f.clock.now),before=f.raw();
    await expect(runWithMemoryAccountWork(work,()=>f.repository.transaction(account,f.clock.now,d=>{d.memoryLifecycle!.revision+=1;}))).rejects.toThrow('Memory lifecycle mutation refused');
    expect(f.raw()).toBe(before);
  });
  it('same ID/revision replacement invalidates old captured work and cannot be rebound lazily',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(account,f.clock.now),d=JSON.parse(f.raw());
    d.memoryLifecycle.incarnation=randomBytes(32).toString('hex');writeFileSync(f.path(),JSON.stringify(d),{mode:0o600});const before=f.raw();
    expect(f.repository.isMemoryAccountWorkCurrent(work,f.clock.now)).toBe(false);
    await expect(runWithMemoryAccountWork(work,()=>f.repository.transaction(account,f.clock.now,()=>undefined))).rejects.toThrow();expect(f.raw()).toBe(before);
  });
  it('fresh bootstrap does not restore old identity confirmation, grants, optional consent or payload',async()=>{
    const f=await setup(),old=JSON.parse(f.raw());f.removeCanonical();
    const c=await f.challenge();expect((await f.request('confirm',{body:{action:'fresh-bootstrap',previewDigest:c.preview.previewDigest,nonce:c.nonce}})).status).toBe(200);
    const d=JSON.parse(f.raw());expect(d.personId).toBe(old.personId);expect(d.memoryLifecycle.incarnation).not.toBe(old.memoryLifecycle.incarnation);
    expect(d.binding).toBeUndefined();expect(d.declaration).toBeUndefined();expect(d.agentGrants).toEqual([]);expect(d.memories).toEqual([]);expect(d.permissions.every((p:{state:string})=>p.state==='not_asked')).toBe(true);expect(d.assistantDeliveryControl).toBeUndefined();
  });
  it('original source floor refuses equality/old sources and preserves honest fresh readiness',async()=>{
    const f=await setup();f.removeCanonical();const c=await f.challenge();await f.request('confirm',{body:{action:'fresh-bootstrap',previewDigest:c.preview.previewDigest,nonce:c.nonce}});
    const d=JSON.parse(f.raw()),cutoff=d.memoryLifecycle.sourceCutoffMs;
    expect(cutoff).toBe(memoryAccountCutoff(d.memoryLifecycle.confirmedAt));f.clock.advance(6000);
    for(const date of [cutoff/1000-1,cutoff/1000])expect(()=>f.repository.captureMemoryAccountWork(account,f.clock.now,date)).toThrow();
    const fresh=f.repository.captureMemoryAccountWork(account,f.clock.now,cutoff/1000+1);expect(f.repository.isMemoryAccountWorkCurrent(fresh,f.clock.now)).toBe(true);
    expect(()=>f.repository.captureMemoryAccountWork(account,f.clock.now,Math.floor(f.clock.now()/1000)+30)).toThrow();
  });
  it('post-temp-fsync replacement is caught by the actual final FILE fence',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(account,f.clock.now),hold=holdNextCanonicalSync(f);
    const pending=runWithMemoryAccountWork(work,()=>f.repository.transaction(account,f.clock.now,(d,now)=>{d.updatedAt=now;}));await Promise.race([hold.entered,pending.then(()=>{throw Error('Commit did not enter actual temporary fsync');})]);
    const replacement=JSON.parse(f.raw());replacement.memoryLifecycle.incarnation=randomBytes(32).toString('hex');writeFileSync(f.path(),JSON.stringify(replacement),{mode:0o600});const bytes=f.raw();hold.release();
    await expect(pending).rejects.toThrow();expect(f.raw()).toBe(bytes);
  });
  it('clock rollback during awaited temp fsync cannot commit an ordinary captured write',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(account,f.clock.now),hold=holdNextCanonicalSync(f),before=f.raw();
    const pending=runWithMemoryAccountWork(work,()=>f.repository.transaction(account,f.clock.now,(d,now)=>{d.updatedAt=now;}));await Promise.race([hold.entered,pending.then(()=>{throw Error('Commit did not enter actual temporary fsync');})]);f.clock.advance(-10000);hold.release();
    await expect(pending).rejects.toThrow();expect(f.raw()).toBe(before);
  });
  it.each(['missing','corrupt','extra','permissions','symlink','hardlink'] as const)('strict root time %s refuses without rewriting state',async mode=>{
    const f=await setup(),p=join(f.directory,MEMORY_ACCOUNT_TIME),raw=readFileSync(p,'utf8');
    if(mode==='missing')unlinkSync(p);else if(mode==='corrupt')writeFileSync(p,'{}\n');else if(mode==='extra')writeFileSync(p,raw.trimEnd()+'\n\n');else if(mode==='permissions')chmodSync(p,0o644);
    else {const other=join(f.h.dir,'qa-time-copy');writeFileSync(other,raw,{mode:0o600});unlinkSync(p);if(mode==='symlink')symlinkSync(other,p);else linkSync(other,p);}
    const before=directoryImage(f.directory);expect(()=>f.repository.memoryAccountStatus(account,f.clock.now)).toThrow();expect(directoryImage(f.directory)).toEqual(before);
  });
  it('root high-water never falls across two accounts and rollback refuses current admission',async()=>{
    const f=await setup();observeMemoryAccountTime(f.directory,f.clock.now);const before=JSON.parse(readFileSync(join(f.directory,MEMORY_ACCOUNT_TIME),'utf8')).highWaterMs;
    f.clock.advance(100);observeMemoryAccountTime(f.directory,f.clock.now);expect(JSON.parse(readFileSync(join(f.directory,MEMORY_ACCOUNT_TIME),'utf8')).highWaterMs).toBeGreaterThanOrEqual(before+100);
    f.clock.advance(-1000);expect(()=>checkMemoryAccountTime(f.directory,f.clock.now)).toThrow();
  });
  it('strict lifecycle rejects future time, malformed cutoff and unknown fields',()=>{
    const now=10000,base={version:1,mode:'fresh-confirmed',incarnation:'a'.repeat(64),revision:1,confirmedAt:now,sourceCutoffMs:memoryAccountCutoff(now)};
    expect(parseMemoryLifecycle(base,now)).toEqual(base);
    for(const value of [{...base,confirmedAt:now+1},{...base,sourceCutoffMs:base.sourceCutoffMs-1},{...base,payload:'QA_CANARY'},{...base,revision:-0}])expect(()=>parseMemoryLifecycle(value,now)).toThrow();
  });
});

/** Diagnostic is combined original FILE/owner/parser/source/time work, not isolated added ER1 overhead. */
describe('ER1 reader admission and bounded diagnostic',()=>{
  it('actual accepted9e reader admits unmarked current FILE but refuses even empty ER1 marker/time',async()=>{
    const f=await setup({marked:false}),env={STUDIO_DATA_DIR:f.h.dir},prior=JSON.parse(readFileSync(join(process.cwd(),'scripts/fixtures/memory-account-prior-reader/studio-release.json'),'utf8'));
    const frozen=JSON.parse(readFileSync(join(process.cwd(),'scripts/fixtures/memory-account-prior-reader/manifest.json'),'utf8'));
    for(const [name,meta]of Object.entries(frozen.files) as Array<[string,{sha256:string}]>)expect(createHash('sha256').update(readFileSync(join(process.cwd(),'scripts/fixtures/memory-account-prior-reader',name))).digest('hex')).toBe(meta.sha256);
    expect(()=>assertPriorCompatibility(env,prior)).not.toThrow();
    f.mark();f.removeCanonical();f.removeCanonical(ID.bob);
    expect(()=>assertReleaseAdaptiveCompatibility(env,ADAPTIVE_RELEASE_CAPABILITIES)).not.toThrow();expect(()=>assertPriorCompatibility(env,prior)).toThrow();
  });
  it('new reader admits migrated active schema and refuses an unmarked embedded lifecycle',async()=>{
    const f=await setup(),env={STUDIO_DATA_DIR:f.h.dir};expect(()=>assertReleaseAdaptiveCompatibility(env,ADAPTIVE_RELEASE_CAPABILITIES)).not.toThrow();
    unlinkSync(join(f.directory,MEMORY_ACCOUNT_MARKER));unlinkSync(join(f.directory,MEMORY_ACCOUNT_TIME));expect(()=>assertReleaseAdaptiveCompatibility(env,ADAPTIVE_RELEASE_CAPABILITIES)).toThrow();
  });
  it('closed reader accepts actual ADP sending invalidation as unknown without retaining payload',async()=>{
    const f=await setup(),now=f.clock.now(),key=new Uint8Array(32).fill(21),p=prepareAssistantText({
      scope:{accountId:account,personId:'tg-300',agentId:f.agentId,space:'work',containerId:'private-tg-300',kind:'private'},
      binding:{botId:f.botId,destinationChatId:ID.alice,endpointBindingId:'qa-endpoint',credentialBindingId:'qa-credential',bindingRevision:'qa-binding'},
      source:{messageId:71,updateId:81,revision:0,occurredAt:now-1000,acceptedAt:now-100},
      authority:{authorityRevision:'qa-authority',grantRevision:'qa-grant',sourceFenceRevision:'qa-fence',sourceFenceSequence:3,historyEpoch:4,deletionEpoch:5,expiresAt:now+60000},
      generationId:randomUUID(),attemptId:randomUUID(),generatedText:'ER1_CLOSED_PAYLOAD_CANARY',decoratedText:'ER1_CLOSED_PAYLOAD_CANARY',keyId:'qa-key',evidenceKey:key,now,expiresAt:now+30000});
    const expected=(state:typeof p.initialState,at:number)=>({stateRevision:state.revision,effectKey:state.effectKey,attemptId:state.attemptId,scope:state.scope,binding:state.binding,source:state.source,authority:state.authority,now:at});
    const sending=reduceDelivery(p.initialState,{type:'begin_dispatch',prepared:p,evidenceKey:key},expected(p.initialState,now+1));
    const invalidated=reduceDelivery(sending,{type:'invalidate_content',sourceFenceSequence:4},expected(sending,now+2));
    expect(invalidated).toMatchObject({phase:'unknown',contentEligible:false,outcome:{reason:'dispatch_interrupted'}});
    f.clock.advance(100);const closedAt=f.clock.now(),closed={version:1,kind:'memory-account-erasing',accountId:account,incarnation:JSON.parse(f.raw()).memoryLifecycle.incarnation,revision:2,operationId:randomUUID(),scopeManifestDigest:'a'.repeat(64),closedAt,sourceCutoffMs:memoryAccountCutoff(closedAt),attemptCount:0,lastAttemptAt:closedAt,attemptDeadline:closedAt+30000,nextAttemptAt:closedAt,metadataRetainUntil:closedAt+86400000,dispatchedOutcomes:[{state:invalidated,retainUntil:invalidated.expiresAt}]};
    expect(()=>parseMemoryAccountErasing(closed,account,f.clock.now())).not.toThrow();expect(JSON.stringify(closed)).not.toContain('ER1_CLOSED_PAYLOAD_CANARY');writeFileSync(f.path(),JSON.stringify(closed),{mode:0o600});
    const before=directoryImage(f.directory);expect(()=>assertReleaseAdaptiveCompatibility({STUDIO_DATA_DIR:f.h.dir},ADAPTIVE_RELEASE_CAPABILITIES)).not.toThrow();expect(directoryImage(f.directory)).toEqual(before);
    expect(f.repository.memoryAccountStatus(account,f.clock.now).state).toBe('erasing');expect(()=>f.repository.captureMemoryAccountWork(account,f.clock.now)).toThrow();
    for(const bad of [{...closed,payload:'ER1_BAD_PAYLOAD'}, {...closed,dispatchedOutcomes:[{state:{...sending,contentEligible:false,invalidatedAtFenceSequence:4},retainUntil:sending.expiresAt}]}]){
      expect(()=>parseMemoryAccountErasing(bad,account,f.clock.now())).toThrow();writeFileSync(f.path(),JSON.stringify(bad),{mode:0o600});expect(()=>assertReleaseAdaptiveCompatibility({STUDIO_DATA_DIR:f.h.dir},ADAPTIVE_RELEASE_CAPABILITIES)).toThrow();
    }
  });
  it('locked confirmation t0 follows completed synchronous fresh-auth validation, never pre-auth or commit time',async()=>{
    const f=await setup();f.removeCanonical();let validated=0;
    const lifecycle=await f.repository.bootstrapMemoryAccount(account,{clock:f.clock.now,authorizeAtAcceptance:()=>{f.clock.advance(7000);validated=f.clock.now();},authorizeCommit:()=>{f.clock.advance(7000);}});
    expect(lifecycle.mode).toBe('fresh-confirmed');if(lifecycle.mode!=='fresh-confirmed')throw Error('unexpected mode');
    expect(lifecycle.confirmedAt).toBeGreaterThanOrEqual(validated);expect(lifecycle.confirmedAt).toBeLessThan(validated+1000);expect(lifecycle.sourceCutoffMs).toBe(memoryAccountCutoff(lifecycle.confirmedAt));expect(f.clock.now()).toBeGreaterThan(lifecycle.confirmedAt+6000);
  });
  it('one-millisecond UTC quantization permits one integer tick only and never a wall regression',async()=>{
    const f=await setup();let mono=performance.now()+10000,wall=f.clock.now()+10000;
    vi.spyOn(performance,'now').mockImplementation(()=>mono);observeMemoryAccountTime(f.directory,()=>wall);
    mono+=1.5;expect(()=>checkMemoryAccountTime(f.directory,()=>wall)).not.toThrow();
    mono+=0.5;expect(()=>checkMemoryAccountTime(f.directory,()=>wall)).toThrow();
    expect(()=>checkMemoryAccountTime(f.directory,()=>wall-1)).toThrow();wall+=1;expect(()=>checkMemoryAccountTime(f.directory,()=>wall)).not.toThrow();
  });
  it('successful read-only authority time cannot regress even above the durable high-water floor',async()=>{
    const f=await setup(),before=directoryImage(f.directory);f.clock.advance(1000);expect(checkMemoryAccountTime(f.directory,f.clock.now)).toBeGreaterThan(0);
    f.clock.advance(-500);expect(()=>checkMemoryAccountTime(f.directory,f.clock.now)).toThrow();expect(directoryImage(f.directory)).toEqual(before);
  });
  it('64 combined current-incarnation/source fences are read-only with zero model/POST work',async()=>{
    const f=await setup(),work=f.repository.captureMemoryAccountWork(account,f.clock.now,Math.floor((f.clock.now()-1000)/1000)),before=directoryImage(f.directory),durations:number[]=[];f.clearCalls();
    for(let i=0;i<64;i++){const start=performance.now();expect(f.repository.isMemoryAccountWorkCurrent(work,f.clock.now)).toBe(true);durations.push(performance.now()-start);}
    durations.sort((a,b)=>a-b);expect(directoryImage(f.directory)).toEqual(before);expect(f.h.chatLLM.replyRequests).toEqual([]);expect(f.calls).toEqual([]);
    console.info('ER1_COMBINED_SYNTHETIC_FENCE_DIAGNOSTIC',JSON.stringify({operations:64,definition:'isMemoryAccountWorkCurrent on captured original source: real owner, FILE reread, incarnation/parser, source and qualified clock fences',p50Ms:durations[31],p95Ms:durations[60],maxMs:durations[63],models:0,posts:0,isolatedAddedOverhead:'unavailable',providerLatency:'unavailable',providerCost:'unavailable'}));
  });
});
