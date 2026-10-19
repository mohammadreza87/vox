import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, middleware } from './middleware';

const request = (path: string) => new NextRequest(`https://studio.example.com${path}`);

beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('STUDIO_ONLY', '1'); vi.stubEnv('STUDIO_WEBAPP_URL', ''); });
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
