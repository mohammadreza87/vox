# Independent 90-day learning and memory simulation

Task: independent long-term user simulation for the observation/lifecycle release. Disposition: **PASS for the two bounded local journeys below**. This is independent evaluation of runtime code written by other authors; the evaluator authored the new simulation fixtures and assertions. It is not protected promotion acceptance or production release approval.

## Candidate and execution

- Base: `9fb73d311753a461bd62e37ce3129b8a60c83d00`, branch `codex/vox-observation-improvement`, with the concurrently authored uncommitted observation/lifecycle candidate. HEAD alone does not identify the tested candidate.
- Owned files: `src/lib/adaptive/lifecycle/longterm-simulation.test.ts` and this report. No core implementation changes.
- Runtime: Node `v22.23.3`, Vitest `4.1.12`, repository default jsdom configuration; real temporary filesystem adapters, injected wall clock, scripted assessor/decision callbacks. No Firestore emulator, HTTP server or database service is exercised.
- Command: `npx vitest run src/lib/adaptive/lifecycle/longterm-simulation.test.ts`.
- Observed result on 19 October 2026: **1 file, 2 tests passed**, test time **13.64 s**, total **14.35 s**. This measures harness execution, not conversation latency or product performance.
- `npx eslint src/lib/adaptive/lifecycle/longterm-simulation.test.ts` and `npx tsc --noEmit --pretty false`: exit 0. `git diff --check` for the owned test path: exit 0.
- Test SHA-256: `9cb8a5c6c7c1cefd99013f4fcb943d63431e7e53193ec179363c66062b910c04`.
- Relevant runtime/test snapshot SHA-256: `98250f0a729327dfa5eaba451218aa2f89da76dea3378551b31e8df1cfce2528`, 89 TypeScript files. Computed from the sorted relative paths under `src/lib/adaptive` and `src/lib/relationships`, hashing the UTF-8 manifest `sha256(file) + "  " + path + "\n"`. This is a local snapshot captured with the run; the parent release owner must freeze the complete final candidate and rerun after further edits.

All account IDs, people, strings and approval declarations are synthetic. Each test creates a new `vox-independent-90d-*` directory under the operating system temp directory and removes it in cleanup. No existing account data, provider credentials, live messages, paid calls or network integrations are used. The synthetic manifest establishes fixture eligibility only; it is not legal or provider approval.

## People and intended behavior

The actor narratives were set independently before writing the API assertions. They describe goals and choices, rather than three copies of one happy path.

| Actor | Goal and behavior | Languages and choices |
| --- | --- | --- |
| Jonah | Coordinate a launch, publish reviewed decisions, withdraw analytics later, request an export | English; Work personalization/analytics on initially; Personal analytics remains off |
| Mina | Keep personal design notes private, consume selected project notes, require listening before advice, choose when future conversations start | Persian and English/Persian mixed turns; analytics explicitly declined in both spaces |
| Leila | Work on a temporary contract, leave the project group, retain a separate personal journal | Persian and mixed English/Persian; Personal analytics on, Work analytics off |

There are **three fictional actors and two scenario tests**, not a claim of dozens of users based on assertion count. The first scenario visits every day slot from day 1 through day 90, with active transitions on days 1, 2, 3, 14, 21, 45, 60 and 90. Inactive days run maintenance without auto-confirming identity. Day 90 is 89 elapsed 24-hour periods after day 1. The second scenario follows Mina's relationship boundary on days 1, 2, 7, 14, 15, 31 and 90. This is a deterministic scenario, not 90 real days of usage.

## Observed coverage

| Journey / boundary | Result and evidence |
| --- | --- |
| Purpose and space choices | PASS. Jonah's Work and Leila's Personal events are accepted; Mina's declined spaces, Leila's Work and Jonah's Personal reject analytics. Personal analytics remains separate from Work. Day 60 confirmation/restart does not reenrol Jonah after withdrawal. |
| Actual file persistence and pending processing | PASS. New AdaptiveRepository/FileAdaptiveStorage and SharedMemoryRepository instances load saved data. Day 1 queues process after replacement service instances. |
| Crashed consumer lease | PASS. A worker pauses after claim; a fresh service reclaims the expired lease; exactly one processed event is projected; the old worker's eventual result is discarded. This models a crash/restart via replacement objects and an expired durable lease, not an operating-system process kill. |
| Observation versus cause | PASS. Interruption findings contain `inferredCause: null` and `observation_only`. Verified success, provider usage and completeness remain unavailable/false. Private facts and authored shared note text are absent from the observed journal summary. |
| Identity expiry and reconfirmation | PASS. Expired core confirmation blocks export and analytics authorization. A fresh confirmation permits new events; a receipt from the earlier confirmation cannot be replayed. |
| Selected recipients and group publication | PASS. A published selected note reaches Mina but not Leila. A published group note reaches the exact three-member group context; the selected note and all private canaries are excluded from that group context. Work containers do not appear in Personal lists. |
| Group departure and return | PASS. Removing Leila marks prior group history unavailable for every old recipient. An outdated three-person audience is denied. Restoring the membership set does not resurrect prior group memory. |
| Revocation, authored contribution erasure and stale writes | PASS. Mina contributes to a selected container; Jonah revokes her access; her authored payload disappears from shared files. Her stale write is denied. Deletion of the remaining shared note survives historical create replay after service replacement. |
| Withdrawal during consumption | PASS. Jonah withdraws Work analytics while a queued failure is leased. The old worker commits no result. Restarted snapshots and export contain no observer events; stale event replay fails. Leila's separately consented Personal event still records and processes. |
| Day 90 scoped export | PASS. Export includes Jonah's recent own Work note, excludes his Personal note and another person's private Work note, excludes deleted/revoked shared contributions and reports provider/backup coverage as unavailable. |
| Retention during inactivity | PASS. Daily account/shared sweeps run through day 90; old observation evidence is absent at the final check. No assertion treats missing/expired evidence as a successful task or zero failures. |
| Mood uncertainty and silence | PASS within the scripted contract. The assessor proposes an open situation with explicitly unknown current mood and a directly requested listening preference. Later silence creates no assessor calls or messages. No actual model inference or affect detection was measured. |
| Topic refusal and global contact boundary | PASS. Mina closes the meeting topic before its follow-up is due; restart/drain sends nothing. A later natural-language request to initiate all future conversations herself yields a scripted stop through `applyScopedControl`, persisting both account authority and core control. Renewal of the 30-day relationship binding cannot accept a new stopped source. |
| Source expiry and renewal | PASS. Old relationship source authority fails after the 30-day binding expires. Explicit reconsent creates a different binding; the global stop still applies. Day 90 export has no check-ins. |

The relationship path uses the actual `RelationshipLoop`, `FileRelationshipStore`, `AdaptiveRelationshipService` and current authorization checks. Assessor outputs are fixed for the exact synthetic utterances, and decision output is scripted to request send; the absence of sends therefore depends on lifecycle/refusal gates, not a universal `stay_quiet` fake. Shared context assertions exercise actual service projections. No generated assistant answer or provider prompt is inspected in this suite.

## Failures and harness corrections

1. The first run used a per-file Node environment. The repository's global setup accesses `window`, so collection failed before any test executed. A temporary Node-only config then ran both journeys. The delivered test uses the repository's normal configuration so ordinary full-suite discovery includes it. The final recorded command above passes. This is E1 evidence, not E2 server/database qualification.
2. The first relationship attempt sent the exact Persian stop directly to `RelationshipLoop.observeTurn` and expected the account authority ledger to change. The loop's explicit-command fast path only updates its own core state; the product's `PersonaGateway.observeRelationship` separately persists explicit commands to account authority before looping scoped keys. That test expectation bypassed required caller wiring. It was corrected to assess a natural refusal through the real scoped callback. This was a harness mistake, not a reproduced production defect. Direct gateway explicit-stop coverage is outside this test and must be supplied by the existing gateway/Studio integration suites.

**No unresolved product failure was reproduced in these two final journeys.** This statement applies only to the frozen synthetic actions and assertions described here.

## Limits and remaining gates

- Evidence level: **E1 deterministic local behavior with file-backed storage**. No CI, deployed revision, production rules, paid LLM/STT/TTS, actual voice, notification receipt or physical device was validated.
- These scripted actors do not establish human naturalness, empathy, intent extraction accuracy, multilingual generation quality, longitudinal satisfaction or improvement effectiveness. There is no baseline/candidate quality, latency or cost comparison. Paid usage and cost: unavailable; no paid calls were made.
- No end-to-end Studio/browser flow, real Telegram delivery, group guest arrival, external membership race during export, observer multi-event batch race, source prompt injection, notification transport uncertainty or restored-backup drill is claimed here. Other independently selected suites must own those gates.
- Runtime implementation and tests share local filesystem/credentials; protected evaluator dataset isolation and separate release authority are unavailable in this harness.
- Next owner: parent release/QA owner freezes the full final diff, reruns this command with the selected broader suites, reconciles other reviewers' findings, and records target-specific release gates separately.
