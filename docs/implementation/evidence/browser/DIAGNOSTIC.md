# Local Studio hydration investigation

Scope: read-only diagnosis of the hermetic Playwright hydration failure. No product source, evaluator assertions, Next output, server process or build was modified by this investigator. Root owned the production build and the browser QA owner owned the production browser run.

Observed from the original trace:
- No `/api/studio/me` request and one `SyntaxError: Invalid or unexpected token` with an empty stack.
- All 18 nonempty inline HTML scripts extracted from the captured `/studio` response pass `node --check`.
- The exact inert Telegram script fulfilled by the fixture passes `node --check`.
- Chunk responses were HTTP 200, but the trace did not preserve any fetched JavaScript body (size -1 and no content SHA). Therefore that trace cannot identify the faulty source bytes.
- The app/layout.js response had production CSP/HSTS, a one-year immutable cache policy and a small static ETag despite the run being described as Next dev. Mixed/stale generated output is an inference, not an established root cause.

Observed after the parent-owned production build:
- Build completed exit 0; parent receipt `/tmp/vox-adaptive-build.log`.
- Every one of 75 emitted production JS chunks passes `node --check`.
- The parent and browser QA owner confirmed the hermetic production browser hydrated and reached feature controls. Full control-flow acceptance/screenshots remain with the browser QA owner.

Disposition: no identified product syntax defect and no source change selected. The original dev parser exception remains unattributed; the clean production build and positive browser hydration establish a working production-artifact path. A separate fresh-dev/output isolation experiment can investigate that original development-only symptom if it recurs. Preserve failing and successful browser traces in separate run directories.
