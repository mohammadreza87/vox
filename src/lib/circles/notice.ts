/**
 * The agent DM card (UX-17) and its receipts, EN and FA with meaning parity (PRIV-036). Evidence
 * records the notice id and version plus copyHash: sha256 of the exact rendered text and button
 * labels, so a stored choice proves what was shown. A material copy change bumps AGENT_NOTICE.version.
 */

import { createHash } from 'crypto';
import type { JoinChoice } from '../studio/types';

export type CircleLocale = 'en' | 'fa';
/** agent-v2: the Persian card names Telegram's «شروع» button as Persian Telegram shows it. */
export const AGENT_NOTICE = { id: 'notice:agent_choice', version: 'agent-v2' } as const;

/** Telegram's language_code picks the copy; anything but Persian reads English. */
export const localeOf = (code?: string): CircleLocale => /^fa\b/i.test(code ?? '') ? 'fa' : 'en';

export const copyHash = (text: string, labels: readonly string[]) =>
  createHash('sha256').update(JSON.stringify([text, ...labels])).digest('hex');

const COPY = {
  en: {
    card: (n: string) => `Hi, I'm ${n} 🐾\n\nTalk with ${n} privately. Join also lets ${n} keep your own notes and use notes from groups you join.\n\nOnly reply to me: I answer you and keep no notes about you. Not me: I stay quiet. Join is for adults (18+). Pressing Start alone chooses nothing.`,
    now: { joined: 'Your choice now: Join.', reply_only: 'Your choice now: Only reply to me.', declined: 'Your choice now: Not me.' },
    join: 'Join · 18+', reply: 'Only reply to me', decline: 'Not me', open: (n: string) => `Open ${n} 🐾`,
    chosen: {
      joined: (n: string) => `You joined ${n}. Talk with me any time. Send /leave to undo.`,
      reply_only: () => `Got it: I'll reply to you and keep no notes. Send /leave to undo.`,
      declined: () => `Okay, I'll stay quiet. Send /start if you change your mind.`,
    },
    expired: 'This card has expired. Send /start for a fresh one.',
    notYours: 'This card is for someone else. Send /start to get your own.',
    used: 'You already chose on this card. Send /start to change it.',
    early: 'One moment, then tap again.',
    soon: "This button isn't available yet.",
    left: (n: string) => `Done. ${n} won't reply until you choose again, and your choice and its cards are deleted. Send /start any time.`,
    notChosen: "You haven't chosen anything with me. Send /start to see your options.",
    notInGroup: "This link is for a group you're not in.",
    nothingKept: "I keep no notes about you here, so there's nothing to pause or clear. Send /leave if you'd like me to stop replying.",
    limit: "I've enjoyed talking, but I need a break. Let's pick this up tomorrow.",
  },
  fa: {
    card: (n: string) => `سلام، من ${n} هستم 🐾\n\nبا ${n} خصوصی گفتگو کنید. «می‌پیوندم» همچنین به ${n} اجازه می‌دهد یادداشت‌های خودتان را نگه دارد و از یادداشت‌های گروه‌هایی که به آن‌ها می‌پیوندید استفاده کند.\n\nفقط به من جواب بده: جواب می‌دهم و هیچ یادداشتی درباره شما نگه نمی‌دارم. مرا حساب نکن: ساکت می‌مانم. پیوستن فقط برای بزرگسالان (۱۸+) است. فشردن «شروع» به‌تنهایی چیزی را انتخاب نمی‌کند.`,
    now: { joined: 'انتخاب فعلی شما: می‌پیوندم.', reply_only: 'انتخاب فعلی شما: فقط به من جواب بده.', declined: 'انتخاب فعلی شما: مرا حساب نکن.' },
    join: 'می‌پیوندم · ۱۸+', reply: 'فقط به من جواب بده', decline: 'مرا حساب نکن', open: (n: string) => `باز کردن ${n} 🐾`,
    chosen: {
      joined: (n: string) => `به ${n} پیوستید. هر وقت خواستید با من حرف بزنید. برای لغو /leave را بفرستید.`,
      reply_only: () => `باشه: به شما جواب می‌دهم و یادداشتی نگه نمی‌دارم. برای لغو /leave را بفرستید.`,
      declined: () => `باشه، ساکت می‌مانم. اگر نظرتان عوض شد /start را بفرستید.`,
    },
    expired: 'این کارت منقضی شده است. برای کارت تازه /start را بفرستید.',
    notYours: 'این کارت مال کس دیگری است. برای کارت خودتان /start را بفرستید.',
    used: 'روی این کارت قبلاً انتخاب کرده‌اید. برای تغییر /start را بفرستید.',
    early: 'یک لحظه صبر کنید و دوباره بزنید.',
    soon: 'این دکمه هنوز فعال نیست.',
    left: (n: string) => `انجام شد. ${n} تا وقتی دوباره انتخاب نکنید جواب نمی‌دهد، و انتخاب شما و کارت‌هایش پاک شد. هر وقت خواستید /start را بفرستید.`,
    notChosen: 'هنوز چیزی انتخاب نکرده‌اید. برای دیدن گزینه‌ها /start را بفرستید.',
    notInGroup: 'این پیوند برای گروهی است که شما در آن نیستید.',
    nothingKept: 'اینجا هیچ یادداشتی درباره شما نگه نمی‌دارم، پس چیزی برای توقف یا پاک کردن نیست. اگر می‌خواهید دیگر جواب ندهم /leave را بفرستید.',
    limit: 'از گفتگو لذت بردم، ولی باید کمی استراحت کنم. فردا ادامه بدهیم.',
  },
} as const;

export const circleCopy = (locale: CircleLocale) => COPY[locale];

export interface AgentCard {
  text: string;
  locale: CircleLocale;
  labels: { join: string; reply: string; decline: string; open: string };
  copyHash: string;
}

/** The agent-level DM card, with the person's current choice when they have one. `pet` adds the web_app label to the hash. */
export function agentCard(agentName: string, locale: CircleLocale, current?: JoinChoice, pet = false): AgentCard {
  const c = COPY[locale];
  const text = c.card(agentName) + (current ? `\n\n${c.now[current]}` : '');
  const labels = { join: c.join, reply: c.reply, decline: c.decline, open: c.open(agentName).slice(0, 64) };
  return { text, locale, labels, copyHash: copyHash(text, [labels.join, labels.reply, labels.decline, ...(pet ? [labels.open] : [])]) };
}

/** The alert shown to the tapper after their choice is durably recorded. */
export const choiceReceipt = (agentName: string, choice: JoinChoice, locale: CircleLocale) => COPY[locale].chosen[choice](agentName);
