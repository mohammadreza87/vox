import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { TELEGRAM_PAYMENT_CURRENCY, TELEGRAM_PRICES, isTelegramPriceId } from '@/lib/telegram/prices';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_PAYMENT_TOKEN = process.env.TELEGRAM_PAYMENT_TOKEN;

/**
 * POST /api/telegram/payments
 * Create a Telegram invoice link for the signed-in user.
 *
 * The invoice payload's userId is the verified Firebase uid, never a
 * caller-supplied id. Payment updates (pre_checkout_query and
 * successful_payment) are handled only by /api/telegram/webhook, which checks
 * the payload's price, amount and currency against the same table. That route
 * verifies Telegram's secret token only when TELEGRAM_WEBHOOK_SECRET is set (or
 * rejects everything with TELEGRAM_WEBHOOK_FAIL_CLOSED=1); without either it is
 * unauthenticated, so a deployment must set the secret before taking payments.
 * This route has no update handler.
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

    // An own-property check: 'constructor' or 'toString' must not reach the price lookup (F180).
    if (!isTelegramPriceId(priceId)) {
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

    const price = TELEGRAM_PRICES[priceId];

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
          currency: TELEGRAM_PAYMENT_CURRENCY,
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
