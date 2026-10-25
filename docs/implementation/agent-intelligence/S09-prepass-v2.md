# S09: Decisions pre-pass v2 in shadow, decision log, catalogue lint, DecisionService caps

Step 9 of [docs/AGENT_INTELLIGENCE_SOLUTION.md](../../AGENT_INTELLIGENCE_SOLUTION.md) (sections 2.1, 4.8 and the Step 9 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.

## Goal

- Widen the vendor-neutral Decisions seam: a per-call deadline up to 5 s, 24 questions, 32 choices, 12 levels, and text parts with one optional image part.
- Add a `ServiceDecider` that runs Studio triage through `DecisionService`, opt-in with `STUDIO_DECIDER=service`.
- Version the triage question sets. v1 is byte-identical to the base. v2 appends 7 message-level questions whose answers are parsed into `Triage.v2` and logged. Routing consumes them only under `TRIAGE_QUESTION_SET=v2-live`, and then only for two narrow adjustments.
- Add an opt-in, content-free decision log (`TIREH_DECISION_LOG=1`) in a file or Firestore `vox_decision_log` with a 90-day sweep, a vitest catalogue lint and a calibration script.
- With every flag unset, request bodies, triage questions, `Triage` objects, routing, diagnostics and every existing test match the base exactly.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the shared contract (sha256 `6b8edcd4…6630`). |
| `src/lib/adaptive/decisions/index.ts` | Exported caps (`DEFAULT_DECISION_DEADLINE_MS=500`, `MAX_DECISION_DEADLINE_MS=5000`, 24 questions, 32 choices, 12 levels, 8 text parts, 1 image part); `decisionTextPartSchema`, `decisionImagePartSchema`, `decisionPartSchema`, `DecisionPart`, `decisionEvidenceSchema` (the legacy tuple stays valid); `export const requestSchema`; `DecisionProviderOptions` as the 4th `evaluate` argument; `effectiveDecisionDeadline()`, passed to the provider as `{ timeoutMs }`. The `OpenAIDecisionProvider` class body is unchanged (S15). |
| `src/lib/adaptive/decisions/README.md` | The default-deadline paragraph only. |
| `src/lib/tireh/triage.ts` | `DeciderPart`, `DecideDetail`, `TriageV2`; optional `Decider.decideParts` / `decideDetailed`; `Triage.v2`; `triageQuestions(..., set = 'v1')`, `readTriage(..., set = 'v1')`, `readTriageV2`; `V2_LIVE_SMALLTALK_CONFIDENCE=0.6`, `V2_LIVE_CORRECTION_PROBABILITY=0.5`. |
| `src/lib/tireh/decisions/catalog.ts` | `V1_QUESTION_NAMES`, `V2_QUESTION_NAMES`, `IMAGE_V1_QUESTION_NAMES` (reserved for S12), `SKILL_SELECTED`, `CATALOGUE_CHOICE_VALUES`, frozen `TRIAGE_V2_QUESTIONS`, `CATALOGUE_LINT`, `PERSONA_HEADER_PREFIX`, `CATALOGUE_LINT_ALLOWLIST` (4 entries), `lintQuestions()`, `triageQuestionSetNow()`. |
| `src/lib/tireh/decisions/language.ts` | `scriptLanguage()`: an Arabic-script vs Latin letter ratio label (>= 80%), not language identification. |
| `src/lib/tireh/decisions/service-decider.ts` | `ServiceDecider` (`decide`, `decideParts`, `decideDetailed`) and `toServiceQuestion`. Reads no flags or credentials; never throws; unknown outcomes give `{}`. |
| `src/lib/tireh/decisions/log.ts` | Row types, strict `newDecisionLogRowSchema`, pure `decisionLogRow()`, in-memory, JSONL file (0o600) and Firestore stores, `createDecisionLogSink()` (fire-and-forget, `maxPending`, sweep at most once per 24 h, fixed error codes), `startDecisionLogRetentionSweep()` (startup and daily, whatever the flag is now; `wireDecisionLog` in `src/lib/studio/runtime.ts` runs it so rows written before a rollback still age out, without creating the file or collection). |
| `src/lib/tireh/decisions/calibration.ts` | Pure `parseLabelsCsv` (`row_id,question,label` only), `computeCalibration`, `formatCalibration`, `unmatchedLabelCount`. |
| `scripts/decisions-calibration.ts` | Thin CLI: `npx tsx scripts/decisions-calibration.ts --log <jsonl> --labels <csv> [--since ISO] [--until ISO] [--thresholds 0.2,0.5,0.8] [--firestore]`. |
| `src/lib/tireh/gateway.ts` | Two import lines after `./skill-routing`, `GatewayDeps.decisionLog`, and the body of `triage()` only. |
| `src/lib/studio/service.ts` | `StudioDeps.decisionLog` and `decisionLog: this.deps.decisionLog,` in `gateway()`. |
| `src/lib/studio/runtime.ts` | One header-comment line and one block after `studio.deps.preferenceLearning = ...` (dynamic imports); the `decider:` line is unchanged. |
| Tests | `src/lib/adaptive/decisions/decisions-v2.test.ts`; `src/lib/tireh/__tests__/decisions-{service-decider,triage-v2,catalogue-lint,log,gateway-log,calibration}.test.ts` (+ `decisions-fixtures.ts`); `src/lib/studio/__tests__/decisions-runtime.test.ts`. |

## v2 questions (about the message, never a person's state)

`route` (answer, smalltalk, clarify, retrieve_deep, task, correction), `context_need` (none, person_profile, open_threads, group_decisions, project_history), `thread_status` (continues, resolves, new, unclear), `explicit_style_request` (brief, detailed, step_by_step, listening, unspecified), and the predicates `personal_life`, `confidential`, `explicit_correction`. Exact texts live in `catalog.ts`.

## Flags

- `STUDIO_DECIDER=service`: runtime replaces `studio.deps.decider` with a `ServiceDecider` over a dedicated `DecisionService(OpenAIDecisionProvider.guarded({apiKey}))`, only when a decider already exists (an `OPENAI_API_KEY` and `STUDIO_DECISIONS` not `off`).
- `TRIAGE_QUESTION_SET=v2|v2-live`: read per call by gateway triage through `triageQuestionSetNow()`; unset or unknown means v1. The pure functions default to `'v1'`.
- `TIREH_DECISION_LOG=1`: runtime wires a sink (file `$STUDIO_DATA_DIR/decision-log-v1.jsonl`, or Firestore `vox_decision_log` under `STUDIO_STORAGE=firestore`); the sink re-checks the flag on every `record()`.

## Contract deviations

1. `triageQuestions`/`readTriage` default `set` to `'v1'`, not `tirehFlags().triageQuestionSet`; the gateway passes `triageQuestionSetNow()`. This keeps existing pure-function tests green under the flag matrix.
2. `gateway.ts` imports two values (`triageQuestionSetNow`, `decisionLogRow`) at the S09 anchor instead of one type-only import, and does not import `tirehFlags` (S03 adds that import).
3. The catalogue-lint allowlist has 4 entries (effort `choice:thoughtful`, proactive instructions, skill instructions, skill `choice:*`), not 2.
4. `runtime.ts` keeps the `decider:` line and selects everything inside one block with dynamic imports.
5. `decisionEvidenceSchema` keeps one extra refine (at most 8 text parts), so 9 text parts without an image are rejected as the tests require.
6. `scriptLanguage('سلام hello there friend')` is `'en'` (exactly 16 of 20 letters are Latin, and the rule is >= 80%); the test uses `'سلام hello friend'` for `'mixed'` and pins the boundary case.

## Risks

- Under `STUDIO_DECIDER=service`, one refused or malformed answer makes the whole batch unknown; with v2 appended, a refusal on a shadow question also discards the v1 triage (full path: quality cost, never privacy).
- `DecisionService` validation is stricter than `OpenAIMedia` (instructions <= 2048 chars, full choice probabilities); a long persona can push the stranger question past 2048 and fall back.
- Until S15 lands the provider HTTP timeout stays 500 ms, so the gateway's 2000 ms budget is effectively 500 ms under `STUDIO_DECIDER=service`; timeouts count toward the dedicated 3-failure, 30-second circuit.
- v2-live thresholds (0.6, 0.5) are uncalibrated; v2-live waits for 200 EN + 200 FA labelled examples per question.
- One row per triaged message, including group observe turns; `routeTaken` is the route a reply would take. The file log is single-process.
- Calibration joins labels by store-generated row id: labels must come from a separately consented or synthetic evaluation run.
