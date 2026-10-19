# Decisions calibration experiment — fictional cases

2026-10-19. This report preserves the initial cutoff experiment and a second prompt-refinement phase at fixed 0.70. Both leave ordinary initiative unqualified. **Do not change the production confidence threshold from this experiment.** The preselected experimental cutoff of 0.60 achieved 7/8 positive sends with no false-positive sends on calibration, then achieved 1/5 positive sends with one false-positive send on the untouched holdout. The existing 0.70 routing produced the same held-out sends. Threshold tuning alone did not resolve the observed timing and ordinary-initiative gaps. Production code and its 0.70 threshold were not modified by this task.

## Phase one: method and evidence boundary

The evaluator imports `OpenAIDecisions` and wraps its fetch function. The production adapter constructs the exact choice question, instructions, choices, model (`gpt-6-luna`), bounded context, phase (`reconsider`), and timeout (6 seconds). The wrapper captures only validated choice/confidence/probabilities and safe HTTP status from a bounded response clone; the unmodified response still goes through the production adapter. No alternate or easier classification question is used. Fictional context is assembled to match the loop's pending-purpose, relationship-state and history sections; it is not produced through PersonaGateway retrieval or assessor behavior. A direct prompt result does not supersede gateway roleplay or certify its context construction. The real run made **32 single-shot provider calls**, maximum concurrency 3, no retries, no composition or transport calls, and no real users. Credentials were read from the named local env file and were never written to output.

The 32 fictional cases and split were authored before calls: calibration 20 (8 positive, 8 negative, 4 timing); holdout 12 (5 positive, 5 negative, 2 timing). Positive means send now; negative forbids send; timing permits defer/stay_quiet and forbids send now. Labels are one engineer's synthetic judgments. The independent review checked methodology and fixture boundaries; it does not make these population or outcome labels. The fixture represents resolved topics, topic refusals, insufficient relevance, missing authorized grounding, quoted fictional disclosures, prompt injection, EN/FA, no-advice listening, corrections, busy periods, and events that have not happened yet.

Eight positive cases contain **no explicit request or general welcome for check-ins** (5 calibration, 3 holdout). Three positive controls contain general welcome (2/1); two explicitly request a check-in (1/1). Established conversation and an upcoming/recent event are contextual evidence, not permission labels. Tags, expected actions, split, case IDs and evaluation policy are excluded from provider input.

The fixture manifest was frozen at `2026-10-19T17:06:33.509Z`, before calibration requests. Cutoff selection was frozen at `2026-10-19T17:06:35.882Z`, before any holdout request. The script only sweeps calibration results. It evaluates the selected cutoff once on holdout and makes no further provider calls or cutoff changes from held-out answers.

The [official Decisions guide](https://developers.openai.com/api/docs/guides/decisions#interpret-the-answers) distinguishes the choice probability distribution from confidence and calls for application labels and error costs when choosing thresholds. This experiment preserves both fields and sweeps confidence because that is the production adapter's routing input. Neither field is treated as an observed frequency or an accuracy guarantee. Predeclared costs are 10 for false-positive send and 1 for missed positive send. Any cutoff with a calibration false-positive send is rejected. Remaining cutoffs maximize positive-send recall, then minimize cost, then prefer 0.70 on a tie, then the nearest cutoff to 0.70, then the higher cutoff.

## Results

Precision is TP/(TP+FP); recall is TP/(TP+FN). A false-positive send is any send on a negative **or timing** case. Zero-send precision is undefined (`null`), never 100%. Invalid/refused/failed requests abstain and remain positive misses; they are also counted separately.

| Evaluation | TP | FP | FN | Other non-sends | Send precision | Send recall | Acceptable action |
|---|---:|---:|---:|---:|---:|---:|---:|
| Calibration, selected 0.60 | 7 | 0 | 1 | 12 | 7/7 | 7/8 | 19/20 |
| Holdout, selected 0.60 | 1 | 1 | 4 | 6 | 1/2 | 1/5 | 7/12 |
| Calibration, actual production 0.70 | 6 | 0 | 2 | 12 | 6/6 | 6/8 | 18/20 |
| Holdout, actual production 0.70 | 1 | 1 | 4 | 6 | 1/2 | 1/5 | 7/12 |
| Always stay quiet, all cases | 0 | 0 | 13 | 19 | undefined | 0/13 | 19/32 |

The production comparator uses the actual adapter action recorded on each call, rather than a second held-out cutoff search. The no-outreach baseline avoids sends while missing all 13 labeled opportunities. It supplies no evidence that sending improves a person's experience.

| Positive subgroup, selected 0.60 | Calibration sends / positives | Holdout sends / positives |
|---|---:|---:|
| Initiative, no explicit/general welcome | 4/5 | 0/3 |
| General welcome control | 2/2 | 0/1 |
| Explicit request control | 1/1 | 1/1 |

All 32 responses contained valid typed choices, confidences and four-option probability distributions: refusals 0, invalid 0, timeouts 0, HTTP errors 0, network errors 0. These zero counts are observations from this run; they are not provider reliability estimates. Existing adapter fault tests separately cover refusal, invalid results, response size, safe errors and timeout behavior.

Calibration sweep (no held-out sweep):

| Confidence cutoff | TP | FP | FN | Rejected for FP |
|---|---:|---:|---:|---|
| 0.50 | 7 | 0 | 1 | no |
| 0.55 | 7 | 0 | 1 | no |
| 0.60 | 7 | 0 | 1 | no; selected by predeclared tie-break |
| 0.65 | 6 | 0 | 2 | no |
| 0.70 | 6 | 0 | 2 | no |
| 0.75 | 4 | 0 | 4 | no |
| 0.80 | 4 | 0 | 4 | no |
| 0.85 | 4 | 0 | 4 | no |
| 0.90 | 2 | 0 | 6 | no |
| 0.95 | 2 | 0 | 6 | no |

Concrete findings:

- `hold-t01` was a check-in asking how an audition went when the authorized history said the audition is **Tuesday afternoon** and current time is **Monday noon**. Raw choice `send`, confidence `0.79`, probability of send `0.84`; actual production action `send`. This is premature outreach under both selected and current cutoffs. The caller-provided due time was Monday, so the deterministic scheduling gate alone could not repair the semantic conflict. No real message was sent.
- `hold-p01` (first café shift), `hold-p02` (Persian running event), and `hold-p04` (gardening continuity) were labeled ordinary, welcome initiative without a permission statement. Raw answers were `close/0.35`, `send/0.24`, `send/0.59`; actions were quiet, quiet, defer at both 0.60 and 0.70. `hold-p03`, a generally welcomed listening-only check-in, returned `send/0.52` and deferred. `hold-p05`, an explicit driving-test request, returned `send/0.93` and passed.
- Lowering to 0.60 added only `cal-p04` in calibration. It added no positive held-out sends. Raw choices and confidence overlap the functional boundary enough that this sample does not justify a new cutoff.

## Application gates evaluated separately

Nine deterministic cases use the actual `RelationshipLoop`, isolated in-memory state, fixed clock, fake composition/transport callbacks, and a forced-`send` decision provider. Eight blocked cases produced zero model calls, zero authorized-context loads and zero sends: global stop, closed situation, denied audience authorization, forgotten source, quiet hours, unanswered prior outreach, unknown timezone and disabled group outreach. The ninth positive control produced one decision, context load and fake send. All 9/9 passed. They are **excluded** from model precision/recall and do not establish that the model enforced application policy. Unknown-audience evaluation supplies an authorization denial; it does not independently verify Studio membership resolution or every privacy information-flow path.

## Reproduction and exact candidate

Run from `/Users/reza/.codex/worktrees/vox-relationship-loop/vox` with a fresh directory each time:

```sh
npx tsx scripts/relationship-calibration.ts --fake --dir /tmp/vox-decision-calibration/fake-v2 --concurrency 3 --max-calls 32
npx tsx scripts/relationship-calibration.ts --real-model --env /Volumes/Workspace/Ludaxis/vox/.env.local --dir /tmp/vox-decision-calibration/real-v1 --concurrency 3 --max-calls 32
npx eslint scripts/relationship-calibration.ts
npx tsc --noEmit --incremental false
npx vitest run src/lib/relationships/__tests__/decisions.test.ts
```

The executed directories above already contain evidence and the script deliberately refuses to overwrite them. Choose a new suffix for another run; offline fake mode reproduces evaluator behavior without provider calls and does **not** measure model quality. Self-checks verify confusion counts, rejection of a false-positive cutoff, zero-send precision, refusal/invalid parsing and safe timeout abstention. The fake run passed nine gates; lint and type-check passed; all 10 adapter tests passed.

Actual local evidence is under `/tmp/vox-decision-calibration/real-v1/`: `manifest.json`, `calibration.json`, `selection.json`, `holdout.json`, `report.json`. Outputs are mode 0600, directory 0700, outside Git, and contain typed raw results, IDs, labels, fingerprints and metrics. The fixture contains only fictional context. Provider bodies, error strings and secrets are not retained. Files under `/tmp` are local and may be cleaned; this checked-in report preserves aggregate results and findings.

The run used dirty candidate HEAD `776eae087cab4f9164527adae976f45efbd01b1d`; HEAD alone does not identify the tested source. SHA-256 fingerprints below identify the exact fixture and request/implementation files. They were verified unchanged after the run.

| Input | SHA-256 |
|---|---|
| Fixture JSON | `38d62b2288f9a3e275414f2be6eb0320d6fc6357e995e231046ab619148ecb56` |
| Production model + question contract JSON | `8cd4b4d66683906912ae84519e49da9a155bb1c21aeb3a7d11991a827b8b68c5` |
| `src/lib/relationships/decisions.ts` | `e0cfce5286abc4ad5636a10c37ba2f620927c60ceb6db1be5db0f4f3c6438ec5` |
| `src/lib/relationships/observer.ts` | `8d9560bfaec9d3f5cc013853e65dc5b3a9dbf6687a6db2c9671f0550b457d110` |
| `src/lib/relationships/loop.ts` | `ba237e809cdc6648c7ae82e61f2d6c56beaa586cc7fe589764ece5aaf7f6e072` |
| `src/lib/relationships/policy.ts` | `a1a49517193d41cc85a9c4545ee48613e612224a8d768502eb1070aa9e25d7c6` |
| `src/lib/relationships/compose.ts` | `739731b6e487ac42c4de549af2e01ce44e3722089b5832bd7f5efbf842a196dd` |
| `scripts/relationship-calibration.ts` | `d536c6b2e6018216acfea7763b8f71e5be0ce9351c23576c9fa511e1247b5a4d` |

## Recommendation and remaining gate

Keep the production threshold unchanged and the feature off by default. The selected experimental cutoff failed on untouched examples; this is insufficient discriminative evidence for lowering or raising it. Investigate temporal grounding and weak implicit-initiative recall with new, independently rated examples and fresh held-out cases. The original holdout is now inspected and must not become a fresh holdout after prompt changes. Human-rated shadow/pilot evaluation remains required. This sample offers no population precision/recall guarantee, per-language estimate, confidence-calibration curve, repeated-call stability measurement, composed-message quality result, real-user benefit, or live-delivery proof.

## Phase two: fixed-threshold prompt refinement

The delivery lead revised the production question after observing phase one. It now distinguishes a due time from evidence that an event has happened, gives the latest schedule priority, and states that grounded ordinary initiative does not require an explicit check-in request or general welcome. Policy identity became `relationships-v2`. Confidence routing remains **0.70**, with the existing 0.50 lower defer boundary. This is a prompt refinement, not a threshold calibration success. The question change was made by the delivery lead, outside this evaluator task's file ownership.

The original 32 cases are now **seen development data**. Phase two selected six known regressions (five positive misses and the premature audition check-in) and authored a separate 12-case set whose responses were unseen before freezing: four genuine initiative positives without prior welcome, one generally welcomed positive, one explicit request, three negative and three timing cases. These new cases span photo archiving, chess, a Persian game jam, a neighborhood walk, volunteering, listening-only support, a future class, current busyness, a rescheduled rehearsal, a resolved task, a Persian topic boundary and a completed one-off utility request. An independent pre-call review removed an inconsistent relative-date phrase before freezing; no responses were inspected in doing so.

Labels and fixed-cutoff policy were frozen at `2026-10-19T17:10:06.741Z`. The CLI wrote `fixed-cutoff.json` before any provider call, made **18 single-shot calls** (concurrency 3), performed **no cutoff sweep**, and retained the exact production adapter action. This phase's new held-out cases are response-unseen frozen examples after a known-error-driven prompt refinement; their author knew the earlier failure categories. They are not independent population sampling or a fresh benchmark guarantee. Across the two authorized phases there were **50 provider calls** (32 + 18), each phase bounded separately, and no further provider calls.

| Fixed 0.70 evaluation | TP | FP | FN | Other non-sends | Send precision | Send recall | Acceptable action |
|---|---:|---:|---:|---:|---:|---:|---:|
| Six seen development regressions | 2 | 0 | 3 | 1 | 2/2 | 2/5 | 3/6 |
| Twelve new held-out cases | 1 | 0 | 5 | 6 | 1/1 | 1/6 | 7/12 |

| Positive subgroup | Seen regression sends / positives | New held-out sends / positives |
|---|---:|---:|
| Initiative, no explicit/general welcome | 1/4 | 0/4 |
| General welcome | 1/1 | 1/1 |
| Explicit request | no cases | 0/1 |

All 18 responses were valid typed choices with valid confidence and four-option probabilities. Refusal, invalid, timeout, HTTP error and network error counts were each zero. The same separate deterministic gate suite passed 9/9 and remains excluded from model metrics.

The formerly premature audition check-in (`reg-hold-t01`) changed from `send/0.79` to raw `send/0.40`, which the unchanged production confidence guard mapped to `stay_quiet`. The three new timing cases mapped to quiet, quiet and defer. This run therefore observed no premature effective send, but it does **not** show that the model always selected a temporally correct raw action; one known future-event case still selected raw send and relied on abstention.

All four new no-welcome positives missed: `fresh-p01` raw send/0.33 → quiet, `fresh-p02` send/0.51 → defer, `fresh-p03` send/0.29 → quiet, `fresh-p04` send/0.36 → quiet. Even the explicit request (`fresh-p05`) returned send/0.57 → defer. Only the generally welcomed listening-oriented case (`fresh-p06`, send/0.75) sent. These results preserve the unresolved ordinary-initiative gap. Direct fixture prompts cannot override failed gateway roleplay or prove that end-to-end context assessment/retrieval works.

Phase-two command (the directory already exists; use a fresh suffix for a new run):

```sh
npx tsx scripts/relationship-calibration.ts --real-model --env /Volumes/Workspace/Ludaxis/vox/.env.local --fixture src/lib/relationships/simulation/decision-calibration-refinement-fixtures.json --dir /tmp/vox-decision-calibration/refinement-real-v1 --concurrency 3 --max-calls 18
npx tsx scripts/relationship-calibration.ts --fake --fixture src/lib/relationships/simulation/decision-calibration-refinement-fixtures.json --dir /tmp/vox-decision-calibration/refinement-fake-v2 --concurrency 3 --max-calls 18
```

Phase-two evidence: `/tmp/vox-decision-calibration/refinement-real-v1/{manifest,fixed-cutoff,development,development-complete,fresh_holdout,report}.json`. Phase one's evidence and original fixture were not overwritten; the original evaluator source was also retained at `/tmp/vox-decision-calibration/real-v1/evaluator-source.ts`. Historical commands with today's modified adapter evaluate today's question; reproducing a prior candidate requires its matching source fingerprints. Final CLI lint/type-check and offline fixed-cutoff checks passed.

Phase-two dirty HEAD remained `776eae087cab4f9164527adae976f45efbd01b1d`. Exact changed fingerprints (all verified against files after calls):

| Input | SHA-256 |
|---|---|
| Separate refinement fixture JSON | `850781ab9926562829ba957d428b5d6a3dde53c5b580c1d007cf319cdd72db65` |
| Revised production model + question contract JSON | `a40e840fcccd697ea78bcec034693d9d603853b4707615b2c46a451613c70102` |
| `src/lib/relationships/decisions.ts` | `26c3f6a7c3b78521d0a55fc0c5bafdeda854d0bcb308bbadd5d8176fbd7d9fe3` |
| `src/lib/relationships/observer.ts` | `0f7054b14b96912115807d5843a7541fc036a18416d206c42cafaf658ad1360a` |
| `scripts/relationship-calibration.ts` | `372aaebd65b4a74a03adad8b1f6d65a74d0f1b892c72d8d1f8bc0eb8683d30bd` |

The loop, policy and composition hashes are identical to phase one. This refinement does not justify activation or a confidence-threshold change. Keep the feature off by default and retain human-rated shadow/pilot evaluation plus successful end-to-end ordinary initiative as outstanding gates. The observed 1/1 send precision is one accepted fictional send, not a dependable risk bound; 0/4 ordinary-initiative recall and the explicit-request miss are material limitations.
