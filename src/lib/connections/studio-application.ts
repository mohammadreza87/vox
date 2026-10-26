import { z } from 'zod';
import type { Studio } from '../studio/service';
import type { ConnectionsApplication, ConnectionsDashboard, SetupReceipt, ConnectionExecutionResult, McpSetupPreview, ConnectionProviderView, McpNeed, ProviderNeed, ProviderSetupState } from './application';
import type { ConnectionActor, SpaceKind, ConnectionsSnapshot } from './contracts';
import { connectionAgentId, enrollmentInputSchema, grantInputSchema, revokeInputSchema } from './contracts';
import type { ConnectionsStorage } from './storage';
import { ConnectionsRepository } from './repository';
import { ConnectionsService } from './service';
import { createStudioConnectionAuthority, assertStudioConnectionAuthorityCurrent } from './authority';
import { listProviderDefinitions } from './catalog';
import { catalogForProfiles, profilesForAgent } from './inventory';
import { getProviderToolDefinition } from './providers';
import type { ConnectionProfile, ConnectionsConfiguration } from './config';
import { deny } from './errors';
import { assertOwner } from './policy';
import { McpConnectionsCatalog } from './mcp/catalog';
import { ConnectionTaskRuntime } from './task-runtime';
import type { ConnectionsBudgetLedger } from './budgets';
import { CONNECTION_RUNTIME_SKILLS } from './skills';
import { ConnectionsWorkflowService } from './workflows/service';
import { workflowRecipe } from './workflows/recipes';
import { settingsV2 } from '../studio/flags';
import { retryErasedRevocations } from './rights';

/** Providers the broker can sign in to in a browser (broker/oauth.ts); runners need an attested worker; the rest take an operator token. */
const SIGN_IN_PROVIDERS = new Set(['github', 'google_drive', 'google_docs', 'google_sheets', 'google_slides', 'gmail', 'google_analytics']);
const RUNNER_PROVIDERS = new Set(['browser', 'ssh']);

export interface ConnectionsBrokerPort {
  begin(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; expectedRevision: number; providerId: string }): Promise<SetupReceipt>;
  claim(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt>;
  cancel(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt>;
  execute(input: { actor: ConnectionActor; space: SpaceKind; operationId: string }): Promise<ConnectionExecutionResult>;
  revoke(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; providerId: string }): Promise<unknown>;
  /** Rights erasure (/v1/erase): a connection Studio revoked and marked erased, with no current identity confirmation. */
  erase?(input: { actor: { accountId: string }; space: SpaceKind; connectionId: string; providerId: string }): Promise<unknown>;
  mcpBegin?(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; expectedRevision: number; endpointUrl: string }): Promise<SetupReceipt>;
  mcpPreview?(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<McpSetupPreview>;
  mcpClaim?(input: { actor: ConnectionActor; space: SpaceKind; flowId: string; acceptedCatalogDigest: string }): Promise<SetupReceipt>;
  mcpCancel?(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt>;
  invalidate?(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; grantId: string }): Promise<unknown>;
}
export interface StudioConnectionsOptions {
  storage: ConnectionsStorage;
  configuration: () => Promise<ConnectionsConfiguration>;
  broker?: ConnectionsBrokerPort;
  budgets?: ConnectionsBudgetLedger;
}
/** One immutable catalogue per authenticated account/space. Never aggregate all
 * tenants' inventories into a global tool catalogue or resource picker. */
export async function createStudioConnectionsApplication(studio: Studio, boundActor: ConnectionActor, boundSpace: SpaceKind,
  options: StudioConnectionsOptions): Promise<ConnectionsApplication> {
  const configuration = await options.configuration();
  const profiles = configuration.profiles.filter(p => p.accountId === boundActor.accountId && p.space === boundSpace);
  const catalogForAgent = (agentId: string | undefined) => catalogForProfiles(profilesForAgent(configuration, boundActor.accountId, boundSpace, agentId));
  const catalog = catalogForAgent(undefined);
  const resolve = createStudioConnectionAuthority(studio);
  const service = new ConnectionsService(new ConnectionsRepository(options.storage, context => assertStudioConnectionAuthorityCurrent(studio, { accountId: context.accountId, ...(context.botAgentId ? { botAgentId: context.botAgentId, botAuthenticationRevision: context.botAuthenticationRevision } : {}) }, context)), { catalog, catalogForAgent, singleConnectionPerProvider: true,
    assertContextCurrent: (actor, context) => assertStudioConnectionAuthorityCurrent(studio, actor, context),
    resolveContext: async (actor, space) => {
      if (actor.accountId !== boundActor.accountId || actor.botAgentId !== boundActor.botAgentId || actor.botAuthenticationRevision !== boundActor.botAuthenticationRevision || space !== boundSpace) return deny('partition_denied');
      return resolve(actor, space);
    },
  });
  const currentProfile = async (providerId: string, agentId?: string, requireEnabled = true): Promise<ConnectionProfile> => {
    const current = await options.configuration();
    const profile = current.profiles.find(p => p.accountId === boundActor.accountId && p.space === boundSpace && p.providerId === providerId && p.agentId === agentId);
    if (!profile || !profile.qualified || requireEnabled && (!current.enabled || !options.broker)) return deny('provider_setup_required', 503);
    const original = profiles.find(p => p.providerId === providerId && p.agentId === agentId);
    if (JSON.stringify(profile) !== JSON.stringify(original)) return deny('configuration_changed', 409);
    return profile;
  };
  const connectionFor = async (actor: ConnectionActor, space: SpaceKind, connectionId: string) => {
    const context = await service.context(actor, space);
    return service.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === connectionId);
      if (!connection) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      return { connection, account: records.providerAccounts.find(p => p.id === connection.providerAccountId) };
    });
  };
  /**
   * Custom MCP from the Vox main app (Settings v2): a manager-signed actor may add a server for an agent it can use
   * (service.enrollMcp checks currentAgentIds = canUseAgent && !blocked). It needs the synchronous committed-state
   * fence (file storage); without it the main-app path stays closed. Bot-signed actors keep their own path.
   */
  /** The main-app path's final fence exists: a committed Studio read and a committed identity read (authority.ts). */
  const mainAppFence = (accountId: string) => !!studio.deps.store.readCommittedForEffect && !!studio.deps.adaptive
    && studio.deps.adaptive.repository.readCommittedForEffect(accountId, Date.now()).status !== 'unsupported';
  const assertMcpSurface = (actor: ConnectionActor) => {
    if (actor.botAgentId) return;
    if (!settingsV2()) return deny('mcp_open_agent_bot');
    if (!mainAppFence(actor.accountId)) return deny('connection_authority_transport_unavailable', 503);
  };
  const mcpAvailable = async () => { const current = await options.configuration(); return current.enabled && !!current.selfServiceMcp?.enabled && !!options.broker?.mcpBegin && !!options.broker.mcpPreview && !!options.broker.mcpClaim && !!options.broker.mcpCancel; };
  const assertMcpAvailable = async () => { if (!await mcpAvailable()) return deny('mcp_setup_unavailable', 503); };
  const currentModelPolicy = (config: ConnectionsConfiguration): boolean => {
    const identity = studio.deps.chatLLM.identity;
    return !!(config.modelPolicy?.qualified && identity && config.modelPolicy.provider === identity.provider && config.modelPolicy.model === identity.model);
  };
  const app: ConnectionsApplication = {
    service,
    async assertWorkflowMutationAllowed() {
      if (!(await options.configuration()).enabled || !options.broker) return deny('connections_paused', 503);
    },
    async workflowChoices(actor, space) {
      const snapshot = await service.list(actor, { space });
      const choices = [];
      for (const connection of snapshot.connections.filter(c => c.lifecycle === 'connected')) {
        const resources = await app.resources(actor, space, connection.id);
        for (const grant of snapshot.grants.filter(g => g.connectionId === connection.id && g.status === 'active' && g.expiresAt > Date.now())) {
          for (const resource of resources.filter(r => grant.resourceIds.includes(r.id))) {
            const recipe = workflowRecipe(resource.id, resource.toolIds.filter(id => grant.toolIds.includes(id)));
            if (recipe) choices.push({ ...recipe, id: `${grant.id}:${resource.id}`, grantId: grant.id, agentId: grant.agentId,
              connectionId: connection.id, providerId: connection.providerId, label: resource.label, resourceId: resource.id, expiresAt: grant.expiresAt });
          }
        }
      }
      return choices;
    },
    async dashboard(actor, space, agentId): Promise<ConnectionsDashboard> {
      const context = await service.context(actor, space);
      agentId = context.botAgentId ?? agentId;
      const current = await options.configuration();
      const state = await studio.deps.store.read();
      const enabled = current.enabled && !!options.broker;
      let snapshot = await service.list(actor, { space, ...(agentId ? { agentId } : {}) });
      // An erasure that could not reach the broker is finished here (paced per partition). /v1/erase needs no actor; the
      // /v1/revoke fallback uses this actor only for connections it may act on (a bot actor: its own agent's).
      if (snapshot.connections.some(c => c.lifecycle === 'revoked' || c.lifecycle === 'deleted')) {
        const broker = options.broker;
        const purged = await retryErasedRevocations({ storage: options.storage, ...(broker?.erase ? { erase: input => broker.erase!(input) } : {}),
          ...(broker ? { revoke: input => broker.revoke(input) } : {}), log: studio.deps.logger ?? console,
          actorFor: async (_, connection) => !actor.botAgentId || connection.schemaVersion === 2 && connection.agentId === actor.botAgentId ? actor : undefined },
        boundActor.accountId, space);
        if (purged > 0) snapshot = await service.list(actor, { space, ...(agentId ? { agentId } : {}) });
      }
      const v2 = settingsV2();
      const modelReady = currentModelPolicy(current);
      const providerState = (provider: ReturnType<typeof listProviderDefinitions>[number], profile: ConnectionProfile | undefined): ProviderSetupState => {
        const how = SIGN_IN_PROVIDERS.has(provider.id) ? 'sign_in' as const : RUNNER_PROVIDERS.has(provider.id) ? 'runner' as const : 'vox_adds' as const;
        if (provider.tools.some(t => t.personalOnly) && space !== 'personal') return { status: 'not_here', how, needs: ['personal_only'] };
        const connection = agentId ? snapshot.connections.find(c => c.agentId === agentId && c.providerId === provider.id && ['connected', 'pending'].includes(c.lifecycle)) : undefined;
        const until = connection && snapshot.grants.filter(g => g.connectionId === connection.id && g.agentId === agentId && g.status === 'active' && g.expiresAt > Date.now()).map(g => g.expiresAt).sort((a, b) => b - a)[0];
        const needs: ProviderNeed[] = [...(!current.enabled ? ['connections_off' as const] : []), ...(!options.broker ? ['service_off' as const] : []), ...(!profile?.qualified ? ['not_set_up_for_you' as const] : [])];
        const answers: ProviderNeed[] = modelReady ? [] : ['answers_off'];
        if (connection?.lifecycle === 'connected') return { status: 'connected', how, needs: [...needs, ...answers], connectionId: connection.id, ...(until ? { connectedUntil: until } : {}) };
        // Only browser sign-in finishes from a page; an operator token or a runner is finished by a Vox operator (broker CLI).
        const enrolls: ProviderNeed[] = how === 'sign_in' ? [] : ['vox_enrolls'];
        if (connection) return { status: 'pending', how, needs: [...needs, ...enrolls], connectionId: connection.id };
        return needs.length || enrolls.length ? { status: 'needs_vox', how, needs: [...needs, ...enrolls] } : { status: 'available', how, needs: answers };
      };
      const mcpNeeds: McpNeed[] = [...(!current.enabled ? ['connections_off' as const] : []), ...(!options.broker?.mcpBegin || !options.broker.mcpPreview || !options.broker.mcpClaim || !options.broker.mcpCancel ? ['service_off' as const] : []),
        ...(!current.selfServiceMcp?.enabled ? ['mcp_off' as const] : []), ...(!actor.botAgentId && !mainAppFence(actor.accountId) ? ['main_app_off' as const] : [])];
      return { ...snapshot, enabled, mcpAvailable: await mcpAvailable(),
        ...(v2 ? { mcp: { available: !mcpNeeds.length, needs: [...mcpNeeds, ...(modelReady ? [] : ['answers_off' as const])] } } : {}),
        canRunTasks: enabled && currentModelPolicy(current), ...(studio.deps.chatLLM.identity ? { modelProcessor: studio.deps.chatLLM.identity } : {}),
        skills: CONNECTION_RUNTIME_SKILLS.filter(s => s.spaces.includes(space)).map(s => ({ id: s.id, version: s.version, title: s.title, providerIds: s.providerIds })),
        maxGrantExpiryAt: Math.min(context.bindingExpiresAt, Date.now() + 30 * 86_400_000),
        agents: state.agents.filter(a => context.currentAgentIds.includes(a.id) && (!agentId || a.id === agentId)).map(a => ({ id: a.id, name: a.persona.name })),
        providers: [...listProviderDefinitions().map<ConnectionProviderView>(provider => {
          const profile = profiles.find(p => p.providerId === provider.id && p.agentId === agentId);
          return { id: provider.id, name: provider.label, description: provider.tools.filter(t => getProviderToolDefinition(t.id)?.effect === 'read').map(t => t.title).join(' · '),
            setup: profile?.setup ?? (provider.auth === 'oauth' || provider.auth === 'delegated_oauth' ? 'oauth' : 'operator'),
            availability: enabled && profile?.qualified ? 'ready' : provider.tools.some(t => t.personalOnly) && space !== 'personal' ? 'unavailable' : 'setup_required',
            reason: profile?.qualified && enabled ? '' : provider.eligibilityReason,
            tools: provider.tools.filter(t => (!t.personalOnly || space === 'personal') && getProviderToolDefinition(t.id)?.effect === 'read').map(t => ({ id: t.id, name: t.title, effect: getProviderToolDefinition(t.id)!.effect })),
            ...(v2 ? { state: providerState(provider, profile) } : {}),
          };
        }), ...(snapshot.connections.some(c => c.mcp?.catalog) ? [{ id: 'remote_mcp', name: 'MCP server', description: 'Your separately connected server', setup: 'oauth' as const,
          availability: 'unavailable' as const, reason: 'Add a separate server using Connect an MCP server.', tools: snapshot.connections.flatMap(c => c.mcp?.catalog ? new McpConnectionsCatalog(c.mcp.catalog).view().tools.map(t => ({ id: t.id, name: t.title, effect: t.effect })) : []) }] : [])],
      };
    },
    async resources(actor, space, connectionId) {
      const { connection, account } = await connectionFor(actor, space, connectionId);
      if (connection.schemaVersion === 2 && connection.mcp) {
        await assertMcpAvailable();
        if (connection.lifecycle !== 'connected' || !account || !connection.mcp.catalog) return deny('mcp_connection_unavailable');
        const catalog = new McpConnectionsCatalog(connection.mcp.catalog), view = catalog.view();
        return [{ id: catalog.resourceId, label: connection.mcp.canonicalResourceUri, toolIds: view.tools.map(t => t.id),
          destinationIds: ['provider:remote_mcp', 'model:studio', 'vox:private'], tools: view.tools.map(t => ({ id: t.id, name: t.title, effect: t.effect })) }];
      }
      const profile = await currentProfile(connection.providerId, connectionAgentId(connection));
      if (connection.lifecycle !== 'connected' || !account || account.providerSubject !== profile.providerSubject || account.providerTenantId !== profile.providerTenantId)
        return deny('provider_identity_mismatch');
      return profile.resources.map(r => ({ ...r, toolIds: r.toolIds.filter(id => getProviderToolDefinition(id)?.effect === 'read'),
        destinationIds: [`provider:${profile.providerId}`, 'model:studio', 'vox:private'] })).filter(r => r.toolIds.length > 0);
    },
    async enrollMcp(actor, raw) { assertMcpSurface(actor); await assertMcpAvailable(); return service.enrollMcp(actor, raw); },
    async previewMcpSetup(actor, space, flowId) { assertMcpSurface(actor); await service.context(actor, space); await assertMcpAvailable(); return options.broker!.mcpPreview!({ actor, space, flowId }); },
    async claimMcpSetup(actor, space, flowId, acceptedCatalogDigest) { assertMcpSurface(actor); await service.context(actor, space); await assertMcpAvailable(); return options.broker!.mcpClaim!({ actor, space, flowId, acceptedCatalogDigest }); },
    async cancelMcpSetup(actor, space, flowId) { await service.context(actor, space); if (!options.broker?.mcpCancel) return deny('broker_unavailable', 503); return options.broker.mcpCancel({ actor, space, flowId }); },
    async enroll(actor, raw): Promise<ConnectionsSnapshot> {
      const input = enrollmentInputSchema.parse(raw);
      const context = await service.context(actor, input.space);
      if (context.botAgentId && input.agentId !== context.botAgentId) return deny('agent_connection_mismatch');
      if (input.agentId && !context.currentAgentIds.includes(input.agentId)) return deny('agent_unavailable');
      await currentProfile(input.providerId, input.agentId);
      const snapshot = await service.list(actor, { space: input.space });
      if (snapshot.connections.some(c => c.providerId === input.providerId && c.agentId === input.agentId && !['deleted', 'revoked'].includes(c.lifecycle))) return deny('connection_exists', 409);
      return service.enroll(actor, input);
    },
    async grant(actor, raw) {
      const input = grantInputSchema.parse(raw);
      const { connection } = await connectionFor(actor, input.space, input.connectionId);
      if (connection.schemaVersion === 2 && connection.agentId !== input.agentId) return deny('agent_connection_mismatch');
      if (!(connection.schemaVersion === 2 && connection.mcp) && (input.effects.some(effect => effect !== 'read') || input.toolIds.some(id => getProviderToolDefinition(id)?.effect !== 'read'))) return deny('external_effects_not_qualified');
      const allowed = await app.resources(actor, input.space, input.connectionId);
      if (input.resourceIds.some(id => !allowed.some(r => r.id === id && input.toolIds.every(t => r.toolIds.includes(t))))) return deny('resource_not_registered');
      return service.grant(actor, input);
    },
    async revoke(actor, raw) {
      const input = revokeInputSchema.parse(raw);
      const { connection } = await connectionFor(actor, input.space, input.connectionId);
      const snapshot = await service.revoke(actor, input);
      if (!input.grantId) await options.broker?.revoke({ actor, space: input.space, connectionId: connection.id, providerId: connection.providerId }).catch(() => undefined);
      else await options.broker?.invalidate?.({ actor, space: input.space, connectionId: connection.id, grantId: input.grantId }).catch(() => undefined);
      return snapshot;
    },
    async beginSetup(actor, space, connectionId) {
      const { connection } = await connectionFor(actor, space, connectionId);
      if (connection.schemaVersion === 2 && connection.mcp) {
        if (actor.botAgentId ? actor.botAgentId !== connection.agentId : (assertMcpSurface(actor), !(await service.context(actor, space)).currentAgentIds.includes(connection.agentId))) return deny('mcp_open_agent_bot');
        await assertMcpAvailable();
        return { ...await options.broker!.mcpBegin!({ actor, space, connectionId, expectedRevision: connection.revision, endpointUrl: connection.mcp.canonicalResourceUri }), kind: 'remote_mcp' as const }; }
      await currentProfile(connection.providerId, connectionAgentId(connection));
      if (connection.lifecycle !== 'pending') return deny('connection_not_pending', 409);
      return options.broker!.begin({ actor, space, connectionId, expectedRevision: connection.revision, providerId: connection.providerId });
    },
    async claimSetup(actor, space, flowId) {
      await service.context(actor, space);
      if (!options.broker) return deny('broker_unavailable', 503);
      return options.broker.claim({ actor, space, flowId });
    },
    async cancelSetup(actor, space, flowId) {
      await service.context(actor, space);
      if (!options.broker) return deny('broker_unavailable', 503);
      return options.broker.cancel({ actor, space, flowId });
    },
    async execute(actor, space, operationId) {
      const snapshot = await service.list(actor, { space });
      const receipt = snapshot.operations.find(o => o.operationId === operationId);
      if (!receipt) return deny('operation_unavailable', 404);
      const tool = getProviderToolDefinition(receipt.toolId);
      const context = await service.context(actor, space);
      const connection = await service.repository.transaction(context, records => records.connections.find(c => c.id === records.operations.find(o => o.id === operationId)?.connectionId));
      if (!connection) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (connection.schemaVersion === 2 && connection.mcp) await assertMcpAvailable();
      else { if (!tool || tool.effect !== 'read') return deny('external_effects_not_qualified'); await currentProfile(tool.providerId, connectionAgentId(connection)); }
      // A premature click must not consume the single-use spend reservation.
      // The broker still rechecks current approval, authority and dispatch state.
      if (!['queued', 'authorized'].includes(receipt.state)) return deny('operation_not_dispatchable', 409);
      await app.reserveTaskBudget?.(connection.providerId, `operation:${operationId}`, 'tool_calls', 1, connectionAgentId(connection));
      return options.broker!.execute({ actor, space, operationId });
    },
    async task(actor, input) {
      if (!currentModelPolicy(await options.configuration())) return deny('model_processor_not_qualified', 503);
      return new ConnectionTaskRuntime(app, studio.deps.chatLLM).run(actor, input);
    },
    async assertTaskCurrent(providerId, agentId) { if (providerId === 'remote_mcp') await assertMcpAvailable(); else await currentProfile(providerId, agentId); },
    async assertModelCurrent() {
      const current = await options.configuration();
      if (!current.enabled || !currentModelPolicy(current) || JSON.stringify(current.modelPolicy) !== JSON.stringify(configuration.modelPolicy)) return deny('model_processor_not_qualified', 503);
    },
    async reserveTaskBudget(providerId, requestId, kind, units, agentId) {
      const profile = providerId === 'remote_mcp' ? (await assertMcpAvailable(), (await options.configuration()).selfServiceMcp!) : await currentProfile(providerId, agentId);
      if (kind === 'model_tokens' && !currentModelPolicy(await options.configuration())) return deny('model_processor_not_qualified', 503);
      if (!options.budgets) return deny('budget_not_configured');
      await options.budgets.reserve({ accountId: boundActor.accountId, space: boundSpace, providerId: agentId ? `${providerId}:agent:${agentId}` : providerId, requestId, kind, units,
        ceiling: kind === 'model_tokens' ? profile.dailyModelTokenCeiling : profile.dailyToolCallCeiling });
    },
  };
  app.workflows = new ConnectionsWorkflowService(service, { dispatcher: (actor, space, operationId) => app.execute(actor, space, operationId) });
  return app;
}

export const connectionTaskRouteSchema = z.object({ space: z.enum(['work', 'personal']) }).passthrough();
