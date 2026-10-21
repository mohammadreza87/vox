# Connections implementation status

19 October 2026. Merged into `develop` (originally branch `codex/studio-connections`), implementation baseline `d8d6766f4e7148e83ec4f85208974e00e3570c34`. The combined runtime source is frozen at `cae9d1e84336959dbaa4f4ef8e50cb4204854ded`, integrating upstream `849e77bbbc84af8700287460c34269c251c22503`. Independent held-out tests are included in the final release commit; their exact non-document manifest is recorded in the review. Independent review accepts only a globally disabled source/UI rollout after final artifact verification. Historical planning documents retain their original baseline and planning-only statements; the user subsequently authorized implementation in this chat.

The implemented release surface is **read-only, private, per verified person and Work/Personal space**. Every provider is disabled until an operator explicitly admits the exact account, native subject/tenant, endpoint, resources, tools, destinations, scope evidence and budget. A configured profile, working identity endpoint or passing fixture is not real provider qualification. **Provider writes, posting, sending, deployment, paid lifecycle actions and destructive/privileged effects are hard-disabled independently in both Studio and the production broker.** Effect adapters, exact approvals and the ledger remain source/fixture evidence for future qualification.

## Implemented source and finite synthetic evidence

| Area | Implemented behavior | Remaining qualification |
|---|---|---|
| Studio experience | EN/FA Connections and workflow screens, exact account/space/agent/resource grants, setup/claim/cancel, safe status, review/pause and isolated tasks | Actual Telegram iOS/Android/Desktop/browser OAuth and accessibility journeys |
| Identity and grants | Adaptive current verified-person binding, exact private scope, usable agents, zero grants on enrollment, no admin/public/successor inheritance, expected revisions | Target account binding/tenant lifecycle and non-private audiences |
| Persistence | Strict normalized records, transactional memory fixture, normalized per-record file generations with lock/fsync/restart/orphan cleanup, Firestore transactions/fence | Actual Firestore rules/emulator, target IAM, capacity/load, TTL/restore/backup drills |
| Broker/vault | Separate-process loopback HTTP, bounded HMAC timestamp/nonce authentication, separate AES-GCM vault/key, UID/mode/ambient-secret startup checks, actor/scope-bound enrollment and refresh | Actual independent OS user/filesystem/network/process identity, deployed callback/proxy, rotation/restore/revoke drills |
| Provider setup | GitHub/Google S256 PKCE and state-bound OAuth seal/claim; operator-only stdin token enrollment; native subject/tenant or explicitly labelled resource/delegation qualification | Real app/provider approval, actual scopes/permissions/account access, provider-specific OAuth variants and worker attestation |
| Catalog/adapters | Code-owned typed schemas, exact finite resource mapping, pinned HTTPS/DNS transport, GitHub/Notion/Slack/Google/Forgejo/Gamend/GA/PostHog/Gmail/Figma/Hetzner read surfaces and bounded write fixtures | Real account/native-resource capability tests. Notion implemented as typed REST bridge; remote MCP profile unqualified |
| Model tasks/skills | Isolated single-connection Studio task loop, code-owned tool choices/argument validation, all-generation source union and seven versioned runtime skills | Real model processor/retention approval, provider/model evaluation, general Telegram/voice tool loop and cross-agent/group context |
| Lineage/revocation | Current binding/agent/grant/source checks through all ancestors, exact provider/model/private destinations, immediate suppression, tombstones and invalidation outbox | Acknowledged physical purge across all history/memory/vector/cache/backup consumers; deletion receipt remains pending |
| Operations | Durable intent/outbox/audit, canonical idempotency, exact approvals, fenced claims/sending/settle, conservative unknown state, terminal preflight failures and ephemeral loss recovery | Provider receipt reconciliation, compensation/undo and actual dispatched-effect target tests; all effects remain disabled |
| Events | Broker-only raw-byte GitHub/Slack signatures, exact subscription/native IDs/key version, keyed body replay digest, minimized durable inbox and explicit native readback | Actual provider hook installation/retry delivery, key rotation and admission. GitHub App-installation events remain unavailable; owner-scoped repo hooks only |
| Workflows | Explicit digest/revision review, bounded fixed read steps, interval/daily IANA timezone schedule, quiet hours, DST fold dedupe, no eligible-time rejection, deterministic occurrence/step IDs, signed explicit worker drain | Authorized recurring worker deployment and real provider readback. No implicit event-created rules, source-body persistence or unsolicited external delivery |
| Budgets/controls | Durable explicit daily model/tool ceilings, per-grant/workflow call/byte/run limits, current profile and executor kill guards | Monetary accounting, provider-native quota/health/circuit-breaker/metrics qualification and actual target outage drills |
| Workers | Bounded isolated public-page offline Chromium reader, named SSH diagnostic runbook, signed release-attestation enrollment and per-scope guarded bootstrap source | Attested enrollment, actual disposable SSH host, authenticated/interactive browser, target kernel/IAM/isolation and production release |

The independent reviewer actually exercised an immutable local Docker/Chromium image with a synthetic offline page, script and iframe. See [RUNNER_OPERATIONS.md](RUNNER_OPERATIONS.md) and the [independent implementation review](evidence/IMPLEMENTATION_REVIEW.md) for exact image/seccomp/fixture evidence. This is local browser-rendering evidence; it does not establish account, SSH-host or deployed worker qualification.

## Validation checkpoint

All keys, accounts, tokens, source text, provider responses, DNS answers, model decisions and network wire responses in the automated suites are synthetic. The broker HTTP tests use the real loopback HTTP server/client with temporary encrypted vault files. File tests reload normalized state and verify aborted transactions, corruption, orphan generation cleanup and no repeated completed workflow. No production secrets or private provider content were read.

- Author foundation, broker, storage and workflow fixtures: **25 PASS**, including actual loopback authentication, PKCE seal/claim, wrong-account/replay/revoke, exact approvals/idempotency/fences/unknown outcomes, source omission/current-person/agent restrictions, encrypted vault binding, normalized file restart, DST/quiet hours, signed-body replay and native event readback gates.
- Full TypeScript check: **PASS**, `node_modules/.bin/tsc --noEmit --pretty false`.
- Owned foundation/broker/events/workflows/scheduler ESLint: **PASS, zero warnings**.
- Independent provider/runner/identity, application/model/task, HTTP/UI, transport, budget and lifecycle suites have separate ownership. Their latest exact counts and candidate digest belong in [IMPLEMENTATION_REVIEW.md](evidence/IMPLEMENTATION_REVIEW.md).
- Combined full regression: **2,498 PASS, 10 skipped; 174 suites PASS, 2 skipped**, `npx vitest run --maxWorkers=4 --reporter=dot`. The initial unconstrained run exposed a stale scripted-model test snapshot and two resource-contention timeouts. The fixture now invokes the new SDK authorization callback and omits nonserializable callback/signal from snapshots; both slow suites passed separately, then the entire bounded-concurrency run passed. No timeout or product assertion was weakened.
- Independent Connections acceptance: **203/203 PASS across 16 suites**, including current agent blocks, signed worker admission, final-use authorization and revoke suppression.
- Full repository ESLint: **zero errors, 185 existing warnings**. TypeScript passes. Production configuration-preservation Node tests: **3/3 PASS**.
- Actual local Chromium mobile EN/FA rendering journey: **1/1 PASS** on the combined source; screenshots reviewed. APIs are explicitly intercepted synthetic fixtures, not account/device proof.

Commands:

```text
node_modules/.bin/vitest run src/lib/connections/__tests__
node_modules/.bin/tsc --noEmit --pretty false
node_modules/.bin/eslint src/lib/connections
```

The broad regression includes the existing Studio, voice, adaptive, learning and relationship suites. Exact production build, deployment and public-route evidence will be recorded separately in the release packet. No unit/CI badge alone is deployment, provider, device or source-purge proof.

## Current completion boundary

`CONN-001`–`030` have implemented or partial source/fixture slices, with task-specific differences recorded in [BACKLOG.json](BACKLOG.json) and its generated [readable view](BACKLOG.md). None is closed by author assertion. `CONN-031` real-account/device journeys and the enabled-provider canary/rollback portions of `CONN-032` are **NOT RUN / UNAVAILABLE**. The disabled source/UI rollout is recorded in RELEASE_PACKET.md. Source and local synthetic behavior are reviewable; provider/account/device/deployment admission remains separate.

Readiness requires a frozen reviewed artifact, target-specific UID/IAM/vault/network/proxy checks, provider approval and native rights evidence, actual read/receipt/revoke/refresh journeys, current budgets/kill/retention configuration, and applicable physical-device proof. Existing production bot polling, Telegram webhooks, Studio credentials and service deployment were not changed by these fixture checks. No provider activation or physical-device journey is claimed complete. A globally disabled source/UI rollout was subsequently verified as recorded in RELEASE_PACKET.md.

خلاصهٔ وضعیت: پیاده‌سازی و آزمون‌های محلی با حساب‌ها و داده‌های ساختگی انجام شده است. قابلیت تولیدی فقط خواندن در فضای خصوصی و با مجوز صریح هر حساب و عامل است. نوشتن، ارسال پیام و اقدامات مخرب در استودیو و بروکر غیرفعال‌اند. اتصال واقعی به ارائه‌دهنده، آزمون دستگاه تلگرام، استقرار، حذف کامل نسخه‌های پشتیبان و تأیید زیرساخت هنوز انجام نشده‌اند و آمادهٔ انتشار اعلام نمی‌شوند.

## Disabled rollout target preflight

An independent read-only check of the actual Mac Studio found the production env owned by UID501, mode0600, no symlink; the installed revision and local health agree on `9fb73d311753a461bd62e37ce3129b8a60c83d00`, bots enabled with one Studio launchd service. All three Connections settings are absent from production env, launchd globals and the service. No broker or runner process/service was observed. No `prepare` is needed. This admits an artifact-verified globally disabled source rollout only, preserving existing configuration and the single Telegram poller. It does not admit account activation.

به‌روزرسانی آزمون نهایی: ۲۴۹۸ آزمون در مجموعهٔ کامل و ۲۰۳ آزمون مستقل اتصال‌ها موفق بودند. بررسی مرورگر انگلیسی و فارسی نیز موفق بود. انتشار کد با اتصال‌های کاملاً غیرفعال پس از تأیید ساخت مجاز است؛ فعال‌سازی حساب‌های واقعی، بروکر و عامل‌های اجرایی هنوز نیازمند پیکربندی و تأیید جداگانه است.

## First source/UI deployment

Runtime `e28fc8df55d88d2fa59c6c5e68b1e0d16b01c3f2` was built and installed on Mac Studio with Connections globally disabled. Independent checks confirmed installed/local/public revision, BUILD_ID, public Studio and sampled assets, authentication denials, one polling server and no Connections service. Production env remained byte-identical; backup and prior release were retained. The subsequent middleware correction and independent held-out tests passed 300 cases across 18 suites, including 238 independent cases. A fresh build is required for that correction. See [RELEASE_PACKET.md](RELEASE_PACKET.md) for English/Persian rollout and remaining activation dependencies.
