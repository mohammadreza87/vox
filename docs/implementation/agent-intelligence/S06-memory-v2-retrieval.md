# S06: Memory record v2, embeddings and bounded fused retrieval

Step 6 of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (sections 2.3, 4.3 L3 row, 4.4 and the Step 6 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`. Flags: `TIREH_RETRIEVAL_V2`, `TIREH_VECTOR_RETRIEVAL` (both default off).

## Goal

- Add the Graphiti / Generative-Agents style L3 fields to `MemoryRecord` as optional, read-tolerant data.
- Add an `EmbeddingProvider` seam with an OpenAI `text-embedding-3-small` adapter and a deterministic fake.
- Add a v2 retrieval path behind `TIREH_RETRIEVAL_V2=1`: Persian-aware tokenisation, reciprocal-rank fusion of lexical and cosine ranks, rescoring (recency since last retrieval, importance, about-audience, type, status, length), near-duplicate and superseded suppression, and `isMemoryAllowedInChat` / `inConversation` as the final gate. At most 8 memories by default.
- Add an in-process feature cache keyed by `(personaId, safetyRevision)` plus an id/updatedAt fingerprint.
- Add a Firestore `findNearest` candidate path behind `TIREH_VECTOR_RETRIEVAL=1` with its composite vector index file.
- Add optional tombstone accessors for S08.
- Ship a ~100-question EN/FA eval (recall@8 reported, leakage == 0 asserted) and Glean-style negative-identity tests through the full pipeline.
- With every flag unset, behaviour, store reads/writes and request payloads are identical to the base.

## Facts at the base this spec relies on

- `retrieval.ts` has `selectMemories(org, memories, chat, {query, limit=20, now})` with a v1 tokenizer (length > 3, 29 English stopwords). It scores `overlap*2 + aboutAudience + recency(90d) + typeBoost + confidence*0.5` and exports `findConflicts`.
- Callers are `gateway.ts` (3 calls with the default limit, 1 with `limit:30` for extraction) and `prompt.ts` (`findConflicts` only). S06 does not edit any caller.
- `InMemoryMemoryStore` keeps `tombstones: Map<personaId, Set<eventId>>` and `revisions`; `add()` bumps the revision only when superseding.
- `file-store.ts` wraps InMemory stores, reloads the JSON under a mkdir lock on every wrapped call and revives the dates listed in `DATE_KEYS`. Method lists passed to `wrap()` are explicit.
- `firestore-store.ts` stores `active` and `scopeKey` on every `tireh_memories` doc and keeps tombstones in `tireh_memory_state/{personaId}.tombstones`. `memoryFromDoc` converts only `source.at`, `createdAt`, `updatedAt`. `clean()` rebuilds every non-Date object, which would destroy a `VectorValue`.
- Installed: `@google-cloud/firestore` 7.11.6 (`Query.findNearest`, `VectorValue.toArray()`, `FieldValue.vector()`), `firebase-admin` 13.10.0, `openai` 6.9.1 (`fetch`, `maxRetries`, `logLevel`; `embeddings.create(body, {signal})`).
- vitest runs in jsdom; the openai SDK refuses browser-like environments, so every new S06 test file starts with `// @vitest-environment node`.
- `ChatContext` has no `space`, so v2 cannot filter by space in this run.
- `firestore.indexes.json` does not exist; `firebase.json` has only `hosting`.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the shared contract (sha256 `6b8edcd4…6630`). Flags read via `tirehFlags()` at call time only. |
| `src/lib/tireh/types.ts` | MEMORY section only: `MemorySpace`, `MemoryStatus` after `MemorySensitivity`; the v2 block (15 optional fields) after `confidence`. Nothing becomes required. |
| `src/lib/tireh/memory/record-v2.ts` | New, pure. `memoryV2(m)` defaults (space work, status asserted, validFrom source.at, importance type default `{decision:7, preference:6, fact/event/relationship:5}` unless an integer 1-10, retrievalCount non-negative integer else 0, subjectConfirmed strict true, dates passed only when valid). `contentHash`, `DEFAULT_IMPORTANCE`, `isInvalidated`, `isExpired` (both inclusive of `== now`). Never mutates. |
| `src/lib/tireh/memory/embeddings.ts` | New. `EMBEDDING_VERSION=1`, default model `text-embedding-3-small`, 1536 dims, batch 128. `OpenAIEmbeddingProvider` (one client, `maxRetries:0`, `logLevel:'off'`, injectable fetch, sequential batches, index re-ordering, dimension check, no text in errors, no logging). `FakeEmbeddingProvider` (sha256 feature hashing, L2-normalised, content-free counters, `failWith`). `cosine`, `embedMemory` (normal, non-blank content only), `createEmbeddingProviderFromEnv` (not wired). |
| `src/lib/tireh/memory/retrieval.ts` | `findConflicts` unchanged. Base `selectMemories` body moved verbatim into `selectMemoriesV1`. Exported `selectMemories` dispatches on `options.mode ?? (tirehFlags().retrievalV2 ? 'v2' : 'v1')`. New: constants, Persian-aware `tokenize`, `ActiveMemoryCache` + module `activeMemoryCache`, `selectMemoriesV2`, `allowedScopeKeys`, `vectorCandidates`. |
| `src/lib/tireh/memory/store.ts` | Optional `findNearest?`, `tombstonesOf?`, `addTombstones?` on `MemoryStore`. InMemory implements the two tombstone methods (sorted, union, never removes, never bumps revision). `withoutSensitiveEmbedding` strips embedding keys on add/update/updateIfShareVersion when the effective sensitivity is not normal; legacy records keep object identity. |
| `src/lib/tireh/memory/file-store.ts` | `DATE_KEYS` adds `validFrom`, `invalidatedAt`, `lastRetrievedAt`, `expiresAt`, `reviewAfter`; `addTombstones` in the mutation list, `tombstonesOf` in the read list. |
| `src/lib/tireh/memory/firestore-store.ts` | `clean()` passes VectorValue through; `memoryFromDoc` converts the five v2 dates and a VectorValue embedding (adds no absent keys); `storedVector()` converts or strips embeddings on add/addIfEpoch/updateIfShareVersion, `update()` converts or deletes; `findNearest` (flag gated, <=30 keys, limit clamp 1..1000, filters normal and non-superseded); `tombstonesOf` / `addTombstones` (revision unchanged). |
| `firestore.indexes.json` | New composite vector index on `tireh_memories`: personaId, active, scopeKey ASC + `embedding` vectorConfig dimension 1536 flat. `firebase.json` untouched. |
| `docs/implementation/MEMORY_RETRIEVAL_RESULT.md` | Append `## Follow-up: memory record v2 and fused retrieval (S06)` with flags, formula, suppression, cache key, sensitivity rules, index deploy command, measured eval numbers and the real-embedding gate. |
| tests | `memory-v2-record`, `memory-v2-embeddings`, `memory-v2-retrieval`, `memory-v2-stores`, `memory-v2-firestore`, `memory-eval/dataset.ts` + `memory-eval/memory-eval.test.ts`, `negative-identity.test.ts`. All `// @vitest-environment node`, no network, temp files via `os.tmpdir()`. |

## v2 retrieval (selectMemoriesV2)

1. `visible = memories.filter(inConversation && isMemoryAllowedInChat && !isInvalidated && !isExpired)`, minus any record whose id is another visible record's `supersedes`.
2. Lexical list: overlap of `tokenize(query)` with the cached feature tokens (`content + ' ' + topic`), overlap desc then id asc.
3. Vector list (only with `queryEmbedding`): equal-length vectors with cosine >= 0.2, cosine desc then id asc.
4. `rrf = Σ 1/(60 + rank)`; `relevance = 3 * rrf * 61 / listsUsed`.
5. `score = relevance + exp(-0.1 * days since (lastRetrievedAt ?? updatedAt)) + importance/10 + aboutAudience + typeBoost(decision 0.5, relationship 0.3) + status(confirmed +0.25, disputed -0.5) - 0.5 * clamp((approxTokens-60)/60)`.
6. Sort by score desc, updatedAt desc, id asc. Skip equal contentHash or cosine > 0.92 to a kept record.
7. Take `limit ?? 8`; re-apply `inConversation && isMemoryAllowedInChat` as the final gate.

Never mutates or clips content, never writes `lastRetrievedAt` / `retrievalCount`, never logs.

## Tokenizer (v2 only)

NFKC + lowercase; Arabic-script variants folded (ي/ى→ی, ك→ک, ة/ۀ→ه, أ/إ/ٱ/آ→ا, ؤ→و, ئ→ی, Persian and Arabic-Indic digits → ASCII); diacritics U+064B-065F, U+0670, tatweel, LRM/RLM removed; ZWNJ, ZWJ, NBSP are separators; split on `[^\p{L}\p{N}]+`. Digits kept at any length; Arabic-script tokens kept at length >= 2 unless a Persian stopword, with one plural suffix (`هایی`, `های`, `ها`) stripped when length >= 5 and >= 3 letters remain; other tokens kept at length >= 3 unless an English stopword, with a trailing `s` stripped at length >= 5 unless ending in `ss`, `us`, `is`. Deduplicated in first-occurrence order.

## Flags

- `TIREH_RETRIEVAL_V2=1` (default off): `selectMemories` without an explicit mode uses v2; default limit 8 only when `limit` is undefined. Anything else gives v1, byte-identical to the base (default limit 20).
- `TIREH_VECTOR_RETRIEVAL=1` (default off; effective only with `TIREH_RETRIEVAL_V2=1`): `FirestoreMemoryStore.findNearest` and `vectorCandidates` query Firestore; otherwise both return `[]` with no Firestore call.
- `OPENAI_EMBEDDING_MODEL` (configuration): read only by `createEmbeddingProviderFromEnv`, which nothing calls in this run.

## Acceptance

- Flags unset: base gateway, prompt, extraction and store behaviour unchanged; `selectMemories` equals the base oracle on 200 seeded fixtures; write payloads without v2 fields equal the base.
- Lib-scoped tsc exits 0; eslint clean on changed files; full tsc reports only the known `Privacy.tsx(111,6) TS17008`.
- `add()` and tombstone additions never bump `safetyRevision`.
- Embeddings are never stored for personal or confidential records; `findNearest` never returns them.
- Under `TIREH_RETRIEVAL_V2=1` the memory-privacy and visibility suites stay green; default returns <= 8, explicit 30 honoured.
- Eval reports recall@8 per category, language and mode; leakage 0 in every mode; v2 >= v1@8 overall and per language; FA v2 lexical > FA v1@8; v2 with embeddings >= 0.8.
- Negative identity: zero rows for every outsider and scope kind in every flag state, with positive controls.
- No network in tests; no new code logs content, queries, embeddings or keys.

## Out of scope

Step 1 (turn snapshot, revision vector, boundary rework); wiring into `gateway.ts` (query embeddings per turn, `vectorCandidates`, in-process vs findNearest switch); writing v2 fields (Step 5 worker / Step 7 consolidation); space filtering; 60-token clipping (S03); supersede notices, audit decorator and tombstone carry (S08); editing `firebase.json` or deploying the index; real-embedding eval on Vox data (the gate before switching the default); upgrading openai (S15); `visibility.ts` semantics; `Privacy.tsx`.

## Risks

- The eval is synthetic and the fake embedder is a hashing bag-of-words: the numbers prove pipeline mechanics and Persian tokenisation, not real `text-embedding-3-small` quality on Persian. Do not flip `TIREH_RETRIEVAL_V2` on by default before the eval reruns with real embeddings on consented Vox data.
- RRF with k=60 compresses relevance differences, so recency, importance and about-audience can reorder relevant records.
- The default limit drops from 20 to 8 under the flag; gateway tests seeding more than 8 memories may change under the flag. The proactive purpose call also sees fewer memories.
- The file profile re-parses the whole JSON on every locked call; 1536-float embeddings would make that expensive. Consider reduced dimensions, rounding or a sidecar before a worker writes embeddings there.
- Without the `clean()` VectorValue guard, spreads of `snapshot.data()` would silently drop vectors from the index.
- Firestore `in` allows at most 30 values; the vector index requires exactly 1536 dimensions.
- Embeddings are derived personal data; Studio paths that serialise `MemoryRecord` should strip them before a worker writes embeddings.
- `ActiveMemoryCache` worst case ~30 MB; it relies on the fingerprint because `add()` does not bump `safetyRevision`. Staleness affects ranking only, never visibility, since the gate runs every call.
- Persian normalisation is lossy (آ→ا, suffix stripping); ranking only.
- Merge order puts S06 before S08; the S08 audit decorator must forward the optional store methods.
