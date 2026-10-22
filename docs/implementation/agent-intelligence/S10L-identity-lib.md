# S10L: identity confidence library (not wired)

Step S10L of docs/AGENT_INTELLIGENCE_SOLUTION.md (sections 2.5 and 4.9, Step 10 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.

## Goal

Add a self-contained library under `src/lib/tireh/identity/` that Step 10 can wire later. It has five parts:

- A content-free style feature extractor.
- A per-person rolling style profile: a time-decayed EMA with a 90-day half-life, at least 50 messages before scoring, and re-baselining after absences.
- A windowed sequential log-likelihood-ratio test. It scores at least 5 messages against the person's own profile and an explicit unknown class, uses per-person thresholds that target fewer than one false prompt per week, and auto-disables a member using the Gini coefficient of per-user error.
- Log-odds fusion of the account prior, a voice hint and a style hint, with hard caps: style alone can only move consistent to uncertain, and hints only ever lower the level.
- In-memory, file and Firestore (`vox_style_profiles`) profile stores, written only under `optional.personalization` and deleted on withdrawal or a consent-epoch bump.

The `IdentityService` interface matches the shared contract exactly. Nothing outside `src/lib/tireh/identity` imports the library in this step: no gateway, boundary, Studio or runtime wiring, and no flag. With every flag unset, runtime behaviour is byte-identical to the base.

## Files

| File | Content |
|---|---|
| `voice-band.ts` | Shared file 3 of the contract, byte-identical with S11L (sha256 `b8d0a41d69e38129c3b47b4450194133e3a90b075dbc54c55c775b03e88421bd`). Never edited. |
| `types.ts` | The S10L contract block verbatim (`IdentityLevel`, `SessionConsistency`, `StyleHint`, `IdentitySignals`, `IdentityAssessment`, `IdentityService`), `IdentitySpace`, `StyleFeatures`, `IDENTITY_LEVEL_RANK`. The only adaptive import is `import type { IdentityHint } from '../../adaptive/types';`. |
| `style-features.ts` | Pure extractor `extractStyleFeatures`, `nextBurstIndex`, `styleVector` (21 dims), `STYLE_FEATURE_KEYS`, `STYLE_VECTOR_KEYS`, `STYLE_VECTOR_DIM`, `BINARY_VECTOR_DIMS`, `SPLIT_WINDOW_MS`, `FINGLISH_LEXICON`, strict zod `styleFeaturesSchema`. Raw text is read only inside the function; output holds only numbers, booleans, null, `version: 1` and `kind`. No character n-grams. Graphemes via `Intl.Segmenter` (fallback `Array.from`), NFC normalisation, ratios quantised to 0.05. |
| `profile.ts` | Pure functions over an immutable `StyleProfile`: `newProfile`, `observeProfile` (time-decayed EMA, `HALF_LIFE_MS` 90 days, variance clamped to `[VARIANCE_FLOOR, unknown variance]`, re-baseline after 30-day absence with weights capped at 10), `profileReady` (50 messages, 20 after a re-baseline), `decayFactor`, `personModel`, `UNKNOWN_MODEL` (explicit unknown class), `profileDocId` (sha256, 40 hex), strict `styleProfileSchema`. |
| `test.ts` | Pure sequential test: `messageLlr` (diagonal Gaussian LLR, per-dim clamp 2, per-message clamp 4, dims with weight < 5 skipped), `stepSequential` (window 12, no decision before 5 messages, sticky downgrades), `personThreshold` (default -10; otherwise quantile of self scores minus 1 targeting 0.5 false prompts per week, clamped to [-40, -4]), `quantile`, `gini`, `evaluateFairness` (budget rule and Gini auto-disable). Not a vitest file: the include glob is `src/**/*.{test,spec}.{ts,tsx}`. |
| `fusion.ts` | Pure, never-throwing `fuseIdentity`: account prior in log-odds, voice bands (negative bands always apply; MATCH only for a well-formed `voice_match` hint for the account person; `speakerLabel` never read), style term capped at -3, session from log-odds, style-alone floor at uncertain, level never above the ceiling, frozen four-key result. |
| `store.ts` | `StyleProfileStore`, `InMemoryStyleProfileStore`, `createFileStyleProfileStore(path)` (single writer, in-process mutex, tmp + chmod 0600 + rename), `FirestoreStyleProfileStore` (`vox_style_profiles/{profileDocId}`). Every put and read is strict-schema validated; failures reject with the fixed `Error('style_profile_invalid')`. No logging. |
| `index.ts` | `IdentityConfidenceService implements IdentityService` plus re-exports. `verifyVoiceNote` (guest/group/abort/disabled/provider_error guards around an injected `VoiceNoteVerifier`), `observeStyle` (withdrawal delete, schema check, enrolled-only, epoch bump delete, in-memory bounded sessions with 30-minute idle close, score before update, profile frozen while a session is flagged), `enroll`, `assess`, plus `recordPromptOutcome`, `forget`, `applyFairness`, `sweep`. Logging only via `options.log?.warn('<fixed code>')`. |

## Interfaces

```ts
export interface IdentityService {
  verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification>;
  observeStyle(input: { personaId: string; personId: string; space: 'work'|'personal'; features: StyleFeatures; at: number; personalizationAllowed: boolean }): Promise<{ stored: boolean; hint?: StyleHint }>;
  enroll(input: { personId: string; space: 'work'|'personal'; kind: 'style_baseline'; at: number; personalizationAllowed: boolean }): Promise<{ enrolled: boolean; reason?: string }>;
  assess(signals: IdentitySignals): IdentityAssessment; // hints only lower: level <= (verifiedRecently ? 'verified' : 'account')
}

export interface IdentityServiceOptions {
  readonly store: StyleProfileStore;
  readonly voice?: VoiceNoteVerifier;
  readonly epochOf?: (personId: string, space: 'work' | 'personal') => number | undefined | Promise<number | undefined>;
  readonly unknown?: GaussianModel;
  readonly log?: Pick<Console, 'warn'>; // 'identity_style_store_unavailable' | 'identity_voice_unavailable'
}
```

Constants: `PRIOR_LOG_ODDS = { verified: 6, account: 3, unverified: 0 }`, `VOICE_LOG_LR = { MATCH: 1, UNCERTAIN: -2.5, NO_MATCH: -6 }`, `STYLE_LOG_LR = { consistent: 0, uncertain: -2, inconsistent: -3 }`, `STYLE_MAX_DROP = 3`, `SESSION_CONSISTENT_MIN = 1.5`, `SESSION_INCONSISTENT_MAX = -1.5`, `LOG_ODDS_BOUND = 12`, `MIN_SEQUENTIAL_MESSAGES = 5`, `SEQUENTIAL_WINDOW = 12`, `MAX_DIM_LLR = 2`, `MAX_MESSAGE_LLR = 4`, `DEFAULT_LOWER_THRESHOLD = -10`, `THRESHOLD_MARGIN = 1`, `MIN_SELF_SCORES = 20`, `TARGET_FALSE_PROMPTS_PER_WEEK = 0.5`, `FALSE_PROMPT_BUDGET_PER_WEEK = 1`, `SESSION_IDLE_MS = 30 min`, `MAX_SESSIONS = 10_000`, `GINI_DISABLE_THRESHOLD = 0.5`, `MIN_FAIRNESS_MEMBERS = 5`, `MIN_FAIRNESS_WEEKS = 2`, `HALF_LIFE_MS = 90 days`, `MIN_PROFILE_MESSAGES = 50`, `ABSENCE_REBASELINE_MS = 30 days`, `MIN_REBASELINE_MESSAGES = 20`, `REBASELINE_WEIGHT_CAP = 10`, `VARIANCE_FLOOR = 0.0025`, `MAX_SELF_SCORES = 64`, `PROFILE_RETENTION_MS = 180 days`.

## Flags

S10L adds no flag and no env var, and does not create `src/lib/tireh/flags.ts`. Nothing outside `src/lib/tireh/identity/` imports the library, so the runtime is byte-identical to the base by construction. Gating is by parameters: `observeStyle` and `enroll` require `personalizationAllowed`, and `verifyVoiceNote` is `NO_OPINION 'disabled'` unless a verifier is injected.

## Tests (all under `src/lib/tireh/identity/__tests__/`)

- `style-features.test.ts`: Persian, English and Finglish extraction, the digit rule, Arabic variants, emoji clusters, Unicode safety, buckets, voice input, hour buckets, bursts, quantisation, the vector.
- `profile.test.ts`: decay, EMA convergence and recency weighting, readiness, re-baselining, variance clamps, null dims, out-of-order timestamps, immutability, doc ids.
- `sequential-test.test.ts`: decisions, clamps, the unknown class, sticky downgrades, thresholds, determinism, the false-prompt budget, detection, Gini and fairness.
- `fusion.test.ts`: exhaustive cap table and the named consequences, hostile input.
- `service.test.ts`: enrollment, withdrawal, epoch bump, readiness, flagged sessions, idle close, prompt outcomes, fairness, voice guards, hostile stores, space isolation, forget and sweep.
- `store.test.ts`: the same behaviour suite over the in-memory, file and Firestore stores; strict rejection; file mode 0600 under `os.tmpdir()`.
- `content-free.test.ts`: text and Persian canaries never reach features, stores, logs or results.
- `hint-isolation.test.ts`: hints are ignored by `authorizeAccess`, `isAuthorizationCurrent` and `resolveVerifiedPerson`; source scans.
- `voice-band.test.ts`: the shared file hash.

## Out of scope

All wiring (GatewayDeps.identity, TurnSnapshot.identity.level, policy key, boundary/unchanged, Studio.adaptiveContext, liveTurn), the effects of an uncertain session, live feature computation from Telegram updates, style-based adaptation, voiceprints (S11L), any change to `src/lib/adaptive/**`, character n-grams and LLM judges, flags.ts, diagnostics, audit rows, consent copy, DPIA, Firestore indexes, calibration on real members and any admin surface. The signal is never reported to admins.

## Risks

- Section 4.9 phase 0 says there is no persisted identity model; this step persists per-person profiles. Mitigation: profiles exist only after an explicit enroll with personalization allowed, are deleted on withdrawal, epoch bump, `forget()` and after 180 days idle, and are never reported. Wiring waits for the DPIA.
- All constants and the fixture false-prompt and detection numbers are synthetic and uncalibrated; they prove mechanics and determinism, not real accuracy.
- The Finglish heuristic is weak by design and never stores matched words.
- Imitation and drift: style can only lower to uncertain; profiles are frozen during flagged sessions; re-baselining and the half-life handle drift.
- The Gini rule needs at least 5 profiled members per space; smaller orgs use the budget rule only.
- Feature vectors are still personal data: ratios are quantised, nothing is keyed by chat or persona, Firestore ids are hashed, `personId` is kept for erasure.
- The file store assumes one writing process.
- In-memory session state is lost on restart; the only effect is a later hint.
- `test.ts` is a source file, not a test file.
