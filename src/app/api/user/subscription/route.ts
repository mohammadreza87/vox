import { NextRequest } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getUserDocument, createUserDocument, resetDailyUsageIfNeeded } from '@/lib/firestore';
import { success, unauthorized, serverError } from '@/lib/api/response';
import { logger } from '@/lib/logger';
import { withCache, cacheKeys, CACHE_TTL, invalidateSubscriptionCache } from '@/lib/cache';
import {
  getV2ApiRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return unauthorized();
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return unauthorized('Invalid token');
    }

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      30,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const email = decodedToken.email;

    // Check if we need to bypass cache (for usage reset)
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';

    if (forceRefresh) {
      await invalidateSubscriptionCache(userId);
    }

    // Use cache for subscription data
    const subscriptionData = await withCache(
      cacheKeys.subscription(userId),
      async () => {
        // Get user document
        let userDoc = await getUserDocument(userId);

        // Create user document if it doesn't exist
        if (!userDoc && email) {
          await createUserDocument(userId, email, decodedToken.name || '');
          userDoc = await getUserDocument(userId);
        }

        if (!userDoc) {
          throw new Error('Failed to get user data');
        }

        // Check if daily usage needs to be reset
        const wasReset = await resetDailyUsageIfNeeded(userId);

        // Re-fetch after potential reset
        if (wasReset) {
          userDoc = await getUserDocument(userId);
        }

        return {
          subscription: userDoc!.subscription,
          usage: userDoc!.usage,
        };
      },
      CACHE_TTL.SUBSCRIPTION
    );

    return success(subscriptionData);
  } catch (error) {
    logger.error({ error }, 'Error getting user subscription');
    return serverError('Failed to get subscription data');
  }
}
