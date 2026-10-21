# S14: Reply-style procedural memory library (Thompson-sampling bandit, not wired)

Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`. Plan: `docs/AGENT_INTELLIGENCE_SOLUTION.md`
section 2.6 (bullet "Personalisation"), section 4.10 bullets 1 and 3, section 5 row 14 (gate: the DPIA
covers behavioural adaptation, so the library ships unused).

## Goal

A pure, content-free library at `src/lib/adaptive/personalization/procedural.ts`, with file, Firestore
and in-memory stores in `procedural-store.ts`. It learns reply-style choices per
(personId, personaId, space, route) with Beta-Bernoulli Thompson sampling over six low-risk
dimensions: length, register, structure, modality, language and closingQuestion.

- Precedence: explicit request this turn > explicit stored preference (resolvePreferences semantics)
  > sampled arm > persona default.
- Reward is a composite in which reply-rate alone never moves a posterior.
- Posteriors decay with a 90-day half-life and can be viewed, reset and deleted on withdrawal.
- A content-free offline-evaluation record `{context, armChosen, propensity, unchosenArms, reward}`
  is written per decision.
- Every choose/settle call is gated on `optional.personalization` through a call-time check callback.
- Nothing is wired into the gateway, Studio or runtime, and no flag is added (the shared contract says
  S14 has none). With the library unused, runtime behaviour is byte-identical to the base.

## Files

| Path | Change |
|---|---|
| `src/lib/adaptive/personalization/procedural.ts` | new: constants, types, strict zod schemas, pure helpers, `ReplyStylePolicy` |
| `src/lib/adaptive/personalization/procedural-store.ts` | new: `InMemoryReplyStyleStore`, `FileReplyStyleStore`, `FirestoreReplyStyleStore` |
| `src/lib/adaptive/personalization/procedural.test.ts` | new: the only test file for S14 |
| `src/lib/adaptive/decisions/README.md` | append one final section after "Personalization and improvement" |

### procedural.ts

Imports only `node:crypto` (`createHash`, `randomUUID`), `zod`, and `import type { ResolvedPreference } from './index'`.
Nothing from gateway, studio, runtime or persistence.

1. Constants: `REPLY_STYLE_POLICY_VERSION = 1`; `REPLY_STYLE_ARMS`; `REPLY_STYLE_DIMENSIONS`
   (length, register, structure, modality, language, closingQuestion); `DEFAULT_HALF_LIFE_MS` = 90 days;
   `FOLLOW_UP_WINDOW_MS` = 10 minutes; `REWARD_WINDOW_MS` = 24 hours; `EVAL_RETENTION_MS` = 90 days;
   `DEFAULT_PROPENSITY_SAMPLES = 200` (allowed 16..2000); `MAX_EVIDENCE = 10_000` (cap on alpha+beta).
2. Types as in "Interfaces".
3. Strict zod schemas `replyStylePosteriorDocSchema` and `replyStyleEvalRecordSchema`. Every string is
   an enum, a 32- or 64-hex hash, or an id matching `/^[A-Za-z0-9_.:-]{1,128}$/`. Every object is
   strict; a row with an unknown key such as `text` fails to parse.
4. Pure helpers:
   - `personKeyOf(personId)` = sha256(`'vox-reply-style:v1:' + personId`) hex, first 32 chars.
   - `posteriorDocId(key)` = sha256(`JSON.stringify(['reply-style', personKeyOf(personId), personaId, space, route])`) hex.
   - `decayPosterior(p, now, halfLifeMs)`: `w = now <= p.updatedAt ? 1 : 2 ** (-(now - p.updatedAt) / halfLifeMs)`;
     `alpha = 1 + (alpha - 1) * w`; `beta = 1 + (beta - 1) * w`; never below Beta(1,1); updatedAt unchanged.
   - `updatePosterior(p, reward, now, halfLifeMs)`: decay, then `alpha += reward`, `beta += 1 - reward`,
     `updatedAt = now`; if `alpha + beta > MAX_EVIDENCE` scale the excess over the prior so the sum equals `MAX_EVIDENCE`.
   - `sampleBeta(alpha, beta, random)` via Gamma: Marsaglia-Tsang for shape >= 1, `Gamma(a+1) * U^(1/a)` for
     shape < 1, Box-Muller normals using `1 - random()`. Throws `RangeError` when `random()` returns NaN or a
     value outside [0,1).
   - `mulberry32(seed)`: deterministic RNG for tests and offline replay.
   - `resolveReplyStyle(input)`, `pinsFromResolvedPreferences(resolved, personaDefault)`,
     `styleFromExplicitRequest(req)` ('brief' -> length brief; 'detailed' -> length detailed;
     'step_by_step' -> structure steps; 'listening' and 'unspecified' -> {}), `compositeReward(signals, replyAt)`,
     `detectCorrectionPhrase(text)` (pure; the text is never retained, logged or returned).
5. `class ReplyStylePolicy` with `choose`, `settle`, `describe`, `reset`, `withdraw`. Defaults:
   `random = Math.random`, `now = Date.now`, `newId = randomUUID`, all six dimensions, 90-day half-life,
   200 propensity samples, 90-day eval retention. The constructor throws on an empty, duplicate or
   unknown dimension, `halfLifeMs <= 0`, or `propensitySamples` outside 16..2000.

#### Arm table

- length: brief | balanced | detailed
- register: formal | informal
- structure: plain | steps
- modality: text | voice_default
- language: fa | en | mixed
- closingQuestion: yes | no

#### Precedence (per dimension; first match wins; `sources[d]` records the winner)

1. `explicitThisTurn[d]` -> `explicit_turn`
2. a stored pin -> `explicit_stored` or `reset`
3. a sampled arm -> `sampled`
4. `personaDefault[d]` -> `persona_default`

#### Stored pin mapping from `ResolvedPreference[]`

The caller ran `resolvePreferences` with its own `authorize`; this module never re-implements eligibility.

- source `explicit`: `response_length v` -> length v; `language 'en' | 'fa'` -> language v;
  `language 'auto'` -> language pinned to `personaDefault.language` (source `explicit_stored`);
  `formatting 'plain'` -> structure plain; `formatting 'structured'` -> structure steps.
- source `reset`: the key's mapped dimension is pinned to `personaDefault[d]` with source `reset`
  (resets outrank inferences, as in index.ts).
- source `hypothesis` or `default`: no pin. Hypotheses never outrank the bandit or pin arms.
- register, modality and closingQuestion have no stored key, so only `explicitThisTurn` pins them.

#### choose(input)

Never throws; any internal or store error falls back to the non-sampled resolution with no decisionId and propensity 1.

a. Compute pins from `explicitThisTurn` and `storedPreferences`.
b. Skip sampling (no store read, no RNG call, no record) when `audience !== 'private'`, `guestAudience` is true,
   every configured dimension is pinned, or `await input.personalizationAllowed()` is not exactly true
   (evaluated after pins, before any store access).
c. Read the posterior doc (absent = all arms Beta(1,1)); decay every arm to now in memory only.
d. For each unpinned configured dimension (REPLY_STYLE_DIMENSIONS order, arms in table order): one `sampleBeta`
   draw per arm, argmax (ties go to the earlier arm); then `propensitySamples` further rounds of per-arm draws,
   counting how often the chosen arm wins; `propensity = min(1, max(count / n, 1 / (n + 1)))`.
e. Joint propensity = product of per-dimension propensities.
f. Recheck `personalizationAllowed()`; if no longer true, return the non-sampled resolution and write nothing.
g. Write a `ReplyStyleEvalRecord` through `store.appendDecision` (reward null; `expiresAt = at + evalRetentionMs`;
   `unchosenArms` = the other arms of each sampled dimension in table order).
h. Return `{ style, sources, decisionId, propensity }`.

#### settle(input)

Returns a `SettleResult`, never throws.

1. Gate not true -> `{updated:false, reason:'personalization_off'}`, no store call.
2. `reward = compositeReward(signals, replyAt = decision.at)`; null -> `no_signal`, the row is untouched and can be settled later.
3. Otherwise `store.settle(decisionId, mutate)`: missing -> `unknown_decision`; already rewarded -> `already_settled`;
   `now - decision.at > REWARD_WINDOW_MS` -> `expired`; else update (decay, then add the reward) only the chosen arm of
   each dimension whose `sources[d] === 'sampled'`, set `reward`, `rewardSignals`, `settledAt = now`, return
   `{updated:true, reward}`. The posterior doc is located from the row's personKey, personaId, space and route.

#### Composite reward

- Negatives (any one -> 0): `explicitCorrection`, `correctionPhrase`, `reaction === 'negative'`,
  a corrective follow-up with `0 <= followUp.at - replyAt <= FOLLOW_UP_WINDOW_MS`.
- Positives (no negative, any one -> 1): `reaction === 'positive'`, a non-corrective follow-up within the window,
  `shareOfferAccepted`, `voiceReciprocated`, `explicitThanks`.
- Otherwise null. `replied`, a follow-up with `corrective: 'unknown'` and an out-of-window follow-up never produce a
  non-null reward.

#### Correction phrases

Normalize: NFKC; Arabic `ي` -> `ی`, `ك` -> `ک`; remove ZWNJ (U+200C) and tatweel (U+0640); trim; lowercase. Then:

- EN: `/^(no|nope)\b(?!\s+(problem|worries|need|rush|thanks|thank you)\b)/`, `/\b(try|say|do( it)?|explain( it)?) again\b/`,
  `/^again[.!?]*$/`, `/\bnot what i (meant|asked|wanted)\b/`, `/\byou misunderstood\b/`, `/\bthat'?s (wrong|not right|incorrect)\b/`
- FA: `/^نه(?=$|[\s،,.!؟?])(?!\s*(ممنون|مرسی|مشکلی|نیازی))/`, `/دوباره(?=$|[\s،,.!؟?])/`, `/منظورم\s*(این|اون|آن)\s*نبود/`,
  `/اشتباه\s*(متوجه|فهمیدی|گفتی|است|ه)/`, `/درست\s*نیست/`

Reply-rate invariant: no code path updates a posterior when `compositeReward` returns null.

### procedural-store.ts

Sync `node:fs`, `node:path`, `randomUUID`, type-only `Firestore`. Every read and write goes through the strict
schemas; parse failures throw, so the store fails closed and `ReplyStylePolicy` turns that into a no-sampling fallback.

1. `InMemoryReplyStyleStore`: Maps of posterior docs and eval rows, `structuredClone` on every read, `settle`
   serialised on a promise-chain mutex, mutate runs on a draft that commits only if mutate does not throw.
2. `FileReplyStyleStore(path)`: one JSON file `{schemaVersion:1, posteriors, decisions}`; directory mode 0o700,
   file mode 0o600; every mutation loads and validates under an in-process mutex, mutates a draft, writes
   `${path}.${randomUUID()}.tmp` (O_CREAT|O_EXCL|O_NOFOLLOW, fsync) and renames over the file; reads use O_NOFOLLOW
   and refuse a symlink or a file over 4_000_000 bytes; caps of 5_000 posterior docs (creating a new doc beyond it
   throws `reply_style_capacity`) and 20_000 decisions (oldest `at` dropped first); a corrupt file throws on every
   call and is never replaced; single-process only.
3. `FirestoreReplyStyleStore(db, { posteriors = 'vox_reply_style', decisions = 'vox_reply_style_eval' })`:
   posterior doc id `posteriorDocId`, fields `{personKey, personaId, space, route, json, updatedAt: Date}`;
   eval doc id `record.id`, fields `{personKey, personaId, space, at: Date, expiresAt: Date (TTL), settled, json}`;
   `appendDecision` in a transaction refusing an existing id; `settle` in one transaction reading both docs;
   list queries by personKey (plus personaId, space) or `at` range, ordered by `at`, limit <= 1000; `deleteScope`
   and `sweep(now)` delete in `db.batch()` chunks of 400 until a query returns empty. No other collections; the raw
   personId is never written.

### README

Append `## Reply-style procedural memory (library, not wired)` after "Personalization and improvement": the
policy, precedence, composite reward, decay/describe/reset/withdraw (integrators must call withdraw on
`optional.personalization` withdrawal, product pause and epoch bump), the call-time gate, the content-free eval rows
with 90-day TTL on `expiresAt` (enable Firestore TTL at deploy), and that wiring waits on the DPIA and confirmation of
`message_reaction` delivery to persona bots.

## Interfaces

See the exported types in `procedural.ts`; they follow the contract verbatim: `ReplyStyleKey`, `ArmPosterior`,
`ReplyStylePosteriorDoc`, `ReplySignalKind`, `ReplyOutcomeSignals`, `CompositeReward`, `ReplyStyleEvalRecord`,
`ReplyStyleStore`, `PersonalizationCheck`, `ChooseReplyStyleInput`, `ReplyStyleChoice`, `SettleReplyStyleInput`,
`SettleResult`, `PosteriorView`, `ReplyStylePolicyOptions`, `ReplyStylePolicy`, and the helper functions above.

## Flags

None. The only gate is `personalizationAllowed`, evaluated at call time before any store access and rechecked
before the eval record is written. No existing module imports `procedural.ts`.

## Tests (`src/lib/adaptive/personalization/procedural.test.ts`)

Math.random is spied to throw; every policy gets `random: mulberry32(seed)` and an injected clock.

- precedence: explicit beats sampled (turn > stored > sampled > persona default; gate off -> persona default).
- stored mapping through the real `resolvePreferences` (structured -> steps, plain -> plain, auto -> persona
  language, reset -> persona value with source `reset`, hypothesis pins nothing).
- pinned dimensions are not learned (no propensity/unchosen entry; posterior unchanged after settle).
- withdrawal deletes posteriors in all three stores; stale decisions return `unknown_decision` and recreate nothing;
  reset deletes only that persona and space across routes.
- reply-rate alone never updates (200 settles with `{replied:true}` leave posteriors deep-equal).
- composite reward table; EN/FA correction phrases; 90-day decay; propensity logging; deterministic sampling with an
  injected RNG; gate and audience; fail-closed store errors; content-free canaries; file store (persistence, 0o600,
  concurrent settles, corrupt file, sweep); Firestore fake (collection names, Date expiresAt, failed commit,
  deleteScope looping past 400).

## Acceptance

- Only the four paths above change versus the base; nothing imports `procedural.ts`.
- Lib-scoped strict tsc exits 0; the new test file passes; no new failing files versus the sandbox baseline; eslint clean.
- No store writes a raw personId or message text; reply-rate alone never updates a posterior; explicit preferences
  always override sampled arms and pinned dimensions are never learned; withdraw/reset delete in all stores.

## Out of scope

Wiring (gateway, composeReply, prompt, Studio, runtime, http, Experience screen); calling withdraw from persistence
paths (Step 1 territory); rendering a style into prompt text (S03); route choice (S09); producing reward signals;
changes to `personalization/index.ts`, explicit.ts, learning/*, persistence, the PreferenceRecord schema; flags,
decision log, `vox_audit`; Firestore index/TTL/firebase.json changes; contextual features or pooling; package files.

## Risks

- Deployment gate not met (DPIA, `message_reaction` delivery), so the library stays unwired.
- The language arm is the riskiest dimension; integrators should configure dimensions without `language` until an
  EN/FA eval exists.
- Correction-phrase heuristics have false positives/negatives; combine with S09's `explicit_correction`.
- Propensity is a 200-sample Monte Carlo estimate floored at 1/(n+1); joint propensity assumes independent
  per-dimension draws (true by construction).
- `personKey` is a pseudonym (unsalted sha256), so eval rows remain personal data, covered by withdraw/reset and a
  90-day TTL.
- `FileReplyStyleStore` serialises writers within one process only.
- Firestore TTL on `vox_reply_style_eval.expiresAt` must be enabled at deploy time, or `sweep()` scheduled.
- The persona id regex may reject unusual ids; choose then fails closed.
