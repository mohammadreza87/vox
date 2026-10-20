import { z } from 'zod';
export const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const reference = z.uuidv4();
export const spaceSchema = z.enum(['work', 'personal']);
export const kindSchema = z.enum(['access_export', 'correction', 'erasure', 'restriction', 'objection', 'portability', 'withdrawal']);
export const stateSchema = z.enum(['received', 'operator_review', 'awaiting_requester', 'operator_action_pending', 'local_export_prepared', 'closed_unfulfilled']);
export const reasonSchema = z.enum(['review_pending', 'supported_scope_only', 'requester_action_required', 'outside_supported_scope', 'requester_withdrew', 'duplicate_request', 'unable_to_verify', 'service_unavailable']);
export const deadlineSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('reviewed_policy_unavailable'), dueAt: z.null(), reason: z.enum(['policy_missing', 'policy_expired', 'jurisdiction_unresolved', 'no_matching_rule']) }).strict(),
  z.object({ state: z.literal('scheduled'), dueAt: integer, policyId: z.string().min(1).max(100), policyRevision: integer.positive(), ruleId: z.string().min(1).max(100), anchorAt: integer }).strict(),
]);
export const coverageSchema = z.object({ localAccount: z.enum(['not_started', 'export_prepared']), shared: z.enum(['not_started', 'currently_authorized_published_only']), providers: z.literal('unsupported'), backups: z.literal('unsupported'), guests: z.literal('unsupported'), deletion: z.literal('not_implemented'), formalRestriction: z.literal('not_implemented') }).strict();
export const policyBindingSchema = z.object({ id: z.string().min(1).max(100), revision: integer.positive(), copyVersion: z.string().min(1).max(100) }).strict();
export const localExportSchema = z.object({ preparedAt: integer, accountRevision: integer, scope: z.literal('authorized_local_account_projection'), delivery: z.literal('unverified') }).strict();
export const auditSchema = z.object({ seq: integer.positive(), at: integer, action: z.enum(['request_received', 'review_started', 'requester_action_requested', 'operator_pending', 'local_export_prepared', 'request_closed']), actor: z.enum(['requester', 'privacy_operator', 'service']), actorRef: z.string().regex(/^[a-f0-9]{64}$/), from: stateSchema.nullable(), to: stateSchema, reasonCode: reasonSchema.optional(), policyRevision: integer.positive() }).strict();
export const requestSchema = z.object({ version: z.literal(1), requestId: reference, accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/), space: spaceSchema, kind: kindSchema, revision: integer.positive(), createdAt: integer, updatedAt: integer, localeAtSubmission: z.enum(['en', 'fa']), intakePolicy: policyBindingSchema, requester: z.object({ assurance: z.literal('signed_telegram_account'), personVerification: z.literal('not_established') }).strict(), state: stateSchema, reasonCode: reasonSchema.optional(), deadline: deadlineSchema, coverage: coverageSchema, localExport: localExportSchema.optional(), retention: z.object({ policyId: z.string().min(1).max(100), policyRevision: integer.positive(), reviewOrExpiryAt: integer }).strict(), audit: z.array(auditSchema).min(1).max(32) }).strict();
export const ledgerSchema = z.object({ version: z.literal(1), accountId: requestSchema.shape.accountId, revision: integer.positive(), observedServerTime: integer, requests: z.array(requestSchema).max(100), commandReceipts: z.array(z.object({ eventId: reference, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestId: reference, resultingRequestRevision: integer.positive(), action: z.string().min(1).max(50), recordedAt: integer, retainUntil: integer }).strict()).max(128) }).strict();
export const createInputSchema = z.object({ version: z.literal(1), eventId: reference, space: spaceSchema, kind: kindSchema, locale: z.enum(['en', 'fa']), expectedIntakePolicyRevision: integer.positive() }).strict();
export const requesterActionSchema = z.object({ version: z.literal(1), eventId: reference, expectedRevision: integer.positive(), action: z.enum(['prepare_local_export', 'withdraw_request']) }).strict();
export const operatorActionSchema = z.object({ version: z.literal(1), eventId: reference, expectedRevision: integer.positive(), action: z.enum(['begin_review', 'request_requester_action', 'mark_operator_pending', 'close_unfulfilled']), reasonCode: reasonSchema, operationHandle: z.string().min(1).max(2048) }).strict();
export type RequestRecord = z.infer<typeof requestSchema>;
export type AccountLedger = z.infer<typeof ledgerSchema>;
export type RightsSpace = z.infer<typeof spaceSchema>;
export type CreateInput = z.infer<typeof createInputSchema>;
export type RequesterAction = z.infer<typeof requesterActionSchema>;
export type OperatorAction = z.infer<typeof operatorActionSchema>;
export type RightsRequestView = Omit<RequestRecord, 'accountId' | 'audit'> & { retentionReviewRequired: boolean };
export type RightsOperationView = Pick<RightsRequestView, 'version' | 'requestId' | 'space' | 'kind' | 'revision' | 'createdAt' | 'updatedAt' | 'state' | 'reasonCode' | 'deadline' | 'coverage' | 'retentionReviewRequired'> & { accountRef: string; operationHandle: string; audit: Array<Omit<RequestRecord['audit'][number], 'actorRef'>> };
export interface RightsSnapshot { supportedKinds: Array<CreateInput['kind']>; available: boolean; policyStatus: 'available' | 'unavailable'; intakePolicy?: z.infer<typeof policyBindingSchema>; requests: RightsRequestView[]; supportContact: 'info@joyixir.com' }
export interface RightsMutation { replayed: boolean; request: RightsRequestView; policyStatus: 'available' | 'unavailable' }
export interface RightsOperations { requests: RightsOperationView[]; nextCursor?: string; policyStatus: 'available' | 'unavailable' }
