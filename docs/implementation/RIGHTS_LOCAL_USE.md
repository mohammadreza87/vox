# Scoped local-use restrictions / محدودیت استفادهٔ محلی

RF1 implements the local technical part of VOX-056. **Implementation is in progress; independent candidate, compiled browser, CI and release acceptance are pending.** The last released baseline is `a49f734`, documented in [the learning-case release](RELEASE_LEARNING_CASES_2026_10_20.md). This document does not enable a feature or certify legal compliance.

An authenticated requester can apply a restriction to one supported purpose in one space: Work or Personal, and optional personalization or optional product analytics. A restriction or objection request must already exist for that signed-in account. Intake and legal review remain separate. One deliberate **Apply local restriction** action confirms the technical change; no per-request operator preapproval is added.

The selected purpose's automatic stored-context, preference, learning, observation and dependent relationship uses stop. Core replies, deliberate selected-note tools and own-data management/export retain their separate existing permission, source and personalization-pause checks. The restriction does not change consent, extend retention, delete records, recall external copies or establish a natural person's identity.

## Authority and truthful status

- Canonical account controls determine current enforcement. Rights-ledger intents and acknowledgements record coordination; an acknowledgement alone never proves current authority.
- Status distinguishes current `active`, `released`, `not_applied` and `unknown` from acknowledgement `none`, `pending`, `recorded` and `failed`. Unknown state has null observation time, use epoch and effective-blocked value. A restriction can be active while its acknowledgement is pending or failed.
- Multiple restrictions combine with OR. Every genuine apply/release advances the exact space-purpose use epoch, even when another restriction keeps that scope blocked. Exact replay does not advance it. Missing old-use stamps cannot authorize new work.
- Release is a distinct requester action under an explicitly reviewed current release policy. Request closure, consent regrant, pause Resume, policy expiry, retention deadlines and timers never release a restriction or restart old work.
- Canonical proof of an active restriction can support explicit release while its original acknowledgement is pending. Later reconciliation records current proof, without inventing historical completion times.
- Request status stays visible when new admissions are disabled. Operator reconciliation can acknowledge only an exact existing effect; it cannot silently retry or apply a new one. Closing a request before apply prevents the new effect; closing it afterward preserves the effect.

The UI supports English/Persian, keyboard use, narrow screens and RTL. It uses initial/manual refresh with account/scope/unmount response guards. A lost mutation response stays unconfirmed until a fresh read. There is no silent POST retry, polling or browser persistence of plans. Legal status is never replaced by “fulfilled,” “deleted” or “all processing stopped.”

## Retention, versions and recovery

Canonical data/control schema 3 requires `rightsUseHolds` / `rightsUseControls` and bounded `retentionStoreIdentity`. Four fixed space-purpose rows carry use epochs. At most 128 metadata-only effects contain exact request/scope, policy/notice commitments, intent digests, review/retention floors and explicit release metadata. Control descriptors expose no source bodies.

Use authority and retention authority are separate. A hold fences dispatch, body admission and late publication without making retained records disappear from sweep/export. Explicit conversion pins the actual validated old namespace for retention; current dispatch still uses the new namespace and use epochs. The account pin is immutable across ordinary writes and repeated conversions. Per-row pins preserve observer, correction, learning and relationship lineage created in different namespaces. Experiment retention reconciliation uses the account pin plus current binding/consent. Real withdrawal, expiry, deletion and source invalidation still apply.

Managed markers use version 3, canonical/control schema 3, product-pause enforcement 1 and rights-use-hold enforcement 1. SQLite uses `user_version=3` and metadata schema 3. FILE physical format remains 2, with head schema 3, authority projection 2 and image version 2/schema 3. Indexed use receipts/handles/cursors use version 2 for schema 3. Older readers/installers must refuse actual new stores.

Rights ledger version 3 remains in `rights-intake/v1` and preserves existing requests, audits, receipts, tombstones and observed-time floors. Its required `localUse` section holds durable intents and acknowledgements. Coordination is **intent → canonical effect → acknowledgement**, with independent writers and final current-authority fences. There is no cross-store transaction claim. Crash recovery inspects exact canonical intent commitments and reports pending/unknown truthfully.

A release interrupted before its canonical effect can be retried deliberately while its original authority remains current. If intervening changes make it stale, the requester can review a fresh plan and confirm a replacement release under current policy and notice. The replacement preserves the old intent and explicitly supersedes the latest unacknowledged release for that exact effect. At publication the effect must still be active; an older worker must refuse after a successor is committed. Superseded intents cannot later be executed or acknowledged. Operator reconciliation never performs this replacement.

An uncommitted apply intent also has a finite execution deadline. Only a positive current canonical read proving its exact effect absent, together with trusted monotonic time beyond that deadline, can classify it as no longer executable. A fresh requester plan and confirmation may then create a new effect under current authority; publication repeats the absence and deadline checks. Unknown or busy state cannot prove absence, and an already committed hold never expires through this recovery path. The old intent, replay exclusion and conservative capacity reservation remain intact.

The current reviewed RF1 actions do not authorize retirement of local control/intent/acknowledgement metadata. Retained dependencies therefore block terminal request purge, even after a released effect's minimum floors pass. Metadata retirement requires a separate reviewed capability; until then finite capacity may make further admissions unavailable. No floor is silently treated as an automatic deletion or release deadline.

Limits remain 700,000 canonical bytes (including the separate 2,048-byte pause reserve), 65,536 rights-ledger bytes and existing row caps. All writers must preserve deterministic worst-case UTF-8 space, row slots and counter headroom for outstanding releases, missing acknowledgements and clock bookkeeping. An initial active effect reserves two future release intents and acknowledgements: the first release and one replacement. An outstanding release reserves one replacement and acknowledgement. The original missing apply acknowledgement also remains reserved. Repeated replacements consume retained history and may eventually be refused; capacity is finite. Admission may refuse before row limits. It cannot evict unresolved controls/receipts or consume reserved release capacity.

## Explicit preparation

No status read, policy installation or requester mutation converts storage automatically. A trusted local administrator must first establish that all relevant writers are stopped and preserve a recoverable backup. The following commands use explicit operator attestations; the flags do not authenticate an operator or prove process shutdown.

```sh
node --import tsx scripts/adaptive-storage.ts prepare-rights-use-holds \
  --root /absolute/data/adaptive --format sqlite-v1 --quiesced

node --import tsx scripts/rights-intake-storage.ts prepare-local-use \
  --data-dir /absolute/data --account-id telegram-account:123 \
  --policy-file /absolute/reviewed-rights-policy.json \
  --quiesced --local-administrator
```

The first command also supports explicit `--format file-v2`. The second requires an existing account ledger and currently valid, reviewed policy version 2 with explicit `localFulfillment.ledgerConversion` approval/decision references. Policy 1 remains intake-only. No duration, jurisdiction decision or approval reference is supplied by default. Real deployments require the privacy owner's reviewed retention basis, current action scope and matching EN/FA notices.

Preparation preserves data and consent; it does not grant capabilities or enable the feature. An already converted ledger is not rewritten, although a legitimate monotonic-clock observation may advance its separate clock record. Missing/invalid policy, absent account, unsupported storage or uncertain authority fails explicitly. Source changes alone do not qualify downgrade safety, actual migrations or backup recovery.

Independent acceptance must include real FILE/SQLite conversion, actual prior-reader refusal, preserved retention/export through conversion and hold changes, subsequent withdrawal/expiry invalidation, apply/release/ack crash ordering, replay after release, all-writer capacity boundaries, current-state UI guards and compiled EN/FA journeys. Provider/backup deletion, RF2 erasure, guest/delegate identity, production service IAM, legal eligibility and device qualification remain separate gates.

## فارسی

این بخش از VOX-056 هنوز در حال پیاده‌سازی است؛ پذیرش مستقل نسخهٔ ثابت، آزمون مرورگر کامپایل‌شده، CI و انتشار نهایی انجام نشده است. آخرین نسخهٔ منتشرشده `a49f734` است.

کاربر واردشده می‌تواند برای درخواست محدودیت یا اعتراضِ متعلق به همان حساب، یک هدف مشخص را در فضای کاری یا شخصی محدود کند: شخصی‌سازی اختیاری یا تحلیل اختیاری محصول. دکمهٔ «اعمال محدودیت محلی» یک تأیید روشن برای اقدام فنی است. ثبت درخواست و رسیدگی حقوقی از این اقدام جدا می‌مانند.

استفادهٔ خودکار از داده‌های ذخیره‌شده در دامنهٔ انتخاب‌شده متوقف می‌شود. پاسخ اصلی، ابزار عمدی روی یادداشت انتخاب‌شده و مدیریت یا خروجی گرفتن از داده‌های خود کاربر همچنان به مجوزها و کنترل‌های قبلی وابسته‌اند. محدودیت، رضایت را تغییر نمی‌دهد، مدت نگهداری را تمدید نمی‌کند و داده‌ای را حذف نمی‌کند.

وضعیت فعلی محدودیت از کنترل اصلی حساب خوانده می‌شود؛ ثبت ناقص نتیجه نمی‌تواند محدودیت فعال را غیرفعال نشان دهد. وضعیت نامعلوم صریح است. پایان دادن به محدودیت، اقدام جداگانه‌ای با سیاست بازبینی‌شدهٔ فعلی است؛ بستن درخواست، اعطای دوبارهٔ رضایت، ادامهٔ شخصی‌سازی یا گذشت زمان آن را پایان نمی‌دهد. کار لغوشده نیز دوباره شروع نمی‌شود.

مهاجرت صریح به نسخهٔ ۳، سابقه، رضایت، ساعت مشاهده‌شده و مبنای نگهداری را حفظ می‌کند. بررسی مجوز استفاده همچنان به فضای ذخیره‌سازی و نسخهٔ فعلی وابسته است. لغو واقعی رضایت، انقضا و حذف منبع همچنان اعمال می‌شوند. ظرفیت قبلی افزایش نمی‌یابد؛ فضای لازم برای پایان دادن به محدودیت و ثبت نتیجه باید محفوظ بماند.

اگر پایان دادن به محدودیت پیش از تغییر اصلی متوقف شود، کاربر می‌تواند با اعتبار فعلی دوباره آن را تأیید کند. اگر تغییر دیگری برنامهٔ قبلی را نامعتبر کرده باشد، برنامه و تأیید تازه لازم است. قصد قبلی حفظ و به‌صورت صریح جایگزین می‌شود؛ پردازش قدیمی دیگر نمی‌تواند آن را اجرا یا نتیجه‌اش را ثبت کند. در لحظهٔ ثبت جایگزین، محدودیت باید همچنان فعال باشد. این بازیابی خودکار نیست و تطبیق نتیجه توسط اپراتور آن را انجام نمی‌دهد. ظرفیت اولیه، یک اقدام پایان دادن، یک جایگزین و رسیدهای لازم را محفوظ می‌گذارد؛ جایگزینی‌های تکراری سابقه را مصرف می‌کنند و ممکن است به سقف ظرفیت برسند.

قصد اعمال محدودیت نیز مهلت اجرای مشخص دارد. پس از گذشت این مهلت بر اساس ساعت معتبر، تنها خواندن قطعی وضعیت اصلی و اثبات نبود همان اثر اجازه می‌دهد آن قصد غیرقابل‌اجرا شناخته شود. سپس برنامه و تأیید تازهٔ کاربر می‌تواند اثر جدیدی ایجاد کند؛ این بررسی‌ها هنگام ثبت دوباره انجام می‌شوند. وضعیت نامعلوم یا مشغول به معنی نبود اثر نیست، محدودیت ثبت‌شده هرگز با این مسیر منقضی نمی‌شود و سابقه و ظرفیت محفوظ قصد قبلی باقی می‌ماند.

سیاست فعلی RF1 اجازهٔ حذف فرادادهٔ کنترل، قصد اقدام و رسید نتیجه را نمی‌دهد. تا زمانی که این وابستگی‌ها نگهداری می‌شوند، حذف نهایی پروندهٔ درخواست مجاز نیست؛ حتی اگر محدودیت پایان یافته و حداقل زمان نگهداری گذشته باشد. این قابلیت به سیاست بازبینی‌شدهٔ جداگانه نیاز دارد و ظرفیت محدود می‌تواند پذیرش اقدام جدید را متوقف کند.

آماده‌سازی محلی نیازمند مدیر مورد اعتماد، توقف قبلی نویسنده‌ها و سیاست معتبر و صریح است. پرچم‌های خط فرمان فقط اظهار مدیر هستند و احراز هویت یا اثبات توقف فرایند محسوب نمی‌شوند. این سند، قابلیت را فعال نمی‌کند و تأیید حقوقی، حذف نزد ارائه‌دهنده یا نسخهٔ پشتیبان، پذیرش دستگاه یا تکمیل کل نقشهٔ راه نیست.
