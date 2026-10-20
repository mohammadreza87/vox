# Guest privacy and evaluation release / انتشار حریم خصوصی مهمان و ارزیابی

On 20 October 2026, [PR78](https://github.com/mohammadreza87/vox/pull/78) merged into develop as `9371894a2dc4bc6f9abca25289f2eaa9fe6e17b9`. Its source tree exactly matches reviewed head `49e2011`. The exact merged build `W5WER59tOQd1rYB__XjOb`, built at 08:50:11 UTC, was installed through the existing provenance, compatibility, backup and readiness manager.

This release adds isolated EN/FA [guest request tracking](GUEST_RIGHTS_INTAKE.md), the [signed synthetic evaluation protocol](EVALUATION_PROTOCOL.md), and trusted public-origin validation for six Studio/guest mutation handlers behind the proxy. It also repairs a separately reproduced early language-selection reset by keeping stateful guest controls disabled until hydration.

## Qualification and live boundary

[CI211](https://github.com/mohammadreza87/vox/actions/runs/39394671835) passed 3,844 tests with 13 explicit skips, 31 additional release/fixture checks, lint/type checking, build and 41 browser tests. Indexed qualification27 and preview140 passed. Independent backend/origin review passed 43 initial external checks, then 158 composed external checks and 117 repository regressions. Independent browser review passed 13 core checks before the hydration repair; the final candidate passed the delayed-script/delayed-notice diagnostic and all five affected actual guest flows. Unaffected source hashes match the earlier tested pin.

At 08:50:36 UTC, 38 local/public route checks passed with the exact installed revision. The [public privacy page](https://vox.joyixir.com/privacy) displays the Joyixir contact fallback with restrictive connection CSP and no-referrer policy. All four current active-bot webhook checks passed; one runtime wrapper and listener own the service. The earlier fifth test bot was already inactive before installation and was not reactivated.

Production environment bytes and optional flags remained unchanged. Legacy FILE storage remains in use; no managed adaptive directory or Connections configuration was introduced. Guest admission remains disabled without a reviewed policy/key. Optional Decisions expansion, scoped relationships, group observation, maintenance, reminder delivery and experiments remain off; existing legacy reply triage remains configured on.

The audit command still reports 14 existing dependency findings, six high development and eight moderate production dependencies; its continued-on-error job is not a clean audit. No dependencies changed. Original temporary evaluation report bytes are unavailable for an undetermined reason; [the evaluation record](EVALUATION_PROTOCOL.md) preserves the distinction between observed execution and retained artifacts.

The durable local receipt is `/Users/reza/.codex/visualizations/2026/10/20/vox-guest-evaluation/RELEASE.md`, with source/build/CI/probe logs and hashed independent reports. No user messages or paid provider generation were performed. Authenticated physical-device journeys, provider quality/latency, production evaluator IAM, mailbox operation, legal/biometric activation and provider/backup erasure remain separate gates. This release does not complete every parent backlog task.

## فارسی

در ۲۰ اکتبر ۲۰۲۶، PR78 با نسخهٔ `9371894` در develop ادغام و ساخت دقیق `W5WER59tOQd1rYB__XjOb` نصب شد. درخت کد با نامزد بررسی‌شدهٔ `49e2011` یکسان است. این انتشار، پیگیری مستقل درخواست مهمان به انگلیسی و فارسی، پروتکل ارزیابی مصنوعی امضاشده، اعتبارسنجی مبدأ عمومی شش مسیر و اصلاح از دست رفتن انتخاب زودهنگام زبان را شامل می‌شود.

CI شامل ۳۸۴۴ آزمون موفق، ۱۳ مورد اجرا‌نشدهٔ صریح، ۳۱ بررسی انتشار/فیکسچر و ۴۱ آزمون مرورگر بود. بررسی مستقل نهایی، حفظ زبان و اطلاعات بازیابی در بارگذاری آهسته و پنج مسیر مرتبط مهمان را تأیید کرد. پس از نصب، ۳۸ بررسی مسیر محلی/عمومی و بررسی وب‌هوک هر چهار ربات فعال موفق بود. ربات آزمایشی پنجم پیش از نصب غیرفعال شده بود و دوباره فعال نشد.

بایت‌های تنظیمات، پرچم‌های اختیاری و ساختار ذخیره‌سازی FILE تغییر نکردند. صفحهٔ عمومی حریم خصوصی راه تماس Joyixir را نمایش می‌دهد؛ پذیرش آنلاین مهمان تا تنظیم سیاست و کلید بررسی‌شده خاموش می‌ماند. ۱۴ یافتهٔ قبلی وابستگی همچنان وجود دارد و سبز بودن مرحلهٔ ممیزی به معنی نبود آسیب‌پذیری نیست. هیچ پیام کاربر یا تولید پولی ارائه‌دهنده انجام نشد. تأیید دستگاه واقعی، کیفیت و تأخیر ارائه‌دهنده، IAM مستقل، عملیات صندوق تماس، تأیید حقوقی/زیست‌سنجی و حذف نزد ارائه‌دهندگان و پشتیبان‌ها همچنان مراحل جداگانه‌اند؛ کل نقشهٔ راه کامل اعلام نمی‌شود.
