# S10L: Identity confidence library (not wired)

Step S10L of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (sections 2.5, 4.6, 4.9 and the Step 10 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.

## Goal

Add a self-contained, unwired library under `src/lib/tireh/identity/` that implements the identity-confidence seam. Six parts:

1. Content-free, Unicode-safe style features computed from one message.
2. A rolling per-person profile: an exponential moving average with a 90-day half-life, at least 50 messages before scoring, statistics reset after 7 days of absence.
3. A sequential CUSUM-style test over at least 5 messages. It compares the person's own profile against an explicit unknown class, uses per-person thresholds, enforces a budget of at most 1 false prompt per member per week, and auto-disables members by Gini of per-user error.
4. Log-odds fusion of the account prior, the voice band and the style hint, with structural caps. Hints only ever lower the level, and style alone can move a session from consistent to uncertain and never to inconsistent.
5. File, in-memory and Firestore (`vox_style_profiles`) stores. They hold only aggregate numbers, gated by `optional.personalization`, and rows are deleted on withdrawal or an epoch bump.
6. An `IdentityService` implementation that matches the shared contract exactly.

Nothing in `gateway.ts`, the boundary, adaptive policy or persistence changes. No production code imports the library. There is no flag: with the library unused, runtime behaviour is byte-identical to the base.

## Files

| Path | Content |
|---|---|
| `voice-band.ts` | Byte-identical to the contract's shared file 3 (sha256 `b8d0a41d69e38129c3b47b4450194133e3a90b075dbc54c55c775b03e88421bd`). Never reformat. |
| `types.ts` | Contract types verbatim (`IdentityLevel`, `SessionConsistency`, `StyleHint`, `IdentitySignals`, `IdentityAssessment`, `IdentityService`); re-exports `IdentityHint` and `StyleFeatures`; rank tables `IDENTITY_LEVEL_RANK`, `SESSION_RANK`; `lowerLevel()`/`lowerSession()`; `EnrollRefusal`, `IdentityLogEvent`, `IdentityLog`; compile-time `HintIsolationCheck` (Assert/Disjoint over keyof). Only adaptive import: `import type` from `../../adaptive/types`. |
| `style-features.ts` | `extractStyleFeatures()`, strict zod `styleFeaturesSchema`, `quantize()`, `lengthBucket()`, `hourBucket()`, `voiceDurationBucket()`, `FINGLISH_MARKERS` (30 frozen tokens). |
| `profile.ts` | Rolling profile as pure functions and strict zod `styleProfileSchema`. |
| `test.ts` | Sequential test and calibration (a source module despite the name; vitest collects only `*.test.ts`). |
| `fusion.ts` | `assessIdentity()`, `validateWeights()`, `DEFAULT_FUSION_WEIGHTS`. |
| `store.ts` | `StyleProfileStore`, `InMemoryStyleProfileStore`, `createFileStyleProfileStore(path)`, `FirestoreStyleProfileStore(db)`, `styleProfileDocId(key)`. |
| `service.ts` | `StyleIdentityService implements IdentityService`. |
| `index.ts` | Barrel; nothing outside the directory imports it in this step. |
| `__tests__/style-fixtures.ts`, `__tests__/fake-firestore.ts` | Strict-clean test helpers. |
| `__tests__/*.test.ts` | style-features, profile, sequential-test, fusion-caps, hint-isolation, content-free, stores, service, voice-band. |

### Style features

Preprocessing: lone surrogates become U+FFFD (non-`u` regex); NFKC; truncate to `MAX_ANALYSED_GRAPHEMES = 4096` graphemes via `Intl.Segmenter('und', {granularity: 'grapheme'})`; words come from the word segmenter with `isWordLike`, lowercased.

Ratios (quantized to a 0.05 grid in [0,1], 0 when the denominator is 0):

- `persianScriptRatio` = `\p{Script=Arabic}` letters / `\p{L}` letters; `latinScriptRatio` likewise for Latin.
- `finglishRatio` = Latin word tokens in `FINGLISH_MARKERS` / Latin word tokens.
- `punctuationRate` = `\p{P}` graphemes / non-whitespace graphemes.
- `emoticonRate` = (graphemes with `\p{Extended_Pictographic}` + ASCII emoticons `/(?:[:;=8][-'^]?[)(DPpOo3\]\[|*]|<3|\^_\^)/` + runs of 2+ `)` or `(` outside an emoticon match) / non-whitespace graphemes, capped at 1.
- `zwnjRate` = U+200C count / Arabic-script word tokens, capped at 1.
- `arabicVariantRatio` = (U+064A + U+0643) / (U+064A + U+0643 + U+06CC + U+06A9).
- `repeatedCharRate` = matches of `/(\p{L})\1{2,}/gu` / word tokens, capped at 1.
- `uppercaseRatio` = `\p{Lu}` among Latin letters / Latin letters.

Other: `terminalPunctuation` (trimmed text ends with `. ! ? … ؟ ۔`); `digitScript` 0 none, 1 ASCII, 2 Persian, 3 Arabic-Indic, 4 mixed; `lengthBucket` by graphemes (<=3, <=10, <=30, <=80, <=200, above). Voice never reads `text`; `voiceDurationBucket` <5 s, <15 s, <60 s, >=60 s or unknown. `hourBucket = floor(hour/4)` in the given time zone (UTC fallback). `followOn` when `0 <= at - previousAt <= 60 s`. Pure, never throws, returns a frozen object without strings except the modality.

### Profile

Bernoulli keys (voice, followOn, edited, terminalPunctuation), categorical keys (hourBucket 6, lengthBucket 6, digitScript 5, voiceDurationBucket 4) and Gaussian keys (the nine ratios, weighted Welford with decay). Each update applies `d = 0.5 ** (max(0, at - lastAt) / HALF_LIFE_MS)`. Text-only keys update only on text, `voiceDurationBucket` only on voice. `expiresAt = lastAt + 7 days`; after expiry statistics reset (calibration kept); the whole row is deleted 90 days after `lastAt`. `isScorable` at >= 50 messages. `bernoulliP = (w*p+1)/(w+2)` clamped to [0.02, 0.98]; categorical add-one smoothing; Gaussian variance floor 0.0025. `needsRebaseline` on epoch or version mismatch or 7 days of absence. Rows carry `purpose: 'optional.personalization'`, `version: 1`, only ids, enums and finite numbers; strict schema at every level.

### Sequential test and calibration

`UNKNOWN_CLASS_V1` (uninformed: Bernoulli 0.5, uniform categoricals, Gaussian mean 0.5 / variance 0.09). `messageLlr` sums `log p_unknown - log p_person`, clamped to ±1.5, 0 when not scorable. `stepSequential`: `s = max(0, s + llr - 0.25)`; `'uncertain'` is sticky and requires `n >= 5` and `s >= threshold`; never `'inconsistent'`. Sessions expire after 30 minutes. A `'confirmed_self'` (false) prompt raises the threshold by 1.5 (max 12), mutes for 7 days and disables after 3 within 28 days; `'someone_else'` only increments true prompts. `relaxCalibration` lowers by 0.5 after 28 quiet days, never below 5. `giniCoefficient` and `autoDisable` (>= 5 members with >= 10 sessions, gini >= 0.4, outliers at >= 2x mean error and >= 0.05, plus anyone with >= 3 recent false prompts).

### Fusion

Defaults: priorAccount 4, priorVerified 5, voiceMatch 0, voiceUncertain -2, voiceNoMatch -4.5, styleUncertain -3.5. Voice counts only for `hint.source === 'voice_match'`, a non-NO_OPINION band and net speech >= 3000 ms; `claimedPersonId`/`speakerLabel` are never read. Style counts only for `source 'style'`, integer messages >= 5 and a non-consistent state (`inconsistent` treated as `uncertain`). `logOdds = min(prior, prior + evidence)`; consistent >= 2, uncertain >= 0, else inconsistent; style-only inconsistent is capped to uncertain. `level = consistent ? base : 'unverified'`. Invalid account id gives `{unverified, uncertain, 0, capped: true}`. Output frozen with exactly `capped, level, logOdds, session`.

### Stores

`update(key, fn)` is atomic read-modify-write: null deletes, a key mismatch throws, every written row is parsed with `styleProfileSchema` first. Invalid rows on read are treated as absent and deleted. File store: JSON `{version: 1, profiles}` via tmp file, chmod 0600, rename, mkdir lock with reload. Firestore: `runTransaction`, where-queries with batched deletes of up to 400, `sweep(now)` resets or deletes expired rows; plain numbers, never undefined. No text, single-message features, session state or hints are ever stored.

### Service

`verifyVoiceNote` never throws; NO_OPINION `guest_or_group` without calling the verifier for groups or guests; `disabled` without a verifier; `timeout` on abort; `provider_error` on a throw. `observeStyle` validates strictly, deletes on missing consent, re-baselines on epoch mismatch, keeps a bounded LRU of per-key sessions with a pending queue so uncertain sessions are never learned, writes through `store.update`, and returns a hint only when `hintAllowed`. `enroll` is idempotent and resets statistics while keeping calibration. Extra methods: `recordPromptOutcome`, `recalibrate` (counts only), `forgetPerson`, `purgePersona`. Logs carry only `{type: 'identity', code}`.

## Flags

None. S10L is not wired and reads no flag; `src/lib/tireh/flags.ts` is not created. Runtime gating is by parameters: nothing is stored unless `personalizationAllowed === true`; `verifyVoiceNote` returns NO_OPINION `disabled` unless a verifier is injected.

## Acceptance (summary)

- Only paths under `src/lib/tireh/identity/` (plus this spec) change; no `src/lib/tireh/identity.ts`.
- `voice-band.ts` sha256 matches; contract declarations reproduced; `StyleIdentityService implements IdentityService` under strict lib tsc; `HintIsolationCheck` compiles.
- Static scan proves no production importer; hints only lower; style-only never yields inconsistent; voice MATCH contributes 0.
- Canary tests prove no message text in rows, file bytes, Firestore docs, return values or logs.
- Consent, withdrawal, epoch bump, 7-day reset and 90-day deletion behave as specified.
- Sequential test is deterministic, never alarms before 5 messages, catches the impostor fixture within 10 messages with zero alarms on held-out data; false-prompt budget and Gini auto-disable hold.

## Out of scope

Wiring (GatewayDeps.identity, TurnSnapshot.identity.level, gateway/transcribe/liveTurn calls, Studio construction); all Step 1 code; effects of a lowered level; edits to `src/lib/adaptive/types.ts`, `policy.ts` or existing tests; voiceprints (S11L); `flags.ts`; outbox/worker extraction (Step 5) and `vox_audit` identity rows; reply adaptation and the bandit (S14); character or hashed n-grams and misspelling dictionaries (dictionary-attackable); any LLM "same author?" judge; benchmarks or threshold tuning on real members; Firestore index files and package files.

## Risks

- Section 4.9 phase 0 says no persisted identity model while Step 10 requires a rolling profile. Resolution: aggregate statistics only, reset after 7 days of inactivity, calibration kept up to 90 days. A member silent for a week needs 50 new messages before scoring resumes. Product/counsel to confirm in the DPIA.
- `UNKNOWN_CLASS_V1`, thresholds, drift and weights are uninformed defaults; fixtures prove mechanics, not accuracy. Wiring stays off until an internal benchmark.
- Warm-up poisoning: the first 50 messages can be from whoever holds the phone.
- Per-process session map on multi-instance deployments weakens detection but never widens access.
- Gini auto-disable needs >= 5 members with >= 10 sessions; small pilots rely on the absolute rule and the 7-day mute.
- GDPR profiling: notice and DPIA under `optional.personalization` before wiring; callers must not log assessments or hints.
- `voice-band.ts` merges cleanly with S11L only if byte-identical.
