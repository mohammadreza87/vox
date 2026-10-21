import { CONNECTIONS_POLICY_VERSION, scopeSchema, type ConnectionContext, type ConnectionRecord, type ConnectionGrantRecord,
  type ReviewedTool, type ScopeBinding, type OperationRecord, type SourceLabel } from './contracts';
import { canonical } from './repository';
import { deny } from './errors';
export const sameScope = (left: ScopeBinding, right: ScopeBinding): boolean =>
  canonical({ ...left, audiencePersonIds: [...left.audiencePersonIds].sort() }) === canonical({ ...right, audiencePersonIds: [...right.audiencePersonIds].sort() });
export function assertContext(context: ConnectionContext, accountId: string, now: number): void {
  scopeSchema.parse(context.scope);
  if (context.accountId !== accountId || !context.personId || !context.bindingId || !Number.isSafeInteger(context.bindingRevision) ||
      context.bindingRevision < 1 || context.bindingExpiresAt <= now || !context.scope.audiencePersonIds.includes(context.personId)) deny('identity_unverified');
  // Current release is per-person Work/Personal. Group contexts require a separate authority resolver/release.
  if (context.scope.audiencePersonIds.length !== 1) deny('unsupported_audience');
}
const ownerScope = (scope: ScopeBinding) => ({ tenantId: scope.tenantId, spaceId: scope.spaceId, spaceKind: scope.spaceKind,
  containerId: scope.containerId, audiencePersonIds: [...scope.audiencePersonIds].sort() });
/** A same-person profile confirmation renews management authority, not old grants or content access. */
export function assertOwner(context: ConnectionContext, connection: ConnectionRecord): void {
  if (context.botAgentId && (connection.schemaVersion !== 2 || connection.agentId !== context.botAgentId)) deny('connection_unavailable', 404);
  if (connection.ownerAccountId !== context.accountId || connection.ownerPersonId !== context.personId || canonical(ownerScope(context.scope)) !== canonical(ownerScope(connection.scope))) deny('connection_unavailable', 404);
}
export function assertGrant(context: ConnectionContext, connection: ConnectionRecord, grant: ConnectionGrantRecord,
  tool: ReviewedTool, input: { agentId: string; resourceIds: readonly string[]; destinationId: string; bytes: number }, now: number): void {
  assertOwner(context, connection);
  if (connection.schemaVersion === 2 && connection.agentId !== input.agentId) deny('agent_connection_mismatch');
  if (connection.lifecycle !== 'connected' || grant.status !== 'active' || grant.expiresAt <= now || grant.bindingRevision !== context.bindingRevision ||
      grant.connectionId !== connection.id || grant.connectionRevision !== connection.revision || grant.connectionEpoch !== connection.revocationEpoch ||
      !sameScope(grant.scope, context.scope) || grant.ownerPersonId !== context.personId || grant.grantorPersonId !== context.personId ||
      grant.agentId !== input.agentId || !context.currentAgentIds.includes(input.agentId) ||
      !grant.toolIds.includes(tool.id) || !grant.effects.includes(tool.effect) || grant.catalogDigest !== tool.catalogDigest ||
      connection.catalogDigest !== tool.catalogDigest || connection.adapterId !== tool.adapterId || connection.adapterVersion !== tool.adapterVersion ||
      connection.providerId !== tool.providerId || input.resourceIds.length === 0 ||
      input.resourceIds.some(id => !grant.resourceIds.includes(id) || (tool.resourceIds.length > 0 && !tool.resourceIds.includes(id))) ||
      !grant.destinationIds.includes(input.destinationId) || !tool.destinationIds.includes(input.destinationId) ||
      input.bytes > Math.min(grant.maxBytes, tool.maxInputBytes)) deny('grant_denied');
}
export function assertSourceUse(context: ConnectionContext, sources: readonly SourceLabel[], input: {
  agentId: string; destinationId: string; purpose: 'explicit.connection_task' | 'explicit.memory_request'; persist?: boolean;
}, now: number): void {
  if (!context.currentAgentIds.includes(input.agentId)) deny('source_disclosure_denied');
  for (const source of sources) {
    if (source.status !== 'active' || source.expiresAt <= now || !sameScope(source.scope, context.scope) ||
        !source.allowedAgentIds.includes(input.agentId) || !source.allowedDestinationIds.includes(input.destinationId) ||
        !source.allowedPurposes.includes(input.purpose) || context.scope.audiencePersonIds.some(id => !source.allowedPersonIds.includes(id)) ||
        (input.persist && !source.persist)) deny('source_disclosure_denied');
  }
}
export function assertCurrentOperation(context: ConnectionContext, operation: OperationRecord,
  connection: ConnectionRecord, grant: ConnectionGrantRecord, tool: ReviewedTool, sources: readonly SourceLabel[], now: number): void {
  if (operation.deadlineAt <= now || operation.bindingRevision !== context.bindingRevision || operation.policyVersion !== CONNECTIONS_POLICY_VERSION ||
      operation.grantRevision !== grant.revision || operation.connectionRevision !== connection.revision ||
      operation.connectionEpoch !== connection.revocationEpoch || operation.toolVersion !== tool.version ||
      operation.catalogDigest !== tool.catalogDigest || operation.schemaDigest !== tool.schemaDigest || operation.effect !== tool.effect ||
      operation.adapterVersion !== tool.adapterVersion || operation.sourceIds.length !== sources.length ||
      operation.sourceRevisions.some((ref, i) => ref !== `${sources[i].id}:${sources[i].revision}:${sources[i].resourceRevision}`)) deny('operation_stale', 409);
  assertGrant(context, connection, grant, tool, { agentId: operation.agentId, resourceIds: operation.resourceIds,
    destinationId: operation.destinationId, bytes: 0 }, now);
  assertSourceUse(context, sources, { agentId: operation.agentId, destinationId: operation.destinationId,
    purpose: 'explicit.connection_task', persist: operation.payload.kind === 'retained' }, now);
}
