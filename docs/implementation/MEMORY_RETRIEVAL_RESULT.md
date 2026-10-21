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

## Follow-up: memory record v2 and fused retrieval (S06)

Step 6 of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (spec: `docs/implementation/agent-intelligence/S06-memory-v2-retrieval.md`). Everything ships off by default; with every flag unset, retrieval, prompts, extraction and store payloads are identical to base `6d00b80`.

### Flags and configuration

| Variable | Default | Effect |
|---|---|---|
| `TIREH_RETRIEVAL_V2=1` | off | `selectMemories` without an explicit `mode` uses v2. Any other value (unset, `0`, `true`) keeps v1. |
| `TIREH_VECTOR_RETRIEVAL=1` | off | `FirestoreMemoryStore.findNearest` and `vectorCandidates` query Firestore. Effective only together with `TIREH_RETRIEVAL_V2=1` (enforced by `tirehFlags()`); otherwise both return `[]` with no Firestore call. |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Configuration read only by `createEmbeddingProviderFromEnv` (needs `OPENAI_API_KEY`). Nothing calls it in this step. |

Flags are read through `tirehFlags()` at call time, never at module load and never from message content.

### What changed

- `MemoryRecord` gains optional v2 fields (`space`, `status`, `validFrom`, `invalidatedAt`, `invalidatedBy`, `importance`, `lastRetrievedAt`, `retrievalCount`, `expiresAt`, `reviewAfter`, `subjectConfirmed`, `contentHash`, `embedding`, `embeddingModel`, `embeddingVersion`). Nothing is required on read; `memoryV2()` supplies defaults for legacy rows. No store sets any v2 field by itself: writing them belongs to the Step 5 worker and Step 7 consolidation.
- v1 is the base scorer moved verbatim into `selectMemoriesV1` (default limit 20). A test compares it with a verbatim copy of the base function over 200 seeded EN/FA fixtures.
- v2 defaults to 8 memories only when no `limit` is passed; extraction's explicit `limit: 30` is honoured. v2 never mutates or clips content (S03 clips each prompt line), never writes `lastRetrievedAt`/`retrievalCount`, and never logs.
- `MemoryStore` gains optional `findNearest` (Firestore only), `tombstonesOf` and `addTombstones` (InMemory, file and Firestore). Tombstone additions never remove ids and never bump `safetyRevision`; `add()` still bumps it only on supersede.
- Nothing is wired into `gateway.ts` in this step: in production v2 is lexical-only until a later step computes a query embedding per turn and calls `vectorCandidates`.

### v2 scoring and suppression

1. Candidates: `inConversation` and `isMemoryAllowedInChat` (unchanged `visibility.ts`), then drop invalidated (`invalidatedBy`, or `invalidatedAt <= now`) and expired (`expiresAt <= now`) records, and any record named in another visible record's `supersedes`.
2. Lexical rank: overlap of Persian-aware tokens (NFKC, Arabic-keyboard folding of ي/ى/ك/ة/ۀ/أ/إ/ٱ/آ/ؤ/ئ, Persian and Arabic-Indic digits, diacritics and tatweel removed, ZWNJ/ZWJ/NBSP as separators, Persian and English stopwords, one plural suffix `ها`/`های`/`هایی`, conservative English `-s`). Cosine rank only when a query embedding is supplied (cosine >= 0.2).
3. `relevance = 3 * Σ 1/(60 + rank) * 61 / listsUsed` (reciprocal-rank fusion).
4. `score = relevance + exp(-0.1 * days since (lastRetrievedAt ?? updatedAt)) + importance/10 + about-audience (1) + type (decision 0.5, relationship 0.3) + status (confirmed +0.25, disputed -0.5) - 0.5 * clamp((approxTokens - 60) / 60)`.
5. Sort by score, then `updatedAt`, then id. Skip a record whose `contentHash` equals, or whose vector has cosine > 0.92 with, an already kept record.
6. Take `limit ?? 8`, then re-apply `inConversation && isMemoryAllowedInChat` as the final gate. The ranking and any cache are optimisations; the code rule is the authority.

### Feature cache

`ActiveMemoryCache` holds derived features only (tokens, approximate token count, content hash, a `Float32Array` copy of the embedding), never visibility decisions, audiences or results. It serves the file profile and personas with at most 300 records (`null`, no caching, above that or for mixed personas), LRU over 16 personas. The key is `(personaId, safetyRevision)` plus a sha256 fingerprint of `id|updatedAt|content length|embeddingVersion|embedding length` per record, because a plain `add()` never bumps `safetyRevision`. `selectMemories` passes `UNKNOWN_REVISION` (-1) and relies on the fingerprint; callers that know the revision (a future worker or Step 1's snapshot) call `features()` directly. A stale entry can only change ranking, never visibility, because the gate runs on every call.

### Embeddings and sensitivity

- `embedMemory` embeds content only (never topic or source) and only for `sensitivity === 'normal'` with non-blank content.
- Every store strips `embedding`, `embeddingModel` and `embeddingVersion` whenever the effective sensitivity is not normal: on add, update and `updateIfShareVersion`, including an update that changes sensitivity (Firestore writes `FieldValue.delete()`). `findNearest` additionally drops non-normal and superseded rows. Personal and confidential records are therefore scored in process only and never enter a server-side index.
- Firestore stores `FieldValue.vector()`; `clean()` now passes a VectorValue through untouched (without that guard, the `snapshot.data()` spread in `updateIfShareVersion` would turn the vector into a map and silently drop it from the index). `memoryFromDoc` converts the v2 dates and a VectorValue back to `number[]` and adds no key absent from the doc.
- `OpenAIEmbeddingProvider` uses the installed `openai` client with `maxRetries: 0`, `logLevel: 'off'` and an injectable `fetch`; errors carry a fixed code and HTTP status only (a provider may echo input back). Server-only.
- Embeddings are derived personal data: before a worker writes them, Studio paths that serialise `MemoryRecord` (HTTP memories, successor copies, exports) should strip them. On the file profile, 1536-float embeddings would make every locked reload parse megabytes; consider reduced `dimensions`, rounding or a sidecar first.

### Firestore vector index

`firestore.indexes.json` declares one composite index on `tireh_memories`: `personaId` ASC, `active` ASC, `scopeKey` ASC, `embedding` vector (dimension 1536, flat). `findNearest` filters `personaId ==`, `active == true`, `scopeKey in <= 30 keys` (from `allowedScopeKeys`, which narrows candidates and is never authority), COSINE, limit 40 by default (clamped 1..1000). Every embedded document must be exactly 1536-dimensional or the index silently skips it. `firebase.json` has no `firestore` block, so deploy the index with:

```sh
gcloud firestore indexes composite create --collection-group=tireh_memories --query-scope=COLLECTION --field-config=field-path=personaId,order=ascending --field-config=field-path=active,order=ascending --field-config=field-path=scopeKey,order=ascending --field-config=field-path=embedding,vector-config='{"dimension":"1536","flat":"{}"}'
```

or add a `firestore` block to `firebase.json` in a separate reviewed change. The index is not deployed by this step.

### Eval (synthetic) and negative identities

`src/lib/tireh/__tests__/memory-eval/` holds 90 synthetic HOOR-style memories (44 Persian, every scope kind and sensitivity, supersede chains, bi-temporal invalidations, expiries) with a hand-written reader oracle independent of `visibility.ts`, and 100 questions: single-session 25, multi-session 20, update 15, temporal 15, abstention 10, cross-person leakage 15, split 50/50 FA/EN, with 11 FA queries that the v1 tokenizer cannot match (Arabic-keyboard letters, ZWNJ/plural forms, 3-letter words). Query and memory embeddings come from the deterministic hashing fake (256 dimensions over the v2 tokens).

Measured on this branch (recall@8 over answerable questions; abstention and leakage questions have no expected rows):

| Mode | Overall | FA | EN | Single | Multi | Update | Temporal | Leakage | Blocked rows returned |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1, top 8 | 0.927 | 0.855 | 1.000 | 0.800 | 0.975 | 1.000 | 1.000 | 0 | 25 (update 8, temporal 13, abstention 4) |
| v2 lexical | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 0 |
| v2 + query embedding | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 0 |
| flag default (`TIREH_RETRIEVAL_V2=1`) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0 | 0 |

By language, v1 FA scores 0.615 on single-session and 0.950 on multi-session (EN 1.000 on both); v2 is 1.000 on every language and category cell. The v1 blocked rows are invalidated, `supersedes`-only and expired predecessors that v1 cannot recognise; leakage is 0 in every mode, v1 included, because both paths share the visibility gate.

`negative-identity.test.ts` seeds an EN and an FA canary per scope kind (private, personal, confidential, people, group including cross-group, project, company, org) and checks every outsider (members outside the scope, a guest, an unknown Telegram id) in all three flag states: zero rows from `selectMemories`, after an authorised reader warms the cache, through a `findNearest` stub that returns every canary, and no canary in any LLM request, prompt, extraction request or Telegram payload through the full gateway. Positive controls confirm an authorised reader receives the canary.

These numbers prove pipeline mechanics, Persian tokenisation and the privacy gates on synthetic data. They are not evidence of `text-embedding-3-small` quality on Persian, real-user recall or latency.

### Gate before switching defaults (not done here)

Do not turn `TIREH_RETRIEVAL_V2` on by default until the eval reruns with real `text-embedding-3-small` embeddings on consented Vox data (doc sections 2.3 and 4.4), with recall@8 at least v1's and leakage 0, and until a later step wires query embeddings and `vectorCandidates` into the gateway. Under the flag the default prompt memory count drops from 20 to 8; the existing gateway, memory-privacy and visibility suites pass under `TIREH_RETRIEVAL_V2=1` (and with `TIREH_VECTOR_RETRIEVAL=1`) on this branch. The weights are constants and can be tuned against the eval.
