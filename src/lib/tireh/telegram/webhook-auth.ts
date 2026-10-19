import { timingSafeEqual } from 'crypto';

/** Constant-time check of Telegram's X-Telegram-Bot-Api-Secret-Token. Fails closed. */
export function isValidWebhookSecret(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
