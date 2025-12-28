import { NextResponse } from 'next/server';

/**
 * Standardized API Response Types
 *
 * All API routes should return responses in this format for consistency.
 */

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    requestId?: string;
    pagination?: {
      hasMore: boolean;
      nextCursor?: string;
      total?: number;
    };
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Error codes for consistent error handling across the API
 */
export const ErrorCodes = {
  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',

  // Auth errors (401, 403)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // Resource errors (404, 409)
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // Server errors (500, 502, 503)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  TIMEOUT: 'TIMEOUT',

  // Business logic errors
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Generate metadata for API responses
 */
function generateMeta(options?: {
  requestId?: string;
  pagination?: {
    hasMore: boolean;
    nextCursor?: string;
    total?: number;
  };
}): ApiSuccessResponse<unknown>['meta'] {
  return {
    timestamp: new Date().toISOString(),
    ...options,
  };
}

/**
 * Create a successful API response
 */
export function success<T>(
  data: T,
  options?: {
    status?: number;
    requestId?: string;
    pagination?: {
      hasMore: boolean;
      nextCursor?: string;
      total?: number;
    };
  }
): NextResponse<ApiSuccessResponse<T>> {
  const { status = 200, ...metaOptions } = options ?? {};

  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    meta: generateMeta(metaOptions),
  };

  return NextResponse.json(response, { status });
}

/**
 * Create an error API response
 */
export function error(
  code: ErrorCode | string,
  message: string,
  status: number,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };

  return NextResponse.json(response, { status });
}

/**
 * 400 Bad Request - Invalid input or validation error
 */
export function badRequest(
  message: string = 'Bad request',
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.VALIDATION_ERROR, message, 400, details);
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
export function unauthorized(
  message: string = 'Authentication required'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.UNAUTHORIZED, message, 401);
}

/**
 * 403 Forbidden - Authenticated but not authorized
 */
export function forbidden(
  message: string = 'Access denied'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.FORBIDDEN, message, 403);
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export function notFound(
  message: string = 'Resource not found'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.NOT_FOUND, message, 404);
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
export function conflict(
  message: string = 'Resource conflict',
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.CONFLICT, message, 409, details);
}

/**
 * 429 Too Many Requests - Rate limited
 */
export function tooManyRequests(
  message: string = 'Too many requests. Please try again later.'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.RATE_LIMITED, message, 429);
}

/**
 * 500 Internal Server Error - Unexpected server error
 */
export function serverError(
  message: string = 'Internal server error'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.INTERNAL_ERROR, message, 500);
}

/**
 * 502 Bad Gateway - External service error
 */
export function badGateway(
  message: string = 'External service error'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.EXTERNAL_SERVICE_ERROR, message, 502);
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
export function serviceUnavailable(
  message: string = 'Service temporarily unavailable'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.SERVICE_UNAVAILABLE, message, 503);
}

/**
 * 504 Gateway Timeout - Request timed out
 */
export function gatewayTimeout(
  message: string = 'Request timed out'
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.TIMEOUT, message, 504);
}

/**
 * Subscription required error (403)
 */
export function subscriptionRequired(
  message: string = 'This feature requires an active subscription',
  details?: { requiredTier?: string }
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.SUBSCRIPTION_REQUIRED, message, 403, details);
}

/**
 * Quota exceeded error (429)
 */
export function quotaExceeded(
  message: string = 'You have exceeded your usage quota',
  details?: { limit?: number; used?: number; resetAt?: string }
): NextResponse<ApiErrorResponse> {
  return error(ErrorCodes.QUOTA_EXCEEDED, message, 429, details);
}
