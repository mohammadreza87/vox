import { readFile } from 'node:fs/promises';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { isCanonicalProviderResource } from './catalog';
import { getProviderDefinition, getProviderToolDefinition } from './providers';
import { idSchema } from './contracts';

const profile = z.object({ accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/), space: z.enum(['work', 'personal']),
  agentId: idSchema.optional(), providerId: idSchema, providerSubject: idSchema, providerTenantId: idSchema, endpointProfileId: idSchema,
  setup: z.enum(['oauth', 'operator']), qualified: z.boolean(), evidenceReference: z.string().max(500),
  dailyModelTokenCeiling: z.number().int().min(0).max(10_000_000).default(0),
  dailyToolCallCeiling: z.number().int().min(0).max(10_000).default(0),
  resources: z.array(z.object({ id: idSchema, label: z.string().trim().min(1).max(160), toolIds: z.array(idSchema).min(1).max(50) }).strict()).max(100),
}).strict();
export const connectionsConfigurationSchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean(),
  modelPolicy: z.object({ provider: z.literal('anthropic'), model: z.string().trim().min(1).max(160), qualified: z.boolean(),
    evidenceReference: z.string().trim().min(1).max(500) }).strict().optional(),
  profiles: z.array(profile).max(500),
  selfServiceMcp: z.object({ enabled: z.boolean(), dailyModelTokenCeiling: z.number().int().min(0).max(10_000_000).default(0),
    dailyToolCallCeiling: z.number().int().min(0).max(10_000).default(0) }).strict().optional(),
}).strict().superRefine((value, context) => {
  const keys = new Set<string>();
  for (const item of value.profiles) {
    const key = JSON.stringify([item.accountId, item.space, item.agentId ?? null, item.providerId]);
    if (keys.has(key)) context.addIssue({ code: 'custom', message: 'Duplicate account/agent/provider partition' });
    keys.add(key);
    const provider = getProviderDefinition(item.providerId);
    if (!provider || item.qualified && !item.evidenceReference.trim() || item.providerId === 'gmail' && item.space !== 'personal')
      context.addIssue({ code: 'custom', message: 'Unqualified provider configuration' });
    if (new Set(item.resources.map(r => r.id)).size !== item.resources.length) context.addIssue({ code: 'custom', message: 'Duplicate resource' });
    for (const resource of item.resources) for (const toolId of resource.toolIds) {
      if (getProviderToolDefinition(toolId)?.providerId !== item.providerId || !isCanonicalProviderResource(toolId, resource.id))
        context.addIssue({ code: 'custom', message: 'Invalid registered resource/tool' });
    }
  }
});
export type ConnectionsConfiguration = z.infer<typeof connectionsConfigurationSchema>;
export type ConnectionProfile = z.infer<typeof profile>;
export const disabledConnectionsConfiguration = (): ConnectionsConfiguration => ({ schemaVersion: 1, enabled: false, profiles: [] });
/** Operator-owned non-secret inventory. Live reads make the kill switch effective
 * on the next boundary; credentials belong exclusively to the broker's vault. */
export async function readConnectionsConfiguration(path: string | undefined): Promise<ConnectionsConfiguration> {
  if (!path) return disabledConnectionsConfiguration();
  if (!isAbsolute(path)) throw new Error('Connections configuration requires an absolute path');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > 512_000) throw new Error('Connections configuration exceeds limit');
  return connectionsConfigurationSchema.parse(JSON.parse(text));
}

/** Final effect admission in the same event turn as returning signed broker authority. */
export function readConnectionsConfigurationNow(path: string | undefined): ConnectionsConfiguration {
  if (!path) return disabledConnectionsConfiguration();
  if (!isAbsolute(path)) throw new Error('Connections configuration requires an absolute path');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512_000) throw new Error('Connections configuration file invalid');
  const text = readFileSync(path, 'utf8'); if (Buffer.byteLength(text) > 512_000) throw new Error('Connections configuration exceeds limit');
  return connectionsConfigurationSchema.parse(JSON.parse(text));
}
