# Local adaptive service boundaries

This document describes the pure service libraries. Their later durable integration is
documented in [the runtime contract](../runtime/README.md) and [delivery record](../../../../docs/implementation/DELIVERY_RESULT.md). Runtime construction is explicitly gated; these libraries do not schedule workers, send external notifications or promote software. Modules export directly from each directory's `index.ts`.

## Decisions

`DecisionService.evaluate` requires a server feature switch, a current session
revision, an authoritative authorization fingerprint and a loader for minimized
text or one bounded explicitly shared image. Authorization precedes loading and is checked again before provider export
and result use. The loader must return only already permitted evidence; this
library cannot make an unrestricted source store safe. Questions are semantic
predicates/choices/scores, never identity or access decisions. The provider rejects
extra request properties and validates named answers, probabilities and score
arithmetic. All refusals currently fall back for the whole batch.

The default deadline includes authorization, loading and provider work and is
capped at 500 ms. Caller cancellation/revisions discard late work. Three provider
errors/timeouts/rate limits open a local 30-second circuit. No retries occur.
`PredictionSession` allows one in-flight request and two evaluations per turn;
`revise` invalidates partial work while `startTurn` resets the budget. The caller
must discard any separately prepared retrieval if its own authorization changes.
These in-memory controls are per instance, not a distributed rate limiter.

Official guide and API reference checked 19 October 2026:

- https://developers.openai.com/api/docs/guides/decisions
- https://developers.openai.com/api/reference/resources/decisions/methods/create

The installed `openai` SDK is 6.9.1; the guide's dedicated JavaScript Decisions
helper needs 7.30.0+. `OpenAIDecisionProvider` uses the installed SDK's public
`post('/decisions')` against the documented `POST /v1/decisions`. A mocked SDK fetch
test verifies the complete URL/body/signal without network or credentials.
`prompt_cache_options: { mode: 'explicit' }` with no breakpoints requests no prompt
caching. This is not a provider retention or regional processing guarantee.

Bounded current-turn text/image evidence is supported locally; see the
[prediction consumer contract](../prediction/README.md). Raw audio and live account compatibility,
quality calibration, latency/cost benchmarks, residency and retention verification
remain unavailable. Returned token usage is measured if provided; when a request
times out before usage arrives its eventual billed usage is unknown. No price
estimate is fabricated. Enabling the provider requires appropriate account/data controls. Studio now constructs
the adapter only behind `STUDIO_DECISIONS_ENABLED=1` and a configured API key; the
authenticated runtime endpoint applies its own profile, grant and budget checks.

## Observation

`authorizeObservation` validates a strict allowlist and applies current server
eligibility. The server producer must set authenticated scope, origin, trust,
receipt time and policy/source versions. Client fields cannot establish these
facts. There is no raw text/media or unrestricted error property.
`observationKey` is an exact key for a storage uniqueness constraint; it does not
replace an atomic outbox/transaction. `projectOutcomes` rechecks each event's
eligibility, selects the exact requested scope/date window, excludes nonhuman,
operational and sampled events, and deterministically supersedes old revisions.
Generated responses and client-reported tool successes do not count as verified
success. Missing/conflicting outcomes stay unknown; missing audio is `null`.
Playback remains explicitly client-reported when applicable. Completeness comes
from the caller's watermark, never absence of events.

Projection output is intended for the same authorized scope. It does not imply
permission to publish small cohorts or merge across people/spaces. Build/channel
cohort selection, privacy suppression, retention, durable producers/outbox and
external export belong to the integration/repository layer.

## Notifications

`evaluateNotification` and `prepareNotification` produce plans only. Separate
purpose and channel consent, verified recipient/endpoint ownership, source
access/tombstones and all current policy versions come from the injected server
snapshot. Preparation reloads that snapshot before returning. Marketing and
browser push have no contract here.

Optional proactive assistance requires explicit opt-in, defaults to cap two per
rolling 24 hours across a verified person's spaces, and defaults to quiet hours
21:00–08:00 in the explicitly selected IANA timezone. Unknown timezone yields
inbox-only; no timezone is guessed. Exact requested reminders can explicitly
choose their own quiet-hour behavior. Generic external payloads carry only an
opaque server-issued reference. Detailed inbox rendering must reauthorize sources.

A future sender must transactionally reserve the person's budget, make a final
policy check and append delivery receipts. Reserved and unknown sends already
consume the budget and block duplicate retries in this policy. These pure
functions do not promise distributed/exactly-once delivery or implement a durable
scheduler, inbox renderer or Telegram sender.

## Personalization and improvement

Preferences are fixed response-length, language and formatting settings, scoped to
one person/agent/container/space. Explicit choices and resets outrank all inferred
hypotheses. Inferences require evidence and at most seven days of validity.
`resolvePreferences` checks current eligibility per record. Writes, user controls,
CAS, deletion lineage and durable reset tombstones belong to repository/UI work.

`assessPromotion` is a read-only readiness gate over a synthetic or approved
aggregate candidate. It rejects protected paths, self-evaluation, untrusted
receipts, version/artifact mismatch, failed/skipped/privacy checks and absent
human release approval. It never applies patches or deploys. Path checks are
conservative defense in depth, not an OS/IAM sandbox. Protected receipt and human
approval callbacks must use evaluator/release credentials unavailable to the
candidate author. Production credentials, artifact verification and worker
isolation must be independently established before an improvement service runs.
