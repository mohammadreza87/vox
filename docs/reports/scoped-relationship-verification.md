# Scoped relationship candidate — 19 October 2026

This report qualifies the scoped implementation, not activation for real people. The active production target is the Mac polling service at `vox.joyixir.com`. Firebase production must retain its explicit target guard; its workflow must not take ownership of these Telegram bots.

## Implemented and independently reviewed

- Account/person/agent/binding/tenant/space/container scope and a separate authoritative source ledger. Work and Personal remain separate; group automatic outreach is denied.
- A newly disclosed, affirmatively granted 30-day relationship identity link. Existing automatic-memory grants require reconsent; the ordinary 12-hour profile confirmation still gates new source capture and private inbox viewing.
- Exact reviewed drafts publish transactionally to the authenticated private inbox. Untracked private/shared memory text is excluded from proactive composition; ordinary foreground authorized memory access remains separate.
- Optional generic Telegram alerts require their own purpose, setting, current access, source authority, quiet-hour/budget checks and prior contact with the same bot endpoint. The server stores an opaque endpoint HMAC, never the bot token. Missing endpoint proof (including the current webhook adapter) allows inbox delivery only.
- Source deletion/revocation clears derived state before acknowledgement, including a send already in progress. Such sends retain an uncertain terminal receipt and cannot be blindly retried.
- Stop/pause controls survive identity-link replacement. Assessor-recognized restrictive controls use the durable authority; a failed durable update reports an unconfirmed result and attempts local suppression. A model cannot resume contact or override explicit timezone/quiet-hour settings.
- EN/FA controls in Experience support scoped inbox reading/dismissal, source removal, pause/stop/resume/forget and a separate generic-alert setting. Protective controls remain accessible when rollout eligibility expires.

## Verification evidence

Sol 6.1 agents implemented core/authority/delivery and performed independent cross-review; Luna implemented UI, documentation and browser fixtures. The integration lead connected and tested actual signed routes, Telegram dispatch and call boundaries.

The complete local Vitest run after integration with diagnostics revision `42a1a57` passed 1,882 tests with nine explicitly skipped emulator tests. The dedicated browser suite passed all ten journeys across desktop Chromium and iPhone-sized WebKit, including EN/FA, scope changes, keyboard controls and narrow layouts. CI now also runs the scoped Chromium journeys against the production build; `RELATIONSHIP_E2E_PRODUCTION=1 npm run e2e:relationships` selects that same build mode locally. All 33 release-script tests pass. TypeScript and targeted ESLint pass. The repository-wide lint gate passes with 184 existing warnings and no errors. Production dependency audit passes its high-severity threshold; eight moderate transitive findings remain in the existing Firebase dependency graph, requiring a separately qualified upgrade.

New focused coverage includes next-day publication after the 12-hour profile expires, 30-day link expiry, independent Work/Personal state, fresh role demotion, off-record EN/FA turns, stop before enrollment, signed-actor isolation, stale context during composition/review/publication, revocation/deletion while sending, duplicate and ambiguous alert handling, same-bot endpoint proof, capacity/retention and shared interruption budgets. Providers and Telegram transports in these tests are synthetic. These results do not prove real provider quality, actual-user delivery or physical-device voice behavior.

Prior fictional provider and long-term replay reports remain useful behavioral evidence for the unchanged assessor/review contracts, but do not certify the new scoped rollout or population-level prediction quality.

## Activation boundary

`STUDIO_SCOPED_RELATIONSHIPS=1` is a separate release gate; it defaults off. Role eligibility can include all current owner and superadmin accounts while preserving current agent access. It does not grant per-person purposes, identity confirmation or an approval manifest. No test manifest or synthetic consent may be installed in production.

Before activation, qualify the actual notices/controller details, current capability approvals, real account enrollment, provider access and device/recipient paths. The user confirmed `info@joyixir.com` as the privacy contact; mailbox operation and legal approval have not been verified. Joyixir's registered address remains unresolved. Human-rated relevance and unwanted-contact measures remain open. Unknown timezone fails quiet. Scoped gateway shadow mode performs no assessment. There is no acoustic emotion diagnosis, automatic model training or autonomous production-code mutation.

Storage is deliberately bounded: 500 source receipts retained at most 90 days, 500 notification receipts retained 90 days and 100 inbox records. Capacity exhaustion fails quiet. Expired sources are pruned and their original timestamps cannot be replayed as new capture.

The 14-to-16 purpose migration is forward-only for older application builds. A code-only rollback may reject migrated accounts. Preserve post-deployment withdrawals and use a schema-compatible recovery build; never reactivate an old consent snapshot. The production installer captures a stopped-state backup before changing its release symlink.
