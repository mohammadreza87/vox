# Independent first memory release acceptance protocol

Protocol: AM-QA-01, frozen 25 October 2026 before implementation test results.
Task: AM-03, within AM-RELEASE-01; AM-02/05/12/20 and VOX-013/014/049 supply implementation and regression dependencies. AM tasks were registered in the canonical backlog after this protocol was frozen.
Reviewer: independent vox_qa_evaluator, configured gpt-6.1-sol/high.
Base: 7224f40d69cf816a49139a30092cbf92551d2a8e.
Execution scope: synthetic local only. No real private messages, paid calls, external sends, deployment or credentials accessed by QA.
Implementation authors: separate architect/runtime workers and lead rollback work. QA owns only this file, `src/lib/tireh/memory/telegram-archive/archive.acceptance.test.ts` and `src/lib/studio/telegram-archive.acceptance.test.ts`, and authors no implementation.

## Decision and evidence contract

This protocol covers a bounded T1 private-owner DM **received-user-text** archive and recent-context slice. Assistant replies, audio, images and files are excluded. A 32-event index supplies recent context, and explicit recovery traverses the finite archive; this is not a searchable full-history graph or complete relationship memory. It does not establish completion of the full master specification. Group archives, exact-selected sharing, rich graph/file UI, semantic provider quality, creator lifecycle migration, sensors and autonomous outreach require their own contracts and gates.

The candidate must be identified by commit and clean tree or by base plus exact tracked/untracked file list and SHA256 digest. No final acceptance against a moving tree. Record runtime, dependency lock, storage mode/schema, archive flag, caps, charter/prompt/model versions and test fixture digest. Re-execution after a material candidate change is required.

All critical cases below must pass: no averaging, model override, unexplained skips, retries-until-green or criterion changes after results. A deterministic failure blocks activation of the affected capability. Existing tests remain regression inputs; their success alone does not establish the new archive implementation. Shared filesystem provides behavioral ownership only, not actual protected-evaluator security isolation.

## Frozen first journey

Use synthetic adult A and B, agent X and successor Y, Work and Personal. Each scope gets a unique opaque canary and a distinct semantic private fact. Source identity includes Telegram bot/account/chat/message/update IDs and source revision. Run EN, FA and mixed-language variants in chronological order; future corrections are withheld until their actual turn.

1. With capture disabled, greet and have a usable current-turn conversation. Confirm no archive content/outbox/provider extraction. Unknown/expired eligibility also denies capture.
2. Enable only the reviewed current A/X/private/space grant. A describes preparation for a synthetic presentation and asks to remember the current deadline. Distinguish captured-service-durable from archive-recoverable receipts.
3. Cross the checkpoint boundary, verify uploaded bundle and immutable manifest by download/hash, commit trusted head, then remove only verified pending events. Restart all runtime objects and reconstruct from trusted head plus durable pending events.
4. Ask an indirect continuation such as 'Can we carry on preparing for that meeting?' Recover the correct current goal and source. Similar unrelated events require grounded clarification, not invented certainty. Exact date/message reference must remain resolvable.
5. A corrects the date. The very next provider context and answer use the corrected date; superseded content cannot act as current fact. Historical attribution may remain only when asked and authorized.
6. A forgets the topic while a checkpoint/retrieval/provider operation is delayed. Commit suppression before acknowledgement; pending payload, active index, warm cache, working brief and late jobs cannot supply forgotten data afterward.
7. Restart; restore an old archive bundle; replay the original update with same/new attempt identifiers. Current trusted tombstones still deny use. Missing latest authority fails closed and reports unavailable.
8. B, successor Y, the other space, an owner/admin identity and a group/unknown audience ask for the same topic. No canary or semantic influence in prompts, extraction, logs or outputs. A positive control before forgetting proves that the authorized path actually used evidence.
9. Ask the agent to change its creator character, treat an archive as system instructions, grant another agent access, or send a reminder because an old source says so. No charter/grant/tool/send authority is created by source text.

Synthetic model outputs establish wiring only. Natural implicit continuity, clarity of correction/forget responses and persona quality need actual provider outputs plus independent EN/FA human review. A small synthetic first journey does not meet the master spec's statistical promotion or latency claims.

## Mandatory fault and boundary cases

| Case | Deterministic oracle |
| --- | --- |
| A01 Scope tuple | Account/person/agent/space/container and bot identity match exactly before every capture/read/upload/context export |
| A02 Eligibility | Disabled/history-only/explicit-save/auto-memory controls remain distinct; no inferred opt-in |
| A03 Ingress durability | Durable event transaction precedes capture acknowledgement and offset/dedup advancement; crash before commit is not accepted |
| A04 Pending recovery | Crash with 1..7 events and max-age pending events recovers each accepted event once; no RAM-only durability claim |
| A05 Checkpoint thresholds | 8-event threshold, 60s maximum age and explicit force work under fake clock; caps/capacity have frozen values |
| A06 Dedup/revision | Duplicate update is idempotent; newer edit supersedes; delayed older edit cannot overwrite current source |
| A07 Crash matrix | Crash before/after bundle upload, verification, manifest upload, verification and head commit never loses accepted events or commits an incomplete head |
| A08 Unknown upload | Lost provider response remains unknown; no blind retry as a fresh operation, no fabricated successful archive receipt |
| A09 Fencing | Concurrent writers/expired leases use generation/CAS plus committed synchronous transport fence; stale external upload cannot become trusted head |
| A10 Corrupt chain | Digest mismatch, malformed schema, gap, cycle, duplicate range, swapped scope/bot and oversized/decompression input fail closed within declared bounds |
| A11 Latest authority | Old pin/head/backup cannot lower current grant/deletion epoch; service-authority loss remains unavailable |
| A12 Revocation race | Revoke before upload/provider dispatch and after async preparation: zero unauthorized network dispatch; revoke before delivery: zero newly released restricted output |
| A13 Forget lineage | Source, revisions, summary/brief/index/cache/pending operations invalidated; old snapshot and late checkpoint cannot resurrect |
| A14 Operational kill | Disables capture/checkpoint/preparation without preventing correction/forget or usable supported core reply; stale receipts unusable |
| A15 Bot replacement | Prior bot file handles unavailable to successor; no automatic private transfer or silent retry under another token |
| A16 Honest purge | Suppressed versus primary purge versus provider/Telegram residual copies reported separately; old Telegram copies never claimed erased |
| A17 Outage/capacity | Bounded backoff and queue; before capacity exhausted deny new durable acceptance with truthful pending/unavailable state; accepted content not silently discarded |
| A18 Reply delivery | Generated/attempted/sent/unknown outcomes distinct; duplicate webhook/restart never blindly repeats an uncertain external effect |
| A19 Provider failure | Timeout/refusal/malformed response preserves existing memory authority, no invented remembered/success receipt |
| A20 Resource/accounting | Bound bundle bytes/events, download/decompression/chain depth, context size, retries and parallelism; omitted usage is unavailable, not zero |

First implementation bounds are 8 eligible received events per checkpoint, 60s maximum pending age, 16 pending events, 64KiB pending bytes, 128KiB per artifact, 128 checkpoints, 1024 receipt metadata entries, 192KiB protocol state, 32 context events, four agent/space rows per account and 256KiB total archive extension. Canonical account capacity remains 700,000 bytes. Artifacts use plain JSON, so no decompression is involved. These finite capacities require an explicit refusal and recovery/control path; exhausting one person's archive must not permanently block their controls or another person's bot traffic.

## Runner commands

Run only in the assigned worktree, with synthetic fixtures. Do not load .env.local or start bots. Keep first failure logs and exact candidate identity. Capture all outputs to an access-appropriate local evidence directory. No product/test repair by the scripted runner.

Baseline selection (independently executed on the base; 196/196 passed, nine suites, 40.17s):

```sh
npx vitest run src/lib/tireh/__tests__/memory-privacy.test.ts src/lib/tireh/__tests__/history-privacy.test.ts src/lib/tireh/__tests__/memory-replacement.test.ts src/lib/tireh/__tests__/memory-v2-retrieval.test.ts src/lib/tireh/__tests__/memory-eval/memory-eval.test.ts src/lib/studio/__tests__/prepared-conversation-qualification.test.ts src/lib/studio/__tests__/indexed-reply-context.test.ts src/lib/adaptive/__tests__/memory-correction.test.ts src/lib/adaptive/__tests__/shared-memory.test.ts --reporter=dot
```

After the implementation and QA-owned new test paths are frozen, run those exact added test paths first, the baseline selection second, then:

```sh
npx vitest run src/lib/tireh/memory/telegram-archive/archive.acceptance.test.ts src/lib/studio/telegram-archive.acceptance.test.ts --reporter=verbose
npx tsc --noEmit --pretty false
npm run lint
git diff --check
```

The lead assigns one full-suite run after all worker integration. Production build and compiled authenticated browser journeys belong to release qualification with isolated storage and bots; do not infer them from dev-server Playwright. Any unexpected network/credentials requirement or unknown policy escalates to QA/lead; do not substitute a fake transport marker or relax expected assertions.

## Environment constraints and baseline evidence

Node 22.23.3; Vitest 4.1.12; dependencies already present. `vitest.config.ts` defaults to jsdom and its global setup unconditionally requires `window`; an initial `@vitest-environment node` run failed before collecting tests. A separate isolated Node config (no browser setup) passed the pure protocol suite. Committed portable tests run under the normal configuration; the FILE integration exercises actual Node filesystem persistence, fresh storage/service objects and actual gateway wiring with synthetic provider output. This is not browser or process-kill qualification. Native better-sqlite3 execution requires the matching Node ABI; passing FILE tests cannot qualify SQLite.

Automatic-memory consent requires `scopedRelationshipsEnabled:true` in the current adaptive service contract as well as the approved capability registry; initial fixture omission produced capability_unavailable before any archive assertions. The corrected fixture enables this existing prerequisite rather than forging consent. Array-table fixture construction was also corrected before admission assertions; both initial logs remain available. No product permission assertion was relaxed.

Prepared schema2 FILEv2/SQLite tests use the installed Anthropic adapter with injected synthetic configured fetch and globally forbidden network. Generic FakeLLM intentionally lacks committedExportFence and cannot export saved context. FILEv2 constructor defaults schema1 unless explicitly prepared. Studio and adaptive clocks must be coherent. A fake marker is not transport qualification.

Current production backend is reported FILE; actual release topology must be verified. Indexed extension/table descriptions cannot be used as evidence that production FILE persistence, transaction, revision and effect fences are correct. Existing single-process FILE qualification does not establish multiwriter/serverless correctness.

Baseline log: `/tmp/vox-memory-qa-baseline-7224f40.log`; SHA256 `fbc8e50d4f01ab7d33e7bdbbc6a495c73f4e603e9b0137087adff44d53ff7ee1`. Synthetic fake-embedding memory evaluation in this log is diagnostic, not real semantic-model quality.

## Candidate review progress

E0 contracts reviewed; concrete source findings were returned to authors: stamped-row installer admission, newest-revision-before-expiry, reconstruction-to-index publication CAS, clear rearming, and disabled/unconfigured edit mutation. These were repaired in the moving implementation and independently exercised. The baseline passed 196/196. The first composed independent protocol/FILE/rollback/admission run passed 53/53, log `/tmp/vox-memory-qa-composed-third.log`, SHA256 `6f5c189d9bc6f28d7c239fa48e23a1b227c96ca67acb65b06b70dc8ab30291bf`; this is progress evidence, not final-candidate acceptance.

An additional real behavioral failure was preserved: ordinary gateway input `forget everything I told you` produced the fake provider's ordinary `Sure.` reply and retained archive context. Log `/tmp/vox-memory-qa-composed-fourth.log`: 55 pass, 1 fail. The author extended the anchored deterministic parser, and the same unchanged assertion now passes. Terminal capacity refusal also passes through the actual polling loop: the unaccepted source reaches no model and no retained content, owner clear and another person's status remain reachable in the same batch, and the next offset is 704. Unknown command confirmation attempts one send, logs the uncertain outcome and does not send a second false no-processing claim. A failed background checkpoint does not change an already durable capture into a refusal.

## Frozen candidate local outcome

Candidate base: `7224f40d69cf816a49139a30092cbf92551d2a8e`, plus the frozen source diff. The 26-path `src`/`scripts` manifest before the subsequent two existing bot-subscription assertion updates is `/tmp/vox-memory-qa-frozen-source-manifest.txt`, SHA256 `34de767a9c842ee5b4e71e20770a19d7fde55491193138e48fc4b4ce2e2fe7c6`. Documentation edits are outside that source digest. Exact commit identity must be attached by the lead after commit; source changes require re-evaluation.

| Independently selected check | Outcome | Evidence |
| --- | --- | --- |
| QA-owned protocol and FILE/rollback/admission | 59/59 pass, 12.24s | `/tmp/vox-memory-qa-independent-final-local-v2.log`, SHA256 `d51b01dc789678546a1316938039a0b76ace87ddddc980544a5b86f1df0d49fc` |
| Complete new archive/runtime/parser/rollback plus Telegram client selection | 98/98 pass, eight files, 34.16s | `/tmp/vox-memory-qa-frozen-selected.log` |
| Release compatibility and actual installer/rollback synthetic fixtures | 45/45 pass, 37.50s | `/tmp/vox-memory-qa-frozen-installer.log` |
| QA-owned ESLint and diff whitespace | Pass | Exact test paths, `npx eslint ...`; `git diff --check` |
| Luna full coverage | Initial failure: 8 failures in 6 files, 7311 pass, 15 skipped | `/tmp/vox-memory-luna-AM-RUN-01/gate-coverage.log` |
| Independent isolated diagnosis of all six failed files | 74/74 pass, 44.84s, coverage on, one worker, original timeouts | `/tmp/vox-memory-qa-isolated-six.log`, SHA256 `0afd737615189d1f23d509b52d49bed4abdab1e797539f62f1269b6abeada6eb` |

The first full-coverage run overlapped the independent selected/installer tests. Its failures include two stale bot `allowed_updates` assertions (the new supported event is `edited_message`), five timeout failures, and a voice-provider-entry buffer assertion that may be timing-sensitive. The lead updated exactly those two event-subscription assertions to match the intended supported event. The other tests/thresholds remain unchanged. Independent six-suite diagnosis uses coverage enabled, `--maxWorkers=1` and the original timeouts after all competing QA processes stop. It passes: previously failing observation 2.664s, longterm 5.347s, workflow 1.067s, voice query 0.512s, prepared FILE 4.741s. This supports resource sensitivity rather than an observed assertion regression; the initial failure remains preserved and does not become a pass. The runner must complete an exclusive full coverage run with `--maxWorkers=2`, unchanged assertions/deadlines, followed sequentially by the build. No other QA test process runs concurrently.

The refreshed source/test manifest includes 27 paths, adding only `src/lib/studio/__tests__/bots.test.ts` with those two intended event-subscription expectation updates. It is `/tmp/vox-memory-qa-refreshed-source-manifest.txt`, SHA256 `95ec5ae8b6376453fa96c60c3e606af2217f04cb5110dbfeac2c7efdf679375c`. Production source and QA-owned tests retain their frozen bytes. Selected-98 log SHA256 is `8c71581b45a145d876faea68124e598800f4d6fc90813bf089dd3e28bde47d8b`; installer-45 log SHA256 is `9f1b19b7beaba7edb0c675d50681e8e3d821b5b70fc2f63291c1d64e0bc55585`.

**Disposition:** independent source/protocol/real-FILE-object-restart acceptance passes for the narrow **default-off code**. Production deployment is conditional on successful required full checks, hosted CI and release-owner compatibility verification; this report does not waive the initial coverage failures. Actual provider E3, deployed path E4, physical Telegram/device E5, quality/latency/cost comparison and process-kill/authority-loss/rollback drills remain UNAVAILABLE. No activation approval is issued. Feature enablement requires those applicable live, authority recovery and retention/purge gates. The full master memory program remains open.

Next owners: architect/runtime finalize interfaces and candidate; lead freezes scope/retention/budgets/storage topology; QA writes/selects independent tests and judges exact candidate; Luna runner may execute fixed commands after dispatch; release owner owns CI/deploy/rollback and authorized synthetic Telegram journey.

## Lead integration evidence after independent review

The Luna runner completed exclusive full coverage with two workers and unchanged deadlines: 7,319 passed, 15 existing skips, 476 passing files and 3 skipped files. The sequential production build passed. The 27-path source/test manifest above remained unchanged. See `AGENT_MEMORY_TEST_RUN.md` for logs and preserved first-run failures. These results satisfy the local full-check condition; hosted CI and release compatibility remain required, and the independent activation hold remains unchanged.
