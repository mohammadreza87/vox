# Per-message skill selection

Status: built on `feat/per-message-skills` (20 October 2026). Builds on `docs/AGENT_SKILLS_STUDIO.md` (the role and skill library) and `src/lib/tireh/triage.ts` (the per-message Decisions request).

## Problem

Every agent carries up to 8 skill playbooks. Today all of them sit in the system prompt on every turn, about 2.2k tokens on average. The model then has to work out for itself which playbook the latest message calls for, and long irrelevant context makes answers less focused (Chroma's "context rot" and NoLiMa findings, `AGENT_INTELLIGENCE_SOLUTION.md` §2.2). It also caps how many skills an agent can usefully hold.

## Bet

Let OpenAI Decisions pick the playbook for each message. The prompt then carries:

- a short index of the agent's skills, as the stable, cached part of the prompt;
- the one playbook that fits this message, in the per-turn part.

The expected gains:

- **Focus:** one relevant method instead of eight.
- **Telegram request shape:** no additional round trip, because the pick rides on the triage request that already runs for each eligible message. This does not mean zero added latency; the measured report records about 12 ms median overhead.
- **Room to grow:** with only an index in the prompt, agents can later carry more than 8 skills.

## Design

**Two prompt modes. The mode is chosen per turn, and each mode keeps a byte-stable prefix of its own.**

| Mode | When | `<craft>` in the stable prefix | Per turn |
|---|---|---|---|
| **Routed** | Triage answered the `skill` question with enough confidence | Role block, an index of the routable skills (title plus "use when"), and the pinned safety skills in full | `<active_skill>`: the chosen playbook (or two when Decisions is torn), or nothing when the answer is `none` |
| **Unrouted** | No decider, an ineligible role or skill set, a compact/indexed turn, a live call, a Mini App call turn, a follow-up, timeout, refusal or low confidence | Full craft for the role and every attached playbook in this candidate's catalog, including pinned safety playbooks | Nothing extra |

Unavailable, failed, invalid, or uncertain primary selection falls back to full craft. This describes the primary answer; a malformed optional probability list only drops the runner-up when the primary answer is valid. A confident but wrong known skill or `none` selection can still omit a useful playbook, so classification errors remain a quality risk. “Full craft” here means the current candidate's catalog; it is not evidence of byte-for-byte equality with a previous release.

**Pinned safety skills stay in the prompt.** Some skills must work even when the message isn't "about" them: crisis protocol, scope and referral, health red flags. Attached skills carrying `pinned: true` stay in the prompt in full and are never offered to Decisions. Other safety instructions, including the fitness readiness screen, are not pinned; the whole-set eligibility gate below preserves them. Pinning alone does not enforce the project's rule against classifying someone's emotional or health state (`AGENT_INTELLIGENCE_SOLUTION.md` §4.8).

**Work roles only.** Routing applies to agents built from a work role in the Tech, AI, Mobile or Publisher packs. Lifestyle roles and custom agents (no library role) always keep the full prompt. An independent review showed why:
- **Lifestyle triggers describe how someone feels or their health** ("feels anxious", "after an injury, illness, pregnancy"). Offering them as choices would make Decisions classify emotional or health state, whatever its instructions say.
- **Routing could drop a safety screen** that lives in another playbook (fitness readiness, nutrition screening).

A CI lint fails the build if a mood or health word appears in any routed work-role choice. A short allowlist covers compliance tasks that are *about* such systems, such as emotion-recognition notices. Lifestyle routing can follow once those triggers are rewritten as requests and reviewed.

**Role and skill eligibility gate.** Routing requires an eligible work library role. Before applying any selection, check every attached nonpinned skill against that role's reviewed `skills` and `optionalSkills` list. If the role is ineligible or any attached nonpinned skill is outside that list, discard the whole routed selection and use full craft; do not keep a partial selection. This check also applies when Decisions confidently returns `none`, so an ineligible role or mixed skill set cannot lose its craft through an empty selection. Pinned safety skills remain in full craft independently of role membership and are never offered as choices. Cross-work skill combinations fall back until their eligibility is reviewed.

**Untrusted text cannot fake a section.** Creator text has prompt section tags stripped until none remain, so nested tricks like `<active_<voice>skill>` don't survive. Display names, group titles and memory text have their angle brackets neutralised. So nobody can open or close `<active_skill>` or `<rules>`, or move the cache cut.

**The Decisions question** is one `choice` named `skill`, added to the existing triage request:

- **Limits:** 5 questions in private chats and 7 in groups, within the 7-question limit. Each choice list is the agent's routable skills plus `none`, at most 16.
- **Choice descriptions:** the skill title and its "use when" line. This is static catalog text; in Telegram it adds no new personal data beyond the existing triage request. The sandbox preview uses a separate OpenAI request and requires its own processor/export qualification before enablement.
- **Instructions:** judge the task the latest message asks for, not the person's mood or health; choose `none` for small talk or when no playbook clearly fits.

**Reading the answer:**

- **A skill at confidence ≥ 0.45:** that skill is used. A second skill is added when its own probability is ≥ 0.25 and the provider returned per-option probabilities.
- **`none` at ≥ 0.45:** no playbook is added for this turn.
- **Anything else** (missing, wrong-shaped, refusal, invalid confidence, or below threshold): the turn is unrouted.

A confident result is not a correctness guarantee. In particular, `none` at or above the confidence threshold means no routable playbook is added for an eligible role; if that classification is wrong, useful instructions can be absent. The role/skill eligibility gate above independently forces full craft for ineligible roles or attached nonpinned skills outside the reviewed role list.

**Rollout flag:** `STUDIO_SKILL_ROUTING`.
- `on` (the default when a decider is configured): routed as above.
- `shadow`: on Telegram, the question is asked and the result is logged content-free, but the prompt stays full craft. Sandbox Test chat shadow mode makes no skill request and writes no shadow log; the prompt stays full craft.
- `off`: never ask.

**Telegram diagnostics** are content-free: one per composed reply, at stage `skill_select`, never with message text or a skill id. Sandbox shadow mode emits no skill-selection diagnostic.
- **Routed:** `skill_routed_selected`, `skill_routed_none`.
- **Unrouted:** `skill_unrouted_no_answer`, `skill_unrouted_low_confidence`.
- **Shadow:** `skill_shadow_*`, the same four outcomes.

In sandbox `on` mode, a separate skill-only request is awaited before generation, with an 800 ms timeout. Telegram adds the skill choice to the existing triage request with a 2000 ms timeout.

**Measured prompt sizes** (characters, about chars/4 in tokens):

| Role | Unrouted stable prefix | Routed stable prefix | Chosen playbook per turn |
|---|---|---|---|
| UA & Growth Lead (6 routable skills) | 15,834 (~3,960) | 8,316 (~2,080) | +1,524 (~380) |
| Product Manager | 15,535 (~3,885) | 8,337 (~2,085) | +1,517 (~380) |

The routed prefix stays byte-identical whichever playbook is active, so it is cached like the unrouted one.

## Where it applies

- **Applies:**
  - Telegram text and voice-note replies in private and group chats, wherever triage runs today. This includes proactive group replies and the fast-model path.
  - The sandbox Test chat in Spawn, so creators can preview the routing behavior. In `on` mode it asks only the `skill` question; its request and shadow behavior differ from Telegram.
- **Stays unrouted:**
  - lifestyle roles and custom agents (see "Work roles only");
  - live voice calls;
  - Mini App call turns;
  - relationship follow-ups;
  - compact/indexed turns. These skip triage because the triage adapter has no committed-export fence. Moving triage onto the fenced `DecisionService` is the intelligence plan's step.

## Success measures

Offline, on the labelled eval set in `scripts/evals/skill-routing/` (English and Persian, five packs):

| Measure | Target |
|---|---|
| Correct skill (any acceptable label) | ≥ 85% overall, ≥ 80% in Persian |
| `none` precision (small talk correctly gets no playbook) | ≥ 90% |
| Added latency (original design target) | 0 (same request); not established by the reported measurements |
| Stable prefix | smaller in routed mode; measured and reported |

Online: the share of routed vs unrouted turns, from content-free diagnostics.

The original zero-latency target is retained here as an unproven target, not waived by this repair. Sharing a Telegram request avoids another round trip but does not prove zero overhead. Classification rates and operational counters do not establish generated-answer quality.

## Results

The labelled eval runs against the real Decisions API: `npm run eval:skills`. Report: `docs/agent-skills/SKILL_ROUTING_EVAL.md`.

- **Set:** 152 cases across 26 roles in all five packs, half of them in Persian. Under the shipped policy, 87 cases on 16 work roles are scored. The 65 lifestyle cases are not sent, because those roles are unrouted by design.
- **Results** (two runs, identical results in 87 of 87):

  | Measure (work roles) | Result | Target |
  |---|---|---|
  | Correct skill, overall | 98.9% (86/87) | 85% |
  | Correct skill, Persian | 97.6% (40/41) | 80% |
  | `none` precision | 93.8% (15/16) | 90% |
  | Wrong route | 1.1% | |
  | Unrouted | 0% | |

- **Latency:** the whole triage call takes p50 274 ms and p95 455 ms. The `skill` question adds about 12 ms median.
- These are author-reported classification-run measurements, not answer-quality or end-to-end response-latency measurements. Sandbox preview uses a separate sequential request with an 800 ms timeout; its latency and timeout frequency are not established by these Telegram measurements.
- The evaluator uses a 10,000 ms timeout, compared with 2,000 ms for Telegram and 800 ms for sandbox preview. The report says no main cases exceeded the Telegram timeout, but raw receipts and behavior at the shorter sandbox budget were not verified here.
- **Held-out work cases:** 6 of 8 correct, none wrong; the other 2 were unrouted and so got the full prompt.
- **The one miss:** a Persian problem statement that asks no question got `none`.
- **Coverage gap:** the set covers 16 of 43 work roles. Expand it before trusting the numbers across the whole catalog.
- **What the evaluation measures:** labels for skill classification, not answer usefulness, task completion, reply safety, relationship quality, or end-to-end response latency. The report's 8-case work holdout is a smoke set (6/8 correct, two unrouted); it does not qualify the other work roles or arbitrary skill combinations. These figures are reported in the checked-in evaluation, not independently re-run or bound here to a protected exact-candidate receipt.
- **Rollout:**
  - The source default remains `on` when a decider is configured; an unchanged production environment therefore does not mean routing remains off or unchanged.
  - For an initial release, explicitly set `STUDIO_SKILL_ROUTING=off` and verify the effective mode after the process is recreated. Keep routing off pending scoped processor/export qualification for the new sandbox preview OpenAI path and independently judged answer-quality and latency evidence. Confirm the selected candidate's `prepare` path imports the flag before relying on a source-env override.
  - After that scope is approved, Telegram `shadow` may measure content-free selections without changing prompts. Sandbox shadow makes no request and emits no log, so it cannot serve as equivalent preview telemetry. Enable `on` only after the relevant qualification passes and the release owner approves it.
  - An alternative question wording (`scripts/evals/skill-routing/variants/question-wording.json`) is a candidate for later evaluation; it is not qualified by the current results.

**Known trade-off:** routed Telegram turns and unrouted live or Mini App turns use two different cached prefixes, so the first live-call turn after chatting writes the cache instead of reading it. Measure `cache_read_input_tokens` per mode before tuning.

## Not in scope

- Raising `MAX_AGENT_SKILLS` above 8. This is now possible; it's a product call after the eval.
- Routing live calls.
- Learning from feedback which playbook helped.
