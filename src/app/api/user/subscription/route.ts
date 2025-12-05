import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { getUserDocument, createUserDocument, resetDailyUsageIfNeeded } from '@/lib/firestore';

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const token = extractBearerToken(request.headers.get('Authorization'));
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const decodedToken = await verifyIdToken(token);
    if (!decodedToken) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;
    const email = decodedToken.email;

    // Get user document
    let userDoc = await getUserDocument(userId);

    // Create user document if it doesn't exist
    if (!userDoc && email) {
      await createUserDocument(userId, email, decodedToken.name || '');
      userDoc = await getUserDocument(userId);
    }

    if (!userDoc) {
      return NextResponse.json(
        { error: 'Failed to get user data' },
        { status: 500 }
      );
    }

    // Check if daily usage needs to be reset
    await resetDailyUsageIfNeeded(userId);

    // Re-fetch after potential reset
    userDoc = await getUserDocument(userId);

    return NextResponse.json({
      subscription: userDoc!.subscription,
      usage: userDoc!.usage,
    });
  } catch (error) {
    console.error('Error getting user subscription:', error);
    return NextResponse.json(
      { error: 'Failed to get subscription data' },
      { status: 500 }
    );
  }
}
