/**
 * Timeout handling utilities for API requests
 *
 * Provides consistent timeout handling for external service calls
 * to prevent hanging requests and improve user experience.
 */

/**
 * Timeout configuration for different operation types (in milliseconds)
 */
export const TIMEOUTS = {
  /** AI chat completion */
  CHAT: 30_000,
  /** AI streaming chat (longer for full response) */
  CHAT_STREAM: 60_000,
  /** Text-to-speech generation */
  TTS: 15_000,
  /** Translation API calls */
  TRANSLATE: 10_000,
  /** Voice cloning (uploading and processing audio) */
  VOICE_CLONE: 120_000,
  /** Firebase/Firestore operations */
  FIREBASE: 10_000,
  /** Default for unspecified operations */
  DEFAULT: 30_000,
  /** Quick operations like validation, lookup */
  QUICK: 5_000,
} as const;

export type TimeoutType = keyof typeof TIMEOUTS;

/**
 * Custom error class for timeout errors
 */
export class TimeoutError extends Error {
  public readonly operation: string;
  public readonly timeoutMs: number;
  public readonly code = 'TIMEOUT';

  constructor(operation: string, timeoutMs: number) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
}

/**
 * Check if an error is a TimeoutError
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError || (error instanceof Error && error.name === 'TimeoutError');
}

/**
 * Wrap a promise with a timeout
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operation - Description of the operation (for error messages)
 * @returns The promise result or throws TimeoutError
 *
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   fetch('https://api.example.com/data'),
 *   TIMEOUTS.CHAT,
 *   'AI chat completion'
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create a timeout wrapper with a specific timeout type
 *
 * @example
 * ```typescript
 * const chatWithTimeout = createTimeoutWrapper('CHAT');
 * const result = await chatWithTimeout(
 *   openai.chat.completions.create({...}),
 *   'OpenAI completion'
 * );
 * ```
 */
export function createTimeoutWrapper(type: TimeoutType) {
  const timeoutMs = TIMEOUTS[type];
  return <T>(promise: Promise<T>, operation: string): Promise<T> => {
    return withTimeout(promise, timeoutMs, operation);
  };
}

/**
 * Create an AbortController that automatically aborts after a timeout
 *
 * Useful for fetch requests that support AbortSignal
 *
 * @example
 * ```typescript
 * const { signal, cleanup } = createTimeoutAbortController(TIMEOUTS.TTS);
 * try {
 *   const response = await fetch(url, { signal });
 *   return await response.json();
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export function createTimeoutAbortController(timeoutMs: number): {
  controller: AbortController;
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new TimeoutError('fetch', timeoutMs));
  }, timeoutMs);

  return {
    controller,
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Fetch with automatic timeout handling
 *
 * @example
 * ```typescript
 * const response = await fetchWithTimeout(
 *   'https://api.example.com/data',
 *   { method: 'POST', body: JSON.stringify(data) },
 *   TIMEOUTS.CHAT
 * );
 * ```
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeoutMs: number = TIMEOUTS.DEFAULT
): Promise<Response> {
  const { signal, cleanup } = createTimeoutAbortController(timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? signal,
    });
    return response;
  } finally {
    cleanup();
  }
}
