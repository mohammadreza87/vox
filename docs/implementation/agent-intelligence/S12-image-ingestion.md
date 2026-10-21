# S12: Image ingestion and image triage

Telegram photos and image documents, private chats only, behind `STUDIO_IMAGES=1`.
Plan: `docs/AGENT_INTELLIGENCE_SOLUTION.md` sections 2.1, 4.8 (Images paragraph and the image table row) and Step 12 of section 5.
Base commit: `6d00b8066e5d8e8d444bb47d978aa571e20929df`. Merge order puts S12 last.

## Goal

The work ships behind `STUDIO_IMAGES=1`, which is off by default. When the flag is on, a Telegram `photo` or a JPEG/PNG image `document` sent to a persona in a private chat with no guest audience becomes one ephemeral image for that turn.

How the turn works:

- The smallest PhotoSize whose longest edge is at least 320 px is downloaded through the Telegram client. The module strips its metadata and base64-encodes it.
- When the decider has `decideParts`, the image is triaged with four image questions: `image_kind`, `image_task`, `contains_people` and `contains_sensitive_document`.
- The image goes to Claude vision through the existing `LLMMessage.images` path in `composeReply`. The tasks `explain`, `extract_text`, `decide` and `react` go to `fastLlm` (Haiku) at a resolution that matches the task.
- If triage is slow, the member gets an immediate text acknowledgement.

Retention rules, enforced in code:

- Nothing is stored unless `image_task=remember` or the caption contains an explicit "remember this", and only when `contains_sensitive_document < 0.5`. If triage is missing, nothing is stored.
- When a people image is stored, extraction gets an explicit `IMAGE_PEOPLE_RULE` that bans identity and physical descriptions.
- Image bytes never reach history, logs, decision or audit rows, memory, or system prompt blocks.

With the flag unset, behaviour is exactly the base: captions are processed as text, photos without a caption are ignored, and nothing is downloaded.

## Verified facts at the base

- `llm.ts` already has `LLMImage {mimeType: 'image/jpeg'|'image/png'|'image/webp'; data}`, `LLMMessage.images`, and image blocks in `anthropicTurns`. The placeholder text `'Describe the shared image.'` is used only when content is empty.
- `composeReply(persona, chat, speakerId, text, triaged?, messageId?, action, replyFormat?, boundary?, images?, authorize?, authorizeNow?)` already attaches `images` to the last user turn in private chats only.
- `GeminiLLM` already sends images. Under the contract `GeminiLLM` is not changed; the images module refuses any non-Anthropic target up front with `isVisionCapable` / `VisionUnsupportedError` from `llm-content.ts`.
- `adaptive/decisions/index.ts` already accepts an `input_image` part (`minimizeImageDataUrl`: edge 512 px or less, 64 KiB or less, baseline JPEG or PNG). S09 owns that file; S12 makes no edits there.
- The base Studio decider is `OpenAIMedia.decide`, which takes a string and has no `decideParts`. Until S09's `ServiceDecider` (or another `decideParts` implementation) is wired, image triage is always null, so image turns never store memory (fail closed).
- The extraction prompt already says "Extract claims only from new HUMAN messages, never from the assistant's response". In private chats the only `[new]` line of an image turn is the human caption or placeholder.

## Files

| Path | Change |
|---|---|
| `src/lib/tireh/flags.ts` | New, byte-identical to the contract (sha256 `6b8edcd4…6630`). Read only inside `images/*`, never imported by `gateway.ts`. |
| `src/lib/tireh/llm-content.ts` | New, byte-identical to the contract (sha256 `4c83fe24…e663`). S12 uses `isVisionCapable` and `VisionUnsupportedError`. No `llm.ts` edits. |
| `src/lib/tireh/telegram/client.ts` | `TelegramPhotoSize`; `photo?` and `document?` on `TelegramMessage` after `voice?`; `downloadImage(fileId, { maxBytes, signal })` after `downloadFile`. Errors never include the URL, token, file_path or bytes. `downloadFile` unchanged. |
| `src/lib/tireh/images/index.ts` | Public surface and `ingestTelegramImage` (see below). |
| `src/lib/tireh/images/select.ts` | `IMAGE_MIN_EDGE = { low: 320, standard: 800, detail: 1092 }`, `ImageDetail`, `pickPhotoSize`. |
| `src/lib/tireh/images/bytes.ts` | `sniffImageMime`, `stripImageMetadata` (JPEG APPn/COM, PNG ancillary chunks), `toLLMImage`. WebP, GIF and HEIC rejected. |
| `src/lib/tireh/images/questions.ts` | `IMAGE_QUESTION_SET_VERSION = 'image-v1'`, `IMAGE_KINDS`, `IMAGE_TASKS`, `IMAGE_QUESTIONS`, `imageTriageText`, `readImageTriage`. |
| `src/lib/tireh/images/policy.ts` | Thresholds, timeouts, `ackText`, `explicitRemember`, `replyDetail`, `imagePolicy`, `forceQuickTriage`. |
| `src/lib/tireh/memory/extraction.ts` | `IMAGE_PEOPLE_RULE`; optional `options: { imagePeopleRule?: boolean }` on `buildExtractionPrompt` and `extractCandidates`. Byte-identical output when absent or false. |
| `src/lib/tireh/gateway.ts` | Six localized edits listed below. |
| `docs/implementation/PRIVACY_AND_CONSENT.md` | One purpose-map row after `model_training`. Not the PRIV-009 processor table (S15). |
| `docs/VOX_STUDIO.md` | `### Images in Telegram (off by default)` before `## Production (Firebase)`, EN and FA. |
| `src/lib/tireh/__tests__/images-*.ts` | New fixtures and tests. |

### `ingestTelegramImage` steps

It never throws; an unexpected error logs `image_ingest_failed` and returns null.

1. Return null, before any I/O, when the flag is off; there is no non-empty `photo` array and no `document` with `mime_type` `image/jpeg` or `image/png`; `chat.kind !== 'private'` or `chat.personId !== speakerId`; or `hasGuestAudience(org, chat)`.
2. `target = fastLlm ?? llm`. If `!isVisionCapable(target)`, a `VisionUnsupportedError` is raised and caught, `image_vision_unsupported` is logged and null returned, before any download.
3. `canTriage = typeof decider?.decideParts === 'function'`.
4. First file: photo → `pickPhotoSize(sizes, canTriage ? 320 : 800)`; document → its `file_id`. A known `file_size` above `IMAGE_MAX_BYTES` is rejected without download.
5. Download with `bot.downloadImage(id, { maxBytes: IMAGE_MAX_BYTES, signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) })`, then `toLLMImage` (sniff, declared-mime check for documents, metadata strip). Failure logs `image_download_failed` or `image_invalid` and returns null.
6. If `canTriage`: arm an `IMAGE_ACK_AFTER_MS` timer that sends `ackText(text)` once as a reply; race `decideParts([{type:'text', text: imageTriageText(persona, text)}, {type:'image', image}], IMAGE_QUESTIONS, IMAGE_TRIAGE_TIMEOUT_MS)` against `IMAGE_TRIAGE_TIMEOUT_MS + 250`; clear the ack timer in `finally`. A rejection, timeout or malformed answer gives `triage = null` and logs `image_triage_failed`. A failed ack logs `image_ack_failed`.
7. For a photo, `detail = replyDetail(triage)`; when `pickPhotoSize(sizes, IMAGE_MIN_EDGE[detail])` is a different file, download it the same way; on failure log `image_detail_download_failed` and keep the first image.
8. Return `{ images: [image], text: text.trim() ? text : IMAGE_PLACEHOLDER_TEXT, triage, ...imagePolicy(triage, text, isVisionCapable(llm)) }`.

Logs are single fixed strings only: `image_ingest_failed`, `image_vision_unsupported`, `image_download_failed`, `image_invalid`, `image_triage_failed`, `image_detail_download_failed`, `image_ack_failed`.

### Policy

- `IMAGE_SENSITIVE_THRESHOLD = 0.5`, `IMAGE_PEOPLE_THRESHOLD = 0.3`, `IMAGE_REMEMBER_CONFIDENCE = 0.6`, `IMAGE_ACK_AFTER_MS = 800`, `IMAGE_TRIAGE_TIMEOUT_MS = TRIAGE_TIMEOUT_MS` (2000), `IMAGE_DOWNLOAD_TIMEOUT_MS = 5000`, `IMAGE_MAX_BYTES = 5 MiB`.
- `suppressMemory = !(triage && (task === 'remember' || explicitRemember(text)) && containsSensitiveDocument < 0.5)`.
- `containsPeople = triage === null || kind === 'photo_of_people' || containsPeople >= 0.3`.
- `forceQuick = !isVisionCapable(llm) || (triage && task in {explain, extract_text, decide, react})`.
- `replyDetail`: null → standard; `extract_text` or kind in {screenshot, document, receipt, chart} → detail; kind in {photo_of_people, meme} with task in {react, unclear} → low; else standard.
- `forceQuickTriage` resolves to the triage with `effort: 'quick', needsWeb: false` (a null triage becomes `{ memorable: true, wantsVoice: false, effort: 'quick', needsWeb: false }`), keeping `skills`, `skillsMiss` and `skillAsked`.

### Questions (`image-v1`)

All phrased about the image or message, never about a person's state, and all pass the catalogue lint `/\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b/i` with no allowlist.

- `image_kind` (choice): screenshot, document, receipt, chart, photo_of_people, meme, other, each with a description.
- `image_task` (choice): explain, extract_text, decide, react, remember, unclear, each with a description. A `remember` with confidence below 0.6 reads as `unclear`.
- `contains_people` (predicate).
- `contains_sensitive_document` (predicate).

`imageTriageText` carries only the persona name and role and the caption (JSON-quoted, at most 600 characters, or `none`): no history and no memories.

### `gateway.ts` edits

1. `import { forceQuickTriage, ingestTelegramImage } from './images';` after the `./group-addressing` import.
2. `private readonly peopleImageTurns = new WeakSet<ChatMessage>();` after the `log` field.
3. One block after the voice-note if/else chain and before `if (!text.trim()) return 'ignored';` that calls `ingestTelegramImage` for addressed non-voice photo/document messages (decider withheld on compact turns) and replaces `text` with the image turn text.
4. `composeReply` call: 5th argument `imageTurn?.forceQuick ? forceQuickTriage(triaged) : triaged`; 10th argument `imageTurn?.images`.
5. `if (imageTurn?.containsPeople) this.peopleImageTurns.add(userMessage);` before `const remember =`, and the expression wrapped as `(…) && !imageTurn?.suppressMemory`.
6. `extractCandidates(…, { imagePeopleRule: currentTurn.some(m => this.peopleImageTurns.has(m)) })`.

With `imageTurn` null every expression evaluates exactly as at the base. No change to `boundary`, `unchanged`, `compactPrivacy`, `retain`, `stamp`, `historyAt`, `triage`, `transcribe`, the `composeReply` body or `liveTurn`.

## Flags

- `STUDIO_IMAGES=1` is the only flag read, at call time, inside `ingestTelegramImage`. Any other value (`true`, `0`, unset) is off.
- `STUDIO_DECIDER=service` (S09) is not read by S12, but image triage needs a decider with `decideParts`. With the base `OpenAIMedia` decider, image triage is null: replies work, retention fails closed and no acknowledgement is sent.
- No new environment variables.

## Tests

- `images-photo-size.test.ts`: `pickPhotoSize` selection, portrait, `minEdge` 800/1092, fallback to the largest, invalid entries, ties, no mutation.
- `images-bytes.test.ts`: JPEG Exif/COM stripping, PNG tEXt/eXIf stripping, malformed inputs, sniffing, `toLLMImage`.
- `images-questions.test.ts`: catalogue lint, names, caps, `readImageTriage`, `imageTriageText`.
- `images-policy.test.ts`: retention matrix, people, `forceQuick`, `replyDetail`, `forceQuickTriage`, `ackText`.
- `images-ingest.test.ts`: null conditions, download failures, triage, detail re-download, acknowledgement, vision gating, documents.
- `images-gateway.test.ts`: flag-off equivalence, routing, Gemini guard, sensitive document not stored, people rule, no image bytes in any log (also under stage timings).
- `images-telegram-client.test.ts`: `downloadImage` size limits, errors and signal with an injected fetch.

## Out of scope

Step 1 seams; `llm.ts`; `adaptive/decisions/index.ts`, `ServiceDecider`, `triage.ts` `DeciderPart` and `image-v1` decision-log rows (S09); `OpenAIMedia` (S15); the PRIV-009 processor table (S15); prompt cache layout (S03); groups, guests, Mini App and live-call images, stickers, animations, video, WebP, GIF, HEIC and albums; storing anything derived from an image; deterministic post-filtering of people-image candidates; new diagnostic codes or stage names; `package.json`; `Privacy.tsx`.

## Risks

- Ingest runs before the turn boundary, as voice-note STT does at the base. A turn the boundary later rejects may already have sent the image to Decisions or Anthropic and received the content-free acknowledgement. Step 1 should consider moving image triage after the snapshot.
- Without a `decideParts` decider, images are never remembered, there is no Haiku routing unless the main model is not vision-capable, and no acknowledgement is sent.
- The base Decisions seam accepts only images up to 512 px and 64 KiB, baseline JPEG or PNG. Progressive JPEGs and larger images are rejected there, which gives null triage (fails closed).
- Each photo in an album arrives as its own update, so the flag-on path replies once per photo.
- Anthropic rejects images over about 8000 px; such documents end in `reply_generation_failed`.
- Metadata stripping is a small hand-written parser; a malformed but decodable file may be rejected.
- `IMAGE_PEOPLE_RULE` is prompt-level only.
- Merge conflicts with S03 (prompt region, `anthropicTurns`) and Step 1 (`composeReply` signature, boundary lines): keep both sides and re-thread `imageTurn?.images` and `forceQuickTriage`.
- Text triage still runs on the placeholder `(shared a photo)`.
- The explicit-remember regexes are heuristic; false negatives fail closed.
