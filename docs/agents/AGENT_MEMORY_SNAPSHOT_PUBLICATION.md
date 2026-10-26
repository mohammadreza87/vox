# Bounded runtime snapshot publication — AM-05 / AM-12

26 October 2026. Reviewed implementation contract, not a release or activation receipt. Builds on the [pure snapshot prerequisite](AGENT_MEMORY_COMPACTION_CONTRACT.md). Independent architecture/privacy review approved this bounded slice; implementation and final qualification remain required.

## User-visible behavior

An eligible private owner DM can explicitly request `/archive compact` only when the separately configured `STUDIO_TELEGRAM_ARCHIVE_SNAPSHOTS=1` availability switch is enabled. It defaults off. Existing `STUDIO_TELEGRAM_ARCHIVE` availability, grants and capture enrollment do not enable this new command. Maintenance and ordinary messages never initiate compaction.

Require an existing verified checkpoint head, no pending messages, no active checkpoint/publication operation, no retired uncertain operation and no prior published snapshot. The owner may flush pending events first. Support one snapshot per archive generation and at most 16 runtime chunks; the pure planner's 128-chunk format remains unchanged. Oversize plans fail before uploads without truncation. Report the temporary durable-save pause and visibly refuse new memory admission while publication is active; do not silently acknowledge unsaved content. Ordinary recovery can use the old trusted chain until the snapshot is committed.

This does not increase the 128-checkpoint/1024-receipt horizon, change retention or provide comprehensive recall. A second compact request is a no-upload already-published result. Snapshot recovery supports subsequent ordinary checkpoint bundles while keeping global sequence monotonic.

## Durable state and authority

The canonical archive state gains a versioned trusted snapshot descriptor and a bounded publication operation. The surrounding archive row carries a reader-capability marker and at most one retired operation record. Current policy and identity remain authoritative; Telegram documents never restore grants or deletion authority.

The descriptor pins the published manifest's file/digest, exact original base head, complete receipt-prefix count/digest, original source-state digest and plan digest. The published wrapper authenticates strict metadata and ordinal chunk references. Current receipt prefixes must match immutable event/logical/revision/fingerprint fields; suppression can only advance. Every later receipt must resolve from a validated suffix or canonical pending source. Latest-source selection uses the entire canonical receipt ledger before expiry/suppression filtering, so older text cannot revive.

The existing pure verifier keeps its exact-source-state/current-authority contract and rejects already-published or active-publication state. A separately named published reader uses the canonical pinned descriptor plus current authority; historical plan authority fields are evidence, not present permission.

## Publication transaction

1. Obtain current eligible authority and canonical source state. Authenticate the exact bounded raw manifest/bundle chain, then create a deterministic plan from original sources and all receipts. Do not use filtered recovery output.
2. Refuse pending work, scope/authority gaps, expired sources or capacity overflow before effects. Persist a metadata-only operation, fixed source projection, validity deadline and a real serialized reservation for worst-case file/message IDs, revision growth and final descriptor. Preserve 192 KiB state, 256 KiB aggregate and canonical rights/pause reserves.
3. For each chunk and the final manifest, durably claim sending before the nonretrying upload, persist a returned receipt before readback, and mark verified only after hash validation. Persisted sending without a response receipt is unknown and must never cause automatic resend. Known receipts may retry readback under current authority.
4. Reconstruct transient chunk bytes after restart only from unchanged authenticated sources and require the frozen digests to match. Check publication availability, authority, original source validity and state projection before/after I/O and immediately before every send and commit. Publication requires a synchronous committed-state claim check inside the transport authorization callback: busy writers, a missing or replaced operation, changed stage/ordinal or source projection must deny the effect. An asynchronous read before invoking the transport is insufficient; explicit acknowledgement and replacement under unchanged policy must not authorize an older callback.
5. Atomically install the descriptor only after every artifact is verified and current state/authority still match. The old head remains unchanged and defines the exact suffix boundary. A lost commit response resolves by reading canonical state, never by repeating uploads.

## Clear, expiry, uncertainty and rollback

Clear, disable, permission/source resets, expiry pruning and capacity fallback must erase applicable content while preserving a content-free receipt for any checkpoint or publication that could have produced an external effect. Never-sent prepared work may be discarded. Repeated resets retain the same retired record; no late callback can overwrite newer authority or a newer record. New external archive work stays blocked until explicit owner acknowledgement, preventing unbounded uncertain-operation accumulation.

Extend `/archive retry-unknown confirm-duplicate-copies` to acknowledge retired metadata under verified private-owner authority, including after capture disable, optional-permission withdrawal or publication availability being switched off. This is control-only acknowledgement; it must not replay content or silently upload. External Telegram copies may remain.

The new reader marker is required for nested snapshot/publication/retired fields, even with availability off. Installed admission rejects older readers, malformed fields and unknown future versions. Scoped downgrade preparation must reject pending or retired uncertain work. Never restore old canonical backups over newer grants, revocations, suppression or tombstones.

## Independent acceptance and rollout

Use synthetic local transports and actual FILE adapter fixtures only. No repeat of the completed Telegram provider experiment, new private-history access or production capture enrollment is authorized by this slice. Cover raw-chain planning, bounded reservation, stage-by-stage restart/lost response, duplicate concurrent requests, snapshot plus later bundles, correction/clear/disable/expiry during effects, repeated reset and owner acknowledgement, complete receipt accounting, stale authority, wrong-scope/corrupt/missing files, limits before upload, reader downgrade refusal, default-off command and absence of automatic publication.

Record source/dependency hashes, exact synthetic request/read bytes, state/reservation size and local latency. Mock transport is not provider/device proof; zero paid model calls do not imply zero production storage/network cost. Independently reviewed tests, required hosted CI/indexed qualification, exact merged build and guarded installation are separate gates.

A newer Settings release and configuration supersede the earlier capture-off checkpoint. Preserve current configuration during deployment and keep the new publication switch off unless separately qualified for activation. Existing production capture/deployed-persona/retention/current-authority disaster-recovery evidence must be reconciled rather than inferred from a flag.

Next bounded slice: assistant-delivery provenance separating generated, sent, failed and unknown outcomes, with no automatic retry of uncertain sends. Archive horizon growth requires its own reviewed contract. Graph, retrieval, routing and prediction improvements follow measured quality, latency and total cost; snapshot publication does not establish full conversational recall.
