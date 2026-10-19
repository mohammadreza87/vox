import { type ConnectionActor, type ConnectionContext, type ConnectionsRecords, type OperationRecord,
  type OperationReceipt, type SpaceKind } from './contracts';
import { assertContext, sameScope } from './policy';
import { digest } from './repository';
import { deny } from './errors';
import { baseRecord, audit, currentOperation, operationReceipt, type ConnectionsService } from './service';
interface LivePayload { context: ConnectionContext; operationId: string; arguments: Record<string, unknown>; digest: string; expiresAt: number }
/** Per-process live memory only. No serialization, disk dump, queue reconstruction or logging. */
export class EphemeralPayloads {
  private readonly leases = new Map<string, LivePayload>();
  put(id: string, context: ConnectionContext, operationId: string, args: Record<string, unknown>, inputDigest: string, expiresAt: number): void {
    this.leases.set(id, { context: structuredClone(context), operationId, arguments: structuredClone(args), digest: inputDigest, expiresAt });
  }
  get(id: string, context: ConnectionContext, operation: OperationRecord, now: number): Record<string, unknown> {
    const lease = this.leases.get(id);
    if (!lease || lease.expiresAt <= now || lease.context.accountId !== context.accountId || lease.context.personId !== context.personId ||
        lease.context.bindingRevision !== context.bindingRevision || !sameScope(lease.context.scope, context.scope) ||
        lease.operationId !== operation.id || lease.digest !== operation.inputDigest) return deny('ephemeral_payload_unavailable', 409);
    return structuredClone(lease.arguments);
  }
  delete(id: string): void { this.leases.delete(id); }
  clearExpired(now: number): void { for (const [id, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(id); }
}
interface LeaseInput { space: SpaceKind; operationId: string; workerId: string; fence: number }
export interface OperationClaim { operation: OperationRecord; arguments: Record<string, unknown>; fence: number }
/** Trusted authenticated-broker API, never browser/model actions. No network I/O here. */
export class OperationsLedger {
  constructor(private readonly service: ConnectionsService) {}
  argumentsFor(records: ConnectionsRecords, context: ConnectionContext, operation: OperationRecord): Record<string, unknown> {
    const now = this.service.now();
    if (operation.payload.kind === 'ephemeral') return this.service.ephemeral.get(operation.payload.ephemeralLeaseId, context, operation, now);
    const payload = records.payloads.find(p => operation.payload.kind === 'retained' && p.id === operation.payload.argumentsRef);
    if (!payload || payload.operationId !== operation.id || payload.revision !== operation.payload.revision || payload.expiresAt <= now ||
        payload.inputDigest !== operation.inputDigest || digest(payload.arguments) !== operation.inputDigest || !sameScope(payload.scope, context.scope)) return deny('payload_unavailable', 409);
    return structuredClone(payload.arguments);
  }
  private assertLease(operation: OperationRecord, input: LeaseInput, now: number): void {
    if (operation.leaseOwner !== input.workerId || operation.fence !== input.fence || operation.leaseUntil === null || operation.leaseUntil <= now) deny('stale_worker_fence', 409);
  }
  async claim(actor: ConnectionActor, input: Omit<LeaseInput, 'fence'> & { leaseMs: number }): Promise<OperationClaim> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 60_000 || !input.workerId) deny('invalid_lease', 400);
    return this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === input.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      if (!['queued', 'authorized'].includes(operation.state) || operation.dispatchedAt !== null ||
          (operation.leaseUntil !== null && operation.leaseUntil > now)) deny('operation_not_dispatchable', 409);
      currentOperation(records, context, operation, this.service.options.catalog, now);
      const args = this.argumentsFor(records, context, operation);
      operation.leaseOwner = input.workerId; operation.leaseUntil = Math.min(now + input.leaseMs, operation.deadlineAt);
      operation.fence++; operation.revision++; operation.updatedAt = now;
      for (const item of records.outbox) if (item.operationId === operation.id && item.kind === 'dispatch') { item.status = 'claimed'; item.revision++; item.updatedAt = now; }
      records.attempts.push({ ...baseRecord(context, now), operationId: operation.id, fence: operation.fence, phase: 'claimed', providerReceiptRef: null });
      audit(records, context, now, 'operation_claimed', operation.id, operation.id);
      return { operation: structuredClone(operation), arguments: args, fence: operation.fence };
    });
  }
  async abandonClaim(actor: ConnectionActor, input: LeaseInput & { safeReason: string }): Promise<OperationReceipt> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    return this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === input.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      this.assertLease(operation, input, now);
      if (!['queued', 'authorized'].includes(operation.state) || operation.dispatchedAt !== null) deny('operation_already_dispatched', 409);
      operation.state = 'failed'; operation.safeReason = input.safeReason; operation.completedAt = now;
      operation.leaseOwner = null; operation.leaseUntil = null; operation.fence++; operation.revision++; operation.updatedAt = now;
      records.payloads = records.payloads.filter(p => p.operationId !== operation.id);
      if (operation.payload.kind === 'ephemeral') this.service.ephemeral.delete(operation.payload.ephemeralLeaseId);
      for (const item of records.outbox) if (item.operationId === operation.id) { item.status = 'done'; item.revision++; item.updatedAt = now; }
      audit(records, context, now, 'operation_preflight_failed', operation.id, operation.id);
      return operationReceipt(operation);
    });
  }
  /** Call immediately before transmission; write-ahead sending state handles a crash in either direction conservatively. */
  async markDispatched(actor: ConnectionActor, input: LeaseInput): Promise<OperationReceipt> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    return this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === input.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      this.assertLease(operation, input, now);
      if (!['queued', 'authorized'].includes(operation.state) || operation.dispatchedAt !== null) deny('operation_already_dispatched', 409);
      currentOperation(records, context, operation, this.service.options.catalog, now);
      this.argumentsFor(records, context, operation);
      if (operation.effect !== 'read') {
        const approval = records.approvals.find(a => a.id === operation.approvalId);
        if (!approval) return deny('approval_required');
        if (approval.operationId !== operation.id || approval.proposalDigest !== operation.proposalDigest ||
            approval.approverPersonId !== context.personId || approval.bindingRevision !== context.bindingRevision ||
            approval.expiresAt <= now || approval.consumedAt !== null || !sameScope(approval.scope, context.scope)) deny('approval_required');
        approval.consumedAt = now; approval.revision++; approval.updatedAt = now;
      }
      operation.state = 'sending'; operation.dispatchedAt = now; operation.revision++; operation.updatedAt = now;
      records.attempts.push({ ...baseRecord(context, now), operationId: operation.id, fence: operation.fence, phase: 'dispatched', providerReceiptRef: null });
      audit(records, context, now, 'operation_dispatched', operation.id, operation.id);
      return operationReceipt(operation);
    });
  }
  async settle(actor: ConnectionActor, input: LeaseInput & { outcome: 'committed' | 'verified' | 'failed' | 'outcome_unknown'; providerReceiptRef?: string }): Promise<OperationReceipt> {
    const context = await this.service.context(actor, input.space);
    const now = this.service.now();
    const receipt = await this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === input.operationId);
      if (!operation) return deny('operation_unavailable', 404);
      this.assertLease(operation, input, now);
      if (operation.state !== 'sending') deny('operation_not_sending', 409);
      // Provider outcome evidence is retained even when policy changed; output delivery is a separate recheck.
      operation.state = input.outcome; operation.providerReceiptRef = input.providerReceiptRef ?? null;
      operation.completedAt = input.outcome === 'outcome_unknown' ? null : now;
      operation.safeReason = input.outcome === 'outcome_unknown' ? 'provider_outcome_unconfirmed' : null;
      operation.leaseOwner = null; operation.leaseUntil = null; operation.revision++; operation.updatedAt = now;
      records.attempts.push({ ...baseRecord(context, now), operationId: operation.id, fence: operation.fence,
        phase: input.outcome, providerReceiptRef: operation.providerReceiptRef });
      for (const item of records.outbox) if (item.operationId === operation.id) { item.status = 'done'; item.revision++; item.updatedAt = now; }
      records.payloads = records.payloads.filter(p => p.operationId !== operation.id);
      audit(records, context, now, `operation_${input.outcome}`, operation.id, operation.id);
      return operationReceipt(operation);
    });
    // A final receipt never permits replay, even if its live payload is still in memory.
    await this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === input.operationId);
      if (operation?.payload.kind === 'ephemeral') this.service.ephemeral.delete(operation.payload.ephemeralLeaseId);
    });
    return receipt;
  }
  /** Startup/lease recovery does not redispatch any possibly transmitted operation. */
  async recover(actor: ConnectionActor, space: SpaceKind): Promise<OperationReceipt[]> {
    const context = await this.service.context(actor, space);
    const now = this.service.now();
    this.service.ephemeral.clearExpired(now);
    return this.service.repository.transaction(context, records => {
      const recovered: OperationReceipt[] = [];
      for (const operation of records.operations) {
        const lostSendingLease = operation.state === 'sending' && (operation.leaseUntil === null || operation.leaseUntil <= now);
        const expired = ['queued', 'authorized', 'needs_approval'].includes(operation.state) && operation.deadlineAt <= now;
        let lostEphemeral = false;
        if (operation.payload.kind === 'ephemeral' && ['queued', 'authorized', 'needs_approval'].includes(operation.state)) {
          try { this.argumentsFor(records, context, operation); } catch { lostEphemeral = true; }
        }
        if (!lostSendingLease && !expired && !lostEphemeral) continue;
        operation.state = lostSendingLease ? 'outcome_unknown' : 'expired';
        operation.safeReason = lostSendingLease ? 'lease_lost_after_possible_dispatch' : lostEphemeral ? 'ephemeral_payload_lost' : 'deadline_expired';
        operation.fence++; operation.leaseOwner = null; operation.leaseUntil = null; operation.revision++; operation.updatedAt = now;
        if (!lostSendingLease) operation.completedAt = now;
        records.payloads = records.payloads.filter(p => p.operationId !== operation.id);
        for (const item of records.outbox) if (item.operationId === operation.id) { item.status = 'done'; item.revision++; item.updatedAt = now; }
        audit(records, context, now, 'operation_recovered', operation.id, operation.id);
        recovered.push(operationReceipt(operation));
      }
      return recovered;
    });
  }
  /** Independent runner read boundary, before/after each fetch or worker operation. */
  async assertDispatchable(actor: ConnectionActor, space: SpaceKind, operationId: string): Promise<void> {
    const context = await this.service.context(actor, space); const now = this.service.now();
    await this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === operationId);
      if (!operation || operation.state !== 'sending' || operation.dispatchedAt === null || operation.leaseOwner === null ||
          operation.leaseUntil === null || operation.leaseUntil <= now || operation.cancellationRequestedAt !== null) return deny('operation_not_dispatchable', 409);
      currentOperation(records, context, operation, this.service.options.catalog, now);
    });
  }
  /** Before model continuation, memory, cache, external egress and final delivery. */
  async assertUsable(actor: ConnectionActor, space: SpaceKind, operationId: string): Promise<void> {
    const context = await this.service.context(actor, space);
    assertContext(context, actor.accountId, this.service.now());
    await this.service.repository.transaction(context, records => {
      const operation = records.operations.find(o => o.id === operationId);
      if (!operation || !['committed', 'verified'].includes(operation.state)) return deny('result_unavailable');
      currentOperation(records, context, operation, this.service.options.catalog, this.service.now());
    });
  }
}
