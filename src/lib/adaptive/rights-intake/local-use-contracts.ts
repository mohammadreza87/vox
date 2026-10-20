import { z } from 'zod';
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), positive = time.positive();
const uuid = z.uuidv4(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const localUsePurposeSchema = z.enum(['optional.personalization', 'optional.product_analytics']);
export const localUseScopeSchema = z.object({ space: z.enum(['work', 'personal']), purpose: localUsePurposeSchema }).strict();
export const localUsePolicyBindingSchema = z.object({ id: z.string().min(1).max(100), revision: positive, digest: hash, approvalReference: z.string().min(1).max(200), decisionReference: z.string().min(1).max(200) }).strict();
export const localUseNoticeBindingSchema = z.object({ version: z.string().min(1).max(100), digest: hash }).strict();
export const localUseIntentSchema = z.object({ version: z.literal(1), eventId: uuid, fingerprint: hash, intentDigest: hash, requestId: uuid, requestRevision: positive,
  scope: localUseScopeSchema, action: z.enum(['apply', 'release']), supersedesEventId: uuid.optional(), effectId: uuid, createdAt: time,
  expectedCanonicalRevision: positive, expectedUseEpoch: time, expectedEffectRevision: positive.optional(), expectedEffectDigest: hash.optional(),
  policy: localUsePolicyBindingSchema, notice: localUseNoticeBindingSchema, reviewAt: time, metadataRetainUntil: time, replayRetainUntil: time, receiptRetainUntil: time,
}).strict().superRefine((r, c) => {
  if (r.action === 'apply' && r.supersedesEventId !== undefined || (r.action === 'release') !== (r.expectedEffectRevision !== undefined && r.expectedEffectDigest !== undefined) || r.action === 'apply' && (r.expectedEffectRevision !== undefined || r.expectedEffectDigest !== undefined) ||
      [r.reviewAt, r.metadataRetainUntil, r.replayRetainUntil, r.receiptRetainUntil].some(t => t <= r.createdAt)) c.addIssue({ code: 'custom', message: 'Invalid local use intent' });
});
export const localUseAckSchema = z.object({ version: z.literal(1), eventId: uuid, intentDigest: hash, effectId: uuid, accountRevision: positive, useEpoch: time,
  effectRevision: positive, effectDigest: hash, effectState: z.enum(['active', 'released']), observedAt: time, recordedAt: time, retainUntil: time }).strict();
export const localUseLedgerSchema = z.object({ version: z.literal(1), intents: z.array(localUseIntentSchema).max(128), acknowledgements: z.array(localUseAckSchema).max(128) }).strict();
export const localUseStatusSchema = z.object({ version: z.literal(1), scope: localUseScopeSchema, selectedEffectId: uuid.optional(),
  technical: z.object({ current: z.enum(['active', 'released', 'not_applied', 'unknown']), reconciliation: z.enum(['none', 'pending', 'recorded', 'failed']) }).strict(),
  effectiveBlocked: z.boolean().nullable(), observedAt: time.nullable(), useEpoch: time.nullable(),
  reason: z.enum(['policy_unavailable', 'release_not_allowed', 'authority_unavailable', 'storage_unsupported', 'intent_pending', 'receipt_pending', 'scope_changed', 'capacity']).nullable(),
}).strict().superRefine((r, c) => {
  if ((r.technical.current === 'active' || r.technical.current === 'released') && !r.selectedEffectId || (r.technical.current === 'unknown' || r.technical.current === 'not_applied') && r.selectedEffectId !== undefined || (r.technical.current === 'unknown' ? r.effectiveBlocked !== null || r.observedAt !== null || r.useEpoch !== null : r.effectiveBlocked === null || r.observedAt === null || r.useEpoch === null || r.technical.current === 'active' && r.effectiveBlocked !== true))
    c.addIssue({ code: 'custom', message: 'Invalid local use proof' });
});
export const localUsePlanInputSchema = z.object({ version: z.literal(1), action: z.enum(['apply', 'release']), purpose: localUsePurposeSchema, effectId: uuid.optional(), locale: z.enum(['en', 'fa']) }).strict();
export const localUseActionInputSchema = z.object({ version: z.literal(1), eventId: uuid, action: z.enum(['apply', 'release']), planHandle: z.string().min(40).max(4096) }).strict();
export const localUsePlanSchema = z.object({ version: z.literal(1), action: z.enum(['apply', 'release']), scope: localUseScopeSchema, planHandle: z.string().min(40).max(4096), expiresAt: time }).strict();
export const localUseReconcileInputSchema = z.object({ version: z.literal(1), eventId: uuid, operationHandle: z.string().min(1).max(2048), commandEventId: uuid }).strict();
export type LocalUseIntent = z.infer<typeof localUseIntentSchema>;
export type LocalUseAck = z.infer<typeof localUseAckSchema>;
export type LocalUseStatus = z.infer<typeof localUseStatusSchema>;
export type LocalUseScope = z.infer<typeof localUseScopeSchema>;
export type LocalUsePlan = z.infer<typeof localUsePlanSchema>;
export type LocalUsePlanInput = z.infer<typeof localUsePlanInputSchema>;
export type LocalUseActionInput = z.infer<typeof localUseActionInputSchema>;

export const localUseViewSchema = z.object({ version: z.literal(1), status: localUseStatusSchema, availableActions: z.array(z.enum(['apply', 'release'])).max(2) }).strict().superRefine((v,c) => { if (new Set(v.availableActions).size !== v.availableActions.length || v.status.technical.current === 'unknown' && v.availableActions.length || v.availableActions.includes('release') && v.status.technical.current !== 'active' || v.availableActions.includes('apply') && v.status.technical.current === 'active' || v.status.technical.reconciliation === 'pending' && v.availableActions.includes('apply')) c.addIssue({code:'custom',message:'Invalid local use actions'}); });
export const localUseOperationSchema = z.object({ view: localUseViewSchema, commandEventId: z.uuidv4().optional(), reconcileAllowed: z.boolean() }).strict().superRefine((v,c) => { if (v.reconcileAllowed && !v.commandEventId) c.addIssue({code:'custom',message:'Missing command proof'}); });
