import { NextRequest, NextResponse } from 'next/server';
import { getFeatureFlagsCached } from '@/lib/features';
import { extractBearerToken, verifyIdToken } from '@/lib/firebase-admin';

/**
 * GET /api/features
 * Returns feature flags for the current user
 * Supports both authenticated and unauthenticated requests
 */
export async function GET(request: NextRequest) {
  try {
    // Try to get user ID for personalized flags
    let userId: string | undefined;

    const token = extractBearerToken(request.headers.get('Authorization'));
    if (token) {
      const decoded = await verifyIdToken(token);
      if (decoded) {
        userId = decoded.uid;
      }
    }

    // Get flags (with or without user-specific overrides)
    const flags = await getFeatureFlagsCached(userId);

    return NextResponse.json({
      flags,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching feature flags:', error);
    // Return default flags on error
    const { DEFAULT_FLAGS } = await import('@/lib/features');
    return NextResponse.json({
      flags: DEFAULT_FLAGS,
      timestamp: new Date().toISOString(),
    });
  }
}
