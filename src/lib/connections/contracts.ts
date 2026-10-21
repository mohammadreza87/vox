import { z } from 'zod';
import { canonicalMcpUrl } from './mcp/transport';
import { mcpCatalogSnapshotSchema, type McpCatalogSnapshot } from './mcp/catalog';

export const CONNECTIONS_SCHEMA_VERSION = 1 as const;
export const CONNECTIONS_POLICY_VERSION = 'connections-v1';
export const EFFECTS = ['read', 'draft', 'write', 'send', 'destructive', 'privileged'] as const;
export type Effect = typeof EFFECTS[number];
export type SpaceKind = 'work' | 'personal';
export const idSchema = z.string().min(1).max(200).regex(/^[\p{L}\p{N}_.:@/-]+$/u);
const label = z.string().trim().min(1).max(160);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = integer.min(1);
const ids = z.array(idSchema).min(1).max(100).refine(v => new Set(v).size === v.length, 'Duplicate ID');
const space = z.enum(['work', 'personal']);
export const scopeSchema = z.object({ tenantId: idSchema, spaceId: idSchema, spaceKind: space,
  containerId: idSchema, audiencePersonIds: ids, audienceRevision: idSchema }).strict();
export type ScopeBinding = z.infer<typeof scopeSchema>;
export interface ConnectionActor { accountId: string;
  /** Minted by route-scoped bot authentication or signed broker control, never browser input. */
  botAgentId?: string; botAuthenticationRevision?: string;
}
/** Returned only by authoritative authenticated-person/scope middleware. Never wire input. */
export interface ConnectionContext {
  accountId: string; personId: string; bindingId: string; bindingRevision: number; bindingExpiresAt: number;
  scope: ScopeBinding; currentAgentIds: readonly string[]; botAgentId?: string; botAuthenticationRevision?: string;
}
const base = { schemaVersion: z.literal(1), id: idSchema, partitionId: idSchema, revision, createdAt: integer,
  updatedAt: integer, retentionUntil: integer };
const scoped = { ...base, ownerAccountId: idSchema, ownerPersonId: idSchema, scope: scopeSchema };
export const providerAccountSchema = z.object({ ...scoped, providerId: idSchema, issuer: z.string().url().max(500),
  providerSubject: idSchema, providerTenantId: idSchema, displayLabel: label, status: z.enum(['active', 'revoked']), identityEvidence: z.literal('unavailable').optional() }).strict();
export type ProviderAccountRecord = z.infer<typeof providerAccountSchema>;
const legacyConnectionSchema = z.object({ ...scoped, providerId: idSchema, displayLabel: label,
  providerAccountId: idSchema.nullable(), adapterId: idSchema, adapterVersion: idSchema,
  catalogDigest: idSchema, endpointProfileId: idSchema, providerScopes: z.array(idSchema).max(100),
  lifecycle: z.enum(['pending', 'connected', 'paused', 'revoked', 'deleted']), revocationEpoch: integer,
  health: z.enum(['unknown', 'healthy', 'degraded', 'reauth_required', 'scope_required', 'policy_blocked', 'unavailable']),
  checkedAt: integer.nullable() }).strict();
const agentConnectionSchema = legacyConnectionSchema.extend({ schemaVersion: z.literal(2), agentId: idSchema,
  mcp: z.object({ canonicalResourceUri: z.string().max(2000), catalog: mcpCatalogSnapshotSchema.nullable() }).strict().optional(),
}).superRefine((value, context) => {
  if ((value.providerId === 'remote_mcp') !== !!value.mcp) context.addIssue({ code: 'custom', message: 'MCP metadata/provider mismatch' });
  if (value.mcp) {
    try { if (canonicalMcpUrl(value.mcp.canonicalResourceUri) !== value.mcp.canonicalResourceUri || value.mcp.catalog && value.mcp.catalog.resource !== value.mcp.canonicalResourceUri) throw new Error(); }
    catch { context.addIssue({ code: 'custom', message: 'MCP resource binding mismatch' }); }
  }
});
export const connectionSchema = z.discriminatedUnion('schemaVersion', [legacyConnectionSchema, agentConnectionSchema]);
export type ConnectionRecord = z.infer<typeof connectionSchema>;
/** Legacy connections stay unbound; no automatic assignment or credential reuse. */
export const connectionAgentId = (connection: { id: string; agentId?: string }): string | undefined => connection.agentId;
export const grantSchema = z.object({ ...scoped, connectionId: idSchema, agentId: idSchema, toolIds: ids,
  resourceIds: ids, destinationIds: ids, effects: z.array(z.enum(EFFECTS)).min(1).max(6),
  purpose: z.literal('explicit.connection_task'), purposeVersion: z.literal(1),
  connectionRevision: revision, connectionEpoch: integer, catalogDigest: idSchema,
  grantorPersonId: idSchema, bindingRevision: revision, expiresAt: integer,
  status: z.enum(['active', 'revoked']), revocationEpoch: integer, maxCalls: integer.min(1).max(1000),
  callsReserved: integer, maxBytes: integer.min(1).max(10_000_000) }).strict();
export type ConnectionGrantRecord = z.infer<typeof grantSchema>;
export const sourceLabelSchema = z.object({ ...scoped, connectionId: idSchema, connectionEpoch: integer,
  grantId: idSchema, grantRevision: revision, resourceId: idSchema, resourceRevision: idSchema,
  allowedAgentIds: ids, allowedPersonIds: ids, allowedDestinationIds: ids,
  allowedPurposes: z.array(z.enum(['explicit.connection_task', 'explicit.memory_request'])).min(1).max(2),
  sensitivity: z.enum(['private', 'restricted']), expiresAt: integer,
  persist: z.boolean(), status: z.enum(['active', 'suppressed']), parentSourceIds: z.array(idSchema).max(100) }).strict();
export type SourceLabel = z.infer<typeof sourceLabelSchema>;
export const payloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retained'), argumentsRef: idSchema, revision }).strict(),
  z.object({ kind: z.literal('ephemeral'), ephemeralLeaseId: idSchema, expiresAt: integer }).strict(),
]);
export type OperationPayload = z.infer<typeof payloadSchema>;
export const operationStates = ['needs_approval', 'authorized', 'queued', 'sending', 'committed', 'verified', 'failed', 'cancelled', 'expired', 'outcome_unknown'] as const;
export type OperationState = typeof operationStates[number];
export const operationSchema = z.object({ ...scoped, requestId: idSchema, idempotencyKey: idSchema,
  connectionId: idSchema, grantId: idSchema, grantRevision: revision, connectionRevision: revision, connectionEpoch: integer,
  agentId: idSchema, toolId: idSchema, toolVersion: idSchema, adapterId: idSchema, adapterVersion: idSchema,
  catalogDigest: idSchema, schemaDigest: idSchema, effect: z.enum(EFFECTS),
  retryClass: z.enum(['safe_read', 'provider_idempotent', 'reconcile_only']),
  resourceIds: ids, destinationId: idSchema, expectedTargetRevision: idSchema.nullable(),
  payload: payloadSchema, inputDigest: idSchema, proposalDigest: idSchema,
  sourceIds: z.array(idSchema).max(100), sourceRevisions: z.array(idSchema).max(100),
  bindingRevision: revision, policyVersion: z.literal(CONNECTIONS_POLICY_VERSION),
  state: z.enum(operationStates), approvalId: idSchema.nullable(), deadlineAt: integer,
  leaseOwner: idSchema.nullable(), leaseUntil: integer.nullable(), fence: integer,
  dispatchedAt: integer.nullable(), completedAt: integer.nullable(), cancellationRequestedAt: integer.nullable(),
  providerReceiptRef: idSchema.nullable(), safeReason: idSchema.nullable(),
  workflowId: idSchema.optional(), workflowRevision: revision.optional(), occurrenceId: idSchema.optional() }).strict();
export type OperationRecord = z.infer<typeof operationSchema>;
export const approvalSchema = z.object({ ...scoped, operationId: idSchema, proposalDigest: idSchema,
  approverPersonId: idSchema, bindingRevision: revision, expiresAt: integer, consumedAt: integer.nullable(), nonce: idSchema }).strict();
export type ApprovalRecord = z.infer<typeof approvalSchema>;
export const payloadRecordSchema = z.object({ ...scoped, operationId: idSchema, arguments: z.record(z.string(), z.unknown()),
  inputDigest: idSchema, sourceIds: z.array(idSchema).max(100), expiresAt: integer }).strict();
export type PayloadRecord = z.infer<typeof payloadRecordSchema>;
export const outboxSchema = z.object({ ...scoped, operationId: idSchema.nullable(),
  kind: z.enum(['dispatch', 'invalidate', 'purge']), status: z.enum(['pending', 'claimed', 'done']),
  connectionId: idSchema, sourceIds: z.array(idSchema).max(100), availableAt: integer }).strict();
export type OutboxRecord = z.infer<typeof outboxSchema>;
export const tombstoneSchema = z.object({ ...scoped, connectionId: idSchema, sourceId: idSchema.nullable(),
  revocationEpoch: integer, reason: z.enum(['disconnect', 'grant_revoked', 'source_deleted']),
  providerRevocation: z.enum(['not_requested', 'pending', 'verified']), purge: z.enum(['pending', 'complete']) }).strict();
export type TombstoneRecord = z.infer<typeof tombstoneSchema>;
export const attemptSchema = z.object({ ...scoped, operationId: idSchema, fence: revision,
  phase: z.enum(['claimed', 'dispatched', 'committed', 'verified', 'failed', 'outcome_unknown', 'cancelled']),
  providerReceiptRef: idSchema.nullable() }).strict();
export type AttemptRecord = z.infer<typeof attemptSchema>;
export const auditSchema = z.object({ ...scoped, event: idSchema, subjectId: idSchema, operationId: idSchema.nullable() }).strict();
export type AuditRecord = z.infer<typeof auditSchema>;
export const subscriptionSchema = z.object({ ...scoped, connectionId: idSchema, providerId: z.enum(['github', 'slack']),
  providerTenantId: idSchema, nativeResourceId: idSchema, resourceId: idSchema,
  eventTypes: z.array(idSchema).min(1).max(10), secretRef: idSchema, secretVersion: revision,
  status: z.enum(['active', 'paused', 'revoked']), expiresAt: integer }).strict();
export type ConnectionSubscription = z.infer<typeof subscriptionSchema>;
export const eventInboxSchema = z.object({ ...scoped, subscriptionId: idSchema, connectionId: idSchema,
  providerId: z.enum(['github', 'slack']), providerEventId: idSchema, payloadDigest: idSchema,
  safeType: idSchema, providerTenantId: idSchema, nativeResourceId: idSchema, occurredAt: integer, receivedAt: integer,
  status: z.enum(['pending', 'processed', 'ignored']), safeReason: idSchema.nullable() }).strict();
export type ConnectionEvent = z.infer<typeof eventInboxSchema>;
const readStepSchema = z.object({ toolId: idSchema, toolVersion: idSchema, catalogDigest: idSchema, schemaDigest: idSchema,
  arguments: z.record(z.string(), z.unknown()), resourceIds: ids }).strict();
export const workflowScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), minutes: integer.min(15).max(10_080) }).strict(),
  z.object({ kind: z.literal('daily'), localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) }).strict(),
  z.object({ kind: z.literal('event'), subscriptionId: idSchema }).strict(),
]);
export type WorkflowSchedule = z.infer<typeof workflowScheduleSchema>;
export const workflowSchema = z.object({ ...scoped, name: label, agentId: idSchema, connectionId: idSchema,
  grantId: idSchema, grantRevision: revision, connectionRevision: revision, bindingRevision: revision,
  skillId: idSchema, skillVersion: idSchema, steps: z.array(readStepSchema).min(1).max(5),
  schedule: workflowScheduleSchema, timezone: z.string().min(1).max(100),
  quietHours: z.object({ startHour: integer.max(23), endHour: integer.max(23) }).strict().nullable(),
  expiresAt: integer, maxRuns: integer.min(1).max(1000), maxCalls: integer.min(1).max(1000),
  runsReserved: integer, callsReserved: integer, status: z.enum(['draft', 'active', 'paused', 'expired']),
  reviewDigest: idSchema, reviewedByPersonId: idSchema.nullable(), reviewedAt: integer.nullable(), lastEvaluatedAt: integer }).strict();
export type ConnectionWorkflow = z.infer<typeof workflowSchema>;
export const occurrenceSchema = z.object({ ...scoped, workflowId: idSchema, occurrenceKey: idSchema, slotAt: integer,
  eventId: idSchema.nullable(), operationIds: z.array(idSchema).max(5),
  state: z.enum(['reserved', 'running', 'complete', 'failed', 'outcome_unknown', 'skipped']),
  safeReason: idSchema.nullable(), leaseOwner: idSchema.nullable(), leaseUntil: integer.nullable(), fence: integer,
  completedAt: integer.nullable() }).strict();
export type WorkflowOccurrence = z.infer<typeof occurrenceSchema>;
export const recordSchemas = { providerAccounts: providerAccountSchema, connections: connectionSchema, grants: grantSchema,
  sources: sourceLabelSchema, operations: operationSchema, approvals: approvalSchema, payloads: payloadRecordSchema,
  outbox: outboxSchema, tombstones: tombstoneSchema, attempts: attemptSchema, audits: auditSchema,
  subscriptions: subscriptionSchema, eventInbox: eventInboxSchema, workflows: workflowSchema, occurrences: occurrenceSchema };
export type RecordMap = { [K in keyof typeof recordSchemas]: z.infer<typeof recordSchemas[K]> };
export type RecordCollection = keyof RecordMap;
export type ConnectionsRecords = { [K in RecordCollection]: RecordMap[K][] };
export interface ReviewedTool {
  id: string; version: string; providerId: string; adapterId: string; adapterVersion: string;
  catalogDigest: string; schemaDigest: string; effect: Effect;
  retryClass: 'safe_read' | 'provider_idempotent' | 'reconcile_only';
  maxInputBytes: number; maxOutputBytes: number; timeoutMs: number;
  resourceIds: readonly string[]; destinationIds: readonly string[];
}
export interface ConnectionsCatalog {
  get(toolId: string): ReviewedTool | undefined;
  validateArguments(toolId: string, value: unknown): Record<string, unknown>;
  provider(providerId: string): { adapterId: string; adapterVersion: string; catalogDigest: string; endpointProfileId: string } | undefined;
  /** Code-owned resource mapping; never model/client authority. */
  mapResources(toolId: string, args: Record<string, unknown>): readonly string[];
}
export const listInputSchema = z.object({ space, agentId: idSchema.optional() }).strict();
export const enrollmentInputSchema = z.object({ space, agentId: idSchema.optional(), providerId: idSchema, displayLabel: label }).strict();
export const grantInputSchema = z.object({ space, connectionId: idSchema, expectedRevision: revision,
  agentId: idSchema, toolIds: ids, resourceIds: ids, destinationIds: ids, effects: z.array(z.enum(EFFECTS)).min(1).max(6),
  expiresAt: integer, maxCalls: integer.min(1).max(1000), maxBytes: integer.min(1).max(10_000_000) }).strict();
export const revokeInputSchema = z.object({ space, connectionId: idSchema, expectedRevision: revision,
  grantId: idSchema.optional(), expectedGrantRevision: revision.optional() }).strict().refine(v => Boolean(v.grantId) === Boolean(v.expectedGrantRevision), 'Grant revision required');
export const proposeInputSchema = z.object({ space, requestId: idSchema, idempotencyKey: idSchema, connectionId: idSchema,
  grantId: idSchema, agentId: idSchema, toolId: idSchema, arguments: z.record(z.string(), z.unknown()),
  destinationId: idSchema, expectedTargetRevision: idSchema.nullable(), sourceIds: z.array(idSchema).max(100),
  retention: z.enum(['retained', 'ephemeral']), deadlineAt: integer }).strict();
export const approveInputSchema = z.object({ space, operationId: idSchema, expectedRevision: revision, proposalDigest: idSchema }).strict();
export const cancelInputSchema = z.object({ space, operationId: idSchema, expectedRevision: revision }).strict();
export type EnrollmentInput = z.infer<typeof enrollmentInputSchema>;
export type GrantInput = z.infer<typeof grantInputSchema>;
export type ProposeInput = z.infer<typeof proposeInputSchema>;
/** Explicit allowlist: credential handles, payloads, provider subjects and source labels never enter client views. */
export type ConnectionView = Pick<ConnectionRecord, 'id' | 'providerId' | 'displayLabel' | 'revision' | 'lifecycle' | 'health' | 'checkedAt' | 'revocationEpoch'> & { agentId?: string; mcp?: { canonicalResourceUri: string; catalog: McpCatalogSnapshot | null } };
export interface OperationReceipt {
  schemaVersion: 1; operationId: string; requestId: string; revision: number; state: OperationState;
  effect: Effect; toolId: string; agentId: string; proposalDigest: string; resourceIds: string[];
  audiencePersonIds: string[]; destinationId: string; expectedTargetRevision: string | null;
  deadlineAt: number; safeReason: string | null; providerReceiptRef: string | null;
}
export interface ConnectionsSnapshot { schemaVersion: 1; scope: ScopeBinding; connections: ConnectionView[];
  grants: ConnectionGrantRecord[]; operations: OperationReceipt[] }
