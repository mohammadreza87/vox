/**
 * Telegram Mini App authentication: the client sends Telegram.WebApp.initData
 * in the X-Telegram-Init-Data header; we verify its HMAC with the VoxxBot
 * token (constant time) and reject data older than 24 hours.
 *
 * An agent bot's token is not Vox's alone: a managed bot's creator owns it and can read it in BotFather, so an
 * HMAC made with it proves nothing about who the person is. Agent-signed initData must also carry Telegram's
 * Ed25519 `signature` (verifyBotInitData, used through initdata-trust.ts).
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * @see https://core.telegram.org/bots/webapps#validating-data-for-third-party-use
 */

import { createHmac, createPublicKey, sign as edSign, timingSafeEqual, verify as edVerify, type KeyObject } from 'crypto';

export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86_400, nowSeconds = Math.floor(Date.now() / 1000)): InitDataUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  // Different parsers must never disagree about the authenticated identity.
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) return null;
  }
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
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as InitDataUser | null;
    return user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.first_name === 'string' ? user : null;
  } catch {
    return null;
  }
}

/**
 * Telegram's Ed25519 public keys for "Validating data for Third-Party Use" (core.telegram.org/bots/webapps, Bot API 8.0),
 * checked 2026-10-25. Telegram signs every Mini App's initData with its own key, so a bot token holder cannot produce
 * this signature: it is what tells a real Telegram launch from initData forged with an agent bot's token.
 */
export const TELEGRAM_INITDATA_KEYS = {
  production: 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d',
  test: '40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec',
} as const;
/** DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const publicKeys = new Map<string, KeyObject | null>();
function ed25519PublicKey(hex: string): KeyObject | null {
  let key = publicKeys.get(hex);
  if (key !== undefined) return key;
  try { key = /^[0-9a-f]{64}$/.test(hex) ? createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' }) : null; }
  catch { key = null; }
  if (publicKeys.size < 8) publicKeys.set(hex, key);
  return key;
}

/** `<bot_id>:WebAppData\n` and every received field except hash and signature, sorted, `key=value`, one per line. */
function thirdPartyCheckString(params: URLSearchParams, botId: number): string {
  return `${botId}:WebAppData\n` + [...params.entries()].filter(([k]) => k !== 'hash' && k !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
}

export type InitDataSignature = 'valid' | 'missing' | 'invalid';
/**
 * Telegram's own Ed25519 `signature` over initData for bot `botId`. 'missing' when the field is absent (a client
 * that predates Bot API 8.0), 'invalid' for anything else that does not verify. Never throws.
 */
export function checkInitDataSignature(initData: string, botId: number, publicKeyHex: string = TELEGRAM_INITDATA_KEYS.production): InitDataSignature {
  try {
    if (!Number.isSafeInteger(botId) || botId <= 0) return 'invalid';
    const params = new URLSearchParams(initData);
    for (const key of params.keys()) if (params.getAll(key).length !== 1) return 'invalid';
    const given = params.get('signature');
    if (given === null) return 'missing';
    // base64url of 64 bytes: 86 characters unpadded (padding tolerated, nothing else)
    if (!/^[A-Za-z0-9_-]{86}(?:==)?$/.test(given)) return 'invalid';
    const signature = Buffer.from(given.replace(/=+$/, ''), 'base64url');
    const key = ed25519PublicKey(publicKeyHex);
    if (signature.length !== 64 || !key) return 'invalid';
    return edVerify(null, Buffer.from(thirdPartyCheckString(params, botId)), key, signature) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}

/** A bot's token (for the HMAC) and its numeric id (for the Ed25519 check-string). */
export interface InitDataSigner { token: string; botId: number }
/** The numeric bot id a token starts with (`123456:ABC…`), or 0 when it has none. */
export const botIdOfToken = (token: string): number => { const m = /^([1-9]\d{0,15}):/.exec(token); return m ? Number(m[1]) : 0; };

export type BotInitDataResult =
  | { user: InitDataUser; signature: 'valid' | 'missing' }
  | { user: null; signature: InitDataSignature | 'hmac_failed' };
/**
 * Both checks: the bot's HMAC `hash` (verifyInitData, unchanged) and Telegram's Ed25519 `signature`. An invalid
 * signature is always refused; a missing one only when `requireSignature`. The HMAC string covers `signature` too.
 */
export function verifyBotInitData(initData: string, signer: InitDataSigner,
  o: { key?: string; requireSignature: boolean; maxAgeSeconds?: number; nowSeconds?: number }): BotInitDataResult {
  const user = verifyInitData(initData, signer.token, o.maxAgeSeconds, o.nowSeconds);
  if (!user) return { user: null, signature: 'hmac_failed' };
  const signature = checkInitDataSignature(initData, signer.botId, o.key ?? TELEGRAM_INITDATA_KEYS.production);
  if (signature === 'invalid' || (signature === 'missing' && o.requireSignature)) return { user: null, signature };
  return { user, signature };
}

/**
 * Test helper and local-dev tool: build a valid initData string. `extra`: more signed fields (start_param, chat_type…).
 * `signer`: also add Telegram's Ed25519 `signature` with this (test) private key, as Telegram does for bot `botId`.
 */
export function signInitData(user: InitDataUser, botToken: string, authDate = Math.floor(Date.now() / 1000), extra: Record<string, string> = {},
  signer?: { botId: number; privateKey: KeyObject }): string {
  const params = new URLSearchParams({ ...extra, auth_date: String(authDate), user: JSON.stringify(user) });
  if (signer) params.set('signature', edSign(null, Buffer.from(thirdPartyCheckString(params, signer.botId)), signer.privateKey).toString('base64url'));
  const dataCheckString = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}
