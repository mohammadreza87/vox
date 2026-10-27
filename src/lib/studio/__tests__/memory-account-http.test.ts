/** Independent actual manager HTTP/auth + canonical FILE bootstrap. No provider or live auth. */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {signInitData} from '../auth';
import {StudioMemoryAccount} from '../memory-account';
import {resetFileRuntimeIoHooks} from '../../../test/fro1-io-fixture';
import {memoryAccountFixture,directoryImage,holdNextCanonicalSync,MEMORY_MANAGER,type MemoryAccountFixture} from './memory-account-fixture';
import {ID} from './helpers';
vi.mock('../file-runtime-owner',async importOriginal=>{
  const actual=await importOriginal<typeof import('../file-runtime-owner')>();
  const {instrumentFileRuntime}=await import('../../../test/fro1-io-fixture');return instrumentFileRuntime(actual);
});
const fixtures:MemoryAccountFixture[]=[];
async function setup(o:Parameters<typeof memoryAccountFixture>[0]={}){const f=await memoryAccountFixture(o);fixtures.push(f);return f;}
afterEach(async()=>{resetFileRuntimeIoHooks();vi.restoreAllMocks();for(const f of fixtures.splice(0))await f.closeOwned();});
const body=(c:{nonce:string;preview:{previewDigest:string}})=>({action:'fresh-bootstrap',nonce:c.nonce,previewDigest:c.preview.previewDigest});
describe('ER1 independent actual protective manager Request/Response',()=>{
  it('outsider status/preview creates neither a member nor canonical account and exposes no payload',async()=>{
    const f=await setup(),before=directoryImage(f.directory),members=(await f.h.store.read()).members.length;
    const res=await f.request('',{owner:777003});expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({state:'setup-required',ready:false});expect((await f.h.store.read()).members).toHaveLength(members);
    expect(directoryImage(f.directory)).toEqual(before);expect((await f.request('preview',{owner:777003,body:{}})).status).toBe(200);expect(directoryImage(f.directory)).toEqual(before);
  });
  it.each(['missing-signature','wrong-signer','expired','future','duplicated-auth-date'] as const)('strict %s manager evidence refuses without account/challenge persistence',async mode=>{
    const f=await setup(),now=Math.floor(f.clock.now()/1000);let signed=f.init();
    if(mode==='missing-signature')signed=signInitData({id:ID.alice,first_name:'QA'},MEMORY_MANAGER,now);
    if(mode==='wrong-signer')signed=signInitData({id:ID.alice,first_name:'QA'},'810001:WRONG_SYNTHETIC_TOKEN',now);
    if(mode==='expired')signed=f.init(ID.alice,now-301);if(mode==='future')signed=f.init(ID.alice,now+30);
    if(mode==='duplicated-auth-date')signed+='&auth_date='+now;
    const before=directoryImage(f.directory),response=await f.request('',{initData:signed});expect(response.status).toBe(401);expect(directoryImage(f.directory)).toEqual(before);
  });
  it.each(['ownerId','path','payload'] as const)('closed preview schema rejects caller-selected %s',async field=>{
    const f=await setup();f.removeCanonical();const before=directoryImage(f.directory);
    expect((await f.request('preview',{body:{[field]:'QA_PRIVATE_BODY_CANARY'}})).status).toBe(400);expect(directoryImage(f.directory)).toEqual(before);
    expect(JSON.stringify(f.h.logger.warn.mock.calls)).not.toContain('QA_PRIVATE_BODY_CANARY');
  });
  it('origin, content-type and malformed JSON refuse before creation',async()=>{
    const f=await setup();f.removeCanonical();const before=directoryImage(f.directory);
    expect((await f.request('preview',{body:{},headers:{origin:'https://wrong.example'}})).status).toBe(403);
    expect((await f.request('preview',{body:{},headers:{'content-type':'text/plain'}})).status).toBe(415);
    expect((await f.request('preview',{raw:'{broken'})).status).toBe(400);expect(directoryImage(f.directory)).toEqual(before);
  });
  it('explicit challenge/confirm creates exactly one fresh account with no automatic reply/readiness',async()=>{
    const f=await setup();f.removeCanonical();const c=await f.challenge(),response=await f.request('confirm',{body:body(c)});
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'fresh-confirmed',ready:false});const after=f.raw();
    expect((await f.request('confirm',{body:body(c)})).status).toBe(503);expect(f.raw()).toBe(after);expect(f.calls.filter(x=>x.method.startsWith('send'))).toEqual([]);
    expect(f.h.chatLLM.replyRequests).toEqual([]);expect(JSON.stringify(f.h.logger.warn.mock.calls)).not.toContain(c.nonce);expect(after).not.toContain(c.nonce);
  });
  it('concurrent same challenge confirmations commit once, with actual expected-absence CAS',async()=>{
    const f=await setup();f.removeCanonical();const c=await f.challenge();const responses=await Promise.all([f.request('confirm',{body:body(c)}),f.request('confirm',{body:body(c)})]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,503]);expect(JSON.parse(f.raw()).memoryLifecycle.revision).toBe(1);
  });
  it('nonce/session/owner mismatch and a replaced challenge cannot create the target account',async()=>{
    const f=await setup();f.removeCanonical();f.removeCanonical(ID.bob);const c=await f.challenge();
    expect((await f.request('confirm',{owner:ID.bob,body:body(c)})).status).toBe(503);
    expect((await f.request('confirm',{initData:f.init(ID.alice,undefined,{query_id:'different-session'}),body:body(c)})).status).toBe(503);
    const next=await f.challenge();expect((await f.request('confirm',{body:body(c)})).status).toBe(503);expect((await f.request('confirm',{body:body(next)})).status).toBe(200);
  });
  it.each(['expiry','cancel','drain','credential-rotation','request-abort'] as const)('%s after fsync cannot consume a stale confirmation and create the file',async mode=>{
    const f=await setup();f.removeCanonical();const c=await f.challenge(),hold=holdNextCanonicalSync(f),abort=new AbortController();
    const pending=f.request('confirm',{body:body(c),signal:abort.signal});await Promise.race([hold.entered,pending.then(()=>{throw Error('No actual fsync hold reached');})]);
    if(mode==='expiry')f.clock.advance(121000);if(mode==='cancel')await f.request('cancel',{body:{}});if(mode==='drain')f.fileOwner!.beginDrain();if(mode==='credential-rotation')f.rotateManager();if(mode==='request-abort')abort.abort();
    hold.release();expect((await pending).status).toBe(503);expect(directoryImage(f.directory).some(x=>x.path.endsWith('.json')&&x.path===f.path().split('/').at(-1))).toBe(false);
  });
  it('post-rename result loss leaves one account and one-use intent; status reconciles without replay',async()=>{
    const f=await setup();f.removeCanonical();const c=await f.challenge();
    const original=f.repository.bootstrapMemoryAccount.bind(f.repository);
    vi.spyOn(f.repository,'bootstrapMemoryAccount').mockImplementation(async(...args)=>{await original(...args);throw Error('QA_RESULT_LOST_AFTER_REAL_COMMIT');});
    expect((await f.request('confirm',{body:body(c)})).status).toBe(503);const bytes=f.raw();
    expect((await f.request('')).status).toBe(200);expect(await (await f.request('')).json()).toMatchObject({state:'fresh-confirmed',ready:false});
    expect((await f.request('confirm',{body:body(c)})).status).toBe(503);expect(f.raw()).toBe(bytes);
  });
  it('challenge capacity is globally bounded without evicting other owners; restart loses old intents',async()=>{
    const f=await setup();f.removeCanonical();const first=f.session(),preview=f.account.preview(first),issued=f.account.challenge(first,preview.previewDigest);
    for(let i=1;i<128;i++){const s=f.session(880000+i),p=f.account.preview(s);f.account.challenge(s,p.previewDigest);}
    const next=f.session(999111);expect(()=>f.account.challenge(next,f.account.preview(next).previewDigest)).toThrow();
    expect(f.account.status(first).pending?.expiresAt).toBe(issued.expiresAt);
    f.fileOwner!.beginDrain();expect(()=>new StudioMemoryAccount(f.h.studio,{clock:f.clock.now}).preview(first)).toThrow();
  });
  it('qualified clock absent refuses API without marker, member, account or secret changes',async()=>{
    const f=await setup({marked:false,qualifiedClock:false}),before=directoryImage(f.h.dir),members=(await f.h.store.read()).members.length;
    expect((await f.request('')).status).toBe(503);expect(directoryImage(f.h.dir)).toEqual(before);expect((await f.h.store.read()).members).toHaveLength(members);
  });
  it('existing account or closed record cannot be overwritten by a bootstrap preview',async()=>{
    const f=await setup(),before=f.raw();expect((await f.request('preview',{body:{}})).status).toBe(503);expect(f.raw()).toBe(before);
    const image=JSON.parse(readFileSync(f.path(),'utf8'));image.memoryLifecycle.incarnation='f'.repeat(64);writeFileSync(f.path(),JSON.stringify(image),{mode:0o600});
    expect((await f.request('preview',{body:{}})).status).toBe(503);expect(JSON.parse(readFileSync(join(f.directory,f.path().split('/').at(-1)!), 'utf8')).memoryLifecycle.incarnation).toBe('f'.repeat(64));
  });
});
