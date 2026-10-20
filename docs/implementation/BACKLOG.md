# Vox implementation backlog

Generated from [BACKLOG.json](BACKLOG.json). All task status comes from that canonical file. Creating a plan does not implement it. Sizes describe complexity, not elapsed days. P0 is foundation; P1 is required before its associated capability is enabled; P2 is a follow-up.

Every task has an independent reviewer. Capability dependencies apply only when enabling that capability; disabled features must be explicit in a release. Core device/provider qualification remains mandatory. Evidence stays empty until work is verified. Follow [QA_AND_RELEASE.md](QA_AND_RELEASE.md) for release gates.

## P0 — Define and design

### VOX-001 — Confirm release scope and measurable outcomes

**Owner:** `vox_product_lead` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-05, REQ-16, REQ-22. **Depends on:** None.

**Implementation progress:** Local scope/metric/decision contract reviewed; launch facts remain explicitly assigned to product/legal owners. See STARTER_SLICE.md.

Confirm Joyixir operator details, EU/EEA and US adults, supported channels/devices, pilot cohort and spending ceiling. Separate core launch from biometric activation.

**Acceptance:**

- [ ] Each unresolved launch decision has an accountable human and affected capability.
- [ ] Task success and useful-response latency have definitions and named data sources; notification opens alone are not success.

**Verification:** Product/QA review with recorded decisions; unresolved items remain explicit.

**Deliverables:** Decision register; Pilot and metric contract.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md"]

### VOX-002 — Create privacy, biometric and jurisdiction launch matrix

**Owner:** `vox_privacy_security` · **Reviewer:** `vox_product_lead` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-01, REQ-12, REQ-22. **Depends on:** VOX-001.

**Implementation progress:** Independent source privacy/security review completed. Formal counsel review, operator/contact details and real jurisdiction approvals remain open; no new optional processing enabled.

Complete purpose/basis mapping, controller/processor roles, US state biometric/recording review, DPIA assessment, retention and subprocessor/transfer checks.

**Acceptance:**

- [ ] Exact registered entity/address/privacy contact are filled before public notices.
- [ ] Every enabled market/capability has a reviewed legal basis and notice; unknown biometric jurisdictions stay disabled.

**Verification:** Qualified privacy/legal review of PRIV requirements and actual data flows.

**Deliverables:** Approved jurisdiction matrix; Notice and processor checklist.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md"]

### VOX-003 — Design onboarding and privacy center

**Owner:** `vox_ux_designer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-01, REQ-09, REQ-20. **Depends on:** VOX-001.

**Implementation progress:** EN/FA onboarding/privacy-state specification reviewed for bounded design direction. Browser implementation, actual journey execution and final copy approval remain outstanding.

Design AI disclosure, core processing explanation, separate optional choices, preference reset, withdrawal and deletion status with English/Persian RTL copy.

**Acceptance:**

- [ ] Declining optional purposes leaves core use available; toggles start off and no prechecked consent.
- [ ] Keyboard/screen-reader flow, equal decline, copy versioning and recovery states are specified.

**Verification:** Annotated flow review plus synthetic usability sessions before implementation.

**Deliverables:** Design flow and states; EN/FA copy and accessibility annotations.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/EXPERIENCE_SPEC.md"]

### VOX-004 — Design memory, identity and personalization controls

**Owner:** `vox_ux_designer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-03, REQ-08, REQ-09. **Depends on:** VOX-001.

**Implementation progress:** Memory/identity/sharing specification reviewed; synthetic walkthrough scripts supplied. Verified server integration and interactive acceptance remain outstanding.

Design Work/Personal switch, private/group/exact-recipient sharing, current person, why-this/undo, guest behavior and authenticated profile switching.

**Acceptance:**

- [ ] Every sharing action previews exact recipients and history consequences.
- [ ] User can correct/reset an inference and distinguish explicit preference from hypothesis.

**Verification:** Journey review including shared account and group membership change.

**Deliverables:** Annotated memory/identity flows; Personalization component states.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/EXPERIENCE_SPEC.md"]

### VOX-005 — Design notification and voice enrollment journeys

**Owner:** `vox_ux_designer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-09, REQ-10, REQ-11, REQ-12, REQ-13. **Depends on:** VOX-002, VOX-003.

**Implementation progress:** Notification/voice design direction reviewed, canonical caps/channels aligned. No capability activation or completed voice enrollment implementation.

Design inbox/settings/channel choice/snooze and separate adult biometric enrollment, test, refusal, deletion and non-biometric paths.

**Acceptance:**

- [ ] OS notification permission and biometric consent are separate from general onboarding.
- [ ] Voice failure never forces enrollment or unlocks another person; notification preview is generic by default.

**Verification:** EN/FA prototype review with consent and lock-screen scenarios.

**Deliverables:** Notification journey; Voice enrollment and fallback journey.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/EXPERIENCE_SPEC.md"]

### VOX-006 — Freeze versioned application contracts and threat model

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-03, REQ-04, REQ-06, REQ-15, REQ-17. **Depends on:** VOX-001, VOX-002.

**Implementation progress:** Pure versioned contract implemented and independently accepted locally. Server integration, IAM/storage enforcement and formal approval remain outstanding.

Define scopes, grants, schemas, service credentials, event projections, decision envelope, retention/revocation epochs and trust boundaries.

**Acceptance:**

- [ ] Directory/history/extraction/cache/evaluation/notification paths all appear in the permission graph.
- [ ] Model suggestions cannot authorize access, enrollment, deployment or external sends.

**Verification:** Architecture/threat-model review; data flow and credential matrix.

**Deliverables:** Architecture decision records; Versioned schema drafts.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/FOUNDATION_CONTRACT.md"]

### VOX-007 — Specify protected eval corpus and baseline protocol

**Owner:** `vox_qa_evaluator` · **Reviewer:** `vox_architect` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-05, REQ-14, REQ-16, REQ-18. **Depends on:** VOX-001, VOX-006.

**Implementation progress:** Strict synthetic manifest and disjoint task/person/group/conversation forward-time partitions, optimizer-only projection, predeclared paired denominators/budgets and signed minimized receipts are implemented. Independent local review passed 24 external checks after two reproduced outcome/scenario defects were fixed. External protected assets/IAM, calibrated judges, representative data and statistical qualification remain open. Independent qualification additionally passed two actual pinned-Docker companion flows at integrated d5416f0; finite synthetic results do not establish population quality.

Define synthetic and permitted realistic datasets, person/group/conversation/time splits, calibrated judges, latency/cost denominators and statistical gates.

**Acceptance:**

- [ ] Optimizer cannot read or edit final promotion examples/scoring.
- [ ] Persian/English, cancellation, revoked sharing, unknown identity and notification outcomes have cases.

**Verification:** QA approves evaluation protocol before model candidate selection.

**Deliverables:** Dataset manifest template; Baseline and promotion protocol.

**Evidence:** ["docs/implementation/EVALUATION_PROTOCOL.md"]

### VOX-008 — Inventory provider, SDK and device capability constraints

**Owner:** `vox_architect` · **Reviewer:** `vox_release_engineer` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-06, REQ-12, REQ-16, REQ-22. **Depends on:** VOX-001, VOX-002.

**Implementation progress:** Documented installed SDK 6.9.1 public post compatibility with Decisions; account/model/device/residency qualification remains open.

Check selected account access to Decisions, SDK migration, regional processing/retention, voice candidates, Telegram delivery and browser/device limits.

**Acceptance:**

- [ ] Provider availability, legal eligibility and latency are separate evidence fields.
- [ ] Image input guide/reference differences are recorded; common supported contract is chosen and tested later.

**Verification:** Read-only documentation/account configuration checks; paid probes occur only within assigned test scope.

**Deliverables:** Provider compatibility matrix; SDK upgrade proposal.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md"]

## P1 — Identity, consent and memory

### VOX-009 — Implement person, account, space and container identities

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-03, REQ-19. **Depends on:** VOX-004, VOX-006.

**Implementation progress:** Durable account-confirmed private profiles, Work/Personal scopes, group and selected-recipient containers. Cross-account identity linking and authenticated multi-person switching remain open.

Add normalized person-account bindings, Work/Personal spaces, private/group/exact-recipient containers, memberships and explicit history policy.

**Acceptance:**

- [ ] Identical members in Work and Personal still address different containers.
- [ ] Claimed speaker or account owner does not silently establish a different verified person.

**Verification:** Unit/integration tests across two spaces, multiple agents, group guests and shared accounts.

**Deliverables:** Domain types and repositories; Identity binding tests.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/FOUNDATION_CONTRACT.md", "docs/implementation/DELIVERY_RESULT.md"]

### VOX-010 — Implement deterministic memory authorization everywhere

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-15. **Depends on:** VOX-009.

**Implementation progress:** Runtime private/shared authorization, agent grants, whole-group projection, delivery rechecks and staged shared publication integrated. Distributed authority/transport atomicity and live Telegram audience completeness remain open.

Apply one server policy to retrieval, directory context, history, summaries, extraction, tool results and exports; fix guest prompt and scope-expansion gaps.

**Acceptance:**

- [ ] Read/edit/reshare and agent/purpose permissions are independently enforced.
- [ ] Unknown audience excludes confidential context and no group-to-project expansion occurs without an explicit grant.

**Verification:** Permission matrix and private-canary adversarial tests, including admin SDK paths.

**Deliverables:** Policy service and adapters; Access regression suite.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/FOUNDATION_CONTRACT.md", "docs/implementation/DELIVERY_RESULT.md"]

### VOX-011 — Implement versioned consent ledger and enforcement

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-01, REQ-04, REQ-17, REQ-22. **Depends on:** VOX-002, VOX-006, VOX-009.

**Implementation progress:** Versioned consent receipts, explicit presentation, durable transitions, expiry and server manifest eligibility wired to Studio API. Legal approval of actual notices remains open.

Create purpose-specific consent/notice receipts, current epochs, withdrawal and enforcement API; distinguish notice acceptance from optional processing permission. Enforce the versioned country/state/feature release registry, adult-entry state and participant/session processing grants at every capture/provider boundary.

**Acceptance:**

- [ ] The server rejects optional collection before persistence/export when disabled.
- [ ] Withdrawn purpose cancels queued work and subsequent provider calls; denial is not overridden by stale UI state.
- [ ] Unknown, conflicting, expired or blocked jurisdiction approvals deny affected processing server-side even if a client directly calls the endpoint.
- [ ] Credible underage/accidental-participant signals suspend optional capture and trigger the approved incident/deletion route; voice never establishes age.

**Verification:** Concurrent grant/withdrawal tests and replay of old jobs.

**Deliverables:** Consent service and endpoints; Ledger/enforcement tests; Server capability eligibility registry and age/session policy tests.

**Evidence:** ["docs/implementation/FOUNDATION_RESULT.md", "docs/implementation/FOUNDATION_CONTRACT.md", "docs/implementation/DELIVERY_RESULT.md"]

### VOX-012 — Build onboarding, privacy center and user controls

**Owner:** `vox_frontend_engineer` · **Reviewer:** `vox_ux_designer` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-01, REQ-08, REQ-09, REQ-20. **Depends on:** VOX-003, VOX-004, VOX-011.

**Implementation progress:** EN/FA Privacy screen, profile declaration, optional choices/withdrawal, private notes and per-agent grants implemented. Guest entry and complete user-rights/status journeys remain open. GI1 adds an isolated public EN/FA /privacy route, manual reference/recovery-code status, explicit close confirmation and disabled-mode contact fallback. Guest credentials remain in transient component state and request bodies; this is metadata request tracking, not verified identity, consent or rights fulfillment. Independent backend and trusted-origin acceptance passed; compiled/CI/release evidence is tracked per candidate, and legal activation remains separate.

Implement scoped settings, AI disclosure, optional consent choices, why-this/undo/reset and request-status UX in Studio. Include a proportionate 18+ entry gate, no-account guest notice/choice and accidental-participant reporting without collecting a full birth date by default.

**Acceptance:**

- [ ] English/Persian states are equivalent, accessible and correct in RTL.
- [ ] Users can decline, revisit and withdraw without losing unrelated core features.
- [ ] Adult entry, guest choice and withdrawal reach the authoritative ledger; a hidden UI or local checkbox cannot stand in for server permission.

**Verification:** Component tests plus browser journeys with denied permissions/offline recovery.

**Deliverables:** Studio settings/onboarding UI; Accessibility and locale evidence.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/GUEST_RIGHTS_INTAKE.md"]

### VOX-013 — Implement memory lifecycle and bounded retrieval

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-08, REQ-16, REQ-17. **Depends on:** VOX-010, VOX-011.

**Implementation progress:** Explicit note/claim/summary review and same-ID correction are implemented. Optional prepared SQLite supplies bounded physical retrieval and compact authority; FILEv2 supplies current-state rollback. Guarded synthetic conversation qualification passed nine cases in both prepared schema-2 formats. PR77/deploy ee3467d also fixes concurrent reviewed-memory acceptance with 11 independent write/fence checks. Production still selects legacy FILE. Shared aggregate indexing, generalized extraction/consolidation and measured quality/latency remain open.

Add provenance/claims/supersession, token-budgeted retrieval, indexed candidate queries and background extraction with scope checks at execution.

**Acceptance:**

- [ ] Normal turns do not download every active memory or await consolidation.
- [ ] Explicit preferences override hypotheses; extracted third-party claims do not become confirmed personal facts.

**Verification:** Retrieval relevance/equality tests, queue retry and scoped extraction tests.

**Deliverables:** Memory lifecycle jobs; Bounded retrieval implementation.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/MEMORY_RETRIEVAL_RESULT.md", "docs/implementation/REVIEWED_PRIVATE_MEMORY_RESULT.md", "docs/implementation/INDEXED_STORAGE.md", "docs/implementation/SQLITE_CONVERSATION_QUALIFICATION.md"]

### VOX-014 — Implement deletion, revocation and scheduled retention expiry

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-17. **Depends on:** VOX-010, VOX-011, VOX-013.

**Implementation progress:** Account/shared scheduled cleanup now has durable paginated leases, restart recovery and expiry tests; observer consent revocation purges journal and derived findings in the same transaction. Maintenance release switch remains off. Provider/backup residual retention and production restore qualification remain open.

Propagate revocation/deletion across history projections, summaries, cache/search, evidence, queues and permitted downstream datasets; maintain minimal tombstones. Implement versioned class-specific expiry and inactivity sweeps, provider residual tracking and backup expiration with the approved numeric schedule.

**Acceptance:**

- [ ] Old extraction/notification/replay work cannot recreate deleted content.
- [ ] UI distinguishes immediate loss of access from physical cleanup/provider residual retention.
- [ ] Fake-clock expiry and inactivity cases deny use on time and purge all derived copies; retries are idempotent and failures alert a named owner.
- [ ] Provider/backup residuals retain explicit pending status until verified expiration or deletion; restoring a backup applies tombstones before any read.

**Verification:** Race tests, restore drill and deletion completion reconciliation. Advance fake time across every data-class TTL and inactivity threshold; verify purge receipts and unresolved provider residuals.

**Deliverables:** Deletion coordinator; Derived lineage and tombstone tests.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-015 — Migrate legacy memory and preference data conservatively

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-03, REQ-19. **Depends on:** VOX-009, VOX-010, VOX-011, VOX-014.

**Implementation progress:** Legacy unscoped history/auto-memory remains denied without silent consent migration. Current adaptive FILE/SQLite/FILEv2 format transition, recovery and current-state rollback tooling is implemented and independently source-tested (INDEXED_STORAGE.md). Broader legacy application inventory, ownership/purpose reconciliation, quarantine mapping and production residual/restore qualification remain open; storage-format conversion does not grant historical data new consent.

Create dry-run inventory/mapping for Studio and older app memory, identity and notifications flags; quarantine ambiguous ownership/purpose/history.

**Acceptance:**

- [ ] No past use becomes optional consent; legacy notifications=true is not a proactive opt-in.
- [ ] Dry-run counts reconcile and rollback preserves authored data without widening permissions.

**Verification:** Synthetic migration rehearsal and before/after access comparison.

**Deliverables:** Versioned migration and rollback; Reconciliation report.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/INDEXED_STORAGE.md"]

### VOX-016 — Enforce storage, key and service-account isolation

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-02, REQ-15, REQ-17, REQ-22. **Depends on:** VOX-006, VOX-009, VOX-010, VOX-011.

**Implementation progress:** Separate account/shared/maintenance namespaces and restricted file modes implemented. Local improvement roles use distinct Ed25519 authorities and a pinned Docker evaluator with no network or secrets. Production service IAM, protected datasets and separate worker credentials remain open.

Implement database/IAM rules, restricted evidence and future biometric storage boundaries, secret handling, key rotation and audit access.

**Acceptance:**

- [ ] Observer/developer credentials cannot read raw private memory or write release/evaluator state.
- [ ] Client and backend bypass attempts fail; logs contain no credentials or private payloads.

**Verification:** Emulator/integration rules tests plus staged policy verification later.

**Deliverables:** Storage/IAM policy; Key and access runbook.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-056 — Implement user rights, scoped exports and guest requests

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-01, REQ-02, REQ-03, REQ-09, REQ-17, REQ-22. **Depends on:** VOX-002, VOX-009, VOX-010, VOX-011, VOX-014, VOX-016.

**Implementation progress:** Own-account Work/Personal export, EN/FA note correction, RI1 request intake and RI2 retention operations are implemented. RI2 binds original audit/closure floors, explicitly reassesses unresolved cases, purges only eligible terminal records and retains finite scoped continuity/410 receipts. Independent RI2 local acceptance passed 36 cases. Formal restriction/objection, guest verification, provider/backups and broader rights fulfillment remain open. Prior additional independent immediate-export race proof remains unavailable after automatic security review; no replacement execution is claimed. GI1 guest metadata intake, bounded separate ledger, current-operator queue, key continuity, final authority fences and finite retention/status receipts are implemented behind reviewed-policy/key configuration. Independent review caught and verified the fix for a short purge-receipt horizon. Actual compiled proxy testing also exposed internal/public-origin mismatch; all six affected handlers now use the trusted server URL. Composed independent acceptance passed 158 external cases and 117 repository regressions; compiled/CI/release evidence remains bound to its exact candidate. Guest recovery-code possession never proves identity or authorizes private-data disclosure.

Implement accessible EN/FA access/export, correction, erasure, restriction, objection, portability and withdrawal requests with proportionate requester verification, a no-account guest route, operator queue, jurisdiction deadlines and status receipts. Wire the privacy center to these real handlers.

**Acceptance:**

- [ ] A verified requester receives only their authorized projection; a workspace owner or shared-account user cannot export another person's private memories.
- [ ] Correction propagates to derived records; restriction/objection prevent the affected use under the approved basis policy; deletion invokes the existing coordinator rather than a separate partial cleanup.
- [ ] Guest requests are trackable without compulsory biometric verification or full account creation; deadlines, extensions, reasons and completion receipts are visible to the privacy operator.
- [ ] EN/FA flows expose truthful pending/completed/error states and reveal no private details through request IDs, download links, support logs or unverified email addresses.

**Verification:** Integration tests for shared-subject redaction, secure export expiry, wrong-requester access, deadline clocks, guest verification and correction/deletion lineage; independent privacy acceptance against PRIV-034/PVT-11.

**Deliverables:** Rights service and operator queue; Scoped export and correction handlers; EN/FA privacy-center and guest request flows; Rights/deadline/access tests.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/RIGHTS_INTAKE.md", "docs/implementation/RIGHTS_RETENTION.md", "docs/implementation/GUEST_RIGHTS_INTAKE.md"]

## P2 — Reliable observation

### VOX-017 — Implement allowlisted event schemas and ingress

**Owner:** `vox_data_engineer` · **Reviewer:** `vox_architect` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-04, REQ-05. **Depends on:** VOX-006, VOX-010, VOX-011.

**Implementation progress:** Allowlisted text_rendered and client-unverified correction observations now have strict ingress, current receipt/canonical command checks, bounded retention and own-space export. No raw note/conversation text is accepted in these observations. Composed release evidence remains separate.

Wire approved schemas with server-derived scope/identity, occurrence/receipt times, origin, revisions, versions and bounded properties. Schema changes escalate to architect.

**Acceptance:**

- [ ] Unknown properties, oversized payloads and unauthorized purpose/scope are rejected.
- [ ] Raw transcript/audio/image/voiceprint fields do not enter broad analytics.

**Verification:** Schema and authentication tests including spoofed actor and QA-origin exclusion.

**Deliverables:** Event types/validators; Ingress endpoints.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/OBSERVATION_COMPLETION.md"]

### VOX-018 — Implement durable outbox, consumers and repair

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-04, REQ-16, REQ-17. **Depends on:** VOX-017, VOX-016.

**Implementation progress:** Bounded durable observer journal includes deduplication, replacement revisions, leases, three-attempt backoff, failure state and explicit retry service; maintenance checkpoints recover after restart. Consent outbox consumers beyond this slice and production-scale transport remain open.

Add state-plus-outbox writes, idempotent consumers, bounded backoff, dead-letter handling, lag/freshness metrics and repair workflow.

**Acceptance:**

- [ ] Duplicate/out-of-order/revised events converge to the same final state and metrics.
- [ ] Worker crash recovers without memory duplication or lost consequential events; revoked jobs remain suppressed.

**Verification:** Fault-injection/replay tests and queue recovery rehearsal.

**Deliverables:** Outbox and worker; Replay/repair tools.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-019 — Instrument Studio turn stages and provider usage

**Owner:** `vox_data_engineer` · **Reviewer:** `vox_architect` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-05, REQ-16. **Depends on:** VOX-017, VOX-008.

**Implementation progress:** Actual voice response and private Telegram terminal outcomes now feed the new observer. Voice playback is correlated by server-issued turn ID. Provider usage, token cost and stage-level latency remain unavailable.

Add turn trace correlation across STT/retrieval/decision/generation/TTS and actual provider metadata via an architect-approved LLM interface change.

**Acceptance:**

- [ ] Measured usage and estimated values are visibly different; current model versions accompany cost.
- [ ] Logs/trace attributes pass payload allowlist and flush behavior is explicit for short-lived handlers.

**Verification:** Scripted provider tests and synthetic full-turn trace readback.

**Deliverables:** Studio trace instrumentation; Usage model fixtures.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-020 — Capture client experience and explicit outcomes

**Owner:** `vox_data_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-05, REQ-09, REQ-16. **Depends on:** VOX-017, VOX-012.

**Implementation progress:** Studio reports committed, connected and visible whole-reply text, separately from explicit task-success feedback. EN/FA note-correction metadata reports saved/unconfirmed outcomes without delaying Save; analytics eligibility loss cancels pending diagnostics. This is whole-response DOM timing, not first streamed token or human comprehension.

Wire first audio, interruption, playback failure, cancellation, correction, feedback and experiment exposure with approved event names.

**Acceptance:**

- [ ] Server completion does not substitute for first audible playback.
- [ ] Client events are unverified, include versions, and do not imply satisfaction or completed tasks.

**Verification:** Browser event readback from synthetic interactions, duplicate/reconnect cases.

**Deliverables:** Client event hooks; Outcome event coverage.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/OBSERVATION_COMPLETION.md"]

### VOX-021 — Remove private payloads from diagnostic and audit paths

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-04, REQ-15, REQ-22. **Depends on:** VOX-017.

**Implementation progress:** New correction/presentation diagnostics retain fixed outcome, scope and bounded timing only; exports omit internal receipts/source/authority hashes. Current-state rollback removes the new observer extension from legacy FILE, prepared SQLite or FILEv2 while preserving canonical data, pause controls and tombstones.

Replace raw STT/call/extraction logs and block audit text with reason codes/restricted evidence refs; keep sensitive replay disabled or explicitly masked.

**Acceptance:**

- [ ] Synthetic private canaries cannot appear in unauthorized logs/audit/analytics/replay exports.
- [ ] Admin audit access does not provide access to private conversation evidence.

**Verification:** Export-capture tests on all known logging and replay paths.

**Deliverables:** Sanitized logging/audit changes; Leak-canary report.

**Evidence:** ["docs/implementation/OBSERVATION_DIAGNOSTICS.md", "docs/implementation/evidence/DIAGNOSTIC_REVIEW.md", "docs/implementation/OBSERVATION_COMPLETION.md"]

### VOX-022 — Build operational and product outcome views

**Owner:** `vox_data_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-05, REQ-16. **Depends on:** VOX-018, VOX-019, VOX-020, VOX-021.

**Implementation progress:** Own-space Studio measurements show response/playback denominators, queue lag/failure, deterministic findings and explicit unavailable task success/usage. Owner/superadmin operations view shows local workflow metadata only. Organization/cohort dashboards remain open.

Produce scoped views for task outcome, latency/cost, correction, queue lag, permission/consent failures and notification outcomes with compatible cohorts.

**Acceptance:**

- [ ] Cohort/language/channel/release/QA filters and completeness are visible.
- [ ] Missing provider outcomes remain unavailable; sampling does not bias uncorrected totals.

**Verification:** Reconcile synthetic source events to displayed aggregates and denominators.

**Deliverables:** Baseline dashboards/queries; Data quality report.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-023 — Introduce read-only observer and reproducible findings

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P0 · **Status:** in_progress

**Requirements:** REQ-05, REQ-14, REQ-15. **Depends on:** VOX-022, VOX-016, VOX-007.

**Implementation progress:** Deterministic read-only observer reconstructs findings from a bounded content-free journal with unknown causes and alternative explanations. No message/code/provider capability exists in its consumer. Semantic clustering and production worker isolation remain open.

Use rules first and sampled semantic analysis to cluster failures into findings with evidence, alternative explanations and confidence.

**Acceptance:**

- [ ] Observer cannot send user messages, modify app code or access unrestricted private content.
- [ ] Each finding separates observed event from inferred cause and links a reproducible case.

**Verification:** Synthetic failure scenarios plus negative controls and budget checks.

**Deliverables:** Observer job; Finding schema and examples.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md"]

## P3 — Decisions, prediction and personalized UX

### VOX-024 — Upgrade SDK and implement Decisions provider adapter

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-06, REQ-16, REQ-22. **Depends on:** VOX-008, VOX-016, VOX-019.

**Implementation progress:** Decisions text/image adapter and bounded real HTTP consumer are integrated, with unknown/timeout fallback and no permission authority. Existing supported SDK generic transport is used; synthetic wire tests pass. Real-account performance/retention qualification remains open.

Upgrade isolated OpenAI dependency; implement typed question/result/usage/refusal adapter and scripted fake, with an explicit versioned schema.

**Acceptance:**

- [ ] All question answer variants and partial refusal are handled without truthy/default-success coercion.
- [ ] Existing OpenAI use cases remain compatible and raw audio never enters Decisions.

**Verification:** Contract tests with fixture payloads; limited approved live-account smoke later.

**Deliverables:** DecisionProvider implementation; SDK compatibility tests.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/evidence/decisions-provider/RESULT.md", "src/lib/adaptive/prediction/RESULT.md"]

### VOX-025 — Define and calibrate question catalog and policies

**Owner:** `vox_qa_evaluator` · **Reviewer:** `vox_architect` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-06, REQ-07, REQ-16. **Depends on:** VOX-007, VOX-024.

**Implementation progress:** Three versioned fixed questions wired to prediction endpoint. Held-out calibration and supported language/cohort efficacy remain open.

Implement DEC-01–07 catalog with supported choices, unknown path, task-specific thresholds and evidence scope; compare with deterministic rules.

**Acceptance:**

- [ ] Question/data versions and false positive/negative/abstention metrics are retained per language/channel.
- [ ] No threshold controls identity, consent, ACL or irreversible actions.

**Verification:** Held-out calibration and blinded review with fixed budget.

**Deliverables:** Versioned question catalog; Calibration report.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md"]

### VOX-026 — Implement live prediction revision and cancellation

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-06, REQ-07, REQ-17. **Depends on:** VOX-013, VOX-014, VOX-024, VOX-025.

**Implementation progress:** Real off-by-default Studio draft consumer debounces edits, caps two evaluations per turn, cancels and supersedes durable revisions, checks fresh receipts and performs read-only gateway context preparation. Scope/correction/cancel/provider-late-result tests pass. Actual early partial-voice producer and end-to-end speed qualification remain open.

Bind predictions to turn/source/scope/policy revisions, cap speculative calls and cancel stale results; prefetch only authorized candidates.

**Acceptance:**

- [ ] Correction, person/space change, membership change, expiry and deletion invalidate prepared context.
- [ ] Timeout or out-of-order decision returns baseline conversation; no speculative external side effect.

**Verification:** Deterministic clock/out-of-order/cancel tests and live-path latency comparison.

**Deliverables:** Session prediction controller; Race/cancellation suite.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "src/lib/adaptive/prediction/RESULT.md"]

### VOX-027 — Implement explicit preferences and scoped hypotheses

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-03, REQ-08, REQ-17. **Depends on:** VOX-011, VOX-013, VOX-014, VOX-025.

**Implementation progress:** Reviewed preference learning now has separate versioned opt-in per confirmed account, agent and Work/Personal space. Final current text may create bounded enum proposals through guarded Decisions; Use is required, explicit choices win, and shared turn budgets, source suppression, expiry and authority revisions fence stale work. Independent 424/30 and composed 121/6 checks passed. Compiled browser, final CI, live provider quality and rollout remain pending; no sensitive-trait or identity inference.

Add preference precedence, hypothesis evidence/expiry, bounded effects and user correction/reset; no hidden sensitive-trait inference.

**Acceptance:**

- [ ] Explicit user choice always wins and can disable future learning.
- [ ] Ambiguous identity or one interruption cannot produce durable personal attribution.

**Verification:** Preference conflict, quoted speech, wrong account and reset tests.

**Deliverables:** Preference/hypothesis service; Attribution fixtures.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/PERSONALIZATION_CONTROLS_RESULT.md", "docs/implementation/REVIEWED_PREFERENCE_LEARNING_RESULT.md"]

### VOX-028 — Build personalized UX with explanation and undo

**Owner:** `vox_frontend_engineer` · **Reviewer:** `vox_ux_designer` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-08, REQ-09, REQ-20. **Depends on:** VOX-004, VOX-012, VOX-026, VOX-027.

**Implementation progress:** EN/FA explicit choices retain scoped explanations and genuine Undo. The composed review-only learning panel offers separate opt-in, uncertain candidate reasons, Use/dismiss, scope cancellation and suppression against immediate relearning after Undo/reset. Independent source and real-handler/file React journeys passed. Compiled browser acceptance and broader suggested-action/component variants remain open.

Apply approved length/language/format/suggested-action and component-schema variants with why-this, undo and stable navigation.

**Acceptance:**

- [ ] No control moves mid-interaction; accessibility preferences remain under user control.
- [ ] Undo restores behavior and prevents immediate relearning from the same evidence.

**Verification:** Usability/accessibility EN/FA tests and reversible variant journeys.

**Deliverables:** Personalized Studio components; UX evidence.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/PERSONALIZATION_CONTROLS_RESULT.md", "docs/implementation/REVIEWED_PREFERENCE_LEARNING_RESULT.md"]

### VOX-029 — Implement feature gates and shared-container experiments

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-16, REQ-18, REQ-21. **Depends on:** VOX-009, VOX-018, VOX-020, VOX-025.

**Implementation progress:** Controlled presentation experiment service, strict configuration and lifecycle, private-person and exact shared-container assignment contracts, and client-unverified visible exposure are implemented. The actual Studio surface is private text density only, default off; shared-runtime enrollment and production cohort activation remain open.

Add server-enforced flags/kill switches, stable assignments/exposure and isolated variant memory for private/person or shared-container experiments.

**Acceptance:**

- [ ] The same selected-recipient container cannot mix experimental writes across different DMs.
- [ ] Cache invalidation stops a disabled feature immediately within the defined operational bound.

**Verification:** Cross-session assignment, membership and rollback tests.

**Deliverables:** Experiment/flag service; Exposure and isolation tests.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/CONTROLLED_EXPERIMENTS.md"]

### VOX-030 — Qualify decision latency, cost and fallback behavior

**Owner:** `vox_qa_evaluator` · **Reviewer:** `vox_release_engineer` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-06, REQ-07, REQ-16. **Depends on:** VOX-024, VOX-025, VOX-026, VOX-028, VOX-029.

**Implementation progress:** Local timeout/refusal/revocation/budget fallback tests passed. One live synthetic sample took1087ms and134 input tokens; it exceeded the production500ms deadline and cannot establish a latency distribution, cost baseline or speed improvement. Held-out quality, load, cold/warm caching and real conversation measurements remain open.

Benchmark baseline versus candidate using the fixed workload, uncertainty intervals and matched quality; evaluate circuit break/budget/outage behavior.

**Acceptance:**

- [ ] At most two speculative evaluations/turn and one in-flight/session are enforced unless a reviewed configuration changes them.
- [ ] 500ms proposed deadline degrades to baseline; no unmeasured vendor speed claim is treated as Vox performance.

**Verification:** Load/fault tests and approved provider measurements with exact versions.

**Deliverables:** Decision qualification report; Budget and circuit-break settings.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/evidence/decisions-provider/RESULT.md"]

### VOX-031 — Integrate supported voice/image input prediction path

**Owner:** `vox_voice_engineer` · **Reviewer:** `vox_architect` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-06, REQ-07, REQ-09, REQ-16, REQ-01, REQ-03, REQ-22. **Depends on:** VOX-024, VOX-026, VOX-030, VOX-011.

**Implementation progress:** Added actual Studio text/image conversation and opt-in draft/image prediction, with browser metadata-stripping JPEG re-encoding, server raster limits, separate image capability, and fresh consent at each provider request/continuation/fallback and delivery. Live-call SDK currently exposes final transcripts; true partial-voice prediction remains unimplemented and is not claimed.

Add capability-gated partial-transcript and minimized shared-image prediction; compare current streaming path with GPT-Live integration where available. Own session audio eligibility before capture: notice/required participant choice, guest flow, current audience and jurisdiction rechecks, and pause-on-join handling.

**Acceptance:**

- [ ] Unsupported mode/account uses baseline input flow; raw audio is not sent to Decisions.
- [ ] Transcript corrections and changed image/context invalidate predictions and never leak into broader analytics.
- [ ] No participant audio reaches a provider until applicable notice/permission gates pass; a new/unknown participant pauses affected capture and restricted output.
- [ ] Unknown or unresolvable mixed-audience consent keeps multi-party processing disabled with an accessible text/private-channel alternative; single-person core mode remains separately qualified.

**Verification:** Mocked stream contract plus approved actual-device/provider E2E.

**Deliverables:** Input/prediction adapter; Mode/device compatibility evidence.

**Evidence:** ["docs/implementation/ADAPTIVE_COMPLETION_RESULT.md"]

## P4 — Notifications

### VOX-032 — Implement notification categories, preferences and inbox

**Owner:** `vox_frontend_engineer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-01, REQ-09, REQ-10, REQ-11. **Depends on:** VOX-005, VOX-011, VOX-012.

**Implementation progress:** Authenticated EN/FA inbox, category/settings controls, requested reminders and feedback implemented. Snooze, Telegram channel controls and external receipts remain open.

Create authenticated inbox and purpose/category/channel choices with snooze/mute/why-this; keep proactive off and marketing disabled.

**Acceptance:**

- [ ] Legacy enabled flags do not silently opt people into proactive contact.
- [ ] Choosing Telegram/browser channel does not imply OS permission or consent to unrelated purposes.

**Verification:** Component/API tests for choose/decline/revoke/RTL states.

**Deliverables:** Notification settings/inbox; Preference tests.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md"]

### VOX-033 — Implement candidate ranking and deterministic eligibility

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-02, REQ-10, REQ-11. **Depends on:** VOX-025, VOX-027, VOX-032, VOX-014.

**Implementation progress:** Pure deterministic eligibility and generic candidate policy plus durable generic inbox candidates implemented. Learned ranking/calibration remains open.

Generate evidence-linked candidates, optionally rank using DEC-05, then enforce exact recipient/source rights, purpose, freshness and eligibility.

**Acceptance:**

- [ ] A high score cannot override a disabled category/channel or missing source grant.
- [ ] Every suppression has a bounded reason code; evidence content stays restricted.

**Verification:** Policy table tests for private/group/selected-recipient cases and expired evidence.

**Deliverables:** Candidate/eligibility service; Notification policy fixtures.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md"]

### VOX-034 — Implement scheduler, quiet hours and notification budgets

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-10, REQ-16, REQ-17. **Depends on:** VOX-018, VOX-033.

**Implementation progress:** Durable atomic cross-space cap and chosen-timezone quiet-hour checks implemented; due reminders appear on authenticated inbox reads. External scheduler/worker remains open.

Schedule using explicit IANA timezone, DST handling, rolling per-person cross-space caps, dedupe and atomic budget reservation.

**Acceptance:**

- [ ] Default optional nudges obey 2/rolling24h and21:00–08:00 quiet hours; unknown timezone uses inbox only.
- [ ] Duplicate workers/retries cannot spend the same budget twice or resurrect revoked candidates.

**Verification:** Fake-clock DST/timezone change and concurrent reservation tests.

**Deliverables:** Scheduler and budget ledger; Time/concurrency tests.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md"]

### VOX-035 — Implement recipient-safe Telegram dispatch and receipts

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-10, REQ-11, REQ-17. **Depends on:** VOX-016, VOX-032, VOX-034.

**Implementation progress:** Prior scoped relationship release includes generic opted-in Telegram alerts, fresh authority checks and private inbox content. Live cohort activation, provider/device delivery proof and pilot outcomes remain open.

Deliver only to an explicitly opted-in, authenticated existing Telegram DM. Send generic text plus an opaque reference; render details inside the authenticated inbox only after current recipient/source authorization. Recheck policy immediately before send.

**Acceptance:**

- [ ] Revoke-after-queue prevents send and links reauthorize on open.
- [ ] Unknown timeout outcome does not trigger blind duplicate sends; accepted/delivered/read states remain distinct.
- [ ] External payloads, URLs, transport receipts and logs contain no private memory or transcript text; no content-bearing notification exception ships in this release.

**Verification:** Adapter fixtures plus approved real receipt and revoked-source E2E later.

**Deliverables:** Telegram dispatcher; Receipt reconciliation tests.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-036 — Measure notification usefulness and unwanted contact

**Owner:** `vox_data_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-05, REQ-10, REQ-18. **Depends on:** VOX-020, VOX-032, VOX-035.

**Implementation progress:** Private useful/dismiss feedback endpoint and UI implemented. Cohort-level reporting and real usefulness measurements remain open.

Instrument explicit useful/not-useful, snooze/mute, suppression, opt-out and verified task outcomes with compatible exposure.

**Acceptance:**

- [ ] Click/open is reported separately from useful outcome.
- [ ] Cross-space counters reveal no source content and analytics uses permitted projections only.

**Verification:** Source-to-view reconciliation and small-cohort privacy checks.

**Deliverables:** Notification outcome views; Exposure/feedback fixtures.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md"]

### VOX-037 — Qualify browser push as a separate follow-up channel

**Owner:** `vox_frontend_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P2 · **Status:** planned

**Requirements:** REQ-09, REQ-10, REQ-11, REQ-20. **Depends on:** VOX-032, VOX-034, VOX-035.

Implement or capability-gate browser push only after platform support, permission, service-worker/token lifecycle and delivery behavior are measured.

**Acceptance:**

- [ ] No automatic OS prompt on first visit or repeated prompt after denial.
- [ ] Actual supported devices prove delivery/revocation; unsupported devices retain inbox without silent channel fallback.

**Verification:** Real browser/OS/device tests with explicit subscriptions and test accounts.

**Deliverables:** Push capability adapter or documented deferral; Device matrix.

## P5 — Optional voice recognition

### VOX-038 — Select voice architecture and qualify jurisdictions

**Owner:** `vox_voice_engineer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** planned

**Requirements:** REQ-12, REQ-13, REQ-16, REQ-22. **Depends on:** VOX-002, VOX-005, VOX-008, VOX-016.

Compare local-first and cloud speaker recognition for permitted candidate sets, encryption, deletion, latency, spoof resistance and vendor contracts.

**Acceptance:**

- [ ] Legal/security approve supported markets, provider/data path and acceptable false acceptance/rejection bounds before enrollment.
- [ ] Enrollment sample retention and residual provider behavior match the notice.

**Verification:** Synthetic/consented benchmark design and signed decision record.

**Deliverables:** Voice ADR and provider scorecard; Jurisdiction feature configuration.

### VOX-039 — Implement optional enrollment and template lifecycle

**Owner:** `vox_voice_engineer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-01, REQ-12, REQ-17. **Depends on:** VOX-011, VOX-014, VOX-016, VOX-038.

**Implementation progress:** Canonical biometric opt-in plus separate own-voice disclosure, one-use intent, isolated encrypted opaque templates, bounded provider deadlines, canonical withdrawal and replay-safe all-device space deletion implemented with synthetic protocol tests. Provider is deliberately not configured in production; actual cryptographic access, provider behavior, retention and legal qualification remain open.

Enroll only an authenticated adult with separate explicit biometric choice; use restricted templates, short-lived buffers, deletion and re-enrollment controls.

**Acceptance:**

- [ ] No passive or third-party enrollment; optional refusal leaves ordinary voice/chat functional.
- [ ] Withdrawal deletes/disables templates per policy and prevents queued re-enrollment or matching.
- [ ] Consent and approved jurisdiction are checked before sample/query feature extraction, including local extraction; denying storage after extraction is insufficient.

**Verification:** Consent/withdrawal races, key-access and template deletion tests.

**Deliverables:** Enrollment APIs/store; Lifecycle tests.

**Evidence:** ["docs/implementation/VOICE_IDENTITY_RESULT.md"]

### VOX-040 — Implement speaker hints and authenticated person switching

**Owner:** `vox_voice_engineer` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-03, REQ-12, REQ-13. **Depends on:** VOX-009, VOX-010, VOX-026, VOX-039.

**Implementation progress:** Implemented self-only possible_self/unknown test hint; it never changes identity or private access. Cross-account speaker matching and authenticated person-switch flow are not implemented; communication style is not an identity credential.

Return recognized hint/unknown within permitted candidates; segment overlapping speakers; require authenticated person confirmation for private-context switch. Treat segment labels as transient and unverified; enable query-template extraction only in a session whose present participants have the required processing permission.

**Acceptance:**

- [ ] Voice or writing-style match never alone changes private memory grants.
- [ ] Unknown/multiple/quoted/recorded speakers cannot write another person profile.
- [ ] Unconsented, unknown or unresolved mixed audio is not processed into biometric query templates; join/withdrawal cancels matching before the next buffer.
- [ ] Matching uses only the explicitly permitted candidate set; it never searches other accounts or silently links a writing-style similarity to a person.

**Verification:** Wrong-account, overlap, replay and person-switch integration tests.

**Deliverables:** Speaker hint adapter; Profile-switch integration.

**Evidence:** ["docs/implementation/VOICE_IDENTITY_RESULT.md"]

### VOX-041 — Build enrollment, status, test and deletion UX

**Owner:** `vox_frontend_engineer` · **Reviewer:** `vox_ux_designer` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-09, REQ-12, REQ-13, REQ-20. **Depends on:** VOX-005, VOX-039, VOX-040.

**Implementation progress:** English/Persian disclosure, enrollment, status, test, cancellation, deletion and unavailable-provider UI implemented. Microphone starts only after server capture intent. Physical-device/browser qualification remains open.

Implement separate biometric disclosure, jurisdiction gating, enrollment/test feedback, visible recognition status and non-biometric fallback in EN/FA.

**Acceptance:**

- [ ] Unsupported region/provider and uncertain match have clear noncoercive flows.
- [ ] User sees recognition controls distinct from cloned voice and can delete a template.

**Verification:** Accessibility/RTL journey and actual microphone-denial testing.

**Deliverables:** Voice controls UI; Consent/status UX evidence.

**Evidence:** ["docs/implementation/VOICE_IDENTITY_RESULT.md"]

### VOX-042 — Qualify voice accuracy, spoofing and device behavior

**Owner:** `vox_qa_evaluator` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** planned

**Requirements:** REQ-03, REQ-12, REQ-13, REQ-16. **Depends on:** VOX-038, VOX-039, VOX-040, VOX-041.

Run independent consented/synthetic voice corpus across languages, devices, noise, synthetic/replayed audio and nonmatch populations.

**Acceptance:**

- [ ] FAR/FRR and confidence intervals satisfy preapproved thresholds; no universal accuracy claim.
- [ ] Private-data access remains blocked even on a false match; deletion and fallback work on actual devices.

**Verification:** Protected voice benchmark and hardware E2E; publish exact dataset/provider/device versions.

**Deliverables:** Voice qualification packet; Market-specific go/no-go.

## P6 — Product improvement

### VOX-043 — Build reviewed learning-case dataset pipeline

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-04, REQ-14, REQ-17. **Depends on:** VOX-007, VOX-014, VOX-016, VOX-023.

**Implementation progress:** Signed minimized synthetic/approved aggregate finding import, lineage expiry/revocation and private-content rejection implemented for local routing workflow. No automatic export of real user observations; production curation/rights integration remains open.

Turn permitted findings into minimized reproductions/evaluation cases with lineage, data-purpose eligibility, retention and review.

**Acceptance:**

- [ ] Private canaries cannot enter shared prompts, PRs, reports or unapproved datasets.
- [ ] Deletion propagates into exported learning cases and future optimization exclusions.

**Verification:** Canary export tests and dataset lineage/delete reconciliation.

**Deliverables:** Case curation workflow; Dataset manifests.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-044 — Implement offline prompt and routing optimization

**Owner:** `vox_architect` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-06, REQ-14, REQ-16. **Depends on:** VOX-025, VOX-030, VOX-043.

**Implementation progress:** Fixed-budget cancellation-routing optimizer now accepts only the strict optimization projection of a frozen protocol; validation/final cases and judge/scoring fields are excluded. Representative prompt optimization, real provider quality and external optimizer isolation remain open.

Generate versioned GEPA-style prompt/query/routing candidates offline with fixed budgets and incumbent comparisons; preserve serving path.

**Acceptance:**

- [ ] Optimizer cannot edit metrics, held-out tests or production policies.
- [ ] Generated prompt artifacts are checked for memorized private examples and support rollback.

**Verification:** Fixed-budget train/validation run and protected candidate evaluation.

**Deliverables:** Optimization worker; Candidate registry.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/EVALUATION_PROTOCOL.md"]

### VOX-045 — Implement sandbox software patch workflow

**Owner:** `vox_architect` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-14, REQ-15, REQ-21. **Depends on:** VOX-016, VOX-023, VOX-043.

**Implementation progress:** Signed defect-to-patch workflow and shipped Persian punctuation fix remain qualified by v1 evidence. Additive v2 now authors a bounded patch through gpt-6.1-sol Responses, durably reserves one request per proposal, verifies signed provenance and preserves protected Docker evaluation. Independent 81-test review and mock end-to-end evaluation passed. One actual provider request produced the correct patch; its first Docker stage stayed incomplete because the test launcher lacked the Docker context, preserved as failed qualification. Independent re-evaluation of the captured artifact is recorded separately. Production IAM, generic coding, automatic PR publication and protected deployment remain open.

Convert reviewed defects into isolated worktrees/branches with small diffs, reproductions, tests and reviewable PR descriptions.

**Acceptance:**

- [ ] Developer credentials cannot access production secrets, raw private content or deploy/merge authority.
- [ ] Candidate scripts/logs cannot certify their own success; changed code maps to the assigned issue.

**Verification:** Sandbox boundary test plus a synthetic bug-to-patch rehearsal.

**Deliverables:** Developer workflow; PR/evidence template.

**Evidence:** ["docs/implementation/SOFTWARE_PATCH_WORKFLOW.md", "docs/implementation/evidence/software-patch/RESULT.md", "docs/implementation/MODEL_PATCH_AUTHOR.md", "docs/implementation/evidence/model-author/RESULT.md"]

### VOX-046 — Implement independent evaluation and promotion receipts

**Owner:** `vox_qa_evaluator` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-14, REQ-16, REQ-18. **Depends on:** VOX-007, VOX-029, VOX-043, VOX-044, VOX-045.

**Implementation progress:** Protocol-bound candidates require a durable evaluator reservation before final execution, signed minimized companion, existing Docker final envelope and human approval of that exact envelope. Replay/crash/cross-candidate reuse and legacy bypass deny. Independent local 24-case review passed. At integrated d5416f0 the four normally skipped Docker cases passed within 33 workflow/software-sandbox tests; two independent actual pinned-Docker companion flows also passed, covering successful approval/restart and denied regression/self-promotion. Default CI skips remain explicit. External IAM/checkpoint and representative quality/calibration remain open.

Run Promptfoo and deterministic tests in a protected environment against exact candidate/model/prompt/data versions; calibrate judge to human examples.

**Acceptance:**

- [ ] Malformed/skipped/refused evaluations reduce coverage and cannot become passes.
- [ ] Quality gains cannot override privacy/identity failures; evidence collected outside candidate control.

**Verification:** Adversarial fake-log/judge-tamper tests and full evaluation rehearsal.

**Deliverables:** Protected evaluator pipeline; Promotion receipt schema.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/EVALUATION_PROTOCOL.md"]

### VOX-047 — Implement controlled experiments and rollback of learned state

**Owner:** `vox_release_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-14, REQ-17, REQ-18, REQ-21. **Depends on:** VOX-029, VOX-046.

**Implementation progress:** Versioned off/offline/shadow/pilot/killed controller, isolated derived state, kill/quarantine/purge, durable suppression/source tombstones, reviewed retention and scoped export are implemented. Local FILE/SQLite/FILEv2 consent integration is independently tested. Evidence references are operator attestations, not automatic proof of independent promotion; production pilot and representative outcome readout remain open.

Promote from offline to side-effect-free shadow then bounded pilot; isolate experimental memory writes and rollback code/config/derived state together.

**Acceptance:**

- [ ] Shared containers do not leak candidate effects into control recipients.
- [ ] Kill switch stops candidate behavior; bad derived memories are quarantined/repaired with lineage.

**Verification:** Pilot/rollback exercise with predeclared stopping rules and fake-clock outcomes.

**Deliverables:** Promotion controller; Rollback runbook/evidence.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/CONTROLLED_EXPERIMENTS.md"]

### VOX-048 — Publish evidence-backed product improvement reports

**Owner:** `vox_docs_analyst` · **Reviewer:** `vox_product_lead` · **Model:** `gpt-6-luna` · **Size:** S · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-05, REQ-14, REQ-16. **Depends on:** VOX-022, VOX-036, VOX-046.

**Implementation progress:** Sanitized local improvement report and read-only owner/superadmin status view distinguish local tests from unavailable CI/deployment/measured effect. Real product outcomes and costs remain unavailable.

Produce compact reports linking verified outcome changes to versions/cohorts, uncertainty, costs and decisions; keep private narratives out.

**Acceptance:**

- [ ] Report distinguishes proposal, local test, CI, deployment and measured effect.
- [ ] No missing metric becomes zero; unsupported causal claims are labelled hypotheses.

**Verification:** Independent metric/source reconciliation and privacy scan.

**Deliverables:** Improvement report template; Sample sanitized report.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md"]

## P7 — Qualification and release

### VOX-049 — Run complete synthetic integration and protected regression suite

**Owner:** `vox_qa_evaluator` · **Reviewer:** `vox_architect` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-02, REQ-03, REQ-04, REQ-06, REQ-10, REQ-14, REQ-17, REQ-01, REQ-22. **Depends on:** VOX-015, VOX-016, VOX-018, VOX-021, VOX-030, VOX-035, VOX-046, VOX-056, VOX-031.

**Implementation progress:** Combined source suite, independent cross-review and consent/cancellation/transport regression checks are recorded in the completion receipt. Synthetic evidence does not close protected semantic/provider/device cases.

Execute QA matrix across consent, memory scopes, event ordering, decisions, notifications, evaluation authority and provider failures.

**Acceptance:**

- [ ] All critical invariants pass against an exact candidate; failures retain original receipts.
- [ ] Revocation/identity/queue races are reproduced deterministically and repaired before gate completion.
- [ ] Direct API attempts with expired/unknown jurisdiction policy, missing adult entry, guest refusal or a participant joining mid-turn are denied before affected capture/provider processing.
- [ ] User-rights exports filter other people's data and exercise correction, restriction, objection and guest requests with traceable deadlines.

**Verification:** Vitest/emulator/property/contract tests plus protected Promptfoo evaluation.

**Deliverables:** Regression evidence packet; Open-defect register.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/INTEGRATION_RELEASE.md", "docs/implementation/RELEASE_2026_10_19.md", "docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/ADAPTIVE_COMPLETION_RESULT.md"]

### VOX-050 — Run Studio browser journeys and accessibility checks

**Owner:** `vox_e2e_runner` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-01, REQ-08, REQ-09, REQ-10, REQ-20. **Depends on:** VOX-012, VOX-028, VOX-032, VOX-035, VOX-049.

**Implementation progress:** New compiled Studio browser journey covers text/image chat, Work/Personal clearing, EN/FA and default-off unavailable recognition. Evidence and real-device distinction are recorded in the completion receipt.

Execute QA-approved Studio journeys using synthetic fixtures in Chromium/WebKit/mobile emulation, EN/FA and RTL; record exact evidence.

**Acceptance:**

- [ ] Tests cover reject optional consent, correction/reset, shared memory, revoked notification and degraded states.
- [ ] Emulation is labelled as such; screenshots alone do not prove backend/provider outcomes.

**Verification:** Playwright commands and accessibility audit with versioned artifacts.

**Deliverables:** Browser evidence bundle; Accessibility findings.

**Evidence:** ["docs/implementation/DELIVERY_RESULT.md", "docs/implementation/INTEGRATION_RELEASE.md", "docs/implementation/RELEASE_2026_10_19.md", "docs/implementation/OBSERVATION_LEARNING.md", "docs/implementation/ADAPTIVE_COMPLETION_RESULT.md"]

### VOX-051 — Run real provider and physical-device E2E

**Owner:** `vox_e2e_runner` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6-luna` · **Size:** L · **Priority:** P1 · **Status:** planned

**Requirements:** REQ-06, REQ-09, REQ-10, REQ-11, REQ-12, REQ-13, REQ-16. **Depends on:** VOX-031, VOX-035, VOX-050.

**When enabling voice_recognition:** VOX-042.

**When enabling browser_push:** VOX-037.

Execute approved core test-account journeys on actual supported Telegram/mobile/browser devices with provider calls and notification receipts. Voice recognition and browser push qualification require their additional capability dependencies; disabled features must be explicitly excluded.

**Acceptance:**

- [ ] End-of-speech to heard audio, interruption/cancellation, notification permissions/delivery and voice fallback have actual evidence.
- [ ] Unavailable hardware/provider/jurisdiction gates remain UNAVAILABLE; no mock substitution.
- [ ] For every enabled audio mode, actual capture/provider traces prove pre-processing permission, new-participant pause and denied-region behavior; unqualified multi-party modes remain disabled.

**Verification:** Human-assisted hardware capture and independent backend trace/receipt correlation.

**Deliverables:** Device/provider qualification matrix; Exact candidate evidence.

### VOX-052 — Qualify load, recovery, deletion and incident response

**Owner:** `vox_release_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** in_progress

**Requirements:** REQ-04, REQ-16, REQ-17, REQ-21. **Depends on:** VOX-018, VOX-014, VOX-030, VOX-035, VOX-047, VOX-049.

**Implementation progress:** Local account sweep pagination, competing leases, crash recovery, expiry, snapshot reconciliation and bounded observer retries tested. Background maintenance is supported only in the persistent file/polling runtime; unsupported activation fails startup. Production load/SLOs, full backup restoration and provider residual deletion remain open.

Load-test approved synthetic workloads, queue/provider outage, lost receipts, restore/tombstones and incident kill switches; set alert owners.

**Acceptance:**

- [ ] Operational SLOs and budgets meet agreed baseline-derived targets.
- [ ] Restore/retry cannot reintroduce deleted data; notification and prediction kill switches function.
- [ ] Clock-driven retention/inactivity drills cover every enabled data class, provider residual status and backup expiry; failed sweeps alert, and expired content stays inaccessible.

**Verification:** Fault/load/recovery drills with exact infrastructure and workload records.

**Deliverables:** Operations qualification; Incident and restore runbook.

**Evidence:** ["docs/implementation/OBSERVATION_LEARNING.md"]

### VOX-053 — Finalize public notices, support and launch materials

**Owner:** `vox_docs_analyst` · **Reviewer:** `vox_privacy_security` · **Model:** `gpt-6-luna` · **Size:** M · **Priority:** P1 · **Status:** planned

**Requirements:** REQ-01, REQ-09, REQ-12, REQ-22. **Depends on:** VOX-002, VOX-012, VOX-032, VOX-048, VOX-056.

**When enabling voice_recognition:** VOX-038, VOX-042.

Align public privacy/biometric notices and English/Persian UX/support content with implemented data routes, retention, providers and actual enabled markets.

**Acceptance:**

- [ ] No placeholders, unsupported zero-retention claims or missing operator/contact remain in published notices.
- [ ] Human legal/privacy owner approves final notice and product behavior; policy version matches receipts.

**Verification:** Copy-to-implementation traceability and legal/localization review.

**Deliverables:** Launch notice/support package; Approval/version record.

### VOX-054 — Run independent release gate and staged production pilot

**Owner:** `vox_release_engineer` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** L · **Priority:** P1 · **Status:** planned

**Requirements:** REQ-16, REQ-18, REQ-21, REQ-22. **Depends on:** VOX-049, VOX-050, VOX-052, VOX-053, VOX-047, VOX-051.

**When enabling voice_recognition:** VOX-042.

**When enabling browser_push:** VOX-037.

Assemble exact artifact/CI/config/migration/legal evidence and rollout separately for core versus voice/push enabled capabilities; run controlled pilot.

**Acceptance:**

- [ ] Every enabled capability satisfies required physical/provider gates; core can exclude unqualified voice or browser push explicitly.
- [ ] Deployment revision and live target behavior are verified independently; human release owner authorizes production activation.

**Verification:** Go/no-go checklist and canary rollout receipts with rollback rehearsal.

**Deliverables:** Release decision packet; Pilot monitoring and rollback record.

### VOX-055 — Close pilot with measured outcomes and next-release decision

**Owner:** `vox_product_lead` · **Reviewer:** `vox_qa_evaluator` · **Model:** `gpt-6.1-sol` · **Size:** M · **Priority:** P1 · **Status:** planned

**Requirements:** REQ-05, REQ-08, REQ-10, REQ-16, REQ-18, REQ-21. **Depends on:** VOX-054, VOX-048.

Reconcile pilot exposures/outcomes, guardrails, latency/cost, opt-outs and complaints; decide keep/rollback/iterate with accountable owners.

**Acceptance:**

- [ ] Insufficient or conflicting evidence keeps baseline or extends study under approved limits.
- [ ] No automatic broad launch based solely on engagement, model self-grades or a successful deploy.

**Verification:** Independent analysis at assignment unit with confidence intervals and user feedback.

**Deliverables:** Pilot outcome report; Prioritized follow-up backlog.

