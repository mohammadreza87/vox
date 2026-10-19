# VOX-021: bounded communication diagnostics / گزارش‌های محدود ارتباطی

Author candidate: base `c424dc6`, branch `codex/safe-event-diagnostics`, isolated worktree `adaptive-observations/vox`. This is a local, synthetic implementation slice. Independent review is tracked separately in `evidence/DIAGNOSTIC_REVIEW.md`; source/local checks do not establish CI or deployment.

نامزد نویسنده: پایهٔ `c424dc6` و شاخهٔ `codex/safe-event-diagnostics` در ورک‌تری جداگانهٔ `adaptive-observations/vox`. این بخش پیاده‌سازی فقط محلی و با دادهٔ ساختگی آزمایش شده است. بررسی مستقل در `evidence/DIAGNOSTIC_REVIEW.md` ثبت می‌شود؛ آزمون محلی، اجرای CI یا استقرار را تأیید نمی‌کند.

## Contract / قرارداد

Purpose: existing operational reliability diagnostics (`ops.security_reliability`, PRIV-007/008). The logger receives exactly four fields: `type: telegram_ingress`, `stage`, `reason`, `outcome`. All values come from the fixed catalog in `src/lib/tireh/telegram/diagnostics.ts`. Callers select a typed event token; they cannot attach metadata. Unknown event keys and inherited object keys are dropped. No conversation/event analytics producer, destination, collection switch, timing measurement, replay export, retention period or external send is introduced.

هدف، گزارش عملیاتی موجود برای قابلیت اطمینان است (`ops.security_reliability`، PRIV-007/008). ثبت‌کننده دقیقاً چهار فیلد دریافت می‌کند: `type: telegram_ingress`، `stage`، `reason` و `outcome`. همهٔ مقدارها از فهرست ثابت `src/lib/tireh/telegram/diagnostics.ts` انتخاب می‌شوند و فراخواننده نمی‌تواند فراداده‌ای اضافه کند. کلیدهای ناشناخته و ارث‌بری‌شده کنار گذاشته می‌شوند. این تغییر، جمع‌آوری تحلیل رفتار، مقصد جدید، سنجش زمان، بازپخش، دورهٔ نگهداری یا ارسال بیرونی جدیدی ایجاد نمی‌کند.

Excluded from diagnostics: exceptions and their messages/names/stacks/causes, provider bodies, request content/URLs, transcript/audio, credentials, model names, persona/bot/account/update/chat/group IDs and names. Profile steps and provider reasons are selected from fixed enums. Voice delivery accepts only the six adapter codes `payment_required`, `quota_exceeded`, `permission_denied`, `rate_limited`, `unavailable`, `provider_error`; everything else becomes `delivery_failed`. Throwing getters/proxies cannot prevent the existing text fallback. The existing web-search fallback still examines provider status/message internally to choose its fallback; no such content reaches diagnostics, and failed accessor inspection rethrows the original exception.

استثناها و پیام، نام، پشته و علت آن‌ها، بدنهٔ پاسخ ارائه‌دهنده، محتوای درخواست یا نشانی آن، متن یا صوت گفتگو، اطلاعات محرمانه، نام مدل و شناسه یا نام عامل، حساب، به‌روزرسانی، چت و گروه وارد گزارش نمی‌شوند. مرحلهٔ تنظیم پروفایل و دلیل خطای ارائه‌دهنده از مقدارهای ثابت انتخاب می‌شوند. تحویل صوت تنها شش کد ثابت بالا را می‌پذیرد و سایر مقدارها به `delivery_failed` تبدیل می‌شوند. حتی getter یا Proxy خطادار نیز جلوی پاسخ متنی جایگزین را نمی‌گیرد. بررسی پیام و وضعیت برای انتخاب مسیر جایگزین جست‌وجوی وب فقط داخلی است و به گزارش نمی‌رسد؛ خطای دسترسی به ویژگی نیز همان استثنای اصلی را دوباره پرتاب می‌کند.

## Runtime paths / مسیرهای اجرا

| Path | Preserved behavior / رفتار حفظ‌شده |
| --- | --- |
| `studio/bots.ts` | Poll failure retries after 3 seconds; each failed update continues the batch and advances offset; stop suppresses pending poll failure/retry; refresh remains 8 seconds; drain remains 60 seconds. / تکرار پس از ۳ ثانیه، ادامهٔ دسته و offset، توقف، تازه‌سازی ۸ ثانیه‌ای و تخلیهٔ ۶۰ ثانیه‌ای حفظ شده‌اند. |
| Persona Telegram route | Missing configuration 503, forbidden 403, invalid body 400, unknown persona 404; processing failures acknowledge HTTP 200 `{ok:false}`. / وضعیت‌های پیکربندی، احراز، ورودی و عامل ناشناخته و پاسخ ۲۰۰ برای خطای پردازش حفظ شده‌اند. |
| Studio Telegram route | Existing auth/body bounds, setup 502, runtime configuration 503; handler failures still acknowledge HTTP 200 `{ok:true}`. / احراز و محدودیت بدنه و پاسخ‌های تنظیم، پیکربندی و پردازش حفظ شده‌اند. |
| `studio/updates.ts` → `studio/service.ts` → `tireh/gateway.ts` | Real manager/agent handlers, profile retry receipts, identity/audience refusal, token failure, decision fallback, extraction, triage, STT, voice/text delivery and duplicate handling. No direct logging producer exists in `updates.ts`. / پردازش واقعی مدیر و عامل، رسید تکرار پروفایل، کنترل مخاطب، توکن، تصمیم، حافظه، تبدیل گفتار، تحویل و جلوگیری از تکرار حفظ شده‌اند. |
| `studio/media.ts`, `tireh/llm.ts`, `tireh/runtime.ts` | Primary STT failure still tries ElevenLabs; unavailable web search still uses the regular reply and stops requesting that tool; direct Pino wiring preserves catalog fields at the destination. / مسیر جایگزین تبدیل گفتار و جست‌وجوی وب حفظ شده و فیلدهای ثابت به مقصد Pino می‌رسند. |
| `studio/voice-call.ts` | Initial turn failure returns 503; a failure after stream startup emits the existing apology, stop marker and `[DONE]`; cancellation behavior stays intact. / خطای آغاز نوبت ۵۰۳ می‌دهد؛ خطای پس از شروع جریان، پیام و نشانگرهای پایان موجود را می‌فرستد؛ رفتار لغو حفظ شده است. |
| `studio/http.ts` | Mini App voice/provider/persona errors use fixed diagnostics. Ordinary response/status/header mapping stays the same; throwing error accessors now yield generic 500 with one fixed diagnostic. / خطاهای صوت، ارائه‌دهنده و ساخت عامل گزارش ثابت دارند. پاسخ، وضعیت و سربرگ خطاهای عادی حفظ شده‌اند؛ دسترسی خطادار به ویژگی خطا اکنون پاسخ عمومی ۵۰۰ و یک گزارش ثابت می‌دهد. |

## Synthetic evidence / شواهد ساختگی

Tests inject a synthetic `Error` whose message, name, stack, cause and request contain private-transcript, fake-credential and identity canaries. Tests capture raw logger arguments before serialization and require a single flat allowlisted object, so an Error cannot hide behind JSON's omission of non-enumerable properties. Other cases exercise a regex-shaped arbitrary provider code, hostile code/status/message getters and Proxy traps. No real account, provider call or personal data is used.

آزمون‌ها خطایی ساختگی با نشانگرهای متن خصوصی، اعتبارنامهٔ جعلی و هویت در پیام، نام، پشته، علت و درخواست تزریق می‌کنند. آرگومان‌های خام ثبت‌کننده پیش از تبدیل به JSON بررسی می‌شوند و باید یک شیء تخت با چهار فیلد ثابت باشند؛ حذف ویژگی‌های غیرقابل‌شمارش Error در JSON نمی‌تواند خطا را پنهان کند. کد دلخواه شبیه عبارت مجاز، getter خطادار و Proxy نیز آزمایش می‌شوند. هیچ حساب واقعی، فراخوانی ارائه‌دهنده یا دادهٔ شخصی استفاده نشده است.

Final author command (19 October 2026): `npx vitest run src/lib/studio src/lib/tireh 'src/app/api/studio/telegram/[key]/route.test.ts' 'src/app/api/tireh/telegram/[personaId]/route.test.ts' --exclude '**/diagnostic-security.test.ts'`. The independent evaluator's file is excluded from author execution and is reported separately. The Mini App HTTP boundary identified during independent review is included in this final source; author tests additionally cover actual audio requests with canary, name/message/status/code getter and Proxy failures. Final check results follow below.

فرمان نهایی نویسنده در ۱۹ اکتبر ۲۰۲۶ در بالا آمده است. فایل ارزیاب مستقل از اجرای نویسنده کنار گذاشته شده و نتیجهٔ آن جداگانه گزارش می‌شود. مرز HTTP مینی‌اپ که در بررسی مستقل پیدا شد در منبع نهایی پوشش دارد؛ آزمون‌های نویسنده درخواست صوت واقعی را با نشانگر خصوصی، getter خطادار نام، پیام، وضعیت و کد و نیز Proxy پوشش می‌دهند. نتیجهٔ بررسی نهایی در ادامه ثبت می‌شود.

- **PASS:** 51 suites / 887 tests, final run started `2026-10-19 18:45:09 UTC`, exit 0. / **موفق:** ۵۱ مجموعه و ۸۸۷ آزمون روی منبع نهایی.
- **PASS:** ESLint on all 25 author TypeScript source/test paths, exit 0. / **موفق:** ESLint برای هر ۲۵ فایل منبع و آزمون نویسنده.
- **PASS:** `npx tsc --noEmit --incremental false`, exit 0; `git diff --check`, exit 0. / **موفق:** بررسی نوع و قالب تغییرات.
- **PASS:** zero direct `.warn/.error/.info/.debug/.trace/.fatal` logging calls remain in non-test `src/lib/studio` and `src/lib/tireh`; all assigned explicit producers use the fixed catalog. / **موفق:** هیچ ثبت مستقیم خارج از فهرست ثابت در منبع غیرآزمونی این دو بخش باقی نمانده است.
- **UNAVAILABLE:** CI, deployed revision, real-provider runtime, production log/retention configuration and full-app export/replay proof. / **تأییدنشده:** CI، نسخهٔ مستقر، ارائه‌دهندهٔ واقعی، تنظیمات گزارش و نگهداری تولید و اثبات همهٔ خروجی‌ها و بازپخش برنامه.

Exact candidate identity: base `c424dc6`; **11 runtime files** digest `d6748fe1e44b114b82ba475e78fbfbafde04a12f7c32e0b07b7ce868f3208713`; **25 author runtime/test files** digest `a286e02e520d66538f8b4371dfc1fcc381e4380c99235e7bcf78a7d2624519f4`. Each digest is SHA-256 over sorted repository-relative path + NUL + file bytes + NUL. Runtime excludes `*.test.*`, `__tests__` and `src/test`; both exclude evaluator-owned files and documentation. No commit, push or deployment was performed by the author.

هویت دقیق نامزد: پایهٔ `c424dc6` و هش‌های بالا برای **۱۱ فایل اجرایی** و **۲۵ فایل اجرایی و آزمون نویسنده** است. هش SHA-256 از مسیر نسبی مرتب‌شده، NUL، بایت‌های فایل و NUL محاسبه شده است. فایل‌های ارزیاب مستقل و مستندات در هش نیستند. نویسنده commit، push یا استقرار انجام نداده است.

## Limits and next owner / محدودیت‌ها و مسئول بعدی

This slice changes explicit application diagnostics in the assigned communication chain. It does not purge historical logs or prove platform/access/APM log settings, production retention/access controls, provider retention, audit authorization, optional analytics exports or replay masking. The existing authenticated operational audit remains distinct from private conversation evidence. Legacy billing/auth/chat routes and generic logging helpers outside this communication chain are outside this candidate. Existing HTTP error responses, including provider error formatting, are a separate output boundary and must not be interpreted as sanitized diagnostic exports.

این بخش فقط گزارش‌های صریح برنامه در زنجیرهٔ ارتباطی تعیین‌شده را تغییر می‌دهد. گزارش‌های قدیمی پاک نشده‌اند و تنظیمات زیرساخت، لاگ دسترسی یا APM، نگهداری و دسترسی تولید، نگهداری ارائه‌دهنده، مجوز گزارش ممیزی، خروجی تحلیل اختیاری یا پوشاندن بازپخش تأیید نشده‌اند. ممیزی عملیاتی احرازشده از شواهد خصوصی گفتگو جداست. مسیرهای قدیمی پرداخت، احراز و چت و ابزارهای عمومی ثبت گزارش خارج از این زنجیره در محدودهٔ این نامزد نیستند. پاسخ‌های خطای HTTP و قالب‌بندی خطای ارائه‌دهنده، مرز خروجی جداگانه‌ای هستند و نباید خروجی تشخیصی پاک‌سازی‌شده محسوب شوند.

Next owner: independent privacy evaluator for the exact frozen diff, then the lead for integration/task disposition and separately authorized release verification. Full VOX-021 all-export acceptance remains a broader task; this document records only the evidenced slice.

مسئول بعدی، ارزیاب مستقل حریم خصوصی برای همین تغییر نهایی و سپس هماهنگ‌کننده برای یکپارچه‌سازی و تعیین وضعیت کار است. بررسی انتشار مجوز و شواهد جداگانه می‌خواهد. پذیرش کامل VOX-021 برای همهٔ خروجی‌ها، کاری گسترده‌تر است؛ این سند فقط بخش دارای شواهد را ثبت می‌کند.
