import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentConnectionsApi } from './agent-connections-client';
const app = { initData: 'SYNTHETIC_SIGNED_ALPHA' };
vi.mock('./client', async importOriginal => ({ ...await importOriginal<typeof import('./client')>(), tg: () => app }));
afterEach(() => { vi.unstubAllGlobals(); app.initData = 'SYNTHETIC_SIGNED_ALPHA'; });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
describe('immutable bot Connections browser client', () => {
  it('uses the exact bot route with its signed session, and offers only the content-free handoff read', async () => {
    const fetch = vi.fn(async () => json({})); vi.stubGlobal('fetch', fetch);
    const api = createAgentConnectionsApi('alpha', app.initData);
    await api.read(); expect(fetch.mock.calls[0][0]).toBe('/api/agents/alpha/connections');
    const read = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(read[1]).toMatchObject({ method: 'GET', headers: { 'X-Telegram-Init-Data': 'SYNTHETIC_SIGNED_ALPHA' } });
    expect(Object.keys(api)).toEqual(['read']);
  });
  it('discards a response after Telegram switches signed accounts', async () => {
    let finish!: (response: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = createAgentConnectionsApi('alpha', app.initData).read();
    app.initData = 'SYNTHETIC_OTHER_PERSON'; finish(json({ private: 'SYNTHETIC_PRIVATE' }));
    await expect(pending).rejects.toMatchObject({ status: 401, message: 'authentication_required' });
  });
  it('does not start a request under an aborted or changed session', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const controller = new AbortController();
    const api = createAgentConnectionsApi('alpha', app.initData, controller.signal); controller.abort();
    await expect(api.read()).rejects.toMatchObject({ status: 401 }); expect(fetch).not.toHaveBeenCalled();
    await expect(createAgentConnectionsApi('alpha', 'WRONG_SIGNED_SESSION').read()).rejects.toMatchObject({ status: 401 }); expect(fetch).not.toHaveBeenCalled();
  });
  it('never treats an HTML fallback or an opaque code as connected account state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>wrong page</html>', { headers: { 'content-type': 'text/html' } })));
    await expect(createAgentConnectionsApi('alpha', app.initData).read()).rejects.toMatchObject({ status: 503 });
  });
});
