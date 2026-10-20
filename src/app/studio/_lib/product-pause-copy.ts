import type { PauseSpace } from './product-pause-client';
export const productPauseCopy = {
  "title": {
    "en": "Personalization pause · {space}",
    "fa": "مکث شخصی‌سازی · {space}"
  },
  "scope": {
    "en": "This choice applies only to your {space} space, across its agents.",
    "fa": "این انتخاب فقط برای فضای {space} شما و همهٔ عامل‌های آن است."
  },
  "explanation": {
    "en": "Pause use of stored notes and summaries, saved or learned preferences, personalized follow-ups and shared personalized context that requires your information. Stored conversation history and cached context are also excluded from AI requests when covered by this pause or when their source is unknown.",
    "fa": "استفاده از یادداشت‌ها و خلاصه‌های ذخیره‌شده، ترجیح‌های ذخیره‌شده یا آموخته‌شده، پیگیری‌های شخصی‌سازی‌شده و زمینهٔ مشترک شخصی‌سازی‌شده‌ای را که به اطلاعات شما نیاز دارد، مکث کنید. سابقهٔ ذخیره‌شدهٔ گفتگو و زمینهٔ نهان‌شده نیز اگر مشمول این مکث باشند یا منبعشان نامشخص باشد، از درخواست‌های هوش مصنوعی کنار گذاشته می‌شوند."
  },
  "continues": {
    "en": "You can still manage your own saved information and use available current-message features. Viewing your history does not let Vox reuse it in AI requests.",
    "fa": "همچنان می‌توانید اطلاعات ذخیره‌شدهٔ خود را مدیریت کنید و از قابلیت‌های در دسترس برای پیام فعلی استفاده کنید. دیدن سابقهٔ گفتگو به Vox اجازهٔ استفادهٔ دوباره از آن در درخواست‌های هوش مصنوعی نمی‌دهد."
  },
  "otherSettings": {
    "en": "Requested generic reminders, analytics, voice identity and security keep their separate settings.",
    "fa": "یادآوری‌های عمومیِ درخواستی، تحلیل استفاده، هویت صوتی و امنیت همچنان تنظیمات جداگانهٔ خود را دارند."
  },
  "retention": {
    "en": "This pause does not delete information or withdraw consent. Existing retention and deletion rules still apply. It is a product control, not a formal legal restriction request.",
    "fa": "این مکث اطلاعات را حذف نمی‌کند و رضایت را پس نمی‌گیرد. قواعد موجودِ نگهداری و حذف همچنان برقرارند. این گزینه یک کنترل محصول است، نه درخواست رسمیِ محدودسازی قانونی."
  },
  "recall": {
    "en": "This cannot recall text or audio already sent to providers or delivered.",
    "fa": "این گزینه متن یا صدایی را که قبلاً به ارائه‌دهندگان فرستاده یا تحویل داده شده است، پس نمی‌گیرد."
  },
  "loading": {
    "en": "Checking personalization pause in {space}…",
    "fa": "در حال بررسی مکث شخصی‌سازی در فضای {space}…"
  },
  "unpaused": {
    "en": "Not paused in {space}",
    "fa": "در فضای {space} مکث نشده است"
  },
  "paused": {
    "en": "Paused in {space}",
    "fa": "در فضای {space} مکث شده است"
  },
  "lastConfirmed": {
    "en": "Last confirmed:",
    "fa": "آخرین وضعیت تأییدشده:"
  },
  "pause": {
    "en": "Pause in {space}",
    "fa": "مکث در فضای {space}"
  },
  "reviewResume": {
    "en": "Review resume in {space}",
    "fa": "بررسی ازسرگیری در فضای {space}"
  },
  "resumeTitle": {
    "en": "Resume stored personalization in {space}?",
    "fa": "استفاده از اطلاعات ذخیره‌شده برای شخصی‌سازی در فضای {space} از سر گرفته شود؟"
  },
  "resumeBody": {
    "en": "Remove this pause only. Vox can use stored information only where your current consent, agent access and other checks allow it. This grants no permission and does not restart old pending work.",
    "fa": "فقط این مکث برداشته می‌شود. Vox تنها در صورت اجازهٔ رضایت فعلی، دسترسی عامل و دیگر بررسی‌ها می‌تواند از اطلاعات ذخیره‌شده استفاده کند. این کار مجوزی نمی‌دهد و کارهای قدیمیِ در انتظار را دوباره آغاز نمی‌کند."
  },
  "resume": {
    "en": "Resume in {space}",
    "fa": "ازسرگیری در فضای {space}"
  },
  "keepPaused": {
    "en": "Keep paused",
    "fa": "در مکث بماند"
  },
  "pendingPause": {
    "en": "Requesting pause in {space}… Not yet confirmed.",
    "fa": "در حال درخواست مکث در فضای {space}… هنوز تأیید نشده است."
  },
  "pendingResume": {
    "en": "Requesting resume in {space}… Not yet confirmed.",
    "fa": "در حال درخواست ازسرگیری در فضای {space}… هنوز تأیید نشده است."
  },
  "unknownOutcome": {
    "en": "The change in {space} was not confirmed. It may have been saved. Check the current status before choosing again.",
    "fa": "تغییر در فضای {space} تأیید نشد؛ ممکن است ذخیره شده باشد. پیش از انتخاب دوباره، وضعیت فعلی را بررسی کنید."
  },
  "unknownStatus": {
    "en": "The current pause status in {space} is unknown.",
    "fa": "وضعیت فعلی مکث در فضای {space} نامشخص است."
  },
  "check": {
    "en": "Check current status",
    "fa": "بررسی وضعیت فعلی"
  },
  "stale": {
    "en": "Settings in {space} changed. Review the current status, then choose again if needed.",
    "fa": "تنظیمات فضای {space} تغییر کرده است. وضعیت فعلی را ببینید و در صورت نیاز دوباره انتخاب کنید."
  },
  "current": {
    "en": "Current status in {space} is shown. The earlier change could not be confirmed.",
    "fa": "وضعیت فعلی فضای {space} نمایش داده می‌شود. تغییر قبلی تأیید نشد."
  },
  "pauseSuccess": {
    "en": "Pause confirmed in {space}.",
    "fa": "مکث در فضای {space} تأیید شد."
  },
  "resumeSuccess": {
    "en": "Pause removed in {space}. Existing permissions still apply.",
    "fa": "مکث در فضای {space} برداشته شد. مجوزهای موجود همچنان تعیین‌کننده‌اند."
  },
  "unchanged": {
    "en": "No change was needed. Current status in {space} is shown.",
    "fa": "نیازی به تغییر نبود. وضعیت فعلی فضای {space} نمایش داده می‌شود."
  },
  "unsupported": {
    "en": "Personalization pause is not available for this account’s current storage and connection. No pause has been confirmed here.",
    "fa": "مکث شخصی‌سازی برای ذخیره‌سازی و اتصال فعلی این حساب در دسترس نیست. اینجا هیچ مکثی تأیید نشده است."
  },
  "unverified": {
    "en": "Pause status could not be verified. Check current status.",
    "fa": "وضعیت مکث قابل تأیید نیست. وضعیت فعلی را بررسی کنید."
  },
  "auth": {
    "en": "Open Vox Studio from your authenticated account to check this status.",
    "fa": "برای بررسی این وضعیت، Vox Studio را از حساب احرازشدهٔ خود باز کنید."
  },
  "summaryDisabled": {
    "en": "Summaries of saved notes are unavailable while personalization is paused in {space}. You can still manage the original notes where allowed.",
    "fa": "خلاصه‌سازی یادداشت‌های ذخیره‌شده هنگام مکث شخصی‌سازی در فضای {space} در دسترس نیست. در صورت داشتن مجوز، همچنان می‌توانید اصل یادداشت‌ها را مدیریت کنید."
  },
  "summaryInvalidated": {
    "en": "This summary preview is no longer usable. After resuming, request a fresh preview.",
    "fa": "این پیش‌نمایش خلاصه دیگر قابل استفاده نیست. پس از ازسرگیری، پیش‌نمایش تازه بخواهید."
  },
  "preference": {
    "en": "Saved, but not applied while personalization is paused in {space}.",
    "fa": "ذخیره شده است، اما هنگام مکث شخصی‌سازی در فضای {space} اعمال نمی‌شود."
  },
  "consent": {
    "en": "Consent remains granted. Use covered by this pause is blocked.",
    "fa": "رضایت همچنان برقرار است. استفادهٔ مشمول این مکث مسدود است."
  },
  "history": {
    "en": "Your visible history is for viewing here. It is not reused in AI requests while covered by this pause or when its source is unknown. History retention has separate rules.",
    "fa": "سابقهٔ قابل مشاهده برای دیدن در اینجاست. تا وقتی مشمول این مکث است یا منبعش نامشخص است، در درخواست‌های هوش مصنوعی دوباره استفاده نمی‌شود. نگهداری سابقه قواعد جداگانه دارد."
  },
  "conversation": {
    "en": "Personalization is paused in {space}. Available replies use your current input without stored personalization.",
    "fa": "شخصی‌سازی در فضای {space} مکث شده است. پاسخ‌های در دسترس از ورودی فعلی شما و بدون شخصی‌سازی بر پایهٔ اطلاعات ذخیره‌شده استفاده می‌کنند."
  },
  "pausedUse": { "en": "This use of stored information is paused in {space}.", "fa": "این استفاده از اطلاعات ذخیره‌شده در فضای {space} مکث شده است." },
  "historicDisabled": {
    "en": "Reviewing an earlier message for memory is unavailable while paused. A fresh, explicit review of current text is a separate action when available.",
    "fa": "بررسی پیام قبلی برای حافظه هنگام مکث در دسترس نیست. بررسی تازه و صریحِ متن فعلی، در صورت دسترسی، اقدامی جداگانه است."
  }
} as const;
export function pauseText(locale: 'en' | 'fa', space: PauseSpace, key: keyof typeof productPauseCopy): string {
  const label = locale === 'fa' ? space === 'work' ? 'کاری' : 'شخصی' : space === 'work' ? 'Work' : 'Personal';
  return productPauseCopy[key][locale].replaceAll('{space}', label);
}
