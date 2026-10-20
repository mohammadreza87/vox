# Skill routing eval

Run 2026-10-20 13:48 UTC against `gpt-6-luna`, catalog `4b6f6ca8624c`, cases `ea0f2c8666b5`. Spec: `docs/SKILL_ROUTING.md`. Regenerate with `npm run eval:skills` (needs `OPENAI_API_KEY`; one Decisions call per work-role case, plus a paired call for every fourth).

## Headline: shipped policy (work roles only)

Routing applies only to agents with a library **work** role (`routableSkillsFor` in `src/lib/studio/skills/render.ts`). Lifestyle and custom agents are always unrouted, because their triggers describe mood or health and routing could drop a fitness or nutrition safety screen. All numbers below are for the **87 work-role cases**. The **65 lifestyle cases are unrouted by policy**: they are not sent and not counted as misses.

| Measure | Target | Result | |
|---|---|---:|---|
| Correct skill, any acceptable label (unrouted counts as a miss) | ≥ 85% | 98.9% (86/87) | met |
| Correct skill, Persian script | ≥ 80% | 97.6% (40/41) | met |
| `none` precision | ≥ 90% | 93.8% (15/16) | met |
| Wrong route | (none set) | 1.1% (1) | |
| Unrouted (keeps the full prompt) | (none set) | 0.0% (0) | |
| Latency, whole triage call | 0 added (same request) | p50 274 ms, p95 455 ms | see Latency |
| Run-to-run agreement (same playbooks loaded) | (none set) | 100.0% (87/87) | vs `run-2026-10-20T13-48-43-188Z.json` |
| Held-out work-role cases, routed correct | (none set) | 75.0% (6/8) | see Held-out |

## Method

- **Request built as production builds it.** For each case the script makes a minimal persona: the case persona name and the role title, with no personality text. Lines are `history + message`, with the user shown by a person name and the agent by the persona name. It then calls `triageInput(persona, lines)` and `triageQuestions(persona, false, routable)` from `src/lib/tireh/triage.ts` (private chat). That call adds the `skill` question when `routable` offers a real choice, giving 5 questions per request. `askedSkill(questions)` decides whether the case is scored.
- **Routable choices from the production policy.** `routableSkillsFor(role, skills)` (imported, not re-implemented) for an agent hired with the role's default skills. Work roles get their skills minus pinned ones, capped at 15; lifestyle roles get none. Each choice is `{ id, title, whenToUse }`, plus `none`.
- **One raw `fetch` per scored case** to `POST https://api.openai.com/v1/decisions` with model `gpt-6-luna` (`OPENAI_DECISION_MODEL` or the production default), mirroring `OpenAIMedia.decide`. No retries, concurrency 4, client timeout 10000 ms. Each full response, including per-option probabilities, is saved under `scripts/evals/skill-routing/results/`.
- **Answer read as production reads it:** `readTriage(answers, false, 'mentions', routable).skills`, which applies `readSkillPick`. A pick needs confidence ≥ 0.45; a runner-up joins when its own probability is ≥ 0.25. Anything else is unrouted, including a triage response that does not parse.
- **Definitions.** *Routed correct:* the pick is not null and any picked id is an acceptable label (or the pick is `none` and the label is `none`). *Top-1 correct:* the first picked id is acceptable. *Wrong route:* a non-null pick that is not routed-correct. *`none` precision:* the share of `none` picks labelled `none`. *`none` recall:* the share of `none` labels picked `none`.
- **Labels** were written before the first run, by one author, from each skill's "use when" line; ambiguous cases list both acceptable ids. Messages are written the way people chat: Persian with the English work words people really use, plus some Finglish. No message pastes a skill title or "use when" text.

## Dataset

- **152 cases** over **26 roles** in all five packs: lifestyle 65 (10 roles), tech 24 (4 roles), ai 16 (3 roles), mobile 26 (5 roles), publisher 21 (4 roles). Languages: English 69, Persian 74, Finglish 9.
- **Scored under the shipped policy (work roles): 87 cases** over 16 roles: tech 24 (4 roles), ai 16 (3 roles), mobile 26 (5 roles), publisher 21 (4 roles). Persian script 47.1% (41), Finglish 5, English 41. Expected `none`: 15 (17.2%). Two acceptable labels: 5. Needs the history line: 3.
- **Unrouted by policy: 65 lifestyle cases** (10 roles). No skill question is asked for them, so they are not sent and not counted as misses. Their labels stay in `cases.json` for the historical comparison and for any future policy change.
- **Routable choices per work role:** 4 to 6 skills plus `none`.

### Pinned safety skills

4 skills are pinned: always in the prompt in full, never offered to Decisions. The most pinned skills in any role's default set is 2 (lifestyle.wellbeing-companion).

| Pinned skill | In the default set of | Optional for |
|---|---|---|
| `core.scope-and-referral` | lifestyle.nutrition-coach, lifestyle.wellbeing-companion, publisher.legal-licensing | lifestyle.fitness-coach, lifestyle.sleep-coach, lifestyle.money-coach, tech.finance-ops, ai.ai-governance, mobile.player-support |
| `fitness.pain-aware-modification` | lifestyle.fitness-coach | (none) |
| `sleep.red-flag-referral` | lifestyle.sleep-coach | (none) |
| `wellbeing.crisis-protocol` | lifestyle.wellbeing-companion | lifestyle.relationships-coach |

## Results (work roles)

### Overall and by language

| Slice | Cases | Routed correct | Top-1 correct | Wrong route | Unrouted | `none` precision | `none` recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| All work roles | 87 | 98.9% | 98.9% | 1.1% | 0.0% | 93.8% (15/16) | 100.0% (15/15) |
| English | 41 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (8/8) | 100.0% (8/8) |
| Persian | 41 | 97.6% | 97.6% | 2.4% | 0.0% | 85.7% (6/7) | 100.0% (6/6) |
| Finglish | 5 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (1/1) | 100.0% (1/1) |
| Persian + Finglish | 46 | 97.8% | 97.8% | 2.2% | 0.0% | 87.5% (7/8) | 100.0% (7/7) |

### By pack

| Slice | Cases | Routed correct | Top-1 correct | Wrong route | Unrouted | `none` precision | `none` recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| tech | 24 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (4/4) | 100.0% (4/4) |
| ai | 16 | 93.8% | 93.8% | 6.3% | 0.0% | 75.0% (3/4) | 100.0% (3/3) |
| mobile | 26 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (4/4) | 100.0% (4/4) |
| publisher | 21 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (4/4) | 100.0% (4/4) |

### By case type

| Slice | Cases | Routed correct | Top-1 correct | Wrong route | Unrouted | `none` precision | `none` recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| Single-message cases | 84 | 98.8% | 98.8% | 1.2% | 0.0% | 93.8% (15/16) | 100.0% (15/15) |
| Needs history | 3 | 100.0% | 100.0% | 0.0% | 0.0% | n/a (0/0) | n/a (0/0) |
| Two acceptable labels | 5 | 100.0% | 100.0% | 0.0% | 0.0% | n/a (0/0) | n/a (0/0) |
| Small talk and quick facts | 15 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (15/15) | 100.0% (15/15) |

### Latency

Whole triage request, measured from this machine through the sandbox proxy (production will differ): p50 **274 ms**, p95 **455 ms**, max 905 ms. **0 of 87** calls (0.0%) went over the 2000 ms production triage budget; in production those turns would time out and stay unrouted. Mean input: 1222 tokens per request.

**Added latency, paired.** On 22 sampled cases, the same request was also sent without the `skill` question, alternating which went first. Median 268 ms with the question and 262 ms without. Median paired difference **12 ms** (p25 -16 ms, p75 107 ms). Proxy jitter is about the same size, so read this as an estimate.

### Runner-ups and provider behaviour

- Skill picks: 71. A runner-up was added to **1.4%** of them (1); it rescued a wrong first choice in 0 case(s).
- The `skill` answer carried per-option probabilities in 87 of 87 responses. Raw top choice correct, ignoring the confidence threshold: 98.9%.
- Statuses: ok 87. Unrouted reasons: none.

### Stability

Compared with `run-2026-10-20T13-48-43-188Z.json` on 87 scored cases: the same playbooks (or `none` / unrouted) in **100.0%**, the same first choice in 100.0%, the same correct/incorrect verdict in 100.0%, and the identical confidence in 100.0%.

## Every work-role miss

A miss is any scored case that is not routed-correct (wrong route or unrouted). Judgements: **router** (the label is right and the router erred), **label** (the label was wrong), **description** (a skill's "use when" line misleads routing), **ambiguous** (both readings are fair), **transport** (the call failed).

| Case | Lang | Message | Expected | Got | Conf. | Top probabilities | Judgement |
|---|---|---|---|---|---:|---|---|
| ctx-03 | fa | مکالمه‌ها که از ۵۰ تا پیام رد میشه بات چیزای قبلی رو قاطی می‌کنه، قبض API هم این ماه دو ب… | ctx.context-budgeting | none | 0.76 | none 0.80, context-budgeting 0.20, system-prompt-design 0.00 | router: Same miss as in the all-roles run: a confident none (0.80) for a Persian problem statement that asks nothing. With 'چیکار کنیم؟' added it routes at 1.00, and in English it routes at 0.84, so the description is sound and no rewrite is proposed. The question-wording change (see Wording experiments) fixes it. |

## Held-out set

`scripts/evals/skill-routing/heldout.json` was written after the first all-roles run and never used to tune wording. Under the shipped policy, 8 of its cases are work-role cases and 10 are lifestyle cases, unrouted by policy. Run 2026-10-20 13:49 UTC, catalog `4b6f6ca8624c`. The work-role subset is small and aimed at known weak spots: "what do I reply" support requests and problem statements that ask nothing. Treat it as a smoke test.

| Slice | Cases | Routed correct | Top-1 correct | Wrong route | Unrouted | `none` precision | `none` recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| Held-out work roles | 8 | 75.0% | 75.0% | 0.0% | 25.0% | 100.0% (2/2) | 100.0% (2/2) |

| Case | Lang | Message | Expected | Got | Conf. | Top probabilities | Judgement |
|---|---|---|---|---|---:|---|---|
| h-ps-03 | en | a player lost all their gems after reinstalling on a new phone, how should I answer? | ps.purchase-issues, ps.bug-handoff | unrouted (low_confidence, raw ps.purchase-issues @ 0.24) | 0.24 | purchase-issues 0.37, crisp-writing 0.30, bug-handoff 0.25 | description: Three-way split: purchase-issues 0.37, crisp-writing 0.30, bug-handoff 0.25. Unrouted, so harmless. The broad crisp-writing trigger ('a reply') pulls 'how should I answer'; see the open crisp-writing proposal. |
| h-ctx-01 | fa | بات‌مون هر وقت ابزار تقویم خطا میده همینطوری پشت هم دوباره امتحان می‌کنه | ctx.tool-design | unrouted (low_confidence, raw ctx.tool-design @ 0.44) | 0.44 | tool-design 0.53, none 0.45, system-prompt-design 0.01 | router: Another Persian problem statement with no question: tool-design 0.53 vs none 0.45, confidence 0.44, just under the threshold. Unrouted, so harmless. The question-wording change routes it at 0.99. |

## Wording experiments (work roles)

Candidate wording, run with `--variant` under the shipped policy (work-role cases only; packs and runtime untouched), on the main set and the held-out work cases.

| Wording | Main: routed correct | Main: wrong / unrouted | Main: `none` P / R | Held-out: routed correct | Held-out: wrong / unrouted | Held-out: `none` P / R |
|---|---:|---:|---:|---:|---:|---:|
| Shipped wording | 98.9% (86/87) | 1 / 0 | 93.8% / 100.0% | 75.0% (6/8) | 0 / 2 | 100.0% / 100.0% |
| Question wording, runtime text (candidate) (`variants/question-wording.json`) | 98.9% (86/87) | 0 / 1 | 100.0% / 100.0% | 87.5% (7/8) | 0 / 1 | 100.0% / 100.0% |

## Proposed "use when" rewrites

Not applied: pack text other than `pinned` is the product lead's call.

### `core.crisp-writing`

- **Now:** Use when writing or editing anything another person will read and act on: a reply, email, summary, post or report, in English or Persian.
- **Proposed:** Use when the writing itself is the job: drafting, tightening or restructuring an email, post, summary or report someone will read and act on, in English or Persian.
- **Why:** Still open, and now the only description lead on work roles. The broad 'a reply' trigger competes with every work skill that drafts replies: before the purchase-issues rewrite it split ps-01, it is the ps-04 runner-up in the all-roles run, and it pulls the held-out h-ps-03 (crisp-writing 0.30, purchase-issues 0.37, bug-handoff 0.25, so unrouted). In the all-roles experiment, narrowing it lifted purchase-issues to 0.46 on h-ps-03 and changed nothing else. It is a default for player support and the tech writer and optional in many work roles, so add cases for those roles before adopting. (cases: ps-01, ps-04, h-ps-02, h-ps-03)

## Notes and limits

- **What changed since the all-roles run.** Routing now applies to work roles only (`routableSkillsFor`). The four recommended rewrites were applied (entry requirements, conversation practice, readiness screen, purchase issues). Feeling words were removed from `core.weekly-review`, `cto.career-ladder` and `cs.ticket-triage`. On the 87 work-role cases, the shipped run differs from the all-roles run in 2 cases, both from the purchase-issues rewrite: ps-01 went from unrouted to purchase-issues, and ps-04 dropped its crisp-writing runner-up.
- **The two safety findings from the all-roles run no longer apply.** A first fitness plan routed without the PAR-Q+ screen, and wellbeing triggers phrased as feelings, were both lifestyle issues. Lifestyle agents always get the full prompt now.
- **Wrong routes are rare and mild.** Only ctx-03 loads the wrong thing: no playbook, when context budgeting was wanted. Every other miss on either set is unrouted, which means today's full prompt.
- **Question-wording candidate (runtime, not packs).** Telling Decisions that a message describing a problem in this colleague's field asks for help, and narrowing `none`'s 'a quick factual answer' to 'a one-line general fact', fixes both Persian problem statements. On work roles it trades one wrong route for one harmless unrouted turn (ev-01: online-monitoring at 0.35), and takes the held-out work cases from 6/8 to 7/8. In the all-roles run its only harm was pushing fitness pain messages into a skill, and those agents are now unrouted by policy. The evidence is small (3 cases changed), so it is worth adopting in shadow first; the wording is in `scripts/evals/skill-routing/variants/question-wording.json`.
- **Stability.** The two shipped-policy runs agree on all 87 scored cases, with identical confidences, so repeat runs measure provider noise only. Robustness to wording is a separate question; see ctx-03.
- **Coverage gap.** The set covers 16 of the 43 work roles. The roles whose triggers were just edited (`cto.career-ladder`, `cs.ticket-triage`) are among the uncovered ones, as are the security, QA, tech writer, recruiter, finance, AI safety, governance, LLM infra, iOS, Android, release, community, game design, monetisation, BD, market research, brand, platform and book roles. Add about 3 cases per uncovered role before trusting the work-only numbers across the catalog.
- **Limits.** One author wrote and labelled every case, with the skill list in view. The held-out work subset is only 8 cases. Real traffic will be harder: longer, multi-topic messages, voice-note transcripts and typos. Run `STUDIO_SKILL_ROUTING=shadow` first and compare the content-free outcome rates with these.
- **Artefacts.** Raw provider responses for every run are saved under `scripts/evals/skill-routing/results/` (git-ignored): choices, confidences, per-option probabilities and usage. To rebuild this report from a saved run: `npm run eval:skills -- --from <run file>`. To try wording without editing packs: `--variant <file>`. To run the held-out set: `--cases scripts/evals/skill-routing/heldout.json`.

## Historical: all-roles run, before the work-only policy

Kept for comparison. This run offered every role's skills to Decisions, lifestyle roles included, with the catalog wording of the time: before the four rewrites and the feeling-word edits. It scored all 152 cases. Its misses, wording experiments and safety findings led to the shipped policy and the applied rewrites.

Run 2026-10-20 13:25 UTC, catalog `79669cbb647c`, all 152 cases scored.

| Measure | Target | Result | |
|---|---|---:|---|
| Correct skill, any acceptable label (unrouted counts as a miss) | ≥ 85% | 96.7% (147/152) | met |
| Correct skill, Persian script | ≥ 80% | 95.9% (71/74) | met |
| `none` precision | ≥ 90% | 92.9% (26/28) | met |
| Wrong route | (none set) | 1.3% (2) | |
| Unrouted (keeps the full prompt) | (none set) | 2.0% (3) | |
| Latency, whole triage call | 0 added (same request) | p50 281 ms, p95 424 ms | |
| Run-to-run agreement | (none set) | 100.0% (152/152) | vs `run-2026-10-20T13-23-57-165Z.json` |

| Slice | Cases | Routed correct | Top-1 correct | Wrong route | Unrouted | `none` precision | `none` recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| All roles | 152 | 96.7% | 96.7% | 1.3% | 2.0% | 92.9% (26/28) | 96.3% (26/27) |
| English | 69 | 97.1% | 97.1% | 1.4% | 1.4% | 91.7% (11/12) | 100.0% (11/11) |
| Persian | 74 | 95.9% | 95.9% | 1.4% | 2.7% | 92.9% (13/14) | 92.9% (13/14) |
| Finglish | 9 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (2/2) | 100.0% (2/2) |
| Pack: lifestyle | 65 | 95.4% | 95.4% | 1.5% | 3.1% | 91.7% (11/12) | 91.7% (11/12) |
| Pack: tech | 24 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (4/4) | 100.0% (4/4) |
| Pack: ai | 16 | 93.8% | 93.8% | 6.3% | 0.0% | 75.0% (3/4) | 100.0% (3/3) |
| Pack: mobile | 26 | 96.2% | 96.2% | 0.0% | 3.8% | 100.0% (4/4) | 100.0% (4/4) |
| Pack: publisher | 21 | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% (4/4) | 100.0% (4/4) |

### Misses in that run

| Case | Lang | Message | Expected | Got | Conf. | Top probabilities | Judgement |
|---|---|---|---|---|---:|---|---|
| fit-08 | fa | از دیروز زانوم یه کم درد می‌کنه، امروز اسکوات بزنم یا نه؟ | none | unrouted (low_confidence, raw none @ 0.34) | 0.34 | none 0.47, readiness-screen 0.44, program-design 0.03 | description: none 0.47 vs readiness-screen 0.44: the readiness trigger's 'returns after injury' pulls a new-ache message. Harmless here (unrouted keeps the full prompt, and the pinned pain skill is always loaded). With the readiness rewrite it goes to none. |
| lrn-08 | en | Hallo, ich möchte ein Kaffee mit Milch, bitte | learn.conversation-practice, learn.error-feedback | unrouted (low_confidence, raw none @ 0.42) | 0.42 | none 0.50, conversation-practice 0.41, level-diagnostic 0.06 | description: none 0.50 vs conversation-practice 0.41: the trigger covers asking to practise, not answering inside a practice the tutor started, so a German reply reads as small talk. Fixed by the conversation-practice rewrite. |
| trv-04 | en | Iranian passport, living in Germany on a blue card. do I need a visa for a weekend in Lon… | travel.entry-requirements-check | none | 0.56 | none 0.63, entry-requirements-check 0.29, contingency-plan 0.03 | description: none 0.63 vs entry-requirements 0.29. The trigger reads as a precondition ('once nationality, residence and route are known'), not as the question people ask, and the none option's 'a quick factual answer' takes visa questions. A quick wrong visa answer is the costliest miss in the set. The rewrite fixes it, with 0.98 on two held-out visa questions. |
| ctx-03 | fa | مکالمه‌ها که از ۵۰ تا پیام رد میشه بات چیزای قبلی رو قاطی می‌کنه، قبض API هم این ماه دو ب… | ctx.context-budgeting | none | 0.76 | none 0.80, context-budgeting 0.20, system-prompt-design 0.00 | router: Confident none (0.80) for a Persian problem statement that asks nothing. The same text ending in 'چیکار کنیم؟' routes to context-budgeting at 1.00, and the English statement at 0.84, so the label and the description are sound. The question-wording variant fixes this case but sends pain messages to readiness-screen, so it is not recommended as written. |
| ps-01 | fa | یه بازیکن میگه پول از کارتش کم شده ولی جم‌ها بهش نرسیده. چی جوابش رو بدم؟ | ps.purchase-issues | unrouted (low_confidence, raw ps.purchase-issues @ 0.41) | 0.41 | purchase-issues 0.51, crisp-writing 0.39, none 0.04 | description: purchase-issues 0.51 vs crisp-writing 0.39: 'what do I reply' pulls the generic writing skill (its trigger lists 'a reply'). The case stays unrouted, which is harmless. The purchase-issues rewrite (which adds replying) fixes it. |

### Wording experiments (all roles, before the policy)

Each candidate wording was run with `--variant`, leaving packs and runtime untouched, over the main set and over all 18 held-out cases. The held-out set targets known weak spots, so its absolute numbers are lower by design. Compare rows, not sets.

| Wording | Main: routed correct | Main: wrong / unrouted | Main: `none` P / R | Held-out: routed correct | Held-out: wrong / unrouted | Held-out: `none` P / R |
|---|---:|---:|---:|---:|---:|---:|
| Current wording | 96.7% (147/152) | 2 / 3 | 92.9% / 96.3% | 72.2% (13/18) | 3 / 2 | 75.0% / 75.0% |
| Four use-when rewrites (recommended) (`variants/when-to-use-rewrites.json`) | 99.3% (151/152) | 1 / 0 | 96.4% / 100.0% | 88.9% (16/18) | 0 / 2 | 100.0% / 100.0% |
| Four rewrites plus narrower crisp-writing (`variants/when-to-use-rewrites-plus-writing.json`) | 99.3% (151/152) | 1 / 0 | 96.4% / 100.0% | 88.9% (16/18) | 0 / 2 | 100.0% / 100.0% |
| Question wording only (runtime text; not recommended) (`variants/question-wording.json`) | 97.4% (148/152) | 1 / 3 | 100.0% / 92.6% | 83.3% (15/18) | 1 / 2 | 100.0% / 75.0% |
| Rewrites plus question wording (`variants/combined.json`) | 98.0% (149/152) | 0 / 3 | 100.0% / 92.6% | 88.9% (16/18) | 0 / 2 | 100.0% / 75.0% |

### Rewrites from that run

#### `travel.entry-requirements-check` (applied)

- **Was:** Use when planning any international trip, once each traveller’s nationality, residence and route (including transits) are known.
- **Applied:** Use when someone asks whether they need a visa, eTA or transit visa, or how long their passport must be valid, or plans any international trip; check each traveller's nationality, residence and route.
- **Why:** Today's trigger is a precondition, so direct visa and passport questions fall to none as quick facts. Main set: trv-04 goes from none to the skill. Held-out: two visa questions go from none and unrouted to 0.98. The weather (none) and booking near-misses are unchanged. (cases: trv-04, h-trv-01, h-trv-02, h-trv-03, h-trv-04)

#### `fitness.readiness-screen` (applied)

- **Was:** Use when someone first asks for a training plan, or returns after injury, illness, surgery, pregnancy or a long break.
- **Applied:** Use when someone is about to get their first training plan, or comes back to training after an injury, illness, surgery, pregnancy or a long break. Not for a new ache mid-programme.
- **Why:** 'Returns after injury' draws new-ache messages, which belong to the pinned pain skill. The held-out back-ache message moves from readiness-screen (0.56) to none (0.79), and fit-08 from unrouted to none. Post-surgery and first-plan positives still route correctly. (cases: fit-08, h-fit-01, h-fit-02, h-fit-03)

#### `learn.conversation-practice` (applied)

- **Was:** Use when a learner wants to practise speaking or chatting, by text or voice.
- **Applied:** Use when a learner wants to practise speaking or chatting, by text or voice, or answers in the target language inside a practice conversation or role-play.
- **Why:** Turns that answer inside a role-play looked like small talk. lrn-08 and two held-out role-play answers now route; the held-out 'check this email' near-miss still goes to error-feedback. (cases: lrn-08, h-lrn-01, h-lrn-02, h-lrn-03)

#### `ps.purchase-issues` (applied)

- **Was:** Use when a player reports being charged without receiving items, losing purchases after a reinstall, a double charge, or asks for a refund.
- **Applied:** Use when a player reports being charged without receiving items, losing purchases after a reinstall, a double charge, or asks for a refund, including what to reply to them.
- **Why:** 'What do I reply' requests split toward crisp-writing and went unrouted. ps-01 now routes. The held-out pure writing job (h-ps-02) still goes to crisp-writing. (cases: ps-01, h-ps-01, h-ps-02)

### Notes from that run

- **Pinned set (4).** `wellbeing.crisis-protocol`, `core.scope-and-referral` (crisis, red flags, eating-disorder signs, legal and regulated-money limits), `sleep.red-flag-referral` (apnea, drowsy driving) and `fitness.pain-aware-modification` (the fitness role's red-flag screen: chest pain, fainting, numbness). Each catches risk whatever the message is about, and the fitness role does not carry scope-and-referral by default. At most 2 pinned skills sit in any default set (wellbeing companion).
- **Left routable on purpose.** `fitness.readiness-screen` (a first-plan intake), `nutrition.baseline-audit` and `target-estimation` (each runs its own SCOFF screen or needs it clear; the nutrition coach carries the pinned scope skill), `chef.food-safety` (only matters when food handling or allergies come up), `money.investing-education`, `travel.contingency-plan` and all legal playbooks (the legal role carries the pinned scope skill).
- **Safety gap this eval surfaced (resolved by the work-only policy): the first plan without the PAR-Q+ screen.** `fitness.program-design` never refers to the readiness screen. When routing picks program-design alone for a first plan (fit-07 does under the recommended rewrites), the screen is not in the prompt that turn. Today's full craft always has it. Options: add a first step to program-design ('If no readiness screen is on record, run it first'), or pin readiness-screen (the fitness default set would then hold 2 pinned skills, still within the limit).
- **Policy tension (resolved by the work-only policy): wellbeing triggers are written as feelings.** The routable wellbeing skills trigger on feelings: grounding ('feels anxious, overwhelmed, panicky'), values activation ('low motivation… feeling flat') and the check-in ('telling you how they are'). Routing them asks Decisions to read emotional state, which `AGENT_INTELLIGENCE_SOLUTION.md` §4.8 rules out, whatever the question's instructions say. Either keep the wellbeing companion unrouted, or rewrite those triggers as requests ('asks for a quick way to calm down', 'asks for help getting going again'). The 3 wellbeing cases here are task-phrased and all routed correctly; this eval does not test feeling-phrased messages on purpose.
- **Pinned skills cover only roles that carry them.** The crisis protocol is a default only for the wellbeing companion (optional for relationships). Career, money, fitness and sleep agents do not carry it by default. Routing does not change this, but it is the bigger safety lever.
- **Stability is not robustness.** Both full runs returned identical choices and confidences (to the provider's 2 decimals), so repeat runs only measure provider noise. Wording sensitivity is real: adding 'چیکار کنیم؟' moves ctx-03 from none 0.80 to the right skill at 1.00. Persian problem statements that ask nothing lean toward none (ctx-03, h-ctx-01).
- **Split votes go unrouted, safely.** When two acceptable skills share the vote, confidence falls under 0.45 and the turn keeps the full prompt (h-ps-03 with the crisp-writing rewrite: purchase-issues 0.46, bug-handoff 0.28, confidence 0.35). That costs focus, not correctness. A runtime option, not tested here: route the top two when their combined probability is high and none is low.
- **No label changed after the runs.** All 5 misses were reviewed. None was a bad label: 4 come from a misleading "use when" line, and 1 (ctx-03) is a router error on a Persian problem statement that asks nothing.
- **Limits.** One author wrote and labelled every case before run 1, with the skill list in view, so real traffic will be harder: longer, multi-topic messages, voice-note transcripts and typos. The held-out set is small (18) and written after the main run. Treat the numbers as a check that the design works, not as a production estimate. Run `STUDIO_SKILL_ROUTING=shadow` first and compare the content-free outcome rates with these.

