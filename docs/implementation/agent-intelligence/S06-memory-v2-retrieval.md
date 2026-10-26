# S06: Memory record v2, embeddings and bounded retrieval

Flagged, additive, not wired into the gateway. Plan: `docs/AGENT_INTELLIGENCE_SOLUTION.md`
sections 2.3, 4.3 (L3 row), 4.4 and the Step 6 row of section 5.
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df` (origin/develop at PR #100).

## Goal

Add the L3 `MemoryRecord` v2 fields as optional, never-required-on-read fields across the
InMemory, file and Firestore stores. Add an embedding seam: an OpenAI
`text-embedding-3-small` adapter, a deterministic fake and cosine. Add a v2 retrieval path
behind `TIREH_RETRIEVAL_V2=1` with:

- Persian-aware tokenisation;
- reciprocal-rank fusion of lexical and cosine ranks;
- rescoring by recency since last retrieval, importance, audience and type;
- suppression of near-duplicates, superseded, invalidated and expired records;
- `isMemoryAllowedInChat` and `inConversation` re-applied as the final gate;
- a default limit of 8 only when no limit is given.

Also: an in-process derived-feature cache keyed by (personaId, safetyRevision) plus an
id+updatedAt fingerprint, and a Firestore `findNearest` candidate path behind
`TIREH_VECTOR_RETRIEVAL=1` with its composite vector index. Two gates: a ~100-question EN/FA
memory eval that reports recall@8 and requires leakage == 0, and Glean-style
negative-identity tests through the full pipeline. With every flag unset, behaviour stays
byte-identical to the base.

No step in this run wires S06 into `gateway.ts`. `gateway.ts` keeps calling
`selectMemories(org, all, chat, { query, now })` synchronously; reply call sites pass no
limit and extraction passes `limit: 30`. No query embedding or `findNearest` is used on the
hot path yet.

Correction (QA F031, recorded by H4; no code change): the flag changes more than reply ranking
and count. Every `selectMemories` call in `gateway.ts` dispatches on it:

- replies (`composeReply` and the live reply path) get v2 ranking and at most 8 memories;
- `proactiveContext` (unsent private reconsiderations) also passes no limit, so it drops from
  20 to at most 8 memories under v2;
- extraction (`extractMemories`, `limit: 30`) gets v2's candidate suppression, so the
  extractor's "Already remembered" (`known`) list loses superseded, invalidated and expired
  records, exact `contentHash` duplicates and, once records carry embeddings, near-duplicates
  (cosine > 0.92). The
  extractor then sees one record of a near-identical pair and may propose a redundant record.
  Write-time de-duplication belongs to Steps 5/7; until then this is a known effect of the flag.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | NEW, byte-identical to the shared contract (sha256 `6b8edcd4…66630`). Not edited by S06. Note (QA F248): changed on `agent-intelligence-wave-a-main` by `97bf549` and `ebc18d9` (`voiceShadow`, `webhookFailClosed`); then sha256 `e398a121…d09`, and since hardening H3 `e94ca83` (`voiceShadow` composed with `voiceRecognition`) `7adeaa35…806740`, pinned in `llm-blocks.test.ts` and `llm-blocks.main-lineage.test.ts`; the hash above stays the contract S06 was built against. |
| `src/lib/tireh/text/persian.ts` | NEW in H4 hardening: `foldPersian`, `isArabicScriptLetter`, `isLatinLetter`, `clipGraphemes` (see Tokenizer). |
| `src/lib/tireh/types.ts` | MEMORY section only: `MemorySpace`, `MemoryStatus` after `MemorySensitivity`; the 15 optional v2 fields inside `MemoryRecord` after `confidence`. |
| `src/lib/tireh/memory/record-v2.ts` | NEW pure helpers: `memoryV2()` defaults view, `contentHash()`, `stripEmbeddingUnlessNormal()`, `DEFAULT_IMPORTANCE`. |
| `src/lib/tireh/memory/embeddings.ts` | NEW: `EMBEDDING_VERSION`, `EmbeddingProvider`, `EmbeddingError`, `OpenAIEmbeddingProvider` (injectable fetch, `maxRetries: 0`, `timeout: 10_000`, chunks of 256, max 2048 inputs, shape validation, content-free errors), `FakeEmbeddingProvider` (FNV-1a trigram hashing, L2-normalised, `calls` counter), `cosine`, `embedMemory` (normal sensitivity only). Not imported by gateway, Studio or runtime. |
| `src/lib/tireh/memory/retrieval.ts` | v1 kept verbatim as `selectMemoriesV1`; `selectMemories` dispatches on `options.mode ?? (tirehFlags().retrievalV2 ? 'v2' : 'v1')`. v2: `tokenize`, RRF (K = 60), rescoring, suppression, final gate, `ActiveMemoryCache`, `audienceScopeKeys`, `vectorCandidates`, exported constants. `findConflicts` unchanged. |
| `src/lib/tireh/memory/store.ts` | Optional `findNearest?`, `tombstonesOf?`, `addTombstones?`; InMemory implements the tombstone pair; `stripEmbeddingUnlessNormal` on `add`, `update`, `updateIfShareVersion`. `add()` never bumps `safetyRevision`. |
| `src/lib/tireh/memory/file-store.ts` | `DATE_KEYS` adds the 5 v2 date keys; `addTombstones` (mutation) and `tombstonesOf` (read) run under the lock. |
| `src/lib/tireh/memory/firestore-store.ts` | `FirestoreMemoryStoreOptions { vectorValue? }`; lazy `FieldValue.vector`; `clean()` passes VectorValues through; `memoryFromDoc` revives v2 dates and VectorValue embeddings only when present; embedding hygiene on all write paths (and `FieldValue.delete()` on update to non-normal); `findNearest`, `tombstonesOf`, `addTombstones`. |
| `firestore.indexes.json` | NEW: one composite vector index on `tireh_memories` (personaId, active, scopeKey, embedding 1536 flat). `firebase.json` untouched. |
| `docs/implementation/MEMORY_RETRIEVAL_RESULT.md` | Append `## Memory record v2 and bounded retrieval (S06, flags off)`. |

### v2 algorithm (selectMemoriesV2, pure)

1. `audience = audienceOf(chat)`; `gate = m => inConversation(m) && isMemoryAllowedInChat(org, m, chat)`.
2. Candidates: pass `gate`, and not superseded (`supersededBy`), not invalidated
   (`invalidatedAt <= now`), not expired (`expiresAt <= now`), and not referenced by another
   input record's `supersedes`.
3. Lexical: hashed `tokenize(query)` vs hashed `tokenize(content + ' ' + topic)`;
   `lex = |q ∩ m| / sqrt(max(1, |m|))`; rank over `lex > 0` (lex desc, updatedAt desc, id asc).
4. Semantic (only with a non-empty `queryEmbedding`): normal-sensitivity records with an
   equal-length embedding; rank over `cos > 0`, same tie-breaks.
5. RRF K = 60; `relevance = rrf / (lists / (K + 1))` in [0, 1].
6. Score = 4·relevance + exp(−0.1·days since lastRetrievedAt ?? updatedAt) + importance/10 +
   aboutAudience + typeBoost (decision 0.5, relationship 0.3) + statusBoost (confirmed +0.25,
   disputed −0.25) + 0.5·confidence − 0.25 when content.length > 210. Sort score desc,
   updatedAt desc, id asc.
7. Distractor suppression in rank order: same contentHash, or cosine > 0.92 between
   same-model, same-version, equal-length embeddings.
8. `limit = options.limit ?? 8`; slice; re-apply `gate`.

### Tokenizer

NFKC + lowercase; Arabic-script letter unification (ي ى ئ→ی, ك→ک, ة→ه, أ إ ٱ آ→ا, ؤ→و);
remove `\p{M}`, tatweel, ZWJ, LRM, RLM, BOM; Persian/Arabic-Indic digits → ASCII; ZWNJ-aware
prefix/suffix stripping then ZWNJ join; split on `[^\p{L}\p{N}]+`; light stems (ها/های suffix,
می/نمی prefix, English plural s); length floors; EN and FA stopwords.

**Shared normaliser (H4).** The letter fold above now lives in `src/lib/tireh/text/persian.ts` as
`foldPersian(text, { lowercase })`; `retrieval.ts` `normalizeText` is
`foldPersian(text, { lowercase: true })`. The same fold is read by `memory/requests.ts`
(`negatedMemoryRequest`, `explicitMemoryRequest`), the S12 extraction people filter and the S14
follow-up classifier, so a Persian spelling recognised in one place is recognised in the others.
The module also exports `isArabicScriptLetter`, `isLatinLetter` (used by
`decisions/language.ts` and `identity/style-features.ts`) and `clipGraphemes`. The fold is
byte-identical to the 718752e normaliser over a committed 60-string EN/FA/mixed corpus
(`hardening-persian-text.test.ts`), with one deliberate addition: heh with yeh above (U+06C0)
and ae (U+06D5) fold to heh (U+0647), so "خانۀ" and "خانهٔ" (heh plus hamza above, whose mark
is stripped) give the same token (QA F139).

**Stemmer (H4, QA F093).** The plural suffix and the verbal prefix are never stacked: a token
ending in ها/های gets only its plural stem (میزها → میز, no longer also زها). می/نمی is
stripped only when at least 3 letters remain, the token does not end in ها/های and the token is
not in `FA_MI_NOUNS` (میز, میدان, میوه, میهمان, میل, میراث, میلیون, میلیارد, میان, میانه,
میانگین, میهن, میمون, میخ), so میدان no longer yields دان, میلیون لیون or میراث راث. Verbal
forms keep their stem (میروم → روم, نمیدانم → دانم). `hardening-tokenize-before-after.test.ts`
pins `tokenize()` on the committed corpus: identical to 718752e except six stemmer entries and the
two heh-variant words. The memory eval is unchanged by both changes: v2 lexical Recall@3 0.980,
Recall@8 1.0, leakage 0 (v1 0.987, untouched).

### Cache

`ActiveMemoryCache`: per-persona entries `{revision, fingerprint, expiresAt, features}`;
fingerprint = sha256 over sorted `id:updatedAtMs`; features hold only `updatedAtMs`, numeric
FNV-1a term hashes, `termCount`, `contentHash`, optional `embeddingNorm`. LRU 64 personas,
TTL 10 minutes; `null` above 300 records or with mixed personas.

### Vector candidates

`audienceScopeKeys(org, chat)`: `[]` for guest/unknown audiences; group chat → `group:<id>`;
private chat → `private:P`, the groups P is in, and (non-guests) projects, companies and
`org`. People scopes are not enumerable and stay on the in-process path.
`vectorCandidates(...)` returns `[]` unless `tirehFlags().vectorRetrieval`, the store has
`findNearest`, the query embedding is non-empty and the scope keys are non-empty; chunks keys
by 30, limit 40, unions by id, keeps only the persona's non-superseded rows, swallows store
errors. Candidates only: the caller must union with `listActive` and pass through
`selectMemories`.

## Flags

- `TIREH_RETRIEVAL_V2=1` (default off, read at call time): v2 mode and default limit 8 when
  limit is undefined. Unset gives the exact base v1 ranking and default limit 20.
- `TIREH_VECTOR_RETRIEVAL=1` (default off; effective only with `TIREH_RETRIEVAL_V2=1`):
  `vectorCandidates` may call `store.findNearest`. Not wired.
- `OPENAI_EMBEDDING_MODEL` (not a flag): read in the provider constructor; default
  `text-embedding-3-small`. No provider is constructed by runtime code in this run.

## Tests

- `memory-v2-record.test.ts`: defaults view, importance clamping, invalid dates,
  `contentHash`, `stripEmbeddingUnlessNormal`.
- `memory-v2-stores.test.ts`: InMemory and file store v2 round-trip, embedding hygiene,
  legacy shape, tombstones, file-store date revival and lock/reload.
- `memory-v2-firestore.test.ts`: own fake Firestore with `in`, `findNearest` capture and a
  FakeVector; vector writes, reads, legacy shape, hygiene, `findNearest`, tombstones.
- `memory-v2-embeddings.test.ts` (node environment): OpenAI adapter through an injected
  fetch, fake provider, cosine, `embedMemory`; global fetch never called.
- `memory-v2-retrieval.test.ts`: tokenizer, v1 byte-identity vs a frozen base copy on 200
  seeded corpora, flag behaviour, v2 suppression and ranking, immutability, final gate,
  cache, `audienceScopeKeys`, `vectorCandidates`.
- `memory-eval/` (org, corpus, questions, metrics, test): ~100 EN/FA questions; recall@8 and
  leakage == 0 in v1, v2 and v2 + fake embeddings; v2 lexical recall@8 ≥ 0.85 overall,
  ≥ 0.85 EN, ≥ 0.80 FA; v2 ≥ v1 overall; v2 FA > v1 FA.
- `negative-identity.test.ts`: scope kind × sensitivity × store × mode matrix for every
  outsider kind; full gateway pipeline under both flag states; filter-ignoring vector fake;
  positive controls.

## Acceptance

- Diff lists only the files above plus new tests under `src/lib/tireh/__tests__/`.
- `flags.ts` sha256 matches the contract.
- Lib-scoped `tsc` exits 0; full `tsc --noEmit` reports only the known
  `Privacy.tsx(111,6) TS17008`.
- `npx vitest run src/lib/tireh src/lib/adaptive/decisions` green; the full suite adds no
  failing files beyond the documented sandbox baseline.
- `TIREH_RETRIEVAL_V2=1 npx vitest run memory-privacy, visibility, memory-eval` passes.
- Eval and negative-identity gates as above; flags-unset byte identity; no embedding ever
  stored for personal or confidential records; no network; no content in caches or logs.
- eslint clean on changed files; commits carry the Co-Authored-By trailer; branch not pushed.

## Out of scope

Step 1 (turn snapshot, revision vector, boundary/unchanged, Studio.adaptiveContext,
persistence seams, liveTurn rechecks) and any gateway.ts edit; writing v2 fields at write
time (Steps 5/7); 60-token clipping and the "## For this turn" rendering (S03); filtering by
`space` (S08 / Step 1); sharing changes, audit rows and `historyPolicy` (S08); visibility.ts
semantics; firebase.json and index deployment (documented only); package.json and the openai
upgrade and the PRIV-009 processor row (S15); L2 cards, context packs, pgvector/Upstash; the
pre-existing Firestore `clean()` Timestamp mangling in `updateIfShareVersion` (report only).

## Risks

- Persian stemming heuristics are validated only on the synthetic eval; the flag stays off
  until recall is measured on real Vox EN/FA data.
- `text-embedding-3-small` Persian quality is unmeasured; fake-embedding numbers are
  report-only.
- The eval is authored with the ranker (overfitting risk); mitigated by fixture sanity, an
  independent oracle and the v1 baseline.
- With the flag on, replies get at most 8 memories instead of 20; extraction keeps 30.
- Base bug: Firestore `updateIfShareVersion` runs `clean()` over snapshot data and turns
  Timestamps into plain maps; S06 protects only VectorValues.
- Lazy `firebase-admin/firestore` import for vector/delete sentinels; tests inject
  `options.vectorValue`.
- A missing vector index makes `findNearest` fail with FAILED_PRECONDITION and
  `vectorCandidates` silently falls back to `[]`.
- People scopes and sensitive records are never in the vector path; future wiring must union
  with `listActive`.
- Hashed term ids in the cache are dictionary-reversible; process memory only, bounded.
- Merge: S08's audit decorator must forward the optional store methods.
