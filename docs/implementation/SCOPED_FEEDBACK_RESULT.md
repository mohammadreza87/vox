# Terminal inbox feedback / بازخورد نهایی صندوق ورودی

## English

### Scope: VOX-032/036-FB0

A delayed read could change a dismissed suggestion or relationship check-in back
to `read`. Dismissal had already cleared the message, so the item could return as
an empty card. Runtime usefulness feedback could also change a dismissed item's
recorded outcome.

Dismissed items now remain dismissed. Later read, usefulness and repeated dismiss
commands succeed without changing the item's status, revision or feedback.
Runtime command receipts and aggregate revisions still advance for a newly
accepted command; existing replay and revision checks remain in force.
Relationship feedback makes no aggregate change for an already dismissed item.
Cancelled items still return `not_found`, and active-item feedback is unchanged.

### Implementation and independent acceptance

- Base: `cf63acf64c6eadf5a2247d2436e0a22bc114386b`.
- Product and regression-test commit: `eb7c4375337e04692806458f7a9dfa5d987e1bda`.
- Product files: `src/lib/adaptive/runtime/service.ts` and
  `src/lib/adaptive/relationships/service.ts`.
- Author regression tests reproduced five failures before the repair. Both
  affected test files then passed all 37 tests.
- A separate evaluator froze its acceptance criteria and runner before execution.
  The same 24 cases produced 14 failures on the base and passed all 24 on the
  repair, with no skips, retries or harness corrections.
- Independent checks covered file-storage restart, delayed actions, command
  replay, revision checks, cancellation, active feedback, account/space isolation,
  producer replay, interruption budgets, signed HTTP handling, and the actual
  Studio relationship command dispatcher with access/projection stubs.
- Both independent runs recorded zero fetch calls and used synthetic local data.

Independent report SHA256:
`a878070f6d2ab83d70002ccbee8315ffa68f0bc1006d018bbe17e4f07c6c0a34`.
Frozen runner SHA256:
`d28f200e111ced7e11017486cb94aeeb96dcdd2b594c5e52e7cb5bcdf4a3f4fb`.
The report, runner, acceptance criteria and per-case results are retained in the
task's `vox-scoped-feedback/independent/` evidence directory.

### Evidence boundaries and remaining work

This records local deterministic acceptance of this repair. The dispatcher check
is not a full authenticated browser journey. Deployment, device behavior, provider
quality, real-user usefulness and the broader VOX-032/036 work are not established
by these results. Evaluator separation is by role on a shared filesystem.

Natural replies about an earlier check-in still need a separate design that links
the reply to the exact authorized item. This repair does not infer feedback from
silence, a generic notification or an unrelated user reply.

## فارسی

### محدوده: VOX-032/036-FB0

یک درخواست دیررس برای خواندن می‌توانست وضعیت پیشنهاد یا پیگیری ردشده را دوباره
به `read` تغییر دهد. چون ردکردن، متن پیام را پاک کرده بود، کارت ممکن بود بدون
متن دوباره ظاهر شود. بازخورد مفیدبودن در سرویس runtime نیز می‌توانست نتیجهٔ
ثبت‌شدهٔ یک مورد ردشده را تغییر دهد.

اکنون مورد ردشده در همان وضعیت باقی می‌ماند. درخواست‌های بعدی برای خواندن،
ثبت مفیدبودن یا ردکردن دوباره، بدون تغییر وضعیت، نسخه یا بازخورد آن مورد موفق
می‌شوند. در runtime، رسید فرمان و نسخهٔ کل سند برای فرمان تازهٔ پذیرفته‌شده
همچنان ثبت می‌شوند و کنترل نسخه و تکرار فرمان برقرار است. در سرویس رابطه،
بازخورد برای موردی که قبلاً رد شده هیچ تغییری در سند ایجاد نمی‌کند.
موارد لغوشده همچنان `not_found` می‌دهند و رفتار بازخورد موارد فعال تغییر نکرده است.

### پیاده‌سازی و پذیرش مستقل

- نسخهٔ پایه و کامیت پیاده‌سازی همان شناسه‌های کامل بخش انگلیسی هستند.
- آزمون‌های نویسنده پیش از اصلاح پنج شکست را بازتولید کردند؛ پس از اصلاح هر
  ۳۷ آزمون در دو فایل مربوط قبول شدند.
- ارزیاب مستقل، معیارها و برنامهٔ آزمون را پیش از اجرا ثابت کرد. همان ۲۴ مورد
  در نسخهٔ پایه ۱۴ شکست داشتند و در نسخهٔ اصلاح‌شده همگی قبول شدند؛ هیچ آزمونی
  کنار گذاشته نشد و اجرا یا برنامهٔ آزمون نیز تکرار یا اصلاح نشد.
- بررسی‌ها شامل بازکردن مجدد ذخیره‌ساز فایل، درخواست دیررس، تکرار فرمان،
  کنترل نسخه، لغو، بازخورد فعال، جداسازی حساب و فضا، تکرار تولید پیام، بودجهٔ
  مزاحمت، مسیر HTTP امضاشده و مسیریاب واقعی فرمان رابطه در Studio بود.
  بررسی Studio از جایگزین‌های آزمونی برای دسترسی و نمایش استفاده کرد.
- داده‌ها ساختگی و محلی بودند و در هر دو اجرای مستقل تعداد فراخوانی fetch صفر بود.
  گزارش و برنامهٔ آزمون با همان هش‌های بخش انگلیسی نگهداری شده‌اند.

### محدودیت شواهد و کار باقی‌مانده

این نتیجه، پذیرش محلی و قطعی همین اصلاح است. بررسی مسیریاب فرمان، آزمون کامل
مرورگر با ورود کاربر نیست. این نتایج استقرار، رفتار روی دستگاه، کیفیت ارائه‌دهنده،
سودمندی برای کاربران واقعی یا تکمیل کل کار VOX-032/036 را اثبات نمی‌کنند.
جداسازی ارزیاب بر پایهٔ نقش و در یک فایل‌سیستم مشترک انجام شده است.

پاسخ طبیعی دربارهٔ پیگیری قبلی هنوز به طراحی جداگانه‌ای نیاز دارد که پاسخ را
به همان مورد مجاز متصل کند. این اصلاح از سکوت، اعلان عمومی یا پاسخ نامرتبط،
بازخورد استنباط نمی‌کند.
