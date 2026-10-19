# First foundation delivery — local acceptance

Historical checkpoint. The later integrated implementation and current limits are recorded in [DELIVERY_RESULT.md](DELIVERY_RESULT.md).

19 October 2026. Branch `codex/adaptive-foundation`, base/HEAD `ebb75a67c79bf317d1dec40381b216c75bb90ffa`, uncommitted candidate. The tested 20-file source manifest has SHA-256 `9373a04da5b1dc27fce75964b241a7792a5debb0304e1d6f7c9a13b6c0013cef`; exact paths, hashing method and raw command receipts are in [the final runner evidence](evidence/foundation-runner/FINAL_RESULT.md). HEAD alone does not identify the local candidate.

## Implemented and reviewed

The new [adaptive module](../../src/lib/adaptive/index.ts) implements versioned identity, space, container, person/agent grant, consent-transition and capability-eligibility contracts. Known recipients must have independent current rights; voice/model hints confer no authority; account confirmation cannot select a different person on a shared account. Revocation/regrant, expiry and policy changes invalidate earlier authorization stamps. Reopening declined, withdrawn, expired or suspended optional permission requires deliberate action. This is pure policy code awaiting authoritative storage and server integration, not an enabled product capability.

The existing Tireh reply/extraction paths now share a restrictive audience check. `hasGuests`, unknown people and empty audiences cannot bypass directory/memory filtering through a prompt builder. Extraction receives only the permitted directory/project projection. New group decisions stay in their source group instead of automatically gaining project scope; personal group classifications stay private/personal. Existing widened records are preserved for explicit migration, not silently reinterpreted.

The [experience specification](EXPERIENCE_SPEC.md) maps EN/FA onboarding, person/space context, memory sharing, privacy/deletion controls, notifications and voice fallback to actual Studio seams. Six synthetic walkthroughs define expected behavior; they are not claims that a browser implementation passed. Canonical notification defaults are aligned with the architecture: 2 per rolling 24 hours, 21:00–08:00 in the chosen timezone, user controls, generic external payloads; no email/SMS launch channel.

## Independent work and checks

| Role | Work / disposition |
|---|---|
| Sol architect | Authored the pure adaptive module and contract. 53 author tests plus repository/scoped typechecks and lint passed. |
| Sol UX designer | Authored the Studio experience specification; no UI implementation or real-user study claimed. |
| Sol privacy/security reviewer | Accepted the bounded Tireh patch and pure policy contract; added 14 independent audience tests and 16 independent policy tests. Identified the shared-account method bug, which the architect fixed before acceptance. |
| Luna E2E runner | Collected final composed evidence without modifying product or tests: **480 tests / 29 files passed**, TypeScript passed, lint passed. |
| Product lead | Integrated the current-path patch, resolved notification defaults/channel inconsistencies, updated existing behavior documentation and maintained honest partial-task status. |

The accepted scopes are code-level audience hardening and a pure trusted-input policy contract. They do not establish production privacy, legal compliance, transactional persistence, caller identity verification or external delivery behavior.

## Remaining work and backlog disposition

VOX-001/002/003/004/005/006/009/010/011 have local progress recorded, but none is falsely completed from this partial delivery. See [the canonical backlog](BACKLOG.json).

- Integrate authoritative person/space repositories and the transactional consent ledger; validate presented notices against the approved copy and actual user action.
- Suppress raw historical context and original user source text on deletion/revocation, with durable lineage, epochs, tombstones and restore/retry protection. A deleted memory row alone remains insufficient.
- Establish current Telegram audience membership and recheck before provider dispatch and final output; the directory snapshot alone remains insufficient.
- Implement controls against real server receipts, then event observation, Decisions, personalization, notifications and the independently evaluated improvement loop.
- Complete formal legal/provider/retention decisions and optional biometric qualification before enabling their affected capabilities.

No provider calls, live-user collection, migration, CI, deployment, browser/physical-device E2E or production activation occurred in this delivery. The new policy module is not yet wired into Studio request handlers. Existing legacy auto-memory behavior is not changed into a consent-compliant ledger by these functions. The next integrated slice is the storage/identity/consent and history-suppression boundary described in [STARTER_SLICE.md](STARTER_SLICE.md).
