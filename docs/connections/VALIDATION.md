# Planning package validation

**Status, 20 October 2026:** historical plan-level validation. Implementation followed and is merged into `develop`; see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) and [BACKLOG.json](BACKLOG.json), where no task is `planned` any more.

19 October 2026 · Baseline `42a1a57113e655b6185ddc731b6f9617aaa4bb4e` · Branch `codex/studio-connections-plan`.

**Disposition: researched implementation handoff, with plan-level review.** These results validate documents, role definitions and simulated handoffs. They do not certify any implemented connector, provider credential, production security boundary, device flow or deployment. All 32 implementation tasks remain `planned` with empty implementation evidence.

## Work actually performed

The coordinator inspected current Vox source/design contracts and primary provider documentation. Three research workers ran as `gpt-6.1-sol` with high reasoning effort for architecture, UX and security/QA. A separate worker at the same model/effort forward-tested the newly written skills. Gamend inspection was limited to relevant local source/contracts at revision `31e3a2887531cc4e046b62af238acd0b98b8f611`; no serving instance or protected deployment was accessed.

| Check | Result and boundary |
|---|---|
| Skill Creator `quick_validate.py` | All nine project skill folders pass frontmatter/name/content checks; semantic behavior evaluated separately |
| Agent configurations | All nine TOMLs parse; exact `gpt-6.1-sol` / `high`; role names and matching skill references agree |
| Discovery manifests | All nine YAML files parse; useful short descriptions and matching `$skill-name` prompts; no privileged tool dependencies silently installed |
| Backlog | 32 unique tasks; acyclic dependency graph; valid role/reviewer references; author and reviewer roles distinct; all planned, implementation evidence empty |
| Traceability | All referenced CR and CONN-QA IDs resolve; the catalogue covers 15 requirements and 30 specified QA scenarios |
| Prerequisites | Real provider tasks depend on policy, broker/vault, lineage/revocation, complete synthetic slice and operational controls; external writes additionally depend on effect ledger/review UI |
| EN/FA experience | 153 unique copy keys; translation parameters match; native Persian usability/copy approval is still required |
| Local links / formatting | Package links checked; Git whitespace check on staged files; relative project references preferred, clearly marked local Gamend research references |
| Independent review | One P1 and three P2 findings corrected and independently rechecked in [review receipt](evidence/INDEPENDENT_REVIEW.md); this is plan-text acceptance only |
| Skill exercises | Concrete fixture-only coordinator, provider-admission and QA-receipt scenarios in [forward-test evidence](evidence/SKILL_FORWARD_TEST.md); no actual implementation or runtime enforcement demonstrated |
| Change scope | Planning documents, skills and custom-agent definitions only; no product source, application dependencies, credentials or production configuration changed |

Validation used the bundled Python runtime for TOML parsing and the Skill Creator validator with a temporary PyYAML installation under `/tmp/vox-connections-skill-validation`. This adds no project dependency. The human backlog is generated from the canonical JSON and carries its digest; regeneration must preserve task semantics and reviewed dependencies.

## Review corrections

1. Generated arguments now conservatively inherit restrictions from **all context visible to the generation**. A model cannot claim narrower provenance; reduced disclosure requires an approved projection and fresh isolated generation.
2. The Work connection example no longer shows a Personal Gmail account; metadata follows the same space boundary as content.
3. Browser selection explicitly refers to an isolated Vox worker/session. Attaching an existing personal browser requires a future separate local-bridge design.
4. Operation payloads distinguish retained and ephemeral inputs. Missing ephemeral input cannot resume after a crash; uncertainty after possible dispatch is reconciled without blind replay.

The security document was peer-reviewed by the UX researcher; its follow-up clarification was reviewed by the coordinator, who did not author it. The security author independently reviewed the other authors' documents, not their own contract. Agent instructions do not constitute the production service isolation required by this plan.

## Unavailable evidence and next boundary

No application tests were run because this change implements no application code. The 30 QA cases are a future test specification, not 30 passing runtime tests. No OAuth registration, provider account eligibility, actual scopes, remote MCP compatibility, live connector writes, physical Telegram device flow, runtime sandbox isolation, legal/provider approval, CI run or deployment is claimed. New custom-agent files may need a refreshed session to become discoverable; their syntax and requested model were checked, not automatic UI registration.

Implementation can begin with the dependency-ready C0 contracts and local synthetic slice when assigned. Real provider access, paid calls, messages and deployment follow the explicitly authorized scope at that time; earlier valid authorization must be honored, not requested again merely because a skill exists. Open CD decisions in [PLAN.md](PLAN.md) block only their dependent activation.
