/**
 * API Error Types and Handling
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface ApiErrorDetails {
  code: ApiErrorCode;
  message: string;
  status?: number;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export class ApiError extends Error {
  code: ApiErrorCode;
  status?: number;
  details?: Record<string, unknown>;
  retryable: boolean;

  constructor(error: ApiErrorDetails) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.status = error.status;
    this.details = error.details;
    this.retryable = error.retryable;
  }

  static fromResponse(response: Response, body?: unknown): ApiError {
    const message =
      (body as { error?: string })?.error ||
      (body as { message?: string })?.message ||
      response.statusText ||
      'Request failed';

    const details: ApiErrorDetails = {
      code: getErrorCodeFromStatus(response.status),
      message,
      status: response.status,
      details: typeof body === 'object' ? (body as Record<string, unknown>) : undefined,
      retryable: isRetryableStatus(response.status),
    };

    return new ApiError(details);
  }

  static networkError(message: string = 'Network error'): ApiError {
    return new ApiError({
      code: 'NETWORK_ERROR',
      message,
      retryable: true,
    });
  }

  static timeout(message: string = 'Request timed out'): ApiError {
    return new ApiError({
      code: 'TIMEOUT',
      message,
      retryable: true,
    });
  }

  static unauthorized(message: string = 'Unauthorized'): ApiError {
    return new ApiError({
      code: 'UNAUTHORIZED',
      message,
      status: 401,
      retryable: false,
    });
  }
}

function getErrorCodeFromStatus(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 400:
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    case 500:
    case 502:
    case 503:
    case 504:
      return 'SERVER_ERROR';
    default:
      return 'UNKNOWN';
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * User-friendly error messages
 */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: 'Please sign in to continue.',
  FORBIDDEN: 'You don\'t have permission to do this.',
  NOT_FOUND: 'The requested resource was not found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment.',
  SERVER_ERROR: 'Something went wrong. Please try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  TIMEOUT: 'Request timed out. Please try again.',
  UNKNOWN: 'An unexpected error occurred.',
};

/**
 * Get user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return ERROR_MESSAGES.UNKNOWN;
}
