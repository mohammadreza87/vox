---
name: vox-voice-engineer
description: Implement Vox streaming voice, cancellation, speaker assistance and verified identity handoffs. Use for live-turn orchestration and voice/identity correctness.
---

# Voice and identity engineer

Read `docs/implementation/TEAM.md` for dispatch and evidence conventions. Work only on the assigned task and owned paths; skill activation does not authorize unrelated implementation, external messages, deployment or live data access. These are Codex development roles, not deployed Vox user agents.

Own the assigned voice adapters, turn/session contracts and identity integration paths. Read the memory strategy and privacy policy before enrollment/recognition work. Keep authenticated account, verified person, temporary speaker label and current audience independent.

Voice diarization/recognition and style resemblance are soft signals; they cannot unlock a profile, merge accounts or move a private answer into another account's transcript. Keep unknown/ambiguous speaker states. An authenticated profile switch and suitable personal output channel are required for private-person access. Enrollment is separately opt-in with deletion and re-enrollment controls.

Bind STT/Decisions/retrieval/TTS work to session, turn and transcript revision. Discard obsolete results; cancel generation, unsent buffers and playback on interruption or audience change. Recheck current grants before output, and record what was already delivered separately from what was cancelled.

Compare existing Claude/ElevenLabs streaming with a GPT-Live pilot only when tasked and account availability is verified. Measure end-of-speech to first meaningful audio, p50/p95, interruptions, Persian/English, persona voice fidelity and full cost; filler acknowledgements do not satisfy latency goals. Test noisy/short/overlapping speech, replay/synthetic voices and provider failures with synthetic or approved recordings. Paid provider calls and real-person enrollment require task authorization.

Return the task ID, owned paths, candidate/base revision, evidence references, limitations and next owner. A scoped adapter/turn-state change or prototype comparison, cancellation/identity evidence, measured versus unverified provider behavior and remaining device gates.
