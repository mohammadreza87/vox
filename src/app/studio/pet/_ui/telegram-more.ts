'use client';

/**
 * Telegram's Wave C Mini App calls (core.telegram.org/bots/webapps, read 26 Oct 2026), apart from telegram.ts so the
 * route never carries them: only the lazy sheets (Asks, share) import this. Each is guarded by `isVersionAtLeast` and
 * wrapped: an old client, the web client or a plain browser answers "unsupported" and the sheet's quiet path runs.
 *
 * - requestWriteAccess([cb]) 6.9: cb(granted: boolean)
 * - checkHomeScreenStatus([cb]) 8.0: unsupported | unknown | added | missed; addToHomeScreen() 8.0, then `homeScreenAdded`
 * - shareMessage(msg_id[, cb]) 8.0: msg_id from the Bot API's savePreparedInlineMessage; cb(sent: boolean)
 * - shareToStory(media_url[, { text, widget_link }]) 7.8: media_url must be HTTPS (a data: or blob: URL is not accepted)
 */

import { openTelegram, tg, type PetTelegram } from './telegram';

const at = (v: string, app: PetTelegram | null) => { try { return !!app?.isVersionAtLeast?.(v); } catch { return false; } };

/** The bot may already message this person (`allows_write_to_pm`, set by Telegram, read only as a hint). */
export const canWrite = (app: PetTelegram | null = tg()) => !!app?.initDataUnsafe?.user?.allows_write_to_pm;

/** Telegram's own write-access prompt (P2), after the person said Continue: true when granted, false when declined or unsupported. */
export function requestWriteAccess(app: PetTelegram | null = tg()): Promise<boolean> {
  return new Promise((resolve) => {
    if (!app?.requestWriteAccess || !at('6.9', app)) { resolve(false); return; }
    try { app.requestWriteAccess((ok) => resolve(!!ok)); } catch { resolve(false); }
  });
}

export type HomeStatus = 'unsupported' | 'unknown' | 'added' | 'missed';
/** Where the shortcut stands (P8 is offered only for `missed`, or `unknown`); within `ms` or `unsupported`. */
export function homeScreenStatus(app: PetTelegram | null = tg(), ms = 1500): Promise<HomeStatus> {
  return new Promise((resolve) => {
    if (!app?.checkHomeScreenStatus || !app.addToHomeScreen || !at('8.0', app)) { resolve('unsupported'); return; }
    const t = setTimeout(() => resolve('unsupported'), ms);
    try { app.checkHomeScreenStatus((s) => { clearTimeout(t); resolve(s ?? 'unknown'); }); } catch { clearTimeout(t); resolve('unsupported'); }
  });
}

/** Telegram's add-to-home-screen prompt; resolves true on `homeScreenAdded`, false when nothing came within `ms`. */
export function addToHomeScreen(app: PetTelegram | null = tg(), ms = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!app?.addToHomeScreen || !at('8.0', app)) { resolve(false); return; }
    const done = (ok: boolean) => { clearTimeout(t); try { app.offEvent?.('homeScreenAdded', added); } catch { /* old client */ } resolve(ok); };
    const added = () => done(true);
    const t = setTimeout(() => done(false), ms);
    try { app.onEvent?.('homeScreenAdded', added); app.addToHomeScreen(); } catch { done(false); }
  });
}

/** Share a prepared inline message (the server's savePreparedInlineMessage id); false when unsupported or not sent. */
export function shareMessage(msgId: string, app: PetTelegram | null = tg()): Promise<boolean> {
  return new Promise((resolve) => {
    if (!app?.shareMessage || !at('8.0', app)) { resolve(false); return; }
    try { app.shareMessage(msgId, (sent) => resolve(!!sent)); } catch { resolve(false); }
  });
}

/** The story editor with a hosted card (HTTPS only); false when unsupported. */
export function shareToStory(mediaUrl: string, text?: string, app: PetTelegram | null = tg()): boolean {
  if (!app?.shareToStory || !at('7.8', app) || !/^https:\/\//.test(mediaUrl)) return false;
  try { app.shareToStory(mediaUrl, text ? { text: text.slice(0, 200) } : undefined); return true; } catch { return false; }
}

/** Telegram's chat picker for a line and a link (t.me/share/url): works on every client inside Telegram. */
export function shareLink(url: string, text: string, app: PetTelegram | null = tg()): boolean {
  if (!app?.initData || !app.openTelegramLink) return false;
  openTelegram(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, app);
  return true;
}
