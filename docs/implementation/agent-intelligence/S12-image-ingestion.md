# S12: Image ingestion and image triage for private Telegram chats

Step 12 of `docs/AGENT_INTELLIGENCE_SOLUTION.md` (sections 2.1, 4.8 "Images" and the Step 12 row of section 5).
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`. Server flag: `STUDIO_IMAGES=1` (default off).

## Goal

Behind `STUDIO_IMAGES=1`, a member's photo or image document in a private, guest-free Telegram chat becomes one image for that turn only. The image is never stored, logged or replayed. One early call from `gateway.handleMessage` into a new `src/lib/tireh/images` module does the work:

1. Picks the smallest PhotoSize whose longest edge is at least 320 px.
2. Downloads it through a new `TelegramBotClient.downloadImage` helper.
3. Checks the bytes and strips metadata (EXIF, GPS, comments).
4. Runs a four-question image triage (`image_kind`, `image_task`, `contains_people`, `contains_sensitive_document`) through the decider's optional `decideParts`, with exactly one `{type:'image'}` part.
5. Downloads the reply image at a resolution that fits the task, and returns an `ImageTurn`.

The gateway then:

- passes `ImageTurn.images` to `composeReply` (the base already attaches images to the newest user turn in private chats);
- forces the fast model (Haiku vision) for `explain`, `extract_text`, `decide` and `react`;
- suppresses memory extraction unless the person asked for it (task `remember` or an explicit "remember this") and the image is not a sensitive document (`contains_sensitive_document < 0.5`);
- for people images, adds `IMAGE_PEOPLE_RULE` to the extraction prompt plus a code-side filter, so memory candidates never carry identity or appearance;
- sends a fixed acknowledgement when triage is slow.

With the flag unset, every code path is byte-identical to the base: a caption is handled as text, and a photo without a caption is ignored.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the shared contract (sha256 `6b8edcd4…6630`). Read only as `tirehFlags().images`, at call time. |
| `src/lib/tireh/llm-content.ts` | New, byte-identical to the shared contract (sha256 `4c83fe24…e663`). S12 uses `VisionUnsupportedError`, `isVisionCapable`, and `systemText` in tests. `llm.ts` is not edited; `GeminiLLM` is not changed (the images module refuses non-Anthropic models before any provider call). |
| `src/lib/tireh/telegram/client.ts` | Additive: `TelegramPhotoSize`; `TelegramMessage.photo` and `.document`; `TelegramBotClient.downloadImage(fileId, { maxBytes, signal })` (getFile, size checks before fetch, Content-Length and body length checks; errors never include the URL or token). `downloadFile` unchanged. |
| `src/lib/tireh/images/index.ts` | New public surface: `IMAGE_PLACEHOLDER_TEXT`, `ImageTriage`, `ImageTurn`, `pickPhotoSize`, `ingestTelegramImage`, `imageIngestionWanted`, `replyPhotoSize`, `forceQuickTriage`, `IMAGE_ACK_AFTER_MS`, `IMAGE_TRIAGE_TIMEOUT_MS`, `IMAGE_LOG_PREFIX`, re-exports of `./questions`, `./bytes`, `./retention`. |
| `src/lib/tireh/images/questions.ts` | `IMAGE_QUESTION_SET = 'image-v1'`, the four `IMAGE_TRIAGE_QUESTIONS`, `imageTriageInput`, `readImageTriage`, `IMAGE_TASK_MIN_CONFIDENCE = 0.5`. |
| `src/lib/tireh/images/bytes.ts` | Pure: `sniffImageMime`, `stripImageMetadata` (JPEG: drop APP1–APP13, APP15, COM; PNG: keep IHDR, PLTE, tRNS, gAMA, cHRM, sRGB, IDAT, IEND), `toLLMImage`, `pickPhotoSize`, `replyPhotoSize`, size constants. |
| `src/lib/tireh/images/retention.ts` | `IMAGE_REMEMBER_REQUEST`, `IMAGE_NO_MEMORY` (byte copy of the gateway's `NO_MEMORY`), `explicitRememberRequest`, `suppressImageMemory`, `imageAckText`, `SENSITIVE_DOCUMENT_THRESHOLD = 0.5`. |
| `src/lib/tireh/memory/extraction.ts` | Additive optional `ExtractionOptions { imagePeopleRule?: boolean }`, `IMAGE_PEOPLE_RULE`, `IMAGE_PEOPLE_DESCRIPTION`; the prompt and candidates are unchanged when the option is absent. |
| `src/lib/tireh/gateway.ts` | Small, localized hunks: the `./images` import, a `WeakSet<ChatMessage>` field, one early block in `handleMessage`, the `composeReply` call arguments, the remember region and the `extractCandidates` argument. |
| `docs/implementation/PRIVACY_AND_CONSENT.md` | One purpose-map row after `model_training`. The PRIV-009 processor table is S15's. |
| `docs/VOX_STUDIO.md` | A `### Photos (STUDIO_IMAGES)` note before `## Production (Firebase)`. |
| `src/lib/tireh/__tests__/images-fixtures.ts` | Test helpers: `VisionFakeLLM`, `GeminiFakeLLM`, `tinyJpeg`, `tinyPng`, `imageBot`, `privatePhoto`, `privateDocument`, `scriptedDecider`, `IMAGE_CANARIES`. |

## ingestTelegramImage order

(a) Return `null` with no I/O when the flag is off, the chat is not private, `hasGuestAudience`, the speaker is not `chat.personId`, or there is no usable image source (a non-empty `photo`, or a JPEG/PNG document within `MAX_REPLY_IMAGE_BYTES`).
(b) Vision gate: both `llm` and, when present, `fastLlm` must be Anthropic; otherwise `VisionUnsupportedError` is caught, `tireh_image:vision_unsupported` is logged, and `null` is returned before any download.
(c) Triage source: photo → `pickPhotoSize(photo, 320)` downloaded with `maxBytes 1_048_576`; document → the document with `MAX_REPLY_IMAGE_BYTES`. Bytes are sniffed and stripped; failures log a fixed code and return `null`.
(d) Triage only when `decider.decideParts` exists, on `sharedImageForModel(...)` (≤512 px, ≤64 KiB, baseline JPEG/PNG); if that throws, triage is skipped. `decideParts([text, image], IMAGE_TRIAGE_QUESTIONS, 2000)` raced against 2000 ms; rejection → `triage_failed`, timeout → `triage_timeout`.
(e) Slow acknowledgement after 1500 ms if triage plus reply download are unfinished: one `sendMessage` replying to the photo; failure logs `ack_failed`; at most one per turn.
(f) Reply image: photo → `replyPhotoSize(photo, triage)` (1024 px for text-like images or unknown triage, else 640), reusing triage bytes when the same file; fallback to the stripped triage image. Document → stripped document bytes.
(g) `ImageTurn`: `text` = caption or `(shared a photo)`; `suppressMemory = suppressImageMemory(triage, text)`; `containsPeople = triage ? p >= 0.5 : true`; `forceQuick` for explain/extract_text/decide/react.

Logging is only `deps.log.warn('tireh_image:<code>')` with a fixed code; never an error object, caption, file id or bytes.

## Gateway hunks

```ts
let imageTurn: ImageTurn | null = null;
if (!isVoice && imageIngestionWanted(message, chat)) {
  const privacy = this.deps.runtimePrivacy;
  const audienceOk = !privacy?.validateAudience || await privacy.validateAudience(persona.id, chat).catch(() => false);
  imageTurn = audienceOk ? await ingestTelegramImage({ org, decider: this.compactPrivacy() ? undefined : this.deps.decider, llm: this.deps.llm, fastLlm: this.deps.fastLlm, bot, log: this.log }, persona, chat, speaker.id, message, text) : null;
  if (imageTurn) text = imageTurn.text;
}
```

- `composeReply(..., imageTurn?.forceQuick ? forceQuickTriage(triaged) : triaged, ..., boundary, imageTurn?.images)`.
- Both rows of an image turn carry the content-free verdict `imageDerived: { suppressed, people }` (`imageDerivedMark`); the field is absent when `STUDIO_IMAGES` is unset. `const remember = (...) && !imageTurn?.suppressMemory;`.
- The assistant row of an image turn whose triage is `null` or a sensitive document stores `IMAGE_WITHHELD_REPLY_TEXT` instead of the reply (`withholdImageReply`). The reply is still delivered.
- `extractMemories` drops `imageDerived.suppressed` rows from the transcript and the known-memory query on every later turn, and passes `{ imagePeopleRule: true }` while any row in the current turn or the retained extraction window has `imageDerived.people`. (QA round 1: the verdict used to live in an in-process `WeakSet` that only covered the image turn itself.)
- A reply composed with an image-marked row in its context inherits that row's mark (`inheritedImageMark`: `suppressed` if any context row is suppressed, `people` if any has people). This holds for Telegram (`handleUpdate`), the Mini App (`converse`, through `generateReplyAt`) and live calls (`liveTurn`), which all share the `private-<personId>` history key. Only assistant rows inherit it; the member's own later rows stay unmarked, so their words still form memory. (QA round 3 findings 1 and 2: `042059a` carried only `people`, and only in `handleUpdate`; `redteam-wave-a-r3.test.ts` now covers both as plain tests.)

No change to `boundary()`, `unchanged()`, `retain()`, `historyAt()`, `triage()`, `transcribe()`, the `composeReply` body, `liveTurn`, `GatewayDeps`, timing or diagnostics.

## Flags

- `STUDIO_IMAGES=1` (default off). Unset gives the exact base behaviour: no `validateAudience` call, no download, no decider call, no extra log line; `composeReply` receives `images` undefined and the unwrapped triage promise; `X && !undefined === X`; extraction receives `undefined` options.
- Indirect dependency: image triage runs only when the decider has `decideParts`. At the base the production decider (`OpenAIMedia`) does not, so every image turn has triage `null`, the reply uses the main model at 1024 px, memory is suppressed and people are assumed present. Full routing needs `STUDIO_DECIDER=service` from S09.

## Tests

- `images-photo-size.test.ts`: `pickPhotoSize` and `replyPhotoSize` selection rules.
- `images-bytes.test.ts`: MIME sniffing, JPEG/PNG metadata stripping, malformed input.
- `images-ingest.test.ts`: flag, audience, vision gate, document rules, download failure, `decideParts` call shape, retention, `forceQuick`, confidence, placeholder text, slow acknowledgement with fake timers, compact (no decider).
- `images-gateway.test.ts`: flag-off equivalence, flag-on captionless photo, fast routing, sensitive document not stored, non-sensitive remember, people-image rule and filter, groups, guests, no bytes in any log, `validateAudience` false.
- `images-extraction.test.ts`: byte-identical prompt without the option; the rule and the filter with it.
- `images-catalogue-lint.test.ts`: the S09 catalogue lint regex on the image questions, names, enums, caps, triage input.
- `images-client.test.ts`: `downloadImage` with an injected fetch; `downloadFile` unchanged.

## Acceptance

- Shared-file hashes match the contract.
- Flag unset: all existing `src/lib/tireh` and `src/lib/adaptive/decisions` suites pass; flag-off gateway tests show deep-equal requests, history and results.
- `STUDIO_IMAGES=1 npx vitest run src/lib/tireh` is green.
- Lib-scoped `tsc` exits 0; eslint on changed files is clean.
- No new failing files in the full suite compared with the contract's baseline list.
- No image bytes or base64 in any chat message, memory, offer, log, diagnostic or system prompt.
- A sensitive document never triggers extraction; a captionless or unrequested image never forms memory; triage `null` always suppresses memory.
- People images: the rule in the extraction prompt, description and relationship candidates dropped in code, triage labels never in the reply prompt.
- No download for groups, guests, strangers, a non-chat-person speaker, a failed `validateAudience`, or a non-Anthropic `llm`/`fastLlm`.

## Out of scope

Step 1 (snapshot, revision vector, `boundary()`/`unchanged()`, `liveTurn` rechecks, persistence seams); `llm.ts`; `adaptive/decisions/index.ts` and `triage.ts` (S09); `media.ts`, the PRIV-009 processor rows and the openai upgrade (S15); decision-log rows for `image-v1` (TODO for the integrator); images in groups, for guests or strangers, in the Mini App path or on live calls; albums, stickers, GIF, WebP, HEIC, video, PDFs; image replay and image evidence; rendering triage answers into the prompt; new diagnostic codes or stage names; `Privacy.tsx`, `package.json`, `fixtures.ts`.

## Risks

- Until S09's `ServiceDecider.decideParts` is enabled, every image turn is untriaged (no Haiku routing, memory always suppressed, 1024 px reply on the main model).
- `minimizeImageDataUrl` accepts only baseline JPEG/PNG; progressive 320 px Telegram JPEGs would silently skip triage. Verify with a real Telegram photo before enabling.
- Only the turn text (caption or placeholder) is settled before the turn boundary. Download, triage and the acknowledgement run after `boundary()` has validated the audience (`if (!boundary.audienceValid) return 'ignored'`), with the boundary's own `validateAudience` read; there is no separate image-path audience read (QA round 3). Paused memory/history still allows an image to be triaged and answered. Revisit after Step 1.
- Latency: triage download, up to 2 s triage and an optional second download precede the reply; the 1.5 s acknowledgement covers the wait. Measure p95 first.
- L1 history keeps the reply text for non-sensitive image turns, so the model can still echo an image description on a later turn. Every reply composed with an image-marked row in context inherits the mark, so an echo of a suppressed image never reaches extraction and an echo of a people image keeps the people rule (and its lexical filter, which may drop some legitimate candidates). The mark carries forward from reply to reply, so in a chat that keeps talking after an image, assistant rows stay out of extraction (or under the people rule) until a reply is composed with no marked row in its 20-row context. The reply to a sensitive or untriaged image is never stored: history keeps a fixed placeholder, so later replies cannot refer back to its details.
- `IMAGE_PEOPLE_DESCRIPTION` is lexical: false positives and misses are possible; the prompt rule is the primary control.
- Follow-ups cannot see the image. Albums produce N replies.
- Merge with S03: image blocks must stay first; run the gateway image suite under `TIREH_CACHED_PROMPT=1`.
- The `image-v1` lint and decision-log question set must stay aligned with S09.
