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

### RI-PILOT-01: internal company availability

The user explicitly requested the company's owner/superadmin pilot. A separate version-2 manifest uses `basis: internal_company_pilot` rather than claiming a resolved jurisdiction or legal approval. It has an explicit account list, current operational review owner/reference, and a maximum 90-day validity window. A synchronous read of current Studio membership must still show exactly one owner/superadmin account at every eligibility evaluation. Account removal, demotion, missing authority resolution or expiry denies use. The version-1 jurisdiction-based policy remains unchanged.

This pilot may make only text notes, usage analytics, personalization, automatic memory, requested reminders, proactive suggestions and Telegram check-in alerts available. It cannot enable biometric recognition, content quality review, or audio/image capabilities. Each person's profile/adult confirmation, purpose choices, agent grants, channel choices, pauses and holds remain effective. No existing permission is changed by provisioning. A country answer is not a prerequisite for this operational pilot; regional/legal qualification remains unverified and is not implied by the manifest.

The planned production configuration enables the scoped relationship loop and reminder maintenance/delivery workers for the existing owner/superadmin cohort. Those workers still require the relevant individual choices and fresh eligible input. The explicitly requested daily lesson uses its own direct-request authorization, so it does not wait for automatic-memory consent or a social check-in grant.

Interactive privacy changes and private interactive access still require a current confirmed profile session. Background reminders and relationship work use their existing separately granted durable identity and channel bindings, so the interactive session expiring does not by itself cancel those grants. Clearing the profile identity blocks this work. The grants' own expiry, current membership, adult declaration, purpose/agent/channel/source permissions, withdrawal, pause and processing holds continue to govern delivery. A 90-day operational policy does not create a 90-day individual background grant.

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

### RI-PILOT-01: دسترسی آزمایشی داخلی شرکت

کاربر استفادهٔ آزمایشی داخلی برای مالک‌ها و مدیران ارشد را صریحاً درخواست کرده است. تنظیم نسخهٔ دوم با مبنای `internal_company_pilot` از تأیید حقوقی یا منطقهٔ قضایی تفکیک می‌شود. حساب‌ها مشخص‌اند، مسئول و مرجع بررسی عملیاتی ثبت می‌شوند و اعتبار حداکثر ۹۰ روز است. در هر بررسی دسترسی، عضویت فعلی باید دقیقاً یک حساب مالک یا مدیر ارشد را نشان دهد. حذف حساب، کاهش نقش، نبود بررسی معتبر یا انقضا دسترسی را متوقف می‌کند. مسیر سیاست منطقه‌ای نسخهٔ اول تغییر نمی‌کند.

این حالت فقط یادداشت متنی، تحلیل استفاده، شخصی‌سازی، حافظهٔ خودکار، یادآور درخواستی، پیشنهاد پیش‌دستانه و اعلان تلگرام را در دسترس قرار می‌دهد. تشخیص زیست‌سنجی، بررسی کیفیت محتوا و قابلیت‌های صوتی یا تصویری را فعال نمی‌کند. تأیید نمایه و بزرگ‌سالی، انتخاب هدف، مجوز عامل و کانال، توقف و محدودیت‌های کاربر همچنان لازم و معتبرند. هیچ رضایتی خودکار ثبت نمی‌شود. پاسخ کشور پیش‌نیاز این آزمایش عملیاتی نیست؛ صلاحیت منطقه‌ای یا حقوقی همچنان تأییدنشده است.

تنظیم عملیاتی موردنظر کارگرهای رابطهٔ محدود و نگهداری و ارسال یادآورها را برای همان گروه داخلی فعال می‌کند. این مسیرها همچنان به انتخاب شخص و ورودی تازهٔ مجاز نیاز دارند. درس روزانهٔ صریحاً درخواست‌شده مجوز درخواست مستقیم خودش را دارد و به رضایت حافظهٔ خودکار یا پیگیری اجتماعی وابسته نیست.

تغییر تعاملی تنظیمات حریم خصوصی و دسترسی خصوصی تعاملی همچنان به نشست فعلیِ نمایهٔ تأییدشده نیاز دارد. یادآورها و کارهای رابطه در پس‌زمینه از پیوند هویت و کانال پایدارِ جداگانه‌ای استفاده می‌کنند که شخص مجاز کرده است؛ پایان نشست تعاملی به‌تنهایی آن مجوزها را لغو نمی‌کند. پاک‌کردن هویت نمایه این کارها را متوقف می‌کند. انقضای خود مجوز، عضویت فعلی، تأیید بزرگ‌سالی، مجوز هدف و عامل و کانال و منبع، پس‌گرفتن رضایت، توقف و محدودیت پردازش همچنان ارسال را کنترل می‌کنند. اعتبار ۹۰روزهٔ سیاست عملیاتی به‌معنای ایجاد مجوز پس‌زمینهٔ ۹۰روزه برای شخص نیست.
