import { randomUUID } from 'crypto';
import { CONNECTIONS_POLICY_VERSION, connectionSchema, enrollmentInputSchema, grantInputSchema, listInputSchema, revokeInputSchema,
  proposeInputSchema, approveInputSchema, cancelInputSchema, type ConnectionActor, type ConnectionContext,
  type ConnectionsCatalog, type ConnectionsRecords, type ConnectionsSnapshot, type ConnectionRecord,
  type OperationRecord, type OperationReceipt, type SpaceKind, type SourceLabel, type ReviewedTool, connectionAgentId, idSchema } from './contracts';
import { ConnectionsRepository, digest, canonical, partitionIdFor } from './repository';
import { canonicalMcpUrl } from './mcp/transport';
import { createPendingMcpCatalog, McpConnectionsCatalog, mcpCatalogSnapshotSchema, type McpCatalogSnapshot } from './mcp/catalog';
import { z } from 'zod';
import { assertContext, assertOwner, assertGrant, assertSourceUse, assertCurrentOperation } from './policy';
import { deny } from './errors';
import { OperationsLedger, EphemeralPayloads } from './operations';
import { ConnectionsLineage } from './lineage';
const DAY = 86_400_000;
export const RECEIPT_RETENTION_MS = 90 * DAY;
export const MAX_OPERATION_LIFETIME_MS = 15 * 60_000;
export interface ConnectionsServiceOptions {
  resolveContext: (actor: ConnectionActor, space: SpaceKind) => Promise<ConnectionContext | undefined>;
  assertContextCurrent?: (actor: ConnectionActor, context: ConnectionContext) => void;
  catalog: ConnectionsCatalog; now?: () => number;
  singleConnectionPerProvider?: boolean;
  catalogForAgent?: (agentId: string | undefined) => ConnectionsCatalog;
  catalogForConnection?: (connection: { id: string; agentId?: string; providerId?: string; mcp?: { canonicalResourceUri: string; catalog: McpCatalogSnapshot | null } }) => ConnectionsCatalog;
}
export const baseRecord = (context: ConnectionContext, now: number, retentionUntil = now + RECEIPT_RETENTION_MS) => ({
  schemaVersion: 1 as const, id: randomUUID(), partitionId: partitionIdFor(context.accountId, context.scope.spaceKind), revision: 1,
  createdAt: now, updatedAt: now, retentionUntil, ownerAccountId: context.accountId, ownerPersonId: context.personId,
  scope: structuredClone(context.scope),
});
export function operationReceipt(operation: OperationRecord): OperationReceipt {
  return { schemaVersion: 1, operationId: operation.id, requestId: operation.requestId, revision: operation.revision,
    state: operation.state, effect: operation.effect, toolId: operation.toolId, agentId: operation.agentId,
    proposalDigest: operation.proposalDigest, resourceIds: [...operation.resourceIds],
    audiencePersonIds: [...operation.scope.audiencePersonIds], destinationId: operation.destinationId,
    expectedTargetRevision: operation.expectedTargetRevision, deadlineAt: operation.deadlineAt,
    safeReason: operation.safeReason, providerReceiptRef: operation.providerReceiptRef };
}
export function resolveSources(records: ConnectionsRecords, sourceIds: readonly string[], context: ConnectionContext, now: number): SourceLabel[] {
  const validated = new Set<string>();
  const visiting = new Set<string>();
  const resolve = (id: string): SourceLabel => {
    const source = records.sources.find(row => row.id === id);
    if (!source) return deny('source_unavailable', 404);
    if (validated.has(id)) return source;
    if (visiting.has(id)) return deny('corrupt_source_cycle', 500);
    visiting.add(id);
    const connection = records.connections.find(row => row.id === source.connectionId);
    const grant = records.grants.find(row => row.id === source.grantId);
    if (!connection || !grant || connection.lifecycle !== 'connected' || connection.revocationEpoch !== source.connectionEpoch ||
        grant.status !== 'active' || grant.revision !== source.grantRevision || grant.expiresAt <= now ||
        grant.bindingRevision !== context.bindingRevision || grant.connectionRevision !== connection.revision ||
        grant.ownerPersonId !== context.personId || !context.currentAgentIds.includes(grant.agentId) ||
        connection.schemaVersion === 2 && connection.agentId !== grant.agentId || records.tombstones.some(t => t.sourceId === source.id ||
          (t.connectionId === source.connectionId && t.reason === 'disconnect'))) deny('source_revoked');
    for (const parentId of source.parentSourceIds) resolve(parentId);
    visiting.delete(id); validated.add(id);
    return source;
  };
  return sourceIds.map(resolve);
}
export function currentOperation(records: ConnectionsRecords, context: ConnectionContext, operation: OperationRecord,
  catalog: ConnectionsCatalog | ((connection: ConnectionRecord) => ConnectionsCatalog), now: number): ReviewedTool {
  if (operation.workflowId) {
    const workflow = records.workflows.find(w => w.id === operation.workflowId);
    const occurrence = records.occurrences.find(o => o.id === operation.occurrenceId && o.workflowId === workflow?.id);
    if (!workflow || workflow.status !== 'active' || workflow.revision !== operation.workflowRevision || workflow.expiresAt <= now ||
        !occurrence || occurrence.state !== 'running' || occurrence.leaseUntil === null || occurrence.leaseUntil <= now || !occurrence.operationIds.includes(operation.id))
      deny('workflow_stale', 409);
  }
  const connection = records.connections.find(c => c.id === operation.connectionId);
  const grant = records.grants.find(g => g.id === operation.grantId);
  const tool = connection && (typeof catalog === 'function' ? catalog(connection) : catalog).get(operation.toolId);
  if (!connection || !grant || !tool) return deny('operation_unavailable', 404);
  assertCurrentOperation(context, operation, connection, grant, tool, resolveSources(records, operation.sourceIds, context, now), now);
  return tool;
}
export function audit(records: ConnectionsRecords, context: ConnectionContext, now: number, event: string, subjectId: string, operationId: string | null = null): void {
  records.audits.push({ ...baseRecord(context, now), event, subjectId, operationId });
}
/** The control-plane has no credential/vault access and performs no provider calls. */
export class ConnectionsService {
  readonly operations: OperationsLedger;
  readonly lineage: ConnectionsLineage;
  readonly ephemeral = new EphemeralPayloads();
  readonly now: () => number;
  constructor(readonly repository: ConnectionsRepository, readonly options: ConnectionsServiceOptions) {
    this.now = options.now ?? Date.now;
    this.operations = new OperationsLedger(this);
    this.lineage = new ConnectionsLineage(this);
  }
  readonly catalogForConnection = (connection: { id: string; agentId?: string; mcp?: { canonicalResourceUri: string; catalog: McpCatalogSnapshot | null } }): ConnectionsCatalog =>
    connection.mcp ? (connection.mcp.catalog ? new McpConnectionsCatalog(connection.mcp.catalog) : createPendingMcpCatalog(connection.mcp.canonicalResourceUri)) :
      this.options.catalogForConnection?.(connection) ?? this.options.catalogForAgent?.(connectionAgentId(connection)) ?? this.options.catalog;
  async context(actor: ConnectionActor, space: SpaceKind): Promise<ConnectionContext> {
    const context = await this.options.resolveContext(actor, space);
    if (!context || context.scope.spaceKind !== space || actor.botAgentId !== context.botAgentId) return deny('identity_unverified');
    assertContext(context, actor.accountId, this.now());
    this.assertContextCurrent(actor, context);
    return structuredClone(context);
  }
  assertContextCurrent(actor: ConnectionActor, context: ConnectionContext): void { this.options.assertContextCurrent?.(actor, context); }
  async list(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot> {
    const parsed = listInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    if (context.botAgentId && parsed.agentId && context.botAgentId !== parsed.agentId) deny('agent_connection_mismatch');
    if (parsed.agentId && !context.currentAgentIds.includes(parsed.agentId)) deny('agent_unavailable');
    return this.repository.transaction(context, records => {
      const agentId = context.botAgentId ?? parsed.agentId;
      const selected = records.connections.filter(c => c.lifecycle !== 'deleted' && (!agentId || connectionAgentId(c) === agentId));
      const ids = new Set(selected.map(c => c.id));
      return { schemaVersion: 1, scope: context.scope,
        connections: selected.map(c => {
          assertOwner(context, c);
          return { id: c.id, providerId: c.providerId, displayLabel: c.displayLabel, revision: c.revision,
            lifecycle: c.lifecycle, health: c.health, checkedAt: c.checkedAt, revocationEpoch: c.revocationEpoch,
            ...(c.schemaVersion === 2 ? { agentId: c.agentId, ...(c.mcp ? { mcp: c.mcp } : {}) } : {}) };
        }), grants: records.grants.filter(g => g.status === 'active' && ids.has(g.connectionId)),
        operations: records.operations.filter(o => ids.has(o.connectionId)).map(operationReceipt) };
    });
  }
  async enroll(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot> {
    const parsed = enrollmentInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    if (parsed.agentId && !context.currentAgentIds.includes(parsed.agentId)) deny('agent_unavailable');
    if (context.botAgentId && parsed.agentId !== context.botAgentId) deny('agent_connection_mismatch');
    const provider = (this.options.catalogForAgent?.(parsed.agentId) ?? this.options.catalog).provider(parsed.providerId);
    if (!provider) return deny('provider_unavailable', 404);
    const now = this.now();
    await this.repository.transaction(context, records => {
      if (this.options.singleConnectionPerProvider && records.connections.some(c => c.providerId === parsed.providerId && connectionAgentId(c) === parsed.agentId && !['revoked', 'deleted'].includes(c.lifecycle))) deny('connection_exists', 409);
      if (records.connections.filter(c => c.lifecycle !== 'deleted').length >= 50) deny('connection_limit', 409);
      const connection = connectionSchema.parse({ ...baseRecord(context, now), ...(parsed.agentId ? { schemaVersion: 2 as const, agentId: parsed.agentId } : {}), providerId: parsed.providerId,
        displayLabel: parsed.displayLabel, providerAccountId: null, ...provider, providerScopes: [],
        lifecycle: 'pending', revocationEpoch: 0, health: 'unknown', checkedAt: null });
      records.connections.push(connection);
      audit(records, context, now, 'connection_enrolled', connection.id);
    });
    return this.list(actor, { space: parsed.space, ...(parsed.agentId ? { agentId: parsed.agentId } : {}) });
  }
  /** Explicit self-service URL only; registration does not contact a provider or grant tools. */
  async enrollMcp(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot> {
    const parsed = z.object({ space: z.enum(['work', 'personal']), agentId: idSchema, endpointUrl: z.string().max(2000),
      displayLabel: z.string().trim().min(1).max(160) }).strict().parse(input);
    const context = await this.context(actor, parsed.space);
    if (!context.currentAgentIds.includes(parsed.agentId) || context.botAgentId && context.botAgentId !== parsed.agentId) return deny('agent_connection_mismatch');
    const resource = canonicalMcpUrl(parsed.endpointUrl), provider = createPendingMcpCatalog(resource).provider('remote_mcp')!;
    const now = this.now();
    await this.repository.transaction(context, records => {
      if (records.connections.some(c => c.schemaVersion === 2 && c.agentId === parsed.agentId && c.mcp?.canonicalResourceUri === resource && !['revoked', 'deleted'].includes(c.lifecycle))) deny('connection_exists', 409);
      if (records.connections.filter(c => c.lifecycle !== 'deleted').length >= 50) deny('connection_limit', 409);
      records.connections.push(connectionSchema.parse({ ...baseRecord(context, now), schemaVersion: 2, agentId: parsed.agentId,
        providerId: 'remote_mcp', displayLabel: parsed.displayLabel, providerAccountId: null, ...provider, providerScopes: [],
        lifecycle: 'pending', revocationEpoch: 0, health: 'unknown', checkedAt: null, mcp: { canonicalResourceUri: resource, catalog: null } }));
    });
    return this.list(actor, { space: parsed.space, agentId: parsed.agentId });
  }
  /** Authenticated independent broker activation of the exact catalog the owner reviewed. */
  async completeMcpEnrollment(actor: ConnectionActor, input: { space: SpaceKind; connectionId: string; expectedRevision: number;
    catalog: McpCatalogSnapshot; issuer: string; providerSubject: string; providerTenantId: string; providerScopes: string[];
    displayLabel: string; identityEvidence: 'unavailable' }): Promise<void> {
    const catalog = mcpCatalogSnapshotSchema.parse(input.catalog), context = await this.context(actor, input.space), now = this.now();
    await this.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === input.connectionId);
      if (!connection) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (connection.schemaVersion !== 2 || !connection.mcp || connection.providerId !== 'remote_mcp' ||
          !context.currentAgentIds.includes(connection.agentId) || catalog.resource !== connection.mcp.canonicalResourceUri ||
          records.tombstones.some(t => t.connectionId === connection.id)) return deny('enrollment_stale', 409);
      if (connection.lifecycle === 'connected') {
        const account = records.providerAccounts.find(row => row.id === connection.providerAccountId);
        if (connection.revision !== input.expectedRevision + 1 || connection.catalogDigest !== catalog.catalogDigest ||
            !connection.mcp.catalog || canonical(connection.mcp.catalog) !== canonical(catalog) ||
            canonical(connection.providerScopes) !== canonical(input.providerScopes) || !account || account.status !== 'active' ||
            account.ownerAccountId !== context.accountId || account.ownerPersonId !== context.personId || account.providerId !== 'remote_mcp' ||
            account.issuer !== input.issuer || account.providerSubject !== input.providerSubject || account.providerTenantId !== input.providerTenantId ||
            account.identityEvidence !== 'unavailable' || input.identityEvidence !== 'unavailable') return deny('enrollment_stale', 409);
        return;
      }
      if (connection.lifecycle !== 'pending' || connection.revision !== input.expectedRevision) return deny('enrollment_stale', 409);
      const account = { ...baseRecord(context, now), providerId: 'remote_mcp', issuer: input.issuer, providerSubject: input.providerSubject,
        providerTenantId: input.providerTenantId, displayLabel: input.displayLabel, status: 'active' as const, identityEvidence: 'unavailable' as const };
      records.providerAccounts.push(account); connection.providerAccountId = account.id;
      Object.assign(connection, new McpConnectionsCatalog(catalog).provider('remote_mcp'));
      connection.mcp.catalog = catalog; connection.providerScopes = [...input.providerScopes]; connection.lifecycle = 'connected';
      connection.health = 'healthy'; connection.checkedAt = now; connection.revision++; connection.updatedAt = now;
      audit(records, context, now, 'mcp_authorization_activated', connection.id);
    });
  }
  /** Broker-only verified callback; never expose this method as an HTTP action.
   * The adapter has already checked issuer, subject, tenant, exact scopes and callback binding.
   * Credentials are managed by the separate broker and never passed here. */
  async completeEnrollment(actor: ConnectionActor, input: { space: SpaceKind; connectionId: string; expectedRevision: number;
    issuer: string; providerSubject: string; providerTenantId: string; providerScopes: string[]; displayLabel: string }): Promise<void> {
    const context = await this.context(actor, input.space);
    const now = this.now();
    await this.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === input.connectionId);
      if (!connection) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (connection.revision !== input.expectedRevision || connection.lifecycle !== 'pending') deny('revision_conflict', 409);
      if (records.tombstones.some(t => t.connectionId === connection.id)) deny('connection_revoked');
      const account = { ...baseRecord(context, now), providerId: connection.providerId, issuer: input.issuer,
        providerSubject: input.providerSubject, providerTenantId: input.providerTenantId, displayLabel: input.displayLabel, status: 'active' as const };
      records.providerAccounts.push(account);
      connection.providerAccountId = account.id;
      connection.providerScopes = [...input.providerScopes];
      connection.lifecycle = 'connected'; connection.health = 'healthy'; connection.checkedAt = now;
      connection.revision++; connection.updatedAt = now;
      audit(records, context, now, 'connection_verified', connection.id);
    });
  }
  async grant(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot> {
    const parsed = grantInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    const now = this.now();
    await this.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === parsed.connectionId);
      if (!connection) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (connection.revision !== parsed.expectedRevision) deny('revision_conflict', 409);
      if (connection.schemaVersion === 2 && connection.agentId !== parsed.agentId) deny('agent_connection_mismatch');
      if (connection.lifecycle !== 'connected' || !context.currentAgentIds.includes(parsed.agentId) || parsed.expiresAt <= now ||
          parsed.expiresAt > Math.min(now + 30 * DAY, context.bindingExpiresAt)) deny('grant_denied');
      for (const toolId of parsed.toolIds) {
        const tool = this.catalogForConnection(connection).get(toolId);
        if (!tool || tool.providerId !== connection.providerId || tool.catalogDigest !== connection.catalogDigest ||
            parsed.resourceIds.some(id => tool.resourceIds.length > 0 && !tool.resourceIds.includes(id)) || parsed.destinationIds.some(id => !tool.destinationIds.includes(id)) ||
            !parsed.effects.includes(tool.effect)) deny('grant_denied');
      }
      if (records.grants.some(g => g.connectionId === connection.id && g.agentId === parsed.agentId && g.status === 'active')) deny('grant_exists', 409);
      const grant = { ...baseRecord(context, now), connectionId: connection.id, agentId: parsed.agentId,
        toolIds: parsed.toolIds, resourceIds: parsed.resourceIds, destinationIds: parsed.destinationIds, effects: parsed.effects,
        purpose: 'explicit.connection_task' as const, purposeVersion: 1 as const, connectionRevision: connection.revision,
        connectionEpoch: connection.revocationEpoch, catalogDigest: connection.catalogDigest, grantorPersonId: context.personId,
        bindingRevision: context.bindingRevision, expiresAt: parsed.expiresAt, status: 'active' as const, revocationEpoch: 0,
        maxCalls: parsed.maxCalls, callsReserved: 0, maxBytes: parsed.maxBytes };
      records.grants.push(grant);
      audit(records, context, now, 'grant_created', grant.id);
    });
    return this.list(actor, { space: parsed.space });
  }
  async revoke(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot> {
    const parsed = revokeInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    const now = this.now();
    const ephemeralIds = await this.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === parsed.connectionId);
      if (!connection) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (connection.revision !== parsed.expectedRevision) deny('revision_conflict', 409);
      const grants = records.grants.filter(g => g.connectionId === connection.id && (!parsed.grantId || g.id === parsed.grantId));
      if (parsed.grantId && grants.length !== 1) deny('grant_unavailable', 404);
      if (parsed.grantId && grants[0].revision !== parsed.expectedGrantRevision) deny('revision_conflict', 409);
      const selected = new Set(grants.map(g => g.id));
      for (const g of grants) { g.status = 'revoked'; g.revocationEpoch++; g.revision++; g.updatedAt = now; }
      if (!parsed.grantId) for (const subscription of records.subscriptions.filter(s => s.connectionId === connection.id)) { subscription.status = 'revoked'; subscription.revision++; subscription.updatedAt = now; }
      if (!parsed.grantId) { connection.lifecycle = 'revoked'; connection.revocationEpoch++; connection.revision++; connection.updatedAt = now; }
      const sources = records.sources.filter(s => s.connectionId === connection.id && (!parsed.grantId || selected.has(s.grantId)));
      for (const s of sources) { s.status = 'suppressed'; s.revision++; s.updatedAt = now; }
      const affected = records.operations.filter(o => o.connectionId === connection.id && (!parsed.grantId || selected.has(o.grantId)));
      for (const o of affected) {
        if (!['needs_approval', 'authorized', 'queued', 'sending'].includes(o.state)) continue;
        if (['needs_approval', 'authorized', 'queued'].includes(o.state)) { o.state = 'cancelled'; o.safeReason = 'revoked'; o.completedAt = now; }
        else if (o.state === 'sending') { o.state = 'outcome_unknown'; o.safeReason = 'revoked_after_dispatch'; }
        o.cancellationRequestedAt = now; o.fence++; o.leaseOwner = null; o.leaseUntil = null; o.revision++; o.updatedAt = now;
      }
      records.payloads = records.payloads.filter(p => !affected.some(o => o.id === p.operationId));
      for (const item of records.outbox) if (affected.some(o => o.id === item.operationId)) { item.status = 'done'; item.revision++; item.updatedAt = now; }
      const sourceIds = sources.map(s => s.id);
      records.tombstones.push({ ...baseRecord(context, now, Number.MAX_SAFE_INTEGER), connectionId: connection.id,
        sourceId: null, revocationEpoch: connection.revocationEpoch, reason: parsed.grantId ? 'grant_revoked' : 'disconnect',
        providerRevocation: parsed.grantId ? 'not_requested' : 'pending', purge: 'pending' });
      for (let offset = 0; offset < Math.max(1, sourceIds.length); offset += 100) records.outbox.push({ ...baseRecord(context, now), operationId: null, kind: 'invalidate', status: 'pending',
        connectionId: connection.id, sourceIds: sourceIds.slice(offset, offset + 100), availableAt: now });
      audit(records, context, now, parsed.grantId ? 'grant_revoked' : 'connection_revoked', parsed.grantId ?? connection.id);
      return affected.filter(o => o.payload.kind === 'ephemeral').map(o => o.payload.kind === 'ephemeral' ? o.payload.ephemeralLeaseId : '');
    });
    for (const leaseId of ephemeralIds) this.ephemeral.delete(leaseId);
    return this.list(actor, { space: parsed.space });
  }
  /** Manual isolated input only. Generated calls MUST use proposeGenerated with complete generation lineage. */
  async propose(actor: ConnectionActor, input: unknown, trustedGenerationSourceIds: readonly string[] = [], workflowBinding?: { workflowId: string; workflowRevision: number; occurrenceId: string }): Promise<OperationReceipt> {
    const parsed = proposeInputSchema.parse(input);
    const sourceIds = [...new Set([...parsed.sourceIds, ...trustedGenerationSourceIds])];
    if (sourceIds.length > 100) deny('source_limit', 400);
    const context = await this.context(actor, parsed.space);
    const now = this.now();
    const ephemeralId = parsed.retention === 'ephemeral' ? randomUUID() : null;
    let prepared: { args: Record<string, unknown>; inputDigest: string } | undefined;
    const receipt = await this.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === parsed.connectionId);
      const grant = records.grants.find(g => g.id === parsed.grantId);
      if (!connection || !grant) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (connection.schemaVersion === 2 && connection.agentId !== parsed.agentId) deny('agent_connection_mismatch');
      const catalog = this.catalogForConnection(connection);
      const tool = catalog.get(parsed.toolId);
      if (!tool) return deny('tool_unavailable', 404);
      const args = catalog.validateArguments(tool.id, parsed.arguments);
      const bytes = Buffer.byteLength(canonical(args));
      if (bytes > tool.maxInputBytes || parsed.deadlineAt <= now || parsed.deadlineAt > now + MAX_OPERATION_LIFETIME_MS) deny('operation_limits', 400);
      const resources = [...catalog.mapResources(tool.id, args)];
      const inputDigest = digest(args);
      prepared = undefined;
      assertGrant(context, connection, grant, tool, { agentId: parsed.agentId, resourceIds: resources, destinationId: parsed.destinationId, bytes }, now);
      const sources = resolveSources(records, sourceIds, context, now);
      assertSourceUse(context, sources, { agentId: parsed.agentId, destinationId: parsed.destinationId,
        purpose: 'explicit.connection_task', persist: parsed.retention === 'retained' }, now);
      const fingerprint = digest({ inputDigest, tool, resources, destinationId: parsed.destinationId,
        expectedTargetRevision: parsed.expectedTargetRevision, sourceRevisions: sources.map(s => `${s.id}:${s.revision}:${s.resourceRevision}`),
        connectionId: connection.id, connectionRevision: connection.revision, connectionEpoch: connection.revocationEpoch,
        grantId: grant.id, grantRevision: grant.revision, agentId: parsed.agentId, scope: context.scope,
        bindingRevision: context.bindingRevision, policyVersion: CONNECTIONS_POLICY_VERSION, workflowBinding: workflowBinding ?? null, retention: parsed.retention, deadlineAt: parsed.deadlineAt });
      const previous = records.operations.find(o => o.idempotencyKey === parsed.idempotencyKey || o.requestId === parsed.requestId);
      if (previous) {
        if (previous.proposalDigest !== fingerprint || previous.idempotencyKey !== parsed.idempotencyKey || previous.requestId !== parsed.requestId) deny('idempotency_conflict', 409);
        return operationReceipt(previous);
      }
      if (grant.callsReserved >= grant.maxCalls) deny('call_budget_exhausted', 409);
      grant.callsReserved++; grant.updatedAt = now;
      // Reservation does not change the permission revision used by existing intents.
      const operationId = randomUUID();
      const argumentsRef = randomUUID();
      const payload = ephemeralId ? { kind: 'ephemeral' as const, ephemeralLeaseId: ephemeralId, expiresAt: parsed.deadlineAt } :
        { kind: 'retained' as const, argumentsRef, revision: 1 };
      const operation: OperationRecord = { ...baseRecord(context, now), id: operationId, requestId: parsed.requestId,
        idempotencyKey: parsed.idempotencyKey, connectionId: connection.id, grantId: grant.id, grantRevision: grant.revision,
        connectionRevision: connection.revision, connectionEpoch: connection.revocationEpoch, agentId: parsed.agentId,
        toolId: tool.id, toolVersion: tool.version, adapterId: tool.adapterId, adapterVersion: tool.adapterVersion,
        catalogDigest: tool.catalogDigest, schemaDigest: tool.schemaDigest, effect: tool.effect, retryClass: tool.retryClass,
        resourceIds: resources, destinationId: parsed.destinationId, expectedTargetRevision: parsed.expectedTargetRevision,
        payload, inputDigest, proposalDigest: fingerprint, sourceIds,
        sourceRevisions: sources.map(s => `${s.id}:${s.revision}:${s.resourceRevision}`), bindingRevision: context.bindingRevision,
        policyVersion: CONNECTIONS_POLICY_VERSION, state: tool.effect === 'read' ? (ephemeralId ? 'authorized' : 'queued') : 'needs_approval',
        approvalId: null, deadlineAt: parsed.deadlineAt, leaseOwner: null, leaseUntil: null, fence: 0,
        dispatchedAt: null, completedAt: null, cancellationRequestedAt: null, providerReceiptRef: null, safeReason: null, ...(workflowBinding ?? {}) };
      records.operations.push(operation);
      if (payload.kind === 'retained') records.payloads.push({ ...baseRecord(context, now, parsed.deadlineAt), id: argumentsRef,
        operationId, arguments: args, inputDigest, sourceIds, expiresAt: parsed.deadlineAt });
      else prepared = { args, inputDigest };
      if (operation.state === 'queued') records.outbox.push({ ...baseRecord(context, now), operationId, kind: 'dispatch',
        status: 'pending', connectionId: connection.id, sourceIds, availableAt: now });
      audit(records, context, now, 'operation_proposed', operation.id, operation.id);
      return operationReceipt(operation);
    });
    if (prepared && ephemeralId) this.ephemeral.put(ephemeralId, context, receipt.operationId, prepared.args, prepared.inputDigest, parsed.deadlineAt);
    return receipt;
  }
  /** Server-only runtime seam: lineage is the union of ALL context visible to this generation,
   * including results, history, summaries and delegated context, regardless of argument wording. */
  async proposeGenerated(actor: ConnectionActor, input: unknown, generation: { sourceIds: readonly string[]; isolated: true; workflow?: { workflowId: string; workflowRevision: number; occurrenceId: string } }): Promise<OperationReceipt> {
    if (!generation || generation.isolated !== true || !Array.isArray(generation.sourceIds)) deny('generation_lineage_required');
    return this.propose(actor, input, generation.sourceIds, generation.workflow);
  }
  async preview(actor: ConnectionActor, input: unknown): Promise<{ receipt: OperationReceipt; arguments: Record<string, unknown> }> {
    const parsed = cancelInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    return this.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === parsed.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      if (operation.revision !== parsed.expectedRevision) deny('revision_conflict', 409);
      currentOperation(records, context, operation, this.catalogForConnection, this.now());
      const args = this.operations.argumentsFor(records, context, operation);
      return { receipt: operationReceipt(operation), arguments: args };
    });
  }
  async approve(actor: ConnectionActor, input: unknown): Promise<OperationReceipt> {
    const parsed = approveInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    const now = this.now();
    return this.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === parsed.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      if (operation.revision !== parsed.expectedRevision || operation.proposalDigest !== parsed.proposalDigest || operation.state !== 'needs_approval') deny('approval_stale', 409);
      currentOperation(records, context, operation, this.catalogForConnection, now);
      this.operations.argumentsFor(records, context, operation);
      const approval = { ...baseRecord(context, now), operationId: operation.id, proposalDigest: operation.proposalDigest,
        approverPersonId: context.personId, bindingRevision: context.bindingRevision, expiresAt: Math.min(now + 5 * 60_000, operation.deadlineAt),
        consumedAt: null, nonce: randomUUID() };
      records.approvals.push(approval); operation.approvalId = approval.id;
      operation.state = operation.payload.kind === 'retained' ? 'queued' : 'authorized'; operation.revision++; operation.updatedAt = now;
      if (operation.state === 'queued') records.outbox.push({ ...baseRecord(context, now), operationId: operation.id, kind: 'dispatch',
        status: 'pending', connectionId: operation.connectionId, sourceIds: operation.sourceIds, availableAt: now });
      audit(records, context, now, 'operation_approved', operation.id, operation.id);
      return operationReceipt(operation);
    });
  }
  async cancel(actor: ConnectionActor, input: unknown): Promise<OperationReceipt> {
    const parsed = cancelInputSchema.parse(input);
    const context = await this.context(actor, parsed.space);
    const now = this.now();
    return this.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === parsed.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      if (operation.revision !== parsed.expectedRevision) deny('revision_conflict', 409);
      if (['committed', 'verified', 'failed', 'cancelled', 'expired'].includes(operation.state)) return operationReceipt(operation);
      operation.cancellationRequestedAt = now;
      operation.state = operation.dispatchedAt === null ? 'cancelled' : 'outcome_unknown';
      operation.safeReason = operation.dispatchedAt === null ? 'cancelled_before_dispatch' : 'cancellation_pending_reconciliation';
      operation.fence++; operation.leaseOwner = null; operation.leaseUntil = null; operation.revision++; operation.updatedAt = now;
      if (operation.payload.kind === 'ephemeral') this.ephemeral.delete(operation.payload.ephemeralLeaseId);
      records.payloads = records.payloads.filter(p => p.operationId !== operation.id);
      for (const item of records.outbox) if (item.operationId === operation.id) { item.status = 'done'; item.revision++; item.updatedAt = now; }
      audit(records, context, now, 'operation_cancelled', operation.id, operation.id);
      return operationReceipt(operation);
    });
  }
}
