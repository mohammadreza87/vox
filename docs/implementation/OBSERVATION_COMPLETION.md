# Studio client experience observations

VOX-017 / VOX-020 / VOX-021 author candidate, based on `7f0b0efe109e6b372245e82b038271db369bb8e4`. Local synthetic implementation only; independent acceptance, CI, live provider/device behavior and deployment remain separate gates.

## Actual producers and evidence boundaries

Studio `ConversationPanel` attaches a measurement to the committed reply DOM. Two animation frames must pass, the reply must contain nonblank text, remain connected and be visible in the viewport and clipping ancestors; hidden/background output waits for visibility/scroll. Account/session, agent, space, pause/use generation and unmount invalidate pending dispatch. Metadata requests do not delay conversation rendering. This measures whole-reply client render latency from Send, **not** first streamed token, first provider token, satisfaction or verified task completion.

`text_rendered` is accepted only for the same authenticated account, exact agent/space, accepted server text conversation turn and current analytics consent/binding/grant receipt. Predictions, voice turns, rejected turns, changed policy and other accounts cannot create that correlation. Duplicate event IDs are idempotent. It remains `client_unverified`. Existing explicit task feedback remains separately labeled and never follows automatically from rendering.

When response metadata supplies `responsePresentation: { density, receipt }`, `compact` changes only the reply line height; `comfortable` inherits the existing baseline style. The same visible committed-text boundary acknowledges `/api/studio/experiments/exposure`. The experiment namespace owns validation, versions and accounting; observer data does not fabricate exposure. A rejected or unavailable acknowledgment restores comfortable styling without polling. Text already shown cannot be unshown; operational kill/revision fences apply to new preparation/acknowledgment operations.

`MemoryCorrectionEditor` acquires optional analytics authority alongside the original Save, without awaiting it or changing the mutation. Only current analytics consent allows this request. After the original Save settles it reports `correction_client_saved` or `correction_client_unconfirmed` through `POST learning/corrections`. Timeout and errors are unconfirmed because an aborted response can still hide a committed mutation. There is no claim that a failed response proves a failed save. A delayed authority response is discarded on consent/account/space change or unmount. An already dispatched metadata report may finish across the ordinary saved-note remount; the server rechecks current authority.

The saved report must match the original canonical `memory_corrected` command receipt and its own-space memory result. No new mutation receipt or fake agent is invented. `mutationEvidence: accepted_command_receipt` distinguishes a recorded command from an unavailable receipt, while feedback remains client reported. Neither endpoint accepts note text, memory IDs, exception messages, actor IDs or arbitrary properties. The journal hashes the operation correlation rather than retaining its raw ID.

## Persistence, reporting and lifecycle

The existing observer envelope stays schema/version 1 for original records. New text records carry `clientExperienceVersion: 1`; the optional `corrections` journal and optional `clientExperience` projection each carry version 1. This is an explicit extension, **not backward readability of populated new data**. The current parser reads original records; the prior strict parser rejects populated new extensions until rollback pruning.

Corrections have an independent exact account/space analytics receipt with current confirmed binding and capability/consent authority; they have no agent scope. They share the 200-record bound with turn records, expire after seven days and are removed on consent withdrawal, expiry or binding change. Agent removal does not turn an account-level note correction into an agent event. Text records retain the existing outbox/retry/lease contract; correction feedback is a bounded direct journal append, with no external consumer action or retry queue.

`LearningPanel` exposes client render count/latency and saved/unconfirmed correction counts in English and Persian. Missing samples remain unavailable/null. Snapshot completeness remains false and includes the correction report count separately from processed turn-event counts. Snapshots contain aggregates and hashed source linkage, not raw account/person/agent/command IDs or content. Own-space account exports add only allowlisted `observerCorrections` version/trust/outcome/mutation-evidence/times; authorized source memories remain governed by the existing independent rights export. Exports include correction expiry in the final deadline fence. Cross-space exports and withdrawals suppress these rows.

## Current-state rollback

Before restoring the prior parser, stop all new client/server observation producers and establish the storage writer lock. `pruneClientExperience` accepts an explicitly supplied canonical storage adapter. The FILE convenience wrapper `pruneFileClientExperience` requires one explicit account and absolute directory, previews a content SHA-256, then applies only with `producersStopped: true` and that exact digest under the FILE transaction lock. A stale digest refuses the operation. It removes only `text_rendered`, the correction extension and derived observer projections. It preserves current memories, corrected text, deletion tombstones, consents, existing server/playback/task observations and telemetry. Never restore an older account snapshot.

The frozen exact `7f0b0ef` observer parser fixture SHA-256 is `6f473fa9e371e80472f81469e34fec047dc446fc793dfda15b1e5d76a5719d9b`. The rollback test verifies old-parser rejection before pruning and acceptance afterwards, plus writer-CAS/stopped-producer refusal and source-state preservation. The older telemetry rollback also removes this extension before targeting its earlier parser. Author adapter tests cover prepared SQLite and managed FILEv2 through the same canonical transaction seam, preserving schema 2 controls, current pause receipt, withdrawn consent, corrected source and deletion tombstones. Preview requires a supported committed read and performs no write; apply reports the actual committed canonical digest, including native omission of an empty observer extension. Unsupported adapters fail closed. No rollout or migration was executed.

## Author validation

Synthetic checks exercise the actual signed conversation/learning/adaptive HTTP handlers and canonical FILE storage, exact receipt/space checks, strict ingress, duplicate handling, withdrawal/expiry, bounded storage, safe diagnostics, minimized own-space export and rollback. Component tests cover committed visible text, both UI languages, presentation acknowledgment, stale output, correction success/unconfirmed outcomes and slow diagnostics/unmount. Browser regressions use the compiled Studio UI with fully synthetic HTTP responses; they are UI evidence and do not establish deployed or real-provider behavior. Their result is recorded in the subsequent author evidence update.

Run the focused author suite with:

```sh
npx vitest run src/lib/adaptive/observation src/lib/studio/__tests__/learning-integration.test.ts src/lib/studio/__tests__/conversation.test.ts src/app/studio/_components/ConversationPanel.test.tsx src/app/studio/_components/MemoryCorrectionEditor.test.tsx src/app/studio/_components/MemoryCorrectionEditor.integration.test.tsx src/app/studio/_components/LearningPanel.test.tsx src/app/studio/_components/PreferenceLearningPanel.integration.test.tsx
npx tsc --noEmit --incremental false
```

Next owner: independent QA/privacy evaluator on the integrated candidate. Source/local evidence does not close platform logs/sinks/IAM retention, external deployment, live audio or verified external-task outcomes.
