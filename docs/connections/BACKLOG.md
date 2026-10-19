# Connections delivery backlog

Generated from [BACKLOG.json](BACKLOG.json), the canonical source. JSON SHA256: `dcf0e1d93a80fe1580c5642817ba8e94c6339d1a5b7823df2b8ad7d76645478c`.

Historical planning baseline `42a1a57113e655b6185ddc731b6f9617aaa4bb4e`. Current implementation baseline `d8d6766f4e7148e83ec4f85208974e00e3570c34`; combined runtime source is frozen at `cae9d1e` with independent held-out tests and the exact manifest in [IMPLEMENTATION_REVIEW.md](evidence/IMPLEMENTATION_REVIEW.md). A separate compiled artifact is required for deployment.

The user authorized end-to-end implementation and production work in this chat. Source paths and synthetic fixtures are implemented; a globally disabled source/UI rollout of e28fc8d was independently verified on Mac Studio. No live provider account, private provider data, real external effect, broker/worker activation or scheduled production execution was exercised. See RELEASE_PACKET.md for the exact rollout boundary.

Source implementation and synthetic fixtures do not close account, device, infrastructure or release qualification. Production provider effects are hard-disabled independently in Studio and broker; read-only capabilities require explicit qualified per-account/scope inventory.

Source implementation, synthetic evidence and account/device/deployment admission are tracked separately. No task is marked complete on author assertion. Original requirements, dependency graph and acceptance criteria below remain the task closure contract. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the current bounded status.

## Task index

| ID | Status | Task | Source |
|---|---|---|---|
| CONN-001 | in_progress | [Freeze pilot scope, resource/action catalogue and decision owners](#conn-001) | partial |
| CONN-002 | in_progress | [Freeze Studio setup, grants and action-review experience](#conn-002) | implemented |
| CONN-003 | in_progress | [Freeze independent threat model, fixtures and outbound oracle](#conn-003) | partial |
| CONN-004 | in_progress | [Select broker, vault, normalized persistence and protocol topology](#conn-004) | implemented |
| CONN-005 | in_progress | [Implement normalized connection records and verified grant authority](#conn-005) | implemented |
| CONN-006 | in_progress | [Implement isolated broker, vault enrollment and fenced refresh](#conn-006) | implemented |
| CONN-007 | in_progress | [Implement pre-model tool and destination policy gates](#conn-007) | partial |
| CONN-008 | in_progress | [Implement source lineage, revoke suppression and deletion replay fences](#conn-008) | partial |
| CONN-009 | in_progress | [Implement complete synthetic Studio connection journey](#conn-009) | implemented |
| CONN-010 | in_progress | [Independently qualify the synthetic application and broker slice](#conn-010) | partial |
| CONN-011 | qualification_unavailable | [Qualify GitHub selected-repository read pilot](#conn-011) | implemented |
| CONN-012 | qualification_unavailable | [Qualify Notion selected-resource remote MCP pilot](#conn-012) | partial |
| CONN-013 | in_progress | [Implement durable effects, approval receipts and uncertain recovery](#conn-013) | implemented |
| CONN-014 | in_progress | [Implement exact action review and durable status UI](#conn-014) | partial |
| CONN-015 | qualification_unavailable | [Qualify reviewed GitHub draft PR and selected Notion updates](#conn-015) | partial |
| CONN-016 | qualification_unavailable | [Qualify selected Google Drive, Docs, Sheets and Slides output](#conn-016) | implemented |
| CONN-017 | qualification_unavailable | [Qualify Slack workspace/channel reads and reviewed posting](#conn-017) | implemented |
| CONN-018 | qualification_unavailable | [Qualify bounded git.joyixir.com Forgejo adapter](#conn-018) | implemented |
| CONN-019 | qualification_unavailable | [Qualify existing Gamend MCP delegated operations](#conn-019) | implemented |
| CONN-020 | qualification_unavailable | [Qualify GA and PostHog scoped analytics reads](#conn-020) | implemented |
| CONN-021 | qualification_unavailable | [Qualify private Gmail read/draft and separately reviewed send](#conn-021) | implemented |
| CONN-022 | qualification_unavailable | [Qualify Figma selected-file capabilities and reviewed changes](#conn-022) | partial |
| CONN-023 | qualification_unavailable | [Qualify Hetzner project inventory and bounded cloud actions](#conn-023) | partial |
| CONN-024 | qualification_unavailable | [Qualify isolated SSH workers and named server runbooks](#conn-024) | partial |
| CONN-025 | qualification_unavailable | [Qualify isolated Chrome browser workflows](#conn-025) | partial |
| CONN-026 | in_progress | [Implement signed provider event inbox and scoped triggers](#conn-026) | implemented |
| CONN-027 | in_progress | [Implement reviewed schedules and bounded proactive workflows](#conn-027) | implemented |
| CONN-028 | in_progress | [Implement scoped budgets, health, metrics and executor kill switches](#conn-028) | partial |
| CONN-029 | in_progress | [Implement versioned runtime skills with capability-bound evaluation](#conn-029) | implemented |
| CONN-030 | in_progress | [Independently evaluate integrated pilot and admission gates](#conn-030) | partial |
| CONN-031 | not_run | [Run authorized real-account and actual Telegram device journeys](#conn-031) | not_run |
| CONN-032 | not_run | [Qualify per-capability canary, rollback and operator handoff](#conn-032) | partial |

## CONN-001

**Freeze pilot scope, resource/action catalogue and decision owners** · C0 · M · **in_progress**

Owner: `vox_connection_lead`. Independent reviewer: `vox_connection_qa`.

Dependencies: none. Requirements: CR-01, CR-02, CR-05, CR-11, CR-12, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-05, CONN-QA-23.

Choose GitHub selected repositories and Notion selected resources as the first private Work pilot. Record exact read and later write tasks, disabled actions, resource-selection semantics, decision owners, privacy/provider prerequisites and spend/retention decisions.

Current implementation: Planning contracts and read-only pilot boundaries documented; full provider/admission owner sign-offs remain open.

Artifacts: `docs/connections/IMPLEMENTATION_CONTRACT.md`, `docs/connections/IMPLEMENTATION_STATUS.md`.

Acceptance:
- CR-01–15 have measurable acceptance and named owners; fixture work remains independent of unresolved account eligibility.
- Pilot lists exact supported effects and forbidden merge/deploy/credential operations; no account-wide crawl or automatic grants.
- Each unresolved CD decision identifies the dependent activation gate; later providers do not become prerequisites for the first pilot.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-002

**Freeze Studio setup, grants and action-review experience** · C0 · M · **in_progress**

Owner: `vox_connection_designer`. Independent reviewer: `vox_connection_qa`.

Dependencies: none. Requirements: CR-01, CR-02, CR-04, CR-05, CR-07, CR-13. QA: CONN-QA-03, CONN-QA-14, CONN-QA-24, CONN-QA-25, CONN-QA-27.

Design existing-pattern Studio entry, provider identity, selected resources/actions/agents, reconnect/revoke, review, status and uncertain-outcome states with EN/FA and RTL/accessibility specifications.

Current implementation: Connections and bounded workflow screens have EN/FA setup, grants, review, status and pause flows; real-device acceptance remains unavailable.

Artifacts: `src/app/studio/_components/screens/Connections.tsx`, `src/app/studio/_components/screens/ConnectionWorkflows.tsx`.

Acceptance:
- Connect alone assigns no agent; account, connection and grant are visually distinguishable.
- Read/local drafts proceed inside current grants; effect review shows exact account, recipients, content, attachments, revisions and expiry without obscuring material details.
- Wrong account, cancelled provider consent, failed return link, offline state and partial scopes have recoverable flows; accessibility and device cases are specified.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-003

**Freeze independent threat model, fixtures and outbound oracle** · C0 · L · **in_progress**

Owner: `vox_connection_security`. Independent reviewer: `vox_connection_qa`.

Dependencies: none. Requirements: CR-03, CR-06, CR-08, CR-09, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-18, CONN-QA-19, CONN-QA-20, CONN-QA-21, CONN-QA-22, CONN-QA-28, CONN-QA-29, CONN-QA-30.

Freeze adversarial EN/FA fixtures, protected deterministic network/model/log assertions, effect classes, evidence levels, oracle ownership and independent review rules before adapter code.

Current implementation: Independent adversarial fixtures and source review exist; no production IAM or complete protected admission oracle qualification is claimed.

Artifacts: `docs/connections/evidence/IMPLEMENTATION_REVIEW.md`.

Acceptance:
- Private/source/secret canaries cover inputs, arguments, headers, results, history, derived context, logs and external destinations.
- Protected evaluation and promotion fixtures are independently controlled; authors cannot change the oracle or release rules to pass.
- Unknown outcomes, stale permissions and missing target-isolation evidence block the affected capability regardless of model quality.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-004

**Select broker, vault, normalized persistence and protocol topology** · C0 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`.

Dependencies: none. Requirements: CR-01, CR-03, CR-04, CR-09, CR-10, CR-14. QA: CONN-QA-06, CONN-QA-16, CONN-QA-17, CONN-QA-20, CONN-QA-22, CONN-QA-28.

Resolve deployable service/IAM/network/store choices, auth-flow and lease transactions, MCP modern/legacy profiles, exact SDK qualification plan, secret lifecycle and compatibility/rollback before implementation.

Current implementation: Normalized repositories, separate broker HTTP process, authenticated control channel, encrypted vault and UID startup checks implemented.

Artifacts: `src/lib/connections/storage.ts`, `src/lib/connections/broker/`, `docs/connections/BROKER_OPERATIONS.md`.

Acceptance:
- Studio, broker, vault and browser/SSH privileges have enforceable boundaries and exact owned identities, not role-text isolation.
- Storage supports normalized grants, auth flows, operations, outbox, leases, revisions and tombstones; studio/state is not expanded.
- MCP 2026-07-28 and needed legacy profiles have an explicit compatibility test/pin plan; no unsupported package/account availability claim.
- Provider webhooks and broker startup do not start, configure or replace Telegram polling.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-005

**Implement normalized connection records and verified grant authority** · C1 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-001, CONN-003, CONN-004. Requirements: CR-01, CR-02, CR-03, CR-08, CR-13. QA: CONN-QA-01, CONN-QA-02, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-22.

Implement strict versioned account/connection/grant/resource metadata repository, identity binding, exact scope/audience authority, expected revisions, lifecycle transitions and denied-by-default server APIs.

Current implementation: Verified current-person/scope authority, strict normalized records, zero-grant enrollment and explicit exact agent grants implemented with transactional file/memory/Firestore paths.

Artifacts: `src/lib/connections/contracts.ts`, `src/lib/connections/repository.ts`, `src/lib/connections/service.ts`.

Acceptance:
- Person/account/provider subject and tenant/space/container/agent/action/resource identities remain separate; connecting creates zero grants.
- Admin, public agent, successor, stale group, unknown audience, cross-tenant and guessed-ID cases deny before content or vault access.
- Concurrent grant/revoke/update operations use expected revisions and normalized indexes; corrupt/duplicate authoritative records fail closed.
- Actual service rules deny direct client access to credentials, restricted metadata and internal receipt stores.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-006

**Implement isolated broker, vault enrollment and fenced refresh** · C1 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-003, CONN-004, CONN-005. Requirements: CR-01, CR-06, CR-09, CR-10, CR-14. QA: CONN-QA-04, CONN-QA-06, CONN-QA-17, CONN-QA-19, CONN-QA-21, CONN-QA-22.

Implement broker service authentication, per-adapter credential handles, vault IAM/envelopes, secure non-chat credential enrollment, OAuth secret storage, refresh serialization, egress enforcement and key rotation/restore.

Current implementation: PKCE/state-bound GitHub/Google OAuth seal-and-claim, verified operator token enrollment, separate encrypted vault, fenced refresh/revoke and startup isolation checks implemented; actual provider and target identity remain unavailable.

Artifacts: `src/lib/connections/broker/`, `scripts/connections-broker.mjs`.

Acceptance:
- Studio/frontend/LLM/ordinary observers cannot decrypt; cross-tenant ciphertext/handle swapping and stale leases fail.
- PKCE/token/refresh/key material stays out of DTOs, logs, traces, URLs and ordinary database exports.
- Refresh race/crash/rotation ambiguity quarantines safely; provider credential rotation differs from KMS key rotation and both are tested.
- Network policy blocks metadata/private/redirect/DNS-rebinding escapes; no ambient developer credentials, host sockets or bot polling.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-007

**Implement pre-model tool and destination policy gates** · C1 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-001, CONN-003, CONN-005. Requirements: CR-02, CR-03, CR-06, CR-10, CR-13. QA: CONN-QA-01, CONN-QA-02, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-12, CONN-QA-20.

Implement reviewed normalized catalogue, strict argument/result schemas, resource mapping, effect classification, data egress/source intersection and scoped tool runtime integrated into PersonaGateway and typed LLM adapters.

Current implementation: Code-owned catalog and isolated Studio model task bridge enforce per-generation source/destination policy; native provider effects are disabled and general Telegram/voice tool orchestration is not admitted.

Artifacts: `src/lib/connections/task-runtime.ts`, `src/lib/connections/policy.ts`, `src/lib/connections/catalog.ts`.

Acceptance:
- No private source, resource title, argument, query, result or derived hint enters an unauthorized model/provider destination, including read tools.
- Provider hints, schema changes, imported instructions and sampling/roots/elicitation do not create authority; drift quarantines affected tools.
- Exact audience/space/current actor/agent/provider/resource/purpose intersection is rechecked before each input, call, continuation and delivery.
- Text-only chat fallback remains usable; no generic URL, headers, SQL, shell or generated-prose execution exists.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-008

**Implement source lineage, revoke suppression and deletion replay fences** · C1 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-003, CONN-005, CONN-007. Requirements: CR-02, CR-03, CR-08, CR-13. QA: CONN-QA-02, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13.

Carry connection/resource/grant/source revisions through results, history, summaries, memory, caches and queues. Enforce immediate suppression and invalidation before any first real provider call.

Current implementation: Recursive source lineage, current grant/person/agent checks, immediate suppression and replay tombstones implemented; global history/vector/cache/backup purge acknowledgment remains pending.

Artifacts: `src/lib/connections/lineage.ts`, `src/lib/connections/service.ts`.

Acceptance:
- Revoke, disconnect, person switch, agent firing and group membership changes cancel dependent work and clear unsent restricted buffers.
- Derived content retains source intersection/expiry and cannot be copied to Personal, groups, another learner or another agent implicitly.
- Deletion/restore/retry/reconnect/index rebuild consult tombstones; source-derived retrieval is suppressed before later physical purge completion.
- Purge, provider revocation, backup expiry and already delivered copies have truthful separate receipts.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-009

**Implement complete synthetic Studio connection journey** · C1 · L · **in_progress**

Owner: `vox_connection_frontend`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-002, CONN-005, CONN-006, CONN-007, CONN-008. Requirements: CR-01, CR-02, CR-03, CR-04, CR-07, CR-10, CR-13. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-05, CONN-QA-11, CONN-QA-12, CONN-QA-21, CONN-QA-25, CONN-QA-27.

Implement fake-provider setup/callback/claim, resource/agent grant controls, safe metadata/status views and sourced read through the actual isolated broker boundary using synthetic credentials/data only.

Current implementation: Synthetic real HTTP/application/model/broker/React journey and EN/FA local browser evidence exist; provider/device journey remains unavailable.

Artifacts: `e2e/connections/`, `docs/connections/evidence/IMPLEMENTATION_REVIEW.md`.

Acceptance:
- Connect → external-style callback without Mini App header → fresh authenticated claim → select resource/agent → read with source → revoke works end to end.
- Flow state binds initiating person, provider issuer/resource, agent/scope, PKCE, exact callback and expiry; callback alone activates no grant.
- Wrong/replayed/expired callback/account and failed return deep link are recoverable and disclose no secret or protected metadata.
- EN/FA/RTL/accessibility and core chat/call regression fixtures pass without changing Telegram transport.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-010

**Independently qualify the synthetic application and broker slice** · C1 · L · **in_progress**

Owner: `vox_connection_qa`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-003, CONN-005, CONN-006, CONN-007, CONN-008, CONN-009. Requirements: CR-01, CR-02, CR-03, CR-04, CR-06, CR-07, CR-08, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-20, CONN-QA-21, CONN-QA-22, CONN-QA-25, CONN-QA-27, CONN-QA-28.

Run frozen independent policy/model/network/log oracle, real isolated datastore/queue/rules concurrency cases and Studio browser journey against an immutable synthetic candidate. No provider account traffic.

Current implementation: Independent finite synthetic security, lifecycle, transport, UI and worker fixtures run; final frozen candidate acceptance and target admission remain open.

Artifacts: `src/lib/connections/__tests__/integration-*.test.ts`, `src/lib/connections/__tests__/security-*.test.ts`, `docs/connections/evidence/IMPLEMENTATION_REVIEW.md`.

Acceptance:
- Report exact candidate/config/oracle digest, fixtures, PASS/FAIL/UNAVAILABLE, unauthorized outbound observations and concurrency/revocation results.
- Secret/source canaries are absent from every forbidden destination; scope, lineage and revocation tests pass at actual broker boundary.
- Reviewer independently accepts results; runner cannot modify product/oracle/thresholds.
- Missing isolation, durable audit or source-suppression evidence blocks all real provider calls.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-011

**Qualify GitHub selected-repository read pilot** · C2 · M · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-001, CONN-006, CONN-007, CONN-008, CONN-010, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Implement narrow GitHub App API adapter for selected repository/issue/PR/code/CI reads, safe pagination/source receipts and installation-resource mapping; qualify fixture and authorized real-account profiles separately.

Current implementation: Typed GitHub repository/issue/PR reads and native identity qualification have fixtures; no real account/installation/repository permission evidence.

Artifacts: `src/lib/connections/providers/github.ts`, `src/lib/connections/broker/provider-identity.ts`.

Acceptance:
- Admission record documents exact app registration, installation permissions/repos, provider identity, rate limits, versions and disabled merge/deploy/write/secret actions.
- Selection is enforced before tool descriptions/search results enter the model; revoked installation/repository rights stop use.
- Synthetic adverse cases pass; real authorized test account confirms only selected read capabilities with source IDs/revisions and sanitized evidence.
- No initial real call occurs until shared lineage/revocation/policy/vault/broker/synthetic acceptance and budget gates are complete.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-012

**Qualify Notion selected-resource remote MCP pilot** · C2 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-001, CONN-006, CONN-007, CONN-008, CONN-010, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Implement first-party Notion remote MCP adapter with explicit protocol/auth profile, reviewed tools and resource membership mapping; deny broad results when selected-resource enforcement cannot be proven.

Current implementation: Notion typed REST api_bridge reads and bot.workspace_id identity implemented; planned remote MCP profile and real workspace qualification are unavailable.

Artifacts: `src/lib/connections/providers/notion.ts`, `src/lib/connections/broker/provider-identity.ts`.

Acceptance:
- Exact SDK/profile/auth/client eligibility is qualified with an independent peer and stored admission record; no all-account tools exposed by default.
- OAuth callback, scopes, refresh/revoke and selected page/resource access survive current-policy checks before model input.
- Broad search that cannot prove permitted membership is unavailable or uses a separately reviewed narrow API profile, never silent credential expansion.
- Fixture proof and explicitly authorized real-account read evidence remain separate; shared pre-real-call gates are satisfied.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-013

**Implement durable effects, approval receipts and uncertain recovery** · C3 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-004, CONN-005, CONN-006, CONN-007, CONN-008, CONN-010. Requirements: CR-04, CR-05, CR-08, CR-10, CR-14. QA: CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-26.

Implement normalized operation/attempt/outbox ledger, exact idempotency digest, one-use action receipts, fenced leases, expected revisions, dispatch boundary, provider evidence levels, cancellation and reconciliation.

Current implementation: Durable operation/outbox/attempt ledger, exact digest-bound approvals, fenced claims, explicit unknown outcomes and ephemeral loss recovery implemented; effects stay production-disabled.

Artifacts: `src/lib/connections/operations.ts`, `src/lib/connections/service.ts`.

Acceptance:
- Duplicate key+same digest converges; changed tool/target/input conflicts; stale workers cannot overwrite current receipts.
- Crash/timeout after possible dispatch yields reconciling/unknown, never automatic fresh-key retry, browser fallback or false success.
- Cancellation before/after dispatch and success distinguishes stopped, pending, committed and undo/compensation; approval/source/target drift invalidates execution.
- Transactional durable intent/audit/budget reservation is required before consequential dispatch; rollback retains unknown-operation resolution.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-014

**Implement exact action review and durable status UI** · C3 · M · **in_progress**

Owner: `vox_connection_frontend`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-002, CONN-009, CONN-013. Requirements: CR-04, CR-05, CR-07, CR-10. QA: CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-24, CONN-QA-25, CONN-QA-27.

Implement preview/review/approve/deny, recipients/attachments/diff/resource-revision display and resumable operation receipts using existing Studio patterns; preserve consent and action distinctions.

Current implementation: Exact preview/review and operation status APIs/fixtures exist; production effects remain hidden/disabled pending independent external audience/source proof.

Artifacts: `src/lib/connections/http.ts`, `src/app/studio/_components/screens/Connections.tsx`.

Acceptance:
- Material action details are readable in EN/FA/RTL and accessible without truncated recipients/targets.
- Wrong person/account, offline stale preview, duplicate tap, changed payload/revision or expired approval creates zero unintended effects.
- Provider acceptance/delivery/verified result, uncertain outcome, cancellation and irreversible effects are separate honest states after reload/reconnect.
- Already authorized unchanged standing workflow does not prompt redundantly; widening requires explicit new review.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-015

**Qualify reviewed GitHub draft PR and selected Notion updates** · C3 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-011, CONN-012, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-25.

Extend pilot adapters with named bounded writes: draft PR on exact repo/base/ref from an isolated authored patch and selected Notion page update. Keep merge/deploy and unsupported write semantics disabled.

Current implementation: GitHub draft PR and selected Notion write adapters are fixture-qualified only. Production dispatch rejects all effects beyond read.

Artifacts: `src/lib/connections/providers/github.ts`, `src/lib/connections/providers/notion.ts`.

Acceptance:
- Writes cannot dispatch without current durable effects contract and exact review UI receipts; diffs bind target/source revisions and grant.
- Preserve authored work, branch protections and provider concurrency controls; unsupported idempotency leaves reconcile-only behavior explicit.
- Fixture lost-response/retry/cancel/conflict and injection cases pass before a separately authorized harmless real-account write/readback.
- Record provider receipt/evidence, cleanup and unknown states; no merge, publish, production deployment or credential-returning capability admitted.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-016

**Qualify selected Google Drive, Docs, Sheets and Slides output** · C3 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-07, CR-10, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-24, CONN-QA-27.

Create per-capability Google admission dossier; decide official MCP eligibility versus narrow API bridge, incremental scopes, selected-file/range targeting, document edits and readback with no Gmail scopes.

Current implementation: Typed selected Google Drive/Docs/Sheets/Slides read and bounded output adapters have fixtures; account/OAuth/scope/output qualification unavailable and writes disabled.

Artifacts: `src/lib/connections/providers/google.ts`.

Acceptance:
- Eligibility, app verification, scopes and resource selector semantics proven per API/action; unavailable features remain unavailable rather than switch to broader credentials.
- System-browser OAuth/return and partial scope denial work; changing Google subject does not inherit old grants.
- Selected document/sheet/range/slide edits show exact target/diff and expected revision where supported, then native readback/receipt.
- Teaching fixture keeps learners separated; report saving does not disclose a private source to an unauthorized destination.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-017

**Qualify Slack workspace/channel reads and reviewed posting** · C3 · M · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23.

Create Slack installation/identity/scope dossier and typed read/draft/post adapter limited to selected team/enterprise/channel resources; events stay disabled until trigger gates.

Current implementation: Slack selected channel identity/history and reviewed post adapter fixtures exist; exact workspace/channel/scopes and external recipients unqualified, posting disabled.

Artifacts: `src/lib/connections/providers/slack.ts`.

Acceptance:
- Bot/user/enterprise/team identities and scopes stay distinct; no email-based workspace merging or automatic scope expansion.
- Channel/resource authority precedes model results; source data cannot silently enter another channel or external search.
- Exact posting preview binds channel/thread/body/attachments; provider acceptance differs from downstream delivery.
- Signature/event contract is documented for later webhook task; installing alone enables no proactive workflow.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-018

**Qualify bounded git.joyixir.com Forgejo adapter** · C3 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-30.

Audit authorized instance version/auth/token narrowing, then implement named repository/issue/PR/CI reads and reviewed draft-PR path with dedicated scoped credentials; no general API or broad OAuth.

Current implementation: Fixed-origin bounded Forgejo reads and write fixtures implemented; installed instance/token/version and real repository rights unqualified.

Artifacts: `src/lib/connections/providers/forgejo.ts`.

Acceptance:
- Current instance/API/token restriction evidence is recorded separately from public Forgejo docs; unsupported narrowing blocks enablement.
- Broad OAuth user tokens unavailable; broker enforces repository/method/action restrictions even if underlying token is wider.
- Repository Git credentials are distinct from API credentials; no unrestricted SSH, merge, workflow dispatch, branch-protection edit or deployment authority.
- Lost/unknown writes reconcile via declared provider contract; no nearby-object guess or blind resend.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-019

**Qualify existing Gamend MCP delegated operations** · C4 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-11, CR-12, CR-15. QA: CONN-QA-01, CONN-QA-04, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-20, CONN-QA-21, CONN-QA-23, CONN-QA-29.

Reuse existing /v1/mcp and native context/discover/describe/preview/execute/status; verify deployed protocol/admission through an authorized test identity, map Vox scopes and preserve native receipts.

Current implementation: Finite Gamend MCP envelopes and native delegated identity/resource adapters implemented; real membership/token/capability evidence unavailable.

Artifacts: `src/lib/connections/providers/gamend.ts`, `src/lib/connections/broker/provider-identity.ts`.

Acceptance:
- Organization/game/environment/current-membership/production/sensitive-operation constraints intersect at both systems; source baseline is not called live admission.
- Named operation descriptors govern broad execute and credential-returning/release/operator actions remain excluded.
- One stable request ID/digest maps to native receipt/status; uncertain mutation never executes again blindly.
- Metric source/cohort/build/timezone/freshness/QA compatibility and regional restrictions are preserved; unsupported values remain unavailable.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-020

**Qualify GA and PostHog scoped analytics reads** · C4 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-010, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-06, CR-10, CR-12, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-05, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Provide separate GA property and PostHog project/data-region admission records and bounded reviewed report/insight reads; no generic PostHog exec, SQL, write flags or configuration tools.

Current implementation: Bounded GA/PostHog aggregate insight reads with exact resources and fixture-normalized outputs implemented; real tenant/cohort/metric evidence unavailable.

Artifacts: `src/lib/connections/providers/analytics.ts`.

Acceptance:
- Each provider has independently qualified auth/profile, project/property selector, dimensions/metrics/rate/thresholding and row limits.
- Answers carry metric definition, cohort/date/platform/build/timezone/identity/QA compatibility, freshness and completeness; absent fields are unavailable.
- No raw player/user export or unrestricted query interface; private report data does not enter another provider query or shared audience.
- Provider reads are individually enableable; saving a report uses a separately qualified write adapter/review contract.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-021

**Qualify private Gmail read/draft and separately reviewed send** · C4 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-10, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-24, CONN-QA-25.

Create Gmail restricted/sensitive-scope and retention dossier; implement private selected message/thread read and local drafts before a separately admitted exact-recipient send capability.

Current implementation: Personal-only exact Gmail read/draft/send adapters have fixtures; real mailbox/scope/recipient delivery unqualified and external effects disabled.

Artifacts: `src/lib/connections/providers/gmail.ts`.

Acceptance:
- No automatic mailbox crawl/ingestion/memory; Google subject, granted scopes and required verification are proven before relevant activation.
- Private mail cannot influence Work/group answers, public queries or reusable skills; malicious mail instructions never create approval.
- Send preview includes sender, all To/Cc/Bcc recipients, full body/attachments and thread context; stable operation handles unknown acceptance without blind resend.
- Read/draft and send have separate admission states and kill switches; provider acceptance is not recipient delivery.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-022

**Qualify Figma selected-file capabilities and reviewed changes** · C4 · M · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-05, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Confirm custom-client/seat eligibility and remote MCP versus REST/local-worker boundaries; expose selected-file/frame reads and only supported separately reviewed native changes.

Current implementation: Figma selected-node/file inspection and identity implemented; canvas mutation capability and actual file/plan/scope qualification unavailable.

Artifacts: `src/lib/connections/providers/figma.ts`.

Acceptance:
- Admission enumerates actually supported read/write actions by account/client; no universal entitlement or edit claim.
- Team/project/file/frame selection and image/download policy apply before model input; developer localhost never substitutes for user Figma.
- Native design/token/component inspection and any verified native change are distinguished from generated screenshot evidence.
- Unsupported effects stay disabled; supported writes bind target/revision/diff and run through durable review/reconcile controls.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-023

**Qualify Hetzner project inventory and bounded cloud actions** · C5 · L · **qualification_unavailable**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-09, CR-10, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-04, CONN-QA-05, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-23, CONN-QA-26.

Implement selected Cloud project/resource read inventory first; separate Cloud/Robot/Storage Box profiles and keys; qualify individually approved lifecycle actions with billing and recovery constraints.

Current implementation: Hetzner selected-server reads and bounded lifecycle adapter fixtures implemented; account/project identity is explicitly credential-resource evidence, actual billing/write/recovery unqualified and effects disabled.

Artifacts: `src/lib/connections/providers/hetzner.ts`, `src/lib/connections/broker/provider-identity.ts`.

Acceptance:
- Exact project/token/action permissions and costs are recorded; inventory grants never imply SSH/server access.
- Restart/resize/delete/paid creation are distinct reviewed effects on exact resource/environment; default remains read-only.
- Native operation status/idempotency and uncertain cancel/recovery behavior are tested with authorized disposable resources before activation.
- Cloud credentials cannot reach production signing/release controls; no automatic regional or provider failover writes.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-024

**Qualify isolated SSH workers and named server runbooks** · C5 · L · **qualification_unavailable**

Owner: `vox_connection_runner`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-006, CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-09, CR-10, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-06, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-19, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-26.

Implement separately isolated SSH worker with named target/user/verified host key, structured command templates, service-diagnostic readbacks and separately approved runbooks; no generic shell.

Current implementation: Isolated SSH reader and forced-command runbook source plus fixtures implemented; no disposable SSH host, attested enrollment or target host-key/IAM journey performed. Guarded signed release-attestation enrollment and per-account/scope runner bootstrap are implemented; actual target attestation and SSH admission remain unavailable.

Artifacts: `src/lib/connections/runners/`, `services/connections-runner/`, `docs/connections/RUNNER_OPERATIONS.md`.

Acceptance:
- Host keys independently verified; changed keys, shell injection, traversal/symlink, network/agent forwarding and host socket/mount escapes deny.
- Dedicated non-root principal and one-operation lease expose only named paths/args/targets with CPU/time/output caps; ambient developer SSH material absent.
- Disconnect/cancel/revoke does not claim a remote process stopped without remote operation status; unknown runbook effects reconcile.
- Authorized disposable-host E2E and actual sandbox/IAM evidence are independent prerequisites; existing Mac Studio production is never an incidental test target.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-025

**Qualify isolated Chrome browser workflows** · C5 · L · **qualification_unavailable**

Owner: `vox_connection_runner`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-006, CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-09, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-06, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-18, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-26.

Qualify pinned Chrome DevTools MCP or typed browser worker with per-owner/space profile, bounded origins/network/files, protected login handoff and exact action semantics; begin with selected read workflows.

Current implementation: Isolated offline Chromium public-page reader implemented and actually exercised in a local immutable Docker image; authenticated/interactive browser and deployed isolation unqualified. Guarded signed release-attestation enrollment and per-account/scope runner bootstrap are implemented; actual target attestation and SSH admission remain unavailable.

Artifacts: `src/lib/connections/runners/`, `services/connections-runner/`, `docs/connections/RUNNER_OPERATIONS.md`.

Acceptance:
- No personal browser profile, password manager, host files, exposed DevTools endpoint, shared cookies or unrestricted extensions; telemetry settings explicitly reviewed.
- Navigation/popup/redirect/upload/download and DOM/screenshot outputs obey egress/source policy before model visibility; active downloads never execute in Studio.
- Login/MFA/passkey/consent remains secure human handoff, not automated OAuth browser; session teardown/revocation verified.
- Consequential click/submit needs deterministic reviewed meaning; unsupported idempotency/reconciliation keeps writes unavailable or explicitly unknown.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-026

**Implement signed provider event inbox and scoped triggers** · C6 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-005, CONN-007, CONN-008, CONN-010, CONN-013, CONN-028. Requirements: CR-02, CR-03, CR-05, CR-06, CR-08, CR-10, CR-13, CR-14. QA: CONN-QA-06, CONN-QA-08, CONN-QA-11, CONN-QA-13, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-26.

Implement provider-specific raw-byte signature/auth validation, durable inbox/dedupe/revisions, subscription ownership and explicit trigger rules; no installation-created automation or message-content authority.

Current implementation: Broker-only GitHub/Slack raw-byte signatures, exact subscription metadata, keyed body replay dedupe, minimized durable event inbox and native-readback gate implemented; real provider hook setup unavailable.

Artifacts: `src/lib/connections/events/`, `src/lib/connections/broker/service.ts`.

Acceptance:
- Invalid signature, wrong tenant/subscription, duplicate/out-of-order/replayed/revoked-source events fail or converge before any dependent action.
- Durably accept minimized event before acknowledgment; callback routing token alone is not authentication.
- Rules bind authorizer/agent/source/action/audience/purpose/expiry/budget and current policy; provider install grants none.
- Feedback/causation chain caps and native state readback prevent loops; no provider event endpoint configures Telegram webhooks.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-027

**Implement reviewed schedules and bounded proactive workflows** · C6 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-013, CONN-014, CONN-026, CONN-028, CONN-029. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-21, CONN-QA-25, CONN-QA-26, CONN-QA-27.

Implement explicit workflow authoring/review, schedule/timezone, permitted variable sources and recipients, pause/kill/expiry, quiet delivery and per-occurrence action grants using the shared ledger.

Current implementation: Explicit immutable reviewed read workflows, interval/daily timezone schedules, quiet hours, DST dedupe, stable ledger IDs and signed worker drain implemented. No hidden scheduler or unsolicited external delivery enabled.

Artifacts: `src/lib/connections/workflows/`, `src/lib/connections/triggers/`, `docs/connections/WORKFLOW_OPERATIONS.md`.

Acceptance:
- Each occurrence stays inside approved trigger/resources/recipient/template/effect/cost envelope and rechecks current source/grants; no new authority from runtime skill.
- Changed target/recipient/template/source or exceeded limits requires renewed authorization; unchanged authorized occurrence does not prompt repeatedly.
- Duplicate/DST/clock/replay, late revoke, pause, cancel and crash cases converge without duplicate effects or revoked-content recreation.
- Unchanged/nonactionable monitoring stays quiet unless periodic status requested; external notification details follow existing current-recipient consent rules.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-028

**Implement scoped budgets, health, metrics and executor kill switches** · C1 · M · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-004, CONN-005, CONN-006, CONN-007. Requirements: CR-04, CR-10, CR-14, CR-15. QA: CONN-QA-04, CONN-QA-05, CONN-QA-11, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-22, CONN-QA-26.

Implement provider/tenant/agent/connection/action/worker flags, budget reservation/metering, safe health facts, circuit breakers, paginated/tool-chain limits, sanitized audit and operator status.

Current implementation: Durable explicit daily model/tool reservations, per-grant/workflow ceilings, current profile kill gates and safe operation status implemented; full health/circuit-breaker/metrics/cost/target outage qualification remains open.

Artifacts: `src/lib/connections/budgets.ts`, `src/lib/connections/runtime.ts`, `src/lib/connections/studio-application.ts`.

Acceptance:
- No paid capability without an explicit configured ceiling; retries/polling/discarded speculation/worker/model cost counts and concurrent reservations cannot overspend.
- Kill switches apply in executor and queue/retry paths; scoped outage does not break unconnected conversation.
- Health distinguishes credential/scopes/policy/catalog/network/provider/resource/webhook/worker facts with checked times; one ping is not feature proof.
- Unsampled minimized audit, no secret/body/header leakage, metric denominators/QA exclusion/completeness and incident owner are documented/tested.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-029

**Implement versioned runtime skills with capability-bound evaluation** · C6 · L · **in_progress**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-12, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-27, CONN-QA-28.

Implement reviewed runtime manifest/load/version/rollback and seven initial synthetic workflow packages: knowledge, teaching progress, engineering triage, product analytics, private mail, design and operations observer.

Current implementation: Seven code-owned versioned runtime skill packages with capability-bound selection and no source persistence implemented; external model/provider evaluation and multi-version rollout remain unqualified.

Artifacts: `src/lib/connections/skills.ts`, `src/lib/connections/task-runtime.ts`.

Acceptance:
- Skill capability requirements resolve only to existing current grants; imported Markdown cannot request credentials, widen actions or change protected policy/model.
- Skill data and collaboration artifacts retain lineage and receiving-agent rights; private content never embeds into reusable instruction bundles.
- Each workflow has happy/missing-grant/injection/stale/conflict/outage/uncertain cases with EN/FA and supported Vietnamese request coverage.
- Missing provider actions remain unavailable; one skill rolls back without widening permissions or disconnecting unrelated agents.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-030

**Independently evaluate integrated pilot and admission gates** · C7 · L · **in_progress**

Owner: `vox_connection_qa`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-003, CONN-010, CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, CONN-028, CONN-029. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-20, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-25, CONN-QA-26, CONN-QA-27, CONN-QA-28.

Freeze exact integrated GitHub/Notion read/write candidate and independently evaluate protected synthetic and authorized provider evidence; establish reusable per-capability gate template for later waves.

Current implementation: Independent integrated source/fixture review exists, including local offline browser smoke. Real per-capability account/latency/cost/revocation/provider admission is unavailable.

Artifacts: `docs/connections/evidence/IMPLEMENTATION_REVIEW.md`.

Acceptance:
- Immutable source/configuration/SDK/catalog/policy/fixture hashes and author/evaluator separation are recorded; no metric average offsets unauthorized disclosure/effect.
- Full pilot security, recovery, mixed-language, side-effect review, receipts and existing Studio regression cases pass or block precisely scoped capabilities.
- Set numeric latency/revocation/purge/cost/recovery thresholds and denominators before canary; no invented benchmark or zero for unavailable evidence.
- Later adapters repeat this gate for their own capability without becoming mandatory prerequisites for pilot release; unknown provider/device/isolation gates remain unavailable.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-031

**Run authorized real-account and actual Telegram device journeys** · C7 · L · **not_run**

Owner: `vox_connection_qa`. Independent reviewer: `vox_connection_security`.

Dependencies: CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, CONN-028, CONN-030. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-07, CR-10, CR-14, CR-15. QA: CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-24, CONN-QA-25, CONN-QA-27.

Run frozen pilot journeys using separately authorized minimal real test accounts/resources and physical Telegram iOS/Android plus Desktop/supported browser, including OAuth handoff/background/reconnect and harmless reviewed effects.

Current implementation: No real provider account authorization or physical Telegram device journey was performed.

Artifacts: `docs/connections/IMPLEMENTATION_STATUS.md`.

Acceptance:
- Capture exact provider subject/tenant/scopes/resources, device/app versions, candidate, source IDs and actual provider receipt/readback; mock/CI health never substitutes.
- Wrong-account callbacks/approval links, deep-link failure, app termination, declined scopes, expiry/revoke and interrupted tool/voice flows behave correctly.
- EN/FA/RTL/accessibility and actual user review of full recipients/targets work; test recipients/resources/cleanup explicitly recorded.
- Runner does not alter implementation/oracle/promote; unavailable device/provider cases block affected public capability and remain labeled unavailable.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.

## CONN-032

**Qualify per-capability canary, rollback and operator handoff** · C7 · L · **not_run**

Owner: `vox_connection_release`. Independent reviewer: `vox_connection_qa`.

Dependencies: CONN-028, CONN-030, CONN-031. Requirements: CR-02, CR-03, CR-04, CR-05, CR-07, CR-08, CR-09, CR-10, CR-14, CR-15. QA: CONN-QA-11, CONN-QA-13, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-24, CONN-QA-26, CONN-QA-27, CONN-QA-28.

Prepare/protect exact artifact/configuration, IAM/vault/network/backup checks, live canary/rollback/unknown-operation drill and operator handoff. Pilot excludes unqualified later adapters; repeat this task gate for each independently admitted later capability.

Current implementation: Globally disabled source/UI e28fc8d installed and independently checked on Mac Studio. No enabled-provider canary, target broker/worker IAM, key rotation or executed rollback drill.

Artifacts: `docs/connections/BROKER_OPERATIONS.md`, `docs/connections/IMPLEMENTATION_STATUS.md`.

Acceptance:
- Fresh preflight records existing Mac Studio revision and sole Telegram polling owner; release changes neither bot transport mode nor production secrets incidentally.
- Explicitly authorized deployment proves exact artifact, target IAM/rules, real provider/user journey, budgets/kill switches and staged read/write canary; source/CI/deploy/device evidence stays separate.
- Rollback stops new and queued execution but preserves grants/tombstones/current revocation, audits and reconciliation of dispatched/unknown effects; restore cannot resurrect secrets/data.
- Named on-call owns rotation, revoke, cost/health incidents and provider status; capability-specific release record lists enabled tools, scopes, evidence and disabled reasons.
- Later Google/Slack/Forgejo/Gamend/analytics/Gmail/Figma/Hetzner/server/browser/automation additions need their own CONN-030/031/032 evidence instances, never automatic release from pilot evidence.

Original external boundary (historical planning guard; current authorized implementation scope is stated above): Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence level: source/synthetic references only. Provider, device and deployment **UNAVAILABLE**; production effects **DISABLED**.
