import { describe, expect, it, vi } from 'vitest';
import type { Studio } from '../../studio/service';
import { signInitData } from '../../studio/auth';
import type { ConnectionsApplication } from '../application';
import { handleConnectionsRequest } from '../http';

const token = 'SYNTHETIC_PROXY_CONNECTIONS_TOKEN';
const publicOrigin = 'https://public.synthetic.invalid';
const internalOrigin = 'http://127.0.0.1:3107';
function fixture(webAppUrl: string | null = `${publicOrigin}/studio`) {
  const studio = { deps: { webAppUrl: webAppUrl ?? undefined, rateLimiter: { consume: vi.fn(async () => undefined) } },
    ensureMember: vi.fn(async () => ({ role: 'member' })) } as unknown as Studio;
  const enroll = vi.fn(async () => ({ schemaVersion: 1 }));
  const app = { enroll } as unknown as ConnectionsApplication;
  const invoke = (origin: string, more: Record<string, string> = {}) => handleConnectionsRequest(studio, app,
    new Request(`${internalOrigin}/api/studio/connections/enroll`, { method: 'POST', headers: {
      'x-telegram-init-data': signInitData({ id: 123, first_name: 'Synthetic' }, token),
      origin, 'content-type': 'application/json', ...more,
    }, body: JSON.stringify({ space: 'work', providerId: 'qa', displayLabel: 'Synthetic' }) }), ['enroll'], token);
  return { invoke, enroll };
}

describe('Connections public-origin mutation through an internal proxy', () => {
  it('accepts the configured public origin while the internal listener differs', async () => {
    const f = fixture();
    const response = await f.invoke(publicOrigin);
    expect(response.status).toBe(201);
    expect(f.enroll).toHaveBeenCalledWith({ accountId: 'telegram-account:123' },
      { space: 'work', providerId: 'qa', displayLabel: 'Synthetic' });
  });
  it.each([internalOrigin, 'https://hostile.synthetic.invalid', ''])('rejects untrusted origin %s', async origin => {
    const f = fixture();
    expect((await f.invoke(origin, { 'x-forwarded-host': 'public.synthetic.invalid', 'x-forwarded-proto': 'https' })).status).toBe(403);
    expect(f.enroll).not.toHaveBeenCalled();
  });
  it('denies a cross-site request even when the Origin matches', async () => {
    const f = fixture();
    expect((await f.invoke(publicOrigin, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(f.enroll).not.toHaveBeenCalled();
  });
  it('fails closed for an invalid configured public URL', async () => {
    const f = fixture('invalid');
    expect((await f.invoke(internalOrigin)).status).toBe(503);
    expect(f.enroll).not.toHaveBeenCalled();
  });
  it('retains exact-origin local fixtures when no public URL is configured', async () => {
    const f = fixture(null);
    const response = await f.invoke(internalOrigin);
    expect(response.status).toBe(201);
  });
});
