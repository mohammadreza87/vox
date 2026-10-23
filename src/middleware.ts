import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Security headers middleware for Vox
 * Applies security headers to all responses to protect against common web vulnerabilities
 */

// Content Security Policy directives
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Required for Next.js
    "'unsafe-eval'", // Required for Next.js in development
    'blob:', // Required for ElevenLabs AudioWorklet modules
    'data:', // Required for ElevenLabs AudioWorklet modules
    'https://js.stripe.com',
    'https://telegram.org',
    'https://oauth.telegram.org',
    'https://apis.google.com', // Google APIs (Firebase Auth)
    'https://www.gstatic.com', // Google static resources
  ],
  'style-src': ["'self'", "'unsafe-inline'"], // Required for styled-jsx and inline styles
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://*.googleusercontent.com', // Firebase user avatars
    'https://t.me', // Telegram avatars
    'https://*.telegram.org',
  ],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://*.firebaseio.com',
    'https://*.googleapis.com',
    'https://firestore.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://api.elevenlabs.io',
    'wss://api.elevenlabs.io', // ElevenLabs Conversational AI WebSocket
    'https://api.stripe.com',
    'https://api.openai.com',
    'https://api.anthropic.com',
    'wss://*.firebaseio.com', // Firebase realtime
    'https://*.sentry.io', // Sentry error tracking
    'https://*.ingest.sentry.io',
  ],
  'frame-src': [
    "'self'",
    'https://js.stripe.com',
    'https://oauth.telegram.org',
    'https://*.firebaseapp.com', // Firebase Auth iframe
    'https://*.firebase.com',
  ],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'worker-src': ["'self'", 'blob:'],
  'media-src': ["'self'", 'blob:', 'data:', 'https://storage.googleapis.com'], // ElevenLabs voice-library previews
  'manifest-src': ["'self'"],
};

// Telegram clients that render Mini Apps in an iframe (Telegram Web)
// Both official WebA and WebK clients use this origin (telegram.org/apps).
const TELEGRAM_FRAME_ANCESTORS = ['https://web.telegram.org'];

const isPathOrChild = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

// Middleware runs at the Edge and cannot read the manifest/key files. Admit only
// the existing explicit server configuration; the Node route must still verify
// HMAC and current profile authority before serving any broker action.
function hasBrokerControlConfiguration(): boolean {
  const manifest = process.env.STUDIO_CONNECTIONS_CONFIG_FILE;
  const key = process.env.STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE;
  const brokerUrl = process.env.STUDIO_CONNECTIONS_BROKER_URL;
  const privatePath = (value: string | undefined) => Boolean(value && value === value.trim() &&
    value.startsWith('/') && !value.startsWith('//') && !/[\0\r\n]/.test(value));
  if (!privatePath(manifest) || !privatePath(key) || !brokerUrl) return false;
  try {
    const url = new URL(brokerUrl);
    return url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

// Build CSP header string
function buildCSP(isDev: boolean, isMiniApp = false): string {
  const directives = { ...CSP_DIRECTIVES };
  if (isMiniApp) directives['frame-ancestors'] = TELEGRAM_FRAME_ANCESTORS;

  // In development, allow localhost and hot reload
  if (isDev) {
    directives['connect-src'] = [
      ...directives['connect-src'],
      'ws://localhost:*',
      'http://localhost:*',
    ];
  }

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

// Permissions Policy directives
const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=(self)', // Voice features need microphone
  'geolocation=()',
  'payment=(self)', // Stripe payments
  'usb=()',
  'magnetometer=()',
  'gyroscope=()',
  'accelerometer=()',
].join(', ');

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const guestPage = pathname === '/privacy';
  const guestGet = ['/api/guest-rights', '/api/guest-rights/operations/requests'].includes(pathname) && request.method === 'GET';
  const guestPost = ['/api/guest-rights/draft', '/api/guest-rights/requests', '/api/guest-rights/status', '/api/guest-rights/close', '/api/guest-rights/operations/actions'].includes(pathname) && request.method === 'POST';
  const guestApi = (guestGet || guestPost) && request.nextUrl.search === '';
  const guest = guestPage || guestApi;
  const botConnections = ['GET', 'POST'].includes(request.method) &&
    /^\/api\/agents\/[A-Za-z0-9_-]{1,128}\/connections(?:\/[A-Za-z0-9_.-]{1,200}){0,8}$/.test(pathname);
  const connectionOAuth = request.method === 'GET' && (
    pathname === '/oauth/callback/remote_mcp' && request.nextUrl.search.length <= 8192 ||
    pathname === '/oauth/client-metadata.json' && request.nextUrl.search === '');

  if (process.env.STUDIO_ONLY === '1') {
    if (pathname === '/') {
      // Next's middleware adapter requires an absolute redirect URL. A tunnel
      // can expose localhost in request.nextUrl, so prefer the configured URL.
      const configuredUrl = process.env.STUDIO_WEBAPP_URL?.trim();
      let target: URL;
      try {
        target = configuredUrl ? new URL(configuredUrl) : new URL('/studio', request.url);
      } catch {
        return new NextResponse(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      if (configuredUrl && (target.protocol !== 'https:' || target.username || target.password ||
        target.pathname.replace(/\/$/, '') !== '/studio' || target.search || target.hash)) {
        return new NextResponse(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      target.pathname = '/studio';
      target.search = request.nextUrl.search;
      return NextResponse.redirect(target);
    }
    const brokerControl = pathname === '/api/connections/broker' && request.method === 'POST' &&
      request.nextUrl.search === '' && hasBrokerControlConfiguration();
    if (!brokerControl && !botConnections && !connectionOAuth && !guest && !isPathOrChild(pathname, '/studio') && !isPathOrChild(pathname, '/api/studio') &&
      !pathname.startsWith('/_next/static/') && pathname !== '/favicon.ico') {
      return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  // Circles S4: the manager bot's Main Mini App is /studio. A pet launch over a group (startapp=p_…, which Telegram
  // also passes as tgWebAppStartParam) renders the pet launch page in place: a rewrite, so the initData fragment stays.
  const petLaunch = (pathname === '/studio' || pathname === '/studio/') && request.method === 'GET' &&
    /^p_[A-Za-z0-9_-]{1,62}$/.test(request.nextUrl.searchParams.get('tgWebAppStartParam') ?? '');
  const response = petLaunch ? NextResponse.rewrite(new URL(`/studio/pet/launch${request.nextUrl.search}`, request.url)) : NextResponse.next();
  if (connectionOAuth) response.headers.set('Cache-Control', 'no-store');
  const isDev = process.env.NODE_ENV === 'development';

  // Generate unique request ID for tracing
  const requestId = crypto.randomUUID();
  response.headers.set('X-Request-ID', requestId);

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Vox Studio is a Telegram Mini App: Telegram Web frames it, so framing is
  // limited to Telegram by CSP instead of being denied outright.
  const isMiniApp = isPathOrChild(pathname, '/studio');
  if (!isMiniApp) response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', guest || connectionOAuth ? 'no-referrer' : 'strict-origin-when-cross-origin');
  // self refers to the Studio origin even when Telegram embeds it. Telegram's
  // parent iframe must delegate microphone access; no wildcard is needed here.
  response.headers.set('Permissions-Policy', guest || connectionOAuth ? PERMISSIONS_POLICY.replace('camera=(self)', 'camera=()').replace('microphone=(self)', 'microphone=()').replace('payment=(self)', 'payment=()') : PERMISSIONS_POLICY);

  // CSP - use report-only in development to avoid blocking
  const csp = connectionOAuth ? ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"].join('; ')
    : guest ? ["default-src 'none'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "img-src 'self' data:", "font-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'", "media-src 'none'"].join('; ') : buildCSP(isDev, isMiniApp);
  if (isDev) {
    response.headers.set('Content-Security-Policy-Report-Only', csp);
  } else {
    response.headers.set('Content-Security-Policy', csp);
  }

  // HSTS - only in production with HTTPS
  if (!isDev) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  // Prevent caching of sensitive API responses
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }

  return response;
}

// Configure which paths the middleware runs on
export const config = {
  // Every path must reach the Studio-only gate, including API paths ending in
  // image extensions and the unused /_next/image optimization endpoint.
  matcher: ['/:path*'],
};
