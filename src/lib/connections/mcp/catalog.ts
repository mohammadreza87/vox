import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConnectionsCatalog, ReviewedTool } from '../contracts';

import { ConnectionsError } from '../errors';
import { canonicalMcpUrl } from './transport';
import { assertMcpSchema, validateMcpValue, type McpSchema } from './schema';
export const MCP_PROVIDER_ID = 'remote_mcp';
export const MCP_ADAPTER_ID = 'remote_mcp';
export const MCP_ADAPTER_VERSION = '1.0.0';
export const MCP_PROTOCOL_VERSION = '2025-11-25';
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const mcpDigest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const rawTool = z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/), title: z.string().max(160).optional(),
  description: z.string().max(2000).optional(), inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(), annotations: z.record(z.string(), z.unknown()).optional(),
  _meta: z.record(z.string(), z.unknown()).optional() }).strict();
export const mcpToolId = (name: string) => `remote_mcp.${createHash('sha256').update(name).digest('hex')}`;
export interface McpCatalogSnapshot {
  schemaVersion: 1; resource: string; protocolVersion: typeof MCP_PROTOCOL_VERSION;
  tools: { name: string; title?: string; description?: string; inputSchema: McpSchema; outputSchema?: McpSchema; annotations?: Record<string, unknown>; _meta?: Record<string, unknown> }[];
  catalogDigest: string;
}
/** The whole advertised descriptor is hashed; untrusted hints never select an effect or retry class. */
export function snapshotMcpCatalog(resourceInput: string, tools: unknown): McpCatalogSnapshot {
  const resource = canonicalMcpUrl(resourceInput);
  const parsed = z.array(rawTool).max(100).parse(tools);
  if (new Set(parsed.map(tool => tool.name)).size !== parsed.length || Buffer.byteLength(JSON.stringify(parsed)) > 40_000) throw new ConnectionsError(400, 'mcp_catalog_limit');
  for (const tool of parsed) { assertMcpSchema(tool.inputSchema); if (tool.outputSchema) assertMcpSchema(tool.outputSchema); }
  parsed.sort((a, b) => a.name.localeCompare(b.name));
  const body = { schemaVersion: 1 as const, resource, protocolVersion: MCP_PROTOCOL_VERSION as typeof MCP_PROTOCOL_VERSION, tools: parsed };
  return Object.freeze({ ...body, catalogDigest: mcpDigest(body) });
}
export class McpConnectionsCatalog implements ConnectionsCatalog {
  readonly snapshot: McpCatalogSnapshot;
  readonly endpointProfileId: string;
  readonly resourceId: string;
  constructor(snapshot: McpCatalogSnapshot) {
    this.snapshot = snapshotMcpCatalog(snapshot.resource, snapshot.tools);
    if (snapshot.protocolVersion !== MCP_PROTOCOL_VERSION || snapshot.catalogDigest !== this.snapshot.catalogDigest) throw new ConnectionsError(409, 'mcp_catalog_drift');
    // Copy through serialization: callers cannot mutate a reviewed schema behind the digest.
    this.snapshot = JSON.parse(JSON.stringify(this.snapshot)) as McpCatalogSnapshot;
    const freeze = (v: unknown) => { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } }; freeze(this.snapshot);
    this.endpointProfileId = `mcp-${mcpDigest(this.snapshot.resource)}`;
    this.resourceId = `mcp:resource:${mcpDigest(this.snapshot.resource)}`;
  }
  get(toolId: string): ReviewedTool | undefined {
    const tool = this.snapshot.tools.find(tool => mcpToolId(tool.name) === toolId); if (!tool) return undefined;
    return Object.freeze({ id: toolId, version: '1', providerId: MCP_PROVIDER_ID, adapterId: MCP_ADAPTER_ID, adapterVersion: MCP_ADAPTER_VERSION,
      catalogDigest: this.snapshot.catalogDigest, schemaDigest: mcpDigest(tool.inputSchema), effect: 'privileged', retryClass: 'reconcile_only',
      maxInputBytes: 32_000, maxOutputBytes: 128_000, timeoutMs: 15_000,
      resourceIds: Object.freeze([this.resourceId]), destinationIds: Object.freeze([`provider:${MCP_PROVIDER_ID}`, 'vox:private', 'model:studio']) });
  }
  provider(providerId: string) { return providerId === MCP_PROVIDER_ID ? { adapterId: MCP_ADAPTER_ID, adapterVersion: MCP_ADAPTER_VERSION,
    catalogDigest: this.snapshot.catalogDigest, endpointProfileId: this.endpointProfileId } : undefined; }
  validateArguments(toolId: string, value: unknown): Record<string, unknown> {
    const tool = this.snapshot.tools.find(tool => mcpToolId(tool.name) === toolId);
    if (!tool || Buffer.byteLength(JSON.stringify(value) ?? '') > 32_000 || !validateMcpValue(tool.inputSchema, value)) throw new ConnectionsError(400, 'mcp_arguments_invalid');
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
  mapResources(toolId: string, args: Record<string, unknown>): readonly string[] { this.validateArguments(toolId, args); return [this.resourceId]; }
  /** Safe presentation content remains visibly untrusted; it does not contain credentials or verified human identity. */
  view() { return { ...this.snapshot, resourceId: this.resourceId, providerId: MCP_PROVIDER_ID, identityEvidence: 'unavailable' as const,
    tools: this.snapshot.tools.map(tool => ({ id: mcpToolId(tool.name), name: tool.name, title: tool.title ?? tool.name, description: tool.description ?? '',
      inputSchema: tool.inputSchema, schemaDigest: mcpDigest(tool.inputSchema), effect: 'privileged' as const, requiresExactReview: true as const })) }; }
}

/** Persist only this validated safe snapshot in the connection control plane. Never a token/client secret. */
export const mcpCatalogSnapshotSchema = z.object({ schemaVersion: z.literal(1), resource: z.string().max(2000),
  protocolVersion: z.literal(MCP_PROTOCOL_VERSION), tools: z.array(rawTool).max(100), catalogDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().transform(value => {
    const validated = snapshotMcpCatalog(value.resource, value.tools);
    if (validated.catalogDigest !== value.catalogDigest) throw new ConnectionsError(409, 'mcp_catalog_drift');
    return validated;
  });
export const createPendingMcpCatalog = (resource: string) => new McpConnectionsCatalog(snapshotMcpCatalog(resource, []));
