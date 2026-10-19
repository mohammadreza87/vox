# Bounded memory retrieval result

Task: VOX-013 supporting optimization; supports the memory strategy and reliable revision handling. It does **not** complete VOX-015 legacy migration or VOX-018 outbox consumers/repair.

Author: Codex architect implementation worker. Candidate base: `9fb73d3`, branch `codex/vox-adaptive-completion`. Local synthetic execution only; no live records, paid/provider calls, credentials, migration, deployment or commits. Independent acceptance remains with the lead/evaluator.

## Implemented behavior

The actual PersonaGateway completion and streaming paths now use `AuthorizedContextRetriever` through the existing `selectAdaptiveContext` adapter. It selects current authorized private/shared/relationship context with deterministic lexical ranking. Matches outrank freshness; equal scores use freshness then stable record ID. English/Persian matching normalizes Unicode, Arabic yeh/kaf, combining marks, joiners and Arabic/Persian digits. No embeddings, translation, external reranker or provider is used by retrieval.

Studio renders explicit response preferences into a separate trusted `priorityContext` projection. Gateway includes that projection in its complete authority receipt and reserves its rows before ordinary memory. A saved note cannot obtain priority by imitating a preference heading. Both layers share one 12-row, 8,192-byte limit measured on the exact UTF-8 serialized context array. Records remain whole; oversized records are skipped rather than cutting negation, dates or qualifications. Empty input remains empty. Unexpected projections above 20,000 records or 1 MiB fail closed; records above 16 KiB are excluded. These are implementation safeguards, not measured optimal memory budgets.

Authorization remains deterministic in `AdaptiveService.readPrivateContext`, `SharedMemoryService.readContext` and gateway audience validation. Retrieval receives only those current projections. Group retrieval uses only the separate all-recipient shared projection and cannot consume individual private rows or priority preferences. Work/Personal, person, agent and current audience/policy/memory revisions remain covered by the full gateway boundary key. Selection does not narrow the receipt: changing even an unselected source suppresses pending output. The unchanged-authority check immediately before provider use, after completion, and before each streamed fragment remains active.

The process-local cache holds opaque row IDs/ranking order, opaque receipt hashes and timestamps only. It never supplies text or stores queries/normalized terms, summaries or candidate projections. Each call rebinds cached IDs against its freshly authorized current rows. Keys cover the current authority receipt, scope, query digest and complete candidate digest. A changed receipt invalidates prior entries for the scope, including source deletion and permission revocation. A 64-entry LRU and 30-second TTL bound retention; no cache data, query fingerprints or text is written to storage, telemetry or logs. There is no authorization shortcut or cached-policy lease.

## Current selected image seam

At the lead's request, `PersonaGateway.converse` also accepts bounded validated `options.images`, passed through `generateReplyAt`/`composeReply` to the current private user LLM message only. Images are cloned into ephemeral provider input after current-turn anchoring. No image fields enter history, memory extraction or relationship observations, and later turns do not replay them. Existing authority rechecks cover image export and response delivery. Request validation and provider formatting are separate lead-owned changes; this receipt does not independently qualify those components or provider retention.

## Synthetic checks

Command:

```sh
npx vitest run src/lib/adaptive/retrieval src/lib/tireh/__tests__/adaptive-context.test.ts src/lib/tireh/__tests__/combined-runtime.test.ts src/lib/tireh/__tests__/integration-independent.test.ts src/lib/studio/__tests__/adaptive-integration.test.ts src/lib/adaptive/__tests__/shared-memory.test.ts src/lib/adaptive/__tests__/persistence-service.test.ts
```

Initial result: **68/68 tests passed** across eight files, including 16 new focused retrieval/runtime cases. The follow-up below records the final expanded candidate checks. New checks cover relevance before recency, EN/FA keyboard/diacritic equivalents, deterministic ties, trusted preference reservation, byte/row limits and whole-record preservation, duplicate/ambiguous input, oversized projections, no text/query in caches, edits/revocation/late old requests, cache scope/TTL/LRU, group private-data exclusion, Work/Personal isolation, stale-before-export suppression, unselected-source changes before delivery, preference revocation during streaming, and current-only image export/history/extraction absence with image grant races.

`npx eslint src/lib/adaptive/retrieval src/lib/tireh/memory/adaptive-context.ts src/lib/tireh/gateway.ts`: passed.

Final `npx tsc --noEmit --pretty false`: passed after the lead resolved the concurrent voice dependency and conversation limiter integration gaps.

A synthetic 2,000-record corpus includes one old relevant English fact, one old relevant Persian fact and 1,998 recent unrelated records. The selector returned:

| Query cohort | Top record | Considered | Selected | Serialized bytes | Warm cache |
|---|---|---:|---:|---:|---|
| English launch deadline | `en-target` | 2,000 | 12 | 469 | hit |
| Persian launch deadline with Arabic keyboard spelling | `fa-target` | 2,000 | 12 | 496 | hit |

This is deterministic ranking/budget evidence, not latency, semantic recall, real-user quality or task-success evidence.

## Limits and next owner

The existing account/shared aggregates are still read and authorized in full. This bounds provider context and repeated ranking cost, but does not provide indexed database search or eliminate aggregate reads/tokenization/fingerprinting. The full source receipt is reread before export/output. Cache entries expire lazily; they retain no source text. Ranking is lexical and can miss paraphrases, multilingual translations and implicit cues. The byte cap applies to the saved-context JSON array, not the full provider request or an exact provider token count. Preferences larger than the full cap are skipped whole; current authored preference schemas produce small bounded enum settings. No production-scale latency, quality evaluation, independent review, CI, deployed revision, provider or device evidence is included.

Lead/evaluator: review the exact combined candidate, rerun type-check/full suite after other worker integration, independently exercise existing person/group/exact-recipient ACL tests, and record acceptance separately. Rollback is reverting the adapter/gateway/Studio projection changes; no data migration or retained retrieval index exists.

## Changed paths

- `src/lib/adaptive/retrieval/index.ts`
- `src/lib/adaptive/retrieval/retrieval.test.ts`
- `src/lib/adaptive/retrieval/runtime-retrieval.test.ts`
- `src/lib/tireh/memory/adaptive-context.ts`
- `src/lib/tireh/gateway.ts` (priority projection/cache receipt and current image plumbing only)
- `src/lib/studio/service.ts` (`adaptiveContext` preference projection only)
- `docs/implementation/MEMORY_RETRIEVAL_RESULT.md`

Author's tested file SHA-256 identities (uncommitted tree, 19 October 2026):

```text
23dad8e319cfa99e90a26b0334dc059ee7b0539bd28398bc739874c1186cfc70  src/lib/adaptive/retrieval/index.ts
a6b12f302a428f2b17b80cae5d17da10af82987dbb616766abaf3c27477b0f6e  src/lib/adaptive/retrieval/retrieval.test.ts
142055561ebaa9377261219d55deb29307cb0d896e565edac71ee2adcd463490  src/lib/adaptive/retrieval/runtime-retrieval.test.ts
b27802ad0c3f8299a53b375624a28db7873f732bf4e043179b1e61cfb0d560b9  src/lib/tireh/memory/adaptive-context.ts
842477d84f20c7131f7d9e0e8fdcd73c33b62b125326e62159b7c2ae41a59fe9  src/lib/tireh/gateway.ts
```


## Follow-up: useful prewarming and conversation capability fence

The lead requested a useful retrieval prewarm after an answered prediction. `gateway.prepareContext(personaId, speakerId, text, { space, authorize })` performs read-only current-boundary selection with the same scope/receipt/query cache key as final conversation. Authorization runs before any private context read and is rechecked with the full boundary before/after selection. It returns a boolean only; no memory text, history retention, relationship observation, model call or user action crosses this API. The prediction worker owns the receipt-validated HTTP hook and its 250 ms preparation budget.

Independent review found that the new conversation route initially checked core/image capability only outside `gateway.converse`. The lead assigned this author the gateway correction: an optional current-authority callback is checked before observation, immediately at provider export after asynchronous assembly, after completion and before final delivery. Memory-source authorization remains separately enforced. The lead supplies the callback from current route capability/agent/cancellation authority. These authored gateway changes require another reviewer for independent acceptance.

Four new focused tests verify route capability loss during assembly despite an unchanged memory receipt, denial before side effects, actual same-query cache warming for final composition, and revoked preparation with zero context reads. Final local combined execution: **172/172 tests passed across 16 files**, comprising the 72-test retrieval/ACL/runtime selection and an additional 100 tests selected during review of the separate prediction/conversation/provider slice. Full TypeScript checking passed. No paid provider, deployed path or device qualification is implied.
