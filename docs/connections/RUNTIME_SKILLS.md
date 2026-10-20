# Runtime agent skills — proposed product contract

**Status, 20 October 2026:** the runtime skills are implemented in `src/lib/connections/skills.ts`; the manifest shape below is the original proposal and differs from the shipped schema.

This document defines future workflows for Vox personas. It does not install them or authorize any account access. Development-team skills in `.agents/skills/vox-connection-*` are separate instructions for building this product.

## Skill and permission separation

A runtime skill teaches how to perform a task with already permitted tools. Its manifest declares requirements; only the connection/grant service can satisfy them. Activating a skill cannot connect an account, widen resources, enable writing, enroll memory, change the conversation model or authorize a different audience. Required tools unavailable means a truthful unavailable state, not fallback to a stronger credential.

Proposed versioned manifest fields:

```yaml
id: teaching-progress
version: 1
description: Prepare lessons and maintain a selected learner progress record
requiredCapabilities:
  - documents.read_selected
  - sheets.read_selected
optionalCapabilities:
  - sheets.update_reviewed_range
allowedSpaces: [personal, work]
audienceRule: current_authorized_recipients
memoryRule: preserve_source_lineage_and_current_grants
workflowRef: teaching-progress-v1
evaluationSuite: teaching-progress-v1
```

This is a design example, not an accepted runtime schema. Resolve concrete agent, account, resource IDs, audience and policy revisions server-side. `allowedSpaces` permits use in either separately; it never moves data between them. Imported Markdown is untrusted task guidance and is not system policy. Only reviewed signed/versioned skill bundles enter the initial catalogue; upstream skill updates require evaluation and do not widen grants.

## Initial skill catalogue

| Skill | Intended agent | Workflow | Required evidence / boundary |
|---|---|---|---|
| Knowledge assistant | Any explicitly assigned persona | Resolve selected sources → retrieve within grant → answer with citations and as-of time | No hidden whole-account search; unsupported claim clearly separated; revoked source cannot influence reply/history |
| Teaching and progress | Marcus or another teacher | Read selected lesson → teach in requested language → propose exact progress range change → execute authorized update → read back | Private learner boundaries even with same agent; no diagnosis, inferred personal facts or cross-learner memory |
| Engineering triage | Work engineering persona | Inspect selected issue/PR/code/CI → produce findings → propose patch in sandbox → create authorized draft PR | Exact repository/base/ref; preserve authored code and protections; no secret result or deployment authority |
| Product analytics | Work analyst | Confirm org/game/env/cohort/date/timezone → query approved metrics → validate completeness → explain uncertainty → proposed report | Raw player/user data excluded by default; QA/build/identity compatibility recorded; no invented zeros or causal claims |
| Personal mail assistant | Personal assistant | Retrieve permitted message → draft → preview sender/recipients/body/attachments → send only under action authority → confirm provider result | Personal private context only; prevent hidden Bcc/attachments, malicious mail instructions, replays and guessed delivery |
| Design collaborator | Work design persona | Read selected Figma frame/spec → reuse design tokens/components → propose supported changes → apply when authorized → inspect result | File/seat/client capability proven; native design inspection distinct from generated screenshot |
| Operations observer | Operations persona | Read selected inventory/logs → classify issue → propose named runbook → review exact target/diff/recovery → execute via isolated runner → verify | Cloud/server/release permissions distinct; no unrestricted shell; uncertain operations reconcile before retry |

Keep tools loaded progressively by task and current grant, using a small trusted description set. A capability may require multiple provider calls; the broker applies the same scope and outbound-data rules at each step. Runtime collaboration transfers only separately authorized task artifacts, never credentials or presumed access. Any receiving agent must possess its own grant and current audience rights.

## Evaluation and versioning

Each skill ships with held-out happy-path, missing-permission, malicious-source, stale-source, conflicting-format/language, provider-outage and ambiguous-effect cases. Include English, Persian and Vietnamese user requests where the agent supports those languages; UI localization remains EN/FA in this scope. Agent personality may change phrasing and initiative, never permissions or evidence standards.

Record skill version, prompt/tool-schema/model versions and externally verified task outcome. Do not auto-promote a skill because a model judge says it followed instructions. New memory extracted from tool results retains provider/source/grant lineage and expiry; derived skills may not embed private source data as reusable instructions. Disable or roll back one skill without disconnecting unrelated agents. A plan to run a workflow proactively needs a separate explicit trigger, destination, expiry, budget and authorization contract.
