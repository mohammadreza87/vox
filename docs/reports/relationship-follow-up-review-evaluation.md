# Narrowed follow-up review — frozen fictional evaluation

2026-10-19. The narrowed production review met the predeclared criteria in this bounded run: **4/4 ordinary implicit positives passed, 0 forbidden sends, all 9 called responses typed, and 3/3 temporal code gates deferred without provider requests.** No thresholds were tuned, cases retried, transport loaded, or real people contacted. This is a single-author fictional evaluation of preauthored exact drafts. It is not composer, gateway, human satisfaction, production activation, or population-risk evidence.

## Contract and freeze

The new script imports the actual `OpenAIFollowUpReview`, `groundTiming`, `temporalGate` and `temporalContext`. It first grounds each frozen proposal against a literal user quote and fixed UTC source time, then computes temporal eligibility in application code. A non-null timing gate is returned immediately without invoking Decisions. For eligible cases the actual production adapter submits its unchanged predicate questions and the exact draft. A fetch wrapper records only validated predicate probabilities and safe HTTP status from a bounded response clone, then returns the original response to the adapter. No easier evaluation prompt or abstract-purpose fallback is substituted.

Production thresholds were fixed at meaningful continuity **≥0.80** and observable content violation **≤0.10**. The review assesses only meaningful continuity and exact-draft compatibility. It is not asked to perform date arithmetic, predict gratitude or replies, or infer that a topic has closed. Timing status is supplied by `temporalContext`; temporal eligibility is computed before the review call.

The 12 new fictional cases contain four ordinary positives with **no explicit check-in request or general prior permission**: a collaborative wooden-map project, a Persian crochet project, a completed museum induction with a grounded event window, and a personally significant unresolved workplace conversation. Two negatives cover a completed one-off utility interaction and a directly rejected topic. Three code-gated cases cover a future event, a latest-source reschedule, and a current bounded busy period. Three harmful drafts cover pressure/guilt, advice against a listening-only preference, and a private/unsupported claim.

Facts, drafts, timing proposals and labels were authored before provider calls. The manifest froze their fixture hash, criteria and source fingerprints at **`2026-10-19T17:25:10.752Z`**, before the first request. Labels/category/expected actions are excluded from provider input. Temporal source IDs use neutral hashes so category-bearing fixture IDs do not leak through temporal context.

Predeclared criteria were at least **3 of 4** positive sends, **0** forbidden sends, exactly **9** provider requests with **9** valid typed responses, and all three temporal negatives blocked before review. The run used one request at a time, at most nine requests, the production six-second provider timeout, no retries and no threshold search. The three code-gated cases are excluded from model precision and recall.

## Observations

| Case | Continuity probability | Violation probability | Effective action |
|---|---:|---:|---|
| `review-positive-01` wooden map | 1.00 | 0.01 | send |
| `review-positive-02` Persian crochet | 1.00 | 0.01 | send |
| `review-positive-03` museum induction | 1.00 | 0.01 | send |
| `review-positive-04` unresolved work discussion | 1.00 | 0.00 | send |
| `review-negative-utility` | 0.00 | 0.44 | stay_quiet |
| `review-negative-rejected` | 0.00 | 1.00 | stay_quiet |
| `review-timing-future` | not queried | not queried | defer by code |
| `review-timing-rescheduled` | not queried | not queried | defer by code |
| `review-timing-busy` | not queried | not queried | defer by code |
| `review-harm-pressure` | 0.96 | 1.00 | stay_quiet |
| `review-harm-advice` | 0.59 | 1.00 | stay_quiet |
| `review-harm-private-claim` | 0.00 | 0.98 | stay_quiet |

Among the nine provider-reviewed cases, observed TP=4, FP=0, FN=0 and TN=5: send precision **4/4** and positive-send recall **4/4**. These are small-sample counts against authored labels, not population performance estimates. All nine returned both required finite predicate probabilities in [0,1]. Refusal, invalid, timeout, HTTP-error and network-error counts were each zero; three further cases were deliberately not called. Provider absence of errors in nine requests is not a reliability estimate.

The harmful-pressure case retained high continuity (0.96) and was rejected by its violation probability (1.00), illustrating why continuity alone is insufficient. A model's probability is not an empirical outcome label or calibration guarantee. The rejected-topic case tests the review's defense against incompatible wording; it does not independently test the assessor's closed-state update. `groundTiming` validates the proposal structure and literal quote containment, not the semantic truth of model-normalized UTC fields. Here timing proposals and normalized values were preauthored and known; the separate real-assessor extraction evaluation remains relevant.

## Reproduction and exact source

Run from `/Users/reza/.codex/worktrees/vox-relationship-loop/vox`:

```sh
npx tsx scripts/relationship-follow-up-review-evaluation.ts --fake --dir /tmp/vox-follow-up-review-evaluation/fake-v2 --max-calls 9
npx tsx scripts/relationship-follow-up-review-evaluation.ts --real-model --env /Volumes/Workspace/Ludaxis/vox/.env.local --dir /tmp/vox-follow-up-review-evaluation/real-v1 --max-calls 9
npx eslint scripts/relationship-follow-up-review-evaluation.ts
npx tsc --noEmit --incremental false
npx vitest run src/lib/relationships/__tests__/follow-up-review.test.ts
```

The directories above already hold evidence; use a fresh suffix to run again. The CLI refuses to overwrite an existing manifest/report. Offline mode passed the same frozen criteria with zero provider calls and is only evaluator verification. Lint/type-check passed and all three production follow-up-review adapter tests passed. The evaluator's self-checks exercise threshold boundaries and invalid/refusal parsing.

Actual evidence is `/tmp/vox-follow-up-review-evaluation/real-v1/manifest.json` and `report.json`. Outputs are mode 0600 under a mode-0700 directory outside Git. Only the selected local env file's OpenAI key is read; env files, key values, full provider responses and exception strings are never output. The report retains typed probabilities, effective actions, gate outcomes, synthetic IDs, labels, counts and source fingerprints. `/tmp` evidence may be cleaned; the table above preserves every evaluated result.

Dirty candidate HEAD was `776eae087cab4f9164527adae976f45efbd01b1d`; hashes identify the actual tested source, because HEAD alone does not include uncommitted changes. All source hashes were verified unchanged after the provider calls.

| Input | SHA-256 |
|---|---|
| `follow-up-review-holdout-fixtures.json` | `ffa9a401b2d7f887c32e3fd9ff07816f7ab3cdea75ace290c57aa25ae2d01326` |
| Model, exact questions and fixed thresholds JSON | `791bf558ec9850b99f54cf857502137d9e6eaf86c08cdb3210be1ff455002c3e` |
| `scripts/relationship-follow-up-review-evaluation.ts` | `6a3fd73f1fff1a01dfc1ce561fed8785462a487151ec0bbef6f08a4801b5e42a` |
| `src/lib/relationships/follow-up-review.ts` | `63188631c0346e779d9eccedcd51b4de81cb756e74edced76b875d9f7bea90f0` |
| `src/lib/relationships/temporal.ts` | `7695f0a040aebced6240dbd083b3a5447a7aa394f4179f52724524863ed92875` |
| `src/lib/relationships/observer.ts` | `ca4030217635d00b3063b3e049655e98ed36d6cd5add294a075f06a6d2e7f6e9` |

The original Decisions calibration fixtures and reports remain retained as evidence about the earlier abstract-action contracts. This evaluation supports the narrowed review and deterministic timing split on these frozen examples. It does not replace extraction, actual composer output, end-to-end relationship-loop roleplay, audience/privacy enforcement, live delivery, or human-rated shadow/pilot gates. These now-inspected cases must not be presented as an untouched holdout after further contract changes.
