# Connections delivery backlog

Generated from [BACKLOG.json](BACKLOG.json), the canonical source. JSON SHA256: `8c345fcb0f95029a0cf97dbb10e55df72152fcc0be2149267ef936756531d719`. Regenerate this view after changing JSON; do not maintain task copies independently.

Planning baseline `42a1a57113e655b6185ddc731b6f9617aaa4bb4e` · 19 October 2026 · **32 tasks, all planned, no execution evidence.**

This backlog is a plan, not permission to implement, connect accounts, access live data, spend, send messages, administer hosts or deploy. Future assignments determine authorized scope. Honor authorization already established in that assignment; do not invent extra approval ceremonies.

All nine development roles use **GPT-6.1 Sol / high**. Owners and independent reviewers are distinct. S/M/L are relative complexity, not dates. Paths are proposed later ownership; the lead must serialize overlapping gateway, provider, operations, fixtures and UI edits.

## Dependency and activation rules

- All proposed paths are reservations for later assignments, not ownership of current unrelated dirty work. Lead serializes overlapping files and narrows dispatch ownership before edits.
- CONN-001–004 can start concurrently within four slots where paths do not overlap; dependencies must pass independent acceptance before dependent activation.
- First real provider call requires accepted identity/grants, isolated vault/broker, pre-model/destination policy, source-lineage/revocation/suppression, synthetic E2E and budget/kill controls.
- An adapter may implement fixtures before account eligibility is available, but cannot claim real/provider-ready status or bypass missing prerequisites.
- Effects require CONN-013 durable execution and CONN-014 exact review UI. Standing workflows additionally require CONN-027 bounded authorization; model/tool text never grants action authority.
- CONN-030–032 are reusable per-capability acceptance/release gates. Initial pilot is GitHub and Notion; later adapter tasks are not a monolithic prerequisite or automatic admission.
- No task closes on author assertion alone. Evidence records exact candidate/config/provider/account/device/profile, independent reviewer, results and unavailable gates.

The complete synthetic gate is CONN-010. First real pilot reads are CONN-011/012 and also depend on CONN-028 controls. Shared effect and review tasks CONN-013/014 precede effectful provider work. Initial pilot release is CONN-032; later providers repeat independent CONN-030/031/032 evidence for their own tools/actions. A stage label expresses delivery grouping, not permission to skip a dependency.

## Task index

| ID | Stage | Size | Task | Owner → independent reviewer | Dependencies |
|---|---|---|---|---|---|
| CONN-001 | C0 | M | [Freeze pilot scope, resource/action catalogue and decision owners](#conn-001) | vox_connection_lead → vox_connection_qa | none |
| CONN-002 | C0 | M | [Freeze Studio setup, grants and action-review experience](#conn-002) | vox_connection_designer → vox_connection_qa | none |
| CONN-003 | C0 | L | [Freeze independent threat model, fixtures and outbound oracle](#conn-003) | vox_connection_security → vox_connection_qa | none |
| CONN-004 | C0 | L | [Select broker, vault, normalized persistence and protocol topology](#conn-004) | vox_connection_platform → vox_connection_security | none |
| CONN-005 | C1 | L | [Implement normalized connection records and verified grant authority](#conn-005) | vox_connection_platform → vox_connection_security | CONN-001, CONN-003, CONN-004 |
| CONN-006 | C1 | L | [Implement isolated broker, vault enrollment and fenced refresh](#conn-006) | vox_connection_platform → vox_connection_security | CONN-003, CONN-004, CONN-005 |
| CONN-007 | C1 | L | [Implement pre-model tool and destination policy gates](#conn-007) | vox_connection_platform → vox_connection_security | CONN-001, CONN-003, CONN-005 |
| CONN-008 | C1 | L | [Implement source lineage, revoke suppression and deletion replay fences](#conn-008) | vox_connection_platform → vox_connection_qa | CONN-003, CONN-005, CONN-007 |
| CONN-009 | C1 | L | [Implement complete synthetic Studio connection journey](#conn-009) | vox_connection_frontend → vox_connection_qa | CONN-002, CONN-005, CONN-006, CONN-007, CONN-008 |
| CONN-010 | C1 | L | [Independently qualify the synthetic application and broker slice](#conn-010) | vox_connection_qa → vox_connection_security | CONN-003, CONN-005, CONN-006, CONN-007, CONN-008, CONN-009 |
| CONN-011 | C2 | M | [Qualify GitHub selected-repository read pilot](#conn-011) | vox_connection_adapter → vox_connection_qa | CONN-001, CONN-006, CONN-007, CONN-008, CONN-010, CONN-028 |
| CONN-012 | C2 | L | [Qualify Notion selected-resource remote MCP pilot](#conn-012) | vox_connection_adapter → vox_connection_qa | CONN-001, CONN-006, CONN-007, CONN-008, CONN-010, CONN-028 |
| CONN-013 | C3 | L | [Implement durable effects, approval receipts and uncertain recovery](#conn-013) | vox_connection_platform → vox_connection_security | CONN-004, CONN-005, CONN-006, CONN-007, CONN-008, CONN-010 |
| CONN-014 | C3 | M | [Implement exact action review and durable status UI](#conn-014) | vox_connection_frontend → vox_connection_qa | CONN-002, CONN-009, CONN-013 |
| CONN-015 | C3 | L | [Qualify reviewed GitHub draft PR and selected Notion updates](#conn-015) | vox_connection_adapter → vox_connection_qa | CONN-011, CONN-012, CONN-013, CONN-014, CONN-028 |
| CONN-016 | C3 | L | [Qualify selected Google Drive, Docs, Sheets and Slides output](#conn-016) | vox_connection_adapter → vox_connection_qa | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-017 | C3 | M | [Qualify Slack workspace/channel reads and reviewed posting](#conn-017) | vox_connection_adapter → vox_connection_qa | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-018 | C3 | L | [Qualify bounded git.joyixir.com Forgejo adapter](#conn-018) | vox_connection_adapter → vox_connection_security | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-019 | C4 | L | [Qualify existing Gamend MCP delegated operations](#conn-019) | vox_connection_adapter → vox_connection_security | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-020 | C4 | L | [Qualify GA and PostHog scoped analytics reads](#conn-020) | vox_connection_adapter → vox_connection_qa | CONN-010, CONN-028 |
| CONN-021 | C4 | L | [Qualify private Gmail read/draft and separately reviewed send](#conn-021) | vox_connection_adapter → vox_connection_security | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-022 | C4 | M | [Qualify Figma selected-file capabilities and reviewed changes](#conn-022) | vox_connection_adapter → vox_connection_qa | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-023 | C5 | L | [Qualify Hetzner project inventory and bounded cloud actions](#conn-023) | vox_connection_adapter → vox_connection_security | CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-024 | C5 | L | [Qualify isolated SSH workers and named server runbooks](#conn-024) | vox_connection_runner → vox_connection_security | CONN-006, CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-025 | C5 | L | [Qualify isolated Chrome browser workflows](#conn-025) | vox_connection_runner → vox_connection_security | CONN-006, CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-026 | C6 | L | [Implement signed provider event inbox and scoped triggers](#conn-026) | vox_connection_platform → vox_connection_security | CONN-005, CONN-007, CONN-008, CONN-010, CONN-013, CONN-028 |
| CONN-027 | C6 | L | [Implement reviewed schedules and bounded proactive workflows](#conn-027) | vox_connection_platform → vox_connection_qa | CONN-013, CONN-014, CONN-026, CONN-028, CONN-029 |
| CONN-028 | C1 | M | [Implement scoped budgets, health, metrics and executor kill switches](#conn-028) | vox_connection_platform → vox_connection_qa | CONN-004, CONN-005, CONN-006, CONN-007 |
| CONN-029 | C6 | L | [Implement versioned runtime skills with capability-bound evaluation](#conn-029) | vox_connection_platform → vox_connection_qa | CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028 |
| CONN-030 | C7 | L | [Independently evaluate integrated pilot and admission gates](#conn-030) | vox_connection_qa → vox_connection_security | CONN-003, CONN-010, CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, CONN-028, CONN-029 |
| CONN-031 | C7 | L | [Run authorized real-account and actual Telegram device journeys](#conn-031) | vox_connection_qa → vox_connection_security | CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, CONN-028, CONN-030 |
| CONN-032 | C7 | L | [Qualify per-capability canary, rollback and operator handoff](#conn-032) | vox_connection_release → vox_connection_qa | CONN-028, CONN-030, CONN-031 |

## CONN-001

**Freeze pilot scope, resource/action catalogue and decision owners** · C0 · M · **planned**

Owner: `vox_connection_lead`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: none. Requirements: CR-01, CR-02, CR-05, CR-11, CR-12, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-05, CONN-QA-23.

Choose GitHub selected repositories and Notion selected resources as the first private Work pilot. Record exact read and later write tasks, disabled actions, resource-selection semantics, decision owners, privacy/provider prerequisites and spend/retention decisions.

Proposed owned paths:
- `docs/connections/PLAN.md`
- `docs/connections/RESEARCH.md`
- `docs/connections/DECISIONS.md (new)`

Acceptance:
- CR-01–15 have measurable acceptance and named owners; fixture work remains independent of unresolved account eligibility.
- Pilot lists exact supported effects and forbidden merge/deploy/credential operations; no account-wide crawl or automatic grants.
- Each unresolved CD decision identifies the dependent activation gate; later providers do not become prerequisites for the first pilot.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-002

**Freeze Studio setup, grants and action-review experience** · C0 · M · **planned**

Owner: `vox_connection_designer`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: none. Requirements: CR-01, CR-02, CR-04, CR-05, CR-07, CR-13. QA: CONN-QA-03, CONN-QA-14, CONN-QA-24, CONN-QA-25, CONN-QA-27.

Design existing-pattern Studio entry, provider identity, selected resources/actions/agents, reconnect/revoke, review, status and uncertain-outcome states with EN/FA and RTL/accessibility specifications.

Proposed owned paths:
- `docs/connections/EXPERIENCE.md`
- `docs/connections/UX_ACCEPTANCE.md (new)`

Acceptance:
- Connect alone assigns no agent; account, connection and grant are visually distinguishable.
- Read/local drafts proceed inside current grants; effect review shows exact account, recipients, content, attachments, revisions and expiry without obscuring material details.
- Wrong account, cancelled provider consent, failed return link, offline state and partial scopes have recoverable flows; accessibility and device cases are specified.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-003

**Freeze independent threat model, fixtures and outbound oracle** · C0 · L · **planned**

Owner: `vox_connection_security`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: none. Requirements: CR-03, CR-06, CR-08, CR-09, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-18, CONN-QA-19, CONN-QA-20, CONN-QA-21, CONN-QA-22, CONN-QA-28, CONN-QA-29, CONN-QA-30.

Freeze adversarial EN/FA fixtures, protected deterministic network/model/log assertions, effect classes, evidence levels, oracle ownership and independent review rules before adapter code.

Proposed owned paths:
- `docs/connections/SECURITY_AND_QA.md`
- `tests/connections/fixtures/** (new protected fixtures)`
- `tests/connections/oracle/** (new protected oracle)`

Acceptance:
- Private/source/secret canaries cover inputs, arguments, headers, results, history, derived context, logs and external destinations.
- Protected evaluation and promotion fixtures are independently controlled; authors cannot change the oracle or release rules to pass.
- Unknown outcomes, stale permissions and missing target-isolation evidence block the affected capability regardless of model quality.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-004

**Select broker, vault, normalized persistence and protocol topology** · C0 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: none. Requirements: CR-01, CR-03, CR-04, CR-09, CR-10, CR-14. QA: CONN-QA-06, CONN-QA-16, CONN-QA-17, CONN-QA-20, CONN-QA-22, CONN-QA-28.

Resolve deployable service/IAM/network/store choices, auth-flow and lease transactions, MCP modern/legacy profiles, exact SDK qualification plan, secret lifecycle and compatibility/rollback before implementation.

Proposed owned paths:
- `docs/connections/ARCHITECTURE.md`
- `docs/connections/BROKER_ADR.md (new)`
- `docs/connections/PROTOCOL_PROFILES.md (new)`

Acceptance:
- Studio, broker, vault and browser/SSH privileges have enforceable boundaries and exact owned identities, not role-text isolation.
- Storage supports normalized grants, auth flows, operations, outbox, leases, revisions and tombstones; studio/state is not expanded.
- MCP 2026-07-28 and needed legacy profiles have an explicit compatibility test/pin plan; no unsupported package/account availability claim.
- Provider webhooks and broker startup do not start, configure or replace Telegram polling.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-005

**Implement normalized connection records and verified grant authority** · C1 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-001, CONN-003, CONN-004. Requirements: CR-01, CR-02, CR-03, CR-08, CR-13. QA: CONN-QA-01, CONN-QA-02, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-22.

Implement strict versioned account/connection/grant/resource metadata repository, identity binding, exact scope/audience authority, expected revisions, lifecycle transitions and denied-by-default server APIs.

Proposed owned paths:
- `src/lib/connections/contracts.ts (new)`
- `src/lib/connections/repository.ts (new)`
- `src/lib/connections/storage/** (new)`
- `src/lib/connections/authority.ts (new)`

Acceptance:
- Person/account/provider subject and tenant/space/container/agent/action/resource identities remain separate; connecting creates zero grants.
- Admin, public agent, successor, stale group, unknown audience, cross-tenant and guessed-ID cases deny before content or vault access.
- Concurrent grant/revoke/update operations use expected revisions and normalized indexes; corrupt/duplicate authoritative records fail closed.
- Actual service rules deny direct client access to credentials, restricted metadata and internal receipt stores.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-006

**Implement isolated broker, vault enrollment and fenced refresh** · C1 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-003, CONN-004, CONN-005. Requirements: CR-01, CR-06, CR-09, CR-10, CR-14. QA: CONN-QA-04, CONN-QA-06, CONN-QA-17, CONN-QA-19, CONN-QA-21, CONN-QA-22.

Implement broker service authentication, per-adapter credential handles, vault IAM/envelopes, secure non-chat credential enrollment, OAuth secret storage, refresh serialization, egress enforcement and key rotation/restore.

Proposed owned paths:
- `src/lib/connections/broker/** (new)`
- `src/lib/connections/vault/** (new)`
- `infra/connections/broker/** (new)`
- `tests/connections/vault/** (new)`

Acceptance:
- Studio/frontend/LLM/ordinary observers cannot decrypt; cross-tenant ciphertext/handle swapping and stale leases fail.
- PKCE/token/refresh/key material stays out of DTOs, logs, traces, URLs and ordinary database exports.
- Refresh race/crash/rotation ambiguity quarantines safely; provider credential rotation differs from KMS key rotation and both are tested.
- Network policy blocks metadata/private/redirect/DNS-rebinding escapes; no ambient developer credentials, host sockets or bot polling.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-007

**Implement pre-model tool and destination policy gates** · C1 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-001, CONN-003, CONN-005. Requirements: CR-02, CR-03, CR-06, CR-10, CR-13. QA: CONN-QA-01, CONN-QA-02, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-12, CONN-QA-20.

Implement reviewed normalized catalogue, strict argument/result schemas, resource mapping, effect classification, data egress/source intersection and scoped tool runtime integrated into PersonaGateway and typed LLM adapters.

Proposed owned paths:
- `src/lib/connections/policy/** (new)`
- `src/lib/connections/catalog/** (new)`
- `src/lib/connections/runtime/** (new)`
- `src/lib/tireh/gateway.ts (bounded integration)`
- `src/lib/tireh/llm.ts (typed tool/abort seam)`

Acceptance:
- No private source, resource title, argument, query, result or derived hint enters an unauthorized model/provider destination, including read tools.
- Provider hints, schema changes, imported instructions and sampling/roots/elicitation do not create authority; drift quarantines affected tools.
- Exact audience/space/current actor/agent/provider/resource/purpose intersection is rechecked before each input, call, continuation and delivery.
- Text-only chat fallback remains usable; no generic URL, headers, SQL, shell or generated-prose execution exists.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-008

**Implement source lineage, revoke suppression and deletion replay fences** · C1 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-003, CONN-005, CONN-007. Requirements: CR-02, CR-03, CR-08, CR-13. QA: CONN-QA-02, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13.

Carry connection/resource/grant/source revisions through results, history, summaries, memory, caches and queues. Enforce immediate suppression and invalidation before any first real provider call.

Proposed owned paths:
- `src/lib/connections/lineage/** (new)`
- `src/lib/connections/revocation/** (new)`
- `src/lib/tireh/gateway.ts (coordinated narrow change)`
- `src/lib/adaptive/shared/service.ts (lineage integration if required)`
- `tests/connections/revocation/** (new)`

Acceptance:
- Revoke, disconnect, person switch, agent firing and group membership changes cancel dependent work and clear unsent restricted buffers.
- Derived content retains source intersection/expiry and cannot be copied to Personal, groups, another learner or another agent implicitly.
- Deletion/restore/retry/reconnect/index rebuild consult tombstones; source-derived retrieval is suppressed before later physical purge completion.
- Purge, provider revocation, backup expiry and already delivered copies have truthful separate receipts.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-009

**Implement complete synthetic Studio connection journey** · C1 · L · **planned**

Owner: `vox_connection_frontend`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-002, CONN-005, CONN-006, CONN-007, CONN-008. Requirements: CR-01, CR-02, CR-03, CR-04, CR-07, CR-10, CR-13. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-05, CONN-QA-11, CONN-QA-12, CONN-QA-21, CONN-QA-25, CONN-QA-27.

Implement fake-provider setup/callback/claim, resource/agent grant controls, safe metadata/status views and sourced read through the actual isolated broker boundary using synthetic credentials/data only.

Proposed owned paths:
- `src/lib/connections/service.ts (new)`
- `src/lib/connections/http.ts (new)`
- `src/app/api/studio/connections/** (new)`
- `src/app/api/connections/oauth/** (new)`
- `src/app/studio/_components/connections/** (new)`
- `tests/connections/fake-provider/** (new)`

Acceptance:
- Connect → external-style callback without Mini App header → fresh authenticated claim → select resource/agent → read with source → revoke works end to end.
- Flow state binds initiating person, provider issuer/resource, agent/scope, PKCE, exact callback and expiry; callback alone activates no grant.
- Wrong/replayed/expired callback/account and failed return deep link are recoverable and disclose no secret or protected metadata.
- EN/FA/RTL/accessibility and core chat/call regression fixtures pass without changing Telegram transport.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-010

**Independently qualify the synthetic application and broker slice** · C1 · L · **planned**

Owner: `vox_connection_qa`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-003, CONN-005, CONN-006, CONN-007, CONN-008, CONN-009. Requirements: CR-01, CR-02, CR-03, CR-04, CR-06, CR-07, CR-08, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-20, CONN-QA-21, CONN-QA-22, CONN-QA-25, CONN-QA-27, CONN-QA-28.

Run frozen independent policy/model/network/log oracle, real isolated datastore/queue/rules concurrency cases and Studio browser journey against an immutable synthetic candidate. No provider account traffic.

Proposed owned paths:
- `tests/connections/e2e/** (new runner-owned scripts only)`
- `docs/connections/evidence/CONN-010/** (new sanitized evidence)`

Acceptance:
- Report exact candidate/config/oracle digest, fixtures, PASS/FAIL/UNAVAILABLE, unauthorized outbound observations and concurrency/revocation results.
- Secret/source canaries are absent from every forbidden destination; scope, lineage and revocation tests pass at actual broker boundary.
- Reviewer independently accepts results; runner cannot modify product/oracle/thresholds.
- Missing isolation, durable audit or source-suppression evidence blocks all real provider calls.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-011

**Qualify GitHub selected-repository read pilot** · C2 · M · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-001, CONN-006, CONN-007, CONN-008, CONN-010, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Implement narrow GitHub App API adapter for selected repository/issue/PR/code/CI reads, safe pagination/source receipts and installation-resource mapping; qualify fixture and authorized real-account profiles separately.

Proposed owned paths:
- `src/lib/connections/adapters/github/** (new)`
- `tests/connections/providers/github/** (new)`
- `docs/connections/admission/github.json (new)`

Acceptance:
- Admission record documents exact app registration, installation permissions/repos, provider identity, rate limits, versions and disabled merge/deploy/write/secret actions.
- Selection is enforced before tool descriptions/search results enter the model; revoked installation/repository rights stop use.
- Synthetic adverse cases pass; real authorized test account confirms only selected read capabilities with source IDs/revisions and sanitized evidence.
- No initial real call occurs until shared lineage/revocation/policy/vault/broker/synthetic acceptance and budget gates are complete.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-012

**Qualify Notion selected-resource remote MCP pilot** · C2 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-001, CONN-006, CONN-007, CONN-008, CONN-010, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Implement first-party Notion remote MCP adapter with explicit protocol/auth profile, reviewed tools and resource membership mapping; deny broad results when selected-resource enforcement cannot be proven.

Proposed owned paths:
- `src/lib/connections/adapters/notion/** (new)`
- `tests/connections/providers/notion/** (new)`
- `docs/connections/admission/notion.json (new)`

Acceptance:
- Exact SDK/profile/auth/client eligibility is qualified with an independent peer and stored admission record; no all-account tools exposed by default.
- OAuth callback, scopes, refresh/revoke and selected page/resource access survive current-policy checks before model input.
- Broad search that cannot prove permitted membership is unavailable or uses a separately reviewed narrow API profile, never silent credential expansion.
- Fixture proof and explicitly authorized real-account read evidence remain separate; shared pre-real-call gates are satisfied.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-013

**Implement durable effects, approval receipts and uncertain recovery** · C3 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-004, CONN-005, CONN-006, CONN-007, CONN-008, CONN-010. Requirements: CR-04, CR-05, CR-08, CR-10, CR-14. QA: CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-26.

Implement normalized operation/attempt/outbox ledger, exact idempotency digest, one-use action receipts, fenced leases, expected revisions, dispatch boundary, provider evidence levels, cancellation and reconciliation.

Proposed owned paths:
- `src/lib/connections/operations/** (new)`
- `src/lib/connections/workers/effects/** (new)`
- `tests/connections/operations/** (new)`

Acceptance:
- Duplicate key+same digest converges; changed tool/target/input conflicts; stale workers cannot overwrite current receipts.
- Crash/timeout after possible dispatch yields reconciling/unknown, never automatic fresh-key retry, browser fallback or false success.
- Cancellation before/after dispatch and success distinguishes stopped, pending, committed and undo/compensation; approval/source/target drift invalidates execution.
- Transactional durable intent/audit/budget reservation is required before consequential dispatch; rollback retains unknown-operation resolution.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-014

**Implement exact action review and durable status UI** · C3 · M · **planned**

Owner: `vox_connection_frontend`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-002, CONN-009, CONN-013. Requirements: CR-04, CR-05, CR-07, CR-10. QA: CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-24, CONN-QA-25, CONN-QA-27.

Implement preview/review/approve/deny, recipients/attachments/diff/resource-revision display and resumable operation receipts using existing Studio patterns; preserve consent and action distinctions.

Proposed owned paths:
- `src/app/studio/_components/connections/ActionReview.tsx (new)`
- `src/app/studio/_components/connections/OperationStatus.tsx (new)`
- `src/app/api/studio/connection-operations/** (new)`
- `tests/connections/ui/action-review/** (new)`

Acceptance:
- Material action details are readable in EN/FA/RTL and accessible without truncated recipients/targets.
- Wrong person/account, offline stale preview, duplicate tap, changed payload/revision or expired approval creates zero unintended effects.
- Provider acceptance/delivery/verified result, uncertain outcome, cancellation and irreversible effects are separate honest states after reload/reconnect.
- Already authorized unchanged standing workflow does not prompt redundantly; widening requires explicit new review.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-015

**Qualify reviewed GitHub draft PR and selected Notion updates** · C3 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-011, CONN-012, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-25.

Extend pilot adapters with named bounded writes: draft PR on exact repo/base/ref from an isolated authored patch and selected Notion page update. Keep merge/deploy and unsupported write semantics disabled.

Proposed owned paths:
- `src/lib/connections/adapters/github/writes/** (new)`
- `src/lib/connections/adapters/notion/writes/** (new)`
- `tests/connections/providers/pilot-writes/** (new)`
- `docs/connections/admission/pilot-writes.json (new)`

Acceptance:
- Writes cannot dispatch without current durable effects contract and exact review UI receipts; diffs bind target/source revisions and grant.
- Preserve authored work, branch protections and provider concurrency controls; unsupported idempotency leaves reconcile-only behavior explicit.
- Fixture lost-response/retry/cancel/conflict and injection cases pass before a separately authorized harmless real-account write/readback.
- Record provider receipt/evidence, cleanup and unknown states; no merge, publish, production deployment or credential-returning capability admitted.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-016

**Qualify selected Google Drive, Docs, Sheets and Slides output** · C3 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-07, CR-10, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-24, CONN-QA-27.

Create per-capability Google admission dossier; decide official MCP eligibility versus narrow API bridge, incremental scopes, selected-file/range targeting, document edits and readback with no Gmail scopes.

Proposed owned paths:
- `src/lib/connections/adapters/google-workspace/** (new)`
- `tests/connections/providers/google-workspace/** (new)`
- `docs/connections/admission/google-workspace.json (new)`

Acceptance:
- Eligibility, app verification, scopes and resource selector semantics proven per API/action; unavailable features remain unavailable rather than switch to broader credentials.
- System-browser OAuth/return and partial scope denial work; changing Google subject does not inherit old grants.
- Selected document/sheet/range/slide edits show exact target/diff and expected revision where supported, then native readback/receipt.
- Teaching fixture keeps learners separated; report saving does not disclose a private source to an unauthorized destination.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-017

**Qualify Slack workspace/channel reads and reviewed posting** · C3 · M · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-12, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23.

Create Slack installation/identity/scope dossier and typed read/draft/post adapter limited to selected team/enterprise/channel resources; events stay disabled until trigger gates.

Proposed owned paths:
- `src/lib/connections/adapters/slack/** (new)`
- `tests/connections/providers/slack/** (new)`
- `docs/connections/admission/slack.json (new)`

Acceptance:
- Bot/user/enterprise/team identities and scopes stay distinct; no email-based workspace merging or automatic scope expansion.
- Channel/resource authority precedes model results; source data cannot silently enter another channel or external search.
- Exact posting preview binds channel/thread/body/attachments; provider acceptance differs from downstream delivery.
- Signature/event contract is documented for later webhook task; installing alone enables no proactive workflow.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-018

**Qualify bounded git.joyixir.com Forgejo adapter** · C3 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-30.

Audit authorized instance version/auth/token narrowing, then implement named repository/issue/PR/CI reads and reviewed draft-PR path with dedicated scoped credentials; no general API or broad OAuth.

Proposed owned paths:
- `src/lib/connections/adapters/forgejo/** (new)`
- `tests/connections/providers/forgejo/** (new)`
- `docs/connections/admission/forgejo.json (new)`

Acceptance:
- Current instance/API/token restriction evidence is recorded separately from public Forgejo docs; unsupported narrowing blocks enablement.
- Broad OAuth user tokens unavailable; broker enforces repository/method/action restrictions even if underlying token is wider.
- Repository Git credentials are distinct from API credentials; no unrestricted SSH, merge, workflow dispatch, branch-protection edit or deployment authority.
- Lost/unknown writes reconcile via declared provider contract; no nearby-object guess or blind resend.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-019

**Qualify existing Gamend MCP delegated operations** · C4 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-11, CR-12, CR-15. QA: CONN-QA-01, CONN-QA-04, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-20, CONN-QA-21, CONN-QA-23, CONN-QA-29.

Reuse existing /v1/mcp and native context/discover/describe/preview/execute/status; verify deployed protocol/admission through an authorized test identity, map Vox scopes and preserve native receipts.

Proposed owned paths:
- `src/lib/connections/adapters/gamend/** (new)`
- `tests/connections/providers/gamend/** (new)`
- `docs/connections/admission/gamend.json (new)`

Acceptance:
- Organization/game/environment/current-membership/production/sensitive-operation constraints intersect at both systems; source baseline is not called live admission.
- Named operation descriptors govern broad execute and credential-returning/release/operator actions remain excluded.
- One stable request ID/digest maps to native receipt/status; uncertain mutation never executes again blindly.
- Metric source/cohort/build/timezone/freshness/QA compatibility and regional restrictions are preserved; unsupported values remain unavailable.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-020

**Qualify GA and PostHog scoped analytics reads** · C4 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-06, CR-10, CR-12, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-05, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Provide separate GA property and PostHog project/data-region admission records and bounded reviewed report/insight reads; no generic PostHog exec, SQL, write flags or configuration tools.

Proposed owned paths:
- `src/lib/connections/adapters/google-analytics/** (new)`
- `src/lib/connections/adapters/posthog/** (new)`
- `tests/connections/providers/analytics/** (new)`
- `docs/connections/admission/google-analytics.json (new)`
- `docs/connections/admission/posthog.json (new)`

Acceptance:
- Each provider has independently qualified auth/profile, project/property selector, dimensions/metrics/rate/thresholding and row limits.
- Answers carry metric definition, cohort/date/platform/build/timezone/identity/QA compatibility, freshness and completeness; absent fields are unavailable.
- No raw player/user export or unrestricted query interface; private report data does not enter another provider query or shared audience.
- Provider reads are individually enableable; saving a report uses a separately qualified write adapter/review contract.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-021

**Qualify private Gmail read/draft and separately reviewed send** · C4 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-10, CR-13, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-24, CONN-QA-25.

Create Gmail restricted/sensitive-scope and retention dossier; implement private selected message/thread read and local drafts before a separately admitted exact-recipient send capability.

Proposed owned paths:
- `src/lib/connections/adapters/gmail/** (new)`
- `tests/connections/providers/gmail/** (new)`
- `docs/connections/admission/gmail.json (new)`

Acceptance:
- No automatic mailbox crawl/ingestion/memory; Google subject, granted scopes and required verification are proven before relevant activation.
- Private mail cannot influence Work/group answers, public queries or reusable skills; malicious mail instructions never create approval.
- Send preview includes sender, all To/Cc/Bcc recipients, full body/attachments and thread context; stable operation handles unknown acceptance without blind resend.
- Read/draft and send have separate admission states and kill switches; provider acceptance is not recipient delivery.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-022

**Qualify Figma selected-file capabilities and reviewed changes** · C4 · M · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-10, CR-15. QA: CONN-QA-01, CONN-QA-03, CONN-QA-05, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-20, CONN-QA-21, CONN-QA-23.

Confirm custom-client/seat eligibility and remote MCP versus REST/local-worker boundaries; expose selected-file/frame reads and only supported separately reviewed native changes.

Proposed owned paths:
- `src/lib/connections/adapters/figma/** (new)`
- `tests/connections/providers/figma/** (new)`
- `docs/connections/admission/figma.json (new)`

Acceptance:
- Admission enumerates actually supported read/write actions by account/client; no universal entitlement or edit claim.
- Team/project/file/frame selection and image/download policy apply before model input; developer localhost never substitutes for user Figma.
- Native design/token/component inspection and any verified native change are distinguished from generated screenshot evidence.
- Unsupported effects stay disabled; supported writes bind target/revision/diff and run through durable review/reconcile controls.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-023

**Qualify Hetzner project inventory and bounded cloud actions** · C5 · L · **planned**

Owner: `vox_connection_adapter`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-09, CR-10, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-04, CONN-QA-05, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-23, CONN-QA-26.

Implement selected Cloud project/resource read inventory first; separate Cloud/Robot/Storage Box profiles and keys; qualify individually approved lifecycle actions with billing and recovery constraints.

Proposed owned paths:
- `src/lib/connections/adapters/hetzner/** (new)`
- `tests/connections/providers/hetzner/** (new)`
- `docs/connections/admission/hetzner.json (new)`

Acceptance:
- Exact project/token/action permissions and costs are recorded; inventory grants never imply SSH/server access.
- Restart/resize/delete/paid creation are distinct reviewed effects on exact resource/environment; default remains read-only.
- Native operation status/idempotency and uncertain cancel/recovery behavior are tested with authorized disposable resources before activation.
- Cloud credentials cannot reach production signing/release controls; no automatic regional or provider failover writes.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-024

**Qualify isolated SSH workers and named server runbooks** · C5 · L · **planned**

Owner: `vox_connection_runner`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-006, CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-09, CR-10, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-06, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-19, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-26.

Implement separately isolated SSH worker with named target/user/verified host key, structured command templates, service-diagnostic readbacks and separately approved runbooks; no generic shell.

Proposed owned paths:
- `src/lib/connections/workers/ssh/** (new)`
- `src/lib/connections/adapters/server-runbooks/** (new)`
- `infra/connections/ssh-worker/** (new)`
- `tests/connections/workers/ssh/** (new)`
- `docs/connections/admission/server-runbooks.json (new)`

Acceptance:
- Host keys independently verified; changed keys, shell injection, traversal/symlink, network/agent forwarding and host socket/mount escapes deny.
- Dedicated non-root principal and one-operation lease expose only named paths/args/targets with CPU/time/output caps; ambient developer SSH material absent.
- Disconnect/cancel/revoke does not claim a remote process stopped without remote operation status; unknown runbook effects reconcile.
- Authorized disposable-host E2E and actual sandbox/IAM evidence are independent prerequisites; existing Mac Studio production is never an incidental test target.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-025

**Qualify isolated Chrome browser workflows** · C5 · L · **planned**

Owner: `vox_connection_runner`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-006, CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-09, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-06, CONN-QA-08, CONN-QA-09, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-17, CONN-QA-18, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-26.

Qualify pinned Chrome DevTools MCP or typed browser worker with per-owner/space profile, bounded origins/network/files, protected login handoff and exact action semantics; begin with selected read workflows.

Proposed owned paths:
- `src/lib/connections/workers/browser/** (new)`
- `src/lib/connections/adapters/browser/** (new)`
- `infra/connections/browser-worker/** (new)`
- `tests/connections/workers/browser/** (new)`
- `docs/connections/admission/browser.json (new)`

Acceptance:
- No personal browser profile, password manager, host files, exposed DevTools endpoint, shared cookies or unrestricted extensions; telemetry settings explicitly reviewed.
- Navigation/popup/redirect/upload/download and DOM/screenshot outputs obey egress/source policy before model visibility; active downloads never execute in Studio.
- Login/MFA/passkey/consent remains secure human handoff, not automated OAuth browser; session teardown/revocation verified.
- Consequential click/submit needs deterministic reviewed meaning; unsupported idempotency/reconciliation keeps writes unavailable or explicitly unknown.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-026

**Implement signed provider event inbox and scoped triggers** · C6 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-005, CONN-007, CONN-008, CONN-010, CONN-013, CONN-028. Requirements: CR-02, CR-03, CR-05, CR-06, CR-08, CR-10, CR-13, CR-14. QA: CONN-QA-06, CONN-QA-08, CONN-QA-11, CONN-QA-13, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-26.

Implement provider-specific raw-byte signature/auth validation, durable inbox/dedupe/revisions, subscription ownership and explicit trigger rules; no installation-created automation or message-content authority.

Proposed owned paths:
- `src/lib/connections/events/** (new)`
- `src/app/api/connections/webhooks/** (new)`
- `src/lib/connections/triggers/contracts.ts (new)`
- `tests/connections/triggers/events/** (new)`

Acceptance:
- Invalid signature, wrong tenant/subscription, duplicate/out-of-order/replayed/revoked-source events fail or converge before any dependent action.
- Durably accept minimized event before acknowledgment; callback routing token alone is not authentication.
- Rules bind authorizer/agent/source/action/audience/purpose/expiry/budget and current policy; provider install grants none.
- Feedback/causation chain caps and native state readback prevent loops; no provider event endpoint configures Telegram webhooks.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-027

**Implement reviewed schedules and bounded proactive workflows** · C6 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-013, CONN-014, CONN-026, CONN-028, CONN-029. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-21, CONN-QA-25, CONN-QA-26, CONN-QA-27.

Implement explicit workflow authoring/review, schedule/timezone, permitted variable sources and recipients, pause/kill/expiry, quiet delivery and per-occurrence action grants using the shared ledger.

Proposed owned paths:
- `src/lib/connections/workflows/** (new)`
- `src/lib/connections/triggers/scheduler.ts (new)`
- `src/app/studio/_components/connections/WorkflowReview.tsx (new)`
- `tests/connections/workflows/** (new)`

Acceptance:
- Each occurrence stays inside approved trigger/resources/recipient/template/effect/cost envelope and rechecks current source/grants; no new authority from runtime skill.
- Changed target/recipient/template/source or exceeded limits requires renewed authorization; unchanged authorized occurrence does not prompt repeatedly.
- Duplicate/DST/clock/replay, late revoke, pause, cancel and crash cases converge without duplicate effects or revoked-content recreation.
- Unchanged/nonactionable monitoring stays quiet unless periodic status requested; external notification details follow existing current-recipient consent rules.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-028

**Implement scoped budgets, health, metrics and executor kill switches** · C1 · M · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-004, CONN-005, CONN-006, CONN-007. Requirements: CR-04, CR-10, CR-14, CR-15. QA: CONN-QA-04, CONN-QA-05, CONN-QA-11, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-22, CONN-QA-26.

Implement provider/tenant/agent/connection/action/worker flags, budget reservation/metering, safe health facts, circuit breakers, paginated/tool-chain limits, sanitized audit and operator status.

Proposed owned paths:
- `src/lib/connections/operations/budgets.ts (new)`
- `src/lib/connections/health/** (new)`
- `src/lib/connections/controls/** (new)`
- `src/lib/connections/observability/** (new)`
- `docs/connections/OPERATIONS.md (new)`

Acceptance:
- No paid capability without an explicit configured ceiling; retries/polling/discarded speculation/worker/model cost counts and concurrent reservations cannot overspend.
- Kill switches apply in executor and queue/retry paths; scoped outage does not break unconnected conversation.
- Health distinguishes credential/scopes/policy/catalog/network/provider/resource/webhook/worker facts with checked times; one ping is not feature proof.
- Unsampled minimized audit, no secret/body/header leakage, metric denominators/QA exclusion/completeness and incident owner are documented/tested.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-029

**Implement versioned runtime skills with capability-bound evaluation** · C6 · L · **planned**

Owner: `vox_connection_platform`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-007, CONN-008, CONN-010, CONN-013, CONN-014, CONN-028. Requirements: CR-02, CR-03, CR-04, CR-05, CR-06, CR-08, CR-12, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-27, CONN-QA-28.

Implement reviewed runtime manifest/load/version/rollback and seven initial synthetic workflow packages: knowledge, teaching progress, engineering triage, product analytics, private mail, design and operations observer.

Proposed owned paths:
- `src/lib/connections/skills/** (new)`
- `src/runtime-skills/** (new proposed product path)`
- `tests/connections/skills/** (new protected evaluation)`
- `docs/connections/RUNTIME_SKILLS.md`

Acceptance:
- Skill capability requirements resolve only to existing current grants; imported Markdown cannot request credentials, widen actions or change protected policy/model.
- Skill data and collaboration artifacts retain lineage and receiving-agent rights; private content never embeds into reusable instruction bundles.
- Each workflow has happy/missing-grant/injection/stale/conflict/outage/uncertain cases with EN/FA and supported Vietnamese request coverage.
- Missing provider actions remain unavailable; one skill rolls back without widening permissions or disconnecting unrelated agents.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-030

**Independently evaluate integrated pilot and admission gates** · C7 · L · **planned**

Owner: `vox_connection_qa`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-003, CONN-010, CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, CONN-028, CONN-029. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-06, CR-07, CR-08, CR-10, CR-13, CR-14, CR-15. QA: CONN-QA-01, CONN-QA-02, CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-06, CONN-QA-07, CONN-QA-08, CONN-QA-09, CONN-QA-10, CONN-QA-11, CONN-QA-12, CONN-QA-13, CONN-QA-14, CONN-QA-15, CONN-QA-16, CONN-QA-17, CONN-QA-20, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-25, CONN-QA-26, CONN-QA-27, CONN-QA-28.

Freeze exact integrated GitHub/Notion read/write candidate and independently evaluate protected synthetic and authorized provider evidence; establish reusable per-capability gate template for later waves.

Proposed owned paths:
- `docs/connections/evidence/CONN-030/** (new)`
- `docs/connections/ADMISSION_TEMPLATE.md (new)`
- `tests/connections/oracle/** (review only by designated independent owner)`

Acceptance:
- Immutable source/configuration/SDK/catalog/policy/fixture hashes and author/evaluator separation are recorded; no metric average offsets unauthorized disclosure/effect.
- Full pilot security, recovery, mixed-language, side-effect review, receipts and existing Studio regression cases pass or block precisely scoped capabilities.
- Set numeric latency/revocation/purge/cost/recovery thresholds and denominators before canary; no invented benchmark or zero for unavailable evidence.
- Later adapters repeat this gate for their own capability without becoming mandatory prerequisites for pilot release; unknown provider/device/isolation gates remain unavailable.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-031

**Run authorized real-account and actual Telegram device journeys** · C7 · L · **planned**

Owner: `vox_connection_qa`. Independent reviewer: `vox_connection_security`. Both GPT-6.1 Sol / high.

Dependencies: CONN-011, CONN-012, CONN-013, CONN-014, CONN-015, CONN-028, CONN-030. Requirements: CR-01, CR-02, CR-03, CR-04, CR-05, CR-07, CR-10, CR-14, CR-15. QA: CONN-QA-03, CONN-QA-04, CONN-QA-05, CONN-QA-11, CONN-QA-14, CONN-QA-16, CONN-QA-21, CONN-QA-23, CONN-QA-24, CONN-QA-25, CONN-QA-27.

Run frozen pilot journeys using separately authorized minimal real test accounts/resources and physical Telegram iOS/Android plus Desktop/supported browser, including OAuth handoff/background/reconnect and harmless reviewed effects.

Proposed owned paths:
- `tests/connections/device/** (new runner scripts only)`
- `docs/connections/evidence/CONN-031/** (new sanitized receipts)`

Acceptance:
- Capture exact provider subject/tenant/scopes/resources, device/app versions, candidate, source IDs and actual provider receipt/readback; mock/CI health never substitutes.
- Wrong-account callbacks/approval links, deep-link failure, app termination, declined scopes, expiry/revoke and interrupted tool/voice flows behave correctly.
- EN/FA/RTL/accessibility and actual user review of full recipients/targets work; test recipients/resources/cleanup explicitly recorded.
- Runner does not alter implementation/oracle/promote; unavailable device/provider cases block affected public capability and remain labeled unavailable.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## CONN-032

**Qualify per-capability canary, rollback and operator handoff** · C7 · L · **planned**

Owner: `vox_connection_release`. Independent reviewer: `vox_connection_qa`. Both GPT-6.1 Sol / high.

Dependencies: CONN-028, CONN-030, CONN-031. Requirements: CR-02, CR-03, CR-04, CR-05, CR-07, CR-08, CR-09, CR-10, CR-14, CR-15. QA: CONN-QA-11, CONN-QA-13, CONN-QA-16, CONN-QA-17, CONN-QA-21, CONN-QA-22, CONN-QA-23, CONN-QA-24, CONN-QA-26, CONN-QA-27, CONN-QA-28.

Prepare/protect exact artifact/configuration, IAM/vault/network/backup checks, live canary/rollback/unknown-operation drill and operator handoff. Pilot excludes unqualified later adapters; repeat this task gate for each independently admitted later capability.

Proposed owned paths:
- `docs/connections/RELEASE_PACKET.md (new)`
- `docs/connections/RUNBOOKS.md (new)`
- `docs/connections/evidence/CONN-032/** (new)`
- `infra/connections/release/** (new proposed protected configuration)`

Acceptance:
- Fresh preflight records existing Mac Studio revision and sole Telegram polling owner; release changes neither bot transport mode nor production secrets incidentally.
- Explicitly authorized deployment proves exact artifact, target IAM/rules, real provider/user journey, budgets/kill switches and staged read/write canary; source/CI/deploy/device evidence stays separate.
- Rollback stops new and queued execution but preserves grants/tombstones/current revocation, audits and reconciliation of dispatched/unknown effects; restore cannot resurrect secrets/data.
- Named on-call owns rotation, revoke, cost/health incidents and provider status; capability-specific release record lists enabled tools, scopes, evidence and disabled reasons.
- Later Google/Slack/Forgejo/Gamend/analytics/Gmail/Figma/Hetzner/server/browser/automation additions need their own CONN-030/031/032 evidence instances, never automatic release from pilot evidence.

External boundary: Local synthetic work only. Any provider account access, paid call, external effect, host access or deployment requires a separately scoped authorized assignment; this backlog grants none.

Evidence: `[]` — no implementation, test, provider, device or release evidence yet.

## Completion evidence contract

Each evidence item must identify author and independent reviewer; exact commit plus dirty diff/path digest if relevant; configuration/schema/policy/catalog/adapter/SDK/protocol/skill versions; fixture provenance or authorized provider/account scope; device/client version where relevant; command or user journey; timestamp; PASS/FAIL/UNAVAILABLE/NOT_RUN result; sanitized artifact/receipt references; observed limitations; cleanup/rollback and next owner. Do not place credentials, private source text or secret canaries in general artifacts.

A task status becomes complete only at its stated evidence level. Fixture-qualified, account-qualified and production-qualified remain separate. Provider documentation, tools/list, saved credentials, CI and health checks cannot replace actual capability, scope, receipt and device acceptance.
