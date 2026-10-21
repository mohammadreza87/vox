import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { idSchema, type ConnectionActor, type ConnectionsCatalog, type OperationReceipt, type ReviewedTool, type SourceLabel, type SpaceKind } from '../contracts';
import type { ConnectionExecutionResult, SetupReceipt } from '../application';
import type { ProviderResult } from '../providers/types';
import { getProviderToolDefinition } from '../providers';
import { ProviderError } from '../transport';
import { ConnectionsError } from '../errors';
import { digest } from '../repository';
import { type BrokerControlPlane, type BrokerAuthority, type BrokerGrantAuthority, type BrokerSubscriptionAuthority, type OperationClaim, authority } from './control';
import { verifyProviderEvent } from '../events/verification';
import { registerSubscriptionSchema } from '../events/contracts';
import type { ConnectionSubscription } from '../contracts';
import type { BrokerVault, VaultBinding } from './vault';
import { type BrokerOAuthTransport, type OAuthProfile, type OAuthToken, pkceChallenge, validateOAuthProfile } from './oauth';
const actorSchema = z.object({ accountId: idSchema, botAgentId: idSchema.optional(), botAuthenticationRevision: idSchema.optional() }).strict()
  .refine(value => !!value.botAgentId === !!value.botAuthenticationRevision);
const base = { actor: actorSchema, space: z.enum(['work', 'personal']) };
export const enrollmentRequestSchema = z.object({ ...base, connectionId: idSchema, expectedRevision: z.number().int().positive(), providerId: idSchema }).strict();
export const claimSetupSchema = z.object({ ...base, flowId: idSchema }).strict();
export const executeRequestSchema = z.object({ ...base, operationId: idSchema }).strict();
export const invalidateRequestSchema = z.object({ ...base, connectionId: idSchema, grantId: idSchema }).strict();
export const revokeRequestSchema = z.object({ ...base, connectionId: idSchema, providerId: idSchema }).strict();
const credentialSchema = z.object({ accessToken: z.string().min(1).max(16000), refreshToken: z.string().max(16000).optional(),
  expiresAt: z.number().int().positive().optional(), scopes: z.array(z.string().min(1).max(200)).max(100),
  subject: idSchema, tenant: idSchema, issuer: z.string().url(), displayLabel: z.string().min(1).max(160),
  connectionRevision: z.number().int().positive(), status: z.enum(['sealed', 'active', 'refreshing', 'revoked']), scopeEvidence: z.enum(['oauth_response', 'operator_asserted', 'runner_attestation']) }).strict();
export type Credential = z.infer<typeof credentialSchema>;
const flowSchema = z.object({ flowId: idSchema, bindingRevision: z.number().int().positive(), connectionRevision: z.number().int().positive(),
  stateHash: z.string().length(64), verifier: z.string().max(200), expiresAt: z.number().int().positive(),
  status: z.enum(['pending', 'exchanging', 'sealed', 'connected', 'cancelled', 'failed']), callbackUsed: z.boolean(),
  issuer: z.string().url().optional(), reason: idSchema.optional(), botAuthenticationRevision: idSchema.optional() }).strict();
type Flow = z.infer<typeof flowSchema>;
export interface BrokerExecutor { execute(toolId: string, args: unknown, context: { credential: { providerId: string; endpointProfileId: string; accessToken: string; expiresAt?: number };
  operationId: string; scopeKind: SpaceKind; signal?: AbortSignal }): Promise<ProviderResult> }
export interface ConnectionsBrokerOptions {
  control: BrokerControlPlane; vault: BrokerVault; oauth: BrokerOAuthTransport; catalog: ConnectionsCatalog; executor: BrokerExecutor;
  catalogForAuthority?: (current: BrokerAuthority) => Promise<ConnectionsCatalog>;
  executorForAuthority?: (current: BrokerAuthority, catalog: ConnectionsCatalog, operation: OperationClaim['operation']) => BrokerExecutor | Promise<BrokerExecutor>;
  revokeForAuthority?: (current: BrokerAuthority) => Promise<{ futureUseStopped: true; providerRevocation: 'verified' | 'unavailable' }>;
  credentialForAuthority?: (current: BrokerAuthority) => Promise<Credential>;
  runnerEnrollment?: (current: BrokerAuthority) => Promise<{ identity: { subject: string; tenant: string; displayLabel: string; issuer: string }; scopes: string[]; leaseMarker: string }>;
  expectedIdentity?: (current: BrokerAuthority) => Promise<{ subject: string; tenant: string }>;
  oauthProfiles: Readonly<Record<string, OAuthProfile>>; enabledProviderIds: readonly string[]; now?: () => number;
  /** Operator-reviewed scopes, never requested by a browser/model/token field. */
  readOnly?: boolean;
  operatorScopes?: Readonly<Record<string, readonly string[]>>;
}
export function providerScopePermits(providerId: string, required: string, scopes: readonly string[]): boolean {
  if (required.includes('|')) return required.split('|').some(alternative => providerScopePermits(providerId, alternative, scopes));
  if (scopes.includes(required)) return true;
  if (providerId === 'hetzner' && required === 'project:read' && scopes.includes('project:read_write')) return true;
  // GitHub OAuth scopes and GitHub App permission names are distinct. This bridge
  // admits only the reviewed repository operations; the provider still enforces each resource.
  return providerId === 'github' && ['metadata:read', 'issues:read', 'issues:write', 'pull_requests:read', 'pull_requests:write'].includes(required) &&
    (scopes.includes('repo') || scopes.includes('public_repo'));
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const bindingFor = (authority: BrokerAuthority): VaultBinding => ({ accountId: authority.context.accountId, personId: authority.context.personId,
  space: authority.context.scope.spaceKind, connectionId: authority.connection.id, providerId: authority.connection.providerId, ...(authority.connection.schemaVersion === 2 ? { agentId: authority.connection.agentId } : {}) });
/** Runs in the independent broker process. No direct Studio database or bot access. */
export class ConnectionsBroker {
  private readonly now: () => number;
  private readonly activeGrantIds = new WeakMap<AbortController, string>();
  private readonly active = new Map<string, Set<AbortController>>();
  constructor(readonly options: ConnectionsBrokerOptions) {
    this.now = options.now ?? Date.now;
    for (const profile of Object.values(options.oauthProfiles)) validateOAuthProfile(profile);
  }
  private enabled(providerId: string): void { if (!this.options.enabledProviderIds.includes(providerId)) throw new ConnectionsError(503, 'provider_not_enabled'); }
  private async fresh(actor: ConnectionActor, space: SpaceKind, connectionId: string, requireEnabled = true): Promise<BrokerAuthority> {
    const current = await authority(this.options.control, actor, space, connectionId);
    if (current.context.accountId !== actor.accountId || current.context.scope.spaceKind !== space || current.connection.id !== connectionId ||
        current.connection.ownerAccountId !== actor.accountId || current.connection.ownerPersonId !== current.context.personId) throw new ConnectionsError(403, 'broker_authority_mismatch');
    if (requireEnabled) {
      this.enabled(current.connection.providerId);
      if (current.connection.schemaVersion === 2 && !current.context.currentAgentIds.includes(current.connection.agentId)) throw new ConnectionsError(403, 'broker_agent_unavailable');
    }
    return current;
  }
  private async checkProviderIdentity(current: BrokerAuthority, identity: { subject: string; tenant: string }): Promise<void> {
    const expected = await this.options.expectedIdentity?.(current);
    if (expected && (identity.subject !== expected.subject || identity.tenant !== expected.tenant)) throw new ConnectionsError(403, 'configured_provider_identity_mismatch');
  }
  private receipt(flow: Flow): SetupReceipt {
    return { flowId: flow.flowId, status: flow.expiresAt <= this.now() && flow.status !== 'connected' ? 'expired' :
      flow.status === 'connected' || flow.status === 'cancelled' || flow.status === 'failed' ? flow.status : 'pending',
      expiresAt: flow.expiresAt, ...(flow.reason ? { reason: flow.reason } : {}) };
  }
  async beginSetup(input: unknown): Promise<SetupReceipt> {
    const parsed = enrollmentRequestSchema.parse(input);
    const current = await this.fresh(parsed.actor, parsed.space, parsed.connectionId);
    if (current.connection.providerId !== parsed.providerId || current.connection.revision !== parsed.expectedRevision || current.connection.lifecycle !== 'pending') throw new ConnectionsError(409, 'enrollment_stale');
    await this.options.catalogForAuthority?.(current);
    const binding = bindingFor(current);
    const profile = this.options.oauthProfiles[parsed.providerId];
    const flowId = randomUUID(); const verifier = randomBytes(48).toString('base64url');
    const state = `${flowId}.${randomBytes(32).toString('base64url')}`;
    const flow: Flow = { flowId, bindingRevision: current.context.bindingRevision, connectionRevision: parsed.expectedRevision,
      stateHash: hash(state), verifier, ...(parsed.actor.botAuthenticationRevision ? { botAuthenticationRevision: parsed.actor.botAuthenticationRevision } : {}), expiresAt: this.now() + 10 * 60_000, status: 'pending', callbackUsed: false,
      ...(profile ? { issuer: profile.issuer } : { reason: 'operator_enrollment_required' }) };
    await this.options.vault.write('flow', flowId, binding, flow);
    if (!profile) return this.receipt(flow);
    const url = new URL(profile.authorizeUrl);
    url.search = new URLSearchParams({ response_type: 'code', client_id: profile.clientId, redirect_uri: profile.callbackUrl,
      state, scope: profile.scopes.join(' '), code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256',
      ...(parsed.providerId.startsWith('google_') || parsed.providerId === 'gmail' ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' } : {}) }).toString();
    return { ...this.receipt(flow), authorizationUrl: url.href };
  }
  private async flowFor(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<{ binding: VaultBinding; flow: Flow; current: BrokerAuthority }> {
    const binding = await this.options.vault.binding('flow', flowId);
    if (!binding || binding.accountId !== actor.accountId || binding.space !== space || actor.botAgentId && binding.agentId !== actor.botAgentId) throw new ConnectionsError(404, 'enrollment_unavailable');
    const current = await this.fresh(actor, space, binding.connectionId);
    if (current.context.personId !== binding.personId || current.connection.providerId !== binding.providerId) throw new ConnectionsError(403, 'enrollment_identity_mismatch');
    const flow = flowSchema.parse(await this.options.vault.read('flow', flowId, binding));
    if (actor.botAuthenticationRevision && flow.botAuthenticationRevision !== actor.botAuthenticationRevision) throw new ConnectionsError(409, 'enrollment_identity_changed');
    if (flow.bindingRevision !== current.context.bindingRevision) throw new ConnectionsError(409, 'enrollment_identity_changed');
    return { binding, flow, current };
  }
  /** Public browser callback seals the candidate only. Fresh authenticated Studio claim is mandatory. */
  async callback(providerId: string, input: unknown): Promise<{ status: 'pending'; reason: 'return_to_authenticated_studio' }> {
    const query = z.object({ state: z.string().max(200), code: z.string().min(1).max(3000).optional(),
      error: z.string().max(100).optional(), error_description: z.string().max(1000).optional(), scope: z.string().max(4000).optional(),
      authuser: z.string().max(20).optional(), prompt: z.string().max(100).optional(), hd: z.string().max(200).optional(), iss: z.string().url().max(500).optional() }).strict().parse(input);
    const flowId = query.state.split('.')[0];
    if (!/^[0-9a-f-]{36}$/.test(flowId)) throw new ConnectionsError(400, 'oauth_state_invalid');
    await this.options.vault.withLock(`flow:${flowId}`, async () => {
      const binding = await this.options.vault.binding('flow', flowId);
      if (!binding || binding.providerId !== providerId) throw new ConnectionsError(400, 'oauth_state_invalid');
      const flow = flowSchema.parse(await this.options.vault.read('flow', flowId, binding));
      const profile = this.options.oauthProfiles[providerId];
      if (!profile || flow.status !== 'pending' || flow.callbackUsed || flow.expiresAt <= this.now() || flow.issuer !== profile.issuer ||
          (query.iss && query.iss !== profile.issuer) || !timingSafeEqual(Buffer.from(hash(query.state)), Buffer.from(flow.stateHash))) throw new ConnectionsError(400, 'oauth_state_invalid');
      const callbackActor: ConnectionActor = { accountId: binding.accountId, ...(flow.botAuthenticationRevision && binding.agentId ? { botAgentId: binding.agentId, botAuthenticationRevision: flow.botAuthenticationRevision } : {}) };
      const beforeExchange = await this.fresh(callbackActor, binding.space, binding.connectionId);
      if (beforeExchange.connection.lifecycle !== 'pending' || beforeExchange.connection.revision !== flow.connectionRevision ||
          beforeExchange.context.personId !== binding.personId || beforeExchange.context.bindingRevision !== flow.bindingRevision)
        throw new ConnectionsError(409, 'enrollment_stale');
      flow.callbackUsed = true; flow.status = 'exchanging';
      await this.options.vault.write('flow', flowId, binding, flow);
      if (query.error || !query.code) { flow.status = 'cancelled'; flow.verifier = ''; await this.options.vault.write('flow', flowId, binding, flow); return; }
      let issuedToken: OAuthToken | undefined;
      try {
        const token = await this.options.oauth.exchange(profile, query.code, flow.verifier);
        issuedToken = token;
        const identity = await this.options.oauth.identity(providerId, token.accessToken, { accountId: binding.accountId, space: binding.space, connectionId: binding.connectionId });
        const afterExchange = await this.fresh(callbackActor, binding.space, binding.connectionId);
        if (afterExchange.connection.lifecycle !== 'pending' || afterExchange.connection.revision !== flow.connectionRevision || afterExchange.context.bindingRevision !== flow.bindingRevision)
          throw new ConnectionsError(409, 'enrollment_stale');
        await this.checkProviderIdentity(afterExchange, identity);
        if (identity.issuer !== profile.issuer) throw new ConnectionsError(403, 'oauth_issuer_mismatch');
        const credential: Credential = { ...token, ...identity, connectionRevision: flow.connectionRevision + 1, status: 'sealed', scopeEvidence: 'oauth_response' };
        await this.options.vault.write('credential', `pending:${flowId}`, binding, credentialSchema.parse(credential));
        flow.status = 'sealed'; flow.verifier = '';
        await this.options.vault.write('flow', flowId, binding, flow);
      } catch {
        if (issuedToken) await this.options.oauth.revoke(profile, issuedToken.accessToken).catch(() => 'unavailable');
        flow.status = 'failed'; flow.reason = 'oauth_verification_failed'; flow.verifier = '';
        await this.options.vault.write('flow', flowId, binding, flow);
        throw new ConnectionsError(502, 'oauth_verification_failed');
      }
    });
    return { status: 'pending', reason: 'return_to_authenticated_studio' };
  }
  async claimSetup(input: unknown): Promise<SetupReceipt> {
    const parsed = claimSetupSchema.parse(input);
    return this.options.vault.withLock(`flow:${parsed.flowId}`, async () => {
      const { binding, flow, current } = await this.flowFor(parsed.actor, parsed.space, parsed.flowId);
      if (flow.status === 'connected') return this.receipt(flow);
      if (flow.expiresAt <= this.now() || flow.status !== 'sealed') return this.receipt(flow);
      const credential = credentialSchema.parse(await this.options.vault.read('credential', `pending:${flow.flowId}`, binding));
      if (current.connection.lifecycle === 'connected' && current.connection.revision === flow.connectionRevision + 1 &&
          current.providerAccount?.providerSubject === credential.subject && current.providerAccount.providerTenantId === credential.tenant && current.providerAccount.issuer === credential.issuer) {
        const active = credentialSchema.parse(await this.options.vault.read('credential', binding.connectionId, binding));
        if (active.status !== 'active' || active.connectionRevision !== current.connection.revision || active.subject !== credential.subject || active.tenant !== credential.tenant)
          throw new ConnectionsError(409, 'enrollment_stale');
        flow.status = 'connected'; await this.options.vault.write('flow', flow.flowId, binding, flow);
        await this.options.vault.delete('credential', `pending:${flow.flowId}`); return this.receipt(flow);
      }
      if (current.connection.lifecycle !== 'pending' || current.connection.revision !== flow.connectionRevision) throw new ConnectionsError(409, 'enrollment_stale');
      if (credential.status !== 'sealed') throw new ConnectionsError(409, 'enrollment_unavailable');
      // Activate locally before callback: an interrupted callback cannot report connected;
      // a repeat claim can safely retry the exact current connection revision.
      credential.status = 'active';
      await this.options.vault.write('credential', binding.connectionId, binding, credential);
      await this.options.control.call({ action: 'completeEnrollment', actor: parsed.actor, space: parsed.space,
        connectionId: binding.connectionId, expectedRevision: flow.connectionRevision, issuer: credential.issuer,
        providerSubject: credential.subject, providerTenantId: credential.tenant, providerScopes: credential.scopes, displayLabel: credential.displayLabel });
      flow.status = 'connected'; await this.options.vault.write('flow', flow.flowId, binding, flow);
      await this.options.vault.delete('credential', `pending:${flow.flowId}`);
      return this.receipt(flow);
    });
  }
  async cancelSetup(input: unknown): Promise<SetupReceipt> {
    const parsed = claimSetupSchema.parse(input);
    return this.options.vault.withLock(`flow:${parsed.flowId}`, async () => {
      const { binding, flow } = await this.flowFor(parsed.actor, parsed.space, parsed.flowId);
      if (flow.status === 'connected') return this.receipt(flow);
      flow.status = 'cancelled'; flow.verifier = '';
      await this.options.vault.write('flow', flow.flowId, binding, flow);
      await this.options.vault.delete('credential', `pending:${flow.flowId}`);
      return this.receipt(flow);
    });
  }
  /** Operator CLI only. No HTTP route accepts tokens. Identity is checked with the selected provider. */
  async operatorEnroll(input: { actor: ConnectionActor; space: SpaceKind; flowId: string; accessToken: string }): Promise<SetupReceipt> {
    return this.options.vault.withLock(`flow:${input.flowId}`, async () => {
      const { binding, flow, current } = await this.flowFor(input.actor, input.space, input.flowId);
      if (flow.status !== 'pending' || flow.expiresAt <= this.now() || current.connection.revision !== flow.connectionRevision) throw new ConnectionsError(409, 'enrollment_stale');
      const scopes = this.options.operatorScopes?.[binding.providerId];
      if (!scopes?.length) throw new ConnectionsError(409, 'operator_scopes_unconfigured');
      const identity = await this.options.oauth.identity(binding.providerId, input.accessToken, { accountId: binding.accountId, space: binding.space, connectionId: binding.connectionId });
      await this.checkProviderIdentity(current, identity);
      const credential: Credential = { accessToken: input.accessToken, ...identity, scopes: [...scopes], status: 'sealed',
        connectionRevision: flow.connectionRevision + 1, scopeEvidence: 'operator_asserted' };
      await this.options.vault.write('credential', `pending:${flow.flowId}`, binding, credentialSchema.parse(credential));
      flow.status = 'sealed'; flow.callbackUsed = true; flow.verifier = ''; delete flow.reason;
      await this.options.vault.write('flow', flow.flowId, binding, flow);
      return this.receipt(flow);
    });
  }
  /** Broker operator enrollment of an attested service binding; never OAuth or a target bearer token. */
  async operatorEnrollRunner(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt> {
    return this.options.vault.withLock(`flow:${input.flowId}`, async () => {
      const { binding, flow, current } = await this.flowFor(input.actor, input.space, input.flowId);
      if (!['browser', 'ssh'].includes(binding.providerId) || !this.options.runnerEnrollment || flow.status !== 'pending' ||
          flow.expiresAt <= this.now() || current.connection.revision !== flow.connectionRevision || current.connection.lifecycle !== 'pending')
        throw new ConnectionsError(409, 'runner_attestation_unavailable');
      const admitted = await this.options.runnerEnrollment(current);
      await this.checkProviderIdentity(current, admitted.identity);
      const credential: Credential = { accessToken: admitted.leaseMarker, ...admitted.identity, scopes: admitted.scopes,
        connectionRevision: flow.connectionRevision + 1, status: 'sealed', scopeEvidence: 'runner_attestation' };
      await this.options.vault.write('credential', `pending:${flow.flowId}`, binding, credentialSchema.parse(credential));
      flow.status = 'sealed'; flow.callbackUsed = true; flow.verifier = ''; delete flow.reason;
      await this.options.vault.write('flow', flow.flowId, binding, flow); return this.receipt(flow);
    });
  }
  private async credential(current: BrokerAuthority, actor: ConnectionActor): Promise<Credential> {
    if (current.connection.providerId === 'remote_mcp') {
      if (!this.options.credentialForAuthority) throw new ConnectionsError(503, 'mcp_setup_unavailable');
      return credentialSchema.parse(await this.options.credentialForAuthority(current));
    }
    const binding = bindingFor(current);
    return this.options.vault.withLock(`credential:${binding.connectionId}`, async () => {
      const credential = credentialSchema.parse(await this.options.vault.read('credential', binding.connectionId, binding));
      if (credential.status !== 'active' || credential.connectionRevision !== current.connection.revision || current.connection.lifecycle !== 'connected') throw new ConnectionsError(403, 'credential_inactive');
      if (credential.expiresAt && credential.expiresAt <= this.now() + 30_000) {
        const profile = this.options.oauthProfiles[binding.providerId];
        credential.status = 'refreshing'; await this.options.vault.write('credential', binding.connectionId, binding, credential);
        try {
        if (!profile || !credential.refreshToken) throw new ConnectionsError(409, 'credential_reauth_required');
        const refreshed = await this.options.oauth.refresh(profile, credential.refreshToken);
        try {
        if (refreshed.scopes.some(scope => !credential.scopes.includes(scope))) throw new ConnectionsError(403, 'refresh_scope_expansion_denied');
        const identity = await this.options.oauth.identity(binding.providerId, refreshed.accessToken, { accountId: binding.accountId, space: binding.space, connectionId: binding.connectionId });
        if (identity.subject !== credential.subject || identity.tenant !== credential.tenant || identity.issuer !== credential.issuer) throw new ConnectionsError(403, 'refresh_identity_changed');
        const afterRefresh = await this.fresh(actor, binding.space, binding.connectionId);
        if (afterRefresh.connection.lifecycle !== 'connected' || afterRefresh.connection.revision !== current.connection.revision || afterRefresh.context.bindingRevision !== current.context.bindingRevision)
          throw new ConnectionsError(403, 'refresh_authority_revoked');
        credential.accessToken = refreshed.accessToken; credential.expiresAt = refreshed.expiresAt;
        credential.refreshToken = refreshed.refreshToken ?? credential.refreshToken; credential.scopes = refreshed.scopes; credential.status = 'active';
        await this.options.vault.write('credential', binding.connectionId, binding, credential);
        } catch { await this.options.oauth.revoke(profile, refreshed.accessToken).catch(() => 'unavailable'); throw new ConnectionsError(409, 'credential_reauth_required'); }
        } catch { credential.status = 'revoked'; await this.options.vault.write('credential', binding.connectionId, binding, credential); throw new ConnectionsError(409, 'credential_reauth_required'); }
      }
      return credential;
    });
  }
  private async preflight(parsed: z.infer<typeof executeRequestSchema>, claim: OperationClaim) {
    const operation = claim.operation;
    const current = await this.fresh(parsed.actor, parsed.space, operation.connectionId);
    const catalog = await this.options.catalogForAuthority?.(current) ?? this.options.catalog;
    const executor = await this.options.executorForAuthority?.(current, catalog, operation) ?? this.options.executor;
    const tool = catalog.get(operation.toolId);
    const provider = catalog.provider(current.connection.providerId);
    if (!tool || !provider || tool.catalogDigest !== operation.catalogDigest || tool.schemaDigest !== operation.schemaDigest ||
        current.connection.catalogDigest !== operation.catalogDigest || tool.effect !== operation.effect || tool.adapterVersion !== operation.adapterVersion ||
        digest(claim.arguments) !== operation.inputDigest) throw new ConnectionsError(409, 'broker_catalog_drift');
    if (operation.destinationId !== `provider:${current.connection.providerId}`) throw new ConnectionsError(403, 'provider_destination_mismatch');
    if (this.options.readOnly && tool.effect !== 'read' && current.connection.providerId !== 'remote_mcp') throw new ConnectionsError(403, 'effect_requires_provider_audience_qualification');
    const definition = getProviderToolDefinition(tool.id);
    const credential = await this.credential(current, parsed.actor);
    await this.checkProviderIdentity(current, credential);
    if (definition && definition.requiredScopes.some(scope => !providerScopePermits(current.connection.providerId, scope, credential.scopes))) throw new ConnectionsError(403, 'credential_scope_denied');
    return { current, tool, provider, credential, executor };
  }
  async execute(input: unknown): Promise<ConnectionExecutionResult> {
    const parsed = executeRequestSchema.parse(input);
    const workerId = `broker-${randomUUID()}`;
    const claim = await this.options.control.call<OperationClaim>({ action: 'claim', ...parsed, workerId, leaseMs: 60_000 });
    const operation = claim.operation;
    const lease = { actor: parsed.actor, space: parsed.space, operationId: operation.id, workerId, fence: claim.fence };
    let checked: { current: BrokerAuthority; tool: ReviewedTool; provider: NonNullable<ReturnType<ConnectionsCatalog['provider']>>; credential: Credential; executor: BrokerExecutor };
    try { checked = await this.preflight(parsed, claim); }
    catch {
      const receipt = await this.options.control.call<OperationReceipt>({ action: 'abandonClaim', ...lease, safeReason: 'broker_preflight_failed' });
      return { receipt };
    }
    const { current, tool, provider, credential, executor } = checked;
    const controller = new AbortController();
    const controllers = this.active.get(operation.connectionId) ?? new Set<AbortController>();
    controllers.add(controller); this.activeGrantIds.set(controller, operation.grantId); this.active.set(operation.connectionId, controllers);
    try {
    await this.options.control.call({ action: 'markDispatched', ...lease });
    const lastAuthority = await this.fresh(parsed.actor, parsed.space, operation.connectionId);
    if (lastAuthority.connection.lifecycle !== 'connected' || lastAuthority.connection.revision !== operation.connectionRevision || controller.signal.aborted)
      throw new ConnectionsError(409, 'connection_revoked');
    const timeout = setTimeout(() => controller.abort(), Math.min(tool.timeoutMs, 30_000));
    let result: ProviderResult;
    let receipt: OperationReceipt;
    try {
      result = await executor.execute(tool.id, claim.arguments, { credential: { providerId: current.connection.providerId,
        endpointProfileId: provider.endpointProfileId, accessToken: credential.accessToken, ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {}) }, operationId: operation.id, scopeKind: parsed.space,
        signal: controller.signal });
      if (result.resourceIds.length !== operation.resourceIds.length || new Set(result.resourceIds).size !== result.resourceIds.length || result.resourceIds.some(id => !operation.resourceIds.includes(id)) || Buffer.byteLength(JSON.stringify(result.data)) > tool.maxOutputBytes ||
          JSON.stringify(result.data).includes(credential.accessToken)) throw new ProviderError('provider_result_denied', tool.effect === 'read' ? 'failed' : 'unknown');
      receipt = await this.options.control.call<OperationReceipt>({ action: 'settle', ...lease, outcome: 'committed',
        ...(result.providerReceiptRef ? { providerReceiptRef: result.providerReceiptRef } : {}) });
    } catch (error) {
      clearTimeout(timeout);
      const outcome = error instanceof ProviderError && error.outcome !== 'unknown' ? 'failed' : 'outcome_unknown';
      receipt = await this.options.control.call<OperationReceipt>({ action: 'settle', ...lease, outcome });
      return { receipt };
    }
    clearTimeout(timeout);
    await this.options.control.call({ action: 'assertUsable', actor: parsed.actor, space: parsed.space, operationId: operation.id });
    const sourceIds: string[] = [];
    for (const resourceId of result.resourceIds) {
      const source = await this.options.control.call<SourceLabel>({ action: 'registerResult', actor: parsed.actor, space: parsed.space,
        operationId: operation.id, resourceId, resourceRevision: hash(result.resourceRevision ?? result.providerReceiptRef ?? operation.id) });
      if (!source.allowedDestinationIds.includes('vox:private') || !source.allowedAgentIds.includes(operation.agentId)) throw new ConnectionsError(403, 'result_disclosure_denied');
      sourceIds.push(source.id);
    }
    // Recheck again after labels and immediately before returning body across the process boundary.
    await this.options.control.call({ action: 'assertUsable', actor: parsed.actor, space: parsed.space, operationId: operation.id });
    let nativeEvidence: { providerId: string; providerTenantId: string; nativeResourceId: string; resourceIds: readonly string[]; revision: string } | undefined;
    if (tool.id === 'github.repository.get' && typeof result.data.id === 'number' && Number.isSafeInteger(result.data.id) && result.data.owner && typeof result.data.owner === 'object') {
      const ownerId = (result.data.owner as Record<string, unknown>).id;
      if (typeof ownerId === 'number' && Number.isSafeInteger(ownerId)) nativeEvidence = { providerId: 'github', providerTenantId: String(ownerId), nativeResourceId: String(result.data.id), resourceIds: result.resourceIds, revision: hash(result.resourceRevision ?? operation.id) };
    }
    if (tool.id === 'slack.channel.get' && result.data.channel && typeof result.data.channel === 'object') {
      const channel = result.data.channel as Record<string, unknown>;
      if (typeof channel.id === 'string') nativeEvidence = { providerId: 'slack', providerTenantId: credential.tenant, nativeResourceId: channel.id, resourceIds: result.resourceIds, revision: hash(result.resourceRevision ?? operation.id) };
    }
    return { receipt, output: { data: result.data, untrustedContent: true, truncated: result.truncated, ...(nativeEvidence ? { nativeEvidence } : {}) }, sourceIds };
    } finally { controllers.delete(controller); if (!controllers.size) this.active.delete(operation.connectionId); }
  }
  /** Operator-only secret enrollment. The browser and Studio never receive signing keys. */
  async registerEventSubscription(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; providerId: 'github' | 'slack';
    providerTenantId: string; nativeResourceId: string; resourceId: string; eventTypes: string[]; expiresAt: number; secret: Uint8Array }): Promise<{ subscriptionId: string }> {
    if (input.secret.byteLength < 32 || input.secret.byteLength > 1000) throw new ConnectionsError(400, 'event_secret_invalid');
    const current = await this.fresh(input.actor, input.space, input.connectionId);
    await this.options.catalogForAuthority?.(current);
    if (current.connection.lifecycle !== 'connected' || current.connection.providerId !== input.providerId) throw new ConnectionsError(409, 'subscription_connection_unavailable');
    const secretRef = randomUUID();
    const subscription = await this.options.control.call<ConnectionSubscription>({ action: 'registerSubscription', actor: input.actor, space: input.space,
      subscription: registerSubscriptionSchema.parse({ connectionId: input.connectionId, providerId: input.providerId, providerTenantId: input.providerTenantId,
        nativeResourceId: input.nativeResourceId, resourceId: input.resourceId, eventTypes: input.eventTypes, secretRef, secretVersion: 1, expiresAt: input.expiresAt }) });
    await this.options.vault.write('credential', `webhook-subscription:${subscription.id}`, bindingFor(current),
      { subscriptionId: subscription.id, secretRef, secret: Buffer.from(input.secret).toString('base64') });
    return { subscriptionId: subscription.id };
  }
  async receiveEvent(providerId: string, subscriptionId: string, rawBody: Uint8Array, headers: Readonly<Record<string, string | undefined>>): Promise<{ accepted: true; duplicate: boolean; eventId: string }> {
    if (!['github', 'slack'].includes(providerId)) throw new ConnectionsError(404, 'event_provider_unavailable');
    const id = `webhook-subscription:${idSchema.parse(subscriptionId)}`;
    const binding = await this.options.vault.binding('credential', id);
    if (!binding || binding.providerId !== providerId) throw new ConnectionsError(404, 'subscription_unavailable');
    const current = await this.fresh({ accountId: binding.accountId }, binding.space, binding.connectionId);
    await this.options.catalogForAuthority?.(current);
    const auth = await this.options.control.call<BrokerSubscriptionAuthority>({ action: 'subscriptionContext', actor: { accountId: binding.accountId },
      space: binding.space, connectionId: binding.connectionId, subscriptionId });
    if (auth.connection.lifecycle !== 'connected' || auth.context.personId !== binding.personId) throw new ConnectionsError(403, 'subscription_revoked');
    const stored = z.object({ subscriptionId: idSchema, secretRef: idSchema, secret: z.string().max(2000) }).strict().parse(await this.options.vault.read('credential', id, binding));
    if (stored.subscriptionId !== subscriptionId || stored.secretRef !== auth.subscription.secretRef) throw new ConnectionsError(403, 'subscription_key_mismatch');
    const event = verifyProviderEvent(rawBody, headers, auth.subscription, Buffer.from(stored.secret, 'base64'), this.now());
    return this.options.control.call({ action: 'ingestVerifiedEvent', actor: { accountId: binding.accountId }, space: binding.space, event });
  }
  async invalidate(input: unknown): Promise<{ futureUseStopped: true; providerEffects: 'unverified' }> {
    const parsed = invalidateRequestSchema.parse(input);
    const current = await this.options.control.call<BrokerGrantAuthority>({ action: 'grantContext', ...parsed });
    if (current.context.accountId !== parsed.actor.accountId || current.context.scope.spaceKind !== parsed.space ||
        current.connection.id !== parsed.connectionId || current.grant.id !== parsed.grantId || current.grant.connectionId !== parsed.connectionId || current.grant.status !== 'revoked')
      throw new ConnectionsError(409, 'grant_revoke_control_plane_first');
    for (const controller of this.active.get(parsed.connectionId) ?? []) if (this.activeGrantIds.get(controller) === parsed.grantId) controller.abort();
    return { futureUseStopped: true, providerEffects: 'unverified' };
  }
  async revoke(input: unknown): Promise<{ futureUseStopped: true; providerRevocation: 'verified' | 'unavailable' }> {
    const parsed = revokeRequestSchema.parse(input);
    const current = await this.fresh(parsed.actor, parsed.space, parsed.connectionId, false);
    if (current.connection.providerId !== parsed.providerId || !['revoked', 'deleted'].includes(current.connection.lifecycle)) throw new ConnectionsError(409, 'revoke_control_plane_first');
    for (const controller of this.active.get(current.connection.id) ?? []) controller.abort();
    if (current.connection.providerId === 'remote_mcp') { if (!this.options.revokeForAuthority) throw new ConnectionsError(503, 'mcp_setup_unavailable'); return this.options.revokeForAuthority(current); }
    const binding = bindingFor(current);
    for (const flowId of await this.options.vault.listFlows()) {
      const candidate = await this.options.vault.binding('flow', flowId);
      if (!candidate || candidate.accountId !== binding.accountId || candidate.space !== binding.space || candidate.personId !== binding.personId || candidate.connectionId !== binding.connectionId) continue;
      await this.options.vault.withLock(`flow:${flowId}`, async () => {
        const flow = flowSchema.parse(await this.options.vault.read('flow', flowId, candidate));
        if (flow.status === 'connected') return;
        const pending = await this.options.vault.read('credential', `pending:${flowId}`, candidate);
        if (pending) { const token = credentialSchema.parse(pending); const profile = this.options.oauthProfiles[binding.providerId];
          if (profile) await this.options.oauth.revoke(profile, token.accessToken).catch(() => 'unavailable'); }
        await this.options.vault.delete('credential', `pending:${flowId}`);
        flow.status = 'cancelled'; flow.verifier = ''; await this.options.vault.write('flow', flowId, candidate, flow);
      });
    }
    return this.options.vault.withLock(`credential:${binding.connectionId}`, async () => {
      const raw = await this.options.vault.read('credential', binding.connectionId, binding);
      if (!raw) return { futureUseStopped: true, providerRevocation: 'unavailable' };
      const credential = credentialSchema.parse(raw);
      credential.status = 'revoked'; await this.options.vault.write('credential', binding.connectionId, binding, credential);
      const profile = this.options.oauthProfiles[binding.providerId];
      const providerRevocation = profile ? await this.options.oauth.revoke(profile, credential.accessToken) : 'unavailable';
      await this.options.vault.delete('credential', binding.connectionId);
      return { futureUseStopped: true, providerRevocation };
    });
  }
}
