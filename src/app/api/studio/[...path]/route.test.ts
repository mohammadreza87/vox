import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getStudio, read, router } = vi.hoisted(() => ({ getStudio: vi.fn(), read: vi.fn(), router: vi.fn() }));
vi.mock('@/lib/studio/runtime', () => ({ getStudio }));
vi.mock('@/lib/studio/http', () => ({ handleStudioRequest: router }));
import { GET } from './route';

const state = globalThis as unknown as { __voxBots?: boolean };
const health = () => GET(new Request('http://localhost/api/studio/health'), { params: Promise.resolve({ path: ['health'] }) });

beforeEach(() => {
  vi.clearAllMocks();
  getStudio.mockResolvedValue({ deps: { store: { read } } });
  read.mockResolvedValue({});
  vi.stubEnv('STUDIO_BOTS', '1');
  vi.stubEnv('STUDIO_REVISION', 'tested-revision');
  state.__voxBots = true;
});
afterEach(() => { vi.unstubAllEnvs(); delete state.__voxBots; });

describe('Studio production readiness', () => {
  it('reports the deployed revision without authenticating or creating a member', async () => {
    const result = await health();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'healthy', bots: true, revision: 'tested-revision' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(router).not.toHaveBeenCalled();
  });

  it('fails readiness when the bot runner has not started', async () => {
    state.__voxBots = false;
    expect((await health()).status).toBe(503);
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
