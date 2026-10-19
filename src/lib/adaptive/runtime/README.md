# Durable local experience runtime

`AdaptiveExperienceService` uses the same private account aggregate and atomic
repository transactions as consent and explicit memory. File storage fsyncs and
renames atomically under a cross-instance lock; Firestore uses a transaction.
`MemoryAdaptiveStorage` is a synthetic/local process store. Old aggregates receive
empty experience defaults; legacy notification flags and activity never backfill
consent. All runtime switches and inbox choices start disabled.

`/api/studio/experience` uses signed, time-bounded Telegram authentication, approved
Studio membership, agent-use checks, request-size/rate limits, JSON-only mutations
and an exact same-origin check. Missing server bot configuration fails closed.
Mutations use aggregate revision CAS and immutable command fingerprints; exact
replays are idempotent, conflicting IDs fail. Responses are not cached.

- GET the root with `?space=work|personal` for the owner's snapshot.
- PUT `preferences`: structured explicit choice/reset for one agent and space.
- PUT `settings`: selected timezone, rolling cap, quiet hours and per-space inbox,
  reminder and proactive choices. Communication choices do not grant purpose consent.
- POST `reminders`: an explicit reminder label and due time, with reminder consent
  and agent access. The label is private content, never analytics or an external payload.
- POST `feedback`: read/dismiss/useful/not_useful for an accessible inbox item.
- POST `predict`: current user text, optional minimized explicitly shared image, and a fixed registry question. Content is ephemeral;
  the response carries an opaque policy receipt, revision and question version.

Explicit preferences can be saved at the user's request before personalization
opt-in. Applying them requires current personalization consent, release eligibility
and an exact per-agent grant. No inferred preferences are created by this runtime.
`readPreferences` and `readPrivateContext` return opaque receipts tied to current
identity, source versions, grants, policy/approval versions and expiry. Observation
writes and inbox feedback do not invalidate response context; privacy changes do.
The caller must recheck receipts after all awaited processing and before output.

The server-only `recordTurn` accepts only allowlisted metadata. It skips all QA,
agent and system activity and checks current optional analytics consent, release
eligibility and agent grants inside the persistence transaction. It records
responded/failed/cancelled, never inferred task completion. Counts remain scoped to
the selected space; task success is unavailable and completeness is explicitly
false. The bounded 500-event/30-day local projection does not claim a full cohort,
wall-clock report window, first-audio latency or production health measurement.

A failed server turn can create a generic proactive inbox suggestion when its
separate purpose and communication settings permit it. Insertion atomically
reserves the default two-per-rolling-24-hour cap across both spaces. A selected IANA
timezone governs quiet hours; unknown timezone remains inbox-only. The inbox is
user-opened: reminders become visible at the exact requested due time and do not
create external delivery. Consent expiry/withdrawal and agent revocation cancel
queued items and remove reminder labels; current reads enforce expiry again.

Prediction requires an injected provider, explicit server enablement, confirmed
profile, core release eligibility and exact agent grant. Durable per-turn budgets
allow two evaluations across revisions, with one active lease per session. The
service checks current authorization around its 500 ms provider deadline. No text,
answers or unrestricted provider diagnostics are persisted. One bounded image may enter
Decisions under the separate image capability; raw audio is unsupported.
The [live prediction consumer](../prediction/README.md) adds cancellation tombstones,
fresh short-lived receipt validation and the text/image browser producer. Three registry questions are supported; relevance ranking,
notification ranking and quality grading are not enabled by this endpoint.

There is no external sender, recurring worker, browser permission request or
software deployment in this module. The inbox uses an existing account aggregate,
not a production-scale event store; document/storage limits deliberately fail
closed. File/Firestore persistence and boundary behavior have synthetic local
coverage; configured Firestore rules/IAM, real provider/account compatibility,
Telegram/device flows and live retention/residency remain separate release proof.
The improvement module remains an independently attested, human-controlled
readiness gate; it does not execute generated patches or modify production.
