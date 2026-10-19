# Adaptive conversation integration — 19 October 2026

This delivery combines the observation/lifecycle/improvement candidate from PR #51
with scoped conversation, memory retrieval, reversible prediction and optional
voice-enrollment infrastructure. Source implementation alone does not enable
optional processing; PR #52 and the release handoff record exact deployment state.

## Delivered behavior

- **Chat here** opens a real authenticated text/image conversation with an agent,
  separate Work/Personal state, EN/FA controls and scoped memory. Browser-selected
  images are resized/re-encoded and server-validated; only the current attachment
  goes to the reply provider. Vox does not persist image bytes in history, memories,
  observations or provider file storage.
- **Prepare while I type** is off by default and explains draft/image processing
  before Send. The actual browser consumer debounces updates, allows at most two
  Decisions evaluations per turn and discards stale/cancelled work. A permitted
  prediction warms the authorized retrieval cache without generating an answer,
  writing memory or sending a message. Send still follows normal authorization.
- **Bounded memory selection** prioritizes server-authored explicit preferences,
  ranks EN/FA terms, preserves whole statements and limits selected context to
  12 rows/8192 serialized UTF-8 bytes. Its bounded local LRU stores opaque ranking
  identifiers and hashes; current content and full authority receipts are always
  read again. It does not cache permission or raw memories.
- **Optional voice lifecycle** has one canonical biometric permission plus separate
  disclosure and deliberate own-voice capture. One-use intent, restricted encrypted
  templates, deadline-bounded processing, self-only hints, cancellation, deletion
  and maintenance retry are implemented. Removing enrollment withdraws permission
  and deletes all device enrollments in the selected space. Matching never switches
  identity or unlocks memory. Runtime has no qualified provider/key and remains off.
- **Observation integration** records consented, content-free outcomes from the new
  text/image route alongside the call/Telegram producers. Maintenance independently
  processes observation and voice cleanup; pending provider deletion keeps the
  bounded page retryable. PR #51 supplies durable events, scoped exports, read-only
  learning UI and independently evaluated, signed routing-artifact experiments.

## Review and verification

Sol 6.1 engineers authored and cross-reviewed the memory, prediction and voice
slices. A Luna runner authored bounded browser journeys. Root integrated and
reviewed the composed behavior. Independent review reproduced and closed:

1. Image approval changed during asynchronous context loading before provider use.
2. Web-search continuation/fallback re-exported content after withdrawal. Every
   scoped provider request now rechecks authority; hidden Anthropic SDK retries
   are disabled for those requests. The callback never enters provider JSON.
3. Late image decoding reused an edited-away draft.
4. A provider ignoring cancellation retained a pending voice request. Hard bounded
   waits now release the request, erase owned buffers and ignore/wipe late results.
5. Disabled prediction cancellation created new-format durable records. It now
   returns without introducing those records.
6. A separate Studio-state read failure skipped biometric cleanup. Both cleanup
   paths now start independently; failed pages retain their checkpoint for retry.
7. A persisted agent block was not checked by the new conversation route. Chat,
   prediction, preparation and experience projections now check it alongside
   current membership and grants, including after awaited provider work.
8. Disabled voice status visits allocated a device row per browser session. Reads
   no longer allocate; explicit enrollment can reclaim untouched legacy rows while
   preserving templates, enrollment evidence, revocations and pending deletion.

Author evidence: [memory](MEMORY_RETRIEVAL_RESULT.md),
[prediction](../../src/lib/adaptive/prediction/RESULT.md),
[voice](VOICE_IDENTITY_RESULT.md), and
[observation](evidence/observation-learning/RESULT.md). Full candidate validation,
compiled browser/server evidence, CI and deployed revision are distinguished in the
release section. Synthetic timings are not a measured improvement
in real-user response latency or proof of speaker-recognition accuracy.

## Rollout and rollback

No new optional capability is enabled by this release. `STUDIO_DECISIONS_ENABLED`,
adaptive policy approvals, relationship processing, maintenance and improvement
trust remain explicitly configured gates. Biometric matching requires a separately
qualified injected provider and independent encryption key; no environment toggle
alone installs one. No deployment sends test messages to real recipients.

New prediction metadata is backward-readable by this version but rejected by the
older strict schema. Before an older binary is restored after enabling prediction,
stop providers/preparation, use the explicit-account CAS-protected
[rollback utility](../../src/lib/adaptive/prediction/README.md#state-and-rollback),
and verify old-schema readability. It strips only new prediction metadata and
preserves budgets, consent, grants and deletion records. Never restore an old
account/voice snapshot over current revocation authority. Voice templates remain
unusable without the current canonical epoch, provider approval and key.

## Remaining product and activation work

The canonical backlog remains deliberately open for indexed memory retrieval and
general extraction/consolidation, verified cross-account person switching, true
partial-voice prediction, and the broader autonomous software-change loop. The
current improvement runner evaluates bounded routing artifacts, not arbitrary
self-deploying product changes. Browser push remains a later channel.

Provider/physical-device E2E, held-out semantic quality, actual latency/cost,
biometric accuracy/spoofing, deployed storage/key access and recovery qualification
remain separate gates. The user supplied Joyixir OÜ and info@joyixir.com; the registered
address is verified in [operator details](OPERATOR_DETAILS.md), while qualified legal/privacy approval remains pending. A consent
paragraph does not establish compliance for an otherwise unqualified data flow.

## خلاصهٔ فارسی

گفتگوی واقعی متن و تصویر با فضای کاری و شخصی جدا، آماده‌سازی اختیاری هنگام تایپ،
بازیابی محدود حافظه و کنترل‌های فارسی و انگلیسی ثبت و حذف صدا پیاده‌سازی شده‌اند.
رویدادهای مجاز گفتگو فقط نتیجه و زمان را ثبت می‌کنند، نه متن یا تصویر را. پیش‌بینی
اجازهٔ دسترسی، ثبت حافظه یا ارسال خودکار پیام ایجاد نمی‌کند. هر درخواست جدید به
ارائه‌دهنده و تحویل پاسخ دوباره مجوز جاری را بررسی می‌کند.

ارائه‌دهندهٔ تشخیص صدا هنوز تأیید و فعال نشده است. تشابه صدا هویت را تغییر نمی‌دهد.
حذف ثبت صدا، مجوز همان فضا را پس می‌گیرد و همهٔ الگوهای دستگاه‌های آن فضا را برای
حذف پردازش می‌کند. آزمون‌های مصنوعی جای آزمایش ارائه‌دهنده، دستگاه واقعی، کیفیت،
کارایی یا تأیید حقوقی را نمی‌گیرند. کارهای باقی‌مانده در فهرست اصلی صریح مانده‌اند.

## Validation and release evidence

- Candidate `232f4645e2928f611ae8bdb7417ecb2d7adf75bb`: **2065 passed,
  10 skipped**, 147 passing test files, with two workers and the unchanged 10-second
  per-test deadline. A prior run concurrent with a build exposed a capacity-test
  timeout; the quieter complete run passed. TypeScript passed; lint has no errors
  and reports existing warnings plus the new intentional cleanup-ref warning.
- Independent combined review approved `232f464`, including the actual runtime
  maintenance retry after a Studio-store failure and exact provider-payload
  comparisons after adding a server-only authorization callback.
- Production artifact `82e6eaa2db0ea9b57ed929faa9889057c8ad7f14`, build
  `6LkkM4qin-mWUp-tYQLGl`: two desktop/mobile browser journeys passed for EN/FA,
  actual PNG decode/JPEG re-encoding, scope clearing and unavailable voice. The
  standalone server launcher was then verified with the same two journeys.
- The same artifact passed [24 controlled HTTP checks](evidence/adaptive-completion/controlled-http.json)
  against real Next routes and file storage. Only external provider responses were
  synthetic. This proves the connected server path, not real provider performance.
- A [connected browser journey](evidence/adaptive-completion/controlled-browser.json)
  also passed with **zero API mocks**: actual mobile-viewport Chromium → compiled
  Next → file storage → synthetic external Anthropic response. Work text/image,
  Personal denial followed by a real scoped grant, and Persian RTL/reply all passed.
  This is a controlled complete application path, not physical-device evidence.

These are candidate receipts, not a claim that their exact revisions are still
deployed. Final promotion is coordinated through PR #52 after PR #51. The release
handoff records exact source/build, CI, local/public health, authentication checks,
polling ownership and unchanged activation flags. Physical devices, real provider
quality and legal clearance are not implied by a successful deployment.
