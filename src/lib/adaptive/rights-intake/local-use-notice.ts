/** Closed EN/FA technical-use notice. Hashes require an explicitly reviewed policy. */
export const LOCAL_USE_NOTICE_VERSION = 'rf1-local-use-v1';
export const localUseNotice = {
  en: {
    title: 'Local use restriction', work: 'Work', personal: 'Personal', purpose: 'Purpose', personalization: 'Personalization', analytics: 'Product analytics',
    decision: 'Restrict supported local uses in this space, for this signed-in account. Your consent choices stay unchanged. This does not extend retention or delete data. Provider and backup actions are not covered. Your rights request still needs review.',
    personalizationScope: 'Automatic use of stored context, preferences and learning for personalization stops in this scope.',
    analyticsScope: 'Optional product analytics collection and processing stop in this scope.',
    exceptions: 'Tools you deliberately use on a selected note, and management or export of your own data, keep their existing permission and personalization-pause checks.',
    apply: 'Apply local restriction', release: 'End this restriction', releaseDecision: 'End this restriction? Current consent, pause settings and any other restrictions will still apply. Previously canceled work will not restart.',
    refresh: 'Refresh status', loading: 'Checking current restriction…', pending: 'Checking whether the restriction was recorded…', unknown: 'The result was not confirmed. Refresh status before trying again.', unavailable: 'Current restriction status is unavailable.',
    notApplied: 'No restriction from this action is currently recorded.', active: 'Local restriction active.', recording: 'Your request status is still updating.', recordingFailed: 'We could not update your request status. Refresh status.',
    released: 'This restriction ended. Current consent and pause settings still apply.', otherHold: 'This restriction ended. Another restriction still blocks this local use.',
    disabled: 'New actions are unavailable.', lastConfirmed: 'Last confirmed', asOf: 'Status as of', legal: 'Legal request tracking is separate. Closing the request does not end this restriction.',
    reconcile: 'Reconcile local status',
  },
  fa: {
    title: 'محدودیت استفادهٔ محلی', work: 'کاری', personal: 'شخصی', purpose: 'هدف', personalization: 'شخصی‌سازی', analytics: 'تحلیل محصول',
    decision: 'استفاده‌های محلی پشتیبانی‌شده را در این فضا و برای همین حساب واردشده محدود کنید. انتخاب‌های رضایت شما تغییر نمی‌کنند. این کار مدت نگهداری را تمدید نمی‌کند و داده‌ای را حذف نمی‌کند. رسیدگی به ارائه‌دهندگان و نسخه‌های پشتیبان را شامل نمی‌شود. درخواست حقوق شما همچنان به بررسی نیاز دارد.',
    personalizationScope: 'استفادهٔ خودکار از زمینه، ترجیحات و یادگیری ذخیره‌شده برای شخصی‌سازی در این دامنه متوقف می‌شود.',
    analyticsScope: 'گردآوری و پردازش تحلیل اختیاری محصول در این دامنه متوقف می‌شود.',
    exceptions: 'ابزارهایی که خودتان برای یک یادداشت انتخاب‌شده به کار می‌برید، و مدیریت یا خروجی گرفتن از داده‌های خودتان، همچنان به مجوزهای قبلی و وضعیت مکث شخصی‌سازی وابسته‌اند.',
    apply: 'اعمال محدودیت محلی', release: 'پایان دادن به این محدودیت', releaseDecision: 'این محدودیت پایان یابد؟ تنظیمات فعلی رضایت و مکث و هر محدودیت دیگری همچنان اعمال می‌شوند. کارهای لغوشدهٔ قبلی دوباره آغاز نمی‌شوند.',
    refresh: 'تازه‌سازی وضعیت', loading: 'در حال بررسی محدودیت فعلی…', pending: 'در حال بررسی ثبت محدودیت…', unknown: 'نتیجه تأیید نشد. پیش از تلاش دوباره، وضعیت را تازه کنید.', unavailable: 'وضعیت فعلی محدودیت در دسترس نیست.',
    notApplied: 'در حال حاضر محدودیتی از این اقدام ثبت نشده است.', active: 'محدودیت محلی فعال است.', recording: 'وضعیت درخواست شما هنوز در حال به‌روزرسانی است.', recordingFailed: 'نتوانستیم وضعیت درخواست شما را به‌روزرسانی کنیم. وضعیت را تازه کنید.',
    released: 'این محدودیت پایان یافت. تنظیمات فعلی رضایت و مکث همچنان اعمال می‌شوند.', otherHold: 'این محدودیت پایان یافت. محدودیت دیگری همچنان مانع این استفادهٔ محلی است.',
    disabled: 'اقدام‌های جدید در دسترس نیستند.', lastConfirmed: 'آخرین وضعیت تأییدشده', asOf: 'وضعیت در زمان', legal: 'پیگیری حقوقی درخواست جداگانه است. بستن درخواست این محدودیت را پایان نمی‌دهد.',
    reconcile: 'تطبیق وضعیت محلی',
  },
} as const;
