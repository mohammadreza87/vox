# VOX-021 independent diagnostic privacy review

Reviewer: `foundation_privacy`, using `vox-privacy-security`. Worktree: `/Users/reza/.codex/worktrees/adaptive-observations/vox` only. Base: `c424dc6d9829540ad1e999a99efa824e9894dd66`. Dirty source is preserved; no commit, push, deploy, live data or provider request was performed. The lead owns first-release deployment.

## Disposition

**PASS for the bounded local source/test scope at the exact candidate below.** All three findings are remediated; no failing criterion is waived. This review covers only safe operational diagnostics in the active Studio/Tireh communication chain. It does not accept all observation/analytics collection or the entire VOX-021 roadmap.

Reviewer-owned changes: this report and the new `src/lib/studio/__tests__/diagnostic-security.test.ts`. Product source and author tests are read-only. All credentials, identifiers, exception payloads and transcripts used here are synthetic canaries. SDK/fetch/Telegram transports are mocked; real orchestration and adapter functions run locally.

## Findings

| ID | Severity | Boundary and minimal reproduction | Status / owner |
|---|---|---|---|
| DGR-01 | P1 | Safe outer gateway catches do not prevent inner adapter leaks. The baseline Studio STT fallback logged the raw primary provider Error; the Anthropic web-search fallback interpolated model and exception message. Live initial/midstream voice catches also forwarded raw exceptions. A provider Error containing a fake token/transcript therefore entered generic logs. | Fixed and independently verified through actual STT/web/voice invocation tests. |
| DGR-02 | P1 | The authenticated Mini App router still logged its raw rejected Error at the former `src/lib/studio/http.ts:291`. Independent GET `/agents` with `listAgents` rejecting the canary Error reached the logger as a second raw argument. With throwing exception accessors, `ElevenLabsSpeechError.is` read `name` at `media.ts:142` and caused router rejection before its intended generic500 response. | Independently reproduced two failures at21:43:35. Implementer fixed current `http.ts:276-304`: classification/formatting is guarded, then one fixed diagnostic is emitted. Both unchanged reproductions now pass: generic500 plus one fixed event, no raw Error. |
| DGR-03 | P2 | The Tireh production logger bridge expected string messages and wrapped subsequent values. Passing a structured catalog object through it did not preserve the intended top-level Pino event fields. | Direct Pino wiring reviewed; actual runtime/gateway/Pino destination suite passes. Reviewer additionally serializes through the saved production logger configuration in a fresh local Node process. This was a structured diagnostic compatibility gap, not independently established secret disclosure. |

The initial independent suite also had three incorrect provisional catalog reason expectations (STT and web fallback); those were corrected to the declared fixed reasons without changing the content exclusion, fallback, original-error or processing criteria. The HTTP findings above are actual candidate failures, not fixture mismatches.

## Review contract and evidence

- Every accepted call site chooses a fixed catalog token. The logging helper accepts no request, exception, account/person/chat/update/agent identifier, transcript, provider body or arbitrary exception code as payload.
- Output payload is exactly `type`, `stage`, `reason`, `outcome`, with finite catalog values. Unknown/inherited event keys are dropped. Voice classification accepts only six exact known provider codes; unknown codes and throwing accessors/proxies select the fixed generic fallback.
- Operational diagnostics remain separate from optional product analytics, personalized memory and improvement evidence. This patch grants no permission to collect conversation content for those purposes.
- Independent invocation coverage exercises polling retry timing and stop; actual manager batch continuation/offset; actual gateway voice synthesis failure and dedupe; actual STT adapter fallback; actual mocked SDK web fallback and unavailable-tool cache; preserving the original SDK exception if status/message inspection throws; initial live-turn503; midstream SSE fallback and DONE; iterator cancellation; authenticated Mini App HTTP catch.
- Author suites additionally cover real Studio/Tireh webhook routes, invalid authentication/body limits, duplicate acknowledgements, next-update continuation, menu/refresh/profile/relationship schedules, profile retry state, service fallback and production Pino destination fields.

## Final candidate and commands

Runtime source SHA-256: **`d6748fe1e44b114b82ba475e78fbfbafde04a12f7c32e0b07b7ce868f3208713`**. It covers these 11 repository-relative paths, sorted lexically and hashed as UTF-8 path, NUL, raw file bytes, NUL:

```text
src/app/api/studio/telegram/[key]/route.ts
src/app/api/tireh/telegram/[personaId]/route.ts
src/lib/studio/bots.ts
src/lib/studio/http.ts
src/lib/studio/media.ts
src/lib/studio/service.ts
src/lib/studio/voice-call.ts
src/lib/tireh/gateway.ts
src/lib/tireh/llm.ts
src/lib/tireh/runtime.ts
src/lib/tireh/telegram/diagnostics.ts
```

Composed source/test/config identity: **`e9a0c91ac59b9eb3e1d9eafca28996b934dbc1f18143f938de88ddcfb7ff7bc2`**, 494 files, unchanged before/after independent verification. Reproduce the same hash rule over the sorted union of `src/**/*.ts`, `src/**/*.tsx`, `src/**/*.css`, `package*.json`, `tsconfig*.json`, `vitest.config.*`. This includes unchanged dependencies and does not broaden acceptance. Documentation and generated build files are excluded.

Independent commands on 19 October 2026:

```sh
npx vitest run src/lib/studio/__tests__/diagnostic-security.test.ts
npx vitest run src/lib/studio src/lib/tireh src/app/api/studio src/app/api/tireh
npx tsc --noEmit --incremental false
npx eslint src/lib/studio/__tests__/diagnostic-security.test.ts
```

Results: reviewer suite **16/16 passed** at21:45:01; composed suites **912/912 tests, 54/54 files passed**, started21:45:20, duration3.62s. TypeScript and reviewer-file ESLint both exited0. The full runtime diff was inspected and a non-test Studio/Tireh module/route scan found no remaining direct logger/console producers. Call-site tests, the runtime bridge and actual configured Pino serialization are included; helper-only assertions do not establish acceptance.

Before/after evidence: the two Mini App catch tests failed against the unmodified catch at21:43:35 (raw second logger argument; secondary accessor exception), then passed after correction. The reviewer edited neither product source nor author tests.

## Limits and remaining owners

This source change prevents the reviewed application producers from forwarding content to the logger. It neither removes historical logs nor qualifies production sinks, platform/access logs, exception instrumentation, retention, backups, provider observability, IAM or deployed isolation. Base Pino fields such as timestamp/process/host/service are not user identity; this review does not claim anonymous infrastructure logs.

Existing user-facing provider error responses and known HTTP status mappings are a separate output boundary. Preserving those responses for ordinary errors does not prove they contain no provider-supplied text; this logging slice must not be presented as comprehensive HTTP error sanitization. Hostile-accessor handling must still remain within the intended HTTP failure boundary.

The catalog deliberately gives up per-agent/account correlation. Do not restore IDs/free text under debug flags or substitute hashing as a claim of anonymity. Operational rollout, sink retention/access controls and any future correlation design remain lead/privacy-owner decisions. Formal legal review, registered entity/contact and approved provider records remain launch gates; they do not prevent synthetic local engineering.

## EN / FA handoff

EN: The fixed-catalog operational logging slice passes independent local review: 16 adversarial checks and 912 composed tests pass. Both reproduced Mini App failures are fixed. Deployment, historical log deletion, production retention/IAM and legal approvals remain separate.

FA: این بخش محدود از ثبت رخدادهای عملیاتی با فهرست ثابت، بررسی مستقل محلی را گذراند؛ ۱۶ آزمون خصمانه و ۹۱۲ آزمون ترکیبی موفق بودند و هر دو خطای بازتولیدشدهٔ مینی‌اپ اصلاح شدند. استقرار واقعی، حذف لاگ‌های گذشته، نگهداری داده و کنترل دسترسی در محیط واقعی و تأیید حقوقی همچنان جداگانه نیاز به بررسی دارند.

## CI fixture portability correction: PR49 / Node20

Lead-reported CI job `118242202425` on PR49 head `453078553e1b0e7a59d80edc2f2e0e2138a013bd` failed eight reviewer cases while constructing `hostileError`, before product code ran. That HEAD was verified locally in this isolated worktree. No CI logs were downloaded; the supplied failure was independently reproduced locally before editing.

The official Darwin arm64 Node20.20.2 archive was downloaded into `/tmp` and its SHA-256 matched the official release manifest: `6375a1d4421bc04ab284ba89459df788a78c49c89e83c463d0eede47e2efc07b`. Sources: [Node20.20.2 checksums](https://nodejs.org/dist/v20.20.2/SHASUMS256.txt) and [runtime archive](https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-arm64.tar.xz). No project dependencies or lockfiles changed.

Cause: on Node20, redefining the lazy native `Error.stack` after installing the throwing `message` getter materializes stack information and invokes that getter. A standalone reproduction of the original order reported `constructed:false, calls:1`; the unmodified suite with V8 coverage failed eight cases and passed eight. This also reproduced without coverage in the standalone construction check, so coverage itself is not established as the cause.

Correction: define the hostile `stack` property first, while native name/message remain ordinary, then define the same other six hostile properties. Every original case and assertion remains. One added test proves the fixture stays an Error, construction invokes no getters, all seven own getter descriptors remain installed, and reading each property still throws the transcript canary (seven getter invocations). No product source was edited and no security criterion was weakened.

Independent before/after commands (Node20 binary installed only under `/tmp`):

```sh
/tmp/vox-diagnostic-node20/node-v20.20.2-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run src/lib/studio/__tests__/diagnostic-security.test.ts --coverage --coverage.reportsDirectory=/tmp/vox-diagnostic-node20-before-coverage
/tmp/vox-diagnostic-node20/node-v20.20.2-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run src/lib/studio/__tests__/diagnostic-security.test.ts --coverage --coverage.reportsDirectory=/tmp/vox-diagnostic-node20-after-coverage
/Users/reza/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run src/lib/studio/__tests__/diagnostic-security.test.ts --coverage --coverage.reportsDirectory=/tmp/vox-diagnostic-node24-after-coverage
node node_modules/vitest/vitest.mjs run src/lib/studio/__tests__/diagnostic-security.test.ts
node node_modules/eslint/bin/eslint.js src/lib/studio/__tests__/diagnostic-security.test.ts
git diff --check
```

Results: original Node20.20.2 coverage run **8 failed / 8 passed**; corrected Node20.20.2 coverage run **17/17 passed** at21:53:13 (2.29s); bundled Node24.19.0 coverage run **17/17 passed** at21:53:20 (2.26s); regular PATH Node22.23.3 run **17/17 passed** at21:53:20 (1.26s). ESLint and diff check passed. Logs and coverage reports remain under `/tmp/vox-diagnostic-node20-*` and `/tmp/vox-diagnostic-node24-*`; only failure/result snippets were surfaced. Coverage configuration and thresholds were unchanged.

Corrected reviewer test SHA-256: `afffdbe497ddb9f36f35f23db4af6a6e6e4abcb9b41ea1ca32acc51a38035a9a`. The 11 reviewed production files still hash to `d6748fe1e44b114b82ba475e78fbfbafde04a12f7c32e0b07b7ce868f3208713`. Earlier composed-suite counts/hashes above are historical checkpoints, not a newly repeated full-suite result. The new evidence is a local macOS reproduction using the matching Node version and coverage mode; the Linux CI rerun remains the lead's next verification. No commit, push or deployment was performed.

FA: شکست CI در ساخت دادهٔ آزمون و پیش از اجرای کد محصول بازتولید شد. با تعریف ویژگی پشته پیش از نصب دسترسی‌های خصمانه، هر هفت ویژگی و همهٔ معیارهای امنیتی حفظ شدند. هر ۱۷ آزمون روی Node20 و Node24 با پوشش کد و روی Node22 موفق بودند؛ اجرای دوبارهٔ CI همچنان جداگانه لازم است.
