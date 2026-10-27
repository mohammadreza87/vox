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

## Original foundation evidence (historical)

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

## Lineage merge and live-release reconciliation

PR 115 merged as `6b410cd` with independent local and hosted acceptance; its build passed. Installation was held when fresh checks found live `6df838f5`, containing authentication and UI fixes absent from main. New scoped PR 116 preserves the exact deployed release alongside memory lineage. Its integration review also requires a narrow fix and failure/retry test for edited-message writes before polling acknowledgement. Do not install the superseded standalone `6b410cd` artifact over the newer live release. See [the lineage receipt and boundaries](AGENT_MEMORY_SOURCE_LINEAGE.md) and external `LINEAGE_RELEASE.md` for current gates.

## Snapshot contract prerequisite — current cycle

The combined lineage release `5b360b9` was installed and verified with capture off; main CI 325 subsequently passed. The next bounded AM-05/AM-12 increment is the [pure snapshot planner/codec/verifier contract](AGENT_MEMORY_COMPACTION_CONTRACT.md) with synthetic qualification. It does not publish snapshots or raise archive capacity. A separate prerequisite repairs main `cd87918` dependency compatibility failures while preserving the existing Stripe wire API and UI behavior. Current source, dependency, independent QA and release reports remain separate evidence gates; preserve newer deployments before installation.

Local fixed qualification passed 223 tests across eight suites plus TypeScript, scoped lint, Studio style and plan links; the independent reviewer owns acceptance of these exact bytes. Required hosted CI, merge and guarded installation remain pending at this source checkpoint. The interrupted compatibility run failed on temporary ENOSPC; the failure is retained and the bounded retry passed. No provider test was repeated.

## Runtime snapshot publication — next bounded increment

PR 120 merged as `632865ed` and was installed as build LGLTrOTFOJftJ3hsHIAXZ with independent acceptance, 7610 passing hosted tests, 55 browser tests and 18 local/public route checks; main CI 332 subsequently passed. These are dated receipts. On 26 October a newer Settings release `4a153f2` became live and main advanced to `ad6d4cc`. Preserve its source and changed configuration; global archive availability is now enabled by separate activation metadata, which does not prove per-user enrollment. This program will not repeat provider sends or activate new behavior from that flag.

The next contract is an explicit, separately gated snapshot publication path with bounded durable staging, preserved uncertain-effect metadata, current-authority/state-fenced publication and snapshot-plus-later-bundle recovery. It keeps the existing receipt/checkpoint/retention limits. Independent contract and crash/concurrency acceptance precede publication qualification. Current main has a rights-lock handoff failure and a separate timestamp-sensitive privacy assertion; narrow repairs must preserve security criteria before promotion.

The runtime publisher and installed-reader fence are now implemented behind a separate default-off switch; see [the bounded contract](AGENT_MEMORY_SNAPSHOT_PUBLICATION.md). The first independent run found a FILE transaction authority defect and fixture mismatches. Failed evidence is retained; the repaired five-file replay passed 102/102, while the unchanged Node gate passed 92/92 and static checks passed. No production/provider activation follows from these source results. Required hosted CI, merge and guarded installation remain separate gates. The next bounded feature is assistant-delivery provenance (generated, sent, failed and unknown), with horizon growth separately reviewed.

PR 124 qualification retained a required hosted failure: 7,990 tests passed, two failed, 15 existing skips. An additional existing archive unit fixture still expected the old nested uncertain-operation layout; independent QA updated it to require the exact retired receipt, no retained content, no resend and safe acknowledgement. The other failure reproduced an unrelated pre-existing launch-code constructor defect: a malformed short component could consume an underscore-containing join-code prefix. A narrow prerequisite validates both original components before serialization, with deterministic failing-before coverage and unchanged valid wire format. Hosted CI must qualify the repaired exact candidate; no retry of the unchanged failed run substitutes for that gate.

A separate source review then found that the actual Telegram client's archive filename allowlist rejected snapshot chunk/manifest names; mocked transport qualification had not exercised this boundary. Promotion was held despite the successor's passing hosted tests. The narrow repair admits only generated UUIDv4 snapshot names with runtime ordinals 0–15 or manifest, preserving legacy filenames, byte limits, synchronous send authority and no automatic resend. Qualification now includes the actual client and archive transport with injected HTTP responses for publication, readback and recovery; no live Telegram messages are authorized by these synthetic checks. The repaired candidate must pass independent and fresh hosted gates before installation.


## Assistant-delivery provenance — current cycle

PR 124 merged as `6abf21237976da20e842e42f41bc6b75536b9b99` and was guarded-installed as build `ELQNllprlmgbG7QDk-dkp` on 26 October 2026. The complete merged tree equals the independently accepted candidate. PR CI 340 passed 8,026 tests and 55 browser cases; indexed 153 passed. Main CI 341 and indexed 154 subsequently passed. Exact artifact verification, 18 local/public route checks and three installed synthetic reader scenarios passed. A fresh 17:39 UTC reconciliation confirmed the same healthy revision/build and unchanged configuration. Global archive availability remains 1; snapshot publication remains absent/off. These dated observations do not prove per-user enrollment or production capture qualification.

The next AM-05/AM-12 slice freezes assistant text-delivery identity, exact submitted wire evidence and conservative outcome transitions. Runtime persistence requires a separate finite control-retention/capacity and replay-cutoff contract, current source/authority fences and compatible-reader admission. Until those gates are resolved, only an unused pure protocol prerequisite is eligible for implementation. It must not change gateway delivery, retained history, received-user archive payloads, voice fallback or production behavior. Existing uncertain outcomes must never cause automatic resends.

The [ADP1 contract](AGENT_MEMORY_ASSISTANT_DELIVERY_PROTOCOL.md) is independently approved for one unused pure protocol module. Implementation and protected independent fixtures have separate owners. Source acceptance, hosted checks and guarded release remain pending; no new persistence or runtime consumer is authorized by this contract.

The pure ADP1 implementation and independent fixture passed a first fixed 193-test run plus types, scoped lint, style and plan checks. Source/dependency hashes remained unchanged. No real provider traffic or runtime consumer was introduced. Independent final acceptance, hosted checks, merge and guarded deployment are tracked separately in current task-artifact reports.


## Durable assistant-delivery control — next cycle

PR125 merged as `5444cfb`, identical to independently accepted `359449e`. Original CI342 passed 8,209 tests, all post-coverage gates and 55 browser cases; indexed155 passed. The scoped build and guarded installation completed on 26 October at 18:30 UTC, with exact artifact verification, 18 routes and preserved configuration. ADP1 remains an unused protocol prerequisite. Later pet release `6c1577` is included in the new `803bfdd` baseline and must be preserved; these are dated source/release receipts, not permission to overwrite a newer installation.

The next slice defines and independently qualifies durable metadata control: finite retention and capacity, stable ingress identity, no-replay cutoffs before removal, current source/authority checks, result recording after revocation without content restoration, and compatible installed readers. Synthetic qualification must precede any runtime producer or transport activation. Existing private-history restrictions, received-user archive scope and unknown-send refusal remain authoritative.

Fresh reconciliation at 21:36 UTC confirmed live `6c1577e39df37b62eea47d163fbf9c16a87b5b6e`, build `5slDUJoLKa25wVDqsvXQj`, with unchanged configuration, archive availability 1 and snapshot publication absent. Deployed-source CI346 passed 8,680 tests and 55 browser cases; indexed159 passed. The documentation-only `803bfdd` main CI347 was cancelled; indexed160 passed. The next candidate still requires its own fresh hosted checks. A first public Python HTTP request failed without a captured status; a separately authorized curl diagnostic returned healthy HTTP200 and the exact revision. Both observations are retained.

The [ARC1 runtime-control contract](AGENT_MEMORY_ASSISTANT_RUNTIME_CONTROL.md) is independently approved. It uses the actual original FILE store, bounded metadata and monotonic replay barriers, selected-space export/erasure/sweep, and a permanent content-free format marker before the first control account write. The marker closes a prior-scanner gap discovered in review. Implementation and independent fixtures have separate owners; no live ingress or dispatch producer is wired in this slice.

ARC1 implementation now has a passing 227-case focused replay after independent fixture and source findings. The real source fix removes JSON property-order dependence while preserving all immutable authority/identity comparisons. Original setup failures, the subsequent six source failures and two assertion issues are retained in the external qualification packet. Node compatibility passed 147 cases. No production producer, message or configuration change follows from these source results. Required hosted CI and guarded release remain separate gates.

PR128 initial hosted CI349 held promotion:8,708 passed/16 existing channel-draft failures exposed a null-post-image assumption in shared FILE storage. No merge or deployment occurred. The bounded compatibility repair must preserve draft tombstones and ARC safety controls; independent regression and a fresh exact-source hosted run are required. Failure evidence is retained externally.

The core guard now distinguishes absent ARC fields from corrupt present fields and preserves generic FILE null tombstones. Independent added regressions and the unchanged Circles suite passed in a286-case focused run, with types/lint/plan/diff passing and29 frozen path hashes unchanged. Prior hosted failure is retained; fresh hosted qualification remains required.

PR128 ARC1 merged as ca41f084 after independent acceptance and CI350 (8,729 tests, 55 browser cases), but the guarded installer refused before copy/switch because the unchanged pet scanner excludes deployed play/growth directories. Production 6c1577 and configuration are preserved; no record payloads were exposed, private history inspected or data deleted. A narrow strict admission repair is approved under PET_STORAGE_ADMISSION_CONTRACT.md, with separate capabilities, actual writer-format/old-reader qualification and a new scoped PR before another guarded install.

The pet admission helper is implemented without writer or ARC runtime changes. Independent qualification passed 93 actual-writer/regression Vitest cases and 109 Node admission cases. Three initial Node setup defects were retained, corrected only by QA and requalified in a three-case replay; all 50 frozen inputs matched. Types, lint, plan and diff checks passed. Exact independent acceptance, fresh hosted gates and a new guarded artifact remain required.

PR129 merged as c42d65f and the new guarded artifact was installed on 27 October 2026: build eIHXecNQgeJiPurRMo-Fm, full artifact SHA256 aabf9ee6caeaaefc460fe33f984386f5b34922c18a0043a328859ffd61eee864. All 3,577 payload files, 18 local/public routes and 43 synthetic installed-reader cases passed; configuration and authority data were preserved. PR CI352 passed 8,732 tests and 55 browser cases. Later main CI355 failed one unchanged Circles export assertion because the digits300 occurred inside a random opaque agent ID; independent analysis found no exposed author identity. The failure is retained and a deterministic test-only oracle repair is in progress. ARC1 remains unwired from live replies/history; this does not complete full recall or enable capture.
