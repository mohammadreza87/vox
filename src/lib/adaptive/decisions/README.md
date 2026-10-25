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

The deadline covers authorization, loading and provider work. It defaults to
500 ms; callers may pass `deadlineMs` from 1 to 5,000 ms (larger values are
clamped). The service hands the effective deadline to the provider as
`options.timeoutMs`, which `OpenAIDecisionProvider` uses as its request
timeout. Requests are capped at 24 questions, 32
choices, 12 levels, and up to 8 text parts plus 1 low-detail image part.
Caller cancellation/revisions discard late work. Three provider
errors/timeouts/rate limits open a local 30-second circuit. No retries occur.
`PredictionSession` allows one in-flight request and two evaluations per turn;
`revise` invalidates partial work while `startTurn` resets the budget. The caller
must discard any separately prepared retrieval if its own authorization changes.
These in-memory controls are per instance, not a distributed rate limiter.

Official guide and API reference checked 19 October 2026:

- https://developers.openai.com/api/docs/guides/decisions
- https://developers.openai.com/api/reference/resources/decisions/methods/create

The installed SDK is openai 7.39.0 (>= 7.30.0, which requires Node 22).
`OpenAIDecisionProvider` calls the SDK's `client.decisions.create` when present and
otherwise the public `post('/decisions')`. Both send the identical documented
`POST /v1/decisions` body with `maxRetries: 0`, and a provider timeout of
`options.timeoutMs`, clamped to 1-5000 ms, defaulting to 500. Mocked-fetch tests
(`decisions.test.ts`, `transport-fence.test.ts`, `openai-compat.test.ts`) verify the URL,
body, signal, error names and the authority fence on both paths without network or
credentials.
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

## Reply-style procedural memory (not wired)

`personalization/procedural.ts` is a Beta-Bernoulli Thompson-sampling bandit over fixed, low-risk reply-style arms
(length, register, structure and closing question by default; modality and language opt-in), one posterior per (person,
persona, space, route) with the person stored only as a hashed subject key. Precedence is explicit request this turn >
explicit stored preference (`resolvePreferences` source `explicit` only) > sampled arm > persona default; pinned
dimensions are never sampled, logged or learned. It samples only in private, non-guest chats after the caller's
`optional.personalization` authorize callback, and `settle()` re-checks it before any write. The composite reward
(reactions, thanks, accepted share offers, reciprocated voice, corrections) never learns from reply-rate alone, and
pseudo-counts decay with a 90-day half-life. `reset()` and `withdraw()` delete posteriors and evaluation rows.
Evaluation rows (`{context, armChosen, propensity, unchosenArms, reward}`) are content-free with 90-day retention, in
`vox_reply_style` / `vox_reply_style_eval`. It is NOT constructed by the Studio runtime or gateway: enabling it is gated
by the DPIA covering behavioural adaptation (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.10, Step 14) and by
confirming that `message_reaction` updates reach persona bots in private chats.
