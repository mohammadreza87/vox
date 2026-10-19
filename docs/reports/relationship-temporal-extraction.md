# Typed temporal extraction qualification

2026-10-19. The new temporal contract separates model-derived factual extraction from deterministic time comparisons. A frozen, single-shot test through the actual `StudioRelationshipAssessor` made twelve fictional Haiku calls: **all twelve parsed; eight passed every frozen case assertion**. The four failures remain recorded. This is useful extraction evidence, but it does not establish complete initiative quality or independently prove dates.

## Implemented contract

`src/lib/relationships/temporal.ts` defines `after_event`, `preparatory` and `ongoing` purpose kinds, an optional UTC event start/end, optional explicitly bounded current `busyUntil`, and a literal source quote. The strict schema rejects invalid dates, reversed windows, extra model-supplied attribution, and malformed fields. `groundTiming` requires the quote to be a literal substring of the current user message and attaches source ID, source timestamp and known timezone in code. Stored attribution is marked `extraction: model_derived`. Literal matching verifies where the quoted text came from; it does not prove correct semantics, ownership of an event, or temporal normalization.

`eventPhase`, `temporalNotBefore` and `temporalGate` perform code comparisons. After-event questions require an explicitly extracted end at or before now. Unknown/date-only/vague ends remain absent and cannot authorize an after-event send. Preparatory questions require a known future start; a preparatory purpose whose start has passed closes. Ongoing purposes can use one open question about progress without assuming a scheduled event finished. Current bounded busy periods defer until their extracted end. The composer must receive the kind rule as trusted application input; merely placing an instruction among untrusted history does not guarantee obedience.

The helper exports audience-local temporal context and a terminal evidence purge function. The delivery lead integrates grounding, same-topic schedule refresh, due-time constraints, source-chain invalidation, terminal purging and transport fences in the loop. Those integration changes are separate from this evaluator's ownership and must pass the final combined checks.

`StudioRelationshipAssessor` now accepts timing on both situation updates and follow-up proposals. Its prompt requires current-person evidence, omits unknown ends, disallows imported quoted/third-person schedules, anchors normalization to sourceAt/known timezone, retains the stable topic key on reschedules, and extracts an explicitly bounded current busy period. `maxTokens` is 1600 and `requireComplete` is true, preserving the provider stop guard. UTC conversion remains a model extraction; code validates shape/order and compares dates, rather than proving the normalized date is true.

## Frozen twelve-call experiment

The fixture contains four meaningful implicit ongoing projects without check-in permission, four dated cases (known future workshop, reschedule, explicitly timed past event, unknown-time audition), two current busy periods including Persian, and two quoted/third-person boundaries. The test uses the actual structured assessor with `claude-haiku-5-5`; its LLM wrapper uses the same Anthropic messages contract, SDK retries disabled, maximum concurrency three and a twelve-second provider/assessor timeout. The wrapper checks `stop_reason` and refuses truncated output. No real recipient, transport or deployment is loaded.

The fixture, exact evaluator, assessor and temporal helpers were hashed into `/tmp/vox-temporal-extraction/real-v1/manifest.json` before any call. The script made exactly twelve single-shot calls and no retries or reruns. Only `ANTHROPIC_API_KEY` was selected from the designated local env file. It retains typed assessments, grounding checks and safe failure status; it never prints/stores secrets, headers, exception strings or full provider envelopes. Evidence files have mode 0600 in a 0700 temporary directory. The separate fake run checks harness behavior and is not provider evidence.

| Frozen category | Cases | All assertions passed |
|---|---:|---:|
| Implicit ongoing projects | 4 | 2 |
| Dated/rescheduled/unknown events | 4 | 2 |
| Current busy period | 2 | 2 |
| Quoted/third-person boundary | 2 | 2 |
| Total | 12 | 8 |

All ten nonboundary cases produced literal, caller-groundable temporal evidence. All three known event windows normalized to the expected start/end, including the October 22 reschedule. Both busy ends were correct, including the Persian statement. Both boundary cases returned no imported timing or follow-up. The date-only audition retained an unknown end and could not pass the code gate. These observations are narrower than the full frozen pass count and do not erase its failures.

The four strict failures were:

- `ongoing-ceramics` and `ongoing-garden` each produced a correctly grounded open ongoing situation, but no follow-up. The assessor's optional planning still missed two meaningful initiative opportunities. Open factual memory does not itself prove a scheduled invitation.
- `dated-reschedule` produced the correct October 22 window on the stable `rehearsal` situation, but called that situation timing `preparatory`. Its new follow-up correctly used `after_event` and a purpose to ask how the rehearsal went. The fixture required the situation timing kind to remain `after_event`, so kind and deterministic-gate assertions failed. This exposes an integration risk: **updating an existing after-event intention from a situation must preserve the intention's kind and purpose while replacing schedule facts**. Otherwise a schedule update can turn an old after-event purpose into an eligible preparatory action. A genuinely new purpose/kind must supersede the old intention as a new follow-up.
- `dated-unknown` selected a preparatory question about learning the audition time, instead of the fixture's expected after-event question. It omitted both unknown times and remained blocked. This is a conservative purpose selection, not successful execution of the frozen expected purpose. No assertion or label was changed afterward.

A literal source quote can still be misinterpreted; the two boundary successes are not a general defense against quoted instructions, event ownership confusion, indirect speech, timezones or cross-audience leakage. Dates were explicit UTC in these cases. There is no DST, arbitrary-language date normalization, multi-person event, human benefit, production transport or population reliability claim. End-to-end initiative still requires a real assessor plan, trusted-kind composition, narrow content review and deterministic gates on the same intended message.

## Reproduction and exact source

Executed commands (use fresh temporary directories for another run):

```sh
npx tsx scripts/relationship-temporal-extraction.ts --fake --dir /tmp/vox-temporal-extraction/fake-v1 --concurrency 3
npx tsx scripts/relationship-temporal-extraction.ts --real-model --env /Volumes/Workspace/Ludaxis/vox/.env.local --dir /tmp/vox-temporal-extraction/real-v1 --concurrency 3
npx eslint src/lib/relationships/temporal.ts src/lib/relationships/__tests__/temporal.test.ts src/lib/relationships/types.ts src/lib/studio/relationship-assessor.ts scripts/relationship-temporal-extraction.ts
npx vitest run src/lib/relationships/__tests__/temporal.test.ts src/lib/studio/__tests__/relationships.test.ts
npx tsc --noEmit --incremental false
```

Both scoped test runs passed 21/21 tests, scoped lint passed, and a full TypeScript check passed after extraction. Final combined validation is owned by the delivery lead because the loop, reviewer and feedback integration are being assembled concurrently. The seven temporal tests cover literal attribution, invalid/reversed dates, exact event boundaries, unknown ends, preparatory versus ongoing behavior, busy boundaries and evidence purging. No further provider requests were made after the twelve-case report.

| Frozen input | SHA-256 |
|---|---|
| Extraction fixture | `935c8d77ddcb10ac0b13d46fdc63ebf6cade54c4abd0bdefa2e52690fba9da3d` |
| Extraction evaluator | `9f4cc1d2cf70b1b7064d327f01c2c6c9d5a1ca13ae6a80fa572e5e6240d7cc8f` |
| Temporal helpers | `7695f0a040aebced6240dbd083b3a5447a7aa394f4179f52724524863ed92875` |
| Structured assessor | `7fa57d2f5880f98206aa7c614448300252b471997c41353fb79ea25a14ca3be5` |

Local raw evidence is `/tmp/vox-temporal-extraction/real-v1/{manifest,report}.json`. Later source changes require their own final validation and must not be represented as the exact twelve-call candidate merely because the Git HEAD is unchanged.
