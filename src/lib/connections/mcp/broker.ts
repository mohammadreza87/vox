import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { idSchema, type ConnectionActor, type SpaceKind } from '../contracts';
import type { SetupReceipt } from '../application';
import type { BrokerAuthority, BrokerControlPlane } from '../broker/control';
import type { BrokerVault, VaultBinding } from '../broker/vault';
import { ConnectionsError } from '../errors';
import { canonical } from '../repository';
import { pkceChallenge } from '../broker/oauth';
import { McpConnectionsCatalog, MCP_PROVIDER_ID, mcpCatalogSnapshotSchema, type McpCatalogSnapshot } from './catalog';
import { McpSession } from './client';
import { McpOAuth, type McpClientConfiguration, type McpOAuthToken } from './oauth';
import { canonicalMcpUrl, McpPublicTransport } from './transport';
const actorSchema = z.object({ accountId: idSchema, botAgentId: idSchema.optional(), botAuthenticationRevision: idSchema.optional() }).strict().refine(value => !!value.botAgentId === !!value.botAuthenticationRevision);
const base = { actor: actorSchema, space: z.enum(['personal', 'work']) };
const flowInput = z.object({ ...base, flowId: z.string().uuid() }).strict();
const metadataSchema = z.object({ resource: z.string(), issuer: z.string(), authorizationEndpoint: z.string(), tokenEndpoint: z.string(), scopesSupported: z.array(z.string()), clientMetadataSupported: z.boolean(), tokenAuthMethods: z.array(z.string()), issuerParameterSupported: z.boolean(), jwksUri: z.string().optional() }).strict();
const clientSchema = z.object({ clientId: z.string(), clientSecret: z.string().optional(), scopes: z.array(z.string()), registration: z.enum(['preregistered', 'client_id_metadata']) }).strict();
const tokenSchema = z.object({ accessToken: z.string(), refreshToken: z.string().optional(), expiresAt: z.number().optional(), scopes: z.array(z.string()) }).strict();
const flowSchema = z.object({ kind: z.literal('self_service_mcp_v1'), flowId: z.string().uuid(), stateHash: z.string().length(64), verifier: z.string(),
  callbackUrl: z.string(), botAuthenticationRevision: z.string().optional(), bindingRevision: z.number(), connectionRevision: z.number(), expiresAt: z.number(),
  callbackUsed: z.boolean(), status: z.enum(['pending', 'exchanging', 'sealed', 'connected', 'failed', 'cancelled']),
  metadata: metadataSchema, client: clientSchema, catalog: mcpCatalogSnapshotSchema.optional(), authorizationId: z.string().uuid(), reason: z.string().optional() }).strict();
type McpFlow = z.infer<typeof flowSchema>;
export interface McpBrokerCredential extends McpOAuthToken {
  subject: string; tenant: string; issuer: string; displayLabel: string; connectionRevision: number;
  status: 'sealed' | 'active' | 'refreshing' | 'revoked'; scopeEvidence: 'oauth_response';
}
export interface McpActivation {
  catalog: McpCatalogSnapshot; issuer: string; providerSubject: string; providerTenantId: string;
  providerScopes: string[]; displayLabel: string; identityEvidence: 'unavailable';
}
export interface SelfServiceMcpBrokerOptions {
  control: BrokerControlPlane; vault: BrokerVault; callbackUrl: string; clients: McpClientConfiguration;
  /** Atomically update safe catalog + connection revision + provider authorization metadata. Creates zero grants. */
  activate(current: BrokerAuthority, activation: McpActivation): Promise<void>;
  transport?: McpPublicTransport; now?: () => number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const bindingFor = (current: BrokerAuthority): VaultBinding => ({ accountId: current.context.accountId, personId: current.context.personId,
  space: current.context.scope.spaceKind, connectionId: current.connection.id, providerId: current.connection.providerId,
  ...(current.connection.schemaVersion === 2 ? { agentId: current.connection.agentId } : {}) });
const configId = (id: string) => `mcp:configuration:${id}`;
const setupId = (id: string) => `mcp:setup:${id}`;
/** Broker-process-only OAuth setup. Neither callback nor a URL submitted by the browser activates a credential. */
export class SelfServiceMcpBroker {
  readonly transport: McpPublicTransport;
  private readonly oauth: McpOAuth;
  private readonly now: () => number;
  constructor(readonly options: SelfServiceMcpBrokerOptions) {
    canonicalMcpUrl(options.callbackUrl);
    if (new URL(options.callbackUrl).pathname !== '/oauth/callback/remote_mcp') throw new ConnectionsError(503, 'mcp_callback_configuration_invalid');
    this.transport = options.transport ?? new McpPublicTransport(); this.now = options.now ?? Date.now;
    this.oauth = new McpOAuth(this.transport, this.now);
  }
  private async fresh(actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<BrokerAuthority> {
    const current = await this.options.control.call<BrokerAuthority>({ action: 'context', actor, space, connectionId });
    if (current.connection.schemaVersion !== 2 || current.connection.providerId !== MCP_PROVIDER_ID || current.connection.id !== connectionId ||
        current.context.accountId !== actor.accountId || current.context.scope.spaceKind !== space || current.connection.ownerAccountId !== actor.accountId ||
        current.connection.ownerPersonId !== current.context.personId || !current.context.currentAgentIds.includes(current.connection.agentId) ||
        actor.botAgentId && current.connection.agentId !== actor.botAgentId || current.context.bindingExpiresAt <= this.now()) throw new ConnectionsError(403, 'mcp_authority_denied');
    return current;
  }
  private receipt(flow: McpFlow): SetupReceipt {
    return { flowId: flow.flowId, status: flow.expiresAt <= this.now() && flow.status !== 'connected' ? 'expired' :
      ['connected', 'failed', 'cancelled'].includes(flow.status) ? flow.status as 'connected' | 'failed' | 'cancelled' : 'pending', expiresAt: flow.expiresAt,
      ...(flow.reason ? { reason: flow.reason } : {}) };
  }
  async beginSetup(input: unknown): Promise<SetupReceipt> {
    const parsed = z.object({ ...base, connectionId: idSchema, expectedRevision: z.number().int().positive(), endpointUrl: z.string().max(2000) }).strict().parse(input);
    return this.options.vault.withLock(`mcp:setup:${parsed.connectionId}`, async () => {
    const current = await this.fresh(parsed.actor, parsed.space, parsed.connectionId);
    if (current.connection.lifecycle !== 'pending' || current.connection.revision !== parsed.expectedRevision) throw new ConnectionsError(409, 'mcp_enrollment_stale');
    const resource = canonicalMcpUrl(parsed.endpointUrl);
    const declared = (current.connection as unknown as { mcp?: { canonicalResourceUri: string } }).mcp?.canonicalResourceUri;
    if (declared !== resource) throw new ConnectionsError(403, 'mcp_resource_mismatch');
    const binding = bindingFor(current);
    const previous = await this.options.vault.read('credential', setupId(parsed.connectionId), binding);
    if (previous) {
      const saved = z.object({ flowId: z.string().uuid() }).strict().parse(previous);
      const resumed = await this.options.vault.withLock(`mcp:flow:${saved.flowId}`, async () => {
        const { flow, current: latest } = await this.load(parsed.actor, parsed.space, saved.flowId);
        if (latest.connection.revision !== parsed.expectedRevision || latest.connection.lifecycle !== 'pending' || flow.metadata.resource !== resource) throw new ConnectionsError(409, 'mcp_enrollment_stale');
        if (flow.status === 'sealed' && flow.expiresAt > this.now() && flow.connectionRevision === parsed.expectedRevision && flow.catalog) {
          const pending = tokenSchema.parse(await this.options.vault.read('credential', `mcp:pending:${flow.flowId}`, binding));
          if (pending.expiresAt && pending.expiresAt > this.now()) return { ...this.receipt(flow), reason: 'catalog_review_required' };
        }
        if (flow.status === 'exchanging') throw new ConnectionsError(409, 'mcp_setup_in_progress');
        if (flow.status === 'connected') throw new ConnectionsError(409, 'mcp_enrollment_stale');
        flow.status = 'cancelled'; flow.verifier = '';
        await this.options.vault.write('flow', flow.flowId, binding, flow);
        await this.options.vault.delete('credential', `mcp:pending:${flow.flowId}`);
      });
      if (resumed) return resumed;
    }
    const setupCheck = async () => { const latest = await this.fresh(parsed.actor, parsed.space, parsed.connectionId);
      if (latest.connection.lifecycle !== 'pending' || latest.connection.revision !== parsed.expectedRevision || latest.context.bindingRevision !== current.context.bindingRevision) throw new ConnectionsError(409, 'mcp_enrollment_stale'); };
    const metadata = await this.oauth.discover(resource, setupCheck); const client = this.oauth.selectClient(metadata, this.options.clients);
    const latest = await this.fresh(parsed.actor, parsed.space, parsed.connectionId);
    if (latest.connection.lifecycle !== 'pending' || latest.connection.revision !== current.connection.revision || canonical(bindingFor(current)) !== canonical(bindingFor(latest))) throw new ConnectionsError(409, 'mcp_enrollment_stale');
    const flowId = randomUUID(); const state = `${flowId}.${randomBytes(32).toString('base64url')}`; const verifier = randomBytes(48).toString('base64url');
    const flow: McpFlow = { kind: 'self_service_mcp_v1', flowId, stateHash: hash(state), verifier, callbackUrl: this.options.callbackUrl,
      ...(parsed.actor.botAuthenticationRevision ? { botAuthenticationRevision: parsed.actor.botAuthenticationRevision } : {}),
      bindingRevision: current.context.bindingRevision, connectionRevision: parsed.expectedRevision, expiresAt: this.now() + 600_000,
      callbackUsed: false, status: 'pending', metadata, client, authorizationId: randomUUID() };
    await this.options.vault.write('flow', flowId, bindingFor(current), flow);
    await this.options.vault.write('credential', setupId(parsed.connectionId), bindingFor(current), { flowId });
    return { ...this.receipt(flow), authorizationUrl: this.oauth.authorizationUrl(metadata, client, this.options.callbackUrl, state, pkceChallenge(verifier)) };
    });
  }
  private async load(actor: ConnectionActor, space: SpaceKind, flowId: string) {
    const binding = await this.options.vault.binding('flow', flowId);
    if (!binding || binding.providerId !== MCP_PROVIDER_ID || binding.accountId !== actor.accountId || binding.space !== space || actor.botAgentId && binding.agentId !== actor.botAgentId) throw new ConnectionsError(404, 'mcp_flow_unavailable');
    const current = await this.fresh(actor, space, binding.connectionId);
    if (canonical(bindingFor(current)) !== canonical(binding)) throw new ConnectionsError(403, 'mcp_binding_changed');
    const flow = flowSchema.parse(await this.options.vault.read('flow', flowId, binding));
    if (flow.callbackUrl !== this.options.callbackUrl || flow.bindingRevision !== current.context.bindingRevision ||
        actor.botAuthenticationRevision !== flow.botAuthenticationRevision) throw new ConnectionsError(409, 'mcp_binding_changed');
    return { binding, current, flow };
  }
  async callback(input: unknown): Promise<{ status: 'pending'; reason: 'return_to_authenticated_bot' }> {
    const query = z.object({ state: z.string().max(200), code: z.string().min(1).max(3000).optional(), error: z.string().max(100).optional(), error_description: z.string().max(1000).optional(), iss: z.string().max(2000).optional() }).strict().parse(input);
    const flowId = query.state.split('.')[0]; if (!z.string().uuid().safeParse(flowId).success) throw new ConnectionsError(400, 'mcp_oauth_state_invalid');
    await this.options.vault.withLock(`mcp:flow:${flowId}`, async () => {
      const binding = await this.options.vault.binding('flow', flowId); if (!binding || binding.providerId !== MCP_PROVIDER_ID) throw new ConnectionsError(400, 'mcp_oauth_state_invalid');
      const saved = flowSchema.parse(await this.options.vault.read('flow', flowId, binding));
      if (saved.status !== 'pending' || saved.callbackUsed || saved.expiresAt <= this.now() || !timingSafeEqual(Buffer.from(hash(query.state)), Buffer.from(saved.stateHash)) ||
          saved.metadata.issuerParameterSupported && query.iss !== saved.metadata.issuer || query.iss !== undefined && query.iss !== saved.metadata.issuer) throw new ConnectionsError(400, 'mcp_oauth_state_invalid');
      const actor = { accountId: binding.accountId, ...(saved.botAuthenticationRevision ? { botAgentId: binding.agentId, botAuthenticationRevision: saved.botAuthenticationRevision } : {}) };
      const { flow, current } = await this.load(actor, binding.space, flowId);
      if (current.connection.lifecycle !== 'pending' || current.connection.revision !== flow.connectionRevision) throw new ConnectionsError(409, 'mcp_enrollment_stale');
      flow.callbackUsed = true; flow.status = 'exchanging'; await this.options.vault.write('flow', flowId, binding, flow);
      if (query.error || !query.code) { flow.status = 'cancelled'; flow.verifier = ''; await this.options.vault.write('flow', flowId, binding, flow); return; }
      try {
        const check = async () => {
          const latest = await this.load(actor, binding.space, flowId);
          if (latest.current.connection.revision !== flow.connectionRevision || latest.current.connection.lifecycle !== 'pending' || flow.expiresAt <= this.now()) throw new ConnectionsError(409, 'mcp_enrollment_stale');
        };
        const token = await this.oauth.token(flow.metadata, flow.client, { grant_type: 'authorization_code', code: query.code, code_verifier: flow.verifier, redirect_uri: flow.callbackUrl }, undefined, check);
        const catalog = await new McpSession(flow.metadata.resource, this.transport, token.accessToken, undefined, check).discover();
        const text = JSON.stringify(catalog);
        if ([token.accessToken, token.refreshToken, flow.verifier, flow.client.clientSecret].some(secret => secret && text.includes(secret))) throw new ConnectionsError(502, 'mcp_catalog_secret_denied');
        await check(); await this.options.vault.write('credential', `mcp:pending:${flowId}`, binding, token);
        flow.catalog = catalog; flow.status = 'sealed'; flow.verifier = ''; await this.options.vault.write('flow', flowId, binding, flow);
      } catch {
        flow.status = 'failed'; flow.reason = 'mcp_oauth_verification_failed'; flow.verifier = '';
        await this.options.vault.delete('credential', `mcp:pending:${flowId}`); await this.options.vault.write('flow', flowId, binding, flow);
        throw new ConnectionsError(502, 'mcp_oauth_verification_failed');
      }
    });
    return { status: 'pending', reason: 'return_to_authenticated_bot' };
  }
  async previewSetup(input: unknown) {
    const parsed = flowInput.parse(input); const { flow, current } = await this.load(parsed.actor, parsed.space, parsed.flowId);
    if (flow.status !== 'sealed' || flow.expiresAt <= this.now() || current.connection.lifecycle !== 'pending' || current.connection.revision !== flow.connectionRevision || !flow.catalog) throw new ConnectionsError(409, 'mcp_review_unavailable');
    return { ...this.receipt(flow), catalog: new McpConnectionsCatalog(flow.catalog).view() };
  }
  async claimSetup(input: unknown): Promise<SetupReceipt> {
    const parsed = flowInput.extend({ acceptedCatalogDigest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input);
    return this.options.vault.withLock(`mcp:flow:${parsed.flowId}`, async () => {
      const { flow, binding, current } = await this.load(parsed.actor, parsed.space, parsed.flowId);
      if (flow.status === 'connected') return this.receipt(flow);
      if (flow.status !== 'sealed' || flow.expiresAt <= this.now() || !flow.catalog || parsed.acceptedCatalogDigest !== flow.catalog.catalogDigest) throw new ConnectionsError(409, 'mcp_review_stale');
      const finish = async () => {
        flow.status = 'connected'; delete flow.reason; await this.options.vault.write('flow', flow.flowId, binding, flow);
        await this.options.vault.delete('credential', `mcp:pending:${flow.flowId}`); return this.receipt(flow);
      };
      const activated = (authority: BrokerAuthority, credential: McpBrokerCredential | undefined) =>
        !!credential && credential.status === 'active' && credential.connectionRevision === flow.connectionRevision + 1 &&
        credential.subject === `authorization:${flow.authorizationId}` && authority.connection.lifecycle === 'connected' &&
        authority.connection.revision === credential.connectionRevision && authority.connection.catalogDigest === flow.catalog!.catalogDigest &&
        authority.providerAccount?.status === 'active' && authority.providerAccount.identityEvidence === 'unavailable' &&
        authority.providerAccount.providerSubject === credential.subject && authority.providerAccount.providerTenantId === credential.tenant &&
        authority.providerAccount.issuer === credential.issuer && canonical(authority.connection.providerScopes) === canonical(credential.scopes);
      if (current.connection.lifecycle === 'connected') {
        const credential = await this.options.vault.read('credential', binding.connectionId, binding) as McpBrokerCredential | undefined;
        if (!activated(current, credential)) throw new ConnectionsError(409, 'mcp_review_stale');
        return finish();
      }
      if (current.connection.lifecycle !== 'pending' || current.connection.revision !== flow.connectionRevision) throw new ConnectionsError(409, 'mcp_review_stale');
      const token = tokenSchema.parse(await this.options.vault.read('credential', `mcp:pending:${flow.flowId}`, binding));
      if (token.expiresAt && token.expiresAt <= this.now()) throw new ConnectionsError(409, 'mcp_reauth_required');
      // External human identity is deliberately unavailable. This random subject identifies only this authorization.
      const credential: McpBrokerCredential = { ...token, subject: `authorization:${flow.authorizationId}`, tenant: `resource:${hash(flow.metadata.resource)}`,
        issuer: flow.metadata.issuer, displayLabel: 'MCP authorization (account identity unavailable)', connectionRevision: current.connection.revision + 1, status: 'active', scopeEvidence: 'oauth_response' };
      await this.options.vault.write('credential', binding.connectionId, binding, credential);
      await this.options.vault.write('credential', configId(binding.connectionId), binding, { metadata: flow.metadata, client: flow.client, catalog: flow.catalog, connectionRevision: credential.connectionRevision, actor: parsed.actor });
      try {
        await this.options.activate(current, { catalog: flow.catalog, issuer: credential.issuer, providerSubject: credential.subject, providerTenantId: credential.tenant,
          providerScopes: credential.scopes, displayLabel: credential.displayLabel, identityEvidence: 'unavailable' });
      } catch {
        let latest: BrokerAuthority;
        try { latest = await this.fresh(parsed.actor, parsed.space, binding.connectionId); }
        catch {
          flow.reason = 'activation_unconfirmed'; await this.options.vault.write('flow', flow.flowId, binding, flow);
          throw new ConnectionsError(409, 'mcp_activation_unconfirmed');
        }
        if (activated(latest, credential)) return finish();
        await this.options.vault.delete('credential', binding.connectionId);
        await this.options.vault.delete('credential', configId(binding.connectionId));
        throw new ConnectionsError(409, 'mcp_activation_failed');
      }
      return finish();
    });
  }
  async cancelSetup(input: unknown): Promise<SetupReceipt> {
    const parsed = flowInput.parse(input);
    return this.options.vault.withLock(`mcp:flow:${parsed.flowId}`, async () => {
      const { flow, binding } = await this.load(parsed.actor, parsed.space, parsed.flowId);
      if (flow.status === 'connected') return this.receipt(flow);
      flow.status = 'cancelled'; flow.verifier = ''; await this.options.vault.write('flow', flow.flowId, binding, flow);
      await this.options.vault.delete('credential', `mcp:pending:${flow.flowId}`); return this.receipt(flow);
    });
  }
  /** ConnectionsBroker credentialForAuthority hook. No token is returned by a browser/control endpoint. */
  async credentialForAuthority(current: BrokerAuthority): Promise<McpBrokerCredential> {
    const binding = bindingFor(current);
    return this.options.vault.withLock(`mcp:credential:${binding.connectionId}`, async () => {
      const credential = await this.options.vault.read('credential', binding.connectionId, binding) as McpBrokerCredential | undefined;
      const config = z.object({ metadata: metadataSchema, client: clientSchema, catalog: mcpCatalogSnapshotSchema, connectionRevision: z.number(), actor: actorSchema }).strict().parse(await this.options.vault.read('credential', configId(binding.connectionId), binding));
      const currentBotRevision = (current.context as unknown as { botAuthenticationRevision?: string }).botAuthenticationRevision;
      const actor = current.context.botAgentId && currentBotRevision ? { accountId: binding.accountId, botAgentId: current.context.botAgentId, botAuthenticationRevision: currentBotRevision } : config.actor;
      if (actor.accountId !== binding.accountId || actor.botAgentId && actor.botAgentId !== binding.agentId) throw new ConnectionsError(403, 'mcp_credential_unavailable');
      const resource = (current.connection as unknown as { mcp?: { canonicalResourceUri: string } }).mcp?.canonicalResourceUri;
      if (resource !== config.metadata.resource || config.catalog.resource !== config.metadata.resource) throw new ConnectionsError(403, 'mcp_resource_mismatch');
      if (!credential || credential.status !== 'active' || credential.connectionRevision !== current.connection.revision || config.connectionRevision !== current.connection.revision ||
          config.catalog.catalogDigest !== current.connection.catalogDigest || current.connection.lifecycle !== 'connected' || canonical(bindingFor(current)) !== canonical(binding)) throw new ConnectionsError(403, 'mcp_credential_unavailable');
      if (!credential.expiresAt || credential.expiresAt > this.now() + 30_000) return credential;
      if (!credential.refreshToken) throw new ConnectionsError(401, 'mcp_reauth_required');
      const latest = await this.options.control.call<BrokerAuthority>({ action: 'context', actor, space: binding.space, connectionId: binding.connectionId });
      if (latest.connection.lifecycle !== 'connected' || latest.connection.revision !== current.connection.revision || canonical(bindingFor(latest)) !== canonical(binding)) throw new ConnectionsError(403, 'mcp_credential_unavailable');
      const check = async () => { const checkCurrent = await this.fresh(actor, binding.space, binding.connectionId);
        if (checkCurrent.connection.lifecycle !== 'connected' || checkCurrent.connection.revision !== current.connection.revision || checkCurrent.context.bindingRevision !== current.context.bindingRevision || canonical(bindingFor(checkCurrent)) !== canonical(binding)) throw new ConnectionsError(403, 'mcp_credential_unavailable'); };
      await check();
      await this.options.vault.write('credential', binding.connectionId, binding, { ...credential, status: 'refreshing' });
      const refreshed = await this.oauth.token(config.metadata, { ...config.client, scopes: credential.scopes }, { grant_type: 'refresh_token', refresh_token: credential.refreshToken }, undefined, check);
      const after = await this.options.control.call<BrokerAuthority>({ action: 'context', actor, space: binding.space, connectionId: binding.connectionId });
      if (after.connection.lifecycle !== 'connected' || after.connection.revision !== current.connection.revision || canonical(bindingFor(after)) !== canonical(binding)) throw new ConnectionsError(403, 'mcp_credential_unavailable');
      const updated = { ...credential, ...refreshed, refreshToken: refreshed.refreshToken ?? credential.refreshToken };
      await this.options.vault.write('credential', binding.connectionId, binding, updated); return updated;
    });
  }
  /** Called only after the control-plane revocation fence is committed. No claim of external token revocation. */
  async revoke(current: BrokerAuthority): Promise<{ futureUseStopped: true; providerRevocation: 'unavailable' }> {
    if (current.connection.schemaVersion !== 2 || current.connection.providerId !== MCP_PROVIDER_ID || !['revoked', 'deleted'].includes(current.connection.lifecycle)) throw new ConnectionsError(409, 'mcp_revocation_not_committed');
    const binding = bindingFor(current);
    for (const flowId of await this.options.vault.listFlows()) {
      const stored = await this.options.vault.binding('flow', flowId);
      if (!stored || canonical(stored) !== canonical(binding)) continue;
      await this.options.vault.withLock(`mcp:flow:${flowId}`, async () => {
        const flow = flowSchema.parse(await this.options.vault.read('flow', flowId, binding));
        await this.options.vault.delete('credential', `mcp:pending:${flow.flowId}`);
        await this.options.vault.delete('flow', flow.flowId);
      });
    }
    await this.options.vault.withLock(`mcp:credential:${binding.connectionId}`, async () => {
      await this.options.vault.delete('credential', binding.connectionId);
      await this.options.vault.delete('credential', configId(binding.connectionId));
      await this.options.vault.delete('credential', setupId(binding.connectionId));
    });
    return { futureUseStopped: true, providerRevocation: 'unavailable' };
  }

}
