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

With the flag unset, a caption is handled as text and a photo without a caption is ignored, as in the base. One change applies with every flag unset: the gateway's `NO_MEMORY` reads the shared `memory/requests.ts` negation rule (see Deviations).

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the shared contract (sha256 `6b8edcd4…6630`) when this step was built. Read only as `tirehFlags().images`, at call time. Note: `flags.ts` changed after the steps merged, on `agent-intelligence-wave-a-main`: `voiceShadow` (`97bf549`), `webhookFailClosed` (`ebc18d9`), then `voiceShadow` composed with `voiceRecognition` and the header corrected (H3, `e94ca83`); current sha256 `7adeaa35129d3ac610ef67940eff790b49417206ee4ccff3f7b88cc5db806740`, pinned in `llm-blocks.test.ts` and `llm-blocks.main-lineage.test.ts`. The `images` field is unchanged. |
| `src/lib/tireh/llm-content.ts` | New, byte-identical to the shared contract (sha256 `4c83fe24…e663`). S12 uses `VisionUnsupportedError`, `isVisionCapable`, and `systemText` in tests. `llm.ts` is not edited; `GeminiLLM` is not changed (the images module refuses non-Anthropic models before any provider call). |
| `src/lib/tireh/telegram/client.ts` | Additive: `TelegramPhotoSize`; `TelegramMessage.photo` and `.document`; `TelegramBotClient.downloadImage(fileId, { maxBytes, signal })` (getFile, size checks before fetch, Content-Length and body length checks; errors never include the URL or token). `downloadFile` unchanged. |
| `src/lib/tireh/images/index.ts` | New public surface: `IMAGE_PLACEHOLDER_TEXT` (and, on integration, `IMAGE_PLACEHOLDER_TEXT_FA`, `imagePlaceholderText`, `isImagePlaceholderText`, `IMAGE_DOWNLOAD_TIMEOUT_MS`, `IMAGE_PEOPLE_THRESHOLD`, `imageShowsPeople`), `ImageTriage`, `ImageTurn`, `pickPhotoSize`, `ingestTelegramImage`, `imageIngestionWanted`, `replyPhotoSize`, `forceQuickTriage`, `IMAGE_ACK_AFTER_MS`, `IMAGE_TRIAGE_TIMEOUT_MS`, `IMAGE_LOG_PREFIX`, re-exports of `./questions`, `./bytes`, `./retention`. |
| `src/lib/tireh/images/questions.ts` | `IMAGE_QUESTION_SET = 'image-v1'`, the four `IMAGE_TRIAGE_QUESTIONS`, `imageTriageInput`, `readImageTriage`, `IMAGE_TASK_MIN_CONFIDENCE = 0.5`, `IMAGE_REMEMBER_CONFIDENCE = 0.6` (a `remember` task below it reads as `unclear`, main's rule). |
| `src/lib/tireh/images/bytes.ts` | Pure: `sniffImageMime`, `stripImageMetadata` (JPEG: drop APP1–APP13, APP15 and COM in every scan of a progressive JPEG and every byte after EOI; keep only the first `JFIF\0` APP0, rewritten to 16 bytes with no thumbnail, and drop JFXX and every other APP0; keep APP14; PNG: keep IHDR, PLTE, tRNS, gAMA, cHRM, sRGB, IDAT, IEND), `toLLMImage`, `pickPhotoSize`, `replyPhotoSize`, size constants. |
| `src/lib/tireh/images/retention.ts` | `suppressImageMemory` (calls `memory/requests.ts` `negatedMemoryRequest` and `explicitMemoryRequest`, the rule the gateway also reads), `imageAckText(text, languageCode?)`, `imageTurnLanguage`, `textLanguage`, `IMAGE_WITHHELD_REPLY_TEXT` and `IMAGE_WITHHELD_REPLY_TEXT_FA` with `withheldImageReplyText` and `isWithheldImageReplyText`, `withholdImageReply`, `SENSITIVE_DOCUMENT_THRESHOLD = 0.5`. On integration `IMAGE_REMEMBER_REQUEST` was deleted; `IMAGE_NO_MEMORY` and `explicitRememberRequest` remain only as deprecated test aliases until no importer is left. |
| `src/lib/tireh/memory/requests.ts` | Integration (`b142d00`, widened by `bd3d1de`): `NEGATED_MEMORY_REQUEST` and `MEMORY_REQUEST`, the one deterministic EN/FA rule for "do not keep this" and "remember this", read by S12 retention and by the gateway's flag-independent `NO_MEMORY`. |
| `src/lib/tireh/memory/extraction.ts` | Additive optional `ExtractionOptions { imagePeopleRule?: boolean }`, `IMAGE_PEOPLE_RULE`, `IMAGE_PEOPLE_DESCRIPTION`; the prompt and candidates are unchanged when the option is absent. |
| `src/lib/tireh/gateway.ts` | Small, localized hunks: the `./images` import, the turn-text placeholder before `boundary()`, one image block after `boundary.audienceValid` in `handleMessage`, the `composeReply` call arguments, the persisted `imageDerived` marks on both rows, the remember region and the `extractCandidates` argument. There is no in-process `WeakSet` (main's `peopleImageTurns` was removed on integration). |
| `docs/implementation/PRIVACY_AND_CONSENT.md` | One purpose-map row after `model_training`. The PRIV-009 processor table is S15's. |
| `docs/VOX_STUDIO.md` | A `### Photos (STUDIO_IMAGES)` note before `## Production (Firebase)`. |
| `src/lib/tireh/__tests__/images-fixtures.ts` | Test helpers: `VisionFakeLLM`, `GeminiFakeLLM`, `tinyJpeg`, `tinyPng`, `imageBot`, `privatePhoto`, `privateDocument`, `scriptedDecider`, `IMAGE_CANARIES`. |

## ingestTelegramImage order

(a) Return `null` with no I/O when the flag is off, the chat is not private, `hasGuestAudience`, the speaker is not `chat.personId`, or there is no usable image source (a non-empty `photo`, or a JPEG/PNG document within `MAX_REPLY_IMAGE_BYTES`).
(b) Vision gate: both `llm` and, when present, `fastLlm` must be Anthropic; otherwise `VisionUnsupportedError` is caught, `tireh_image:vision_unsupported` is logged, and `null` is returned before any download.
(c) Triage source: photo → `pickPhotoSize(photo, 320)` downloaded with `maxBytes 1_048_576`; document → the document with `MAX_REPLY_IMAGE_BYTES`. Every download carries `AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS)` (5 s; `download_timeout`). Bytes are sniffed and stripped; failures log a fixed code and return `null`. Then the turn's authority (image capability included) is re-checked: a moved authority drops the image before any acknowledgement or triage (`authority_changed`).
(d) Triage only when `decider.decideParts` exists, on `sharedImageForModel(...)` (≤512 px, ≤64 KiB, baseline JPEG/PNG); if that throws, triage is skipped. `decideParts([text, image], IMAGE_TRIAGE_QUESTIONS, 2000)` raced against 2000 ms; rejection → `triage_failed`, timeout → `triage_timeout`.
(e) Slow acknowledgement after 1500 ms if triage plus reply download are unfinished: one `sendMessage` replying to the photo; failure logs `ack_failed`; at most one per turn.
(f) Reply image: photo → `replyPhotoSize(photo, triage)` (1024 px for text-like images or unknown triage, else 640), reusing triage bytes when the same file; before a second download the authority is re-checked (`authority_changed`); fallback to the stripped triage image. Document → stripped document bytes.
(g) `ImageTurn`: `text` = caption or the placeholder (`(shared a photo)`, or `(یک عکس فرستاد)` when there is no caption and the Telegram `language_code` starts with `fa`); `suppressMemory = suppressImageMemory(triage, text)`; `containsPeople = imageShowsPeople(triage)` (unknown triage, kind `photo_of_people` or `p >= 0.3`; main's rule, ported by fixer r2 on main; it was `p >= 0.5`); `forceQuick` for explain/extract_text/decide/react.

Logging is only `deps.log.warn('tireh_image:<code>')` with a fixed code (`vision_unsupported`, `download_failed`, `download_timeout`, `authority_changed`, `unsupported_type`, `too_large`, `metadata_invalid`, `triage_failed`, `triage_timeout`, `ack_failed`); never an error object, caption, file id or bytes.

## Gateway hunks

```ts
// Before the boundary: only the turn text is settled.
const imageWanted = !isVoice && imageIngestionWanted(message, chat);
const caption = text;
if (imageWanted && !caption.trim()) text = imagePlaceholderText(imageTurnLanguage(caption, message.from?.language_code));
let boundary = await this.boundary(persona, chat, speaker.id, 'work', text, this.compactPrivacy());
if (!boundary.audienceValid) return 'ignored';
let imageTurn: ImageTurn | null = null;
if (imageWanted) {
  // The turn's authority, built as text triage's (8a7dc55), with the image capability inside it.
  const imageAuthority = { authorize: async () => await this.groupAllowed(...) && await this.imageCapable(...) &&
    await this.unchanged(persona, chat, speaker.id, boundary) ? boundary.key : null,
    ...(boundary.compact ? { authorizeNow: () => this.exportAuthorizedNow(...) && this.imageCapableNow(...) } : {}) };
  imageTurn = boundary.publicOnly || !await this.imageCapable(persona, chat, speaker.id, boundary.space) ? null
    : await ingestTelegramImage({ org, decider: boundary.compact || this.compactPrivacy() ? undefined : this.deps.decider,
        llm, fastLlm, bot, log, authority: imageAuthority, decisionLog /* only while TIREH_DECISION_LOG */ }, persona, chat, speaker.id, message, caption);
  if (!imageTurn && !caption.trim()) return 'ignored';
}
```

This is the merged shape (abridged). There is no separate image-path `validateAudience` read: ingestion runs after the
boundary has validated the audience, never for a `publicOnly` (Circles outsider) audience, and only while the person's
image capability holds (`imageCapable`).

- `composeReply(..., imageTurn?.forceQuick ? forceQuickTriage(triaged) : triaged, ..., boundary, imageTurn?.images)`.
- Both rows of an image turn carry the content-free verdict `imageDerived: { suppressed, people }` (`imageDerivedMark`); the field is absent when `STUDIO_IMAGES` is unset. `const remember = (...) && !imageTurn?.suppressMemory;`.
- The assistant row of an image turn whose triage is `null` or a sensitive document stores `IMAGE_WITHHELD_REPLY_TEXT` instead of the reply (`withholdImageReply`). The reply is still delivered.
- `extractMemories` drops `imageDerived.suppressed` rows from the transcript and the known-memory query on every later turn, and passes `{ imagePeopleRule: true }` while any row in the current turn or the retained extraction window has `imageDerived.people`. (QA round 1: the verdict used to live in an in-process `WeakSet` that only covered the image turn itself.)
- A reply composed with an image-marked row in its context inherits that row's mark (`inheritedImageMark`: `suppressed` if any context row is suppressed, `people` if any has people). This holds for Telegram (`handleUpdate`), the Mini App (`converse`, through `generateReplyAt`) and live calls (`liveTurn`), which all share the `private-<personId>` history key. Only assistant rows inherit it; the member's own later rows stay unmarked, so their words still form memory. (QA round 3 findings 1 and 2: `042059a` carried only `people`, and only in `handleUpdate`; `redteam-wave-a-r3.test.ts` now covers both as plain tests.)

No change to `boundary()`, `unchanged()`, `retain()`, `historyAt()`, `triage()`, `transcribe()`, timing or diagnostics. On integration `composeReply` gained the image context and the image-capability export check, `converse()` and `liveTurn` the inherited marks, and `GatewayDeps` the optional `imageAllowed` and `imageAllowedNow` (fixer r2); the existing `decisionLog` sink also takes `image-v1` rows (see below).

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

- Shared-file hashes match the contract. (At merge time. `flags.ts` changed afterwards; see its row in Files.)
- Flag unset: all existing `src/lib/tireh` and `src/lib/adaptive/decisions` suites pass; flag-off gateway tests show deep-equal requests, history and results.
- `STUDIO_IMAGES=1 npx vitest run src/lib/tireh` is green.
- Lib-scoped `tsc` exits 0; eslint on changed files is clean.
- No new failing files in the full suite compared with the contract's baseline list.
- No image bytes or base64 in any chat message, memory, offer, log, diagnostic or system prompt.
- A sensitive document never triggers extraction; a captionless or unrequested image never forms memory; triage `null` always suppresses memory.
- People images: the rule in the extraction prompt, description and relationship candidates dropped in code, triage labels never in the reply prompt.
- No download for groups, guests, strangers, a non-chat-person speaker, a failed `validateAudience`, or a non-Anthropic `llm`/`fastLlm`.
- No download without the person's image capability (fixer r2 on main): `GatewayDeps.imageAllowed`, which Studio wires to the adaptive `single_party_image` capability that a Mini App image also needs. It is checked before the first download, inside the image authority (after the download, before triage, at the guarded transport) and before the reply export. A runtime with a privacy adapter and no `imageAllowed` gets no image; the internal pilot, which rejects `single_party_image` at startup, therefore answers no Telegram image.

## Deviations

- **Base behaviour with every flag unset: the gateway's `NO_MEMORY`.** The spec promised byte-identical base behaviour
  with `STUDIO_IMAGES` unset. Since `b142d00` (and `bd3d1de`) the gateway's flag-independent `NO_MEMORY`, which gates
  group memory and relationship observation, reads `memory/requests.ts` `NEGATED_MEMORY_REQUEST` instead of the base
  `do not|don't` + verb rule, so S12 retention and the gateway share one negation rule. It is a strict superset of the
  base rule and only ever withholds memory (fail closed). It is a base-behaviour exception awaiting the product lead's
  acknowledgement (`WAVE_A_ON_MAIN.md` section 9, item (i)); the header of `flags.ts` ("with all of them unset the
  runtime behaves exactly as before") predates it and the legacy payments exception (a).

## Integration onto main (2026-10-25/26)

Merged as `40be72c` (main's and wave A's runs were both full implementations; wave A's was chosen, `WAVE_A_ON_MAIN.md`
section 2), then hardened by the QA fixer rounds and the hardening cluster H2. This section describes the merged code;
where it differs from the sections above, it wins. Every path is behind `STUDIO_IMAGES`, read at call time.

- **After `boundary.audienceValid`.** Only the turn text (caption or placeholder) is settled before `boundary()`. The
  download, triage and acknowledgement run after the boundary has validated the audience, never for a `publicOnly`
  audience (main's outsider guarantee), and only while `imageCapable` holds.
- **Image capability.** `GatewayDeps.imageAllowed` (and its synchronous twin `imageAllowedNow` for the indexed send
  fence) is the person's own image capability; Studio wires it to the adaptive `single_party_image` capability, as a
  Mini App image needs, and denies without an adaptive service or on a read failure. A gateway with a privacy adapter
  and no `imageAllowed` gets no image. It is checked before the first download, inside the image authority (after the
  download, before triage, at the guarded transport), at `composeReply`'s pre-export check (the images are dropped and
  the caption is still answered) and in the reply request's transport authority (fixer r2 `ed05751`, r3 `07e635e`).
- **Authority re-checks.** The gateway hands `ingestTelegramImage` the turn authority built as text triage's
  (`8a7dc55`), with the image capability inside it. It is re-read after the triage download (before the acknowledgement
  and triage), before the reply-tier download, and by `decideParts`' guarded transport. A moved authority drops the
  image and logs `authority_changed`.
- **Download deadline.** Each download carries `AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS)` (5 s); a timeout logs
  `download_timeout`, detected structurally (`name === 'TimeoutError'`). `downloadImage` cancels the body when the
  status is not ok or the size passes the cap, rethrows the deadline instead of reporting an empty answer, and marks an
  oversize file with the structural code `file_too_large` (H2).
- **JPEG stripping.** Metadata is stripped in every scan of a progressive JPEG and after EOI (fixer r1 `02d468e`); the
  JFIF APP0 thumbnail is removed (only the first `JFIF\0` APP0 is kept, as 16 bytes with no thumbnail; JFXX and other
  APP0 segments are dropped) (H2).
- **Progressive acceptance.** While `STUDIO_IMAGES` is on, `minimizeImageDataUrl` sends a progressive (SOF2) JPEG to a
  separate multi-scan validator that keeps the seam's contract (at most 512 px and 64 KiB; one SOF0 or SOF2 frame; only
  DHT/DQT/DRI and the next SOS between scans; any APPn, COM or other marker after the first SOS rejected). With the flag
  unset, and for baseline JPEG and PNG, the single-scan path is unchanged (H2).
- **Triage reading.** A missing, non-choice or unknown `image_kind` is unknown triage (`null`: suppressed, people rule
  on), as main's reader was (H2); `remember` below 0.6 reads as `unclear` (fixer r3); the people rule is main's (kind
  `photo_of_people` or `contains_people >= 0.3`, fixer r2).
- **Mini App untriaged rule.** `converse()` marks both rows of a Mini App turn with an attached image as an untriaged
  image turn (suppressed, people rule on; it fails closed even on an explicit remember request, because this path has no
  image triage) and keeps only the withheld text in history; the reply still reaches the caller (fixer r1 `04bccc5`).
  Flag unset: main's behaviour.
- **Marks.** Both rows of an image turn carry `imageDerived`; on an image turn the assistant row's mark is the union of
  the image's verdict and the inherited one (fails closed only) (H2).
- **`image-v1` decision-log rows.** While `TIREH_DECISION_LOG` is on, the image triage call writes one content-free row
  (answered, failed or timed out) through the gateway's sink, recorded after the turn's text-triage row; a turn that
  ends earlier writes none. The row holds catalogue names, values and probabilities, never the caption, the image or a
  person id (H2).
- **FA texts.** `IMAGE_PLACEHOLDER_TEXT_FA` `(یک عکس فرستاد)` and `IMAGE_WITHHELD_REPLY_TEXT_FA`
  `(دربارهٔ یک عکس پاسخ داده شد؛ جزئیات نگه داشته نشد)`. The placeholder and the acknowledgement follow the caption's
  script, else the sender's Telegram `language_code` (no history is read before the boundary); the withheld text follows
  the delivered reply's script, and in the Mini App the message's script. The English constants are unchanged (H2).
- **Memory requests.** `suppressImageMemory` and the gateway call `memory/requests.ts` directly, so the shared rule's
  normalisation (the Persian fold) reaches both; with every flag unset the gateway's `NO_MEMORY` reads the same rule
  (base-behaviour exception, decision (i)).

## Out of scope

Step 1 (snapshot, revision vector, `boundary()`/`unchanged()`, `liveTurn` rechecks, persistence seams); `llm.ts`; `adaptive/decisions/index.ts` and `triage.ts` (S09); `media.ts`, the PRIV-009 processor rows and the openai upgrade (S15); images in groups, for guests or strangers, or on live calls; image triage for Mini App images (their turns are handled untriaged, see the integration section); albums, stickers, GIF, WebP, HEIC, video, PDFs; image replay and image evidence; rendering triage answers into the prompt; new diagnostic codes or stage names; `Privacy.tsx`, `package.json`, `fixtures.ts`.

## Risks

- Until S09's `ServiceDecider.decideParts` is enabled, every image turn is untriaged (no Haiku routing, memory always suppressed, 1024 px reply on the main model).
- `minimizeImageDataUrl` accepted only baseline JPEG/PNG, so progressive 320 px Telegram JPEGs skipped triage. On integration a progressive (SOF2) JPEG is accepted by a separate multi-scan validator while `STUDIO_IMAGES` is on (see the integration section); still verify with a real Telegram photo before enabling.
- Only the turn text (caption or placeholder) is settled before the turn boundary. Download, triage and the acknowledgement run after `boundary()` has validated the audience (`if (!boundary.audienceValid) return 'ignored'`), with the boundary's own `validateAudience` read; there is no separate image-path audience read (QA round 3). Paused memory/history still allows an image to be triaged and answered. Revisit after Step 1.
- Latency: triage download, up to 2 s triage and an optional second download precede the reply; the 1.5 s acknowledgement covers the wait. Measure p95 first.
- L1 history keeps the reply text for non-sensitive image turns, so the model can still echo an image description on a later turn. Every reply composed with an image-marked row in context inherits the mark, so an echo of a suppressed image never reaches extraction and an echo of a people image keeps the people rule (and its lexical filter, which may drop some legitimate candidates). The mark carries forward from reply to reply, so in a chat that keeps talking after an image, assistant rows stay out of extraction (or under the people rule) until a reply is composed with no marked row in its 20-row context. The reply to a sensitive or untriaged image is never stored: history keeps a fixed placeholder, so later replies cannot refer back to its details.
- `IMAGE_PEOPLE_DESCRIPTION` is lexical: false positives and misses are possible; the prompt rule is the primary control.
- Follow-ups cannot see the image. Albums produce N replies.
- Merge with S03: image blocks must stay first; run the gateway image suite under `TIREH_CACHED_PROMPT=1`.
- The `image-v1` lint and decision-log question set must stay aligned with S09 (the image triage call now writes `image-v1` decision-log rows).
