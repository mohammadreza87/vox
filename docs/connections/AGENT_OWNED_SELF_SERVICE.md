# Agent-owned connections: implementation contract

Scope: CONN-002 / CONN-005 / CONN-009, candidate based on
`4afab485c6e353d12d1a0b0cbd2c9baf4a2e4fb1`.

## Delivered foundation

Connections created from an agent page are schema 2 and have a required immutable
`agentId`. A different agent gets a different connection and credential, even for
the same provider account. Grants, catalogs, resource selections, budgets, final
worker fences, encrypted vault AAD and runner admission resolve this binding.
Legacy schema 1 records remain unbound and are visible only in the account view;
they are never automatically assigned, migrated or reused by an agent. Connecting
creates no tool/resource grant. Owners can revoke one agent without affecting a
second agent. The manager API retains its existing membership requirements.

The source now also includes public bot self-service for the compatible MCP
profile below. Fixed API-provider profiles remain the legacy operator-qualified
path; they are not represented as self-service sign-in. The new bot route does
not create company membership. Production activation still requires the
independent broker, manifests, callback relay and user-provider verification.
Synthetic provider traffic and encrypted local-vault tests are not live provider
evidence.

## Required public bot experience

A person opens an agent's own Telegram Mini App and chooses Connections. They can
connect their own OAuth account, or enter the URL of a compatible public HTTPS MCP
server. The person reviews the external server and the tools/data the agent may
use. An OAuth callback returns them to the same bot's authenticated setup claim;
a callback by itself cannot activate a credential or grant authority. Each agent
has separate account setup, selected resources, tools and disconnect controls.
No company membership, role escalation or operator-written per-person profile is
created merely by starting a public bot. Existing personal identity confirmation
and applicable user-controlled settings remain authoritative.

## Implemented seams and required operational verification

1. **Bot principal.** A route-scoped endpoint selects one current active agent and
   that bot's token, then verifies Telegram initData only with that token. The
   route `agentId` is a routing hint until verification succeeds. No loop over
   tokens and no manager-token fallback. The verified principal is server-owned
   and contains accountId plus botAgentId. Current active/visibility/block rules
   apply at each authority boundary. Public bot users can own their personal
   partition without becoming Studio members. Private/org agents retain their
   existing access rules.
2. **Opaque-ID fences.** Resources, grants, enrollment setup/claim/cancel, task,
   action review/approve/cancel/execute and disconnect resolve stored connection
   binding against the verified bot principal before reading private payloads or
   reaching the broker. A body/query agentId cannot replace the principal. Broker
   setup-flow binding includes the agent and fresh claim must match it. Cache
   keys include the verified bot agent; background worker context cannot infer a
   company role or bypass current block/revocation state.
3. **Provider templates.** Operator configuration registers provider endpoints,
   app-client identity and supported scopes, not user account IDs/subjects.
   The actual account subject/tenant is verified from the provider after OAuth,
   sealed in the independent broker and committed after authenticated claim.
   Resources are selected by that person and verified with that credential.
   Reauthorizing with a different subject requires explicit reconnect/review.
4. **Custom MCP endpoint.** User-supplied URLs are only accepted through explicit
   authenticated setup UI. Public HTTPS only; no userinfo, fragments, local/file
   protocols, stdio, shell, private network, cloud metadata IPs or implicit
   redirects. Resolve and validate every address on every request, connect to the
   validated pinned address with original TLS server name, and repeat for every
   discovery/OAuth/token/MCP target. Reject ambiguous/noncanonical URL forms.
   Redirects are rejected rather than forwarding tokens. DNS response limits,
   timeout/body/tool/schema limits and cancellation are mandatory.
5. **MCP OAuth.** Support RFC 9728 protected-resource metadata, RFC 8414 and OIDC
   issuer discovery, OAuth 2.1 authorization code with S256 PKCE, unpredictable
   single-use state, exact callback/issuer binding and RFC 8707 `resource` in both
   authorization and token exchange. Prefer a registered client app, then client
   ID metadata where supported; dynamic registration is separately gated. Do not
   forward a token issued to a different audience. Signed JWT access tokens require discovered public JWKS, allowed asymmetric
   algorithm, exact issuer and one exact resource audience, expiry and scopes.
   Opaque tokens/introspection and browser bearer-token entry are unsupported.
   A verified access-token issuer/audience does not establish a verified human
   account identity: that evidence is explicitly unavailable for custom MCP.
   Credentials bind the exact canonical MCP resource URI (including its path)
   and issuer, rather than only an origin, and never enter Studio/browser
   storage, model context, chat, logs or exported metadata.
6. **Dynamic catalog.** Treat server tools, descriptions, annotations, prompts and
   resources as untrusted content. A read-only hint cannot authorize an effect.
   Bind every reviewed tool/schema and resource selection to a catalog digest;
   changed catalog or schema requires re-review. Unknown tool effects require an
   exact action preview. No tool-selected endpoint, environment variables,
   arbitrary transport, automatic credentials, automatic grants or cross-agent
   reuse. Account-level server permission can be broader than an agent grant;
   the effective agent grant remains the intersection.
7. **Execution.** Before every provider call and every emitted result part check
   current user/bot/agent/binding/grant/resource/catalog/expiry/revocation state.
   Retain provenance and permitted audience/purpose/destination in source labels.
   Model-selected or inferred identity never authorizes access. An uncertain
   side-effect result is not retried automatically. Generic write operations
   require exact user review and provider-specific idempotency/reconciliation
   evidence before autonomous retries are supported.

## Public and private routes

> **Agent-signed trust hotfix (October 2026).** An agent's creator owns its bot and
> can read its token in BotFather, so agent-signed initData can be forged (now
> blocked: Telegram's Ed25519 signature is required) or harvested by a repointed
> menu (not blockable). The bot surface below is therefore a **read-only
> dashboard**: every other route, including `profile/confirm`, answers 404, and
> the page shows "Manage connections in Vox". Connecting, granting, tasks and
> identity confirmation move to the VoxxBot-signed Vox Mini App. The pet no longer
> links here. See [PRODUCTION.md](../PRODUCTION.md#agent-bot-tokens-are-not-voxs-alone).

- Bot-owned UI: `/studio/connect/[agentId]` (read-only).
- Authenticated bot API: `/api/agents/[agentId]/connections/[[...path]]`.
  Only the dashboard `GET` is served; `POST profile/confirm` and every other route
  answer 404 on this surface (it previously minted the account's identity binding
  for whoever presented initData signed with the agent's token).
- `POST mcp/enroll` accepts only space, agentId, endpointUrl and displayLabel.
  `setup` starts/resumes sign-in; `mcp/setup/preview` returns a safe server catalog;
  `mcp/setup/claim` requires the exact accepted catalog digest. No automatic grants.
- Public Next routes `/oauth/callback/remote_mcp` and
  `/oauth/client-metadata.json` relay over signed private broker control. Callback
  HTML does not reflect code/state/errors or activate access. Metadata is a
  strict public allowlist with one exact same-origin callback. Proxy/access logs
  must omit callback query strings.
- Credential calls stay in the independent broker; Studio stores only schema2
  mcp metadata and safe catalog snapshots. Broker/config rollback is separate
  from the Studio release admission scanner.

## Compatibility promise

Initial compatible servers must support public HTTPS Streamable HTTP and bounded
JSON/JSON-SSE responses at a declared supported MCP protocol version. OAuth
servers must expose standards-compliant metadata, public JWKS and signed JWT
access tokens, and accept a preregistered client or client-ID metadata document,
exact resource indicators and S256 PKCE. Dynamic registration and opaque-token
introspection are unsupported. Unsupported
registration/transport/auth/schema types display a concrete reason; do not claim
'any MCP server'. Browser automation, SSH/stdio, private/local network endpoints,
custom JS execution, delegated company admin accounts and undocumented identity
proofs remain outside this contract.

## Acceptance and rollout gates

- Synthetic two-person/two-agent tests: same provider, different and same external
  accounts, correct token route, wrong bot/user/agent/space/connection/flow IDs,
  pending/no Studio member, public/private/org agent, blocked/fired/rotated token,
  profile expiry/rebind, catalog changes, revoke during call/result/refresh.
- Network tests: rebinding, mixed public/private DNS, redirect to private IP,
  IPv4/IPv6 variants, metadata issuer/token cross-host checks, resource mismatch,
  callback CSRF/replay/mix-up, scope escalation, reflected URLs/errors and secret
  absence from telemetry/UI/storage.
- Independent security review on an exact candidate before credentials activate.
- Independent broker UID, vault/auth keys with distinct paths, public callback
  reverse-proxy, production manifest/templates, rollback admission and retention.
- Real authorized end-user journey with at least two independent users and two
  bots, actual provider account choice, approved bounded read and revocation.
  Source/tests/health alone do not prove live delivery.

## Primary references checked 2026-10-22

- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP security practices: https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices
- Telegram Mini App validation: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

The references inform the proposed contract; they do not certify the current
implementation or create permission for live credentials/provider actions.

## Persistence and rollout capability

`STUDIO_CONNECTIONS_CONFIG_FILE` keeps schemaVersion 1 and optional
`selfServiceMcp: { enabled, dailyModelTokenCeiling, dailyToolCallCeiling }` without
individual user/account subjects. The broker's separate private configuration
has optional `selfServiceMcp: { enabled, callbackUrl, clientMetadataUrl?,
registeredClients?, scopes? }`; registered app-client secrets stay there only.

Schema2 connections optionally include
`mcp: { canonicalResourceUri, catalog: null | McpCatalogSnapshot }`. The snapshot
has schemaVersion 1, exact resource, protocolVersion `2025-11-25`, bounded tools
and catalogDigest. A provider account records `identityEvidence: unavailable`
with an opaque authorization subject, never a claimed verified human subject.
Current release admission requires `supportedSelfServiceMcpSchemas: [1]` when
that configuration property, pending/active mcp metadata or unavailable identity
evidence exists, even if the feature is disabled. An older strict parser cannot
be installed as a rollback over these records.

Same-person account reconfirmation renews management of existing credentials;
it never renews old grants, sources or operations. The owner must explicitly stop
old access and review a fresh grant under the new binding. Different person,
space, audience or bot identity never inherits credential management.
