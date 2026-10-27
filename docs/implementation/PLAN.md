# Vox adaptive agents: implementation plan

Prepared 19 October 2026 for Joyixir OÜ. Product scope: adults in the EU/EEA and US; English and Persian interfaces; Work and Personal spaces. The recorded RF1 release is `cf63acf64c6eadf5a2247d2436e0a22bc114386b` (20 October 2026); see the [historical receipt](RELEASE_RF1_2026_10_20.md). The prior learning-case release is documented in [its receipt](RELEASE_LEARNING_CASES_2026_10_20.md). RF1 was deployed with its optional policy off; VOX-056 remains open.

**Later runtime observation:** at 2026-10-20T13:33Z the existing Studio host served healthy `504203f0a798e780dc23e6eee5c51d89dcf5cdb3`, build `6QvxjYDllUGBSqlhTaxRG`, installed by another session. Its local validation, partial CI evidence and the installed step 0 scope are recorded in the [agent intelligence step 0 release receipt](RELEASE_INTELLIGENCE_STEP0_2026_10_20.md). This is a dated runtime observation, not qualification of every intervening source change or optional feature. RF2 [private-note erasure](RIGHTS_PRIVATE_NOTE_ERASURE.md) is being implemented and independently evaluated. **فارسی:** رسید RF1 تاریخی است؛ در ۲۰ اکتبر، ساعت ۱۳:۳۳ UTC، میزبان موجود نسخهٔ سالم `504203f` با ساخت `6QvxjYDllUGBSqlhTaxRG` را از نصب جلسه‌ای دیگر اجرا می‌کرد. این مشاهدهٔ زمان‌دار، پذیرش همهٔ تغییرات یا قابلیت‌های اختیاری نیست. پیاده‌سازی و ارزیابی مستقل حذف محدود یادداشت خصوصی RF2 ادامه دارد.

**Delivery status:** the observation/lifecycle/improvement work and the complementary scoped chat, image prediction, bounded retrieval and optional voice lifecycle are now integrated in the completion candidate. See [adaptive completion](ADAPTIVE_COMPLETION_RESULT.md) for implementation, independent review and precise release evidence. Existing source/release receipts remain historical. Optional capabilities stay off without reviewed configuration; provider/device/privacy qualification and the unfinished roadmap entries remain open.

**Product outcome.** Vox should understand the current task early, remember the right information for the right people, adapt the experience with visible user control, send useful timely notifications, and turn measured failures into tested product improvements. Success means more completed tasks and less rework, with bounded latency and cost and correct privacy boundaries.

| Read this | Purpose |
|---|---|
| [Durable assistant delivery control](../agents/AGENT_MEMORY_ASSISTANT_RUNTIME_CONTROL.md) | AM-05/AM-12: approved unwired FILE ledger, replay cutoffs, rights lifecycle and installed reader contract; qualification pending |
| [Assistant delivery protocol](../agents/AGENT_MEMORY_ASSISTANT_DELIVERY_PROTOCOL.md) | AM-05/AM-12: pure unused identity, exact-wire and outcome prerequisite; live integration and control retention deferred |
| [Snapshot publication](../agents/AGENT_MEMORY_SNAPSHOT_PUBLICATION.md) | PR 124 deployed as 6abf212; independently qualified bounded publication remains separately off, with existing horizons preserved |
| [Snapshot contract](../agents/AGENT_MEMORY_COMPACTION_CONTRACT.md) | Pure planner/codec/verifier prerequisite; no retention or horizon growth |
| [Selective source suppression](../agents/AGENT_MEMORY_SOURCE_LINEAGE.md) | AM-05/AM-12: PRs 115/116 deployed as 5b360b9 with capture off; source-lineage and edit-write recovery qualified within the documented scope |
| [Agent memory production program](../agents/AGENT_MEMORY_PRODUCTION_PROGRAM.md) | Authorized ongoing team implementation, independent acceptance, main merge and guarded deployment; first private Telegram archive slice |
| [Unified agent memory specification](../agents/AGENT_MEMORY_MASTER_SPEC.md) | Full agent product direction, 22 work packages, routing/preparation, KPI and improvement program |
| [T1 storage contract](../agents/TELEGRAM_STORAGE_DECISION_T1.md) | Telegram archive plus explicit service-side authority/pending/index state and recovery qualification |
| [Task backlog](BACKLOG.md) | Detailed tasks, dependencies, owners, reviewers and acceptance criteria |
| [Machine-readable backlog](BACKLOG.json) | Canonical task data for dispatch and progress tracking |
| [Architecture and Decisions contract](ARCHITECTURE.md) | Components, data contracts, prediction and notification behavior |
| [Privacy and consent](PRIVACY_AND_CONSENT.md) | Jurisdiction requirements, consent lifecycle, draft English/Persian copy and legal launch decisions |
| [QA and release](QA_AND_RELEASE.md) | Test matrix, independent evaluation, device proof and release gates |
| [Product team](TEAM.md) | Skills, agent definitions, model routing and handoffs |
| [Package validation](PACKAGE_VALIDATION.md) | Checks performed on the plan and skills, plus remaining runtime evidence boundaries |
| [Implementation start and decisions](STARTER_SLICE.md) | Active work, concrete decisions, metric contract and remaining foundation gaps |
| [Production release receipt](RELEASE_2026_10_19.md) | Exact develop/CI/build/deployment evidence and activation limits |
| [20 October release receipt](RELEASE_2026_10_20.md) | Retention, observation and presentation experiments; exact live revision and remaining gates |
| [Guest and evaluation release receipt](RELEASE_GUEST_EVALUATION_2026_10_20.md) | Public privacy fallback, signed evaluation protocol, trusted public origins and exact deployed evidence |
| [Recorded maintenance status](MAINTENANCE_HEALTH.md) | Read-only operator checkpoint progress, failure and lease evidence without enabling execution |
| [Maintenance status release receipt](RELEASE_MAINTENANCE_2026_10_20.md) | Independent and CI acceptance, exact deployed revision and preserved configuration |
| [Communication diagnostics](OBSERVATION_DIAGNOSTICS.md) | Next source slice, independent review and remaining observation scope |
| [Rendered experience and correction observation](OBSERVATION_COMPLETION.md) | Visible committed text, scoped correction feedback and current-state rollback |
| [Reviewed rights retention](RIGHTS_RETENTION.md) | Explicit reassessment, terminal purge, finite continuity and ledger compatibility |
| [Scoped local-use restrictions](RIGHTS_LOCAL_USE.md) | RF1 is deployed on the existing Studio host with optional policy off; source/browser/CI evidence and open activation/rights gates are recorded. The security audit has 14 findings and is not clean |
| [Private-note erasure / حذف یادداشت خصوصی](RIGHTS_PRIVATE_NOTE_ERASURE.md) | RF2 source review and 312 local synthetic checks passed; compiled/CI/release gates remain open / بازبینی منبع و ۳۱۲ آزمون محلی موفق؛ پذیرش برنامهٔ کامپایل‌شده، CI و انتشار باز است |
| [RF1 production release receipt](RELEASE_RF1_2026_10_20.md) | Exact deployed revision/build, unchanged production policy/configuration, route/bot probes and outstanding release gates |
| [Agent intelligence step 0 release receipt](RELEASE_INTELLIGENCE_STEP0_2026_10_20.md) | Step 0 security gaps and timers plus the committed boundary read; exact deployed revision, local and partial CI evidence, unchanged configuration |
| [Synthetic legacy inventory](LEGACY_INVENTORY.md) | Isolated LIP1 implementation and independent synthetic acceptance; no live inventory, import or restore |
| [Selected offline inventory / فهرست آفلاین منتخب](LEGACY_OFFLINE_INVENTORY.md) | LIA1 native file → bounded deny-all report; independent synthetic acceptance / فایل بومی تا گزارش محدود با استفادهٔ ممنوع؛ پذیرش مستقل ساختگی |
| [Reviewed synthetic learning cases](LEARNING_CASES.md) | Exact finding/review provenance, current-use authority, migration/capacity safety and independent local acceptance |
| [Protected evaluation protocol](EVALUATION_PROTOCOL.md) | Frozen synthetic splits, paired budgets, durable final-attempt reservation and signed promotion binding |
| [Controlled presentation experiments](CONTROLLED_EXPERIMENTS.md) | Private Studio consumption, consent lifecycle, isolated variants and kill semantics |
| [Adaptive runtime integration](ADAPTIVE_RUNTIME_RESULT.md) | Reminder delivery, stage and usage diagnostics, partial voice preparation and exact qualification limits |
| [Observation and lifecycle delivery](OBSERVATION_LEARNING.md) | Durable observer, scoped export, maintenance and local routing workflow; activation limits |
| [Integrated local delivery](DELIVERY_RESULT.md) | Historical local foundation, evidence and remaining gates |
| [First foundation result](FOUNDATION_RESULT.md) | Implemented code, independent acceptance, 480-test evidence and remaining integration |
| [Adaptive extension release compatibility](ADAPTIVE_EXTENSION_COMPATIBILITY.md) | Release admission reads persisted extension metadata next to the canonical markers |
| [Experience contract](EXPERIENCE_SPEC.md) | Design reference for the Privacy, Reminder and Voice recognition screens; walkthrough scripts |
| [Foundation contract v1](FOUNDATION_CONTRACT.md) | Historical pure-TypeScript contract for the adaptive module before persistence and endpoints |
| [Guest privacy request tracking / پیگیری درخواست مهمان](GUEST_RIGHTS_INTAKE.md) | VOX-056 GI1 integration candidate and its independent acceptance |
| [Indexed private memory](INDEXED_STORAGE.md) | FILE, SQLite and FILEv2 formats, migration, recovery and rollback tooling for VOX-013 |
| [Adaptive develop integration](INTEGRATION_RELEASE.md) | How develop was assembled from the foundation, Mac Studio and relationship lines |
| [Live voice access correction](LIVE_VOICE_ACCESS_FIX.md) | Access rechecks before signed live-call URLs and during streaming |
| [Atomic memory correction hotfix](MEMORY_REPLACEMENT_HOTFIX_RESULT.md) | Local source and synthetic evidence for the memory replacement fix |
| [Bounded memory retrieval](MEMORY_RETRIEVAL_RESULT.md) | Retrieval optimisation supporting the memory strategy; not legacy migration |
| [Explicit message memory / حافظه از پیام](MESSAGE_MEMORY_RESULT.md) | Reviewed message-memory slice of VOX-013 without automatic memory |
| [Model patch author / نویسندهٔ اصلاح کد](MODEL_PATCH_AUTHOR.md) | v2 model-authored software patches with their receipts |
| [Explicit personalization controls](PERSONALIZATION_CONTROLS_RESULT.md) | Work/Personal controls and the command-lock integration fix |
| [Read-only preview inventory / فهرست پیش‌نمایش](PREVIEW_INVENTORY.md) | Bounded Firebase preview channel inventory after quota failures |
| [Private saved note correction](PRIVATE_NOTE_CORRECTION_RESULT.md) | VOX-056 and VOX-013 note correction with compiled-browser qualification |
| [Personalization pause / مکث شخصی‌سازی](PRODUCT_PAUSE.md) | PR 74 pause control, source qualification and its remaining deployment gate |
| [Reviewed preference learning](REVIEWED_PREFERENCE_LEARNING_RESULT.md) | VOX-027 integration acceptance and resolved review findings |
| [Reviewed private memory / حافظهٔ خصوصی](REVIEWED_PRIVATE_MEMORY_RESULT.md) | Access restoration and authority revision evidence |
| [Retention acknowledgement / تأیید نگهداری](RIGHTS_ACKNOWLEDGEMENT.md) | Acknowledgement flow for retention outcomes |
| [Account privacy requests / درخواست حریم خصوصی](RIGHTS_INTAKE.md) | RI1 request intake, independent acceptance and later status clarifications |
| [Terminal inbox feedback / بازخورد صندوق](SCOPED_FEEDBACK_RESULT.md) | FB0 scoped useful/dismiss feedback for VOX-032 and VOX-036 |
| [Software patch workflow](SOFTWARE_PATCH_WORKFLOW.md) | v1 deterministic-author patch evaluation; v2 is the model author |
| [Prepared conversation qualification](SQLITE_CONVERSATION_QUALIFICATION.md) | Synthetic guarded-transport fixture for schema-2 SQLite and FILEv2 |
| [Turn telemetry](TURN_TELEMETRY_RESULT.md) | VOX-019 and VOX-020 stage, usage and outcome instrumentation evidence |
| [Scoped voice identity lifecycle](VOICE_IDENTITY_RESULT.md) | VOX-039 to VOX-041 author evidence for the optional voice identity service |
| [Voice provider decision](VOICE_PROVIDER_INTEGRATION.md) | Provider research and provisional transcript decision of 19 October 2026 |
| [Prior memory strategy](../AGENT_MEMORY_STRATEGY.md) and [research](../SELF_DEVELOPMENT_RESEARCH.md) | Research rationale and source findings |

**Agreed product decisions.** Work and Personal are separate spaces. Each contains private memory per person, group memory, and memory shared with an exact set of selected people independently of a chat group. Agent ownership never grants access to everyone's private memory. Prediction can prepare reversible work; permission checks remain deterministic. Voice recognition is optional and must not unlock private data. The user confirmed **Joyixir OÜ** as the registered operator name. The user confirmed **info@joyixir.com** as the privacy contact on 19 October 2026; mailbox operation and legal approval remain unverified. The [registered address is verified from the official Estonian register](OPERATOR_DETAILS.md); the complete notice still needs legal approval.

The system has three improvement loops: per-person adaptation, versioned agent optimization, and sandboxed software development. A common event contract connects them through purpose-specific data projections and separate credentials. It does not grant every worker access to all observations.

```mermaid
flowchart LR
    A[Consent and identity] --> B[Scoped events and memory]
    B --> C[Decisions and reversible prediction]
    C --> D[Personalized conversation and UX]
    C --> E[Notification candidates]
    E --> F[Policy and dispatch checks]
    B --> G[Read-only outcome observer]
    G --> H[Prompt or code candidate]
    H --> I[Independent evaluation]
    I --> J[Controlled release and rollback]
    J --> G
```

**Scope and sequencing.** Deliver a useful core while the biometric feature completes its separate legal/provider/security gates. Build in vertical slices, each including design, implementation, QA and evidence. Calendar estimates should follow baseline measurements and task sizing; the stage numbers below express dependencies, not guaranteed weeks.

| Stage | Deliverable | Exit evidence |
|---|---|---|
| P0 — define and design | Approved flows, event purposes, market matrix, provider constraints, baseline metrics | Product/design/privacy/QA contracts agree; unresolved launch facts have owners |
| P1 — establish boundaries | Person/space/container/grant model, consent ledger, scoped memory, deletion and migration | Cross-space/guest/revocation tests pass, no silent expansion of historical access |
| P2 — observe reliably | Durable events, turn traces, outcome capture and read-only observer | Replay, deduplication, completeness and export-minimization evidence |
| P3 — decide and personalize | Decisions adapter, bounded prediction, preference controls and UX variants | Held-out routing quality; stale decisions cancelled; clear reset/undo |
| P4 — notify usefully | In-app inbox, opted-in Telegram delivery, reminder scheduling and feedback | Revoke-before-send, duplicates, quiet hours and recipient privacy tests |
| P5 — recognize voice optionally | Enrolled speaker hints and confirmed profile switch | Jurisdiction clearance, measured voice errors and spoof tests, non-biometric fallback |
| P6 — improve the product | Reviewed learning cases, prompt candidates and tested code PRs | Evaluator independence, traceable evidence and controlled experiments |
| P7 — qualify and release | Actual device/provider E2E, staged rollout and operational ownership | Release packet distinguishes source, CI, deployment and observed behavior |

P0 design and source exploration run in parallel. P5 provider/legal work can run alongside P1–P4. Public voice recognition stays disabled until P5 qualifies; core release does not imply biometric clearance. Browser push is a follow-up channel behind capability detection and separate permission; the first notification delivery channels are an in-app inbox and an existing, explicitly opted-in Telegram conversation. No email/SMS or marketing campaigns are included in the initial release.

**User stories and requirements.** Every implementation task maps to these IDs. `Must` means required before the associated capability is enabled; it does not require biometric work before shipping the core.

| ID | Priority | Requirement and observable acceptance |
|---|---|---|
| REQ-01 | Must | A person can use core Vox while declining optional purposes. First use explains AI processing; separate opt-ins and receipts govern optional analytics, durable personalization, biometrics and proactive contact. Withdrawal stops future dependent processing. |
| REQ-02 | Must | A person can select Work/Personal and private/group/exact-recipient memory. Every read, write, summary, cache, extraction and tool output obeys space, audience, agent and purpose grants. New group members follow an explicit history policy. |
| REQ-03 | Must | Account, verified person, temporary speaker, statement subject and claimed identity are distinct. Ambiguous identity cannot write a guessed personal profile or unlock it. Authenticated switching establishes the active person. |
| REQ-04 | Must | Observations use server-validated versioned event envelopes, purpose-specific exports, deduplication and durable processing. Optional collection is denied before persistence/export when disabled. |
| REQ-05 | Must | Actions, model interpretations and verified outcomes remain separate. Reports show cohort, versions, QA exclusion, sampling and completeness; missing data never counts as success. |
| REQ-06 | Must | A server-side Decisions adapter uses typed results, validated question versions, deadlines, bounded retries, refusal/unknown handling, usage and model tracking. Service failure preserves a usable baseline conversation. |
| REQ-07 | Must | Early text/image/transcript predictions only prepare permitted retrieval or UI suggestions. Turn revision, context changes and revoked permission cancel work; predictions never create commitments, send messages or change sharing. |
| REQ-08 | Must | Explicit preferences take precedence over learned hypotheses. People can inspect why behavior changed, correct it, reset it and disable learning. Hypotheses have evidence, expiry, scope and limited effect. |
| REQ-09 | Must | UX presents active space, person and sharing audience; includes accessible consent, memory, preference and notification controls with EN/FA parity, RTL, keyboard and screen-reader coverage. |
| REQ-10 | Must | Notification candidates have a reason, evidence, expiry and recipient. Deterministic policy enforces category/channel permission, quiet hours, caps, deduplication and current relevance before queueing and sending. |
| REQ-11 | Must | External notification payloads contain generic text and an opaque reference, without private facts. Detailed content is rendered per recipient inside the authenticated inbox after current access checks; deep links recheck access. Provider acceptance, delivery and user action are distinct states. |
| REQ-12 | Must for voice | A verified adult can separately enroll, test, disable and delete voice recognition. No passive enrollment or cross-account search. Unknown/multiple/spoofed speakers follow a conservative fallback. |
| REQ-13 | Must for voice | Recognition only suggests a person within the explicitly permitted candidate set. Private access still requires authenticated confirmation. Voice cloning, diarization and emotion inference are separate capabilities; cloning and emotion inference are outside this work. |
| REQ-14 | Must | Improvement agents receive permitted evidence, propose versioned changes, and cannot modify the protected evaluator, promotion rules or production permissions. Model-graded success cannot override deterministic failures. |
| REQ-15 | Must | Runtime observers, personalizers, optimizers and release services have enforceably separate credentials. Development-agent role instructions are not treated as a security sandbox. |
| REQ-16 | Must | Latency, accuracy, cost and telemetry completeness have measured baselines and predeclared gates. Speculative work, event cardinality, model invocations and retries have budgets and kill switches. |
| REQ-17 | Must | Deletion/revocation covers source records, derived context, indexes, caches, queued jobs, evaluation exports and provider workflows where available. Tombstones prevent replay from recreating deleted information. Disclosed retention exceptions stay explicit. |
| REQ-18 | Must | Experiments have stable assignment and actual-exposure events. Shared-memory variants isolate the group/exact-recipient container; experimental writes cannot contaminate control or other recipients. |
| REQ-19 | Must | Migration quarantines ambiguous legacy identity/audience/purpose data, preserves user-authored content and provides reconciliation/rollback. No blanket grant or automatic enrollment is inferred from historical use. |
| REQ-20 | Must | Offline/reconnect, refusal, provider outage and permission-denied states remain usable. No repeated permission nagging or involuntary conversation interruption. A person can report an unwanted adaptation or notification. |
| REQ-21 | Must | A named release owner can disable each capability, investigate an incident, repair derived state and roll back a version. Live claims require exact deployed revision and target-specific evidence. |
| REQ-22 | Must | Legal notices, retention, subprocessors, transfers, account-specific data controls and jurisdiction availability match the actual system. Privacy review resolves launch dependencies; no consent banner is represented as a compliance guarantee. |

**Experience to design.** The initial design deliverable includes onboarding with equal optional accept/decline paths; a privacy center; a visible Work/Personal switch; active person and shared-account confirmation; memory audience controls; a “Why this?” explanation with undo; notification inbox/settings/snooze; optional voice enrollment and deletion; group disclosure/guest behavior; and degraded states. UI copy must describe user consequences rather than internal model names. Keep a clear distinction between an acknowledged privacy notice and a consent choice.

Example: a user says “Please keep voice answers short.” If personal learning is allowed, Vox records an explicit scoped preference and provides an undo. Repeated interruptions alone create only a temporary hypothesis. A relevant task deadline may generate a notification candidate, but dispatch still checks the user's notification choices, current memory rights and quiet hours. A recurring playback failure generates a sanitized issue for development, never a broad export of the user's conversation.

**Model allocation.** The requested development team uses `gpt-6.1-sol` for complex design, architecture, privacy/security, voice implementation, independent evaluation and release diagnosis. `gpt-6-luna` handles bounded event wiring after schemas are approved, scripted E2E execution and documentation/evidence formatting. Luna escalates ambiguous ownership, permissions, consent, schema changes and unexplained failures to Sol. Changing a model to save cost is measured against quality and risk, not task length alone. Official guidance describes Sol for demanding work and Luna for focused workloads. [Model catalog](https://developers.openai.com/api/docs/models).

For deployed Vox, use `gpt-6-luna` through Decisions for supported classification questions. Use normal response generation for replies and structured record creation; Sol can handle difficult tasks when authorized and justified by evaluation. Decisions is not the speaker-recognition engine or the permission system. Preserve the current provider baseline for comparisons during the rollout.

**Metrics and evaluation.** Establish a versioned baseline by language, channel, device and task. Primary measures are verified task completion, unnecessary corrections, appropriate memory use, end-of-speech to first useful audio, first useful text, and cost per successful task. Monitor unwanted notification reports, opt-out/undo, inaccurate personal attribution and collection without permission. Engagement duration and notification opens cannot be the sole optimization goal.

Provisional efficacy target: at least a 20% improvement in p95 useful-response latency at comparable task quality, or a predeclared task-success improvement at a bounded cost. Quality non-inferiority starts at a maximum two-percentage-point degradation with an appropriate confidence interval and subgroup checks; privacy and attribution failures are hard failures regardless of average quality. The QA plan defines denominators, evidence sizes, stopping rules and operational targets. These are proposed release criteria, not measured current results. Small samples keep the baseline in place.

**Launch decisions still needed.** Joyixir OÜ must finalize the remaining controller details (registered address verified in [operator details](OPERATOR_DETAILS.md)), applicable US state rollout, contractual role for Work spaces, biometric vendor and permitted jurisdictions, retention schedule, transfer/processor agreements, account-specific provider settings, and acceptable voice error bounds. Operation and notice approval for the user-confirmed privacy contact **info@joyixir.com** remain unverified. Product and engineering also need the pilot cohort, spend ceiling and supported device/channel list. The backlog assigns these decisions; they do not prevent design, synthetic-data development or ordinary code tests.

**Starting slice.** Execute VOX-001 through VOX-008 for release contracts, then dependency-ready tasks in VOX-009 through VOX-023 plus VOX-056 for permissions, consent, user rights and reliable observation. Prove one Studio voice turn with synthetic participants and one explicit preference before enabling predictive adaptation. The lead may parallelize non-conflicting tasks whose dependencies are satisfied; each task retains an independent reviewer and evidence packet. Public-facing capability activation follows its completed gate, not the existence of a role file or a passing mock test.

Runtime snapshot publication follows the reviewed [bounded contract](../agents/AGENT_MEMORY_SNAPSHOT_PUBLICATION.md); activation and full recall remain separate gates.

Release prerequisite for AM-05/AM-12: [Pet FILE admission contract](../agents/PET_STORAGE_ADMISSION_CONTRACT.md). Strictly recognize the existing deployed pet namespaces without changing data, rights or runtime behavior.

Next AM-05/AM-12 slice: [Owner Work-DM text integration](../agents/AGENT_MEMORY_ASSISTANT_TEXT_INTEGRATION.md). Freeze explicit scoped enrollment and actual nonretrying delivery before implementation, then qualify synthetic FILE/injected-HTTP paths independently. Production activation remains separate from a default-off code release.

ATI1 is installed at `f895ba59` with the feature off; main CI360 and indexed173 passed. The next AM-05/AM-12 increment is actual FILE process ownership and managed release handoff, with supported-writer inventory and independent contract review before implementation. Full physical erase/recreate and real activation remain separate.

Implementation contract: [FRO1 ownership](../agents/AGENT_MEMORY_FILE_RUNTIME_OWNERSHIP.md) and [supported writers](../agents/FILE_RUNTIME_WRITER_INVENTORY.md). Independently approved for source implementation only; no runtime or release proof follows from contract acceptance.

27 October successor: FRO1 was independently accepted and installed as `9e8752e8eb4b43fcce6303d5eb815c76618044a0`, build `ir5CCnTRa9K9N-PhiAgtQ`; main CI368 subsequently passed. The [production program](../agents/AGENT_MEMORY_PRODUCTION_PROGRAM.md) records the precise evidence and retained limitations. The next AM-05/AM-12 design slice is [ER1 canonical memory erasure and fresh reconstruction](../agents/AGENT_MEMORY_ERASURE_RECONSTRUCTION.md), with a [source-linked surface inventory](../agents/MEMORY_ERASURE_SURFACE_INVENTORY.md). This contract-only slice does not implement physical erasure, activate assistant delivery, or qualify whole-product deletion. Independent contract review precedes a separately assigned implementation through the actual manager, repository and runtime paths.

ER1 source successor: AM-ER1-ADMISSION-01 wires manager fresh-bootstrap, original work identity, canonical/context fences and reader admission under the [ER1 contract](../agents/AGENT_MEMORY_ERASURE_RECONSTRUCTION.md). Independent synthetic qualification precedes source acceptance. Qualified clock, actual managed first-marker migration, physical erasure and activation remain separate open gates; an unavailable production journey is not a live erasure feature.

The repaired ER1 candidate passed 97 focused and 193 affected regression cases in separate bounded runs. Initial failures and the outstanding protected-test nullability check remain retained; a narrow fixture successor precedes final source acceptance and hosted qualification. Production remains the separately accepted FRO1 release. Next activation prerequisite is an independently reviewed, actual managed first-marker migration/resume path and qualified clock, followed by physical erasure and cleanup; no administrative command or erase action is claimed here.

Later 27 October checkpoint: PR138 closed the bounded AM-ER1-ADMISSION-01 slice and was installed as `ae1236f4794dac65d1c62e5661885764437e493c`, build `VQF-zxo_FVZseGtLjYxN1`. Required PR/main checks passed; independent final acceptance covered 3,588 installed files, 24 capabilities, 40 routes and 160 reader cases/220 nonmutating calls. Earlier failures remain historical evidence. The [production program](../agents/AGENT_MEMORY_PRODUCTION_PROGRAM.md) records exact artifact and acceptance identities. New memory setup remains unavailable without qualified clock and marking; no physical erasure or activation is claimed.

The next bounded deliverable is AM-ER1-MANAGED-INIT-CONTRACT-01: independently review and freeze the [managed initialization and recovery contract](../agents/AGENT_MEMORY_MANAGED_INITIALIZATION.md) before changing runtime source. It must connect to actual stopped-process/FRO1/release paths, preserve current authority and healthy accounts, and define honest recovery from partial time/marker publication. Contract publication is separate from implementation, production marking, provider qualification and full recall. AM-05 and AM-12 remain in progress.

AM-ER1-MANAGED-INIT-CONTRACT-01 is complete for independently reviewed design publication only (MI1 contract SHA256`fd0edb349ef06981345c95d6038d3fac59c273054c5da794be6166662f53f96f`). Implement and independently qualify its actual managed operation/runtime consumers next. No first marker, migration, physical erasure or production activation follows from documentation approval.
