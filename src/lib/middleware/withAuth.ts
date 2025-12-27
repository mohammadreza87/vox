import { NextRequest, NextResponse } from 'next/server';
import { DecodedIdToken } from 'firebase-admin/auth';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';

/**
 * Extended NextRequest with authenticated user information
 */
export interface AuthenticatedRequest extends NextRequest {
  user: DecodedIdToken;
  userId: string;
}

/**
 * Standard error response format
 */
export interface AuthErrorResponse {
  error: string;
  code: string;
}

/**
 * Route handler type for authenticated routes
 */
type AuthenticatedHandler = (
  request: AuthenticatedRequest,
  context?: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

/**
 * Route handler type for optionally authenticated routes
 */
type OptionalAuthHandler = (
  request: NextRequest & { user?: DecodedIdToken; userId?: string },
  context?: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

/**
 * Standard route handler type
 */
type RouteHandler = (
  request: NextRequest,
  context?: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

/**
 * Middleware wrapper that requires authentication
 * Returns 401 if no valid token is provided
 *
 * @example
 * export const GET = withAuth(async (request) => {
 *   const { userId } = request;
 *   // userId is guaranteed to be defined
 *   return NextResponse.json({ userId });
 * });
 */
export function withAuth(handler: AuthenticatedHandler): RouteHandler {
  return async (request: NextRequest, context?) => {
    const token = extractBearerToken(request.headers.get('Authorization'));

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'MISSING_TOKEN' } satisfies AuthErrorResponse,
        { status: 401 }
      );
    }

    const decodedToken = await verifyIdToken(token);

    if (!decodedToken) {
      return NextResponse.json(
        { error: 'Invalid or expired token', code: 'INVALID_TOKEN' } satisfies AuthErrorResponse,
        { status: 401 }
      );
    }

    // Extend request with user info
    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.user = decodedToken;
    authenticatedRequest.userId = decodedToken.uid;

    return handler(authenticatedRequest, context);
  };
}

/**
 * Middleware wrapper that optionally authenticates
 * Request proceeds even without a token, but user info is attached if valid token exists
 *
 * @example
 * export const GET = withOptionalAuth(async (request) => {
 *   if (request.userId) {
 *     // Authenticated user
 *     return NextResponse.json({ tier: 'pro' });
 *   }
 *   // Anonymous user
 *   return NextResponse.json({ tier: 'free' });
 * });
 */
export function withOptionalAuth(handler: OptionalAuthHandler): RouteHandler {
  return async (request: NextRequest, context?) => {
    const token = extractBearerToken(request.headers.get('Authorization'));

    if (token) {
      const decodedToken = await verifyIdToken(token);

      if (decodedToken) {
        // Extend request with user info
        const extendedRequest = request as NextRequest & {
          user?: DecodedIdToken;
          userId?: string;
        };
        extendedRequest.user = decodedToken;
        extendedRequest.userId = decodedToken.uid;

        return handler(extendedRequest, context);
      }
    }

    // Proceed without user info
    return handler(request, context);
  };
}

/**
 * Helper to create a standardized 401 response
 */
export function unauthorized(code: string = 'UNAUTHORIZED', message: string = 'Unauthorized'): NextResponse {
  return NextResponse.json({ error: message, code } satisfies AuthErrorResponse, { status: 401 });
}

/**
 * Helper to create a standardized 403 response
 */
export function forbidden(code: string = 'FORBIDDEN', message: string = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message, code } satisfies AuthErrorResponse, { status: 403 });
}
