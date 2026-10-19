# Connections account onboarding and offline configuration

This source slice provides 14 typed API providers and two separately gated read workers. No provider account was connected while implementing these files. Real identity, granted scopes, resources, account eligibility, provider writes and production admission remain **UNAVAILABLE** until their separately authorized checks run.

## Generate and validate a concrete configuration

From the repository root:

```sh
npm run connections:config -- generate --out /absolute/path/to/review-examples
npm run connections:config -- check \
  --manifest /absolute/path/to/review-examples/connections.manifest.example.json \
  --broker /absolute/path/to/review-examples/broker.example.json
```

The underlying command is `node --import tsx scripts/connections-config.mjs`; it accepts only `generate --out DIR` or `check --manifest FILE --broker FILE`. Generation creates three new files and refuses to overwrite an existing target. `connections.manifest.example.json` contains all 16 synthetic per-person/space profiles; `broker.example.json` contains schema-valid paths and an empty enabled-provider/OAuth list; `provider-setup.examples.json` explains the actual minimum auth/resource shape and provides schema-valid arguments for one read tool per provider. Generated files have no credential, client secret, private key or provider account directory. They start disabled, unqualified, with empty evidence and zero budgets. The synthetic Telegram/account/resource IDs must never be promoted as actual identity evidence.

The validator imports the same manifest and broker schemas used by the application, builds a separate canonical catalog for every account/space partition, and checks endpoint/provider binding, resource/tool compatibility, current OAuth endpoint pins, declared scope coverage and native provider identity/inventory constraints. It rejects a global resource union, credential-profile/provider mismatch, cross-project PostHog inventory, substituted Gamend organization, Work Gmail and attempted worker activation without a configured admission channel. Errors use fixed codes/counts/indexes; they do not print tokens, account IDs, provider responses, resource names or config values.

`PASS` means the **offline configuration shape and cross-file compatibility** pass. Output always contains `realProviderProof: "UNAVAILABLE"`, including when an input claims `qualified:true`. The checker does not inspect the vault/keys, authenticate the deployment UID, call a provider, verify an evidence reference, qualify a declared write scope, start a broker, or enable any feature. Those checks remain distinct. Supply the exact mirrored manifest path in `--manifest`; it must match the broker's `connectionsManifestFile`. Studio and broker must read the same reviewed manifest content and version.

## Per-provider minimum read setup

Every row has a concrete synthetic resource/argument example in the generated setup file. All real account evidence is UNAVAILABLE here. API fallback and official MCP eligibility are separate qualification paths.

| Provider | Minimum auth/identity and selected resource | Initial scope/action boundary |
|---|---|---|
| GitHub | Preferred selected-repository App/fine-grained credential; verify exact repo read and returned owner ID. User OAuth is a distinct supported path using `/user` | `metadata:read` for the repository example. Credential fingerprint is a credential profile, **not** an installation ID. Private-repository OAuth commonly requires `repo`; never infer App permissions from that OAuth scope |
| Notion | Integration token, explicit selected-page sharing; `/v1/users/me` returns bot ID and `bot.workspace_id` | Read-content capability only in the sample. Missing workspace ID denies; names/owner labels cannot replace it. The static integration token path is implemented; Notion REST OAuth/PKCE is not configured by this example |
| Slack | Approved workspace installation and scoped token; `auth.test` verifies user/team; select one C/G channel ID | Initial native channel readback: `channels:read` (or `groups:read` for private channels). Message history additionally needs `channels:history`/`groups:history`. Send requires separate `chat:write`, membership and exact review |
| Drive | Google system-browser OAuth, OpenID identity and reviewed selected-file picker | `openid` plus `drive.file`; one exact file metadata read. Do not widen to full Drive for convenience |
| Docs | Same Google identity, separately selected document with API-compatible `drive.file` rights | `openid` plus `drive.file`; initial bounded text read. Inserts additionally require exact tab/index and fresh document revision |
| Sheets | Same Google identity, separately selected spreadsheet and explicit A1 rectangle | `openid` plus `drive.file`; at most 1000 cells. Literal RAW edits have their own approval and no claim of atomic revision precondition |
| Slides | Same Google identity, separately selected presentation | `openid` plus `drive.file`; bounded text. Replacement additionally binds selected slides and fresh presentation revision |
| Gmail | Personal space only; Google OAuth eligibility/verification/security-assessment or applicable exemption for restricted scopes | `openid` plus `gmail.readonly` in the example. Compose/draft and send are separate; no CC/BCC/attachments or mutable-draft send |
| Figma | Qualified OAuth/PAT, `/v1/me` and explicit file/node access | `current_user:read` for identity plus `file_content:read` for selected node. Custom-client MCP entitlement, seats and beta canvas writes remain separate |
| Forgejo | Dedicated narrowly permissioned application token, registered instance, `/api/v1/user` and exact repository allowlist | `read:repository` only as supported by the **qualified installed version**. Do not assume OAuth scope enforcement |
| Hetzner | Read-only project token and exact selected server read | `project:read` is a declared operator policy label. The API does not supply account/project identity here: use the explicit SHA256 credential-bound profile. Read success never proves `project:read_write`; reboot is privileged and absent from this sample |
| Google Analytics | Google OpenID identity plus actual GA4 property membership | `openid` plus `analytics.readonly`; finite report fields, up to100 rows/93days. Preserve thresholding/timezone/freshness evidence |
| PostHog | Select exact US/EU profile and project/saved insight. Insight-only credential mode avoids broader user access | `insight:read`; identity is explicitly credential-bound when user identity is unavailable. Native user/project identity alternative additionally requires `user:read` and `project:read`. No persons, SQL or CLI execution |
| Gamend | Native delegated MCP credential; current org, grant ownerAdminId, exact game/environment, expiry/revoke, protocol/scopes/operation restrictions verified from `gamend_context` | Selected context read with a native `tenancy:read` grant in this example; the optional reviewed `GameTimezoneController_get` requires its own tool inventory entry; `AnalyticsController_engagement` separately requires `analytics:read`. No native writes/deploy/release right is exposed |
| Browser reader | Separately attested worker service plus broker operation lease and server-registered exact public HTTPS pages | `worker:public_page_read` is an internal policy label, **not OAuth**. Static token enrollment remains unavailable. Only offline/no-JavaScript public-page reading is implemented |
| Server diagnostics | Separately attested worker service, exact literal host IP, unprivileged user, independently verified Ed25519/ECDSA key and service inventory | `worker:service_status` is an internal policy label. Static OAuth/token enrollment remains unavailable; broker-only enroll-runner requires signed deployment admission. Only fixed forced-command `service.status` is implemented; no arbitrary shell or privileged mutation |

For Google, `drive.file` compatibility must be tested on the selected document/spreadsheet/presentation; sharing a Google login does not qualify all features. For Notion and Figma, the integration bot/user identity is not an external resource grant. For PostHog and Hetzner, a credential fingerprint never becomes a person/account identity by changing its display label. A credential rotation changes its fingerprint and requires explicit reviewed rebinding.

## Account and release admission

Replace each synthetic profile through an authorized account-specific qualification: verified provider subject/tenant or explicit credential-profile kind, exact endpoint/region, bounded resource inventory, requested/granted/verified scopes, permitted tools, account restrictions and sanitized receipt references. Record **requested**, **provider-granted**, **API-verified** and **currently agent-usable** scopes separately. The broker's operator-scope list is an assertion, not provider proof. Authentication/read success does not demonstrate write capability. Missing provider evidence must remain visible for that capability.

The manifest is per `accountId + Work/Personal + provider`; the broker compares the provider-returned identity to that exact profile. Resource names/IDs come from its registered inventory, and the current agent grant intersects the same canonical resources before any call. Do not concatenate inventories across people/spaces, copy credentials between Work/Personal, accept a browser-declared subject, or qualify a provider from its OAuth consent alone. Provider scopes cap access; they do not authorize an agent, audience, memory retention, message, cloud restart or deployment.

For supported Google/GitHub OAuth, configure the reviewed application registration and pinned callback in the **broker-only private configuration**. No OAuth profile with a client secret is generated by this helper. Complete consent in the system browser, then return to freshly authenticated Studio to claim the sealed candidate. For operator enrollment, only the independent broker CLI accepts the provider token through stdin; the browser/API does not accept it. An operator may provide an existing broker-owned secret file using stdin redirection:

```sh
node --import tsx scripts/connections-broker.mjs enroll \
  /absolute/broker-only/config.json TELEGRAM_ACCOUNT_ID work FLOW_ID \
  < /absolute/broker-only/provider-token
```

Create and keep secrets on the server under the dedicated broker identity. Do not put token values on command lines, into generated examples, Studio state, logs, chat, model context or source. Actual file ownership/modes, distinct encryption/control keys, independent non-root UID, ambient credential denial and vault access are checked by the separate broker startup path, not this offline checker. Read-only setup does not authorize real-account messaging, spending or cloud changes.

Browser/SSH cards remain unqualified until an independently admitted worker/inventory/identity channel is configured. Their signed admission/bootstrap source and local offline-browser smoke do not close the external deployment gate. See [runner operation boundaries](RUNNER_OPERATIONS.md) and [provider implementation evidence](PROVIDER_IMPLEMENTATION.md). Production bootstrap now installs the guarded runner executor only when runnerAdmissionFile is explicitly configured. The offline validator rejects enabling worker IDs without that file; an absolute file path alone is only a configuration shape check and never attestation/runtime proof.

Only after independent account/resource/security/device evidence passes should an operator enable a bounded profile, set a real sanitized evidence reference, choose a small nonzero budget, and expose its permitted tools. Deploying the source, checking this JSON, storing a credential, authenticating a token or listing tools does not establish a production user journey. Keep per-provider read/write/identity/device/deployment gates separate.

## Verification of this helper

Author fixtures cover all16 generated provider examples and their real strict schemas, disabled defaults, exact canonical resource mapping, cross-file/partition/endpoint checks, credentials omitted from output, wrong OAuth endpoints/scopes, native identity mismatch and unavailable worker admission. The actual generator and checker were run against generated local files: **PASS**, sixteen profiles, zero qualified, globally disabled, `realProviderProof: UNAVAILABLE`. No provider endpoint or private account was accessed.

## Broker client authentication and provider protocol

Studio authenticates users with its existing signed Telegram/account binding. Studio and the separate broker authenticate their internal loopback control/execution requests with a server-only HMAC key, timestamp/nonce/body/path binding and replay checks. This service key is unrelated to a provider access token. Each process needs its own owner-only copy of the same control key; neither copy is the broker's distinct vault-encryption key. Keep the broker under a separate non-root UID, and give Studio no read/decrypt right to the broker vault. The release preflight verifies configured UID/owner/mode/key roles without starting services; actual ACL/IAM and runtime negative-access tests remain a separate admission gate.

The current GitHub, Notion, Slack, Google Workspace/Gmail, Figma, Forgejo, Hetzner, Google Analytics and PostHog adapters call **typed HTTPS APIs** at code-owned fixed origins, with credentials only in server-side Authorization headers. Native Gamend uses its actual finite MCP utility names with the pinned2026-07-28 protocol and verified delegated context. No provider tool discovery enlarges the code-owned action catalog. Official remote MCP availability/Preview/client entitlement is separate; Figma/Slack/Google MCP admission is not inherited from API authentication or from the user's Codex connection. The browser/SSH worker lease channel is a third separately admitted protocol and has no fabricated OAuth token.

## Signed worker admission and deployment preflight

The broker now loads `runnerAdmissionFile` only when explicitly configured. Its strict schema is exported as `runnerAdmissionConfigurationSchema` in `broker/runner-admission.ts`. Each browser or SSH profile binds exactly one account/space, a local `runner-service:` subject and derived `runner-scope:` tenant, an immutable Docker image ID, reviewed seccomp bytes, and finite exact target inventory. A root-owned, non-writable Ed25519 release public key verifies a release-authority signature over the exact configuration digest, identity, evidence reference and expiry (at most30days). The helper exports `runnerProfileConfigurationDigest`, `runnerAttestationPayload` and `runnerScopeTenant` so an independently authorized release signer can build the precise reviewed record. No signer key, signature or trust assertion is generated by onboarding. A changed/missing config/public key/seccomp, signature/target/space mismatch, expiry, missing image or current authority race fails closed.

After an authorized signer and operator complete those deployment gates, the existing pending flow can be sealed using the independent broker CLI, with no OAuth token or stdin secret:

```sh
node --import tsx scripts/connections-broker.mjs enroll-runner \
  /absolute/broker-only/config.json TELEGRAM_ACCOUNT_ID work FLOW_ID
```

The broker records an internal `runner-local:` lease marker with explicit runner-attestation evidence, compares the signed local service identity to the exact manifest and still requires freshly authenticated Studio claim. The marker is not a bearer credential to an external target. Browser/SSH calls use the normal reviewed catalog/grant/ledger and recheck the live sending lease, current connection/person/space/source policy before fetch, before worker dispatch and before output. Broker restart or disconnect does not create a new authority.

Release templates are supplied under `services/connections-broker/systemd/` and `services/connections-broker/launchd/`. They are inactive files; no user/service was created, loaded, enabled or started. Review actual node/tsx/artifact paths and dedicated non-root identities before installation. The separate readonly preflight command is:

```sh
npm run connections:preflight -- \
  --manifest /absolute/connections.manifest.json \
  --broker /absolute/broker-only/config.json \
  --studio-auth-key /absolute/studio-only/control.key
```

Run it as an authorized deployment operator able to inspect the relevant role files. It checks the exact config schemas, existing distinct non-root principals, owner/mode/symlink/hardlink roles, matching Studio/broker copies of the control key and a distinct vault key. It creates nothing, contacts no provider and prints no key values. `runtimeIamProof`, ACL evidence and real provider proof stay UNAVAILABLE. The command was exercised against disabled example config with nonexistent deployment roles/keys and correctly returned FAIL; five pure metadata/key-role fixtures passed, and the launchd plist passed `plutil -lint`. This is not a verified host/service deployment.

**Docker daemon access can confer host privilege.** A different Unix UID and a network-none container do not prove that a credential-bearing orchestrator cannot control its host. A dedicated worker daemon/host or independently reviewed restricted Docker proxy is a mandatory deployment gate; its actual IAM/kernel/escape evidence remains UNAVAILABLE. No worker mounts a daemon socket, but the orchestrator's own daemon access still requires that independent review. SSH disposable-host/native-systemd qualification likewise remains UNAVAILABLE.

Model tasks require an explicit exact `modelPolicy` provider/model with `qualified:true` and evidence in the manifest. The generated examples omit this policy, so real LLM execution is denied by default. Neither a provider account qualification nor an operator budget silently qualifies a model destination.
