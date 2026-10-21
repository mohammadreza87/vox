import type { Locale } from './i18n';

type Phase = 'ready' | 'listening' | 'thinking' | 'speaking';

/** Copy for the call screen (board call). `en` defines the shape. */
const en = {
  /** Tap-to-talk tells you what the big button does next; a live call only speaks up when it adds something. */
  hint: { ready: 'Tap to talk', listening: 'Tap again to send', thinking: '', speaking: 'Tap to interrupt' } as Record<Phase, string>,
  liveHint: { ready: 'Tap to start the call', listening: '', thinking: '', speaking: 'Just talk to interrupt' } as Record<Phase, string>,
  mutedHint: 'Tap the mic to talk',
  spaces: { work: 'Work', personal: 'Personal' },
  muted: 'Muted', listening: 'Listening', connecting: 'Connecting', thinking: 'Thinking', speaking: (name: string) => `${name} is speaking`,
  connected: 'Connected', ready: 'Ready',
  dropped: 'The call dropped.', didntCatch: 'Didn\'t catch that — try again.',
  closeCall: 'Close call', options: 'Call options',
  micDenied: 'Vox needs the microphone for calls. Allow it when Telegram asks.', tryAgain: 'Try again',
  you: 'You', mute: 'Mute', unmute: 'Unmute', captions: 'Captions', send: 'Send', talk: 'Talk', end: 'End call',
  space: 'Space', endToSwitch: 'End the call to switch space.', spaceFoot: 'Calls remember things in the space you pick.',
  conversationSpace: 'Conversation space', ended: 'Call ended', done: 'Done',
};

export const callCopy: Record<Locale, typeof en> = {
  en,
  fa: {
    hint: { ready: 'برای صحبت بزنید', listening: 'برای ارسال دوباره بزنید', thinking: '', speaking: 'برای قطع صحبت بزنید' },
    liveHint: { ready: 'برای شروع تماس بزنید', listening: '', thinking: '', speaking: 'برای قطع کردن، فقط صحبت کنید' },
    mutedHint: 'برای صحبت، میکروفون را بزنید',
    spaces: { work: 'کار', personal: 'شخصی' },
    muted: 'بی‌صدا', listening: 'در حال شنیدن', connecting: 'در حال اتصال', thinking: 'در حال فکر کردن', speaking: (name) => `${name} در حال صحبت است`,
    connected: 'وصل', ready: 'آماده',
    dropped: 'تماس قطع شد.', didntCatch: 'متوجه نشدم — دوباره امتحان کنید.',
    closeCall: 'بستن تماس', options: 'گزینه‌های تماس',
    micDenied: 'وکس برای تماس به میکروفون نیاز دارد. وقتی تلگرام پرسید، اجازه دهید.', tryAgain: 'تلاش دوباره',
    you: 'شما', mute: 'بی‌صدا کردن', unmute: 'روشن کردن میکروفون', captions: 'زیرنویس', send: 'ارسال', talk: 'صحبت', end: 'پایان تماس',
    space: 'فضا', endToSwitch: 'برای تغییر فضا، تماس را پایان دهید.', spaceFoot: 'تماس‌ها چیزها را در فضایی که انتخاب می‌کنید به خاطر می‌سپارند.',
    conversationSpace: 'فضای گفتگو', ended: 'تماس پایان یافت', done: 'تمام',
  },
};
