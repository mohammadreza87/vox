# Selective Telegram source suppression — AM-05 / AM-12

26 October 2026. Next bounded increment after combined foundation `9954c03`. This record describes the scoped contract and will carry acceptance evidence; it does not activate capture or complete the broader memory roadmap.

## User-visible outcome

Editing a previously accepted private Telegram message should remove that source from agent use without clearing unrelated accepted messages. The edited replacement is not captured in this increment. An edit with no trusted source lineage, or one whose suppression metadata cannot fit the existing state limits, retains the conservative whole-archive reset. General memory corrections and forgetting also retain their existing whole-scope barriers.

## Contract

- Match only the current agent/account/Work scope and an accepted logical source ID in the canonical receipt ledger.
- Mark matching receipts suppressed, remove that source's pending text and recent context, and advance the current authority generation. Preserve unrelated accepted sources, receipts and the trusted archive head.
- Treat suppression as durable authority, not as a rebuildable index. Apply it to capture, context and recovery, including old Telegram bundles and replayed original events. A repeated edit is idempotent.
- Keep the existing maximum of 1,024 receipts. No separate unbounded tombstone collection, automatic eviction, retention extension or schema migration is introduced.
- A prepared operation with no external effect may be abandoned. Any operation that reached an upload stage remains uncertain and blocks automatic retry; the existing explicit duplicate-copy confirmation is required before another upload. External copies may remain.
- An explicit source-suppression version and release capability fence prevent an older reader from ignoring the new authority record, including when capture is disabled. Inconsistent persisted markers fail closed.
- Known-source lineage does not establish fact-to-source mapping for arbitrary corrections. Preserve broad reset behavior where lineage is unavailable.

## Independent acceptance

The evaluator owns adversarial fixtures for target removal with unrelated-source preservation, restart, verified-head recovery, replay, duplicate edits, pending/in-flight operations, unknown-delivery retention, cross-person/agent/space isolation, permissions, expiry, full resets, invalid persisted versions and old-reader rollback rejection. Use synthetic FILE state and mocked Telegram only. Do not repeat the completed external provider test.

Measures for this deterministic slice: zero suppressed-source uses after commit; zero removal of unrelated accepted sources on a known-source edit within capacity; explicit conservative reset at capacity; zero automatic retries of an uncertain upload; unchanged scope and queue bounds. These fixture outcomes are not conversational quality, p95 latency or operating-cost measurements.

## Release boundary and next sprint

Capture remains disabled. Promotion requires exact-candidate independent acceptance, scoped regression/type/style checks, hosted CI and indexed qualification, a clean merged artifact, fresh installed-revision guards and post-install verification. Preserve current grants, tombstones and configuration. Production incoming-persona, physical-device, retention and crash/authority-disaster-recovery qualification remain open.

After this prerequisite, specify snapshot compaction with an authority-preserving reconstruction protocol, then assistant-delivery provenance that distinguishes generated, sent, failed and unknown outcomes. Graph, retrieval and predictive preparation follow measured source completeness and recovery quality.

## Evidence status

PR [115](https://github.com/mohammadreza87/vox/pull/115) merged as `6b410cd` after independent local acceptance (24 new cases, 48 affected regression cases, 81 installer/compatibility cases), hosted CI 321 (7,357 tests passed, 15 existing skips, build/browser checks passed) and indexed qualification. Initial timeout/cleanup and fixture failures remain in the external reports; isolated replays used unchanged deadlines. The merged tree matched accepted `fddbc82`.

Its build passed, but installation was held: production had advanced to `6df838f5` on `release/screens-and-trust`, with authentication and UI fixes absent from main. PR [116](https://github.com/mohammadreza87/vox/pull/116) combines those exact live fixes with the memory change. No unrelated live work is removed.

Integration review found a durability gap in the existing edited-message path: a canonical suppression write failure could escape as an ordinary error and allow polling to acknowledge the edit. The combined candidate must classify such failures as pending and independently prove failed-write/retry/offset behavior. Earlier acceptance establishes its tested cases and does not override this new blocker. Combined acceptance, hosted CI and guarded installation remain pending at this source checkpoint. External LINEAGE_INTEGRATION_ACCEPTANCE.md and LINEAGE_RELEASE.md under the production task-artifact directory carry later results.
