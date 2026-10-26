/**
 * Detects a bot whose updates are no longer reaching Vox, and tells the operator. Never acts.
 *
 * An agent bot's creator owns it and can read its token in BotFather. With the token they can set a webhook of their
 * own or run a competing getUpdates poller, and read every message people send that agent from then on. Vox cannot
 * prevent that (it is the token's power), only notice it: long polling then fails with a conflict, and
 * getWebhookInfo shows a webhook Vox never set (production polls, so any webhook is foreign).
 *
 * The poll loop (bots.ts) feeds every failure to an IntegrityWatch; after a sustained pattern it probes
 * getWebhookInfo at most once a minute and reports one of:
 *  - webhook_foreign: a webhook URL is set on a bot Vox polls;
 *  - poll_conflict: repeated getUpdates conflicts and no webhook (another poller holds the token);
 *  - token_rejected: Telegram refuses the token (changed or revoked in BotFather).
 * The alert is a content-free log line (the internal agent id, never a URL, token or message), an `agent.integrity`
 * audit row, and a VoxxBot DM to each superadmin (EN and FA), at most once per bot and reason every 6 hours.
 * Nothing is deleted, re-pointed or stopped: no deleteWebhook/setWebhook, no agent is fired or paused.
 */

import type { TelegramBotClient } from '../tireh/telegram/client';
import type { Studio } from './service';

export type IntegrityReason = 'webhook_foreign' | 'poll_conflict' | 'token_rejected';

/** Failures must last this long (continuously, or as repeated conflicts) before a probe. */
export const INTEGRITY_AFTER_MS = 60_000;
/** getWebhookInfo at most this often per bot. */
export const INTEGRITY_PROBE_MS = 60_000;
/** Conflicts counted over this window; successes in between do not clear them (a competing poller alternates). */
const CONFLICT_WINDOW_MS = 10 * 60_000;
const CONFLICTS_TO_PROBE = 4;
/** A probe that hangs must never stall the poll loop. */
const PROBE_TIMEOUT_MS = 10_000;
/** One alert per bot and reason per this period, per process. */
export const INTEGRITY_ALERT_EVERY_MS = 6 * 3_600_000;

function classify(error: unknown): { conflict: boolean; unauthorized: boolean } {
  const e = (error ?? {}) as { errorCode?: unknown; description?: unknown };
  const code = typeof e.errorCode === 'number' ? e.errorCode : undefined;
  const text = typeof e.description === 'string' ? e.description : '';
  return { conflict: code === 409 || /\bconflict\b/i.test(text), unauthorized: code === 401 || /\bunauthorized\b/i.test(text) };
}

/** Per poll loop. `failed` returns a reason to report, or null; `succeeded` clears the continuous-failure clock. */
export class IntegrityWatch {
  private failingSince: number | undefined;
  private lastProbe = -Infinity;
  private conflicts: number[] = [];
  private unauthorized = false;
  /**
   * The last probe found a webhook and polling has not succeeded since. Only then may the loop retry slower: while a
   * webhook is set, getUpdates can never win an update. Against a competing poller it must not slow down, since
   * every update the rival's pending poll takes while Vox sleeps is lost to Vox.
   */
  webhookSeen = false;

  constructor(private readonly bot: Pick<TelegramBotClient, 'getWebhookInfo'>, private readonly now: () => number = Date.now) {}

  succeeded() { this.failingSince = undefined; this.unauthorized = false; this.webhookSeen = false; }

  async failed(error: unknown): Promise<IntegrityReason | null> {
    const now = this.now();
    const c = classify(error);
    this.failingSince ??= now;
    this.unauthorized ||= c.unauthorized;
    if (!c.conflict) this.webhookSeen = false;
    if (c.conflict) this.conflicts.push(now);
    this.conflicts = this.conflicts.filter((t) => now - t <= CONFLICT_WINDOW_MS);
    const conflicted = this.conflicts.length >= CONFLICTS_TO_PROBE && now - this.conflicts[0] >= INTEGRITY_AFTER_MS;
    const stuck = now - this.failingSince >= INTEGRITY_AFTER_MS;
    if ((!conflicted && !stuck) || now - this.lastProbe < INTEGRITY_PROBE_MS) return null;
    this.lastProbe = now;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const info = await Promise.race([this.bot.getWebhookInfo(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS); })])
        .finally(() => clearTimeout(timer));
      if (info === null) return null;
      this.webhookSeen = typeof info?.url === 'string' && info.url !== '';
      if (this.webhookSeen) return 'webhook_foreign';
      return conflicted ? 'poll_conflict' : null;
    } catch (probeError) {
      return classify(probeError).unauthorized || this.unauthorized ? 'token_rejected' : null;
    }
  }
}

const COPY: Record<IntegrityReason, { en: (bot: string) => string; fa: (bot: string) => string }> = {
  webhook_foreign: {
    en: (bot) => `Vox alert: ${bot} has a webhook that Vox did not set, so its messages are going somewhere else. Whoever holds this bot's token may be reading them. Vox changed nothing.`,
    fa: (bot) => `هشدار وکس: برای ${bot} وب‌هوکی تنظیم شده که وکس آن را تنظیم نکرده است، پس پیام‌هایش جای دیگری می‌رود. ممکن است دارندهٔ توکن این بات آن‌ها را بخواند. وکس چیزی را تغییر نداد.`,
  },
  poll_conflict: {
    en: (bot) => `Vox alert: another program keeps fetching ${bot}'s updates, so some of its messages are not reaching Vox. Whoever holds this bot's token may be reading them. Vox changed nothing.`,
    fa: (bot) => `هشدار وکس: برنامهٔ دیگری مدام به‌روزرسانی‌های ${bot} را می‌گیرد، پس بعضی پیام‌هایش به وکس نمی‌رسد. ممکن است دارندهٔ توکن این بات آن‌ها را بخواند. وکس چیزی را تغییر نداد.`,
  },
  token_rejected: {
    en: (bot) => `Vox alert: Telegram no longer accepts ${bot}'s token. It was probably changed or revoked in BotFather. Vox changed nothing.`,
    fa: (bot) => `هشدار وکس: تلگرام دیگر توکن ${bot} را نمی‌پذیرد. احتمالاً در BotFather عوض یا باطل شده است. وکس چیزی را تغییر نداد.`,
  },
};

/** The superadmin DM, both languages (Vox does not know an operator's language here). Never a URL or a token. */
export const integrityMessage = (reason: IntegrityReason, bot: string) => `${COPY[reason].en(bot)}\n\n${COPY[reason].fa(bot)}`;

/** The reporter the poll loops share: throttled log + audit row + superadmin DMs. `target` is an agent id or 'manager'. */
export function integrityReporter(studio: Studio): (target: string, reason: IntegrityReason) => Promise<void> {
  const last = new Map<string, number>();
  const log = studio.deps.logger ?? console;
  return async (target, reason) => {
    const now = Date.now(), key = `${target}:${reason}`;
    if (now - (last.get(key) ?? -Infinity) < INTEGRITY_ALERT_EVERY_MS) return;
    last.set(key, now);
    log.warn({ type: 'bot_integrity', target, reason, outcome: 'alerted' });
    try { await studio.deps.store.audit({ actor: 'system', action: 'agent.integrity', target, detail: reason }); }
    catch { log.warn({ type: 'bot_integrity', target, reason, outcome: 'audit_failed' }); }
    let alerts = true;
    try { alerts = studio.deps.integrityAlerts?.() !== false; } catch { alerts = true; }
    const manager = studio.deps.managerBot;
    if (!alerts || !manager) return;
    let state: Awaited<ReturnType<Studio['deps']['store']['read']>> | null = null;
    try { state = await studio.deps.store.read(); } catch { state = null; }
    const agent = target === 'manager' ? undefined : state?.agents.find((a) => a.id === target);
    const bot = target === 'manager' ? `@${studio.deps.managerUsername.replace(/^@/, '')}`
      : agent ? `${agent.persona.name}${agent.bot?.username ? ` (@${agent.bot.username})` : ''}` : 'an agent bot';
    const admins = new Set<number>([...studio.deps.superadminIds,
      ...(state?.members ?? []).filter((m) => m.role === 'superadmin' || m.role === 'owner').map((m) => m.telegramId)]);
    for (const id of admins) {
      try { await manager.sendMessage(id, integrityMessage(reason, bot)); }
      catch { log.warn({ type: 'bot_integrity', target, reason, outcome: 'dm_failed' }); }
    }
  };
}
