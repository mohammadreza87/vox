# Role contracts

Assign one concrete task, bounded file ownership, required inputs, and acceptance evidence. These are skill profiles, not permanently running model processes.

## Loop engineer — Sol

Own `src/lib/relationships/{loop,policy,store,file-store,firestore-store,types}.ts` and behavioral tests. Skills: event state machines, transactions, leases, idempotence, revision fences, retention, timezone scheduling, uncertain delivery. Read the core README before changing contracts. Test duplicate/out-of-order input, overlapping workers, stale context after revoke, restart after claim, timeout after possible send, and one unanswered outreach. A passing send path alone is insufficient.

## Context engineer — Sol

Own memory extraction, visibility, retrieval, source attribution, and history epochs in `src/lib/tireh`. Skills: information-flow analysis, temporal facts, exact-recipient grants, compare-and-swap, safe prompt construction. Test with distinct private canaries in actual model-input capture. Include newly joined members, unknown guests, private corrections to previously shared facts, revoked offers, and in-flight generation during forget. Do not widen a source audience when summarizing or deriving facts.

## Observation and decision engineer — Sol for contracts; Luna for fixtures

Own Decisions adapter and typed observer. Skills: bounded classification, timeout/refusal handling, calibration, data minimization, event provenance, evaluation design. Observe accepted input, assessment result, intention lifecycle, decision, policy suppression, delivery outcome and user correction through typed events. Log model/policy/revision identity, never raw conversation or provider bodies. Test unknown/refused/malformed results and observational failure without breaking the conversation. A model confidence value is not empirical calibration. Version policies and evaluate human-rated relevance against a no-outreach baseline before tuning thresholds.

## Full-stack and product designer — Sol integration; Luna isolated UI

Own Studio services/routes, gateway integration and controls by explicit subtask. Skills: authorization, channel identity, accessible React, mobile layout, useful loading/empty/error states. Preserve stable agent character and minimize configuration burden. Pause/stop must leave normal conversation usable; source owners must be able to inspect, share, revoke and forget their own data. Verify API enforcement independently of hidden UI controls. Browser tests should cover keyboard and mobile use, actual visible states, and privacy of operations views.

## QA and synthetic users — Luna routine; Sol multi-person/adversarial

Own evaluation harnesses and reports. Skills: virtual time, failure injection, real storage contracts, browser automation, behavior-based assertions. A user actor reads each actual response and chooses the next message from a coherent life situation; it does not copy a fixed script and call that independent roleplay. Keep identities and private facts separate, advance virtual time, allow silence, and cover resolution/correction/stop as well as successful follow-up. Record provider models, transport type, assertions, failures and transcript location. Report language and naturalness judgments as qualitative findings, not population-level results.

## Independent reviewer — Sol

Read the diff and invoke relevant tests without assuming the implementation author's conclusions. Prioritize cross-user disclosures, unauthorized/stale sends, loss of explicit controls, unbounded work, misleading evidence, and deployment mismatches. Give a reproducible trigger and severity for each finding. Findings should be resolved or explicitly remain release-blocking; do not silently downgrade them because the implementation is large.

## Delivery and operations lead — Sol

Own dependency sequencing and integration. Skills: repository hygiene, config packaging, controlled rollout, incident recovery, evidence reporting. Keep one reviewable candidate, preserve authored work, and run required checks on that candidate. Mode off is the default; pilot allowlists and current authorization govern live use. Verify scheduler authentication, Firestore rules/TTL/index behavior, provider access and real channel delivery independently. Roll back through the mode switch and deployed configuration; never manually retry an unknown send without investigation.
