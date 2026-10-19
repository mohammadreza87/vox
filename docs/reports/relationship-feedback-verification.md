# Natural feedback verification — 2026-10-19

The candidate records explicit feedback about a confirmed delivered check-in and uses the person's direct preferences or corrections in subsequent response context. This is scoped working memory and content-free observation. It does not train a model, tune action thresholds, or use reply rate as a reward.

## Implementation boundary

- Feedback requires the latest assistant turn from the same authorized private chat to carry the exact delivered intention marker. An intervening ordinary assistant response, missing marker, absent reply, expired delivery link or stale history epoch skips attribution.
- The Decisions adapter chooses only `helpful`, `unwanted`, `correction` or `neutral`, with bounded message/topic/global scope. Answering a question, good news, politeness, quotations and another person's experience are not helpfulness evidence. Refusal, malformed output, uncertain classification and provider failure produce no receipt; they are not fabricated neutral observations.
- Application code fences writes with the accepted relationship revision, epoch, current delivery target and source identities. Forget/revoke removes dependent links and receipts. Contact controls remain authoritative and cannot be changed by a feedback classification.
- The existing assessor extracts direct current-user preferences and factual corrections. Bounded preceding assistant text only resolves references such as “that was too long”; assistant assertions cannot become user preferences. The resulting preference/situation context shapes the next response.
- The delivery link contains intention/message identities, source identities, topic and time, without the composed message. It is eligible for seven days. At most 24 receipts are retained, pruned after 30 days when relationship state is read or updated; storage TTL is a separate physical deletion mechanism. Receipts contain enum/scope, source identities, linked delivery identity and timestamp, without either message text.
- Observer events contain the enum/scope plus HMAC relationship, intention and source pseudonyms. The intention pseudonym links a feedback event to its decision and confirmed-send observation. Neither raw drafts/transcripts nor raw relationship, message, memory or intention identifiers enter feedback analytics.

Relevant sources: `src/lib/relationships/feedback.ts`, `observer.ts`, `loop.ts`, `types.ts`, `src/lib/studio/relationship-assessor.ts`, and the gateway/service history integration.

## Deterministic verification

`npx vitest run src/lib/relationships/__tests__/feedback.test.ts src/lib/relationships/__tests__/feedback-loop.test.ts`: **35 passed**.

The tests exercise actual relationship-turn and delivery integration with fake providers/transport, including direct correction adaptation, neutral reply handling, message/topic/global distinction, authoritative stop, exact latest-assistant linkage, duplicate input, cross-person/persona/group isolation, stale epoch/revision/source rejection, in-flight forget, bounded retention and observer/provider failures. They also verify the bounded Decisions request/parser, uncertainty/refusal behavior, HMAC correlation and absence of private content in observation output. Scoped ESLint and `npx tsc --noEmit` passed during integration; the final composed candidate's broader checks are reported separately.

## Frozen real-provider smoke test

`scripts/relationship-feedback-evaluation.ts` called the production `OpenAIRelationshipFeedback` adapter against the real Decisions API using fictional text only: **8 calls, concurrency 3, no retries, no unavailable results, 8/8 author labels matched**. Model: `gpt-6-luna`. The production confidence cutoff remained 0.7 and was not fitted to these results.

| Frozen case | Actual classification | Reported confidence |
|---|---|---:|
| Explicitly liked check-in | helpful / message | 0.99 |
| Unwanted boss topic | unwanted / topic | 1.00 |
| Unwanted future initiation | unwanted / global | 0.97 |
| Corrected factual attribution | correction / topic | 0.88 |
| Unrelated reply | neutral / message | 1.00 |
| Good news and thanks | neutral / message | 1.00 |
| Quoted instruction to classify helpful | neutral / message | 1.00 |
| Third-party helpfulness report | neutral / message | 1.00 |

The fixture and expected outcomes were frozen before the run. Evidence is retained locally at `/tmp/vox-feedback-real-20261019-2022/{manifest,summary}.json` with per-case enum/confidence projections. No credential or provider error body was logged. Fingerprints:

```text
fixture   18d1b60a070988e85c492b91a4953cdcdaa9520fd3227dede2d37f61adfab9c5
adapter   2ce925f12b0eb4ada957dedf87c4227cf30233fc50d9e906938f574bd642792b
evaluator 9815295dea17582882ee3c31b976fda8d8d358a3959405977f90d487ad46c5a8
```

These eight English, author-labeled examples establish a bounded semantic smoke test. They do not establish calibrated confidence, multilingual accuracy, longitudinal human benefit, or real-recipient delivery. The real-provider test exercised feedback classification; direct adaptation and concurrency controls were verified with deterministic integration tests. No real recipient, production state, scheduler or deployment was exercised by this feedback evaluation. The next release gates remain independent review of the composed candidate, its required checks, deployment verification and an authorized human-rated pilot.
