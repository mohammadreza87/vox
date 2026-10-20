# Vox planning package validation

**Status, 20 October 2026:** the package has grown to 21 skills under `.agents/skills/vox-*` and 20 agents under `.codex/agents`, and `scripts/validate-vox-plan.py` passes on the current tree. The counts below are the original 19 October validation.

Reviewed 19 October 2026. Source baseline: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`. This record describes checks of the local planning package and development roles. It does not certify application behavior, legal compliance, provider integration or production deployment.

This is the planning-time snapshot. Local implementation subsequently started on 19 October; current work and evidence belong in [STARTER_SLICE.md](STARTER_SLICE.md) and the canonical backlog. Statements below that all tasks were planned describe this earlier validation point.

## Contents and automated checks

- 56 planned implementation tasks across 8 stages, covering all 22 product requirements. Each task has an owner, a different reviewer, dependencies, acceptance criteria, verification method, deliverables and an initially empty evidence list.
- 40 privacy requirements, 42 main QA matrix cases, 14 additional privacy test cases and 15 EN/FA draft UX flows. The marketing flow is future design only and must not be enabled in the initial release.
- 11 project skills and 11 matching custom-agent definitions: 8 use `gpt-6.1-sol`; 3 use `gpt-6-luna`.

The following checks passed against the local files:

| Check | Result and boundary |
|---|---|
| `scripts/validate-vox-plan.py --render` using bundled Python 3.12 | Task IDs, requirement coverage, role/model references, independent reviewer, dependency DAG including optional capability dependencies, evidence requirements, TOML parsing, local links and Markdown fences passed. Regenerated `BACKLOG.md` from canonical JSON. |
| Bundled skill-creator `quick_validate.py` | All 11 skills passed frontmatter and body checks. PyYAML 6.0.3 was available through a temporary `/tmp` package directory; no repository or global dependency was changed. |
| Skill UI metadata and agent TOML | All 11 YAML files parsed, default prompts reference their skills, and descriptions meet the metadata length limits. All 11 TOML files use the supported configuration keys and explicitly read their assigned skill. |
| Local Codex CLI discovery check | `codex-cli 0.163.0` ran `codex debug prompt-input` successfully with empty stderr. All 11 skill names appeared in the generated model-visible prompt. The debug command did not establish runtime custom-agent selection. |
| Source boundary | No tracked application code, dependency or deployment configuration changed. Package files are local and uncommitted; HEAD alone does not identify their contents. |

The validator is [available here](../../scripts/validate-vox-plan.py). Python 3.11+ is needed for full TOML parsing; earlier Python versions explicitly report that check unavailable.

## Independent role checks

Two synthetic forward-tests used the requested models through explicit subagent dispatch and skill reading. They test the instructions' usefulness, not automatic custom-agent discovery or the Vox runtime.

| Role/model | Fixture | Observed result |
|---|---|---|
| E2E runner, `gpt-6-luna` / medium | Mock tests passed, CI login timed out, staging revision differed from the candidate, only a local screenshot existed, and real-device/provider receipts were absent. | Correctly reported not release-ready, kept evidence levels separate and escalated to the independent Sol QA role. No product/provider actions ran. |
| Architect, `gpt-6.1-sol` / high | Unsafe ticket proposed sending solely on a score, caching without authorization invalidation, voice-based identity switching, enqueue-only consent checks, blind timeout retries and author edits to the protected judge. | Rejected all six clauses and supplied corrected policy, cache, identity, delivery, retry and evaluator contracts. No files, providers or live data were changed by the test. |

The architect test ran before the backlog files were created and accurately marked that input unavailable at that time. Both backlog files now exist and pass the graph/reference validation; this timing limitation is not presented as an outstanding missing artifact.

Independent integration review identified and corrected notification disclosure inconsistencies, overly broad synthetic-canary prohibitions, missing rights/export work, pre-processing participant gates, scheduled retention expiry, and server age/jurisdiction enforcement. Their acceptance requirements now live in the owning tasks and QA/privacy documents.

## Remaining evidence boundaries

- Saving the agent definitions does not prove the running desktop session has reloaded them. Exact custom-agent selection and runtime configuration discovery still require a fresh inventory/dispatch check in the implementation session.
- No application implementation, regression suite, paid provider call, physical-device test, CI run, legal approval or production activation was performed for this planning package.
- All backlog tasks remain `planned`. Provider performance, voice recognition error rates, notification delivery, privacy controls and improvement-loop isolation remain to be implemented and measured.
- Joyixir's registered entity/address/privacy contact, jurisdiction review, provider contracts/settings, retention schedule and biometric qualification remain owned launch decisions in the plan.

Start from the [implementation plan](PLAN.md), use the [team dispatch contract](TEAM.md), and record implementation evidence against the exact future candidate.
