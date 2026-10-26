/**
 * The pet's group words (Circles S4), EN and FA with meaning parity. The Join sheet's notice and its three buttons
 * are not here: they are the group card's own copy, sent by the server (PetCircle.card), so the sheet shows exactly
 * what the card's copyHash covers. Loaded with the sheet, never on the living page.
 */

import type { ParticipantState } from '@/lib/circles/contracts';

export type CircleLang = 'en' | 'fa';
export const circleLang = (code?: string): CircleLang => /^fa\b/i.test(code ?? '') ? 'fa' : 'en';

const fa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const list = (names: readonly string[], lang: CircleLang) =>
  lang === 'fa' ? names.join(' و ') : names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const COPY = {
  en: {
    here: (n: number, m: number | null) => m === null ? `${n} here` : `${n} of ${m} here`,
    join: 'Join group notes',
    notes: 'Group notes',
    notNow: 'Not now',
    with: (names: readonly string[]) => `Here with ${list(names, 'en')}`,
    chose: { joined: 'You joined', reply_only: 'You chose: Only reply to me', declined: 'You chose: Not me' } as Partial<Record<ParticipantState, string>>,
    myNotes: 'My notes',
    fromGroup: 'From this group',
    empty: 'Nothing saved yet. Ask me to remember something.',
    from: (group: string) => `from ${group}`,
    byYou: 'saved by you',
    erase: 'Erase',
    eraseAsk: 'Erase your copy of this note? Everyone else keeps theirs.',
    leave: 'Leave group notes',
    leaveAsk: (group: string) => `Leave ${group}'s notes? Notes saved while you were here stay with everyone who was here.`,
    left: "You're out of this group's notes.",
    stale: 'The card just changed. Here is the newest one.',
    full: 'This group already has 12 people in its notes.',
    notMember: "This link is for a group you're not in.",
    failed: "That didn't work. Try again?",
    seeNotes: 'See my notes',
    retry: 'Group notes · tap to retry',
    copiesIn: (name: string) => `📌 Get your copies in ${name}’s chat`,
    useVox: 'Your notes open in Vox now: tap ⋯, then Settings.',
    reopen: 'Close and reopen me to choose here.',
  },
  fa: {
    here: (n: number, m: number | null) => m === null ? `${fa(n)} نفر اینجا` : `${fa(n)} از ${fa(m)} اینجا`,
    join: 'پیوستن به یادداشت‌های گروه',
    notes: 'یادداشت‌های گروه',
    notNow: 'الان نه',
    with: (names: readonly string[]) => `اینجا با ${list(names, 'fa')}`,
    chose: { joined: 'پیوستید', reply_only: 'انتخاب شما: فقط به من جواب بده', declined: 'انتخاب شما: مرا حساب نکن' } as Partial<Record<ParticipantState, string>>,
    myNotes: 'یادداشت‌های من',
    fromGroup: 'از این گروه',
    empty: 'هنوز چیزی ذخیره نشده. از من بخواهید چیزی را به خاطر بسپارم.',
    from: (group: string) => `از ${group}`,
    byYou: 'ذخیره‌شده توسط شما',
    erase: 'پاک کردن',
    eraseAsk: 'نسخه خودتان از این یادداشت پاک شود؟ بقیه نسخه خودشان را نگه می‌دارند.',
    leave: 'خروج از یادداشت‌های گروه',
    leaveAsk: (group: string) => `از یادداشت‌های ${group} خارج می‌شوید؟ یادداشت‌هایی که وقتی اینجا بودید ذخیره شدند، پیش همه کسانی که آن موقع اینجا بودند می‌مانند.`,
    left: 'دیگر در یادداشت‌های این گروه نیستید.',
    stale: 'کارت همین الان عوض شد. این تازه‌ترین آن است.',
    full: 'یادداشت‌های این گروه همین حالا ۱۲ نفر دارد.',
    notMember: 'این پیوند برای گروهی است که شما در آن نیستید.',
    failed: 'نشد. دوباره امتحان کنید؟',
    seeNotes: 'دیدن یادداشت‌های من',
    retry: 'یادداشت‌های گروه · برای تلاش دوباره بزنید',
    copiesIn: (name: string) => `📌 نسخه‌هایتان را در گفتگو با ${name} بگیرید`,
    useVox: 'یادداشت‌هایتان حالا در وکس باز می‌شوند: ⋯ و بعد «تنظیمات» را بزنید.',
    reopen: 'برای انتخاب اینجا، مرا ببندید و دوباره باز کنید.',
  },
} as const;

export const circleCopy = (lang: CircleLang) => COPY[lang];
