import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../../studio/auth';
import type { Studio } from '../../studio/service';
import type { ConnectionsApplication } from '../application';
import { handleConnectionsRequest } from '../http';

const BOT_TOKEN = 'SYNTHETIC_QA_BOT_TOKEN';
const ORIGIN = 'https://vox-qa.example.invalid';
function fixture() {
  const ensureMember = vi.fn(async () => ({ telegramId: 1001, role: 'member', firstName: 'QA' }));
  const studio = { deps: { rateLimiter: { consume: vi.fn(async () => undefined) } }, ensureMember } as unknown as Studio;
  const app = { dashboard: vi.fn(async () => ({ schemaVersion: 1 })), resources: vi.fn(async () => []),
    beginSetup: vi.fn(async () => ({})), claimSetup: vi.fn(async () => ({})), cancelSetup: vi.fn(async () => ({})),
    execute: vi.fn(async () => ({})), service: { enroll: vi.fn(async () => ({})), grant: vi.fn(async () => ({})),
      revoke: vi.fn(async () => ({})), approve: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})),
      preview: vi.fn(async () => ({ receipt: {} })) } } as unknown as ConnectionsApplication;
  const signed = signInitData({ id: 1001, first_name: 'QA' }, BOT_TOKEN);
  const request = (path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; unsigned?: boolean } = {}) => {
    const headers = { ...(options.unsigned ? {} : { 'x-telegram-init-data': signed }),
      ...(options.method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}), ...options.headers };
    return new Request(`${ORIGIN}/api/studio/connections/${path}`, { method: options.method ?? 'GET', headers,
      ...(options.body === undefined ? {} : { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) }) });
  };
  const invoke = (path: string[], req: Request) => handleConnectionsRequest(studio, app, req, path, BOT_TOKEN);
  return { studio, app, ensureMember, signed, request, invoke };
}

describe('independent Connections authenticated API boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects unsigned, forged and expired identities before reaching account/provider code', async () => {
    const f = fixture();
    const signatures = ['', signInitData({ id: 9999, first_name: 'Forged' }, 'WRONG_QA_KEY'),
      signInitData({ id: 1001, first_name: 'Expired' }, BOT_TOKEN, Math.floor(Date.now() / 1000) - 90_000)];
    for (const init of signatures) {
      const response = await f.invoke([], f.request('', { headers: { 'x-telegram-init-data': init } }));
      expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(f.ensureMember).not.toHaveBeenCalled(); expect(f.app.dashboard).not.toHaveBeenCalled();
  });

  it('derives the actor from verified Telegram data even when the URL claims another account', async () => {
    const f = fixture(); const response = await f.invoke([], f.request('?accountId=telegram-account:9999&personId=person:bob&role=owner'));
    expect(response.status).toBe(200);
    expect(f.app.dashboard).toHaveBeenCalledExactlyOnceWith({ accountId: 'telegram-account:1001' }, 'work');
  });

  it('pending Studio membership never reaches Connections even with a valid signature', async () => {
    const f = fixture(); f.ensureMember.mockResolvedValueOnce({ telegramId: 1001, role: 'pending', firstName: 'QA' });
    const response = await f.invoke([], f.request(''));
    expect(response.status).toBe(403); expect(f.app.dashboard).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://attacker.example.invalid' },
    { origin: '', 'sec-fetch-site': 'same-origin' },
    { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
  ])('rejects cross-origin mutations before service actions: %j', async headers => {
    const f = fixture(); const response = await f.invoke(['enroll'], f.request('enroll', { method: 'POST', body: {}, headers }));
    expect(response.status).toBe(403); expect(f.app.service.enroll).not.toHaveBeenCalled();
  });

  it('requires JSON and bounds actual body bytes before enrollment', async () => {
    const f = fixture();
    const wrongType = await f.invoke(['enroll'], f.request('enroll', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }));
    expect(wrongType.status).toBe(415);
    const oversized = await f.invoke(['enroll'], f.request('enroll', { method: 'POST', body: JSON.stringify({ displayLabel: 'x'.repeat(70_000) }) }));
    expect(oversized.status).toBe(413); expect(f.app.service.enroll).not.toHaveBeenCalled();
  });

  it.each(['completeEnrollment', 'complete-enrollment', 'actions/propose', 'operations/claim', 'operations/markDispatched', 'vault'])
    ('keeps broker-only authority unavailable on the wire at %s', async route => {
      const f = fixture();
      const response = await f.invoke(route.split('/'), f.request(route, { method: 'POST', body: { accountId: 'telegram-account:9999', sourceIds: [] } }));
      expect(response.status).toBe(404); expect(f.app.execute).not.toHaveBeenCalled(); expect(f.app.service.enroll).not.toHaveBeenCalled();
    });

  it('requires a positive preview revision and forwards only server-verified actor plus exact operation ID', async () => {
    const f = fixture();
    const invalid = await f.invoke(['review', 'qa-operation'], f.request('review/qa-operation?revision=0'));
    expect(invalid.status).toBe(400); expect(f.app.service.preview).not.toHaveBeenCalled();
    const missing = await f.invoke(['review', 'qa-operation'], f.request('review/qa-operation'));
    expect(missing.status).toBe(400);
    const valid = await f.invoke(['review', 'qa-operation'], f.request('review/qa-operation?revision=7&space=personal&accountId=forged'));
    expect(valid.status).toBe(200);
    expect(f.app.service.preview).toHaveBeenCalledExactlyOnceWith({ accountId: 'telegram-account:1001' },
      { space: 'personal', operationId: 'qa-operation', expectedRevision: 7 });
  });
});
