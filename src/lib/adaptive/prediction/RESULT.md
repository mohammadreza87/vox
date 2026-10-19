# Synthetic delivered prediction contract result

Author: streaming prediction worker, architect/voice role. Base `9fb73d3`,
branch `codex/vox-adaptive-completion`, uncommitted candidate; integration and
independent acceptance belong to the lead/evaluator. Run 19 October 2026 on local
Node 22.23.3, OpenAI SDK 6.9.1, Vitest 4.1.12. No network/provider credentials or
paid provider requests used. Fixtures are synthetic English/Persian drafts and
one synthetic single-pixel PNG, not private transcripts/media.

`npx tsx src/lib/adaptive/prediction/benchmark.ts` passed all ten fixed delivered
consumer cases: four text hints and two image hints delivered; two refusals and
two simulated 650ms provider responses fell back. Recorded p50 was 28.108ms and
p95 502.682ms for this isolated synthetic decision+consumer loop (excluding repository/HTTP prewarm),
including timeout cases;
the fixed Decisions service deadline remains 500ms. Baseline measurement is an
empty scheduling/control operation, not a competing model or final response.
There is no demonstrated end-to-end latency benefit. Synthetic returned input
usage was 24 tokens for known responses; timed-out usage and all real-provider
billing are unavailable. See [full result](benchmark-result.json).

Focused tests exercise signed request/origin/size boundaries, the SDK URL/body and
AbortSignal, EN/FA debounce, unsent-keystroke API suppression, two-call budget,
late/reordered delivery, audience/scope correlation, cancellation tombstones across
service instances, new-turn supersession, current Studio/core/grant checks,
short receipt expiry, image approval expiry while in flight, raster limits/CRC,
metadata stripping/interscan rejection and absence of raw content in durable
budgets. Focused author validation on 19 October 2026: `npx vitest run
src/lib/adaptive/decisions src/lib/adaptive/prediction src/lib/adaptive/runtime`
passed 59 tests in six files; scoped ESLint and `npx tsc --noEmit --pretty false`
passed. The exact composed-candidate diff digest is recorded by the lead because
other workers are changing shared files. The HTTP prewarm tests cover successful
read-only preparation, permission revocation during preparation and a hanging
preparer falling back after its separate 250ms bound. Gateway cache-reuse evidence
is owned by the memory worker; no live-provider prewarm speed benefit is claimed.

This is candidate-authored evidence, not independent acceptance. Semantic quality,
held-out calibration, confidence intervals, real provider/account latency/cost,
regional controls/retention, partial voice producer support, actual browser/device
media decode and playback, CI and deployment remain UNAVAILABLE. No VOX-027
hypothesis learning producer was implemented by this slice. No source-only result
closes those remaining gates.

Rollback follow-up: disabled/provider-absent cancellation is now a no-op; unknown
turns without current core/agent authority cannot seed extended records. The local
FILE-store rollback tool was tested only against synthetic temporary files: dry-run
left bytes unchanged, missing stop acknowledgement and stale CAS failed, and apply
removed only new prediction metadata while preserving original evaluation budgets
and private source fields. No production cleanup or old-binary promotion occurred.

A separate read-only historical-schema check loaded the actual
`9fb73d3:src/lib/adaptive/runtime/contracts.ts` from Git, transpiled it in memory,
and confirmed that a cancellation property is rejected while the same original
prediction record without new metadata is accepted with evaluations=2 preserved.
This verifies the rollback compatibility reason without modifying any live data.
