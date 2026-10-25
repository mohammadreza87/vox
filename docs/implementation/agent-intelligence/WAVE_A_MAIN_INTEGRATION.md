# Wave A onto main: integration record

This branch (`agent-intelligence-wave-a-main`) starts from `main` at `7224f40` and merges the wave A step merges of
`agent-intelligence-wave-a` one step at a time. Where both sides implemented the same module, the QA-hardened wave A
implementation is the chosen one. Main's own features and repairs are kept. Each step below lists the conflicted files,
how each was resolved, and every main-lineage test case that was not kept, by name, with the reason.

## S14: reply-style bandit library (wave A `7127eba`, aiq/bandit-lib `57e2d6c`)

Main merged an earlier run of the same spec (`6fa457b`, `c435308`, `8991af6`, `0ebf66f`, `aa5ef60`, merged by
`1ae38d4`). Neither side wires the library: no module outside `src/lib/adaptive/personalization/procedural*.ts` imports it.

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/adaptive/personalization/procedural.ts` | Wave A's file. |
| `src/lib/adaptive/personalization/procedural-store.ts` | Wave A's file. |
| `src/lib/adaptive/personalization/procedural.test.ts` | Wave A's file. Portable main-lineage cases moved to `procedural.main-lineage.test.ts`. |
| `docs/implementation/agent-intelligence/S14-bandit-lib.md` | Wave A's spec. Main's earlier-run spec (226 lines, `ReplyStylePolicy` API) is superseded. |
| `src/lib/adaptive/decisions/README.md` | Wave A's "Reply-style procedural memory (not wired)" section; every other line is main's, byte for byte. |

Main's README sentence asking for a Firestore TTL policy on `vox_reply_style_eval.expiresAt` went with main's S14
section. Wave A stores `at` and `expiresAt` as plain numbers and deletes expired rows through `sweep()`. Firestore TTL
only acts on Timestamp fields, so wiring must either schedule `sweep()` or change the store to write a Timestamp.

### Main-lineage cases kept (adapted to wave A's API)

`procedural.main-lineage.test.ts` holds these cases, with the API renames listed in its header:

- precedence helpers: "maps resolvePreferences output to pins: structured, plain, en and hypothesis"; "resolveReplyStyle
  ignores invalid arm values and explicitRequestFromTurn maps triage labels".
- composite reward: "reply-rate alone never produces a reward"; "scores each single positive as 1 and each single
  negative as 0"; "a negative settle records reward 0 and adds to beta only".
- correction phrases (EN/FA): detects "No, shorter", "nope", "again", "that's not what I meant", "نه، کوتاه‌تر",
  "دوباره", "منظورم این نبود", "منظورم اين نبود"; does not flag "I know", "nobody asked", "نهایت", "thanks!".
- decay: "halves evidence over the prior every 90 days and never drops below Beta(1,1)"; "a dominant posterior that is
  ten half-lives old no longer dominates".
- propensity logging: "joint propensity is the product over all six dimensions".
- deterministic sampling: "same seed and store contents give the same choice; seeds explore; Math.random is never
  used"; "sampleBeta rejects a bad RNG and choose then falls back without sampling".
- gate and audience: "a false gate touches no store method; only an exact true opens it"; "a gate that flips to false
  before the write records nothing"; "groups and guest audiences never sample"; "settle with a false or throwing gate
  changes no posterior".
- store failure: "choose falls back without throwing".
- file store: "serialises concurrent settles on one posterior exactly"; "a corrupt file fails closed and is never
  overwritten" (with main's symlinked-file assertion, plus a planted symlink at the temp path that is never written
  through).
- Firestore store: "a failed transaction commit leaves the posterior and exposure unchanged"; "refuses duplicate
  exposure ids and unsafe document ids".

### Main-lineage cases and assertions not kept

Whole cases (main's describe > it):

- precedence > "explicit this turn beats stored, stored beats sampled, sampled beats persona default": API absent
  (`ReplyStylePolicy`, seeding through `appendDecision`/`settle`). Covered by wave A "precedence > explicit request this
  turn beats stored preference, which beats the sampled arm, which beats the persona default".
- precedence > "pinned dimensions are never sampled or learned": API absent (`store.get`, sparse per-arm posterior
  docs). Covered by wave A "composite reward > updates only sampled dimensions; ..." and the precedence row checks.
- precedence > "validates constructor options": contradicts wave A (4 to 6 dimensions, not 1 to 6;
  `propensitySamples` up to 4096, not 2000; no `halfLifeMs` option). Covered by wave A "dimensions option > rejects
  anything but 4 to 6 distinct known dimensions".
- memory/file/firestore store: withdrawal and reset > "withdraw deletes posteriors and eval rows by space, then
  entirely, and stale decisions recreate nothing", "reset deletes only that persona and space, across all routes",
  "lists decisions by time range and sweeps only expired rows" (3 cases × 3 stores): API absent (`withdraw(personId,
  space)`, `listDecisions`, `deleteScope`, `sweep` returning a number). Covered by wave A "withdrawal deletes
  posteriors and eval rows (%s)" and "store contract (%s)".
- composite reward > "200 settles with reply-rate-only signals leave every posterior unchanged": contradicts wave A
  (wave A marks a no-signal exposure settled, so it cannot be settled again later; no `corrective: 'unknown'`).
  Covered by wave A "property: 200 random subsets of reply and non-corrective follow-up signals never update".
- propensity logging > "logs a content-free record with the chosen arm, propensity and unchosen arms": row shape
  differs (main logged the full style, sources and a dimensions list). Covered by wave A "logs context, chosen arms,
  propensities and unchosen arms that replay exactly" and "expired exposures and denied authorization never change
  posteriors".
- propensity logging > "a dominant arm has propensity above 0.95": covered by wave A "a strongly skewed posterior gives
  propensity above 0.95".
- store failure > "a mutate that throws leaves the in-memory store unchanged": API absent (`store.settle(mutate)`).
  Covered by wave A "store contract (%s) > transact is atomic: a throw or an invalid write commits nothing".
- content-free rows > "the file store never writes the person id or message text", "the Firestore store never writes
  the person id or message text": covered by wave A "eval rows and posteriors are content-free (%s)" on all three
  stores. "strict schemas reject extra keys and malformed person keys": different schemas; covered by wave A "strict
  schemas reject extra keys and inconsistent rows".
- file store > "persists across instances with private file and directory modes": covered by wave A "writes 0600 in a
  private directory and reloads in a second instance".
- Firestore store > "uses exactly the two default collections and Date fields for TTL": contradicts wave A (plain
  numbers, full rows, configurable collections). See the TTL note above.
- Firestore store > "deleteScope loops past the 400-row batch size": covered by wave A "pages batch deletes across more
  than 400 rows".

Assertions dropped from the kept cases:

- pins: `language: 'auto'` pinning the persona default, and a reset preference pinning the persona default with source
  `reset`. Wave A: `auto` and resets never pin, and there is no `reset` source.
- explicit request: `'listening'` mapping to `{}`. Wave A maps it to `{ length: 'brief', closingQuestion: 'no' }`.
- reward: a non-corrective follow-up alone scoring 1 (wave A: null, reply-rate alone never learns);
  `voice_reciprocated` scoring 1 (wave A: 0.5); the separate `correction_phrase` kind (wave A callers send a
  `follow_up` with `corrective: true`); main's exact positives/negatives lists; `corrective: 'unknown'`.
- correction phrases detected by main but neutral in wave A: "try again", "you misunderstood", "اشتباه متوجه شدی",
  "اشتباه‌متوجه شدی", "منظورم‌این نبود". Not flagged by main but corrective in wave A (correction wins, documented):
  "no problem", "no worries, thanks", "نه ممنون".
- decay: `updatePosterior` and the `MAX_EVIDENCE` total-evidence cap (wave A clamps each parameter at
  `MAX_BETA_PARAM`), and `updatedAt` preservation (wave A's `decayBeta` has no timestamp).
- `choice.propensity` (wave A logs propensities on the evaluation row only).
- settle with a false gate never calling the store: wave A calls `transact` and marks the exposure settled with reward
  null (`not_allowed`).
- settle returning `store_error`: wave A's `settle()` rethrows store errors, and the exposure stays settleable.
### Main-lineage hardening ported into wave A's code (fix-ups from the S14 verifier, landed with the S10L merge)

- `procedural.ts` `choose()`: re-runs `authorize(scope)` immediately before `recordExposure`, so a withdrawal that races
  `choose()` leaves no evaluation row behind (main's second gate check). Main's "a gate that flips to false before the
  write records nothing" is now kept in `procedural.main-lineage.test.ts`.
- `procedural-store.ts` `FileReplyStyleStore`: `load()` opens the store with `O_RDONLY | O_NOFOLLOW`, checks
  `fstat().isFile()` and reads from the descriptor (a symlink fails closed with `invalid_reply_style_store`); `write()`
  unlinks a stale `${path}.tmp` under the lock and creates it with `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` (0600),
  and removes the temp file when the write or rename fails. Main used a random temp name; wave A keeps the fixed
  `${path}.tmp` name under the mkdir lock.

## S10L: identity confidence library (wave A `b278780`, aiq/identity-lib `b34b7c0`)

Main merged an earlier run of the same spec (`80252dd`, `ecef502`, `09f3005`, `33db2d8`, `a44f5d4`, `afa2245`, `a74af6a`,
`83848b7`, merged by `b892138`), plus the `8a7dc55` hint-isolation hunk that allows `voice-band` importers. Neither side
wires the library. The only production importers of `src/lib/tireh/identity` are the S11L consumers of the shared
`voice-band.ts` contract (`studio/identity/voice.ts`, `studio/identity/net-speech.ts`, `tireh/gateway.ts`).
`voice-band.ts` is byte-identical on both sides and after the merge (sha256 `b8d0a41d…21bd`).

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/tireh/identity/{fusion,index,profile,store,style-features,test,types}.ts` | Wave A's files. `index.ts` holds `IdentityConfidenceService`. |
| `src/lib/tireh/identity/service.ts` | Deleted (main only; `StyleIdentityService`). Wave A's hint-isolation (d) pins the directory to the eight wave A sources. |
| `src/lib/tireh/identity/__tests__/{content-free,hint-isolation,profile,sequential-test,service,style-features,voice-band}.test.ts`, `style-fixtures.ts` | Wave A's files. Portable main-lineage cases moved to `*.main-lineage.test.ts`. |
| `src/lib/tireh/identity/__tests__/fake-firestore.ts` | Wave A's 70-line fake (used by wave A's `content-free`, `store` and the identity main-lineage tests). |
| `src/lib/studio/__tests__/fake-firestore.ts` | New: main's 122-line identity fake, byte for byte (`runTransaction`, `batch`, `<=` filters). |
| `src/lib/studio/__tests__/{circles-dm,pet-store}.test.ts` | Import path only: `./fake-firestore`. `FirestorePetStore.update` needs `runTransaction`. |
| `src/lib/tireh/identity/__tests__/{fusion-caps,stores}.test.ts` | Deleted (main only). Portable cases moved to `fusion.main-lineage.test.ts` and `store.main-lineage.test.ts`. |
| `docs/implementation/agent-intelligence/S10L-identity-lib.md` | Wave A's spec. Main's earlier-run spec (`StyleIdentityService`, persona-keyed profiles, CUSUM test) is superseded. |

### Main-lineage cases kept (adapted to wave A's API)

API renames are listed in each file's header (`StyleIdentityService` -> `IdentityConfidenceService`, `assessIdentity` ->
`fuseIdentity`, `forgetPerson` -> `forget`, `recalibrate` -> `applyFairness`, `giniCoefficient` -> `gini`,
`styleProfileDocId(key)` -> `profileDocId(personId, space)`, `foldFeatures` -> `observeProfile(styleVector(...))`,
`isScorable` -> `profileReady`). Wave A stores a profile only after `enroll()`, so service cases enroll first.

- `hint-isolation.main-lineage.test.ts`: all nine main cases (runtime: hint keys spread into the identity context,
  identity-confidence keys at the top level, a hint never standing in for a verified person, `assess` never returning
  identity or person fields; source tree: the scanned sources (wave A's eight), adaptive imported only as types from
  `adaptive/types`, no authorization or verified-identity API, the adaptive policy free of identity-confidence imports
  and hint fields, and the library unwired except for the shared voice-band contract). This keeps `8a7dc55`'s intent
  and catches dynamic imports and `require()`, which wave A's (d) does not at `b278780`.
- `fusion.main-lineage.test.ts`: "covers the whole product"; "never raises the level above the base"; monotonicity
  for every signal except a voice MATCH; "never lets style alone reach inconsistent"; no-opinion and too-few-message
  evidence ignored; `speakerLabel` never read and `claimedPersonId` never changing a negative band; "returns frozen
  objects with exactly four keys"; "gives unverified for an empty or invalid account person" (undefined, 42, null,
  '', '   ', `verifiedRecently: 'yes'`); `IDENTITY_LEVEL_RANK` frozen and ordered.
- `service.main-lineage.test.ts`: "implements the IdentityService contract"; "stores nothing without personalization
  consent and deletes existing rows"; "discards statistics on an epoch bump"; "rejects invalid features without
  touching the store"; "never rejects when the store throws"; forget across both spaces; enroll "refuses and deletes
  rows without consent", "is idempotent and resets statistics", input validation; verifyVoiceNote "never calls the
  verifier for groups or guest audiences", "returns disabled without a verifier", verifier failures and a pre-aborted
  signal, "passes a verifier result through unchanged"; "records nothing without a row".
- `content-free.main-lineage.test.ts`: "never stores, returns or logs message text" on the in-memory, file and Firestore
  stores, with main's scan for every 4+-character fragment of every input word in features, results, stored bytes and
  logs, the string-path check on stored rows, and id-free single-argument logs.
- `profile.main-lineage.test.ts`: "halves weight every 90 days"; "scores only from 50 messages"; "accepts trained
  profiles"; "rejects extra keys and non-finite numbers"; "never mutates its input".
- `sequential-test.main-lineage.test.ts`: "computes the Gini coefficient" (the four value assertions).
- `store.main-lineage.test.ts`: deterministic hex document ids that differ by space; "writes the file with mode 0600
  and drops invalid rows on load"; "stores plain numbers in Firestore and never undefined" (with the invalid document
  deleted on read).
- `style-features.main-lineage.test.ts`: "does not throw on lone surrogates"; empty or whitespace-only text; "bounds
  the work on a 100k-character input"; "returns objects without strings except the kind".

### Main-lineage cases and assertions not kept

`fusion-caps.test.ts`:

- "never raises ... log-odds above the prior": contradicts wave A, where a well-formed voice MATCH about the account
  person is +1 evidence above the prior (`capped` set, level still at the ceiling). The level half is kept.
- "is monotonic" for a voice MATCH: contradicts wave A (a MATCH can lift a style-uncertain session back to consistent,
  never above the ceiling). Kept for every other signal.
- "treats inconsistent style like uncertain": contradicts wave A (`STYLE_LOG_LR` −3 versus −2).
- "ignores short, non-voice-match ... evidence": contradicts wave A, which applies a negative band whatever the net
  speech or the hint source (fail toward disclosing less) and does not check `netSpeechMs` on a MATCH. The no-opinion
  and too-few-message halves are kept.
- "never reads claimedPersonId" for a MATCH: contradicts wave A, which drops a MATCH whose `claimedPersonId` names
  someone other than the account person.
- "gives the documented defaults": contradicts wave A's constants (priors 6 and 3, voice +1/−2.5/−6, style −2/−3).
  Covered by wave A "identity fusion" (c), (g), (h).
- "caps style-only evidence even with extreme weights", "validates weights": API absent (`FusionWeights`,
  `validateWeights`). Covered by `STYLE_MAX_DROP` and wave A (d).
- "gives unverified for an empty or invalid account person": the exact fallback object for '' and '   ' (wave A: level
  unverified, `capped: false`) and the 201-character id (wave A has no length cap and gives `account`).
- "rank helpers > returns the lower of two": API absent (`lowerLevel`, `lowerSession`, `SESSION_RANK`).

`stores.test.ts` (each of in-memory, file, Firestore):

- "gets, creates, updates and deletes through update", "applies concurrent updates": API absent (`update(key, fn)`,
  `delete` returning a boolean). Covered by wave A "(a) gets, puts, deletes, lists and sweeps" and "serialises
  concurrent writes".
- "rejects a key mismatch and invalid rows without writing": API absent (key mismatch on `update`). Covered by wave A
  "(b) rejects anything outside the strict profile shape and writes nothing".
- "deletes by person across personas and spaces, and by persona": API absent (persona-keyed rows, `deletePerson`,
  `deletePersona`, `listPersona`, `listPerson`). Covered by wave A (a) `deleteAllFor` and the kept forget case.
- "sweeps expired statistics and deletes rows past retention": contradicts wave A (main reset statistics after 7 days
  and deleted after 90; wave A deletes profiles idle for 180 days).
- "derives deterministic 64-hex document ids": wave A ids are 40 hex characters; the persona-concatenation check needs
  persona keys (API absent).

`service.test.ts`:

- "gives no hint before 50 messages and a session-count hint after": contradicts wave A (hints from the fifth message
  of a session). Covered by wave A (e).
- "resets statistics after 7 days of absence and keeps the calibration": contradicts wave A (30-day re-baseline that
  caps weights). Covered by wave A profile (e).
- "never learns from a session that ends uncertain": main's `personA`/`personB` fixtures are not in wave A. Covered by
  wave A (f) "never trains the owner profile from a flagged session".
- "folds consistent sessions with a 5-message lag": contradicts wave A (every unflagged message folds immediately).
- "bounds the in-process session map": API absent (`maxSessions`, `activeSessions`); wave A bounds at `MAX_SESSIONS`.
- "forgets a person and purges a persona": `purgePersona` and persona keys absent; the forget half is kept.
- "discards statistics on an epoch bump": main restarted the row at the new epoch; wave A deletes it (kept as such).
- "rejects invalid features without touching the store": the `invalid_input` log events (wave A logs nothing there).
- "is idempotent and resets statistics while keeping the calibration": keeping the calibration contradicts wave A
  (enroll is a full re-baseline that also clears `falsePrompts`, `selfScores` and `disabled`).
- "creates nothing when no row exists": contradicts wave A (only `enroll()` creates a profile).
- "maps verifier failures and aborts": an abort during a hanging verifier (wave A awaits the injected verifier, which
  owns the signal), the `verifier_timeout` log code, and a `null` input (wave A answers `provider_error`).
- "raises the threshold and mutes hints for 7 days on a false prompt", "keeps the threshold on a true prompt and keeps
  the session uncertain": contradict wave A (a per-person quantile threshold, no mute window; `other_person` pins the
  session inconsistent). Covered by wave A (h).
- "records nothing without consent": API absent (no `personalizationAllowed` on `recordPromptOutcome`).
- "recalibrates with counts only and persists disabled": API absent (`recalibrate`). Covered by wave A (i).
- "assess > delegates to the fusion with the configured weights": API absent (weights). Covered by wave A "assesses
  through the capped fusion".

`content-free.test.ts`: "rejects rows carrying text before anything is written" (API absent: `update`; covered by wave
A store (b)) and "file store load filter > drops a row with an extra key on load" (covered by wave A store "(c) returns
null for a missing file and drops a corrupt row on read").

`profile.test.ts`: "weights an observation 90 days old at one half", "keeps categorical counts summing to the weight",
"does not move text-only keys on voice messages or voice duration on text", "resets statistics but keeps the
calibration", "starts empty profiles with the default calibration", "smooths Bernoulli and categorical estimates": API
absent (main's keyed Gaussian, Bernoulli, categorical and calibration statistics); covered by wave A profile (c), (g)
and "starts as an empty, valid, content-free profile". "needs a re-baseline on epoch, version or 7 days of absence" and
"deletes rows 90 days after the last activity": contradict wave A (30 days; 180 days). "floors the Gaussian variance":
covered by wave A (f). The nested-key schema cases need main's nested statistics (API absent).

`sequential-test.test.ts`: "never decides on one message" (main reported `consistent` before five messages; wave A
reports no decision; covered by wave A (a)); "flags every impostor session within 5 to 10 messages", "never flags the
person on 500 held-out messages", "gives no evidence from an unscorable profile", "keeps uncertain sticky within a
session and resets after the gap", "is deterministic" (main's CUSUM API and fixtures; covered by wave A (b), (d), (f),
(g), (h)); "never returns inconsistent and ignores non-finite evidence" (contradicts wave A: inconsistent at twice the
threshold, and a non-finite LLR counts as −4); the Gini RangeError assertions (wave A's `gini` does not throw); the
false-prompt budget cases and both `autoDisable` cases (API absent; covered by wave A (e), (g), (j)).

`style-features.test.ts`: the Persian, English and Finglish measurement cases, the bucket, timing and modality cases and
the schema cases use main's nested feature shape (`modality`, `text` block, NFKC, 30 Finglish markers, 60 s follow-on);
covered by wave A (a)–(m) and "rejects anything that is not exactly a feature set". "treats a ZWJ family emoji as one
grapheme": covered by wave A (f). "puts every ratio on the 0.05 grid": covered by wave A (l) (`quantize` absent). "never
throws on hostile input and returns a frozen zero vector of the modality" and the frozenness half of "returns frozen
objects": contradict wave A (results are not frozen, and a throwing `text` getter propagates; wave A guarantees no
throw on hostile Unicode). The prefix-equality half of the 100k case (wave A caps UTF-16 units, not graphemes).

`voice-band.test.ts`: both cases are in wave A's single case (same sha256, `MIN_NET_SPEECH_MS` 3000).

### Open issues carried

- QA F025 (open): S10L persists a per-person style profile, against section 4.9 phase 0. Known wave A deviation; it is
  unwired and only created by an explicit `enroll()` under `optional.personalization`.
- Wave A's `extractStyleFeatures` does not catch a throwing property getter on its input (main's did). Callers pass
  plain objects; harden at wiring time.

## S09: decision pre-pass v2 (wave A `6cbe4bc`, aiq/prepass-v2-r2): main-lineage cases not kept

Recorded with the S06 merge (verifier finding on S09). No code changed. The S09 merge took wave A's r2 versions of
`decisions-log.test.ts`, `decisions-calibration.test.ts`, `decisions-service-decider.test.ts` and
`decisions-triage-v2.test.ts`. On main these four files were byte-identical to `c6e8ab6`; the merge removed the main
cases below (describe > it), besides the `decisions-catalog-lint.test.ts` cases recorded with that merge.

`decisions-log.test.ts` (covered by wave A `decisions-log.test.ts` and `decisions-gateway-log.test.ts`):

- "round-trips `at` as a Date" and "filters since <= at < until, sorts ascending and applies limit": same names in wave A.
- "sweeps rows older than 90 days": wave A "sweep removes rows strictly older than 90 days, keeps the row at the cutoff
  and returns the count".
- file decision-log store > "creates the file with mode 0600, survives a reopen and skips a corrupt line": wave A
  "creates the file with mode 0600, skips a corrupt line, and keeps 0600 after a sweep".
- Firestore decision-log store > "uses the vox_decision_log collection and drops invalid stored rows": wave A "writes to
  vox_decision_log with `at` as a Date and drops invalid stored rows".
- decision-log sink > "does nothing while TIREH_DECISION_LOG is unset" and "appends a valid row when
  TIREH_DECISION_LOG=1": wave A "with enabled() false nothing is appended" and "the default enabled() reads
  TIREH_DECISION_LOG on every record()". "a rejecting append warns and record() does not throw": wave A "a rejected
  append gives onError(append_failed) and record() does not throw". "a throwing store never escapes record()": wave A "a
  synchronously throwing store or onError never escapes record()". "sweeps at most once per sweepEveryMs": same name in
  wave A.
- recordTriageDecision > "sets the question-set version from the questions sent and the flag", "keeps only asked
  questions and catalogue values, and never the text", "null answers give unknown/threw and {} gives unknown/empty;
  detail reason wins", "never throws, even when the sink does": API absent (wave A builds rows with `decisionLogRow`).
  Covered by wave A "never carries the message, persona name or skill id", "drops choices outside the catalogue and
  non-catalogue probabilities", "outcome and unknownReason: failed, detail unknown timeout, and empty answers" and the
  gateway-log cases. Wave A reports a thrown decider as `decider_error`, not `threw`.
- gateway decision log > "a private turn logs exactly one content-free row", "a group turn logs chatKind group", "a
  throwing decider logs unknown/threw/untriaged and still reports triage_failed", "a throwing sink, or no sink, still
  delivers the reply", "with a ServiceDecider the row carries inputTokens and the service elapsedMs": wave A
  `decisions-gateway-log.test.ts` "a private text turn produces exactly one content-free row matching the questions
  sent", "a group message logs chatKind group with no member names or chat ids", "a throwing decider logs unknown
  decider_error; ...", "a sink whose record throws leaves the reply unaffected", "without a sink decideDetailed is never
  called ..." and "with a ServiceDecider the row carries elapsedMs and inputTokens from the detail".

`decisions-calibration.test.ts` (11 cases; API absent: main's `calibrationReport`, `formatCalibrationReport`,
`parseDecisionLogJsonl` became wave A's `computeCalibration`, `formatCalibration`, `parseLabelsCsv`):

- calibrationReport: predicates > "computes exact precision and recall per language at 0.2, 0.5 and 0.8", "gives a null
  precision when nothing is predicted positive", "counts unanswered rows and excludes them; marks blocks under 200
  insufficient; ignores unjoined labels", "a CSV language column overrides the row label", "is not insufficient at 200
  examples": wave A "predicate memorable: exact tp/fp/fn, precision and recall per language", "defaults to thresholds
  0.1..0.9 and counts unmatched labels without exposing them", and the `support n/200` gate lines.
- calibrationReport: choices > "scores one-vs-rest per value from probabilities, falling back to confidence for the
  chosen value": wave A "choice route = smalltalk: exact tp/fp/fn per language".
- parsing > "rejects a bad label, an unknown catalogue value and a bad header with the line number", "accepts skill ids
  and other catalogue-shaped values for questions without a fixed catalogue", "parseDecisionLogJsonl skips malformed
  lines and rows that fail the schema": wave A "accepts 0/1/true/false for predicates (normalised) and catalogue values
  for choices"; stored rows are schema-checked by the log stores ("drops invalid stored rows").
- formatCalibrationReport > "prints a fixed-width table without row ids", "says so when nothing joined": wave A "prints a
  TSV table and support n/200 gate lines per question and language, never row ids" and "a lower gate is reported as met".

`decisions-service-decider.test.ts`:

- studioDecider > "unset returns the identical fallback object", "service without OPENAI_API_KEY returns the fallback",
  "any other value returns the fallback": wave A `decisions-runtime.test.ts` "flags unset: the decider is the base
  OpenAIMedia (no decideDetailed) and there is no decision log", "STUDIO_DECIDER=service without OPENAI_API_KEY keeps no
  decider", "STUDIO_DECIDER=service with STUDIO_DECISIONS=off keeps no decider".
- ServiceDecider unknown outcomes give {} > "a service that throws gives {} with reason threw": **contradictory by
  design**. Wave A "a service that throws gives {} with reason provider_error and elapsedMs from options.now".

`decisions-triage-v2.test.ts` (all four contradictory by design for the chosen implementation):

- v2 question set > "reads the set from TRIAGE_QUESTION_SET at call time": main's pure `triageQuestions` default
  follows the flag. Wave A "triageQuestionSetNow reads TRIAGE_QUESTION_SET at call time; the pure default stays v1".
- readTriage under v2-live > "route correction at 0.6 or explicit_correction at 0.6 makes the message memorable; 0.4
  does not" and "route smalltalk at 0.7 makes effort quick; at 0.5 it stays thoughtful": the v2-live route-correction
  threshold moves from main's 0.5 to wave A's 0.6. Wave A "thresholds are 0.6 and 0.5", "route smalltalk at 0.6 makes
  effort quick; at 0.59 nothing changes", "route correction at 0.6 or explicit_correction at 0.5 makes the message
  memorable; below does not".
- readTriage under v2 (shadow) > "has no v2 key without v2 answers, and v2 answers never rescue an invalid v1 result":
  main omits an empty `v2` key; wave A always sets it under v2. Wave A "set v1 has no v2 key; v2 without v2 answers has
  an empty v2; v2 never rescues an invalid v1 result".

## S06: memory record v2 and retrieval (wave A `0ba3de6`, aiq/memory-v2-retrieval-2 `1bef816`)

Main merged an earlier run of the same spec (`e1d76cf`, `a45de43`, `eb48243`, `80881de`, `daac12d`, `7014326`, `4620bd3`,
`d7d5d10`, `2849f1b`, `9a6751e`, merged by `7c74019`), then `8a7dc55` added the committed-counter `local()` probes to the
file store. Nothing outside the module calls a main-only export (`UNKNOWN_REVISION`, `allowedScopeKeys`,
`isInvalidated`, `isExpired`, `createEmbeddingProviderFromEnv`, `EmbeddingRequestError`, `activeMemoryCache`).

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/tireh/memory/{retrieval,embeddings,record-v2}.ts` | Wave A's files. |
| `src/lib/tireh/memory/store.ts` | Wave A's file. Against `7224f40` only comments differ around Step 1: `revisionProbe`, `epochProbe`, `safetyRevision`, `lineageEventIds` and `StaleMemoryWriteError` are unchanged. Wave A replaces main's private `withoutSensitiveEmbedding` with `stripEmbeddingUnlessNormal` and validates tombstone ids (`assertTombstoneIds`). |
| `src/lib/tireh/memory/firestore-store.ts` | Wave A's body (`stripEmbeddingUnlessNormal`, injectable `vectorValue`, vector patch in `update`/`updateIfShareVersion`), with Step 1's `RevisionProbe` import and `revisionProbe`/`epochProbe` exactly as on main. Main's two `findNearest` guards are kept as defence in depth: no Firestore query unless `tirehFlags().vectorRetrieval`, and rows that are not normal sensitivity are dropped. |
| `src/lib/tireh/memory/file-store.ts`, `src/lib/tireh/types.ts` | Auto-merged to main's text, which already holds wave A's date keys, the union wrap lists (mutations `add`, `addIfEpoch`, `update`, `updateIfShareVersion`, `delete`, `invalidate`, `addTombstones`; reads `get`, `listActive`, `safetyRevision`, `revisionProbe`, `tombstonesOf`; history `recent`, `getEpoch`, `epochProbe`) and `8a7dc55`'s `local()` committed rereads. |
| `firestore.indexes.json` | Wave A's file (same index as main, expanded formatting; the `vox_audit` composite arrives with a later step). |
| `docs/implementation/MEMORY_RETRIEVAL_RESULT.md` | Base content plus wave A's S06 section; main's S06 follow-up section is replaced. |
| `docs/implementation/agent-intelligence/S06-memory-v2-retrieval.md` | Wave A's spec. |
| `src/lib/tireh/__tests__/memory-v2-{embeddings,firestore,record,retrieval,stores}.test.ts`, `negative-identity.test.ts`, `memory-eval/memory-eval.test.ts` | Wave A's files. `memory-v2-firestore.test.ts` "FirestoreMemoryStore.findNearest" now sets `TIREH_RETRIEVAL_V2=1` and `TIREH_VECTOR_RETRIEVAL=1` for the kept store gate and gains two cases: "makes no Firestore call while the vector flag is off" and "drops a non-normal row even when the index returns it". |
| `src/lib/tireh/__tests__/memory-eval/dataset.ts` | Deleted (main only, orphaned by wave A's eval). |
| `src/lib/tireh/__tests__/*.main-lineage.test.ts` (six files) | New: main's passing cases (see below). |

### Main-lineage cases kept

- `memory-v2-record.main-lineage.test.ts`: memoryV2 defaults (legacy record per type, type defaults, keeps valid v2
  values, invalid importance NaN / '7' / Infinity, importance bounds 1 and 10, invalid dates, enum values and counts);
  contentHash (both cases).
- `memory-v2-stores.main-lineage.test.ts`: every case except the tombstone union case below (InMemory and file store).
- `memory-v2-firestore.main-lineage.test.ts`: memoryFromDoc, writes, findNearest (including "flag off returns [] without
  touching Firestore" and "filters out personal and superseded docs even if the index returns them", which the kept
  store guards satisfy) and "firestore.indexes.json > declares exactly the contract vector index". That last case
  asserts the whole file; when wave A's `vox_audit` composite index lands, narrow it to the `tireh_memories` entry.
- `memory-v2-embeddings.main-lineage.test.ts`: cosine (both), "is deterministic, unit norm and sized as configured",
  "sends dimensions only when configured", "maps shuffled response indexes back to input order", "an aborted signal
  rejects".
- `memory-v2-retrieval.main-lineage.test.ts`: v1 parity over 200 seeded fixtures, mode resolution, tokenize (Arabic
  keyboard folding; diacritics, digits and stopwords), v2 fusion (3), v2 rescoring order (4), suppression by cosine and
  by contentHash, v2 final gate (3), v2 purity, "ActiveMemoryCache > returns null above maxRecords or for mixed
  personas", and vectorCandidates "flag off gives [] with zero store calls", "a throwing store or a store without
  findNearest gives []", "no keys means no call", "candidates still go through the final gate" with the arguments
  reordered to wave A's `(store, org, personaId, chat, vector)`. The fusion embedder drops the main-only `tokenizer`
  option, which wave A's fake ignored at runtime.
- `negative-identity.main-lineage.test.ts`: all three canary families in all three flag states (210 cases), with main's
  `evalOrgConfig` inlined, the `activeMemoryCache` reset and `tokenizer` option dropped, and `vectorCandidates`
  arguments reordered.

### Main-lineage cases not kept

- `memory-eval/memory-eval.test.ts` (whole file; depends on the deleted `dataset.ts` corpus): memory eval dataset guard >
  "has exactly 100 questions with the documented category counts and a ~50/50 language split", "has 70-90 memories,
  about half Persian, about half with v2 fields, all scope kinds and sensitivities", "has at least 10 FA queries the v1
  tokenizer cannot match", "references only known memories; expected rows are readable by the asker; blocked rows are
  not expected", "embeds only normal-sensitivity records"; memory eval results > "leakage is 0 in mode %s" (each mode),
  "v2 never returns blocked rows for update, temporal and abstention", "v2 recall@8 >= v1@8 overall and per language",
  "FA v2 lexical recall@8 is strictly better than FA v1@8", "v2 with a query embedding reaches recall@8 >= 0.8 overall
  (synthetic tripwire, not a quality claim)", "the flag-default path equals explicit v2 lexical", "returns at most 8 rows
  per question in every v2 mode". Covered by wave A's eval ("never leaks in any mode, ...", "v2 never returns
  invalidated or expired records", "meets the v2 lexical recall@8 gates and beats v1", "returns at most 8 memories per
  question in v2", fixture sanity cases).
- `memory-v2-record.test.ts`: "invalid importance %s falls back to the type default" for 0, 11, 3.5 and -1:
  contradictory (wave A clamps finite values into 1..10 and rounds; wave A "clamps or falls back for out-of-range
  importance"). "never mutates the input" and isInvalidated / isExpired > "legacy records are neither invalidated nor
  expired", "invalidatedBy alone invalidates", "invalidatedAt boundaries: past and == now invalidate, future does not",
  "expiresAt boundaries: past and == now expire, future does not": API absent (`isInvalidated`, `isExpired`); wave A
  checks the boundaries inside retrieval ("suppresses expired, invalidated, superseded and replaced records"). Main's
  "invalidatedBy alone invalidates" is contradictory: wave A requires `invalidatedAt <= now`.
- `memory-v2-stores.test.ts` and `memory-v2-firestore.test.ts`: "tombstonesOf/addTombstones: sorted union, idempotent,
  revision unchanged" (InMemory and file store) and tombstones > "tombstonesOf/addTombstones round-trip with the revision
  unchanged": contradictory. Main silently drops an empty id; wave A rejects it with `TypeError` (ids are non-empty and
  at most 512 characters). Wave A "adds tombstones as a sorted, idempotent union without a revision bump or record
  removal" and "FirestoreMemoryStore tombstones > reads and unions tombstones in tireh_memory_state without changing
  revision".
- `memory-v2-embeddings.test.ts`: FakeEmbeddingProvider > "keeps the zero vector for text with no tokens" (contradictory:
  wave A hashes trigrams of the padded text), "counters hold counts only, never text", "throws failWith when set",
  "accepts a custom tokenizer" (API absent; wave A "is deterministic and unit-norm, and counts calls without storing
  text"); OpenAIEmbeddingProvider > "sends the documented body to /embeddings and makes no request on construction",
  "batches 300 inputs into 3 sequential calls of at most 128", "embed([]) makes no call; a blank string throws before
  fetch", "a 500 rejects after exactly one fetch call, with no input or key in the error", "throws
  embedding_dimension_mismatch" (contradictory body, batch size 256, `EmbeddingError` and the codes `embedding_failed`
  and `embedding_shape`; wave A's OpenAIEmbeddingProvider cases); embedMemory > "returns null for personal,
  confidential and blank records without calling the provider", "embeds normalised content only and returns model,
  version and hash" (contradictory on blank and untrimmed content only; personal and confidential return null on both
  sides; wave A's embedMemory cases); createEmbeddingProviderFromEnv > all three cases (API absent; wave A "reads
  OPENAI_EMBEDDING_MODEL in the constructor").
- `memory-v2-retrieval.test.ts`: tokenize > "handles ZWNJ prefixes and plural suffixes", "stems English plurals
  conservatively and keeps short codes with digits" (contradictory: wave A emits the surface form and the stem); v2
  rescoring order > "relevance outranks the priors" (contradictory weights; wave A's RRF with K = 60 is documented in
  MEMORY_RETRIEVAL_RESULT.md); v2 suppression > "drops invalidated, expired and superseded-target records; keeps future
  expiry" (contradictory on `invalidatedBy` alone); ActiveMemoryCache > "hits for the same (persona, revision, set) and
  misses on a revision change", "add() without a revision bump misses via the fingerprint; update() misses", "evicts
  least-recently-used personas beyond maxPersonas", "an owner-warmed cache gives an outsider zero invisible rows" (API
  absent: `stats()`, `maxPersonas`, the `activeMemoryCache` singleton; wave A's ActiveMemoryCache cases and the
  negative-identity suites); allowedScopeKeys > "member: private, groups, org, projects, companies and people sets from
  memories", "guest: only private and own groups; unknown person: none", "group: its own key; hasGuests group: none"
  (API absent; wave A's audienceScopeKeys cases; the people-set enumeration is contradictory, wave A never enumerates
  people scopes); vectorCandidates > "chunks 45 keys into 2 calls of at most 30 and merges duplicates" (contradictory:
  relies on people keys from `memories`; wave A "chunks more than 30 keys, dedupes by id and drops other-persona and
  superseded rows").

### Main-lineage hardening ported into wave A's code (fix-up from the S06 verifier, landed with the S08 merge)

- `src/lib/tireh/memory/embeddings.ts`: main's `logLevel: 'off'` on the OpenAI client is ported into wave A's lazy
  client (`new OpenAIClient({ apiKey, fetch, maxRetries: 0, timeout: 10_000, logLevel: 'off' })`), so the SDK never
  logs whatever `OPENAI_LOG` says. `memory-v2-embeddings.test.ts` gains "never logs through the SDK, even with
  OPENAI_LOG=debug, on success or failure" (fails without the option: the SDK made 9 console calls).

### Open issues carried

- `FirestoreMemoryStore.updateIfShareVersion` spreads `snapshot.data()`, so Timestamp fields become maps on both sides
  (known before this merge).
- Tombstone additions do not bump the memory revision (wave A invariant), so Step 1 probes are unaffected.

## S08: sharing v2 and audit (wave A `bedca98`, aiq/sharing-audit-r2 `0926957`)

Superset step: main merged the first run (`546f49e`, `acfc3a8`, `dba13f6`, the same commits wave A's r2 continues), and
`8a7dc55` changed only the older-adapter arm of two tests. Git found two merge bases (`0ba3de6` and `acfc3a8`). Main
touched nothing in S08's production code after `acfc3a8`, so wave A's r2 bodies of `inheritMemories`,
`resnapshotGroupMemory` and `memoryNoticesFor` auto-merged into main's `studio/service.ts` beside the Circles, Pet and
channel code, which is unchanged. `runtime.ts` was not touched by the merge and holds exactly one S08 audit block.

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/studio/__tests__/sharing-v2.test.ts` (conflict) | Wave A's file, plus wave A's post-S06 fix `ca4035b` (a `NoTombstoneStore` for the fail-closed arm, since S06's `InMemoryMemoryStore` now carries tombstones, and "carries tombstones with the real InMemoryMemoryStore once S06 is merged"). The file now equals the wave A branch tip. |
| `src/lib/studio/__tests__/sharing-v2.main-lineage.test.ts` | New: main's cases that pass against wave A's implementation and are not already in wave A's file (below). |
| `src/lib/tireh/__tests__/invariants.test.ts` | Auto-merged: wave A's r2 cases with main's `8a7dc55` older-adapter arm in (12) (`Object.defineProperties` on an `InMemoryMemoryStore`), which is equivalent to wave A's later `NoTombstoneStore`. |
| `src/lib/studio/service.ts`, `src/lib/studio/types.ts`, `src/lib/tireh/memory/sharing.ts`, `src/lib/tireh/audit/*`, `src/lib/tireh/policy/snapshot.ts`, `src/lib/adaptive/shared/service.ts`, audit and policy tests, the S08 spec | Auto-merged to wave A's r2. |

Checked after the merge: with `TIREH_SHARING_V2` unset `inheritMemories` keeps the base copy; with it set, a store
without `tombstonesOf`/`addTombstones` inherits nothing, tombstones are carried before any copy, and only
normal-sensitivity group, people and project records are copied. `resnapshotGroupMemory` keeps the admin check, the
approved-member and in-group checks, `canUseAgent` and the per-agent `blocked` list, and writes through
`updateIfShareVersion`. Neither touches Circles per-person notes: notes live in `CircleNotes` (`notesLedger`), not in
the memory store, and extraction never reads them.

### Main-lineage cases kept

`sharing-v2.main-lineage.test.ts`: "(a) org-bridge historyPolicy > maps the field only when it is set to a known value"
(an unknown value is dropped; key order), "(b) HTTP with the flags off > resnapshot is the base 404 and GET memories
has exactly the memories key", "(d) inheritMemories with the flag off > copies every record, private ones included,
exactly as at the base" (no `memory.inherit` entry), "(h) SharedMemoryService.readContext consent decoupling > flag
on: membership and the agent read grant are enough, and every other fence stays" and "> flag on: the product pause
still withholds shared context" (the real `ProductPauseService` on `ManagedFileV2Storage`).

### Main-lineage cases and assertions not kept

- "(c) HTTP with TIREH_SHARING_V2=1 > only admins re-snapshot, with validation, preview and apply": contradictory on the
  `StudioState.audit` entry (main `target: group:<chat>`, `detail: member <id>: <n> records`; wave A `target: <chat>`,
  `detail: <id>:<n>`). Wave A's "(a) group re-snapshot" cases cover the validation, preview, apply and idempotence.
- "(c) ... > a recipient sees a content-free notice after the owner privately corrects a shared record": contradictory
  notice shape (main `stillShared`; wave A `oldMemoryId`, `newMemoryId`, `replacementVisible`). Wave A's "(e)
  supersede notices" cases.
- "(e) inheritMemories with TIREH_SHARING_V2=1 > copies only normal group/people/project records, strips supersession
  and carries tombstones": contradictory on the `memory.inherit` audit entry (`copied 4, skipped 3`), which wave A
  does not write. Wave A's "(d) inheritMemories > TIREH_SHARING_V2=1" cases.
- "(e) ... > copies nothing when the store cannot carry tombstones" (`8a7dc55`): its fail-closed assertion is kept as
  wave A's "inherits nothing when the store cannot carry tombstones (fail closed)" with `NoTombstoneStore`; its
  `memory.inherit` detail `skipped: tombstones unsupported` is contradictory (wave A writes no inherit entry).
- "(f) re-snapshot vox_audit rows > records previewed and applied rows with the admin as actor and no content":
  contradictory on `policyKey: 'group.resnapshot.v1'` and `chatKeyHash`, which wave A's resnapshot rows do not carry.
  Wave A's "with TIREH_AUDIT_LOG=1 writes content-free previewed and resnapshot rows".
- Covered verbatim or as a subset by wave A, so not duplicated: "(g) group events never widen a snapshot" (wave A's
  "(b)" runs it for every historyPolicy and flag state), "(h) flag off: a recipient without optional.personalization
  sees nothing" (wave A's "(f) flag unset"), "(i) runtime wiring" (both cases; wave A's are supersets).
- `audit-decorator`, `audit-store`, `policy-differential` and `invariants` (1), (9), (10): the first-run cases were
  rewritten by wave A's r2 on top of the shared base `acfc3a8`, not by this merge. Run against the merged code, 9 of
  the first-run cases fail (contradictory row shapes and classifications), for example audit-store "normalizes arrays
  and rejects content-bearing or malformed rows" and audit-decorator "write, supersede, share_approve, revoke, denied,
  resnapshot (no row) and delete".

### Behaviour change on main

- With `TIREH_SHARING_V2=1` successor inheritance no longer writes `memory.inherit` entries to `StudioState.audit`, and
  a failing `addTombstones` now throws out of the hire step instead of being audited and skipped (no record is copied
  in either case). A non-tombstone `add` failure is rethrown instead of counted.

### Test results

- `npx tsc --noEmit -p tsconfig.json`: clean.
- Focused suites, flags unset (sharing-v2 and its main-lineage file, invariants, policy-differential, audit-*,
  service, circles-notes, adaptive/shared, memory-v2-embeddings): 239/239. One run had a load flake in circles-notes
  "rights > export returns only the requester's copies; forget me deletes only theirs", which passed alone three times
  and on the rerun of the whole set.
- Privacy core suites, flags unset: 623/623 across 30 files.
- `src/lib/studio`, flags unset: 11 failed, all environment or baseline: `guest-rights-http` (10, mkdtemp /tmp EPERM)
  and `prepared-conversation-qualification` (baseline timeout).
- `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` on invariants, policy-differential and `src/lib/studio`: 13 failed / 1540
  passed. By design: service.test "a successor inherits memories at hire time when the predecessor was fired with
  transfer" (as recorded in WAVE_A_INTEGRATION.md; wave A's `05a4520` pins the flag unset and arrives with TAIL).
  Environment: `guest-rights-http` (10). Load: `prepared-conversation-qualification` and circles-group "review fixes:
  closing, erasure, cards > forget me leaves no trace of the requester", both passing alone with the flags set.

### Fix-ups from the S08 verifier (landed with the S11L merge)

- `inheritMemories` (`src/lib/studio/service.ts`) no longer uses `instanceof StaleMemoryWriteError` (QA F135). A shared
  structural helper `isStaleMemoryWriteError(e)` in `src/lib/tireh/memory/store.ts` matches the class or the name, and
  `audit/memory-decorator.ts` `errorOutcome` uses it too. A tombstoned lineage whose error comes from another bundle
  copy is skipped again instead of failing the hire after the agent is marked active. New sharing-v2 case: "skips a
  tombstoned lineage whose StaleMemoryWriteError comes from another bundle copy (structural check)".
- `resnapshotGroupMemory` writes one `vox_audit` row per `MAX_AUDIT_IDS` (200) ids per agent, as main's parent did. The
  audit store keeps at most 200 ids per row and drops the rest without an error, so a re-snapshot over more than 200
  records per agent used to leave widened records out of the 'applied' trail. New sharing-v2 case: "with
  TIREH_AUDIT_LOG=1 splits an applied re-snapshot over more than MAX_AUDIT_IDS records into batches and loses no id"
  (201 records, two 'applied' rows, union equals all ids). The rows still carry no `policyKey` or `chatKeyHash`.

## S11L: voiceprint library (wave A `17ddf29`, aiq/voice-lib-r2 `ca7c27c`)

Superset step: main merged the first run (`ef3c8b3` via `7093ee7`); wave A's r2 continues it. After `7093ee7` main
changed only `voice.ts` and added `voiceprint-authority-races.test.ts` (`8a7dc55`), wired the local voice engine
mutually exclusive with voiceprints in `runtime.ts` (`c2c0bee`) and restyled the EnrollScreen consent checkbox
(`9e14d6f`). Everything else (identity/*, the voiceprint tests, http.ts, service.ts, the S11L docs) auto-merged to
wave A's r2, with main's Circles, Pet and channel routes in `http.ts` unchanged.

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/studio/identity/voice.ts` (conflict) | Wave A's r2 file (fingerprinted authority, track/abortInflight, selfEcho.templates, after-put recheck) with main's `8a7dc55` fence ported: a pure `decide()` over the direct authority controls shared by the transactional `authority()` and a new synchronous `authorityNow(telegramId, space, fingerprint, agentId?)` on `adaptive.readDirectAuthorityForEffect`. It is true only for status 'ready', the same fingerprint and `allowedVerify` (with an agent) or `allowedEnroll`. Called before `cipher.open` and at the start of each `untilAborted` export callback (before `speech.measure`, `provider.voiceprint`, `provider.identify`). Failure: `NO_OPINION('consent_missing')` in verify, `VoiceprintError(409, 'consent_changed')` in enroll. The adaptive Pick now includes `readDirectAuthorityForEffect`. The fingerprint carries the permission's `lastEventId` instead of the verified grant's event id (equal whenever a grant exists), so it can be computed from the evidence-free direct controls. |
| `src/lib/studio/__tests__/voiceprint-authority-races.test.ts` | Main's three assertions ported to wave A's fixtures (`selfEcho.templates` spy for `ensureEchoTemplates`/`listEcho`, `store.get` for the awaited lookup, `consent('work', 'withdrawn')`), each run with the chained invalidator and with the fence alone, plus "does not upload a voice note after consent is withdrawn during the echo lookup" (the listed risk) and a no-false-deny case. Without the fence 5 of the 10 cases fail. |
| `src/lib/studio/runtime.ts` (conflict) | Main's header (Circles, S11L; the thresholds line corrected to wave A's `{match,noMatch,selfEcho,channels?}`), main's `localVoiceIdentityOptions` and `VoiceIdentityService(..., localVoice.options)`, wave A's `createStudioVoiceprints` block with its `Promise.all` invalidator, `sweep` and `warmSelfEcho`. The `STUDIO_DECIDER` header line and the inline ServiceDecider block were already in place from S09. |
| `src/lib/studio/identity/index.ts` | `createStudioVoiceprints` takes an optional `flags` reader. Needed for the mutual exclusion: wave A's service reads `tirehFlags()` from `process.env`, so the masked `env` alone (`STUDIO_VOICE_RECOGNITION: '0'`) would not have turned it off. `runtime.ts` passes both the masked env and `flags: () => ({ voiceRecognition: false })` when `localVoice.selected`; `warmSelfEcho` runs only when `!localVoice.selected && tirehFlags().voiceRecognition`. New voiceprint-storage case: "a constant-off flag reader (runtime.ts, local voice engine selected) keeps voiceprints off with STUDIO_VOICE_RECOGNITION=1". |
| `src/app/studio/_components/screens/EnrollScreen.tsx` (conflict) | Wave A's r2 logic and EN/FA copy, with main's `9e14d6f` classes (`vx-privacy-checkbox` label, `vx-privacy-check` input). `npm run check:studio-style` passes. |
| `src/lib/tireh/gateway.ts` | Main's file with wave A's r2 `voiceVerifier` doc and shadow block shape; `guestAudience` stays `hasGuestAudience(this.deps.org, chat)` (strictly safer; the guest guard returns earlier). The `Promise.all` beside STT is still there; TAIL's `07ecb14` replaces it with fire-and-forget behind `STUDIO_VOICE_SHADOW` (QA F023/F036). |

### Main-lineage tests not kept

Deleted by the r2 lineage (its rewrite of the first run), recorded by name:

- `voiceprint-gateway.test.ts` (git pairs it as a rename with wave A's `voiceprint-guests.test.ts`): "gateway.transcribe
  shadow voice verification > verifies a private member voice note once, with content-free inputs", "> starts STT and
  verification concurrently and replies with the transcript unchanged", "> a rejecting verifier produces the same reply
  as no verifier", "> an addressed group voice note runs STT but never the verifier; a hasGuests group runs neither",
  "> without a verifier dependency the bot calls match a run without the field", "liveTurn stays untouched > liveTurn
  and converse never call the verifier", "> the liveTurn source and voice-call.ts contain no voiceprint verification".
  Wave A's `voiceprint-guests` and `voiceprint-liveturn` cover the gateway and live-turn paths.
- `voiceprint-net-speech.test.ts` ("opusNetSpeech" > six container-parsing cases): API absent; wave A measures net
  speech through the provider's `SpeechActivity`.
- `voiceprint-no-audio.test.ts` ("enroll and verify leave no canary in files, Firestore docs, logs or audit rows"):
  replaced by wave A's `voiceprint-storage` "no audio, transcript or score is persisted or logged".
- `voiceprint-store.test.ts` ("AesGcmVoiceprintCipher", "voiceprintCipherFromEnv", "FileVoiceprintStore",
  "FirestoreVoiceprintStore", "voiceprintConfigFromEnv" groups, 13 cases): API absent (echo rows, `voiceprintConfigFromEnv`,
  `AesGcmVoiceprintCipher`); wave A's `voiceprint-storage` covers the cipher, key, file and Firestore stores.
- `voiceprint-gates`, `voiceprint-http`, `voiceprint-verify`, `voiceprint-withdrawal`, `voiceprint-fixtures` and
  `EnrollScreen.test.tsx`: main's versions were the first run, untouched on main after `7093ee7`; they auto-merged to
  wave A's r2 rewrites.

### Behaviour change on main

- Voiceprint HTTP: the POST consent statement is `accepted` (was `enroll_my_voice`) and responses are
  `{ voiceprint: status }`; `unsupported_audio` is gone (wave A refuses through the provider). `VoiceprintStatus` gains
  `consent`; the reasons are wave A's codes.

### Open issues carried

- ~~Firestore storage with `STUDIO_VOICE_RECOGNITION=1` has no production refusal guard.~~ Corrected (fixer r1): the
  S03 merge `18d0415` restored it. `createStudioVoiceprints` takes `production` (runtime.ts passes `config.production`)
  and, with Firestore storage and the flag on, throws 'Voiceprints on Firebase require Cloud KMS envelope encryption'
  before any store is built (`voiceprint-storage.test.ts`, 'refuses Firestore in production with
  STUDIO_VOICE_RECOGNITION=1 until Cloud KMS exists…'). An invalid key, or one that reuses `STUDIO_SECRET`, still
  throws at startup. The one remaining difference from main: a `VOICEPRINT_KEY` that is missing while the flag is on is
  treated as off instead of failing startup.
- The local voice engine's `runtime-config.ts` reads `env.STUDIO_VOICE_RECOGNITION` directly (main's code, unchanged).

### Test results

- `npx tsc --noEmit -p tsconfig.json`: clean.
- Focused suites, flags unset (voiceprint*, EnrollScreen, runtime, runtime-pet-wiring, live-authority-expiry,
  relationship-turn-fence, VoiceRecognitionPanel): 226/226 across 15 files.
- `STUDIO_VOICE_RECOGNITION=1` voiceprint suites: 101/101. `npm run check:studio-style`: pass.
- Privacy core suites plus sharing-v2, audit-decorator and tireh/identity, flags unset: 783/783 across 48 files.
- `src/lib/studio`, `src/lib/tireh`, `src/app/studio`, `src/lib/adaptive/voice-identity`, flags unset: 18 failed, all
  environment: `guest-rights-http` (10, mkdtemp /tmp EPERM), `local-provider` (7, unix socket listen EPERM) and
  `prepared-conversation-qualification` (load timeout; passes alone, as does circles-group "forget me leaves no trace
  of the requester", which flaked once under load).

## S03: cache-stable prompt (wave A `aeeab39`, aiq/prompt-caching-r2 `ce37a8b`)

Main merged an earlier run (`fd1fc4e`, `a37fcc2`, `488958a`, then `33558b4` and `b23e090`). The merge commit `18d0415`
records the `prompt.ts` and `gateway.ts` resolutions (wave A's r2 layout with every `962e877` hunk re-applied; main's
`composeReply` and `liveTurn` with wave A's `placeTurn` in the cached arm) and the regenerated flag-off golden. This
section adds what that commit did not record (fixes from the S03 verifier, landed with the S12 merge).

### Resolution of the add/add files

`src/lib/tireh/llm.ts`, `src/lib/tireh/__tests__/fixtures.ts`, `src/lib/tireh/conversation/__tests__/prompt-layout.test.ts`,
`src/lib/tireh/__tests__/cached-prompt-gateway.test.ts` and `src/lib/tireh/__tests__/llm-blocks.test.ts` were resolved
to wave A's side (each is byte-identical to `aeeab39`).

### Correction: main's four flag-on wrappers

The S03 merge deleted four main-only wrappers by hand and recorded them as matching wave A's r2. Wave A never had these
files. Two are superseded: `cached-prompt-audience-boundary.test.ts` by `cached-prompt-suite-audience-boundary.test.ts`,
and `cached-prompt-memory-privacy.test.ts` by `cached-prompt-suite-memory-privacy.test.ts` plus the parity matrix in
`prompt-layout.test.ts`. The other two have no replacement and are restored unchanged from main:
`cached-prompt-gateway-suite.test.ts` and `cached-prompt-gateway-suite-tail.test.ts`, which re-run all of
`gateway.test.ts` under `TIREH_CACHED_PROMPT=1` with `TIREH_PROMPT_SYSTEM_TAIL` off and on (104/104).

### Main-lineage cases kept

The cases of main's earlier-lineage files that pass against wave A's layout are kept, unchanged apart from a header line:

- `conversation/__tests__/prompt-layout.main-lineage.test.ts`: 13 cases (Block A stability, routing and floor; Block B
  presence; Block C volatility, per-chat identity and the Conversation section; private memories and conflicts in the
  legacy format; the personal block; tag neutralization; block order and hashes; `buildSystemPrompt` unchanged).
- `__tests__/cached-prompt-gateway.main-lineage.test.ts`: 14 of main's 15 cases, among them "a hasGuests group caption
  reply carries only the caption and the per-turn block" and "serializes the tail last on the wire and keeps trailing
  text for live calls".
- `__tests__/llm-blocks.main-lineage.test.ts`: all 21 of main's cases.

### Replaced tests (earlier S03 lineage, `488958a`/`a37fcc2`/`fd1fc4e`) not kept

`prompt-layout.test.ts`:

- "pads deterministically and leaves long text unchanged": API absent (`padCacheBlock`; wave A has `padToCacheFloor`).
- "matches its snapshot" (Block A): contradicts wave A. Main's Block A ends with the turn note; wave A moves
  `TURN_NOTE` to Block C, so Block A ends at `</rules>`.
- "equals the Organization section of the legacy prompt and is stable across speakers and dates": contradicts wave A.
  Main asserted a 64-hex sha256 block hash; wave A's hash is 16 hex characters.
- "carries the extra frame and the hooks when given, and is unchanged without them": contradicts wave A. Block C ends
  with `TURN_NOTE`, not with the extra frame.
- "carries the date, speaker, format, skill, memories, conflicts, saved and relationship context, then the final
  reminder": contradicts wave A's per-turn header lines and their order.
- "clips long memories by code point and keeps short ones whole": contradicts wave A. Wave A clips at 209 code points
  plus "…" (main: 210), and conflicting memories are not clipped.
- "puts the turn on the last user message and one breakpoint on the previous assistant", "sets no breakpoint without an
  assistant message", "returns the tail in system-tail mode without trailing text", "adds a user turn when there is
  none": API absent (`attachTurnBlock`; wave A has `placeTurn`, which pushes an empty-content user turn for an empty
  history where main pushed `content=turn`). `prompt-layout.test.ts` covers `placeTurn`.

`cached-prompt-gateway.test.ts`:

- "puts no date, memory, saved context or per-turn text before the last cache breakpoint": contradicts wave A in its
  last assertion. The live call's final system block ends with `TURN_NOTE`, not with the live-call frame. The rest of
  its checks are covered by `cached-prompt-wire.test.ts`.

## S12: image ingestion (wave A `1a3437c`, aiq/image-ingestion `2bdb95f`)

Main merged an earlier run (`656c84f`, `a6141c3`, `134b572`, `ca56f47`, `9948fb9`, `bce2019`, `203d0c0`, `b0cbb7f`,
merged by `d99e3a5`). Wave A is the chosen implementation. At this sha wave A's gateway branch still ingests before
`boundary()` and keeps a process-only `peopleImageTurns` WeakSet. TAIL (`bfc9b39`, `19f3b37`, `6c90443`) moves the
download, triage and acknowledgement after the turn boundary and persists the `imageDerived` marks.

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/tireh/images/{bytes,index,questions}.ts` (add/add) | Wave A's files. `retention.ts` added from wave A. |
| `src/lib/tireh/images/policy.ts`, `select.ts` (main only) | Deleted. Only main's `images-policy` and `images-questions` tests imported them. |
| `src/lib/tireh/memory/extraction.ts` (conflict) | Wave A's file: `ExtractionOptions`, `IMAGE_PEOPLE_RULE` in the group-aware rules line, and the `IMAGE_PEOPLE_DESCRIPTION` candidate filter. Main's gateway caller already passed `{ imagePeopleRule }`. |
| `src/lib/tireh/telegram/client.ts` (conflict) | Main's file (Circles, Pet and channel additions unchanged) with only wave A's `downloadImage` body, which tolerates a missing `headers.get`. |
| `src/lib/tireh/gateway.ts` (conflict) | Main's file with wave A's S12 branch: `imageIngestionWanted` (flag, private chat, image present) then `validateAudience` before `ingestTelegramImage`. This replaces main's `addressed && (photo or document)` condition. The `peopleImageTurns` field is declared once, beside main's `groupWindow`. The extraction call uses wave A's form (`{ imagePeopleRule: true }` or `undefined`). `composeReply` keeps main's argument list (`action`, the `extras`) and gets `imageTurn?.images`. `groupWindow.record` stores `text`: images are private-only, so a group window never sees an image turn. The import line keeps main's `targetsSomeoneElse`. |
| `src/lib/tireh/__tests__/images-{bytes,fixtures,gateway,ingest,photo-size}` (add/add) | Wave A's files. In `images-gateway.test.ts`, the two decide-call equality checks compare the calls through a `decideCalls` helper. The helper reduces functions to a marker, because main's `8a7dc55` passes a per-turn authority object with closures to `decide`. Wave A's `a40e8f8` hunks for this suite are ported here, which `8fd2048` left for S12: `visibleText` reads the system, `trailingText` and `systemTail`, so the suite passes under `TIREH_CACHED_PROMPT=1`. |
| `images-catalogue-lint`, `images-client`, `images-extraction` tests | Added from wave A. |
| `images-telegram-client.test.ts` (main only) | Kept. 6/6 pass against the merged `downloadImage`. |
| `docs/implementation/agent-intelligence/S12-image-ingestion.md` (add/add) | Wave A's spec. |
| `docs/VOX_STUDIO.md` (conflict) | One "Photos (STUDIO_IMAGES)" section. It uses wave A's text, plus the acknowledgement wording and the people-in-photos sentence. The Persian paragraph is rewritten to match wave A's behaviour (acknowledgement «یک لحظه، دارم عکس را نگاه می‌کنم.»). |
| `docs/implementation/PRIVACY_AND_CONSENT.md` (conflict) | Wave A's `core.conversation` (images) purpose-map row replaces main's. Main's Circles `optional.group_memory` row is kept verbatim. The processor-table rows for Decisions image triage (F022) arrive with TAIL. |

### Risks checked

- Circles outsider DMs: new `circles-dm` case "STUDIO_IMAGES=1: an outsider's photo is never downloaded or triaged; a
  member's photo in the same harness is". It uses a vision-capable reply model, a `decideParts` decider and a
  `downloadImage` spy. A joined outsider's photo causes no download and no triage. A member's photo in the same
  harness is downloaded, which shows the gate is not vacuous. The outsider is refused at `validateAudience`, and
  `ingestTelegramImage` would also refuse on `hasGuestAudience` or `speakerId !== chat.personId`.
- Channel posts (`is_automatic_forward`, `sender_chat`): `resolveChat` gives a group context for every non-private
  chat. `imageIngestionWanted` requires `chat.kind === 'private'`, so a channel photo is never ingested.

### Main-lineage cases kept

Main's replaced add/add test files, with main's fixtures as `images-main-lineage-fixtures.ts`, keep every case that
passes against wave A's module:

- `images-bytes.main-lineage.test.ts`: "recognises JPEG and PNG by signature", "rejects GIF, WebP and text", "drops APP1
  Exif and COM segments and keeps SOI, SOF0, SOS and EOI", "is the identity on a JPEG without metadata".
- `images-photo-size.main-lineage.test.ts`: 5 `pickPhotoSize` cases (smallest size of at least 320 px, portrait edges,
  largest fallback, edge ties, no mutation).
- `images-ingest.main-lineage.test.ts`: 17 cases: 13 gate cases (flag values, non-images, pdf/webp/gif/undefined documents, group,
  foreign chat, guest speaker, oversize document, with the cap now `MAX_REPLY_IMAGE_BYTES`), "uses the caption as the
  turn text, else the placeholder", "accepts a PNG image document and strips its text chunks", "re-downloads at detail
  resolution for text extraction", "sends no acknowledgement for a fast triage".
- `images-gateway.main-lineage.test.ts`: flag undefined and '0' base behaviour (4), "handles a group photo exactly as
  with the flag off, with no download", "routes an explain image to the fast vision model without web search", "routes
  a remember image to the main model", both sensitive-document cases, "adds the people rule to extraction and keeps
  triage and bytes out of every prompt" (its fake reads `systemText(request.system)`; its follow-up assertions changed
  in TAIL), and, added in TAIL, both "no image bytes in any log (stage timings false/true)" cases with the
  `tireh_image:` log string: 12 cases.
- `images-main-lineage.test.ts` (from the deleted `images-policy` and `images-questions`): both `forceQuickTriage` cases,
  "reuses the text triage timeout", "reads a complete answer", and "returns null when image_task / contains_people /
  contains_sensitive_document is missing".

### Main-lineage cases not kept

- `images-policy.test.ts`: "stores nothing without triage and assumes people", "stores a remember task only below the
  sensitive threshold", "honours an explicit caption request and its negation", "flags people by kind or by a protective
  probability threshold", "forces the quick vision route for quick tasks, or whenever the main model cannot see",
  "matches English and Persian requests", "lets any negation win", "maps triage to a resolution tier", "acknowledges in
  Persian for a Persian caption and in English otherwise". API absent (`imagePolicy`, `explicitRemember`,
  `replyDetail`, `ackText`). Wave A's `suppressImageMemory`, `explicitRememberRequest`, `replyPhotoSize` and
  `imageAckText` are covered by `images-ingest` and `images-gateway`. Two of them contradicted wave A: people were
  flagged at 0.5, not at 0.3 or by kind, and a model that cannot see refuses the image instead of forcing the quick
  route. The first was a weakened privacy check, not only a contradictory threshold: fixer r2 on main (`cb51710`)
  ported main's rule as `imageShowsPeople()` (unknown triage, kind `photo_of_people` or `contains_people >=
  IMAGE_PEOPLE_THRESHOLD = 0.3`), pinned in `redteam-wave-a-main-r2.test.ts`. The vision refusal stays wave A's.
- `images-questions.test.ts`: "is question set image-v1 with exactly the four named questions", "passes the catalogue
  lint with no allowlist", "fits the base seam caps and describes every choice", "offers exactly the kinds and tasks"
  (API absent: `IMAGE_QUESTIONS`, `IMAGE_QUESTION_SET_VERSION`; covered by `images-catalogue-lint`); "carries the persona
  header and the JSON-quoted caption only", "caps the caption at 600 characters and says none without one" (API absent:
  `imageTriageText`; wave A's `imageTriageInput` has another format); "returns null when image_kind is missing", "returns
  null for unknown choices and out-of-range or NaN probabilities", "downgrades a low-confidence remember to unclear"
  (contradict wave A: a missing or unknown kind reads as 'other', an unknown task as 'unclear', probabilities are
  clamped, and the task confidence floor is 0.5, not 0.6).
- `images-bytes.test.ts`: "rejects truncated files, bad lengths, a missing SOS and a missing EOI" and "rejects IHDR not
  first, trailing bytes, unknown critical chunks and a missing IEND" (wave A throws `invalid_image` where main returned
  null); "drops tEXt and eXIf and keeps IHDR, IDAT and IEND" (wave A drops `pHYs`); the three `toLLMImage` cases (wave
  A's `toLLMImage(bytes, mime)` only encodes; sniffing and stripping happen in `fetchImage`).
- `images-photo-size.test.ts`: "uses the documented minimum edges" and "honours larger minimum edges" (API absent:
  `IMAGE_MIN_EDGE`; wave A has `TRIAGE_MIN_EDGE` and `replyPhotoSize`); "returns null for empty or all-invalid input and
  skips invalid entries" (contradicts: wave A accepts finite fractional dimensions).
- `images-ingest.test.ts`: the log-string cases "refuses a model without vision identity before downloading", "refuses
  Gemini as the only target before downloading", "logs one fixed string, never the error, when the download fails",
  "rejects a document whose declared type does not match its bytes", "keeps the small image when the detail download
  fails", "treats a rejected triage as missing", "times out a triage that never answers", "logs a failed acknowledgement
  with a fixed string" (contradict: wave A logs `tireh_image:<code>`, not main's `image_*` strings). Also "rejects bytes
  that are not a supported image" (main corrupts only the 800 px file; wave A triages from the 320 px copy and keeps
  it when the reply-size copy is invalid), "downloads the 800 px size
  once and never acknowledges without an image-capable decider" and "keeps the small image for a casual people photo"
  (wave A always fetches a reply-size copy after the 320 px triage copy), "asks the four image questions once with the
  caption and the small image" (`imageTriageInput` format), "treats a malformed triage as missing" (wave A reads it
  leniently and logs nothing), "acknowledges a slow triage once, in reply to the photo" and "acknowledges in Persian for
  a Persian caption" (API absent: `IMAGE_ACK_TEXT`), and "forces the quick vision route when the main model is not
  vision-capable" (wave A refuses instead).
- `images-gateway.test.ts`: "replies to a captionless photo with the image in the current turn only" (contradicts in
  the image bytes: wave A's stripped reply-size copy), "never sends an image to a Gemini main model" (contradicts in the
  shape: wave A sends no image at all when either model cannot see, which is stricter). Both "no image bytes in any log
  (stage timings false/true)" cases were first listed here; the S12 verifier showed that only the log string differs,
  so they are kept (see TAIL).

### Test results

- `npx tsc --noEmit -p tsconfig.json`: clean.
- Step suites, flags unset (`images-*`, `gateway.test.ts`, `tireh/telegram`, `tireh/memory`, `circles-dm`,
  `circles-channels`, `pet-http`): 286/286 across 19 files.
- `STUDIO_IMAGES=1 npx vitest run src/lib/tireh src/lib/studio/__tests__/circles-dm.test.ts`: 1970/1970.
- Privacy core suites (the list before TAIL, plus `sharing-v2`), flags unset: 633/633 across 30 files, three runs. One
  earlier run under load had a single failure that did not reproduce.
- S03 fixes: `cached-prompt-gateway-suite` (both arms) 104/104; the three S03 main-lineage files 48/48.
- `images-*` with `TIREH_CACHED_PROMPT=1`, and with `TIREH_CACHED_PROMPT=1 TIREH_PROMPT_SYSTEM_TAIL=1 STUDIO_IMAGES=1`: 132/132 each.
- `src/lib/tireh`, `src/lib/studio`, `src/lib/circles`, `src/app/studio`, flags unset: 4549/4561. All 11 failures are
  environment failures: `guest-rights-http` (10, mkdtemp /tmp EPERM) and `prepared-conversation-qualification` (1,
  timeout under full-suite load).

## TAIL: integration fixes and QA rounds 1 to 3 (wave A `7a9bd38`)

The tail of `agent-intelligence-wave-a` after the S12 merge: the integration fixes (`9235a6d`, `ca4035b`, `a40e8f8`,
`d3dac45`, `56a4e98`), the wave A record `WAVE_A_INTEGRATION.md` (`2a07baf`), the three QA rounds with their red-team
tests and fixes, and the legacy Telegram payments hardening (`169d16d`, `a70ca9a`, `7a9bd38`).

### Resolution

| File | Resolution |
| --- | --- |
| `src/lib/tireh/gateway.ts` (conflict) | Main's file with wave A's QA tail. `bfc9b39`: `imageWanted` and the `IMAGE_PLACEHOLDER_TEXT` turn text before the boundary, then `ingestTelegramImage` after `boundary.audienceValid` (main's `group_audience_invalid` diagnostic is kept). `19f3b37`: `imageDerivedMark` on the stored user and assistant rows, rows of a suppressed image turn filtered out of extraction, and `imagePeopleRule` derived from `imageDerived.people` on the current turn and the retained rows; main's `peopleImageTurns` WeakSet is gone. `042059a`/`6c90443`: `ComposedReply.imageContext` from `inheritedImageMark(recent)`, carried onto the Telegram assistant row (with `IMAGE_WITHHELD_REPLY_TEXT` for a withheld reply), `converse` (Mini App, Pet included: `generateReplyAt` keeps main's `surfaceFrame` and now returns `{ text, imageContext }`) and the `liveTurn` assistant row. `07ecb14`: shadow voiceprint verification runs only with `STUDIO_VOICE_SHADOW=1`, fire-and-forget with `AbortSignal.timeout(3000)`; main's `guestAudience: hasGuestAudience(...)` value is kept. `4d5b120` is superseded by `ComposedReply`. Every main hunk stays: group agents (`publicOnly`, GroupWindow follow-ups and claims, `TurnExtras`, the degenerate-reply retry), Circles (notes intercept, `notesFence` in `sendReply`), Pet `surfaceFrame`, Step 1, `8a7dc55` (no live recheck throttle; triage authority), `758875d`/`a0e59c4`. |
| `src/lib/adaptive/decisions/decisions-v2.test.ts` (conflict) | Wave A's `9235a6d` version: "sends options.timeoutMs as the provider timeout and maxRetries 0" (timeout 2000 reaches the request, the assertion main's "passes the effective service deadline with maxRetries 0 through the S15 adapter" made) and "keeps timeout 500 and maxRetries 0 when no options are passed". |
| `src/lib/tireh/__tests__/invariants.test.ts` (conflict) | Wave A's file: the real-store arm and the `NoTombstoneStore` fail-closed arm. Main's `Object.defineProperties(plain, { tombstonesOf: undefined, addTombstones: undefined })` arm is literally covered: `NoTombstoneStore` defines the same two instance properties as `undefined` on an `InMemoryMemoryStore`. |
| `src/lib/studio/__tests__/sharing-v2.test.ts` (conflict) | Union: wave A's real-store and `NoTombstoneStore` cases plus main's "skips a tombstoned lineage whose StaleMemoryWriteError comes from another bundle copy (structural check)". |
| `firestore.indexes.json`, `S12-image-ingestion.md`, `images/{index,retention}.ts`, `memory/extraction.ts`, `types.ts`, `images-gateway.test.ts`, `memory-v2-retrieval.test.ts`, `hint-isolation.test.ts` | Auto-merged to wave A's content (main's `decideCalls` helper in `images-gateway.test.ts` kept). |
| `src/app/api/telegram/{payments,webhook}`, `src/lib/telegram/{prices,verify}.ts`, `verify.test.ts`, `useTelegramPayment.ts` | Wave A's files, merged cleanly. The explicit exception in `WAVE_A_INTEGRATION.md` (the deleted `PUT /api/telegram/payments`) and its record of the seven removed tests stand: "returns 400 when userId is missing", "accepts pre-checkout query", "updates user subscription on successful payment", "sets correct tier for max plan", "sends confirmation message to user", "returns success for empty webhook", "returns 500 on processing error". The fail-closed webhook verifier stays behind `TELEGRAM_WEBHOOK_FAIL_CLOSED` (default off, open issue 8). |
| `scripts/legacy-offline-inventory.mjs` | The LIA1 inspector block regenerated from `renderInspectorBundle()` (TypeScript 5.9.3 at the pinned hash), as `cb3e952` did, after wave A's `imageDerived` history field landed in `adapters.ts` (main's `mainMiniApp` and Circles group fields kept). `node --test scripts/legacy-offline-inventory.test.mjs`: 17/17. |
| `docs/implementation/PRIVACY_AND_CONSENT.md` | Unchanged by TAIL. The Decisions image-triage processor row (F022) is the OpenAI Decisions API row, already present. Wave A has no pyannoteAI processor row at `7a9bd38`, so there is none to port. |

### Main behaviour kept on top of wave A's order

Wave A ingests an image once `boundary.audienceValid` holds. On main, the boundary also admits a public-only audience
(`validatePublicAudience`: a Circles outsider in a DM who chose replies). Main's S12 lineage refused such a photo,
because it required `validateAudience` itself. The turn boundary now carries `publicOnly` (not hashed into the key), and
the gateway skips ingestion for it: a captionless photo is ignored and a captioned one is answered from the caption
alone. New case in `images-gateway.test.ts`: "never downloads for a public-only audience (Circles outsider who chose
replies), captioned or not". It fails without the gate.

### Main-lineage cases changed in TAIL

- `images-gateway.main-lineage.test.ts` now keeps both "no image bytes in any log (stage timings false/true)" cases
  ("keeps bytes, scan text and tokens out of logs, history, memory and every non-image field"). The only change is the
  log string: `tireh_image:download_failed` for `image_download_failed`, and the `tireh_image:` prefix filter. They are
  moved from "not kept" to kept in the S12 section above; the gateway main-lineage count is 12.
- "adds the people rule to extraction and keeps triage and bytes out of every prompt": its image-turn assertions are
  kept. Its two follow-up assertions are not, because they contradict wave A's `19f3b37` (F012/F050): main expected the
  next text turn's extraction to drop `IMAGE_PEOPLE_RULE` and to equal `buildExtractionPrompt(...)`. Wave A persists
  the people mark on the image turn's rows, so the rule holds while those rows are in the extraction window. The case
  now asserts that.
- `memory-v2-firestore.main-lineage.test.ts` "declares exactly the contract vector index": its whole-file equality
  contradicts wave A's `d3dac45`, which adds the `vox_audit` composite index for `FirestoreAuditStore.list`. The case now
  compares the `tireh_memories` entries and `fieldOverrides` only; the contracted vector index is asserted unchanged.

### Goldens

TAIL re-derives no golden. Against wave A, three snapshot files differ on this branch, all from earlier steps:
`cached-prompt-flag-off.base.json` (re-derived at `7224f40` in the S03 merge, recorded in its header),
`cached-prompt-baseline.test.ts.snap` (main's version, which carries `962e877`'s group-agent prompt wording) and
`prompt-layout.test.ts.snap` (Block A gains `962e877`'s "Always answer in words" rules line).

### Test results

- `npx tsc --noEmit -p tsconfig.json`: clean. ESLint on the 180 `.ts`, `.tsx` and `.mjs` files changed since `7224f40`:
  0 errors, 17 warnings (unused imports in main-lineage test files). `npm run check:studio-style`: passes.
- Step suites, flags unset (`redteam-*`, `qa-*`, `images-*`, `cached-prompt-*`, `adaptive/decisions`,
  `app/api/telegram`, `lib/telegram`, `legacy-inventory`, `tireh/identity`): 912 passed and 5 expected failures (the
  QA known-gap tests) across 67 files. `node --test scripts/legacy-offline-inventory.test.mjs`: 17/17.
- `STUDIO_IMAGES=1` on `redteam-image-window`, `redteam-image-followup`, `redteam-wave-a-r3` and `images-*`: 147/147.
  `STUDIO_VOICE_SHADOW=1` on `voiceprint-*` and `qa-*`: 108 passed, 5 expected failures.
- Privacy core suites plus the wave A red-team suites and `sharing-v2`, flags unset: 663/663 across 35 files.
- `src/lib/tireh`, `src/lib/studio`, `src/lib/circles`, `src/app/studio`, flags unset: 4591 passed, 14 failed. All are
  environment failures: `guest-rights-http` (10, mkdtemp /tmp EPERM), and `prepared-conversation-qualification` (3) and
  `PreferenceLearningPanel.integration` (1), timeouts under load that pass alone (11/11).
- Full `npx vitest run`, flags unset: 24 files and 107 tests failed, 7654 passed. Every failure is an environment
  failure. mkdtemp /tmp EPERM: `guest-rights`, `guest-rights-http`, `rights-intake/storage`. Listen EPERM (TCP or unix
  socket): `connections/mcp/self-service` (37), `connections/mcp/tls`, `voice-identity/local-provider` (7),
  `integration-broker`, `foundation-broker`, `foundation-broker-error-http`, `runtime/reminders`. tsx child IPC:
  `personalization/learning/rollback`. Timeouts under full-suite load that pass alone: `observation/service`,
  `personalization/http`, `rights-intake/{rights-intake,local-erasure}`, `rights-use-holds/service`,
  `voice-identity/service`, `routines/engine`, `circles-notes`, `indexed-reply-context`, `studio/service`,
  `prepared-conversation-qualification`. `images-gateway` and `memory-v2-firestore.main-lineage` failed in that run
  because it started before the fixes above; both pass now. None of the EPERM suites is touched by wave A.
- Flag matrix (recorded results in `WAVE_A_INTEGRATION.md`):

| Command | Result |
|---|---|
| `TIREH_CACHED_PROMPT=1 npx vitest run src/lib/tireh` | 10 failed / 1969 passed: exactly S03's expected 10 (`diagnostics` 1, `gateway` 5, `history-privacy` 3, `voice-delivery` 1) |
| `TIREH_RETRIEVAL_V2=1` memory-privacy, visibility, memory-eval | 41/41 |
| `TIREH_SHARING_V2=1 TIREH_AUDIT_LOG=1` invariants, policy-differential, `src/lib/studio` | 11 failed / 1586 passed: `guest-rights-http` (10, EPERM) and `prepared-conversation-qualification` (1, load timeout) |
| `STUDIO_DECIDER=service TRIAGE_QUESTION_SET=v2 TIREH_DECISION_LOG=1` `src/lib/tireh src/lib/adaptive/decisions` | 2091 passed, 5 expected failures |
| `STUDIO_IMAGES=1 npx vitest run src/lib/tireh` | 1979 passed, 5 expected failures |
| `STUDIO_VOICE_RECOGNITION=1` `src/lib/studio/__tests__/voiceprint*` | 105/105 |
