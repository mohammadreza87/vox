# Observation, lifecycle and local improvement delivery

Prepared 19 October 2026 against production baseline `9fb73d311753a461bd62e37ce3129b8a60c83d00`.
This record describes the next implementation slice; source, local qualification, CI, deployment and enabled production behavior are separate evidence levels.

## Delivered behavior

- Consented private Telegram replies and Studio tap-to-talk turns enter a bounded, content-free account journal. Voice responses return an opaque turn correlation only after journal acceptance. The browser reports actual playing/ending/error/interruption callbacks against that correlation. Server completion and client playback never become verified task success.
- The observer processes leased events with revision/deduplication, bounded retry, explicit failure state and deterministic replay. Findings report observed failures or interruptions, alternative explanations and an unknown cause. No raw message, audio, model prompt, external messaging capability or code-execution capability is included.
- Work and Personal measurements remain separate. Studio shows queue freshness, measured counts, missing coverage and EN/FA findings. Refresh performs bounded processing; current account/agent permissions are checked again. Admin roles do not expose other people's private measurements.
- A confirmed account can download a scoped JSON export. Shared content is restricted to currently authorized published rows. Private exports remain transient. Provider and backup coverage are explicitly unavailable.
- Inactive accounts can be swept through a separate durable maintenance checkpoint namespace. Cursor, lease, bounded page size, failure state and restart behavior survive process restarts. Snapshot reconciliation retains current authority and never restores old grants or deleted payloads.
- The local improvement workflow accepts reviewed signed minimized findings, proposes a bounded routing experiment, registers immutable candidate bytes, runs an evaluator in a pinned Docker image and requires independent evaluator and human signatures. A synthetic demonstration exercises this whole local chain. Its rollback record is a comparison of candidate and baseline behavior, not a deployed rollback.

## Boundaries and defaults

`STUDIO_MAINTENANCE=1` explicitly enables background sweeps; any other value leaves the worker off. Existing relationship switches and the capability policy manifest retain their own gates. Adding this code grants no optional purpose or agent access.

Empty observer state is omitted from serialized account documents so this disabled rollout remains readable by the previous strict schema. Once journal collection is enabled, rolling back to older code requires an explicit content-free observer-field migration; do not restore stale backups over newer consent or deletion records. Maintenance and improvement state use separate namespaces ignored by the previous release.

`STUDIO_IMPROVEMENT_TRUST_JSON` contains validated public Ed25519 keys for distinct analyst, author, evaluator and human authorities. When absent the review service is unavailable. File runtime uses its private `improvement-review` directory; Firestore configuration is rejected until a distributed registry is implemented. Studio receives only the report method. It has no signing, promotion, merge or deployment endpoint.

The observer journal has a 200-event capacity, seven-day maximum retention and three attempts per processing cycle. Identity/permission/grant expiry can purge events sooner. A full journal rejects optional measurements without breaking the conversation; the UI declares instrumented coverage incomplete. `retryFailed` is an explicit trusted service operation after the failure has been investigated. No automatic repeated paid analysis runs.

Docker is a local container boundary. Its host, daemon and image are trusted. Synthetic distinct keys demonstrate signature enforcement but do not establish production IAM isolation. The cancellation dataset is deliberately small and does not measure language quality, human warmth, prediction accuracy or real product improvement. Software patch authoring, PR automation, protected dataset provisioning and serving-policy promotion remain separate tasks.

## Verification and operations

Source tests cover real Studio voice/Telegram producers, authenticated ingress, private canaries, invalid client trust, missing correlation, duplicate callbacks, revoked access and own-space export. Core tests cover file-backed concurrent workers, lease recovery, deterministic revision replay, retry exhaustion, confirmation expiry, stale snapshots and paginated inactive-account cleanup.

Independent review identified and repaired evaluation payload minimization and budget bypasses. It also corrected an unsupported rollback-disable claim. Review of observer/export concurrency and an independently designed three-person 90-day simulation form part of integrated qualification; their final results are recorded in the evidence directory.

Run the deterministic suite with `npx vitest run` and TypeScript with `npx tsc --noEmit`. Run the real Docker evaluator separately with `VOX_IMPROVEMENT_IMAGE=sha256:<approved-local-image> npx vitest run --config scripts/improvement-vitest.config.ts`. Docker must already have the pinned image; the runner never pulls it. The demonstration command is `VOX_IMPROVEMENT_IMAGE=sha256:<approved-local-image> npx tsx scripts/improvement-demo.ts <new-private-output-directory>`; it refuses an existing directory and uses only fresh synthetic keys and cases.

Browser fixtures run through `npx playwright test --config playwright.learning.config.ts` after a production build. They cover EN/FA, RTL, mobile widths, refresh, export downloads and readonly operator status. They cannot prove physical microphone/speaker behavior or a Telegram user's device receipt.

Before enabling maintenance, verify the account storage and distinct checkpoint namespace, read-only enumeration access, bounded processing under the intended workload, cancellation on shutdown and fixed diagnostic failure ownership. Stop the worker by removing its explicit release switch and restarting the runtime. Existing expiry checks still deny use on reads. Inspect failed checkpoints before an intentional retry; do not remove an account lock while a writer may be alive.

Production activation still needs approved capability policy, the person's scoped choices, representative provider/device evidence, and an agreed pilot/spend ceiling. Provider/backup deletion, production load SLOs and full disaster recovery are not certified by these local tests. The exact registered operator and address for public notices remain unresolved; the confirmed privacy contact is info@joyixir.com.

## خلاصهٔ فارسی

این مرحله ثبت رویدادهای بدون متن گفتگو، پردازش پایدار با تلاش محدود، نمایش آمار جداگانهٔ کاری و شخصی، دریافت خروجی حساب و پاک‌سازی زمان‌بندی‌شدهٔ داده‌های منقضی را اضافه می‌کند. پخش صدا فقط گزارش مرورگر است؛ پایان پاسخ سرور به معنی موفقیت کار یا رضایت کاربر نیست. دلیل خطا یا قطع پخش، بدون شاهد معتبر، نامشخص می‌ماند.

گزارش‌های هر شخص خصوصی هستند و نقش مالک یا مدیر ارشد اجازهٔ دیدن آمار خصوصی دیگران را نمی‌دهد. خروجی حساب به فضای انتخابی و حافظهٔ مشترک منتشرشده‌ای محدود است که دسترسی آن هنوز معتبر باشد. وضعیت حذف در سرویس‌دهنده‌ها و نسخه‌های پشتیبان تأیید نشده است.

پردازش پس‌زمینه تنها با تنظیم صریح `STUDIO_MAINTENANCE=1` فعال می‌شود. اضافه‌شدن کد هیچ رضایت یا دسترسی تازه‌ای ایجاد نمی‌کند. گردش بهبود محلی از داده و کلیدهای مصنوعی، ارزیابی محدود در Docker و امضای جداگانهٔ ارزیاب و تأییدکننده استفاده می‌کند. این آزمایش کوچک، کیفیت مکالمهٔ واقعی، جداسازی مجوزهای تولید، انتشار خودکار کد یا بازگردانی واقعی سرویس را اثبات نمی‌کند.

آزمون‌های مرورگر شامل انگلیسی، فارسی، راست‌به‌چپ، جداسازی فضاها و دریافت فایل هستند. آزمون دستگاه واقعی، اندازه‌گیری کیفیت سرویس‌دهنده، سیاست مصوب انتشار و پایلوت عملیاتی همچنان لازم‌اند. اطلاعات حقوقی ثبت‌شده و نشانی بهره‌بردار هنوز تکمیل نشده؛ ایمیل تأییدشدهٔ حریم خصوصی `info@joyixir.com` است.
