# Read-only preview inventory / فهرست فقط‌خواندنی پیش‌نمایش

Firebase preview creation can fail with HTTP 429 when the site has reached its channel quota. The preview workflow now attempts a bounded read-only inventory after a successful or failed deployment attempt, provided CLI preparation succeeded and the job was not cancelled. Deployment and inventory outcomes remain separate; inventory cannot turn a failed deployment into success.

The script uses the existing runner service account and project. It checks the credential's project, fixes the requested default site to that project, and accepts only the documented `sites/SITE_ID/channels/CHANNEL_ID` response scope. No IAM roles, secrets, workflow triggers, channel deletion or channel reuse are added.

Output contains channel counts and up to 100 PR-shaped channel IDs with expiry timestamps or explicit `null`. Live and other channels are counted separately; other labels are omitted. Omitted PR counts and completeness are explicit. A missing expiry does not establish cleanup eligibility. The existing preview comment now promises only its configured seven-day expiry.

Credential files use a private temporary directory and restrictive modes. The child runs the unmodified cached Firebase CLI 15.34.0 with an allowlisted environment. Raw provider output and debug logs are not published; failures use bounded codes. Temporary files are removed after success, failure, timeout or handled signals. Forced runner termination cannot execute cleanup.

The inventory has a 30-second deadline, 1 MiB stdout limit, 32 KiB stderr limit and 1,000-channel response limit. CLI pagination completes before projection. These are deadline/output limits; the CLI's internal accumulated pages do not have a strict heap bound. Malformed, oversized or foreign-site results produce no partial totals.

Local validation covers 14 synthetic script tests, six independent wrapper checks, two canonical-name/nullable-expiry probes and all 64 workflow-condition combinations. These checks use fictional credentials and local fake CLI processes. Runner execution, actual inventory totals, account/site availability and any subsequent cleanup decision require separate evidence. This feature does not establish production readiness of the conversation system.

References: [Firebase Channel resource](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels), [paginated channel listing](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels/list).

---

ایجاد پیش‌نمایش Firebase ممکن است به‌دلیل پرشدن سهمیهٔ کانال‌های سایت با خطای HTTP 429 متوقف شود. گردش‌کار اکنون پس از تلاش موفق یا ناموفق استقرار، در صورت آماده‌بودن CLI و لغونشدن کار، فهرست‌گیری محدود و فقط‌خواندنی انجام می‌دهد. نتیجهٔ فهرست‌گیری و استقرار جدا است و موفقیت فهرست‌گیری شکست استقرار را پنهان نمی‌کند.

این ابزار از حساب سرویس و پروژهٔ موجود runner استفاده می‌کند و پروژهٔ اعتبارنامه، سایت پیش‌فرض درخواست و محدودهٔ پاسخ را تطبیق می‌دهد. هیچ نقش IAM، secret، trigger، حذف کانال یا استفادهٔ مجدد از کانال اضافه نشده است.

خروجی شامل شمارنده‌ها و حداکثر ۱۰۰ شناسهٔ کانال PR همراه با انقضا یا مقدار صریح `null` است. کانال live و سایر کانال‌ها جدا شمرده می‌شوند؛ نام سایر کانال‌ها نمایش داده نمی‌شود. تعداد موارد حذف‌شده از نمایش و کامل‌بودن فهرست PR روشن است. نبود زمان انقضا مجوز پاک‌سازی نیست. متن پیش‌نمایش فقط انقضای تنظیم‌شدهٔ هفت‌روزه را اعلام می‌کند.

اعتبارنامه در پوشهٔ موقت خصوصی و فایل با دسترسی محدود نگهداری می‌شود. فرایند فرزند CLI اصلی نسخهٔ 15.34.0 را با محیط محدود اجرا می‌کند. خروجی خام ارائه‌دهنده و گزارش‌های debug منتشر نمی‌شوند و خطاها فقط با کدهای محدود گزارش می‌شوند. فایل‌های موقت پس از موفقیت، خطا، مهلت یا سیگنال قابل‌مدیریت حذف می‌شوند؛ توقف اجباری runner امکان اجرای پاک‌سازی را ندارد.

محدودیت‌ها شامل مهلت ۳۰ ثانیه، خروجی استاندارد ۱ MiB، خروجی خطای ۳۲ KiB و حداکثر ۱۰۰۰ کانال است. صفحه‌بندی CLI پیش از خلاصه‌سازی کامل می‌شود؛ این محدودیت‌ها سقف قطعی حافظهٔ داخلی CLI نیستند. پاسخ نامعتبر، بیش‌ازحد بزرگ یا متعلق به سایت دیگر هیچ جمع ناقصی تولید نمی‌کند.

شواهد محلی شامل ۱۴ آزمون مصنوعی، شش بررسی مستقل wrapper، دو بررسی قالب نام و انقضای خالی و ۶۴ ترکیب شرط گردش‌کار است. آزمون‌ها از اعتبارنامهٔ ساختگی و CLI محلی جعلی استفاده می‌کنند. اجرای واقعی runner، شمارنده‌های زنده، دسترسی حساب و سایت و هر تصمیم پاک‌سازی به شواهد جدا نیاز دارد. این قابلیت تأیید آمادگی سامانهٔ گفتگو برای تولید نیست.
