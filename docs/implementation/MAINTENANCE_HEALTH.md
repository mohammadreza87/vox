# Recorded maintenance status / وضعیت ثبت‌شدهٔ نگهداری

Bounded VOX-022 / VOX-052 implementation, based on released `9371894`. Backend and frontend authors are separate from the independent evaluator. Sol handles this slice because it changes operator authorization and storage inspection; the broader fixed-schema reporting role remains assigned to Luna in the backlog. Author source checks passed; independent acceptance, composed CI, compiled browser and deployment evidence must be attached to the exact candidate before release.

## What the operator sees

The Studio Software improvement operations card now distinguishes maintenance configuration from recorded checkpoint evidence. The English/Persian status section displays snapshot time, last recorded activity, recorded result, page/account progress, fixed failure copy and recorded lease expiry where available. It is system-wide and independent of the selected Work/Personal space; only a current owner or superadmin can read it.

One initial request and the existing manual Refresh operations action read status. Refresh clears previous evidence while loading. Abort and generation checks suppress late responses after refresh, space/view change or unmount. No polling timer, maintenance trigger, scheduler control, automatic retry or notification is added. The client validates the shared strict browser-safe contract; missing legacy or malformed health is unavailable.

`not_started` means a successful inspection found no checkpoint. Missing health capability is `not_configured`; it does not mean empty history. A disabled runner can still expose retained checkpoint evidence. `leased` means a future lease was recorded; `stale` means the recorded lease expired. Neither proves worker liveness. A lock produces `busy` without a snapshot. Unsupported, corrupt, inconsistent, future-dated or unreadable state is unavailable. There is no invented age threshold, percentage or ETA.

The checkpoint timestamp can reflect lease claim, renewal or final writes; it is not an exact attempt start or completion time. Counts cover checkpointed scan progress, not unique people or verified deletions. A prior failed result remains visible alongside a newly held lease. The browser does not reinterpret a static lease snapshot as current liveness after its local clock advances.

## Read and authority boundary

The read-only capability is wired separately from maintenance execution. It inspects the existing strict v1 checkpoint from the known FILE adapter, without calling generic unbounded reads. Fixed hashed key, 16 KiB limit, no-follow descriptor access, private path/file checks and before/after identity checks bound inspection. Unsupported adapters fail closed. No read creates or repairs directories/files, clears locks, advances a durable clock, claims/renews a lease or sweeps accounts.

The operations GET bypasses membership mutation. It requires a fresh signed session and exactly one committed owner/superadmin membership before reading; after serialization it rechecks authentication and committed role synchronously before publishing. Raw errors, account IDs, cursor, worker/token identity and private content are never in the health projection. Reasons are fixed catalog values and are translated into neutral interface copy.

Existing Studio process bootstrap can initialize its own runtime storage before this handler is called; that is distinct from a health read. Independent compiled checks record bootstrap separately and compare repeated operation reads afterward. This slice does not alter checkpoint schema, scheduler, sweep behavior, feature flags, production storage format or provider-deletion guarantees.

## Acceptance and remaining work

Required synthetic cases include empty/retained/failed/held/expired checkpoints, disabled execution, lock/corruption/unsupported storage, bounded reads with no side effects, malformed client responses, access revocation and expired authentication at publication, and EN/FA refresh/cancellation/mobile layout. Independent compiled journeys use actual operations HTTP with execution off; configured-runner behavior is checked through source/runtime/component tests. A live scheduled run is not inferred from those results.

Operator status is not an alerting service. Cohort dashboards, operational SLO/load qualification, notification of failed sweeps, production IAM, provider residual deletion and complete backup restoration remain open in the parent tasks. Production maintenance remains disabled unless separately configured under its existing release gate.

## فارسی

این بخش محدود از VOX-022 و VOX-052، وضعیت ثبت‌شدهٔ نگهداری را برای مالک یا سوپرادمین فعلی نمایش می‌دهد. وضعیت کل سامانه از فضای کاری/شخصی انتخاب‌شده مستقل است. پیکربندی با شواهد اجرای ثبت‌شده فرق دارد؛ خاموش بودن اجرا، سابقهٔ موجود را به «هیچ اجرایی ثبت نشده» تبدیل نمی‌کند.

نمای انگلیسی/فارسی، زمان مشاهده، آخرین فعالیت ثبت‌شده، نتیجهٔ قبلی، تعداد صفحه‌ها و حساب‌ها در پیشرفت ثبت‌شده، خطای ثابت و زمان انقضای مجوز موقت را نشان می‌دهد. این شمارنده‌ها تعداد افراد یکتا یا حذف تأییدشده نیستند. مجوز برقرار یا منقضی، زنده بودن فرایند را ثابت نمی‌کند و زمان فعالیت ممکن است به ثبت یا تمدید مجوز مربوط باشد. خطای قبلی در کنار مجوز جدید پنهان نمی‌شود.

فقط دریافت اولیه و دکمهٔ دستی تازه‌سازی وجود دارد؛ هیچ اجرا، زمان‌بندی، اعلان یا تلاش خودکار تازه‌ای اضافه نمی‌شود. هنگام تازه‌سازی، شواهد قدیمی پاک می‌شود و پاسخ دیررس پس از تغییر نما یا خروج نمایش داده نمی‌شود. دادهٔ ناقص، ناسازگار یا قدیمیِ فاقد فیلد وضعیت، «در دسترس نیست» خواهد بود. خواندن وضعیت هیچ فایل، قفل یا مجوزی را تغییر نمی‌دهد و کنترل نقش و احراز هویت درست پیش از انتشار پاسخ دوباره انجام می‌شود.

بررسی مستقل، CI، مسیر مرورگر کامپایل‌شده و رسید استقرار باید به نامزد دقیق متصل باشند. این تغییر، هشدار عملیاتی، تأیید حذف نزد ارائه‌دهنده، بازیابی کامل پشتیبان، سنجش بار یا تکمیل همهٔ وظایف والد نیست؛ فعال‌سازی نگهداری تولید جداگانه باقی می‌ماند.
