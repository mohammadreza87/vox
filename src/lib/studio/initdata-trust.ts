/**
 * Which initData Vox trusts, and how much (the agent-signed trust hotfix).
 *
 * - **Agent-signed** (an agent bot's token): its creator owns the bot and can read the token, so the HMAC alone is
 *   forgeable for any Telegram id. Telegram's Ed25519 `signature` is required. Only the low-value pet routes (look,
 *   care, the launch lookup) may accept a missing signature, and only under the emergency switch
 *   STUDIO_INITDATA_SIGNATURE=shadow (deps.initDataSignature). Nothing that erases, discloses, consents, talks as the
 *   person or touches connections is ever authorised by agent-signed initData without a valid signature.
 * - **Manager-signed** (VOXX_BOT_TOKEN): only Vox holds that token, so the HMAC already proves Telegram launched
 *   Vox's own bot. A signature that is present must verify; a missing one is accepted (no lockout of old clients).
 *
 * Telemetry is content-free: `{ type: 'initdata_signature', surface, outcome }`, never an id, a name or initData.
 */

import { botIdOfToken, verifyBotInitData, type InitDataSigner, type InitDataUser } from './auth';
import type { Studio } from './service';

export type InitDataSurface = 'pet' | 'pet_launch' | 'connections' | 'my_data';
export type SignatureMode = 'enforce' | 'shadow';

const VALID_LOG_MS = 10 * 60_000;
const lastValid = new Map<string, number>();

function report(studio: Studio, surface: InitDataSurface, outcome: string) {
  const log = studio.deps.logger ?? console;
  if (outcome === 'valid') {
    // A healthy signal for the rollout smoke test, without a line per tap.
    const now = Date.now(), at = lastValid.get(surface) ?? 0;
    if (now - at < VALID_LOG_MS) return;
    lastValid.set(surface, now);
    log.info({ type: 'initdata_signature', surface, outcome });
    return;
  }
  log.warn({ type: 'initdata_signature', surface, outcome });
}

const mode = (studio: Studio): SignatureMode => {
  try { return studio.deps.initDataSignature?.() === 'shadow' ? 'shadow' : 'enforce'; } catch { return 'enforce'; }
};

/**
 * initData signed by an agent's own bot. `relaxable`: this route may run on a missing signature while the shadow
 * switch is on. `maxAgeSeconds`: a tighter window than the 24 h default (talk and consent).
 */
export function verifyAgentInitData(studio: Studio, initData: string, signer: InitDataSigner, surface: InitDataSurface,
  o: { relaxable?: boolean; maxAgeSeconds?: number } = {}): InitDataUser | null {
  const requireSignature = !(o.relaxable && mode(studio) === 'shadow');
  const result = verifyBotInitData(initData, signer, { key: studio.deps.initDataKey, requireSignature, maxAgeSeconds: o.maxAgeSeconds });
  // A failed HMAC is someone else's bot or junk: not a signature signal.
  if (result.signature !== 'hmac_failed') report(studio, surface, result.user && result.signature === 'missing' ? 'missing_accepted' : result.signature);
  return result.user;
}

/**
 * After a refusal under a tighter `maxAgeSeconds`: true when this initData is genuine (HMAC and Telegram's signature
 * both verify) and only past that window, still inside the 24 h default. The pet then says "reopen me" instead of
 * treating a long-open Mini App as an outsider. Authorises nothing; no telemetry (the strict call already reported).
 */
export function agentInitDataExpired(studio: Studio, initData: string, signer: InitDataSigner): boolean {
  return verifyBotInitData(initData, signer, { key: studio.deps.initDataKey, requireSignature: true }).user !== null;
}

/** initData signed by the manager bot (VOXX_BOT_TOKEN). A present signature must verify. */
export function verifyManagerInitData(studio: Studio, initData: string, managerToken: string, surface: InitDataSurface): InitDataUser | null {
  if (!managerToken) return null;
  const botId = botIdOfToken(managerToken);
  const result = verifyBotInitData(initData, { token: managerToken, botId }, { key: studio.deps.initDataKey, requireSignature: false });
  if (result.signature === 'invalid') report(studio, surface, 'invalid');
  return result.user;
}
