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
- **Speed:** no added latency, because the pick rides on the triage request that already runs for every message (it becomes one more question in the same call).
- **Room to grow:** with only an index in the prompt, agents can later carry more than 8 skills.

## Design

**Two prompt modes. The mode is chosen per turn, and each mode keeps a byte-stable prefix of its own.**

| Mode | When | `<craft>` in the stable prefix | Per turn |
|---|---|---|---|
| **Routed** | Triage answered the `skill` question with enough confidence | Role block, an index of the routable skills (title plus "use when"), and the pinned safety skills in full | `<active_skill>`: the chosen playbook (or two when Decisions is torn), or nothing when the answer is `none` |
| **Unrouted** | No decider, a compact/indexed turn, a live call, a Mini App call turn, a follow-up, timeout, refusal or low confidence | Today's full craft (role and every playbook), byte-identical to before | Nothing extra |

There is no regression path: whenever selection is unavailable or unsure, the agent gets exactly today's prompt.

**Safety skills are pinned.** Some skills must work even when the message isn't "about" them: crisis protocol, scope and referral, health red flags. These carry `pinned: true` in the catalog. They are always in the prompt in full and are never offered to Decisions. This keeps them from depending on a classifier, and it means Decisions never classifies someone's emotional or health state, which is the project's rule (`AGENT_INTELLIGENCE_SOLUTION.md` §4.8).

**Work roles only.** Routing applies to agents built from a work role in the Tech, AI, Mobile or Publisher packs. Lifestyle roles and custom agents (no library role) always keep the full prompt. An independent review showed why:
- **Lifestyle triggers describe how someone feels or their health** ("feels anxious", "after an injury, illness, pregnancy"). Offering them as choices would make Decisions classify emotional or health state, whatever its instructions say.
- **Routing could drop a safety screen** that lives in another playbook (fitness readiness, nutrition screening).

A CI lint fails the build if a mood or health word appears in any routed work-role choice. A short allowlist covers compliance tasks that are *about* such systems, such as emotion-recognition notices. Lifestyle routing can follow once those triggers are rewritten as requests and reviewed.

**Untrusted text cannot fake a section.** Creator text has prompt section tags stripped until none remain, so nested tricks like `<active_<voice>skill>` don't survive. Display names, group titles and memory text have their angle brackets neutralised. So nobody can open or close `<active_skill>` or `<rules>`, or move the cache cut.

**The Decisions question** is one `choice` named `skill`, added to the existing triage request:

- **Limits:** 5 questions in private chats and 7 in groups, within the 7-question limit. Each choice list is the agent's routable skills plus `none`, at most 16.
- **Choice descriptions:** the skill title and its "use when" line. This is static catalog text, so no new personal data goes to OpenAI beyond what triage already sends.
- **Instructions:** judge the task the latest message asks for, not the person's mood or health; choose `none` for small talk or when no playbook clearly fits.

**Reading the answer:**

- **A skill at confidence ≥ 0.45:** that skill is used. A second skill is added when its own probability is ≥ 0.25 and the provider returned per-option probabilities.
- **`none` at ≥ 0.45:** no playbook is added for this turn.
- **Anything else** (missing, malformed, refusal, below threshold): the turn is unrouted.

**Rollout flag:** `STUDIO_SKILL_ROUTING`.
- `on` (the default when a decider is configured): routed as above.
- `shadow`: the question is asked and the result is logged content-free, but the prompt stays unrouted. This is for comparing before switching on.
- `off`: never ask.

**Diagnostics** are content-free: one per composed reply, at stage `skill_select`, never with message text or a skill id.
- **Routed:** `skill_routed_selected`, `skill_routed_none`.
- **Unrouted:** `skill_unrouted_no_answer`, `skill_unrouted_low_confidence`.
- **Shadow:** `skill_shadow_*`, the same four outcomes.

**Measured prompt sizes** (characters, about chars/4 in tokens):

| Role | Unrouted stable prefix | Routed stable prefix | Chosen playbook per turn |
|---|---|---|---|
| UA & Growth Lead (6 routable skills) | 15,834 (~3,960) | 8,316 (~2,080) | +1,524 (~380) |
| Product Manager | 15,535 (~3,885) | 8,337 (~2,085) | +1,517 (~380) |

The routed prefix stays byte-identical whichever playbook is active, so it is cached like the unrouted one.

## Where it applies

- **Applies:**
  - Telegram text and voice-note replies in private and group chats, wherever triage runs today. This includes proactive group replies and the fast-model path.
  - The sandbox Test chat in Spawn, so creators see what production will do. It asks only the `skill` question.
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
| Added latency | 0 (same request) |
| Stable prefix | smaller in routed mode; measured and reported |

Online: the share of routed vs unrouted turns, from content-free diagnostics.

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
- **Held-out work cases:** 6 of 8 correct, none wrong; the other 2 were unrouted and so got the full prompt.
- **The one miss:** a Persian problem statement that asks no question got `none`.
- **Coverage gap:** the set covers 16 of 43 work roles. Expand it before trusting the numbers across the whole catalog.
- **Rollout:**
  - The default is `on`: a miss falls back to today's prompt, and the eval shows 1.1% wrong routes.
  - For a cautious launch, set `STUDIO_SKILL_ROUTING=shadow` in the production config for a few days, compare the content-free diagnostics, then remove it.
  - A tested alternative question wording (`scripts/evals/skill-routing/variants/question-wording.json`) is worth trying the same way.

**Known trade-off:** routed Telegram turns and unrouted live or Mini App turns use two different cached prefixes, so the first live-call turn after chatting writes the cache instead of reading it. Measure `cache_read_input_tokens` per mode before tuning.

## Not in scope

- Raising `MAX_AGENT_SKILLS` above 8. This is now possible; it's a product call after the eval.
- Routing live calls.
- Learning from feedback which playbook helped.
