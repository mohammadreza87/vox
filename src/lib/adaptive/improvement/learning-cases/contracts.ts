import { z } from 'zod';
import { identifier, sha256, timestamp, findingSchema } from '../contracts';
import { scenarios, type EvaluationManifest } from '../evaluation/contracts';
export const learningCaseCommitmentSchema = z.object({ version: z.literal(1), lineageDigest: sha256 }).strict();
export type LearningCaseCommitment = z.infer<typeof learningCaseCommitmentSchema>;
declare const preparedLearningCases: unique symbol;
/** Nominal only: the workflow additionally requires its private runtime identity. */
export interface PreparedLearningCases { readonly [preparedLearningCases]: true }
export const fictionalUnits = Array.from({ length: 128 }, (_, i) => `fictional_${String(i).padStart(3, '0')}`) as [string, ...string[]];
export const recipeSchema = z.object({ version: z.literal(1), catalogDigest: sha256, findingId: identifier,
  findingImportOperationId: identifier, findingEnvelopeDigest: sha256, scenario: z.enum(scenarios), locale: z.enum(['en', 'fa', 'mixed']), unit: z.enum(fictionalUnits),
  occurredAt: timestamp, reviewedAt: timestamp, expiresAt: timestamp, retentionPolicyRef: identifier, retainUntil: timestamp,
}).strict().refine(r => r.occurredAt <= r.reviewedAt && r.reviewedAt < r.expiresAt && r.retainUntil >= r.expiresAt);
export type LearningCaseRecipe = z.infer<typeof recipeSchema>;
export const sidecarSchema = z.object({ version: z.literal(1), catalogDigest: sha256, corpusDigest: sha256,
  cases: z.array(z.object({ caseId: sha256, partition: z.enum(['optimization', 'validation', 'final']), ordinal: z.number().int().min(0).max(127), materializedDigest: sha256, caseRecordDigest: sha256 }).strict()).min(3).max(384),
  reviewedAt: timestamp, expiresAt: timestamp, retentionPolicyRef: identifier, retainUntil: timestamp,
}).strict().refine(s => s.reviewedAt < s.expiresAt && s.retainUntil >= s.expiresAt);
export type LearningCaseSidecar = z.infer<typeof sidecarSchema>;
export const envelopeSchema = <T extends z.ZodType>(payload: T) => z.object({ schemaVersion: z.literal(1), keyId: identifier,
  purpose: z.string().min(1).max(64), payload, signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(128) }).strict();
export const caseRecordSchema = z.object({ finding: envelopeSchema(findingSchema), review: envelopeSchema(recipeSchema) }).strict();
export const withdrawalSchema = z.object({ caseId: sha256, reviewedAt: timestamp }).strict();
export type LearningCasePreparation = { manifest: EvaluationManifest; sidecar: import('../contracts').Attestation<LearningCaseSidecar> };
