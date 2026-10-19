# Vox development team

This is a reusable Codex implementation team for the [plan](PLAN.md) and [backlog](BACKLOG.json). It does not create deployed Vox personas, provision an autonomous improvement service, grant access to user memory, or start scheduled work. Joyixir is the confirmed operator; initial product scope is adults in the EU/EEA and US. Product/runtime requirements remain in [privacy and consent](PRIVACY_AND_CONSENT.md) and [QA and release](QA_AND_RELEASE.md). The design basis is the [memory strategy](../AGENT_MEMORY_STRATEGY.md) and [software improvement/observation research](../SELF_DEVELOPMENT_RESEARCH.md); these proposals do not establish shipped behavior.

## Discover and invoke

The repository supplies project-scoped skills at `.agents/skills/vox-*/SKILL.md` and standalone custom agents at `.codex/agents/vox-*.toml`. Skills describe reusable expertise and can be selected automatically or invoked as `$vox-architect`, for example. Custom agents select the model and role instructions; each explicitly reads its corresponding skill. Invoking a skill in the current chat does not itself change that chat's model or create another agent.

Codex discovers these project directories. A running session may need a reload/new session before new skills or custom agents appear. Verify the available agent/model inventory before dispatch. Do not assume that saving TOML proves a role was loaded, a model was available, or an agent ran. If the exact requested model is unavailable, report the gap and request an explicit routing decision instead of silently substituting. A read-only plan/handoff can still be prepared within the current task.

The definitions use `name`, `description`, `model`, `model_reasoning_effort` and `developer_instructions`. They intentionally inherit parent permissions and tools; standalone custom-agent configuration does not create per-role privilege isolation. Review-only instructions, owned paths and evaluation boundaries are behavioral constraints. The deployed Observer, Analyst/Optimizer, Developer, Evaluator and release service still need separate service credentials, data projections and protected promotion controls. See [Codex subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents) and [building skills](https://learn.chatgpt.com/docs/build-skills) for the configuration/discovery conventions checked for this setup on 19 October 2026.

Example dispatch: “Use `vox_product_lead` to take the next dependency-ready task from BACKLOG.json, dispatch the scoped implementation, and return independent acceptance evidence. Work locally; live data, paid calls, messages and deployment require explicit task authorization.” This is an example request, not an automatic instruction to start implementing the roadmap.

## Roles and model routing

| Custom agent | Model / effort | Responsibility and ownership boundary | Skill / definition |
|---|---|---|---|
| `vox_product_lead` | `gpt-6.1-sol` / high | Delivery scope, dependencies, acceptance, task disposition and role coordination | [Skill](../../.agents/skills/vox-product-lead/SKILL.md) · [Agent](../../.codex/agents/vox-product-lead.toml) |
| `vox_ux_designer` | `gpt-6.1-sol` / high | Interaction/state specifications, memory/consent UX and copy; code only if assigned | [Skill](../../.agents/skills/vox-ux-designer/SKILL.md) · [Agent](../../.codex/agents/vox-ux-designer.toml) |
| `vox_architect` | `gpt-6.1-sol` / high | Backend interfaces, memory/retrieval, outbox and Decisions contracts; assigned implementation paths | [Skill](../../.agents/skills/vox-architect/SKILL.md) · [Agent](../../.codex/agents/vox-architect.toml) |
| `vox_privacy_security` | `gpt-6.1-sol` / high | Independent read-only access, consent, minimization and deletion review | [Skill](../../.agents/skills/vox-privacy-security/SKILL.md) · [Agent](../../.codex/agents/vox-privacy-security.toml) |
| `vox_data_engineer` | `gpt-6-luna` / high | Deterministic producers/projections under a reviewed schema and retention contract | [Skill](../../.agents/skills/vox-data-engineer/SKILL.md) · [Agent](../../.codex/agents/vox-data-engineer.toml) |
| `vox_frontend_engineer` | `gpt-6.1-sol` / high | Studio controls, state handling, accessibility and approved notification behavior | [Skill](../../.agents/skills/vox-frontend-engineer/SKILL.md) · [Agent](../../.codex/agents/vox-frontend-engineer.toml) |
| `vox_voice_engineer` | `gpt-6.1-sol` / high | Streaming/cancellation, speaker assistance and verified identity integration | [Skill](../../.agents/skills/vox-voice-engineer/SKILL.md) · [Agent](../../.codex/agents/vox-voice-engineer.toml) |
| `vox_qa_evaluator` | `gpt-6.1-sol` / high | Independent candidate acceptance, regression/eval design and protected gate assessment | [Skill](../../.agents/skills/vox-qa-evaluator/SKILL.md) · [Agent](../../.codex/agents/vox-qa-evaluator.toml) |
| `vox_e2e_runner` | `gpt-6-luna` / medium | Approved scripted execution and evidence artifacts; product/tests/criteria read-only | [Skill](../../.agents/skills/vox-e2e-runner/SKILL.md) · [Agent](../../.codex/agents/vox-e2e-runner.toml) |
| `vox_release_engineer` | `gpt-6.1-sol` / high | Readiness, reliability and rollback; live promotion only when explicitly authorized | [Skill](../../.agents/skills/vox-release-engineer/SKILL.md) · [Agent](../../.codex/agents/vox-release-engineer.toml) |
| `vox_docs_analyst` | `gpt-6-luna` / medium | Source-linked documentation, approved aggregate/report formatting and evidence bookkeeping | [Skill](../../.agents/skills/vox-docs-analyst/SKILL.md) · [Agent](../../.codex/agents/vox-docs-analyst.toml) |

Use Sol for ambiguous scope, new contracts, architectural choices, identity/ACL/consent work, high-risk implementation, independent judgment and release decisions. Use Luna where inputs, schema, expected outputs and acceptance criteria are fixed. A bounded task can be implemented by Luna, but a small diff is not automatically low risk. Data schema design, causal/cohort analysis and evaluation interpretation belong to Sol; routine producers, approved report formatting and scripted execution can use Luna. Escalate a Luna task when a permission/identity/retention question or conflicting evidence appears. Report the concrete missing decision rather than making a model guess.

These are development model defaults. They do not set Vox's served conversation model or the product's Decisions API model. Provider availability, SDK compatibility and latency must be verified for the product integration independently.

## Operating loop

1. The lead identifies the authorized delivery slice, reads the task and prerequisites, and assigns a stable task ID from BACKLOG.json. A new request does not implicitly authorize the entire roadmap. Required legal, provider or production decisions remain named gates with owners.
2. Assign exact owned paths and a candidate baseline. Architectural seams and UX/consent contracts come before dependent wiring. Typical seams are `src/lib/tireh`, `src/lib/studio`, Studio components/routes and observation adapters, but a role owns only the paths listed in its dispatch. Preserve existing dirty work.
3. Run a lead plus at most three workers with the current four available slots. Keep an agent slot available when independent evaluation becomes the bottleneck. Use read-only reviewers alongside authors when useful; serialize writes to shared files, contracts and backlog status. Additional roles do not require eleven concurrent sessions.
4. The author returns a reviewable diff and evidence. The lead resolves integration conflicts, records material decisions and fixes a candidate revision before acceptance. For an uncommitted tree, record the base commit and a digest/path list for the exact diff tested; do not describe HEAD alone as the tested candidate.
5. An evaluator who did not author that implementation independently selects/runs checks against the candidate. The E2E runner may collect deterministic evidence under QA's reviewed commands; it does not accept the change or modify tests until green. Privacy review is read-only unless a separately assigned fix task changes its role and requires a new independent reviewer.
6. The lead updates the task only when its own acceptance criteria and applicable gates are met. Documentation carries failures and unavailable evidence as well as passes. A source/local-test task may finish at that level; a release task stays open until its required target/runtime evidence exists.
7. The release role prepares the exact artifact/target, rollback, data implications and post-release checks. When live actions are explicitly authorized, execute the approved release scope and verify the deployed revision plus actual Studio user flow. Permission to implement or invoke a role does not itself authorize sending messages, deploying or collecting live private data.

The author must not change protected evaluator fixtures, judge instructions, scoring rules, thresholds or promotion policy to make a candidate pass. The improvement system requires real protection of these assets; this local team config alone cannot enforce it. If independent review or required isolation cannot be provided, label acceptance unavailable and report the missing gate.

## Dispatch template

```text
Task: <existing BACKLOG.json ID and intended outcome>
Agent/model: <custom agent; exact model and effort>
Baseline: <commit, plus existing dirty diff if relevant>
Prerequisites/contracts: <task IDs and approved schema/UX/policy versions>
Owned paths: <exact paths; explicitly coordinate shared files>
Read-only inputs: <relevant code, docs, fixtures and evidence>
Acceptance: <observable behavior and failure paths>
Execution scope: <local/mock/staging/live; credentials and cost boundary>
External actions authorized: <specific actions or none>
Independent acceptance owner: <different author/evaluator>
Evidence destination: <task-specific artifact paths>
Escalation: <missing contracts or authority go to named Sol role>
```

The dispatch supplies the necessary context directly; do not assume a fresh worker inherits another agent's hidden reasoning. Prefer a narrow task with a complete user-visible result over unrelated fragments. Splitting work must preserve the identity, permissions, retention and revision contract across every seam.

## Handoff and evidence templates

```text
Task: <ID>
Disposition: <ready for review / failed / blocked by named prerequisite>
Author or reviewer: <agent and actual model; distinguish roles>
Candidate: <base, commit or exact dirty-diff identity>
Owned/changed or reviewed paths: <paths>
Behavior: <concrete before/after or observed result>
Checks: <command/flow; environment; time; exit/status; artifact>
Fixtures: <synthetic or specifically approved source; policy version>
Coverage: <pass / fail / skipped / UNAVAILABLE, with reasons>
Limits: <local versus CI versus deployment/provider/device evidence>
Decision needed: <specific unresolved question and owner>
Next owner: <role and prerequisite to continue>
```

```text
Release evidence: <task and exact candidate/artifact>
Source and local checks: <references>
Independent acceptance: <reviewer, revision and gate results>
CI: <run URL/revision or UNAVAILABLE>
Deployed revision/target: <verified identifier or UNAVAILABLE>
Runtime flow: <exact Studio path and synthetic observation or UNAVAILABLE>
Provider/rules/device checks: <separate results or UNAVAILABLE>
Rollback/kill switch: <version, data/derived-memory effects and evidence>
Open gates: <owner and consequence>
```

Do not put secrets, private transcripts, voiceprints or restricted source details in handoffs. Use approved minimized projections and artifact references with matching access controls. Work and Personal remain separate; a development task is not a grant to all user memory. `UNAVAILABLE` means unverified or inaccessible, never zero failures.

## Maintain the team

Change a skill when a repeated task demonstrates a missing decision or invariant. Keep role descriptions narrow enough to route correctly and UI metadata consistent with `$skill-name`. Automatic skill selection is enabled by default. Do not add an invocation-only policy merely because a role can perform sensitive work; require task authorization for the actual external action.

Validate each changed skill with the bundled `skill-creator/scripts/quick_validate.py` and parse each custom agent as TOML. Check that names match the backlog roles, that every agent reads the assigned skill, that links resolve, and that Sol/Luna routing is explicit. Syntax validation does not prove Codex discovery, model access, role behavior, service privilege isolation or product correctness. Use an independent realistic forward-test for a substantial/risky role change when delegation is authorized; keep it synthetic and local unless a broader test is authorized.

No scheduler or ongoing observer is enabled by these files. Future runtime observation and optimization must follow the separately approved product contracts and release controls.
