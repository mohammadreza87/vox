import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken, getAdminDb } from '@/lib/firebase-admin';
import { Chat, Message } from '@/shared/types';
import { logger } from '@/lib/logger';
import { withCache, cacheKeys, CACHE_TTL, cacheDelete } from '@/lib/cache';
import {
  getV2ApiRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

// GET - Load user data (chats, preferences, custom contacts)
export async function GET(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
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

    // Use cache for user preferences
    const userData = await withCache(
      cacheKeys.userPreferences(userId),
      async () => {
        const db = await getAdminDb();
        const userDataRef = db.collection('users').doc(userId).collection('data').doc('app');
        const userDataSnap = await userDataRef.get();

        if (!userDataSnap.exists) {
          return {
            chats: [],
            customContacts: [],
            preferences: { theme: 'light' },
          };
        }

        const data = userDataSnap.data()!;

        // Convert Firestore timestamps to ISO strings for JSON serialization
        const chats = (data.chats || []).map((chat: Chat) => ({
          ...chat,
          lastMessageAt:
            chat.lastMessageAt instanceof Date
              ? chat.lastMessageAt.toISOString()
              : chat.lastMessageAt,
          messages: (chat.messages || []).map((msg: Message) => ({
            ...msg,
            createdAt: msg.createdAt instanceof Date ? msg.createdAt.toISOString() : msg.createdAt,
          })),
        }));

        return {
          chats,
          customContacts: data.customContacts || [],
          preferences: data.preferences || { theme: 'light' },
        };
      },
      CACHE_TTL.USER_PREFERENCES
    );

    return NextResponse.json(userData);
  } catch (error) {
    logger.error({ error }, 'Error loading user data');
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}

// POST - Save user data
export async function POST(request: NextRequest) {
  try {
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
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
    const body = await request.json();
    const { chats, customContacts, preferences } = body;

    const db = await getAdminDb();
    const userDataRef = db.collection('users').doc(userId).collection('data').doc('app');

    const updateData: Record<string, unknown> = {};

    if (chats !== undefined) {
      updateData.chats = chats;
    }
    if (customContacts !== undefined) {
      updateData.customContacts = customContacts;
    }
    if (preferences !== undefined) {
      updateData.preferences = preferences;
    }

    await userDataRef.set(updateData, { merge: true });

    // Also update the customContactsCount in the main user document for subscription tracking
    if (customContacts !== undefined) {
      const userDocRef = db.collection('users').doc(userId);
      await userDocRef.set(
        {
          usage: {
            customContactsCount: Array.isArray(customContacts) ? customContacts.length : 0,
          },
        },
        { merge: true }
      );
    }

    // Invalidate cache after update
    await cacheDelete(cacheKeys.userPreferences(userId));

    return NextResponse.json({ saved: true });
  } catch (error) {
    logger.error({ error }, 'Error saving user data');
    return NextResponse.json({ error: 'Failed to save data' }, { status: 500 });
  }
}
