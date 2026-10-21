# S09: Decisions pre-pass v2 in shadow, decision log, catalogue lint, DecisionService caps

Step 9 of [docs/AGENT_INTELLIGENCE_SOLUTION.md](../../AGENT_INTELLIGENCE_SOLUTION.md) (sections 2.1, 4.8 and the Step 9 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.

## Goal

- Raise the Decisions seam's caps and make its deadline configurable per call (default 500 ms, maximum 5 s).
- Generalise its input to a strict array of text parts with one optional image part.
- Add a `ServiceDecider` adapter, selected only by `STUDIO_DECIDER=service`, that runs the triage `Decider` over `DecisionService`.
- Version the triage question sets: v1 stays byte-identical; v2 appends 7 message-phrased questions. v2 answers are parsed and logged in shadow and change routing only under `TRIAGE_QUESTION_SET=v2-live`.
- Add a content-free decision log (file plus Firestore `vox_decision_log`, 90-day retention) behind `TIREH_DECISION_LOG=1`, a CI lint over the question catalogue, and an offline calibration report script.
- With every flag unset the runtime behaves exactly as the base.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the shared contract (sha256 `6b8edcd4bf18ca2f4d7a160f0a83077e823d6f491834abf54268a31433566630`). S09 reads `decider`, `triageQuestionSet`, `decisionLog`. |
| `src/lib/adaptive/decisions/index.ts` | Exported caps (`DEFAULT_DECISION_DEADLINE_MS=500`, `MAX_DECISION_DEADLINE_MS=5000`, `MAX_DECISION_QUESTIONS=24`, `MAX_DECISION_CHOICES=32`, `MAX_DECISION_LEVELS=12`, `MAX_DECISION_TEXT_PARTS=8`, `MAX_DECISION_IMAGE_PARTS=1`); choices/levels caps; `decisionTextPartSchema`, `decisionImagePartSchema`, `decisionPartSchema`, new `decisionEvidenceSchema` (string 1..8192 or one strict `{role:'user', content}` with 1..9 parts, at most one image, at least one text, text total <= 8192; the base `[input_text, input_image]` tuple still parses); `export const requestSchema` (questions <= 24); `DecisionProviderOptions { timeoutMs? }` as the 4th `evaluate` argument; deadline clamped to 1..5000 and passed as `{ timeoutMs }`. The `OpenAIDecisionProvider` class body is untouched (S15 owns it). |
| `src/lib/adaptive/decisions/README.md` | Only the "default deadline" paragraph, plus one sentence on the caps. |
| `src/lib/tireh/decisions/catalog.ts` | New. v2 question definitions (`route`, `context_need`, `thread_status`, `explicit_style_request`, `personal_life`, `confidential`, `explicit_correction`) phrased about the message; `CATALOGUE_LINT_PATTERN`, `PERSONA_HEADER_PREFIX`, `catalogueTexts`, `lintQuestions`, `V1_LINT_ALLOWLIST`. Imports `DecisionQuestion` type-only from `../triage`. |
| `src/lib/tireh/decisions/language.ts` | New. `scriptLanguage(text)` → `'fa' | 'en' | 'mixed' | 'unknown'` by Arabic-script vs Latin letter share (>= 0.8). Pure. |
| `src/lib/tireh/decisions/service-decider.ts` | New. `ServiceDecider implements Decider` (`decide`, `decideParts`, `decideDetailed`) over `DecisionService`; never throws; unknown results give `{}`. `studioDecider(fallback, env)` selects it only for `STUDIO_DECIDER=service` with `OPENAI_API_KEY`. |
| `src/lib/tireh/decisions/log.ts` | New. Content-free `DecisionLogRow` schema (strict zod), `InMemoryDecisionLogStore`, `createFileDecisionLogStore` (JSONL, 0o600, sweep via tmp + rename), `FirestoreDecisionLogStore` (`vox_decision_log`), `createDecisionLogSink` (fire-and-forget, never throws, fixed warn codes, sweep at most once per 24 h), `recordTriageDecision`. |
| `src/lib/tireh/decisions/calibration.ts` | New pure library: `parseDecisionLogJsonl`, `parseLabelsCsv`, `calibrationReport`, `formatCalibrationReport`. |
| `scripts/decisions-calibration.ts` | New thin CLI: `node --import tsx scripts/decisions-calibration.ts --log <decision-log-v1.jsonl> --labels <labels.csv> [--thresholds 0.2,0.5,0.8] [--question route] [--since 2026-10-01]`. No network, no Firestore mode. |
| `src/lib/tireh/triage.ts` | `DeciderPart`, `DecideDetail`, `TriageV2`; optional `Decider.decideParts` / `decideDetailed`; `Triage.v2`; `triageQuestions(..., set)` and `readTriage(..., set)` defaulting to `tirehFlags().triageQuestionSet`; `readTriageV2`; `V2_SMALLTALK_CONFIDENCE=0.6`, `V2_CORRECTION_CONFIDENCE=0.5`, `V2_CORRECTION_PROBABILITY=0.5`. v1 output byte-identical. |
| `src/lib/tireh/gateway.ts` | One import line after `./skill-routing`, one `GatewayDeps.decisionLog` line after `decider?: Decider;`, and the body of the private `triage()` method only. |
| `src/lib/studio/service.ts` | Two lines: `StudioDeps.decisionLog` (inline import type) and `decisionLog: this.deps.decisionLog,` in `gateway()`. |
| `src/lib/studio/runtime.ts` | One import line (`studioDecider`), the `decider:` line, and one block after `studio.deps.preferenceLearning = ...` wiring the decision log under `TIREH_DECISION_LOG=1`. |
| Tests | `src/lib/adaptive/decisions/decisions-v2.test.ts`, `src/lib/tireh/__tests__/decisions-{service-decider,triage-v2,log,catalog-lint,calibration}.test.ts`. The v1 golden block of `decisions-triage-v2.test.ts` is filled with inline snapshots at the untouched base and must never be regenerated. |

## v2 questions (all about the message, none about a person's state)

- `route` (choice) — "What kind of reply does the latest message call for? Judge only what the message asks for.": answer, smalltalk, clarify, retrieve_deep, task, correction.
- `context_need` (choice) — "Which background, if any, does a good reply to the latest message need beyond the recent lines?": none, person_profile, open_threads, group_decisions, project_history.
- `thread_status` (choice) — "How does the latest message relate to the topic of the recent lines?": continues, resolves, new, unclear.
- `explicit_style_request` (choice) — "Does the latest message explicitly ask for a reply format? Choose unspecified unless the message says so in words.": brief, detailed, step_by_step, listening, unspecified.
- `personal_life`, `confidential`, `explicit_correction` (predicates).

## Flags

- `STUDIO_DECIDER=service` (startup, via `tirehFlags(env).decider` in `studioDecider`): `ServiceDecider` over a dedicated `DecisionService(OpenAIDecisionProvider.guarded)`; needs `OPENAI_API_KEY`. Anything else keeps `OpenAIMedia`. `STUDIO_DECISIONS=off` still disables every decider.
- `TRIAGE_QUESTION_SET=v2|v2-live` (call time): unset/unknown = v1. v2 appends the 7 questions and attaches `Triage.v2` in shadow. v2-live additionally lets route smalltalk (confidence >= 0.6) set effort quick, and route correction (>= 0.5) or explicit_correction (>= 0.5) set memorable true.
- `TIREH_DECISION_LOG=1` (startup and call time): content-free rows in `decision-log-v1.jsonl` under `STUDIO_DATA_DIR` or Firestore `vox_decision_log`; 90-day sweep at most once per 24 h per process.

### Contract deviations

1. `gateway.ts` imports a value: `import { recordTriageDecision, type DecisionLogSink } from './decisions/log';` (same anchor, one line). gateway.ts does not import `tirehFlags` (S03 adds it).
2. `StudioDeps.decisionLog` uses an inline `import('../tireh/decisions/log').DecisionLogSink` type.
3. `runtime.ts` gains one import line (`studioDecider`) after the `../adaptive/decisions` import.
4. Unlisted additions inside S09 paths: `calibration.ts`, `readTriageV2` and the three thresholds, `V1_LINT_ALLOWLIST` / `lintQuestions`.
5. Interpretation: "correction → memorable" is `route === 'correction'` OR the `explicit_correction` predicate, both thresholded, only under v2-live.

## Acceptance (summary)

- Flags unset: v1 questions and `readTriage` equal the base inline snapshots byte for byte; the Studio decider is the same `OpenAIMedia` instance; no decision-log file or collection; every existing suite passes apart from sandbox baseline failures.
- `DecisionService` accepts 24 questions, 32 choices, 12 levels, up to 8 text parts plus 1 low-detail image; validation stays strict (`invalid_input` without a provider call).
- `deadlineMs` defaults to 500, is clamped to 1..5000 and reaches the provider as `options.timeoutMs`. `OpenAIDecisionProvider` body unchanged.
- `ServiceDecider` never throws; unknown/refused gives `{}` so `readTriage` returns null and the reply takes the full path.
- Pre-pass input stays `triageInput` (persona header plus the last six lines); no memory, card or saved context reaches the decider (canary test).
- Decision-log rows validate against a strict schema and carry no text, persona name, person id, chat key or message id (canary test). Writes never affect delivery.
- The catalogue lint passes with the v2 questions and no v2 allowlist; each v1 allowance has a reason and is used.

## Out of scope

Step 1 (boundary/unchanged/adaptiveContext/liveTurn/persistence), the `OpenAIDecisionProvider` body and `media.ts` (S15), Step 2 hot-path work, consuming v2 answers beyond the two v2-live adjustments, image questions and Telegram photo ingestion (S12), linting stranger/brief-routing questions, a labelling harness, Firestore export or TTL policy, package.json scripts, new diagnostics codes or stage names, editing existing tests, fixing `Privacy.tsx`.

## Risks

- Until S15 merges, `OpenAIDecisionProvider` keeps a 500 ms transport timeout, so under `STUDIO_DECIDER=service` slow answers become `timeout` and the turn is untriaged (safe, costlier).
- `STUDIO_DECIDER=service` swaps the decider for every Studio consumer (gateway triage, sandbox skill preview, stranger decisions, brief routing). The zod caps apply (instructions <= 2048, never clipped) and provider errors return `{}` instead of throwing, so `stranger_decider_failed` / `triage_failed` no longer fire for them.
- The dedicated circuit breaker is per process: three failures leave every triage untriaged for 30 s.
- Under `TRIAGE_QUESTION_SET=v2`, existing tests asserting the exact v1 question list fail by design (tireh `skill-routing.test.ts`, studio `triage.test.ts`, studio `skill-routing.test.ts`).
- v2 adds about 7 questions of input tokens per request; measure via the log before enabling.
- `routeTaken` is computed with composeReply's rules, not observed. Compact turns produce no row; group observe turns do.
- Calibration needs labels keyed by row id from a separately consented evaluation run; the doc's gate is >= 200 labelled examples per language and question.
- `fa` is an Arabic-script ratio bucket, not language identification.
- Rows carry `personaId` and a timestamp (pseudonymous); keep the log server-side with 90-day retention.
- Firestore sweep deletes in pages of 400 once per day per process; recommend a TTL policy later.
- File-store appends from concurrent processes are not coordinated (single-process Mac profile).
- The v1 golden snapshots must never be regenerated.
