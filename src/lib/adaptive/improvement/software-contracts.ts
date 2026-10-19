import { z } from 'zod';
import { identifier, sha256, timestamp } from './contracts';

export const SOFTWARE_TARGET_PATH = 'src/lib/utils/sentence-detector.ts' as const;
const gitOid = z.string().regex(/^[a-f0-9]{40}$/);
export const softwareIdentitySchema = z.object({
  schemaVersion: z.literal(1), issueId: identifier,
  repositoryCommit: gitOid, repositoryTreeOid: gitOid,
  targetPath: z.literal(SOFTWARE_TARGET_PATH), baseBlobOid: gitOid,
  baseSourceDigest: sha256, patchDigest: sha256, resultSourceDigest: sha256, policyDigest: sha256,
}).strict();
export type SoftwareIdentity = z.infer<typeof softwareIdentitySchema>;
export const softwarePatchArtifactSchema = z.object({ identity: softwareIdentitySchema,
  authorMode: z.literal('deterministic_synthetic'), patch: z.string().min(1).max(32768),
}).strict();
export type SoftwarePatchArtifact = z.infer<typeof softwarePatchArtifactSchema>;
export interface FrozenSoftwareBase {
  repositoryCommit: string; repositoryTreeOid: string; targetPath: typeof SOFTWARE_TARGET_PATH;
  baseBlobOid: string; baseSourceDigest: string; source: string;
}
const sentence = z.object({ text: z.string().max(16384), index: z.number().int().nonnegative().max(256) }).strict();
export const softwareRunInputSchema = z.object({ schemaVersion: z.literal(1), operations: z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chunk'), text: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal('flush') }).strict(), z.object({ kind: z.literal('reset') }).strict(),
])).min(1).max(16) }).strict().refine(input => Buffer.byteLength(JSON.stringify(input)) <= 16384, 'input_byte_budget');
export type SoftwareRunInput = z.infer<typeof softwareRunInputSchema>;
export const softwareRunOutputSchema = z.object({ schemaVersion: z.literal(1), steps: z.array(z.object({
  sentences: z.array(sentence).max(256), flushed: sentence.nullable(), buffer: z.string().max(16384),
  currentIndex: z.number().int().nonnegative().max(256),
}).strict()).min(1).max(16) }).strict().refine(output => Buffer.byteLength(JSON.stringify(output)) <= 65536, 'output_byte_budget');
export type SoftwareRunOutput = z.infer<typeof softwareRunOutputSchema>;
export const softwareEvaluationSchema = z.object({ identity: softwareIdentitySchema,
  datasetDigest: sha256, evaluatorDigest: sha256, imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  checks: z.number().int().min(1).max(128), baselineFailures: z.number().int().min(0).max(128),
  candidateFailures: z.number().int().min(0).max(128), status: z.enum(['passed', 'failed', 'incomplete']), testedAt: timestamp,
  phase: z.literal('protected_final'), isolation: z.literal('docker_candidate_only_host_scored'),
}).strict().refine(value => value.baselineFailures <= value.checks && value.candidateFailures <= value.checks &&
  (value.status !== 'passed' || (value.candidateFailures === 0 && value.baselineFailures > 0)), 'invalid_evaluation_counts');
export type SoftwareEvaluation = z.infer<typeof softwareEvaluationSchema>;
