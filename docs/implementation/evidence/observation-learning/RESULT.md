# Local integrated acceptance — 19 October 2026

Base `9fb73d311753a461bd62e37ce3129b8a60c83d00`; reviewed candidate files are bound by [source.sha256](source.sha256). This is local deterministic/file-backed and container evidence, not a production-activation receipt.

## Checks

- Whole repository: `npx vitest run` — **1,971 passed, 10 skipped**. Nine emulator-dependent checks remain outside this run; the one optional Docker check was run separately below. Existing `tts/route.test.ts` nested-mock deprecation warning remains unrelated.
- Docker evaluator: `VOX_IMPROVEMENT_IMAGE=sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 npx vitest run --config scripts/improvement-vitest.config.ts` — **32 passed, no skips**.
- `npx tsc --noEmit`, scoped ESLint and `git diff --check` — pass. `python3 scripts/validate-vox-plan.py` — no errors; TOML parsing unavailable under the installed Python version.
- Three-actor, 90-day file-backed journeys — **2 passed**, included in the full suite. See [SIMULATION.md](SIMULATION.md) for exact coverage and deliberate exclusions.
- Final integrated observer/lifecycle compatibility selection — **39 passed**, including server/API integration, observer, lifecycle and 90-day journeys. Counts overlap the full suite and must not be added together.

## Independent review and corrections

Independent workflow review reproduced extra free-text fields in signed evaluation envelopes, evaluation case counts exceeding proposal budgets, and a claimed candidate-disable operation absent from the implementation. Strict nested schemas and numeric budgets now reject the first two; the rollback receipt explicitly describes comparison only. Parent reviewed these fixes and added atomic durable artifact publication plus a restart/re-registration repair regression. The original pure promotion gate remains unchanged.

Independent observer/lifecycle review reproduced two P1 races: later claimed consumer callbacks ran after withdrawal during an earlier callback; and a prepared shared export survived an external group-membership change that had not mutated the shared repository. Before each callback, current policy/fingerprint/lease is now checked. Export now reconstructs and compares the shared projection, with private authority checked before final shared identity/group/expiry/revision checks. Added tests cover withdrawal, registry disable, lease expiry, event replacement, external membership changes and expiry across the awaited checks. The reviewer’s five-suite run passed **61 tests**; parent inspected the fixes and reran integrated qualification. This supplies the concurrency coverage deliberately excluded from the separate simulation report.

An independent rollback-compatibility probe loaded the actual repository implementation from `9fb73d3` against current synthetic storage. Old code read accounts with empty observer state omitted; retained observer events correctly failed the old strict schema. After withdrawal, old code could read the account while withdrawal, deleted-memory tombstone, absent private text and replay events remained intact. Current code recreated fresh empty observer defaults. No historical backup was restored. Activating observation requires a separately planned migration before any later old-code rollback.

## Rehearsal evidence

[improvement-report.json](improvement-report.json) binds exact source-file hashes, candidate, evaluator, data and policy digests and signed results. [improvement-public-trust.json](improvement-public-trust.json) contains only synthetic public verification keys. Fresh private demo keys were held in memory and never saved or mounted in Docker. Baseline failed 2 of 3 toy cancellation cases; candidate failed 0 of 3. Before synthetic human approval, readiness was denied. The resulting readiness and rollback comparison authorize no deployment.

## Browser qualification

The production build of `0266a3a7fb52ebdd50d680091e789bb9425c47d3` passed and its four synthetic browser journeys passed on Chromium and mobile WebKit. These cover EN/FA controls, Work/Personal isolation, export downloads and the read-only operations view. Visual inspection caught a Persian action label exceeding its fixed-height button; this candidate adds content-sized buttons and label-bounds assertions. The final build/browser/release receipt is collected separately against the final committed revision, so the earlier pass does not certify the later layout change. The LearningPanel component selection passed **8 tests** after that change.

## Remaining release levels

Production build, browser screenshots, exact-head CI, preview HTTP and deployment records are collected separately after this source freeze. Optional production processing remains off. No real provider generation, microphone/speaker/device, product-quality improvement, production IAM isolation or live pilot outcome is certified here. Cross-store authorization is revalidated at delivery boundaries; these checks do not claim a distributed atomic transaction over external membership authorities.
