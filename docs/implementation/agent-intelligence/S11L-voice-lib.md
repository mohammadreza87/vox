# S11L: voice enrollment and verification library (shadow mode, default off)

This is Step 11 of [`docs/AGENT_INTELLIGENCE_SOLUTION.md`](../../AGENT_INTELLIGENCE_SOLUTION.md): sections 2.4 and 4.9, and the Step 11 row of section 5. It is constrained by [`PRIVACY_AND_CONSENT.md`](../PRIVACY_AND_CONSENT.md) PRIV-017 to PRIV-025 and UX-07.

- Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`.
- Branches: `aiq/voice-lib`, then `aiq/voice-lib-r2`, which aligns the work with the revised spec.
- Operator notes: [`VOICE_PROVIDER_INTEGRATION.md`](../VOICE_PROVIDER_INTEGRATION.md#voiceprints-behind-studio_voice_recognition-s11l).

## Goal

Add an isolated library for voiceprint enrollment and 1:1 verification under `src/lib/studio/identity`. Nothing runs unless all of these hold:

- `STUDIO_VOICE_RECOGNITION=1`, read with `tirehFlags()` at call time;
- the adaptive capability approval (`eligible()`; `runtime.ts` sets `voiceRecognitionEnabled` from the flag);
- a granted `optional.biometric_recognition` whose last event carries affirmative `ConsentEvidence`;
- a confirmed profile and a non-pending member;
- an agent grant, for verification only;
- for verification of voice notes, also `STUDIO_VOICE_SHADOW=1` (`tirehFlags().voiceShadow`, which is off whenever `STUDIO_VOICE_RECOGNITION` is; added on integration).

The result is discarded (shadow mode; S10 consumes it later). With every flag and `VOICEPRINT_KEY` unset, behaviour is the base.

## Files

| Path | Content |
|---|---|
| `src/lib/tireh/flags.ts`, `src/lib/tireh/identity/voice-band.ts` | Shared contract files, byte-identical (sha256 `6b8edcd4…6630`, `b8d0a41d…21bd`) when this step was built. Note: `flags.ts` changed after the steps merged, on `agent-intelligence-wave-a-main`: `voiceShadow` (`97bf549`), `webhookFailClosed` (`ebc18d9`), then `voiceShadow` composed with `voiceRecognition` (H3, `e94ca83`); current sha256 `7adeaa35129d3ac610ef67940eff790b49417206ee4ccff3f7b88cc5db806740`, pinned in `llm-blocks.test.ts` and `llm-blocks.main-lineage.test.ts`. `voice-band.ts` is unchanged. |
| `src/lib/studio/identity/provider.ts` | `VoiceprintProvider` (`identify(query)` takes the query AUDIO; score is in [0,1]), `SpeechActivity`, and `VoiceprintProviderError` (code-only message). |
| `src/lib/studio/identity/pyannote.ts` | `PyannoteVoiceprintProvider` (`pyannoteai:precision-2`, https `*.pyannote.ai` only). It uploads through media/input plus a PUT, shares one upload per audio digest for 10 minutes, runs jobs with polling, and provides `speechActivity()` from diarization. |
| `src/lib/studio/identity/net-speech.ts` | `grossTooShort`, `netSpeechFromSegments` and `meetsNetSpeech` (3 s floor; 10 s for enrollment). |
| `src/lib/studio/identity/crypto.ts` | `parseVoiceprintKey` (32 bytes; refuses `STUDIO_SECRET` reuse) and `VoiceprintCipher` (`vp1.<keyId>.<iv>.<tag>.<ct>`, AES-256-GCM, AAD bound to person, space, provider, model and consent event). |
| `src/lib/studio/identity/config.ts` | Per-org and per-channel thresholds (strict zod; no defaults), `bandFor`, `pilotManifest` and `voiceprintEnv`. |
| `src/lib/studio/identity/store.ts` | `VoiceprintRow` (strict), `voiceprintDocId`, and `InMemory`/`File`/`FirestoreVoiceprintStore` with get, put, touch, delete and list. |
| `src/lib/studio/identity/self-echo.ts` | `PersonaVoiceEchoSource`: in-memory echo templates of every persona voice, single-flight warm, fail-closed `templates()`. |
| `src/lib/studio/identity/voice.ts` | `VoiceprintService` (enroll, status, delete, invalidate, sweep, warmSelfEcho, verifyVoiceNote), `biometricGrant` and `VoiceprintError`. |
| `src/lib/studio/identity/index.ts` | Re-exports and `createStudioVoiceprints`. |
| `src/lib/studio/runtime.ts` | `voiceRecognitionEnabled` in both adaptive spreads, plus one block after the `setVoiceIdentityInvalidator` block that re-sets the single invalidator slot with a chained handler. |
| `src/lib/studio/service.ts` | `StudioDeps.voiceprints`, `voiceVerifier` in `gateway()`, and `enrollVoice`, `voiceprintStatus` and `deleteVoiceprint`. These act on the actor's own row only and write no audit row. |
| `src/lib/studio/http.ts` | `POST/GET/DELETE voice-enroll`. POST takes FormData audio, space and `statement=accepted`, and consumes the expensive and call limiters. |
| `src/lib/tireh/gateway.ts` | Type import, the `GatewayDeps.voiceVerifier` field, and `transcribe()`. As written, it ran verification with `Promise.all` beside STT; on main it is fire-and-forget behind `tirehFlags().voiceShadow` (see the integration section). |
| `src/app/studio/_components/screens/EnrollScreen.tsx` | UX-07 EN/FA copy with literal placeholders. Not wired into `StudioApp`. |

`src/lib/adaptive/persistence/service.ts` is not edited. Setting the option from the flag is the gate, and the `adaptive/voice-identity` tests set the option without the env.

## Deviations from the written spec

- **The HTTP route and limiter only act when `studio.deps.voiceprints` is set.** Without `VOICEPRINT_KEY`, `voice-enroll` stays the base 404 and consumes no extra limiter, because the hard rule requires unset flags to behave exactly as the base. `Studio.voiceprintStatus` and `deleteVoiceprint` still return the not-available status when called directly.
- **The presigned media PUT carries no `Authorization` header.** The API key must not reach the storage host, and a presigned URL carries its own authorization. Every pyannoteAI API call sends `Bearer`.
- **Authority reasons are ordered profile, then capability, then consent.** An unconfirmed profile is reported as `profile_confirmation_required` even when the capability check would also fail.
- **`status()` deletes a template whose `consentEventId` no longer matches the current grant**, as `verifyVoiceNote` does. Re-consent therefore never shows a stale enrollment.

## Integration onto main (2026-10-25/26)

Merged as `f8a4b5c` onto `agent-intelligence-wave-a-main`, then hardened by the QA fixer rounds and the hardening
clusters H3 (flags), H5 (voiceprints) and H6 (membership). This section describes the merged code; where it differs from
the sections above, it wins.

- **Shadow flag.** `STUDIO_VOICE_SHADOW=1` (`tirehFlags().voiceShadow`, read at call time) gates verification of
  private voice notes. `flags.ts` composes it as `voiceRecognition && STUDIO_VOICE_SHADOW`, so it is never on without
  `STUDIO_VOICE_RECOGNITION` (H3). Product decision (n) keeps it off by default.
- **Fire-and-forget.** `transcribe()` starts `verifyVoiceNote` without awaiting it, bounded by
  `AbortSignal.timeout(VOICE_SHADOW_DEADLINE_MS)` (3000 ms); the reply never waits for it and its result is discarded.
  `verifyVoiceNote` is registered with `track()`, so `invalidate()` aborts an in-flight verification (no match, no touch).
- **`authorityNow` fence** (ported from main's `8a7dc55`): the authority is re-read immediately before `cipher.open`
  and before every provider export, so a withdrawal during a verification stops it before a template is decrypted or
  audio leaves the process.
- **Production Firestore refusal.** `createStudioVoiceprints` takes `production`; with the flag on, Firestore storage
  and a production runtime it refuses at startup until Cloud KMS envelope encryption exists (restored in `18d0415`).
- **Local-engine exclusion.** When main's local voice engine (`c2c0bee`) is selected, the runtime passes the
  voiceprints `STUDIO_VOICE_RECOGNITION='0'`, so the two are never on together.
- **Missing key and thresholds (product decision (h)).** A missing `VOICEPRINT_KEY` leaves voiceprints off (nothing is
  constructed; main failed startup). An invalid `VOICE_MATCH_THRESHOLDS_JSON` logs `voiceprint_thresholds_invalid` and
  verification gives no opinion (main failed startup). An invalid key, or one reusing `STUDIO_SECRET`, still fails
  startup. Whether to restore main's fail-fast is decision (h).
- **Verify cap.** `verifyVoiceNote` returns no opinion for audio above `MAX_VOICEPRINT_AUDIO_BYTES` (10 MiB) before any
  read, authority check, tracking or upload; the reason is the generic `VERIFY_TOO_LARGE_REASON` bucket because the
  shared reason union is byte-pinned (H5).
- **`chainVoiceInvalidators`.** Exported from `identity/voice.ts` and wired in `runtime.ts` as
  `setVoiceIdentityInvalidator(chainVoiceInvalidators(voiceIdentity, voiceprints))`, with main's `Promise.allSettled`
  semantics: a rejecting `VoiceIdentityService` no longer cuts the voiceprint deletion short (H5). With the flag on, a
  member demoted to `pending` has their templates invalidated at once (`Studio.setRole`, H6); a failure logs
  `[vox] voiceprint invalidate_failed` and never fails the role change.
- **Daily sweep.** `startVoiceprintSweep(voiceprints, { onError })` sweeps now and then daily on an unref'd timer and
  reports only `sweep_failed` (logged as `[vox] voiceprint sweep_failed`). The sweep walks `VoiceprintStore.listKeys()`
  (key fields only, never the sealed template; Firestore pages of 200 by document id with a field mask) and reads
  membership once per sweep through `eligiblePeople`; a failed membership read deletes only expired rows and then
  rejects. `warmSelfEcho` failures log `[vox] voiceprint warm_failed` (H5).
- **Upload cache.** One pyannoteAI upload per audio digest is shared for 10 minutes. The shared upload runs on its own
  signal (`AbortSignal.timeout(UPLOAD_TIMEOUT_MS)`, 30 s, aborted once no caller waits), and each caller joins it through
  its own signal, so one caller's deadline fails only that caller; a rejected upload is evicted (H5).
- **Store.** `FirestoreVoiceprintStore.touch()` is a field update that never recreates a deleted template (fixer r3).

## Tests

- `voiceprint-gates.test.ts`: flag, capability, approval, profile, consent states, affirmative evidence, pending member, pilot manifest, thresholds and the happy path, plus post-capture refusals and timeout.
- `voiceprint-withdrawal.test.ts`: withdrawal and profile change through the chained invalidator, space isolation, a race with a pending provider, deletion with the flag off, re-consent and the sweep.
- `voiceprint-verify.test.ts`: bands, thresholds, net speech, the self-echo guard, the echo source and failure paths.
- `voiceprint-guests.test.ts`: groups, guests, non-members, pending people and mixed speakers, plus gateway-level wiring.
- `voiceprint-storage.test.ts`: canaries, schema, file mode, the cipher, the key, the Firestore store and `createStudioVoiceprints`.
- `voiceprint-http.test.ts`, `voiceprint-liveturn.test.ts` and `voiceprint-pyannote.test.ts`.
- `EnrollScreen.test.tsx`.

## Out of scope

- Step 1 seams.
- S10 consumption of the band.
- The adaptive voice-identity subsystem.
- Multi-clip or per-language enrollment, adaptive templates and re-embedding.
- Calibration (FAR/FRR).
- Watermark detection and countermeasures.
- The Cloud KMS implementation and the file-profile key scheme, which are documented gates.
- Wiring `EnrollScreen`.
- Live calls.
- `package.json`.
