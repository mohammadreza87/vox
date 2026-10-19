import type { ConnectionActor, SourceLabel, SpaceKind } from './contracts';
import { assertSourceUse } from './policy';
import { deny } from './errors';
import { baseRecord, audit, resolveSources, currentOperation, type ConnectionsService } from './service';
const intersection = (sets: readonly (readonly string[])[]): string[] => sets.length ? [...new Set(sets[0])].filter(id => sets.every(set => set.includes(id))) : [];
/** Labels only: provider data never becomes instructions, grants or durable memory by being labelled. */
export class ConnectionsLineage {
  constructor(private readonly service: ConnectionsService) {}
  /** Trusted broker seam after validated adapter result. No raw result body is persisted here. */
  async registerResult(actor: ConnectionActor, input: { space: SpaceKind; operationId: string; resourceId: string;
    resourceRevision: string; allowMemory?: boolean }): Promise<SourceLabel> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    return this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === input.operationId);
      if (!operation || !['committed', 'verified'].includes(operation.state) || !operation.resourceIds.includes(input.resourceId)) return deny('result_unavailable');
      currentOperation(records, context, operation, this.service.options.catalog, now);
      const grant = records.grants.find(g => g.id === operation.grantId)!;
      const parents = resolveSources(records, operation.sourceIds, context, now);
      // No memory authority is inferred from an operation grant. A separate reviewed memory bridge must grant it.
      if (input.allowMemory) deny('memory_bridge_unavailable');
      const source: SourceLabel = { ...baseRecord(context, now, Math.min(grant.expiresAt, ...parents.map(p => p.expiresAt))),
        connectionId: operation.connectionId, connectionEpoch: operation.connectionEpoch, grantId: grant.id,
        grantRevision: grant.revision, resourceId: input.resourceId, resourceRevision: input.resourceRevision,
        allowedAgentIds: intersection([[operation.agentId], ...parents.map(p => p.allowedAgentIds)]),
        allowedPersonIds: intersection([context.scope.audiencePersonIds, ...parents.map(p => p.allowedPersonIds)]),
        allowedDestinationIds: intersection([grant.destinationIds, ...parents.map(p => p.allowedDestinationIds)]),
        allowedPurposes: ['explicit.connection_task'], sensitivity: parents.some(p => p.sensitivity === 'restricted') ? 'restricted' : 'private',
        expiresAt: Math.min(grant.expiresAt, ...parents.map(p => p.expiresAt)), persist: false, status: 'active', parentSourceIds: operation.sourceIds };
      if (!source.allowedAgentIds.length || !source.allowedPersonIds.length || !source.allowedDestinationIds.length) deny('source_intersection_empty');
      records.sources.push(source);
      audit(records, context, now, 'source_registered', source.id, operation.id);
      return source;
    });
  }
  /** ALL context source IDs must be passed by the trusted generation/runtime owner. */
  async assertUse(actor: ConnectionActor, input: { space: SpaceKind; sourceIds: readonly string[]; agentId: string;
    destinationId: string; purpose: 'explicit.connection_task' | 'explicit.memory_request'; persist?: boolean }): Promise<void> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    await this.service.repository.transaction(context, records => {
      const sources = resolveSources(records, input.sourceIds, context, now);
      assertSourceUse(context, sources, input, now);
    });
  }
  async deleteSource(actor: ConnectionActor, input: { space: SpaceKind; sourceId: string; expectedRevision: number }): Promise<{
    futureUseStopped: true; purge: 'pending'; providerCopies: 'unverified'; backupExpiry: 'unverified'; suppressedSourceIds: string[];
  }> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    const result = await this.service.repository.transaction(context, records => {
      const original = records.sources.find(s => s.id === input.sourceId);
      if (!original) return deny('source_unavailable', 404);
      if (original.revision !== input.expectedRevision) deny('revision_conflict', 409);
      const selected = new Set([original.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const source of records.sources) if (!selected.has(source.id) && source.parentSourceIds.some(id => selected.has(id))) { selected.add(source.id); changed = true; }
      }
      for (const source of records.sources.filter(s => selected.has(s.id))) {
        source.status = 'suppressed'; source.revision++; source.updatedAt = now;
        records.tombstones.push({ ...baseRecord(context, now, Number.MAX_SAFE_INTEGER), connectionId: source.connectionId,
          sourceId: source.id, revocationEpoch: source.connectionEpoch, reason: 'source_deleted', providerRevocation: 'not_requested', purge: 'pending' });
      }
      const operations = records.operations.filter(o => o.sourceIds.some(id => selected.has(id)));
      const liveIds: string[] = [];
      for (const operation of operations) {
        if (['queued', 'authorized', 'needs_approval'].includes(operation.state)) operation.state = 'cancelled';
        else if (operation.state === 'sending') operation.state = 'outcome_unknown';
        operation.safeReason = 'source_deleted'; operation.cancellationRequestedAt = now; operation.fence++;
        operation.leaseOwner = null; operation.leaseUntil = null; operation.revision++; operation.updatedAt = now;
        if (operation.payload.kind === 'ephemeral') liveIds.push(operation.payload.ephemeralLeaseId);
      }
      records.payloads = records.payloads.filter(p => !p.sourceIds.some(id => selected.has(id)));
      for (const item of records.outbox) if (item.operationId && operations.some(o => o.id === item.operationId)) { item.status = 'done'; item.revision++; item.updatedAt = now; }
      records.outbox.push({ ...baseRecord(context, now), operationId: null, kind: 'invalidate', status: 'pending',
        connectionId: original.connectionId, sourceIds: [...selected], availableAt: now });
      audit(records, context, now, 'source_deleted', original.id);
      return { liveIds, suppressedSourceIds: [...selected] };
    });
    for (const id of result.liveIds) this.service.ephemeral.delete(id);
    return { futureUseStopped: true, purge: 'pending', providerCopies: 'unverified', backupExpiry: 'unverified', suppressedSourceIds: result.suppressedSourceIds };
  }
}
