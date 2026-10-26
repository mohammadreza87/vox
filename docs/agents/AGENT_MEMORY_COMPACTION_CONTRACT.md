# Snapshot compaction prerequisite — AM-05 / AM-12

26 October 2026. This slice defines and qualifies a pure snapshot planner, codec and verifier. It does not publish a snapshot, change a trusted head, extend the archive horizon, increase retention, send a file or activate capture. Runtime publication remains a separate dependency.

## Why this comes first

Recovery currently walks up to 128 manifest/bundle pairs. A compact snapshot could reduce reconstruction work, but only if it preserves source provenance and current deletion authority. `recover()` returns filtered latest events, so its output is not sufficient evidence of complete source coverage. Admission receipt fingerprints also intentionally omit received/expiry timestamps for retry semantics. An arbitrary event list cannot prove original retention.

The planner therefore consumes the exact canonical archive state and current authority plus bounded raw files rooted at that state's trusted head. It verifies the existing manifest/bundle chain and includes only canonical pending events. Every unsuppressed receipt must resolve to its matching verified source. A currently suppressed receipt may have no payload because suppression can remove pending text before publication; its receipt and authority remain present.

## Contract and boundaries

- Validate account/person/agent/space/container, bot identity, canonical state and authority, source chain order, content hashes, event IDs, logical IDs, versions and receipt fingerprints.
- Preserve every receipt, including suppression markers. Classify sources as active, suppressed, expired or superseded without retaining excluded text. Retain original timestamps and expiry where source evidence exists; never infer or extend expiry from a fingerprint.
- Refuse any outstanding operation. Planning cannot cancel prepared work, forget uncertain sends, reclaim capacity or reconcile provider effects.
- Use deterministic bounded serialization. Existing limits remain: 128 checkpoints, 1,024 receipts, 192 KiB canonical archive state, 128 KiB per file. The contract accepts at most 256 raw files / 32 MiB and produces at most 128 chunks of at most 128 KiB each, plus a bounded manifest. Oversize or missing coverage fails instead of dropping sources.
- Bind the planned manifest to the exact source head/state and authority watermark. Verification receives an independently trusted expected manifest digest and the caller's current state/authority/time; it checks all parts before returning any usable events.
- The functions perform no I/O and mutate no caller state. The caller must establish genuinely current committed authority and trusted file provenance. Passing a stale object to a pure function cannot prove freshness. Any later use or publication must recheck authority atomically.
- Snapshot planning does not make external Telegram copies disappear. Suppression remains an agent-use barrier, and all current scope/retention limits continue to apply.

## Independent qualification

Use only synthetic fixtures. Cover exact provenance and complete receipt accounting; missing/extra/duplicate/conflicting source files; hash corruption; wrong scope/bot; source revisions and original expiry; missing suppressed payload; tampered snapshot chunks/manifest; changed authority/state; all operation stages; limits at and beyond every bound; input immutability; and deterministic output. No partial event result may escape failed verification.

Record actual fixture counts, raw/planned bytes, chunk counts and local planning/verification duration. Pure execution makes zero provider requests. These measurements are not network reconstruction latency, p95 conversation performance, provider cost, legal retention approval or runtime compaction qualification.

## Runtime publication follow-up

A later reviewed increment must obtain current files under authority, reserve durable bounded operation state, stage and verify every file, retain uncertain upload receipts across crashes, and atomically publish the new trusted head only under unchanged state and authority. The old head remains authoritative until that commit. Test crashes before/after each external effect and commit, lost responses, edits/expiry during work, concurrent writers, missing artifacts, stale snapshots and downgrade-reader fencing. No old backup may overwrite newer suppression or grants. Snapshot publication cannot simply erase the 1,024-receipt or monotonic 128-checkpoint limit; horizon growth needs its own reviewed capacity and authority contract.

## Baseline and release qualification

The prior lineage release `5b360b9` is installed with capture off; its previously pending main CI 325 passed. New main `cd87918` changes dependency versions only. Its CI failed a Stripe API typing mismatch and three motion test assertions, so those failures must be resolved before promoting any new main-based artifact. Preserve the existing Stripe wire API version and real UI behavior; do not weaken evaluator thresholds. Zod is now 4.6.7 and remains patched. Storybook is 10.6.3; current audit evidence reports eight moderate transitive findings and one high developer-tool finding, with no critical finding in that run. This is not a clean audit.

The implemented planner/verifier passed 17 author cases. The independently selected fixed run passed 223 tests across eight suites, including source accounting, the exact 32 MiB input bound and 128 output chunks, plus archive and compatibility regressions. TypeScript, changed-file lint, Studio style and 228 plan links passed; TOML parsing was unavailable under host Python 3.9 (agent definitions unchanged). A synthetic 1,024-receipt / 128-checkpoint run used 245,410 source bytes, four chunks and 404,692 output bytes, with zero provider requests; one local sample measured planning at 367.25 ms and verification at 9.04 ms. These are single-run synthetic measurements. The first compatibility run stopped on temporary ENOSPC and its failure is retained. Required hosted CI, merge and guarded release remain separate gates; exact later results belong in the production task-artifact reports and release receipt. AM-05/AM-12 remain in progress; assistant-delivery provenance and the graph/routing/prediction roadmap are not completed by this prerequisite.
