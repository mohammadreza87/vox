import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyTelegramWebhookToken, createWebhookForbiddenResponse } from '@/lib/telegram/verify';
import {
  getWebhookRateLimiter,
  getRateLimitIdentifier,
  checkRateLimitSecure,
} from '@/lib/ratelimit';
import { paidPlan } from '@/lib/telegram/prices';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/** Content-free diagnostics: a fixed code and the update kind, never the update body. */
function updateKind(body: Record<string, unknown> | null): string {
  if (!body || typeof body !== 'object') return 'invalid';
  if (body.pre_checkout_query) return 'pre_checkout_query';
  const message = body.message as Record<string, unknown> | undefined;
  if (message?.successful_payment) return 'successful_payment';
  if (message) return 'message';
  return 'other';
}

/**
 * POST /api/telegram/webhook
 * Webhook endpoint for Telegram Bot updates (payments, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const rateResult = await checkRateLimitSecure(
      getWebhookRateLimiter(),
      getRateLimitIdentifier(request, undefined),
      60,
      60_000
    );
    if (!rateResult.success && rateResult.response) {
      return rateResult.response;
    }

    // Verify webhook signature
    if (!verifyTelegramWebhookToken(request)) {
      console.error('Invalid Telegram webhook token');
      return createWebhookForbiddenResponse();
    }

    const body = await request.json();

    console.info(`telegram_webhook:${updateKind(body)}`);

    // Handle pre_checkout_query (payment validation)
    if (body.pre_checkout_query) {
      const query = body.pre_checkout_query;
      // Approve only an invoice for a known price at that price's amount and currency.
      const valid = paidPlan(query) !== null;
      if (!valid) console.warn('telegram_webhook:pre_checkout_rejected');

      const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerPreCheckoutQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(valid
            ? { pre_checkout_query_id: query.id, ok: true }
            : { pre_checkout_query_id: query.id, ok: false, error_message: 'This invoice is no longer valid. Please start the purchase again.' }),
        }
      );

      const result = await response.json().catch(() => null);
      if (!result?.ok) console.warn('telegram_webhook:pre_checkout_answer_failed');

      return NextResponse.json({ success: true });
    }

    // Handle successful_payment
    if (body.message?.successful_payment) {
      const payment = body.message.successful_payment;
      const telegramId = body.message.from?.id;

      // The entitlement comes only from a known price paid in full in its currency;
      // tier and duration come from the price table, never from the payload text.
      const plan = paidPlan(payment);
      if (!plan) {
        console.warn('telegram_webhook:payment_rejected');
        return NextResponse.json({ success: true });
      }
      const { priceId, userId, tier, durationDays } = plan;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      // Update user subscription in Firestore
      const adminDb = await getAdminDb();
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
      if (telegramId) await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramId,
            text: `🎉 Thank you for subscribing to Vox ${tier.charAt(0).toUpperCase() + tier.slice(1)}!\n\nYour subscription is now active and will expire on ${expiresAt.toLocaleDateString()}.\n\nEnjoy your premium features!`,
            parse_mode: 'HTML',
          }),
        }
      );

      console.info('telegram_webhook:subscription_updated');

      return NextResponse.json({ success: true });
    }

    // Handle other message types (optional)
    if (body.message?.text) {
      const chatId = body.message.chat.id;
      const text = body.message.text;

      // Respond to /start command
      if (text === '/start') {
        await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '👋 Welcome to Vox!\n\nTap the button below to open the app and start talking with AI contacts.',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: '🚀 Open Vox',
                    web_app: { url: 'https://vox-aicontact-fe0e3.web.app' }
                  }
                ]]
              }
            }),
          }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('telegram_webhook:error', error instanceof Error ? error.name : 'unknown');
    // Always return 200 to prevent Telegram from retrying
    return NextResponse.json({ success: true });
  }
}

/**
 * GET /api/telegram/webhook
 * Health check for webhook
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Telegram webhook endpoint' });
}
