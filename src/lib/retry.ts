/**
 * Server-side retry logic with exponential backoff
 *
 * Provides consistent retry behavior for external service calls
 * to handle transient failures gracefully.
 */

import { logger } from './logger';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay between retries in ms (default: 1000) */
  baseDelay: number;
  /** Maximum delay between retries in ms (default: 10000) */
  maxDelay: number;
  /** Jitter factor to randomize delays (0-1, default: 0.1) */
  jitter: number;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback for logging/monitoring retry attempts */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: 0.1,
};

/**
 * Error codes that indicate retryable network/connection issues
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'TIMEOUT',
]);

/**
 * HTTP status codes that indicate retryable errors
 */
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Check if an error is retryable based on its characteristics
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Check for network error codes
  const code = (error as NodeJS.ErrnoException).code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  // Check for timeout errors
  if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
    return true;
  }

  // Check for fetch/HTTP errors with retryable status codes
  if ('status' in error && typeof (error as { status: unknown }).status === 'number') {
    return RETRYABLE_STATUS_CODES.has((error as { status: number }).status);
  }

  // Check error message for common retryable patterns
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'network',
    'connection',
    'timeout',
    'econnreset',
    'socket hang up',
    'temporarily unavailable',
    'service unavailable',
    'too many requests',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

/**
 * Calculate backoff delay with exponential growth and jitter
 */
export function calculateBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: number = 0.1
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add random jitter to prevent thundering herd
  const jitterRange = cappedDelay * jitter;
  const jitterValue = Math.random() * jitterRange * 2 - jitterRange;

  return Math.round(cappedDelay + jitterValue);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Custom error class for retry exhaustion
 */
export class RetryExhaustedError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`All ${attempts} retry attempts exhausted. Last error: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RetryExhaustedError);
    }
  }
}

/**
 * Execute a function with automatic retry on failure
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The function result on success
 * @throws RetryExhaustedError if all retries fail
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => {
 *     const response = await fetch('https://api.example.com/data');
 *     if (!response.ok) throw new Error(`HTTP ${response.status}`);
 *     return response.json();
 *   },
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetry = opts.shouldRetry
        ? opts.shouldRetry(lastError, attempt)
        : isRetryableError(lastError);

      // If not retryable or last attempt, throw immediately
      if (!shouldRetry || attempt === opts.maxRetries) {
        if (attempt > 0) {
          throw new RetryExhaustedError(attempt + 1, lastError);
        }
        throw lastError;
      }

      // Calculate delay for next attempt
      const delay = calculateBackoff(attempt, opts.baseDelay, opts.maxDelay, opts.jitter);

      // Log retry attempt
      if (opts.onRetry) {
        opts.onRetry(lastError, attempt + 1, delay);
      } else {
        logger.warn({
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delay,
          error: lastError.message,
        }, 'Retrying operation');
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Create a retry wrapper with preset options
 *
 * @example
 * ```typescript
 * const retryFirebase = createRetryWrapper({ maxRetries: 3, baseDelay: 500 });
 * const data = await retryFirebase(() => db.collection('users').doc(id).get());
 * ```
 */
export function createRetryWrapper(defaultOptions: Partial<RetryOptions> = {}) {
  return <T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> => {
    return withRetry(fn, { ...defaultOptions, ...options });
  };
}

/**
 * Pre-configured retry wrapper for Firebase operations
 */
export const retryFirebase = createRetryWrapper({
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 5000,
});

/**
 * Pre-configured retry wrapper for external API calls
 */
export const retryExternalApi = createRetryWrapper({
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 10000,
});
