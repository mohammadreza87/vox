import { z } from 'zod';
import { approvalSchema, findingSchema, identifier, proposalSchema, protectedEvaluationSchema, sha256, timestamp } from '../contracts';
import { improvementCandidateSchema } from '../index';
import { manifestSchema, protocolReceiptSchema, protocolReservationSchema } from '../evaluation/contracts';
import { caseRecordSchema, envelopeSchema, sidecarSchema } from './contracts';
const map = <T extends z.ZodType>(key: z.ZodString, value: T, limit = 5000) => z.record(key, value).refine(v => Object.keys(v).length <= limit);
const rollback = z.object({ candidateId: identifier, artifactDigest: sha256, restoredRevision: sha256, restoredArtifactDigest: sha256,
  scope: z.literal('local_rehearsal'), comparisonOnly: z.literal(true), productionMutation: z.literal(false), derivedState: z.literal('none_created'), rehearsedAt: timestamp,
  checks: z.object({ candidateOnCancelled: z.enum(['stop', 'continue']), restoredOnCancelled: z.enum(['stop', 'continue']) }).strict() }).strict();
const candidate = z.object({ candidate: improvementCandidateSchema, proposalId: identifier, authorKeyId: identifier,
  protocol: envelopeSchema(protocolReceiptSchema).optional(), protocolReservation: envelopeSchema(protocolReservationSchema).optional(),
  evaluation: envelopeSchema(protectedEvaluationSchema).optional(), approval: envelopeSchema(approvalSchema).optional() }).strict();
const base = { findings: map(identifier, findingSchema), proposals: map(identifier, proposalSchema), candidates: map(identifier, candidate),
  revokedLineages: z.array(sha256).max(5000), finalUses: z.array(sha256).max(5000), protocolUses: z.array(sha256).max(5000).optional(),
  rollbacks: map(identifier, rollback), operations: map(identifier, sha256) };
export const legacyStateSchema = z.object(base).strict().refine(s => Object.values(s.proposals).every(p => !p.learningCases) && Object.values(s.candidates).every(c => !c.candidate.learningCases));
export const corpusRecordSchema = z.object({ manifest: manifestSchema, sidecar: envelopeSchema(sidecarSchema) }).strict();
export const learningStateSchema = z.object({ ...base, protocolUses: z.array(sha256).max(5000), schemaVersion: z.literal(2), trustDigest: sha256,
  registryId: z.uuid(), generation: z.number().int().positive().safe(), observedAt: timestamp,
  learningCases: map(sha256, caseRecordSchema, 384), learningCorpora: map(sha256, corpusRecordSchema, 32), withdrawnCases: z.array(sha256).max(384) }).strict();
export type LearningState = z.infer<typeof learningStateSchema>;
