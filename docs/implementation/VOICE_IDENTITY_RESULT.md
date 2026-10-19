# VOX-039–041 scoped voice identity lifecycle

Candidate: uncommitted additions on `codex/vox-adaptive-completion`, base `9fb73d3`; 19 October 2026. Author role: voice engineer. Independent acceptance belongs to the lead/evaluator; this document is author evidence. No live or paid provider calls, real-person enrollment, deployment, or device qualification were performed.

## Implemented behavior

The Studio Privacy screen has separate English/Persian recognition controls, RTL output, status, disclosure, own-live-voice enrollment statement, test, cancel, deletion and non-biometric alternatives. The ordinary microphone and cloned voice controls do not grant biometric consent. A failed or unsupported provider leaves recognition unavailable; ordinary text/calls and authenticated profile selection remain available.

There is one canonical `optional.biometric_recognition` permission in the existing account aggregate. The service additionally requires a current, separately presented enrollment statement and device-session/space capture intent. The server checks verified adult/profile scope, exact reviewed jurisdiction approvals, canonical consent/epoch, provider release approval and the separate key before issuing capture. No microphone prompt happens until that intent succeeds. Capture is one-use, expires within 30 seconds, records at most 10 seconds in the supplied browser client and accepts at most 1 MB. A qualified adapter must verify the duration, live challenge and isolated eligible speaker before feature extraction. Unknown/mixed/recorded/replay/synthetic or uncertain input abstains; the synthetic fixture demonstrates sequencing, not detection quality.

Provider injection is explicit. The production runtime has **no selected adapter, key or provider approval and `enabled: false`**. Neither Decisions, speech transcription nor TTS is treated as speaker matching. An enabled adapter must support the reviewed stateless inspection/extraction/bounded-comparison/purge contract, exact provider/version/location, approved EN/FA disclosure, numeric template/enrollment retention, current approval reference and independent encryption key. This source contract is not vendor or legal qualification.

Opaque reference bytes use AES-256-GCM in a dedicated restricted storage aggregate, authenticated to account, person, Work/Personal space, device-session and biometric purpose epoch. Audio and live query templates are not persisted or sent to analytics/tracing. Mutable application audio/query/reference buffers are zeroed when processing finishes/fails or its remaining capture lease expires. Adapter promises are raced against cancellation/deadlines even if a broken adapter ignores its signal; late opaque extraction results are erased. Purge is bounded to five seconds and late acknowledgements cannot turn a returned pending result into completion. Provider intermediate memory cleanup and infrastructure backups remain separate verified operational requirements.

Testing compares only the current authenticated self reference; the result is `possible_self` or `unknown`, with no identity ID, name or confidence claim. Voice/style resemblance never changes a binding, account, profile, memory access, grant, audience or tool authority. The user is directed to authenticated profile controls. Group/call biometric matching is unavailable: participant isolation/permission before query extraction has not been established.

Deletion explicitly withdraws canonical recognition permission for the selected space and purges every enrolled device-session in that space. The UI explains this scope before the action. The canonical epoch prevents an older restored voice-store document from reviving the enrollment, including after a new grant. Whole-system historical restore must apply current external tombstones before reads; this source slice does not qualify backup recovery. Failed provider purge leaves durable suppression plus visible `provider_pending`, with retry controls. Online completion does not assert backup deletion. Profile change/expiry and canonical purpose changes call the separate invalidation hook after authority commits; `maintenanceAccount` expires scoped templates and retries purge for an explicit server account registry.

## Local evidence

Command:

```sh
npx vitest run src/lib/adaptive/voice-identity src/app/studio/_components/VoiceRecognitionPanel.test.tsx src/app/studio/_lib/voice-identity-client.test.ts --reporter=dot
```

Result: **4 test files, 29 tests passed**, 19 October 2026, local Node/Vitest, synthetic bytes/provider only. Checks include real signed-auth HTTP → service → durable file storage → provider protocol → encrypted template → self-only hint → canonical withdrawal/deletion; account/space/device isolation and encryption AAD; receipt/one-use intent replay; provider failure/retry; epoch invalidation during in-flight extraction; all-device withdrawal and profile-change hooks; maintenance/expiry; restoration of old ciphertext before and after regrant; EN/FA/RTL controls; unchecked own-voice enrollment; local abort during canonical withdrawal; simulated OS microphone denial/unresolved-prompt cleanup; ignored-abort extraction/comparison/purge, late-result wiping and a capture with only 500 ms remaining. Invalidation/maintenance suppresses all rows first, uses at most five concurrent bounded provider purges for the 20-row account limit, and repeated canonical expiry hooks do not recursively retry pending purges. TypeScript and ESLint for owned paths passed after these changes.

Owned source: `src/lib/adaptive/voice-identity/**`, `src/app/api/studio/voice-identity/[[...path]]/route.ts`, `src/app/studio/_components/VoiceRecognitionPanel{,.test}.tsx`, and `src/app/studio/_lib/voice-identity-client{,.test}.ts`. The lead owns canonical policy/invalidation/runtime and Privacy parent wiring.

## Remaining gates

VOX-038 and VOX-042 remain **UNAVAILABLE**: provider selection, on-device feasibility versus approved cloud departure, binding provider contract/residual retention, jurisdiction/legal/DPIA and written-release approval, EN/FA error/abstention/spoof thresholds, real microphone/noise/overlap/recorded/cloned-speech evaluations, actual browser/device permission behavior, key access/rotation, logout cleanup, backup restore/tombstone operations, maintenance scheduling/alerts and deployment. No accuracy, liveness or legal-compliance claim follows from synthetic protocol tests. The optional feature remains disabled until those owners qualify the actual target.

## خلاصهٔ فارسی

چرخهٔ محدود ثبت، وضعیت، آزمایش و حذف تشخیص صدا همراه با کنترل‌های فارسی و انگلیسی پیاده‌سازی و با دادهٔ کاملاً مصنوعی آزمایش شد. رضایت تشخیص صدا همان مجوز مستقل و اصلی حساب است؛ ثبت صدا به افشای جداگانه و انتخاب صریح صدای زندهٔ خود فرد نیز نیاز دارد. ضبط فقط پس از مجوز کوتاه‌مدت سرور آغاز می‌شود. شباهت صدا هرگز هویت یا دسترسی خصوصی را تغییر نمی‌دهد.

حذف، تشخیص صدا را در فضای انتخاب‌شده خاموش می‌کند و الگوهای همهٔ دستگاه‌های آن فضا را برای حذف پردازش می‌کند. در صورت شکست حذف ارائه‌دهنده، استفاده مسدود می‌ماند و وضعیت انتظار نمایش داده می‌شود. حذف آنلاین به معنی حذف همهٔ پشتیبان‌ها نیست. ارائه‌دهندهٔ واقعی، تأیید حقوقی، کیفیت تشخیص و آزمایش دستگاه هنوز در دسترس نیستند؛ بنابراین قابلیت در محیط واقعی خاموش می‌ماند. ۲۹ آزمون محلی مصنوعی موفق شدند و هیچ صدای واقعی ثبت نشد.

## Release review correction — device-session capacity

Review finding: opening Privacy under a new session-storage device ID previously persisted an empty voice row, including while the provider was unavailable. Twenty such visits exhausted the bounded account store. Status, cancellation, capture checks and purge reads now use an ephemeral empty projection for unknown scopes. Only an explicit enrollment disclosure creates a row. If a full legacy store contains untouched `not_asked` placeholders (revision/epoch zero, no disclosure receipt, enrollment statement, capture, template or purge attempt), explicit enrollment may reclaim one. Active enrollment, ciphertext, pending provider deletion, and revoked/expired evidence/tombstones are preserved.

The deliberate limit remains **20 real enrollment/disclosure/revocation records per account**. When all records are protected, an explicit new enrollment returns **HTTP 409 `storage_capacity`**; status reads continue to work and no protected record is silently deleted. Archival of real enrollment evidence needs a separately approved retention policy; durable device IDs are not used to hide the limit.

Validation: the complete focused voice suite now passes **32 tests / 4 files**, including 40 disabled fresh-session status visits with zero durable rows; reclamation of legacy placeholders while preserving active/pending-purge/revocation records byte-for-byte; and 30 additional status visits against a full protected store followed by explicit 409. Owned-path ESLint and TypeScript passed. These are local synthetic tests; production provider/device qualification remains unavailable.

**اصلاح ظرفیت نشست دستگاه:** مشاهدهٔ وضعیت در نشست تازه دیگر رکورد خالی دائمی ایجاد نمی‌کند. فقط ثبت صریح، رکورد ایجاد می‌کند و جای‌نگهدارهای قدیمیِ استفاده‌نشده قابل بازیابی ظرفیت هستند. الگوی فعال، حذف در انتظار و شواهد لغو حفظ می‌شوند. سقف ۲۰ رکورد واقعی همچنان برقرار است؛ پر بودن رکوردهای محافظت‌شده، ثبت جدید را با خطای صریح ۴۰۹ متوقف می‌کند، اما نمایش وضعیت ادامه دارد. ۳۲ آزمون محلی مصنوعی موفق شدند.
