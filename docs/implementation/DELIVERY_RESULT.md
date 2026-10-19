# Vox adaptive system — integrated local delivery

19 October 2026. Operator: Joyixir. Audience: adults in the EU/EEA and US. Branch: `codex/adaptive-foundation`; base: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`. This is a local, uncommitted source candidate. It has not been pushed, deployed or enabled for live users.

**Disposition:** the bounded local core passes independent review, the composed regression suite and production-build browser flows. Final settled EN/FA screenshots and receipts are included in the browser evidence. This record supersedes the implementation status in the historical [first foundation result](FOUNDATION_RESULT.md). The 56-task [backlog](BACKLOG.md) remains the full roadmap, with partial tasks explicitly open. A delivered local core does not complete biometric, streaming, legal or release requirements.

## What the candidate does

| User outcome | Implemented behavior | Important boundary |
|---|---|---|
| Keep Work and Personal separate | Separate account-scoped memory, consent, preferences and inbox projections; visible call-space selector | Personal prompts omit the Work directory, projects and reporting relationships. An authenticated account profile is not proof of a physical speaker's identity. |
| Save private notes | Explicit save, inspect and delete; per-agent access; separate optional personalization choice | Agent ownership/admin status does not grant private-memory access. Automatic extraction is unavailable. |
| Share with exact people or a group | Server audience preview, deliberate share action, exact recipients, explicit agents, participant removal/leave, source deletion | New members do not inherit old shares. Observed group membership epochs invalidate old group shares. Actual Telegram membership completeness remains a release gate. |
| Change privacy choices | Versioned EN/FA notices, server receipts, equal optional decline, withdrawal and expiry | All optional purposes start off. Server-reviewed capability policy is required; a self-declared region or checkbox cannot approve a feature. This is not a finalized legal privacy policy. |
| Personalize replies | Explicit per-agent reply preferences with reset, scoped private/shared context, current-instruction precedence | Applying stored choices requires personalization consent and agent grant. The runtime does not learn unverified personal traits. |
| Keep prompts bounded | Post-authorization lexical ranking and deduplication; at most 12 whole saved-context records and 8192 serialized UTF-8 bytes | Whole records are skipped instead of truncated. This is a byte bound, not measured token efficiency or semantic-search quality. Storage aggregates are still loaded; indexed retrieval is future work. |
| Make quick semantic decisions | Authenticated text prediction endpoint; fixed question registry, typed Decisions adapter, current-policy receipts, cancellation, two evaluations per turn, 500 ms deadline, no retry and baseline fallback | It returns semantic evidence. It does not authorize sharing, identify people, send a message or generate the final reply. Early voice/image streaming and reply-flow integration remain open. |
| Observe permitted behavior | Durable content-free server turn statuses/durations, dedupe and consent checks; excludes QA/agent/system origins | Mini App voice response completion is the currently connected producer. Task success and cohort completeness remain unknown; full stage/failure/client instrumentation is pending. |
| Control notifications | Authenticated inbox, explicit requested reminders, category switches, chosen timezone, quiet hours, atomic cap across both spaces, useful/dismiss feedback | Reminders appear when due on inbox reads. No Telegram/email/SMS/push sender, recurring scheduler or marketing activation. |
| Improve safely | Pure evidence/projection helpers and a promotion gate requiring trusted independent evaluation and human release approval | No autonomous code modification or deployed observer/optimizer. Separate service credentials and protected execution environments remain required. |

## Memory structure and authority

The implementation separates four concerns: current ephemeral conversation input; explicit private/shared durable records; authorized bounded reply context; and content-free product observations. Policy metadata, consent receipts and deletion markers have their own role. Operational observations are not a second copy of conversation text.

Each person has independent Work and Personal choices. A selected-recipient container is independent of a Telegram group. A group container records the exact audience and observed membership epoch. Reads require current recipient/agent authority and applicable purpose permission; predictions never grant those rights. Voice or communication style cannot switch the active account or unlock another person's memory.

Private account documents and shared-container documents are separate from the administrator-readable Studio state. File storage uses private modes, a writer lock, fsync and atomic rename; the Firestore adapter uses transactions. An inaccessible or malformed store fails closed. These are bounded pilot stores: account JSON is capped at 700 KB and the current shared namespace at 650 KB/100 containers. Production partitioning, encryption/key/IAM qualification and load recovery remain open. A crashed file lock requires operator inspection before removal.

Shared creation stages unpublished content. No reader sees it until current authority is revalidated and real binding/capability expiry is checked inside the publication transaction. Failed publication erases staged text and records a replay marker. Deleting private or shared notes erases active payloads; tombstones and legacy source lineage stop retries from recreating them. Expiry is checked on access. Background retention sweeps, backup restore reconciliation and provider residual deletion have not been qualified.

Old unscoped Tireh history and automatic extraction are denied by the new Studio runtime. Existing authored legacy data is preserved for explicit migration; confirming a profile never silently imports it. Current core conversations remain usable with optional purposes declined. Ordinary speech transcription and speech generation remain distinct from biometric speaker recognition.

## Interfaces and configuration

- `/api/studio/adaptive`: own profile, consent presentation/changes, explicit private notes and per-agent grants.
- `/api/studio/shared`: preview, exact-audience container creation, contributions, source deletion, participant revocation and agent access.
- `/api/studio/experience`: explicit preferences, notification settings, inbox/reminders/feedback and text prediction.
- All three use signed Telegram authentication, approved account membership, bounded JSON mutations, same-origin checks, rate limits and non-cacheable responses. Development impersonation is not supported by these routes.
- `STUDIO_ADAPTIVE_POLICY_JSON` is a server-owned reviewed configuration manifest. Its parser is not legal approval. Missing approval keeps affected features unavailable; no genuine approval records were fabricated in this task.
- `STUDIO_DECISIONS_ENABLED=1` plus the configured OpenAI client enables the adapter construction. Endpoint eligibility, current grants and budgets still apply. No provider inference was performed for this delivery.

The installed OpenAI SDK remains 6.9.1. Its public `post('/decisions')` sends the documented request; mocked fetch verifies URL/body/deadline behavior. The provider uses `gpt-6-luna`. The [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and [create reference](https://developers.openai.com/api/reference/resources/decisions/methods/create) were checked during research/review. Live account compatibility, billed cost, regional processing, retention and performance are unverified. Details: [service libraries](../../src/lib/adaptive/decisions/README.md), [durable experience runtime](../../src/lib/adaptive/runtime/README.md).

## Team and independent verification

The [team package](TEAM.md) contains 11 project skills and 11 agent definitions. Complex implementation and independent privacy evaluation used `gpt-6.1-sol`; scripted browser QA uses `gpt-6-luna`. Role files are development instructions, not production security boundaries or background jobs.

The independent reviewer reproduced and tracked defects before accepting fixes: Personal prompts receiving Work directory data; permission/source changes during TTS; permission changes during awaited telemetry; contradictory observation copies; stale effective-permission UI; shared publication after author expiry; and stale Studio authority after deferred private loading. The original failing cases were retained. See [independent review](evidence/ADAPTIVE_REVIEW.md), [shared publication evidence](evidence/shared-memory/RESULT.md) and [legacy history/deletion evidence](evidence/history-enforcement/RESULT.md).

| Check | Final result | Evidence boundary |
|---|---|---|
| Independent composed regressions | **679/679 tests, 53 files** | Includes 21 independent security cases; synthetic storage/providers |
| Repository TypeScript | Passed, exit 0 | Run serially after the final build |
| Scoped ESLint | Passed, exit 0 | Adaptive, Tireh, Studio, UI and API paths |
| Optimized production build | Passed, exit 0 | Existing repository-wide lint warnings remain; no deploy |
| Compiled browser journey | Passed in mobile Chromium emulation, EN/FA | Intercepted synthetic APIs and inert Telegram script; screenshots/receipts in [browser evidence](evidence/browser/RESULT.md) |
| Plan and role validation | 56 tasks, 22 requirements, 11 TOML roles and 11 skills pass | Local definitions and graph/link validation |

Final source fingerprint: **`0a38ef7499456d7d0b0bf4f34c3aa1c103de9f94fbbbe1ca69724e2e9c3f8a53`** over 425 source/config files. The [delivery receipt](evidence/delivery/receipt.json) records build ID `uy8y8pGML_xPsXwQ_1FBf`; the [source manifest](evidence/delivery/source.sha256) identifies individual files. Hash method is in the independent review. Logs: [build](evidence/delivery/build.log), [TypeScript](evidence/delivery/tsc.log), [lint](evidence/delivery/lint.log).

Browser testing found a stale preference dropdown after a successful Reset. A failing unit reproduction was added before fixing it; the final browser flow verifies the displayed value returns to Balanced. An earlier development-server run failed before hydration with an unattributed SyntaxError; the compiled production artifact passed. [Diagnostic details](evidence/browser/DIAGNOSTIC.md) preserve the distinction. No change in permission criteria or test threshold was used to obtain a pass.
 Synthetic providers and browser-intercepted APIs are labelled separately. There is no physical device, real Telegram, provider, CI or deployed endpoint proof.

## Remaining gates and owners

| Gate | Next owner | Completion required |
|---|---|---|
| Identity and legal launch | Joyixir/privacy lead | Registered entity/address/contact; lawful purposes and controller/processor roles; applicable US states; approved notices, retention, provider agreements/transfers and account settings; complete user-rights/guest request routes |
| Production data boundaries | Architect/security/release | IAM/keys and separate worker credentials; distributed authority/transport reservation; live group roster freshness; backups/tombstone restore; scheduled expiry, partitioning, load/recovery and operational ownership |
| Fast predictive conversations | Voice/architecture/QA | Streaming transcript/image consumer, cancellation and safe prefetch integration; held-out EN/FA quality, cost and first-useful-response latency benchmarks |
| Automatic memory and learning | Architect/data/QA | Scoped extraction/consolidation and provenance, indexed retrieval, hypothesis evidence/expiry and correction; explicit migration reconciliation |
| External notifications | Data/release/QA | Durable scheduler/sender, final recipient checks, provider receipts, duplicate/unknown-send recovery, real Telegram/device proof |
| Voice recognition | Voice/privacy/QA | Provider selection, jurisdiction approval, explicit enrollment/deletion, known-candidate speaker hints, authenticated switching, error/spoof/device evaluation; stays disabled |
| Product self-improvement | Architect/evaluator/release | Actual isolated observer/developer/evaluator workers, minimized approved datasets, immutable artifact/evaluator receipts, controlled pilot and human release |
| Release qualification | QA/release/product | Exact artifact/CI, authorized staging pilot, physical-device/provider tests, rollback, measured outcomes and production verification |

Consent text cannot guarantee compliance. The legal and operational gates above remain real prerequisites for activation. The source candidate intentionally reports unavailable capabilities rather than presenting them as working features.

## خلاصهٔ فارسی

نسخهٔ محلی شامل جداسازی فضای کاری و شخصی، یادداشت خصوصی هر حساب، حافظهٔ مشترک برای افراد مشخص یا گروه، رضایت‌نامهٔ نسخه‌دار، دسترسی صریح عامل، تنظیم ترجیح پاسخ، صندوق اعلان و یادآور خصوصی است. متن رابط کاربری انگلیسی و فارسی دارد. زمینهٔ ذخیره‌شدهٔ هر پاسخ پس از بررسی دسترسی به حداکثر ۱۲ رکورد کامل و ۸۱۹۲ بایت محدود می‌شود.

مسیر متنی Decisions با بودجه و مهلت محدود پیاده‌سازی شده؛ اتصال پیش‌بینی زنده به جریان صوت/تصویر و اثبات افزایش سرعت هنوز انجام نشده است. یادگیری خودکار حافظه، شناسایی زیست‌سنجی صدا، ارسال اعلان بیرونی و عامل‌های خودکار تغییر نرم‌افزار فعال نیستند. سبک گفتار یا صدا هویت کاربر را احراز نمی‌کند و دسترسی به حافظهٔ دیگران نمی‌دهد.

تست‌های محلی و مرور مستقل، جایگزین آزمون سرویس واقعی، تلگرام، دستگاه فیزیکی یا استقرار نیستند. اطلاعات کامل حقوقی Joyixir، راه تماس حریم خصوصی، سیاست نگهداری و تأییدهای انتشار همچنان لازم‌اند. هیچ انتشار یا فعال‌سازی برای کاربران واقعی در این کار انجام نشده است.
