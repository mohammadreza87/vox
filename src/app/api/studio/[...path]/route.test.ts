import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getStudio, read, router } = vi.hoisted(() => ({ getStudio: vi.fn(), read: vi.fn(), router: vi.fn() }));
vi.mock('@/lib/studio/runtime', () => ({ getStudio }));
vi.mock('@/lib/studio/http', () => ({ handleStudioRequest: router }));
import { GET } from './route';
import {qualifiedAccountFixture,type QualifiedAccountFixture} from '@/lib/studio/__tests__/memory-account-qualified-fixture';

const state = globalThis as unknown as { __voxBots?: boolean };
const health = () => GET(new Request('http://localhost/api/studio/health'), { params: Promise.resolve({ path: ['health'] }) });
const memoryHealth = (value='1') => GET(new Request('http://localhost/api/studio/health',{headers:{'x-vox-memory-account-readiness':value}}), { params: Promise.resolve({ path: ['health'] }) });
const memoryFixtures:QualifiedAccountFixture[]=[];
async function memoryFixture(marked=true){const f=await qualifiedAccountFixture({marked,seed:false});memoryFixtures.push(f);getStudio.mockResolvedValue(f.studio);return f;}

beforeEach(() => {
  vi.clearAllMocks();
  getStudio.mockResolvedValue({ deps: { store: { read } } });
  read.mockResolvedValue({});
  vi.stubEnv('STUDIO_BOTS', '1');
  vi.stubEnv('STUDIO_REVISION', 'tested-revision');
  state.__voxBots = true;
});
afterEach(() => { vi.unstubAllEnvs(); delete state.__voxBots; });
afterEach(()=>{for(const f of memoryFixtures.splice(0))f.close();});

describe('Studio production readiness', () => {
  it('reports the deployed revision without authenticating or creating a member', async () => {
    const result = await health();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'healthy', bots: true, revision: 'tested-revision', transport: 'polling' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(router).not.toHaveBeenCalled();
  });

  it('fails readiness when the bot runner has not started', async () => {
    state.__voxBots = false;
    expect((await health()).status).toBe(503);
  });

  it('supports webhook readiness without a polling process', async () => {
    state.__voxBots = false;
    getStudio.mockResolvedValueOnce({ deps: { store: { read }, managerBot: {}, webhookBase: 'https://studio.example.com' } });
    const result = await health();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ transport: 'webhook', bots: true, revision: 'tested-revision' });
  });

  it('fails readiness if persistent storage cannot be read', async () => {
    read.mockRejectedValueOnce(new Error('private filesystem details'));
    const result = await health();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private filesystem details');
  });

  it('fails readiness when runtime initialization fails', async () => {
    getStudio.mockRejectedValueOnce(new Error('Missing configuration'));
    expect((await health()).status).toBe(503);
  });

  it('never publishes initialization details in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    getStudio.mockRejectedValueOnce(new Error('private filesystem details'));
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private filesystem details');
  });
});

describe('MI1 explicit operational memory readiness route',()=>{
  it('ordinary health retains the exact existing response even when the unmarked memory capability is unavailable',async()=>{
    await memoryFixture(false);const response=await health();expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status:'healthy',bots:true,revision:'tested-revision',transport:'polling'});
    expect(response.headers.get('cache-control')).toBe('no-store');expect(router).not.toHaveBeenCalled();
  });
  it('only the exact explicit header asks for the additive capability',async()=>{
    await memoryFixture(false);const response=await memoryHealth('true');expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status:'healthy',bots:true,revision:'tested-revision',transport:'polling'});
  });
  it('a real registered root/time/current-manager composition is available without an account or provider refresh',async()=>{
    const f=await memoryFixture(),calls=f.f.control.providerCalls;
    const accountRead=vi.spyOn(f.repository,'memoryAccountStatus').mockImplementation(()=>{throw Error('QA_NO_ACCOUNT_SCAN');});
    const response=await memoryHealth();expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status:'healthy',bots:true,revision:'tested-revision',transport:'polling',memoryAccount:{version:1,state:'available'}});
    expect(accountRead).not.toHaveBeenCalled();expect(f.f.control.providerCalls).toBe(calls);expect(router).not.toHaveBeenCalled();
  });
  it('a valid unmarked root is explicitly unavailable rather than ordinary healthy memory readiness',async()=>{
    await memoryFixture(false);const response=await memoryHealth();expect(response.status).toBe(503);
    expect(await response.json()).toEqual({status:'unhealthy',bots:true,revision:'tested-revision',transport:'polling',memoryAccount:{version:1,state:'unavailable'}});
  });
  it('a metadata-only service without real composition cannot fake an available capability',async()=>{
    getStudio.mockResolvedValue({deps:{store:{read},memoryAccount:{now:()=>1,options:{time:{sampleNow:()=>1}}}}});
    const response=await memoryHealth();expect(response.status).toBe(503);expect(await response.json()).toMatchObject({memoryAccount:{version:1,state:'unavailable'}});
  });
  it('actual owner drain makes requested health unavailable and exposes no authority details',async()=>{
    const f=await memoryFixture();f.f.owner.beginDrain();const response=await memoryHealth();expect(response.status).toBe(503);
    expect(await response.json()).toEqual({status:'unhealthy',memoryAccount:{version:1,state:'unavailable'}});
  });
  it.each(['initialization','store'] as const)('%s failure retains the fixed requested unavailable result',async failure=>{
    if(failure==='initialization')getStudio.mockRejectedValueOnce(Error('MI1_PRIVATE_PATH_KEY_POLICY_CANARY'));
    else read.mockRejectedValueOnce(Error('MI1_PRIVATE_PATH_KEY_POLICY_CANARY'));
    const response=await memoryHealth();expect(response.status).toBe(503);
    expect(await response.json()).toEqual({status:'unhealthy',memoryAccount:{version:1,state:'unavailable'}});expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
