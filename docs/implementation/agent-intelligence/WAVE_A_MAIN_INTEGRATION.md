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
- gate and audience: "a false gate touches no store method; only an exact true opens it"; "groups and guest audiences
  never sample"; "settle with a false or throwing gate changes no posterior".
- store failure: "choose falls back without throwing".
- file store: "serialises concurrent settles on one posterior exactly"; "a corrupt file fails closed and is never
  overwritten".
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
- gate and audience > "a gate that flips to false before the write records nothing": contradicts wave A, which runs the
  authorize callback once per `choose()` (before any store read) and again in `settle()` before any posterior write;
  main re-checked a second time before appending the evaluation row. Follow-up for wiring time.
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
- symlinked file refusal: wave A's file store reads through `readFileSync` and follows a symlink; main opened with
  `O_NOFOLLOW`. Follow-up hardening for wiring time (the store is single-host and unwired).
