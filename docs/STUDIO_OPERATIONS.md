# Studio production operation coordination

This guide describes the cooperative guard in `scripts/studio-production.mjs`. Check the exact candidate's test and release evidence before operating it; these instructions do not establish that a guarded release is deployed or currently holds a lock.

## Before an install or rollback

Use the guarded `studio-production.mjs` entry point for every production mutation. The guard coordinates `prepare`, `install`, `stop`, `backup`, and `rollback` using one atomic owner-token lock under the canonical production base. It remains held through readiness checks and any installer recovery. `status` is observational. The supervised runtime's `run` command must not acquire the operation lock or wait for it to be released, so it can start while installation is waiting for readiness.

For an install, supply the currently approved release as a complete baseline: its absolute resolved release directory, full 40-character revision, and build ID. For a true first install, explicitly state that the current release is absent. Example shapes only; replace every placeholder with values from the reviewed release approval and trusted operator records:

```sh
node scripts/studio-production.mjs install \
  --expect-current '<absolute-resolved-release-path>' \
  --expect-revision '<full-40-character-revision>' \
  --expect-build '<approved-build-id>'

# Only for a verified initial install with no current release:
node scripts/studio-production.mjs install --expect-absent
```

For rollback, provide the expected currently installed path, full revision, and build ID using the same `--expect-current`, `--expect-revision`, and `--expect-build` flags. Rollback does not accept `--expect-absent`: without a present baseline there is no known release to restore safely.

After acquiring the lock, the guard must compare this tuple to a fresh, consistent view before any configuration/artifact write. It must check ownership and the captured tuple again before stopping the service, then again immediately before switching `current`. A mismatch or incomplete/corrupt metadata fails closed; do not substitute a newer observed baseline or retry with different values without renewed release approval.

Do not run a second build against the same candidate while it is being installed. The operation lock does not freeze build inputs.

## Lock conflicts and recovery

An existing lock, partial owner record, or failed lock acquisition means another operation may be active. Do not delete or reclaim it based on age, PID absence, an empty process search, or a health check. A stale lock fails closed. Recovery requires an operator to verify the exact lock token and directory identity, prior owner and installer descendants, and a fresh installed baseline, then coordinate explicit removal of that exact stale lock.

If install recovery finds that `current` no longer points to this operation's own candidate release, it must not stop the service, overwrite the pointer, change `previous`, or restart a stale release. Preserve the evidence and escalate the conflict to the release owner. Lock cleanup may remove only the token and lock-directory identity acquired by that operation.

If stopping the service fails partway through, the operation fails without taking a snapshot or switching releases. Service state may be uncertain; the operator must reconcile it before retrying. Automatic recovery is not a guarantee that every failure restores a running service.

An atomic directory lock cannot guarantee cleanup after SIGKILL, power loss, or an operating-system crash. Legacy installer copies, manual `launchctl`/server actions, direct `studio:start` or `npm start`, and another host or production base that does not cooperate can bypass the guard. Coordinate those paths separately; the guard does not claim host-wide exclusion.

## فارسی

این راهنما محافظ هماهنگی در `scripts/studio-production.mjs` را توضیح می‌دهد. پیش از اجرای آن، شواهد آزمون و انتشار همان نامزد را بررسی کنید؛ این دستورالعمل‌ها اثبات نمی‌کنند که نسخهٔ محافظت‌شده مستقر است یا اکنون قفلی را در اختیار دارد.

### پیش از نصب یا بازگشت

برای همهٔ تغییرات محیط تولید از مسیر محافظت‌شدهٔ `studio-production.mjs` استفاده کنید. محافظ، فرمان‌های `prepare`، `install`، `stop`، `backup` و `rollback` را با یک قفل اتمیِ دارای توکن مالکیت زیر مسیر canonical محیط تولید هماهنگ می‌کند. قفل تا پایان بررسی آمادگی و هرگونه بازیابی نصب‌کننده نگه داشته می‌شود. فرمان `status` فقط وضعیت را می‌خواند. فرمان `run` برای اجرای runtime تحت نظارت نباید قفل عملیات را بگیرد یا منتظر آزادشدن آن بماند تا هنگام انتظار نصب برای آمادگی بتواند شروع شود.

برای نصب، نسخهٔ فعلیِ مورد تأیید را با یک مبنای کامل مشخص کنید: مسیر مطلق و resolve‌شدهٔ پوشهٔ نسخه، شناسهٔ کامل ۴۰ نویسه‌ای بازبینی، و شناسهٔ build. برای نصب اولیهٔ واقعی، نبود نسخهٔ فعلی را صریح اعلام کنید. نمونه‌ها فقط قالب هستند؛ همهٔ جای‌نگهدارها را با مقادیر تأیید انتشار و سوابق معتبر اپراتور جایگزین کنید:

```sh
node scripts/studio-production.mjs install \
  --expect-current '<مسیر-مطلق-نسخه-فعلی>' \
  --expect-revision '<شناسه-کامل-۴۰-نویسه‌ای>' \
  --expect-build '<شناسه-build-تأییدشده>'

# فقط برای نصب اولیهٔ تأییدشده که نسخهٔ فعلی وجود ندارد:
node scripts/studio-production.mjs install --expect-absent
```

برای بازگشت، مسیر، بازبینی کامل و شناسهٔ build نسخهٔ فعلیِ مورد انتظار را با همان گزینه‌های `--expect-current`، `--expect-revision` و `--expect-build` ارائه کنید. بازگشت، `--expect-absent` را نمی‌پذیرد؛ بدون مبنای موجود، نسخهٔ شناخته‌شده‌ای برای بازیابی ایمن وجود ندارد.

محافظ پس از گرفتن قفل باید این سه‌تایی را با وضعیت تازه و سازگار مقایسه کند؛ این بررسی باید پیش از هرگونه نوشتن پیکربندی یا artifact انجام شود. پیش از توقف سرویس، مالکیت و مبنای ثبت‌شده را دوباره بررسی می‌کند و بار دیگر درست پیش از تغییر `current` همین کار را انجام می‌دهد. هرگونه عدم تطابق یا فرادادهٔ ناقص/خراب باعث توقف ایمن می‌شود؛ مبنای تازه‌مشاهده‌شده را جایگزین نکنید و بدون تأیید دوبارهٔ انتشار با مقادیر دیگر تلاش نکنید.

هم‌زمان با نصب، برای همان نامزد build دیگری اجرا نکنید. قفل عملیات، ورودی‌های build را ثابت نگه نمی‌دارد.

### تعارض قفل و بازیابی

وجود قفل، رکورد مالکیت ناقص یا شکست در گرفتن قفل یعنی ممکن است عملیات دیگری در جریان باشد. قفل را بر اساس عمر، نبود PID، خالی‌بودن جست‌وجوی فرایندها یا بررسی سلامت حذف یا پس نگیرید. قفل کهنه باعث توقف ایمن می‌شود. بازیابی نیازمند بررسی توکن و شناسهٔ دقیق پوشهٔ قفل، مالک قبلی و فرزندان نصب‌کننده، و مبنای تازهٔ نسخهٔ نصب‌شده است؛ سپس اپراتور باید حذف صریح همان قفل کهنه را هماهنگ کند.

اگر بازیابی نصب تشخیص دهد `current` دیگر به نسخهٔ نامزدِ ساخته‌شده توسط همین عملیات اشاره نمی‌کند، نباید سرویس را متوقف کند، اشاره‌گر را بازنویسی کند، `previous` را تغییر دهد یا نسخهٔ کهنه‌ای را دوباره اجرا کند. شواهد را حفظ و تعارض را به مسئول انتشار ارجاع دهید. پاک‌سازی قفل فقط مجاز است توکن و شناسهٔ پوشه‌ای را حذف کند که همان عملیات گرفته است.

اگر توقف سرویس در میانهٔ کار شکست بخورد، عملیات بدون گرفتن نسخهٔ پشتیبان یا تعویض نسخه متوقف می‌شود. وضعیت سرویس ممکن است نامشخص باشد؛ اپراتور باید پیش از تلاش دوباره آن را بررسی و تعیین تکلیف کند. بازیابی خودکار تضمین نمی‌کند که پس از هر خطا سرویس دوباره در حال اجرا باشد.

قفل پوشه‌ای اتمی پس از SIGKILL، قطع برق یا خرابی سیستم‌عامل تضمین نمی‌کند که پاک شود. نسخه‌های قدیمی نصب‌کننده، فرمان‌های دستی `launchctl`/سرور، اجرای مستقیم `studio:start` یا `npm start` و میزبان یا مسیر محیط تولید دیگری که همکاری نکند می‌توانند محافظ را دور بزنند. این مسیرها را جداگانه هماهنگ کنید؛ محافظ ادعای انحصار در کل میزبان ندارد.

