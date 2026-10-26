# Agent memory production delivery program

Started 25 October 2026, Europe/Tallinn. User authorized a collaborating Sol 6.1/Luna team to implement, independently QA/test, push, merge main and deploy, followed by ongoing improvement. This record reports actual progress; the master specification remains the product design. No scope is complete merely because its task is registered.

## Workspace and production baseline

- Isolated branch: `codex/agent-memory-production`, starting from main `7224f40d69cf816a49139a30092cbf92551d2a8e`.
- Design inputs copied from `97229f5c7089d05ee3f0ae7c468c7f733ba26cca`; unrelated design work and account-access research are not part of this candidate.
- Release engineer observed production on `73710865e91935eb812d0d83962726fbe586d79b`, build `VJbEY600P6sikDqXzB_hR`, at 18:29 Tallinn / 16:29 UTC on 25 October. Public/local health passed; this is a dated baseline, not candidate release proof.
- Existing production uses FILE storage and has Decisions, maintenance and reminder delivery enabled. Preserve actual settings; do not infer default-off behavior from old documents.
- T1 is the implementation direction. See [the corrected storage contract](TELEGRAM_STORAGE_DECISION_T1.md). New archive activation requires current capture eligibility, scoped setup, and verified recovery authority.

## Team and model assignment

| Responsibility | Model | Role and boundary |
|---|---|---|
| Product lead | Current coordinating model | Own scope, backlog, dependency sequencing, integration and release evidence |
| Architecture/protocol | Sol 6.1 | Canonical contracts, Telegram archive protocol/client and focused author tests |
| Runtime implementation | Sol 6.1 | Existing Studio/gateway/persistence integration, user-visible setup/status, focused author tests |
| Independent acceptance | Sol 6.1 | Protected scenarios, exact-candidate QA, privacy/recovery decisions; no implementation authorship |
| Release | Sol 6.1 | Current production audit, guarded install/rollback, exact provider/runtime evidence |
| Scripted test execution | Luna | Run reviewed fixed commands, capture logs and deterministic results; no test repair or acceptance-policy edits |
| Evidence/report formatting | Luna when needed | Format approved results; do not infer passing gates from summaries |

At most lead plus three active workers in this environment. Rotate roles by dependency; five product preparation subagents are a runtime feature, not this development concurrency limit. Authors and evaluators do not approve their own implementation. A worker owns exact assigned files and preserves other workers' changes.

## First release: AM-RELEASE-01

Goal: a real, bounded private owner-DM Telegram archive path integrated with existing memory authority. Avoid ambiguous group audience enumeration in the first slice. Use immutable hashed bundle/manifest documents and trusted external locator/authority state. Capture eligible events only, expose pending/verified/failed status, and prove current corrections/deletions survive index reconstruction.

First-slice content is received private text only, not transactional archiving of assistant deliveries, voice or files. The recent context index holds at most 32 eligible events. The initial archive horizon is 128 verified checkpoints, at most 1,024 events; capacity rejects new capture rather than truncating accepted records. Snapshot compaction, comprehensive conversation reconstruction and broader search remain open follow-on work. User commands and release copy must state this bounded capability.

Active AM-02/03/05/12 map to existing VOX-013/014/049 and related release tasks. New AM task records retain the full 22-package roadmap without marking existing incomplete work done. Contracts may narrow the first release only with explicit evidence boundaries; do not describe a library, disabled flag, or health endpoint as the complete memory system.

Required acceptance includes scope isolation, duplicate/out-of-order delivery, crash/restart, maximum-age flush, bounded outage backlog, unknown external outcomes, current authority before restore, correction/forget during work, and non-reappearance after restore. Runtime needs the actual FILE backend or an explicitly qualified migration. Group storage, new sensors, five-worker speculative preparation, phi pacing, creator migrations and broader connectors remain separate staged tasks until implemented and qualified.

## Delivery and release sequence

1. Freeze interfaces and exact file ownership against the isolated baseline.
2. Implement the complete bounded journey and author checks; preserve provider/configuration behavior outside the slice.
3. Independent evaluator freezes and runs acceptance; Luna can execute reviewed commands and collect evidence.
4. Fix findings, repeat affected checks, record exact candidate and results. Run required type/lint/test/build and repository release checks.
5. Push branch and open/attach PR. Require hosted CI and indexed-storage qualification before main merge. Revalidate if main moves.
6. Build the clean merged revision with `studio:build`; re-read current production path/revision/build; use guarded installer and operation lock.
7. Verify exact installed/local/public revision and supported authenticated feature journey. Preserve latest authority and tombstones on any rollback. Do not overwrite production configuration or user state to make a smoke test pass.
8. Record remaining gates and next dependency-ready task. Provider, device, source, CI, merge, install and functional activation are separate evidence fields.

## Ongoing operation

Continue this authorized backlog in dependency order. Each cycle checks actual branch/PR/CI/deployed state, finishes the active slice, evaluates independently, and promotes only a qualified candidate. Investigate integrity regressions before feature expansion. Use the master specification's KPI and sprint cadence; do not automatically lower thresholds or publish personality changes from a metric.

Recurring development follow-up is separate from the already existing read-only Vox release monitor. Avoid overlapping deployment operations and notify only on meaningful progress, an actionable failure, completion or a required decision. Do not turn agent private conversations into a global improvement dataset. No new per-user capture, source permission or consent is inferred from development authorization.

After the first installation, qualify the Telegram provider journey with an explicitly designated synthetic destination before activating capture. The next memory increment must address snapshot compaction and selective source lineage: reaching the first slice's fixed archive horizon must not become the long-term user experience, and correcting one fact should eventually invalidate its descendants without clearing unrelated history. Keep the existing bounded refusal and conservative clear behavior until those replacements independently pass recovery and deletion tests.

## Current evidence

- Sol architect, runtime implementer, independent QA and release roles dispatched; release baseline completed.
- Fresh dependency installation succeeded using Node 22.23.3 and the checked-in lockfile.
- Independent baseline: 9 suites / 196 tests passed against the original source baseline; this does not accept the new implementation.
- Ongoing follow-up `agent-memory-production-delivery` is active every four hours on this chat, separate from the read-only release monitor.
- Bounded implementation complete for review. Independent QA-owned checks passed 59/59; selected source regressions passed 98/98 and installer/admission checks passed 45/45. See the acceptance report for scope and exact source digest.
- The first full coverage run failed eight tests: two outdated bot update-list assertions and six failures sensitive to the concurrent test workload. The assertions were updated for intended edited-message ingestion. The six affected suites then passed 74/74 with coverage, one worker and unchanged deadlines. This diagnostic does not replace the required full run; failure evidence is retained.
- Exclusive full coverage passed 7,319 tests with 15 existing skips under two workers and unchanged deadlines. Production build passed. CI, PR, merge and deployment are pending. Actual Telegram archive activation remains held for provider, retention and kill/recovery qualification.
- The first scope/contract review may identify a prerequisite that must land first; report it explicitly instead of claiming full completion.

## Completed foundation checkpoint and next increment — 26 October 2026

PR [113](https://github.com/mohammadreza87/vox/pull/113) merged as `3566c1a`; combined main `9954c03d60ac3ccd401da8b32b5c2ea8134de621` includes PR 114's Zod 4.6.6 patch. Hosted CI [320](https://github.com/mohammadreza87/vox/actions/runs/40216723791) and indexed qualification [133](https://github.com/mohammadreza87/vox/actions/runs/40216723688) passed. The guarded Mac installation on 25 October verified build `q--4w-1OOArle4wcTLGlI`, local/public revision and preserved configuration. These are dated receipts; reconcile again before promotion.

The one approved synthetic archive test at the designated persona's creator DM completed once and passed independent E3 review. It used isolated FILE state and production transport code; it did not prove actual inbound Studio/persona behavior or physical-device receipt. No repeated provider sends, private-history imports or capture activation follow from that result. The archive flag remains off.

Protected local evidence: `/Users/reza/.codex/task-artifacts/agent-memory-production/RELEASE_RECORD.md`, `COMBINED_RELEASE_ACCEPTANCE.md`, `COMBINED_MAIN_TESTS.md`, `SECURITY_REVIEW.md` and `PROVIDER_FINAL_ACCEPTANCE.md`. Zod remediation is present; the production audit retained eight moderate transitive findings. Developer-tool Storybook and brace-expansion risks remain separate from the inspected production artifact.

The next bounded AM-05/AM-12 increment is selective suppression of a known edited Telegram source. Its hypothesis is that unrelated accepted sources can remain available while the edited source is excluded from pending text, recent context and archive reconstruction. Unknown-lineage corrections and scope-wide forgetting must retain the conservative full reset. Independent acceptance must cover restart, old-source replay, in-flight uploads, scope isolation, bounded authority records and incompatible-reader rollback. This is not graph consolidation, snapshot compaction or assistant-delivery capture. Those remain the next roadmap items after this source-lineage prerequisite.
