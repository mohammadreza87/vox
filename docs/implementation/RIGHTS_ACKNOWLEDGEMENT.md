# Retention acknowledgement / تأیید نتیجهٔ نگهداری

## English

A retention action could commit successfully and then return `rights_storage_busy` while reading its result, when a concurrent retry held the same account lock. The service now retries only that read, using the existing three-second budget and ten-millisecond delay. It does not repeat the durable action. Current operator, reviewed policy and operation-handle authority are checked before every attempt and after the asynchronous read before returning the result. Other storage failures still fail immediately.

Accepted source: `98245a17791f7821693180e4c2b315745750be60` (tree `47aa44b7c2d1c60df5eb7c61f4c76ddf449d0d63`), based on `d7897af`. Integration source `c712c5b9252e6ec8e7fbe85d3e229ccfa4a4776f` is based on shared develop `d263eecafff789fd3048b21585b9d0a74666eb23`; the entire rights-intake directory is byte-identical to the accepted source. The surrounding branch includes separately merged work and requires its own CI qualification.

Author validation passed all 95 rights-intake tests, scoped lint and full TypeScript. Independent QA passed 17/17 selected tests (ten new acknowledgement regressions and seven existing retention tests), with no skips/retries and 1,338 tracked hashes unchanged. Independent privacy source review approved the authority checks. The injected read-conflict tests establish service behavior; the existing concurrent FILE test exercises real synthetic storage, without claiming an instrumented physical-lock trace.

The first seven regression cases produced six failures and one pass before the repair. An intermediate dependency setup failed three suite imports while 47 tests passed; that run remains failed. Fresh exact-lock dependencies and the final ten cases produced the author result above. Prior failures are retained.

Evidence root: `/Users/reza/.codex/visualizations/2026/10/20/vox-legacy-inventory/`. Independent QA review SHA256 `95d708fb752dda852795f2e9ba1ae8879f2b21fc5d9c0c9263f48757945c8464`; execution receipt `984529c7512f1f5686fb897d9b854cac3f6acad3d1a322ffb97125eb3d18e619`; privacy review `RIGHTS_ACK_PRIVACY_98245A1.md` SHA256 `5b29dea6cd94b2ff1962f5848729fdbde5a7b1de994986cb1189ea431670e2f6`.

This synthetic source qualification adds no processing purpose, consent grant or retention policy. Deployment, live operator journeys, RF2 erasure, provider and backup deletion remain separate work. VOX-056 stays in progress.

Integration also repairs two defects introduced by the new shared branch: `def95f4` restores schema-3 FILE control checks before retained-body reads, and `99a03b9` restores the gateway's `raw` provider-result binding before plain-text normalization. The latter is a cherry-pick of independently authored `c2cca3a`. The first integration run at `c712c5b` passed 69 tests but failed two suite imports because of that duplicate gateway binding; it is retained as a failed run. Existing assertions are unchanged. The schema-3 restoration passed independent privacy source review (`RF1_SCHEMA3_GUARD_PRIVACY_C712C5B.md`, SHA256 `07142a620c519881f5655d7634a803e3bcd38e36590b38d40a99d40fb06d5455`). Composed tests, CI and release remain pending at this documentation point.

## فارسی

عملیات نگهداری ممکن بود با موفقیت ثبت شود، اما هنگام خواندن نتیجه، به‌دلیل قفل همان حساب توسط تلاش هم‌زمان، خطای `rights_storage_busy` برگرداند. اکنون فقط خواندن نتیجه با بودجهٔ موجود سه‌ثانیه‌ای و فاصلهٔ ده‌میلی‌ثانیه تکرار می‌شود؛ عملیات پایدار دوباره اجرا نمی‌شود. اختیار فعلی اپراتور، سیاست بازبینی‌شده و اعتبار شناسهٔ عملیات قبل از هر تلاش و پس از خواندن ناهم‌زمان، پیش از بازگرداندن نتیجه بررسی می‌شوند. سایر خطاهای ذخیره‌سازی همچنان فوری رد می‌شوند.

منبع پذیرفته‌شده `98245a17791f7821693180e4c2b315745750be60` با درخت `47aa44b7c2d1c60df5eb7c61f4c76ddf449d0d63` و پایهٔ `d7897af` است. نسخهٔ ادغام `c712c5b9252e6ec8e7fbe85d3e229ccfa4a4776f` بر پایهٔ develop مشترک `d263eecafff789fd3048b21585b9d0a74666eb23` قرار دارد؛ کل پوشهٔ rights-intake با منبع پذیرفته‌شده یکسان است. سایر تغییرات ادغام‌شدهٔ شاخه به تأیید CI جداگانه نیاز دارند.

نویسنده هر ۹۵ آزمون rights-intake، lint فایل‌های تغییرکرده و بررسی کامل TypeScript را گذراند. QA مستقل ۱۷ از ۱۷ آزمون منتخب را گذراند: ده مورد جدید تأیید نتیجه و هفت آزمون موجود نگهداری، بدون رد یا تلاش مجدد و با ۱۳۳۸ هش فایل رهگیری‌شدهٔ بدون تغییر. بازبینی مستقل حریم خصوصی بررسی‌های اختیار را تأیید کرد. تزریق خطای خواندن، رفتار سرویس را می‌سنجد؛ آزمون هم‌زمان موجود از ذخیره‌سازی واقعی با دادهٔ ساختگی استفاده می‌کند، اما ردگیری ابزارگذاری‌شدهٔ قفل فیزیکی ادعا نمی‌شود.

هفت مورد نخست قبل از تعمیر، شش شکست و یک موفقیت داشتند. در اجرای میانی، سه مجموعه به‌علت وابستگی ناقص وارد نشدند و ۴۷ آزمون موفق بودند؛ آن اجرا ناموفق باقی می‌ماند. نصب تازه مطابق lockfile و ده مورد نهایی نتیجهٔ نویسنده را ایجاد کردند. شکست‌های قبلی حفظ شده‌اند. مسیر شواهد و هش‌های گزارش مستقل، رسید اجرا و بازبینی حریم خصوصی در بخش انگلیسی آمده‌اند.

این تأیید منبع با دادهٔ ساختگی، هدف پردازش، رضایت یا سیاست نگهداری جدیدی ایجاد نمی‌کند. استقرار، مسیر اپراتور واقعی، حذف RF2 و حذف ارائه‌دهنده و پشتیبان کارهای جداگانه‌اند. VOX-056 همچنان در حال انجام است.

ادغام همچنین دو ایراد شاخهٔ مشترک جدید را تعمیر می‌کند: `def95f4` بررسی کنترل‌های FILE با طرح‌وارهٔ ۳ را پیش از خواندن محتوای نگه‌داری‌شده برمی‌گرداند و `99a03b9` نام `raw` را برای نتیجهٔ ارائه‌دهنده در gateway، پیش از تبدیل به متن ساده، بازیابی می‌کند. مورد دوم از تغییر مستقل `c2cca3a` گرفته شده است. نخستین اجرای ادغام در `c712c5b` شامل ۶۹ آزمون موفق بود، اما دو مجموعه به‌دلیل تعریف تکراری متغیر gateway وارد نشدند؛ این اجرا ناموفق ثبت می‌ماند. هیچ انتظار آزمون موجود تغییر نکرده است. بازگرداندن بررسی طرح‌وارهٔ ۳، بازبینی مستقل حریم خصوصی را گذراند؛ مرجع و هش در بخش انگلیسی آمده‌اند. در زمان ثبت این سند، آزمون‌های ترکیبی، CI و انتشار هنوز در انتظار تکمیل هستند.
