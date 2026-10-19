import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createConnectionsCatalog } from '../catalog';
import { getProviderToolDefinition } from '../providers';
import { ProviderRegistry } from '../providers/registry';
import { readConnectionsConfiguration } from '../config';
import type { BrokerAuthority } from './control';
import { ConnectionsError } from '../errors';
import { AuthenticatedBrokerClient, BrokerAuthenticator } from './auth';
import { HttpBrokerControlPlane } from './control';
import { FileBrokerVault, readPrivateKeyFile } from './vault';
import { ConnectionsBroker } from './service';
import { ProviderIdentityQualifier, type IdentityAdmission } from './provider-identity';
import { PinnedOAuthTransport } from './oauth';
import { loadRunnerAdmissionRegistry } from './runner-admission';
import { createConnectionsBrokerServer } from './server';
const profileSchema = z.object({ providerId: z.string(), issuer: z.string().url(), authorizeUrl: z.string().url(), tokenUrl: z.string().url(),
  revokeUrl: z.string().url().optional(), clientId: z.string().min(1).max(1000), clientSecret: z.string().min(1).max(16000),
  callbackUrl: z.string().url(), scopes: z.array(z.string().min(1).max(200)).min(1).max(100) }).strict();
export const brokerConfigurationSchema = z.object({ schemaVersion: z.literal(1), host: z.literal('127.0.0.1'),
  port: z.number().int().min(1024).max(65535), brokerUid: z.number().int().positive(), studioUid: z.number().int().positive(),
  vaultDirectory: z.string().min(1), vaultKeyFile: z.string().min(1), authKeyFile: z.string().min(1),
  keyVersion: z.string().min(1).max(50), studioOrigin: z.string().url(),
  enabledProviderIds: z.array(z.string().min(1).max(100)).max(20), oauthProfiles: z.record(z.string(), profileSchema),
  operatorScopes: z.record(z.string(), z.array(z.string().min(1).max(200)).max(100)),
  connectionsManifestFile: z.string().min(1), runnerAdmissionFile: z.string().min(1).optional(),
  catalog: z.object({ resourceIdsByTool: z.record(z.string(), z.array(z.string()).max(100)), destinationIds: z.array(z.string()).max(100),
    endpointProfileIds: z.record(z.string(), z.string()).optional() }).strict(),
}).strict();
export type BrokerConfiguration = z.infer<typeof brokerConfigurationSchema>;
export async function validateBrokerProcess(configuration: BrokerConfiguration, configFile?: string): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined || uid === 0 || uid !== configuration.brokerUid || configuration.brokerUid === configuration.studioUid || configuration.studioUid === 0) throw new ConnectionsError(503, 'broker_independent_uid_required');
  if (Object.keys(process.env).some(name => /(?:TOKEN|SECRET|API_KEY|ACCESS_KEY|CREDENTIAL|AUTH_SOCK|PRIVATE_KEY|PASSWORD|PASSWD|SERVICE_ACCOUNT|TIREH|VOXX|^STUDIO_)/i.test(name) && Boolean(process.env[name]))) throw new ConnectionsError(503, 'broker_ambient_studio_credentials_denied');
  if ([configuration.vaultDirectory, configuration.vaultKeyFile, configuration.authKeyFile, ...(configFile ? [configFile] : [])].some(path => !path.startsWith('/')) ||
      resolve(configuration.vaultKeyFile) === resolve(configuration.authKeyFile)) throw new ConnectionsError(503, 'broker_private_paths_invalid');
  const directory = await fs.lstat(configuration.vaultDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== uid || (directory.mode & 0o077) !== 0) throw new ConnectionsError(503, 'broker_vault_permissions_invalid');
  if (configFile) {
    const stat = await fs.lstat(configFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0) throw new ConnectionsError(503, 'broker_config_permissions_invalid');
  }
}
export async function loadConnectionsBroker(configPath: string) {
  const stat = await fs.lstat(configPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 200_000) throw new ConnectionsError(503, 'broker_config_permissions_invalid');
  const configuration = brokerConfigurationSchema.parse(JSON.parse(await fs.readFile(configPath, 'utf8')));
  await validateBrokerProcess(configuration, configPath);
  const [vaultKey, authKey] = await Promise.all([readPrivateKeyFile(configuration.vaultKeyFile, configuration.brokerUid), readPrivateKeyFile(configuration.authKeyFile, configuration.brokerUid)]);
  if (vaultKey.equals(authKey)) throw new ConnectionsError(503, 'broker_distinct_keys_required');
  const runners = configuration.runnerAdmissionFile ? await loadRunnerAdmissionRegistry(configuration.runnerAdmissionFile, configuration.brokerUid) : undefined;
  const catalog = createConnectionsCatalog(); // No global account/resource union.
  const scoped = async (current: BrokerAuthority) => {
    const manifest = await readConnectionsConfiguration(configuration.connectionsManifestFile);
    if (!manifest.enabled) throw new ConnectionsError(503, 'connections_paused');
    const profiles = manifest.profiles.filter(p => p.accountId === current.context.accountId && p.space === current.context.scope.spaceKind);
    const selected = profiles.find(p => p.providerId === current.connection.providerId);
    if (!selected?.qualified) throw new ConnectionsError(503, 'broker_provider_unqualified');
    const resourceIdsByTool: Record<string, string[]> = {}; const endpointProfileIds: Record<string, string> = {};
    for (const profile of profiles) {
      endpointProfileIds[profile.providerId] = profile.endpointProfileId;
      if (!profile.qualified) continue;
      for (const resource of profile.resources) for (const toolId of resource.toolIds) if (getProviderToolDefinition(toolId)?.effect === 'read') (resourceIdsByTool[toolId] ??= []).push(resource.id);
    }
    return { selected, catalog: createConnectionsCatalog({ resourceIdsByTool, endpointProfileIds,
      destinationIds: ['vox:private', 'model:studio', ...profiles.map(p => `provider:${p.providerId}`)] }) };
  };
  for (const providerId of configuration.enabledProviderIds) if (!catalog.provider(providerId)) throw new ConnectionsError(503, 'broker_provider_invalid');
  for (const [providerId, profile] of Object.entries(configuration.oauthProfiles)) if (providerId !== profile.providerId || !configuration.enabledProviderIds.includes(providerId)) throw new ConnectionsError(503, 'broker_oauth_configuration_invalid');
  const control = new HttpBrokerControlPlane(new AuthenticatedBrokerClient(configuration.studioOrigin, authKey, ['/api/connections/broker']));
  const broker = new ConnectionsBroker({ control, vault: new FileBrokerVault(configuration.vaultDirectory, vaultKey, configuration.keyVersion),
    oauth: new PinnedOAuthTransport({ identityQualifierForContext: async (identityContext, providerId) => {
      const current = await control.call<BrokerAuthority>({ action: 'context', actor: { accountId: identityContext.accountId }, space: identityContext.space, connectionId: identityContext.connectionId });
      const { selected } = await scoped(current); const admissions: IdentityAdmission[] = [];
      if (providerId !== selected.providerId) throw new ConnectionsError(403, 'identity_provider_mismatch');
      if (providerId === 'github' && selected.providerSubject.startsWith('credential:')) admissions.push({ providerId, kind: 'credential_resource',
        repositories: selected.resources.map(r => /^github:repo:([^/]+)\/(.+)$/.exec(r.id)).filter((m): m is RegExpExecArray => Boolean(m)).map(m => ({ owner: m[1], repository: m[2] })) });
      if (providerId === 'hetzner') admissions.push({ providerId, kind: 'credential_resource', serverIds: selected.resources.map(r => /^hetzner:server:(\d+)$/.exec(r.id)).filter((m): m is RegExpExecArray => Boolean(m)).map(m => Number(m[1])) });
      if (providerId === 'posthog') {
        const matches = selected.resources.map(r => /^posthog:project:(\d+):insight:(\d+)$/.exec(r.id)).filter((m): m is RegExpExecArray => Boolean(m));
        if (!matches.length || new Set(matches.map(m => m[1])).size !== 1) throw new ConnectionsError(503, 'posthog_identity_inventory_invalid');
        const region = selected.endpointProfileId === 'posthog-eu' ? 'eu' : 'us';
        admissions.push(selected.providerSubject.startsWith('credential:') ? { providerId, kind: 'credential_resource', region, projectId: matches[0][1], insightIds: matches.map(m => m[2]) } : { providerId, kind: 'user_project', region, projectId: matches[0][1] });
      }
      if (providerId === 'gamend') {
        const matches = selected.resources.map(r => /^gamend:org:([^:]+):game:([^:]+):env:([^:]+)$/.exec(r.id)).filter((m): m is RegExpExecArray => Boolean(m));
        if (!matches.length || new Set(matches.map(m => m[0])).size !== 1) throw new ConnectionsError(503, 'gamend_identity_inventory_invalid');
        admissions.push({ providerId, kind: 'native_delegation', orgId: matches[0][1], gameId: matches[0][2], envId: matches[0][3] });
      }
      return new ProviderIdentityQualifier({ admissions });
    } }), catalog, executor: new ProviderRegistry({ catalog }),
    catalogForAuthority: async current => (await scoped(current)).catalog,
    runnerEnrollment: async current => { if (!runners) throw new ConnectionsError(503, 'runner_attestation_unavailable'); return runners.enrollmentIdentity(current); },
    executorForAuthority: (current, scopedCatalog) => {
      if (['browser', 'ssh'].includes(current.connection.providerId)) { if (!runners) throw new ConnectionsError(503, 'runner_attestation_unavailable'); return runners.executorForAuthority(current, scopedCatalog, control); }
      return new ProviderRegistry({ catalog: scopedCatalog });
    },
    expectedIdentity: async current => { const { selected } = await scoped(current); return { subject: selected.providerSubject, tenant: selected.providerTenantId }; }, oauthProfiles: configuration.oauthProfiles,
    enabledProviderIds: configuration.enabledProviderIds, readOnly: true, operatorScopes: configuration.operatorScopes });
  return { broker, control, configuration, server: createConnectionsBrokerServer(broker, new BrokerAuthenticator(authKey)) };
}
