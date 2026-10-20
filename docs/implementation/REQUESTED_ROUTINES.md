# Requested daily lessons and privacy activation

Task RR-01 / RI-ACTIVATE, baseline `4be2b395`, 20 October 2026.
Status: implementation and independent acceptance in progress; this document is not a deployment receipt.

## English

The user expects Marcus to send daily English slang in his own private Telegram chat, choosing an appropriate moment from the user's timezone and activity. Existing conversation replies cannot create a recurring task. Generic Experience reminders are one-time inbox alerts from the manager bot, and relationship check-ins are a separate workflow.

RR-01 adds a durable, expressly requested daily task. The default timing is adaptive: a known IANA timezone defines the daytime window, recent interaction timestamps help avoid interruptions, and a bounded timing decision can send or defer. It does not promise a fixed clock time. A person may choose a fixed time explicitly. Missing timezone is clarified; language, nationality, and inferred mood do not determine it. The task survives restarts, avoids catch-up bursts and has list, change, pause, resume and stop controls.

The initial cohort is current owners and superadmins with current access to an active agent. The actual private Telegram sender, chat, agent bot identity and token fingerprint bind delivery. The model cannot choose a recipient or grant permission. A current authority check precedes generation and the external send. Cancellation or a changed identity invalidates queued work. A send whose outcome is unknown is not automatically retried. Telegram acceptance does not prove the user read a lesson.

The direct-content exception is specific to the user's requested daily lesson in their own verified private chat. Generation uses the declared instruction and a bounded history of that same task's lessons; it does not retrieve relationship memories, group conversations, or another person's history. Adaptive timing uses bounded timestamps, not conversation contents. Optional relationship check-in alerts retain their existing notice and generic payload contract.

The ledger is `requested-routines-v1.json` in the private runtime data directory. Active and paused tasks retain their instruction until stopped; recent lesson history is limited to seven snippets of at most 400 characters. Occurrence and inbound deduplication records expire after 30 days. There are at most eight tasks per member/agent and 500 overall, with 10,000 occurrence and inbound records each. Adaptive timing allows at most eight decisions per local day in the 09:00–20:00 window; activity older than seven days is ignored. These are initial engineering limits, not a claim of learned optimal timing.

Stop clears the instruction and lesson snippets from the canonical task and cancels pending generation. It cannot recall a Telegram message already dispatched. This separate ledger is not included in the existing adaptive account export or scoped private-note erasure. Runtime backups and interrupted-write temporary files are separate retention surfaces; no claim of complete filesystem erasure is made. `/daily list` exposes only the requesting person's tasks for that agent. Rollback disables the worker while preserving its ledger and receipts; do not replay an uncertain send.

Authors own the new routine engine and Studio integration separately. The lead owns production configuration, script imports, task documentation and release composition. An independent privacy/security reviewer selects checks and assesses the composed candidate. Required checks include multi-day time progression, DST, duplicate workers, persistence/restart, cancellation during generation, changed access/token, ambiguous sends, explicit versus quoted or negated requests, and disabled runtime behavior.

RI-ACTIVATE supplies the missing basic privacy-request policy and dedicated server-generated signing key. Request handling belongs to the current owner/superadmin team. Chosen operational periods are 30 days to review a request's retention, 90 days for audit and continuity metadata, 30 days for receipts and closed-request metadata, 15 minutes for handles, and one year for policy review. These are operational settings, not legal deadlines. Applicable deadlines remain unresolved rather than invented. Reassessment and purge remain deliberate operator actions.

Basic intake is available to recognized accounts, including a pending account that contacts the manager bot. Operators are explicitly listed current owners/superadmins; account export retains its separate membership checks. At preparation, the three current members are one owner and two superadmins. Future membership can broaden intake, but cannot automatically broaden operator access. Request tracking does not itself erase data, stop processing, change consent, or complete provider/backup work.

Available optional privacy controls require the per-account service manifest plus the person's own choices. Activating availability must not silently grant purposes, fabricate an adult declaration, or enroll a voice. Features without a working backend must be described accurately rather than given an enabled switch.

## فارسی

کاربر انتظار دارد مارکوس اصطلاح انگلیسی روزانه را در گفت‌وگوی خصوصی تلگرام خودش بفرستد و زمان مناسب را بر اساس منطقهٔ زمانی و فعالیت او انتخاب کند. پاسخ متنی فعلی وظیفهٔ تکرارشونده ایجاد نمی‌کند. یادآور فعلی فقط یک اعلان یک‌باره از ربات مدیر است و پیگیری رابطه مسیر جداگانه‌ای دارد.

در RR-01 درخواست صریح روزانه به وظیفه‌ای پایدار تبدیل می‌شود. زمان‌بندی پیش‌فرض تطبیقی است: منطقهٔ زمانی مشخص، بازهٔ روز را تعیین می‌کند؛ زمان آخرین تعامل برای جلوگیری از مزاحمت استفاده می‌شود؛ و تصمیم محدود می‌تواند ارسال را انجام دهد یا عقب بیندازد. ساعت ثابت وعده داده نمی‌شود. انتخاب ساعت ثابت اختیاری است. اگر منطقهٔ زمانی مشخص نباشد، پرسیده می‌شود و از زبان، ملیت یا حال‌وهوای حدس‌زده‌شده استخراج نمی‌شود. وظیفه پس از راه‌اندازی مجدد باقی می‌ماند و کنترل مشاهده، تغییر، توقف موقت، ادامه و لغو دارد.

گروه اولیه مالک‌ها و مدیران ارشد فعلی هستند که به عامل فعال دسترسی دارند. فرستنده و گفت‌وگوی خصوصی واقعی تلگرام، هویت ربات و اثرانگشت توکن مقصد را مشخص می‌کنند؛ مدل نمی‌تواند گیرنده یا مجوز ایجاد کند. پیش از تولید و ارسال، دسترسی دوباره بررسی می‌شود. لغو یا تغییر هویت، کار در صف را نامعتبر می‌کند. ارسال با نتیجهٔ نامعلوم خودکار تکرار نمی‌شود. پذیرش تلگرام اثبات خواندن پیام نیست.

ارسال محتوای درس فقط برای درخواست روزانهٔ خود کاربر در گفت‌وگوی خصوصی تأییدشده است. تولید از دستور صریح و تعداد محدودی از درس‌های همان وظیفه استفاده می‌کند، نه حافظهٔ رابطه، گفت‌وگوی گروه یا سابقهٔ شخص دیگر. انتخاب زمان فقط از زمان تعامل استفاده می‌کند، نه متن گفت‌وگو. قرارداد اعلان عمومی پیگیری‌های رابطه تغییر نمی‌کند.

فایل مستقل `requested-routines-v1.json` در پوشهٔ خصوصی سرویس نگهداری می‌شود. دستور وظیفهٔ فعال یا متوقف‌شدهٔ موقت تا لغو نهایی باقی می‌ماند؛ سابقه حداکثر هفت بخش درس با سقف ۴۰۰ نویسه است. سابقهٔ رخداد و جلوگیری از تکرار پس از ۳۰ روز منقضی می‌شود. سقف هر کاربر و عامل هشت وظیفه و سقف کل ۵۰۰ وظیفه است. حداکثر هشت تصمیم زمانی در هر روز محلی بین ساعت ۹ تا ۲۰ گرفته می‌شود و فعالیت قدیمی‌تر از هفت روز نادیده گرفته می‌شود. این‌ها محدودیت مهندسی اولیه‌اند، نه ادعای یادگیری بهترین زمان.

لغو، دستور و بخش‌های درس را از رکورد اصلی پاک می‌کند و تولید در صف را متوقف می‌کند؛ پیام ارسال‌شدهٔ تلگرام قابل پس‌گرفتن نیست. این فایل در خروجی فعلی حساب و حذف محدود یادداشت خصوصی پوشش داده نمی‌شود. نسخه‌های پشتیبان و فایل موقتِ نوشتن ناتمام سطح نگهداری جداگانه دارند؛ حذف کامل از همهٔ فایل‌ها ادعا نمی‌شود. بازگشت نسخه، کارگر را غیرفعال و رسیدها را حفظ می‌کند و ارسال نامعلوم نباید تکرار شود.

آزمون‌ها شامل چند روز، تغییر ساعت فصلی، کارگر هم‌زمان، راه‌اندازی مجدد، لغو هنگام تولید، تغییر دسترسی یا توکن، نتیجهٔ نامعلوم ارسال و درخواست‌های نقل‌قول‌شده یا منفی است. بازبین مستقل نسخهٔ ترکیبی را بررسی می‌کند.

در RI-ACTIVATE سیاست عملیاتی درخواست‌های حریم خصوصی و کلید اختصاصی تولیدشده روی سرور تنظیم می‌شود. بررسی درخواست بر عهدهٔ مالک‌ها و مدیران ارشد فعلی است. دوره‌های عملیاتی انتخاب‌شده: ۳۰ روز تا بررسی نگهداری درخواست؛ ۹۰ روز برای سابقهٔ ممیزی و تداوم؛ ۳۰ روز برای رسید و اطلاعات درخواست بسته؛ ۱۵ دقیقه برای اعتبار دستگیره؛ و یک سال برای بازبینی سیاست. این‌ها مهلت قانونی نیستند. مهلت قانونی نامشخص، نامشخص باقی می‌ماند. ارزیابی مجدد و پاک‌سازی فقط با اقدام مسئول انجام می‌شود.

ثبت درخواست برای حساب شناخته‌شده، از جمله حساب در انتظار عضویت، در دسترس است. خروجی حساب و دسترسی اپراتور بررسی جداگانه دارند. در زمان آماده‌سازی سه عضو شامل یک مالک و دو مدیر ارشد وجود دارد. عضویت جدید دسترسی اپراتور ایجاد نمی‌کند. ثبت درخواست به‌تنهایی داده را حذف نمی‌کند، پردازش را متوقف نمی‌کند و رضایت را تغییر نمی‌دهد.

در دسترس شدن کنترل‌های اختیاری به تنظیم سرویس برای حساب و انتخاب خود شخص وابسته است. فعال‌سازی دسترسی نباید رضایت، تأیید بزرگ‌سالی یا ثبت صدای کاربر را جعل کند. قابلیت فاقد زیرساخت اجرایی باید صادقانه توضیح داده شود.
