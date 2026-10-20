import { z } from 'zod';
const n = z.number().int().nonnegative().safe(), id = z.string().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.uuidv4();
const space = z.enum(['work', 'personal']);
export const erasureWitnessEntrySchema = z.object({ id, space, beforeRevision: n.positive(), beforeEpoch: n, beforeStatus: z.enum(['active', 'deleted']), afterRevision: n.positive(), afterEpoch: n, afterStatus: z.literal('deleted'), sourceRefsDigest: hash }).strict();
export const erasureWitnessSchema = z.array(erasureWitnessEntrySchema).min(1).max(300);
export type ErasureWitness = z.infer<typeof erasureWitnessSchema>;
export const localErasureOperationSchema = z.object({ version: z.literal(1), eventId: uuid, fingerprint: hash, requestId: uuid, requestRevision: n.positive(), space, memoryId: id,
  expectedCanonicalRevision: n.positive(), expectedBindingDigest: hash, witness: erasureWitnessSchema, witnessDigest: hash, createdAt: n, expiresAt: n, executionDeadline: n,
  policyDigest: hash, noticeDigest: hash, metadataRetainUntil: n, replayRetainUntil: n, receiptRetainUntil: n,
  acknowledgement: z.object({ effectRevision: n.positive(), observedAt: n, recordedAt: n, retainUntil: n }).strict().optional(),
}).strict();
export type LocalErasureOperation = z.infer<typeof localErasureOperationSchema>;
export const localErasureLedgerSchema = z.object({ version: z.literal(1), operations: z.array(localErasureOperationSchema).max(32) }).strict();
export const localErasureCoverageSchema = z.object({ canonicalSelectedNote: z.enum(['not_started', 'removed', 'unknown']), canonicalDependentNotes: z.enum(['not_started', 'no_active_payloads', 'unknown']),
  queuedDerivedUse: z.literal('unknown'), noncanonicalDerivativeCopies: z.literal('unverified'), noncanonicalDerivativeUse: z.literal('unverified'), sharedCopies: z.literal('not_implemented'),
  otherPrivateData: z.literal('outside_selected_scope'), storageFileRemnants: z.literal('unverified'), providers: z.literal('not_implemented'), backups: z.literal('not_implemented'), requestFulfillment: z.literal('not_established') }).strict();
export const localErasureStatusSchema = z.object({ operationRef: hash, technical: z.enum(['not_applied', 'note_content_removed', 'unknown']), recording: z.enum(['none', 'intent_recorded', 'acknowledgement_pending', 'recorded', 'failed']), observedAt: n.nullable(), effectRevision: n.positive().nullable(), coverage: localErasureCoverageSchema }).strict().superRefine((v,c) => {
  if (v.technical === 'unknown' ? v.observedAt !== null || v.effectRevision !== null || v.coverage.canonicalSelectedNote !== 'unknown' || v.coverage.canonicalDependentNotes !== 'unknown' : v.observedAt === null ||
    (v.technical === 'note_content_removed' ? v.effectRevision === null || v.coverage.canonicalSelectedNote !== 'removed' || v.coverage.canonicalDependentNotes !== 'no_active_payloads' : v.effectRevision !== null || v.coverage.canonicalSelectedNote !== 'not_started' || v.coverage.canonicalDependentNotes !== 'not_started')) c.addIssue({code:'custom',message:'Invalid erasure proof'});
});
export const localErasureViewSchema = z.object({ version: z.literal(1), requestId: uuid, requestRevision: n.positive(), space, available: z.boolean(), operations: z.array(localErasureStatusSchema).max(32) }).strict();
export const localErasureOperatorSchema = z.object({view:localErasureStatusSchema,commandEventId:uuid,reconcileAllowed:z.boolean()}).strict();
export const localErasurePlanInputSchema = z.object({ version: z.literal(1), eventId: uuid, expectedRequestRevision: n.positive(), space, memoryId: id, expectedMemoryRevision: n.positive(), locale: z.enum(['en','fa']) }).strict();
export const localErasurePlanSchema = z.object({ version: z.literal(1), requestId: uuid, space, eventId: uuid, memoryId: id, memoryRevision: n.positive(), planHandle: z.string().min(40).max(4096), expiresAt: n }).strict();
export const localErasureExecuteInputSchema = z.object({ version: z.literal(1), eventId: uuid, planHandle: z.string().min(40).max(4096) }).strict();
export const localErasureMutationSchema = localErasureViewSchema.extend({ replayed: z.boolean(), operationRef: hash }).strict();
export const localErasureReconcileInputSchema = z.object({ version: z.literal(1), eventId: uuid, operationHandle: z.string().min(1).max(2048), commandEventId: uuid }).strict();
export type LocalErasureView = z.infer<typeof localErasureViewSchema>;
export type LocalErasurePlan = z.infer<typeof localErasurePlanSchema>;
export type LocalErasureMutation = z.infer<typeof localErasureMutationSchema>;
export type LocalErasurePlanInput = z.infer<typeof localErasurePlanInputSchema>;
export type LocalErasureExecuteInput = z.infer<typeof localErasureExecuteInputSchema>;
