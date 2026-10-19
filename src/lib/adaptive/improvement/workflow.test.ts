import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attest, canonical, hash, type Authority, type RoutingArtifact, type TrustStore } from './contracts';
import { ImprovementWorkflow, type ProtectedEvaluation } from './workflow';
import { EVALUATOR_DIGEST, POLICY_DIGEST, evaluateIsolated, optimizeRouting } from './sandbox';
import type { ImprovementCandidate } from './index';
const roots: string[] = []; const now = 100000;
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'vox-improvement-test-')); roots.push(root);
  const trust: TrustStore = {}; const keys: Record<string, string> = {};
  for (const role of ['analyst', 'author', 'evaluator', 'human'] as Authority[]) { const pair = generateKeyPairSync('ed25519');
    trust[role] = { role, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }; keys[role] = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(); }
  const workflow = new ImprovementWorkflow({ root, trust, now: () => now });
  const baseline: RoutingArtifact = { schemaVersion: 1, kind: 'cancellation_routing', onCancelled: 'complete', onActive: 'continue' };
  const artifact: RoutingArtifact = { ...baseline, onCancelled: 'stop' };
  const dataset = { version: 'final1', cases: [{ cancelled: true, expected: 'stop' as const }, { cancelled: false, expected: 'continue' as const }] };
  const finding = { schemaVersion: 1 as const, id: 'finding1', kind: 'synthetic' as const, problemCode: 'audio_cancellation' as const,
    sourceDigest: hash('source'), lineageIds: [hash('lineage')], sampleCount: 10, failureCount: 3, purpose: 'product_improvement' as const, reviewedAt: now, expiresAt: now + 10000 };
  const sign = <T>(role: Authority, purpose: string, payload: T) => attest(role, keys[role], purpose, payload);
  const imported = sign('analyst', 'approved_finding', finding); await workflow.importFinding('import', imported);
  const proposal = { id: 'proposal1', findingId: finding.id, kind: 'routing_change' as const, hypothesis: 'cancelled_turn_should_stop' as const, expectedOutcome: 'zero_post_cancel_work' as const,
    baselineRevision: hash('source'), baselineArtifactDigest: hash(canonical(baseline)), createdAt: now, budget: { maxCandidates: 2, maxCases: 8 } };
  await workflow.proposeRouting('proposal', proposal);
  const candidate: ImprovementCandidate = { schemaVersion: 1, id: 'candidate1', authorServiceId: 'author', baselineRevision: proposal.baselineRevision, candidateRevision: hash(canonical(artifact)), artifactDigest: hash(canonical(artifact)),
    problemCode: 'audio_cancellation', evidenceIds: [finding.id], evidenceKind: 'synthetic', changedPaths: ['src/features/call/cancellation-routing.ts'], evaluatorVersion: EVALUATOR_DIGEST, datasetVersion: hash(canonical(dataset)),
    promotionPolicyVersion: POLICY_DIGEST, rollbackRevision: proposal.baselineRevision, createdAt: now };
  const registration = sign('author', 'candidate_artifact', { proposalId: proposal.id, candidate, artifact }); await workflow.registerCandidate('candidate', registration);
  const evaluation: ProtectedEvaluation = { receipt: { candidateId: candidate.id, candidateRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest, evaluatorServiceId: 'evaluator', evaluatorVersion: candidate.evaluatorVersion,
    datasetVersion: candidate.datasetVersion, promotionPolicyVersion: candidate.promotionPolicyVersion, baselineRevision: candidate.baselineRevision, status: 'passed', privacyFailures: 0, failedChecks: 0, skippedChecks: 0, testedAt: now },
    details: { sourceDigest: candidate.baselineRevision, artifactDigest: candidate.artifactDigest, baselineArtifactDigest: proposal.baselineArtifactDigest, datasetDigest: candidate.datasetVersion,
      evaluatorDigest: candidate.evaluatorVersion, imageDigest: `sha256:${hash('image')}`, policyDigest: candidate.promotionPolicyVersion, phase: 'protected_final', isolation: 'docker_network_none_readonly', checks: 2, baselineFailures: 1, candidateFailures: 0 } };
  const evaluated = sign('evaluator', 'protected_evaluation', evaluation);
  const approval = sign('human', 'release_review', { candidateId: candidate.id, artifactDigest: candidate.artifactDigest, evaluationDigest: hash(canonical(evaluated)), decision: 'approve' as const, approvedAt: now, expiresAt: now + 1000 });
  return { root, trust, keys, workflow, baseline, artifact, candidate, dataset, finding, imported, proposal, registration, evaluation, evaluated, approval, sign };
}
describe('durable improvement routing vertical slice', () => {
  it('survives restart and requires independent exact receipt and human approval before readiness/rollback', async () => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', s.evaluated);
    expect(await s.workflow.readiness(s.candidate.id)).toEqual({ ready: false, reason: 'human_release_required' });
    await s.workflow.approve('approval', s.approval);
    const restarted = new ImprovementWorkflow({ root: s.root, trust: s.trust, now: () => now });
    expect(await restarted.readiness(s.candidate.id)).toMatchObject({ ready: true });
    const rehearsal = await restarted.rollbackRehearsal('rollback', s.candidate.id, s.baseline);
    expect(rehearsal).toMatchObject({ scope: 'local_rehearsal', comparisonOnly: true, productionMutation: false,
      restoredArtifactDigest: hash(canonical(s.baseline)), checks: { candidateOnCancelled: 'stop', restoredOnCancelled: 'continue' } });
    expect(rehearsal.checks).not.toHaveProperty('candidateDisabled');
    expect(await restarted.report()).toMatchObject({ deployment: 'UNAVAILABLE', measuredProductionEffect: 'UNAVAILABLE', causalClaim: 'hypothesis_only' });
    expect(JSON.stringify(await restarted.listReviewQueue())).not.toContain('"cases":');
  });
  it('handles same-operation concurrency idempotently and rejects changed replay', async () => {
    const s = await setup(); const other = new ImprovementWorkflow({ root: s.root, trust: s.trust, now: () => now });
    await Promise.all([s.workflow.attachEvaluation('evaluation', s.evaluated), other.attachEvaluation('evaluation', s.evaluated)]);
    expect((await other.report()).auditEvents).toBe(4);
    await expect(other.proposeRouting('evaluation', s.proposal)).rejects.toThrow('idempotency_conflict');
  });
  it('repairs a registration interrupted before object commit without duplicate audit state', async () => {
    const s = await setup();
    await fs.unlink(join(s.root, 'objects', s.candidate.artifactDigest));
    const restarted = new ImprovementWorkflow({ root: s.root, trust: s.trust, now: () => now });
    await expect(restarted.readArtifact(s.candidate.id)).rejects.toThrow();
    await restarted.registerCandidate('candidate', s.registration);
    expect(await restarted.readArtifact(s.candidate.id)).toEqual(s.artifact);
    expect((await restarted.report()).auditEvents).toBe(3);
    expect(await fs.readdir(join(s.root, 'objects'))).toEqual([s.candidate.artifactDigest]);
    expect((await fs.stat(join(s.root, 'objects', s.candidate.artifactDigest))).mode & 0o777).toBe(0o400);
  });
  it('rejects fabricated logs and evaluator identity signed by the author key', async () => {
    const s = await setup();
    await expect(s.workflow.attachEvaluation('fake', attest('evaluator', s.keys.author, 'protected_evaluation', s.evaluation))).rejects.toThrow('untrusted_evaluation');
    await expect(s.workflow.attachEvaluation('fake', s.sign('author', 'protected_evaluation', s.evaluation))).rejects.toThrow('untrusted_evaluation');
    await expect(s.workflow.attachEvaluation('fake', { ...s.evaluated, payload: { ...s.evaluation, log: 'all tests passed' } } as never)).rejects.toThrow('untrusted_evaluation');
  });
  it('rejects reuse of cryptographic keys across authority roles', async () => {
    const s = await setup(); expect(() => new ImprovementWorkflow({ root: s.root, trust: { ...s.trust, human: { role: 'human', publicKey: s.trust.author.publicKey } } })).toThrow('distinct_ed25519');
  });
  it.each(['sourceDigest', 'datasetDigest', 'evaluatorDigest', 'policyDigest', 'baselineArtifactDigest'] as const)('binds exact %s', async field => {
    const s = await setup(); const evaluation = { ...s.evaluation, details: { ...s.evaluation.details, [field]: hash('tampered') } };
    await expect(s.workflow.attachEvaluation('mismatch', s.sign('evaluator', 'protected_evaluation', evaluation))).rejects.toThrow('evaluation_binding_mismatch');
  });
  it('cannot certify skipped checks, missing checks or false success', async () => {
    const s = await setup();
    for (const evaluation of [{ ...s.evaluation, receipt: { ...s.evaluation.receipt, skippedChecks: 1 } },
      { ...s.evaluation, details: { ...s.evaluation.details, candidateFailures: 1 } },
      { ...s.evaluation, details: { ...s.evaluation.details, checks: 0 } }]) {
      await expect(s.workflow.attachEvaluation('invalid', s.sign('evaluator', 'protected_evaluation', evaluation))).rejects.toThrow();
    }
  });
  it('rejects signed private narratives and logs at every evaluation payload boundary', async () => {
    const s = await setup(); const canary = 'PRIVATE_TRANSCRIPT_CANARY';
    for (const evaluation of [{ ...s.evaluation, privateTranscript: canary },
      { ...s.evaluation, receipt: { ...s.evaluation.receipt, log: canary } },
      { ...s.evaluation, details: { ...s.evaluation.details, explanation: canary } }]) {
      await expect(s.workflow.attachEvaluation('private-evaluation', s.sign('evaluator', 'protected_evaluation', evaluation))).rejects.toThrow();
    }
    expect(JSON.stringify(await s.workflow.listReviewQueue())).not.toContain(canary);
    expect((await s.workflow.report()).auditEvents).toBe(3);
    await s.workflow.attachEvaluation('valid-evaluation', s.evaluated);
    await s.workflow.approve('approval', s.approval);
    expect(await s.workflow.readiness(s.candidate.id)).toMatchObject({ ready: true });
  });
  it('enforces the frozen proposal case budget and corpus schema limit before accepting evidence', async () => {
    const s = await setup();
    await expect(s.workflow.attachEvaluation('over-budget', s.sign('evaluator', 'protected_evaluation', {
      ...s.evaluation, details: { ...s.evaluation.details, checks: s.proposal.budget.maxCases + 1 },
    }))).rejects.toThrow('evaluation_case_budget_exceeded');
    await expect(s.workflow.attachEvaluation('over-schema-limit', s.sign('evaluator', 'protected_evaluation', {
      ...s.evaluation, details: { ...s.evaluation.details, checks: 129 },
    }))).rejects.toThrow();
    expect((await s.workflow.report()).auditEvents).toBe(3);
    await s.workflow.attachEvaluation('valid-evaluation', s.evaluated);
  });
  it('blocks failed candidate despite human approval and prevents reuse of final set for corrected candidate', async () => {
    const s = await setup(); const failed = s.sign('evaluator', 'protected_evaluation', { ...s.evaluation, receipt: { ...s.evaluation.receipt, status: 'failed' as const, failedChecks: 1 }, details: { ...s.evaluation.details, candidateFailures: 1 } });
    await s.workflow.attachEvaluation('failed', failed);
    await s.workflow.approve('approve-failed', s.sign('human', 'release_review', { ...s.approval.payload, evaluationDigest: hash(canonical(failed)) }));
    expect(await s.workflow.readiness(s.candidate.id)).toMatchObject({ ready: false, reason: 'failed' });
    const next = { ...s.candidate, id: 'candidate2' }; await s.workflow.registerCandidate('candidate2', s.sign('author', 'candidate_artifact', { proposalId: s.proposal.id, candidate: next, artifact: s.artifact }));
    await expect(s.workflow.attachEvaluation('retry-final', s.sign('evaluator', 'protected_evaluation', { ...s.evaluation, receipt: { ...s.evaluation.receipt, candidateId: next.id } }))).rejects.toThrow('final_dataset_consumed');
  });
  it('removes revoked lineage from learning exports and prevents pending promotion/reimport', async () => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', s.evaluated); await s.workflow.approve('approval', s.approval);
    await s.workflow.revokeLineage('revoke', s.sign('human', 'revoke_lineage', { lineageId: s.finding.lineageIds[0] }));
    expect((await s.workflow.listReviewQueue()).findings).toEqual([]);
    await expect(s.workflow.readiness(s.candidate.id)).rejects.toThrow('finding_ineligible');
    await expect(s.workflow.importFinding('reimport', s.sign('analyst', 'approved_finding', { ...s.finding, id: 'reimport' }))).rejects.toThrow('finding_ineligible');
  });
  it('rejects protected changes, private free text, untrusted commands and over-budget candidates', async () => {
    const s = await setup();
    await expect(s.workflow.importFinding('private', s.sign('analyst', 'approved_finding', { ...s.finding, id: 'private', narrative: 'PRIVATE_CANARY', command: 'curl example.invalid' }))).rejects.toThrow();
    await expect(s.workflow.registerCandidate('protected', s.sign('author', 'candidate_artifact', { ...s.registration.payload, candidate: { ...s.candidate, id: 'protected', changedPaths: ['src/lib/adaptive/policy.ts'] } }))).rejects.toThrow('candidate_binding_mismatch');
    const next = { ...s.candidate, id: 'candidate2' }; await s.workflow.registerCandidate('candidate2', s.sign('author', 'candidate_artifact', { ...s.registration.payload, candidate: next }));
    await expect(s.workflow.registerCandidate('candidate3', s.sign('author', 'candidate_artifact', { ...s.registration.payload, candidate: { ...next, id: 'candidate3' } }))).rejects.toThrow('candidate_budget_exhausted');
    expect(JSON.stringify(await s.workflow.report())).not.toContain('PRIVATE_CANARY');
  });
  it('detects altered audit entries and artifacts', async () => {
    const s = await setup(); await fs.chmod(join(s.root, 'objects', s.candidate.artifactDigest), 0o600); await fs.writeFile(join(s.root, 'objects', s.candidate.artifactDigest), '{}');
    await expect(s.workflow.readArtifact(s.candidate.id)).rejects.toThrow('artifact_corrupt');
    const file = join(s.root, 'audit', '0000000001.json'); const entry = JSON.parse(await fs.readFile(file, 'utf8')); entry.state.findings.finding1.failureCount = 0; await fs.writeFile(file, JSON.stringify(entry));
    await expect(s.workflow.report()).rejects.toThrow('audit_corrupt');
  });
  it('requires frozen optimization budgets and keeps final cases out of optimizer API', () => {
    const baseline: RoutingArtifact = { schemaVersion: 1, kind: 'cancellation_routing', onCancelled: 'complete', onActive: 'continue' };
    const dataset = { version: 'training', cases: [{ cancelled: true, expected: 'stop' as const }, { cancelled: false, expected: 'continue' as const }] };
    expect(optimizeRouting(baseline, dataset, 2, 8)).toMatchObject({ baselineFailures: 1, candidateFailures: 0, candidatesConsidered: 2, evidence: 'optimization_only' });
    expect(() => optimizeRouting(baseline, dataset, 2, 1)).toThrow('budget');
    for (const invalidBudget of [NaN, Infinity, 0, -1, 1.5]) {
      expect(() => optimizeRouting(baseline, dataset, 2, invalidBudget)).toThrow('budget');
    }
  });
  it.runIf(!!process.env.VOX_IMPROVEMENT_IMAGE)('executes frozen baseline/candidate in pinned Docker isolation and signs bounded result', async () => {
    const s = await setup(); const envelope = await evaluateIsolated({ candidate: s.candidate, artifact: s.artifact, baseline: s.baseline, dataset: s.dataset,
      imageDigest: process.env.VOX_IMPROVEMENT_IMAGE!, evaluatorKeyId: 'evaluator', evaluatorPrivateKey: s.keys.evaluator, now });
    expect(envelope.payload.details).toMatchObject({ baselineFailures: 1, candidateFailures: 0, checks: 2, isolation: 'docker_network_none_readonly' });
    await s.workflow.attachEvaluation('docker-evaluation', envelope); expect(await s.workflow.readiness(s.candidate.id)).toMatchObject({ reason: 'human_release_required' });
  });
});
