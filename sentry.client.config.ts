import * as Sentry from '@sentry/nextjs';

/**
 * Sentry Client Configuration for Vox
 * Captures client-side errors, performance metrics, and session replay
 */

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,

  // Only enable Sentry if DSN is configured
  enabled: Boolean(SENTRY_DSN),

  // Environment tag
  environment: process.env.NODE_ENV || 'development',

  // Performance Monitoring
  // Capture 10% of transactions in production, 100% in development
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session Replay
  // Capture 10% of sessions for replay (helps debug user issues)
  replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  // Capture 100% of sessions with errors for replay
  replaysOnErrorSampleRate: 1.0,

  // Integrations
  integrations: [
    // Browser tracing for performance monitoring
    Sentry.browserTracingIntegration(),
    // Session replay (only in production to save bandwidth)
    ...(process.env.NODE_ENV === 'production'
      ? [
          Sentry.replayIntegration({
            // Mask all text for privacy
            maskAllText: true,
            // Block all media to reduce size
            blockAllMedia: true,
          }),
        ]
      : []),
  ],

  // Filter out noise
  ignoreErrors: [
    // Random network errors
    'Network Error',
    'NetworkError',
    'Failed to fetch',
    'Load failed',
    // Browser extension errors
    /chrome-extension:/,
    /moz-extension:/,
    // Safari extensions
    /safari-extension:/,
    // User aborted requests
    'AbortError',
    // Resize observer errors (common and harmless)
    'ResizeObserver loop',
    // Firebase auth errors (user-facing, not bugs)
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    // React hydration mismatches in development
    ...(process.env.NODE_ENV === 'development' ? ['Hydration failed'] : []),
  ],

  // Sanitize sensitive data before sending
  beforeSend(event) {
    // Remove sensitive query params
    if (event.request?.query_string) {
      const sensitiveKeys = ['token', 'auth', 'key', 'secret', 'password'];
      if (typeof event.request.query_string === 'string') {
        // Handle string format
        const sanitized = event.request.query_string
          .split('&')
          .filter((param) => {
            const key = param.split('=')[0].toLowerCase();
            return !sensitiveKeys.includes(key);
          })
          .join('&');
        event.request.query_string = sanitized;
      } else if (Array.isArray(event.request.query_string)) {
        // Handle array of tuples format
        event.request.query_string = event.request.query_string.filter(
          ([key]) => !sensitiveKeys.includes(key.toLowerCase())
        );
      }
    }

    // Remove sensitive headers
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }

    return event;
  },

  // Add custom tags
  initialScope: {
    tags: {
      service: 'vox-client',
    },
  },
});
