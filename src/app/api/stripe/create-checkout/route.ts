import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, extractBearerToken } from '@/lib/firebase-admin';
import { stripe, getOrCreateCustomer } from '@/lib/stripe';
import { getUserDocument, setStripeCustomerId } from '@/lib/firestore';
import { SUBSCRIPTION_TIERS } from '@/config/subscription';
import {
  getV2ApiRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

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

    const rateResult = await checkRateLimitSecure(
      getV2ApiRateLimiter(),
      getRateLimitIdentifier(request, decodedToken.uid),
      10,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    const userId = decodedToken.uid;
    const email = decodedToken.email;

    if (!email) {
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 }
      );
    }

    // Get request body
    const { priceId, successUrl, cancelUrl } = await request.json();

    const allowedPriceIds = [
      SUBSCRIPTION_TIERS.pro.stripePriceIds?.monthly,
      SUBSCRIPTION_TIERS.pro.stripePriceIds?.annual,
      SUBSCRIPTION_TIERS.max.stripePriceIds?.monthly,
      SUBSCRIPTION_TIERS.max.stripePriceIds?.annual,
    ].filter((id): id is string => Boolean(id));

    if (!priceId) {
      return NextResponse.json(
        { error: 'Price ID is required' },
        { status: 400 }
      );
    }

    if (allowedPriceIds.length > 0 && !allowedPriceIds.includes(priceId)) {
      return NextResponse.json(
        { error: 'Invalid price ID' },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const userDoc = await getUserDocument(userId);
    const existingCustomerId = userDoc?.subscription?.stripeCustomerId;

    const customerId = await getOrCreateCustomer(userId, email, existingCustomerId);

    // Save customer ID to Firestore if new
    if (!existingCustomerId) {
      await setStripeCustomerId(userId, customerId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL}/app?checkout=success`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL}/pricing?checkout=canceled`,
      metadata: {
        firebaseUserId: userId,
      },
      subscription_data: {
        metadata: {
          firebaseUserId: userId,
        },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
