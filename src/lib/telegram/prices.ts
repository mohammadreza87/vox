/**
 * Telegram Payments price table, shared by the invoice route (POST
 * /api/telegram/payments) and the update handler (/api/telegram/webhook) so a
 * payment update is checked against the same amounts the invoice was created with.
 */

/** Amounts in the smallest currency unit (cents for USD). */
export const TELEGRAM_PRICES = {
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
} as const;

export type TelegramPriceId = keyof typeof TELEGRAM_PRICES;

export const TELEGRAM_PAYMENT_CURRENCY = 'USD';

export function isTelegramPriceId(value: unknown): value is TelegramPriceId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TELEGRAM_PRICES, value);
}

export interface TelegramPaidPlan {
  priceId: TelegramPriceId;
  userId: string;
  tier: 'pro' | 'max';
  durationDays: number;
}

/**
 * The plan an invoice payment pays for, or null when the payload does not name a
 * known price and a user, or the amount or currency differs from that price.
 * Used for both pre_checkout_query and successful_payment.
 */
export function paidPlan(payment: { invoice_payload?: unknown; total_amount?: unknown; currency?: unknown }): TelegramPaidPlan | null {
  if (typeof payment.invoice_payload !== 'string') return null;
  let payload: unknown;
  try { payload = JSON.parse(payment.invoice_payload); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  const { priceId, userId } = payload as { priceId?: unknown; userId?: unknown };
  if (!isTelegramPriceId(priceId) || typeof userId !== 'string' || !userId || userId.includes('/')) return null;
  if (payment.total_amount !== TELEGRAM_PRICES[priceId].amount || payment.currency !== TELEGRAM_PAYMENT_CURRENCY) return null;
  return { priceId, userId, tier: priceId.startsWith('max') ? 'max' : 'pro', durationDays: priceId.endsWith('_annual') ? 365 : 30 };
}
