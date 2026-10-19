# Vox implementation contracts

19 October 2026. Proposed contracts supporting [the plan](/Volumes/Workspace/Ludaxis/vox/docs/implementation/PLAN.md). Names and field envelopes below are Vox application contracts, not claims that OpenAI exposes those fields. Final schemas are versioned in code during implementation.

**Extend the active Studio/Tireh path.** Put policy and orchestration behind `src/lib/studio/service.ts`, `src/lib/tireh/gateway.ts` and their injected dependencies. Evolve `src/lib/tireh/llm.ts` to return usage/model/finish metadata and support streaming/cancellation. Instrument `src/app/studio/_components/screens/Call.tsx` for first audio and actual playback. Keep HTTP handlers thin. Existing legacy `/app` telemetry and flags are not proof of Studio coverage.

| Component | Responsibility | Authority |
|---|---|---|
| Identity and consent service | Verified person/account bindings, purpose grants, receipts and withdrawal | Server-controlled; client claims validated |
| Memory policy service | Space/container/audience/agent/purpose decisions and versioned revocation | Deterministic authorization before retrieval and output |
| Event ingestion/outbox | Validate allowed fields, persist events atomically with consequential state changes, route projections | Writes only assigned scope; no universal private-content export |
| Live session controller | Current goal, turn revisions, predictions and cancellation | Ephemeral context within session grants |
| Decision service | Compact typed semantic questions and calibrated decision policies | Suggests routes; cannot authorize access or dispatch |
| Personalization service | Explicit preferences and tentative hypotheses with undo/expiry | Only the person's current permitted space/container |
| Notification service | Eligibility, schedules, channel adapters, delivery ledger and feedback | Final deterministic authorization immediately before dispatch |
| Observer/analyst | Aggregates outcomes and proposes reproducible problems | Read-only purpose-filtered views |
| Optimizer/developer | Proposes prompt/config/code candidates in sandbox | No production writes, no evaluator or release credentials |
| Evaluator/release service | Protected datasets, exact-candidate evidence, promotion and rollback | Independent from candidate author; human release owner initially |

Start with the existing TypeScript/Firebase foundation and a durable outbox plus worker. Normalize scope and event records instead of growing the single `studio/state` JSON document. Define `MemoryRepository`/search adapters so bounded retrieval can use an approved index without a premature database migration. A vector/graph store is not the authoritative permission source. Reuse Datadog for sanitized traces where viable; add product analytics/experiment tooling only where it fills a verified gap. Keep retention and export policy independent of vendor choice.

**Data model.** All durable records include schema version, created/updated timestamps and relevant policy/source versions. Server timestamps supplement occurrence times; no universal ordering is inferred from wall clocks alone.

| Record | Core fields and constraints |
|---|---|
| Person/account link | `person_id`, `account_id`, verified method/time, status; ambiguous speaker separate; linkage requires authenticated proof |
| Space/container | Work or Personal; private owner, group membership or exact recipient set; history visibility policy; opaque identifier |
| Grant | principal/agent, resource/container, allowed operations, purpose, expiry and version; read/edit/reshare separate |
| Consent receipt | verified person, purpose, scope, policy/copy version and locale, offered choices, chosen state, timestamp and withdrawal; no inferred opt-in |
| Memory | container/layer, controller/source/subjects, fact versus claim, evidence refs, validity/confidence, consent/purpose, supersession, retention and deletion lineage |
| Preference/hypothesis | person/space/agent context, explicit versus inferred, supporting events, expiry, override/reset, permitted effect and version |
| Event | event ID, producer/schema, occurrence/receipt, sequence/revision, authenticated actor, space/container/purpose, session/turn/trace, source versions, sampling and allowlisted payload |
| Decision result | source event IDs/revision, question/policy version, provider/model, typed answer or unknown reason, age/deadline, usage/cost and evidence scope |
| Notification | intent/recipient/category/channel, evidence refs, eligibility/policy version, due/expiry, dedupe key, delivery state and feedback |
| Improvement candidate | problem/evidence, baseline/candidate revision, dataset/judge versions, changed artifact, evaluation receipts, rollout/rollback record |
| Tombstone | source or permission version, deletion/revocation effective time, derived targets and completion status; minimal evidence under approved retention |

Memory layers remain L0 live signals, L1 working session, L2 person/relationship preferences, L3 temporal events/claims, L4 curated knowledge/procedures, L5 restricted evidence. Layer promotion never widens sharing. The existing audience filter must extend to directory context, history, summaries, extraction and all derived artifacts. Guest/unknown audience handling is restrictive. Selective sharing creates a separately approved projection when the private reason should remain private.

Migration maps only verified ownership/purpose/audience. Ambiguous legacy records remain quarantined and unavailable to new retrieval until resolved. Consent flags are not backfilled from historical use. Backups and derived indexes participate in a documented deletion/restore policy; replays consult tombstones.

**Observation contract.** Ingestion checks authentication, tenant/scope, purpose eligibility, event size, schema, allowed properties and idempotency. Consequential backend events use transactional state-plus-outbox where available. Client events remain explicitly unverified. Consumers use producer+event ID and revision keys, bounded retry/backoff, dead-letter repair and completeness watermarks. Store origin `human|agent|system|qa` to exclude automated activity from product outcomes. Sensitive text/media is referenced only through a separately authorized evidence store.

Starting events: `turn.started`, `transcription.finalized`, `retrieval.completed`, `decision.completed`, `response.first_text`, `audio.first_played`, `reply.interrupted`, `turn.cancelled`, `tool.commit_verified`, `preference.changed`, `memory.corrected`, `memory.share.revoked`, `notification.suppressed`, `notification.accepted_by_provider`, `feedback.submitted` and `experiment.exposed`. A generated answer or accepted notification is not verified task success. Audit consent/access/share/delete outcomes without sampling; sample high-volume successful diagnostic detail and include sample rates.

**Decisions implementation.** At review time the guide identifies public beta, `gpt-6-luna`, and JavaScript SDK 7.30.0+; Vox declares `openai ^6.9.1`. Isolate the SDK upgrade and run provider compatibility tests. The endpoint returns typed predicate/choice/score answers with per-question refusal and usage. Raw audio is unsupported; transcripts feed the classifier. [Guide](https://developers.openai.com/api/docs/guides/decisions), [API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

Use a common supported input subset initially: minimized text and approved inline images. The guide and API reference currently differ on hosted image URL support; verify the selected SDK/account contract rather than relying on that optional feature. Do not export images merely to make a public URL. Keep payloads, question names and answer validation behind a `DecisionProvider` interface with a scripted fake.

| Question ID | API question type | Use | Deterministic boundary/fallback |
|---|---|---|---|
| DEC-01 `intent_route` | choice | Supported task route, including `unknown` | Unknown preserves baseline/clarifies; no automatic action |
| DEC-02 `explicit_correction` | predicate | Flag possible correction for structured extraction | Validate subject/source and user authority before writing |
| DEC-03 `memory_relevance` | score | Rank already authorized memory candidates | Cannot retrieve outside the authorized candidate set |
| DEC-04 `next_step` | choice | Prepare a permitted retrieval or UI suggestion | No send, purchase, sharing or durable commitment |
| DEC-05 `notify_relevance` | score | Rank eligible proactive notification candidates | Rules control permission, recipient, timing, caps and dispatch |
| DEC-06 `failure_category` | choice | Cluster sanitized operational failure windows | Treat result as interpretation; reproduce before proposing fix |
| DEC-07 `answer_grounding` | predicate | Sampled quality signal against permitted evidence | Not ground truth; never overrides deterministic privacy/tool failures |

Classify only when deterministic state is insufficient. Initial configurable guardrails: at most two speculative evaluations per turn, one in flight per session and a 500 ms decision deadline. Timeout/refusal/malformed/unsupported/rate-limited results become a typed `unknown` status, not a negative answer. Use circuit breaking and bounded background retries; never retry a stale live decision. Benchmark and revise these proposed limits before enabling them broadly.

Store question version, candidate set, policy version and final outcome for calibration. Measure false positives/negatives and abstention by language/channel/task. Define route-specific thresholds and compare with simple rules; no universal 0.9 threshold. Reject unrecognized answer types, duplicate/missing named answers and invalid probabilities. Batch related questions only when their data scope and deadline are identical. Responses/structured generation handles full memory records and user-facing prose.

**Early prediction and UX.** Partial speech, text and shared images update a session revision. The controller can prefetch authorized context in parallel with continued listening. Each prepared result is bound to person/account, space/container, audience, agent/purpose grants, source/consent/policy versions and expiry. Recheck all of them before use; cancellation, correction, deletion or membership changes invalidate the work. Late decisions cannot redirect a newer turn. No speculative output is spoken or sent solely because a partial utterance matched a pattern.

An explicit user preference overrides inference. Start with low-risk response length, language, formatting and approved suggested actions. Do not infer sensitive traits, emotions or hidden identity from voice/style. Store inferred preferences with short expiry and evidence; expose why/undo/reset. Avoid moving controls while a user interacts or changing accessibility settings without their choice. Generate personalized layouts through approved component/configuration schemas; code generation follows the separate development loop.

**Notification policy.** Separate categories: security/service information, user-requested reminders, proactive assistance, and marketing. Marketing is disabled/out of scope in this release. Optional proactive assistance starts off; choosing a communication channel is separate from OS/browser permission. The legacy `notifications: true` preference does not establish consent for new purposes.

Initial product defaults for optional proactive nudges: at most two per rolling 24 hours per verified person across spaces, quiet hours 21:00–08:00 in an explicitly selected IANA timezone, user-adjustable caps, and one default delivery channel. Explicit reminders respect the chosen schedule and separately stated quiet-hour behavior; an AI urgency score cannot bypass settings. If timezone is unknown, retain in the in-app inbox and do not guess a send time. Use an opaque per-person budget counter without exposing cross-space content.

Notification lifecycle: `candidate → eligible → scheduled → dispatching → provider_accepted → delivered/failed/unknown`, with `suppressed`, `expired` or `cancelled` possible before acceptance. Provider support determines which receipt states can be established. A send timeout with an unknown outcome is not automatically retried when that could duplicate delivery; reconcile through supported receipts or stop and report uncertainty. Exactly-once external delivery is not promised.

Immediately before send, recheck identity, recipient endpoints, purpose/category/channel choices, current source access, tombstones, freshness, quiet hours and budget reservation. External notification payloads use generic text and an opaque reference; no private content-bearing exception ships in this release. Render detailed content separately for each recipient in the authenticated inbox from currently authorized sources, and re-authorize deep links on open. This rule concerns notification dispatch; ordinary requested conversational replies follow their own current audience and channel policy. Snooze, dismiss, mute, why-this and useful/not-useful feedback update the user's controls. Aggregate feedback supports experiments; a click is not proof of usefulness. Initial channels: authenticated in-app inbox and opted-in existing Telegram DM; browser push later with capability/permission testing, no silent email/SMS fallback.

**Voice recognition.** Conduct a provider/algorithm bakeoff before selection. Authenticated adults enroll through separate biometric disclosure and affirmative choice in approved jurisdictions. Define candidate-set restriction, encrypted template store and key access, retention, withdrawal/deletion, false acceptance/rejection, noisy speech, language shifts, overlap and replay/synthetic-voice tests. Do not keep enrollment recordings by default; exact provider behavior must match the notice. Streaming diarization may label speaker segments, but a segment label is not verified identity.

Recognition produces a hint or unknown. Switching to a person while using someone else's account requires that person's authenticated confirmation before private memory is available. Never attach voice samples to absent people or search everyone in the organization. A non-biometric path remains usable. Voiceprint recognition neither implies permission to clone a voice nor provides a basis for emotion/employee monitoring.

**Improvement and deployment.** Observer findings produce sanitized reproductions and approved evaluation cases. Offline GEPA-style prompt candidates and sandbox code changes are compared against an immutable baseline. The candidate cannot edit evaluator code, scoring rules, held-out data, release thresholds, audit evidence or deployment credentials. Evidence is collected independently against the exact commit/prompt/model/data versions. Shadow runs use simulated/read-only side effects and isolated memory writes. Shared-container variants stay isolated until promotion; rollback includes erroneous derived memories.

Development-team agents in `.codex/agents` inherit parent-session permissions. Their instructions do not enforce runtime isolation. Implement service identities, database/IAM rules, restricted queues and sandbox boundaries for production actors. Do not grant a role broad authority merely because a skill says it is an evaluator.

**Provider retention and residency.** Decisions documentation describes default abuse-monitoring retention up to 30 days, eligible ZDR configurations with limitations, cache state and image exceptions. EU regional processing is configuration-dependent. Do not promise zero retention or immediate provider deletion without verified account settings and contracts. Minimize content before provider calls and choose cache behavior consistent with the approved policy. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). The privacy plan owns the full subprocessor and jurisdiction matrix.

**Operations.** Every capability has a server-side flag and kill switch: event export, semantic decisions, predictive prefetch, learning, proactive notifications, voice enrollment/matching and optimization. Defaults deny new optional processing until rollout gates are met. Monitor queue lag, dead-letter volume, event completeness, provider errors, stale decisions, budget exhaustion, revoked-source attempts and outcome regressions. Restore drills must prove that deleted data remains inaccessible. The release packet includes exact artifacts, independently collected test receipts, configuration/migration version, rollout cohort, rollback steps and unresolved limitations.
