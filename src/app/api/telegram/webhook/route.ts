import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyTelegramWebhookToken, createWebhookForbiddenResponse } from '@/lib/telegram/verify';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * POST /api/telegram/webhook
 * Webhook endpoint for Telegram Bot updates (payments, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify webhook signature
    if (!verifyTelegramWebhookToken(request)) {
      console.error('Invalid Telegram webhook token');
      return createWebhookForbiddenResponse();
    }

    const body = await request.json();

    console.log('Telegram webhook received:', JSON.stringify(body, null, 2));

    // Handle pre_checkout_query (payment validation)
    if (body.pre_checkout_query) {
      const query = body.pre_checkout_query;

      console.log('Pre-checkout query:', query);

      // Validate the payment - accept all for now
      // You can add custom validation here (check stock, user eligibility, etc.)
      const response = await fetch(
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

      const result = await response.json();
      console.log('Pre-checkout response:', result);

      return NextResponse.json({ success: true });
    }

    // Handle successful_payment
    if (body.message?.successful_payment) {
      const payment = body.message.successful_payment;
      const telegramId = body.message.from.id;

      console.log('Successful payment:', payment);

      let payload;
      try {
        payload = JSON.parse(payment.invoice_payload);
      } catch {
        console.error('Failed to parse payment payload:', payment.invoice_payload);
        return NextResponse.json({ success: true });
      }

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
      await fetch(
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

      console.log(`Subscription updated for user ${userId}: ${tier} until ${expiresAt.toISOString()}`);

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
    console.error('Telegram webhook error:', error);
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
