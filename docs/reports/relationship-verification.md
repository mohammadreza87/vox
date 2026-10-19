# Relationship candidate verification

Date: 2026-10-19. Baseline: `68a1cd3`. Initial implementation: `776eae0`; the candidate and subsequent fixes are on [draft PR #43](https://github.com/mohammadreza87/vox/pull/43). The current policy is `relationships-v3`. This is a tested development candidate, not a production launch or proof of long-term human benefit.

## Delivered scope

- Detailed E0–E6 task/dependency/team plan and reusable project skill, with Sol 6.1 and Luna assignments and independent synthetic-user roles.
- Audience-scoped preferences, open/closed situations, source times, durable future purposes, and typed temporal evidence.
- Current source-backed event windows, code-based temporal checks, fresh complete composition, exact-draft Decisions review, then fresh authorization and durable/transport fences. The runtime uses two predicates with fixed continuity ≥0.80 and content-violation ≤0.10 thresholds. Historical four-way choice experiments remain available for reproduction; they are not the runtime contract.
- File/Firestore persistence, leases, revision/epoch fences, stop/pause/resume, quiet hours, expiry, unanswered-contact restraint, and conservative unknown-delivery handling.
- Telegram/MiniApp transcript-based voice context and a shared forget path for typed text, voice notes and calls.
- Exact-recipient sharing, source ownership, revocation, guest/member filtering and derived-context invalidation.
- Natural feedback tied to an exact delivered outreach: helpful, unwanted, correction, or neutral. A reply or silence is not evidence of helpfulness. Preferences/corrections update scoped context; feedback does not train models or authorize contact.
- User controls, content-free observation with pseudonymous action linkage, and admin aggregate feedback counts.

## Verification

| Check | Result and scope |
|---|---|
| Final full Vitest | **1,149 passed / 9 emulator-only skipped**, 80 suites passed / 2 skipped; exit 0 |
| Actual Firestore emulator | **9/9 database tests passed** on the final source; a preceding complete relationship-directory emulator run passed 119 tests. Isolated loopback `demo-vox-relationships`, no production database. Emulator stopped afterward |
| TypeScript | Full `npx tsc --noEmit --incremental false` passed on final source |
| ESLint | Full lint passed with zero errors and 177 repository warnings; final changed core/test paths checked again |
| Production build | `npm run build` passed; latest GitHub CI qualifies the pushed revision separately |
| Browser | Chromium desktop and iPhone 13 WebKit: **2 passed**, including settings, selected-person sharing/revoke, mobile overflow and aggregate feedback display. Fixture APIs; isolated port 3100 refuses server reuse |
| HTTP authorization | Real signed Telegram init-data through actual router/service/storage tests: unauthorized access, actor allowlist, timezone validation, actor-bound controls and admin-only observations |
| Environment packaging / skill | 13 production-environment and HTTP-verifier tests passed, plus four Firebase config-packaging regressions. Independent review reran all eight new packaging/preview checks. The updated v3 skill passed the bundled validator |
| Independent review | Stop-after-fence, voice forget, polite global stop, Telegram source-time provenance, policy versioning and long reschedule source retention were remediated; independent probes and focused reruns passed |

The normal full suite skips database-only cases unless `FIRESTORE_EMULATOR_HOST` is set. Separate actual-emulator tests cover transactions, concurrent claims, privacy epochs, memory snapshots, legacy parentless history deletion and expiry/control behavior. They do not prove production IAM, indexes or asynchronous TTL deletion timing. The local emulator used a temporary Java runtime; no system Java installation or production project was changed.

Browser checks verify visible controls and mutation bodies using fixture responses, not live authentication/Telegram. The first earlier attempt reached an unrelated pre-existing app on port 3000; it was neither modified nor stopped. Dedicated port 3100 now prevents that ambiguity.

### Remote verification and preview packaging correction

For `fc8f642`, [CI run 39295386682](https://github.com/mohammadreza87/vox/actions/runs/39295386682) passed lint/types, coverage tests, build and **11 browser tests**. Preview deployment also reported success, but direct HTTP checks found `/`, `/studio` and the unauthenticated worker returning plain 500 while a static JavaScript asset returned 200. The same standalone build locally returned 200 and the expected JSON 401. A successful upload was not a working preview.

After the owner completed Google Cloud's passkey check, runtime logs established the cause: the generated `next.config.js` loaded bundled Sentry/OpenTelemetry code that required `import-in-the-middle` at a missing root dependency location. Firebase's production dependency list externalized that name because a nested copy existed under `dd-trace`, while the root copy was development-only. The eager Sentry import executed even with Sentry disabled. This packaging issue predates the relationship changes.

The correction keeps Sentry loading lazy and limited to configured build/development phases; production server configuration returns before loading its build wrapper. A Firebase-style bundled-config regression and configured Sentry comparisons qualify the change separately. A new preview HTTP gate must pass before the workflow reports readiness: landing and Studio pages return HTML 200 and the unauthenticated worker returns JSON 401. This check cannot certify authenticated Studio providers, Telegram delivery or a production pilot. The PR records the latest pushed revision, CI and post-deploy results; the earlier `fc8f642` preview failure remains part of the evidence.

The inherited dependency audit is also distinct from green CI: full audit reports six high development-tooling entries and eight moderate runtime entries; production-only audit reports zero high entries. The existing CI audit step uses `continue-on-error`. No dependency was added or force-downgraded for this feature.

## Provider and conversational evidence

| Evaluation | Observed result | Boundary |
|---|---|---|
| Historical choice calibration | Initial 32-case calibration/holdout and 18-case refinement missed many ordinary initiatives; one initial heldout future-event false send | Preserved as failures; no threshold lowered to make a selected story pass |
| Historical draft/predicate experiments | 36 paired choice calls and 30 four-predicate calls failed initiative criteria | These broad contracts were rejected |
| Current bounded review | Fresh 12-case frozen set: 4/4 implicit positives allowed, 0/5 inappropriate queried drafts allowed, 3/3 timing cases code-deferred without a provider call, 9/9 typed provider responses | Prewritten drafts and authored temporal facts; no composer or human satisfaction claim |
| Temporal extraction | 12 real Haiku assessments, 12 parsed; 8/12 strict assertions. All 10 applicable source quotes grounded; 3/3 known windows, 2/2 busy periods and 2/2 quoted/third-person boundaries correct | Only 2/4 meaningful ongoing cases proposed a follow-up. ISO normalization is model-derived, not independently proved date interpretation |
| Feedback classification | 8/8 frozen English examples matched through actual Decisions adapter; 35 focused helper/integration tests passed | Small synthetic smoke test, not population calibration or proof in every language |
| Final default-model user session | Seven independent fictional user turns over Oct 19–26; one unsolicited check-in, linked style correction, resolution, then no stale outreach. Two reconsiderations, no drain failures | Actual gateway/assessor/retrieval/composer/review with Sonnet 5-5, Haiku 5-5 and Luna; fake Telegram, no real audio or humans |

The final user session sent: “Hi Marco, I've been thinking about the exhibition file and how it's sitting with you. How are things feeling between you and Priya at the moment?” The user had raised an unresolved work situation after several ordinary exchanges, without requesting a check-in or granting general permission. The later style correction was linked to the exact delivered intention, and resolution closed the next pending purpose. Source hashes remained stable during that run. A subsequent conservative cancellation on more than 20 grounding references was separately independently reproduced and regression-tested; the roleplay report identifies its exact pre-fix hashes.

Earlier independent Asha/Nima sessions include 90-day virtual timelines, EN/FA exchanges, listening/mood corrections, groups, selected-recipient sharing, guests, revocation and silence. Those findings drove actual fixes. They are not 90 days of real human use. The seeded replay executes 18 turn/reconsideration entries and explicitly reports 14 annotations that its adapter does not execute; separate tests and interactive controls exercise sharing/membership/fault cases.

Reports:

- [Final default-model conversation acceptance](relationship-final-user-acceptance.md)
- [Current exact-draft review](relationship-follow-up-review-evaluation.md)
- [Temporal extraction and limitations](relationship-temporal-extraction.md)
- [Natural feedback verification](relationship-feedback-verification.md)
- [Asha long-term roleplay](relationship-asha-roleplay.md), [Nima EN/FA and sharing](relationship-nima-roleplay.md)
- [Earlier proactive attempts](relationship-proactive-acceptance.md), [choice calibration](relationship-decision-calibration.md), [rejected architectural experiments](relationship-candidate-evaluation.md)
- [Independent implementation review](relationship-independent-review.md)

Fictional raw transcripts and diagnostic outputs remain in dedicated `/tmp/vox-*` directories named by each report. No credentials or real conversation content are committed. Provider costs, token counts and latency distributions were not captured for the interactive final session; they are unavailable, not zero.

## Remaining release gates

The implementation, local checks, bounded independent review and small synthetic acceptance are complete. Human-rated calibration, long-term benefit and production operation remain open. Missing initiative in the extraction study is a known recall limitation; one successful full session does not eliminate it. Feature mode remains **off by default**.

1. Verify one exact deployed revision with mode off, then an explicitly scoped internal evaluation. Shadow assesses supplied turns without live personalization/outbox/delivery; it is not a full unattended draft-review rehearsal.
2. Verify production Firestore server-only rules, indexes and TTL policies. Durable user control projections must survive working-data expiry.
3. Install and verify authenticated bounded scheduling, including overlap and restart behavior in the actual deployment environment.
4. With a named internal Vox agent and explicitly authorized test recipient, demonstrate real Telegram DM and voice behavior, useful outreach or deliberate silence, stop/pause, sharing/revocation and access removal.
5. Review human-rated relevance, unwanted outreach, missed opportunities, corrections, latency and cost against a no-outreach baseline before expanding the allowlist. Reply rate is not a sufficient objective.

Automatic group outreach is disabled; group replies and selected-person sharing are supported. Acoustic emotion recognition and autonomous production code changes are outside this implementation. Revoke/forget/membership changes conservatively clear derived persona histories and working preferences, so harmless style preferences may need relearning. Durable stop/timing controls survive. Backend deletion cannot recall delivered text, and no network send can be atomic with a simultaneous user control.

The user subsequently authorized push/deploy and the internal pilot for all Owner and Super Admin accounts. The production pilot uses current-role checks, including promotion/demotion, and preserves existing agent access, prior-DM and timing requirements. Release infrastructure now qualifies storage and activates the authenticated worker only after exact-revision checks. Actual deployment/provider/delivery evidence is recorded separately; this authorization does not by itself prove a live send.
