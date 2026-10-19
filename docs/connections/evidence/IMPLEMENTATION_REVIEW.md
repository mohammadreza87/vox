# Independent Connections implementation review

Evaluator: independent GPT-6.1 Sol/high security/QA agent using `vox-connection-security` and `vox-connection-qa`. Evaluation date: 19 October 2026. Authors and evaluator have separate file ownership. This report establishes source and bounded local fixture evidence; deployment IAM and native account qualification remain separate.

## Exact reviewed candidate

Combined branch `codex/studio-connections`, HEAD `cae9d1e84336959dbaa4f4ef8e50cb4204854ded`, includes merge `f417c31` of exact `origin/develop` revision `849e77b` and current agent-block/provider-request authorization fixes. The final independent tests are uncommitted additions on this HEAD. The report was refreshed after the root owner declared source freeze.

Compared with baseline `e1186f258d38de538c8f20537ee7579f577f1269`, the final non-document changed-file manifest contains **194 files**, SHA-256 **`9c890bb050fa423653ff6e8461bf8e4726b1400b277f5547af42c74cbd7834ff`**. Reproduce by taking the sorted union of `git diff --name-only <baseline>` and `git ls-files --others --exclude-standard`, retaining existing files except `docs/**` and `README.md`; build ordered objects `{path,sha256}` using exact file bytes, serialize JSON with sorted keys and separators `(',', ':')`, then SHA-256 the JSON bytes. Documentation is excluded to avoid a self-referential report hash. Any code/configuration/test change after this snapshot invalidates the manifest and requires affected verification. This source manifest is not a compiled release artifact digest.

## Independent evidence

All accounts, signing/encryption keys, credentials, resources, models, DNS answers and provider responses used here are explicit synthetic fixtures. Real authenticated routers, adaptive identity repositories, connection policy/repository/ledger/lineage, filesystem persistence, encrypted vault, typed provider registry, workflow scheduler, and isolated task runtime execute in tests. Injected model/DNS/provider seams record transmissions without accessing native providers or production configuration. React tests render real components in jsdom. Actual local broker HTTP and offline Docker/Chromium checks are identified separately below.

| Independent suite | Cases | Result |
|---|---:|---|
| Core/ledger/lineage/filesystem (`integration-security`) | 35 | PASS |
| Model → policy → ledger → typed adapter/skills (`integration-task-runtime`) | 16 | PASS |
| Account-bound production application/inventory/model policy (`integration-application`) | 17 | PASS |
| Real broker/OAuth/vault/core interfaces and loopback HTTP (`integration-broker`) | 13 | PASS |
| Durable concurrent/restarted budget reservations (`integration-budgets`) | 10 | PASS |
| Draft/review/pause, schedules/events/native evidence (`integration-workflows`) | 14 | PASS |
| Signed worker → actual reverse-control handler (`integration-signed-worker`) | 2 | PASS |
| DNS/HTTPS/dispatched uncertain outcomes (`security-transport`) | 19 | PASS |
| Actual authenticated HTTP router (`security-http`) | 14 | PASS |
| Real adaptive authority/current membership/agent blocks (`security-authority`) | 10 | PASS |
| Actual Connections/workflow component render (`security-ui`) | 7 | PASS |
| HMAC/key compatibility/encrypted vault/ambient credentials (`security-broker`) | 10 | PASS |
| Browser/SSH/container source boundaries (`security-runners`) | 8 | PASS |
| Native identity/explicit credential-resource admission (`security-provider-identity`) | 13 | PASS |
| Raw signed minimized provider events (`security-events`) | 7 | PASS |
| Signed runner deployment admission/final-use fences (`security-runner-admission`) | 8 | PASS |
| **Consolidated independent result** | **203** | **PASS, 16 suites** |

Commands: `node_modules/.bin/vitest run src/lib/connections/__tests__/integration-*.test.ts src/lib/connections/__tests__/security-*.test.ts`; `node_modules/.bin/tsc --noEmit --pretty false`; `node_modules/.bin/eslint src/lib/connections/__tests__/integration-*.test.ts src/lib/connections/__tests__/security-*.test.ts`. Consolidated independent **203/203 PASS**, full TypeScript **PASS**, independently owned tests ESLint **PASS with zero warnings/errors**. The last edit only removed unused local destructuring from the scripted-model snapshot helper; its affected 16-case suite was repeated and passed. The new SDK authorization function is invoked before recording model wire input; nonserializable callback/signal are excluded from snapshots, without weakening authority assertions.

The private HTTP fixture starts the actual broker server on an ephemeral `127.0.0.1` port and uses its actual signed client with synthetic keys. Real broker/core/vault/executor interfaces complete a read. Unsigned/wrong-key execution cannot reach the executor, exact HMAC replay is denied, duplicate OAuth query keys fail, and no operator-token enrollment HTTP route exists. Output excludes credential canaries. The server is closed afterward. This is actual local HTTP, while implementations still share the test process/OS identity.

The independent local Docker smoke used immutable image **`sha256:bac48b77b4c9c885ab076f689b318de31455fcf39b76a36b246da2f923c2c9ef`**, seccomp SHA-256 **`513c31efdc06215e0c5c84cc60cbef110ea619962df9e78d62a68633094cbeab`**, the existing local Docker Unix socket, and source network-none/nonroot/cap-drop/read-only/resource limits. The offline HTML included a visible canary, a script attempting page replacement, and an external iframe. Actual output was `title:"Independent QA", text:"OFFLINE_QA_CANARY_622", offline:true, javascript:false, interactive:false`. No script execution/external content appeared. This qualifies this exact local offline browser fixture; it does not qualify authenticated browsing, SSH, a production runner or host-escape resistance.

## Findings resolved and independently regressed

1. **Dispatched effects:** unusable write responses/redirects now preserve unknown outcome rather than offering safe retry. Held-out transport cases originally failed and now pass.
2. **Source authority:** cached sources and every parent recheck live person binding, agent membership, grant expiry/revision, connection epoch, tombstones and destination restrictions. A derived cross-connector result cannot survive original-source revocation.
3. **Consent usability:** server maximum grant expiry bounds real UI choices; initial choices exceeded the verified binding lifetime. Work/Personal transitions clear private labels, and Persian RTL plus disabled-provider state render correctly.
4. **Generated input lineage:** code-owned generation source union prevents model omission; tainted generated arguments stay ephemeral. A second real typed read succeeds without retained source-derived arguments. Explicit model-processor destination consent is required independently of private reply permission.
5. **Purge honesty:** source suppression/current payload deletion reports global purge pending. File generation cleanup removes unreferenced generations under lock. Fixture reconstruction verifies current and prior retained-file canary removal; this is not a production backup/restore drill.
6. **Enrollment/broker lifecycle:** active-provider uniqueness is transactional. Pending/sealed OAuth revoke, late exchange, interrupted claim convergence, independent reads, grant-only abort, rotated-token cleanup, and persisted ambiguous-refresh revocation all have held-out regressions. Known pre-dispatch failure terminates fenced work safely without a provider call.
7. **Budgets/model authority:** zero omitted caps deny spend; durable concurrent budgets and restart preserve caps. Authority rechecks after budget reservation and at the SDK transmission boundary. Current agent blocks deny use immediately. Kill switches, model-policy withdrawal/change, and hung-model cancellation suppress continuation/effects/output. Missing/unqualified/mismatched actual model identity cannot run a task.
8. **Workflows/events:** exact draft review precedes activation; pause and expired authority suppress dispatch. A stale rule pauses quietly with zero calls rather than blocking unrelated rules. Stable occurrences deduplicate concurrent drains. All-day quiet/no eligible slot is rejected. Actual provider egress destinations and the central tool budget apply to scheduled reads. Signed raw event bodies deduplicate even when an unsigned delivery ID changes; normalized event metadata alone cannot authorize a subsequent step. Native readback mismatch suppresses later reads. GitHub App installation events remain unavailable pending a separate installation-identity proof; supported owner-scoped repository-hook events do not compare unrelated identifier namespaces.
9. **Service authentication:** both services read separate owned 0600 copies of the same 64-hex key representation. Mode/owner/symlink checks, exact signatures, replay/body/path binding, and actual ambient VOXX/model credential variable rejection pass independent fixtures.
10. **External effects:** production application discovery/grants/execute and the broker are read-only. Private Vox reply audience plus generic provider destination cannot establish native external recipient authorization. Sending/changing must remain blocked until a fresh provider-native audience/disclosure contract participates in preview, approval and pre-send checks. Synthetic effect ledger coverage does not enable production writes.
11. **Worker admission:** signed per-account/space service inventory binds exact targets, image/socket/profile configuration, qualification evidence and expiry. Held-out changes to inventory/socket/evidence, a correctly signed wrong tenant/overlong approval, runtime seccomp mismatch, changed configuration, and revoke after worker completion all fail closed. Worker identity is explicitly a local service identity, never fabricated OAuth/native account authentication. SSH runbook input is bounded and fixed-command; actual SSH execution remains unavailable.

## Disabled source rollout assessment

**No source-level security blocker was found for deploying this combined candidate with Connections globally disabled**, subject to the root owner's complete build/regression and release checks. Missing `STUDIO_CONNECTIONS_CONFIG_FILE` resolves to `enabled:false, profiles:[]`; absent broker URL/key creates neither a broker client nor reverse-control authenticator. Dashboard is disabled. Setup/enrollment, grants/resources, model tasks, provider execution and workflow activation fail closed. No automatic broker, scheduler or worker startup occurs in Studio. Local revoke/cancel/pause remain available where authority/state exist.

Before such a rollout, verify presence-only absence of all three Connections configuration/broker environment settings and absence of a broker/worker service or provider webhook ingress; bind deployment to the tested immutable build, then verify existing Studio/Telegram health and rollback. Deploying disabled source does **not** activate or qualify providers, model tasks, workflows/events, browser/SSH runners or real accounts. This evaluator did not access production environment values or deploy anything.

## Unavailable activation/release evidence

| Required evidence | Status |
|---|---|
| Exact native provider OAuth/account/scope/subject/tenant/revoke/refresh per enabled account | UNAVAILABLE |
| Actual external model processor identity/account/privacy/retention qualification | UNAVAILABLE |
| Separately deployed broker service UID, vault/key permissions, network/egress isolation | UNAVAILABLE |
| Dedicated worker daemon/host or constrained orchestrator IAM unable to access Studio/vault/user files | UNAVAILABLE |
| Disposable SSH host full execution and independent native host-key qualification | UNAVAILABLE |
| Real Telegram EN/FA iOS/Android/Desktop OAuth, private/group voice and existing-agent flows | UNAVAILABLE |
| Retention consumer acknowledgments and physical purge/history/vector/cache/backup/restore | UNAVAILABLE |
| Exact deployed artifact, public endpoint, Telegram interaction, rollback and operator kill drill | UNAVAILABLE |

Docker daemon API access can confer host privileges despite distinct broker/Studio UIDs. Container flags, signatures and an offline image smoke do not prove safe daemon/host IAM. A dedicated worker host/daemon or constrained orchestrator and measured access controls remain an activation gate. Provider metadata, signed source configuration and operator `qualified` flags are not native account proof. Group connector output and all production external changes remain unavailable.
