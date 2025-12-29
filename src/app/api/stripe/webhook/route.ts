import { NextRequest, NextResponse } from 'next/server';
import { stripe, getTierFromPriceId } from '@/lib/stripe';
import { updateUserSubscription, createUserDocument, getUserDocument } from '@/lib/firestore';
import Stripe from 'stripe';
import {
  getWebhookRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';

// Disable body parsing for webhook signature verification
export const runtime = 'nodejs';

// Helper to safely get subscription period dates
function getSubscriptionDates(subscription: Stripe.Subscription) {
  // Access raw data to avoid type issues with Stripe SDK
  const subData = subscription as unknown as {
    current_period_start: number;
    current_period_end: number;
  };
  return {
    currentPeriodStart: new Date(subData.current_period_start * 1000),
    currentPeriodEnd: new Date(subData.current_period_end * 1000),
  };
}

export async function POST(request: NextRequest) {
  const rateResult = await checkRateLimitSecure(
    getWebhookRateLimiter(),
    getRateLimitIdentifier(request, undefined),
    50,
    60_000
  );
  if (!rateResult.success && rateResult.response) {
    return rateResult.response;
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.created': {
        // Handle new subscription created
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.firebaseUserId;
  if (!userId) {
    console.error('No Firebase user ID in checkout session metadata');
    return;
  }

  // Get subscription details
  if (session.subscription) {
    const subscriptionResponse = await stripe.subscriptions.retrieve(
      session.subscription as string
    );
    const subscription = subscriptionResponse as Stripe.Subscription;

    const priceId = subscription.items.data[0]?.price.id;
    const tier = getTierFromPriceId(priceId);

    if (!tier) {
      console.error('Unknown price ID:', priceId);
      return;
    }

    // Ensure user document exists
    const existingUser = await getUserDocument(userId);
    if (!existingUser && session.customer_email) {
      await createUserDocument(userId, session.customer_email, '');
    }

    // Update subscription in Firestore
    const dates = getSubscriptionDates(subscription);
    await updateUserSubscription(userId, {
      tier,
      status: 'active',
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: dates.currentPeriodStart,
      currentPeriodEnd: dates.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });

    console.log(`User ${userId} subscribed to ${tier} plan`);
  }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  // Get user ID from metadata or customer
  const userId = subscription.metadata?.firebaseUserId;
  if (!userId) {
    console.error('No Firebase user ID in subscription metadata for created event');
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierFromPriceId(priceId);

  if (!tier) {
    console.error('Unknown price ID:', priceId);
    return;
  }

  // Map Stripe status to our status
  let status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' = 'active';
  if (subscription.status === 'canceled') status = 'canceled';
  else if (subscription.status === 'past_due') status = 'past_due';
  else if (subscription.status === 'trialing') status = 'trialing';
  else if (subscription.status === 'incomplete') status = 'incomplete';

  const dates = getSubscriptionDates(subscription);
  await updateUserSubscription(userId, {
    tier,
    status,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodStart: dates.currentPeriodStart,
    currentPeriodEnd: dates.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });

  console.log(`Subscription created for user ${userId}: ${tier} (${status})`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.firebaseUserId;
  if (!userId) {
    console.error('No Firebase user ID in subscription metadata');
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const tier = getTierFromPriceId(priceId);

  if (!tier) {
    // If no valid tier, might be downgraded to free
    await updateUserSubscription(userId, {
      tier: 'free',
      status: null,
      stripeSubscriptionId: null,
      stripePriceId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    return;
  }

  // Map Stripe status to our status
  let status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' = 'active';
  if (subscription.status === 'canceled') status = 'canceled';
  else if (subscription.status === 'past_due') status = 'past_due';
  else if (subscription.status === 'trialing') status = 'trialing';
  else if (subscription.status === 'incomplete') status = 'incomplete';

  const dates = getSubscriptionDates(subscription);
  await updateUserSubscription(userId, {
    tier,
    status,
    stripePriceId: priceId,
    currentPeriodStart: dates.currentPeriodStart,
    currentPeriodEnd: dates.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });

  console.log(`Subscription updated for user ${userId}: ${tier} (${status})`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.firebaseUserId;
  if (!userId) {
    console.error('No Firebase user ID in subscription metadata');
    return;
  }

  // Downgrade to free tier
  await updateUserSubscription(userId, {
    tier: 'free',
    status: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });

  console.log(`User ${userId} subscription deleted, downgraded to free`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Access subscription from raw invoice data
  const invoiceData = invoice as unknown as { subscription: string | null };
  const subscriptionId = invoiceData.subscription;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription;
  const userId = subscription.metadata?.firebaseUserId;

  if (!userId) {
    console.error('No Firebase user ID in subscription metadata');
    return;
  }

  await updateUserSubscription(userId, {
    status: 'past_due',
  });

  console.log(`Payment failed for user ${userId}, status set to past_due`);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // Access subscription from raw invoice data
  const invoiceData = invoice as unknown as { subscription: string | null };
  const subscriptionId = invoiceData.subscription;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription;
  const userId = subscription.metadata?.firebaseUserId;

  if (!userId) {
    console.error('No Firebase user ID in subscription metadata');
    return;
  }

  // Update period dates and confirm active status
  const dates = getSubscriptionDates(subscription);
  await updateUserSubscription(userId, {
    status: 'active',
    currentPeriodStart: dates.currentPeriodStart,
    currentPeriodEnd: dates.currentPeriodEnd,
  });

  console.log(`Invoice paid for user ${userId}, subscription renewed`);
}
