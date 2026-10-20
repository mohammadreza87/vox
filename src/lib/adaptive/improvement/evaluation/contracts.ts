import { z } from 'zod';
import { canonical, hash, identifier, sha256, timestamp } from '../contracts';
const count = z.number().int().nonnegative().max(128);
const money = z.number().int().nonnegative().safe();
export const scenarios = ['cancellation', 'active_continue', 'revoked_sharing', 'unknown_identity', 'notification_verified', 'notification_unknown'] as const;
export const actionSchema = z.enum(['stop', 'continue', 'deny', 'notify_verified', 'notify_unknown']);
export const caseInputSchema = z.object({ locale: z.enum(['en','fa','mixed']), text: z.string().min(1).max(512),
  cancelled: z.boolean(), identity: z.enum(['known','unknown']), sharing: z.enum(['none','active','revoked']), notification: z.enum(['none','verified','unknown']) }).strict();
const evaluationCaseSchemaBase = z.object({ id: sha256, taskId: sha256, personId: sha256, groupId: sha256.optional(), conversationId: sha256,
  occurredAt: timestamp, scenario: z.enum(scenarios), input: caseInputSchema, expected: actionSchema }).strict();
const validateCase = (c: z.infer<typeof evaluationCaseSchemaBase>, ctx: z.RefinementCtx) => {
  const expected = c.scenario === 'cancellation' ? 'stop' : c.scenario === 'active_continue' ? 'continue' : ['revoked_sharing','unknown_identity'].includes(c.scenario) ? 'deny' : c.scenario === 'notification_verified' ? 'notify_verified' : 'notify_unknown';
  // These fixtures exercise one declared policy condition at a time. Mixed
  // cancellation/identity/revocation conditions need a separately reviewed case
  // family; an outcome label cannot override a contradictory input flag.
  const known = c.input.identity === 'known', safeSharing = c.input.sharing !== 'revoked', noNotification = c.input.notification === 'none';
  const activeAuthority = !c.input.cancelled && known && safeSharing;
  const matches = c.scenario === 'cancellation' ? c.input.cancelled && known && safeSharing && noNotification
    : c.scenario === 'active_continue' ? activeAuthority && noNotification
    : c.scenario === 'revoked_sharing' ? !c.input.cancelled && known && c.input.sharing === 'revoked' && noNotification && !!c.groupId
    : c.scenario === 'unknown_identity' ? !c.input.cancelled && !known && safeSharing && noNotification
    : activeAuthority && c.input.notification === (c.scenario === 'notification_verified' ? 'verified' : 'unknown');
  if (c.expected !== expected || !matches) ctx.addIssue({ code: 'custom', message: 'scenario_policy_mismatch' });
};
export const evaluationCaseSchema = evaluationCaseSchemaBase.superRefine(validateCase);
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
export const corpusSchema = z.object({ schemaVersion: z.literal(1), provenance: z.literal('synthetic_only'),
  optimization: z.array(evaluationCaseSchema).min(1).max(128), validation: z.array(evaluationCaseSchema).min(1).max(128), final: z.array(evaluationCaseSchema).min(1).max(128) }).strict();
export type EvaluationCorpus = z.infer<typeof corpusSchema>;
const validWindow = (w: { startsAt: number; endsAt: number }) => w.startsAt < w.endsAt;
const windowSchema = z.object({ startsAt: timestamp, endsAt: timestamp }).strict().refine(validWindow);
export const scoringSchema = z.object({ version: z.literal('strict-synthetic-v1'), minimumCoverage: z.literal(1), minimumSuccessRate: z.number().min(0).max(1),
  minimumPairedSuccessGain: z.number().min(0).max(1), minimumQualityPerAssignedCase: z.number().min(0).max(1), maximumP95LatencyMs: z.number().finite().positive().max(60000),
  maximumCostPerSuccessMicrousd: money, deterministicFailuresAllowed: z.literal(0), privacyFailuresAllowed: z.literal(0),
  inference: z.literal('descriptive_synthetic_only') }).strict();
export const judgeSchema = z.object({ version: z.literal('deterministic-policy-v1'), calibration: z.literal('synthetic_only'), calibrationDigest: sha256 }).strict();
const manifestSchemaBase = z.object({ schemaVersion: z.literal(1), id: identifier, purpose: z.literal('product_improvement'), provenance: z.literal('synthetic_only'),
  reviewedAt: timestamp, expiresAt: timestamp, retention: z.object({ approvalReference: identifier, retainUntil: timestamp }).strict(),
  split: z.object({ policy: z.literal('disjoint_task_person_group_conversation_forward_time_v1'), optimization: windowSchema, validation: windowSchema, final: windowSchema }).strict(),
  counts: z.object({ optimization: count.positive(), validation: count.positive(), final: count.positive() }).strict(),
  digests: z.object({ corpus: sha256, optimization: sha256, validation: sha256, final: sha256, judge: sha256, scoring: sha256, runner: sha256, adapter: sha256 }).strict(),
  budget: z.object({ maxCases: count.positive(), maxCalls: z.number().int().positive().max(256), maxCostMicrousd: money, maxReportedLatencyMs: money, maxWallTimeMs: z.number().int().positive().max(60000) }).strict(),
  requiredScenarios: z.array(z.enum(scenarios)).length(scenarios.length), requiredLocales: z.array(z.enum(['en','fa','mixed'])).length(3),
  statistics: z.object({ unit: z.literal('person_or_exact_group'), method: z.literal('descriptive_only'), minimumIndependentUnits: z.number().int().positive().max(128), populationClaims: z.literal('not_authorized') }).strict(),
  judge: judgeSchema, scoring: scoringSchema,
}).strict();
const validateManifest = (m: z.infer<typeof manifestSchemaBase>, ctx: z.RefinementCtx) => {
  if (m.expiresAt <= m.reviewedAt || m.retention.retainUntil < m.expiresAt || m.split.optimization.endsAt > m.split.validation.startsAt || m.split.validation.endsAt > m.split.final.startsAt ||
      new Set(m.requiredScenarios).size !== scenarios.length || new Set(m.requiredLocales).size !== 3 || m.budget.maxCases < m.counts.final || m.budget.maxCalls < 2 * m.counts.final ||
      m.digests.judge !== hash(canonical(m.judge)) || m.digests.scoring !== hash(canonical(m.scoring))) ctx.addIssue({ code: 'custom', message: 'invalid_protocol_manifest' });
};
export const manifestSchema = manifestSchemaBase.superRefine(validateManifest);
export type EvaluationManifest = z.infer<typeof manifestSchema>;
export const adapterOutputSchema = z.object({ status: z.enum(['complete','invalid','refused','unavailable','skipped']), action: actionSchema.optional(),
  outcome: z.enum(['verified_success','verified_failure','unavailable']), privacyFailure: z.boolean(),
  latencyMs: z.number().finite().nonnegative().max(60000).nullable(), costMicrousd: money.nullable(), discardedCostMicrousd: money.nullable(),
  judgeScore: z.number().min(0).max(1).nullable() }).strict();
export type AdapterOutput = z.infer<typeof adapterOutputSchema>;
const metricsSchemaBase = z.object({ assigned: count.positive(), complete: count, invalid: count, refused: count, unavailable: count, skipped: count,
  successes: count, deterministicFailures: count, privacyFailures: count, coverage: z.number().min(0).max(1), successRate: z.number().min(0).max(1),
  p50LatencyMs: z.number().nonnegative().nullable(), p95LatencyMs: z.number().nonnegative().nullable(), latencyAvailable: count,
  totalCostMicrousd: money.nullable(), costAvailable: count, costPerSuccessMicrousd: z.number().nonnegative().nullable(), qualityPerAssignedCase: z.number().min(0).max(1), judgeAvailable: count,
}).strict();
const validateMetrics = (v: z.infer<typeof metricsSchemaBase>, ctx: z.RefinementCtx) => {
  if (v.complete + v.invalid + v.refused + v.unavailable + v.skipped !== v.assigned || v.successes > v.complete || v.coverage !== v.complete / v.assigned || v.successRate !== v.successes / v.assigned || v.latencyAvailable > v.assigned || v.costAvailable > v.assigned || v.judgeAvailable > v.assigned || v.deterministicFailures > v.complete || v.privacyFailures > v.assigned ||
      (v.costAvailable < v.assigned ? v.totalCostMicrousd !== null : v.totalCostMicrousd === null) || v.costPerSuccessMicrousd !== (v.totalCostMicrousd === null || v.successes === 0 ? null : v.totalCostMicrousd / v.successes) ||
      (v.latencyAvailable < v.assigned ? v.p50LatencyMs !== null || v.p95LatencyMs !== null : v.p50LatencyMs === null || v.p95LatencyMs === null || v.p50LatencyMs > v.p95LatencyMs))
    ctx.addIssue({ code: 'custom', message: 'invalid_metric_denominator' });
};
export const metricsSchema = metricsSchemaBase.superRefine(validateMetrics);
export type EvaluationMetrics = z.infer<typeof metricsSchema>;
export const protocolMetadataSchema = z.object({ manifestDigest: sha256, splitDigest: sha256, coverageDigest: sha256, reviewedAt: timestamp, expiresAt: timestamp, retentionApprovalReference: identifier, counts: manifestSchema.shape.counts }).strict();
const protocolReceiptSchemaBase = z.object({ schemaVersion: z.literal(1), evidence: z.literal('synthetic_local_preflight'), protocolDigest: sha256,
  candidateId: identifier, candidateRevision: sha256, artifactDigest: sha256, baselineRevision: sha256, baselineArtifactDigest: sha256,
  legacyDatasetDigest: sha256, candidateEvaluatorDigest: sha256, promotionPolicyDigest: sha256,
  protocolMetadata: protocolMetadataSchema, bindings: manifestSchema.shape.digests, evaluatorServiceId: identifier, testedAt: timestamp, retainUntil: timestamp,
  status: z.enum(['passed','failed','incomplete']), baseline: metricsSchema, candidate: metricsSchema,
  pairedSuccessGain: z.number().min(-1).max(1), calls: z.number().int().nonnegative().max(256),
  budget: manifestSchema.shape.budget,
}).strict();
const validateProtocolReceipt = (r: z.infer<typeof protocolReceiptSchemaBase>, ctx: z.RefinementCtx) => {
  if (r.protocolDigest !== hash(canonical({ protocolMetadata: r.protocolMetadata, bindings: r.bindings, budget: r.budget, retainUntil: r.retainUntil })) || r.testedAt < r.protocolMetadata.reviewedAt || r.testedAt >= r.protocolMetadata.expiresAt || r.baseline.assigned !== r.protocolMetadata.counts.final || r.retainUntil <= r.testedAt || r.baseline.assigned !== r.candidate.assigned || r.candidate.assigned > r.budget.maxCases || r.calls > r.budget.maxCalls || r.calls < r.baseline.assigned + r.candidate.assigned - r.baseline.skipped - r.candidate.skipped ||
      r.pairedSuccessGain !== r.candidate.successRate - r.baseline.successRate || r.status === 'passed' && (r.calls !== 2 * r.candidate.assigned || r.candidate.judgeAvailable !== r.candidate.assigned || r.baseline.judgeAvailable !== r.baseline.assigned || r.baseline.coverage !== 1 || r.candidate.coverage !== 1 || r.candidate.deterministicFailures !== 0 || r.candidate.privacyFailures !== 0 || r.candidate.costAvailable !== r.candidate.assigned || r.candidate.latencyAvailable !== r.candidate.assigned))
    ctx.addIssue({ code: 'custom', message: 'invalid_protocol_receipt' });
};
export const protocolReceiptSchema = protocolReceiptSchemaBase.superRefine(validateProtocolReceipt);
export type ProtocolReceipt = z.infer<typeof protocolReceiptSchema>;

/** Bind semantic refinements as well as JSON schema shape into the evaluator identity. */
export const PROTOCOL_SCHEMA_DIGEST = hash(canonical({ version: 1, rules: [validateCase,validateManifest,validateMetrics,validateProtocolReceipt,validWindow].map(fn => fn.toString()),
  schemas: [manifestSchema,evaluationCaseSchema,adapterOutputSchema,metricsSchema,protocolReceiptSchema].map(schema => schema.toJSONSchema()) }));

const protocolReservationBase = protocolReceiptSchemaBase.omit({ evidence: true, baseline: true, candidate: true, pairedSuccessGain: true, calls: true, status: true, testedAt: true }).extend({ reservedAt: timestamp }).strict();
const validateReservation = (r: z.infer<typeof protocolReservationBase>, ctx: z.RefinementCtx) => {
  if (r.protocolDigest !== hash(canonical({ protocolMetadata: r.protocolMetadata, bindings: r.bindings, budget: r.budget, retainUntil: r.retainUntil })) ||
    r.reservedAt < r.protocolMetadata.reviewedAt || r.reservedAt >= r.protocolMetadata.expiresAt || r.retainUntil <= r.reservedAt)
    ctx.addIssue({ code: 'custom', message: 'invalid_protocol_reservation' });
};
export const protocolReservationSchema = protocolReservationBase.superRefine(validateReservation);
export type ProtocolReservation = z.infer<typeof protocolReservationSchema>;

export const RESERVATION_SCHEMA_DIGEST = hash(canonical({ rule: validateReservation.toString(), schema: protocolReservationSchema.toJSONSchema() }));
