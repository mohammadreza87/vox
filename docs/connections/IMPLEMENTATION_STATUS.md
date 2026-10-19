# Connections implementation status

19 October 2026. Branch `codex/studio-connections`, implementation baseline `d8d6766f4e7148e83ec4f85208974e00e3570c34`. The candidate is uncommitted and still under independent integration review. The coordinator must freeze the final source/configuration/diff manifest before acceptance. Historical planning documents retain their original baseline and planning-only statements; the user subsequently authorized implementation in this chat.

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
- The latest broad pre-merge checkpoint executed **375 cases in 25 suites: all PASS** with `node_modules/.bin/vitest run src/lib/connections/__tests__` (23:21 local test runner checkpoint). The independently owned workflow suite now has 14 passing cases, including owner-scoped GitHub hook namespaces and rejection of never-eligible schedules. This green checkpoint predates the coordinator's final upstream integration/freeze; repeat affected checks on that combined candidate before acceptance.

Commands:

```text
node_modules/.bin/vitest run src/lib/connections/__tests__
node_modules/.bin/tsc --noEmit --pretty false
node_modules/.bin/eslint src/lib/connections
```

Broader existing Studio/adaptive/relationships tests, production build, browser journeys and regressions belong to the coordinator's final candidate packet. No unit/CI badge alone is deployment, provider, device or source-purge proof.

## Current completion boundary

`CONN-001`–`030` have implemented or partial source/fixture slices, with task-specific differences recorded in [BACKLOG.json](BACKLOG.json) and its generated [readable view](BACKLOG.md). None is closed by author assertion. `CONN-031` real-account/device journeys and `CONN-032` live canary/rollback/operator handoff are **NOT RUN / UNAVAILABLE**. Source and local synthetic behavior are reviewable; provider/account/device/deployment admission remains separate.

Readiness requires a frozen reviewed artifact, target-specific UID/IAM/vault/network/proxy checks, provider approval and native rights evidence, actual read/receipt/revoke/refresh journeys, current budgets/kill/retention configuration, and applicable physical-device proof. Existing production bot polling, Telegram webhooks, Studio credentials and service deployment were not changed by these fixture checks. No provider, device or production action is claimed complete.

خلاصهٔ وضعیت: پیاده‌سازی و آزمون‌های محلی با حساب‌ها و داده‌های ساختگی انجام شده است. قابلیت تولیدی فقط خواندن در فضای خصوصی و با مجوز صریح هر حساب و عامل است. نوشتن، ارسال پیام و اقدامات مخرب در استودیو و بروکر غیرفعال‌اند. اتصال واقعی به ارائه‌دهنده، آزمون دستگاه تلگرام، استقرار، حذف کامل نسخه‌های پشتیبان و تأیید زیرساخت هنوز انجام نشده‌اند و آمادهٔ انتشار اعلام نمی‌شوند.
