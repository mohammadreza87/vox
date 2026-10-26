# Wave A on main (agent intelligence, 25 Oct 2026)

Branch `agent-intelligence-wave-a-main`, built in the worktree `$TMPDIR/vox-wave-a-main` from `main` at
`7224f40d69cf816a49139a30092cbf92551d2a8e` (PR #112). It is not pushed. It brings the QA-hardened wave A of
[the agent intelligence plan](../../AGENT_INTELLIGENCE_SOLUTION.md) onto the release line the team merges to and
deploys from. Every wave A flag defaults to off.

This is the summary record for the branch. The per-step detail (each conflict resolution, every main-lineage test
case kept or not kept, by name, with the reason, and every re-derived golden) is in
[WAVE_A_MAIN_INTEGRATION.md](WAVE_A_MAIN_INTEGRATION.md). The develop-based wave A branch keeps its own record,
[WAVE_A_INTEGRATION.md](WAVE_A_INTEGRATION.md), which stays here unchanged as the historical record of that branch.

The medium and low QA findings left open after fixer round 3 were addressed by nine hardening clusters on 25 Oct 2026
and merged onto this branch (section 10). Sections 6 to 9 describe the tree after that merge.

## 1. The two integrations

| | Main (`7224f40`) | Wave A (`agent-intelligence-wave-a`, `7a9bd38`) |
|---|---|---|
| Base | main release line | `9144c2e` = `origin/develop` `39ef433` plus Step 1 (PR #104), which main also contains |
| Wave A content | Codex integration of the first-round step branches (`250f065`, PR #105, 21 Oct) and its repairs `8a7dc55`, `b71a0a2`, `c2c0bee`, `758875d`, `a0e59c4` | Step branches merged in the order S14, S10L, S15, S09, S06, S08, S11L, S03, S12 (the `-r2` continuations for five steps), integration fixes, three QA rounds (139 findings, red-team tests and fixes) and the legacy Telegram payments hardening |
| Main-only features | Pet Mini App (#107, #108), Studio design integration (#105, #106), agent experience fixes (#110), Circles / group agents with consent (#111), Mini App window repair (#112) | none |
| openai | ^7.39.0 (lock 7.39.0) | ^7.34.0 (lock 7.34.0) |
| Record | `docs/implementation/INTEGRATION_RELEASE.md` | `WAVE_A_INTEGRATION.md` |

Lineage per step:

- **Superset steps (S15, S09, S08, S11L, S03).** Wave A's branch contains main's first-round commits as ancestors
  (`git merge-base --is-ancestor` confirms each) and continues them. These merges only had to keep main's later
  repairs (mostly `8a7dc55`) and main's features around the same code.
- **Double-implemented steps (S14, S10L, S06, S12).** Main merged a different, earlier run of the same spec. No commit
  of main's lineage is in wave A, so both sides hold a full implementation of the same module and the files conflict
  wholesale. The QA-hardened wave A implementation is the chosen one (section 2).
- **Repairs.** None of `8a7dc55`'s repairs were in wave A: the live-loop recheck on every part (no `LIVE_RECHECK_MS`
  throttle), `DeciderAuthority`, `authorizeAtTransport`, the voiceprint `authorityNow` fence, the file-store `local()`
  committed rereads and the adaptive storage `committedDigests`. Each one is ported into wave A's code on this branch.

## 2. Chosen side per double-implemented module

| Module | Main lineage | Wave A lineage | Chosen | Ported from main |
|---|---|---|---|---|
| S14 reply-style bandit library (`adaptive/personalization/procedural*.ts`) | `6fa457b`…`aa5ef60`, merged by `1ae38d4` | `aiq/bandit-lib` `57e2d6c`, merged as `7127eba` | wave A | Portable test cases in `procedural.main-lineage.test.ts`. The second `authorize()` check in `choose()` immediately before the evaluation row is written. `FileReplyStyleStore` `O_NOFOLLOW` read and `O_CREAT\|O_EXCL\|O_NOFOLLOW` temp-file write (S14 verifier fix-ups). Main's non-S14 README lines byte for byte. |
| S10L identity library (`tireh/identity/*`) | `80252dd`…`83848b7`, merged by `b892138` | `aiq/identity-lib` `b34b7c0`, merged as `b278780`, plus QA `05a4520` | wave A | Main's richer Firestore fake moved to `src/lib/studio/__tests__/fake-firestore.ts` for the Circles DM and Pet store tests (import path change only). Portable cases in 8 `identity/__tests__/*.main-lineage.test.ts` files, including main's source-tree hint-isolation scans. `voice-band.ts` byte-identical (`b8d0a41d…21bd`). Main-only `identity/service.ts` deleted (no importer). |
| S06 memory v2 (`tireh/memory/{retrieval,embeddings,record-v2,store,firestore-store}.ts`) | `e1d76cf`…`9a6751e`, merged by `7c74019` | `aiq/memory-v2-retrieval-2` `1bef816`, merged as `0ba3de6`, plus QA `39216c4`, `9e66c1a`, `05a4520` | wave A | Step 1 `revisionProbe`/`epochProbe`/`RevisionProbe` and `8a7dc55` file-store `local()` committed rereads, with the wrap lists as the union. `firestore.indexes.json` (wave A's is a superset). Embeddings client `logLevel: 'off'` (S06 verifier fix-up, with a test). Portable cases in 6 `memory-v2-*` / `negative-identity` `.main-lineage.test.ts` files. Main's `memory-eval/dataset.ts` deleted as an orphan. |
| S12 image ingestion (`tireh/images/*`, gateway photo branch, extraction people rule) | `656c84f`…`b0cbb7f`, merged by `d99e3a5` | `aiq/image-ingestion` `2bdb95f`, merged as `1a3437c`, plus `56a4e98`, `19f3b37`, `eef8279`, `5cd59e5`, `042059a`, `6c90443`, `bfc9b39` | wave A | Main's `telegram/client.ts` (Circles, Pet and channel additions) with only wave A's `downloadImage` body. Main's outsider guarantee: the boundary carries `publicOnly` and the gateway never ingests for it (new test). Main's `images-telegram-client.test.ts` kept. Portable cases in 6 `images-*main-lineage*` files. Main's `images/policy.ts`, `select.ts` and the `peopleImageTurns` WeakSet removed. Main's people rule (kind `photo_of_people` or `contains_people >= 0.3`) ported by fixer r2 (`cb51710`): wave A's 0.5 without the kind was a weakened privacy check. |

The reason is the same for all four: wave A's version went through three QA rounds and carries the red-team
hardening (for S12, main's lineage had the exact defects F011, F012, F016, F035 and F050 that the red team fixed), and
no main feature calls into S14, S10L or S06. S12's only contact with main's features is the Telegram client and the
gateway regions around the photo branch, and those regions are main's.

## 3. Step merges

Each step was merged with `git merge --no-ff` onto the previous step, resolved per file (never with `-X ours` or
`-X theirs`). Conflicted files are recomputed from each merge's parents with `git merge-tree`.

| Step | Wave A SHA | Merge commit | Conflicted files | Resolution in brief | Fix-up commits |
|---|---|---|---|---|---|
| S14 | `7127eba` | `33992d7` | `S14-bandit-lib.md`, `adaptive/decisions/README.md`, `procedural.ts`, `procedural-store.ts`, `procedural.test.ts` | Wave A's files; README is wave A's S14 section plus main's other lines | (S14 verifier fixes landed with S10L) |
| S10L | `b278780` | `ee2230d` | `S10L-identity-lib.md` and 16 `tireh/identity` files (`fusion`, `index`, `profile`, `store`, `style-features`, `test`, `types`, the fake, fixtures and 8 tests) | Wave A's files; main's fake relocated; main-only `service.ts`, `fusion-caps.test.ts`, `stores.test.ts` removed | — |
| S15 | `b36da3a` | `4b9d808` | `adaptive/decisions/index.ts`, `openai-compat.test.ts`; silent openai downgrade in `package.json`/lock | Wave A's S15 body with `8a7dc55`'s `authorize`, `authorizeAtTransport` and the guarded async fetch re-applied; main's `package.json`/lock restored (openai 7.39.0) | — |
| S09 | `6cbe4bc` | `be01fde` | `adaptive/decisions/README.md`, `tireh/decisions/service-decider.ts`, `tireh/gateway.ts` | Wave A's r2 `ServiceDecider` with `8a7dc55`'s authority passthrough; main's gateway with wave A's S09 wiring (`triageQuestionSetNow`, `decisionLogRow`) | `e3bc3d1` (decision-log gateway test expects the authority argument) |
| S06 | `0ba3de6` | `a940b72` | `MEMORY_RETRIEVAL_RESULT.md`, `S06-memory-v2-retrieval.md`, `firestore.indexes.json`, 7 memory-v2/eval/negative-identity tests, `embeddings.ts`, `firestore-store.ts`, `record-v2.ts`, `retrieval.ts`, `store.ts` | Wave A's files with Step 1 probes kept exactly; file-store auto-merged with the union wrap lists and `local()` rereads | — |
| S08 | `bedca98` | `8d327ed` | `studio/__tests__/sharing-v2.test.ts` | Wave A's file plus `ca4035b`'s `NoTombstoneStore` arm; main's passing cases in `sharing-v2.main-lineage.test.ts`; `service.ts` auto-merged with Circles, Pet and channels unchanged | S06 verifier fix (`logLevel: 'off'`) in the merge |
| S11L | `17ddf29` | `f8a4b5c` | `EnrollScreen.tsx`, `studio/identity/voice.ts`, `studio/runtime.ts` | Wave A's r2 `voice.ts` with `8a7dc55`'s `authorityNow` fence before `cipher.open` and every provider export; `voiceprint-authority-races.test.ts` ported (10 cases); runtime keeps main's local voice engine mutually exclusive with voiceprints; EnrollScreen keeps main's `9e14d6f` classes | S08 verifier fixes (structural `isStaleMemoryWriteError`, 200-id audit batches) in the merge |
| S03 | `aeeab39` | `18d0415` | `prompt-layout.test.ts.snap`, `conversation/prompt.ts`, `tireh/gateway.ts` | Wave A's r2 `prompt.ts` with every `962e877` group-agent hunk re-applied (turn-context lines only in the per-turn block); `placeTurn` under main's `composeReply`/`liveTurn`; flag-off golden re-derived at `7224f40` | `8fd2048` (revision-compare reads `systemText`) |
| S12 | `1a3437c` | `40be72c` | `VOX_STUDIO.md`, `PRIVACY_AND_CONSENT.md`, `S12-image-ingestion.md`, 5 `images-*` tests and fixtures, `gateway.ts`, `images/{bytes,index,questions}.ts`, `memory/extraction.ts`, `telegram/client.ts` | Section 2; main's Circles consent sections kept verbatim | S03 verifier fixes (main's `cached-prompt-gateway-suite` and `-tail` wrappers restored) in the merge |
| TAIL | `7a9bd38` | `f002ea7` | `decisions-v2.test.ts`, `sharing-v2.test.ts`, `invariants.test.ts`, `tireh/gateway.ts` | Wave A's QA tail in main's gateway (image work after `boundary.audienceValid`, persisted `imageDerived` marks, shadow verification fire-and-forget behind `STUDIO_VOICE_SHADOW`); LIA1 inspector regenerated | — |

### Dropped items, by step

Every main-lineage test case that was not kept is listed by describe/it name, with the reason, in
WAVE_A_MAIN_INTEGRATION.md. In summary:

- **S14:** main's `ReplyStylePolicy` API cases with no wave A equivalent (precedence, propensity logging, file and
  Firestore store shape), and four cases that contradict wave A ('validates constructor options', '200 settles with
  reply-rate-only signals…', 'uses exactly the two default collections and Date fields for TTL', and the gate case,
  which was later restored when the second `authorize()` check was ported). Main's README sentence on a Firestore TTL
  policy for `vox_reply_style_eval.expiresAt` is gone: wave A stores plain numbers and relies on `sweep()`.
- **S10L:** main's `StyleIdentityService` (`identity/service.ts`) and the `fusion-caps`, `stores`, `service`,
  `profile`, `sequential-test` and `style-features` cases that use an absent API or contradict wave A's fusion weights,
  retention (30 and 180 days) and non-frozen results.
- **S15:** 'timeoutMs 0 becomes 1 on both paths' (wave A clamps 0 to 500; `DecisionService` never passes a value
  below 1). Main's `requestTimeoutMs()` and `typedCreate()` (replaced by wave A's `timeout()` and inline create
  detection). Wave A's openai ^7.34.0 was not taken.
- **S09:** `decisions-catalog-lint.test.ts` (renamed by wave A's r2 to `decisions-catalogue-lint.test.ts`, 7 cases
  each with an equivalent), plus 16 decisions-log, 11 decisions-calibration, 4 decisions-service-decider and
  4 decisions-triage-v2 cases (renamed APIs or contradictory thresholds).
- **S06:** `memory-eval.test.ts` and its `dataset.ts` corpus (wave A's memory-eval gates replace them), and the
  record, store, Firestore, embeddings and retrieval cases that use an absent API or contradict wave A (importance
  clamping, empty tombstone ids throw, embeddings batch size and error codes, tokenizer surface forms, people scopes).
- **S08:** five sharing-v2 cases whose audit entry or notice shapes contradict wave A, and nine first-run
  audit/policy cases rewritten by wave A's r2.
- **S11L:** first-run `voiceprint-gateway` (7 cases), `voiceprint-net-speech` (6), `voiceprint-no-audio` (1) and
  `voiceprint-store` (13). Main-only `voice.ts` exports `voiceprintConfigFromEnv`, `chainVoiceInvalidators`,
  `echoVoicesFromStudio`, `ensureEchoTemplates` and `registerEchoVoice`.
- **S03:** main's earlier-lineage `cached-prompt-audience-boundary` and `cached-prompt-memory-privacy` wrappers
  (superseded by the r2 `cached-prompt-suite-*` wrappers); `prompt-layout` and `cached-prompt-gateway` cases on
  `attachTurnBlock`, `padCacheBlock` and the earlier block order. The wave A flag-off golden generated at `6d00b80`
  was replaced by a regeneration at `7224f40`.
- **S12:** main's `images-policy` and `images-questions` suites (API absent or contradictory thresholds), and the
  bytes, photo-size, ingest and gateway cases that use main's log strings or null-returning parsers.
- **TAIL:** two follow-up assertions in 'adds the people rule to extraction…' (they contradict wave A's persisted
  people mark, F012/F050), the whole-file equality in 'declares exactly the contract vector index' (wave A adds the
  `vox_audit` composite index), main's `peopleImageTurns` WeakSet and its pre-boundary ingestion. The seven legacy
  `PUT /api/telegram/payments` tests stay removed under wave A's explicit exception (product decision (a)).

No privacy check, authority fence, flag gate, Step 1 change or main feature was dropped. Where two tests asserted
contradictory behaviour of a double-implemented module, the one matching wave A was kept and the other is named in
WAVE_A_MAIN_INTEGRATION.md.

## 4. Verifier findings and how they were closed

Each step merge was checked by a verifier. The table lists every finding and its status on this branch.

| Step | Severity | Finding | Status |
|---|---|---|---|
| S14 | medium | Write-side symlink hardening of the file store's temp file was dropped | Closed: ported with S10L (`O_CREAT\|O_EXCL\|O_NOFOLLOW`, 0600, removed on failure) |
| S14 | medium | `choose()` authorized only once before the evaluation row | Closed: second `authorize()` immediately before `recordExposure`, with main's test |
| S14 | low | Eval-row retention depends only on `sweep()` (no Firestore TTL) | Hardening H1: `startReplyStyleRetentionSweep` (daily, best effort) exists and is tested but is not wired (S14 is unwired); the period is product decision (f) |
| S10L | low | A voice MATCH counts in fusion whatever its net speech | Open: library unwired; check at wiring time (open issue 9) |
| S10L | low | `recordPromptOutcome('confirmed_self')` updates a profile without a consent or epoch re-check | Open: library unwired; add the re-check at wiring time (open issue 9) |
| S10L | low | `extractStyleFeatures` propagates a throwing input getter | **Closed in hardening H4:** returns `zeroStyleFeatures(kind)` |
| S15 | low | Provider-level `input_audio` rejection not asserted directly | **Closed in hardening H3:** section 8 of `openai-compat.test.ts`, zero fetches on every transport |
| S15 | low | README and S15 doc body describe the main-lineage timeout and `typedCreate` | **Closed in hardening H8:** README and the S15 integration block describe `timeout(ms)`, inline create detection and `structuralTimeouts` |
| S09 | medium | Main's removed decisions-log/calibration/service-decider/triage-v2 cases were not in the dropped list | Closed: listed by name in WAVE_A_MAIN_INTEGRATION.md (S09 section) |
| S06 | medium | Embeddings client lost main's `logLevel: 'off'` | Closed: ported with S08, with a test under `OPENAI_LOG=debug` |
| S06 | low | `vectorCandidates` 'reads the process environment when no env is given' fails with both retrieval flags in the ambient environment | Open, test-only: the matrix runs with flags unset (`u.sh` below) |
| S06 | low | The kept `findNearest` gate reads the process environment; `findNearest` checks the 30-key cap before removing duplicates | Open (vector retrieval is not wired; open issue 4) |
| S08 | medium | `instanceof StaleMemoryWriteError` brought into successor inheritance | Closed: structural `isStaleMemoryWriteError`, with a cross-bundle test |
| S08 | medium | Re-snapshot `vox_audit` rows no longer split into 200-id batches | Closed: one row per 200 ids, with a 201-record test |
| S08 | low | The other-persona guard in `policy/snapshot.ts` was dropped with its unnamed main test | **Closed in fixer r1:** `2b66ced` restores it, with a policy-differential case |
| S08 | low | Dropped list named 2 of 9 contradictory first-run tests | Closed: the record names the probe failures and the rewritten suites |
| S08 | low | `memoryNoticesFor` returns `newMemoryId` even when the recipient cannot see the replacement | Open: an opaque id only, `replacementVisible` false; review with the notice copy (product decision (e)) |
| S11L | medium | The production refusal for voiceprints on Firestore is gone | Closed by the S03 merge `18d0415` (`createStudioVoiceprints` takes `production`; `voiceprint-storage` case 'refuses Firestore in production with STUDIO_VOICE_RECOGNITION=1 until Cloud KMS exists…'). Corrected in fixer r1 |
| S11L | low | Verify does not cap the voice-note audio size before upload | **Closed in hardening H5:** no opinion before any read, authority, `track()` or upload above `MAX_VOICEPRINT_AUDIO_BYTES` (reason bucket `provider_error` until `too_large` joins the pinned union; open issue 7) |
| S11L | low | The invalidator moved from `allSettled` to `Promise.all` | **Closed in hardening H5:** `chainVoiceInvalidators` (`allSettled`, then the first rejection), wired in runtime.ts and the test fixture |
| S03 | critical | Main's flag-on `cached-prompt-gateway-suite` and `-tail` wrappers deleted with no replacement | Closed: restored unchanged from main (104/104) |
| S03 | medium | Main's earlier-run S03 cases in add/add files replaced without being named | Closed: named in WAVE_A_MAIN_INTEGRATION.md (S03); passing ones kept in 3 `.main-lineage` files |
| S03 | low | No committed test keeps `962e877`'s turn-context lines out of blocks A/B/C | **Closed (F236):** `prompt-layout-turn-context.test.ts`, listed in the S03 spec by hardening H7 |
| S03 | low | `STUDIO_VOICE_RECOGNITION=1` with a missing `VOICEPRINT_KEY` no longer fails at startup (an invalid key, or one reusing `STUDIO_SECRET`, still does) | Open, missing-key case only (open issue 7, product decision (h)) |
| S12 | medium | Main's 'no image bytes in any log (stage timings false/true)' privacy test dropped although it does not contradict | Closed: both cases kept in `images-gateway.main-lineage.test.ts` with wave A's log string |
| S12 | low | The record overstated wave A's coverage for that case | Closed: corrected in the record |
| TAIL | medium | `STUDIO_VOICE_SHADOW` read from `process.env`, not through `tirehFlags()` | **Closed in this run:** `97bf549` |
| TAIL | low | `TELEGRAM_WEBHOOK_FAIL_CLOSED` read from `process.env` outside `tirehFlags()` | **Closed in this run:** `ebc18d9` |
| TAIL | low | The load-timeout list omits `relationship-turn-fence` | Closed: section 6 lists every suite that failed under load in this run, and `relationship-turn-fence` passes in the core run |

### Commits in this run

- `97bf549` **Read STUDIO_VOICE_SHADOW through tirehFlags().** `TirehFlags.voiceShadow` (doc: "S11L
  STUDIO_VOICE_SHADOW=1: shadow verification of 1:1 voice notes, off the reply path; needs
  STUDIO_VOICE_RECOGNITION"), returned as `on(env.STUDIO_VOICE_SHADOW)`. The gateway's `voiceShadowOn` is gone; the
  shadow block is gated by `tirehFlags().voiceShadow`, read at call time. New `src/lib/tireh/__tests__/flags.test.ts`.
- `ebc18d9` **Read TELEGRAM_WEBHOOK_FAIL_CLOSED through tirehFlags().** `TirehFlags.webhookFailClosed`, read by
  `src/lib/telegram/verify.ts`. Default unchanged (off).
- `d8f0306` and `55a6b31`, test hygiene: unused imports removed from three main-lineage test files, and three
  merged test files typed against `LLMRequest.system: string | SystemBlock[]`. `circles-dm.test.ts`'s decider mocks
  read `systemText(request.system)`. `llm-blocks.main-lineage.test.ts`'s 'array system' case called main's
  `cachedSystem(blocks)`, which wave A types as string-only; it passed only because `Array.indexOf` returned -1 and
  handed the input back. It now asserts `anthropicSystem(blocks)`, the function the request path uses for block
  arrays, with the same expected output.

`flags.ts` changed after the steps merged, as its header allows. The shared-contract pins in `llm-blocks.test.ts` and
`llm-blocks.main-lineage.test.ts` move from `6b8edcd4…6630` to the new hash, and the QA r3 default-off table includes
both new fields. The spec records (S03, S06, S08, S09, S11L, S12) still quote the original hash as the contract each
step was built against; since the hardening run each has a note under its `flags.ts` row with the current hash
(`7adeaa35…806740`, after H3 composed `voiceShadow` with `voiceRecognition`).

**Base-behaviour exception (flags unset): the gateway's `NO_MEMORY`.** Since `b142d00` (widened by fixer r2,
`bd3d1de`) the gateway's flag-independent `NO_MEMORY`, which gates group memory and relationship observation, reads
`memory/requests.ts` `NEGATED_MEMORY_REQUEST` instead of the base `do not|don't` + `remember|save|store` rule. It also
recognises never, dont, no need, rather not, should/must not, won't, keep, up to five words between the negation and
the verb ("I don't want you to remember this"), a comma parenthetical, "forget this/that/it" and the Persian refusals.
It only ever withholds memory (fail closed); the gap never runs through "forget" or "lose", so "don't forget to save
this" is still a request. Recorded here because it changes behaviour with every flag unset.

### QA round 1 on main, fixer round 1

The round 1 QA findings (privacy red team, spec conformance, tests and types, code quality) were applied in severity
order. Each fix has a test that fails without it; every `it.fails` case those findings pinned is now a plain `it`.

- `b142d00` **One negation rule for memory requests (high).** "don't keep this", "never save this", "dont save this"
  and "please don't ever save this" were read as explicit remember requests on an image turn, so extraction ran where
  the person said not to keep it. `src/lib/tireh/memory/requests.ts` holds the one rule (never, keep, dont, no need to,
  up to two words between; Persian with ZWNJ and Arabic yeh/kaf); `gateway.ts` `NO_MEMORY` and `images/retention.ts`
  both read it. CQ1 and the two Persian r3 cases flipped; `memory-requests.test.ts` added.
- `4d17ecf` **Image seam authority and download deadline.** The gateway hands `ingestTelegramImage` the turn authority
  built exactly as text triage's (8a7dc55). It is re-checked after the download, before the acknowledgement and
  triage (a moved authority drops the image, `tireh_image:authority_changed`), and passed to `decideParts`, so the
  guarded transport re-checks it again. Each download carries `AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS = 5 s)`
  (`tireh_image:download_timeout`), and `downloadImage` stops reading and cancels a streamed body once it passes the cap.
- `04bccc5` **Mini App image turns.** With `STUDIO_IMAGES=1`, `converse()` marks both rows of an attached-image turn as a
  Telegram image turn with unknown triage (suppressed, people rule on; it fails closed, an explicit remember request
  included, because this path has no image triage) and keeps `IMAGE_WITHHELD_REPLY_TEXT` in history. The reply still
  reaches the caller. Flag unset: main's behaviour.
- `02d468e` **JPEG metadata between scans.** `stripImageMetadata` walks every scan of a progressive JPEG and drops APPn
  and COM wherever they sit; anything after EOI is dropped.
- `2b66ced` **Policy oracle other-persona guard** restored (above).
- `19f8586` **Supersede-notice erasure and the audit sweep (F013).** A deleted memory erases every notice naming it
  (decorator delete path, whatever the flags are now); a rights-intake erasure erases every notice naming the person.
  `withAuditRetention` runs the 12-month `vox_audit` sweep on the first append and then at most daily.
  `FirestoreSupersededNoticeStore.listFor` is ordered and bounded, with a new composite index.
- `0fd2d43` Test typing of the image fixture decider.

Not changed, with the reason: the test-file typecheck (open issue 2); a notice TTL (product decision (f)); per-person
erasure of `vox_audit` rows (append-only by design, retention only).

### QA round 2 on main, fixer round 2

The round 2 findings (12: two high from the privacy red team and one from code quality, nine medium) were applied in
severity order. Each fix has a test that fails without it (the pinned `it.fails` cases are plain `it` now, or a
mutation of the fix turns the new test red).

- `bd3d1de` **Refusals and questions in memory requests (high, PR2-1 / CQ2-1; medium, CQ2-2, SC2-1).**
  `NEGATED_MEMORY_REQUEST` now reads modal and desire negations ("I don't want you to remember this", "you shouldn't
  keep this"), up to five words between, a comma parenthetical ("do NOT, under any circumstances, keep this"), the
  Persian "لازم نیست …" and "نمی‌خوام …" refusals, "فراموشش کن" and "ذخیره‌ش نکن"; "فراموش نکن" (do not forget) stays
  a non-negation. The gap never runs through "forget" or "lose", so "don't forget to save this" is a request again
  (SC2-1). `MEMORY_REQUEST` needs the English verb in imperative position (start, clause mark, "please", "can you",
  "don't forget to", …), so "do you remember this?", "I can't remember this place" and "keep it down" are not image
  remember requests. The base-behaviour exception is recorded in section 3.
- `ed05751` **Telegram images need `single_party_image` (high, PR2-3).** `GatewayDeps.imageAllowed` (and
  `imageAllowedNow` for the indexed fence) is checked before the first download, inside the image authority (after the
  download, before triage, at the guarded transport) and before the reply export. A gateway with a privacy adapter and
  no `imageAllowed` gets no image. Studio wires it to the adaptive `single_party_image` capability (as
  `conversation.ts` does for Mini App images) and denies without an adaptive service or on a read failure. Tests:
  the pinned case, a positive control, a withdrawal during the download, and a seam test. Test harnesses that give a
  gateway a permissive privacy adapter (`images-gateway`, `redteam-wave-a-main-r1`) and `circles-dm`'s member-photo
  case now grant the capability, so only the gate each test is about can refuse the image; no assertion was removed.
- `cb51710` **Main's people rule (medium, PR2-2).** `imageShowsPeople()`: unknown triage, kind `photo_of_people` or
  `contains_people >= IMAGE_PEOPLE_THRESHOLD (0.3)`.
- `c5e7b89` **Successor filter and inheritance errors (medium, open issue 6 / F-r3, CQ2-5).**
  `isSuccessorTransferable(memory, now)` refuses invalidated and expired records. A missing tombstone seam, a failed
  carry or a failed copy never fails the hire; `memory.inherit` admin audit rows say what happened (main's lineage).
- `53b9361` **Erasure after a flag rollback (medium, PR2-4, SC2-2, CQ2-6).** `wireSharingAudit()` keeps writes behind
  the flags and adds, whatever the flags: an erasure-only notice handle (`Studio.forgetMemoryNotices` falls back to
  it), a delete-only `noticeErasingMemoryStore` when notices are stored, and `startAuditRetentionSweep` (now and daily,
  unref'd). Neither creates a file or collection, so "with both flags unset installs nothing" still holds. Runtime test:
  record with the flags on, restart with them unset, delete a memory, file a rights erasure, see the sweep.
- `43b9325` **Privacy gates in CI (medium, SC2-3).** A `privacy-gates` job runs the privacy core and red-team suites
  with flags unset and invariants, policy-differential, the wave A red-team suites and `sharing-v2` under
  `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1`; build and the PR summary wait on it. Making it a required check is the
  owner's branch-protection setting (open issue 13).

Contradictory tests: none. Every changed test asserts the chosen behaviour; no test was dropped.

### QA round 3 on main, fixer round 3

QA round 3 (`0421ae2`, `60a6632`, `681ef76`, `b39b4b6`) reported nine medium findings and no critical or high. All
nine were applied in order; every code fix has a test that fails without it (the pinned `it.fails` cases are plain
`it` now, and each new test was run against the code with its fix reverted).

- `b39b4b6` **Firestore `hasAny` and the db branch of `wireSharingAudit` (tests-types).** Applied by QA itself; no
  further change. `qa-tests-types-r3-main.test.ts` passes in the full run.
- `da20dc3` **Image `remember` below 0.6 is `unclear` (privacy red team).** `readImageTriage` applies
  `IMAGE_REMEMBER_CONFIDENCE = 0.6` (main's rule) to `remember` and keeps 0.5 for the other tasks.
- `07e635e` **The reply export of a Telegram image is fenced at the transport (privacy red team).** While images ride
  on the reply request, the person's `single_party_image` capability is part of `request.authorize` and (compact
  turns) `request.authorizeNow`; `composeReply` drops the images when the capability is gone at its pre-export check
  (the caption is still answered, as when it is withdrawn earlier) and the transport fails the export when it goes
  after that. `ingestTelegramImage` re-reads the turn's authority before the reply-tier download.
  `images-authority`'s "authority withdrawn after the post-download check" case now expects the image to be dropped
  (`null`, one download) instead of a turn with triage `null`: stricter, same subject.
- `556572a` **Circles notes and image-derived bot replies (privacy red team).** While `STUDIO_IMAGES` is on, "remember
  this" that would save the text of this agent's own bot message proposes nothing and asks the person to type what to
  keep (new notes copy `typeIt`, en and fa). Nothing records which bot messages came from an image, so every own-bot
  reply is refused while the flag is on. Typed text, replies to other messages and every case with the flag unset are
  unchanged (guards pin both).
- `ee5e7e6` **The privacy-gates job runs section 4.6's whole gate (spec conformance).** 32 files flags unset
  (negative-identity, the boundary suites, memory replacement, the combined runtime and their cached-prompt wrappers
  added), a new step under `TIREH_RETRIEVAL_V2=1`, and the S08 record lists the exact file set.
- `f1ae457` **The flags-unset `NO_MEMORY` change is recorded (spec conformance).** S12 spec: Files row for
  `memory/requests.ts`, corrected `IMAGE_NO_MEMORY` row and base-behaviour line, a Deviations entry. Section 9 lists it
  as exception (i) awaiting acknowledgement. Code unchanged (fail closed).
- `e02e171` **`FirestoreVoiceprintStore.touch()` cannot restore a deleted template (code quality).** A field update of
  `lastConfirmedAt` that never creates the document (NOT_FOUND is a no-op). `verifyVoiceNote` is registered with
  `track()`, so `invalidate()` aborts an in-flight verification (no match, no touch).
- `7b5ef94` **Notice erasure covers the forget closure (code quality).** `MemoryStore.delete` resolves to the ids it
  removed; `auditMemoryStore` and `noticeErasingMemoryStore` erase the notices naming any of them.
- `11a4e25` **Decision-log retention after a rollback (code quality).** `wireDecisionLog` (runtime.ts) wires the sink
  only with `TIREH_DECISION_LOG` and runs `startDecisionLogRetentionSweep` at startup and daily whatever the flag is;
  neither store's sweep creates the file or collection.

Contradictory tests: none. No test was dropped; the one changed assertion (`images-authority`) is stricter.

## 5. Catch-up with main

`git fetch https://github.com/mohammadreza87/vox.git main` succeeded on 25 Oct 2026. `FETCH_HEAD` is
`7224f40d69cf816a49139a30092cbf92551d2a8e`, the base of this branch, so there was nothing to merge. This branch is
caught up to `7224f40`.

## 6. Results for this tree

All runs are in `$TMPDIR/vox-wave-a-main` with a real `node_modules` (`npm ci`, openai 7.39.0), at the hardening
merge (`2fddf34`, the tree this record describes). "Flags unset" means the 13 variables of section 8 removed with
`env -u`. The earlier per-round results (before fixer round 1 to after fixer round 3) are in this file's history; the
last of them is the comparison column of the flag matrix below.

- **`npx tsc --noEmit -p tsconfig.json`:** exit 0. **`npx tsc --noEmit -p tsconfig.test.json`** (`npm run
  typecheck:tests`, H9's gate over the changed and `hardening-*` test files): exit 0.
- **ESLint** on the 120 `.ts`, `.tsx`, `.js` and `.mjs` files added or modified since `718752e`: exit 0.
- **`npm run check:studio-style`:** pass. **`node --test scripts/legacy-offline-inventory.test.mjs`:** 17/17.
  **`node -e "require('./firebase.json')"`:** loads. **`npm pkg get engines`:** `{ "node": "22" }`.
- **`grep -rn 'it\.fails(' src`:** prints nothing. The QA known-gap cases are all plain `it` now; there are no
  expected failures left.
- **Direct flag reads:** the H3 grep (`process.env.TIREH_*`, `STUDIO_IMAGES`, `STUDIO_DECIDER`, `TRIAGE_QUESTION_SET`,
  `STUDIO_VOICE_*`, `TELEGRAM_WEBHOOK_FAIL_CLOSED` and the `env.` forms) finds only `src/lib/tireh/flags.ts` outside
  tests. `src/lib/adaptive/voice-identity/` differs from `718752e` only in `runtime-config.ts`'s flag read.
- **Full `npx vitest run`, flags unset:** 14 failed files, 96 failed tests, 8186 passed, 0 expected failures,
  14 skipped, 56 unhandled errors (listen EPERM). All 96 are environmental:
  - mkdtemp `/tmp` EPERM: `adaptive/guest-rights/guest-rights` (20), `studio/guest-rights-http` (10),
    `adaptive/rights-intake/storage` (2), `connections/mcp/__tests__/tls` (1);
  - listen 127.0.0.1 EPERM: `connections/mcp/__tests__/self-service` (37), `foundation-broker-error-http` (10),
    `foundation-broker` (1), `integration-broker` (1), `adaptive/runtime/reminders/reminders` (2, the tsx IPC pipe);
  - unix-socket listen: `adaptive/voice-identity/local-provider` (7); tsx child IPC:
    `adaptive/personalization/learning/rollback` (1);
  - timeouts and timing under full-suite load, each passing when rerun alone: `adaptive/message-memory/message-memory`
    (1), `adaptive/observation/service` (1) and `studio/__tests__/prepared-conversation-qualification` (1) (69/69
    together), and `reminders` 'serializes duplicate workers across independent file adapters' (1; passes alone;
    `reminders` is unchanged since `7224f40`).
- **CI `privacy-gates` steps, run locally:** 632/632 flags unset (32 files; 613 at fixer r3, the new cases are H4's
  memory-request forms), 296/296 under `TIREH_RETRIEVAL_V2=1`, 118/118 under the S08 flags.

### Flag matrix

Every other flag unset (the `env -u` wrapper above). The machine was otherwise idle for these runs (load average
about 5), so the load-timeout set is smaller than in the cluster runs.

| Command (every other flag unset) | Hardening merge (this tree) | After fixer r3 (`718752e`) |
|---|---|---|
| `TIREH_CACHED_PROMPT=1 npx vitest run src/lib/tireh` | 2389/2389 (H7 ported the string-`system` fakes) | 10 failed / 2112 passed, 2 expected failures (S03's 10) |
| `TIREH_CACHED_PROMPT=1 npx vitest run src/lib/studio` | 11 failed / 1647 passed: `guest-rights-http` 10 (mkdtemp EPERM), `prepared-conversation-qualification` 1 (load timeout, 9/9 alone) | not recorded |
| `TIREH_RETRIEVAL_V2=1` memory-privacy, visibility, memory-eval | 41/41 | 41/41 |
| `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` invariants, policy-differential, `src/lib/studio` | 11 failed / 1671 passed: `guest-rights-http` 10 (EPERM), `prepared-conversation-qualification` 1 (load timeout, 9/9 alone under the same flags) | 11 failed / 1603 passed (same two files) |
| `TIREH_SHARING_V2=1` `src/lib/adaptive/__tests__/shared-memory.test.ts` | 29/29 (H6 pins the two base consent cases to the flag unset; decision (k)) | 2 failed by design |
| `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1` `src/lib/tireh src/lib/adaptive/decisions` | 2503/2503 | 2234 passed, 2 expected failures |
| `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1` `src/lib/studio` | 11 failed / 1647 passed: the same two environmental files (`skill-routing`, `runtime-scoped-relationships` and `runtime.test` no longer fail) | not recorded (do-not-run note) |
| `TRIAGE_QUESTION_SET=v2` `src/lib/studio` | 11 failed / 1647 passed: the same two environmental files | not recorded (do-not-run note) |
| `STUDIO_IMAGES=1` `src/lib/tireh`, `circles-dm`, `circles-channels` | 2458/2458 | 2191 passed, 2 expected failures |
| `STUDIO_VOICE_RECOGNITION=1` `src/lib/studio/__tests__/voiceprint*` | 108/108; the H5 and H6 `hardening-voiceprint-*` and `hardening-pyannote-upload-cache` files under the same flag: 34/34 | 108/108 |
| `STUDIO_VOICE_RECOGNITION=1 STUDIO_VOICE_SHADOW=1` voiceprint-liveturn, gateway | 54/54 | 54/54 |
| `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` `src/app/api/telegram src/lib/telegram` | 32/32 | 22/22 |
| Informational: every flag on (`TIREH_CACHED_PROMPT`, `TIREH_PROMPT_SYSTEM_TAIL`, `TIREH_RETRIEVAL_V2`, `TIREH_SHARING_V2`, `TIREH_AUDIT_LOG`, `STUDIO_DECIDER=service`, `TRIAGE_QUESTION_SET=v2`, `TIREH_DECISION_LOG`, `STUDIO_IMAGES`, `STUDIO_VOICE_RECOGNITION`), `src/lib/tireh` | 2389/2389 | 9 failed / 2113 passed |

Every row is at its recorded result or better. Passes are higher because the clusters added 38 `hardening-*` test
files and extended existing suites.

## 7. Open issues

1. **Commit trailer (product decision (o)).** The computed tasks ask for `Co-Authored-By: Claude Fable 5.1`; the
   session attribution rule says `Claude Opus 5.5`. The step merges, fixer r1 and r2, and the hardening clusters H1,
   H2, H3, H5 and H8 carry Fable 5.1; the first integration run, QA r3, fixer r3, the hardening clusters H4, H6, H7
   and H9, and the hardening merge commits carry Opus 5.5 (the session rule). Pick one before the branch is pushed; do
   not rewrite merged history.
2. **Test files are type-checked only where wave A changed them.** Hardening H9 added `tsconfig.test.json` (every test
   file added or modified since `7224f40` plus `src/**/hardening-*.test.ts(x)`), `npm run typecheck:tests` (H8) and a
   'Typecheck changed tests' step in CI's test job. Main's own untouched tests still carry their pre-existing strict
   errors (H9 measured 671 in 130 files outside the list) and stay out of the gate. `circles-group.test.ts` and
   `learning/races.test.ts` have test-only changes but are left out of the list because they carry 12 and 2 of main's
   errors. The gate passes without `next-env.d.ts` (gitignored, absent in CI); in a checkout where `next dev` created
   it, Next's global types make `NODE_ENV` a required `ProcessEnv` key and five listed files report 43 errors
   (`flags.test.ts`, `memory-v2-retrieval.test.ts`, `qa-spec-conformance-r3.test.ts`, `voiceprint-storage.test.ts`,
   `decisions-runtime.test.ts`); they should pass plain string records.
3. **S03.** Cache hit rates are not measured, and no reply model was checked against a mid-conversation system
   message (staging). Recorded deviations, owner "S03 follow-up before the staging gate" (H7): no `count_tokens`
   check per reply model; block B keyed by content hash, not studio revision; no audience-only block B above about
   30 people (needs the gateway); `layout.hashes` and `onMeta` not consumed for the 70% cache-read and hash-churn
   alerts or pre-warm. The 10 expected `TIREH_CACHED_PROMPT=1` failures are gone (H7 ported the string-`system`
   fakes); `cached-prompt-ports.test.ts` and `cached-prompt-studio-ports.test.ts` now duplicate originals that pass
   under the flag and can be retired later. `retrieval.ts` `LONG_MEMORY_CHARS` and `prompt.ts`
   `MAX_PROMPT_MEMORY_CHARS` (both 210) are still two definitions (F088).
4. **S06.** Recall@3 0.980 against 0.987 for v1 (RRF compresses lexical strength; unchanged by H4's shared fold, which
   also maps U+06C0 and U+06D5 to heh); embeddings, query embedding and `vectorCandidates` are not wired
   (`vectorRetrieval` is documented as library only); a missing vector index returns no candidates silently;
   `findNearest` reads the process environment and caps before de-duplicating; `FirestoreMemoryStore.updateIfShareVersion`
   turns Timestamps into maps (both sides). `TIREH_RETRIEVAL_V2` also changes `proactiveContext` and the extraction
   "known" list (F031, documented in S06). `ActiveMemoryCache` churn (F092) is a performance item.
5. **S09 and S15.** Provider timeouts on the Studio triage path are classified structurally (`structuralTimeouts`,
   H3); `DecisionService` itself, and so main's flags-unset `STUDIO_DECISIONS_ENABLED` path, still reports them as
   `provider_error` by design. Running `src/lib/studio` under `TRIAGE_QUESTION_SET=v2` is no longer blocked (F051,
   F052; row in section 6). Whether `/v1/decisions` accepts `safety_identifier` is unverified: it is sent only after
   an operator sets `DECISIONS_SAFETY_ID_SALT`, and the gateway now names the subject (section 10), so confirm against
   the Decisions OpenAPI spec before setting the salt. S15's 7-day age rule picked openai 7.34.0; this branch keeps
   main's 7.39.0, which main already deploys.
6. **S08.** Enable `TIREH_SHARING_V2` soon: the base successor copy includes private and sensitive records. Review
   `newMemoryId` in notices for an invisible replacement (product decision (e)). The Telegram `/memories` notice line
   and the reserved audit kinds (`retrieval`, `prompt_memory`, `consent_change`, `identity_change`) stay out of scope,
   with reasons in the S08 spec (F247). Notices have no TTL and `vox_audit` rows keep person ids for 12 months after a
   rights erasure (product decision (f)). A group with no `historyPolicy` still allows the admin re-snapshot (product
   decision (j)); TIREH_SHARING_V2 drops the per-recipient personalization consent for group context too (product
   decision (k)). The re-snapshot preview returns `byAgent` and `memoryIds` only with `{ detail: true }` because
   `sharing-v2.test.ts` and `invariants.test.ts` pin the preview body with `toEqual`; make it the default once those
   assertions use `toMatchObject` (TODO in `service.ts`). There is no Mini App control for `historyPolicy`. Before
   either S08 flag runs on Firestore, deploy the indexes (section 8).
7. **S11L.** The startup refusal for Firestore voiceprints in production with the flag on is in place, and an invalid
   key or one reusing `STUDIO_SECRET` still fails startup. The one difference from main: a missing `VOICEPRINT_KEY`
   while the flag is on leaves voiceprints off (product decision (h)). KMS envelope encryption and key custody are
   release gates. Verify caps the audio size (H5), but reports the generic `provider_error` reason: adding `too_large`
   to `VoiceNoOpinionReason` needs `voice-band.ts`, whose sha256 is pinned (follow-up: move the pin, update
   `fusion.main-lineage.test.ts` REASONS, switch `VERIFY_TOO_LARGE_REASON`). The sweep runs at boot and daily per
   process with no cross-instance lease (F087). `setVoiceIdentityInvalidator` is a single slot (the chain is composed
   in runtime.ts). The pyannoteAI adapter is untested against a live account, and its 48 h media purge exceeds the
   1-hour enrollment raw-sample target in PRIVACY_AND_CONSENT.md section 7 (F022, privacy owner). EnrollScreen FA
   strings need native review. Consolidating main's local voice-identity store with voiceprints (F043) is an
   architecture change left out; the two engines stay mutually exclusive.
8. **S12.** The default decider has no `decideParts`, so with only `STUDIO_IMAGES=1` image triage is null (full
   routing needs `STUDIO_DECIDER=service`, and the runtime logs `[vox] images_without_image_triage` once). Sending the
   image to the decider before any verdict is product decision (g). A paused memory or history setting still lets an
   image be triaged and answered; p95 latency needs a real Telegram check; an `extract_text` reply can put document
   text into the person's own private history (privacy owner review). Image documents larger than 512 px still fail
   closed for triage (F062: needs a re-encoding seam). A Mini App image turn has no image triage, so with the flag on
   it is always suppressed and its reply withheld from history. A Telegram image needs the person's
   `single_party_image` capability, so where no approval for it exists `STUDIO_IMAGES=1` answers captions only. Memory
   requests are regex rules over raw and folded text: they lean towards refusal. With Circles on and
   `STUDIO_IMAGES=1`, "remember this" on any of the agent's own messages asks the person to type what to keep (no
   content-free mark records which bot messages came from an image). Inherited image marks have no hop limit
   (product decision (l)). With the flag on, every progressive JPEG goes through the new multi-scan validator (Mini
   App upload, Decisions boundary and Telegram triage); oversize fixture errors without a `code` now log
   `download_failed`.
9. **S10L and S14.** Not wired; they wait on the DPIA. QA F025: S10L persists a per-person style profile against
   section 4.9 phase 0 (product decision (d)). At wiring time: honour net speech for a voice MATCH, re-check consent and
   epoch in `recordPromptOutcome('confirmed_self')`, add the S10L `FirestoreStyleProfileStore` list/sweep paging
   (F087/F133), and wire `startReplyStyleRetentionSweep` for `vox_reply_style_eval` (product decision (f)).
10. **Legacy Telegram webhook.** `TELEGRAM_WEBHOOK_SECRET` is set nowhere in the repo. Until it is set, registered as
    the setWebhook `secret_token` and `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` is on, the webhook is unverified (product
    decision (b)). Invoices are not bound to a server-side intent (product decision (c)). Every Bot API call from the
    webhook now has an 8 s deadline (H2).
11. **Housekeeping.** `git worktree prune` cannot remove 8 stale `.git/worktrees` entries inside the sandbox (EPERM);
    run it outside the sandbox. The cluster branches `aiq/harden/H1` to `H9` and the scratch branch
    `aiq/harden/H8-base` (H8's rebase base, the same tree as the merged clusters) can be deleted once this record is
    accepted.
12. **Privacy gates as a required check.** The `privacy-gates` CI job runs section 4.6's gate; making it a required
    status check on `main` and `develop` is a branch-protection setting for the repository owner. Gate cases that live
    in other suites (successor, voice replay, shared phone) run only in the general `test` job.
13. **Firestore deploy.** `firebase.json` now references `firestore.indexes.json`, so a plain `firebase deploy` also
    deploys the indexes and asks before deleting indexes or field overrides that are not in the file (for example the
    relationship worker's `expiresAt` TTL overrides); `--force` deletes them without asking. The GitHub deploy action
    deploys hosting only (section 8).

Closed since the last record: the circles-group random collision (H9: `idTrace` with a hex-bounded id), the
`races.test.ts` dereference before its length check (H9), the CQ2-3 audit sweep signal and F030 triage timeout naming
(no `it.fails` case is left in `src`), `image-v1` decision-log rows (H2), progressive JPEG triage behind
`STUDIO_IMAGES` (H2), the direct `STUDIO_VOICE_RECOGNITION` reads in `runtime.ts` and `runtime-config.ts` (H3), the
voiceprint verify cap, `allSettled` invalidator and daily sweep (H5), the S03 flag-on failures (H7), the
`engines` field and the `firebase.json` index reference (H8).

## 8. Deployment prerequisites

- **Install:** `npm ci` (lock pins openai 7.39.0). The main checkout's `node_modules` may be stale.
- **Node 22:** `package.json` has `"engines": { "node": "22" }` (H8). firebase-tools 15.34.0, the version
  `deploy.yml` pins, copies `engines.node` into the generated SSR function as `nodejs22`; `">=22"` is rejected by
  that CLI, so do not widen it. npm on a Node 24 machine only warns (no `engine-strict`).
- **Firestore indexes:** `firestore.indexes.json` (referenced by `firebase.json` since H8) holds the
  `tireh_memories` vector index (S06), `vox_audit` (`personaId` ASC, `at` DESC) and (`personaId` ASC, `memoryIds`
  CONTAINS, `at` DESC, H1), `tireh_supersede_notices` (`personaId` ASC, `recipientPersonId` ASC, `at` DESC) and
  `vox_reply_style_eval` (`context.personaId` ASC, `at` ASC, H1; S14 is unwired). The GitHub deploy action deploys
  hosting only: run `firebase deploy --only firestore:indexes` before `TIREH_SHARING_V2` or `TIREH_AUDIT_LOG` runs on
  Firestore (see open issue 13 for what a plain `firebase deploy` now does).
- **Typecheck:** `npm run typecheck:tests` (`tsconfig.test.json`) besides `npx tsc --noEmit -p tsconfig.json`.
- **Environment per flag** (all default off; read only through `tirehFlags()` in `src/lib/tireh/flags.ts`, sha256
  `7adeaa35…806740` after H3):

| Env | Step | Also needs |
|---|---|---|
| `TIREH_CACHED_PROMPT=1` | S03 | — |
| `TIREH_PROMPT_SYSTEM_TAIL=1` | S03 | `TIREH_CACHED_PROMPT=1`; a reply model that accepts a mid-conversation system message |
| `TIREH_RETRIEVAL_V2=1` | S06 | — |
| `TIREH_VECTOR_RETRIEVAL=1` | S06 | `TIREH_RETRIEVAL_V2=1`, Firestore, the deployed vector index (library only, no runtime effect yet) |
| `TIREH_SHARING_V2=1` | S08 | Firestore: the deployed `tireh_supersede_notices` and `vox_audit` indexes |
| `TIREH_AUDIT_LOG=1` | S08 | Firestore: the deployed `vox_audit` indexes |
| `STUDIO_DECIDER=service` | S09 | `OPENAI_API_KEY` (Decisions API); see the readiness variables below |
| `TRIAGE_QUESTION_SET=v2\|v2-live` | S09 | best with `STUDIO_DECIDER=service`; measure refusal and malformed rates first |
| `TIREH_DECISION_LOG=1` | S09 | — (90-day retention; `image-v1` rows with `STUDIO_IMAGES=1`) |
| `STUDIO_IMAGES=1` | S12 | `STUDIO_DECIDER=service` for triage; a vision-capable reply model; the `single_party_image` capability approval; ZDR readiness (product decision (g)) |
| `STUDIO_VOICE_RECOGNITION=1` | S11L | `VOICEPRINT_KEY` (dedicated 256-bit key), `PYANNOTE_API_KEY` (optional `PYANNOTE_BASE_URL`), approval and consent; mutually exclusive with the local voice engine |
| `STUDIO_VOICE_SHADOW=1` | S11L | `STUDIO_VOICE_RECOGNITION=1` (composed in `flags.ts`: off whenever recognition is off) |
| `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` | legacy | `TELEGRAM_WEBHOOK_SECRET` set in every legacy deployment and registered as `secret_token` |

- **Decisions readiness variables** (H3; deployment attestations and a secret, not flags; read from the env argument
  in `src/lib/tireh/decisions/readiness.ts`). With `STUDIO_DECIDER=service` the runtime logs
  `[vox] decisions_readiness:<code>` at startup for each one that is missing:

| Env | Code when missing | Meaning |
|---|---|---|
| `DECISIONS_ZDR_APPROVED=1` | `zdr_unconfirmed` | Zero data retention approved for the Decisions account |
| `DECISIONS_EU_ENDPOINT_CONFIRMED=1` | `eu_endpoint_unconfirmed` | EU residency endpoint confirmed |
| `DECISIONS_SAFETY_ID_SALT` | `safety_identifier_salt_missing` (`_invalid` when shorter than 32 characters or equal to `STUDIO_SECRET`) | Secret salt for the hashed `safety_identifier`; nothing is sent without a valid salt |

- **New admin route** (behind `TIREH_SHARING_V2`): `POST groups/:chatId/history-policy { policy }` with
  `since_membership` or `all_authorized_history` (H6, audited `group.history_policy`).

S10L and S14 have no flag and are not wired.

## 9. Product decisions

None is implemented here; each is the product lead's call. (a) to (i) were recorded before the hardening run; (j)
to (o) come from it. Recommendations are the hardening contract's.

- **(a)** Legacy Telegram payments: `PUT /api/telegram/payments` deleted and `POST` requiring a Firebase ID token, a
  base-behaviour exception kept pending sign-off. H3's own-property price-id check is independent of it.
  Recommendation: sign off (PUT was an unauthenticated entitlement writer).
- **(b)** `TELEGRAM_WEBHOOK_FAIL_CLOSED` default stays off until `TELEGRAM_WEBHOOK_SECRET` is rolled out; owner to be
  named. Recommendation: name an owner, roll out the secret with the flag on, retire the legacy webhook in step 15.
- **(c)** Binding Telegram invoices to a server-side intent. Recommendation: keep the price, amount and currency
  checks until (b) lands, then bind if the route is not retired.
- **(d)** The S10L persisted style profile against section 4.9 phase 0 (F025). Recommendation: keep it unwired and
  change it to 7-day observed facts before step 10 wiring, unless the DPIA is amended.
- **(e)** Supersede-notice copy, and `newMemoryId` when the recipient cannot see the replacement (an existence
  oracle). Recommendation: withhold it unless the replacement is visible, approve the EN and FA copy, then add the
  `/memories` line.
- **(f)** Retention periods the plan does not fix: notice TTL; `vox_audit` person ids after a rights erasure;
  decision-log rows pairing `personaId` and an exact time with the sensitivity probabilities; S14 eval rows (H1's
  unwired sweep helper); S10L 30/180 days; S12 images. Recommendation: notices 90 days; decision-log `at` rounded to
  the hour; redact `vox_audit` person ids on rights erasure; eval rows 30 days through the scheduled sweep at wiring.
- **(g)** Sending a possibly sensitive document image to the decider before any verdict. Recommendation: make ZDR
  approval (readiness code `zdr_unconfirmed`) a release gate for `STUDIO_IMAGES`; until then run images without
  decider triage (fail closed).
- **(h)** A missing `VOICEPRINT_KEY` or invalid thresholds with `STUDIO_VOICE_RECOGNITION=1`: this branch leaves
  voiceprints off or warns, main failed startup. Recommendation: restore main's fail-fast for both when the flag is on.
- **(i)** Base-behaviour exception: with every flag unset the gateway's group memory and relationship observation
  call `memory/requests.ts` `negatedMemoryRequest`, a strict superset of main's rule that only withholds memory. Since
  hardening H4 it also matches the text after the shared Persian fold (tatweel, U+0649, presentation forms, harakat,
  Arabic yeh/kaf), and since H2 the gateway calls the function instead of the raw regex. Recommendation: acknowledge it.
- **(j)** Default `historyPolicy` for groups without one (re-snapshot). H6 honours explicit values; absent keeps
  today's behaviour (allowed), while the S08 oracle treats absent as `since_membership`. Recommendation: absent means
  `since_membership` (fail closed); admins opt in with the new setter.
- **(k)** Shared-context consent for group audiences under `TIREH_SHARING_V2` (two base `shared-memory.test.ts` cases
  are pinned to the flag unset; `hardening-shared-memory-v2.test.ts` pins the v2 behaviour). Recommendation: decouple
  consent only for a single private reader; keep every recipient's consent for group context.
- **(l)** Lifetime of inherited S12 image marks (after one image every later assistant row in the chat stays
  suppressed with the people rule on). Recommendation: a hop counter (for example `EXTRACTION_WINDOW / 2`).
- **(m)** Whose grant allows successor transfer: the predecessor's `memoryPolicy` 'transfer' only, or also
  `mayUseAgent` for every authorized person on the successor. Recommendation: add the per-person check (only narrows).
- **(n)** Shadow voiceprint verification (`STUDIO_VOICE_SHADOW`) uploads biometric audio and discards the result
  until S10 consumes it. Recommendation: keep it off; remove it if S10 is not scheduled within wave B.
- **(o)** Commit trailer for the branch (open issue 1). Recommendation: pick one before the branch is pushed; do not
  rewrite merged history.

## 10. Hardening (2026-10-25)

The medium and low QA findings still open after fixer round 3 (QA history: F001 to F139 from the develop-based
rounds, F140 onwards from the rounds on main, plus the per-step verifier findings) were split into nine clusters by a
hardening contract with disjoint file ownership. Each cluster was built on `718752e` and merged onto this branch with
`git merge --no-ff` in the contract's order (H1, H3, H4, H6, H5, H7, H2, H9, H8). Every merge was automatic: no file
conflicted, no hunk was resolved by hand, and no test case was dropped (`flags.test.ts`'s two voiceShadow cases were
rewritten for the composed flag, not removed). The merged tree equals H8's rebase base `aiq/harden/H8-base`
(`347b04e`), which merged the same heads in another order. No cluster added a flag field: H3 composes `voiceShadow`
with `voiceRecognition` (a behaviour change of an existing field; `flags.ts` sha256 `7adeaa35…806740`, pins moved in
`llm-blocks*.test.ts`), and the Decisions readiness variables are attestations read outside `tirehFlags()`
(section 8).

| Cluster | Branch head | Merge commit | Scope |
|---|---|---|---|
| H1 retention and stores | `aiq/harden/H1` `2732d29` (5 commits) | `714fa55` | audit and notice writes, sweeps, Firestore list queries, S14 eval queries |
| H3 flags, decisions, triage | `aiq/harden/H3` `a3cf7d3` (9) | `aa7e9cc` | `flags.ts`, flag reads, timeouts, safety identifier, readiness, catalogue, v2-live, payments price id |
| H4 Persian text | `aiq/harden/H4` `4334abb` (7) | `cde98c5` | shared fold, stemmer, script label, EnrollScreen timer |
| H6 sharing and `service.ts` | `aiq/harden/H6` `e98b194` (4) | `1c6d6a1` | `historyPolicy`, preview, notices, demotion invalidation, shared-memory pins |
| H5 voiceprints | `aiq/harden/H5` `0c5b88e` (4) | `7fd5b45` | verify cap, invalidator chain, daily sweep, upload cache |
| H7 prompt | `aiq/harden/H7` `09798ec` (4) | `d573761` | shared section renderers, grapheme clip, flag-on test fakes |
| H2 images and gateway image region | `aiq/harden/H2` `1290f4e` (12) | `c7cf6b9` | Persian texts, downloads, triage kind, `image-v1` rows, mark union, JFIF, progressive JPEG, webhook deadline |
| H9 test typecheck and hygiene | `aiq/harden/H9` `01fe58d` (4) | `2faec6f` | `tsconfig.test.json`, CI step, strict test types, deterministic main tests |
| H8 packaging and documentation | `aiq/harden/H8` `36921fe` (9 own commits on `H8-base`) | `c850fa1` | `engines`, `firebase.json`, `typecheck:tests`, PRIVACY_AND_CONSENT, VOX_STUDIO, specs, README |

### Findings fixed, per cluster

- **H1:** F046, F085, F137 (audit and notice writes race a 2 s `AUDIT_WRITE_TIMEOUT_MS`; failures and timeouts log
  only `[vox] audit_append_failed`, `audit_append_timeout`, `notice_record_failed` or `notice_erasure_failed`);
  F173, F215 (the `vox_audit` sweep reports `sweep_failed` through `onError`); F174 (the `delete` row lists the whole
  forget closure, in rows of 200 ids); F049, F090, F175, F256 (`FirestoreAuditStore.list` filters `since` and
  `memoryId` in the query before the limit; new composite index); F208 (with `TIREH_SHARING_V2` alone the 12-month
  sweep also runs at startup and daily); F185 (runtime retention test); F136 (`listEval` queries persona and window
  together; new index); VF-S14-low-eval-retention (`startReplyStyleRetentionSweep`, not wired); CQ2-3 (the last
  `it.fails` in qa-code-quality-r2 is a plain `it`).
- **H3:** F207, F260 (`voiceShadow = voiceRecognition && STUDIO_VOICE_SHADOW`); F045, F089, F124, F117, F159, F245
  (`runtime.ts` and `adaptive/voice-identity/runtime-config.ts` read `tirehFlags().voiceRecognition`; the grep for
  direct flag reads finds only `flags.ts`); F242 and F096, F138 (the `flags.ts` header and the `vectorRetrieval` doc);
  F030, F001, F075, F095, F114, F134, F187 (`structuralTimeouts(provider)` for the triage provider: structural
  classification, no `instanceof`, `committedExportFence` forwarded; `DecisionService` unchanged); F009 and
  VF-S15-low-input-audio (`openai-compat` abort shape and a provider-boundary `input_audio` row); F177 (the runtime
  `ServiceDecider` caps requests at `TRIAGE_TIMEOUT_MS`); F070, F121 (hashed `safety_identifier`, only with
  `DECISIONS_SAFETY_ID_SALT`); readiness codes (`tireh/decisions/readiness.ts`); F130 (`[vox]
  images_without_image_triage`); F259 (catalogue-derived v2 types, question bytes unchanged); F029
  (`CATALOGUE_LINT_EXTENDED`, English and Persian affect and wellbeing terms); F233 (the v2-live correction adjustment
  only in a private chat and never for a confidential or personal-life message); F180 (payments `isTelegramPriceId`
  own-property check; decision (a) untouched); F051, F052 (v1 studio suites pin the S09 flags; a v2 arm in
  skill-routing); F037 (question-count cap test); F145 (`anthropicSystem` drops empty blocks and keeps only `type` and
  `ttl` in `cache_control`).
- **H4:** F039, F084 (one `text/persian.ts`: `foldPersian`, `isArabicScriptLetter`, `isLatinLetter`,
  `clipGraphemes`); F257, F038, F083, F125, F160 (`negatedMemoryRequest` and `explicitMemoryRequest` also test the
  folded text; raw matches still count); F176 (the image people filter reads the folded content); F093 (the v2
  stemmer never stacks plural and verbal prefix, `FA_MI_NOUNS`); F139 (retrieval part: U+06C0 and U+06D5 fold to
  heh; memory-eval v2 Recall@3 stays 0.980); F181 (the script label counts letters only); F263 (EnrollScreen timer
  in the locale's digits inside `<bdi>`); F056 (hint-isolation scans every quote style); F031 (documented in S06);
  VF-S10L-low-throwing-getter.
- **H6:** F019, F115 (`resnapshotGroupMemory` refuses `since_membership` with 409 and a `refused` audit row; new
  admin `setGroupHistoryPolicy` and `POST groups/:chatId/history-policy`, behind `TIREH_SHARING_V2`; absent keeps
  today's behaviour, decision (j)); F033 (preview `byAgent` and `memoryIds`, ids only, opt-in); F091, F261
  (`memoryNoticesFor` filters before the cap of 50 and reads in parallel chunks of 10); F014, F060 (demotion to
  pending invalidates voiceprints under `STUDIO_VOICE_RECOGNITION`); F021, F073, F109 (the two base shared-memory
  consent cases pinned to the flag unset, a flag-on arm added; decision (k)). F047 and F135 needed no code.
- **H5:** F032, F078 (the voiceprint sweep runs at boot and daily, deletes expired and non-member rows, reads
  membership once per sweep and only key fields); F087, F133 (S11L part: `listKeys()` paging without template bytes);
  F178, F217, F179 (the shared pyannote upload runs on its own signal, a caller's abort rejects only that caller, a
  rejected upload is evicted); VF-S11L-low-verify-cap; VF-S11L-low-allSettled (`chainVoiceInvalidators`); F100,
  F058, F010 (tighter voiceprint tests); the runtime S11L block logs `[vox] voiceprint sweep_failed` and
  `warm_failed` instead of swallowing them.
- **H7:** F142, F190, F002, F018, F111, F074, F101, F008 (the tireh fence suites and the Studio originals read the
  prompt through `systemText()`, so `TIREH_CACHED_PROMPT=1` has no expected failures left); F088, F126 (both prompt
  builders render one set of section renderers; goldens byte-identical); F139 (clipMemory part: the 209-code-point cut
  moves back to a grapheme boundary); F028, F076, F112, F236, F248 (S03 spec deviations, tests list and hash note).
- **H2:** F219 (Persian placeholder, withheld-reply and acknowledgement texts chosen by `scriptLanguage`; English
  constants byte-identical); F262, F218 (`TelegramApiError` `code: 'file_too_large'`, bodies cancelled before each
  throw, `getFile` abort rethrown only for the download); F232 (missing or unknown `image_kind` gives null triage);
  F258, F220, F048 (`IMAGE_REMEMBER_REQUEST` deleted; `suppressImageMemory` and the gateway call
  `negatedMemoryRequest`/`explicitMemoryRequest`; Mini App untriaged images fail closed explicitly); F246 (`image-v1`
  decision-log rows after the turn's text row, timed on the gateway clock, under `TIREH_DECISION_LOG`); F221 (8 s
  deadline on the webhook's Bot API calls); F216 (the assistant row's image marks are the union of the turn and its
  context); F196 (APP0 JFIF thumbnails removed, JFXX dropped); F183 (relationship observation honours the negation);
  F144 (the Circles outsider photo turn is proven public-only); F189 part 2; open issue 8 (progressive JPEG triage
  behind `STUDIO_IMAGES` with a multi-scan validator).
- **H9:** F140, F188 (`tsconfig.test.json` strict gate and the CI step); F225, F146 (strict test types); F143, F186,
  F223 (circles-group 'forget me leaves no trace' checks hex-bounded ids through `idTrace`: a test-only change to
  main's test); F224 (`learning/races.test.ts` 'final-rename fence' checks the length before dereferencing: a
  test-only change to main's test); F226, F189 part 3, F008 port part (labels and the ports' group key).
- **H8:** F026, F129 (`engines.node` "22", see section 8); F041 (firebase.json part); F022 (pyannoteAI processor row;
  the retention conflict stays with the privacy owner); F069, F209, F238, F162, F204, F205, F206, F237, F241, F242,
  F243, F244, F248, F247, F119, VF-S15-low-README, VF-S15-low-doc, VF-S14-low-README (PRIVACY_AND_CONSENT PRIV-009
  rows, the VOX_STUDIO photo and deploy notes, an "Integration onto main" block in S08, S11L, S12, S14 and S15, and
  the decisions README).

### Integration commits

- `c86bb6a` **Name the decider subject and pass the group flag to readTriage in the gateway** (H2 item 10 and H3's
  F233 follow-up, left to the integrator because they needed both clusters). Text triage names `source.personId` and
  image triage `speaker.id` as `DeciderAuthority.subject`; only a `ServiceDecider` with a valid
  `DECISIONS_SAFETY_ID_SALT` reads it, as an opaque salted hash, so the body is unchanged without a salt and the
  default decider ignores it. `readTriage` receives `chat.kind === 'group'`, so under `TRIAGE_QUESTION_SET=v2-live` a
  correction never widens group memory, also for a message that names the persona. New
  `hardening-gateway-decider-wiring.test.ts` (fails with the group argument removed). S09 and PRIVACY_AND_CONSENT
  updated.
- `e6e2689` **Reconcile cluster tests with the merged behaviour.** `voiceprint-guests.test.ts`'s three shadow cases
  stub `STUDIO_VOICE_RECOGNITION=1` as well (H3's composition with H5's tests); the `decisions-triage-v2.test.ts` case
  'never changes needsWeb, wantsVoice, addressed, proactive or skills' (askAddressed true) now expects v1's
  `memorable: false` under v2-live (F233; the private positive case is unchanged); `runtime.test.ts`'s relationships
  case pins `STUDIO_DECIDER` unset (F051); `voiceprint-fixtures.ts` installs the invalidator through
  `chainVoiceInvalidators`, as runtime.ts does.
- `2fddf34` **Remove the deprecated image memory-request aliases; describe the merged audit wiring.**
  `IMAGE_NO_MEMORY` and `explicitRememberRequest` are gone (memory-requests.test.ts reads `memory/requests.ts`); the
  `requests.ts` call-site TODO and the `wireSharingAudit` comment are current; S12 spec row updated.
- The commit that adds this section: this record, the S03 and S06 `flags.ts` hash notes, and the stale integrator
  TODO removed from `flags.test.ts`.

### Left open by the clusters

Recorded in section 7: the `too_large` reason (pinned `voice-band.ts`), the opt-in preview detail, the cross-instance
voiceprint sweep lease, the S10L style-profile store paging, F062 (large image documents), the F088 shared clip
constant, the S03 staging follow-ups, the `next-env.d.ts` dependence of the test typecheck, and the unverified
`safety_identifier` API support. Product decisions (j) to (o) are new (section 9).
