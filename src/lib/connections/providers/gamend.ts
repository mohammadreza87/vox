import { z } from 'zod';
import { defineTool, type ProviderToolDefinition, type ProviderExecutionContext } from './types';
import { uuid, safeText, parse, object } from './normalization';
import { ProviderError } from '../transport';
const selected = z.object({ orgId: uuid, gameId: uuid, envId: uuid }).strict();
const knownOperation = z.enum(['GameTimezoneController_get', 'AnalyticsController_engagement']);
const boundedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const time = Date.parse(value + 'T00:00:00Z'); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value; });
const invocation = z.discriminatedUnion('operationId', [
  selected.extend({ operationId: z.literal('GameTimezoneController_get') }),
  selected.extend({ operationId: z.literal('AnalyticsController_engagement'), from: boundedDate, to: boundedDate, granularity: z.enum(['day', 'week', 'month']), platform: z.enum(['android', 'ios', 'web', 'windows', 'macos', 'linux']).optional() }),
]).refine(a => a.operationId !== 'AnalyticsController_engagement' || (Date.parse(a.to) >= Date.parse(a.from) && Date.parse(a.to) - Date.parse(a.from) <= 92 * 86400000), 'At most 93 calendar days');
const resource = (a: z.infer<typeof selected>) => [`gamend:org:${a.orgId}:game:${a.gameId}:env:${a.envId}`];
const format = 'gamend:org:orgUuid:game:gameUuid:env:envUuid';
function rpc(name: string, args: Record<string, unknown>, context: ProviderExecutionContext) {
  // Broker context is intentionally not copied into upstream metadata.
  void context;
  return { method: 'POST' as const, path: '/v1/mcp', headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': name }, body: { jsonrpc: '2.0', id: 'vox-connections', method: 'tools/call', params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'vox-connections', version: '1.0.0' } } } } };
}
function structured(body: unknown): Record<string, unknown> {
  const envelope = object(body);
  if (envelope.jsonrpc !== '2.0' || envelope.id !== 'vox-connections' || envelope.error) throw new ProviderError('provider_protocol_error');
  const result = object(envelope.result);
  if (result.isError === true) throw new ProviderError('provider_operation_refused');
  return object(result.structuredContent);
}
function checkScope(raw: unknown, a: z.infer<typeof selected>): Record<string, unknown> {
  const scope = object(raw);
  if (scope.orgId !== a.orgId || (scope.gameId !== undefined && scope.gameId !== a.gameId) || (scope.envId !== undefined && scope.envId !== a.envId)) throw new ProviderError('provider_scope_mismatch');
  return { orgId: a.orgId, gameId: a.gameId, envId: a.envId };
}
function nativeInput(a: z.infer<typeof invocation>): Record<string, unknown> {
  if (a.operationId === 'GameTimezoneController_get') return { path: { gameId: a.gameId } };
  return { path: { envId: a.envId }, query: { from: a.from, to: a.to, granularity: a.granularity, ...(a.platform ? { platform: a.platform } : {}) } };
}
export const gamendTools: readonly ProviderToolDefinition[] = [
  defineTool({ id: 'gamend.context', providerId: 'gamend', title: 'Read selected delegated context', description: 'Read delegated context filtered to the exact selected organization, game and environment. Does not grant new rights.', effect: 'read', schema: selected, requiredScopes: [], resourceFormat: format, mapResources: resource,
    request: (a, context) => rpc('gamend_context', {}, context), normalize: (r, a) => { const data = structured(r.body);
      if (data.organizationId !== a.orgId) throw new ProviderError('provider_scope_mismatch');
      const games = parse(z.array(z.object({ id: uuid, name: safeText(200), reportingTimezone: z.string().max(100) })).max(100), data.games).filter(g => g.id === a.gameId);
      const environments = parse(z.array(z.object({ id: uuid, gameId: uuid, name: safeText(200), slug: z.enum(['dev', 'staging', 'prod']) })).max(1000), data.environments).filter(e => e.id === a.envId && e.gameId === a.gameId);
      if (games.length !== 1 || environments.length !== 1) throw new ProviderError('provider_resource_unavailable');
      const metrics = parse(z.object({ definitionVersion: z.string().max(100), timeStorage: safeText(200), reportingTimezone: safeText(200), missingData: safeText(1000), canonicalEvents: safeText(1000) }), data.metrics);
      return { data: { orgId: a.orgId, game: games[0], environment: environments[0], metrics }, truncated: object(data.pagination).nextGameCursor !== null }; } }),
  defineTool({ id: 'gamend.discover', providerId: 'gamend', title: 'Discover admitted read operations', description: 'Discover only the two code-reviewed read operations; dynamic MCP tools never enlarge the Vox catalog.', effect: 'read', schema: selected, requiredScopes: [], resourceFormat: format, mapResources: resource,
    request: (_a, context) => rpc('gamend_discover', { effect: 'read', principal: 'agent', availability: 'served', limit: 125 }, context), normalize: r => { const data = structured(r.body); const items = parse(z.array(z.object({ operationId: z.string().max(160), description: safeText(1000), effect: z.enum(['read', 'write']), availability: z.enum(['served', 'held', 'not_configured']).optional() })).max(125), data.items).filter(item => knownOperation.safeParse(item.operationId).success && item.effect === 'read'); return { data: { items, catalogVersion: parse(z.string().max(200), data.catalogVersion) }, truncated: data.nextCursor !== null }; } }),
  defineTool({ id: 'gamend.describe', providerId: 'gamend', title: 'Describe reviewed read operation', description: 'Read named operation safety/availability metadata. Provider-supplied schemas remain untrusted and cannot activate tools.', effect: 'read', schema: selected.extend({ operationId: knownOperation }), requiredScopes: [], resourceFormat: format, mapResources: resource,
    request: (a, context) => rpc('gamend_describe', { operationId: a.operationId }, context), normalize: (r, a) => ({ data: parse(z.object({ operationId: z.literal(a.operationId), effect: z.literal('read'), availability: z.enum(['served', 'held', 'not_configured']).optional(), description: safeText(1000), requiresSensitive: z.literal(false), requiresCredentialAdmin: z.literal(false), requiresDestructive: z.literal(false), secretResult: z.literal(false) }), structured(r.body)) }) }),
  ...(['preview', 'execute'] as const).map(action => defineTool({ id: `gamend.${action}`, providerId: 'gamend', title: action === 'preview' ? 'Preview selected read' : 'Run selected analytics read', description: 'Invoke only reviewed reporting-timezone or bounded engagement read with native delegated org/game/environment enforcement.', effect: 'read', schema: invocation, requiredScopes: ['tenancy:read|analytics:read'], resourceFormat: format, mapResources: resource,
    request: (a, context) => rpc(`gamend_${action}`, { operationId: a.operationId, input: nativeInput(a) }, context), normalize: (r, a) => {
      const data = structured(r.body);
      if (data.operationId !== a.operationId) throw new ProviderError('provider_operation_mismatch');
      if (action === 'preview') { checkScope(data.scope, a); const summary = parse(z.object({ operationId: knownOperation, effect: z.literal('read'), executed: z.literal(false), simulationAvailable: z.literal(false), validation: z.literal('schema-and-current-authority'), requiresRequestId: z.literal(false) }), data); return { data: summary }; }
      if (data.contractVersion !== 'gamend-agent/1' || data.status !== 'succeeded') throw new ProviderError('provider_operation_refused');
      const provenance = object(data.provenance); checkScope(provenance.scope, a);
      const metrics = a.operationId === 'GameTimezoneController_get' ? parse(z.object({ gameId: z.literal(a.gameId), reportingTimezone: z.string().max(100) }), data.data) : parse(z.object({ asOf: z.string().datetime(), timezone: z.string().max(100), granularity: z.enum(['day', 'week', 'month']), totalEvents: z.string().regex(/^(0|[1-9][0-9]*)$/), series: z.array(z.object({ bucket: z.string().datetime(), players: z.number().finite().nonnegative(), sessions: z.number().finite().nonnegative(), events: z.number().finite().nonnegative() })).max(100) }), data.data);
      return { data: { operationId: a.operationId, status: 'succeeded', metrics, scope: { orgId: a.orgId, gameId: a.gameId, envId: a.envId }, source: 'gamend', observedAt: parse(z.string().datetime(), provenance.observedAt) }, truncated: provenance.truncated === true };
    } })),
  defineTool({ id: 'gamend.status', providerId: 'gamend', title: 'Read native request status', description: 'Reconcile one explicitly selected native request receipt. Raw result payload and secret fields are excluded.', effect: 'read', schema: selected.extend({ requestId: uuid }), requiredScopes: [], resourceFormat: `${format} plus gamend:request:requestUuid`, mapResources: a => [...resource(a), `gamend:request:${a.requestId}`],
    request: (a, context) => rpc('gamend_status', { requestId: a.requestId }, context), normalize: (r, a) => { const data = structured(r.body); checkScope(data.scope, a); const receipt = parse(z.object({ id: uuid, requestId: z.literal(a.requestId), operationId: z.string().max(160), status: z.enum(['pending', 'succeeded', 'refused', 'failed', 'unknown', 'held', 'partial']), startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable() }), data); return { data: receipt, receipt: `gamend:request:${receipt.requestId}` }; } }),
];
