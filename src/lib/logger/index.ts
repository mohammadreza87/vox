import pino from 'pino';

/**
 * Structured logging with Pino for Vox
 * - Pretty print in development
 * - JSON format in production
 * - Sensitive field redaction
 * - Request ID tracking
 */

// Determine log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Fields to redact from logs (security)
const REDACTED_FIELDS = [
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'password',
  'token',
  'sessionToken',
  'apiKey',
  'api_key',
  'secret',
  'x-api-key',
  'X-API-Key',
  'bearer',
];

// Build redact paths for nested objects
const redactPaths = REDACTED_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `headers.${field}`,
  `body.${field}`,
  `req.headers.${field}`,
]);

// Create the base logger
// Note: pino-pretty transport with workers causes issues in Next.js dev mode
// Using simple JSON logging instead - use pino-pretty CLI for local debugging if needed
const baseLogger = pino({
  level: LOG_LEVEL,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      env: process.env.NODE_ENV || 'development',
      service: 'vox',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with request context
 * @param requestId Unique request ID
 * @param context Additional context to include
 * @returns Child logger with context
 */
export function createRequestLogger(
  requestId: string,
  context?: Record<string, unknown>
): pino.Logger {
  return baseLogger.child({
    requestId,
    ...context,
  });
}

/**
 * Create a child logger for a specific module
 * @param module Module name (e.g., 'auth', 'chat', 'tts')
 * @returns Child logger with module context
 */
export function createModuleLogger(module: string): pino.Logger {
  return baseLogger.child({ module });
}

/**
 * Log an API request
 */
export function logRequest(
  logger: pino.Logger,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  metadata?: Record<string, unknown>
): void {
  const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

  logger[logLevel]({
    type: 'request',
    method,
    path,
    statusCode,
    durationMs,
    ...metadata,
  });
}

/**
 * Log an error with stack trace
 */
export function logError(
  logger: pino.Logger,
  error: Error,
  context?: Record<string, unknown>
): void {
  logger.error({
    type: 'error',
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  });
}

/**
 * Log an external API call
 */
export function logExternalCall(
  logger: pino.Logger,
  service: string,
  endpoint: string,
  statusCode: number,
  durationMs: number,
  metadata?: Record<string, unknown>
): void {
  const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

  logger[logLevel]({
    type: 'external_call',
    service,
    endpoint,
    statusCode,
    durationMs,
    ...metadata,
  });
}

/**
 * Log a user action (for audit trail)
 */
export function logUserAction(
  logger: pino.Logger,
  userId: string,
  action: string,
  metadata?: Record<string, unknown>
): void {
  logger.info({
    type: 'user_action',
    userId,
    action,
    ...metadata,
  });
}

/**
 * Log a security event
 */
export function logSecurityEvent(
  logger: pino.Logger,
  event: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  metadata?: Record<string, unknown>
): void {
  const logLevel = severity === 'critical' || severity === 'high' ? 'error' : 'warn';

  logger[logLevel]({
    type: 'security',
    event,
    severity,
    ...metadata,
  });
}

// Export the base logger for simple use cases
export const logger = baseLogger;

// Export pino type for typing child loggers
export type { Logger } from 'pino';
