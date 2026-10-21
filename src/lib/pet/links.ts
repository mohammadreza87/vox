/**
 * Where each agent's pet page lives (brief §3.9): the bot's menu button and the /start web_app
 * button open `<STUDIO_WEBAPP_URL>/pet/<agentId>`. Telegram only opens HTTPS Mini Apps, so a
 * missing or non-HTTPS Studio URL means no entry point (never a broken button).
 */

import { PET_PAGE_BASE } from './types';

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Telegram shows short menu labels; longer names fall back to this. */
export const MENU_FALLBACK = 'Play';
export const MENU_MAX_CHARS = 16;

/** `https://host/studio/pet/<agentId>`, or null when the Studio URL can't host a Mini App. */
export function petPageUrl(webAppUrl: string | undefined, agentId: string): string | null {
  if (process.env.STUDIO_PET_DISABLED === '1' || !webAppUrl || !AGENT_ID.test(agentId)) return null;
  let base: URL;
  try { base = new URL(webAppUrl); } catch { return null; }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return null;
  return `${base.origin}${PET_PAGE_BASE}/${agentId}`;
}

/** The menu button label: the agent's first name if it fits (≤ 16 characters), else "Play". */
export function menuLabel(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const length = Array.from(first).length;
  return length > 0 && length <= MENU_MAX_CHARS ? first : MENU_FALLBACK;
}
