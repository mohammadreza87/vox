/** Every word the My data page shows, EN and FA with meaning parity. */

import type { MyDataForgetResponse } from '@/lib/studio/my-data-contract';

export type MyDataLang = 'en' | 'fa';
export const myDataLang = (code?: string): MyDataLang => (/^fa\b/i.test(code ?? '') ? 'fa' : 'en');

const fa = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export interface MyDataCopy {
  title: string; intro: string; loading: string; failed: string; retry: string; reopen: string;
  pets: string; petsEmpty: string; choices: string; choice: Record<string, string>; groups: string; groupCount: (n: number) => string;
  notes: string; notesEmpty: string; fromGroup: (title: string) => string; erase: string; eraseAsk: string;
  apps: string; appsUnavailable: string; space: Record<'work' | 'personal', string>;
  json: string; copy: string; copied: string;
  forget: string; forgetAsk: string; forgotten: (r: MyDataForgetResponse) => string; anAgent: string;
}

const COPY: Record<MyDataLang, MyDataCopy> = {
  en: {
    title: 'My data',
    intro: 'What Vox keeps about you for agents’ pets, group notes and connected apps. Only you can open this page.',
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
    apps: 'Connected apps',
    appsUnavailable: 'Your connected apps can’t be shown right now. Try again later.',
    space: { work: 'Work', personal: 'Personal' },
    json: 'Everything as JSON',
    copy: 'Copy',
    copied: 'Copied',
    forget: 'Erase pet care, group notes and connected apps',
    forgetAsk: 'Erase your pet care for every agent, your choices, your group-note memberships, your note copies and your connected apps? This cannot be undone. This action does not erase your saved-memory account or chats.',
    forgotten: (r) => `Done. Erased pet care for ${r.erased} ${r.erased === 1 ? 'agent' : 'agents'}${r.notesErased ? `, ${r.notesErased} ${r.notesErased === 1 ? 'note' : 'notes'}` : ''}${r.choicesErased ? `, ${r.choicesErased} ${r.choicesErased === 1 ? 'choice' : 'choices'}` : ''}${r.circlesErased ? `, ${r.circlesErased} group ${r.circlesErased === 1 ? 'membership' : 'memberships'}` : ''}${r.connectionsErased ? `, ${r.connectionsErased} connected ${r.connectionsErased === 1 ? 'app' : 'apps'}` : ''}.${r.connectionsPending ? ` ${r.connectionsPending} more connected ${r.connectionsPending === 1 ? 'app is' : 'apps are'} stopped and will be gone shortly.` : ''}`,
    anAgent: 'An agent',
  },
  fa: {
    title: 'داده‌های من',
    intro: 'آنچه وکس دربارهٔ شما برای حیوانک‌های عامل‌ها، یادداشت‌های گروه و برنامه‌های وصل‌شده نگه می‌دارد. فقط خودتان می‌توانید این صفحه را باز کنید.',
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
    apps: 'برنامه‌های وصل‌شده',
    appsUnavailable: 'برنامه‌های وصل‌شده شما الان نشان داده نمی‌شوند. بعداً دوباره امتحان کنید.',
    space: { work: 'کاری', personal: 'شخصی' },
    json: 'همه به صورت JSON',
    copy: 'کپی',
    copied: 'کپی شد',
    forget: 'پاک کردن مراقبت حیوانک‌ها، یادداشت‌های گروه و برنامه‌های وصل‌شده',
    forgetAsk: 'مراقبت حیوانک همهٔ عامل‌ها، انتخاب‌ها، عضویت در یادداشت‌های گروه، نسخه‌های یادداشت و برنامه‌های وصل‌شده شما پاک شود؟ این کار برگشت‌پذیر نیست. این اقدام حساب حافظهٔ ذخیره‌شده یا گفتگوهایتان را پاک نمی‌کند.',
    forgotten: (r) => `انجام شد. مراقبت حیوانک ${fa(r.erased)} عامل${r.notesErased ? `، ${fa(r.notesErased)} یادداشت` : ''}${r.choicesErased ? `، ${fa(r.choicesErased)} انتخاب` : ''}${r.circlesErased ? `، ${fa(r.circlesErased)} عضویت گروه` : ''}${r.connectionsErased ? `، ${fa(r.connectionsErased)} برنامه وصل‌شده` : ''} پاک شد.${r.connectionsPending ? ` ${fa(r.connectionsPending)} برنامه وصل‌شده دیگر متوقف شده و به‌زودی پاک می‌شود.` : ''}`,
    anAgent: 'یک عامل',
  },
};

export const myDataCopy = (lang: MyDataLang) => COPY[lang];
