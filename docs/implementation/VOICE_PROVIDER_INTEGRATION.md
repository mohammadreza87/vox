# Voice provider and provisional transcript decision — 19 October 2026

Research for Joyixir OÜ. No provider request, credential inspection, account configuration change or real enrollment was performed. The research informed the local implementation below; it does not qualify a provider or establish legal approval.

## Shortest path

Partial voice prediction is implementable on the existing ElevenLabs call without a second STT subscription: the installed @elevenlabs/client 0.12.2 normal onMessage callback handles final user_transcript but does not dispatch tentative_user_transcript. Unrecognized events fall through to onDebug. Installed @elevenlabs/types 0.4.0 defines tentative_user_transcription_event with user_transcript and numeric event_id. Allowlist and schema-check exactly that event; never log raw debug payloads. Use local monotonically increasing transcript revisions. A final normal onMessage invalidates the entire current partial epoch because this older SDK drops its final event_id. Interruption/mute/session/scope change/unmount invalidate too. Explicit off-by-default EN/FA permission to prepare while listening is independent of ordinary mic permission. Enable only when the exact agent's tentative_user_transcript client-event configuration is verified. Current account configuration is unverified. Docs warn that events are not all enabled by default.

Primary docs: https://elevenlabs.io/docs/eleven-agents/libraries/java-script and https://elevenlabs.io/docs/eleven-agents/customization/events/client-events . Local evidence: node_modules/@elevenlabs/client/dist/lib.modern.js dispatch; dist/BaseConversation.d.ts; @elevenlabs/types/dist/generated/types/asyncapi-types.d.ts lines82–112. Current upstream source: https://github.com/elevenlabs/packages/blob/main/packages/client/src/BaseConversation.ts . Installed Scribe separately exposes partial_transcript and committed_transcript, but adding it would duplicate audio export/cost and require a new token/retention path; it is unnecessary if the existing Agents event is available.

## Real optional speaker hint engine

Recommended implementation direction: stateless local/self-hosted SpeechBrain ECAPA-TDNN worker plus the existing optional enrollment lifecycle. This produces actual reusable opaque speaker embeddings and cosine-comparison scores; it is not a fabricated matching provider. Keep only authenticated self in the candidate set. Existing AES-GCM storage can hold the versioned opaque vector. A Python/PyTorch/torchaudio worker converts explicitly captured audio to mono16kHz, checks length/quality, extracts via encode_batch, compares locally and immediately releases working buffers. Bind model digest/version to templates and reject mismatches. Do not adopt the library's example threshold as a product acceptance threshold. No new SaaS secret is required for offline inference after a reviewed model download; a private service endpoint/token and separate template-encryption key are deployment choices. CPU/GPU latency and Persian/English quality remain unmeasured.

Primary model card (Apache2.0, extraction and verification examples, 16kHz requirement and out-of-domain limitation): https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb . API: https://speechbrain.readthedocs.io/en/latest/API/speechbrain.inference.speaker.html .

ECAPA alone does NOT implement live-challenge ASR, overlap isolation, replay/synthetic detection or consent. Do not make inspect() return eligible_single_live merely because it emits an embedding. A qualified pre-extraction inspection path and measured abstention/spoof bounds remain required by the current provider contract. Real engine/container/transport can be implemented now with synthetic contract tests, but real enrollment stays off until the legal/jurisdiction release, reviewable numeric retention/threshold policy, restricted key/service provisioning, and approved EN/FA recordings/devices qualify this exact version. Recognition remains possible-self/unknown only and cannot select a person, unlock memories or change ACLs.

## Cloud alternatives and exact mismatch

pyannoteAI has real POST /v1/voiceprint and /v1/identify endpoints with explicit supplied voiceprints, scores/matching thresholds, and async job output. It requires a new API key/plan, reviewed cloud-region/DPA/subprocessors and audio URL/media upload access plus async polling/webhook handling. The default public policy says media uploads≤48h, worker audio removed after processing, job outputs≤24h, submitted voiceprint content/labels redacted≤96h, while certain request metadata/input records are retained indefinitely. This is incompatible with blindly declaring the existing request_only/purge contract satisfied. No immediate-delete confirmation was verified. It is a possible separate reviewed cloud contract, not the shortest drop-in adapter.

Primary endpoints: https://docs.pyannote.ai/api-reference/voiceprint and https://docs.pyannote.ai/api-reference/identify . Retention: https://www.pyannote.ai/terms-of-use AppendixA. Provider explicitly distinguishes speaker comparison from biometric authentication: https://www.pyannote.ai/blog/speaker-diarization-vs-recognition-vs-identification .

OpenAI's installed SDK6.9.1 and current transcription API support gpt-4o-transcribe-diarize with known_speaker_names/references and diarized_json. The references are raw audio data URLs, not opaque reusable voiceprints. That would require retaining/retransmitting enrollment audio contrary to the current raw-sample-delete-after-extraction architecture. Its speaker labels are not an authentication or anti-spoof proof. Existing OpenAI credentials alone therefore do not make it a compatible biometric adapter. Primary reference: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create .

No general ElevenLabs speaker-verification/voiceprint comparison endpoint was established from the primary docs inspected. Its professional-cloning ownership verification is a different purpose and must not be reused as optional recognition authorization: https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/professional-voice-cloning .

## Implemented local integration and remaining gate

`src/lib/adaptive/prediction/voice-client.ts` consumes the installed SDK's actual `tentative_user_transcript` debug shape, forwards only bounded user text through the existing signed prediction transport, and uses the existing two-evaluation-per-turn/debounce/revision cancellation. It never logs the raw event, stores audio, selects identity, invokes actions, speaks, or passes a route hint into the final user message. Final user messages invalidate the current provisional epoch; revisions cancel older preparation; interruption, speaking/mute, scope changes, errors, disconnect and unmount cancel too. Work and Personal remain separate and server authority is rechecked by the existing endpoint, Decisions and retrieval boundaries. The result is only a preparation hint; ordinary conversation continues independently.

The Call screen provides a separate English/Persian **Prepare while I speak** disclosure and off-default checkbox, reset per call/scope. It is independent of microphone permission and optional analytics. Availability has a real read-only path: `ElevenLabsStudio.partialTranscriptVersion` reads the exact remote agent configuration, validates its agent/version, required event list, custom-LLM URL and secret reference, then `signedUrl` pins the session to that same `version_id`. The getter has a 400ms abort/deadline and bootstrap adds a 450ms outer bound. Missing fields/methods, unverified events, errors or timeouts report `client_event_configuration_unverified`; ordinary calls continue. Current core policy, selected-space agent grant and configured Decisions are required before and after qualification. Neither a local flag nor arrival of a raw event enables preparation. No provider agent is regenerated or patched for this feature. The actual account's event configuration and real EN/FA device delivery have not been inspected or qualified by this work.

Primary activation contracts: [Get agent](https://elevenlabs.io/docs/api-reference/agents/get) documents `conversation_config.conversation.client_events` and `version_id`; [Get signed URL](https://elevenlabs.io/docs/api-reference/conversations/get-signed-url) documents the `version_id` selector. These establish the request contract, not proof of an account's current configuration. Changing an agent's client events remains a separate explicit provider configuration operation.

Tap-to-talk alone can display optional task feedback when the server supplies an accepted turn ID. Browser playback reports a bounded client-reported request-to-event duration from actual `onplaying`/`onended`/error callbacks; this is not verified hearing or end-of-speech latency. Provider-managed live STT, TTS, browser playback and task correlation remain unavailable where no corresponding measured callback/turn identifier exists. There is no new speaker-recognition provider in this change: the existing biometric feature remains unavailable without a separately qualified adapter, canonical permission and explicit enrollment.

Helper tests cover allowlisting, EN/FA text, opt-in/configuration gates, debounce, correction/abort/invalidation, two-call budgets across advancing provider event IDs, final/mute/withdraw/unmount and stale events. Call tests drive actual installed-callback shapes under a synthetic SDK fixture, including a provider mode change while muted. A connected synthetic test gets the available capability through the actual version getter over synthetic external responses, pins the signed session, then drives the in-process signed HTTP handler, real file storage, canonical account/grant checks and real DecisionService. It asserts an answered receipt, content-free persisted state and server cancellation; bounded preparation can truthfully return false on its 250ms deadline. These tests do not establish compiled Next/browser behavior, provider event delivery, latency, quality or real-device behavior. No paid calls or external configuration changes were made.

Validation: **83 tests / 8 files passed**, with ESLint on owned/shared changed paths and TypeScript passing. Run `npx vitest run src/lib/studio/__tests__/voice-live-authority.test.ts src/lib/studio/__tests__/voice-partial-configuration.test.ts src/lib/adaptive/prediction/voice-client.test.ts src/lib/adaptive/prediction/voice-integration.test.ts src/app/studio/_components/VoicePreparationPanel.test.tsx src/app/studio/_components/screens/Call.test.tsx src/lib/studio/__tests__/voice-call.test.ts src/lib/studio/__tests__/media.test.ts`. The 13 isolated live-authority tests also cover blocked bootstrap, withholding a signed URL, fresh transport authorization after canonical awaits, stream closure, reflection and share-offer output suppression. Already delivered stream chunks remain delivered; independent stores are not an atomic distributed transaction.

## خلاصهٔ فارسی

برای Joyixir OÜ، مسیر متن موقت تماس با رویداد واقعی SDK پیاده‌سازی شده است. این مسیر فقط پس از انتخاب جداگانهٔ کاربر و تأیید پیکربندی همان تماس، متن محدود را برای پیش‌بینی و آماده‌سازی اطلاعات مجاز می‌فرستد. متن موقت، صدا یا الگوی صدا در گزارش عمومی ذخیره نمی‌شود. تغییر متن، پایان نوبت، وقفه، بی‌صداکردن، تغییر فضا و خروج، آماده‌سازی قبلی را لغو می‌کند. این سیگنال هویت را تأیید نمی‌کند، دسترسی نمی‌دهد، عملی اجرا نمی‌کند و پاسخ نهایی را جایگزین نمی‌کند.

مسیر فعال‌سازی، پیکربندی همان عامل و نسخه را فقط می‌خواند و فهرست رویدادها، مقصد مدل و مرجع کلید را بررسی می‌کند؛ سپس نشانی امضاشده را به همان نسخه متصل می‌کند. نبود اطلاعات، خطا یا پایان مهلت، قابلیت اختیاری را غیرفعال نگه می‌دارد و تماس معمولی ادامه دارد. سیاست متن اصلی، مجوز عامل در فضای انتخاب‌شده و سرویس Decisions نیز لازم‌اند. پیکربندی حساب واقعی و تحویل رویداد روی دستگاه هنوز در این کار آزمایش نشده‌اند؛ هیچ تغییر حسابی خودکار انجام نمی‌شود.

تشخیص گوینده با ECAPA به سرویس محلی، مدل و نسخهٔ تأییدشده، بازرسی معتبر پیش از استخراج، سیاست حقوقی/نگهداری و ارزیابی انگلیسی و فارسی نیاز دارد. ECAPA به‌تنهایی اثبات زنده‌بودن یا مقابله با صدای بازپخش‌شده و مصنوعی نیست. هیچ صدای واقعی ثبت نشده و هیچ تغییر حساب یا فراخوانی پولی انجام نشده است. زمان پخش گزارش‌شدهٔ مرورگر، اثبات شنیدن یا زمان واقعی پایان گفتار نیست؛ اندازه‌گیری‌های زنده‌ای که دادهٔ معتبر ندارند همچنان ناموجود هستند.

## Voiceprints behind STUDIO_VOICE_RECOGNITION (S11L)

S11L ([spec](agent-intelligence/S11L-voice-lib.md)) adds a separate voiceprint library in `src/lib/studio/identity`. It runs in shadow mode and does not touch the adaptive voice-identity subsystem above, which stays disabled. With `STUDIO_VOICE_RECOGNITION`, `VOICEPRINT_KEY` and `PYANNOTE_*` unset, nothing is constructed and the runtime behaves exactly as before.

**Gates, in order.** Each must hold before any sample is captured or compared:

1. `STUDIO_VOICE_RECOGNITION=1`, read at call time through `tirehFlags()`.
2. The runtime sets the adaptive option `voiceRecognitionEnabled` from the same flag. That lifts the `feature_not_released` deny in `eligible()`. `persistence/service.ts` itself is not edited, because the `adaptive/voice-identity` tests set the option without the env.
3. A capability approval for `biometric_recognition` in a schemaVersion 1 `STUDIO_ADAPTIVE_POLICY_JSON`. The internal-pilot manifest (schemaVersion 2) withholds the provider, because employer or pilot availability is not member consent.
4. A confirmed profile and a non-pending member.
5. A granted `optional.biometric_recognition` permission whose last consent event carries affirmative `ConsentEvidence`.
6. For verification only, the persona's agent grant.
7. A configured provider (`PYANNOTE_API_KEY`), configured thresholds, and a warm self-echo guard.

Authority is read again after the provider call. If anything changed, the template is discarded.

**Environment.**

| Variable | Default | Meaning |
|---|---|---|
| `STUDIO_VOICE_RECOGNITION` | off | Enrollment and shadow verification. Approval and consent are still required. |
| `VOICEPRINT_KEY` | unset (nothing constructed) | Base64 of exactly 32 bytes. Startup refuses `STUDIO_SECRET`, its UTF-8 bytes or its SHA-256. Development and pilot key only. |
| `PYANNOTE_API_KEY` | unset (no provider) | Without it, enroll returns 503 `provider_unavailable` and verify returns `disabled`. Status and delete still work. |
| `PYANNOTE_BASE_URL` | `https://api.pyannote.ai` | Must be https on a `*.pyannote.ai` host. This is the EU option: confirm the EU host on the account before setting it. |
| `VOICE_MATCH_THRESHOLDS_JSON` | unset (no opinion) | `{"default":{match,noMatch,selfEcho,channels?},"orgs":{"<orgName>":{…}}}` with `0 <= noMatch < match <= 1` and `0 < selfEcho <= 1`. There are no built-in thresholds. Invalid JSON logs `voiceprint_thresholds_invalid` once and behaves as unset. |

**pyannoteAI data flow.** Every call uploads the audio to pyannoteAI's temporary media storage (`POST /v1/media/input`, then a PUT to the presigned URL), then runs a `voiceprint`, `identify` or `diarize` job with model `precision-2` and polls `/v1/jobs/{id}`.

- Uploaded media is purged by the vendor within 48 h, and job outputs are deleted after 24 h. The UX-07 `{sample_deletion_term}` must disclose this. Verify both figures on the account dashboard.
- Candidate labels are opaque (`owner`, `echo-<n>`); person ids never leave Vox.
- Net speech and the speaker count come from diarization. Below 3 s of net speech there is no opinion, and an enrollment clip needs 10 s.
- The adapter was written from public documentation and is not yet verified against a live account. That includes the endpoints, the confidence scale and the EU host.
- The processor-table row belongs to S15 (PRIV-009).

**Store.** The isolated store `vox_voiceprints` holds only the sealed template and these fields: `personId`, `space`, `provider`, `modelVersion`, `channel`, `consentEventId`, `createdAt` and the optional `lastConfirmedAt`.

- On the file profile it is `voiceprints-v1.json` in the data directory, with mode 0600 inside a 0700 directory, written through `.tmp`, fsync and rename.
- On Firebase it is the Firestore collection `vox_voiceprints`. Document ids are `sha256` hashes, so no person id appears in an id.
- Raw samples, transcripts, query audio and scores are never persisted or logged.
- Templates are sealed with AES-256-GCM. The AAD binds each template to person, space, provider, model version and consent event.

**Firebase: KMS is required.** A `VOICEPRINT_KEY` from the environment, stored beside the Firestore ciphertext, is NOT acceptable in production. Cloud KMS envelope encryption must exist before the flag is enabled on Firebase: a per-collection data key wrapped by KMS, never `STUDIO_SECRET`. It is not implemented in this step. Runtime therefore refuses `STUDIO_VOICE_RECOGNITION=1` on Firestore in production (`createStudioVoiceprints` throws at startup when `runtime.ts` passes `production: true`).

**Mac file profile: an open gate.** The key custody and backup design is still open. It must say where the key lives, how it rotates, and how backups exclude or re-encrypt `voiceprints-v1.json`. Rotating or losing the key makes every template unreadable, which gives `provider_error` and requires re-enrollment.

**Deletion.** Templates are deleted in these cases:

- consent withdrawal or change, and profile change, through the chained adaptive voice-identity invalidator (re-set in `runtime.ts` so `VoiceIdentityService.invalidate` still runs);
- explicit `DELETE /api/studio/voice-enroll`, which works with the flag off;
- re-consent, because a template whose `consentEventId` no longer matches is deleted on the next status or verification;
- the startup sweep, which removes templates older than 365 days or belonging to people who are no longer members (inside CUBI's one-year bound).

**Shadow mode.** Verification runs in `Promise.all` with speech-to-text, only on 1:1 Telegram voice notes from non-guest members. The result is discarded until S10 consumes it, and it never grants access. Because verification is job-based it can delay a voice-note reply by up to the 3 s deadline. Measure with `STUDIO_STAGE_TIMINGS` before any non-shadow use.

**Never done.** Vox never:

- verifies guests, groups or mixed-speaker audio;
- runs on live calls (`liveTurn` and `voice-call.ts` are untouched);
- uses a template across orgs or for a successor;
- infers emotion or any other attribute from voice;
- clones a voice.

**Before any non-shadow use**, these are required:

- counsel's opinion on verification versus identification under the AI Act;
- employee-consent validity (GDPR Art. 9);
- the BIPA/CUBI jurisdictions and written release;
- the PRIV-019 local-first justification;
- a measured FAR ≤ 0.5% at FRR ≤ 5%, in English and Farsi.

**خلاصهٔ فارسی:** الگوی صدا فقط با پرچم، تأیید قابلیت، رضایت صریح زیست‌سنجی و پروفایل تأییدشده ساخته می‌شود و در حالت سایه است. نمونهٔ خام ذخیره نمی‌شود، الگو با کلید جداگانه رمز می‌شود، و در Firebase پیش از فعال‌سازی، رمزنگاری پوششی با Cloud KMS لازم است.
