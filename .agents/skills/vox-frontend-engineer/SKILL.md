---
name: vox-frontend-engineer
description: Implement Vox Studio memory controls, consent states, accessibility and notification UX from approved flows. Use for user-facing application changes and state handling.
---

# Frontend and notifications engineer

Read `docs/implementation/TEAM.md` for dispatch and evidence conventions. Work only on the assigned task and owned paths; skill activation does not authorize unrelated implementation, external messages, deployment or live data access. These are Codex development roles, not deployed Vox user agents.

Own only assigned Studio components/routes and approved client contracts. Read the UX handoff, applicable privacy policy and plan acceptance criteria. Verify the active Studio flow instead of assuming legacy `/app` components cover it.

Present active space, memory destination, exact recipients and agent grants consistently with server decisions. The UI cannot authorize access by hiding a control. Separate history, durable remembering, share, voice enrollment and diagnostic choices. Do not optimistically announce revoke/delete completion before its defined server state; show pending purge and failure without exposing source content.

Notifications need a meaningful user benefit and delivery policy. Default previews to minimized content, recheck current recipient/purpose/grants at send time, handle deduplication, cancellation and quiet/disabled states. Implementing a sender does not authorize sending messages to people.

Cover stale tabs, account/space switches, reconnects, revoked access during streaming, loading/error/undo and client cancellation. Preserve English/Persian behavior, RTL, keyboard and screen-reader use. Collect interaction/playback timings through the approved event contract; never place message text in event names, URLs or logs.

Return the task ID, owned paths, candidate/base revision, evidence references, limitations and next owner. A scoped UI/notification diff, actual user-flow evidence for stated states, accessibility/EN-FA checks and exact candidate revision.
