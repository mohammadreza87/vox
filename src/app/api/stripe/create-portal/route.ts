import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { stripe } from '@/lib/stripe';
import { getUserDocument } from '@/lib/firestore';

export async function POST(request: NextRequest) {
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

    // Get user's Stripe customer ID
    const userDoc = await getUserDocument(userId);
    const customerId = userDoc?.subscription?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json(
        { error: 'No subscription found' },
        { status: 400 }
      );
    }

    // Get optional return URL from request
    const { returnUrl } = await request.json().catch(() => ({}));

    // Create portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${process.env.NEXT_PUBLIC_APP_URL}/app`,
    });

    return NextResponse.json({
      url: session.url,
    });
  } catch (error) {
    console.error('Error creating portal session:', error);
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    );
  }
}
