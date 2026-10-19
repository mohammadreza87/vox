# Independent relationship implementation review

Reviewed 2026-10-19 in `/Users/reza/.codex/worktrees/vox-relationship-loop/vox` against baseline `68a1cd3d696ed621a6e6319f4122836b4e5f8065`. The candidate is an uncommitted working tree, including newly added files. Reviewer: independent Codex subagent, `gpt-6.1-sol`, high reasoning effort, started with a fresh context as authorized in the implementation request. This is a source and local behavioral review, not a deployment certificate.

## Conclusion

Three actionable control/privacy defects were reported to the delivery lead during review. The lead remediated them in this same working tree. The reviewer independently reproduced the strongest concurrency defect before remediation and reran its regression afterward. No additional reproducible cross-audience disclosure, unauthorized retry, or worker-authentication defect was found in the reviewed paths. This conclusion applies to the current candidate and bounded checks below; production activation remains subject to the separate operational gates.

## Findings and disposition

### P1 — A completed stop could be ignored after the durable send fence

Original trigger: a due job commits its `sending` state; before that store update returns to `drain`, the user's `stop` control commits. The original `applyControl` cancelled only pending/evaluating jobs, and Studio's transport authorization omitted current disabled/pause/revision checks. The worker then invoked Telegram even though `disabled` was already true. This is before a transport call begins, beyond the unavoidable race after Telegram has accepted a request.

Independent reproduction: `src/lib/studio/__tests__/independent-review-reproduction.test.ts` interleaves a real `loop.control(key, 'stop')` after the sending transaction has committed and before it returns. On the original implementation the test confirmed `disabled === true`, `sent === 1`, and one fake Telegram call. The regression now asserts zero sends and independently passes.

Disposition: remediated. `RelationshipLoop.mayDeliver` reloads current mode, intention ownership/status, lease, state revision and policy; the loop checks after fencing, and `Studio.drainRelationships` checks again immediately before transport. Relevant current paths: `src/lib/relationships/loop.ts` (`mayDeliver` and the post-fence check), `src/lib/studio/service.ts` (`send` callback). A stop after the last check/network submission remains a platform boundary, not a claim of transactional delivery.

### P1 — Voice-channel forget-all left source memories and retained history usable

Original trigger: say “Forget everything about me.” in a MiniApp ordinary/live voice turn or Telegram voice note. Typed Telegram routed this recognized control through `/forgetall`, but the other channels reached only `observeRelationship`/`applyControl('forget')`, which cleared working relationship data while leaving the independent long-term memories and chat history retrievable. A subsequent response could reuse the supposedly forgotten fact.

Disposition: remediated by a common `PersonaGateway.forgetOwnedContext` path used by typed/transcribed Telegram and ordinary/live call turns. It fences epochs before source deletion, deletes only this source owner's memory chains, purges derived histories/relationship state again after deletion, and returns a deterministic receipt without a generation call. The added three-channel regressions were independently executed; they check retained canary removal, preservation of another person's source record, empty history, and rejection of pre-forget epoch writes.

### P2 — Common polite requests did not durably stop old intentions

Original trigger: an existing pending follow-up is followed by “Please stop checking in.” or “Please don't send me any more check-ins.” The narrow parser returned null. The old assessment schema could not persist a global control; avoiding a new intention did not cancel the old one. Relying on Decisions to notice a request in a bounded recent-history window does not preserve a stop durably.

Disposition: remediated for these common forms by anchored polite-prefix/suffix handling and additional explicit stop forms, plus a validated assessor control restricted to stop/pause. A model cannot issue resume. Assessor prompt separates the current user's direct global contact boundary from quoted requests and a single topic closure. Existing deterministic command controls remain available. Natural-language intent breadth remains a model-quality evaluation concern; finite parser fixtures do not prove every paraphrase.

## Review coverage

Read the relationship skill, role contract, delivery plan, operations contract and core README. Reviewed tracked diffs and untracked implementation across:

- Private/group audience snapshots, unknown/guest fail-closed behavior, history filtering, source attribution, correction chains and exact-recipient sharing/revocation CAS.
- Memory/history epoch fencing and shared in-memory, file and Firestore adapters.
- Relationship ingestion/deduplication, revisions, source tombstones, expiry, controls, quiet hours, leases, terminal redaction, uncertain-delivery restraint and per-operation/drain deadlines.
- Decisions request/response validation and content bounds; content-free observer projections and aggregate admin response.
- Studio authorization, worker authentication before runtime startup, runtime allowlists/default-off mode, deployment environment packaging and user controls.
- UI state/request wiring and the test/simulation surfaces used as acceptance evidence.

No implementation source was edited by the reviewer. The reviewer added the isolated concurrency reproduction/regression and this report; the delivery lead owns remediation.

## Independently executed checks

1. `npm run test:relationships`: 75 passed, 9 opt-in emulator tests skipped at that point in the review. These results preceded the final added control regressions.
2. Original isolated send-fence reproduction: 1 passed while asserting the defective result (one send after a completed stop).
3. Remediated isolated send-fence regression: 1 passed while asserting zero sends.
4. `npx vitest run src/lib/tireh/__tests__/gateway.test.ts src/lib/studio/__tests__/relationships.test.ts src/lib/relationships/__tests__/loop.test.ts src/lib/studio/__tests__/independent-review-reproduction.test.ts`: 85 passed, including the added channel-forget and control tests in the candidate available at execution.

The delivery lead should record the final aggregate test/build/lint/emulator/browser results after all concurrent edits settle. Counts from different candidate moments are not interchangeable.

## Evidence limits and next release gate

The browser scenario in `e2e/relationships.spec.ts` fulfills `/api/studio/**` from fixtures. It validates rendered states, interactions, request bodies and layout on configured browsers; it does not exercise authenticated Studio backend/storage authorization through the browser. The synthetic gateway session uses actual gateway/loop code with fake Telegram, and its reconsideration callback bypasses Studio's production transport authorization. That is useful conversational/component evidence, separate from the Studio integration tests and the real scheduler route.

The reviewer did not independently run a real Firestore emulator, make provider calls, install a scheduler, inspect deployed rules/TTL/indexes, or send to an actual recipient. Reported emulator/provider results from other workers are not relabeled as reviewer execution. Source tests do not establish long-term relevance or wellbeing, and no finite synthetic conversation set establishes universal natural-language boundary detection.

Before live activation, qualify one exact committed/deployed revision with current Firestore rules/TTL/index behavior, authenticated bounded scheduler invocation, real Decisions access and failure behavior, and an explicitly authorized internal recipient. Demonstrate current-context delivery or silence, stop/pause/revoke/access removal, overlapping workers and restart/unknown-delivery behavior. Keep mode off until that rollout gate is fulfilled. No synthetic-user task authorizes messages to real people.
