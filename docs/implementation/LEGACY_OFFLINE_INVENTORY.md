# Selected offline inventory / فهرست آفلاین منتخب

## English

**VOX-015 / LIA1:** one explicitly selected offline Tireh FileState document can now be inspected through inherited file descriptors and converted into a bounded inventory report. This is an operator/developer tool; it has no application route, background discovery, provider call, import or permission-granting action.

The inspector accepts two distinct descriptors numbered at least 3: the selected snapshot and a small closed-format selection document containing the expected byte count and SHA256. Both must be regular files owned by the effective user, have one link and mode 0400 or 0600. It never opens an input pathname. It checks declared size, positional reads, EOF, byte digest and before/after metadata, then closes both transferred descriptors exactly once. Output aliases are checked before input reads or diagnostics.

Snapshot input is bounded to 512 KiB; selection to 4 KiB; each descriptor to 4,096 read calls; parsing to 50,000 tokens and 32 nested containers; output to 1,001 rows and 2 MiB. Cancellation discards all staged memory rows while preserving truthful counts of successful reads and observed EOF. Unknown structures remain incomplete. Repeated native records remain separate occurrences.

The report contains fixed kinds/reasons and counts, with no memory text, people identifiers, file paths, source digests or raw error messages. Every row has `target: null`, current authority unverified and use denied. Selected bytes and selected-document structure can be checked; source-wide coverage, snapshot creation consistency, currentness and provenance authenticity remain unavailable. Aggregate counts are not described as anonymous.

The standalone CLI is `scripts/legacy-offline-inventory.mjs`, invoked with `--snapshot-fd N --selection-fd M` after a caller explicitly opens and transfers the two selected files. It emits one bounded JSON line; exit 0 means selected-document complete, 2 incomplete/rejected, and 3 output failure. A readable static JavaScript artifact embeds exactly six source modules. It uses Node fs/crypto/process only, with no runtime compiler, package discovery, configuration loading, cache or subprocess. Trusted Node startup remains an external prerequisite; this is not an OS sandbox.

For the synthetic end-to-end developer check, run `node --test scripts/legacy-offline-inventory.test.mjs`. CI runs this check and verifies exact source/artifact parity with the pinned TypeScript compiler. Actual data execution still needs a named source selection, read/purpose authorization, snapshot/provenance procedure and output access/retention decision; no real data was selected during this implementation.

Accepted source: `bc2f1d78353bad3e5cea518a023d6906a0caf696`, tree `5b3993a31200412346a9dbfc1f0324748f27b992`, based on `e4196a6`. Independent QA passed **123/123** once: 87 modeled acquisition/API cases, 17 modeled CLI cases and 19 actual synthetic inherited-FD child cases. Zero failures/skips/retries; 1,344 tracked hashes unchanged; seven original LIP entries unchanged; zero console calls. Independent artifact parity passed for CLI SHA256 `5afda9a3691fff127b9b2d0d29801b648c6715e87390216cf9d68c4b67f40201`. Integration `2d7ab62` preserves these seven source/test files exactly while composing the separate PR #89 repairs.

Evidence root: `/Users/reza/.codex/visualizations/2026/10/20/vox-legacy-inventory/`. Independent result `offline-independent/RESULT.json` SHA256 `068fc451d54f7aec313a57f3420303613206b999f9197c697bccf4d383039d74`; frozen protocol SHA256 `8d6fb933a599ab9e65eef297c4adb4091ab519d0955c2448249bb5fc91599c03`; privacy closure `LIA1_PRIVACY_BC2F1D7_ACCOUNTING_CLOSURE.md` SHA256 `a18b34dcd59e985e83de541c01694c1bc0b1a1b0c82ff0c5d05a8ccef75f4e10`.

Historical failures are retained. Candidate `12184f2` was rejected because its runtime TypeScript loader could emit diagnostics and discover configuration/cache/processes. Candidate `5160552` removed that loader but undercounted I/O when cancellation arrived during a read. Four author regressions failed before the accounting repair; the final 70 offline source tests and 17 CLI/parity tests passed. Earlier 188-test and typecheck results remain tied to their original candidate. Independent acceptance above is synthetic and local; CI/merge/deployment of this integration are pending at this documentation point.

Ownership/purpose mapping, consent reconciliation, live acquisition, import, restoration and external deletion are not implemented by LIA1. It makes no latency/cost improvement claim. VOX-015 remains in progress.

## فارسی

**VOX-015 / LIA1:** اکنون می‌توان یک سند آفلاین Tireh FileState را که صریحاً انتخاب شده است، از طریق توصیفگر فایل به گزارش محدود فهرست‌برداری تبدیل کرد. این ابزار مخصوص اپراتور/توسعه‌دهنده است؛ مسیر برنامه، کشف پس‌زمینه، فراخوانی ارائه‌دهنده، واردسازی یا ایجاد مجوز ندارد.

ورودی شامل دو توصیفگر متمایز با شمارهٔ حداقل ۳ است: فایل منتخب و سند کوچک انتخاب با اندازهٔ مورد انتظار و SHA256. هر دو باید فایل عادی، متعلق به کاربر مؤثر، با یک پیوند و مجوز 0400 یا 0600 باشند. ابزار مسیر ورودی را باز نمی‌کند. اندازه، خواندن با موقعیت صریح، EOF، هش بایت‌ها و فرادادهٔ قبل/بعد بررسی می‌شوند و هر توصیفگر منتقل‌شده دقیقاً یک بار بسته می‌شود. هم‌پوشانی خروجی با ورودی، پیش از خواندن یا پیام تشخیصی بررسی می‌شود.

حدود عبارت‌اند از ۵۱۲ کیلوبایت برای snapshot، چهار کیلوبایت برای انتخاب، ۴۰۹۶ فراخوانی خواندن برای هر توصیفگر، ۵۰۰۰۰ نشانه و عمق ۳۲، و حداکثر ۱۰۰۱ ردیف و دو مگابایت خروجی. لغو، همهٔ ردیف‌های حافظهٔ آماده‌شده را کنار می‌گذارد، اما شمارش خواندن موفق و EOF مشاهده‌شده را حفظ می‌کند. ساختار ناشناخته ناقص می‌ماند و رخدادهای تکراری جداگانه شمرده می‌شوند.

گزارش فقط نوع/دلیل ثابت و شمارنده دارد؛ متن حافظه، شناسهٔ افراد، مسیر فایل، هش منبع یا خطای خام منتشر نمی‌شود. مقصد همهٔ ردیف‌ها null، اختیار فعلی تأییدنشده و استفاده ممنوع است. بایت‌های منتخب و ساختار سند قابل‌بررسی‌اند؛ پوشش کل منبع، سازگاری زمان ساخت snapshot، تازگی و اصالت منشأ نامعلوم می‌مانند. شمارنده‌ها ناشناس تلقی نمی‌شوند.

CLI مستقل `scripts/legacy-offline-inventory.mjs` با `--snapshot-fd N --selection-fd M` اجرا می‌شود؛ فراخواننده ابتدا دو فایل منتخب را صریحاً باز و منتقل می‌کند. خروجی یک خط JSON محدود است؛ کد خروج ۰ یعنی سند منتخب کامل، ۲ یعنی ناقص/ردشده و ۳ یعنی شکست خروجی. JavaScript خوانای تولیدشده شامل شش ماژول ثابت است و فقط fs/crypto/process داخلی Node را دارد؛ کامپایلر زمان اجرا، کشف بسته، بارگذاری پیکربندی، cache یا زیرفرایند ندارد. شروع مورداعتماد Node پیش‌شرط بیرونی است؛ این ابزار sandbox سیستم‌عامل نیست.

آزمون توسعهٔ سرتاسری با دادهٔ ساختگی از طریق `node --test scripts/legacy-offline-inventory.test.mjs` اجرا می‌شود. CI این آزمون و تطابق دقیق منبع/خروجی تولیدشده با کامپایلر ثابت را بررسی می‌کند. اجرای دادهٔ واقعی همچنان به انتخاب منبع مشخص، اختیار خواندن/هدف، رویهٔ snapshot/منشأ و تصمیم دسترسی/نگهداری گزارش نیاز دارد. در این پیاده‌سازی دادهٔ واقعی انتخاب نشد.

منبع پذیرفته‌شده `bc2f1d78353bad3e5cea518a023d6906a0caf696` با درخت `5b3993a31200412346a9dbfc1f0324748f27b992` بر پایهٔ `e4196a6` است. QA مستقل **۱۲۳ از ۱۲۳** مورد را در یک اجرا گذراند: ۸۷ حالت API/خواندن مدل‌شده، ۱۷ حالت CLI مدل‌شده و ۱۹ حالت فرایند واقعی با فایل و توصیفگر ساختگی. شکست، رد یا تلاش مجدد وجود نداشت؛ ۱۳۴۴ هش رهگیری‌شده و هفت ورودی اصلی LIP بدون تغییر، و فراخوانی کنسول صفر بود. تطابق مستقل خروجی تولیدشده نیز موفق شد. نسخهٔ ادغام `2d7ab62` این هفت فایل را دقیقاً حفظ می‌کند و تعمیرهای جداگانهٔ PR #89 را در بر دارد. مسیر و هش شواهد در بخش انگلیسی آمده‌اند.

شکست‌های قبلی حفظ شده‌اند. نامزد `12184f2` به‌دلیل امکان چاپ پیام و کشف پیکربندی/cache/فرایند توسط loader زمان اجرا رد شد. نامزد `5160552` loader را حذف کرد، اما هنگام لغو حین خواندن، شمارش I/O ناقص بود. چهار آزمون نویسنده قبل از تعمیر شکست خوردند؛ پس از تعمیر، ۷۰ آزمون منبع آفلاین و ۱۷ آزمون CLI/تطابق موفق شدند. نتیجهٔ قدیمی ۱۸۸ آزمون و TypeScript مربوط به همان نامزد قدیمی است. پذیرش مستقل بالا محلی و ساختگی است؛ در زمان ثبت سند، CI، ادغام و استقرار این نسخه در انتظار تکمیل‌اند.

نگاشت مالکیت/هدف، تطبیق رضایت، دریافت زنده، واردسازی، بازیابی و حذف بیرونی توسط LIA1 پیاده‌سازی نشده‌اند. ادعای بهبود تأخیر یا هزینه وجود ندارد. VOX-015 همچنان در حال انجام است.
