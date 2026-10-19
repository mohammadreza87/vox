/**
 * Telegram Mini App authentication: the client sends Telegram.WebApp.initData
 * in the X-Telegram-Init-Data header; we verify its HMAC with the VoxxBot
 * token (constant time) and reject data older than 24 hours.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86_400, nowSeconds = Math.floor(Date.now() / 1000)): InitDataUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSeconds - authDate > maxAgeSeconds) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as InitDataUser | null;
    return user && Number.isSafeInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

/** Test helper and local-dev tool: build a valid initData string. */
export function signInitData(user: InitDataUser, botToken: string, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
