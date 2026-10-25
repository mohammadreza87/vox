# Agent Memory scripted test run

- **Task:** AM-RUN-01 execution subtask under canonical `AM-03` and `AM-RELEASE-01`
- **Runner:** `vox_e2e_runner`, requested model `gpt-6-luna` / medium; session model was not independently verifiable from the runner.
- **Execution:** 2026-10-25, UTC timestamps and raw command logs in `/tmp/vox-memory-luna-AM-RUN-01/`.
- **Environment:** `/Users/reza/.codex/worktrees/agent-memory-production/vox`; Node `v22.23.3`, npm `10.9.9`, Python `3.9.6`.
- **Base revision:** `7224f40d69cf816a49139a30092cbf92551d2a8e`.
- **Candidate:** moving dirty working tree based on that revision. Source was being edited by other workers; this is execution evidence only, not final candidate acceptance. Snapshot of changed paths and SHA-256 digests: `/tmp/vox-memory-luna-AM-RUN-01/changed-files.sha256`; captured after the three commands. The full source state is in `source-state.txt`.
- **Fixtures:** repository-local test fixtures only; no live accounts, provider calls, external messages, deployment, or destructive reset.

## Commands and results

| Command | Result | Observed output |
|---|---|---|
| `npx vitest run src/lib/tireh/memory/telegram-archive src/lib/adaptive/telegram-archive-rollback.test.ts` | **PASS**, exit 0 | 4 files passed; 53 tests passed; Vitest-reported duration 962 ms. Full log: `01-vitest.log`. |
| `node --test scripts/studio-adaptive-compatibility.test.mjs scripts/studio-production.test.mjs scripts/studio-skill-routing-config.test.mjs scripts/studio-rights-erasure-compatibility.test.mjs scripts/rights-intake-storage.test.mjs` | **PASS**, exit 0 | 179 tests passed; 0 failed/skipped; Node-reported duration 3329.922917 ms. Full log: `02-node-tests.log`. |
| `python3 scripts/validate-vox-plan.py` | **PASS with unavailable subcheck**, exit 0 | 78 tasks, 8 phases, 22 requirements, 20 agents, 226 checked local links, `errors: []`; TOML parsing reported `UNAVAILABLE: use Python 3.11+` because this environment has Python 3.9.6. Full log: `03-plan-validator.log`. |

Start/end timestamps and exact exit codes are in the corresponding `*.exit` and `*.end-utc` files, plus `start-utc.txt` and `end-utc.txt`. No failed command was retried.

## Limits and handoff

These results apply to the captured moving tree only. The lead mapped this execution subtask to `AM-03` (frozen baseline/evaluation protocol) and `AM-RELEASE-01` (integrated release slice). Full lint, TypeScript, full coverage, build, and additional CI script gates were not run per dispatch; wait for the lead to freeze source and authorize that gate. Independent acceptance belongs to `/root/memory_acceptance`. No production, provider, or device behavior is established by these local tests.

**Next owner:** lead to freeze and identify the final candidate, then provide the follow-up gate instruction; independent acceptance reviewer to decide acceptance.

## Proposed post-freeze CI gate (not run)

`.github/workflows/ci.yml` pins Node `22.23.3`. The requested gate set should include:

- `npm run lint`
- `npm run check:studio-style`, then `node --test scripts/check-studio-style.test.mjs`
- `npx tsc --noEmit`
- `npm run test:coverage` with `NEXT_PUBLIC_FIREBASE_API_KEY=test-key`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=test.firebaseapp.com`, and `NEXT_PUBLIC_FIREBASE_PROJECT_ID=test-project`
- CI release/script tests: `node --test scripts/legacy-offline-inventory.test.mjs`; `node --test scripts/firebase-preview-inventory.test.mjs`; `node --test scripts/connections-production-config.test.mjs`; the five-file `node --test` command recorded above; and `node --test e2e/guest-fixture-build.test.mjs`
- `npm run build` with the CI fallback values for the six `NEXT_PUBLIC_FIREBASE_*` build variables (`test-key`, `test.firebaseapp.com`, `test-project`, `test-bucket`, `123456`, `1:123:web:abc`) and `NEXT_TELEMETRY_DISABLED=1`

The workflow also defines Playwright jobs. They are outside the requested scripted release-node gate proposal and require explicit inclusion before running. No post-freeze command has been started.

## Post-freeze CI gate results

The lead declared the runtime source frozen at base `7224f40d69cf816a49139a30092cbf92551d2a8e` with reported runtime digest `540709b226a751d70ed5dbadcd6b179531d5b3efb1d2551d016d430e1e288fd5`. A 37-path local source manifest and per-file hashes were captured before running the gate: `/tmp/vox-memory-luna-AM-RUN-01/frozen-source-paths.txt` and `frozen-source.sha256` (manifest SHA-256 `ced1b0712c5faac606fa6e33d04c4ef3ff1b8d937820cb43ff50585ca5cdeda3`). After checks, those source files were unchanged; only `docs/implementation/BACKLOG.json` and `docs/implementation/BACKLOG.md` differed from the capture, outside the runner-owned evidence path. Logs are all under `/tmp/vox-memory-luna-AM-RUN-01/`.

| Gate | Result |
|---|---|
| `npm run lint` | **PASS**, exit 0; 0 errors, 196 warnings. `gate-lint.log` |
| `npm run check:studio-style && node --test scripts/check-studio-style.test.mjs` | **PASS**, exit 0; style check clean, 3/3 tests. `gate-style.log` |
| `npx tsc --noEmit` | **PASS**, exit 0. `gate-tsc.log` |
| CI script: legacy offline inventory | **PASS**, exit 0; 17/17. `ci-legacy-inventory.log` |
| CI script: Firebase preview inventory | **PASS**, exit 0; 20/20. `ci-firebase-preview.log` |
| CI script: Connections production config | **PASS**, exit 0; 1/1. `ci-connections-config.log` |
| CI script: studio release compatibility group | **PASS**, exit 0; 179/179. `ci-studio-release.log` |
| CI script: guest fixture build provenance | **PASS**, exit 0; 4/4. `ci-guest-provenance.log` |
| `npm run test:coverage` with CI test Firebase env | **FAIL**, exit 1 after 162.484 s. Vitest: 479 files (470 pass, 6 fail, 3 skip); 7,334 tests (7,311 pass, 8 fail, 15 skip). `gate-coverage.log`, `gate-coverage.meta`. |

Coverage failures: timeouts in lifecycle simulation, observation service, Connections foundation workflow, and two prepared-conversation qualification cases; voice identity failed `expected undefined to be defined`; two bot-runner cases expected `getUpdates` arguments without `edited_message`. The coverage run overlapped with an independent reviewer’s focused Vitest/installer work until QA reported its tests stopped; the wall-clock formats differ (Vitest prints local time, runner metadata is UTC), so no converted overlap timestamp is asserted. This may contribute to the timeouts, but does not explain the two different bot expectation failures. The raw log contains full traces. The initial full run was preserved without retry. QA then completed isolated diagnostics; the lead authorized one two-worker coverage rerun against the updated bot test expectations. The rerun and any later build are reported separately below. Hosted CI and Playwright remain separate gates.

## QA diagnosis and authorized resource-bounded rerun

The independent acceptance reviewer ran 6 focused files / 74 tests in isolation with coverage enabled, `maxWorkers=1`, and original deadlines: **PASS, 74/74**, in 44.84 s. Evidence: `/tmp/vox-memory-qa-isolated-six.log`, SHA-256 `0afd737615189d1f23d509b52d49bed4abdab1e797539f62f1269b6abeada6eb`. QA observed slow cases completing in isolation (observation 2.664 s, lifecycle 5.347 s, Connections foundation 1.067 s, voice comparison 0.512 s, prepared file-v2 4.741 s). This supports resource contention as an explanation for timeout results. The initial full-run failure remains recorded above. Two bot expectation literals were updated by their owner to include the intended `edited_message`; the runner made no source/test edits.

The lead then authorized one exclusive full coverage rerun at two workers, with CI Firebase test env and unchanged assertion/deadline thresholds:

- Command: `npm run test:coverage -- --maxWorkers=2`
- Result: **PASS**, exit 0, 476 files passed / 3 skipped; 7,319 tests passed / 15 skipped; 497.30 s Vitest duration (498.48 s wall).
- Coverage: statements 77.79%, branches 76.31%, functions 77.99%, lines 79.04%.
- Evidence: `/tmp/vox-memory-luna-AM-RUN-01/gate-coverage-w2.log` and `.meta`.
- Candidate manifest: QA refreshed 27-path manifest `/tmp/vox-memory-qa-refreshed-source-manifest.txt`, SHA-256 `95ec5ae8b6376453fa96c60c3e606af2217f04cb5110dbfeac2c7efdf679375c`. Verified identical after the coverage run and build.

After coverage completed, the CI fallback environment build ran sequentially:

- Command: `npm run build`
- Result: **PASS**, exit 0, 46.42 s wall; Next compiled successfully and generated all 43 static pages.
- Evidence: `/tmp/vox-memory-luna-AM-RUN-01/gate-build.log` and `.meta`.

The earlier lint, style, type, and Node script gates are recorded above. Lint had 196 warnings and no errors. Hosted CI, Playwright execution, deployment, and runtime/provider/device behavior remain unverified. Independent acceptance remains with `/root/memory_acceptance`; this evidence is not an acceptance decision.
