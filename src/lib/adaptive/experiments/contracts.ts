import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative().safe();
const revision = z.number().int().positive().safe();
export const EXPERIMENT_VERSION = 'vox-controlled-experiments-v1' as const;
export const densitySchema = z.enum(['comfortable', 'compact']);
/** Browser contract: no assignment identity, source text, or authority claims. */
export interface ResponsePresentation { density: 'compact' | 'comfortable'; receipt: string }
export const experimentExposureInputSchema = z.object({ space: z.enum(['work', 'personal']), agentId: id, receipt: hash }).strict();
export type ExperimentExposureInput = z.infer<typeof experimentExposureInputSchema>;
export const experimentScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('private_person'), tenantId: id, space: z.enum(['work', 'personal']), personId: id }).strict(),
  z.object({ kind: z.literal('shared_container'), tenantId: id, space: z.enum(['work', 'personal']), containerId: id,
    containerKind: z.enum(['selected', 'group']), recipients: z.array(id).min(2).max(100) }).strict(),
]);
export type ExperimentScope = z.infer<typeof experimentScopeSchema>;
export const experimentConfigSchema = z.object({ schemaVersion: z.literal(1), id, assignmentVersion: revision,
  assignmentKind: z.enum(['private_person', 'shared_container']), salt: hash,
  baselineArtifact: hash, candidateArtifact: hash,
  candidateBasisPoints: z.number().int().min(1).max(9999),
  candidateDensity: z.literal('compact'), baselineDensity: z.literal('comfortable'),
  startsAt: time, expiresAt: time,
  review: z.object({ owner: id, reviewer: id, reference: id, reviewedAt: time, offlineEvidence: id, shadowEvidence: id }).strict(),
  retention: z.object({ policyVersion: id, approvalReference: id, retainUntil: time }).strict(),
  stoppingRules: z.object({ maxAssignments: z.number().int().min(1).max(1000), maxExposures: z.number().int().min(1).max(2000),
    maxFailures: z.number().int().min(1).max(20), successMetric: z.literal('client_reported_readability'), guardrail: z.literal('presentation_failure') }).strict(),
}).strict().superRefine((c, ctx) => {
  if (c.review.owner === c.review.reviewer || c.review.reviewedAt > c.startsAt || c.startsAt >= c.expiresAt ||
      c.retention.retainUntil < c.expiresAt || c.baselineArtifact === c.candidateArtifact)
    ctx.addIssue({ code: 'custom', message: 'Invalid reviewed experiment configuration' });
});
export type ExperimentConfig = z.infer<typeof experimentConfigSchema>;
export const experimentPhaseSchema = z.enum(['off', 'offline', 'shadow', 'pilot', 'killed']);
export type ExperimentPhase = z.infer<typeof experimentPhaseSchema>;
const definition = z.object({ config: experimentConfigSchema, revision, phase: experimentPhaseSchema, failures: time,
  stopReason: z.enum(['manual', 'failure_guardrail', 'assignment_limit', 'exposure_limit', 'expired']).optional() }).strict();
const assignment = z.object({ id: hash, experimentId: id, assignmentVersion: revision, unit: hash,
  variant: z.enum(['control', 'candidate']), scopeRevision: hash, assignedAt: time }).strict();
const source = z.object({ id: hash, revision }).strict();
export type ExperimentSource = z.infer<typeof source>;
const derived = z.object({ id: hash, experimentId: id, assignmentVersion: revision, assignmentId: hash, unit: hash,
  source, configRevision: revision, authorityRevision: hash, scopeRevision: hash, variant: z.enum(['control', 'candidate']), density: densitySchema,
  state: z.enum(['active', 'quarantined']), createdAt: time, expiresAt: time }).strict();
const exposure = z.object({ id: hash, derivedId: hash, experimentId: id, assignmentVersion: revision, assignmentId: hash,
  unit: hash, variant: z.enum(['control', 'candidate']), occurredAt: time, trust: z.literal('client_unverified'),
  surface: z.literal('text_rendered'), configRevision: revision }).strict();
export const experimentDocumentSchema = z.object({ schemaVersion: z.literal(1), version: z.literal(EXPERIMENT_VERSION), observedAt: time,
  definitions: z.array(definition).max(50), assignments: z.array(assignment).max(1000), derived: z.array(derived).max(2000),
  exposures: z.array(exposure).max(2000),
  /** Irreversible within this ledger: neither rollback nor reinstall may remove these. */
  tombstones: z.array(z.object({ id: hash, kind: z.enum(['source_deleted', 'version_killed', 'scope_suppressed']), at: time }).strict()).max(3000),
}).strict();
export type ExperimentDocument = z.infer<typeof experimentDocumentSchema>;
export const emptyExperimentDocument = (): ExperimentDocument => ({ schemaVersion: 1, version: EXPERIMENT_VERSION, observedAt: 0,
  definitions: [], assignments: [], derived: [], exposures: [], tombstones: [] });

/** Authenticated person's minimized management export; internal unit hashes,
 * authority fingerprints and effect receipts never enter the browser export. */
export const experimentScopeExportSchema = z.object({ schemaVersion: z.literal(1),
  assignments: z.array(assignment.pick({ experimentId: true, assignmentVersion: true, variant: true, assignedAt: true })).max(1000),
  derived: z.array(derived.pick({ experimentId: true, variant: true, density: true, state: true, createdAt: true, expiresAt: true })).max(2000),
  exposures: z.array(exposure.pick({ experimentId: true, assignmentVersion: true, variant: true, occurredAt: true, trust: true, surface: true, configRevision: true })).max(2000),
  suppressed: z.boolean(),
}).strict();
export type ExperimentScopeExport = z.infer<typeof experimentScopeExportSchema>;
