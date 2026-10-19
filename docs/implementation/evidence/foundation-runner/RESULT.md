# Foundation runner evidence

- Task: foundation-runner (bounded local verification)
- Branch: `codex/adaptive-foundation`
- Base: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`
- HEAD: `ebb75a67c79bf317d1dec40381b216c75bb90ffa`
- Source diff identity: SHA-256 `795ab64cfa2489aa8c355a0e3ed64fc69b63862d7ca569ee2a3a41abf55cf9a3` of `git diff <base> -- src/lib/tireh src/lib/studio`
- Environment: Node `v22.23.3`, npm `10.9.9`, Vitest `v4.1.12`
- Fixture/source review: `vitest.config.ts` uses `src/test/setup.ts`; no global setup. Setup mocks Firebase and UI APIs. Targeted tests use scripted/in-memory fixtures and fake clients; provider adapter tests inject fake fetch. No dotenv command or live provider call was used.

## Results

- `npx vitest run src/lib/tireh src/lib/studio` — started 2026-10-19 20:12:57 local time; exit 0. 25 test files passed; 410 tests passed; 0 failed. Full output: [vitest.log](vitest.log).
- `npx eslint src/lib/tireh/memory/visibility.ts src/lib/tireh/memory/retrieval.ts src/lib/tireh/memory/extraction.ts src/lib/tireh/conversation/prompt.ts src/lib/tireh/types.ts src/lib/tireh/__tests__/audience-boundary.test.ts src/lib/tireh/__tests__/gateway.test.ts src/lib/tireh/__tests__/extraction.test.ts` — started 2026-10-19 20:13 local time; exit 0. No diagnostics. Full output: [eslint.log](eslint.log).

## Limits

These results cover only the approved local Tireh/Studio tests and listed lint targets. The adaptive subtree was not tested. This bundle does not establish whole-candidate acceptance, CI, deployed behavior, provider integration, or device behavior. Existing unrelated untracked files were left untouched.
