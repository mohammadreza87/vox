/** Author qualification only: real synthetic workflow/files/signatures. Docker
 * envelopes below are explicitly signed host fixtures, not container evidence. */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonical, hash, type RoutingArtifact } from '../contracts';
import type { ImprovementCandidate } from '../index';
import { ImprovementWorkflow, type ProtectedEvaluation } from '../workflow';
import { EVALUATOR_DIGEST, POLICY_DIGEST } from '../sandbox';
import { learningCaseFixture } from '../learning-cases/testing';
import { optimizeLearningCaseRouting } from './optimizer';
import { evaluationProtocolDigest } from './manifest';
import { attestLearningCaseProtocol, bindLearningCaseFinalEvaluation, bindProtocolFinalEvaluation, evaluateReservedProtocol, protocolReservationRequest } from './binding';
import { deterministicSyntheticAdapter, runEvaluation, type SyntheticEvaluationAdapter } from './runner';
const baseline: RoutingArtifact = { schemaVersion: 1, kind: 'cancellation_routing', onCancelled: 'complete', onActive: 'continue' };
const artifact: RoutingArtifact = { ...baseline, onCancelled: 'stop' };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(candidateArtifact: RoutingArtifact = artifact) {
  const root = await mkdtemp(join(tmpdir(), 'vox-lc1-evaluation-author-')); roots.push(root);
  const f = await learningCaseFixture(root);
  const optimized = await optimizeLearningCaseRouting({ workflow: f.workflow, handle: f.handle }, f.manifest, baseline, 2, f.now());
  expect(optimized.artifact).toEqual(artifact);
  const candidate: ImprovementCandidate = { schemaVersion: 2, learningCases: f.manifest.learningCases, id: 'fictional_candidate', authorServiceId: 'author', baselineRevision: f.finding.sourceDigest,
    candidateRevision: hash(canonical(candidateArtifact)), artifactDigest: hash(canonical(candidateArtifact)), problemCode: 'audio_cancellation', evidenceIds: [f.finding.id], evidenceKind: 'synthetic',
    changedPaths: ['src/features/call/cancellation-routing.ts'], evaluatorVersion: EVALUATOR_DIGEST, datasetVersion: hash('fictional-legacy-protected-final'), promotionPolicyVersion: POLICY_DIGEST,
    rollbackRevision: f.finding.sourceDigest, createdAt: f.now(), evaluationProtocolDigest: evaluationProtocolDigest(f.manifest) };
  await f.workflow.proposeRouting('fictional_proposal', { schemaVersion: 2, learningCases: f.manifest.learningCases, id: 'proposal', findingId: f.finding.id, kind: 'routing_change', hypothesis: 'cancelled_turn_should_stop', expectedOutcome: 'zero_post_cancel_work',
    baselineRevision: f.finding.sourceDigest, baselineArtifactDigest: hash(canonical(baseline)), createdAt: f.now(), evaluationProtocolDigest: candidate.evaluationProtocolDigest, budget: { maxCandidates: 2, maxCases: 6 } });
  await f.workflow.registerCandidate('fictional_register', f.sign('author', 'candidate_artifact', { proposalId: 'proposal', candidate, artifact: candidateArtifact }));
  const handle = await f.workflow.prepareLearningCases(f.preparation);
  const authority = { workflow: f.workflow, handle };
  const reservation = f.sign('evaluator', 'evaluation_protocol_reservation', protocolReservationRequest(candidate, f.manifest, hash(canonical(baseline)), 'evaluator', f.now()));
  const options = (adapter = deterministicSyntheticAdapter) => ({ manifest: f.manifest, corpus: f.corpus, candidate, artifact: candidateArtifact, baseline, evaluatorServiceId: 'evaluator', adapter, clock: f.now, learningCaseAuthority: authority });
  return { ...f, candidate, handle, authority, reservation, options };
}
it('connects reviewed closed cases through reserved paired evaluation, guarded signing/final binding and human restart readiness', async () => {
  const f = await fixture();
  const receipt = await evaluateReservedProtocol(f.workflow, 'fictional_reserved_run', f.reservation, f.options());
  expect(receipt).toMatchObject({ schemaVersion: 2, status: 'passed', calls: 12, learningCases: f.manifest.learningCases });
  await expect(attestLearningCaseProtocol(f.authority, structuredClone(receipt), 'evaluator', f.keys.evaluator)).rejects.toThrow('learning_case_runner_receipt_required');
  const originalCalls = receipt.calls; receipt.calls = 0;
  await expect(attestLearningCaseProtocol(f.authority, receipt, 'evaluator', f.keys.evaluator)).rejects.toThrow('learning_case_runner_receipt_required');
  receipt.calls = originalCalls;
  const protocol = await attestLearningCaseProtocol(f.authority, receipt, 'evaluator', f.keys.evaluator);
  await f.workflow.attachEvaluationProtocol('fictional_attach_protocol', protocol, f.handle);
  const hostFixture: ProtectedEvaluation = { receipt: { candidateId: f.candidate.id, candidateRevision: f.candidate.candidateRevision, artifactDigest: f.candidate.artifactDigest,
    evaluatorServiceId: 'evaluator', evaluatorVersion: EVALUATOR_DIGEST, datasetVersion: f.candidate.datasetVersion, promotionPolicyVersion: POLICY_DIGEST, baselineRevision: f.candidate.baselineRevision,
    status: 'passed', privacyFailures: 0, failedChecks: 0, skippedChecks: 0, testedAt: f.now() },
    details: { sourceDigest: f.candidate.baselineRevision, artifactDigest: f.candidate.artifactDigest, baselineArtifactDigest: hash(canonical(baseline)), datasetDigest: f.candidate.datasetVersion,
      evaluatorDigest: EVALUATOR_DIGEST, imageDigest: `sha256:${'a'.repeat(64)}`, policyDigest: POLICY_DIGEST, phase: 'protected_final', isolation: 'docker_network_none_readonly', checks: 2, baselineFailures: 1, candidateFailures: 0 } };
  const finalOptions = { candidate: f.candidate, evaluation: f.sign('evaluator', 'protected_evaluation', hostFixture), protocol, trust: f.trust, evaluatorKeyId: 'evaluator', evaluatorPrivateKey: f.keys.evaluator, now: f.now() };
  expect(() => bindProtocolFinalEvaluation(finalOptions)).toThrow('learning_case_authority_required');
  const final = await bindLearningCaseFinalEvaluation(f.authority, finalOptions);
  await f.workflow.attachEvaluation('fictional_attach_final', final);
  expect(await f.workflow.readiness(f.candidate.id)).toEqual({ ready: false, reason: 'human_release_required' });
  await f.workflow.approve('fictional_human_review', f.sign('human', 'release_review', { candidateId: f.candidate.id, artifactDigest: f.candidate.artifactDigest, evaluationDigest: hash(canonical(final)), decision: 'approve', approvedAt: f.now(), expiresAt: 900 }));
  const restarted = new ImprovementWorkflow({ root: f.root, trust: f.trust, now: f.now });
  expect(await restarted.readiness(f.candidate.id)).toMatchObject({ ready: true });
  await f.workflow.withdrawLearningCase('fictional_withdraw', f.sign('human', 'withdraw_learning_case', { caseId: f.caseId, reviewedAt: f.now() }));
  await expect(restarted.readiness(f.candidate.id)).rejects.toThrow('learning_case_ineligible');
}, 30000);
it('a genuine prepared but unreserved handle cannot call the runner directly or dispatch an adapter', async () => {
  const f = await fixture(); let calls = 0;
  const adapter: SyntheticEvaluationAdapter = { ...deterministicSyntheticAdapter, async run(input, signal) { calls++; return deterministicSyntheticAdapter.run(input, signal); } };
  await expect(runEvaluation(f.options(adapter))).rejects.toThrow('learning_case_reservation_required');
  expect(calls).toBe(0);
}, 30000);
it('source revocation during an awaited adapter suppresses all later arms/signatures and keeps final use consumed', async () => {
  const f = await fixture(); let calls = 0, first!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { first = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  const adapter: SyntheticEvaluationAdapter = { ...deterministicSyntheticAdapter, async run(input, signal) { calls++; first(); await waiting; return deterministicSyntheticAdapter.run(input, signal); } };
  const running = evaluateReservedProtocol(f.workflow, 'fictional_revoked_run', f.reservation, f.options(adapter));
  // Attach a rejection observer immediately while controlling the adapter.
  const observed = running.then(value => ({ value }), error => ({ error }));
  await entered;
  await f.workflow.revokeLineage('fictional_revoke', f.sign('human', 'revoke_lineage', { lineageId: f.finding.lineageIds[0] }));
  release();
  const result = await observed; expect('error' in result).toBe(true); expect(calls).toBe(1);
  const audit = await readdir(join(f.root, 'audit'));
  const latest = JSON.parse(await readFile(join(f.root, 'audit', audit.sort().at(-1)!), 'utf8'));
  expect(latest.state.protocolUses).toContain(f.manifest.digests.final);
  expect(latest.state.candidates[f.candidate.id].protocol).toBeUndefined();
}, 30000);
it('private handles reject serialization, other workflow instances and candidate substitution after reservation', async () => {
  const f = await fixture(); let calls = 0;
  const adapter: SyntheticEvaluationAdapter = { ...deterministicSyntheticAdapter, async run(input, signal) { calls++; return deterministicSyntheticAdapter.run(input, signal); } };
  const options = f.options(adapter);
  await expect(runEvaluation({ ...options, learningCaseAuthority: { workflow: f.workflow, handle: structuredClone(f.handle) } })).rejects.toThrow('learning_case_authority_stale');
  const restarted = new ImprovementWorkflow({ root: f.root, trust: f.trust, now: f.now });
  await expect(runEvaluation({ ...options, learningCaseAuthority: { workflow: restarted, handle: f.handle } })).rejects.toThrow('learning_case_authority_stale');
  expect(await f.workflow.reserveEvaluationProtocol('fictional_candidate_reserved', f.reservation, f.handle)).toBe(true);
  await expect(runEvaluation({ ...options, candidate: { ...f.candidate, id: 'substituted_candidate' } })).rejects.toThrow('learning_case_reservation_required');
  expect(calls).toBe(0);
}, 30000);
it('expiry at the exact deadline during an awaited adapter denies late receipt production without a second call', async () => {
  const f = await fixture(); let calls = 0;
  const adapter: SyntheticEvaluationAdapter = { ...deterministicSyntheticAdapter, async run(input, signal) { calls++; const result = await deterministicSyntheticAdapter.run(input, signal); f.setNow(1000); return result; } };
  await expect(evaluateReservedProtocol(f.workflow, 'fictional_expiring_run', f.reservation, f.options(adapter))).rejects.toThrow('expired');
  expect(calls).toBe(1);
}, 30000);

it('a planted active-turn regression records failure and cannot become ready through human or legacy paths', async () => {
  const f = await fixture({ ...artifact, onActive: 'stop' });
  const receipt = await evaluateReservedProtocol(f.workflow, 'fictional_failed_run', f.reservation, f.options());
  expect(receipt.status).toBe('failed'); expect(receipt.candidate.deterministicFailures).toBeGreaterThan(0);
  const protocol = await attestLearningCaseProtocol(f.authority, receipt, 'evaluator', f.keys.evaluator);
  await f.workflow.attachEvaluationProtocol('fictional_failed_attach', protocol, f.handle);
  expect(await f.workflow.readiness(f.candidate.id)).toEqual({ ready: false, reason: 'failed' });
  await expect(f.workflow.approve('fictional_premature_human', f.sign('human', 'release_review', { candidateId: f.candidate.id, artifactDigest: f.candidate.artifactDigest, evaluationDigest: hash('no-final'), decision: 'approve', approvedAt: f.now(), expiresAt: 900 }))).rejects.toThrow('evaluation_missing');
}, 30000);
