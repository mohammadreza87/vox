export type PrivacyLocale = 'en' | 'fa';

/** Explain the server's actual gate without implying every failure is a policy review. */
export function privacyUnavailableReason(reason: string | undefined, locale: PrivacyLocale): string {
  const messages: Record<string, readonly [string, string]> = {
    profile_confirmation_required: ['Confirm your account profile above to use this control.', 'برای استفاده از این کنترل، نمایهٔ حساب خود را در بالا تأیید کنید.'],
    adult_required: ['Confirm that you are 18 or older in your account profile.', 'در نمایهٔ حساب خود تأیید کنید که ۱۸ سال یا بیشتر دارید.'],
    feature_not_released: ['This feature is not available yet.', 'این قابلیت هنوز در دسترس نیست.'],
    jurisdiction_unknown: ['Your service region needs to be configured. Contact info@joyixir.com.', 'منطقهٔ سرویس شما باید تنظیم شود. با info@joyixir.com تماس بگیرید.'],
    disabled: ['This feature is disabled for your account.', 'این قابلیت برای حساب شما غیرفعال است.'],
    approval_missing: ['Service setup is incomplete for your account. Contact info@joyixir.com.', 'راه‌اندازی سرویس برای حساب شما کامل نشده است. با info@joyixir.com تماس بگیرید.'],
    approval_invalid: ['Your service configuration needs to be updated. Contact info@joyixir.com.', 'تنظیمات سرویس شما باید به‌روز شود. با info@joyixir.com تماس بگیرید.'],
    review_pending: ['Service availability for your account is under review.', 'دسترسی سرویس برای حساب شما در حال بررسی است.'],
    blocked: ['This feature is unavailable for your account.', 'این قابلیت برای حساب شما در دسترس نیست.'],
  };
  return (messages[reason ?? ''] ?? ['This control is unavailable. Refresh your settings or contact info@joyixir.com.', 'این کنترل در دسترس نیست. تنظیمات را تازه کنید یا با info@joyixir.com تماس بگیرید.'])[locale === 'fa' ? 1 : 0];
}

export const privacyCopy = {
  en: {
    title: 'Privacy & memory', subtitle: 'Your context. Your choices.',
    intro: 'Choose what Vox remembers and how it helps you. Optional features start off. Your Work and Personal spaces keep separate settings and memories.',
    work: 'Work', personal: 'Personal', space: 'Memory space', language: 'Language',
    identity: 'Who is using this account?', identityBody: 'Confirm that you are using your own profile. A voice or writing style never switches your identity or unlocks someone else’s memories.',
    confirm: 'Use my account profile', confirmed: 'Account profile confirmed', adult: 'I am 18 or older',
    jurisdiction: 'Country or US state code (optional)', jurisdictionHint: 'For example EE or US-CA. Leave blank if you are unsure. Availability also requires a reviewed service policy.',
    accountNote: 'If someone else is using this account, use their own authenticated account. Shared-account person switching is not available yet.',
    optional: 'Optional choices', off: 'Off', on: 'On', reviewNeeded: 'Off · review needed',
    review: 'Review choice', enable: 'Turn on', decline: 'Keep off', withdraw: 'Turn off',
    unavailable: 'Unavailable until service requirements are approved.', saving: 'Saving…', saved: 'Saved.',
    withdrawn: 'Off. Future use for this purpose has stopped.', retry: 'Try again',
    notice: 'Read before choosing', noticeVersion: 'Notice version', close: 'Close',
    memoryTitle: 'Saved by you', memoryBody: 'These notes belong to your account profile in this space. Adding one does not turn on automatic remembering.',
    memoryLabel: 'What should Vox remember?', saveMemory: 'Save private memory', empty: 'No saved memories in this space.',
    private: 'Only my account profile', expires: 'Expires', remove: 'Delete', cancel: 'Cancel',
    deleteTitle: 'Delete this saved memory?', deleteBody: 'The saved text will be removed and a deletion marker will prevent this record from returning. Messages you already sent to other people remain with their recipients.',
    deleted: 'The saved memory was deleted.', refresh: 'Refresh settings',
    ai: 'You are talking with AI', aiBody: 'Vox uses AI providers to process the content you send and produce replies. It can make mistakes. Optional memory, analytics, learning, notifications and voice recognition each have their own controls.',
    operator: 'Operated by Joyixir OÜ', privacyContact: 'Privacy contact', registeredAddress: 'Registered address',
    sharing: 'Sharing stays explicit', sharingBody: 'An agent owner does not gain access to your private memories. Group and selected-person sharing require an explicit audience and current permissions. Nothing on this page shares a note.',
    voice: 'Voice recognition', voiceBody: 'Voice recognition is unavailable until its consent, provider and regional requirements are approved. You can keep using account selection and ordinary voice calls.',
    loading: 'Loading your privacy settings…', working: 'Working…',
    agents: 'Agents you allow', agentsBody: 'Choose which agents may use saved notes in this space. Personalization must also be on. Ownership of an agent does not grant it access.', allowAgent: 'Allow', revokeAgent: 'Remove access', noAgents: 'No active agents are available.',
  },
  fa: {
    title: 'حریم خصوصی و حافظه', subtitle: 'اطلاعات شما، انتخاب شما.',
    intro: 'انتخاب کنید وکس چه چیزهایی را به خاطر بسپارد و چگونه کمک کند. قابلیت‌های اختیاری در ابتدا خاموش‌اند. تنظیمات و حافظهٔ فضاهای کاری و شخصی جدا هستند.',
    work: 'کاری', personal: 'شخصی', space: 'فضای حافظه', language: 'زبان',
    identity: 'چه کسی از این حساب استفاده می‌کند؟', identityBody: 'تأیید کنید که از نمایهٔ خودتان استفاده می‌کنید. صدا یا سبک نوشتن هرگز هویت را تغییر نمی‌دهد و حافظهٔ فرد دیگری را باز نمی‌کند.',
    confirm: 'استفاده از نمایهٔ حساب خودم', confirmed: 'نمایهٔ حساب تأیید شد', adult: '۱۸ سال یا بیشتر دارم',
    jurisdiction: 'کد کشور یا ایالت آمریکا (اختیاری)', jurisdictionHint: 'برای مثال EE یا US-CA. اگر مطمئن نیستید خالی بگذارید. دسترسی به قابلیت‌ها به سیاست تأییدشدهٔ سرویس نیز نیاز دارد.',
    accountNote: 'اگر فرد دیگری از این حساب استفاده می‌کند، باید وارد حساب احراز هویت‌شدهٔ خودش شود. تغییر شخص در یک حساب مشترک هنوز در دسترس نیست.',
    optional: 'انتخاب‌های اختیاری', off: 'خاموش', on: 'روشن', reviewNeeded: 'خاموش · نیازمند بازبینی',
    review: 'بررسی انتخاب', enable: 'فعال کردن', decline: 'خاموش بماند', withdraw: 'خاموش کردن',
    unavailable: 'تا تأیید الزامات سرویس در دسترس نیست.', saving: 'در حال ذخیره…', saved: 'ذخیره شد.',
    withdrawn: 'خاموش است. استفادهٔ بعدی برای این هدف متوقف شده است.', retry: 'تلاش دوباره',
    notice: 'پیش از انتخاب بخوانید', noticeVersion: 'نسخهٔ اطلاعیه', close: 'بستن',
    memoryTitle: 'ذخیره‌شده توسط شما', memoryBody: 'این یادداشت‌ها در این فضا متعلق به نمایهٔ حساب شما هستند. افزودن یادداشت، حافظهٔ خودکار را فعال نمی‌کند.',
    memoryLabel: 'وکس چه چیزی را به خاطر بسپارد؟', saveMemory: 'ذخیرهٔ حافظهٔ خصوصی', empty: 'در این فضا حافظه‌ای ذخیره نشده است.',
    private: 'فقط نمایهٔ حساب خودم', expires: 'انقضا', remove: 'حذف', cancel: 'انصراف',
    deleteTitle: 'این حافظهٔ ذخیره‌شده حذف شود؟', deleteBody: 'متن ذخیره‌شده حذف می‌شود و نشانگر حذف از بازگشت این رکورد جلوگیری می‌کند. پیام‌هایی که قبلاً برای دیگران فرستاده‌اید نزد گیرندگان باقی می‌مانند.',
    deleted: 'حافظهٔ ذخیره‌شده حذف شد.', refresh: 'تازه‌سازی تنظیمات',
    ai: 'با هوش مصنوعی صحبت می‌کنید', aiBody: 'وکس برای پردازش محتوایی که می‌فرستید و تولید پاسخ از ارائه‌دهندگان هوش مصنوعی استفاده می‌کند و ممکن است اشتباه کند. حافظه، تحلیل استفاده، یادگیری، اعلان‌ها و تشخیص صدای اختیاری هرکدام کنترل جداگانه دارند.',
    operator: 'بهره‌بردار: Joyixir OÜ', privacyContact: 'تماس دربارهٔ حریم خصوصی', registeredAddress: 'نشانی ثبت‌شده',
    sharing: 'اشتراک‌گذاری با انتخاب شماست', sharingBody: 'مالک عامل به حافظه‌های خصوصی شما دسترسی ندارد. اشتراک با گروه یا افراد منتخب به مخاطبان مشخص و مجوزهای معتبر نیاز دارد. هیچ کاری در این صفحه یادداشتی را به اشتراک نمی‌گذارد.',
    voice: 'تشخیص صدا', voiceBody: 'تشخیص صدا تا تأیید الزامات رضایت، ارائه‌دهنده و منطقه در دسترس نیست. انتخاب حساب و تماس صوتی معمولی همچنان قابل استفاده‌اند.',
    loading: 'در حال دریافت تنظیمات حریم خصوصی…', working: 'در حال انجام…',
    agents: 'عامل‌های مجاز شما', agentsBody: 'انتخاب کنید کدام عامل‌ها می‌توانند از یادداشت‌های این فضا استفاده کنند. شخصی‌سازی نیز باید روشن باشد. مالکیت عامل به آن دسترسی نمی‌دهد.', allowAgent: 'اجازه دادن', revokeAgent: 'حذف دسترسی', noAgents: 'عامل فعالی در دسترس نیست.',
  },
} as const;

export const purposeCopy: Record<string, Record<PrivacyLocale, { title: string; body: string }>> = {
  'optional.product_analytics': { en: { title: 'Usage analytics', body: 'Share minimized interaction measurements to help improve Vox. Conversation text and audio are excluded.' }, fa: { title: 'تحلیل استفاده', body: 'اندازه‌گیری‌های محدود تعامل برای بهبود وکس. متن گفتگو و صدا ارسال نمی‌شوند.' } },
  'optional.personalization': { en: { title: 'Personalization', body: 'Adapt replies and your experience using preferences in this space.' }, fa: { title: 'شخصی‌سازی', body: 'تنظیم پاسخ‌ها و تجربه بر اساس ترجیح‌های همین فضا.' } },
  'optional.auto_memory': { en: { title: 'Automatic memory', body: 'Suggest and save useful details from conversations you permit.' }, fa: { title: 'حافظهٔ خودکار', body: 'پیشنهاد و ذخیرهٔ جزئیات مفید از گفتگوهایی که اجازه می‌دهید.' } },
  'optional.biometric_recognition': { en: { title: 'Voice recognition', body: 'A separate optional enrollment. Recognition can suggest a person, but cannot authenticate them.' }, fa: { title: 'تشخیص صدا', body: 'ثبت‌نامی جداگانه و اختیاری. تشخیص می‌تواند فردی را پیشنهاد دهد اما هویت او را احراز نمی‌کند.' } },
  'optional.reminder_delivery': { en: { title: 'Requested reminders', body: 'Deliver reminders you ask for through channels you choose.' }, fa: { title: 'یادآورهای درخواستی', body: 'ارسال یادآورهایی که درخواست می‌کنید از راه‌های انتخابی شما.' } },
  'optional.proactive_suggestions': { en: { title: 'Proactive suggestions', body: 'Offer timely help, with quiet hours and a limit on interruptions.' }, fa: { title: 'پیشنهادهای پیش‌دستانه', body: 'کمک به‌موقع با رعایت ساعات سکوت و محدودیت مزاحمت.' } },
  'optional.content_quality_review': { en: { title: 'Content quality review', body: 'A separate choice to contribute permitted content to quality improvement.' }, fa: { title: 'بررسی کیفیت محتوا', body: 'انتخابی جداگانه برای مشارکت محتوای مجاز در بهبود کیفیت.' } },
};
