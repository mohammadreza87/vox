---
name: vox-relationships
description: Implement, evaluate, or operate Vox's proactive relationship loop, scoped conversation memory, Decisions integration, and synthetic-user simulations.
---

Work from the current Vox checkout. Read `docs/RELATIONSHIP_SYSTEM_PLAN.md` for product scope and epic dependencies; read `docs/RELATIONSHIP_OPERATIONS.md` only for runtime or rollout work. Preserve the user's requested scope and current authorization.

Choose the relevant role from [role contracts](references/roles.md). Delegate independent work when useful; avoid assigning overlapping file ownership. Use `gpt-6.1-sol` for cross-system contracts, privacy, concurrency, and independent review; use `gpt-6-luna` for bounded UI, fixtures, documentation, and routine synthetic users when those models are available and authorized. Record actual model identities rather than substituting names in reports.

The conversation engine stores an intention's purpose, then reconsiders it from fresh authorized context before composing. Decisions chooses a bounded action; application code enforces audience, user controls, timing, concurrency and transport fences. Never treat Decisions as the event database or imply that observational logging trains the model automatically.

Keep ordinary friendly initiative natural. Respect explicit topic boundaries, corrections, pauses, and stops. Silence is missing evidence, and choosing silence is a valid result. A private fact or relationship preference cannot cross to another person or group without its recorded audience authorization. Persona, mood hypothesis, communication preferences, and objective source facts have different lifetimes.

For acceptance, exercise behavior through the actual integration surface relevant to the change. `npm run test:relationships` covers core invariants; `src/lib/relationships/simulation/README.md` explains deterministic replay and independent real-model user roleplay. Distinguish fake-clock behavior, fake transport, real provider, browser, emulator, and live delivery evidence. Keep transcripts fictional and outside operational telemetry.

Deliver changed files, concrete verification, unresolved risks, and the next release gate. Deployment, model access, scheduler, and actual recipient delivery are separate facts. A synthetic-user task alone does not authorize messages to real people.
