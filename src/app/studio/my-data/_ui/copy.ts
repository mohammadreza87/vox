/** Every word the My data page shows, EN and FA with meaning parity. */

import type { MyDataForgetResponse } from '@/lib/studio/my-data-contract';

export type MyDataLang = 'en' | 'fa';
export const myDataLang = (code?: string): MyDataLang => (/^fa\b/i.test(code ?? '') ? 'fa' : 'en');

const fa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export interface MyDataCopy {
  title: string; intro: string; loading: string; failed: string; retry: string; reopen: string;
  pets: string; petsEmpty: string; choices: string; choice: Record<string, string>; groups: string; groupCount: (n: number) => string;
  notes: string; notesEmpty: string; fromGroup: (title: string) => string; erase: string; eraseAsk: string;
  json: string; copy: string; copied: string;
  forget: string; forgetAsk: string; forgotten: (r: MyDataForgetResponse) => string; anAgent: string;
}

const COPY: Record<MyDataLang, MyDataCopy> = {
  en: {
    title: 'My data',
    intro: 'What Vox keeps about you for agents’ pets and group notes. Only you can open this page.',
    loading: 'Loading your data…',
    failed: 'That didn’t work. Try again?',
    retry: 'Try again',
    reopen: 'This page opens only from Vox. Open it again from the Vox bot.',
    pets: 'Pets',
    petsEmpty: 'No pet care saved.',
    choices: 'Your choices on agent cards',
    choice: { joined: 'Joined', reply_only: 'Only reply to me', declined: 'Not me' },
    groups: 'Group notes',
    groupCount: (n) => (n === 1 ? 'You are part of 1 group’s notes.' : `You are part of ${n} groups’ notes.`),
    notes: 'Your notes',
    notesEmpty: 'No notes saved.',
    fromGroup: (title) => `from ${title}`,
    erase: 'Erase',
    eraseAsk: 'Erase your copy of this note? Everyone else keeps theirs.',
    json: 'Everything as JSON',
    copy: 'Copy',
    copied: 'Copied',
    forget: 'Forget everything',
    forgetAsk: 'Erase your pet care for every agent, your choices, your group-note memberships and your note copies? This cannot be undone. Your chats stay.',
    forgotten: (r) => `Done. Erased pet care for ${r.erased} ${r.erased === 1 ? 'agent' : 'agents'}${r.notesErased ? `, ${r.notesErased} ${r.notesErased === 1 ? 'note' : 'notes'}` : ''}${r.choicesErased ? `, ${r.choicesErased} ${r.choicesErased === 1 ? 'choice' : 'choices'}` : ''}${r.circlesErased ? `, ${r.circlesErased} group ${r.circlesErased === 1 ? 'membership' : 'memberships'}` : ''}.`,
    anAgent: 'An agent',
  },
  fa: {
    title: 'داده‌های من',
    intro: 'آنچه وکس دربارهٔ شما برای حیوانک‌های عامل‌ها و یادداشت‌های گروه نگه می‌دارد. فقط خودتان می‌توانید این صفحه را باز کنید.',
    loading: 'در حال دریافت داده‌های شما…',
    failed: 'نشد. دوباره امتحان کنید؟',
    retry: 'دوباره',
    reopen: 'این صفحه فقط از وکس باز می‌شود. آن را دوباره از بات وکس باز کنید.',
    pets: 'حیوانک‌ها',
    petsEmpty: 'مراقبتی ذخیره نشده است.',
    choices: 'انتخاب‌های شما روی کارت عامل‌ها',
    choice: { joined: 'پیوستید', reply_only: 'فقط به من جواب بده', declined: 'مرا حساب نکن' },
    groups: 'یادداشت‌های گروه',
    groupCount: (n) => `شما در یادداشت‌های ${fa(n)} گروه هستید.`,
    notes: 'یادداشت‌های شما',
    notesEmpty: 'یادداشتی ذخیره نشده است.',
    fromGroup: (title) => `از ${title}`,
    erase: 'پاک کردن',
    eraseAsk: 'نسخه خودتان از این یادداشت پاک شود؟ بقیه نسخه خودشان را نگه می‌دارند.',
    json: 'همه به صورت JSON',
    copy: 'کپی',
    copied: 'کپی شد',
    forget: 'همه را فراموش کن',
    forgetAsk: 'مراقبت حیوانک همهٔ عامل‌ها، انتخاب‌ها، عضویت در یادداشت‌های گروه و نسخه‌های یادداشت شما پاک شود؟ این کار برگشت‌پذیر نیست. گفتگوهایتان می‌مانند.',
    forgotten: (r) => `انجام شد. مراقبت حیوانک ${fa(r.erased)} عامل${r.notesErased ? `، ${fa(r.notesErased)} یادداشت` : ''}${r.choicesErased ? `، ${fa(r.choicesErased)} انتخاب` : ''}${r.circlesErased ? `، ${fa(r.circlesErased)} عضویت گروه` : ''} پاک شد.`,
    anAgent: 'یک عامل',
  },
};

export const myDataCopy = (lang: MyDataLang) => COPY[lang];
