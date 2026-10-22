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
- an agent grant, for verification only.

The result is discarded (shadow mode; S10 consumes it later). With every flag and `VOICEPRINT_KEY` unset, behaviour is the base.

## Files

| Path | Content |
|---|---|
| `src/lib/tireh/flags.ts`, `src/lib/tireh/identity/voice-band.ts` | Shared contract files, byte-identical (sha256 `6b8edcd4…6630`, `b8d0a41d…21bd`). |
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
| `src/lib/tireh/gateway.ts` | Type import, the `GatewayDeps.voiceVerifier` field, and `transcribe()`, which runs `Promise.all` with STT for private chats after the Step 0 guard. |
| `src/app/studio/_components/screens/EnrollScreen.tsx` | UX-07 EN/FA copy with literal placeholders. Not wired into `StudioApp`. |

`src/lib/adaptive/persistence/service.ts` is not edited. Setting the option from the flag is the gate, and the `adaptive/voice-identity` tests set the option without the env.

## Deviations from the written spec

- **The HTTP route and limiter only act when `studio.deps.voiceprints` is set.** Without `VOICEPRINT_KEY`, `voice-enroll` stays the base 404 and consumes no extra limiter, because the hard rule requires unset flags to behave exactly as the base. `Studio.voiceprintStatus` and `deleteVoiceprint` still return the not-available status when called directly.
- **The presigned media PUT carries no `Authorization` header.** The API key must not reach the storage host, and a presigned URL carries its own authorization. Every pyannoteAI API call sends `Bearer`.
- **Authority reasons are ordered profile, then capability, then consent.** An unconfirmed profile is reported as `profile_confirmation_required` even when the capability check would also fail.
- **`status()` deletes a template whose `consentEventId` no longer matches the current grant**, as `verifyVoiceNote` does. Re-consent therefore never shows a stale enrollment.

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
