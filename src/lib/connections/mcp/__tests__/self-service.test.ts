import { createServer, request, type Server } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfServiceMcpBroker } from '../broker';
import { McpPublicTransport, canonicalMcpUrl, type McpPinnedSender } from '../transport';
import { McpConnectionsCatalog, createPendingMcpCatalog, mcpToolId, snapshotMcpCatalog } from '../catalog';
import { McpBrokerExecutor } from '../client';
import { McpOAuth } from '../oauth';
import { FileBrokerVault } from '../../broker/vault';
import type { BrokerAuthority, BrokerControlPlane } from '../../broker/control';

const resource = 'https://mcp.fixture.net/tenant-a/mcp';
const issuer = 'https://auth.fixture.net/tenant/';
const callbackUrl = 'https://broker.fixture.net/oauth/callback/remote_mcp';
let accessToken: string;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-rsa', use: 'sig' };
function signedToken(claims: Record<string, unknown> = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: issuer, aud: resource, exp: Math.floor(Date.now() / 1000) + 3600, scope: 'files', ...claims })).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), keys.privateKey).toString('base64url')}`;
}
const refreshToken = 'synthetic-refresh-fixture-1234';
const tool = { name: 'files.get', description: 'Untrusted server description', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } };
const actor = { accountId: 'account-a', botAgentId: 'agent-a', botAuthenticationRevision: 'bot-revision-1' };
function currentAuthority(): BrokerAuthority {
  return { context: { accountId: 'account-a', personId: 'person-a', bindingId: 'binding-a', bindingRevision: 1, bindingExpiresAt: Date.now() + 3_600_000,
    currentAgentIds: ['agent-a', 'agent-b'], botAgentId: 'agent-a', scope: { tenantId: 'tenant-a', spaceId: 'personal-a', spaceKind: 'personal', containerId: 'container-a', audiencePersonIds: ['person-a'], audienceRevision: '1' } },
    connection: { schemaVersion: 2, id: 'connection-a', agentId: 'agent-a', providerId: 'remote_mcp', ownerAccountId: 'account-a', ownerPersonId: 'person-a', lifecycle: 'pending', revision: 1,
      mcp: { canonicalResourceUri: resource, catalog: null }, catalogDigest: createPendingMcpCatalog(resource).snapshot.catalogDigest } } as BrokerAuthority;
}
describe('self-service MCP synthetic HTTP/OAuth broker', () => {
  let server: Server; let directory: string; let current: BrokerAuthority; let transport: McpPublicTransport; let broker: SelfServiceMcpBroker; let vault: FileBrokerVault;
  let seen: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[];
  let tokenResponse: Record<string, unknown>; let resourceMetadata: Record<string, unknown>; let authMetadata: Record<string, unknown>;
  let tools: unknown[]; let sse: boolean; let failTool: boolean; let leakToken: boolean; let activationCount: number; let revokeOnCall: boolean; let revokeOnRefresh: boolean;
  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('CryptoKey', webcrypto.CryptoKey);
    seen = []; current = currentAuthority(); tools = [structuredClone(tool)]; sse = true; failTool = false; leakToken = false; activationCount = 0; revokeOnCall = false; revokeOnRefresh = false;
    accessToken = signedToken();
    tokenResponse = { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: 'files', resource };
    resourceMetadata = { resource, authorization_servers: [issuer], scopes_supported: ['files'] };
    authMetadata = { issuer, jwks_uri: 'https://auth.fixture.net/jwks', authorization_endpoint: 'https://auth.fixture.net/authorize', token_endpoint: 'https://auth.fixture.net/token', response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true };
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const raw = Buffer.concat(chunks).toString();
      const body = req.headers['content-type'] === 'application/json' ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
      seen.push({ path: req.url!, headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/.well-known/oauth-protected-resource/tenant-a/mcp') { res.end(JSON.stringify(resourceMetadata)); return; }
      if (req.url === '/.well-known/oauth-authorization-server/tenant' || req.url === '/tenant/.well-known/openid-configuration') {
        if (authMetadata.fixtureOidcOnly && req.url.includes('oauth-authorization-server')) { res.statusCode = 404; res.setHeader('content-type', 'text/html'); res.end('missing'); return; }
        res.end(JSON.stringify(authMetadata)); return; }
      if (req.url === '/jwks') { res.end(JSON.stringify({ keys: [jwk] })); return; }
      if (req.url === '/token') { if (revokeOnRefresh && body.grant_type === 'refresh_token') current.connection.lifecycle = 'revoked'; res.end(JSON.stringify(tokenResponse)); return; }
      if (req.url !== '/tenant-a/mcp') { res.statusCode = 404; res.end('{}'); return; }
      if (req.headers.authorization !== `Bearer ${accessToken}`) { res.statusCode = 401; res.setHeader('www-authenticate', `Bearer resource_metadata="https://mcp.fixture.net/.well-known/oauth-protected-resource/tenant-a/mcp"`); res.end('{}'); return; }
      let result: unknown;
      if (body.method === 'initialize') { res.setHeader('mcp-session-id', 'synthetic-session'); result = { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'Fixture', version: '1' } }; }
      else if (body.method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; }
      else if (body.method === 'tools/list') result = { tools };
      else if (body.method === 'tools/call') {
        if (revokeOnCall) current.connection.lifecycle = 'revoked';
        if (failTool) { res.destroy(); return; }
        result = { content: [{ type: 'text', text: leakToken ? accessToken : 'synthetic document' }] };
      } else { res.statusCode = 400; res.end('{}'); return; }
      const response = { jsonrpc: '2.0', id: body.id, result };
      if (sse && body.method === 'tools/call') { res.setHeader('content-type', 'text/event-stream'); res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`); }
      else res.end(JSON.stringify(response));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    // Synthetic-only sender maps the checked public fixture URL to the local real HTTP server.
    // Production uses sendMcpPinnedHttps with certificate verification; this does not qualify live TLS/DNS.
    const send: McpPinnedSender = async input => { await input.beforeSend?.(); return new Promise((resolve, reject) => {
      expect(input.address).toBe('8.8.8.8'); expect(input.family).toBe(4); expect(input.url.protocol).toBe('https:');
      const req = request({ hostname: '127.0.0.1', port, path: input.url.pathname, method: input.method, headers: input.headers, signal: input.signal }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('end', () => resolve({ status: res.statusCode!, headers: Object.fromEntries(Object.entries(res.headers).filter((x): x is [string, string] => typeof x[1] === 'string')), bytes: Buffer.concat(chunks) }));
      }); req.on('error', reject); req.end(input.body);
    }); };
    transport = new McpPublicTransport({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], send });
    directory = await mkdtemp(join(tmpdir(), 'vox-mcp-fixture-')); vault = new FileBrokerVault(directory, randomBytes(32));
    const control = { async call(input: { actor?: typeof actor; connectionId?: string; space?: string }) {
      if (input.actor?.accountId !== current.context.accountId || input.actor?.botAgentId !== current.connection.agentId || input.actor.botAuthenticationRevision !== actor.botAuthenticationRevision || input.connectionId !== current.connection.id || input.space !== 'personal') throw new Error('fixture authority denied');
      return structuredClone(current);
    } } as BrokerControlPlane;
    broker = new SelfServiceMcpBroker({ control, vault, callbackUrl, transport, clients: { registeredClients: [{ issuer, clientId: 'vox-fixture', scopes: ['files'] }] },
      activate: async (_before, activation) => { activationCount++; current.connection.lifecycle = 'connected'; current.connection.revision++; current.connection.catalogDigest = activation.catalog.catalogDigest; } });
  });
  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); });
  async function begin() {
    const setup = await broker.beginSetup({ actor, space: 'personal', connectionId: 'connection-a', expectedRevision: 1, endpointUrl: resource });
    return { setup, auth: new URL(setup.authorizationUrl!) };
  }
  async function sealed() { const begun = await begin(); await broker.callback({ state: begun.auth.searchParams.get('state'), code: 'synthetic-code', iss: issuer }); return begun; }
  async function active() { const begun = await sealed(); const preview = await broker.previewSetup({ actor, space: 'personal', flowId: begun.setup.flowId });
    await broker.claimSetup({ actor, space: 'personal', flowId: begun.setup.flowId, acceptedCatalogDigest: preview.catalog.catalogDigest }); return { ...begun, preview }; }
  it('resumes the exact sealed setup after a new server-side broker instance without client storage', async () => {
    const first = await sealed(); const restarted = new SelfServiceMcpBroker(broker.options);
    const resumed = await restarted.beginSetup({ actor, space: 'personal', connectionId: 'connection-a', expectedRevision: 1, endpointUrl: resource });
    expect(resumed).toMatchObject({ flowId: first.setup.flowId, status: 'pending', reason: 'catalog_review_required' });
    expect(resumed.authorizationUrl).toBeUndefined(); expect(activationCount).toBe(0);
    expect(seen.filter(call => call.path === '/token')).toHaveLength(1);
    expect((await restarted.previewSetup({ actor, space: 'personal', flowId: resumed.flowId })).catalog.resource).toBe(resource);
  });
  it('a deliberate restart invalidates the previous uncompleted authorization callback', async () => {
    const first = await begin(); const second = await begin(); expect(second.setup.flowId).not.toBe(first.setup.flowId);
    await expect(broker.callback({ state: first.auth.searchParams.get('state'), code: 'old', iss: issuer })).rejects.toThrow('mcp_oauth_state_invalid');
    expect(seen.filter(call => call.path === '/token')).toHaveLength(0);
  });
  it.each([
    { aud: 'https://mcp.fixture.net/tenant-b/mcp' }, { iss: 'https://other.fixture.net/' },
    { aud: [resource, 'https://api.fixture.net/'] }, { exp: 1 }, { exp: undefined },
    { nbf: Math.floor(Date.now() / 1000) + 3600 }, { scope: 'files admin' },
  ])('rejects a genuinely signed token with invalid claims before any MCP bearer request %j', async claims => {
    tokenResponse.access_token = signedToken(claims); const { auth } = await begin();
    await expect(broker.callback({ state: auth.searchParams.get('state'), code: 'x', iss: issuer })).rejects.toThrow('mcp_oauth_verification_failed');
    expect(seen.filter(call => call.path === '/tenant-a/mcp')).toHaveLength(0); expect(activationCount).toBe(0);
  });
  it('rejects a general opaque provider token instead of forwarding it to the custom MCP server', async () => {
    tokenResponse.access_token = 'opaque-general-provider-credential'; delete tokenResponse.resource;
    const { auth } = await begin();
    await expect(broker.callback({ state: auth.searchParams.get('state'), code: 'x', iss: issuer })).rejects.toThrow('mcp_oauth_verification_failed');
    expect(seen.filter(call => call.path === '/tenant-a/mcp')).toHaveLength(0);
  });
  it('reconciles an activation commit whose response was lost without deleting its credential', async () => {
    const { setup } = await sealed(); const preview = await broker.previewSetup({ actor, space: 'personal', flowId: setup.flowId });
    broker.options.activate = async (_before, activation) => {
      activationCount++; current.connection.lifecycle = 'connected'; current.connection.revision++; current.connection.catalogDigest = activation.catalog.catalogDigest;
      current.connection.providerScopes = activation.providerScopes;
      current.providerAccount = { status: 'active', identityEvidence: 'unavailable', issuer: activation.issuer,
        providerSubject: activation.providerSubject, providerTenantId: activation.providerTenantId } as BrokerAuthority['providerAccount'];
      throw Error('lost synthetic response after commit');
    };
    const result = await broker.claimSetup({ actor, space: 'personal', flowId: setup.flowId, acceptedCatalogDigest: preview.catalog.catalogDigest });
    expect(result.status).toBe('connected'); expect(activationCount).toBe(1);
    expect((await broker.credentialForAuthority(current)).accessToken).toBe(accessToken);
  });
  it('binds PKCE/resource to full URI; callback seals only; fresh same-bot reviewed claim activates zero grants', async () => {
    const { setup, auth } = await begin(); expect(auth.searchParams.get('resource')).toBe(resource); expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('state')).toMatch(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    await broker.callback({ state: auth.searchParams.get('state'), code: 'synthetic-code', iss: issuer }); expect(activationCount).toBe(0);
    const exchange = seen.find(call => call.path === '/token')!; expect(exchange.body.resource).toBe(resource); expect(exchange.body.redirect_uri).toBe(callbackUrl);
    expect(exchange.body.code_verifier).toHaveLength(64); expect(exchange.body.client_id).toBe('vox-fixture');
    const preview = await broker.previewSetup({ actor, space: 'personal', flowId: setup.flowId }); expect(preview.catalog.identityEvidence).toBe('unavailable');
    expect(preview.catalog.tools[0]).toMatchObject({ effect: 'privileged', requiresExactReview: true });
    expect(JSON.stringify(preview)).not.toContain(accessToken); expect(JSON.stringify(preview)).not.toContain(refreshToken);
    await expect(broker.claimSetup({ actor, space: 'personal', flowId: setup.flowId, acceptedCatalogDigest: '0'.repeat(64) })).rejects.toThrow('mcp_review_stale');
    await broker.claimSetup({ actor, space: 'personal', flowId: setup.flowId, acceptedCatalogDigest: preview.catalog.catalogDigest }); expect(activationCount).toBe(1);
    const credential = await broker.credentialForAuthority(current); expect(credential.subject).toMatch(/^authorization:/); expect(credential.accessToken).toBe(accessToken);
    const envelope = await readFile(join(directory, 'credential', (await readdir(join(directory, 'credential')))[0]), 'utf8'); expect(envelope).not.toContain(accessToken);
  });
  it.each([{ accountId: 'account-b' }, { botAgentId: 'agent-b' }, { botAuthenticationRevision: 'rotated-bot' }])('denies a mismatched authenticated actor %j before preview/claim', async patch => {
    const { setup } = await sealed(); const other = { ...actor, ...patch };
    await expect(broker.previewSetup({ actor: other, space: 'personal', flowId: setup.flowId })).rejects.toThrow();
    await expect(broker.claimSetup({ actor: other, space: 'personal', flowId: setup.flowId, acceptedCatalogDigest: '0'.repeat(64) })).rejects.toThrow(); expect(activationCount).toBe(0);
  });
  it('rejects callback replay and issuer mix-up before token exchange', async () => {
    const { auth } = await begin(); const state = auth.searchParams.get('state');
    await expect(broker.callback({ state, code: 'x', iss: 'https://other.fixture.net/' })).rejects.toThrow('mcp_oauth_state_invalid'); expect(seen.filter(call => call.path === '/token')).toHaveLength(0);
    await broker.callback({ state, code: 'x', iss: issuer }); await expect(broker.callback({ state, code: 'x', iss: issuer })).rejects.toThrow('mcp_oauth_state_invalid'); expect(seen.filter(call => call.path === '/token')).toHaveLength(1);
  });
  it.each(['scope', 'resource'])('rejects token %s escalation and does not activate', async key => {
    tokenResponse[key] = key === 'scope' ? 'files admin' : 'https://mcp.fixture.net/tenant-b/mcp'; const { auth } = await begin();
    await expect(broker.callback({ state: auth.searchParams.get('state'), code: 'x', iss: issuer })).rejects.toThrow('mcp_oauth_verification_failed'); expect(activationCount).toBe(0);
  });
  it('rejects protected metadata for same origin but a different resource path', async () => {
    resourceMetadata.resource = 'https://mcp.fixture.net/tenant-b/mcp'; await expect(begin()).rejects.toThrow('mcp_oauth_resource_mismatch');
  });
  it('refuses dynamic registration and supports CIMD only when advertised', async () => {
    const oauth = new McpOAuth(transport); const metadata = await oauth.discover(resource);
    expect(() => oauth.selectClient(metadata, {})).toThrow('mcp_client_registration_unsupported');
    expect(oauth.selectClient(metadata, { clientMetadataUrl: 'https://broker.fixture.net/client.json', scopes: ['files'] }).registration).toBe('client_id_metadata');
    expect(() => oauth.selectClient({ ...metadata, clientMetadataSupported: false }, { clientMetadataUrl: 'https://broker.fixture.net/client.json' })).toThrow('mcp_client_registration_unsupported');
  });
  it('supports OIDC discovery fallback and exact issuers without a trailing slash', async () => {
    const exactIssuer = issuer.slice(0, -1); resourceMetadata.authorization_servers = [exactIssuer]; authMetadata.issuer = exactIssuer; authMetadata.fixtureOidcOnly = true;
    broker.options.clients.registeredClients = [{ issuer: exactIssuer, clientId: 'vox-fixture', scopes: ['files'] }];
    const { auth } = await begin(); expect(auth.origin).toBe('https://auth.fixture.net');
    expect(seen.some(call => call.path === '/tenant/.well-known/openid-configuration')).toBe(true);
  });
  it('expired flow and revoked connection reject callback without token exchange', async () => {
    const { setup, auth } = await begin(); const binding = (await vault.binding('flow', setup.flowId))!;
    const flow = await vault.read('flow', setup.flowId, binding) as Record<string, unknown>;
    await vault.write('flow', setup.flowId, binding, { ...flow, expiresAt: Date.now() - 1 });
    await expect(broker.callback({ state: auth.searchParams.get('state'), code: 'x', iss: issuer })).rejects.toThrow('mcp_oauth_state_invalid');
    expect(seen.filter(call => call.path === '/token')).toHaveLength(0);
  });
  it('revocation deletes only this exact connection and makes callback replay unavailable', async () => {
    const { setup, auth } = await active(); const binding = (await vault.binding('credential', 'connection-a'))!;
    await vault.write('credential', 'connection-b', { ...binding, agentId: 'agent-b', connectionId: 'connection-b' }, { accessToken: 'other-synthetic-token' });
    current.connection.lifecycle = 'revoked'; expect(await broker.revoke(current)).toEqual({ futureUseStopped: true, providerRevocation: 'unavailable' });
    expect(await vault.binding('credential', 'connection-a')).toBeUndefined(); expect(await vault.binding('flow', setup.flowId)).toBeUndefined();
    expect(await vault.binding('credential', 'connection-b')).toMatchObject({ agentId: 'agent-b' });
    await expect(broker.callback({ state: auth.searchParams.get('state'), code: 'x', iss: issuer })).rejects.toThrow('mcp_oauth_state_invalid');
  });
  it('same external token in another person/agent vault stays separately bound', async () => {
    const first = await active(); const otherActor = { accountId: 'account-b', botAgentId: 'agent-b', botAuthenticationRevision: 'bot-b-revision' };
    const other = currentAuthority(); other.context.accountId = 'account-b'; other.context.personId = 'person-b'; other.context.botAgentId = 'agent-b';
    other.context.scope.spaceId = 'personal-b'; other.context.scope.audiencePersonIds = ['person-b'];
    Object.assign(other.connection, { id: 'connection-b', agentId: 'agent-b', ownerAccountId: 'account-b', ownerPersonId: 'person-b' });
    const secondBroker = new SelfServiceMcpBroker({ ...broker.options, control: { async call<T>(input: unknown) {
      const request = input as { actor: typeof otherActor; space: string; connectionId: string };
      if (JSON.stringify(request.actor) !== JSON.stringify(otherActor) || request.connectionId !== 'connection-b' || request.space !== 'personal') throw new Error('other fixture authority denied'); return structuredClone(other) as T;
    } }, activate: async (_current, activation) => { other.connection.lifecycle = 'connected'; other.connection.revision++; other.connection.catalogDigest = activation.catalog.catalogDigest; } });
    const second = await secondBroker.beginSetup({ actor: otherActor, space: 'personal', connectionId: 'connection-b', expectedRevision: 1, endpointUrl: resource });
    const auth = new URL(second.authorizationUrl!); await secondBroker.callback({ state: auth.searchParams.get('state'), code: 'same-external-account', iss: issuer });
    const preview = await secondBroker.previewSetup({ actor: otherActor, space: 'personal', flowId: second.flowId });
    await secondBroker.claimSetup({ actor: otherActor, space: 'personal', flowId: second.flowId, acceptedCatalogDigest: preview.catalog.catalogDigest });
    await expect(secondBroker.previewSetup({ actor: otherActor, space: 'personal', flowId: first.setup.flowId })).rejects.toThrow();
    expect(await vault.binding('credential', 'connection-a')).toMatchObject({ accountId: 'account-a', agentId: 'agent-a' });
    expect(await vault.binding('credential', 'connection-b')).toMatchObject({ accountId: 'account-b', agentId: 'agent-b' });
    const firstCredential = await broker.credentialForAuthority(current); const secondCredential = await secondBroker.credentialForAuthority(other);
    expect(firstCredential.accessToken).toBe(secondCredential.accessToken); expect(firstCredential.subject).not.toBe(secondCredential.subject);
    current.connection.lifecycle = 'revoked'; await broker.revoke(current); expect((await secondBroker.credentialForAuthority(other)).accessToken).toBe(accessToken);
  });
  it('executes real JSON-SSE tools call with session/protocol and marks all output untrusted', async () => {
    const { preview } = await active(); const catalog = new McpConnectionsCatalog(snapshotMcpCatalog(resource, tools)); let checks = 0;
    const executor = new McpBrokerExecutor(catalog, transport, async () => { checks++; if (current.connection.lifecycle !== 'connected') throw new Error(); });
    const result = await executor.execute(mcpToolId('files.get'), { id: 'document-a' }, { credential: { providerId: 'remote_mcp', endpointProfileId: catalog.endpointProfileId, accessToken }, operationId: 'operation-a', scopeKind: 'personal' });
    expect(result).toMatchObject({ untrustedContent: true, resourceRevision: preview.catalog.catalogDigest, providerReceiptRef: null });
    expect(checks).toBeGreaterThanOrEqual(6); const call = seen.find(call => call.body.method === 'tools/call')!; expect(call.headers['mcp-session-id']).toBe('synthetic-session'); expect(call.headers['mcp-protocol-version']).toBe('2025-11-25');
  });
  it('changed untrusted description/schema invalidates reviewed catalog before tools/call', async () => {
    await active(); const catalog = new McpConnectionsCatalog(snapshotMcpCatalog(resource, tools)); tools = [{ ...tool, description: 'changed description' }];
    await expect(new McpBrokerExecutor(catalog, transport, async () => undefined).execute(mcpToolId('files.get'), { id: 'x' }, { credential: { providerId: 'remote_mcp', endpointProfileId: catalog.endpointProfileId, accessToken }, operationId: 'operation-a', scopeKind: 'personal' })).rejects.toMatchObject({ outcome: 'not_dispatched' });
    expect(seen.filter(call => call.body.method === 'tools/call')).toHaveLength(0);
  });
  it.each(['revoke', 'secret', 'network'])('denies %s after dispatch with uncertain result and no retry', async mode => {
    await active(); const catalog = new McpConnectionsCatalog(snapshotMcpCatalog(resource, tools)); revokeOnCall = mode === 'revoke'; leakToken = mode === 'secret'; failTool = mode === 'network';
    const executor = new McpBrokerExecutor(catalog, transport, async () => { if (current.connection.lifecycle !== 'connected') throw new Error('revoked'); });
    await expect(executor.execute(mcpToolId('files.get'), { id: 'x' }, { credential: { providerId: 'remote_mcp', endpointProfileId: catalog.endpointProfileId, accessToken }, operationId: 'operation-a', scopeKind: 'personal' })).rejects.toMatchObject({ outcome: 'unknown' });
    expect(seen.filter(call => call.body.method === 'tools/call')).toHaveLength(1);
  });
  it('revocation during refresh denies the new token and never retries the refresh', async () => {
    await active(); const binding = (await vault.binding('credential', 'connection-a'))!; const credential = await broker.credentialForAuthority(current);
    await vault.write('credential', 'connection-a', binding, { ...credential, expiresAt: Date.now() + 1 }); revokeOnRefresh = true;
    await expect(broker.credentialForAuthority(current)).rejects.toThrow('mcp_credential_unavailable');
    current.connection.lifecycle = 'connected'; await expect(broker.credentialForAuthority(current)).rejects.toThrow('mcp_credential_unavailable');
    expect(seen.filter(call => call.path === '/token' && call.body.grant_type === 'refresh_token')).toHaveLength(1);
  });
  it('refreshes only the same resource with current authority', async () => {
    await active(); const binding = (await vault.binding('credential', 'connection-a'))!; const credential = await broker.credentialForAuthority(current);
    await vault.write('credential', 'connection-a', binding, { ...credential, expiresAt: Date.now() + 1 });
    const refreshed = await broker.credentialForAuthority(current); expect(refreshed.accessToken).toBe(accessToken);
    expect(seen.filter(call => call.path === '/token').at(-1)?.body).toMatchObject({ grant_type: 'refresh_token', resource });
  });
});

describe('public network and untrusted schema fences', () => {
  it.each(['http://public.fixture.net/mcp', 'https://127.0.0.1/mcp', 'https://[::1]/mcp', 'https://2130706433/mcp', 'https://PUBLIC.fixture.net/mcp', 'https://public.fixture.net:443/mcp', 'https://user@public.fixture.net/mcp', 'https://public.fixture.net/a/../mcp', 'https://public.fixture.net/%2e%2e/mcp', 'https://public.fixture.net/mcp?q=x', 'https://public.fixture.net/mcp#x', 'https://local.internal/mcp'])('rejects ambiguous or unsupported URL %s', input => { expect(() => canonicalMcpUrl(input)).toThrow('mcp_url_unsupported'); });
  it.each(['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2001:db8::1'])('rejects mixed public/private DNS %s without sending', async address => {
    let sent = false; const transport = new McpPublicTransport({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }], send: async () => { sent = true; throw new Error(); } });
    await expect(transport.request({ url: resource, method: 'GET' })).rejects.toThrow('mcp_address_denied'); expect(sent).toBe(false);
  });
  it('re-resolves all addresses for every request and rejects rebinding', async () => {
    let resolutions = 0; let sends = 0;
    const transport = new McpPublicTransport({ resolve: async () => [{ address: ++resolutions === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }], send: async () => { sends++; return { status: 200, headers: {}, bytes: Buffer.from('{}') }; } });
    await transport.request({ url: resource, method: 'GET' }); await expect(transport.request({ url: resource, method: 'GET' })).rejects.toThrow('mcp_address_denied'); expect(sends).toBe(1);
  });
  it('rejects redirect without a follow-up and bounds DNS time/cancellation', async () => {
    let sends = 0; const transport = new McpPublicTransport({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], send: async () => { sends++; return { status: 302, headers: { location: 'http://169.254.169.254/' }, bytes: Buffer.alloc(0) }; } });
    await expect(transport.request({ url: resource, method: 'GET' })).rejects.toThrow('mcp_redirect_denied'); expect(sends).toBe(1);
    const slow = new McpPublicTransport({ timeoutMs: 10, resolve: async () => new Promise(() => undefined) }); await expect(slow.request({ url: resource, method: 'GET' })).rejects.toThrow('mcp_cancelled');
  });
  it.each(['dns', 'connect'])('withdrawn authority during held %s blocks outbound credential bytes', async phase => {
    let allowed = true; let bytes = 0; let release!: () => void; let reached!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { reached = resolve; });
    const fence = async () => { if (!allowed) throw new Error('withdrawn'); };
    const transport = new McpPublicTransport({ resolve: async () => { if (phase === 'dns') { reached(); await held; } return [{ address: '8.8.8.8', family: 4 }]; },
      send: async input => { if (phase === 'connect') { reached(); await held; } await input.beforeSend?.(); bytes++; return { status: 200, headers: {}, bytes: Buffer.alloc(0) }; } });
    const pending = transport.request({ url: resource, method: 'POST', headers: { authorization: 'Bearer synthetic-secret' }, beforeSend: fence });
    await entered; allowed = false; release(); await expect(pending).rejects.toThrow(); expect(bytes).toBe(0);
  });
  it('rejects unsupported JSON Schema and ignores read hints for authorization', () => {
    const catalog = new McpConnectionsCatalog(snapshotMcpCatalog(resource, [tool])); expect(catalog.get(mcpToolId(tool.name))).toMatchObject({ effect: 'privileged', retryClass: 'reconcile_only' });
    expect(() => snapshotMcpCatalog(resource, [{ ...tool, inputSchema: { type: 'object', $ref: 'http://169.254.169.254/schema' } }])).toThrow('mcp_schema_unsupported');
    expect(() => catalog.validateArguments(mcpToolId(tool.name), { id: 'x', shell: 'bad' })).toThrow('mcp_arguments_invalid');
    expect(() => catalog.validateArguments(mcpToolId(tool.name), { id: 2 })).toThrow('mcp_arguments_invalid');
  });
});
