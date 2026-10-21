# Vox Studio Connections — delivery plan

**Status, 20 October 2026:** this is the original planning package. The capability is implemented and merged, read-only and disabled until an operator qualifies an account; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

19 October 2026 · Planning package v1 · Source baseline `42a1a57113e655b6185ddc731b6f9617aaa4bb4e` (`develop`). This package designs future work. It does not connect accounts, enable agent tools, change production, or certify provider access. The user requested research, a detailed plan and skilled development-agent definitions; implementation is a subsequent assignment.

**Recommendation:** add a Connections capability to the existing Studio. A person connects an app account once, selects resources, assigns named agents and chooses permitted actions. A server-side broker enforces these choices on every use. Use official MCP servers where their authentication, scopes and available tools meet the requirement; use narrow API adapters where they do not. Ship useful vertical slices rather than a catalogue of connected logos.

| Deliverable | Read for |
|---|---|
| [Research and provider matrix](RESEARCH.md) | Current primary-source findings, transport/auth choices, eligibility and qualification gates |
| [Experience specification](EXPERIENCE.md) | Existing Studio design, flows/states, EN/FA copy, mobile/RTL/accessibility |
| [Architecture](ARCHITECTURE.md) | Current source seams, proposed schemas/services, OAuth, runtime, storage and reliability |
| [Security and QA](SECURITY_AND_QA.md) | Threat model, deterministic controls, adversarial tests, release acceptance |
| [Canonical backlog](BACKLOG.json) · [Readable backlog](BACKLOG.md) | Dependency graph, exact ownership proposals, independent reviewers and completion evidence |
| [Development team](TEAM.md) | GPT-6.1 Sol/high roles, dispatch/handoff contracts, skills and staged concurrency |
| [Runtime skill design](RUNTIME_SKILLS.md) | Future end-user agent workflows; distinct from development-agent skills |
| [Package validation](VALIDATION.md) | What this planning pass actually checked and unresolved evidence |

## Product outcome and boundaries

Vox agents should complete useful work across a person's approved apps without forcing that person to repeat account setup or exposing their data to another person, group, agent or space. Success is an externally verified result: a sourced answer, an actual saved document, an accepted message, or a confirmed infrastructure operation. A model saying it did something is not evidence.

Examples of the intended experience:

- Marcus reads a selected teaching document and updates the learner's selected progress Sheet after an approved action. Another learner cannot obtain either resource through Marcus.
- An engineering agent explains an issue using selected GitHub/Forgejo repositories, drafts a patch in a sandbox, and creates a draft PR when authorized. It does not inherit permission to merge or deploy.
- An analyst answers a Gamend question with the exact organization, game, environment, date range, timezone, build/cohort, coverage and data freshness, then saves an approved report. Missing metrics remain unavailable.
- A personal assistant reads the connected person's Gmail in Personal space, drafts a response and presents recipients/content before sending. It cannot quote that inbox in a work group.
- An operations agent reads selected Hetzner resources and named service diagnostics. Restart, resize, delete, deployment and billing-related actions are separately governed capabilities.

The first release excludes arbitrary public MCP URLs, uploaded executable plugins, a generic unrestricted shell/HTTP proxy, whole-account indexing, automatic Gmail ingestion, unattended root access, and cross-space memory sharing. These exclusions keep the first implementation bounded; future expansion requires explicit contracts and tests.

## Decisions to carry into implementation

1. **One connection, several explicit grants.** Provider identity, saved connection and per-agent permission are separate records. Connecting an account alone assigns no agents. An organization Owner administers workspace connections but does not acquire another person's personal content.
2. **Use existing boundaries.** Preserve Work/Personal, verified person, current audience, source lineage, history policy and revocation epochs. Conjunction of provider permission, connection scope, current requester, agent grant, purpose, destination and resource policy determines access. A group mention is not delegation.
3. **Filter before the model.** Check tool descriptions, search queries, arguments, resources, results, history, summaries and memories. Private content must not influence an unauthorized answer or outbound query indirectly. A read-only search can still leak confidential text to another service.
4. **Credentials stay with the broker.** Studio and the conversation model receive opaque references and safe status only. Use a separate service identity, vault and bounded runner permissions; role instructions and encrypted fields in a shared process are not isolation.
5. **Simple interaction, proportionate control.** Scoped reads and local drafts within an existing grant proceed without repeated confirmation. Meaningful external effects use exact action review or an explicitly configured bounded workflow. Approval binds the target, content, recipients, revisions, limits and expiry; changed plans require a new decision. Never invent approval from a tool result or email.
6. **MCP is an adapter, not policy.** Maintain code-owned tool classification and a pinned compatibility profile. The current spec and older deployed servers differ; test each provider's negotiated protocol instead of assuming one handshake. Server tool hints do not establish harmlessness.
7. **Durable outcomes.** Store action intent, authorization revision, execution lease, provider receipt and verification separately. Timeout after dispatch means uncertain until reconciled, not safe to retry. Cancel may stop pending work without reversing a completed effect.
8. **Separate automation.** MCP supplies capabilities. Signed webhooks/schedules supply triggers; a separate policy-controlled worker decides whether to run an already approved workflow. Notifications retain existing generic external previews and current-recipient checks.
9. **Runtime skills teach workflows; grants authorize them.** Version skills with required capabilities and evaluation cases. An imported skill cannot request its own credentials, widen permissions or change protected policy.
10. **Feature-specific rollout.** Each provider, action class and runner can be disabled separately. Preserve existing bots, Telegram polling ownership, voice and unrelated memory behavior throughout migration.

These are proposed engineering/product decisions. Primary-source rationale and limitations are in the research, architecture and security documents; no blanket compliance or complete prompt-injection prevention is claimed.

## Requirement contract

| ID | Required behavior / observable acceptance |
|---|---|
| CR-01 | Connect, identify, reconnect and revoke an account through a server-bound flow; forged/replayed/cross-user callbacks fail. No token reaches chat, URL logs, browser storage or model input. |
| CR-02 | Select exact resources/actions/agents/space; no automatic agent assignment or new-tool access after an update. Revocation blocks new use immediately at the policy boundary. |
| CR-03 | Every invocation and result obeys current requester, provider, agent, purpose and audience authority. Unknown group audiences fail closed for restricted data. |
| CR-04 | Sources and externally verified receipts accompany outcomes; UI distinguishes preparing, waiting for review, running, succeeded, failed, cancelled and uncertain. |
| CR-05 | Side effects use revision-bound approval or a bounded workflow grant, idempotency where supported, and reconciliation for uncertain outcomes. Duplicate callbacks never duplicate effects. |
| CR-06 | Untrusted content, tool descriptions and imported skills cannot grant authority, run arbitrary code, trigger new connections or move data into an unauthorized destination. |
| CR-07 | EN/FA, RTL, keyboard/screen-reader and actual Telegram mobile OAuth flows work using existing Studio tokens, navigation and component patterns. |
| CR-08 | Revocation/deletion invalidates source-derived snippets, history, summaries, indexes, caches, skills' retained data and queued jobs. Restore/replay consults tombstones. |
| CR-09 | Browser/SSH workers are isolated, narrow, cancelable and resource-bounded; no access to host personal profiles, unrestricted sockets or production signing keys. |
| CR-10 | Provider rate limits, expiry, pagination, malformed responses, outages and schema drift produce safe recoverable states, not infinite working indicators. |
| CR-11 | Gamend preserves its own org/game/environment/current-membership/production controls; product operations cannot bypass its protected release system. |
| CR-12 | Analytics answers disclose metric definition and cohort/freshness/QA compatibility; unsupported values are unavailable, not inferred zero. |
| CR-13 | Connection metadata, content processing, durable remembering and proactive workflow activation have separate choices/retention contracts. No silent account crawl. |
| CR-14 | Logs/audits record scoped actor/action/outcome without credential/content leaks; costs, limits, kill switches and incident ownership are testable. |
| CR-15 | Production acceptance covers the exact source/configuration/provider accounts and actual user journeys. Mock tests, CI and a health endpoint do not stand in for those journeys. |

## Sequenced delivery

All stages include design, implementation, independent review and evidence. Provider-eligibility work can run ahead, but dependent features stay off. Task sizes in the backlog express relative complexity, not calendar promises.

| Stage | Deliverable | Acceptance gate |
|---|---|---|
| C0 — contracts and qualification | Freeze UX/policy, provider matrix, broker storage/isolation design, synthetic fixtures, app registrations plan | Independent architecture/privacy/QA review; decision owners identified; no live account required for fixture work |
| C1 — complete synthetic slice | Connect fake account → select one resource → assign agent → scoped read → source citation → revoke | Real application/broker boundary and durable policy, denial/race tests, full Studio flow using fixtures |
| C2 — first useful pilot | GitHub selected repositories via narrow app API; Notion remote MCP selected resources where enforceable | Both adapter kinds proven; OAuth/credential refresh/revoke; provider-specific resource enforcement; private/group isolation; real authorized test accounts |
| C3 — work output | Selected Drive/Docs/Sheets/Slides, Slack and Forgejo; reviewed external writes and receipts | Google eligibility/API fallback decision; exact target/diff review, version conflicts and uncertain writes; protected git operations held |
| C4 — analysis and private assistance | Reuse Gamend MCP; PostHog/GA scoped analytics; Gmail private read/draft then separately qualified send; Figma read/write by capability | Tenant/cohort checks; Gmail scope/verification gates; Figma client entitlement; no claim that all connector actions are universally available |
| C5 — operations and browser | Hetzner inventory first; approved named server runbooks; isolated Chrome workflows | OS/network isolation, per-target credentials, host verification, egress/file controls, timeout/cancel/kill/restore drills |
| C6 — bounded proactive workflows | Signed provider events, explicit schedules, budgets, quiet hours, workflow review/versioning | Replay and revoke-before-send tests, exactly scoped action chain, audit and recovery; no general autonomous escalation |
| C7 — production qualification | Provider-by-provider canary, actual Telegram devices, operator runbooks, exact artifact promotion | QA and independent security accept candidate; authorized release owner verifies target and rollback; each connector shows qualified status separately |

**First implementation assignment:** CONN-001 through CONN-004 cover the initial contracts; dispatch them only as their recorded dependencies become ready, parallelizing non-overlapping work. CONN-005–010 plus CONN-028 (budgets, health and kill switches) establish the complete synthetic vertical slice. CONN-011/012 are the first real providers; eligibility research for Google/Gmail/Slack/Figma/Gamend can proceed independently. Keep later providers out of the initial critical path. No unsupported fallback to a broader credential or API is automatic.

**Planning estimates:** use S (bounded adapter/copy/fixture), M (cross-layer feature), L (new security/runtime contract) in dispatch. Re-estimate after C0 using actual provider setup lead times, broker isolation and device-auth findings. A four-slot AI team cannot parallelize a shared contract or substitute for provider approval, human usability work or a release owner. No defensible release date is available before those findings.

## Adoption and measurement

Start with one Work pilot and one separate Personal test account using synthetic provider resources. A first useful task is more important than connection count. Track: connect-to-first-verified-result conversion, auth recovery success, unsupported-scope rate, p50/p95 broker and provider time separately, tool-selection error rate, approvals abandoned because the preview was unclear, duplicate/uncertain effects, cost per verified task and revocation latency. Segment by provider, tool version, language, device, actor type and release. Exclude QA traffic from product outcomes and retain completeness flags.

Before canary, QA freezes the sample set and budgets. Suggested initial guardrails: at most 8 tool steps per interactive turn, 2 concurrent read calls, 1 effectful call per operation lease, provider-specific deadlines with visible progress, and per-connection daily cost ceilings. These values are proposals to benchmark, not measured capacity. No unauthorized data exposure or unauthorized action is acceptable in the held-out security set. Quality comparisons require declared denominators and uncertainty; token volume and engagement are not success metrics.

## Decision register and ownership

| ID | Decision / proposed default | Owner and gate |
|---|---|---|
| CD-01 | Initial providers: GitHub + Notion; existing Gamend discovery/qualification runs in parallel | Product lead before C2 scope freeze; adapt if provider access blocks pilot |
| CD-02 | Broker separate from Studio runtime, own key access and action store; choose deployable store/isolation mechanism in CONN-004 | Architecture + release + security before credentials or external effects |
| CD-03 | Pilot users, target apps/workspaces/resources and spend ceiling | Product/operator before paid calls or live-account tests; fixture implementation can proceed |
| CD-04 | Organization-managed versus delegated personal credentials, delegation rights and approved processors/retention | Privacy/operator before affected activation; no ownership-based access shortcut |
| CD-05 | Google preview eligibility and restricted-scope verification; Slack internal app; Figma custom-client eligibility | Connector owner records real account evidence; unavailable feature remains unavailable |
| CD-06 | `git.joyixir.com` installed Forgejo version/token policy; Gamend deployed MCP/version/regional admission | Connector + operations owners before server-specific integration claim |
| CD-07 | Allowed infrastructure runbooks and environments; budget thresholds and rollback owner | Operations/security before C5 writes; no generic root-shell default |
| CD-08 | Native EN/FA copy review, supported Telegram/iOS/Android/desktop versions, usability pilot | Design + independent QA before public experience qualification |
| CD-09 | Production topology and active Telegram transport owner at release time | Release role fresh verification; do not assume old deployment notes are current |

None of these open operational decisions prevents this planning package or local synthetic implementation. They block only the dependent real-world action or release claim. Existing session authorization should be honored when implementation is later assigned; skills do not invent an extra approval ceremony.

## Definition of complete implementation

The relevant backlog tasks have independent acceptance evidence; the source candidate and configuration are immutable; provider scope/eligibility is proven; real account and device journeys pass; permissions survive restart/revoke/member change; outages cannot leak or duplicate effects; the on-call operator can disable, diagnose and roll back the capability. Release reports state source, CI, deployment and observed provider/user behavior separately. Unsupported providers or actions are clearly unavailable in the UI, never advertised as ready because a token was saved.
