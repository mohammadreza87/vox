# Final composed candidate verification

- Task: foundation-runner, final frozen composed candidate
- Branch: `codex/adaptive-foundation`
- Base: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`
- HEAD: `ebb75a67c79bf317d1dec40381b216c75bb90ffa` (candidate changes are in the working tree)
- Environment: Node `v22.23.3`, npm `10.9.9`, Vitest `v4.1.12`
- Candidate source identity: SHA-256 `6a9bbfb9b82847fd9d7f537028039fd3e5de081490cb21ba84a90907c2dcd2ec`. Computed over sorted paths, appending each repo-relative UTF-8 path, NUL, file bytes, NUL.
- Source path set (19 files included in the digest):

  - `src/lib/adaptive/__tests__/consent.test.ts`
  - `src/lib/adaptive/__tests__/eligibility.test.ts`
  - `src/lib/adaptive/__tests__/fixtures.ts`
  - `src/lib/adaptive/__tests__/independent-policy.test.ts`
  - `src/lib/adaptive/__tests__/policy.test.ts`
  - `src/lib/adaptive/consent.ts`
  - `src/lib/adaptive/eligibility.ts`
  - `src/lib/adaptive/identity.ts`
  - `src/lib/adaptive/index.ts`
  - `src/lib/adaptive/policy.ts`
  - `src/lib/adaptive/types.ts`
  - `src/lib/tireh/__tests__/audience-boundary.test.ts`
  - `src/lib/tireh/__tests__/extraction.test.ts`
  - `src/lib/tireh/__tests__/gateway.test.ts`
  - `src/lib/tireh/conversation/prompt.ts`
  - `src/lib/tireh/memory/extraction.ts`
  - `src/lib/tireh/memory/retrieval.ts`
  - `src/lib/tireh/memory/visibility.ts`
  - `src/lib/tireh/types.ts`

## Results

- `npx vitest run src/lib/adaptive src/lib/tireh src/lib/studio` — started `2026-10-19 17:16:20 UTC`; exit 0; 29 files passed, 479 tests passed, 0 failed. Output: [stdout](final-vitest.stdout.txt), [stderr](final-vitest.stderr.txt), [exit](final-vitest.exit.txt), [start time](final-vitest.started.txt).
- `npx tsc --noEmit --incremental false` — started `2026-10-19 17:16:28 UTC`; exit 0. Output: [stdout](final-tsc.stdout.txt), [stderr](final-tsc.stderr.txt), [exit](final-tsc.exit.txt), [start time](final-tsc.started.txt).
- `npx eslint src/lib/adaptive src/lib/tireh/memory/visibility.ts src/lib/tireh/memory/retrieval.ts src/lib/tireh/memory/extraction.ts src/lib/tireh/conversation/prompt.ts src/lib/tireh/types.ts src/lib/tireh/__tests__/audience-boundary.test.ts src/lib/tireh/__tests__/gateway.test.ts src/lib/tireh/__tests__/extraction.test.ts` — started `2026-10-19 17:16:43 UTC`; exit 0, no diagnostics. Output: [stdout](final-eslint.stdout.txt), [stderr](final-eslint.stderr.txt), [exit](final-eslint.exit.txt), [start time](final-eslint.started.txt).

These are local source checks for the identified candidate. They do not establish CI, deployment, live provider, or device behavior.
