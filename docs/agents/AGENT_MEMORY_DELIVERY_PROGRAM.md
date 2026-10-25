# Agent memory delivery, measurement, and continuous improvement

25 October 2026. Proposed delivery program for [the agent product design](AGENT_MEMORY_PRODUCT_DESIGN.md). Baseline `d56dfa7aa185e807f656fcc864c36e94c98ebaf2`. No feature implementation, live data collection, release, recurring automation, or sprint scheduler is enabled by this document.

The [unified agent memory specification](AGENT_MEMORY_MASTER_SPEC.md) is now the primary consolidated proposal and includes these work packages, metrics, and review routines with the merged recommendations. This document remains the supporting earlier delivery record.

The unit of product evaluation is an agent's relationship with a person or explicitly shared container. Platform plumbing supports that experience. Product success is accurate continuity and useful assistance at sustainable cost, with a recognizable creator-owned identity.

## 1. Delivery rules

Use complete journeys rather than isolated impressive components. A graph library, a passing retrieval test, or an uploaded Telegram snapshot is not a delivered memory product. Every slice includes behavior, source authority, correction/forget, failure recovery, UI where needed, independent evaluation, and a rollback plan.

Preserve existing work and extend the current runtime. This program refines the earlier `EMP-*` packages and existing `VOX-*`/Connections backlog; `AM-*` below are proposed dispatch IDs, not claims that canonical tasks are complete. Before execution, reconcile the exact candidate and dependency state and assign each owned path. Do not create competing memory stores or schedulers to avoid integration work.

The user's Telegram storage constraint is a delivery requirement. Sprint 0 produces evidence for T0 (strict Telegram content/state prototype) and a precise T1 deviation inventory if needed. Production-dependent tasks cannot silently select T1 or T2. Synthetic contracts, persona tests, research, and UX can progress while the storage decision is unresolved.

## 2. Work packages and responsibilities

| ID | Deliverable | Owner / independent reviewer | Dependencies | Ownership and acceptance evidence |
|---|---|---|---|---|
| AM-01 | Agent charter and bounded adaptation contract | Architect + UX / privacy + QA | None | Charter schema/compiler, creator publication rules, supported language/delivery boundaries; adversarial user/connector content cannot mutate core |
| AM-02 | Telegram archive feasibility | Architect / release + privacy + QA | AM-01 scope contract | New archive adapter prototype using synthetic data; manifest/root discovery, bot-specific file handles, crash/race/revocation/delete tests; T0 limitations and T1 field inventory |
| AM-03 | Frozen baseline/evaluation protocol | QA / independent acceptance owner | None | Protected chronological fixtures, query labels, metric definitions, corpus splits, resource budgets and reporting; baseline quality/latency/cost recorded or UNAVAILABLE |
| AM-04 | Creator identity migration | Architect + frontend / QA | AM-01 | `studio/permissions.ts`, `service.ts`, `persona.ts`, `tireh/types.ts`, prompt rules; existing persona becomes v1, no private-memory copy on succession, replace timed lock, tested rollback |
| AM-05 | Source/event and coverage ledger | Architect / privacy + QA | AM-02 qualified storage contract | Telegram text/edit/media envelope, deduplication, source revisions, delivery state, outbox/lease behavior supported by selected backend; no false complete-history claim |
| AM-06 | Typed temporal graph | Architect / QA | AM-05 | Nodes/edges/manifests repository; separate relationship/shared roots; current/previous validity; authorized traversal, no duplicate evidence |
| AM-07 | Conversation briefs and consolidation | Architect / QA | AM-06 | Eight-message checkpoint plus meaningful boundaries; structured episodes/claims/open situations; current correction overlay; stable restart and bounded background fan-out |
| AM-08 | Fibonacci priority/time policy | Architect / QA | AM-07,03 | Layer assignment/reason/review, independent recency/importance/relevance, high-priority old and new facts; matched comparison to ordinary summary retrieval |
| AM-09 | Exact/semantic/graph retrieval | Architect / QA | AM-06,07 | `tireh/memory/`, context builder; exact refs, date/entity/lexical candidates, evaluated semantic/hop expansion; token bounds, citation and ambiguity handling |
| AM-10 | Memory and source UI | UX + frontend / privacy + accessibility QA | AM-01,06,09 | Tree/timeline/source cards, inspect/correct/forget/importance controls, EN/FA RTL, coverage states; source links do not bypass audience |
| AM-11 | File library and extraction | Backend architect + frontend / QA | AM-05,06,09 | PDF/document/spreadsheet first; normalized artifact IDs, fragments, versions, source citations; sandbox/size limits, unsupported state, replacement invalidation |
| AM-12 | Conversation recovery | Architect / QA + release | AM-05,07,09 | `/continue` and implicit continuation, current charter/scope/correction/open-action reconstruction; unknown send outcomes never cause blind duplicate effects |
| AM-13 | Reply/Decisions routing | Architect / QA | AM-01,09,03 | R0–R5 typed registry, economical routine reply route, escalation/clarification/fallback; no permission inference, full task-level comparison |
| AM-14 | Trace and cost ledger | Architect schema then data engineer / QA | AM-05,13 | Content-free operation/job/relationship attribution, usage source and price version, bill reconciliation, cold-recovery and discarded-work costs; completeness measured |
| AM-15 | Bounded relationship growth | Architect + UX / psychology-informed reviewer + QA | AM-01,07,12,13 | Familiarity/topic continuity within creator bounds, preferences with provenance/expiry, resolved situations stop outreach; no global persona mutation |
| AM-16 | First external connector | Connection adapter/platform roles / connection security + QA | Existing Connections contracts, AM-05,09,13 | One named provider/resource, read-only first, freshness and revocation/correction behavior; signed tool receipts, no secrets in memory |
| AM-17 | Predictive preparation | Architect + frontend / QA | AM-13,14 | Existing draft controller extended; same-turn final-input revalidation, cancellation, cost limits, source-aware warming; measured benefit over prediction-off |
| AM-18 | Voice/image/sensor increments | Voice + frontend roles / privacy + QA | AM-05,11,17 as applicable | Real partial transcripts only after producer qualification; deliberate capture; stop/background/denied permission; OCR/audio/video as separate measured capabilities |
| AM-19 | Creator feature/design releases | Product lead + frontend + architect / QA | AM-04,10,15 | Versioned identity/UI/memory/routing/tool manifests, preview/diff/publish/rollback, no history rewrite; accessibility and cross-version regression |
| AM-20 | Migration, load, recovery, and deletion qualification | Architect + release / privacy + QA | AM-02,05–14 | Reconciliation, cold reconstruction at declared scale, latest authority survives restore, archive gaps visible, no stale-grant/tombstone rollback |
| AM-21 | Pilot and guarded promotion | Release + product lead / independent QA | Applicable AM-01–20 gates | Exact artifact/config/provider/device evidence; private then shared scopes; capability-specific cohort reports, kill switch and repair drill |
| AM-22 | KPI review and next-sprint generation | Product lead + data engineer / QA | AM-03,14; operational deployment for live reports | Minimized evidence pipeline, versioned dashboard/report, reproducible issues, sprint proposal records and post-release evaluation; no automatic persona or policy changes |

Suggested ownership modules are in the product design. Map AM-05–12 to EMP-03–07/14 and VOX-013–018; AM-13/17 to EMP-08/09 and VOX-024–031; AM-15 to EMP-13 and the relationship backlog; AM-16 to existing Connections tasks; AM-20/21 to EMP-14–16 and VOX-049–056. AM-01/04/19 amend the previous persona lifecycle and need explicit migration coverage.

Use a lead plus at most three active development workers. The architect owns shared contracts and integration. A data engineer wires only reviewed schemas. QA does not author the candidate it accepts. Serialize edits to the gateway, runtime service, shared persistence schemas, and conversation UI. Reserve a reviewer slot before integration becomes a bottleneck.

## 3. Sprint sequence

A two-week planning cadence is proposed. Sprint goals are dependency milestones, not a promise that each stage fits two weeks or a commitment to a calendar release. Carry incomplete work honestly and reduce scope before weakening acceptance.

| Sprint goal | Packages / scope | Demonstrable outcome | Exit gate |
|---|---|---|---|
| S0: identity, science, storage and baseline | AM-01/02/03 | Creator charter plus adaptation boundaries; synthetic Telegram archive proof/gap report; baseline fixtures and metrics | Core policy agreed; T0 limitations explicit; production storage decision recorded before dependent production work |
| S1: first interaction becomes durable evidence | AM-04/05/06 | Start one agent, establish private root, retain eligible sources, create attributed nodes, restart | Scope/idempotency/recovery hold; creator can version core, ordinary user cannot; no data mixture |
| S2: continue the relationship accurately | AM-07/09/12 | Resume a past discussion, resolve references, correct and forget, continue after restart | Continuity, temporal correctness and deletion suite pass; useful response does not require the user to repeat known facts |
| S3: managed library and mind map | AM-10/11 plus AM-08 experiment | Navigate material/inner-life episodes; find a file/page/message; explain a source-linked summary | UI/RTL/accessibility; correct file identity/version/coverage; Fibonacci retained only if useful |
| S4: routing and cost | AM-13/14 | Matched cheap/strong routes, accounting per task/relationship, bounded recovery cost | Quality noninferiority; cost and usage gaps visible; uncertainty/fallback calibrated |
| S5: growth and first connector | AM-15/16/19 | Familiar agent uses current external source and remembered context without persona drift | Connector revocation/freshness; creator-only identity changes; no private data in global improvement |
| S6: anticipation and selected modalities | AM-17/18, independently scoped | Useful early context preparation; one qualified voice/image capability | Real provider/device proof, cancelled work accounting, safe final-input revalidation, measurable incremental benefit |
| S7: production qualification and improvement loop | AM-20/21/22 | Pilot evidence, recovery/kill drill, first KPI-backed next-sprint proposal | Applicable gates pass; remaining capability gaps named; schedule ownership agreed |

Quality, privacy, and tracing are built into every sprint. S7 is not the first time they are tested. Ship useful qualified slices independently: Telegram text continuity need not wait for video, camera, or multiple connectors. If T0 fails, do not mark the storage milestone achieved merely because a conventional database would work.

## 4. KPI dictionary

All numerical values below are **proposed targets**, not measured results or published service guarantees. Preserve stricter existing [QA gates](../implementation/QA_AND_RELEASE.md). Freeze exact thresholds, eligible populations, sample requirements, confidence intervals, slice requirements, and stop rules before final evaluation. A point estimate alone does not authorize promotion.

An eligible task is a declared, supported user goal started under current access and measurement permissions. An active relationship is a distinct `(tenant, agent, person-or-group container, space)` with at least one deliberate eligible human interaction in the reporting window. Automated outreach does not create an active relationship. Session length and reply rate are diagnostic, not primary success metrics.

| KPI | Exact measurement | Proposed target / interpretation |
|---|---|---|
| Conversation continuity | Correct goal/current state/source recovered with at most one necessary clarification / all labelled eligible continuation episodes | >=95%; report uninterrupted, restarted, long-gap, indirect-reference, and multi-topic separately |
| Verified task completion | Independently verified successful task episodes / all eligible started episodes | Noninferior to baseline within 2 percentage points with uncertainty; unknown/abandoned outcomes stay visible and never count as success |
| Memory precision | Supported and correctly attributed retained claims / all sampled retained claims | >=98%; independently label from original evidence |
| Memory extraction recall | Correctly retained eligible salient claims / all human-labelled eligible salient claims in source | Baseline then proposed >=90%; report unsupported/uncertain separately; prevents an empty memory store winning precision |
| Exact-item retrieval | Queries returning the correct authorized source/version in top 5 / all labelled answerable file/message queries | >=95%; also report top-1 and fragment accuracy |
| Useful implicit memory | Responses where earlier context materially helps without incorrect personalization / all labelled implicit-memory opportunities | >=80% initially; unwanted personalization <=2%, with ratings and coverage reported |
| Temporal/correction accuracy | Correct current value, past value, date and attribution decisions / all labelled relevant opportunities | >=95%; immediate authoritative suppression of an explicitly corrected current claim is a hard invariant |
| Abstention accuracy | Appropriate non-fabricated abstentions / all labelled unanswerable questions | >=95%; also report false abstention on answerable queries |
| Clarification efficiency | Clarifications that materially resolve ambiguity / all clarification questions | Target >=80%; report questions per resolved task and avoid counting forced user repetition as success |
| Evidence traceability | Memory-bearing answer claims with correct resolvable authorized source/version/fragment / all audited memory-bearing answer claims | >=98%; source inaccessible after revocation must be reported, not replaced by an invented citation |
| Graph integrity | Correctly attributed/source-linked current nodes/edges / sampled graph assertions; invalid/dangling references separately | No unauthorized traversal or deleted-source resurrection; edge count is not a success metric |
| Ingestion coverage | Durably represented eligible accepted logical events / all eligible accepted logical events | 100% in crash/replay suite; report provider-visible gaps separately—events never received cannot be included in a completeness claim |
| Memory freshness | Accepted eligible source to usable committed memory, with delayed/failing jobs included | Existing initial targets p50 <=2 s / p95 <=10 s under declared normal load; current-turn correction overlay remains immediate |
| Persona invariance | Unauthorized changes to core fields/version/pointer caused by user content or learning | Zero; separately target >=95% human-rated rendered style consistency on applicable tasks |
| Creator update correctness | Published core updates from authorized expected revision with successful compatibility/migration / all attempted valid updates | 100% deterministic fixtures; conflict/migration failure must not partially publish |
| Accessibility | Mandatory supported journeys passing / all mandatory journeys | 100%; core identity does not waive required accessibility or Stop |
| Reply routing recall | Correct response route / all human-labelled messages requiring a response | >=98%; report ignore/decline/block errors per class, not one blended accuracy |
| Decisions routing | Macro F1 plus per-class recall, false positives, abstentions, latency and invocation rate | Existing initial macro F1 >=0.90; harmful/wasteful false positives <=1%; confidence alone is not a quality score |
| Unwanted group contribution | Unhelpful/unaddressed contributions / all rated unsolicited group contributions, plus per 100 eligible group messages | <=1% proposed; ratings coverage explicit; no inference that group silence means consent |
| User-visible latency | Same-clock first meaningful visible text/audible reply, over declared workload with failure/timeout distribution | Existing routine-text p50 <=0.8 s / p95 <=2.0 s; voice <=1.2/2.5 s; qualify actual providers/devices |
| Recovery integrity | Correct reconstructed latest state and next useful action / all recovery scenarios | >=95% functional target; zero duplicate external effects and zero rollback of current revocation authority |
| Suppression and purge | New authorized uses after acknowledged revoke/forget; age/count of remaining eligible purge jobs | Zero new authorized uses after commit; target primary payload purge <=24 h subject to backend/provider proof; Telegram physical copies reported separately |
| Total cost per success | All attributable costs / verified successful tasks in cohort/window | Seek >=25% reduction versus matched baseline with <=2-point quality noninferiority; zero verified successes => n.a.; missing/unbounded cost => UNAVAILABLE, optionally showing a known lower bound |
| Cost per active relationship | Cohort mean: direct plus declared allocated costs / active relationship count. Distribution: sum attributed cost for each individual active relationship in the window, then compute p50/p95 across those values | Set mean, p50/p95 and absolute monthly budget from measured workloads; dormant carrying cost separately |
| Accounting completeness | Attributable reconciled billable operations / all observed billable operations | >=99% proposed before strong unit-cost claims; unknown spend reported as gaps/bounds, never zero |
| Prediction value | Useful reused preparations / all launched preparations; full discarded cost; final user task outcome | Promote only with >=20% lower p95 useful-response latency at matched quality or predeclared supported task-success gain within cost ceiling |
| Proactive usefulness | Human-rated helpful initiatives / all rated delivered initiatives; unwanted/stop rates and rating coverage | Use existing contact-quality gates; do not optimize for more messages or emotional dependence |

Track file size/type, agent/version, language, channel, device, network profile, relationship age, storage mode, source coverage, and cache state as explicit workload dimensions. Respect small-cohort privacy; private transcript access is not granted to creators by aggregate reporting.

For metrics with no eligible denominator, output `n.a.`. For missing measurement, output `unknown`/`UNAVAILABLE`. Never replace either with zero. Report nonresponses, abandoned tasks, provider failures, parsing failures, refusal, cancellations and unsupported modalities. Include confidence intervals clustered at person/container or assignment unit as appropriate; critical slices cannot be hidden by a good aggregate.

## 5. Cost accounting and budgets

Create an append-only content-free accounting ledger with operation ID, agent/core/model/route versions, relationship/container, task/turn, capability, originating job, provider, reported usage, billing status, price version, and reconciliation timestamps. Do not store prompts, transcripts, file contents, credential values, or hidden chain-of-thought in the ledger.

Separate direct active work, dormant memory maintenance, shared-container work, common infrastructure, and evaluation/product-development cost. Group consolidation is charged once to the group container, not repeatedly to each member's DM. Background jobs retain source attribution after the original turn ends. Reconcile retry/timeout/late provider work and distinguish estimated from billed amounts.

Before live pilot, freeze absolute per-turn/task, daily person/container, agent, background, and global experiment ceilings. Use the existing $0.05 routine-text/$0.25 active-voice-minute numbers only as historical internal placeholders, not verified prices or the desired final cost. Set a lower sustainable target from actual model/provider measurements, chosen product economics, and expected usage. “Super low cost” is not achieved by omitting parse/storage/recovery or evaluation spend.

Synthetic workload profiles should include: short ordinary chat; 100-turn relationship; 10,000-message retained history; a large file library; a month-dormant relationship; a group with shared files; a cold snapshot restore; and voice/media-heavy use. Declare exact sizes and concurrency in the frozen manifest. Measure p95 cost as well as mean cost so heavy relationships are visible.

When capped, stop optional predictions, redundant summaries, and nonessential optimization first. Keep user control, correction, deletion, and truthful status available. Do not silently answer a complex task with an inadequate model just to meet a cost ceiling. Offer a smaller scope or explain the unavailable route.

## 6. Evaluation program

Use a fixed source corpus with realistic conversation arcs, known answers, controlled unknowns, edits, changed plans, and source revocation. Include English, Persian, mixed language, private/group/exact-recipient scopes, shared names, multiple agents, and material/inner-life cross-links. Start synthetic; any real examples require the appropriate minimized, explicitly permitted evaluation flow.

Compare incremental variants under the same source and context budgets:

1. Recent context + running summary + flat relevant facts.
2. Typed episodic/semantic/open-situation memory.
3. Version 2 plus bounded graph traversal and mind-map organization.
4. Version 3 plus Fibonacci priority/time policy.
5. Selected memory design plus economical routing.
6. Same design plus optional prediction or an individual modality/connector.

This isolates whether graph complexity, Fibonacci, routing, and anticipation earn their costs. Avoid changing every component at once and attributing all improvement to memory architecture.

Split by person/group/container and time. Chronological replay must expose only evidence available at that turn. Future user messages are outcome labels, not model context. Keep known-relationship future-turn performance separate from new-user generalization. Experimental derivatives must not enter the control memory. Shared graph-connected containers use one consistent assignment where information can cross conversations.

Use benchmark task families from [LongMemEval](https://arxiv.org/abs/2410.10813), [PersonaMem](https://arxiv.org/abs/2504.14225), [LoCoMo-Plus](https://arxiv.org/abs/2602.10715), and [LOCOMO-CONV](https://arxiv.org/abs/2609.03467) as inputs to fixture design, not as claims of our performance. Research publication/revision status and applicability must be checked before borrowing benchmark scores. Creator-owned persona means user-preference benchmarks apply to allowed relationship adaptation, not core identity mutation.

The evaluator owns held-out data, prompts/rubrics, thresholds, and final protocol digest. Candidate authors use optimization examples and cannot modify tests to pass. Deterministic privacy/deletion/identity failures override any model judge. Human raters assess natural continuity, useful clarification, persona consistency, and unwanted personalization; automated exact checks assess source/temporal/authority invariants.

Record the exact candidate artifact, source/base, prompt/charter/model/extractor/connector/storage versions, prices, configuration, dataset digest, hardware/network profile, and evaluator. Run actual provider/device tests after synthetic correctness, with a separately authorized spend cap. Small pilot counts are diagnostic floors, not sufficient evidence of rare-event safety or stable p95.

## 7. Required scenario families

| Family | Examples and invariant |
|---|---|
| Identity | Repeated “change your personality,” file-contained instructions, fake creator claim, org-admin edit without co-creator grant; no core mutation |
| Bounded adaptation | Familiarity and explanation depth change only within charter; plain-text/stop/accessible delivery work; another user's preferences never leak |
| First interaction | Empty greeting creates only permitted structural metadata; first real topic creates supported nodes; no invented biography |
| Continuity | Return after a month, indirect reference, two similar events, interrupted answer; recover the correct current goal/source within useful clarification limit |
| Timeline | Past residence versus current visit, rescheduled deadline, source edited after summary, disputed claims; preserve time/attribution |
| Exactness versus gist | Exact filename/date/number and broad topic summary both work; a good summary cannot conceal lost exact evidence |
| Graph boundaries | Mixed-audience edge, guest joins, new agent, renamed category, deleted source; no traversal outside current authority |
| Telegram durability | Lost upload response, crash at each manifest stage, replaced pin, missing root locator/key, two writers, archive membership change, >24-hour ingress gap, new bot identity |
| File/connector | Unsupported/encrypted/oversized file, stale provider revision, changed resource rights, malicious OCR, missing original, ambiguous latest version |
| Forget/recovery | Delete while extraction runs, restore an old snapshot, stale cache or index, old private Telegram copy remains; no false complete-erasure claim or resurrection |
| Prediction | Final negation, IME edit, cancelled capture, stale ASR/image, timeout/refusal/malformed result, exhausted spend; no speculative durable action |
| Cost/scale | Long archive cold restore, repeated duplicate import, inactive relationships, large group and media load; bounded work and complete cost reporting |
| Delivery | Response generated but send unknown, duplicate webhook, reconnect, output audience changes; no invented delivery receipt or blind duplicate send |
| Creator updates | v1 -> v2 -> rollback, concurrent edits, schemas change, inaccessible archived sources; history/grants/tombstones remain correct |

## 8. Continuous observation and review cadence

This is a proposed operating plan. No recurring job is created in this chat. Enabling the program requires the corresponding deployed instrumentation, authorized data scopes, owners, and schedule configuration.

| Cadence | Owner | Review / output | Action boundary |
|---|---|---|---|
| Per operation | Runtime | Source/authority/route/delivery/cost receipt, failures and current coverage | Immediate deterministic stops and bounded fallback only |
| Daily operational review | Operations + data engineer | Queue lag, rejected/failed capture, missing accounting, delete backlog, cost spikes, archive freshness, provider outages | Alert/incident under predeclared controls; no automatic personality edit |
| Weekly quality review | Product lead + QA | Continuity misses, user corrections, source/citation failures, unwanted personalization, route and cost comparisons | Reproducible issue clusters and candidate backlog; do not export raw private histories |
| Every two weeks | Product lead + owners + independent evaluator | Sprint selection, acceptance of finished work, next hypotheses and budget | Approve bounded development work; no auto-promotion from a dashboard |
| After each release | Release + QA | Candidate versus baseline, regression and cohort outcomes, rollback readiness | Expand, hold, repair, or roll back under release policy |
| Every six weeks | Research reviewer + architect | Primary memory/agent-evaluation research, status and relevance | Small sourced design experiment proposals, not wholesale architecture replacement |
| Monthly | Product/finance/operations | Cost per relationship including dormant cost, storage capacity, retention/deletion and source access | Adjust explicit budgets/capacity; measure effect before promising economics |

P0 integrity events—unauthorized content export, core mutation, resurrection after forget, stale authority after restore, duplicate external effects—stop affected expansion and trigger incident handling immediately. Do not wait for the next sprint. Performance/cost thresholds trigger only when the denominator and measurement completeness are sufficient; missing telemetry itself creates an instrumentation task.

## 9. How observations become new sprints

1. Normalize permitted feedback and outcomes into content-free measures and scoped evidence references. Distinguish reported dissatisfaction from inferred cause.
2. Cluster a repeated failure by behavior and version. An analyst may propose a cause; it must be reproduced before becoming an implementation fact.
3. Create a sprint candidate with the contract below. Prioritize privacy/integrity first, then observed user impact, evidence confidence, expected benefit, implementation effort, and operating cost. Avoid a pseudo-precise composite score when evidence is weak.
4. Product lead and QA choose a small number of measurable hypotheses, freeze baseline and evaluation budget, assign an owner plus a non-author reviewer, and map dependencies.
5. Implement on optimization examples; independently evaluate the exact candidate; publish failures and unknowns. If inconclusive, retain baseline and improve the evidence plan rather than lowering thresholds.
6. Release the accepted bounded change to its eligible cohort. Observe actual exposure and outcome; complete the sprint only when its stated evidence level is met.
7. Feed confirmed regression/usefulness/cost findings into the next sprint. Never use successful test output as evidence that a feature is active in production.

```yaml
id: AM-NEXT-001
title: Recover the correct event when two recent topics share a date
status: proposed
affected_capability: conversation_recovery
affected_versions: [explicit versions]
population_and_scope: declared eligible relationship/container cohort
evidence: [authorized minimized receipt IDs or synthetic reproduction]
baseline: metric value, denominator, uncertainty, measurement gaps
hypothesis: a bounded event-disambiguation cue reduces wrong-topic continuation
proposed_change: exact owned paths and behavior
primary_metric: continuity accuracy
guardrails: attribution, clarification burden, core style, latency, cost, access
budget: implementation, evaluation and pilot ceilings
owner: named implementer
independent_reviewer: different evaluator
dependencies: [accepted contracts]
acceptance: frozen thresholds and mandatory scenarios
stop_conditions: privacy failure, persona mutation, regression, budget exhaustion
rollout_and_rollback: exact versions, cohort and state repair
result: pending; source, CI, deployment and observed behavior reported separately
```

Automated jobs may prepare a candidate report, test a fixed synthetic protocol, or draft sprint proposals when deployed and authorized. They do not grant new source access, alter evaluation policy, publish a creator personality, merge code, or deploy merely because a KPI improved. Creator-approved persona changes use the separate identity release flow.

## 10. Release evidence and rollout

Start with synthetic histories and the chosen archive/backend contract. Then a small internal adult private-chat pilot, then limited eligible cohorts (the existing 5% -> 25% -> broader rollout sequence), with sufficient observations and uncertainty analysis at each gate. Group sources, shared containers, connectors, voice, and camera each need their own activation evidence. A private-text pilot cannot certify them.

Release packet:

- Exact source, candidate diff/artifact digest, build, storage/config/charter versions.
- Author evidence and independent review with mandatory checks passed, failed, or unavailable.
- CI result, current deployed target/revision, policy/storage/credential configuration.
- Authenticated Telegram/Mini App journey and actual provider/device evidence.
- Memory/source reconstruction, correction/delete, authority-preserving recovery, and rollback drill.
- Frozen cohort metrics with accounting coverage, uncertainty, exclusions, and cost ceiling.
- Capability flags, owner, kill condition, rollback state repair, remaining unqualified features.

Do not overwrite fresh corrections, grants, or tombstones when rolling back. Disable capture/preparation and invalidate stale receipts before downgrading readers; repair candidate-created summaries/indexes with a versioned process. Telegram history already disclosed to recipients is not undone by reverting code.

## 11. Current planning evidence and next step

The product/architecture, Telegram feasibility, psychology/behavior research, and KPI/evaluation reviews inform these proposals. Their source and research evidence is separate from implementation or runtime qualification.

Planning review reconciliation (2026-10-25): the independent architecture review found no remaining blocking document defect after specifying trusted recovery locators, signing trust, and current revocation authority. The privacy review requested explicit first-interaction memory eligibility and actual Telegram archive audience checks; both are incorporated. The evaluation review requested distinct missing-cost versus zero-denominator reporting and separate cohort-mean versus per-relationship cost distributions; both definitions are corrected. These are document reviews, not runtime, provider, deployment, or independent replication of the psychology research.

Next work is Sprint 0: freeze creator identity/adaptation contracts, run a scoped synthetic Telegram archive feasibility experiment, and establish a fair continuity/retrieval/cost baseline. The acceptance question is concrete: can one agent retain authorized history, restart, continue accurately in its own character, and honor a correction/forget under the chosen storage contract? No production storage compromise is authorized by this planning document.
