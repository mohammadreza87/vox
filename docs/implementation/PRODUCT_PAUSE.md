# Personalization pause / مکث شخصی‌سازی

Implementation candidate, 20 October 2026. Independent composed acceptance, compiled browser qualification, CI and release are pending. This is a bounded product control within the VOX-056 work; the formal rights service, guest requests, deadlines and provider/backup erasure remain open.

## User behavior

An authenticated account can pause Work or Personal independently. Pause stops using saved private notes, derived summaries, preferences, personalized relationship activity and shared personalized context that requires a paused participant. Existing consent choices remain unchanged. Resume is a new explicit choice; it requires a current confirmed profile and Studio access, and grants no consent.

Users can still manage their original notes and preferences under their existing permissions. Conversation can use freshly supplied current text without stored personalization. Saved or unknown-provenance history, cached prefixes and previous prepared requests cannot be relabeled as current input. Earlier-message review shortcuts and saved-note summaries are unavailable while paused. Existing local history viewing has separate retention rules.

Requested ordinary reminders, analytics, voice identity and security keep their separate controls. Pause does not delete data, promise indefinite retention, recall delivered information or constitute a formal legal restriction request. Consent withdrawal, deletion and normal expiry retain their existing effects.

The UI shows pending or unknown when a command response is lost. It reads current state and never silently retries the old action against a newer sequence. A lost pause response followed by a later resume must not let an old pause retry overwrite the resume. Only the latest exact receipt supports reconciliation; there is no historical completion claim after another command becomes latest.

## Runtime and storage contract

- Canonical v2 and compact controls require two scoped rows. Every accepted command consumes a sequence; only an effective state change increments the use epoch. Receipt and state commit together. Bookkeeping reserves 2 KiB within the existing 700,000-byte account limit, independent of ordinary event/outbox capacity.
- Existing v1 remains readable without foreground conversion. Explicit conversion validates and preserves current data, permissions, tombstones and clock observations, rebuilds projections and creates a new storage identity. Oversized or malformed sources fail without truncation. A missing v2 control never defaults to unpaused.
- Initial support is prepared local SQLite or managed FILEv2 with qualified provider and final-output guards. Current state is checked before provider export, stream chunks, speech and delivery. Old prepared context remains invalid after resume. Unsupported transports cannot advertise the control.
- Pause suspends use without invalidating retained primary relationship sources. Transient learning/dispatch work is cancelled; new work after resume needs fresh authority. Source retention and use authorization remain separate.
- Account-owned `GET /api/studio/product-pause?space=work|personal` and strict `POST /api/studio/product-pause` use signed account authentication. Payloads cannot select another owner. Pause/status do not require optional consent, a fresh profile or an approved Studio role. Resume checks current core/profile and Studio membership again at commit.

## Operator boundaries

Source deployment does not prepare or activate a v2 store. The reviewed conversion entry is `scripts/adaptive-storage.ts prepare-product-pause --root <absolute-adaptive-root> --format sqlite-v1|file-v2 --quiesced`. It is an explicit operator action after actual process quiescence, current-state backup and the exact candidate's qualification. The flag is an assertion, not proof that another process stopped. Do not run it against production merely because this document exists.

Ready marker v2 declares canonical schema 2, controls schema 2 and product-pause enforcement version 1. Install and rollback inspect the current selected store before switching binaries. A release without the matching capability manifest cannot be installed over a prepared v2 store, even if nobody is currently paused. Runtime schema rejection is a second check. This protects the supported release commands; it does not constrain arbitrary old operator tools or root access.

Rollback uses current-state conversion into a compatible target. Never restore an earlier data snapshot over newer pause choices, withdrawals or deletion. Retired stores and backups follow their separate retention policy; no secure-erasure claim is made. Optional provider features and production configuration require their own activation decision.

## رفتار برای کاربر

هر حساب احرازشده می‌تواند شخصی‌سازی را در فضای کاری یا شخصی، به‌صورت جداگانه مکث کند. در این حالت از یادداشت‌های ذخیره‌شده، خلاصه‌ها، ترجیح‌ها، فعالیت شخصی‌سازی‌شدهٔ رابطه‌ها و زمینهٔ مشترکی که به شرکت‌کنندهٔ مکث‌کرده وابسته است استفاده نمی‌شود. رضایت‌های قبلی تغییر نمی‌کنند. ازسرگیری یک انتخاب صریح و تازه است؛ نمایه و دسترسی فعلی را بررسی می‌کند و رضایت جدیدی نمی‌دهد.

مدیریت اصل یادداشت‌ها و ترجیح‌ها، با مجوزهای مستقل خود، ادامه دارد. پاسخ می‌تواند از متن تازهٔ فعلی استفاده کند. سابقه، پیشوندهای ذخیره‌شده و درخواست‌های آمادهٔ قبلی با منبع مشمول مکث یا نامشخص، ورودی تازه محسوب نمی‌شوند. بررسی پیام‌های قبلی برای حافظه و خلاصه‌سازی یادداشت‌های ذخیره‌شده هنگام مکث در دسترس نیست. دیدن سابقهٔ خود کاربر قواعد نگهداری جداگانه دارد.

یادآوری‌های عادیِ درخواستی، تحلیل کاربرد، تشخیص صدا و امنیت تنظیمات مستقل دارند. مکث به معنای حذف داده، نگهداری نامحدود، پس‌گرفتن اطلاعات تحویل‌شده یا درخواست رسمی محدودسازی قانونی نیست. حذف، پس‌گرفتن رضایت و انقضای معمول همچنان اثر مستقل خود را دارند.

اگر پاسخ فرمان نرسد، وضعیت «در انتظار» یا «نامشخص» نمایش داده می‌شود. برنامه وضعیت فعلی را می‌خواند و فرمان قدیمی را خودکار بر پایهٔ توالی جدید اجرا نمی‌کند. تلاش دوباره برای یک مکث قدیمی نباید ازسرگیری جدیدتر را بازنویسی کند.

## مرز عملیاتی

انتشار کد به‌تنهایی ذخیره‌سازی را تبدیل یا قابلیت را فعال نمی‌کند. آماده‌سازی نسخهٔ ۲ نیازمند اقدام صریح اپراتور، توقف واقعی پردازش، حفظ وضعیت فعلی و بررسی مستقل نسخهٔ دقیق است. دادهٔ خراب یا کنترلِ مفقود در نسخهٔ ۲ هرگز به‌طور پیش‌فرض «بدون مکث» تلقی نمی‌شود. ابزار انتشار و بازگشت، کدی را که توان اجرای کنترل‌های ذخیره‌شده ندارد رد می‌کند.

بازگشت باید انتخاب‌های فعلی مکث، رضایت‌ها و حذف‌ها را حفظ کند؛ بازیابی نسخهٔ قدیمی داده مجاز نیست. پشتیبان‌ها و فروشگاه‌های قبلی سیاست نگهداری جداگانه دارند و این قابلیت ادعای پاک‌سازی امن همهٔ نسخه‌ها را ندارد. تکمیل جریان رسمی حقوق کاربر و درخواست مهمان هنوز بخشی از کار باقی‌مانده است.
