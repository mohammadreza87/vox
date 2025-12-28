import * as Sentry from '@sentry/nextjs';

/**
 * Sentry Server Configuration for Vox
 * Captures server-side errors and API route performance
 */

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  // Only enable Sentry if DSN is configured
  enabled: Boolean(SENTRY_DSN),

  // Environment tag
  environment: process.env.NODE_ENV || 'development',

  // Performance Monitoring
  // Capture 10% of transactions in production, 100% in development
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Filter out noise
  ignoreErrors: [
    // Network errors from upstream services
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    // Firebase transient errors
    'INTERNAL ASSERTION FAILED',
    // Rate limiting (expected behavior, not an error)
    'Rate limit exceeded',
    // Auth errors (user-facing, not bugs)
    'auth/id-token-expired',
    'auth/invalid-id-token',
  ],

  // Sanitize sensitive data before sending
  beforeSend(event) {
    // Remove sensitive environment variables from extra data
    if (event.extra) {
      const sensitiveKeys = ['key', 'secret', 'token', 'password', 'auth'];
      for (const key of Object.keys(event.extra)) {
        if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
          delete event.extra[key];
        }
      }
    }

    // Sanitize request data
    if (event.request) {
      // Remove authorization headers
      if (event.request.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }

      // Sanitize request body (might contain tokens)
      if (event.request.data && typeof event.request.data === 'object') {
        const sanitizedData = { ...event.request.data } as Record<string, unknown>;
        const sensitiveFields = ['password', 'token', 'sessionToken', 'initData', 'hash'];
        for (const field of sensitiveFields) {
          if (field in sanitizedData) {
            sanitizedData[field] = '[REDACTED]';
          }
        }
        event.request.data = sanitizedData;
      }
    }

    return event;
  },

  // Add custom tags
  initialScope: {
    tags: {
      service: 'vox-server',
    },
  },
});
