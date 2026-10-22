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

## Memory record v2 and bounded retrieval (S06, flags off)

Step 6 of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (sections 4.3 L3 and 4.4). Spec: `docs/implementation/agent-intelligence/S06-memory-v2-retrieval.md`. Everything ships behind server flags that default off; with every flag unset, `selectMemories` is the base scorer verbatim (checked against a frozen copy on 200 seeded corpora), legacy rows and Firestore docs map to the base shapes, and no provider, cache or vector code runs.

**Flags.** `TIREH_RETRIEVAL_V2=1` switches `selectMemories` to the v2 ranker (read at call time through `tirehFlags()`); an explicit `mode` overrides it. `TIREH_VECTOR_RETRIEVAL=1` lets `vectorCandidates` call Firestore `findNearest`; it is effective only together with `TIREH_RETRIEVAL_V2=1`. `OPENAI_EMBEDDING_MODEL` (not a flag) picks the embedding model in the `OpenAIEmbeddingProvider` constructor, default `text-embedding-3-small`.

**Record v2.** `MemoryRecord` gains optional `space`, `status`, `validFrom`, `invalidatedAt`/`invalidatedBy`, `importance`, `lastRetrievedAt`, `retrievalCount`, `expiresAt`, `reviewAfter`, `subjectConfirmed`, `contentHash`, `embedding`, `embeddingModel`, `embeddingVersion`. None is required on read: `memoryV2()` supplies defaults (work, asserted, `source.at`, importance 7 for decisions, 6 for preferences, 5 otherwise). The InMemory, file and Firestore stores never keep an embedding on a personal or confidential record (stripped on add, update and share updates; Firestore deletes the fields when a record stops being normal). `add()` still never bumps `safetyRevision`. The stores gain optional `tombstonesOf`/`addTombstones` (union only, no revision bump) for S08, and Firestore gains `findNearest`.

**v2 ranking.** Candidates pass `inConversation` and `isMemoryAllowedInChat` and are not superseded, replaced by another input record, invalidated (`invalidatedAt <= now`) or expired (`expiresAt <= now`). Lexical relevance uses a Persian-aware tokenizer (Arabic-keyboard letters unified, harakat, tatweel and directional marks removed, Persian and Arabic-Indic digits mapped, ZWNJ prefixes/suffixes stripped then joined, light می/ها stems, English plural stems, EN and FA stopwords) with `|q ∩ m| / sqrt(|m|)`. With a query embedding, a cosine rank over normal-sensitivity records is fused with the lexical rank by reciprocal-rank fusion (K = 60), normalised to [0, 1]. Score = 4 × relevance + exp(−0.1 × days since `lastRetrievedAt` or `updatedAt`) + importance/10 + 1 if about a reader + 0.5 decision / 0.3 relationship + 0.25 confirmed / −0.25 disputed + 0.5 × confidence − 0.25 above 210 characters. In rank order, a record with the same `contentHash` as a kept one, or an embedding from the same model and version with cosine > 0.92, is dropped. The visibility gate is re-applied to the final list.

**Count and size.** v2 returns at most 8 memories when no limit is given (`MAX_PROMPT_MEMORIES`); an explicit limit, such as extraction's 30, is honoured. Retrieval never mutates content: clipping each memory line to about 60 tokens is S03's per-turn rendering (`MAX_PROMPT_MEMORY_CHARS = 210`).

**Cache.** `ActiveMemoryCache` keeps derived features per persona, keyed by `(personaId, safetyRevision)` plus a sha256 fingerprint of the sorted `id:updatedAtMs` pairs (a plain `add()` does not bump the revision). An entry holds only `updatedAtMs`, FNV-1a numeric term hashes, the term count, `contentHash` and an embedding norm: no content, topic, query or visibility decision. It is bounded to 64 personas (LRU) and 10 minutes (TTL), returns `null` above 300 records or for mixed personas (v2 then computes the same features uncached), and is never logged or persisted. Hashed terms are dictionary-reversible in principle and can outlive deleted content until TTL or eviction; they never leave process memory.

**Vector path.** `audienceScopeKeys(org, chat)` lists the scope keys every reader may see: the group key in a group chat (none with guests or unknown readers); in a private chat `private:P`, the groups P is in and, for non-guests, P's projects, companies and `org`. People scopes cannot be enumerated for an `in` pre-filter and personal/confidential records are never embedded, so both are served only by the in-process path. `vectorCandidates` chunks the keys by 30, asks `findNearest` for 40 candidates per chunk, unions by id, keeps only the persona's non-superseded rows and returns `[]` on any store error. It returns candidates only: a caller must union them with `listActive()` and pass the result through `selectMemories`. The negative-identity suite proves that even an index that ignores every filter yields zero rows to outsiders through that pipeline.

**Not wired yet.** Nothing in the gateway, worker or Studio calls the embedding provider, `vectorCandidates` or the new store methods; the gateway keeps calling `selectMemories(org, all, chat, { query, now })`, so with `TIREH_RETRIEVAL_V2=1` only reply ranking and count change (at most 8 instead of 20; extraction keeps 30). TODO (Steps 5 and 7): embed normal-sensitivity records at write time in the worker, compute the query embedding, call `vectorCandidates` above about 300 visible records on Firestore, and bump `lastRetrievedAt`/`retrievalCount` after a reply.

**Processor gate.** Embeddings send normal-sensitivity memory text to OpenAI. The PRIV-009 processor row for OpenAI embeddings (S15) must exist before any `OpenAIEmbeddingProvider` is constructed in production.

**Index deployment.** `firestore.indexes.json` defines the composite vector index on `tireh_memories` (personaId, active, scopeKey, embedding with 1536 dimensions, flat). `firebase.json` is unchanged. Deploy either by adding `"firestore": {"indexes": "firestore.indexes.json"}` to `firebase.json` in a separate ops change and running `firebase deploy --only firestore:indexes`, or with:

```
gcloud firestore indexes composite create --collection-group=tireh_memories --query-scope=COLLECTION --field-config=field-path=personaId,order=ascending --field-config=field-path=active,order=ascending --field-config=field-path=scopeKey,order=ascending --field-config='field-path=embedding,vector-config={"dimension":"1536","flat":"{}"}'
```

Without the index, `findNearest` fails with FAILED_PRECONDITION and `vectorCandidates` silently returns `[]` (lexical fallback), so a missing index is invisible in results; check it before enabling the flag.

**Eval.** `src/lib/tireh/__tests__/memory-eval/` holds 100 synthetic HOOR questions (50 EN, 50 FA; single 24, multi 16, update 16, temporal 14, abstention 12, leakage 18) over 134 records (66 EN, 68 FA, with Arabic-keyboard and ZWNJ variants) covering every scope kind and all three sensitivities. Leakage is judged against hand-written `visibleTo` labels that the test cross-checks with `isVisibleInChat`. recall@8 is over the 76 items with gold; recall@3 is reported as a stricter ordering check.

| Mode | recall@8 | EN | FA | single | multi | update | temporal | leakage items | recall@3 | leakage | stale returned |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v1 (limit 8) | 0.987 | 1.000 | 0.974 | 1.000 | 1.000 | 0.938 | 1.000 | 1.000 | 0.987 | 0 | 11 |
| v2 lexical (default 8) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.980 | 0 | 0 |
| v2 + fake embedding | 0.987 | 0.974 | 1.000 | 1.000 | 1.000 | 0.938 | 1.000 | 1.000 | 0.980 | 0 | 0 |

Leakage is 0 in all three modes and no abstention item returned a forbidden id. "Stale returned" counts invalidated or expired records handed back; v1 has no notion of either, so it is reported rather than gated. The fake embedding is a hashed-trigram stand-in with no semantics: its row says nothing about real paraphrase recall.

**What the numbers do and do not show.** The data is synthetic and authored together with the ranker, and each asker sees only 0 to 89 records (Reza 89, Parastoo 73, Milad 66, Sina 39, Arman 23, the GameEnd group 17, Leads 12, Negar 4, the guest group 0), so recall@8 sits near its ceiling for both rankers. v2's measurable gains here are Persian normalisation, the suppression of stale records and the cap of 8. RRF with K = 60 compresses lexical strength (rank 1 versus rank 10 differs by about 0.5 of 4 points), so recency, importance and type can lift a weak single-word match above a strong one; recall@3 is slightly below v1 (0.980 vs 0.987, multi-session 0.906). Persian quality on real Vox data and `text-embedding-3-small` Persian quality are unmeasured. The default therefore stays off until recall is measured on a held-out set of real EN/FA conversations.
