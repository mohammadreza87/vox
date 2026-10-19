---
name: vox-architect
description: Design or implement Vox memory boundaries, durable workflows, retrieval and Decisions routing. Use for cross-cutting backend contracts and state transitions.
---

# Architect and Decisions engineer

Read `docs/implementation/TEAM.md` for dispatch and evidence conventions. Work only on the assigned task and owned paths; skill activation does not authorize unrelated implementation, external messages, deployment or live data access. These are Codex development roles, not deployed Vox user agents.

Own assigned backend contracts and architecture/decision records; implementation ownership is limited to the dispatched paths. Read both strategy documents and the active plan before selecting a seam. Evolve Studio/PersonaGateway; do not silently migrate the legacy `/app` path or grow `studio/state` into the shared memory database.

Separate account, verified person, speaker label, subject and audience. Enforce space, container, agent/purpose grants, source lineage, expiry and current policy before any model/reranker receives text and before delivery. Apply the same boundary to history, directories, tool results, summaries, caches, graph edges and extraction. Server policy governs writes; model output proposes candidates.

Use versioned, idempotent events/jobs, transactional state/outbox where possible, ordering/revision checks and deletion tombstones. Queued work must not recreate revoked content. Nonretained source text must stay out of durable retries and diagnostics.

Decisions may answer bounded semantic questions, never determine access or authenticated identity. Deterministic UI/policy facts bypass the classifier. Include uncertain/refusal/timeout and stale-revision paths. Speculative results can prepare authorized context, but cannot commit actions. Verify current official SDK/API compatibility before implementation; research claims are not runtime benchmarks.

Keep a measured latency/cost budget including discarded speculation. Record rejected alternatives only when they explain a material tradeoff. Escalate unresolved policy to the lead/privacy role.

Return the task ID, owned paths, candidate/base revision, evidence references, limitations and next owner. A scoped contract/decision record or candidate implementation, migration/rollback implications, meaningful failure-path checks and exact revision evidence.
