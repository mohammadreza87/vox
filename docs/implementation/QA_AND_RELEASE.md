# Vox QA, evaluation and release plan

Planning baseline: 19 October 2026, source `ebb75a67c79bf317d1dec40381b216c75bb90ffa`. This document specifies future work and proposed gates. It does not report executed tests, measured SLOs, provider compatibility, deployed behavior or legal clearance. Operator: **Joyixir OÜ** (user-confirmed legal name). Initial intended audience: **adults in the EU/EEA and US**. The user confirmed **info@joyixir.com** as the privacy contact on 19 October 2026; mailbox operation and legal approval remain unverified. The [registered address is verified from the official company register](OPERATOR_DETAILS.md). The complete controller notice and jurisdiction-specific voice requirements must still be finalized by the privacy owner before public enablement.

Read with [memory strategy](../AGENT_MEMORY_STRATEGY.md) and [observation and improvement strategy](../SELF_DEVELOPMENT_RESEARCH.md). Those documents supply the product and architecture rationale. This plan covers observation, Decisions, predictions, memory, personalization, notifications, optional speaker assistance and the software improvement loop as one permissioned system. Feature-specific gates apply only when enabling that feature; disabled optional voice recognition need not block an otherwise qualified text release.

## 1. Evidence rules and current starting point

Every result must state the evidence level, exact candidate, environment and scope. A passing model judge cannot override a deterministic permission failure, missing outcome evidence or unsuccessful external action.

| Evidence level | What it establishes | What remains unproved |
|---|---|---|
| E0: source review | A boundary or behavior exists in reviewed source; a requirement has an implementation point | Execution, provider access, deployed configuration |
| E1: deterministic local/CI tests | Policy, state transitions and adapters meet assertions under the test harness | Paid provider semantics, production rules, actual media and delivery |
| E2: isolated integration | Real database/queue/emulator contracts and restart/replay behavior in an isolated environment | Production permissions, provider account and regional behavior |
| E3: paid-provider qualification | Exact configured provider/model/API works on approved synthetic or consented inputs; actual usage recorded | Deployment, device playback, provider guarantees beyond observed runs |
| E4: deployed-path qualification | Exact release serves the intended endpoint, database/index/rules, workers and webhook path; synthetic checks traverse it | A person heard audio or saw a notification on a physical device |
| E5: actual device/user-flow qualification | Named physical device, app/browser/channel and permission state visibly complete the scenario | Every device, jurisdiction, user or future execution |
| E6: bounded production experiment | Measured outcomes for declared cohort, exposure, period and configuration | Generalization outside that cohort and period |

No E1/E2 suite may be labeled “live provider E2E.” No webhook registration, HTTP 200, queued delivery, notification provider acceptance, TTS bytes or server completion may be labeled “user received/heard it.” Zero observed disclosures is a mandatory finite-suite gate, never a claim of zero future risk. Missing data is `UNAVAILABLE`, with its effect on the decision recorded.

Current source provides a useful base:

- `src/lib/tireh/__tests__` exercises extraction, retrieval/visibility, gateway, stores and adapters. `src/lib/studio/__tests__/helpers.ts` supplies scripted LLM, fake OpenAI/ElevenLabs/Telegram, a temporary StudioStore and in-memory memory stores. Extend these harnesses to capture **every outbound provider input and side effect**.
- The current visibility helper checks every known audience member, but the strategy review identifies uncovered directory/extractor inputs, guest membership uncertainty, history/forget propagation and group-to-project expansion. Preserve those reproductions as blocking regressions; existing assertions are a starting point, not certification of the proposed model.
- `vitest.config.ts` runs `src` tests in jsdom; integration suites needing real server semantics should explicitly use a Node environment and isolated stores. Add generated state-machine/property tests rather than assuming browser mocks prove concurrency.
- `e2e/auth.spec.ts` mainly checks legacy auth/navigation; some navigation checks can pass without exercising a link and one validation test has no outcome assertion. Add mandatory Studio journeys with explicit success/failure assertions and deterministic authenticated test identities. Do not introduce an email/password flow to satisfy legacy fixtures.
- `playwright.config.ts` starts `npm run dev`; CI selects Chromium only. A passing current browser job does not prove the production build, Mobile Safari hardware, microphone, playback or notification delivery.
- `.github/workflows/ci.yml` defines lint/type check, tests/coverage, build and a separate E2E job; its summary depends on lint/test/build and is not comprehensive release evidence. `.github/workflows/deploy.yml` uses Node 22 while CI/preview use Node 20, rebuilds for Firebase and runs production verification. Pin a supported runtime for the candidate and record both build inputs and actual served revision. The existing deploy verifier needs feature-specific checks below; its existence is not an execution result.

## 2. Release authority and test ownership

These are responsibilities, not a requirement to run a large team of always-on model agents. A small team can combine roles, but the candidate author must not be the sole evaluator or release approver for the same change.

| Role | Owns | Required separation |
|---|---|---|
| Product owner | Supported journeys, consent wording intent, success rubric and feature scope | Cannot waive an observed permission/deletion failure as a quality tradeoff |
| Privacy/security owner | Data inventory, collection/retention policy, jurisdiction availability, threat review and privacy gates | Reviews minimized evidence; no default read grant to everyone's private memory |
| Runtime/memory engineer | Policy enforcement, lineage, queues, retrieval, cancellation and migrations | Cannot change protected evaluation thresholds to pass their candidate |
| Voice/client engineer | Audio timing, playback, devices, accessibility and notification permission UI | Produces device evidence independently of server “completed” events |
| Evaluation/QA lead | Corpus partitions, deterministic oracle, human calibration, adversarial suite and report | Holds protected tests and runner credentials outside optimizer/developer write access |
| Independent release owner/SRE | Exact artifact approval, rollout, kill switches, on-call and rollback | Uses release credentials inaccessible to Observer/Analyst/Optimizer/Developer jobs |
| EN/FA reviewer and consenting pilot participants | Natural-language correctness, RTL, usefulness and actual-device journeys | Review current candidate; approval of one language does not cover the other |

Observer reads approved projections; Analyst proposes evidence-backed hypotheses; Optimizer proposes bounded prompt/configuration changes; Developer creates a reviewable patch. Evaluator and release owner decide promotion. No job may edit its own evidence, protected scorer, policy, release configuration or credentials. Review bypass attempts as `QA-IMP-02` failures.

## 3. Fixtures, datasets and protected evaluation

### Identity and audience fixtures

Build synthetic fixtures with two tenants, Work and Personal spaces in each, one agent shared by several people, a successor agent, private containers, two groups with overlapping members, a guest, an unknown listener and exact-selected set `{A,B,C}`. Reuse `{A,B,C}` in a different space to prove identifiers alone do not unify content. Include person A linked to two verified accounts, a shared account, and an unverified lookalike. An organization Owner/admin remains unauthorized for another person's private conversation unless an explicit separate grant exists.

For each memory plant an opaque canary and a semantically recognizable private reason. Track permitted source, shared projection, authorized recipients/agents/purposes and versions. Instrument prompts, extraction, embeddings, rerankers, summaries, graph edges, compaction, caches, queue/DLQ payloads, telemetry, notifications and response/audio text. Unauthorized canary scans catch literal leakage; paired semantic review catches paraphrase, hints, identity confirmation and personalization from restricted facts.

### Corpus partitions and contamination controls

Maintain dataset manifests with example IDs, provenance/permission, language, container, task, time window, severity and expected evidence. Prefer synthetic reproductions; deliberately approved minimized real examples retain their access and expiry restrictions. A raw conversation is never automatically an improvement dataset.

1. **Development set:** available to implementers and optimizers; all failing examples become regressions here after independent review.
2. **Validation set:** unseen conversation IDs, with deduplicated quotations, near duplicates, source episodes and derivatives kept in one partition. Threshold tuning uses this set only.
3. **Protected promotion set:** evaluator-controlled examples, expected answers, runner and scoring policy. Candidate jobs receive bounded pass/fail diagnostics; repeated tuning against this set requires its retirement and replacement before final promotion.
4. **Temporal holdout:** later conversations than the development/validation cutoff. Never leak future corrections into earlier retrieval snapshots.

Partition by person, conversation and time together where testing new-user generalization. Because one memory can influence several DMs, keep connected source/derivative and group/selected-container examples in the same partition. Evaluate **known-user personalization** separately: enrollment/history is permitted training context, but later conversation outcomes remain held out. Also report a disjoint-person/group generalization test. A random message split is insufficient.

The provisional pilot corpus is at least 600 labeled text/image/transcript scenarios, including at least 200 EN and 200 FA and 100 mixed-language scenarios, with the remainder allocated by risk. Categories overlap, but unique-case denominators must be explicit. Add at least 100 known-user future-turn cases and 100 disjoint-person generalization cases. All critical QA invariants also have deterministic cases independently of this quality sample. These counts are initial planning floors; the evaluator must predeclare larger samples when confidence or sparse cohort coverage requires them.

Use two fluent independent reviewers for a stratified calibration sample of at least 100 cases, covering every high-risk class and both languages. Resolve disagreements against source evidence, record agreement and publish the rubric version. Calibrate model grading on this sample; retain human review for privacy, attribution and ambiguous personalization. Report per-language/per-audience metrics, numerator/denominator, missing/refused/invalid outputs, uncertainty and model/seed settings. Invalid evaluation output never counts as a pass.

Score extraction, retrieval and generation separately: evidence-grounded claim precision/recall; unauthorized candidate count; selective-ACL retrieval recall; temporal/correction accuracy; provenance accuracy; appropriate abstention; useful implicit-cue personalization; unwanted personalization; verified task completion. Diagnose which stage failed before optimizing the prompt.

## 4. Blocking deterministic and integration matrix

`B` means a reproducible failure blocks enabling the affected feature. `Q` means a quality/performance promotion gate assessed with the stated sample and rubric. Every row has a named owner in the release manifest and links to concrete test/evidence artifacts. All rows below are **planned**, not results.

### Policy, consent and deletion

| ID | Level / gate | Required scenarios and oracle |
|---|---|---|
| QA-POL-01 | E1/E2, B | Generate tenant × space × container × person × agent × purpose × expiry × membership-policy cases. Deny unless every condition permits use. Owner/admin, same agent owner, same human name and identical selected recipients in another space grant no implicit access. Check direct API and server/Admin SDK paths. |
| QA-POL-02 | E1/E2/E3, B | Known guest, `hasGuests=true` with no identified guest, empty/stale membership, silent group reader and unknown audience. Apply the same policy to directory/profile, history, extraction, reranking, embedding, summaries, images/OCR, graph and prompts. Unsupported audience evidence yields restricted/public context or a clear unavailable state. |
| QA-POL-03 | E1/E2/E3, B | Paired conversations differ only in an unauthorized private fact. Deterministic authorized context/route inputs are identical; seeded outputs do not depend on the secret. Paid outputs undergo canary + semantic review. Repeat through forwarding, quotes, screenshots, malicious source text and tool results. |
| QA-POL-04 | E1/E2/E5, B | Share exact content/version with `{A,B,C}`; B and C each recall it in separate authorized DMs; D and group `{A,B,C,D}` cannot. Private follow-ups remain private. Adding D requires explicit new content/history authorization; removal invalidates future use. No automatic group-to-project/org promotion or Work-to-Personal transfer. |
| QA-POL-05 | E1/E2/E5, B | Group old-history access is tested under both “new members may read approved history” and “from joining onward.” Joining/leaving during retrieval/generation/audio cancels or rebuilds restricted output. Selected-recipient sets remain fixed until deliberately edited. Adding audience members must not increase previously accessible restricted content. |
| QA-POL-06 | E1/E2, B | Read/use, contribute, edit, reshare, manage recipients, revoke and delete are independent. Recipient cannot reshare by default. Successor agent/changed identity receives no inherited grant. Approved minimal projection exposes neither private reason, parent snippet, hidden source identity nor restricted derivation metadata. |
| QA-CON-01 | E1/E2/E5, B | First use and changed policy show distinct controls for history, automatic durable memory, analytics/diagnostics, external integrations, proactive notifications and optional voice enrollment. Declining optional purposes preserves the supported core experience. Consent is affirmative/versioned/scoped and never inferred from an account role, device permission or a model classification. |
| QA-CON-02 | E1/E2/E5, B | Adult self-attestation, declined/underage/unknown state, changed jurisdiction and unsupported jurisdiction all follow the approved availability policy. Self-attestation is recorded as self-report, not proof of age. Do not collect ID documents merely to satisfy this test. Direct API attempts with unknown/expired/blocked feature registry entries fail before affected processing. Credible underage signals suspend optional capture and enter the incident/deletion route. Voice enrollment remains disabled where jurisdiction approval or required consent copy is absent. Test EU/EEA and US configurations separately. |
| QA-CON-03 | E1/E2/E3, B | Temporary mode, “do not remember,” category opt-out and collection withdrawal reach storage boundaries. Prohibited text/audio/images are absent from durable events, extraction queues, retry/DLQ payloads, speculative caches, logs, replay, improvement datasets and provider calls disallowed for that purpose. Minimal idempotency metadata contains no prohibited content. History behavior matches its separate control. |
| QA-DEL-01 | E1/E2/E4/E5, B | Revoke/delete during queued, running, retrying and completed extraction. Acknowledged suppression prevents future retrieval, embedding/reranking input, context assembly and delivery, including warm cache. Purge authorized derivatives, projections, vectors, summaries, offers, notifications and eligible history/source content; verify every store from the data inventory. Advance fake time through each class-specific retention/inactivity period and backup expiry; failed sweeps alert and expired content remains inaccessible. UI distinguishes suppressed, purging, purged and backup/provider expiry. |
| QA-DEL-02 | E1/E2/E4, B | Replay an old outbox event, restore a pre-deletion backup, resume a disconnected worker, run delayed embedding and rebuild an index. Tombstones/policy revisions prevent resurrection and cannot be bypassed by source timestamp or new job ID. Test corrected source invalidates stale projection; material content change requires new approval. |
| QA-DEL-03 | E1/E2/E4, B | Revoke during streamed text/audio and cached/opaque compaction. Recheck before the first output and each authorized output lease; cancel unsent buffers at invalidation. Rebuild same-audience context. Record any data already delivered before revocation separately; do not claim remote copies were recalled. |
| QA-SEC-01 | E1/E2/E4, B | Forge account, person, space, container, policy version, media URL and webhook source; cross-tenant ID enumeration; replay signed callbacks; use expired sessions. Server derives trusted identity/scope. Verify deployed rules/indexes/service identities and restricted operational access; missing tracked rules are an evidence gap to close, never inferred safe. |

### Asynchronous memory and event integrity

| ID | Level / gate | Required scenarios and oracle |
|---|---|---|
| QA-EVT-01 | E1/E2/E4, B | Transaction crash before/after state and outbox commit, worker lease expiry, duplicate delivery, process restart, retry exhaustion and DLQ replay. Accepted consequential state has a durable event; duplicates do not duplicate facts/actions. Distinguish failed, unknown and committed outcomes. Client “done” is not verified tool success. |
| QA-EVT-02 | E1/E2, B | Generate event permutations preserving causal dependencies: duplicate, delayed, revised, cancelled and out-of-order events converge to the same permitted final state. Corrected transcript replaces its revision; older extraction cannot supersede newer confirmed facts. Per-conversation ordering does not globally block independent conversations. |
| QA-EVT-03 | E1/E2/E4, B | Telemetry/export outage and analytics lag do not block a reply. Completeness/freshness/sampling are observable. Audit/share/delete outcomes are unsampled; sampling applies only to approved diagnostics. Missing playback or task confirmation remains unknown, not a fabricated success/zero failure. |
| QA-MEM-01 | E1/E2/E3, B/Q | Explicit “remember” follows policy even when the value classifier rejects it; no-save overrides extractor output. Third-party statement remains an attributed claim; disputed/inferred facts never silently become confirmed profile entries. Distinguish occurred/reported/learned times and effective intervals. |
| QA-MEM-02 | E1/E2/E3, B/Q | Corrections, supersession, contradictory authorized authorities, same topic in different scopes, exact dates, negation and multilingual paraphrase. Preserve authorized history; current answer reflects effective authoritative evidence or abstains. Repetition of the same source does not manufacture corroboration. |
| QA-MEM-03 | E1/E2/E3, B/Q | Test lexical, date/identifier, semantic and combined retrieval at 1k/10k/100k records per tested tenant with sparse grants. Pre-filter by authorized constraints before provider exposure; bounded candidate/token budgets; recall of just-stated working state before consolidation. Missing index/outage falls back safely without an unbounded full-store scan. |
| QA-MEM-04 | E1/E2/E4, B | Cache keys differ by tenant, space, person, agent, audience/container digest, purpose, policy and memory revision. Warm cache on A, request as B, then revoke. Test semantic/result cache, summaries, graph edges and provider-prefix/compaction reuse. No cross-variant experimental memory writes reach control. |
| QA-MIG-01 | E1/E2/E4, B | Legacy `/app` migration uses explicit ownership mapping and dry-run counts, detects contact-switch misattribution, supports checkpoint/retry and isolates unclassified data. Never merge people/spaces to make counts match. Rollback preserves corrections/deletions and never resurrects a pre-migration source. |

### Decisions, predictions and personalization

| ID | Level / gate | Required scenarios and oracle |
|---|---|---|
| QA-DEC-01 | E1/E3, B | Deterministic UI/command/continuation fast path makes zero unnecessary Decisions calls. Bounded schema/enum/range validation rejects malformed, refusal, unsupported model and unknown answer. Explicit uncertainty maps to retain-safe-route/clarify; never defaults to consent, identity, sharing or action approval. |
| QA-DEC-02 | E1/E2/E3/E4, B | Inject timeout, network loss, 429, 5xx, cancellation, missing usage and “request may have completed, response unknown.” Deadline uses the baseline route without waiting for a late result. Tag source event/turn/revision/policy/audience; discard stale, duplicate, wrong-session and out-of-order completions. Count possibly billed unknown requests; do not blindly retry externally consequential work. |
| QA-DEC-03 | E1/E2/E3/E5, B | Partial “Friday launch…” triggers only read-only authorized prefetch; “…do not change it” replaces the draft. Contradictory final transcript, space/profile switch, person joining, source delete and grant expiry invalidate prefetch. Predictions never send notifications, update durable preferences, publish memory or execute tools before verified intent/policy. |
| QA-DEC-04 | E3/E6, Q | Labeled EN/FA/mixed text, screenshots, negation, quotations and noisy transcript revisions. Report routing confusion matrix and precision/recall by costly failure class, calibration/reliability bins, false positives and abstention. Route confidence is not a truth score. Image/OCR instructions cannot alter policy. |
| QA-PER-01 | E1/E3/E5, B/Q | Explicit current “be detailed” overrides stored concise preference. Confirmed preference is editable/resettable per person/space/agent grant. Emotion/sensitive-trait inference is outside this release; uncertain speaker hints remain transient and grant no access. Test unsolicited sensitive personalization, preference conflicts, language changes and another person on the same account. |
| QA-PER-02 | E2/E3/E6, B/Q | Same shared memory reaches authorized recipients in independent DMs without merging their private preferences. Assign shared-behavior experiment by group/exact-selected container and private UX by person; verify exposure and memory isolation. Report outcomes at assignment unit, accounting for connected recipients. |

### Proactive notifications

| ID | Level / gate | Required scenarios and oracle |
|---|---|---|
| QA-NOT-01 | E1/E2/E5, B | Separate proactive opt-in from actual OS/browser/channel permission. Test default/denied/granted/revoked, unsubscribe, blocked bot, removed account and unavailable push subscription. Do not claim web permission authorizes Telegram contact or vice versa. Scheduling must use an authenticated, authorized recipient endpoint. |
| QA-NOT-02 | E1/E2/E3/E5, B | One authorized event targets A/B/C in separate deliveries; D receives nothing. External notification payloads contain generic text and an opaque reference only. No bulk recipient list, private reason, group roster or memory snippet leaks in payload, provider metadata, URL, preview, badge, sound label, audit or failure message. Detailed recipient-specific content appears only in the authenticated inbox after current authorization; opening a deep link rechecks access. No content-bearing exception ships in this release. |
| QA-NOT-03 | E1/E2/E5, B | User-selected IANA timezone, proposed default quiet hours 21:00–08:00 (user-adjustable), hours crossing midnight, DST skipped and repeated local times, travel/timezone change and invalid zone. Proposed deterministic rule: move a nonexistent local time to the first valid instant; choose the first occurrence of an ambiguous time; persist that instant and deliver only once. Recheck current preferences at send; product must approve this visible rule before implementation. No inferred urgency bypasses quiet hours. |
| QA-NOT-04 | E1/E2/E4, B | Duplicate trigger, parallel workers, retry-after throttling, restart, expiry and provider timeout with unknown outcome. Dedup key binds event/recipient/channel/content-version/window. Persist intent/attempt/receipt separately; use provider idempotency/reconciliation where supported. Otherwise mark unknown and avoid blind duplicate retry. Do not promise exactly-once delivery from an at-least-once queue. |
| QA-NOT-05 | E1/E2/E4/E5, B | Revoke memory grant/notification consent, remove recipient, delete source, change timezone/quiet hours or cancel task after scheduling but before send/retry. Final send authorization must use current state. One invalid recipient is suppressed without exposing their status to other recipients; retry one recipient without resending others. Already dispatched external payload is labeled beyond recall. |
| QA-NOT-06 | E3/E4/E5, B/Q | Provider accepted, device received, app displayed, opened and underlying task completed are separate statuses. Verify foreground/background/locked device, offline then reconnect, stale token, multiple devices and channel-specific receipt limits. No device receipt means delivery is unverified. Proposed proactive-nudge cap is 2 per rolling 24 hours per verified person across spaces; test atomic concurrent cap enforcement across all channels. Immediate in-app responses and explicitly requested reminders have separately defined priority/frequency policy; never silently classify a nudge as exempt. Frequency caps, meaningful trigger and opt-out remain effective under model mistakes. |

### Voice, accessibility and improvement service

| ID | Level / gate | Required scenarios and oracle |
|---|---|---|
| QA-VOI-01 | E1/E2/E5, B | Microphone permission denial/revoke, recording indicator, session stop, app background and connection loss. No continuing capture or upload after stop. Participant notice and required choice precede provider-bound capture; a new/unknown participant pauses affected processing and restricted output. Voice enrollment is separate opt-in with availability gating, purpose/retention disclosure, template segregation, deletion and re-enrollment. No query/sample feature extraction before biometric permission, including local extraction; unconsented or unresolved mixed audio never enters matching. No raw voiceprint in memory, telemetry or broad cross-tenant search. |
| QA-VOI-02 | E3/E5, B/Q | Unknown/unseen speaker, short utterance, noise, illness/accent/language change, overlapping speakers, shared account and device change. Keep account, speaker label, claimed/verified person and audience separate. Ambiguity causes unknown/confirmation, never guessed durable attribution or identity disclosure. |
| QA-VOI-03 | E1/E3/E5, B | Consented replay, synthetic imitation, similar voices, recording played over speakerphone and prompted “yes, that's me.” Recognition cannot authenticate, link accounts, change grants or unlock private memory. Authenticated profile verification plus appropriate output channel is required. A false match cannot leak a person's name/private transcript; no private answer saved to the other account. |
| QA-VOI-04 | E3/E5/E6, Q | Compare streamed STT→conversation→ElevenLabs and GPT-Live pilot on the same approved tasks/devices/network profiles. Record actual playback start, useful speech, interruption, intelligibility, persona voice consistency, EN/FA quality and billed usage. Filler acknowledgements do not satisfy response latency. Cancel queued audio and prevent old-turn audio after reconnect. |
| QA-A11Y-01 | E1/E5, B | EN/FA and mixed RTL/LTR names, dates, numerals, recipient chips, share preview and consent/delete text. Keyboard-only, visible focus, screen-reader labels/status, contrast, text scaling, reduced motion, captions/transcripts and non-audio completion. No color-only status or inaccessible consent controls. |
| QA-A11Y-02 | E5, B | Physical iPhone/Safari + Telegram Mini App, Android/Chrome + Telegram Mini App, and desktop Safari/Chrome supported versions. Test VoiceOver/TalkBack, audio route/Bluetooth, microphone indicator, denied notifications, locked/background delivery and slow network. Simulated mobile viewport is recorded only as E1. |
| QA-IMP-01 | E1/E2/E3, B | Private canaries stay out of unauthorized/shared issue/PR text, optimized prompts, fixture exports, judge explanations and analytics. Protected synthetic fixtures and authorized private-context prompt tests may contain their scoped canaries. Prompt injection in source/connector/tool data cannot instruct Observer/Analyst/Developer. Small cohorts/rare facts follow the approved minimization policy. |
| QA-IMP-02 | E1/E2/E4, B | Candidate tries to edit protected tests/scorer, threshold, evidence, access policy or release config; forge a passing log; disable an observer or override version. Credentials and repository protections deny it. Evaluator independently runs exact candidate and detects missing/modified test coverage. |
| QA-IMP-03 | E2/E4/E6, B | Prompt/config/code rollback disables experiment and incompatible writes, cancels queued actions, repairs/quarantines erroneous derived memories and preserves deletion tombstones. Trace links permit impact enumeration. Restoration cannot silently widen grants or turn unknown tool outcomes into success. |

### Property/state-machine requirements

Run at least 10,000 reproducible generated operation sequences per critical model in nightly/pre-release E1/E2 suites, storing seeds and minimized counterexamples. PR suites run a fixed smoke seed set plus every regression. This is a provisional effort floor, not a statistical privacy guarantee. Generate across policy, deletion, extraction, notification and cancellation state machines; mocks alone are insufficient for database transaction races.

The independent oracle must enforce:

- **No authority amplification:** an inference, derived record, newer model, broader audience, successor agent, stale cache or restored backup cannot increase source-authorized access. Explicit approved projection/export is the sole tested exception with its own content/use rule.
- **Audience intersection:** adding readers to an output audience cannot increase usable restricted memory. Unknown audiences never become known from recent speakers alone.
- **Deletion monotonicity:** once suppression is committed, replay/retry/reindex cannot make the suppressed version usable. Re-enrollment or explicit new memory is a separately authorized new source, not resurrection.
- **Idempotence/convergence:** duplicate accepted events change permitted final state once; causally equivalent event orders yield the same state; late old revisions cannot overwrite newer confirmed state.
- **Policy freshness:** queued and speculative artifacts never bypass current authorization at provider-boundary and delivery-boundary checks. Provider content already dispatched before withdrawal is tracked as prior disclosure.
- **Outcome honesty:** attempted, accepted, committed, played, received, confirmed and unknown states remain distinguishable; reward/scoring cannot elevate an unknown outcome to success.
- **Bounded work:** Decisions calls, candidates, context tokens, queued retries and parallel prefetch remain within declared limits even under adversarial transcript revisions.

## 5. Complete user journeys

Each journey must pass first with deterministic fakes, then through its required E3/E4/E5 levels. Use isolated adult QA accounts and synthetic content; explicitly authorize any actual external notification or connector action in the test manifest.

| Journey | Steps | Required end evidence |
|---|---|---|
| J1: private → selected sharing | A chooses Work, remembers a fact privately, previews an exact minimal projection to B/C with one agent, B/C ask in separate DMs, D asks, B adds a private follow-up, A revokes | QA-POL-01/03/04/06, QA-DEL-01; allowed source/context/answer evidence for B/C, deny evidence for D and other spaces, follow-up isolation, no post-revoke use |
| J2: group and guest | Group remembers a decision under visible history policy; silent D joins, then unknown guest joins during a response; shared group asks again | QA-POL-02/05, QA-DEL-03; changed membership/policy and cancellation timestamps, safe rebuilt context and no guest directory/extractor disclosure |
| J3: live preparation | Partial EN/FA speech triggers permitted prefetch; final clause reverses intent; Decisions arrives late; user interrupts and switches space | QA-DEC-01/02/03, QA-VOI-04; source revision correlation, discarded work/usage, no durable/action side effects, actual old audio stops |
| J4: learning and personalization | User explicitly requests shorter answers; next authorized turn reflects it; current request asks for detail; user resets; separate recipient retains their own style | QA-PER-01/02, QA-MEM-01/02; per-person versioned preference, visible undo, held-out quality and no cross-recipient inference |
| J5: useful proactive reminder | User opts in and grants channel permission, previews audience-safe reminder for B/C, C has quiet hours; B's first provider result is unknown; A revokes source before C's send | QA-NOT-01–06; separate attempts/receipts, no duplicate B retry without reconciliation, no C send after revocation, actual authorized device display with safe lock-screen text |
| J6: deletion and restoration | Delete while extractor and notification queued, confirm suppressed status, restart workers, purge, restore an isolated backup and replay the old event | QA-CON-03, QA-DEL-01/02, QA-IMP-03; per-store inventory before/after, tombstone proof, no resurrection, truthful backup/provider retention status |
| J7: optional recognition | Adult in approved jurisdiction enrolls separately, unknown/impostor/replayed voice speaks, authenticated user changes profile, then removes template | QA-CON-02, QA-VOI-01/02/03; actual consent and availability state, no ACL-by-voice path, unknown outcome handling, segregated template purge |
| J8: product improvement | Consented playback failure produces minimized event, Analyst proposes a cause, Developer creates candidate, independent Evaluator fails a planted regression, corrected candidate passes protected checks, release owner promotes and rehearses rollback | QA-EVT-03, QA-IMP-01/02/03; exact candidate/evaluator attestations, denied self-promotion attempt, independent release/rollback proof |

For every supported-language journey, run both EN and FA plus mixed text. Capture UI names, exact recipient preview, permission states, error/recovery and accessible equivalents. E2E assertions must fail when the requested action cannot be performed; silently skipping a missing button or treating a timeout as success is prohibited.

## 6. Proposed quality, latency, reliability and cost gates

**All numbers below are provisional internal acceptance targets to baseline, not measured Vox performance, current provider prices or industry benchmarks.** Before candidate evaluation, the product, evaluation and release owners freeze the relevant thresholds, cohort/device/network profile and budget in the manifest. Baseline findings can justify changing a future gate with a documented rationale; a candidate author cannot lower a gate after seeing protected results. Never relax permission/consent/deletion invariants to meet latency or cost.

| Area | Provisional gate | Measurement / caveat |
|---|---|---|
| Privacy/identity/action correctness | 0 observed unauthorized provider inputs, outputs, grants, guessed durable identity writes or speculative side effects in all mandatory scenarios | Any reproducible instance blocks enabling affected feature, regardless of average quality |
| Critical suite coverage | 100% mandatory rows and required device/channel cases executed; 0 unresolved B failures; 0 unexplained skips | Mark unavailable evidence explicitly and hold the affected feature; code coverage percentage cannot substitute |
| Grounded memory quality | Claim precision ≥98%; correction/temporal/provenance accuracy ≥95%; appropriate abstention ≥95% | Separate EN, FA, mixed and audience slices; no release on pooled average that hides a critical failing slice |
| Personalization usefulness | Human-rated useful in ≥80% of eligible held-out cases; unwanted personalization ≤2%; verified task success noninferior within 2 percentage points of baseline | Predeclare eligibility/rubric; confidence interval must exclude a decline worse than 2 points. Insufficient precision retains baseline |
| Decisions routing | Macro F1 ≥0.90; harmful/wasteful route false-positive rate ≤1%; report abstention and per-class recall | Security remains deterministic. Require enough labeled examples for stated uncertainty; bootstrap at person/container unit |
| End-to-end text | Request accepted → first meaningful visible text: p50 ≤0.8 s, p95 ≤2.0 s; no >10% p95 regression from baseline | Warm/cold paths and cache state separately; >200 measured turns per declared key profile for pilot floor, not proof of stable tail |
| End-to-end speech | Client end-of-speech → first meaningful audible reply: p50 ≤1.2 s, p95 ≤2.5 s; interruption → last old audible sample p95 ≤250 ms | Measure actual device playback, clock domain and network; server TTS ready is a separate stage |
| Decisions stage | Only if invoked: p50 ≤150 ms, p95 ≤400 ms, 500 ms response deadline then safe baseline route | Timeouts/refusals/unknowns included, never removed to improve percentiles; ≤2 calls per turn, ≤1 in-flight Decisions call per session and ≤2 parallel read-only prefetch paths initially; these require provider-pilot validation and are not an SLA |
| Retrieval stage | Authorized retrieval p50 ≤100 ms, p95 ≤300 ms at declared scale; ≤200 candidates and 2k–6k routine context token experiment | Count read/index operations and selective-ACL recall. Large-document tasks use a declared separate budget |
| Background memory | Accepted eligible event → usable durable memory p50 ≤2 s, p95 ≤10 s in normal load; new-turn working state remains coherent while delayed | Fault tests deliberately exceed latency and must retain safety. Queue lag/oldest age and recovery are independent metrics |
| Revocation/suppression | Suppression is effective at acknowledged authoritative commit; 0 newly authorized dispatches after that point | Invalidation/cancellation latency p95 ≤250 ms, maximum lease 1 s initially; no output on an expired lease. Already dispatched text/audio cannot be recalled |
| Purge | Eligible primary-store/cache/queue payload purge ≤24 h after request; operational retry alert at 15 min; backup expiry target ≤30 days | Privacy owner must validate actual stores/provider contracts before promising these deadlines. Provider retention unverified → `UNAVAILABLE`, no “fully erased” claim |
| Notification scheduling | Eligible due → provider dispatch p50 ≤5 s, p95 ≤30 s excluding declared quiet hours/offline provider outage; 0 intentional duplicate dispatches in race suite | Actual device receipt/open is measured separately and may be unavailable. Expired or revoked notifications must never be “caught up” |
| Operational event integrity | 100% accepted consequential events durable in crash/restart suite; export lag p95 ≤60 s in normal pilot; failure detection ≤5 min | Unavailable exporter does not lose accepted outbox events; sampled detail is labeled; queue/data loss immediately stops expansion |
| Conversation spend ceilings | Initial pilot ceiling $0.05 per successful routine text turn and $0.25 per active voice minute; background observation/optimization ≤20% of conversation spend | Internal budget placeholders requiring owner sign-off and actual provider billing/usage reconciliation. Include STT/TTS/Decisions/generation/embedding/storage/failed and discarded work; missing usage is not $0 |
| Feature efficacy promotion | ≥20% lower p95 useful-response latency at matched quality, or a predeclared statistically supported improvement in verified task success | Apply quality noninferiority margin ≤2 percentage points with confidence intervals and critical subgroup checks. Inconclusive evidence retains baseline; safety instrumentation does not need to show a latency benefit |
| Longer-term efficiency ambitions | Test ≥30% lower p95 useful-response latency and ≥50% fewer routine context tokens at matched quality | From the strategy's experiment goals; distinct from initial feature efficacy gate and not promised improvements. Report observed benefit or retain baseline |

Calculate p50/p95 over all eligible attempts with outcome/timeout rates alongside successful-turn timings; show which failures have no time-to-success. Capture monotonic client durations for audio, server span durations and synchronization uncertainty rather than subtracting unrelated wall clocks. Include cold starts, cache misses, 1%/3% packet loss, 150/300 ms injected RTT, disconnects and 2× expected pilot concurrency. Define expected pilot concurrency before running load; no load number is measured here.

Report cost per attempted and verified successful task, not only token cost or cost per request. Show measured provider usage, billed totals, storage/queue estimates and pricing version separately. Unattributed provider work is an accounting gap. Set an absolute daily experiment cap in the manifest and stop new speculative/optimization work at the cap; retain safe baseline operation.

Speaker assistance requires its own threshold report: false accepts, false rejects, unknown rate, segment attribution accuracy and spoof acceptance by language, device and duration, each with denominators and confidence intervals. The privacy/legal and security owners must decide and freeze an acceptable false-accept/false-reject operating point before recognition enablement; it is not established in this plan. As a sample-sizing illustration, about 300 independent nonmatch trials with zero accepts only approximate a one-sided 95% upper false-accept bound of 1%; this is neither a measured result nor an approved acceptable risk. Correlated trials from a few speakers do not provide 300 independent identities. The evaluator designs sufficient held-out people/sessions and reports clustered uncertainty. Require zero observed security impact for every false match. A recognition gate never permits voice-based ACLs. Replay/synthetic attacks are separate adversarial slices, not folded into an attractive overall average.

## 7. Implementation work packages and stage exits

These packages are sequential where stated, with test harness work beginning alongside each implementation slice. The task owner records issue links, acceptance artifacts and dependencies in the delivery backlog. Estimate effort after contracts are agreed; do not commit dates from this research plan.

| Stage / owner | Concrete QA and delivery tasks | Dependencies and exit |
|---|---|---|
| S0: QA lead + privacy/runtime owners | Freeze supported surfaces, threat model, event/data inventory, consent/age/market states and independent release authority. Add canary captures, fake clock, deterministic IDs and concurrent worker harness. Reproduce guest prompt/extractor/history/group expansion defects. Instrument active Studio stage/playback timings and usage without conversation logging. | Before collecting expanded observation data. E1 baseline report; defined E3 spend cap; privacy contacts/retention unknowns explicitly tracked |
| S1: runtime + QA | Implement/test policy oracle across every input/output, normalized containers/grants, corrections, tombstones, lineage and outbox. Run QA-POL/CON/DEL/EVT/SEC, transaction/restart/property tests. Draft memory edit/share/revoke/delete journeys and EN/FA controls. | S0. No shared-memory expansion until all relevant B gates pass E1/E2; production rules/index configuration must be available for E4 |
| S2: evaluation + memory engineer | Build datasets/splits and protected runner; test indexed retrieval, bounded context and async consolidation; add J1/J2/J4/J6 production-build browser journeys. Qualify paid extraction/generation on minimized cases. Validate opt-out/export minimization. | S1 policy boundaries. E3 held-out memory/personalization report, no missing critical slices, measured baseline quality/cost/latency |
| S3: Decisions/runtime owner | Pin compatible SDK/API/models in an isolated adapter, test schema/deadline/stale/unknown outcomes, bounded partial-event debounce and policy-aware prefetch. Run read-only shadow routing; compare to baseline with E3 actual usage. | S1/S2. QA-DEC suite, benefit/quality gate and functioning kill switch; no permission or side-effect authority given to model decisions |
| S4: notifications/client + privacy/QA | Implement per-channel consent/permission, per-recipient schedule/dispatch, quiet-hour/DST rules, safe payload and dedup/reconciliation. Run J5 on isolated providers and physical devices. | S1 deletion/send rechecks, finalized trigger/frequency/retention policy. QA-NOT suite E1–E5 before proactive enablement |
| S5: voice/client + evaluation | Compare streaming architectures at matched tasks; test STT revisions/interruption/actual audio. Add optional enrollment only for approved adult/jurisdiction configuration; build held-out speaker/attack corpus and template deletion checks. | S1/S3 plus privacy-approved enrollment policy. QA-VOI/A11Y E3/E5. Can release conversational voice while recognition remains off if its gates are incomplete |
| S6: independent evaluator + release owner | Run protected exact-candidate suite, production-build E2E, fault/load/cost tests, deployed-path synthetic checks, device review and rollback rehearsal. Execute improvement-loop J8 with deliberately failing candidate. | Required stages for enabled scope pass. Signed manifest and go/no-go checklist; no autonomous promotion |
| S7: product/evaluation/SRE | Bounded adult opt-in experiment, actual exposure logging, cohort-unit outcome analysis, rollback-ready monitoring and post-release review. Expand only with sufficient quality/privacy/cost evidence. | S6 and finalized Joyixir privacy/legal/contact disclosures for enabled markets. E6 report; unresolved evidence retains previous baseline |

CI changes required as implementation tasks: pin tested build/runtime versions; run deterministic/property smoke on PRs and seeded race suites nightly; test the production build separately from dev server; gate Studio E2E explicitly; collect independently generated reports; require deployment-script tests; add protected evaluation workflow with separate credentials; store artifact digest/prompt/model/policy/dataset versions; make required-check summaries reflect actual job states. Paid tests use approved fixtures, a budget cap and opt-in execution; secrets never enter reports. Preview must use isolated storage/bots/queues and cannot register production webhooks or send pilot notifications.

## 8. Rollout, monitoring and rollback

Roll out per tenant/person or shared container with server-enforced assignment, not browser-only flags. Keep separate kill switches for observation collection, durable extraction, Decisions/prefetch, personalization, shared access, proactive sends, optional recognition and improvement promotion. Switching off observation must not disable essential security/audit events required by the approved policy.

Provisional rollout sequence is internal synthetic → consenting internal adults → 5% eligible opt-in units → 25% → intended availability. Each expansion waits at least 48 hours and 500 eligible completed tasks at the correct assignment unit, **and** the predeclared statistical evidence requirement. Time or sample floor alone does not authorize expansion. Low traffic or inconclusive outcomes keep the stage unchanged. Shared containers remain wholly within one assignment to avoid contaminating separate DMs. A feature never broadens grants as an experiment.

Stop expansion and disable the affected feature immediately for any reproduced disclosure, consent bypass, voice-based grant, deletion resurrection, post-revocation send, lost consequential event or evaluator/release boundary bypass. For quality/performance, proposed stop triggers are p95 useful latency >20% above frozen baseline for two consecutive 15-minute windows with at least 100 eligible attempts each, verified task success worse by >2 points after the predeclared uncertainty test, or the daily spend ceiling. Where low counts prevent a reliable rate, investigate individually and keep baseline rather than reporting a clean window.

Monitor by code/prompt/model/policy version, tenant-safe cohort, language, channel/device, assignment, cache state and provider region where measured. Alerts cover queue oldest age/DLQ, deletion lag, stale membership/policy leases, notification unknown/duplicate attempts, usage gaps, provider failures, stopped audio, unverified task outcomes and incomplete telemetry. No alert payload includes private conversation text.

Rollback rehearsal must demonstrate feature disablement and cancellation within 5 minutes of an authorized release-owner command in the isolated deployed environment, followed by verification of actual live flag/cache propagation. Cancel unsent speculative work and notification jobs; preserve unknown external outcomes for reconciliation. Pin back code/prompt/model/config; enumerate candidate-written memories/indexes, quarantine incompatible or erroneous derivatives and repair via versioned migration without resurrecting deleted content. Restore is not equivalent to rollback: never restore a database wholesale over newer revocations/corrections. Re-run J1/J5/J6 and one actual voice turn after rollback for the enabled scope.

## 9. Go/no-go checklists

### Before a paid-provider run

- [ ] Approved synthetic/minimized or explicitly consented corpus and destination policy; no production user corpus copied by default.
- [ ] Exact adapter/SDK/model versions and account access checked; recorded capability/region configuration and bounded cost ceiling.
- [ ] Providers/calls and external sends permitted in the manifest; dry-run and kill switch ready.
- [ ] Sanitized request capture, response correlation, usage/error/unknown accounting and provider-retention status recorded.

### Before enabling a feature in production

- [ ] Scope, adult/market availability and unsupported states are explicit; Joyixir operator details, privacy contact, retention/deletion promises and applicable consent text finalized by privacy owner.
- [ ] Exact candidate commit/artifact, dependency lock, runtime, prompts, models, flags, schema/indexes and policy are frozen; independent reports match that candidate.
- [ ] All relevant B matrix rows pass at required evidence levels; no unexplained critical skips or missing EN/FA, guest, selected-recipient and revocation cases.
- [ ] Protected corpus isolation and independent evaluator/release authority are verified; quality/latency/cost results meet frozen gates or scope remains disabled.
- [ ] Actual deployed rules, service identities, worker/outbox behavior, webhook versus polling ownership and endpoint revision are verified on the intended route.
- [ ] Production-build Studio journeys pass; required physical devices and actual notification/microphone permissions are documented.
- [ ] Source/history/derivative/cache/queue/DLQ/vector/template inventory and suppression/purge/backup restoration proof are complete for enabled features.
- [ ] Outcome/usage completeness dashboards, on-call owner, independent kill switches and rollback/reconciliation rehearsal pass.
- [ ] Release owner records a feature-by-feature go/no-go; provider tests or a deployment summary alone cannot approve device delivery.

### Before expanding or declaring completion

- [ ] Correct assignment-unit exposure, cohort dates/timezone/build and minimum evidence are verified; QA/synthetic traffic excluded from user outcome metrics.
- [ ] Live endpoint revision and relevant behavior are rechecked; meaningful end-user completion evidence is distinguished from server/provider acceptance.
- [ ] All errors, refusals, unknown outcomes, skipped tests, missing usage and device restrictions are disclosed in the result.
- [ ] No new privacy/permission/deletion regression; quality/cost/tail latency pass per critical language/channel slice; no unsupported claim of causality.
- [ ] Rollback and data-repair responsibilities remain staffed; remaining disabled features are named precisely.

## 10. Evidence templates

Store reports in a restricted, versioned artifact location with expiry, access control and content minimization. Public PRs contain sanitized summaries and restricted evidence references. Never publish recordings, voice templates, user IDs, secrets or private canaries to demonstrate a pass.

### Candidate and release manifest

```yaml
release_id: REQUIRED
status: proposed | qualified | blocked | rolled_out | rolled_back
operator: Joyixir OÜ
markets: [EU_EEA, US]
audience: adults_only
operator_legal_details_and_privacy_contact: PENDING # Complete controller block remains unresolved
privacy_contact:
  email: info@joyixir.com
  source: user_confirmed_2026_10_19
  mailbox_operation: UNVERIFIED
  legal_approval: PENDING
registered_entity_and_address: OPERATOR_DETAILS.md # Official register checked 2026-10-19
candidate:
  source_commit: REQUIRED
  artifact_digest: REQUIRED
  lockfile_digest: REQUIRED
  runtime_version: REQUIRED
  prompt_model_policy_schema_versions: REQUIRED
  enabled_features_and_kill_switches: REQUIRED
environment:
  evidence_level: E1_E2_E3_E4_E5_E6
  endpoint_and_served_revision: REQUIRED_FOR_E4
  database_rules_indexes_workers_webhooks: REQUIRED_FOR_E4
  provider_account_region_and_capabilities: REQUIRED_FOR_E3
  device_os_app_browser_permission_state: REQUIRED_FOR_E5
evaluation:
  corpus_manifest_and_split_digest: REQUIRED
  protected_runner_and_scorer_digest: REQUIRED
  baseline_candidate_and_frozen_gates: REQUIRED
  languages_audiences_assignment_unit: REQUIRED
  sample_counts_missing_invalid_and_uncertainty: REQUIRED
  paid_run_cap_and_billing_usage_reconciliation: REQUIRED_FOR_E3
approvals:
  product_privacy_qa: REQUIRED_NAMED_OWNERS
  independent_release_owner: REQUIRED
  go_no_go_by_feature_and_remaining_gaps: REQUIRED
rollback:
  prior_artifact_and_flags: REQUIRED
  queued_unknown_actions_and_memory_repair: REQUIRED
  rehearsal_evidence_and_oncall_owner: REQUIRED
```

### Individual test record

```text
Test ID / journey / risk / owner:
Result: PASS | FAIL | UNAVAILABLE | NOT_RUN (never blank)
Evidence level, candidate and configuration versions:
Fixture/corpus IDs; permission/provenance; seed; language; space/container:
Environment/device/channel; consent and actual OS/browser permission state:
Preconditions and causal event order (monotonic times / clock uncertainty):
Expected authorized inputs, state and visible outcome:
Observed outbound provider inputs / mutations / deliveries / playback:
Trace/job/source-revision/policy IDs and sanitized artifact hashes:
Expected and observed purge destinations; provider/backup expiry status:
Latency p50/p95, denominator, failure/timeout/unknown counts, usage source:
Independent oracle/reviewer decision; deviation and impact:
Reproduction/minimized counterexample; fix; rerun evidence:
Residual gap, expiry, and feature go/no-go:
```

### Performance and experiment readout

```text
Period/timezone, cohort and exclusion rules, build/prompt/model/policy:
Assignment unit, experiment/exposure versions, baseline/control:
Eligibility and consent; actual exposure and connected-recipient handling:
Attempted/completed/verified successful tasks; missing/invalid/unknown:
Quality by EN/FA/mixed + private/group/selected + known/new person:
Client first meaningful text/audio and stop-audio p50/p95 + uncertainty:
Stage spans, queue lag, cache state, network/device/cold-start slices:
Provider measured usage and billed totals; estimates/gaps labeled:
Discarded speculation, retries, observation/optimization spend:
Privacy/attribution/deletion/notification failures and deterministic gates:
Clustered confidence intervals; predeclared stop/success criteria:
Independent evaluator decision; release owner approval; next gate:
```

An implementation proposal is complete when these tasks, ownership and acceptance artifacts are in the backlog. A feature release is complete only when the appropriate evidence exists for the exact served candidate and the independent release owner records the decision. This document itself authorizes no provider calls, data collection, notifications or deployment.
