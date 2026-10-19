# Vox implementation start and decision register

Started 19 October 2026 after the user instructed the team to proceed. Branch: `codex/adaptive-foundation`; base: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`. The existing untracked research, reports and planning files are preserved.

The first bounded delivery is locally accepted: [implemented changes, independent review and 480-test evidence](FOUNDATION_RESULT.md). The larger foundation tasks remain in progress until storage/runtime integration and their other acceptance requirements are met.

## First delivery contract

The first local slice establishes the identity/access/consent domain, specifies the actual Studio interaction states, and removes two existing audience-expansion paths. This is an engineering foundation with synthetic tests. The running service is not automatically migrated to the new policy model, and no live collection or optional capability is activated by these changes.

| Work | Owner | Independent acceptance | Scope |
|---|---|---|---|
| VOX-001 local scope and metric contract | Product lead | Privacy/QA reviewer | This register; formal launch decisions stay open |
| VOX-003/004 and design portion of VOX-005 | Sol UX designer | Sol privacy/security | [Experience specification](EXPERIENCE_SPEC.md), actual component seams and six synthetic walkthroughs |
| VOX-006, domain portions of VOX-009/010/011 | Sol architect | Sol privacy/security and lead | `src/lib/adaptive/`: deterministic, versioned domain policy, no persistence or live data |
| VOX-010 current-path hardening | Lead | Sol privacy/security | Tireh guest context, defensive prompt filtering and group extraction scope |
| Local verification | Luna E2E runner under reviewed commands | Sol evaluator/lead | Unit/regression/type/lint evidence only; no CI/device/provider claim |

These tasks may proceed with draft engineering contracts while real-data launch approvals remain unresolved. Implementation of a pure policy function does not complete the durable ledger, migration or server integration task. Dependent features must not be enabled from these local artifacts alone.

## Concrete product decisions

| Decision | Current choice | Accountable owner / unresolved consequence |
|---|---|---|
| Product audience | Adults only; Work and Personal; EU/EEA and US | Reza / Joyixir product owner; country/state feature rollout requires legal review |
| Operator | Joyixir supplied by the user; privacy contact **info@joyixir.com** confirmed by the user on 19 October 2026 | Reza supplies the exact registered entity and address before public notices; mailbox operation and legal approval remain unverified |
| Local cohort and data | Synthetic fixtures and scripted providers only | Lead; no live-user cohort is enrolled |
| External provider spend for this slice | Zero external provider calls | Lead; production/pilot ceiling remains for Reza to set |
| Source surfaces | Active Studio/Tireh; preserve legacy `/app` and authored work | Architect; migrations remain explicit tasks |
| New optional behavior | Off; no new analytics, biometrics or proactive contact activation | Privacy/security; live prerequisites must pass first |
| Identity | Verified person is separately selected and bound to an account | Architect; account ownership/voice/style never supplies missing proof |
| Sharing | Group statements stay in the group; broader sharing requires a separate grant | Product lead; do not reinterpret a model classification as consent |
| Ambiguous legacy history | Preserve data; do not claim it meets new lineage/authorization requirements | Architect; next integrated storage slice must suppress unsafe replay before qualification |
| Release | No production activation in this slice | Reza is release decision owner; qualified legal reviewer must be assigned by Joyixir |

## Metric contract

Proposed metrics remain unmeasured until their producers and dataset are implemented. The definitions below prevent a generated answer or model self-grade from becoming a success event.

| Metric | Definition / denominator | Required producer and current availability |
|---|---|---|
| Verified task completion | Successful externally verified commit or explicit user confirmation / eligible attempted tasks; distinguish each evidence source | Future outcome events; unavailable today |
| Useful text latency | User turn commitment to first task-relevant rendered text; exclude filler | Gateway trace + Studio client render event; unavailable today |
| Useful voice latency | Actual end of speech to first task-relevant audible playback; report p50/p95 by device/language/channel | STT/turn trace + actual Call playback; unavailable today |
| Memory correctness | Authorized retrieval/attribution/correction on a versioned synthetic or approved evaluation corpus | Local fixtures initially; no production score inferred |
| Cost per successful task | Known billed usage plus explicitly labeled estimates/unknown requests / verified successful tasks | Future provider usage and outcome correlation; unavailable today |
| Notification usefulness | Explicit useful/unwanted feedback and underlying task outcome / eligible delivered notifications, with unavailable delivery separated | Future receipt and feedback events; opens alone are not success |
| Privacy failures | Any unauthorized content/provider exposure, grant expansion or collection without the required permission | Deterministic canaries and authorization tests; hard failure independent of average quality |

Every later report must carry cohort, time window/timezone, build/model/prompt/policy versions, origin/QA exclusion, sampling and completeness. No observed events means unavailable data, not zero failure.

## Required follow-on storage and runtime work

The initial review identified additional current-path issues that this bounded patch does not claim to repair:

1. Reply and extraction replay raw history without durable source/audience lineage. A forgotten source may still exist in a user message even if assistant messages reference memory IDs. VOX-010/014 must integrate history suppression, policy epochs and deletion across all stores and retries.
2. Telegram participant membership can become stale before someone speaks. VOX-010/031 must establish current audience evidence and recheck it before context dispatch and output; group privacy cannot depend on speaker events alone.
3. Legacy auto-memory collection, server consent enforcement, Work/Personal migration and authenticated shared-account person switching are not established by the new pure functions. VOX-009/011/012/015 own their integration.
4. Existing historical memories that were automatically widened to project scope are not silently rewritten. VOX-015 must identify and quarantine ambiguous legacy grants with an auditable migration.
5. The privacy center must show actual server receipts and per-system deletion states. The experience specification must not be wired to optimistic toggles that imply unimplemented controls.

The next implementation slice is durable authoritative identity/consent and history suppression, then observation and Decisions. Voice recognition retains its separate jurisdiction/provider/accuracy gates. Use [BACKLOG.json](BACKLOG.json) for status; only acceptance evidence can complete a task.
