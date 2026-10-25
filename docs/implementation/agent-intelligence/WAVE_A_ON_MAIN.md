# Wave A on main (agent intelligence, 25 Oct 2026)

Branch `agent-intelligence-wave-a-main`, built in the worktree `$TMPDIR/vox-wave-a-main` from `main` at
`7224f40d69cf816a49139a30092cbf92551d2a8e` (PR #112). It is not pushed. It brings the QA-hardened wave A of
[the agent intelligence plan](../../AGENT_INTELLIGENCE_SOLUTION.md) onto the release line the team merges to and
deploys from. Every wave A flag defaults to off.

This is the summary record for the branch. The per-step detail (each conflict resolution, every main-lineage test
case kept or not kept, by name, with the reason, and every re-derived golden) is in
[WAVE_A_MAIN_INTEGRATION.md](WAVE_A_MAIN_INTEGRATION.md). The develop-based wave A branch keeps its own record,
[WAVE_A_INTEGRATION.md](WAVE_A_INTEGRATION.md), which stays here unchanged as the historical record of that branch.

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
| S10L identity library (`tireh/identity/*`) | `80252dd`…`83848b7`, merged by `b892138` | `aiq/identity-lib` `b34b7c0`, merged as `b278780`, plus QA `05a4520` | wave A | Main's richer Firestore fake moved to `src/lib/studio/__tests__/fake-firestore.ts` for the Circles DM and Pet store tests (import path change only). Portable cases in 9 `identity/__tests__/*.main-lineage.test.ts` files, including main's source-tree hint-isolation scans. `voice-band.ts` byte-identical (`b8d0a41d…21bd`). Main-only `identity/service.ts` deleted (no importer). |
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
| S14 | low | Eval-row retention depends only on `sweep()` (no Firestore TTL) | Recorded: wiring/deploy note (open issue 9) |
| S10L | low | A voice MATCH counts in fusion whatever its net speech | Open: library unwired; check at wiring time (open issue 9) |
| S10L | low | `recordPromptOutcome('confirmed_self')` updates a profile without a consent or epoch re-check | Open: library unwired; add the re-check at wiring time (open issue 9) |
| S10L | low | `extractStyleFeatures` propagates a throwing input getter | Recorded open issue (open issue 9) |
| S15 | low | Provider-level `input_audio` rejection not asserted directly | Open, low: the zod-boundary cases still reject it before any fetch |
| S15 | low | README and S15 doc body describe the main-lineage timeout and `typedCreate` | Open documentation follow-up (open issue 5) |
| S09 | medium | Main's removed decisions-log/calibration/service-decider/triage-v2 cases were not in the dropped list | Closed: listed by name in WAVE_A_MAIN_INTEGRATION.md (S06 section) |
| S06 | medium | Embeddings client lost main's `logLevel: 'off'` | Closed: ported with S08, with a test under `OPENAI_LOG=debug` |
| S06 | low | `vectorCandidates` 'reads the process environment when no env is given' fails with both retrieval flags in the ambient environment | Open, test-only: the matrix runs with flags unset (`u.sh` below) |
| S06 | low | The kept `findNearest` gate reads the process environment; `findNearest` checks the 30-key cap before removing duplicates | Open (vector retrieval is not wired; open issue 4) |
| S08 | medium | `instanceof StaleMemoryWriteError` brought into successor inheritance | Closed: structural `isStaleMemoryWriteError`, with a cross-bundle test |
| S08 | medium | Re-snapshot `vox_audit` rows no longer split into 200-id batches | Closed: one row per 200 ids, with a 201-record test |
| S08 | low | The other-persona guard in `policy/snapshot.ts` was dropped with its unnamed main test | **Closed in fixer r1:** `2b66ced` restores it, with a policy-differential case |
| S08 | low | Dropped list named 2 of 9 contradictory first-run tests | Closed: the record names the probe failures and the rewritten suites |
| S08 | low | `memoryNoticesFor` returns `newMemoryId` even when the recipient cannot see the replacement | Open: an opaque id only, `replacementVisible` false; review with the notice copy (product decision (e)) |
| S11L | medium | The production refusal for voiceprints on Firestore is gone | Closed by the S03 merge `18d0415` (`createStudioVoiceprints` takes `production`; `voiceprint-storage` case 'refuses Firestore in production with STUDIO_VOICE_RECOGNITION=1 until Cloud KMS exists…'). Corrected in fixer r1 |
| S11L | low | Verify does not cap the voice-note audio size before upload | Open (enroll caps at `MAX_VOICEPRINT_AUDIO_BYTES`; open issue 7) |
| S11L | low | The invalidator moved from `allSettled` to `Promise.all` | Open (open issue 7) |
| S03 | critical | Main's flag-on `cached-prompt-gateway-suite` and `-tail` wrappers deleted with no replacement | Closed: restored unchanged from main (104/104) |
| S03 | medium | Main's earlier-run S03 cases in add/add files replaced without being named | Closed: named in WAVE_A_MAIN_INTEGRATION.md (S03); passing ones kept in 3 `.main-lineage` files |
| S03 | low | No committed test keeps `962e877`'s turn-context lines out of blocks A/B/C | Open (open issue 3) |
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
step was built against.

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

## 5. Catch-up with main

`git fetch https://github.com/mohammadreza87/vox.git main` succeeded on 25 Oct 2026. `FETCH_HEAD` is
`7224f40d69cf816a49139a30092cbf92551d2a8e`, the base of this branch, so there was nothing to merge. This branch is
caught up to `7224f40`.

## 6. Results for this tree

### After fixer round 2 (HEAD of this record's last update)

- **`npx tsc --noEmit -p tsconfig.json`:** exit 0. **ESLint** on every file fixer r2 changed: exit 0.
- **Full `npx vitest run`, flags unset:** 14 failed files, 96 failed tests, 7796 passed, 2 expected failures (the
  remaining QA `it.fails`: CQ2-3 audit sweep `onError`, F030 `DecisionService` timeout naming), 14 skipped, 56
  unhandled errors (listen EPERM). All 96 are environmental:
  - mkdtemp `/tmp` EPERM: `adaptive/guest-rights/guest-rights` (20), `studio/guest-rights-http` (10),
    `adaptive/rights-intake/storage` (2), `connections/mcp/__tests__/tls` (1);
  - listen 127.0.0.1 EPERM: `connections/mcp/__tests__/self-service` (37), `foundation-broker-error-http` (10),
    `foundation-broker` (1), `integration-broker` (1), `adaptive/runtime/reminders/reminders` (2);
  - unix-socket listen: `adaptive/voice-identity/local-provider` (7); tsx child IPC:
    `adaptive/personalization/learning/rollback` (1);
  - timeouts under full-suite load, each passing alone: `adaptive/observation/service` (1),
    `adaptive/prediction/voice-integration` (1), `studio/__tests__/prepared-conversation-qualification` (2).
- **Flag matrix** (every other flag unset; fixer r2 touched the gateway, images, S08 and the runtime, so every row was
  rerun):
  - `TIREH_CACHED_PROMPT=1` `src/lib/tireh`: 10 failed / 2096 passed, 2 expected failures: exactly S03's 10.
  - `TIREH_RETRIEVAL_V2=1` memory-privacy, visibility, memory-eval: 41/41.
  - `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` invariants, policy-differential, `src/lib/studio`: 12 failed / 1590 passed:
    `guest-rights-http` (10, mkdtemp EPERM) and `prepared-conversation-qualification` (2, load timeout, 9/9 alone).
    A first run also timed out `group-runtime` once (passes alone).
  - `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1` `src/lib/tireh src/lib/adaptive/decisions`:
    2218 passed, 2 expected failures.
  - `STUDIO_IMAGES=1` `src/lib/tireh`, `circles-dm`, `circles-channels`: 2175 passed, 2 expected failures.
  - `STUDIO_VOICE_RECOGNITION=1` voiceprint suites: 105/105; with `STUDIO_VOICE_SHADOW=1`, voiceprint-liveturn and
    gateway: 54/54.
  - Informational, every flag on, `src/lib/tireh`: 9 failed / 2097 passed (S03's 10 less `voice-delivery`).
  - The new CI `privacy-gates` steps, run locally: 188/188 flags unset, 106/106 under the S08 flags.
  Every row is at least the result recorded below and in `WAVE_A_INTEGRATION.md` (failures are the same
  environmental set; passes are higher).

### After fixer round 1

- **`npx tsc --noEmit -p tsconfig.json`:** exit 0. **ESLint** on the `.ts`/`.tsx` files fixer r1 changed: exit 0.
- **Full `npx vitest run`, flags unset:** 16 failed files, 99 failed tests, 7749 passed, 2 expected failures (the
  remaining QA `it.fails`: S08 successor filter F-r3, `DecisionService` timeout naming F030), 14 skipped, 56 unhandled
  errors (listen EPERM). All 99 are environmental:
  - mkdtemp `/tmp` EPERM: `adaptive/guest-rights/guest-rights` (20), `studio/guest-rights-http` (10),
    `adaptive/rights-intake/storage` (2), `connections/mcp/__tests__/tls` (1);
  - listen 127.0.0.1 EPERM: `connections/mcp/__tests__/self-service` (37), `foundation-broker-error-http` (10),
    `foundation-broker` (1), `integration-broker` (1), `adaptive/runtime/reminders/reminders` (2);
  - unix-socket listen: `adaptive/voice-identity/local-provider` (7); tsx child IPC:
    `adaptive/personalization/learning/rollback` (1);
  - timeouts under full-suite load, each passing alone: `adaptive/lifecycle/longterm-simulation` (1),
    `adaptive/message-memory/message-memory` (1), `adaptive/observation/service` (1),
    `studio/__tests__/indexed-reply-context` (1), `studio/__tests__/prepared-conversation-qualification` (3).
- **Flag matrix, rows for the areas fixer r1 touched** (every other flag unset):
  - `TIREH_CACHED_PROMPT=1` `src/lib/tireh`: 10 failed / 2055 passed, 2 expected failures: exactly S03's 10
    (`diagnostics` 1, `gateway` 5, `history-privacy` 3, `voice-delivery` 1).
  - `TIREH_RETRIEVAL_V2=1` memory-privacy, visibility, memory-eval: 41/41.
  - `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` invariants, policy-differential, `src/lib/studio`: 11 failed / 1588 passed:
    `guest-rights-http` (10, mkdtemp EPERM) and `prepared-conversation-qualification` (1, load timeout).
  - `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1` `src/lib/tireh src/lib/adaptive/decisions`:
    2177 passed, 2 expected failures.
  - `STUDIO_IMAGES=1` `src/lib/tireh`, `circles-dm`, `circles-channels`: 2134 passed, 2 expected failures.
  - Informational, every flag on, `src/lib/tireh`: 9 failed / 2056 passed (S03's 10 less `voice-delivery`).
  Every row is at least the result recorded below and in `WAVE_A_INTEGRATION.md`. The voiceprint and webhook rows were
  not rerun (code not touched).

### Before fixer round 1

All runs are in `$TMPDIR/vox-wave-a-main` with a real `node_modules` (`npm ci`, openai 7.39.0), at the commit that
adds this record. "Flags unset" means every wave A flag removed from the environment with `env -u` (the 13 variables
of section 8).

- **`npx tsc --noEmit -p tsconfig.json`:** exit 0.
- **ESLint** on the 182 `.ts`, `.tsx`, `.js` and `.mjs` files changed between `7224f40` and HEAD: exit 0, 0 errors,
  0 warnings (the 17 unused-import warnings TAIL recorded are fixed by `d8f0306`).
- **`npm run check:studio-style`:** pass. **`node --test scripts/legacy-offline-inventory.test.mjs`:** 17/17.
- **Full `npx vitest run`, flags unset:** 22 failed files, 106 failed tests, 7659 passed, 5 expected failures (QA
  known-gap `it.fails`), 14 skipped, 56 unhandled errors (listen EPERM). Main's baseline had 14 failed files and
  95 failed tests, all environmental. Every failure here is classified below; none is merge-induced.
  - **Sandbox, mkdtemp `/tmp` EPERM:** `adaptive/guest-rights/guest-rights` (20), `studio/guest-rights-http` (10),
    `adaptive/rights-intake/storage` (2), `connections/mcp/__tests__/tls` (1).
  - **Sandbox, listen 127.0.0.1 EPERM:** `connections/mcp/__tests__/self-service` (74 reported lines, most of the 56
    unhandled errors), `connections/__tests__/foundation-broker-error-http` (10), `foundation-broker` (1),
    `integration-broker` (1), `adaptive/runtime/reminders/reminders` (2).
  - **Sandbox, unix-socket listen:** `adaptive/voice-identity/local-provider` (7, main's `c2c0bee` engine).
  - **Sandbox, tsx child IPC:** `adaptive/personalization/learning/rollback` (1).
  - **Timeouts under full-suite load that pass alone** (each rerun alone, flags unset): `adaptive/lifecycle/longterm-simulation`
    2/2, `adaptive/observation/service` 22/22, `adaptive/persistence/internal-pilot` 43/43,
    `adaptive/personalization/learning/races` 15/15, `adaptive/rights-intake/local-erasure.independent` 31/31,
    `adaptive/rights-intake/local-erasure` 62/62, `adaptive/shared/shared-clock` 8/8, `adaptive/voice-identity/service`
    21/21, `studio/__tests__/circles-notes` 37/37, `studio/__tests__/indexed-reply-context` 57/57,
    `studio/__tests__/prepared-conversation-qualification` 9/9. None of these suites or the code under them changed
    between `7224f40` and HEAD.
- **Privacy core suites** (the 29 of the plan plus the wave A red-team suites and `sharing-v2`, 35 files), flags
  unset: 662/663. The one failure, circles-group 'review fixes: closing, erasure, cards > forget me leaves no trace of
  the requester…', is a random-value collision in main's own test, not a regression: it asserts that the serialized
  events do not contain `'999'` (the stranger's id), and that run's random owner hash was `f2ee0935d5999decc…`.
  Rerun alone three times: 45/45 each. Circles code and that test are unchanged from `7224f40` (open issue 12).

### Flag matrix

| Command (every other flag unset) | This tree | Recorded at wave A (`WAVE_A_INTEGRATION.md`) |
|---|---|---|
| `TIREH_CACHED_PROMPT=1 npx vitest run src/lib/tireh` | 10 failed / 1974 passed, 5 expected failures: exactly S03's 10 (`diagnostics` 1, `gateway` 5, `history-privacy` 3, `voice-delivery` 1); the 2 unhandled rejections are `history-privacy`'s string-`system` fakes in the same 3 cases | 10 failed / 1290 passed |
| `TIREH_RETRIEVAL_V2=1` memory-privacy, visibility, memory-eval | 41/41 | 41/41 |
| `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` invariants, policy-differential, `src/lib/studio` | 11 failed / 1586 passed: `guest-rights-http` (10, mkdtemp EPERM) and `prepared-conversation-qualification` (1, load timeout, 9/9 alone). The by-design successor failure no longer appears (wave A's `05a4520` pins that test's flag unset) | 12 failed / 1213 passed (1 by design) |
| `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1` `src/lib/tireh src/lib/adaptive/decisions` | 2096 passed, 5 expected failures | 1404/1404 |
| `STUDIO_IMAGES=1` `src/lib/tireh`, `circles-dm`, `circles-channels` | 2053 passed, 5 expected failures | 1300/1300 (`src/lib/tireh` only) |
| `STUDIO_VOICE_RECOGNITION=1` `src/lib/studio/__tests__/voiceprint*` | 105/105 (includes the ported authority races) | 90/90 |
| `STUDIO_VOICE_RECOGNITION=1 STUDIO_VOICE_SHADOW=1` voiceprint-liveturn, gateway | 54/54 | not recorded |
| `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` `src/app/api/telegram src/lib/telegram` | 22/22 | not recorded |
| Informational: every flag on (`TIREH_CACHED_PROMPT`, `TIREH_PROMPT_SYSTEM_TAIL`, `TIREH_RETRIEVAL_V2`, `TIREH_SHARING_V2`, `TIREH_AUDIT_LOG`, `STUDIO_DECIDER=service`, `TRIAGE_QUESTION_SET=v2`, `TIREH_DECISION_LOG`, `STUDIO_IMAGES`, `STUDIO_VOICE_RECOGNITION`), `src/lib/tireh` | 9 failed / 1975 passed: S03's 10 less `voice-delivery`, which passes with the other flags on; no flag-off golden fails | 13 failed |

The "5 expected failures" are the QA known-gap tests written as `it.fails`; they turn red when a gap is closed.
Every matrix row is at least as good as the recorded wave A result.

## 7. Open issues

1. **Commit trailer.** The computed task asks for `Co-Authored-By: Claude Fable 5.1`; this session's attribution rule
   says `Claude Opus 5.5`. The step merges on this branch carry Fable 5.1; this run's commits carry Opus 5.5; fixer r1's
   and fixer r2's commits carry Fable 5.1, as their tasks asked. Pick one before the branch is pushed.
2. **Test files are not type-checked.** `tsconfig.json` excludes `*.test.ts(x)`. QA r1 counted 48 strict errors in the
   124 test files changed since `7224f40`. A test tsconfig over every file under `src` (types `vitest/globals`,
   `@testing-library/jest-dom/vitest`, `node`) reports 754 errors in about 80 files, most of them in main's own tests
   (`api/chat`, `api/v2/chats`, `api/user/subscription`, stores). A CI gate needs that cleanup first; it is a
   follow-up, not part of this merge. They pass at runtime.
3. **S03.** Cache hit rates are not measured, and no reply model was checked against a mid-conversation system
   message (staging). No committed test pins `962e877`'s turn-context lines out of blocks A/B/C. Under
   `TIREH_CACHED_PROMPT=1` the 10 expected failures remain (string-`system` suites; each has a port).
4. **S06.** Recall@3 0.980 against 0.987 for v1 (RRF compresses lexical strength); embeddings, query embedding and
   `vectorCandidates` are not wired; a missing vector index returns no candidates silently; `findNearest` reads the
   process environment and caps before de-duplicating; `FirestoreMemoryStore.updateIfShareVersion` turns Timestamps
   into maps (both sides).
5. **S09 and S15.** `DecisionService` classifies timeouts by `error.name` (F030), so provider timeouts log as
   `provider_error`. Do not run `src/lib/studio` under `TRIAGE_QUESTION_SET=v2` (v1-pinned triage tests, F051, F052).
   The decisions README and the S15 record still describe main's `requestTimeoutMs`/`typedCreate`. S15's 7-day age
   rule picked openai 7.34.0; this branch keeps main's 7.39.0, which main already deploys.
6. **S08.** Enable `TIREH_SHARING_V2` soon: the base successor copy includes private and sensitive records. (The
   v2 successor filter now refuses invalidated and expired records; fixer r2.) Review `newMemoryId` in notices for an
   invisible replacement. The Telegram `/memories` notice line and reserved audit kinds are TODO. Notices are erased
   with their memories and on a rights erasure, also after a flag rollback, but have no TTL (product decision (f));
   `vox_audit` rows keep the 12-month sweep (also with both flags off) and have no per-person erasure (append-only by
   design). A failed sweep leaves no signal yet (CQ2-3, still an `it.fails`). Before `TIREH_SHARING_V2` runs on
   Firestore, deploy the new `tireh_supersede_notices` index.
7. **S11L.** The startup refusal for Firestore voiceprints in production with the flag on is in place (`18d0415`), and
   an invalid key or one reusing `STUDIO_SECRET` still fails startup. The one difference from main: a `VOICEPRINT_KEY`
   that is missing while the flag is on is treated as off instead of failing startup. KMS envelope encryption and key
   custody are release gates. Verify does not
   cap the voice-note size. The invalidator uses `Promise.all`. `setVoiceIdentityInvalidator` is a single slot. The
   pyannoteAI adapter is untested against a live account. EnrollScreen FA strings need native review. Main's own
   `runtime.ts` (two `voiceRecognitionEnabled` lines) and `adaptive/voice-identity/runtime-config.ts` still read
   `STUDIO_VOICE_RECOGNITION` from the environment directly; they predate this merge and are left as main has them.
8. **S12.** The default decider has no `decideParts`, so with only `STUDIO_IMAGES=1` image triage is null (full
   routing needs `STUDIO_DECIDER=service`); `image-v1` decision-log rows are not written; a paused memory or history
   setting still lets an image be triaged and answered; progressive JPEGs (now stripped across every scan, but still
   skipped by the triage seam's baseline-only check) and p95 latency need a real Telegram check; an `extract_text`
   reply can put document text into the person's own private history (privacy owner review). A Mini App image turn has
   no image triage, so with the flag on it is always suppressed and its reply withheld from history. Since fixer r2 a
   Telegram image also needs the person's `single_party_image` capability (as a Mini App image does), so where no
   approval for it exists (the internal pilot rejects it at startup) `STUDIO_IMAGES=1` answers captions only. Memory
   requests are still regex rules: they lean towards refusal, and a request phrased in a way neither rule knows is
   treated as no request (image memory suppressed).
9. **S10L and S14.** Not wired; they wait on the DPIA. QA F025: S10L persists a per-person style profile against
   section 4.9 phase 0 (product decision (d)). At wiring time: honour net speech for a voice MATCH, re-check consent and
   epoch in `recordPromptOutcome('confirmed_self')`, catch throwing getters in `extractStyleFeatures`, and either
   schedule `sweep()` for `vox_reply_style_eval` or store a Timestamp for Firestore TTL.
10. **Legacy Telegram webhook.** `TELEGRAM_WEBHOOK_SECRET` is set nowhere in the repo. Until it is set, registered as
    the setWebhook `secret_token` and `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` is on, the webhook is unverified (product
    decision (b)). Invoices are not bound to a server-side intent (product decision (c)).
11. **Housekeeping.** `git worktree prune` cannot remove 8 stale `.git/worktrees` entries inside the sandbox (EPERM).
    Run it outside the sandbox.
12. **circles-group random collision.** Main's 'forget me leaves no trace of the requester' asserts that serialized
    events do not contain the stranger id `999`, but the events carry random 32-hex hashes, so it fails whenever a hash
    happens to contain `999` (seen once in this run). The test should compare against the exact id field, not the
    whole serialized string. Left as main has it.

13. **Privacy gates as a required check.** The `privacy-gates` CI job exists (fixer r2); making it a required status
    check on `main` and `develop` is a branch-protection setting for the repository owner.

## 8. Deployment prerequisites

- **Install:** `npm ci` (lock pins openai 7.39.0). The main checkout's `node_modules` may be stale.
- **Node 22 or later:** openai 7.x requires it. `package.json` has no `engines` field; confirm the Firebase/App
  Hosting runtime.
- **Firestore indexes:** deploy `firestore.indexes.json` by hand (`firebase deploy --only firestore:indexes`). It holds
  the `tireh_memories` vector index (S06), the `vox_audit` composite index (`personaId` ASC, `at` DESC, S08) and the
  `tireh_supersede_notices` composite index (`personaId` ASC, `recipientPersonId` ASC, `at` DESC, S08, fixer r1).
  `firebase.json` does not reference the file.
- **Environment per flag** (all default off; read only through `tirehFlags()` in `src/lib/tireh/flags.ts`):

| Env | Step | Also needs |
|---|---|---|
| `TIREH_CACHED_PROMPT=1` | S03 | — |
| `TIREH_PROMPT_SYSTEM_TAIL=1` | S03 | `TIREH_CACHED_PROMPT=1`; a reply model that accepts a mid-conversation system message |
| `TIREH_RETRIEVAL_V2=1` | S06 | — |
| `TIREH_VECTOR_RETRIEVAL=1` | S06 | `TIREH_RETRIEVAL_V2=1`, Firestore, the deployed vector index (not wired yet) |
| `TIREH_SHARING_V2=1` | S08 | Firestore: the deployed `tireh_supersede_notices` index |
| `TIREH_AUDIT_LOG=1` | S08 | Firestore: the deployed `vox_audit` index |
| `STUDIO_DECIDER=service` | S09 | `OPENAI_API_KEY` (Decisions API) |
| `TRIAGE_QUESTION_SET=v2\|v2-live` | S09 | best with `STUDIO_DECIDER=service`; measure refusal and malformed rates first |
| `TIREH_DECISION_LOG=1` | S09 | — (90-day retention) |
| `STUDIO_IMAGES=1` | S12 | `STUDIO_DECIDER=service` for triage; a vision-capable reply model |
| `STUDIO_VOICE_RECOGNITION=1` | S11L | `VOICEPRINT_KEY` (dedicated 256-bit key), `PYANNOTE_API_KEY` (optional `PYANNOTE_BASE_URL`), approval and consent; mutually exclusive with the local voice engine |
| `STUDIO_VOICE_SHADOW=1` | S11L | `STUDIO_VOICE_RECOGNITION=1` |
| `TELEGRAM_WEBHOOK_FAIL_CLOSED=1` | legacy | `TELEGRAM_WEBHOOK_SECRET` set in every legacy deployment and registered as `secret_token` |

S10L and S14 have no flag and are not wired.

## 9. Product decisions

From the recorded set (none is implemented here; each is the product lead's call):

- **(a)** Legacy Telegram payments: `PUT /api/telegram/payments` deleted and `POST` requiring a Firebase ID token, a
  base-behaviour exception kept pending sign-off.
- **(b)** `TELEGRAM_WEBHOOK_FAIL_CLOSED` default stays off until `TELEGRAM_WEBHOOK_SECRET` is rolled out; owner to be
  named. This run moved the flag read into `tirehFlags()` without changing the default.
- **(c)** Binding Telegram invoices to a server-side intent.
- **(d)** The S10L persisted style profile against section 4.9 phase 0 (F025).
- **(e)** Supersede-notice copy. Related: whether a notice should carry `newMemoryId` when the recipient cannot see
  the replacement.
- **(f)** Retention periods the plan does not fix (for example the S14 evaluation rows, S10L's 30/180 days, S12
  image retention).
- **(g)** Sending a possibly sensitive document image to the decider before any verdict exists.

New from this run:

- **(i)** Base-behaviour exception awaiting acknowledgement (QA r3 SC3): with every flag unset the gateway's
  `NO_MEMORY` (group memory, relationship observation) reads `memory/requests.ts` `NEGATED_MEMORY_REQUEST`, a strict
  superset of the base rule that only withholds memory (section 3). Like (a), it contradicts the "behaves exactly as
  before" promise in `flags.ts` and the S12 spec; the code stays fail closed until the product lead decides.
- **(h)** Narrowed in fixer r1: the Firestore production refusal and the invalid-key failure are in place. Left to
  decide: whether a `VOICEPRINT_KEY` that is missing while `STUDIO_VOICE_RECOGNITION=1` should fail startup (main) or
  leave voiceprints off (this branch).
