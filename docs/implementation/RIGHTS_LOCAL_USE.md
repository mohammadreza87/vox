# Scoped local-use restrictions / محدودیت استفادهٔ محلی

**Pre-release qualification snapshot — candidate `6c0718ec84a6e141e3cf22d0758782aa17611146` (tree `8dd033ed35801c0807f61765b844b507a1bc7cf9`).** Independent source acceptance passed 39/39 checks across 11 files; 981 source hashes were unchanged. The production build passed (`ZXMdZEogMmYQguqBwlYqc`). CI230 (`39410896635`) tests/E2E passed: 4,001 passed and 13 existing skips across 287 files (2 skipped files). CI also passed 46 Node checks and 41 existing browser journeys across 8 groups; those journeys do not cover dedicated RF1 controls. Indexed43 and Preview150 succeeded. The audit is **not clean**: exit 1 with 14 findings (8 moderate, 6 high); the workflow job stayed green because of `continue-on-error`, and dependencies were unchanged.

Compiled-app SQLite09 and FILE09 each passed 13/13 (26 cases total); FILE09 covers 7 active, 4 restart and 2 policy-off cases. Independent combined browser acceptance passed 26/26 (13 SQLite + 13 FILE), with zero failures, skips or flaky cases. Evidence uses mock transport and synthetic identities; it does not establish OS isolation, native browser zoom or language selection, physical-device behavior, or provider behavior. Merge and release remain pending.

Candidate `25a2661` was rejected and its regression/criteria correction is preserved. RF1 is only one technical slice of VOX-056, limited to the requester account and selected space/purpose. Broader privacy obligations, remaining VOX-056 requirements and legal approval remain open. This document neither enables a feature nor certifies legal compliance.

The live baseline at this qualification was `a49f734`, documented in [the learning-case release](RELEASE_LEARNING_CASES_2026_10_20.md).

An authenticated requester can apply a restriction to one supported purpose in one space: Work or Personal, and optional personalization or optional product analytics. A restriction or objection request must already exist for that signed-in account. Intake and legal review remain separate. One deliberate **Apply local restriction** action confirms the technical change; no per-request operator preapproval is added.

The selected purpose's automatic stored-context, preference, learning, observation and dependent relationship uses stop. Core replies, deliberate selected-note tools and own-data management/export retain their separate existing permission, source and personalization-pause checks. The restriction does not change consent, extend retention, delete records, recall external copies or establish a natural person's identity.

RF1 applies to the signed-in requester account and one selected space/purpose. It does not promise that a restriction propagates to other participants or recipients, or that copies held by third parties or providers stop. Shared-container grants/revocation and existing product-pause participant rules remain separate.

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

The independent source suite passed 39/39 synthetic checks. Compiled-app SQLite09 and FILE09 each passed 13/13; independent combined browser acceptance passed 26/26 (13 SQLite + 13 FILE), with zero failures, skips or flaky cases. The cases cover EN/FA desktop and 320px mobile (CSS 200% on mobile), keyboard apply/release, lost mutation responses followed by manual GET without POST retry, delayed space unmount/fresh scope/account, and overlapping holds. Transport and identities are synthetic; OS isolation, native browser zoom/language selection, physical-device and provider behavior remain unavailable. Provider/backup deletion, RF2 erasure, guest/delegate identity, production service IAM, legal eligibility and device qualification remain open.

## فارسی

**وضعیت صلاحیت پیش از انتشار — نامزد `6c0718ec84a6e141e3cf22d0758782aa17611146` (درخت `8dd033ed35801c0807f61765b844b507a1bc7cf9`).** پذیرش مستقل منبع با ۳۹ از ۳۹ بررسی در ۱۱ فایل موفق شد؛ ۹۸۱ هش منبع بدون تغییر ماند. ساخت تولیدی موفق شد (`ZXMdZEogMmYQguqBwlYqc`). آزمون‌ها و E2E در CI230 (`39410896635`) موفق شدند: ۴۰۰۱ موفق و ۱۳ موردِ ازپیش‌موجودِ اجرا‌نشده در ۲۸۷ فایل (۲ فایل اجرا‌نشده). همچنین ۴۶ بررسی اسکریپتی Node و ۴۱ مسیر مرورگر موجود در CI در ۸ گروه موفق شدند؛ این مسیرها کنترل‌های اختصاصی RF1 را پوشش نمی‌دهند. Indexed43 و Preview150 موفق شدند. ممیزی **پاک نیست**: کد خروجی ۱ و ۱۴ یافته (۸ متوسط، ۶ بالا) داشت؛ job فقط به‌دلیل `continue-on-error` سبز ماند و وابستگی‌ها تغییر نکردند.

اجرای مرورگر برنامهٔ کامپایل‌شدهٔ SQLite09 و FILE09 هرکدام با ۱۳ از ۱۳ موفق شد (مجموع ۲۶ مورد)؛ FILE09 شامل ۷ مورد فعال، ۴ مورد راه‌اندازی مجدد و ۲ مورد خاموشی سیاست است. پذیرش مستقل ترکیبی مرورگر با ۲۶ از ۲۶ (۱۳ SQLite و ۱۳ FILE) و بدون شکست، مورد ردشده یا نتیجهٔ ناپایدار موفق شد. شواهد از انتقال ساختگی و هویت‌های ساختگی استفاده می‌کنند و جداسازی سیستم‌عامل، بزرگ‌نمایی/انتخاب زبان بومی مرورگر، رفتار دستگاه واقعی یا ارائه‌دهنده را اثبات نمی‌کنند. ادغام و انتشار در انتظارند.

نامزد `25a2661` رد شد و گزارش رگرسیون و اصلاح معیار آن حفظ شده است. RF1 فقط یک بخش فنی از VOX-056 و محدود به حساب درخواست‌کننده و فضای/هدف انتخاب‌شده است. تعهدات گسترده‌تر حریم خصوصی، نیازمندی‌های باقی‌ماندهٔ VOX-056 و تأیید حقوقی باز هستند. این سند قابلیت را فعال نمی‌کند و تأیید حقوقی نیست.

این محدودیت فقط برای حساب درخواست‌کننده و فضای کاری یا شخصی و هدف انتخاب‌شده اعمال می‌شود. این قابلیت تضمین نمی‌کند که محدودیت به سایر شرکت‌کنندگان یا دریافت‌کنندگان سرایت کند یا نسخه‌های نزد ارائه‌دهندگان یا اشخاص ثالث متوقف شوند. مجوزها و لغو مجوزهای فضای مشترک و قواعد فعلی مکث محصول برای شرکت‌کنندگان جداگانه‌اند.


کاربر واردشده می‌تواند برای درخواست محدودیت یا اعتراضِ متعلق به همان حساب، یک هدف مشخص را در فضای کاری یا شخصی محدود کند: شخصی‌سازی اختیاری یا تحلیل اختیاری محصول. دکمهٔ «اعمال محدودیت محلی» یک تأیید روشن برای اقدام فنی است. ثبت درخواست و رسیدگی حقوقی از این اقدام جدا می‌مانند.

استفادهٔ خودکار از داده‌های ذخیره‌شده در دامنهٔ انتخاب‌شده متوقف می‌شود. پاسخ اصلی، ابزار عمدی روی یادداشت انتخاب‌شده و مدیریت یا خروجی گرفتن از داده‌های خود کاربر همچنان به مجوزها و کنترل‌های قبلی وابسته‌اند. محدودیت، رضایت را تغییر نمی‌دهد، مدت نگهداری را تمدید نمی‌کند و داده‌ای را حذف نمی‌کند.

وضعیت فعلی محدودیت از کنترل اصلی حساب خوانده می‌شود؛ ثبت ناقص نتیجه نمی‌تواند محدودیت فعال را غیرفعال نشان دهد. وضعیت نامعلوم صریح است. پایان دادن به محدودیت، اقدام جداگانه‌ای با سیاست بازبینی‌شدهٔ فعلی است؛ بستن درخواست، اعطای دوبارهٔ رضایت، ادامهٔ شخصی‌سازی یا گذشت زمان آن را پایان نمی‌دهد. کار لغوشده نیز دوباره شروع نمی‌شود.

مهاجرت صریح به نسخهٔ ۳، سابقه، رضایت، ساعت مشاهده‌شده و مبنای نگهداری را حفظ می‌کند. بررسی مجوز استفاده همچنان به فضای ذخیره‌سازی و نسخهٔ فعلی وابسته است. لغو واقعی رضایت، انقضا و حذف منبع همچنان اعمال می‌شوند. ظرفیت قبلی افزایش نمی‌یابد؛ فضای لازم برای پایان دادن به محدودیت و ثبت نتیجه باید محفوظ بماند.

اگر پایان دادن به محدودیت پیش از تغییر اصلی متوقف شود، کاربر می‌تواند با اعتبار فعلی دوباره آن را تأیید کند. اگر تغییر دیگری برنامهٔ قبلی را نامعتبر کرده باشد، برنامه و تأیید تازه لازم است. قصد قبلی حفظ و به‌صورت صریح جایگزین می‌شود؛ پردازش قدیمی دیگر نمی‌تواند آن را اجرا یا نتیجه‌اش را ثبت کند. در لحظهٔ ثبت جایگزین، محدودیت باید همچنان فعال باشد. این بازیابی خودکار نیست و تطبیق نتیجه توسط اپراتور آن را انجام نمی‌دهد. ظرفیت اولیه، یک اقدام پایان دادن، یک جایگزین و رسیدهای لازم را محفوظ می‌گذارد؛ جایگزینی‌های تکراری سابقه را مصرف می‌کنند و ممکن است به سقف ظرفیت برسند.

قصد اعمال محدودیت نیز مهلت اجرای مشخص دارد. پس از گذشت این مهلت بر اساس ساعت معتبر، تنها خواندن قطعی وضعیت اصلی و اثبات نبود همان اثر اجازه می‌دهد آن قصد غیرقابل‌اجرا شناخته شود. سپس برنامه و تأیید تازهٔ کاربر می‌تواند اثر جدیدی ایجاد کند؛ این بررسی‌ها هنگام ثبت دوباره انجام می‌شوند. وضعیت نامعلوم یا مشغول به معنی نبود اثر نیست، محدودیت ثبت‌شده هرگز با این مسیر منقضی نمی‌شود و سابقه و ظرفیت محفوظ قصد قبلی باقی می‌ماند.

سیاست فعلی RF1 اجازهٔ حذف فرادادهٔ کنترل، قصد اقدام و رسید نتیجه را نمی‌دهد. تا زمانی که این وابستگی‌ها نگهداری می‌شوند، حذف نهایی پروندهٔ درخواست مجاز نیست؛ حتی اگر محدودیت پایان یافته و حداقل زمان نگهداری گذشته باشد. این قابلیت به سیاست بازبینی‌شدهٔ جداگانه نیاز دارد و ظرفیت محدود می‌تواند پذیرش اقدام جدید را متوقف کند.

آماده‌سازی محلی نیازمند مدیر مورد اعتماد، توقف قبلی نویسنده‌ها و سیاست معتبر و صریح است. پرچم‌های خط فرمان فقط اظهار مدیر هستند و احراز هویت یا اثبات توقف فرایند محسوب نمی‌شوند. پذیرش مستقل منبع با ۳۹ از ۳۹ بررسی ساختگی موفق شد. مرورگر برنامهٔ کامپایل‌شدهٔ SQLite09 و FILE09 هرکدام با ۱۳ از ۱۳ موفق شد؛ پذیرش مستقل ترکیبی مرورگر با ۲۶ از ۲۶ (۱۳ SQLite و ۱۳ FILE) و بدون شکست، مورد ردشده یا نتیجهٔ ناپایدار موفق شد. موارد مرورگر EN/FA در دسکتاپ و موبایل ۳۲۰ پیکسلی (CSS 200٪ فقط روی موبایل)، اعمال/آزادسازی با صفحه‌کلید، پاسخ ازدست‌رفتهٔ تغییر با GET دستی و بدون تکرار POST، خروج دیرهنگام از فضا و محدوده/حساب تازه، و محدودیت‌های هم‌پوشان را پوشش می‌دهند. انتقال و هویت‌ها ساختگی‌اند؛ جداسازی سیستم‌عامل، بزرگ‌نمایی/انتخاب زبان بومی مرورگر، دستگاه واقعی و ارائه‌دهنده بررسی نشده‌اند. حذف نزد ارائه‌دهنده یا نسخهٔ پشتیبان، پاک‌سازی RF2، هویت مهمان/نماینده، IAM تولید، بررسی حقوقی و پذیرش دستگاه باز هستند. این سند قابلیت را فعال نمی‌کند، تأیید حقوقی نیست و تکمیل کل نقشهٔ راه را نشان نمی‌دهد.


## Evidence references

External evidence directory: `/Users/reza/.codex/visualizations/2026/10/20/vox-learning-cases/`.

- Independent synthetic suite: `rf1-independent-qa/REPORT.md` (SHA256 `754d99b14b1e84ca0634b1d76600091b6bdd167379ae8be6d0e722877f46ab7e`); 39/39, 11 files, no skips/failures; exact candidate/tree above.
- Exact-source manifest: `rf1-independent-qa/evidence-manifest.json` (SHA256 `3418ae77ede963a454b340d661137134bc7d560524e99319b29ac4dfc815b5af`); 981 source hashes unchanged.
- Historical rejected candidate `25a2661`: `rf1-independent-qa/criteria-correction-2026-10-20/REPORT.md`, `FINDING_01_PAUSE_ABA.md` and `evidence-manifest.json` preserve the failed candidate and corrected oracle.
- Corrected production build: exit 0, build `ZXMdZEogMmYQguqBwlYqc`, manifest `rf1-release/corrected-candidate-build-manifest.json`, built `2026-10-20T10:53:54.094Z`.
- CI230 evidence: `rf1-release/ci-39410896635-tests.txt`, `-e2e.txt` and `-audit.txt`. Test/E2E jobs succeeded: 4,001 passed, 13 existing skipped checks across 287 files (2 skipped files). There were 46 Node script checks (1 Connections release-preservation + 41 single-host release-safety/configuration + 4 guest-build provenance), and separately 41 CI browser journeys across 8 groups (2+5+2+6+8+1+1+16). Indexed43 and Preview150 succeeded. Audit command exited 1 with 14 findings (8 moderate, 6 high); workflow continues on error and dependencies were unchanged.
- Compiled-app SQLite and FILE attempt09 each passed 13/13 (26 total); FILE stages were 7 active, 4 restart and 2 policy-off. Receipts: `rf1-browser-qa/attempt-09-sqlite/run-receipt.json` (SHA256 `24b88fc1f083b067a5b143b2354a08c025193422ef00106106e05035fd51a60a`) and `rf1-browser-qa/attempt-09-file/run-receipt.json` (SHA256 `cd88a4c14957d713a9884116728271d45468b8953736aaa8a0c15f87a1c52704`). Independent combined acceptance passed 26/26 (13 SQLite + 13 FILE), with zero failures, skips or flaky cases. Final report `rf1-independent-qa/BROWSER_REPORT.md` (SHA256 `cd250097ec65efd015dd5c8eaa7050a20349e118b464a3af7b1135a0b0b5d5df`) and manifest `rf1-independent-qa/BROWSER_EVIDENCE_MANIFEST_09.json` (SHA256 `f2cf1a3a2db9f7557d65a91a88594caad30b7b4792d6e3f7cc3fdf971f997a56`, 110 files) bind the evidence to the candidate. Both runs use mock transport and synthetic identities; browser binary hash and OS network isolation are unavailable. Native language/zoom, phase-specific crash, delayed account/purpose, operator-revocation, device and provider behavior remain unverified. Mobile screenshots at CSS 200% use a native viewport and may omit the headline; they do not prove the complete status screen. Earlier harness setup/fixture failures are preserved externally. Merge/release pending.


## ارجاعات شواهد

پوشهٔ شواهد بیرونی: `/Users/reza/.codex/visualizations/2026/10/20/vox-learning-cases/`.

- مجموعهٔ مستقل آزمایش‌های ساختگی: `rf1-independent-qa/REPORT.md` با SHA256 `754d99b14b1e84ca0634b1d76600091b6bdd167379ae8be6d0e722877f46ab7e`؛ 39 از 39 مورد در 11 فایل، بدون مورد ردشده یا ناموفق.
- مانیفست منبع دقیق: `rf1-independent-qa/evidence-manifest.json` با SHA256 `3418ae77ede963a454b340d661137134bc7d560524e99319b29ac4dfc815b5af`؛ 981 هش منبع بدون تغییر.
- نسخهٔ ردشدهٔ تاریخی `25a2661`: `rf1-independent-qa/criteria-correction-2026-10-20/REPORT.md` و فایل‌های همان پوشه، شکست و اصلاح معیار را نگه می‌دارند.
- ساخت نهایی اصلاح‌شده: موفق، build ID `ZXMdZEogMmYQguqBwlYqc`، مانیفست `rf1-release/corrected-candidate-build-manifest.json`.
- شواهد CI230: `rf1-release/ci-39410896635-tests.txt`، `-e2e.txt` و `-audit.txt`. آزمون‌ها و E2E موفق شدند: 4001 مورد موفق و 13 موردِ ازپیش‌موجودِ اجرا‌نشده در 287 فایل (2 فایل اجرا‌نشده). 46 بررسی اسکریپتی Node (1 حفظ انتشار Connections، 41 ایمنی/تنظیمات تک‌میزبان، 4 منشأ ساخت مهمان) انجام شد؛ جداگانه، 41 مسیر مرورگر CI در 8 گروه موفق بود (2+5+2+6+8+1+1+16). Indexed43 و Preview150 موفق بودند. ممیزی وابستگی با 14 یافته (8 متوسط، 6 بالا) پاک نیست.
- مرورگر کامپایل‌شدهٔ SQLite و FILE در تلاش 09 هرکدام با 13 از 13 موفق شدند (مجموع 26 مورد)؛ FILE شامل 7 مورد فعال، 4 مورد راه‌اندازی مجدد و 2 مورد خاموشی سیاست است. رسیدها: `rf1-browser-qa/attempt-09-sqlite/run-receipt.json` با SHA256 `24b88fc1f083b067a5b143b2354a08c025193422ef00106106e05035fd51a60a` و `rf1-browser-qa/attempt-09-file/run-receipt.json` با SHA256 `cd88a4c14957d713a9884116728271d45468b8953736aaa8a0c15f87a1c52704`. پذیرش مستقل ترکیبی با ۲۶ از ۲۶ مورد (۱۳ SQLite و ۱۳ FILE) و بدون شکست، مورد ردشده یا نتیجهٔ ناپایدار موفق شد. گزارش نهایی `rf1-independent-qa/BROWSER_REPORT.md` با SHA256 `cd250097ec65efd015dd5c8eaa7050a20349e118b464a3af7b1135a0b0b5d5df` و مانیفست `rf1-independent-qa/BROWSER_EVIDENCE_MANIFEST_09.json` با SHA256 `f2cf1a3a2db9f7557d65a91a88594caad30b7b4792d6e3f7cc3fdf971f997a56` (۱۱۰ فایل) شواهد را به نامزد ثابت متصل می‌کنند. انتقال و هویت‌ها ساختگی‌اند؛ هش باینری مرورگر و جداسازی شبکهٔ سیستم‌عامل در دسترس نیست. زبان/بزرگ‌نمایی بومی، خرابی مرحله‌ای، حساب/هدف با تأخیر، لغو اپراتور، رفتار دستگاه و ارائه‌دهنده تأیید نشده‌اند. تصاویر موبایل در CSS 200٪ از نمای بومی استفاده می‌کنند و ممکن است عنوان را نشان ندهند؛ بنابراین کل صفحهٔ وضعیت را اثبات نمی‌کنند. خطاهای قبلی راه‌اندازی/fixture بیرون از مخزن حفظ شده‌اند. ادغام و انتشار در انتظارند.
