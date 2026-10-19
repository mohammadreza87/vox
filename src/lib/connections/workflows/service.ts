import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { idSchema, workflowScheduleSchema, type ConnectionActor, type ConnectionContext, type ConnectionWorkflow,
  type ConnectionSubscription, type ConnectionEvent, type ConnectionsRecords, type SpaceKind, type WorkflowOccurrence } from '../contracts';
import { ConnectionsError, deny } from '../errors';
import { baseRecord, audit, type ConnectionsService } from '../service';
import { assertOwner, assertGrant, sameScope } from '../policy';
import { canonical, digest } from '../repository';
import { resolveConnectionSkill } from '../skills';
import { assertTimezone, scheduledSlot, occurrenceUuid, inQuietHours, hasEligibleOccurrence } from '../triggers/scheduler';
import type { VerifiedConnectionEvent } from '../events/verification';
import type { ConnectionExecutionResult } from '../application';
const space = z.enum(['work', 'personal']);
const positive = z.number().int().positive();
export const workflowCreateSchema = z.object({ space, name: z.string().trim().min(1).max(160), agentId: idSchema,
  connectionId: idSchema, grantId: idSchema, skillId: idSchema, skillVersion: positive,
  steps: z.array(z.object({ toolId: idSchema, arguments: z.record(z.string(), z.unknown()) }).strict()).min(1).max(5),
  schedule: workflowScheduleSchema, timezone: z.string().min(1).max(100),
  quietHours: z.object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(0).max(23) }).strict().nullable(),
  expiresAt: positive, maxRuns: positive.max(1000), maxCalls: positive.max(1000) }).strict();
export const workflowCommandSchema = z.object({ space, workflowId: idSchema, expectedRevision: positive }).strict();
export const workflowReviewSchema = workflowCommandSchema.extend({ reviewDigest: idSchema }).strict();
export const workflowDrainSchema = z.object({ space, maxOccurrences: positive.max(10) }).strict();
export interface WorkflowServiceOptions {
  dispatcher: (actor: ConnectionActor, space: SpaceKind, operationId: string) => Promise<ConnectionExecutionResult>;
  /** Native provider read, independently authorized for the exact subscription. Never trust an event body as current state. */
  readback?: (actor: ConnectionActor, subscription: ConnectionSubscription, event: ConnectionEvent) => Promise<{ matches: boolean; revision: string }>;
  now?: () => number;
}
function safeMetadataArguments(value: unknown, depth = 0): void {
  if (depth > 5) deny('workflow_arguments_invalid', 400);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value === 'string' && value.length <= 200 && !/[\r\n]/.test(value)) return;
  if (Array.isArray(value) && value.length <= 30) { for (const item of value) safeMetadataArguments(item, depth + 1); return; }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (/query|text|body|content|sql|url|header|token|secret|prompt|email|message$/i.test(key)) deny('workflow_content_persistence_denied');
      safeMetadataArguments(item, depth + 1);
    }
    return;
  }
  deny('workflow_arguments_invalid', 400);
}
export class ConnectionsWorkflowService {
  private readonly now: () => number;
  constructor(readonly core: ConnectionsService, readonly options: WorkflowServiceOptions) { this.now = options.now ?? core.now; }
  async list(actor: ConnectionActor, selectedSpace: SpaceKind) {
    const context = await this.core.context(actor, selectedSpace);
    return this.core.repository.transaction(context, records => ({ workflows: records.workflows, occurrences: records.occurrences,
      // Secret references and native subscription ownership never become browser content.
      subscriptions: records.subscriptions.map(s => ({ id: s.id, providerId: s.providerId, connectionId: s.connectionId, resourceId: s.resourceId, status: s.status, expiresAt: s.expiresAt })) }));
  }
  private current(records: ConnectionsRecords, context: ConnectionContext, workflow: ConnectionWorkflow): void {
    const now = this.now();
    const connection = records.connections.find(c => c.id === workflow.connectionId);
    const grant = records.grants.find(g => g.id === workflow.grantId);
    if (!connection || !grant) return deny('workflow_stale', 409);
    if (workflow.bindingRevision !== context.bindingRevision || workflow.grantRevision !== grant.revision ||
        workflow.connectionRevision !== connection.revision || workflow.expiresAt <= now || !sameScope(workflow.scope, context.scope) ||
        !resolveConnectionSkill(workflow.skillId, Number(workflow.skillVersion), context.scope.spaceKind, connection.providerId, grant)) deny('workflow_stale', 409);
    for (const step of workflow.steps) {
      const tool = this.core.options.catalog.get(step.toolId);
      if (!tool) return deny('workflow_tool_drift', 409);
      if (tool.effect !== 'read' || tool.version !== step.toolVersion || tool.catalogDigest !== step.catalogDigest || tool.schemaDigest !== step.schemaDigest) deny('workflow_tool_drift', 409);
      assertGrant(context, connection, grant, tool, { agentId: workflow.agentId, resourceIds: step.resourceIds,
        destinationId: `provider:${connection.providerId}`, bytes: Buffer.byteLength(canonical(step.arguments)) }, now);
    }
    if (workflow.schedule.kind === 'event') {
      const subscription = records.subscriptions.find(s => workflow.schedule.kind === 'event' && s.id === workflow.schedule.subscriptionId);
      if (!subscription || subscription.status !== 'active' || subscription.expiresAt <= now || subscription.connectionId !== connection.id ||
          workflow.steps.some(step => step.resourceIds.some(id => id !== subscription.resourceId))) deny('workflow_subscription_unavailable');
    }
  }
  async create(actor: ConnectionActor, input: unknown): Promise<ConnectionWorkflow> {
    const parsed = workflowCreateSchema.parse(input); assertTimezone(parsed.timezone);
    const context = await this.core.context(actor, parsed.space); const now = this.now();
    return this.core.repository.transaction(context, records => {
      if (records.workflows.length >= 100) deny('workflow_capacity', 409);
      const connection = records.connections.find(c => c.id === parsed.connectionId);
      const grant = records.grants.find(g => g.id === parsed.grantId);
      if (!connection || !grant) return deny('connection_unavailable', 404);
      assertOwner(context, connection);
      if (parsed.expiresAt <= now || parsed.expiresAt > Math.min(grant.expiresAt, context.bindingExpiresAt) || parsed.maxCalls < parsed.steps.length ||
          !resolveConnectionSkill(parsed.skillId, parsed.skillVersion, parsed.space, connection.providerId, grant)) deny('workflow_authority_denied');
      const steps = parsed.steps.map(step => {
        const tool = this.core.options.catalog.get(step.toolId);
        if (!tool || tool.effect !== 'read') return deny('workflow_effect_unavailable');
        const args = this.core.options.catalog.validateArguments(step.toolId, step.arguments); safeMetadataArguments(args);
        return { toolId: tool.id, toolVersion: tool.version, catalogDigest: tool.catalogDigest, schemaDigest: tool.schemaDigest,
          arguments: args, resourceIds: [...this.core.options.catalog.mapResources(tool.id, args)] };
      });
      if (parsed.schedule.kind === 'event' && !['github.repository.get', 'slack.channel.get'].includes(steps[0].toolId)) deny('workflow_native_readback_required');
      const workflow: ConnectionWorkflow = { ...baseRecord(context, now), name: parsed.name, agentId: parsed.agentId,
        connectionId: connection.id, grantId: grant.id, grantRevision: grant.revision, connectionRevision: connection.revision,
        bindingRevision: context.bindingRevision, skillId: parsed.skillId, skillVersion: String(parsed.skillVersion), steps,
        schedule: parsed.schedule, timezone: parsed.timezone, quietHours: parsed.quietHours, expiresAt: parsed.expiresAt,
        maxRuns: parsed.maxRuns, maxCalls: parsed.maxCalls, runsReserved: 0, callsReserved: 0, status: 'draft',
        reviewDigest: 'pending', reviewedByPersonId: null, reviewedAt: null, lastEvaluatedAt: now };
      this.current(records, context, workflow);
      if (!hasEligibleOccurrence(workflow, now)) deny('workflow_no_eligible_time', 400);
      workflow.reviewDigest = digest({ ...workflow, id: null, partitionId: null, createdAt: null, updatedAt: null, reviewDigest: null });
      records.workflows.push(workflow); audit(records, context, now, 'workflow_created', workflow.id); return workflow;
    });
  }
  async review(actor: ConnectionActor, input: unknown): Promise<ConnectionWorkflow> {
    const parsed = workflowReviewSchema.parse(input); const context = await this.core.context(actor, parsed.space); const now = this.now();
    return this.core.repository.transaction(context, records => {
      const workflow = records.workflows.find(w => w.id === parsed.workflowId);
      if (!workflow) return deny('workflow_unavailable', 404);
      if (workflow.revision !== parsed.expectedRevision || workflow.reviewDigest !== parsed.reviewDigest || workflow.status !== 'draft') deny('workflow_review_stale', 409);
      this.current(records, context, workflow); workflow.status = 'active'; workflow.reviewedByPersonId = context.personId; workflow.reviewedAt = now;
      workflow.revision++; workflow.updatedAt = now; audit(records, context, now, 'workflow_reviewed', workflow.id); return workflow;
    });
  }
  async pause(actor: ConnectionActor, input: unknown): Promise<ConnectionWorkflow> {
    const parsed = workflowCommandSchema.parse(input); const context = await this.core.context(actor, parsed.space); const now = this.now();
    return this.core.repository.transaction(context, records => {
      const workflow = records.workflows.find(w => w.id === parsed.workflowId);
      if (!workflow) return deny('workflow_unavailable', 404);
      if (workflow.revision !== parsed.expectedRevision) deny('revision_conflict', 409);
      workflow.status = 'paused'; workflow.revision++; workflow.updatedAt = now;
      for (const operation of records.operations.filter(o => o.workflowId === workflow.id && ['needs_approval', 'authorized', 'queued', 'sending'].includes(o.state))) {
        operation.state = operation.dispatchedAt === null ? 'cancelled' : 'outcome_unknown'; operation.safeReason = 'workflow_paused';
        operation.fence++; operation.leaseOwner = null; operation.leaseUntil = null; operation.revision++; operation.updatedAt = now;
        if (operation.payload.kind === 'ephemeral') this.core.ephemeral.delete(operation.payload.ephemeralLeaseId);
      }
      audit(records, context, now, 'workflow_paused', workflow.id); return workflow;
    });
  }
  /** Authenticated broker registration only: secret is already sealed in broker vault. No browser route accepts it. */
  async registerSubscription(actor: ConnectionActor, input: { space: SpaceKind; connectionId: string; providerId: 'github' | 'slack';
    providerTenantId: string; nativeResourceId: string; resourceId: string; eventTypes: string[]; secretRef: string; secretVersion: number; expiresAt: number }): Promise<ConnectionSubscription> {
    const context = await this.core.context(actor, input.space); const now = this.now();
    return this.core.repository.transaction(context, records => {
      const connection = records.connections.find(c => c.id === input.connectionId);
      if (!connection) return deny('connection_unavailable', 404); assertOwner(context, connection);
      if (connection.lifecycle !== 'connected' || connection.providerId !== input.providerId || input.expiresAt <= now || input.expiresAt > context.bindingExpiresAt ||
          !records.grants.some(g => g.connectionId === connection.id && g.status === 'active' && g.resourceIds.includes(input.resourceId))) deny('subscription_denied');
      const subscription: ConnectionSubscription = { ...baseRecord(context, now), connectionId: connection.id, providerId: input.providerId,
        providerTenantId: input.providerTenantId, nativeResourceId: input.nativeResourceId, resourceId: input.resourceId,
        eventTypes: input.eventTypes, secretRef: input.secretRef, secretVersion: input.secretVersion, status: 'active', expiresAt: input.expiresAt };
      records.subscriptions.push(subscription); audit(records, context, now, 'subscription_registered', subscription.id); return subscription;
    });
  }
  /** Only minimized metadata from verifyProviderEvent in the authenticated broker is accepted. */
  async acceptVerifiedEvent(actor: ConnectionActor, selectedSpace: SpaceKind, event: VerifiedConnectionEvent): Promise<{ accepted: true; duplicate: boolean; eventId: string }> {
    const context = await this.core.context(actor, selectedSpace); const now = this.now();
    return this.core.repository.transaction(context, records => {
      const subscription = records.subscriptions.find(s => s.id === event.subscriptionId);
      const connection = records.connections.find(c => c.id === subscription?.connectionId);
      if (!subscription || !connection) return deny('event_subscription_denied');
      if (connection.lifecycle !== 'connected' || subscription.status !== 'active' || subscription.expiresAt <= now ||
          subscription.providerId !== event.providerId || subscription.providerTenantId !== event.providerTenantId || subscription.nativeResourceId !== event.nativeResourceId ||
          subscription.secretVersion !== event.secretVersion || !subscription.eventTypes.includes(event.safeType) || Math.abs(event.occurredAt - now) > 300_000) deny('event_subscription_denied');
      const existing = records.eventInbox.find(e => e.subscriptionId === subscription.id && (e.providerEventId === event.providerEventId || e.payloadDigest === event.payloadDigest));
      if (existing) return { accepted: true, duplicate: true, eventId: existing.id };
      const record: ConnectionEvent = { ...baseRecord(context, now), subscriptionId: subscription.id, connectionId: connection.id,
        providerId: event.providerId, providerEventId: event.providerEventId, payloadDigest: event.payloadDigest, safeType: event.safeType,
        providerTenantId: event.providerTenantId, nativeResourceId: event.nativeResourceId, occurredAt: event.occurredAt, receivedAt: now,
        status: 'pending', safeReason: null };
      records.eventInbox.push(record); audit(records, context, now, 'event_received', record.id); return { accepted: true, duplicate: false, eventId: record.id };
    });
  }
  async drain(actor: ConnectionActor, input: unknown): Promise<{ occurrences: WorkflowOccurrence[]; quiet: true }> {
    const parsed = workflowDrainSchema.parse(input); let context = await this.core.context(actor, parsed.space); const now = this.now();
    // An expired occurrence lease never regenerates payloads or new operation IDs after process loss.
    await this.core.repository.transaction(context, records => {
      for (const occurrence of records.occurrences) if (['running', 'reserved'].includes(occurrence.state) && occurrence.leaseUntil !== null && occurrence.leaseUntil <= now) {
        occurrence.state = occurrence.operationIds.length ? 'outcome_unknown' : 'skipped'; occurrence.safeReason = 'workflow_worker_lost';
        occurrence.fence++; occurrence.leaseOwner = null; occurrence.leaseUntil = null; occurrence.revision++; occurrence.updatedAt = now;
      }
    });
    const claimed = await this.core.repository.transaction(context, records => {
      const selected: Array<{ workflow: ConnectionWorkflow; occurrence: WorkflowOccurrence; event?: ConnectionEvent; subscription?: ConnectionSubscription }> = [];
      for (const workflow of records.workflows) {
        if (selected.length >= parsed.maxOccurrences || workflow.status !== 'active' || inQuietHours(workflow, now)) continue;
        if (workflow.expiresAt <= now) { workflow.status = 'expired'; workflow.revision++; workflow.updatedAt = now; continue; }
        try { this.current(records, context, workflow); }
        catch { workflow.status = 'paused'; workflow.revision++; workflow.updatedAt = now; audit(records, context, now, 'workflow_authority_expired', workflow.id); continue; }
        if (workflow.runsReserved >= workflow.maxRuns || workflow.callsReserved + workflow.steps.length > workflow.maxCalls) continue;
        let slot = scheduledSlot(workflow, now); let event: ConnectionEvent | undefined; let subscription: ConnectionSubscription | undefined;
        if (workflow.schedule.kind === 'event') {
          subscription = records.subscriptions.find(s => workflow.schedule.kind === 'event' && s.id === workflow.schedule.subscriptionId);
          event = records.eventInbox.find(e => e.subscriptionId === subscription?.id && e.status === 'pending' && e.receivedAt >= (workflow.reviewedAt ?? Number.MAX_SAFE_INTEGER) &&
            !records.occurrences.some(o => o.workflowId === workflow.id && o.eventId === e.id));
          if (event) slot = { key: `event:${event.id}`, slotAt: event.receivedAt };
        }
        if (!slot) continue;
        const occurrenceId = occurrenceUuid(workflow.id, slot.key);
        if (records.occurrences.some(o => o.id === occurrenceId)) continue;
        const occurrence: WorkflowOccurrence = { ...baseRecord(context, now), id: occurrenceId, workflowId: workflow.id, occurrenceKey: slot.key,
          slotAt: slot.slotAt, eventId: event?.id ?? null, operationIds: [], state: 'running', safeReason: null,
          leaseOwner: randomUUID(), leaseUntil: now + 60_000, fence: 1, completedAt: null };
        records.occurrences.push(occurrence); workflow.runsReserved++; workflow.callsReserved += workflow.steps.length; workflow.lastEvaluatedAt = now; workflow.updatedAt = now;
        selected.push({ workflow: structuredClone(workflow), occurrence: structuredClone(occurrence), ...(event ? { event: structuredClone(event) } : {}), ...(subscription ? { subscription: structuredClone(subscription) } : {}) });
        audit(records, context, now, 'workflow_occurrence_reserved', occurrence.id);
      }
      return selected;
    });
    const completed: WorkflowOccurrence[] = [];
    for (const item of claimed) {
      let state: WorkflowOccurrence['state'] = 'complete'; let reason: string | null = null;
      try {
        let needsNativeEvidence = Boolean(item.event && item.subscription);
        if (item.event && item.subscription) {
          const readback = this.options.readback;
          if (readback) {
            const evidence = await readback(actor, item.subscription, item.event);
            if (!evidence.matches || !evidence.revision) deny('native_readback_mismatch');
            needsNativeEvidence = false;
          }
        }
        for (let index = 0; index < item.workflow.steps.length; index++) {
          context = await this.core.context(actor, parsed.space);
          await this.core.repository.transaction(context, records => {
            const workflow = records.workflows.find(w => w.id === item.workflow.id);
            const occurrence = records.occurrences.find(o => o.id === item.occurrence.id);
            if (!workflow || !occurrence) return deny('workflow_stale', 409);
            if (workflow.status !== 'active' || workflow.revision !== item.workflow.revision || occurrence.fence !== item.occurrence.fence || occurrence.state !== 'running') deny('workflow_stale', 409);
            this.current(records, context, workflow);
          });
          const step = item.workflow.steps[index]; const requestId = occurrenceUuid(item.occurrence.id, `step:${index}`);
          const receipt = await this.core.proposeGenerated(actor, { space: parsed.space, requestId, idempotencyKey: requestId,
            connectionId: item.workflow.connectionId, grantId: item.workflow.grantId, agentId: item.workflow.agentId, toolId: step.toolId,
            arguments: step.arguments, destinationId: `provider:${this.core.options.catalog.get(step.toolId)!.providerId}`, expectedTargetRevision: null, sourceIds: [], retention: 'ephemeral', deadlineAt: this.now() + 30_000 },
            { sourceIds: [], isolated: true, workflow: { workflowId: item.workflow.id, workflowRevision: item.workflow.revision, occurrenceId: item.occurrence.id } });
          await this.core.repository.transaction(context, records => {
            const occurrence = records.occurrences.find(o => o.id === item.occurrence.id)!;
            if (occurrence.fence !== item.occurrence.fence || occurrence.state !== 'running') deny('workflow_stale', 409);
            occurrence.operationIds.push(receipt.operationId); occurrence.revision++; occurrence.updatedAt = this.now();
          });
          const result = await this.options.dispatcher(actor, parsed.space, receipt.operationId);
          if (needsNativeEvidence && index === 0 && item.subscription) {
            const envelope = result.output && typeof result.output === 'object' ? result.output as Record<string, unknown> : undefined;
            const evidence = envelope?.nativeEvidence && typeof envelope.nativeEvidence === 'object' ? envelope.nativeEvidence as Record<string, unknown> : undefined;
            if (!evidence || evidence.providerId !== item.subscription.providerId || evidence.providerTenantId !== item.subscription.providerTenantId ||
                evidence.nativeResourceId !== item.subscription.nativeResourceId || !Array.isArray(evidence.resourceIds) ||
                !evidence.resourceIds.includes(item.subscription.resourceId) || typeof evidence.revision !== 'string' || !evidence.revision)
              deny('native_readback_mismatch');
            needsNativeEvidence = false;
          }
          // Result data is deliberately discarded: no persistence or unsolicited delivery authority.
          if (!['committed', 'verified'].includes(result.receipt.state)) { state = result.receipt.state === 'outcome_unknown' ? 'outcome_unknown' : 'failed'; reason = 'workflow_operation_incomplete'; break; }
        }
      } catch (error) { state = 'failed'; reason = error instanceof ConnectionsError ? error.code : 'workflow_execution_failed'; }
      context = await this.core.context(actor, parsed.space);
      const record = await this.core.repository.transaction(context, records => {
        const occurrence = records.occurrences.find(o => o.id === item.occurrence.id)!;
        if (occurrence.fence !== item.occurrence.fence) return occurrence;
        occurrence.state = state; occurrence.safeReason = reason; occurrence.completedAt = this.now(); occurrence.leaseOwner = null; occurrence.leaseUntil = null;
        occurrence.revision++; occurrence.updatedAt = this.now();
        if (item.event) {
          const event = records.eventInbox.find(e => e.id === item.event!.id);
          if (event && records.workflows.filter(w => w.status === 'active' && w.schedule.kind === 'event' && w.schedule.subscriptionId === event.subscriptionId)
            .every(w => records.occurrences.some(o => o.workflowId === w.id && o.eventId === event.id && !['reserved', 'running'].includes(o.state)))) {
            event.status = 'processed'; event.revision++; event.updatedAt = this.now();
          }
        }
        audit(records, context, this.now(), 'workflow_occurrence_finished', occurrence.id); return occurrence;
      });
      completed.push(record);
    }
    return { occurrences: completed, quiet: true };
  }
}
