# Local voice identity engine

This is the canonical `/api/studio/voice-identity` engine. It provides a real CPU SpeechBrain ECAPA encoder and local cosine comparison. It does **not** currently provide a qualified live/overlap/replay/synthetic inspector. The built-in inspector returns unknown before embedding extraction; operator JSON cannot override it. Enrollment remains unavailable. Do not mark VOX-038/042 or the user journey complete from an encoder smoke result.

The worker accepts only authenticated HTTP over an owner-only Unix socket. It does not receive account/person IDs, fetch models at runtime, write audio/templates or search a speaker directory. The application retains the existing isolated encrypted template lifecycle. It rechecks current committed canonical purpose/profile/region authority and voice intent epoch before inspection, extraction, decrypt, comparison, store commit and returning hints. The adapter repeats the fence after internal awaits and immediately before writing each body. Recognition remains a self-only soft hint and changes no authentication, account, memory grant or conversation audience.

The application selects this engine only through `STUDIO_VOICE_IDENTITY_CONFIG_FILE`. This prevents accidentally enabling the separate legacy Pyannote shadow route through the shared flag. Existing legacy template deletion remains wired if its legacy key exists. No migration, account enrollment, capability-policy change, purpose grant or deployment is performed by these scripts.

## Pinned model and runtime

`model.json` pins the official Apache-2.0 [SpeechBrain ECAPA model](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/tree/0f99f2d0ebe89ac095bcc5903c4dd8f72b367286), revision `0f99f2d0ebe89ac095bcc5903c4dd8f72b367286`, checkpoint SHA256 `0575cb64845e6b9a10db9bcb74d5ac32b326b8dc90352671d345e2ee3d0126a2` (83,316,686 bytes). The graph is instantiated directly from reviewed SpeechBrain classes; no model-provided YAML/remote Python is executed. Checkpoint loading uses `weights_only=True`. Input is decoded through a bounded FFmpeg pipe to 16kHz mono, with protocol and demuxer allowlists, decoded-byte and wall-time caps. Templates encode a finite normalized192-dimensional vector bound to the exact model digest, not serialized executable objects.

`requirements-macos-arm64-py312.lock` is hash-pinned **only for CPython3.12/macOSarm64**, including matched torch/torchaudio2.11.0 and SpeechBrain1.1.2. Install into a dedicated venv, with `pip install --require-hashes --no-cache-dir -r ...`. Do not use this platform lock to resolve Linux/GPU dependencies. A production Linux CPU wheel lock and target-runtime validation are separate work if that is the deployment host.

Create a private directory outside the repository, then run:

```sh
node scripts/voice-identity-setup.mjs --directory /absolute/private/model-directory --download-model --create-keys
node scripts/voice-identity-benchmark.mjs --python /absolute/venv/bin/python --model-dir /absolute/private/model-directory
/absolute/venv/bin/python services/voice-identity/worker.py serve --model-dir /absolute/private/model-directory --socket /absolute/private/run/voice.sock --auth-key-file /absolute/private/model-directory/socket-auth.key
```

The run directory must already exist, belong to the same OS user as Vox/worker, and be0700; socket and key files are0600. Setup refuses unsafe existing keys and never prints them. It downloads only the pinned public checkpoint, bounds disk/download bytes and checks SHA before atomic rename. It generates distinct socket-auth and template-encryption keys. It creates no release approval or match policy.

A private0600 JSON config consumed by Vox has this shape. Keep `enabled:false` until independent qualification and the actual service policy support recognition. No approval example is fabricated here.

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "socketPath": "/absolute/private/run/voice.sock",
  "authKeyFile": "/absolute/private/model-directory/socket-auth.key",
  "encryptionKeyFile": "/absolute/private/model-directory/template-encryption.key"
}
```

Run `node --import tsx scripts/voice-identity-preflight.mjs` with the config environment. It emits only readiness/reason and exits2 when unavailable. Read/delete remain usable when a configured worker is down. Invalid key/config permissions fail initialization. The config's optional `approval` follows `VoiceProviderApproval` and must contain the actual reviewed bilingual disclosure, provider/model identity, release reference, expiries and template/consent TTLs. An approval does not make an unqualified worker ready. The canonical service jurisdiction/capability configuration and each adult's separate consent remain required.

`/inspect` can issue a one-use30s model/audio-bound extraction lease only when an actual qualified inspector passes all checks. There is no production plugin/operator switch to impersonate that inspector. `/extract` refuses absent, expired, reused or changed-audio/model leases. `/compare` accepts exactly one reference labelled self, and abstains without an unexpired model-bound match policy containing threshold and external qualification reference. The match policy is not generated automatically. `/purge` clears hash-only inspection leases; the worker has no persistent enrollment archive. Application encrypted template deletion and backup expiry remain separate.

No request content is logged. Mutable copies are cleared where possible; Python/JS immutable JSON/base64 copies and OS memory are not a provable cryptographic erasure guarantee. Production operation must disable core dumps, control swap/debug access, restrict process identity and verify logging, key access, backups/restore and residual memory. Worker subprocess/network bounds do not replace host isolation. Run as a dedicated unprivileged user; for Linux consider a protected service with no network, `LimitCORE=0`, bounded memory/CPU/tasks and no swap. No deployment unit has been installed here.

## Qualification work with a finite exit condition

The built-in quality-only inspector cannot become ready. The next implementation must replace it with reviewed local algorithms, pin every weight/code artifact and measure the following gates. These are proposed engineering candidates, not approved acceptance thresholds:

1. Random6-digit challenge: local multilingual [OpenAI Whisper](https://github.com/openai/whisper), tiny/base CPU candidate; exact normalized EN/FA digit sequence, confidence and complete-audio checks. Never pass the displayed challenge as an ASR prompt. Reject mismatches, extra words, uncertain/Persian recognition and expired capture. A fresh challenge rejects ordinary old recordings; it does not reject a real-time synthesis attack.
2. Non-biometric speech/quality and overlap: [SpeechBrain CRDNN VAD](https://huggingface.co/speechbrain/vad-crdnn-libriparty) can measure speech duration and low-quality/silent captures. VAD is not a single-speaker detector. Add a separately pinned local overlap model before claiming this check; model access/license and CPU budget are unresolved. Do not run ECAPA to decide whether an otherwise unconsented mixed capture is safe to process.
3. Anti-spoof: official MIT [AASIST](https://github.com/clovaai/aasist) is a small candidate for synthesized/converted speech. Its ASVspoof2019LA training does not qualify physical loudspeaker replay, current TTS or Persian. Evaluate old-challenge replay, same-challenge synthesis, physical/device replay, codec changes and mixed voices. False/unavailable/uncertain detector output must return unknown before ECAPA extraction.
4. Match calibration: `qualify.py` accepts an explicit bounded public/synthetic manifest of exact file hashes, provenance/license and **speaker-disjoint** calibration/holdout splits. It outputs aggregate pair errors and a candidate threshold; never templates or an installable policy. It caps200files,100MB,2000pairs/split and120s. Shared-speaker pair dependence means its nominal Wilson interval is descriptive, not a certified population error bound. An independent evaluator must set target FAR/FRR, confidence level, sampling/independence rules and latency limits **before** acceptance, then approve a fixed model/inspector/threshold tuple on an untouched representative holdout.
5. Physical EN/FA browser/device enrollment/test/delete/withdrawal races must pass in the supported target runtime. No existing private user audio may be reused. Use licensed public fixtures and separately authorized volunteered capture. The current3-account EE pilot excludes biometrics in strict capability configuration; an actual approved service-market configuration and individual separate opt-ins are required, not a widened pilot enum.

A usable release requires a measured tuple, supported-market/service review, actual host keys/retention operations and individual opt-in. No external provider account is needed for this local path. Missing overlap/spoof/challenge implementation, representative physical/Persian fixtures, preapproved error limits and target-host deployment qualification are specific remaining inputs/work; ordinary conversation, text and authenticated profile selection continue without recognition.

## Reproducible checks

```sh
python -m unittest discover -s services/voice-identity -p 'test_*.py' -v
node node_modules/vitest/vitest.mjs run src/lib/adaptive/voice-identity src/app/studio/_components/VoiceRecognitionPanel.test.tsx src/app/studio/_lib/voice-identity-client.test.ts
python services/voice-identity/qualify.py --model-dir /absolute/private/model-directory --manifest /absolute/public-fixtures/manifest.json --permit-licensed-public
```

A manifest contains `schemaVersion:1`, HTTPS`provenance`, `license`, `fixtureKind`(`licensed_public` or `synthetic`) and `files` with `path`(absolute), `sha256`, `speaker`(public/test label), `split`(`calibration` or `holdout`), `mimeType`. It refuses a speaker in both splits. This is an author-side engineering harness; protected independent evaluator fixtures/criteria remain untouched.

22October2026 author evidence: actual chirp encoder smoke192finite dimensions, first extraction67.5ms; real pinned model, no human inference claim. Bounded public FSDD revision`26eb9aaf76e81b692f806f9140c2d2777410d7a1`, CC-BY-SA4.0,24 derived six-digit clips/6 speakers: a calibration-only candidate0.340233 achieved0/48 false matches on calibration but **22/48 on speaker-disjoint holdout**, with0/18 false rejects. This short English digit experiment **failed generalization** and no threshold was installed. It is not an accepted FAR estimate, live challenge, synthetic/replay or device test. Exact fixture hashes/transformation and results are retained in the scoped evidence directory outside the repo.
