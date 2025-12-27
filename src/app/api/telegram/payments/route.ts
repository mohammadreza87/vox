import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_PAYMENT_TOKEN = process.env.TELEGRAM_PAYMENT_TOKEN;

// Price IDs for Telegram (in smallest currency unit - cents for USD)
const PRICES = {
  pro_monthly: {
    amount: 999, // $9.99
    label: 'Vox Pro - Monthly',
    description: 'Unlimited messages, 3 voice clones, 10 custom contacts',
  },
  pro_annual: {
    amount: 9999, // $99.99
    label: 'Vox Pro - Annual',
    description: 'Unlimited messages, 3 voice clones, 10 custom contacts (Save 17%)',
  },
  max_monthly: {
    amount: 2999, // $29.99
    label: 'Vox Max - Monthly',
    description: 'Everything in Pro + unlimited voice clones & custom contacts',
  },
  max_annual: {
    amount: 29999, // $299.99
    label: 'Vox Max - Annual',
    description: 'Everything in Pro + unlimited voice clones & custom contacts (Save 17%)',
  },
};

type PriceId = keyof typeof PRICES;

/**
 * POST /api/telegram/payments
 * Create a Telegram invoice link
 */
export async function POST(request: NextRequest) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_PAYMENT_TOKEN) {
      return NextResponse.json(
        { error: 'Telegram payments not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { priceId, userId, telegramId } = body;

    if (!priceId || !PRICES[priceId as PriceId]) {
      return NextResponse.json(
        { error: 'Invalid price ID' },
        { status: 400 }
      );
    }

    if (!userId || !telegramId) {
      return NextResponse.json(
        { error: 'Missing user ID or Telegram ID' },
        { status: 400 }
      );
    }

    const price = PRICES[priceId as PriceId];

    // Create invoice link using Telegram Bot API
    const invoiceResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: price.label,
          description: price.description,
          payload: JSON.stringify({ priceId, userId, telegramId }),
          provider_token: TELEGRAM_PAYMENT_TOKEN,
          currency: 'USD',
          prices: [
            {
              label: price.label,
              amount: price.amount,
            },
          ],
        }),
      }
    );

    const invoiceData = await invoiceResponse.json();

    if (!invoiceData.ok) {
      console.error('Telegram invoice error:', invoiceData);
      return NextResponse.json(
        { error: invoiceData.description || 'Failed to create invoice' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      invoiceLink: invoiceData.result,
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create payment' },
      { status: 500 }
    );
  }
}

/**
 * Webhook handler for Telegram payment updates
 * This should be called by Telegram's webhook
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle pre_checkout_query (payment validation)
    if (body.pre_checkout_query) {
      const query = body.pre_checkout_query;

      // Validate the payment - you can add custom validation here
      // For now, we'll accept all payments
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pre_checkout_query_id: query.id,
            ok: true,
          }),
        }
      );

      return NextResponse.json({ success: true });
    }

    // Handle successful_payment
    if (body.message?.successful_payment) {
      const payment = body.message.successful_payment;
      const payload = JSON.parse(payment.invoice_payload);
      const { priceId, userId } = payload;

      // Determine subscription tier and duration
      const tier = priceId.startsWith('max') ? 'max' : 'pro';
      const isAnnual = priceId.includes('annual');
      const durationDays = isAnnual ? 365 : 30;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      // Update user subscription in Firestore
      const userRef = adminDb.collection('users').doc(userId);
      const subscriptionRef = userRef.collection('data').doc('subscription');

      await subscriptionRef.set({
        tier,
        status: 'active',
        provider: 'telegram',
        telegramPaymentId: payment.telegram_payment_charge_id,
        providerPaymentId: payment.provider_payment_charge_id,
        priceId,
        amount: payment.total_amount,
        currency: payment.currency,
        subscribedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        // Reset usage counters
        messagesUsed: 0,
        voiceClonesUsed: 0,
        customContactsUsed: 0,
      }, { merge: true });

      // Send confirmation message to user
      const telegramId = body.message.from.id;
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramId,
            text: `🎉 Thank you for subscribing to Vox ${tier.charAt(0).toUpperCase() + tier.slice(1)}!\n\nYour subscription is now active and will expire on ${expiresAt.toLocaleDateString()}.\n\nEnjoy your premium features!`,
          }),
        }
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Payment webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
