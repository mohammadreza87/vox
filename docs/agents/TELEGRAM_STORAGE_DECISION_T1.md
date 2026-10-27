# Telegram storage decision: T1 archive with minimal service state

25 October 2026. T1 implementation direction under the product owner's request to implement, independently test, merge and deploy the memory program. Implementation base `7224f40d69cf816a49139a30092cbf92551d2a8e`; original design baseline `d56dfa7aa185e807f656fcc864c36e94c98ebaf2`. Qualification remains required; this document alone does not activate a feature, migrate data or change retention.

This memo answers the open question in [the product design](AGENT_MEMORY_PRODUCT_DESIGN.md#8-telegram-storage-requirement-feasible-design-and-hard-limits) and [the delivery program](AGENT_MEMORY_DELIVERY_PROGRAM.md): which storage mode the memory system runs on. It lists every field that would live outside Telegram under T1, what kind of data each field is, and how it is erased. AM-02 still runs the synthetic T0 test; this memo records why T0 cannot be the production contract and what T1 must look like so that AM-05 and later can start.

## 1. Recommendation

Implement **T1**: Telegram holds the user-visible memory archive, and an external service store holds trusted authority, pointers, pending events, tombstones, operation state and a rebuildable index. Reconstruct content from Telegram artifacts and pending events while separately restoring current trusted grants and deletion state. This is a T1 recovery test; it does not prove strict Telegram-only T0 recovery. T2 is not selected. External index bodies and pending events are personal content, not merely pointers; inventory and retention apply.

The ordinary Bot API has no general message-history replay. File bundles can provide recovery data, but a pinned locator does not establish the newest authorized state. Record T0 failures or unavailable evidence explicitly rather than claiming an impossibility proof from a missing history method alone.

## 2. Verified Bot API facts that decide this

Checked against the [Bot API reference](https://core.telegram.org/bots/api) and the [Mini Apps documentation](https://core.telegram.org/bots/webapps) on 25 October 2026. The current client in `src/lib/tireh/telegram/client.ts` uses `getUpdates`, `setWebhook`, `sendMessage`, `editMessageText`, `sendVoice`, `getFile`, `getChatMember`, `getChatMemberCount` and bot profile methods; it does not yet use `sendDocument`, `getChat`, `pinChatMessage`, `createForumTopic` or `deleteMessage`.

| Fact | Consequence for storage |
| --- | --- |
| There is no general fetch-old-message-by-id method, and `messages.getHistory` and `messages.search` are user-account methods | A text journal is not a replay API. Known accessible file IDs, including received files, support file recovery; the latest pin is only a locator |
| Unreceived updates are kept for at most 24 hours | Inbound messages must be persisted by the service on receipt; an outage longer than a day loses them with no Telegram-side recovery |
| `file_id` is valid only for the bot that received or sent the file | A replacement bot cannot download the archive; successor bots need a re-upload or a user-driven re-attach flow |
| `getChat` exposes only the most recent pinned message | The pin can serve as a root locator but not as a history cursor or a transactional manifest |
| Ordinary `deleteMessage` documents a 48-hour limit alongside administrator permissions; no general admin exemption is established | Forgetting cannot promise physical removal of older Telegram copies; it must report "external copies may remain" |
| No transactions, locks, compare-and-swap or multi-message atomic writes | Exactly-once and ordering guarantees must come from the service side |
| Text message limit 4,096 characters; bot uploads up to 50 MB (the current client downloads at most 20 MB) | Node cards are views, not storage; durable data goes in files |
| Bots cannot create groups or channels | The user creates the memory group from a deep link and adds the bot as admin; the bot creates forum topics after verifying its rights |
| Mini App CloudStorage: 1,024 keys of 4,096 characters per bot and user | Fine for cursors and preferences, useless as a graph store |
| Rate limits of roughly 30 messages per second overall and 20 per minute to one group | Consolidation writes must be batched; one checkpoint upload per 8 messages is affordable, one message per event is not at scale |

## 3. What stays in Telegram under T1

Telegram is the durable archive destination. Before archive verification, pending source content also lives durably in the service outbox; the derived index remains personal content. The first implementation slice supports text events in the verified private owner DM only. Forum groups, category topics, node cards and group archive setup in the target layout below are future capabilities and must not be presented as activated by the first release.

| Artifact | Telegram object | Written when | Read by | Recovery role |
| --- | --- | --- | --- | --- |
| Event bundle | Document in the Snapshots topic, gzip JSON, one per checkpoint | Every 8 committed messages or a topic boundary | Bot via `getFile`; user can download | Replays events since the last snapshot |
| Snapshot | Document in the Snapshots topic, full map and index image | After each consolidation run that changed the map | Bot via `getFile` | Cold start base |
| Manifest file | Immutable document with schema, scope, sequence range, bundle/snapshot file IDs and hashes, previous manifest-file reference and authority watermark | After each committed checkpoint | Bot via `getFile` | Complete traversable recovery chain; missing ranges fail recovery |
| Root locator | Small pinned message naming a manifest file and digest | After manifest verification | Bot via `getChat`; user reads it | Discovery only; external committed revision and current authority determine whether it may be used |
| Node cards | One message per node in its category topic, edited in place | On node change, coalesced | User | Human-readable view only; never read back by the bot |
| Journal lines | One message per checkpoint in the Journal topic | At checkpoint | User | Human-readable audit only |
| Memory cards and replies | Bot chat and Mini App | On request | User | None |
| Cursor and UI preferences | Mini App CloudStorage | On change | Mini App | Convenience only |

The event bundle plus the manifest are what make "rebuildable from Telegram" true. A bundle is uploaded before the checkpoint is acknowledged, and its file id and digest go into the next manifest write. Verification downloads the bundle and compares hashes before the checkpoint is marked recoverable.

## 4. Field inventory: everything that leaves Telegram

Classes: **identifier** (opaque ids and numbers), **control** (authority, epochs, pointers), **derived content** (text or vectors computed from user content), **content** (user text itself), **operational** (job and cost state, content-free). Persistence: **durable** (loss is data loss), **rebuildable** (cache, recreated from Telegram files plus the outbox), **transient** (lifetime of a turn or job). Retention follows [the privacy schedule](../implementation/PRIVACY_AND_CONSENT.md#7-retention-rights-and-accountability); numbers below are the proposed starting targets from that document and are not new commitments.

### 4.1 Scope and authority (durable, control)

The target indexed mapping uses `accounts` and `controls` described in [INDEXED_STORAGE.md](../implementation/INDEXED_STORAGE.md). The first release instead extends the existing canonical AdaptiveDocument on the actual FILE backend using its committed-write fence and existing authority controls. Indexed/firestore archive support requires separate qualification; archive-disabled behavior remains unchanged. No parallel ungoverned content store is introduced.

| Field | Class | Retention | Erased by |
| --- | --- | --- | --- |
| tenantId, agentId, personId, space, containerId | identifier | Life of the relationship | Relationship deletion |
| charterVersion, adaptationEnvelopeVersion | control | Life of the relationship | Relationship deletion |
| historyPolicy, automaticMemoryEligibility, explicitSaveFlag | control | Life of the relationship | User setting change writes a new epoch |
| consentEpoch, grantRevision, revocationWatermark | control | Life of the relationship plus minimal audit | Never rolled back; audit copy under the consent-evidence rule |
| audienceRevision (group containers) | control | Life of the container | Container deletion |

### 4.2 Archive locator (durable, control)

Without these a cold start cannot find the archive. They are the single most important external fields.

| Field | Class | Retention | Erased by |
| --- | --- | --- | --- |
| memoryGroupChatId, journalTopicId, snapshotsTopicId, categoryTopicIds | identifier | Life of the relationship | Relationship deletion |
| pinnedManifestMessageId, latestManifestDigest, latestSnapshotFileId, latestBundleFileId | control | Life of the relationship | Replaced on each manifest write |
| botId that owns the file ids | identifier | Life of the relationship | Bot replacement triggers re-attach |
| archiveAudienceCheck (verified intended recipient identities, source of membership evidence, history policy, rights, observed revision, gaps, verifiedAt) | control | Life of the relationship | Invalidate on membership/access change or evidence gap; count alone is insufficient |

### 4.3 Outbox (durable until bundled, content)

This is the one place user text sits outside Telegram in durable form. Maps onto the existing `outbox` table.

| Field | Class | Retention | Erased by |
| --- | --- | --- | --- |
| eventId, logicalMessageId, telegramUpdateId, telegramMessageId, revision | identifier | Until the bundle containing it is verified in the manifest | Bundle verification deletes the row |
| kind, actorId, occurredAt, receivedAt | identifier | Same | Same |
| payload text, media file id, caption | **content** | Flush at 8 committed messages, topic boundary or configured maximum age, whichever comes first; bounded outage policy below | Verified checkpoint or applicable forget; never discard accepted unsaved payload just to meet an age target |
| deliveryState (sent, unknown, failed) for outbound messages | operational | Same | Same |

Age and byte limits are monitored. During Telegram outage, retain eligible accepted events within the reviewed durable queue policy, back off retries, and stop accepting new durable saves before capacity is exhausted; report archive pending instead of silently dropping data. Freeze maximum-age flush, retry, capacity and retention values before activation. Separate service-durable acknowledgement from archive verification. Outbound unknown-send receipts survive payload deletion in the content-free operation ledger until reconciled; do not blindly resend.

### 4.4 Tombstones and corrections (durable, control)

| Field | Class | Retention | Erased by |
| --- | --- | --- | --- |
| tombstoneId, targetRootIds, lineage | identifier | Minimal non-content audit under the deletion rule | Never silently; only under the approved retention contract |
| authorityEpoch, createdAt | control | Same | Same |
| purgeStatus (blocked, online purge done, provider pending, external copies may remain) | operational | Same | Same |
| correctionId, replacementRef, effectiveAt | identifier | Life of the relationship | Relationship deletion |

Restore from any snapshot applies current trusted tombstones and authority before the first read. A backup alone cannot prove that its authority epoch is newest. The service recovery protocol must establish a current trusted watermark through qualified replication/backup reconciliation; if that cannot be established, affected reads remain unavailable. Test loss of the service store as well as loss of the derived index. Revocation records are authoritative recovery state, not reconstructable caches.

### 4.5 Operation ledger (durable, operational)

| Field | Class | Retention | Erased by |
| --- | --- | --- | --- |
| jobKey (source range, revisions, extraction version, authority generation), lease, attempt ids | operational | Proposed 30 days | Scheduled purge |
| checkpoint receipts (uploaded, verified, recoverable, timestamps) | operational | Life of the relationship | Relationship deletion |
| trace records (route, memory ids used, models, tokens, cost, outcome) | operational, content-free | Proposed 30 days detailed, aggregates longer | Scheduled purge |
| cost ledger rows | operational | Per the accounting rule in the delivery program | Scheduled purge |

### 4.6 Index (rebuildable, derived content)

This is what makes replies fast. It is a cache in the sense that it can be deleted and rebuilt, but every row is personal data and is protected as content. Maps onto the existing `memory_meta`, `bodies`, `postings` and `source_edges` tables and their expiry and reverse-lookup indexes.

| Field | Class | Retention | Erased by |
| --- | --- | --- | --- |
| claim rows: subject, type, value, status, validFrom, validTo, confidence, explicit flag, sourceEventIds | **derived content** | Rebuildable; follows history retention | Tombstone, forget, or full rebuild |
| last retrieved, mentioned, confirmed, contradicted timestamps | control | Same | Same |
| storageStrength, retrievalStrength, nextReviewAt, layer or importance reason | control | Same | Same |
| node rows: title, summary, branch, category, parentId, crossLinks, salience, archived | **derived content** | Same | Same |
| person nodes: relationship to user, last contact, valence | **derived content**, sensitive | Same | Same |
| lexical postings | derived content | Same | Same |
| embeddings | derived content | Same | Same; embedding provider retention is a separate verified fact |
| working brief fields: goal, decisions, open questions, next step, mood | **derived content** | Rebuilt at each checkpoint | Checkpoint or forget |
| open situations: goal, dueAt, state, nextReconsideration | derived content | Life of the situation | Resolution or forget |

### 4.7 Transient (lifetime of a turn or job, content)

| Field | Class | Lifetime |
| --- | --- | --- |
| recent-window cache (last 8 messages verbatim) | content | Rebuilt from the outbox and bundles; memory only |
| assembled context package for a reply | content | The turn; never logged |
| prepared retrieval from predictive preparation | derived content | Until final-input validation; never durable |
| parser working copies for files | content | Until extraction completes or fails |

### 4.8 Secrets (external, never in Telegram)

Bot tokens, signing keys for manifests, embedding and model provider keys, and the key custody for any encrypted bundles stay in the existing vault boundary. Telegram never holds a secret, and no secret appears in a manifest, card or bundle.

## 5. What T1 guarantees that T0 cannot

| Guarantee | How T1 provides it | Why T0 cannot |
| --- | --- | --- |
| Accepted eligible events survive the qualified failure model | Transactionally persist before inbound acknowledgement/offset advancement and service-durable save acknowledgement; verify archive checkpoint before compaction | In-memory queues do not survive restart; provider events never received remain a separate coverage gap |
| Revocation survives restart and restore | revocationWatermark and tombstones in the service store, applied before any read | A pinned manifest cannot prove it is the newest after rollback |
| Stale writers cannot commit authoritative state | Transactional lease with fencing generation and conditional committed-revision update; reconcile external uploads | No cross-store transaction with Telegram; a lease alone does not prevent stale network writes |
| Edits and duplicates resolve to one logical message | Deduplication on update id and logical id with revisions in pending/archive records | The 24-hour limit concerns unreceived updates; stable retained IDs can deduplicate older received events |
| Forgetting is honest | Purge status distinguishes blocked, purged, provider pending, external copies may remain | Old bundle files and cards remain readable to group members |
| Replies are fast | Index serves retrieval; Telegram is never read on the reply path | Downloading and parsing bundles per reply is too slow and too costly |

## 6. Honest limits of T1

- Telegram copies already visible to a group member cannot be retracted by the service. Forgetting changes agent use and controlled copies only.
- Successor bots cannot use the predecessor's file ids. A bot replacement needs a user-approved re-attach that re-uploads the latest snapshot.
- Process `my_chat_member` removal/block updates and eligible `chat_member` updates; the client already represents both. Group deletion is not equivalent to bot removal. Suspend on lost rights or evidence gaps and reconcile; failed writes do not establish deletion.
- Embeddings and summaries are personal data outside Telegram. "Telegram storage" is a true statement about durable artifacts, not about where processing happens. Provider calls still receive authorized text.
- Encrypting bundles would need a key custody and recovery design that does not exist yet and would not protect the plaintext cards and messages already in the group.

## 7. Costs the decision implies

Planning estimates to be replaced by AM-02 measurements. Assume 100 messages per active relationship per day.

| Item | Per relationship per day | Note |
| --- | --- | --- |
| Bundle uploads | About 13 files of 2 to 10 KB | One per 8 messages; far under rate limits |
| Manifest edits | About 13 edits | `editMessageText` on the pinned message; one per bundle |
| Node card edits | Under 30, coalesced | Spread over the day; nightly cap 100 writes per group |
| Snapshot | 1 file, tens of KB to a few MB after a year | Only when consolidation changed the map |
| Service store growth | Tens of KB per day of index and ledger rows | Outbox stays near empty |
| Cold rebuild | Root/authority lookup plus every required snapshot/manifest/bundle download; number depends on checkpoint age and chunking | Benchmark 10,000-message history, a day's pending bundles, outage backlog and media; under 60 seconds is a hypothesis |

## 8. Decision record

| Item | Entry |
| --- | --- |
| Options considered | T0 strict Telegram-only; T1 Telegram archive plus minimal service state; T2 external database with Telegram front end |
| Implementation direction | T1 with separate content reconstruction and trusted-authority disaster-recovery qualification |
| Authorization | Product owner's 25 October request to implement, QA, push, merge main and deploy this memory program; scoped activation still requires passing acceptance and current user grants |
| What the decision unblocks | AM-05 source and coverage ledger, AM-06 graph, AM-12 recovery, AM-20 migration and deletion qualification |
| What it does not decide | Retention numbers, provider and model choice, encryption of bundles, successor-bot re-attach UX, group deletion handling |
| Reversal cost | Low before AM-05 ships; after that, a move to T2 is a migration of content out of Telegram and a product promise change |

### Checklist before signing

- [ ] AM-02 synthetic T0 report attached with pass, fail or unavailable per requirement
- [ ] Section 4 reviewed by privacy: every content and derived-content row has a retention rule and an erasure path
- [ ] Maximum-age flush, outage/backpressure behavior and non-content delivery reconciliation tested
- [ ] AM-12 T1 content and authority recovery drills specified; no T0 label for external-state recovery
- [ ] Bot API methods to add agreed: `sendDocument`, `getChat`, `pinChatMessage`, `createForumTopic`, `deleteMessage` with admin rights handling
- [ ] User-facing wording for forgetting agreed: removed from agent use, purge pending, purged from controlled copies, external copies may remain

## 9. Related documents

- [Agent product design](AGENT_MEMORY_PRODUCT_DESIGN.md), section 8, storage options and the T0 protocol
- [Delivery program](AGENT_MEMORY_DELIVERY_PROGRAM.md), AM-02, AM-05, AM-12, AM-20
- [Human memory research brief](../research/AGENT_HUMAN_MEMORY_RESEARCH_2026_10_25.md)
- [Indexed private memory](../implementation/INDEXED_STORAGE.md), the existing service store the external fields map onto
- [Privacy and consent](../implementation/PRIVACY_AND_CONSENT.md), retention schedule and deletion orchestration
- [Event memory and prediction plan](../implementation/EVENT_MEMORY_PREDICTION_PLAN.md)


## Assistant-delivery control extension (ARC1)

The separately reviewed [ARC1 contract](AGENT_MEMORY_ASSISTANT_RUNTIME_CONTROL.md) adds an unwired original-FILE prerequisite. Outside Telegram it stores strict delivery identity/authority snapshots, keyed evidence digests, minimized outbound receipts and outcome state under a 7-day detail lifetime with expiry-gated use and lifecycle pruning; per-stream route/message floors and an account original-source-time barrier prevent replay after detail removal. These are personal/control data. Four streams, 32 detailed effects and a 160 KiB canonical reservation are engineering limits, not new permission to capture production conversations. Selected-space export, immediate detail erasure with replay fences, and lifecycle pruning are required. The permanent content-free format marker contains only a version and format kind. No assistant text, provider response body, secret, generated text or submitted wire bytes may be persisted by this extension. See the contract for the complete field inventory, relationship-life floor policy, fresh account bootstrap, actual FILE qualification and old-reader refusal. Production purpose/notice/retention and authenticated producer activation remain separate gates.

The next [ATI1 integration contract](AGENT_MEMORY_ASSISTANT_TEXT_INTEGRATION.md) proposes ARC2 scoped enrollment controls: bot/chat/agent/Work/container identity, enabled state, enrollment/change time, revision and operation request ID, with at most four rows per account. These remain personal control data outside Telegram; disabled routing/replay controls last for the relationship, with no automatic enrollment-row retirement or physical-erasure promise in this slice. Selected-space export and protective disable/erasure must preserve no-replay barriers and uncertain outcomes. A second permanent content-free version marker preserves reader admission after personal records are erased. Existing seven-day effect detail, 32-effect and storage limits stay unchanged. Contract acceptance, implementation, synthetic qualification, release and real enrollment are separate gates; this inventory does not enable capture or expand assistant-content retention.

## FILE runtime ownership control (FRO1)

The [FRO1 contract](AGENT_MEMORY_FILE_RUNTIME_OWNERSHIP.md) adds bounded operational owner and process-lifecycle metadata outside Telegram: a lifetime guard with version, role, random nonce, process ID/time and release identity; private bounded wrapper spawn/exit evidence; and a permanent content-free format marker. These contain no conversation payload, account/chat identifier or secret and are not permission or current account authority. Normal managed handoff retires only the proved stopped holder; unexpected stale or incomplete evidence refuses takeover. The marker persists after personal records are erased and prevents an incompatible downgrade. Runtime boot installs it even while ATI is off; maintenance/read-only inspection does not. This is an operational migration, not enrollment or retention expansion. Exact fields, finite control-file bounds, safe cleanup, reader admission and no-restore rules are in the contract. First live migration and source/installed qualification remain separate gates.
