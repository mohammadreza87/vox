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

### Open issues carried

- `FirestoreMemoryStore.updateIfShareVersion` spreads `snapshot.data()`, so Timestamp fields become maps on both sides
  (known before this merge).
- Tombstone additions do not bump the memory revision (wave A invariant), so Step 1 probes are unaffected.
