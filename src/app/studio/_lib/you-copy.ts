import type { PrivacyLocale } from './adaptive-copy';

/** Copy for the "You" settings hub (UI §5.1). Legal and notice wording stays in adaptive-copy. */
export const youCopy = {
  en: {
    you: 'You',
    identitySection: 'Your identity', maySection: 'What Vox may do', notesSection: 'Your notes', sharingSection: 'Sharing',
    experienceSection: 'Experience', controlSection: 'Control', adminSection: 'Admin', languageSection: 'Language',
    identityConfirmed: 'Confirmed', identityConfirm: 'Confirm your identity', adult: 'Adult',
    identityNeeded: 'Needed before optional features can turn on',
    telegramAccount: 'Telegram account', telegramAccountSub: 'Username and user ID to share with an admin',
    identityBanner: 'Confirm your identity before turning on optional features.', identityAction: 'Confirm',
    pausedBanner: (space: string) => `Vox is paused in ${space}.`, pausedAction: 'Review',
    needsIdentity: 'Confirm your identity first',
    addNote: 'Add a private note', seeAll: (n: number) => `See all ${n}`, showFewer: 'Show fewer',
    noteProvenanceClaim: 'User-reviewed claim', noteProvenanceSummary: (n: number) => `Summary of ${n} notes`,
    summarise: 'Summarise notes', summariseSub: 'Combine 2–8 notes into one reviewed summary',
    sharedMemories: 'Shared memories', agentAccess: 'Agent access', connections: 'Connections',
    agentsAllowed: (n: number) => n ? `${n} allowed` : 'None', canUseNotes: 'Can use your notes',
    preferences: 'Preferences', inbox: 'Inbox', unread: (n: number) => `${n} unread`, reminders: 'Reminders', voiceRecognition: 'Voice recognition',
    pause: 'Pause Vox', pauseOff: 'Stop personalised use in one space', pauseOn: 'Paused in this space',
    requests: 'Request a copy or deletion', diagnostics: 'Diagnostics', operatorRequests: 'Privacy requests',
    undo: 'Undo', turnedOff: (title: string) => `${title} is off.`,
    note: 'Private note', done: 'Done', edit: 'Edit',
    privacyRequestLink: 'Privacy request without an account', consentFoot: 'You can turn this off any time in You.',
    languageName: 'English',
  },
  fa: {
    you: 'شما',
    identitySection: 'هویت شما', maySection: 'اجازه‌های وکس', notesSection: 'یادداشت‌های شما', sharingSection: 'اشتراک‌گذاری',
    experienceSection: 'تجربه', controlSection: 'کنترل', adminSection: 'مدیریت', languageSection: 'زبان',
    identityConfirmed: 'تأیید شد', identityConfirm: 'هویت خود را تأیید کنید', adult: 'بزرگسال',
    identityNeeded: 'پیش از روشن کردن قابلیت‌های اختیاری لازم است',
    telegramAccount: 'حساب تلگرام', telegramAccountSub: 'نام کاربری و شناسهٔ کاربری برای ارسال به مدیر',
    identityBanner: 'پیش از روشن کردن قابلیت‌های اختیاری، هویت خود را تأیید کنید.', identityAction: 'تأیید',
    pausedBanner: (space: string) => `وکس در فضای ${space} مکث شده است.`, pausedAction: 'بررسی',
    needsIdentity: 'ابتدا هویت خود را تأیید کنید',
    addNote: 'افزودن یادداشت خصوصی', seeAll: (n: number) => `دیدن همه (${n})`, showFewer: 'نمایش کمتر',
    noteProvenanceClaim: 'ادعای بررسی‌شدهٔ شما', noteProvenanceSummary: (n: number) => `خلاصهٔ ${n} یادداشت`,
    summarise: 'خلاصه کردن یادداشت‌ها', summariseSub: 'ترکیب ۲ تا ۸ یادداشت در یک خلاصهٔ بررسی‌شده',
    sharedMemories: 'حافظه‌های مشترک', agentAccess: 'دسترسی عامل‌ها', connections: 'اتصال‌ها',
    agentsAllowed: (n: number) => n ? `${n} مجاز` : 'هیچ', canUseNotes: 'اجازهٔ استفاده از یادداشت‌ها',
    preferences: 'ترجیح‌ها', inbox: 'صندوق اعلان', unread: (n: number) => `${n.toLocaleString('fa-IR')} خوانده‌نشده`, reminders: 'یادآورها', voiceRecognition: 'تشخیص صدا',
    pause: 'مکث وکس', pauseOff: 'توقف استفادهٔ شخصی‌سازی‌شده در یک فضا', pauseOn: 'در این فضا مکث شده',
    requests: 'درخواست نسخه یا حذف', diagnostics: 'عیب‌یابی', operatorRequests: 'درخواست‌های حریم خصوصی',
    undo: 'بازگردانی', turnedOff: (title: string) => `${title} خاموش شد.`,
    note: 'یادداشت خصوصی', done: 'تمام', edit: 'ویرایش',
    privacyRequestLink: 'درخواست حریم خصوصی بدون حساب', consentFoot: 'هر زمان می‌توانید این را در بخش «شما» خاموش کنید.',
    languageName: 'فارسی',
  },
} as const satisfies Record<PrivacyLocale, Record<string, unknown>>;

/** Language names are always shown in their own script. */
export const LANGUAGES = [{ value: 'en', label: 'English' }, { value: 'fa', label: 'فارسی' }] as const;
