# Relationship loop operations

Read [delivery plan](RELATIONSHIP_SYSTEM_PLAN.md) and [core contracts](../src/lib/relationships/README.md) first. The feature defaults to **off**. Enabling configuration alone is not evidence of a running scheduler or working Telegram delivery.

## Configuration

| Variable | Meaning |
|---|---|
| `STUDIO_RELATIONSHIPS` | `off`, `shadow`, or `live`; defaults `off` |
| `STUDIO_RELATIONSHIP_AGENTS` | Explicit pilot agent IDs, or `*` only with privileged role scope |
| `STUDIO_RELATIONSHIP_ROLES` | Optional `owner,superadmin`; current roles are checked at input, context, controls and delivery |
| `STUDIO_RELATIONSHIP_PEOPLE` | Positive Telegram IDs; optional with role scope, and intersects roles when both are present |
| `STUDIO_RELATIONSHIP_WORKER_SECRET` | Server-generated secret of at least 32 characters; CI derives a purpose-separated HMAC from the existing server secret when omitted |
| `OPENAI_API_KEY` | Decisions provider account; not exposed to browsers |

Shadow assesses only the supplied accepted turn. It makes no outbox work, foreground reply, or memory change and does not run the complete fresh-draft review. Live enables personal working context for the allowlist and reconsideration jobs. The user's timezone must be known before an automatic send. Studio → agent → Memories → Staying in touch provides timezone/quiet hours and pause/stop/resume. Ordinary follow-ups never ask a new permission question.

Telegram `/pause` pauses seven days; `/stop` stops proactive check-ins; `/resume` enables future eligible check-ins without resurrecting cancelled jobs. The user can continue normal conversation while paused or stopped. An unanswered automatic check-in suppresses further social nudges until an inbound turn. No acoustic mood inference is implemented; voice uses the accepted transcript.

## Serverless worker

The production workflow runs `firebase-relationship-infra.mjs prepare` before packaging. It verifies the deployed globally client-denied Firestore rules, required indexes and active working-data TTL, and prepares the named `vox-relationship-worker` scheduler paused. It never replaces rules. After exact-revision health, webhook and authenticated runtime/configuration checks, activation force-runs the paused job, verifies a fresh successful attempt, then enables the minute cadence. Off and shadow leave it paused; release failure also pauses it.

The worker credential is generated only on CI: an existing explicit credential takes precedence; otherwise HMAC-SHA256 of `STUDIO_SECRET` with purpose `vox:relationship-worker:v1` produces a stable independent bearer value. It is masked and passed privately to runtime packaging and the scheduler. Changing the parent secret changes this fallback credential; coordinate rotation and redeployment. No new service-account credentials or user permissions are granted. Existing release credentials need Rules read, Firestore field/TTL administration and Cloud Scheduler administration. API/IAM failures stop promotion with sanitized diagnostics.

For the authorized internal pilot, use `live`, roles `owner,superadmin`, agents `*`, and no explicit people filter. This follows current roles and existing agent access; it does not broadcast a greeting, invent a timezone, create prior DM history, or override stop/pause controls. Demotion suppresses the relationship immediately on the next gate. Stored personal controls survive, so a later promotion does not silently undo a stop.

Schedule **POST** `/api/studio/relationships/drain` once per minute with an `Authorization: Bearer <worker secret>` header and JSON `{"limit":2}`. The route authenticates before runtime initialization and accepts at most five relationships per request. Use a secret manager for the credential; do not commit it or put it in logs. The hosting environment must have outbound provider/Telegram access and sufficient timeout. The ledger, not the HTTP invocation, is the source of pending work.

One authenticated request may overlap another: transaction leases prevent duplicate claims. An operation fenced as `sending` is never blindly retried after an unknown result; it becomes `delivery_unknown`, accepting the possibility of a missed message to avoid duplicates. This is not an exactly-once transport guarantee. Review unknown delivery counts before increasing pilot traffic.

The local long-polling runner drains due work on startup and each minute, with a non-overlapping timer. Local relationship storage is intended for one always-on process. Use Firestore for multiple instances or serverless operation. Local memory writes use a process-independent lock directory. If a process is killed while holding it, stop all local Vox processes before removing that specific `<memory-file>.lock` directory and restarting; the implementation intentionally does not steal an ambiguous live lock. Do not delete the memory JSON file to clear a lock.

## Firestore and access

Server-only collections include `vox_relationships`, its epoch/control collections, `vox_relationship_observations`, and `tireh_privacy_epochs`. Deny browser access to these collections; Admin SDK access must remain confined to the application service account. No client Firestore access is required for this feature. Verify existing project rules rather than replacing unrelated rules with a broad template.

Enable Firestore TTL policies on `expiresAt` for `vox_relationships` and `vox_relationship_observations`. TTL deletion is asynchronous; application read paths also enforce the applicable age window. User stop/timing controls remain separate from expiring working text. A real emulator or staging transaction/concurrency run and project rule review are required before live rollout. Unit tests with a transactional fake do not prove Firestore deployment.

The due query uses `nextDueAt` inequalities and ordering on the same field; verify that automatic single-field indexing is enabled. Persona invalidation queries `personaId`; observations query/order `at`. Follow provider diagnostics if deployment-level index exemptions differ. Do not deploy an unverified index configuration.

## Observability

Admins see **Org → Conversation activity**, which refreshes while visible. The authenticated API `/api/studio/relationship-observations` returns aggregate counts over at most the most recent 500 retained events, explicitly not all-time totals. It never returns transcripts, private memory, names, raw chat IDs, provider bodies, audio or the per-scope pseudonym. Stored observation scope identifiers use keyed hashes.

The current follow-up runtime composes one fresh complete draft with at most one question after deterministic gates, then calls `OpenAIFollowUpReview` for two independent predicates: meaningful continuity ≥0.80 and content violation ≤0.10. The exact reviewed text is sent only after fresh authorization, epoch/revision and transport fences pass. The legacy four-way `OpenAIDecisions` send/defer/close/stay-quiet evaluator is historical evaluation evidence, not current runtime. These predicates are not calibrated accuracy guarantees; reconsideration remains bounded by policy and intention expiry.

Temporal grounding includes a literal quote from the current source, caller-attached source ID, source time and timezone. A model-derived ISO date is not independent date proof. `after_event` requires a known end; known future starts are preparatory; ongoing events do not assume completion. Reschedules refresh the window and preserve the existing intention kind unless its purpose changes. Unknown timing fails quiet. Pending purposes and recent messages preserve source times, so relative dates do not move during reconsideration. Studio and synthetic acceptance use the same follow-up composer. It requests short prose with enough generation budget and rejects provider-reported token truncation before any delivery; failure is reconsidered under the same bounded retry policy.

Watch assessment failures, deferrals, stale actions avoided, unknown delivery, duplicate suppression and user control changes. A closed topic or staying quiet is a valid outcome. The API does not imply that a user read or appreciated a delivered message. Human-rated relevance and unwanted-contact feedback remain separate from delivery counts. Feedback classification is limited to the same private audience and exact latest assistant intention marker/epoch within seven days. Only explicit helpful/unwanted/correction/neutral labels are observations; malformed, refused or low-confidence classifications produce none. Politeness, reply, and silence do not mean success. Classification does not train models or alter controls; explicit assessor preferences and corrections affect subsequent context. Up to 24 feedback receipts remain for 30 days with source fences for forget; last-target linkage expires after seven days. HMAC-linked observer outcomes feed admin aggregate counts only.

## Verification and release

Run `npm run test:relationships`, the full Vitest suite, lint, TypeScript, a production build and `npm run e2e:relationships`. The dedicated browser config starts its own port 3100 server and refuses to reuse an unrelated app. Install Playwright Chromium and WebKit first if needed. Run deterministic virtual-time replay and independent synthetic-user sessions against the actual implementation. Keep synthetic transcripts in dedicated local report directories; never replay real customer data into roleplay without appropriate authorization.

For each candidate, record commit, exact checks, provider/model, storage type, mode and pilot allowlist. A live pilot must demonstrate:

1. A real accepted Telegram DM updates the correct private relationship.
2. Voice and Telegram use the same person-agent context.
3. A due job sends one useful message or deliberately stays quiet using current context.
4. Resolution, stop, pause, revocation and access removal suppress pending actions.
5. A restart and overlapping scheduler calls preserve delivery invariants.
6. Group joins/leaves and failed membership verification reveal no private context.
7. Scheduler, TTL and rules are active on the exact deployed revision.

Rollback by setting mode `off` in the runtime configuration and rolling out/restarting all instances. Already running external transport calls cannot be recalled. Keep audit evidence for unknown sends; do not manually requeue them without investigating. Remove pilot allowlists to fail startup if someone accidentally attempts to re-enable live mode without a deliberate configuration.

## Known boundaries

Core v3 is implemented in a review candidate, default-off, and not production. Current fictional evaluation qualified a small gate: follow-up review 4/4 implicit positives, 0 forbidden sends, 9/9 typed provider responses; three timing cases were blocked by code before review. Temporal extraction had 12 calls (strict 8/12, literal grounding 10/10, known windows 3/3, busy windows 2/2, boundaries 2/2, ongoing/planned 2/4). Feedback verification had 8/8 real-provider classifications and 35 test cases. These are narrow synthetic/code checks, not human quality or production evidence. The [independent final gateway session](reports/relationship-final-user-acceptance.md) passed scoped fictional English user acceptance with real model calls and fake Telegram transport; it does not establish real-user outcomes or production delivery. Human-rated pilot and production gates remain open. See the named reports in `docs/reports/` for methods and limits.


Automatic group outreach is disabled. Group replies and explicit sharing are supported with audience snapshots; incomplete reader verification suppresses historical/internal context. Membership is revalidated before group delivery, including individual membership and member count. A platform membership change racing the actual network send cannot be made transactional.

Forget/revoke uses persistent epochs to fence old extraction, history writes and generated replies, and conservatively clears derived persona histories/working context. Already delivered Telegram text and already streamed voice fragments are not removed. The visible UI explains that deletion affects future use.

Synthetic long-term scenarios and model-driven user agents exercise behavior, but do not establish long-term benefit for real people. Do not expand the pilot based on engagement alone. The self-development/code-writing loop remains a separate future workstream with review and release boundaries.
