# S11L: voice enrollment and verification library (shadow mode, default off)

Step 11 of [`docs/AGENT_INTELLIGENCE_SOLUTION.md`](../../AGENT_INTELLIGENCE_SOLUTION.md) (sections 2.4, 4.9 and the Step 11 row of section 5), constrained by [`PRIVACY_AND_CONSENT.md`](../PRIVACY_AND_CONSENT.md) PRIV-017 to PRIV-025 and UX-07.

Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`. Branch: `aiq/voice-lib`.

## Goal

Add an isolated, consent-gated voiceprint library in `src/lib/studio/identity`:

- a `VoiceprintProvider` seam with a pyannoteAI adapter;
- an AES-256-GCM sealed template store `vox_voiceprints` (file and Firestore);
- a net-speech guard (at least 3 s of net speech, else no opinion);
- a self-echo guard against the ElevenLabs persona voices Vox generates;
- three-band verification (`MATCH | UNCERTAIN | NO_MATCH`) with per-org thresholds;
- Studio enroll, status and delete methods with HTTP routes;
- a minimal `EnrollScreen` using the UX-07 copy;
- `verifyVoiceNote`, run in `Promise.all` with STT inside `gateway.transcribe`, for 1:1 non-guest enrolled members only.

The verification result is discarded (shadow mode). With `STUDIO_VOICE_RECOGNITION` and `VOICEPRINT_KEY` unset, behaviour is byte-identical to the base.

## Facts verified at the base

1. The "hard deny" is `AdaptiveService.eligible()`: `capability === 'biometric_recognition' && this.options.voiceRecognitionEnabled !== true` returns `feature_not_released`. Production never sets the option. This step lifts it only by setting the option from the flag in the two `runtime.ts` spreads. `persistence/service.ts` is not edited.
2. A granted `ConsentPermission` can only come from `transitionConsent()`, which rejects without `ConsentEvidence {kind:'consent', affirmative:true}`. So `state==='granted' && expiresAt>now && lastEventId` is the affirmative-evidence check, and `lastEventId` is the `consentEventId`.
3. The consent-change and profile-change paths already call the single `voiceIdentityInvalidator` (reasons `voice_consent_changed` / `profile_changed`) after commit. `runtime.ts` sets it to `VoiceIdentityService.invalidate`; S11L re-sets it to a chained handler that keeps that call.
4. Telegram turns use space `work` (boundary default).
5. `bot.downloadFile` returns an `ArrayBuffer`; `message.voice` has `{duration, mime_type}`.
6. `Call.tsx`'s `pickMime`/`ensureStream` are not exported, and `Call.tsx` is not S11L-owned.
7. The adaptive voice-identity subsystem (`src/lib/adaptive/voice-identity/**`, `VoiceIdentityService enabled:false`, the `/api/studio/voice-identity` routes) stays untouched.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the shared contract (sha256 `6b8edcd4…6630`). |
| `src/lib/tireh/identity/voice-band.ts` | New, byte-identical to the shared contract (sha256 `b8d0a41d…21bd`), shared with S10L. Nothing else in `src/lib/tireh/identity`. |
| `src/lib/studio/identity/crypto.ts` | `AesGcmVoiceprintCipher` (32-byte key, `vpk1.<keyId>.<iv>.<tag>.<ct>` base64url, 12-byte IV, AAD = JSON `['vox_voiceprints', ...aad]`, plaintext 1..65536 bytes) and `voiceprintCipherFromEnv` (null when unset; exactly 32 bytes; refuses `STUDIO_SECRET` reuse: raw, first 32 bytes, sha256). Header documents that this is the interim key design: Cloud KMS envelope encryption on Firebase and a written key/backup scheme on the Mac file profile are release gates. |
| `src/lib/studio/identity/store.ts` | `VoiceprintRow`, `EchoTemplateRow`, `VoiceprintStore`; `InMemoryVoiceprintStore`, `FileVoiceprintStore` (JSON `{version:1, rows, echo}`, serialized writes, temp file mode 0600, fsync, rename, re-read before each mutation), `FirestoreVoiceprintStore` (collection `vox_voiceprints`, hashed doc ids `p_…`/`e_…`, kinds `person`/`echo`, equality-only queries). Strict zod on read; invalid rows dropped; templates must start with `vpk1.`. |
| `src/lib/studio/identity/net-speech.ts` | `opusNetSpeech` estimator for Ogg Opus and WebM Opus (Opus TOC accounting, packet-size VAD heuristic). Anything else returns null. Exports `MIN_ENROLL_NET_SPEECH_MS=10_000`, `MAX_ENROLL_GROSS_MS=30_000`, `SPEECH_MIN_BYTES_PER_20MS=10`, re-exports `MIN_NET_SPEECH_MS`. |
| `src/lib/studio/identity/pyannote.ts` | `PyannoteVoiceprintProvider` (media input upload, `/v1/voiceprint`, `/v1/identify`, job polling, zod-parsed responses, content-free errors, never logs, never constructed in tests). `PYANNOTE_MODEL_VERSION='pyannoteai-voiceprint-v1'`. |
| `src/lib/studio/identity/voice.ts` | `VoiceprintService` (enroll, status, delete, invalidate, ensureEchoTemplates, registerEchoVoice, verifyVoiceNote), thresholds parsing and band mapping, `echoVoicesFromStudio`, `chainVoiceInvalidators`. |
| `src/lib/studio/identity/index.ts` | Re-exports plus `voiceprintConfigFromEnv`. |
| `src/lib/adaptive/persistence/service.ts` | **No edit.** The gate is created by setting `voiceRecognitionEnabled` from the flag in `runtime.ts`. |
| `src/lib/studio/runtime.ts` | `voiceRecognitionEnabled: process.env.STUDIO_VOICE_RECOGNITION === '1'` in both adaptive option spreads; one block after the `setVoiceIdentityInvalidator` block wiring `VoiceprintService` and the chained invalidator; env doc comment. |
| `src/lib/studio/service.ts` | Type import; `StudioDeps.voiceprints?`; `voiceVerifier: this.deps.voiceprints` in `gateway()`; `enrollVoice`, `voiceprintStatus`, `deleteVoiceprint` before `auditLog`. |
| `src/lib/studio/http.ts` | `expensive` + `call` limiter for `POST voice-enroll` (only when voiceprints are wired); `GET`/`POST`/`DELETE voice-enroll` before the catalog block. |
| `src/lib/tireh/gateway.ts` | Type import, `GatewayDeps.voiceVerifier?`, and the `transcribe()` body only. |
| `src/app/studio/_components/screens/EnrollScreen.tsx` | New minimal client screen with the UX-07 EN/FA copy (placeholders literal), unchecked statement, bounded capture (stop after 12 s, auto-stop at 30 s, cancel), delete, person-selection callback. Not wired into `StudioApp`. |
| `docs/implementation/VOICE_PROVIDER_INTEGRATION.md` | Appended section "Voiceprints (S11L): key management and release gates". |
| `src/lib/studio/__tests__/voiceprint-fixtures.ts` | Test-only fakes: `FakeVoiceprintProvider`, `fakeEstimator`, `setupVoiceprints`, `fakeFirestore`. No network. |

## Interfaces (names and signatures kept exactly)

```ts
// src/lib/studio/identity/voice.ts
export interface VoiceprintProvider {
  readonly id: string; readonly modelVersion: string;
  voiceprint(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Uint8Array>;
  /** query = raw voice-note audio; candidates carry opaque ids only ('self', 'echo:<n>'). */
  identify(query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal): Promise<{ candidateId?: string; score: number }>;
}
export interface VoiceBandThresholds { readonly match: number; readonly uncertain: number; readonly echo: number } // 0 < echo <= uncertain < match <= 1
export interface VoiceThresholdConfig { readonly default: VoiceBandThresholds; readonly orgs?: Readonly<Record<string, VoiceBandThresholds>> }
export function parseVoiceThresholds(raw: string | undefined): VoiceThresholdConfig | null; // throws on invalid
export function bandFor(score: number, t: VoiceBandThresholds): VoiceBand;
export type VoiceprintUnavailableReason = 'disabled' | 'adaptive_unavailable' | 'profile_confirmation_required' | 'capability_unavailable' | 'biometric_consent_required' | 'provider_unavailable' | 'thresholds_missing' | 'echo_guard_unavailable';
export interface VoiceprintStatus { space: 'work' | 'personal'; available: boolean; reason?: VoiceprintUnavailableReason; enrolled: boolean; provider?: string; modelVersion?: string; channel?: VoiceprintRow['channel']; createdAt?: string; lastConfirmedAt?: string }
export type VoiceprintErrorCode = VoiceprintUnavailableReason | 'empty_audio' | 'too_short' | 'too_long' | 'unsupported_audio' | 'self_echo' | 'consent_changed' | 'provider_error';
export class VoiceprintError extends Error { constructor(readonly code: VoiceprintErrorCode, readonly status: number) }
export type EchoVoiceSource = () => Promise<readonly { voiceId: string; synthesize(signal: AbortSignal): Promise<{ audio: ArrayBuffer; mimeType: string }> }[]>;
export interface VoiceprintServiceDeps {
  store: VoiceprintStore; cipher: VoiceprintCipher; provider?: VoiceprintProvider;
  adaptive?: Pick<AdaptiveService, 'withDirectAuthority' | 'isPurposeAllowed' | 'isProfileConfirmed' | 'capabilityStatus'>;
  thresholds: VoiceThresholdConfig | null; orgKey: string; echoVoices?: EchoVoiceSource; netSpeech?: NetSpeechEstimator;
  flags?: () => Pick<TirehFlags, 'voiceRecognition'>; now?: () => Date; deadlineMs?: number; enrollTimeoutMs?: number;
}
export class VoiceprintService implements VoiceNoteVerifier {
  enroll(input: { telegramId: number; personId: string; space: 'work' | 'personal'; audio: ArrayBuffer; mimeType: string; channel: VoiceprintRow['channel'] }, signal?: AbortSignal): Promise<VoiceprintStatus>;
  status(input: { telegramId: number; personId: string; space: 'work' | 'personal' }): Promise<VoiceprintStatus>;
  delete(input: { personId: string; space?: 'work' | 'personal' }): Promise<{ deleted: number }>;
  invalidate(telegramId: number, space?: 'work' | 'personal'): Promise<void>;
  ensureEchoTemplates(signal?: AbortSignal): Promise<number>;
  registerEchoVoice(voiceId: string, audio: ArrayBuffer, mimeType: string, signal?: AbortSignal): Promise<void>;
  verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification>; // never throws
}
export const VOICE_VERIFY_TIMEOUT_MS = 3_000; export const ENROLL_TIMEOUT_MS = 30_000;
export const MAX_ENROLL_AUDIO_BYTES = 1_000_000; export const MAX_VERIFY_AUDIO_BYTES = 2_000_000;
export function echoVoicesFromStudio(store: StudioStorage, eleven: ElevenLabsStudio | null): EchoVoiceSource;
export function chainVoiceInvalidators(...handlers): (input: { telegramId: number; space?: 'work' | 'personal'; reason: string }) => Promise<void>;

// src/lib/studio/identity/store.ts
export interface VoiceprintRow { personId: string; space: 'work' | 'personal'; provider: string; modelVersion: string; channel: 'telegram_voice_note' | 'mini_app'; consentEventId: string; createdAt: Date; lastConfirmedAt?: Date; template: string }
export interface EchoTemplateRow { voiceId: string; provider: string; modelVersion: string; createdAt: Date; template: string }
export interface VoiceprintStore { get; put; delete; listEcho; putEcho }

// src/lib/studio/identity/crypto.ts
export interface VoiceprintCipher { readonly keyId: string; seal(plain: Uint8Array, aad: readonly string[]): string; open(sealed: string, aad: readonly string[]): Uint8Array }

// src/lib/studio/identity/index.ts
export interface VoiceprintEnvConfig { enabled: boolean; cipher: AesGcmVoiceprintCipher; provider?: PyannoteVoiceprintProvider; thresholds: VoiceThresholdConfig | null }
export function voiceprintConfigFromEnv(env: NodeJS.ProcessEnv, o: { storage: 'file' | 'firestore'; production: boolean }): VoiceprintEnvConfig | null;

// HTTP (/api/studio): POST voice-enroll (FormData audio, space, statement='enroll_my_voice'; 'expensive' + 'call' limiters),
// GET voice-enroll?space=, DELETE voice-enroll?space=
```

## Authority (VoiceprintService)

`authority(telegramId, space, agentId?)` runs inside `adaptive.withDirectAuthority`:

- `personAllowed = isPurposeAllowed(d, space, 'optional.biometric_recognition', now) && p.state === 'granted' && p.expiresAt > now && !!p.lastEventId` (profile confirmation, capability approval via `eligible()` and the flag-driven option are all inside `isPurposeAllowed`);
- `agentAllowed = personAllowed && (!agentId || isPurposeAllowed(..., agentId))`;
- reason: unconfirmed profile → `profile_confirmation_required`; `feature_not_released` → `disabled`; not eligible → `capability_unavailable`; else `biometric_consent_required`;
- any throw → not allowed, `adaptive_unavailable`.

## verifyVoiceNote (never throws, never mutates `input.audio`)

1. Flag off → `disabled`.
2. Group chat or guest audience → `guest_or_group`; nothing is read, decoded or sent.
3. Missing provider, adaptive or thresholds → `disabled`.
4. `durationSec < 3` → `too_short`; audio over 2 MB → `provider_error` (no provider call).
5. personId not `tg-<n>` → `not_enrolled`. 6. No row → `not_enrolled`.
7. Not personAllowed → delete row, `consent_missing`; not agentAllowed → `consent_missing`, row kept.
8. consentEventId changed → delete, `not_enrolled`; provider/model changed → `not_enrolled` (kept).
9. No echo templates → `disabled`.
10. Net speech null → `too_short`; under 3000 ms → `too_short` with `netSpeechMs`.
11. Open templates with AAD (owner `[personId, space, provider, modelVersion, consentEventId]`, echo `['echo', voiceId, provider, modelVersion]`).
12. `provider.identify(bytes, [{id:'self'}, {id:'echo:<i>'}…])` with a deadline (`VOICE_VERIFY_TIMEOUT_MS`); timeout/abort → `timeout`.
13. Zero-fill opened templates.
14. Echo winner at or above `t.echo` → `self_echo`; echo winner below → `NO_MATCH`; `self` → `bandFor(score)`; otherwise `NO_MATCH`.

## enroll

Flag → provider → thresholds → size → authority → net speech (null 415, <10 s 422, >30 s 413) → echo templates (none: 503) → self-echo check (422) → `provider.voiceprint` (bounded by `ENROLL_TIMEOUT_MS`) → authority re-check (409 `consent_changed`) → seal and put → authority check again (delete and 409 on change) → zero the template → `status()`. Provider errors map to 502 `provider_error`.

## Flags

- `STUDIO_VOICE_RECOGNITION=1` (default off). Read through `tirehFlags().voiceRecognition` at call time. `runtime.ts` also sets `voiceRecognitionEnabled` with `process.env.STUDIO_VOICE_RECOGNITION === '1'`. Unset keeps the `feature_not_released` deny. Set, it still requires a confirmed profile, capability approval for `biometric_recognition` from `STUDIO_ADAPTIVE_POLICY_JSON`, a granted `optional.biometric_recognition` with affirmative evidence and, for verification, the persona's agent grant.
- `VOICEPRINT_KEY`: base64 of exactly 32 bytes, never derived from `STUDIO_SECRET`. Required with the flag. Set with the flag off: status/delete-only mode. Both unset: nothing wired.
- `PYANNOTE_API_KEY`: without it there is no provider (`provider_unavailable`).
- `PYANNOTE_BASE_URL`: optional https origin (EU residency). Default `https://api.pyannote.ai`.
- `VOICE_MATCH_THRESHOLDS_JSON`: `{"default":{match,uncertain,echo},"orgs":{"<orgName>":{…}}}`, `0<echo<=uncertain<match<=1`; parsed only with the flag on; invalid → startup error; unset → enroll 503 `thresholds_missing`, verify `disabled`.
- Production on Firestore with the flag refuses to start until Cloud KMS envelope encryption exists.

## Tests

- `voiceprint-gates.test.ts`: flag/approval/consent/profile gates, base deny preserved, enrolled row shape, net speech and size errors, self-echo, no echo voices.
- `voiceprint-withdrawal.test.ts`: withdrawal and profile change delete via the chained invalidator, space isolation, lazy expiry deletion, idempotent delete with the flag off, verify after withdrawal, enroll/withdraw race, invalidator chaining.
- `voiceprint-verify.test.ts`: bands and boundaries, per-org thresholds, threshold parsing, net-speech guard, self-echo, guests and groups untouched, not enrolled, agent grant, opaque candidate ids, provider error, timeout, never rejects, audio unchanged, flag off.
- `voiceprint-store.test.ts`: cipher, env key, file store, Firestore store, `voiceprintConfigFromEnv`.
- `voiceprint-no-audio.test.ts`: canary scan of every persisted file, Firestore fake doc, log and audit row.
- `voiceprint-http.test.ts`: statement, spaces, limiters, base 404 without voiceprints, pending member.
- `voiceprint-gateway.test.ts`: verifier call shape, concurrency with STT, transcript unchanged, rejecting verifier, groups/guests, no verifier dep, `liveTurn` untouched.
- `voiceprint-net-speech.test.ts`: synthesized Ogg and WebM Opus, silence, TOC code 3, unsupported and malformed input.
- `EnrollScreen.test.tsx`: unchecked statement, UX-07 copy as substrings of the doc, RTL, recording, cancel, unmount, delete, unavailable reason, person selection.

## Acceptance

- Shared file sha256 values match the contract.
- Lib-scoped strict `tsc` (plus `EnrollScreen.tsx`) exits 0.
- `npx vitest run src/lib/tireh src/lib/adaptive/decisions` keeps its base result; the studio/adaptive suites show no new failing files beyond the sandbox baseline.
- With the flag and key unset: `studio.deps.voiceprints` is undefined, `transcribe` follows the base path, `voice-enroll` returns the base 404 with no extra limiter, and biometric consent is still denied with `feature_not_released`.
- No network in tests; no audio, transcript or plaintext template in any persisted file, Firestore fake doc, log or audit row; templates at rest start with `vpk1.`.
- Guests and groups: no store read, decode, template open or provider call.
- Withdrawal or a profile change deletes templates through the chained invalidator, and `VoiceIdentityService.invalidate` is still called.
- Untouched: `persistence/service.ts`, `adaptive/voice-identity/**`, `voice-call.ts`, `StudioApp.tsx`, `Privacy.tsx`, `Call.tsx`, `client.ts`, `timing.ts`, `diagnostics.ts`, `package.json` and existing tests. `gateway.ts` changes only in the import, the `GatewayDeps` field and the `transcribe()` body.

## Out of scope

Step 1 (snapshots, revision vectors, `boundary()`/`unchanged()`, `adaptiveContext*`, `runtimePrivacy`, persistence seams, the `liveTurn` loop); S10/S10L (`IdentityService`, consuming the band; the result is discarded with `TODO(S10)`); editing `eligible()`; the adaptive voice-identity subsystem; multi-clip and per-language enrollment, adaptive templates, re-embedding and the re-enrol clock; live-call verification, group diarization, identification of guests, emotion inference and cloning (PRIV-025); Cloud KMS and the file-profile key scheme (documented gates only); member-leave and inactivity deletion hooks, the CUBI clock and BIPA release execution; watermark detection and AASIST countermeasures; the FAR/FRR study and counsel opinion; wiring `EnrollScreen` into `StudioApp`, extracting `Call.tsx` helpers, `client.ts` helpers; the pyannoteAI processor-table row (S15); fixing `Privacy.tsx`.

## Risks

- Latency with the flag on: `Promise.all` can add up to 3 s per 1:1 voice note even in shadow mode. Measure with `STUDIO_STAGE_TIMINGS` (`stt` stage) before enabling; consider fire-and-forget once S10 decides how bands are consumed.
- pyannoteAI API details (upload, endpoints, polling, confidence scale, model name, EU URL, 24 h retention) come from public docs and are unverified against a live account.
- The net-speech estimator is a packet-size heuristic, not a VAD; calibrate in the FAR/FRR study. Non-Opus captures (Safari `audio/mp4`) are refused for enrollment.
- `identify` returns only the best candidate; when an echo template wins below the echo threshold the owner score is unknown and the result is `NO_MATCH`.
- The echo guard needs at least one persona echo template, generated lazily at enrollment (ElevenLabs credits, pyannote processing of synthetic voices). Cloned voices make echo templates biometric data too; they are sealed in the same isolated store.
- The interim `VOICEPRINT_KEY` design does not satisfy the key-management gate. Firestore production is blocked in code; the file profile is a documented gate.
- `withDirectAuthority` on legacy file storage runs one adaptive transaction per verified voice note; a busy indexed store yields `consent_missing` (fail closed).
- Setting `voiceRecognitionEnabled` also makes biometric consent grantable in the adaptive Privacy UI; the existing `VoiceIdentityService` stays unavailable because its provider is not enabled.
- A future writer of `setVoiceIdentityInvalidator` could drop voiceprint deletion; keep `chainVoiceInvalidators`.
- Legal: counsel on verification vs remote identification, the jurisdiction registry (Illinois and Texas blocked), DPIA and a PRIV-019 local-first review are required before any non-shadow use. The flag stays off in production until those gates are signed.
