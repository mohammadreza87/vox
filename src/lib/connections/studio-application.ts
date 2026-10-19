import { z } from 'zod';
import type { Studio } from '../studio/service';
import type { ConnectionsApplication, ConnectionsDashboard, SetupReceipt, ConnectionExecutionResult } from './application';
import type { ConnectionActor, SpaceKind, ConnectionsSnapshot } from './contracts';
import { enrollmentInputSchema, grantInputSchema, revokeInputSchema } from './contracts';
import type { ConnectionsStorage } from './storage';
import { ConnectionsRepository } from './repository';
import { ConnectionsService } from './service';
import { createStudioConnectionAuthority } from './authority';
import { createConnectionsCatalog, listProviderDefinitions } from './catalog';
import { getProviderToolDefinition } from './providers';
import type { ConnectionProfile, ConnectionsConfiguration } from './config';
import { deny } from './errors';
import { ConnectionTaskRuntime } from './task-runtime';
import type { ConnectionsBudgetLedger } from './budgets';
import { CONNECTION_RUNTIME_SKILLS } from './skills';
import { ConnectionsWorkflowService } from './workflows/service';
import { workflowRecipe } from './workflows/recipes';

export interface ConnectionsBrokerPort {
  begin(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; expectedRevision: number; providerId: string }): Promise<SetupReceipt>;
  claim(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt>;
  cancel(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt>;
  execute(input: { actor: ConnectionActor; space: SpaceKind; operationId: string }): Promise<ConnectionExecutionResult>;
  revoke(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; providerId: string }): Promise<unknown>;
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
  const resourceIdsByTool: Record<string, string[]> = {};
  const endpointProfileIds: Record<string, string> = {};
  for (const profile of profiles) {
    endpointProfileIds[profile.providerId] = profile.endpointProfileId;
    if (!profile.qualified) continue;
    for (const resource of profile.resources) for (const toolId of resource.toolIds) {
      if (getProviderToolDefinition(toolId)?.effect === 'read') (resourceIdsByTool[toolId] ??= []).push(resource.id);
    }
  }
  const catalog = createConnectionsCatalog({ resourceIdsByTool, endpointProfileIds,
    destinationIds: ['vox:private', 'model:studio', ...profiles.map(p => `provider:${p.providerId}`)] });
  const resolve = createStudioConnectionAuthority(studio);
  const service = new ConnectionsService(new ConnectionsRepository(options.storage), { catalog, singleConnectionPerProvider: true,
    resolveContext: async (actor, space) => {
      if (actor.accountId !== boundActor.accountId || space !== boundSpace) return deny('partition_denied');
      return resolve(actor, space);
    },
  });
  const currentProfile = async (providerId: string, requireEnabled = true): Promise<ConnectionProfile> => {
    const current = await options.configuration();
    const profile = current.profiles.find(p => p.accountId === boundActor.accountId && p.space === boundSpace && p.providerId === providerId);
    if (!profile || !profile.qualified || requireEnabled && (!current.enabled || !options.broker)) return deny('provider_setup_required', 503);
    const original = profiles.find(p => p.providerId === providerId);
    if (JSON.stringify(profile) !== JSON.stringify(original)) return deny('configuration_changed', 409);
    return profile;
  };
  const connectionFor = async (actor: ConnectionActor, space: SpaceKind, connectionId: string) => {
    const context = await service.context(actor, space);
    return service.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === connectionId);
      if (!connection) return deny('connection_unavailable', 404);
      return { connection, account: records.providerAccounts.find(p => p.id === connection.providerAccountId) };
    });
  };
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
    async dashboard(actor, space): Promise<ConnectionsDashboard> {
      const context = await service.context(actor, space);
      const current = await options.configuration();
      const state = await studio.deps.store.read();
      const enabled = current.enabled && !!options.broker;
      return { ...await service.list(actor, { space }), enabled,
        canRunTasks: enabled && currentModelPolicy(current), ...(studio.deps.chatLLM.identity ? { modelProcessor: studio.deps.chatLLM.identity } : {}),
        skills: CONNECTION_RUNTIME_SKILLS.filter(s => s.spaces.includes(space)).map(s => ({ id: s.id, version: s.version, title: s.title, providerIds: s.providerIds })),
        maxGrantExpiryAt: Math.min(context.bindingExpiresAt, Date.now() + 30 * 86_400_000),
        agents: state.agents.filter(a => context.currentAgentIds.includes(a.id)).map(a => ({ id: a.id, name: a.persona.name })),
        providers: listProviderDefinitions().map(provider => {
          const profile = profiles.find(p => p.providerId === provider.id);
          return { id: provider.id, name: provider.label, description: provider.tools.filter(t => getProviderToolDefinition(t.id)?.effect === 'read').map(t => t.title).join(' · '),
            setup: profile?.setup ?? (provider.auth === 'oauth' || provider.auth === 'delegated_oauth' ? 'oauth' : 'operator'),
            availability: enabled && profile?.qualified ? 'ready' : provider.tools.some(t => t.personalOnly) && space !== 'personal' ? 'unavailable' : 'setup_required',
            reason: profile?.qualified && enabled ? '' : provider.eligibilityReason,
            tools: provider.tools.filter(t => (!t.personalOnly || space === 'personal') && getProviderToolDefinition(t.id)?.effect === 'read').map(t => ({ id: t.id, name: t.title, effect: getProviderToolDefinition(t.id)!.effect })),
          };
        }),
      };
    },
    async resources(actor, space, connectionId) {
      const { connection, account } = await connectionFor(actor, space, connectionId);
      const profile = await currentProfile(connection.providerId);
      if (connection.lifecycle !== 'connected' || !account || account.providerSubject !== profile.providerSubject || account.providerTenantId !== profile.providerTenantId)
        return deny('provider_identity_mismatch');
      return profile.resources.map(r => ({ ...r, toolIds: r.toolIds.filter(id => getProviderToolDefinition(id)?.effect === 'read'),
        destinationIds: [`provider:${profile.providerId}`, 'model:studio', 'vox:private'] })).filter(r => r.toolIds.length > 0);
    },
    async enroll(actor, raw): Promise<ConnectionsSnapshot> {
      const input = enrollmentInputSchema.parse(raw);
      await currentProfile(input.providerId);
      const snapshot = await service.list(actor, { space: input.space });
      if (snapshot.connections.some(c => c.providerId === input.providerId && !['deleted', 'revoked'].includes(c.lifecycle))) return deny('connection_exists', 409);
      return service.enroll(actor, input);
    },
    async grant(actor, raw) {
      const input = grantInputSchema.parse(raw);
      if (input.effects.some(effect => effect !== 'read') || input.toolIds.some(id => getProviderToolDefinition(id)?.effect !== 'read')) return deny('external_effects_not_qualified');
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
      await currentProfile(connection.providerId);
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
      if (!tool) return deny('tool_unavailable', 404);
      if (tool.effect !== 'read') return deny('external_effects_not_qualified');
      await currentProfile(tool.providerId);
      await app.reserveTaskBudget?.(tool.providerId, `operation:${operationId}`, 'tool_calls', 1);
      return options.broker!.execute({ actor, space, operationId });
    },
    async task(actor, input) {
      if (!currentModelPolicy(await options.configuration())) return deny('model_processor_not_qualified', 503);
      return new ConnectionTaskRuntime(app, studio.deps.chatLLM).run(actor, input);
    },
    async assertTaskCurrent(providerId) { await currentProfile(providerId); },
    async assertModelCurrent() {
      const current = await options.configuration();
      if (!current.enabled || !currentModelPolicy(current) || JSON.stringify(current.modelPolicy) !== JSON.stringify(configuration.modelPolicy)) return deny('model_processor_not_qualified', 503);
    },
    async reserveTaskBudget(providerId, requestId, kind, units) {
      const profile = await currentProfile(providerId);
      if (kind === 'model_tokens' && !currentModelPolicy(await options.configuration())) return deny('model_processor_not_qualified', 503);
      if (!options.budgets) return deny('budget_not_configured');
      await options.budgets.reserve({ accountId: boundActor.accountId, space: boundSpace, providerId, requestId, kind, units,
        ceiling: kind === 'model_tokens' ? profile.dailyModelTokenCeiling : profile.dailyToolCallCeiling });
    },
  };
  app.workflows = new ConnectionsWorkflowService(service, { dispatcher: (actor, space, operationId) => app.execute(actor, space, operationId) });
  return app;
}

export const connectionTaskRouteSchema = z.object({ space: z.enum(['work', 'personal']) }).passthrough();
