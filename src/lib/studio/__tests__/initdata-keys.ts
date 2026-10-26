/**
 * A test Ed25519 keypair standing in for Telegram's initData key (never the production key's private half, which only
 * Telegram has). makeStudio() trusts its public half; agentInit() signs initData the way Telegram does for a bot.
 */
import { generateKeyPairSync } from 'crypto';
import { botIdOfToken, signInitData, type InitDataUser } from '../auth';

const pair = generateKeyPairSync('ed25519');
export const TEST_INITDATA_PRIVATE_KEY = pair.privateKey;
export const TEST_INITDATA_KEY_HEX = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('hex');

/** The bot id Telegram would sign for: hire() tokens are `token-<botId>`, real-shaped ones `<botId>:…`. */
export const testBotId = (token: string) => { const m = /^token-(\d+)$/.exec(token); return m ? Number(m[1]) : botIdOfToken(token); };

/** initData as Telegram issues it for this bot: the HMAC with its token and Telegram's (test) Ed25519 signature. */
export function agentInit(user: InitDataUser, token: string, authDate?: number, extra: Record<string, string> = {}, botId = testBotId(token)): string {
  return signInitData(user, token, authDate, extra, { botId, privateKey: TEST_INITDATA_PRIVATE_KEY });
}
