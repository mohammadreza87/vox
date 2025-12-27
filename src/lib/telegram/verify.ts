import { createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify Telegram webhook requests using the secret token
 *
 * Telegram allows you to set a secret token when registering a webhook.
 * This token is sent in the X-Telegram-Bot-Api-Secret-Token header.
 *
 * @see https://core.telegram.org/bots/api#setwebhook
 */
export function verifyTelegramWebhookToken(request: NextRequest): boolean {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  // If no secret is configured, skip verification (but log a warning)
  if (!webhookSecret) {
    console.warn('TELEGRAM_WEBHOOK_SECRET not configured - webhook verification skipped');
    return true;
  }

  const providedToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');

  if (!providedToken) {
    console.error('Missing X-Telegram-Bot-Api-Secret-Token header');
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (providedToken.length !== webhookSecret.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < providedToken.length; i++) {
    result |= providedToken.charCodeAt(i) ^ webhookSecret.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Verify Telegram Mini App init data hash
 *
 * Used to verify that init data came from Telegram
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(initData: string, botToken: string): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) {
      return false;
    }

    // Remove hash from params for verification
    params.delete('hash');

    // Sort params and create data check string
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Create secret key
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Create hash
    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch (error) {
    console.error('Error verifying Telegram init data:', error);
    return false;
  }
}

/**
 * Verify Telegram Login Widget data
 *
 * Used to verify that login data came from Telegram
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLoginData(
  data: Record<string, string>,
  botToken: string
): boolean {
  try {
    const { hash, ...otherData } = data;

    if (!hash) {
      return false;
    }

    // Create data check string
    const dataCheckString = Object.keys(otherData)
      .sort()
      .map((key) => `${key}=${otherData[key]}`)
      .join('\n');

    // Create secret key (SHA256 of bot token)
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Create hash
    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return calculatedHash === hash;
  } catch (error) {
    console.error('Error verifying Telegram login data:', error);
    return false;
  }
}

/**
 * Check if the auth_date is within acceptable range (24 hours)
 */
export function isAuthDateValid(authDate: number, maxAgeSeconds: number = 86400): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - authDate < maxAgeSeconds;
}

/**
 * Create a forbidden response for failed webhook verification
 */
export function createWebhookForbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Forbidden', code: 'INVALID_WEBHOOK_TOKEN' },
    { status: 403 }
  );
}
