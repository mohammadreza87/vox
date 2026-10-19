import { randomBytes } from 'node:crypto';
import { BrokerAuthenticator, signBrokerRequest } from './lib/connections/broker/auth';
import { POST as brokerControlPost } from './app/api/connections/broker/route';
import { handleStudioBrokerControl } from './lib/connections/runtime';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, middleware } from './middleware';

vi.mock('@/lib/studio/runtime', () => ({ getStudio: vi.fn(async () => ({})) }));
vi.mock('@/lib/connections/runtime', () => ({ handleStudioBrokerControl: vi.fn() }));

const request = (path: string) => new NextRequest(`https://studio.example.com${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('STUDIO_ONLY', '1'); vi.stubEnv('STUDIO_WEBAPP_URL', '');
  vi.stubEnv('STUDIO_CONNECTIONS_CONFIG_FILE', ''); vi.stubEnv('STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', ''); vi.stubEnv('STUDIO_CONNECTIONS_BROKER_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('Studio production routes', () => {
  it('redirects the entry point to Studio and retains launch query parameters', () => {
    const response = middleware(request('/?startapp=welcome'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://studio.example.com/studio?startapp=welcome');
  });

  it('uses the configured public URL behind a localhost tunnel and ignores forwarded hosts', () => {
    vi.stubEnv('STUDIO_WEBAPP_URL', 'https://vox.joyixir.com/studio');
    const response = middleware(new NextRequest('http://localhost:3107/?startapp=welcome', {
      headers: { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http' },
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://vox.joyixir.com/studio?startapp=welcome');
  });

  it.each(['not-a-url', 'http://vox.joyixir.com/studio', 'javascript:alert(1)',
    'https://user:password@vox.joyixir.com/studio', 'https://vox.joyixir.com/login',
    'https://vox.joyixir.com/studio?override=yes', 'https://vox.joyixir.com/studio#override'])
  ('fails closed for an invalid configured Mini App URL: %s', (url) => {
    vi.stubEnv('STUDIO_WEBAPP_URL', url);
    expect(middleware(request('/')).status).toBe(503);
  });

  it.each(['/studio', '/studio/', '/studio/agents', '/api/studio/me', '/api/studio/media/avatar.jpg', '/_next/static/chunks/app.js', '/favicon.ico'])
  ('serves the required Mini App surface: %s', (path) => {
    expect(middleware(request(path)).headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/login', '/pricing', '/studio-other', '/api/studio-other', '/api/chat', '/api/chat/avatar.jpg', '/api/convai/llm',
    '/api/telegram/payments', '/api/stripe/create-checkout', '/_next/image?url=https://example.com/a.jpg', '/private.json'])
  ('hides legacy and unnecessary routes, including image suffixes: %s', (path) => {
    expect(middleware(request(path)).status).toBe(404);
  });

  it('covers all paths so API filename suffixes cannot bypass the route gate', () => {
    expect(config.matcher).toEqual(['/:path*']);
  });
});

describe('explicit internal Connections broker route', () => {
  const configure = () => {
    vi.stubEnv('STUDIO_CONNECTIONS_CONFIG_FILE', '/private/operator/connections.json');
    vi.stubEnv('STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', '/private/operator/broker-auth.hex');
    vi.stubEnv('STUDIO_CONNECTIONS_BROKER_URL', 'http://127.0.0.1:7091');
  };
  const brokerRequest = (path = '/api/connections/broker', method = 'POST') =>
    new NextRequest(`https://studio.example.com${path}`, { method });

  it('keeps the unconfigured rollout hidden despite localhost or Origin headers', () => {
    for (const url of ['https://studio.example.com/api/connections/broker', 'http://localhost:3107/api/connections/broker']) {
      const response = middleware(new NextRequest(url, { method: 'POST', headers: { origin: 'http://localhost:3107', 'x-forwarded-host': '127.0.0.1' } }));
      expect(response.status).toBe(404); expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(handleStudioBrokerControl).not.toHaveBeenCalled();
  });

  it.each(['STUDIO_CONNECTIONS_CONFIG_FILE', 'STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', 'STUDIO_CONNECTIONS_BROKER_URL'])
  ('keeps partial configuration hidden when %s is absent', missing => {
    configure(); vi.stubEnv(missing, '');
    expect(middleware(brokerRequest()).status).toBe(404);
  });

  it.each([
    ['STUDIO_CONNECTIONS_CONFIG_FILE', 'relative/connections.json'],
    ['STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', 'relative/key.hex'],
    ['STUDIO_CONNECTIONS_CONFIG_FILE', '//other-host/connections.json'],
    ['STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', '/private/key\n.hex'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'not-a-url'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'https://broker.example.com'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'http://localhost:7091'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'http://127.0.0.1.attacker.example:7091'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'http://user:password@127.0.0.1:7091'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'http://127.0.0.1:7091/provider'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'http://127.0.0.1:7091/?override=true'],
    ['STUDIO_CONNECTIONS_BROKER_URL', 'http://127.0.0.1:7091/#override'],
  ])('fails closed for malformed server prerequisite %s=%s', (name, value) => {
    configure(); vi.stubEnv(name, value);
    expect(middleware(brokerRequest()).status).toBe(404);
  });

  it.each(['http://127.0.0.1:7091', 'http://[::1]:7091'])
  ('admits only the exact POST with explicit loopback broker configuration: %s', brokerUrl => {
    configure(); vi.stubEnv('STUDIO_CONNECTIONS_BROKER_URL', brokerUrl);
    const response = middleware(brokerRequest());
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none';");
  });

  it.each(['/api/connections', '/api/connections/broker/', '/api/connections/broker/claim', '/api/connections/broker-extra',
    '/api/connections/broker.jpg', '/api/connections/%62roker', '/api/connections/broker?override=true', '/api/chat', '/api/private'])
  ('does not widen lookalike, child, query or unrelated API routes: %s', path => {
    configure(); expect(middleware(brokerRequest(path)).status).toBe(404);
  });

  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('does not admit a %s broker control request', method => {
    configure(); expect(middleware(brokerRequest('/api/connections/broker', method)).status).toBe(404);
  });

  it('lets the actual route reach its mandatory authenticated handler rather than authenticating in middleware', async () => {
    configure();
    const key = randomBytes(32); const auth = new BrokerAuthenticator(key);
    vi.mocked(handleStudioBrokerControl).mockImplementation(async (_studio, incoming) => {
      const raw = await incoming.text();
      try { auth.verify('POST', '/api/connections/broker', raw, incoming.headers); }
      catch { return Response.json({ error: 'broker_auth_denied' }, { status: 401 }); }
      return Response.json({ authenticated: true });
    });
    const body = JSON.stringify({ action: 'context', fixture: true });
    const unsigned = new NextRequest('https://studio.example.com/api/connections/broker', { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    expect(middleware(unsigned).headers.get('x-middleware-next')).toBe('1');
    expect((await brokerControlPost(unsigned)).status).toBe(401);
    const signed = new NextRequest('https://studio.example.com/api/connections/broker', { method: 'POST', body,
      headers: { 'content-type': 'application/json', ...signBrokerRequest(key, 'POST', '/api/connections/broker', body) } });
    expect(middleware(signed).headers.get('x-middleware-next')).toBe('1');
    expect(await (await brokerControlPost(signed)).json()).toEqual({ authenticated: true });
    expect(handleStudioBrokerControl).toHaveBeenCalledTimes(2);
  });
});

describe('Telegram embedding headers', () => {
  it('allows the official Telegram Web origin only on Studio documents', () => {
    const response = middleware(request('/studio'));
    expect(response.headers.get('Content-Security-Policy')).toContain('frame-ancestors https://web.telegram.org;');
    expect(response.headers.get('Content-Security-Policy')).not.toContain('https://*.telegram.org; form-action');
    expect(response.headers.has('X-Frame-Options')).toBe(false);
    expect(response.headers.get('Permissions-Policy')).toContain('microphone=(self)');
  });

  it('retains frame denial on API responses and every non-Studio document', () => {
    vi.stubEnv('STUDIO_ONLY', '0');
    for (const path of ['/login', '/studio-other', '/api/studio/me']) {
      const response = middleware(request(path));
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none';");
    }
  });
});
