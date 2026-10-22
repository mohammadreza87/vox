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

/* ---------- group card (UX-16), S2 ---------- */

/** circle-v1: notes are kept by each member; notes saved while you're here stay with everyone who was here (R2 decision 4). */
export const GROUP_NOTICE = { id: 'notice:optional.group_memory', version: 'circle-v1' } as const;

const faDigits = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const listOf = (names: readonly string[], locale: CircleLocale) =>
  locale === 'fa' ? names.join(' و ') : names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const GROUP = {
  en: {
    notice: (a: string) => `🐾 ${a} can keep notes for this group: only things someone here asks to save. Every member who joins keeps their own copy, and notes are used here only while everyone in this chat has joined, and only by agents you join. Notes saved while you're here stay with everyone who was here. Leave anytime. Adults (18+) only.`,
    status: (on: boolean, joined: number, total: number | null) => `Notes: ${on ? 'on' : 'off'} · ${total === null ? `${joined} joined` : `${joined} of ${total} joined`}`,
    small: 'Counts can reveal choices in small groups.',
    others: 'Other bots here count as readers.',
    more: (n: number) => `${n} more`,
    join: 'Join · 18+', reply: 'Only reply to me', decline: 'Not me', details: 'Details & pet 🐾',
    include: (a: string) => `🐾 ${a} wants to use this group's notes. Include ${a} and it can use this group's notes, like the agents you already joined. Only people who joined can include it.`,
    includeStatus: (n: number, total: number | null) => total === null ? `${n} said yes` : `${n} of ${total} said yes`,
    includeLabel: (a: string) => `Include ${a}`,
    welcome: (names: string, a: string) => `Hi ${names}! I'm ${a} 🐾 Group notes nap until everyone's in.`,
    everyone: (a: string) => `Everyone's in 🎉 ${a} can keep notes for this group now.`,
    nudge: 'Tap to join 🐾',
    alert: {
      joined: (a: string) => `You joined. ${a} can use this group's notes while everyone here has joined. Leave anytime: tap Not me, or /leave.`,
      reply_only: () => "Got it: I'll reply to you, and keep no group notes for you.",
      declined: () => "Okay: you're not included in this group's notes.",
    },
    keptSuffix: " Notes saved while you were here stay with everyone who was here.",
    included: (a: string) => `Done: ${a} can use this group's notes for you too.`,
    expired: 'This card is out of date. Look for the newest card in this chat.',
    notMember: 'Only people in this chat can choose here.',
    full: 'This group already has 12 people in its notes.',
    limit: "You've joined and left this group's notes too many times to join again here.",
    joinFirst: 'Tap Join on the group card first.',
    early: 'One moment, then tap again.',
    unavailable: 'Group notes are paused here.',
    left: "Done: you're out of this group's notes. Notes saved while you were here stay with everyone who was here.",
    notIn: "You're not in this group's notes.",
    leftCircles: (n: number) => n === 1 ? "You're also out of one group's notes." : `You're also out of ${n} groups' notes.`,
    leftGroups: (n: number) => n === 1 ? "Done: you're out of this group's notes. Notes saved while you were here stay with everyone who was here."
      : `Done: you're out of the notes of ${n} groups. Notes saved while you were there stay with everyone who was there.`,
  },
  fa: {
    notice: (a: string) => `🐾 ${a} می‌تواند یادداشت‌های این گروه را نگه دارد؛ فقط چیزهایی که کسی اینجا بخواهد ذخیره شود. هر عضوی که بپیوندد نسخه خودش را نگه می‌دارد، و یادداشت‌ها اینجا فقط وقتی به کار می‌روند که همه اعضای این گفتگو پیوسته باشند، و فقط توسط ایجنت‌هایی که شما انتخاب کنید. یادداشت‌هایی که وقتی اینجا هستید ذخیره می‌شوند، پیش همه کسانی که آن موقع اینجا بودند می‌مانند. هر وقت خواستید خارج شوید. فقط بزرگسالان (۱۸+).`,
    status: (on: boolean, joined: number, total: number | null) => `یادداشت‌ها: ${on ? 'روشن' : 'خاموش'} · ${total === null ? `${faDigits(joined)} نفر پیوسته‌اند` : `${faDigits(joined)} از ${faDigits(total)} پیوسته‌اند`}`,
    small: 'در گروه‌های کوچک، شمارش‌ها ممکن است انتخاب‌ها را نشان دهند.',
    others: 'ربات‌های دیگر اینجا هم خواننده حساب می‌شوند.',
    more: (n: number) => `${faDigits(n)} ایجنت دیگر`,
    join: 'می‌پیوندم · ۱۸+', reply: 'فقط به من جواب بده', decline: 'مرا حساب نکن', details: 'جزئیات و پت 🐾',
    include: (a: string) => `🐾 ${a} می‌خواهد از یادداشت‌های این گروه استفاده کند. اگر ${a} را اضافه کنید، مثل ایجنت‌هایی که قبلاً به آن‌ها پیوسته‌اید از یادداشت‌های این گروه استفاده می‌کند. فقط کسانی که پیوسته‌اند می‌توانند آن را اضافه کنند.`,
    includeStatus: (n: number, total: number | null) => total === null ? `${faDigits(n)} نفر موافقت کرده‌اند` : `${faDigits(n)} از ${faDigits(total)} موافقت کرده‌اند`,
    includeLabel: (a: string) => `اضافه کردن ${a}`,
    welcome: (names: string, a: string) => `سلام ${names}! من ${a} هستم 🐾 یادداشت‌های گروه تا وقتی همه نپیوسته‌اند خواب‌اند.`,
    everyone: (a: string) => `همه پیوستند 🎉 حالا ${a} می‌تواند یادداشت‌های این گروه را نگه دارد.`,
    nudge: 'برای پیوستن بزنید 🐾',
    alert: {
      joined: (a: string) => `پیوستید. تا وقتی همه اینجا پیوسته‌اند، ${a} از یادداشت‌های گروه استفاده می‌کند. برای خروج: «مرا حساب نکن» یا /leave.`,
      reply_only: () => 'باشه: به شما جواب می‌دهم و برایتان یادداشت گروهی نگه نمی‌دارم.',
      declined: () => 'باشه: شما در یادداشت‌های این گروه حساب نمی‌شوید.',
    },
    keptSuffix: ' یادداشت‌هایی که وقتی اینجا بودید ذخیره شدند، پیش همه کسانی که آن موقع اینجا بودند می‌مانند.',
    included: (a: string) => `انجام شد: ${a} هم می‌تواند برای شما از یادداشت‌های این گروه استفاده کند.`,
    expired: 'این کارت قدیمی است. تازه‌ترین کارت این گفتگو را پیدا کنید.',
    notMember: 'فقط اعضای این گفتگو می‌توانند اینجا انتخاب کنند.',
    full: 'یادداشت‌های این گروه همین حالا ۱۲ نفر دارد.',
    limit: 'آن‌قدر به یادداشت‌های این گروه پیوسته‌اید و خارج شده‌اید که دیگر نمی‌توانید اینجا دوباره بپیوندید.',
    joinFirst: 'اول روی کارت گروه «می‌پیوندم» را بزنید.',
    early: 'یک لحظه صبر کنید و دوباره بزنید.',
    unavailable: 'یادداشت‌های گروه اینجا متوقف است.',
    left: 'انجام شد: دیگر در یادداشت‌های این گروه نیستید. یادداشت‌هایی که وقتی اینجا بودید ذخیره شدند، پیش همه کسانی که آن موقع اینجا بودند می‌مانند.',
    notIn: 'شما در یادداشت‌های این گروه نیستید.',
    leftCircles: (n: number) => n === 1 ? 'از یادداشت‌های یک گروه هم خارج شدید.' : `از یادداشت‌های ${faDigits(n)} گروه هم خارج شدید.`,
    leftGroups: (n: number) => n === 1 ? 'انجام شد: دیگر در یادداشت‌های این گروه نیستید. یادداشت‌هایی که وقتی اینجا بودید ذخیره شدند، پیش همه کسانی که آن موقع اینجا بودند می‌مانند.'
      : `انجام شد: دیگر در یادداشت‌های ${faDigits(n)} گروه نیستید. یادداشت‌هایی که وقتی آنجا بودید ذخیره شدند، پیش همه کسانی که آن موقع آنجا بودند می‌مانند.`,
  },
} as const;

export const groupCopy = (locale: CircleLocale) => GROUP[locale];
export const agentList = listOf;

/** Telegram's limit for a callback alert. */
export const ALERT_MAX = 200;

/**
 * The Join alert, always within ALERT_MAX: the agent list shortens ("A, B and 2 more") before the
 * sentence does, so the how-to-leave part (PRIV-016) is never cut.
 */
export function joinedAlert(agentNames: readonly string[], locale: CircleLocale): string {
  const c = GROUP[locale];
  for (let k = agentNames.length; k >= 1; k--) {
    const shown = agentNames.slice(0, k), rest = agentNames.length - k;
    const text = c.alert.joined(listOf(rest ? [...shown, c.more(rest)] : shown, locale));
    if (text.length <= ALERT_MAX) return text;
  }
  const room = ALERT_MAX - c.alert.joined('').length - 1;
  const first = agentNames[0] ?? '';
  return c.alert.joined(first.length > room ? `${first.slice(0, Math.max(1, room))}…` : first);
}

/** An alert that is always within ALERT_MAX (the agent name is what shortens). */
export function nameAlert(make: (a: string) => string, agentName: string): string {
  const room = ALERT_MAX - make('').length;
  return make(agentName.length > room ? `${agentName.slice(0, Math.max(1, room - 1))}…` : agentName);
}

export interface GroupCard {
  /** The notice: what copyHash covers, the same on the card and on a welcome. */
  notice: string;
  /** The notice plus the status line (counts only, never names) */
  text: string;
  locale: CircleLocale;
  labels: { join: string; reply: string; decline: string; details: string };
  copyHash: string;
}

/**
 * The group card. copyHash covers the notice and button labels (with the URL label only when the card
 * carries that button); the status line under it is a counter, not part of the notice.
 */
export function groupCard(agentNames: readonly string[], locale: CircleLocale, status: { on: boolean; joined: number; total: number | null; others?: boolean }, withLink: boolean): GroupCard {
  const c = GROUP[locale], notice = c.notice(listOf(agentNames, locale));
  const labels = { join: c.join, reply: c.reply, decline: c.decline, details: c.details };
  const small = status.total !== null && status.total <= 2 ? `\n${c.small}` : '';
  const others = status.others ? `\n${c.others}` : '';
  return { notice, text: `${notice}\n\n${c.status(status.on, status.joined, status.total)}${others}${small}`, locale, labels,
    copyHash: copyHash(notice, [labels.join, labels.reply, labels.decline, ...(withLink ? [labels.details] : [])]) };
}

/**
 * The silent newcomer welcome: one per batch of newcomers, a greeting over the same notice, so a tap on
 * it carries the card's copyHash. At most five first names, then "and N more".
 */
export function welcomeText(names: readonly string[], agentName: string, agentNames: readonly string[], locale: CircleLocale): string {
  const c = GROUP[locale], cut = names.map((n) => n.slice(0, 64));
  const greeted = cut.length > 5 ? listOf([...cut.slice(0, 4), locale === 'fa' ? `${faDigits(cut.length - 4)} نفر دیگر` : `${cut.length - 4} more`], locale) : listOf(cut, locale);
  return `${c.welcome(greeted, agentName)}\n\n${c.notice(listOf(agentNames, locale))}`;
}

/** A later agent's include card. */
export function includeCard(agentName: string, locale: CircleLocale, yes: number, total: number | null): { notice: string; text: string; label: string; copyHash: string } {
  const c = GROUP[locale], notice = c.include(agentName), label = c.includeLabel(agentName).slice(0, 64);
  return { notice, text: `${notice}\n\n${c.includeStatus(yes, total)}`, label, copyHash: copyHash(notice, [label]) };
}
