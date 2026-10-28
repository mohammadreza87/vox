/** Independent real FILE + signed manager request + actual registered interval
 * consumers. No network, managed first-publication, provider or device claim. */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {signInitData} from '../auth';
import {StudioMemoryAccount,memoryAccountOperationalHealth} from '../memory-account';
import {verifyMemoryAccountInitData} from '../memory-account-http';
import {StudioAssistantTextIntegration,parseAssistantTextKeys} from '../assistant-text-integration';
import {AssistantTextTransport} from '../../tireh/telegram/assistant-text-transport';
import {prepareAssistantText} from '../../tireh/delivery/assistant-text-protocol';
import {MEMORY_ACCOUNT_TIME} from '../../adaptive/memory-account-lifecycle';
import {runWithMemoryAccountWork} from '../../adaptive/memory-account-lifecycle';
import {accountIdFor} from '../../adaptive/persistence/repository';
import {qualifiedAccountFixture,MI1_MANAGER,type QualifiedAccountFixture} from './memory-account-qualified-fixture';
import {ID} from './helpers';
import {image} from '../../../../scripts/fixtures/memory-account-managed-fixture.mjs';
import {setFileRuntimeIoHooks,resetFileRuntimeIoHooks} from '../../../test/fro1-io-fixture';
vi.mock('../file-runtime-owner',async importOriginal=>{
  const actual=await importOriginal<typeof import('../file-runtime-owner')>();
  const {instrumentFileRuntime}=await import('../../../test/fro1-io-fixture');return instrumentFileRuntime(actual);
});
const fixtures:QualifiedAccountFixture[]=[];
async function setup(o:Parameters<typeof qualifiedAccountFixture>[0]={}){const f=await qualifiedAccountFixture(o);fixtures.push(f);return f;}
afterEach(()=>{resetFileRuntimeIoHooks();vi.restoreAllMocks();for(const f of fixtures.splice(0))f.close();});
async function issue(f:QualifiedAccountFixture){
  const preview=await f.request('preview',{body:{}});expect(preview.status).toBe(200);const p=await preview.json();
  const issued=await f.request('challenge',{body:{action:'fresh-bootstrap',previewDigest:p.previewDigest}});expect(issued.status).toBe(200);
  const c=await issued.json();return {action:'fresh-bootstrap',previewDigest:c.preview.previewDigest,nonce:c.nonce};
}
describe('MI1 conservative interval-aware manager authentication',()=>{
  it('actual owner Request uses Ed25519 and HMAC, has no model/delivery effect and reads current FILE',async()=>{
    const f=await setup(),before=image(f.f.directory),response=await f.request();
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'legacy-current',ready:false});
    expect(response.headers.get('cache-control')).toBe('no-store');expect(image(f.f.directory)).toEqual(before);
    expect(f.h.chatLLM.replyRequests).toEqual([]);expect(f.h.manager.sendMessage).not.toHaveBeenCalled();
  });
  it('fresh authentication is conservative against interval lower for future and upper for expiry',async()=>{
    const f=await setup(),at=Math.floor(f.account.now()/1000),signed=f.init(ID.alice,at),ms=at*1000;
    // Authentic signature alone does not select the optimistic endpoint.
    expect(verifyMemoryAccountInitData(f.studio,signed,MI1_MANAGER,ms-1999,{nowMs:ms-1999,utcLowerMs:ms-2001,utcUpperMs:ms-1999})).toBeNull();
    expect(verifyMemoryAccountInitData(f.studio,signed,MI1_MANAGER,ms-1999,{nowMs:ms-1999,utcLowerMs:ms-2000,utcUpperMs:ms-1999})?.id).toBe(ID.alice);
    expect(verifyMemoryAccountInitData(f.studio,signed,MI1_MANAGER,ms+299999,{nowMs:ms+299999,utcLowerMs:ms+299949,utcUpperMs:ms+299999})?.id).toBe(ID.alice);
    expect(verifyMemoryAccountInitData(f.studio,signed,MI1_MANAGER,ms+300000,{nowMs:ms+300000,utcLowerMs:ms+299950,utcUpperMs:ms+300000})).toBeNull();
  });
  it.each(['unsigned','expired','future','duplicate'] as const)('%s initData cannot reach protective account actions',async mode=>{
    const f=await setup(),now=Math.floor(f.account.now()/1000);let signed=f.init();
    if(mode==='unsigned')signed=signInitData({id:ID.alice,first_name:'MI1 QA'},MI1_MANAGER,now);
    if(mode==='expired')signed=f.init(ID.alice,now-301);if(mode==='future')signed=f.init(ID.alice,now+30);if(mode==='duplicate')signed+='&auth_date='+now;
    const before=image(f.f.directory);expect((await f.request('',{initData:signed})).status).toBe(401);expect(image(f.f.directory)).toEqual(before);
  });
  it('a forged/copy time capability does not construct an authenticated actual Studio service',async()=>{
    const f=await setup(),before=image(f.f.parent);
    expect(()=>new StudioMemoryAccount(f.studio,{time:{...f.permit}})).toThrow();
    expect(()=>new StudioMemoryAccount(f.studio,{time:f.permit,clock:Date.now})).toThrow();expect(image(f.f.parent)).toEqual(before);
  });
  it('explicit qualified bootstrap retains fresh zero-authority defaults and never imports legacy payloads',async()=>{
    const f=await setup(),old=f.document();f.remove();const confirmation=await issue(f),response=await f.request('confirm',{body:confirmation});
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'fresh-confirmed',ready:false});
    const d=f.document();expect(d.memoryLifecycle?.mode).toBe('fresh-confirmed');expect(d.memoryLifecycle?.incarnation).not.toBe(old.memoryLifecycle?.incarnation);
    expect(d.memories).toEqual([]);expect(d.agentGrants).toEqual([]);expect(d.binding).toBeUndefined();expect(d.declaration).toBeUndefined();
    expect(d.permissions.every(p=>p.state==='not_asked')).toBe(true);expect(d.assistantDeliveryControl).toBeUndefined();
    const bytes=f.raw();expect((await f.request('confirm',{body:confirmation})).status).toBe(503);expect(f.raw()).toBe(bytes);
  });
  it.each(['expiry','rotation','cancel'] as const)('%s during actual awaited canonical fsync refuses bootstrap with no fallback clock',async mode=>{
    const f=await setup({shortLease:true});f.remove();const confirmation=await issue(f);
    let enter!:()=>void,release!:()=>void,once=true;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});
    setFileRuntimeIoHooks({afterTemporarySync:async path=>{if(once&&path.startsWith(f.path()+'.')){once=false;enter();await gate;}}});
    const pending=f.request('confirm',{body:confirmation});await Promise.race([entered,pending.then(()=>{throw Error('actual temporary fsync not reached');})]);
    if(mode==='expiry')f.f.control.offsetMs+=5100;if(mode==='rotation')f.rotateManager();if(mode==='cancel')expect((await f.request('cancel',{body:{}})).status).toBe(200);
    release();expect((await pending).status).toBe(503);expect(()=>f.raw()).toThrow();expect(f.h.manager.sendMessage).not.toHaveBeenCalled();
  });
});
describe('MI1 real operational composition health without account scans or refresh',()=>{
  it('a real bound service is available from root/time/current manager only, with no account reads or provider refresh',async()=>{
    const f=await setup(),storage=f.repository.storage,reads=vi.spyOn(storage,'readCommittedForEffect').mockImplementation(()=>{throw Error('QA_NO_ACCOUNT_SCAN');}),
      status=vi.spyOn(f.repository,'memoryAccountStatus').mockImplementation(()=>{throw Error('QA_NO_ACCOUNT_SCAN');}),before=image(f.f.directory),calls=f.f.control.providerCalls;
    expect(memoryAccountOperationalHealth(f.studio)).toEqual({version:1,state:'available'});
    expect(reads).not.toHaveBeenCalled();expect(status).not.toHaveBeenCalled();expect(f.f.control.providerCalls).toBe(calls);expect(image(f.f.directory)).toEqual(before);
  });
  it('operational readiness does not claim a user, source, enrollment or ready account',async()=>{
    const f=await setup({seed:false}),before=image(f.f.directory);
    expect(memoryAccountOperationalHealth(f.studio)).toEqual({version:1,state:'available'});
    const response=await f.request('',{owner:777003});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'setup-required',ready:false});
    expect(image(f.f.directory)).toEqual(before);
  });
  it.each(['unmarked','partial','expired','drained','missing-manager','rotated-manager','scalar-only-service'] as const)('%s cannot present operational readiness',async mode=>{
    const f=await setup({marked:mode!=='unmarked',shortLease:mode==='expired'});
    if(mode==='partial')unlinkSync(join(f.f.directory,MEMORY_ACCOUNT_TIME));
    if(mode==='expired')f.f.control.offsetMs+=5100;if(mode==='drained')f.f.owner.beginDrain();
    if(mode==='missing-manager')f.studio.deps.managerBot=null;if(mode==='rotated-manager')f.rotateManager();
    if(mode==='scalar-only-service')f.studio.deps.memoryAccount=new StudioMemoryAccount(f.studio,{clock:f.clock1});
    const before=image(f.f.directory),calls=f.f.control.providerCalls;
    expect(memoryAccountOperationalHealth(f.studio)).toEqual({version:1,state:'unavailable'});expect(image(f.f.directory)).toEqual(before);expect(f.f.control.providerCalls).toBe(calls);
  });
  it('a malformed clock file stays untouched and does not disclose its contents',async()=>{
    const f=await setup();writeFileSync(join(f.f.directory,MEMORY_ACCOUNT_TIME),'PRIVATE_MI1_TIME_CANARY\n',{mode:0o600});const before=image(f.f.directory);
    expect(memoryAccountOperationalHealth(f.studio)).toEqual({version:1,state:'unavailable'});expect(image(f.f.directory)).toEqual(before);
  });
  it('a capability for another genuine root cannot be rebound by copying the service options',async()=>{
    const a=await setup(),b=await setup();expect(()=>new StudioMemoryAccount(a.studio,{time:b.permit,managerToken:()=>MI1_MANAGER})).toThrow();
    a.studio.deps.memoryAccount=b.account;expect(memoryAccountOperationalHealth(a.studio)).toEqual({version:1,state:'unavailable'});
  });
});

describe('MI1 qualified ATI clock consumers with a deliberately different host clock',()=>{
  function displacedHost(){const original=Date.now.bind(Date);vi.spyOn(Date,'now').mockImplementation(()=>original()+90*86400000);}
  function text(f:QualifiedAccountFixture){
    const now=f.clock2(),expiresAt=now+1000;
    return prepareAssistantText({scope:{accountId:accountIdFor(ID.alice),personId:f.document().personId,agentId:'mi1-qa-agent',space:'work',containerId:'mi1-private',kind:'private'},
      binding:{botId:79001,destinationChatId:ID.alice,endpointBindingId:'mi1-qa-endpoint',credentialBindingId:'mi1-qa-credential',bindingRevision:'mi1-qa-binding'},
      source:{messageId:11,updateId:29,revision:0,occurredAt:now-1000,acceptedAt:now},
      authority:{authorityRevision:'mi1-current-authority',grantRevision:'mi1-current-grant',sourceFenceRevision:'mi1-current-fence',sourceFenceSequence:0,historyEpoch:0,deletionEpoch:0,expiresAt},
      generationId:'11111111-1111-4111-8111-111111111111',attemptId:'22222222-2222-4222-8222-222222222222',
      generatedText:'MI1_SYNTHETIC_REPLY',decoratedText:'MI1_SYNTHETIC_REPLY',keyId:'mi1-qa-key',evidenceKey:new Uint8Array(32).fill(91),now,expiresAt});
  }
  it('retired key notAfter uses the captured registered clock rather than the later host UTC',async()=>{
    displacedHost();const f=await setup(),now=f.clock2(),raw=JSON.stringify({currentKeyId:'current',keys:[{keyId:'current',keyBase64:Buffer.alloc(32,1).toString('base64')},
      {keyId:'retired',keyBase64:Buffer.alloc(32,2).toString('base64'),notAfter:now+1000}]}),keys=parseAssistantTextKeys(raw,now,f.clock2)!;
    expect(Date.now()).toBeGreaterThan(now+1000);expect(keys.resolve('retired')).toEqual(new Uint8Array(32).fill(2));
    f.f.control.offsetMs+=1001;expect(keys.resolve('retired')).toBeUndefined();expect(keys.current().keyId).toBe('current');
  });
  it('actual control preflight rejects a source future to qualified time even when host UTC would accept it',async()=>{
    displacedHost();const f=await setup(),integration=new StudioAssistantTextIntegration(f.studio,{enabled:()=>true,now:f.clock2}),
      ingress={botId:79001,chatId:ID.alice,fromId:ID.alice,isBot:false as const,chatType:'private' as const,kind:'initial-text' as const,messageId:11,updateId:29,dateSeconds:Math.floor(f.clock2()/1000)+30};
    expect(Date.now()).toBeGreaterThan(ingress.dateSeconds*1000);
    const work=f.repository.captureMemoryAccountWork(accountIdFor(ID.alice),f.clock1),before=f.raw();
    expect(()=>runWithMemoryAccountWork(work,()=>integration.control.preflightSource(ID.alice,ingress))).toThrow();expect(f.raw()).toBe(before);
  });
  it('actual single-attempt transport timestamps an accepted fake response with qualified time despite later host UTC',async()=>{
    displacedHost();const f=await setup(),prepared=text(f),fetchFn=vi.fn(async()=>Response.json({ok:true,result:{message_id:91001,date:Math.floor(f.clock2()/1000),from:{id:79001,is_bot:true},chat:{id:ID.alice,type:'private'},text:prepared.submittedText}}));
    expect(Date.now()).toBeGreaterThan(prepared.initialState.expiresAt);
    const result=await new AssistantTextTransport(fetchFn,f.clock2).send({token:'79001:MI1_SYNTHETIC_TOKEN_TEST_ONLY',prepared,authorizeNow:()=>true,ownerSignal:f.f.owner.signal,ownerActive:()=>f.f.owner.assertActive()});
    expect(fetchFn).toHaveBeenCalledOnce();expect(result.kind).toBe('response');
    if(result.kind!=='response')throw Error('qualified transport unexpectedly unavailable');
    expect(result.evidence.observedAt).toBeLessThan(prepared.initialState.expiresAt);expect(result.evidence.observedAt).toBeLessThan(Date.now());
  });
  it.each(['before-fetch','after-fetch'] as const)('qualified deadline crossing %s never retries or invents unsent certainty',async point=>{
    displacedHost();const f=await setup(),prepared=text(f),fetchFn=vi.fn(async()=>{f.f.control.offsetMs+=1100;return Response.json({ok:true,result:{message_id:91001}});});
    const result=await new AssistantTextTransport(fetchFn,f.clock2).send({token:'79001:MI1_SYNTHETIC_TOKEN_TEST_ONLY',prepared,
      authorizeNow:()=>{if(point==='before-fetch')f.f.control.offsetMs+=1100;return true;},ownerSignal:f.f.owner.signal,ownerActive:()=>f.f.owner.assertActive()});
    expect(result).toEqual({kind:'unknown',reason:'transport_error'});expect(fetchFn).toHaveBeenCalledTimes(point==='before-fetch'?0:1);
  });
});
