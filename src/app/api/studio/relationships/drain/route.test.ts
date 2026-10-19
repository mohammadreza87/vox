import { afterEach, describe, expect, it, vi } from 'vitest';
const getStudio = vi.hoisted(() => vi.fn());
vi.mock('@/lib/studio/runtime', () => ({ getStudio }));
import { POST } from './route';
const secret = 'synthetic-worker-secret-at-least-32-characters';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('authenticated relationship worker', () => {
  it('rejects unauthorized calls before initializing the runtime', async () => {
    vi.stubEnv('STUDIO_RELATIONSHIP_WORKER_SECRET', secret);
    expect((await POST(new Request('http://localhost/api/studio/relationships/drain', { method: 'POST' }))).status).toBe(401);
    expect(getStudio).not.toHaveBeenCalled();
  });
  it('rejects oversized or unbounded authorized work before initialization', async () => {
    vi.stubEnv('STUDIO_RELATIONSHIP_WORKER_SECRET', secret);
    for (const body of ['{"limit":5000}', 'x'.repeat(1025), '{"limit":1,"text":"private"}']) {
      expect((await POST(new Request('http://localhost/api/studio/relationships/drain', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body }))).status).toBe(400);
    }
    expect(getStudio).not.toHaveBeenCalled();
  });
  it('runs a bounded authenticated drain and exposes no runtime error details', async () => {
    vi.stubEnv('STUDIO_RELATIONSHIP_WORKER_SECRET', secret);
    const drain = vi.fn(async () => ({ sent: 1 }));
    getStudio.mockResolvedValue({ drainRelationships: drain, deps: {
      relationships: { mode: 'live' }, relationshipConfig: { roles: ['owner', 'superadmin'], agentIds: ['*'], personIds: [] },
    } });
    const request = () => new Request('http://localhost/api/studio/relationships/drain', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{"limit":1}' });
    expect(await (await POST(request())).json()).toEqual({ result: { sent: 1 }, configuration: {
      mode: 'live', roles: ['owner', 'superadmin'], allAgents: true, explicitAgentCount: 0, explicitPersonCount: 0,
    } });
    expect(drain).toHaveBeenCalledWith(1);
    getStudio.mockRejectedValue(new Error('secret-private-runtime-detail'));
    const failed = await POST(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('secret-private');
  });
});
