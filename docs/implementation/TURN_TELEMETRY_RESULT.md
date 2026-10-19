# Turn stages, returned usage and reported outcomes

Tasks: VOX-019/020. Author: Codex instrumentation worker. Worktree `vox-adaptive-runtime`, initial base `ee800d9`, uncommitted shared candidate. Local synthetic execution only; no paid provider calls, live user data, deployment or activation. Independent acceptance remains with the lead/evaluator.

## Delivered behavior

The existing optional product-analytics consent and exact account/person/space/agent authority govern the new measurements. `beginObservation.run` creates a bounded request-local collector only when initial observation authority exists. Server producers continue checking current Studio access and canonical consent at append. Withdrawal purges the journal and derived measurements in the same account transaction; stale in-flight receipts cannot recreate them. Disabled/missing telemetry never changes the returned answer or propagates observer errors.

The optional strict telemetry envelope permits at most 16 fixed-enum stage spans and 16 provider receipts per turn. It stores only stage, outcome, bounded duration, provider/model-family enums and nullable numeric token counters. It carries no transcripts, prompts, images, audio, URLs, names, arbitrary model identifiers, errors or provider response objects. Truncation is explicit. No broad telemetry sink or logging export is enabled.

Supported measurements:

- Actual authenticated text/image and private Telegram reply work executes inside a consented observation context. Tap-to-talk wraps STT, retrieval, generation and TTS. The live reply generator wraps each iterator operation, including early cancellation, so retrieval/generation usage belongs to that turn rather than a global collector.
- Anthropic non-streaming requests record their returned input/output/cache counters independently for each actual request, including explicit web continuations. Streaming retains cumulative reported counters once, rather than summing cumulative deltas. Early or incomplete streams are partial/unknown. Gemini records returned `usageMetadata` counters. Numeric zero is retained only when the provider actually returns zero.
- Both the bounded Decisions service and the existing Studio Decisions media adapter have stage hooks. Returned input tokens remain input-only; missing output tokens stay null. The prediction HTTP owner wraps its request/preparation with the observation context and marks it as `operation: prediction`; preparation does not increment completed conversation counts.
- OpenAI STT records usage only for a returned token-usage object. Unreported STT/TTS usage remains unavailable; audio duration or bytes never become estimated tokens or money. ElevenLabs speech callbacks measure elapsed processing with usage unavailable.
- Provider failures record unavailable usage for that attempt. Aggregates retain known token counters even when output is cancelled/discarded, show discarded counters separately, and mark incomplete usage. Billing cost remains null. No prices are guessed.
- Existing correlated browser playback outcomes remain client-unverified. An optional bounded duration reports request-to-playback from the supported tap-to-talk client; no browser timestamp can certify that a person heard audio.

Explicit outcome controls ask whether the response helped complete the task, with Yes/No/Not sure and EN/FA copy. The strict client event references a server-issued accepted turn in the same account/space/agent. It cannot submit server telemetry. Revised feedback replaces the previous same-event report. Own-space projections distinguish reported successes, failures and unknowns; verified task success remains null. Text chat returns an optional correlation only when observation recording succeeds. The voice UI owner integrates the same `TaskOutcome` component for supported tap-to-talk correlations.

The learning view displays stage sample counts/means, observed token totals, missing-usage status, reported task outcomes and client playback timing. Existing completeness fields remain conservative; the additive `projection.telemetry` and telemetry coverage identify the new data. Absent usage/timing stays null, including empty or older records.

## Compatibility and rollback

New code reads existing observer documents unchanged. New fields are optional and introduce no new top-level account document. The previous strict observer reader cannot read extended event/projection fields or the new task-report outcomes. This is explicitly not automatic binary rollback compatibility.

`pruneFileObserverTelemetry` in `src/lib/adaptive/observation/telemetry-rollback.ts` is an operator-only FILE-store utility. Dry-run requires an absolute directory and exact single account. Applying requires producers stopped and a matching document-content SHA-256, under the existing writer lock and atomic write. It removes new telemetry/operation metadata, prediction-only observation events and new task-report events; it clears derived projections for safe rebuild. It preserves authored memories, consent, grants, original response/playback events and evaluation budgets. It never scans accounts or prints private data. It does not remove other slices' new schema fields; a combined rollback must apply each required compatibility procedure. Firestore rollback tooling remains unsupported.

Tests load the actual `ee800d9` strict observer schema from Git in memory: the extended fixture is rejected and the explicitly cleaned fixture is accepted. Dry-run leaves bytes unchanged; missing stop acknowledgement and stale CAS reject apply.

## Local evidence

- Final expanded selection: **156 tests passed across 14 files**. Commands include `src/lib/adaptive/observation`, Studio media/learning/conversation integration, provider LLM tests, combined gateway boundaries, TaskOutcome, LearningPanel and ConversationPanel tests.
- A wider earlier selection including voice-call/options regression paths passed **143 tests across 13 files** before the additional media-receipt case.
- Scoped ESLint passed. The existing ConversationPanel cleanup-ref warning remains outside this slice's new behavior.
- Full `npx tsc --noEmit --pretty false` passed after concurrent reminder UI types settled.
- After the independent reviewer identified missing preparation timing, `gateway.prepareContext` gained the same request-local retrieval span. The focused retrieval and prediction HTTP selection passed **21 tests across 2 files**. The reviewer separately inspected provider/request preservation and returned-usage handling; final combined-candidate acceptance belongs to the lead.

Meaningful cases include concurrent collector isolation, disabled collection, hostile usage getters without answer changes, bounded overflow, actual zero versus missing values, cumulative stream usage, independent web continuation/failure receipts, exact returned STT/Decisions metadata, no private canary in receipts, prediction/response denominators, discarded-work counters, unknown task outcomes, signed own-space API correlation, client telemetry forgery rejection, cross-account/cross-space denial, opt-out purge and late-event suppression, EN/FA feedback and stale client response suppression, prior-schema rollback and CAS races.

## Coverage limits

This is source and deterministic local evidence, not real provider billing, throughput, efficacy or latency qualification. The full application has no verified task-commit oracle. Reports are user statements, not verified success. Model-family enums describe the adapter; exact returned model/build/language cohort attribution remains unavailable. Provider-managed live STT/TTS, live audio playback and unexposed vendor usage remain unsupported. Group-wide observation remains unimplemented because no individual consent grants a whole group export. No synthetic sample proves a measured improvement.

The current whole-account journal remains capped and can refuse new measurements at capacity; conversation delivery continues. Provider usage from a request that never returns is unknown, including a provider that ignores cancellation. No background timer, SDK retry, new optional processing flag or external export is enabled by this slice.

Coordinated source hooks have landed: the prediction owner added the HTTP observation scope and post-preparation snapshot; the voice owner added tap-to-talk outcome controls and bounded request-to-playback timing. Their author-owned UI/source tests remain separate from this worker's scoped evidence. Next owner: lead/evaluator for independent combined review. Production activation, provider/device checks and any new schema rollback remain explicit release tasks.


## Tested source identity

Uncommitted implementation on base `ee800d9`; these SHA-256 identities cover this author's core source at handoff. Shared integration files also carry other workers' changes and must be identified by the lead's final combined diff/revision.

Subsequent independently owned live-access and provider-configuration changes alter shared gateway/media files. The identities below record the instrumentation handoff, not the final shared candidate or deployed artifact. Reminder evidence and its single-process file-store qualification are recorded separately in [the runtime result](ADAPTIVE_RUNTIME_RESULT.md).

```text
6f473fa9e371e80472f81469e34fec047dc446fc793dfda15b1e5d76a5719d9b  src/lib/adaptive/observation/contracts.ts
80b477a24e18dec340ac244d6f1c27502ca599a55b10b66d94a116e8000fd8c4  src/lib/adaptive/observation/helpers.ts
f58774671d9e97b36211a458c3842be7754167f7c22b177abeb4e1d698741acd  src/lib/adaptive/observation/service.ts
ce18852fbf3d5d2f31ea0f8ed6f32ffb28b47c9c42c04dfa3616fe7e8e4916bf  src/lib/adaptive/observation/telemetry.ts
847aadc29f9b5568584dc5ad82669e2c9fb463182cb7e5c444b5c46d11beadd5  src/lib/adaptive/observation/trace.ts
8f9fe3bd266769b090b1027c9adb3e7c955823d347c5f4cb1496cd1ecf6f839f  src/lib/adaptive/observation/telemetry-rollback.ts
9587d1172f88f3ed4eb95f1f688561bd863a53490df0bbbcb25044272a419404  src/lib/tireh/llm.ts
dbc9c2a09d7759c296d36669c4233d02d671d75732c1ef7e7a78f2d4f2e45c38  src/lib/tireh/gateway.ts
9fd2a852ec40b7742920ccba09e9a8f7f26c836c7ffc53d3cb90ea696af54019  src/lib/studio/observation.ts
eeb26c7278a11775c402b794628294f365c4c871169023ce20e5f3c6a3522061  src/lib/studio/media.ts
d61b1e468f303f8a85e65e45c0be6f0a1b88f4c771eba0b8f699200878284ad6  src/app/studio/_components/TaskOutcome.tsx
```

## خلاصهٔ فارسی

اندازه‌گیری مراحل پاسخ و مصرف فقط با مجوز اختیاری تحلیل، در همان حساب، فرد، فضا و عامل انجام می‌شود. متن، تصویر، صدا، خطای خام یا شناسهٔ دلخواه مدل در این گزارش ثبت نمی‌شود. شمارنده فقط از پاسخ واقعی ارائه‌دهنده گرفته می‌شود؛ مقدار غایب و هزینهٔ صورت‌حساب ناموجود می‌ماند و صفر یا قیمت تخمینی جای آن نمی‌گیرد. پاسخ «بله/خیر/نامشخص» کاربر و زمان پخش مرورگر، گزارش تأییدنشده‌اند؛ موفقیت واقعی کار یا شنیدن صدا را اثبات نمی‌کنند. لغو مجوز، گزارش و محاسبات وابسته را پاک می‌کند و رخداد دیررس آن‌ها را برنمی‌گرداند.

شواهد نویسنده شامل ۱۵۶ آزمایش در ۱۴ فایل و پس از اصلاح زمان‌سنجی آماده‌سازی، ۲۱ آزمایش مرتبط در دو فایل است. این اعداد جایگزین بررسی مستقل نسخهٔ ترکیبی، اجرای واقعی ارائه‌دهنده، هزینه، دستگاه یا سنجش بهبود نیستند. بازگشت به خوانندهٔ سخت‌گیر قبلی به پاک‌سازی صریحِ همان حساب با توقف تولیدکننده و تطبیق هش نیاز دارد؛ بازیابی پشتیبان قدیمی روی حقوق جاری مجاز نیست. هش‌های بالا هویت منبع در زمان تحویل اندازه‌گیری‌اند؛ تغییرهای بعدی فایل‌های مشترک باید در نسخهٔ نهایی جداگانه ثبت شوند.
