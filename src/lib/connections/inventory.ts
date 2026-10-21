import { createConnectionsCatalog } from './catalog';
import { getProviderToolDefinition } from './providers';
import type { ConnectionProfile, ConnectionsConfiguration } from './config';
import type { SpaceKind } from './contracts';

/** An agent never inherits the legacy unbound inventory or another agent's account. */
export const profilesForAgent = (config: ConnectionsConfiguration, accountId: string, space: SpaceKind, agentId?: string): ConnectionProfile[] =>
  config.profiles.filter(profile => profile.accountId === accountId && profile.space === space && profile.agentId === agentId);

export function catalogForProfiles(profiles: readonly ConnectionProfile[]) {
  const resourceIdsByTool: Record<string, string[]> = {};
  const endpointProfileIds: Record<string, string> = {};
  for (const profile of profiles) {
    endpointProfileIds[profile.providerId] = profile.endpointProfileId;
    if (!profile.qualified) continue;
    for (const resource of profile.resources) for (const toolId of resource.toolIds) {
      if (getProviderToolDefinition(toolId)?.effect === 'read') (resourceIdsByTool[toolId] ??= []).push(resource.id);
    }
  }
  return createConnectionsCatalog({ resourceIdsByTool, endpointProfileIds,
    destinationIds: ['vox:private', 'model:studio', ...profiles.map(profile => `provider:${profile.providerId}`)] });
}
