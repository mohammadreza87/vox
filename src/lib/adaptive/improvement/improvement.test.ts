import { describe, expect, it } from 'vitest';
import { assessPromotion, isCandidatePathAllowed, type EvaluationReceipt, type ImprovementCandidate } from './index';
const now = Date.UTC(2026, 9, 19, 12);
const candidate: ImprovementCandidate = { schemaVersion: 1, id: 'candidate1', authorServiceId: 'author1', baselineRevision: 'a'.repeat(40),
  candidateRevision: 'b'.repeat(40), artifactDigest: 'c'.repeat(64), problemCode: 'audio_cancellation', evidenceIds: ['repro1'], evidenceKind: 'synthetic',
  changedPaths: ['src/features/call/player.ts'], evaluatorVersion: 'eval1', datasetVersion: 'data1', promotionPolicyVersion: 'policy1', rollbackRevision: 'a'.repeat(40), createdAt: now - 100 };
const receipt: EvaluationReceipt = { candidateId: candidate.id, candidateRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest,
  evaluatorServiceId: 'evaluator1', evaluatorVersion: 'eval1', datasetVersion: 'data1', promotionPolicyVersion: 'policy1', baselineRevision: candidate.baselineRevision,
  status: 'passed', privacyFailures: 0, failedChecks: 0, skippedChecks: 0, testedAt: now };
const gate = { now, verifyReceipt: async () => true, humanApproved: async () => true };
describe('protected candidate gate', () => {
  it.each(['src/lib/adaptive/policy.ts', 'src/lib/studio/permissions.ts', 'src/test/judges.ts', 'src/a/../../policy.ts', '/src/features/a.ts', 'src/features/x.test.ts', '.github/workflows/release.yml', 'src/lib/auth/token.ts', 'src/lib/security/grants.ts'])('protects evaluator/policy/release paths: %s', path => {
    expect(isCandidatePathAllowed(path)).toBe(false);
  });
  it('returns readiness only for independent exact-candidate evidence and a human release approval', async () => {
    expect(await assessPromotion(candidate, receipt, gate)).toMatchObject({ ready: true, candidateRevision: candidate.candidateRevision, rollbackRevision: candidate.baselineRevision });
    expect(await assessPromotion(candidate, receipt, { ...gate, humanApproved: async () => false })).toEqual({ ready: false, reason: 'human_release_required' });
  });
  it('rejects absent, self-authored or untrusted receipts', async () => {
    expect(await assessPromotion(candidate, undefined, gate)).toMatchObject({ reason: 'missing_evaluation' });
    expect(await assessPromotion(candidate, { ...receipt, evaluatorServiceId: candidate.authorServiceId }, gate)).toMatchObject({ reason: 'self_evaluation' });
    expect(await assessPromotion(candidate, receipt, { ...gate, verifyReceipt: async () => false })).toMatchObject({ reason: 'untrusted_receipt' });
  });
  it('rejects candidate, dataset, policy, baseline and artifact mismatches', async () => {
    for (const change of [{ candidateRevision: 'd'.repeat(40) }, { artifactDigest: 'e'.repeat(64) }, { datasetVersion: 'other' }, { promotionPolicyVersion: 'other' }, { baselineRevision: 'f'.repeat(40) }]) {
      expect(await assessPromotion(candidate, { ...receipt, ...change }, gate)).toMatchObject({ reason: 'version_mismatch' });
    }
  });
  it('treats skipped/failed/privacy checks as failed acceptance', async () => {
    for (const change of [{ skippedChecks: 1 }, { privacyFailures: 1 }, { failedChecks: 1 }, { status: 'incomplete' as const }]) {
      expect(await assessPromotion(candidate, { ...receipt, ...change }, gate)).toMatchObject({ ready: false, reason: 'failed' });
    }
  });
});
