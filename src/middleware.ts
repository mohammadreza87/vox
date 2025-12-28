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
    'https://js.stripe.com',
    'https://telegram.org',
    'https://oauth.telegram.org',
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
  ],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'worker-src': ["'self'", 'blob:'],
  'media-src': ["'self'", 'blob:', 'data:'],
  'manifest-src': ["'self'"],
};

// Build CSP header string
function buildCSP(isDev: boolean): string {
  const directives = { ...CSP_DIRECTIVES };

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
  const response = NextResponse.next();
  const isDev = process.env.NODE_ENV === 'development';

  // Generate unique request ID for tracing
  const requestId = crypto.randomUUID();
  response.headers.set('X-Request-ID', requestId);

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);

  // CSP - use report-only in development to avoid blocking
  const csp = buildCSP(isDev);
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
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
