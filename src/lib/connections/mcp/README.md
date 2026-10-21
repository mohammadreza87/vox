# Self-service remote MCP broker

Author slice: CONN-002 / CONN-005 / CONN-009 agent-owned self-service extension.
Implementation baseline: `c0a31362fe1e239442f775596f8073864ba877f5` plus the
pre-existing shared foundation WIP. This directory owns only generic MCP broker
code and synthetic tests. Shared connection records, bot authority, HTTP, UI,
bootstrap and release admission are implemented by their assigned owners.

## Integration

`SelfServiceMcpBroker` runs only in the independent credential-bearing broker.
Its constructor requires the existing signed `BrokerControlPlane`, `BrokerVault`,
a public callback at `/oauth/callback/remote_mcp`, application client configuration,
and an `activate(current, activation)` callback. That callback must atomically
publish the reviewed safe catalog, update the exact pending connection revision,
and create provider authorization metadata. It creates zero grants.

- `beginSetup({actor,space,connectionId,expectedRevision,endpointUrl})` requires an
  existing schema 2 pending connection whose `mcp.canonicalResourceUri` equals the
  exact endpoint. It returns an authorization URL with opaque state and S256 PKCE.
- `callback(query)` consumes state once, exchanges only at the discovered issuer,
  discovers a catalog using the sealed credential, and returns a pending receipt.
- `previewSetup({actor,space,flowId})` returns untrusted safe catalog presentation.
- `claimSetup({...actor,space,flowId,acceptedCatalogDigest})` requires the same bot
  authentication revision, current owner/person/binding and reviewed digest.
- `cancelSetup(...)` deletes the pending credential. Callback alone activates
  neither a connection credential nor a tool/resource grant.
- `credentialForAuthority(current)` supplies the existing broker's credential hook.
  Refreshes include the exact resource indicator and current authority checks.
  An interrupted refresh leaves the credential fenced as `refreshing`; it is not
  retried automatically. Reconnect is required after an uncertain refresh.
- `revoke(current)` requires committed control-plane revocation and deletes only
  the exact bound flow, pending credential, active credential and broker config.
  External provider token revocation remains `unavailable`.

`McpConnectionsCatalog(snapshot)` implements the existing ConnectionsCatalog.
`createPendingMcpCatalog(resource)` supplies an empty catalog during setup.
`McpBrokerExecutor(catalog, transport, assertCurrent)` is the existing executor
interface. `assertCurrent` must check the exact operation with the signed control
plane while it is dispatchable. The executor rediscovers and compares the catalog
before `tools/call`, never automatically retries, and checks authority again before
returning its buffered untrusted result. Production transport checks authority
after DNS and again after TLS establishment immediately before writing headers or
body. Buffered SSE publishes one result after the final fence; it emits no interim
parts to the model, browser or chat.

Safe schema 2 connection metadata is
`mcp:{canonicalResourceUri:string,catalog:null|McpCatalogSnapshot}`. Snapshot schema
1 binds the exact resource, protocol `2025-11-25`, complete bounded tool descriptors
and digest. Provider/adapter IDs are `remote_mcp`, adapter version `1.0.0`, endpoint
profile is `mcp-<SHA256 of canonical resource URI>`. Persist the catalog only after
a fresh reviewed claim. No provider token, PKCE verifier, client secret or external
human subject is in this metadata. An opaque access token provides no verified
human identity: random `authorization:<UUID>` subjects identify only each separate
authorization, with `identityEvidence:unavailable` in safe presentation/activation.

## Supported compatibility

Public canonical HTTPS DNS names on port 443, exact path, no query/fragment/userinfo;
Streamable HTTP POST with bounded JSON or JSON-SSE responses, initialized/session
handling, up to five tools/list pages and 100 tools/40 KB of catalog. Every DNS
answer must be public (maximum 16 answers); the selected validated address is
pinned while TLS verifies the original hostname. Redirects, response compression,
private/local/metadata addresses and ambiguous URL forms fail closed. Overall
request deadlines include DNS, cancellation and bounded headers/bodies.

OAuth supports RFC 9728 resource metadata, RFC 8414 or OIDC discovery, exactly one
advertised issuer, authorization code, S256 PKCE, exact callback/state/issuer and
RFC 8707 resource on exchange and refresh. Use a registered application client
with `none` or `client_secret_post`, or a configured public client ID metadata URL
when advertised. Configured scopes must be advertised by the resource. No dynamic
registration, bearer-entry UI, private endpoints, stdio, shell, arbitrary JS,
implicit grants or cross-agent credentials are supported. Servers requiring other
registration/auth methods, multiple-issuer selection, protocol versions, resumable
long SSE streams, server-to-client requests or unsupported schema keywords receive
a concrete incompatibility reason.

The code-owned schema subset supports typed objects/arrays/scalars, properties,
required, boolean additionalProperties, items, enum/const, descriptions/titles,
number bounds, lengths and item bounds. `$ref`, schema execution and implicit
network schema resolution are rejected. All discovered tools are `privileged`
and `reconcile_only`; read-only hints and descriptions never confer read access.
The selected resource is the complete server authorization URI. Generic tools
cannot prove narrower provider-internal resource restrictions; external account
permissions can remain broader than the user's explicit agent grant.

## Evidence and gates

`npx vitest run src/lib/connections/mcp --reporter=verbose` exercises synthetic
OAuth/MCP over a real local HTTP fixture behind a test-only sender, encrypted
FileBrokerVault, separate people/agents with the same synthetic token, callback
replay/mix-up/expiry, explicit catalog claim, resource/scopes, catalog drift,
revocation/refresh/unknown outcomes, DNS/private IP/redirect limits and paused
DNS/connect withdrawal. A real local HTTPS fixture in isolated child processes
uses a temporary test CA to verify production sender pinning/SNI, rejection of an
untrusted certificate and no credential bytes after authority withdrawal.
These fixtures make no live provider or end-user qualification claim.

Remaining gates: independent security/QA acceptance on the exact combined
candidate; shared HTTP/UI integration evidence; independent broker UID and vault/
service-key IAM; trusted reverse proxy/public callback/CIMD document; enabled
manifest/client templates; documented vault retention/rotation/restore and rollback
admission; and an explicitly authorized real provider journey with two users/two
bots, exact reviewed action and revocation. This source slice authorizes none of
those external actions.

Primary references checked 2026-10-22:
https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
