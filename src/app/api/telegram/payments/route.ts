import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';

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
 * Create a Telegram invoice link for the signed-in user.
 *
 * The invoice payload's userId is the verified Firebase uid, never a
 * caller-supplied id. Payment updates (pre_checkout_query and
 * successful_payment) are handled only by /api/telegram/webhook, behind
 * Telegram's secret-token check; this route has no update handler.
 */
export const POST = withAuth(async (request) => {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_PAYMENT_TOKEN) {
      return NextResponse.json(
        { error: 'Telegram payments not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { priceId, telegramId } = body;
    const userId = request.userId;
    if (body.userId !== undefined && body.userId !== userId) {
      return NextResponse.json(
        { error: 'User ID does not match the signed-in user' },
        { status: 403 }
      );
    }

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
});
