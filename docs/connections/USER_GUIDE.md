# Connections in Vox Studio

## English

Open **Privacy → Connections & agent access**, or an agent's **Connections & my access**. Confirm your account profile in Privacy first. Choose **Work** or **Personal**. Your own connected account, selected resources and agent access stay in that space. Owners cannot use another person's account through their administrative role.

Choose **Add connection**. A card shows **Setup required** until its application registration, account identity, resource inventory, separate broker and security checks have been qualified. An OAuth service opens the system browser; after signing in, return to Studio and choose **Check connection**. Other services use a broker operator to enroll a dedicated credential privately. Never put credentials in a persona, task prompt or chat. A successful connection initially grants **no agent access**.

Choose **Choose access**, an agent, specific resources and permitted reads. Review the access expiry. Current grants last at most one or eight hours and never outlive your confirmed account binding. Disconnecting or stopping access blocks later calls and derived results; provider cleanup can still be pending.

Choose **Ask an agent** to run a task using that one connection. Task guidance includes knowledge assistance, teaching progress, engineering triage, product analytics, private mail, design collaboration and operations observation. Guidance never grants access by itself. English, Persian and Vietnamese requests are supported by the guidance; actual language quality still requires native-speaker evaluation. Results are private to this Studio session. They do not enter ordinary bot conversation history, group messages or shared memories.

Studio shows the actual AI provider and model that process tasks. The operator must qualify that processor and its handling of connected content before tasks become available; a working app connection alone does not approve AI processing. Scheduled fixed reads do not call the model.

**Scheduled checks** creates a draft for a specific read, resource and agent. Review the exact read, schedule, timezone, optional quiet hours, maximum checks and expiry before activating. Only a configured broker worker runs checks. Expired access, pause, policy drift or uncertain results stop further execution. Activity shows status, not retained source content. This release does not send scheduled summaries or notifications. Event checks require a qualified signed GitHub or Slack subscription and a fresh native resource read.

The initial production policy permits **reads only**. Drafting in Gmail, sending, publishing, document edits, server reboots and other external effects remain disabled. Their adapter and action-review code is covered by fixtures, but actual recipient/audience and source-sharing checks must be qualified before release. Exact content approval alone is not sufficient. Browser support is a registered public-page reader in an offline Chromium sandbox; server support is a fixed service-status runbook. Neither grants access to your ordinary Chrome profile or arbitrary shell commands.

If an outcome is not confirmed, do not repeat the action. Review activity and reconcile it with the provider. Setup, access, provider execution, identity confirmation and deployment are separate states.

## فارسی

از **حریم خصوصی ← اتصال‌ها و دسترسی عامل** یا تنظیمات اتصال هر عامل وارد شوید. ابتدا نمایهٔ حساب خود را در بخش حریم خصوصی تأیید کنید. فضای **کاری** یا **شخصی** را انتخاب کنید. حساب متصل، منابع انتخاب‌شده و دسترسی عامل در همان فضا باقی می‌مانند. نقش مالک، مجوز استفاده از حساب شخص دیگر نیست.

**افزودن اتصال** را بزنید. تا زمانی که ثبت برنامه، هویت حساب، منابع، سرویس امن اتصال و بررسی‌های امنیتی تأیید نشده‌اند، کارت سرویس وضعیت **نیازمند راه‌اندازی** دارد. سرویس‌های OAuth در مرورگر سیستم باز می‌شوند؛ پس از ورود، به استودیو برگردید و **بررسی اتصال** را بزنید. ثبت اعتبارنامهٔ اختصاصی سرویس‌های دیگر را اپراتور سرویس امن انجام می‌دهد. اعتبارنامه را در شخصیت عامل، درخواست یا گفت‌وگو وارد نکنید. اتصال موفق در ابتدا به **هیچ عاملی دسترسی نمی‌دهد**.

در **انتخاب دسترسی**، عامل، منابع مشخص و خواندن‌های مجاز را انتخاب و زمان پایان دسترسی را بررسی کنید. دسترسی فعلی حداکثر یک یا هشت ساعت است و از اعتبار تأیید هویت شما بیشتر نمی‌شود. توقف دسترسی یا قطع اتصال، فراخوانی‌های بعدی و استفاده از نتایج وابسته را متوقف می‌کند؛ پاک‌سازی در سرویس ممکن است هنوز کامل نشده باشد.

در **درخواست از عامل**، کاری برای همان اتصال بنویسید. راهنماهای کار شامل دستیار دانش، پیشرفت آموزشی، بررسی مهندسی، تحلیل محصول، ایمیل شخصی، همکاری طراحی و بررسی عملیات هستند. راهنما به‌تنهایی مجوز ایجاد نمی‌کند. راهنماها درخواست‌های انگلیسی، فارسی و ویتنامی را پشتیبانی می‌کنند؛ کیفیت واقعی زبان باید توسط گویشور بومی ارزیابی شود. نتیجه فقط در همان نشست خصوصی استودیو دیده می‌شود و وارد تاریخچهٔ معمول ربات، پیام گروه یا حافظهٔ مشترک نمی‌شود.

استودیو نام ارائه‌دهنده و مدل واقعی پردازش درخواست را نشان می‌دهد. اپراتور باید پردازشگر و نحوهٔ برخورد آن با محتوای متصل را پیش از فعال‌شدن کارها تأیید کند؛ اتصال موفق حساب به‌تنهایی مجوز پردازش هوش مصنوعی نیست. خواندن‌های ثابت زمان‌بندی‌شده مدل را فراخوانی نمی‌کنند.

**بررسی‌های زمان‌بندی‌شده** ابتدا پیش‌نویسی برای یک خواندن، منبع و عامل مشخص ایجاد می‌کند. پیش از فعال‌کردن، منبع و خواندن دقیق، برنامه، منطقهٔ زمانی، ساعت‌های سکوت اختیاری، سقف اجرا و پایان اعتبار را بررسی کنید. فقط اجراکنندهٔ پیکربندی‌شدهٔ سرویس امن، بررسی‌ها را اجرا می‌کند. پایان دسترسی، توقف، تغییر سیاست یا نتیجهٔ نامشخص اجرای بعدی را متوقف می‌کند. فعالیت‌ها فقط وضعیت را نشان می‌دهند؛ محتوای منبع نگهداری نمی‌شود. این نسخه خلاصه یا اعلان زمان‌بندی‌شده ارسال نمی‌کند. بررسی رویداد به اشتراک امضاشدهٔ تأییدشده در GitHub یا Slack و خواندن تازهٔ منبع نیاز دارد.

سیاست اولیهٔ انتشار فقط **خواندن** را مجاز می‌کند. تهیهٔ پیش‌نویس در Gmail، ارسال، انتشار، ویرایش سند، راه‌اندازی دوبارهٔ سرور و سایر تغییرات بیرونی غیرفعال‌اند. کد رابط و بررسی کار در آزمون‌ها پوشش دارد، اما مخاطبان واقعی و مجوز اشتراک منبع باید پیش از انتشار تأیید شوند. تأیید محتوای دقیق به‌تنهایی کافی نیست. پشتیبانی مرورگر به خواندن صفحهٔ عمومی ثبت‌شده در محیط جدا و آفلاین Chromium محدود است؛ پشتیبانی سرور فقط وضعیت سرویس مشخص را می‌خواند. دسترسی به نمایهٔ معمول Chrome یا دستور دلخواه پوسته ایجاد نمی‌شود.

اگر نتیجه تأیید نشده است، کار را تکرار نکنید. فعالیت را بررسی و وضعیت را با سرویس تطبیق دهید. راه‌اندازی، دسترسی، اجرای سرویس، تأیید هویت و استقرار، وضعیت‌های جداگانه‌اند.

## Operator references

- [Implementation status](IMPLEMENTATION_STATUS.md)
- [Account onboarding and offline validation](ACCOUNT_ONBOARDING.md)
- [Broker deployment](BROKER_OPERATIONS.md)
- [Workflow operation](WORKFLOW_OPERATIONS.md)
- [Runner constraints](RUNNER_OPERATIONS.md)
- [Independent evidence](evidence/IMPLEMENTATION_REVIEW.md)
