import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionsCatalog, ReviewedTool } from './contracts';
import { ConnectionsError } from './errors';
import { providerDefinitions, providerToolDefinitions, getProviderDefinition, getProviderToolDefinition } from './providers';
import type { ProviderDefinition, ProviderToolDefinition } from './providers';
export const CONNECTIONS_ADAPTER_VERSION = '1.0.0';
export interface ProviderCatalogOptions {
  /** Exact resources from an operator-reviewed per-connection inventory. Never a global account union. */
  resourceIdsByTool?: Readonly<Record<string, readonly string[]>>;
  /** Vox destinations registered by the server, e.g. a particular private conversation. */
  destinationIds?: readonly string[];
  /** Operator-selected profile only; cannot be supplied through tool arguments. */
  endpointProfileIds?: Readonly<Record<string, string>>;
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function providerInputJsonSchema(tool: ProviderToolDefinition): Record<string, unknown> {
  return z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'throw' }) as Record<string, unknown>;
}
export function isCanonicalProviderResource(toolId: string, resourceId: string): boolean {
  const tool = getProviderToolDefinition(toolId);
  if (!tool || resourceId.length > 600) return false;
  const component = '[A-Za-z0-9_-]{1,200}'; const uid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const patterns: Record<string, string[]> = {
    github: ['github:repo:[a-z0-9_-][a-z0-9_.-]{0,99}/[a-z0-9_-][a-z0-9_.-]{0,99}'],
    forgejo: ['forgejo:repo:[a-z0-9_-][a-z0-9_.-]{0,99}/[a-z0-9_-][a-z0-9_.-]{0,99}'],
    notion: [`notion:page:${uid}`], slack: ['slack:channel:[CG][A-Z0-9]{8,20}'],
    google_drive: [`google_drive:file:${component}`], google_docs: [`google_docs:document:${component}`],
    google_sheets: [`google_sheets:spreadsheet:${component}`], google_slides: [`google_slides:presentation:${component}`],
    gmail: tool.id === 'gmail.message.get' ? ['gmail:message:[a-f0-9]{8,40}'] : ['gmail:mailbox:self', 'gmail:recipient:[A-Za-z0-9_-]{1,171}'],
    figma: [`figma:file:${component}:node:\\d{1,12}:\\d{1,12}`], hetzner: ['hetzner:server:[1-9]\\d{0,15}'],
    google_analytics: ['google_analytics:property:[1-9]\\d{0,15}'], posthog: ['posthog:project:[1-9]\\d{0,15}:insight:[1-9]\\d{0,15}'],
    browser: [`browser:page:${component}`], ssh: [`ssh:host:[A-Za-z0-9_-]{1,80}:service:[A-Za-z0-9_-]{1,80}`],
    gamend: [`gamend:org:${uid}:game:${uid}:env:${uid}`, ...(tool.id === 'gamend.status' ? [`gamend:request:${uid}`] : [])],
  };
  return (patterns[tool.providerId] ?? []).some(pattern => new RegExp(`^(?:${pattern})$`).test(resourceId));
}
export interface ProviderCatalogView {
  id: string; label: string; adapterId: string; adapterVersion: string; endpointProfileId: string;
  protocol: ProviderDefinition['protocol']; auth: ProviderDefinition['auth']; documentationUrl: string;
  eligibility: ProviderDefinition['eligibility']; eligibilityReason: string; accountEvidence: 'unavailable';
  releaseState: ProviderDefinition['releaseState']; setup: readonly string[];
  tools: { id: string; title: string; description: string; effect: string; requiredScopes: readonly string[];
    resourceFormat: string; personalOnly: boolean; inputSchema: Record<string, unknown>; schemaDigest: string }[];
}
export class CodeOwnedConnectionsCatalog implements ConnectionsCatalog {
  private readonly tools = new Map<string, ReviewedTool>();
  private readonly profiles = new Map<string, NonNullable<ReturnType<ConnectionsCatalog['provider']>>>();
  constructor(options: ProviderCatalogOptions = {}) {
    const knownTools = new Set(providerToolDefinitions.map(tool => tool.id));
    if (Object.keys(options.resourceIdsByTool ?? {}).some(id => !knownTools.has(id)) ||
        Object.keys(options.endpointProfileIds ?? {}).some(id => !getProviderDefinition(id))) throw new ConnectionsError(400, 'catalog_configuration_invalid');
    const destinations = Object.freeze([...(options.destinationIds ?? [])]);
    if (destinations.length > 100 || new Set(destinations).size !== destinations.length || destinations.some(id => !/^[\p{L}\p{N}_.:@/-]{1,200}$/u.test(id))) throw new ConnectionsError(400, 'catalog_configuration_invalid');
    for (const provider of providerDefinitions) {
      const endpointProfileId = options.endpointProfileIds?.[provider.id] ?? provider.endpointProfileId;
      if (!/^[a-z][a-z0-9-]{0,100}$/.test(endpointProfileId)) throw new ConnectionsError(400, 'catalog_configuration_invalid');
      const entries = provider.tools.map(tool => {
        const resources = Object.freeze([...(options.resourceIdsByTool?.[tool.id] ?? [])]);
        if (resources.length > 100 || new Set(resources).size !== resources.length || resources.some(id => !isCanonicalProviderResource(tool.id, id))) throw new ConnectionsError(400, 'catalog_resource_invalid');
        const schema = providerInputJsonSchema(tool);
        return { tool, resources, schema, schemaDigest: digest(schema) };
      });
      const catalogDigest = digest({ provider: provider.id, adapter: provider.adapterVersion, endpointProfileId, destinations,
        tools: entries.map(({ tool, resources, schemaDigest }) => ({ id: tool.id, effect: tool.effect, scopes: tool.requiredScopes, resources, schemaDigest })) });
      this.profiles.set(provider.id, Object.freeze({ adapterId: provider.adapterId, adapterVersion: provider.adapterVersion, catalogDigest, endpointProfileId }));
      for (const { tool, resources, schemaDigest } of entries) this.tools.set(tool.id, Object.freeze({ id: tool.id, version: '1', providerId: provider.id,
        adapterId: provider.adapterId, adapterVersion: provider.adapterVersion, catalogDigest, schemaDigest, effect: tool.effect,
        retryClass: tool.effect === 'read' ? 'safe_read' : 'reconcile_only', maxInputBytes: 64_000, maxOutputBytes: 128_000, timeoutMs: 15_000,
        resourceIds: resources, destinationIds: destinations }));
    }
  }
  get(toolId: string): ReviewedTool | undefined { return this.tools.get(toolId); }
  provider(providerId: string) { return this.profiles.get(providerId); }
  validateArguments(toolId: string, value: unknown): Record<string, unknown> {
    const tool = getProviderToolDefinition(toolId);
    if (!tool) throw new ConnectionsError(404, 'tool_unavailable');
    const parsed = tool.schema.safeParse(value);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > (this.get(toolId)?.maxInputBytes ?? 0)) throw new ConnectionsError(400, 'tool_arguments_invalid');
    return parsed.data;
  }
  mapResources(toolId: string, args: Record<string, unknown>): readonly string[] {
    const definition = getProviderToolDefinition(toolId); const reviewed = this.get(toolId);
    if (!definition || !reviewed) throw new ConnectionsError(404, 'tool_unavailable');
    const resources = definition.mapResources(this.validateArguments(toolId, args));
    if (!resources.length || resources.some(id => !isCanonicalProviderResource(toolId, id) || !reviewed.resourceIds.includes(id))) throw new ConnectionsError(403, 'resource_not_registered');
    return Object.freeze([...new Set(resources)]);
  }
  listProviders(): ProviderCatalogView[] {
    return providerDefinitions.map(provider => ({ id: provider.id, label: provider.label, adapterId: provider.adapterId, adapterVersion: provider.adapterVersion,
      endpointProfileId: this.profiles.get(provider.id)!.endpointProfileId, protocol: provider.protocol, auth: provider.auth,
      documentationUrl: provider.documentationUrl, eligibility: provider.eligibility, eligibilityReason: provider.eligibilityReason,
      accountEvidence: provider.accountEvidence, releaseState: provider.releaseState, setup: [...provider.setup], tools: provider.tools.map(tool => ({
        id: tool.id, title: tool.title, description: tool.description, effect: tool.effect, requiredScopes: [...tool.requiredScopes], resourceFormat: tool.resourceFormat,
        personalOnly: tool.personalOnly ?? false, inputSchema: providerInputJsonSchema(tool), schemaDigest: this.tools.get(tool.id)!.schemaDigest })) }));
  }
}
export const createConnectionsCatalog = (options: ProviderCatalogOptions = {}): CodeOwnedConnectionsCatalog => new CodeOwnedConnectionsCatalog(options);
/** Browser-safe setup/catalog metadata only; never contains a provider account, token or inventory. */
export const listProviderDefinitions = (): ProviderCatalogView[] => createConnectionsCatalog().listProviders();
