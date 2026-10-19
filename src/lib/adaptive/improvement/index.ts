import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40,64}$/);
export const improvementCandidateSchema = z.object({
  schemaVersion: z.literal(1), id, authorServiceId: id, baselineRevision: revision,
  candidateRevision: revision, artifactDigest: digest, problemCode: z.enum(['audio_cancellation', 'latency_regression', 'routing_quality', 'response_style']),
  evidenceIds: z.array(id).min(1).max(32), evidenceKind: z.enum(['synthetic', 'approved_aggregate']),
  changedPaths: z.array(z.string().min(1).max(256)).min(1).max(64),
  evaluatorVersion: id, datasetVersion: id, promotionPolicyVersion: id,
  rollbackRevision: revision, createdAt: z.number().int().nonnegative(),
}).strict().refine(c => c.baselineRevision !== c.candidateRevision && c.rollbackRevision === c.baselineRevision);
export type ImprovementCandidate = z.infer<typeof improvementCandidateSchema>;

const protectedPrefixes = ['.agents/', '.codex/', '.github/', 'e2e/', 'docs/implementation/',
  'src/lib/adaptive/', 'src/lib/studio/permissions', 'src/lib/studio/crypto', 'src/lib/studio/runtime',
  'src/lib/tireh/memory/visibility', 'src/test/', 'scripts/'];
/** A conservative initial candidate surface; policy changes require a separately
 * reviewed engineering task. This guard does not itself provide an OS/IAM sandbox. */
export function isCandidatePathAllowed(path: string): boolean {
  if (!/^src\/[A-Za-z0-9_./-]+\.(ts|tsx|css)$/.test(path) || path.split('/').some(part => part === '.' || part === '..' || part === '') ||
      /(?:^|\/)(?:__tests__|__fixtures__|evaluators?|fixtures?|judges?|polic(?:y|ies)|permissions?|auth|security)(?:\/|\.)/i.test(path) ||
      /\.(?:test|spec)\.[^.]+$/.test(path)) return false;
  return !protectedPrefixes.some(prefix => path.toLowerCase().startsWith(prefix.toLowerCase()));
}
export interface EvaluationReceipt {
  readonly candidateId: string;
  readonly candidateRevision: string;
  readonly artifactDigest: string;
  readonly evaluatorServiceId: string;
  readonly evaluatorVersion: string;
  readonly datasetVersion: string;
  readonly promotionPolicyVersion: string;
  readonly baselineRevision: string;
  readonly status: 'passed' | 'failed' | 'incomplete';
  readonly privacyFailures: number;
  readonly failedChecks: number;
  readonly skippedChecks: number;
  readonly testedAt: number;
}
const evaluationReceiptSchema = z.object({
  candidateId: id, candidateRevision: revision, artifactDigest: digest, evaluatorServiceId: id,
  evaluatorVersion: id, datasetVersion: id, promotionPolicyVersion: id, baselineRevision: revision,
  status: z.enum(['passed', 'failed', 'incomplete']), privacyFailures: z.number().int().nonnegative(),
  failedChecks: z.number().int().nonnegative(), skippedChecks: z.number().int().nonnegative(),
  testedAt: z.number().int().nonnegative().safe(),
}).strict();
export type PromotionReadiness = { ready: false; reason: 'invalid_candidate' | 'protected_path' | 'missing_evaluation' | 'untrusted_receipt' | 'self_evaluation' | 'version_mismatch' | 'failed' | 'human_release_required' } |
  { ready: true; candidateId: string; candidateRevision: string; artifactDigest: string; rollbackRevision: string };

/** Read-only gate; does not execute a patch, change a prompt, deploy or grant any
 * authority. Trusted attestation/human approval must come from protected stores,
 * never the candidate payload. Runtime credentials remain separate launch work. */
export async function assessPromotion(input: unknown, receipt: EvaluationReceipt | undefined, gate: {
  now: number;
  verifyReceipt: (receipt: EvaluationReceipt) => Promise<boolean>;
  humanApproved: (candidate: ImprovementCandidate) => Promise<boolean>;
}): Promise<PromotionReadiness> {
  const parsed = improvementCandidateSchema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(gate.now) || gate.now < 0 || parsed.data.createdAt > gate.now) return { ready: false, reason: 'invalid_candidate' };
  const candidate = parsed.data;
  if (candidate.changedPaths.some(path => !isCandidatePathAllowed(path))) return { ready: false, reason: 'protected_path' };
  if (!receipt) return { ready: false, reason: 'missing_evaluation' };
  if (!evaluationReceiptSchema.safeParse(receipt).success) return { ready: false, reason: 'untrusted_receipt' };
  if (receipt.evaluatorServiceId === candidate.authorServiceId) return { ready: false, reason: 'self_evaluation' };
  try { if (!await gate.verifyReceipt(receipt)) return { ready: false, reason: 'untrusted_receipt' }; }
  catch { return { ready: false, reason: 'untrusted_receipt' }; }
  if (receipt.candidateId !== candidate.id || receipt.candidateRevision !== candidate.candidateRevision ||
      receipt.artifactDigest !== candidate.artifactDigest || receipt.baselineRevision !== candidate.baselineRevision ||
      receipt.evaluatorVersion !== candidate.evaluatorVersion || receipt.datasetVersion !== candidate.datasetVersion ||
      receipt.promotionPolicyVersion !== candidate.promotionPolicyVersion || receipt.testedAt < candidate.createdAt || receipt.testedAt > gate.now) return { ready: false, reason: 'version_mismatch' };
  if (receipt.status !== 'passed' || receipt.privacyFailures !== 0 || receipt.failedChecks !== 0 || receipt.skippedChecks !== 0) return { ready: false, reason: 'failed' };
  try { if (!await gate.humanApproved(candidate)) return { ready: false, reason: 'human_release_required' }; }
  catch { return { ready: false, reason: 'human_release_required' }; }
  return { ready: true, candidateId: candidate.id, candidateRevision: candidate.candidateRevision,
    artifactDigest: candidate.artifactDigest, rollbackRevision: candidate.rollbackRevision };
}
