# Bounded live draft prediction

Task slice: VOX-026/030, supporting VOX-031. This module does not implement the
VOX-027 hypothesis learning producer. Base: `9fb73d3` on
`codex/vox-adaptive-completion`; source/local evidence only, no deployment.

`LivePredictionConsumer` consumes explicit draft text, stable partial-transcript
events **if a producer actually supplies them**, and a user-selected shared image.
The current ElevenLabs `onMessage` surface supplies a final transcript; calling
this consumer there must not be described as early ASR/voice prediction. The
Studio text/image composer is the usable partial-input producer. It must leave
preparation off until the user chooses it. There is no microphone/audio capture,
voice matching, enrollment or identity/access inference in this path.

```ts
const consumer = new LivePredictionConsumer({
  ...predictionHttpTransport(() => signedTelegramInitData),
  onPrepared: hint => renderReversibleSuggestion(hint?.routeHint),
});
consumer.startTurn({ space, agentId, sessionId, turnId, contextKey });
consumer.update({ text: currentDraft, stable: true, image });
const hint = await consumer.takePrepared(); // fresh server receipt validation
consumer.cancel(); // interruption, send, close, audience/person/space/image change
```

`contextKey` is a correlation value supplied by the UI, never authorization. Every
correction clears the local prepared result and aborts old work. Debounce defaults
to 180 ms. Only launched/prepared requests require server invalidation; unsent
keystrokes remain local and consume no API/mutation budget. At most two model calls
per turn, one active server lease per session, no retries. Turn IDs must be fresh
for genuinely new turns; changing a revision does not reset the budget. New turns
supersede old ones permanently during the ten-minute tombstone retention.

The signed same-origin experience API supports:

- POST `predict`: current user text, optional `{sourceId,revision,dataUrl}` image,
  revision/session/turn/context and a fixed registry question.
- POST `prediction-cancel`: only the scope/revision, retained as a content-free
  cancellation tombstone. Late requests in another process fail that check too.
- POST `prediction-validate`: scope/revision and opaque policy receipt. Checks
  current Studio access plus core, exact agent grant, receipt expiry and image
  capability approval. Private retrieval/output still requires its own receipts.

The provider's 500 ms deadline is unchanged; it includes the Decisions service's
permission/loading/provider work. Repository reservations and final runtime
cleanup/checks can add elapsed time, so the complete HTTP operation is not
promised to finish in 500 ms. A newer request may use baseline while an old
lease drains. Local abort saves work; durable revision/reservation checks decide
whether a result can be used. Receipts live for at most 1500 ms and also end at
image approval expiry. Content-free records contain no draft, raster or answers.
There is no semantic-result cache and no speculation-triggered tool, memory write, sharing,
notification, audio playback or final answer. An answered, receipt-validated result
can warm already-authorized read-only context ranking through gateway.prepareContext,
with a separate 250ms preparation bound. This returns only preparedContext:boolean;
no memory text is exported to the browser. The same-query final gateway path may
reuse ranking work only while its own current source/policy boundary still matches.
Preparation failure/timeout leaves the semantic/baseline conversation available. Route hints are uncalibrated UI
hypotheses only. The optional 0.8 confidence filter is a conservative proposed
UI filter, not a measured/calibrated quality threshold.

`prepareSharedImage` accepts an explicitly selected raster, uses canvas to resize
to <=512px per edge, JPEG re-encodes it, and reduces size until <=64KiB. Its 8MiB
source-file cap applies before bitmap decode. `sharedImageDataUrlSchema` and
`minimizeImageDataUrl` independently check inline bytes, format and dimensions on
the server; client dimensions are never trusted. Server PNG checks CRCs, 8-bit
noninterlaced headers, rejects animation/unknown critical chunks, and strips
ancillary metadata. JPEG supports a deliberately narrow baseline single-scan
format, strips APP/COM metadata and rejects unexpected markers in scan entropy,
including interscan/trailing metadata. Progressive/multiscan JPEG and remote
URLs, GIF/SVG, raw audio, Files API handles and tool items are unsupported. The
browser re-encoding normalizes supported source formats. `sharedImageForModel`
returns `{mimeType,data}` for the final conversation adapter. Image provider export
requires the distinct `single_party_image` server capability; text approval alone
does not authorize it. This is current-turn user media, not a stored private-source
resolver: clients must cancel on source changes; private-source support would
require server lineage/deletion authorization before loading any bytes.

## Documentation and evidence

Official OpenAI documentation fetched 19 October 2026:
[Decisions guide](https://developers.openai.com/api/docs/guides/decisions),
[API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create),
[voice guide](https://developers.openai.com/api/docs/guides/voice-agents),
[Decisions voice integration](https://developers.openai.com/api/docs/guides/decisions-voice).
These establish typed text/image requests and voice-source correlation, not Vox
latency or account availability. The installed SDK 6.9.1 public
`post('/decisions')` is verified by mocked SDK fetch; no SDK model migration was
performed and the explicit model stays `gpt-6-luna`. Dedicated Decisions JS helper
requires the guide's newer SDK; this compatible HTTP seam remains deliberate.

Run `npx tsx src/lib/adaptive/prediction/benchmark.ts` for the fixed synthetic EN/FA
text and image workload through `LivePredictionConsumer` and `DecisionService`.
[Recorded result](RESULT.md) and [JSON](benchmark-result.json) preserve limitations.
The fake provider emits fixture labels, so this cannot establish semantic accuracy,
calibration, real provider cost/latency, voice/device compatibility or end-to-end
conversation benefit. Paid calls were not made. Actual provider, independent
acceptance, CI, deployed revision, mobile/browser/device and audio-playback proof
remain separate gates.

## State and rollback

Existing aggregates parse with optional prediction metadata absent. New writes add
content-free reservation/cancellation/approval/receipt metadata inside
experience.predictionTurns. No raw text/raster migration or backfill occurs. The
prior server uses a strict schema and cannot parse those new record properties.
Before rolling back to that binary, disable prediction/preparation and use the
scoped rollback utility to remove only the eight new metadata properties, preserving
original revision/evaluation budgets and every other document field. The disabled
cancel endpoint is a no-op and cannot seed new-format records. Existing-turn
cancellation remains possible after authority revocation while the feature is on.

For one explicitly selected FILE-store account, dry-run (no writes):

```sh
npx tsx src/lib/adaptive/prediction/prune-rollback.ts --directory /absolute/path/to/adaptive --account-id telegram-account:123
```

After providers/preparation are stopped, apply using the exact contentSha256
returned by that dry-run:

```sh
npx tsx src/lib/adaptive/prediction/prune-rollback.ts --directory /absolute/path/to/adaptive --account-id telegram-account:123 --expected-content-sha256 <digest> --providers-stopped --apply
```

Use the current working directory's absolute path to the utility when outside the
repository. The script never scans accounts or prints private document content.
Apply uses normal file storage locks/atomic writes and a content CAS; changed
accounts fail closed. Run for each specifically approved affected account and
verify old-schema readability before changing binaries. Firestore is deliberately
unsupported by this file CLI; an authorized operator must use the exported pure
stripPredictionMetadataForRollback helper inside a reviewed Firestore storage
transaction with the same explicit scope/CAS. No production cleanup has run. Kill
switches alone do not rewrite existing durable records.
