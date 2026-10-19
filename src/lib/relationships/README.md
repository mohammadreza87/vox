# Scoped relationship loop

`RelationshipLoop` is shared conversational working state and a durable queue of
reconsiderable purposes. It does not administer agents, change executable code,
expand memory permissions, or schedule provider-side tasks. Studio supplies fresh
authorization, audience-filtered context, composition and Telegram transport.

## Contract

- `observeTurn`: deduplicates accepted turns, applies explicit stop/pause/resume/
  forget controls, validates an injected assessment and updates bounded working
  preferences/open situations. A future intention stores its purpose and source
  references, never a prewritten delayed message.
- `context`: returns working context for exactly one persona/chat/audience key.
  Private keys reject ingestion by another speaker. Studio must establish current
  group membership and access before ingestion/retrieval.
- `configure`: records an authenticated person's IANA timezone and optional quiet
  hours. Automatic delivery requires a known timezone. The extractor may set one
  only from an explicit statement; UTC is not silently assumed.
- `status` and `control`: support individual controls and inspection. Resume does
  not restore cancelled purposes. Forget removes grounded working data and
  cancels dependent intentions. Source IDs connect memory deletion to purposes.
- `invalidatePersona` / `clearPersona`: bump a durable persona epoch before
  clearing all derivative relationship records. In-flight assessment commits
  cannot recreate data from an older epoch. Explicit stop/pause/timing choices
  survive invalidation. Clearing relationship derivatives does not delete the
  independent memory/history stores; Studio must invalidate those as well.
- `drain`: claims at most one job per selected relationship, reloads current
  authorization/context, applies deterministic gates, composes a fresh complete
  draft, then reviews that exact draft with `OpenAIFollowUpReview`. Before sending
  the same text it rechecks authorization and epoch/revision/lease fences. Missing,
  malformed or refused review fails quiet.

## Modes and policy

`off` avoids assessment/decision calls and automated jobs. `shadow` assesses the supplied incoming turn only. It writes no relationship
working data/jobs, changes no memory, shapes no foreground reply, and performs no
complete fresh-draft review. It does not simulate a future scheduled delivery. `live` enables working state and due-job execution;
Studio's allowlists and fresh authorization remain mandatory.

The runtime composes a fresh complete draft with at most one question after deterministic gates, then asks `OpenAIFollowUpReview` two independent predicates: meaningful continuity ≥0.80 and observable content violation ≤0.10. It sends that exact draft only after fresh authorization, epoch/revision and transport fences. The older four-way `OpenAIDecisions` choice evaluator is retained as historical evaluation only, not current runtime.

Temporal grounding requires a literal quote from the current source, caller-attached source ID, source time and timezone. Model-derived ISO date extraction is not independent date proof. `after_event` requires a known end; known future starts are preparatory; ongoing events do not assume completion. Reschedules refresh the window and preserve the old kind unless the purpose changes. Unknown timing fails quiet.

Feedback classification is limited to the same private audience and the latest assistant exact intention marker plus matching epoch within seven days. Explicit helpful/unwanted/correction/neutral labels are eligible; malformed, refused or low-confidence classifications create no observation. Politeness, replies and silence do not imply success. Classification does not train models or change control; assessor preferences/corrections affect subsequent context. Receipts are bounded to 24 and 30 days with source fences for forget; last-target linkage expires after seven days.

The default policy delays reconsideration by at least one hour, limits scheduling
to thirty days ahead, expires an intention seven days after its due time, respects
22:00–08:00 in the known timezone and permits at most one unanswered social
outreach. Inbound conversation resets that unanswered count. A cooldown applies
across topics. Automatic group outreach defaults off; group context never causes a
private relationship key to be loaded.

Working preferences and situations have a ninety-day use horizon. `status` and
`context` remove expired entries; cleanup is lazy on access. Records are bounded
to 24 preferences, 24 situations, 24 active purposes and 24 terminal receipts, with
a 200 KB serialized state limit. Terminal receipts immediately redact purpose,
topic and grounding source references; they retain only delivery metadata. Per-relationship event IDs and forgotten-source tombstones retain the
most recent 256 IDs. This secondary dedupe window does not replace the Telegram
update deduper, identity checks or history deletion epochs. A durable Telegram
message-ID high watermark also rejects older transport events after the bounded
dedupe window. Explicit source timestamps older than the latest inbound turn
cannot reopen state or reset unanswered outreach.

## Persistence and delivery guarantees

The local relationship file store serializes mutations, uses restrictive file
permissions and writes/fsyncs/renames before advancing memory. File adapters support
one store instance in
one persistent process. Multiple processes/instances must use Firestore. Parent
directory fsync and distributed file locks are not provided.

Firestore uses bounded relationship data documents, separate durable control
documents, persona epoch documents, transactional claims and a due-time query.
Data documents carry a ninety-day expiresAt TTL and read-time expiry enforcement;
production must enable TTL on vox_relationships.expiresAt. Stop, pause, timezone,
quiet hours, message sequence and outreach restraint survive data TTL deletion in
the controls collection, which contains no conversational text. These are separate from the Studio
singleton state document. Worker calls must be authenticated, awaited and
bounded; serverless deployments need an independently installed scheduler. An
in-process timer or an unawaited post-response promise is not durable scheduling.

An active relationship-wide lease excludes other topics from concurrent workers.
The worker has a default twenty-five-second wall-clock budget (maximum thirty),
and callback deadlines of at most twelve seconds. A provided AbortSignal should
be forwarded to transport. Mode changes are rechecked before provider work and
before the send fence. Evaluation leases may retry after expiry. Sending writes a durable `sending`
fence before transport. Telegram cannot participate in a database transaction:
a crash/timeout may leave delivery unknown. Such attempts become
`delivery_unknown` and suppress repeat outreach; they are never blindly retried.
This deliberately permits a missed follow-up instead of claiming exactly-once
external delivery. Authorization or a stop that arrives after Telegram has
accepted the send cannot retract that message. Studio also checks authorization
inside its transport callback to narrow that boundary.

## Observation and provider boundaries

Observers emit a fixed allowlist: event ID/time, schema/feature/mode, action/type,
private/group kind, pinned policy/model versions, an optional validated hex
source revision and a keyed HMAC scope pseudonym. No conversational text,
purpose, memory, person name, raw Telegram/chat ID, audio or exception/provider
body is exported. Admin reporting should aggregate these events rather than use
administrative permissions to browse conversations. Observation failures do not
retry transport side effects.

Local observation storage keeps at most 2,000 events and trims a thirty-day window
on append. Firestore writes `expiresAt`; production must enable TTL for that field.
Its read query independently enforces the thirty-day window. Detailed observation
records are operational samples, not complete totals or a training corpus.

`OpenAIDecisions` is a historical four-way evaluator and is not on the current follow-up runtime path. `OpenAIFollowUpReview` reviews the exact freshly composed candidate using two independent typed predicates. Provider/account access and quality still require live qualification. Structured extraction/composition remain separate adapters.

## Verification boundary

Focused tests cover deterministic multi-day behavior, scope isolation, explicit
controls, concurrent workers, stale assessments/composition, epoch invalidation,
restart persistence, uncertain transport, Decisions parsing/limits and store
atomicity. Deterministic adapter tests use a transactional fake. Opt-in tests
in firestore-emulator.test.ts and memory-emulator.test.ts also exercise the real
Admin SDK against a guarded loopback demo-project emulator: concurrent commits,
claims, privacy epochs, source snapshots, sharing CAS, legacy message purge, and
expiry/control persistence. These do not prove deployed indexes/rules/TTL, an
installed scheduler, live provider quality or Telegram delivery. Those are separate release gates on the exact
installed revision. No production provider calls or external messages are needed
for the focused suites.
