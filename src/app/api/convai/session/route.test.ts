import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedRequest, createMockRequest, parseResponse } from '@/test/utils';

const auth = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: auth.verifyIdToken,
  extractBearerToken: (header: string | null) => /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? null,
}));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: log }));

const { POST } = await import('./route');
const context = { params: Promise.resolve({}) };
const CONTACT_CANARY = 'SYNTHETIC_CONTACT_NAME_CANARY';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ELEVENLABS_AGENT_ID', 'synthetic-agent');
  vi.stubEnv('ELEVENLABS_API_KEY', 'synthetic-key');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(Response.json({ signed_url: 'wss://synthetic.invalid/session' }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('POST /api/convai/session (legacy /app calls)', () => {
  it('refuses a caller without a Firebase ID token before reaching ElevenLabs', async () => {
    const response = await POST(createMockRequest('POST', '/api/convai/session', { body: { contactName: 'A', voiceId: 'v' } }), context);
    expect(response.status).toBe(401);
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an invalid ID token before reaching ElevenLabs', async () => {
    auth.verifyIdToken.mockResolvedValue(null);
    const response = await POST(createAuthenticatedRequest('POST', '/api/convai/session', { body: { contactName: 'A', voiceId: 'v' } }), context);
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('issues a signed URL to a signed-in user without logging what they sent', async () => {
    auth.verifyIdToken.mockResolvedValue({ uid: 'synthetic-user' });
    const response = await POST(createAuthenticatedRequest('POST', '/api/convai/session', { body: { contactName: CONTACT_CANARY, voiceId: 'v' } }), context);
    const { status, data } = await parseResponse<{ signedUrl: string }>(response as never);
    expect(status).toBe(200);
    expect(data.signedUrl).toBe('wss://synthetic.invalid/session');
    expect(fetchMock).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=synthetic-agent', expect.anything());
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logged).not.toContain(CONTACT_CANARY);
    expect(logged).not.toContain('wss://synthetic.invalid/session');
  });

  it('rejects a malformed body from a signed-in user', async () => {
    auth.verifyIdToken.mockResolvedValue({ uid: 'synthetic-user' });
    const response = await POST(createAuthenticatedRequest('POST', '/api/convai/session', { body: { contactName: '', voiceId: 7 } }), context);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
