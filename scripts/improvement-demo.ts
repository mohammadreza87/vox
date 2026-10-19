/** Synthetic local rehearsal only. Keys are fresh test credentials, held in host
 * memory and never mounted in the evaluator container. No serving config writes. */
import { generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { attest, canonical, hash, type Authority, type RoutingArtifact, type RoutingDataset, type TrustStore } from '../src/lib/adaptive/improvement/contracts';
import { ImprovementWorkflow } from '../src/lib/adaptive/improvement/workflow';
import { EVALUATOR_DIGEST, POLICY_DIGEST, evaluateIsolated, optimizeRouting } from '../src/lib/adaptive/improvement/sandbox';
import type { ImprovementCandidate } from '../src/lib/adaptive/improvement';
async function main() {
  const root = resolve(process.argv[2] ?? '/tmp/vox-improvement-demo');
  try { await fs.access(root); throw new Error('demo_directory_must_not_exist'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const imageDigest = process.env.VOX_IMPROVEMENT_IMAGE;
  if (!imageDigest) throw new Error('VOX_IMPROVEMENT_IMAGE_must_pin_local_sha256_image');
  const trust: TrustStore = {}; const privateKeys: Record<string, string> = {};
  for (const role of ['analyst', 'author', 'evaluator', 'human'] as Authority[]) {
    const keys = generateKeyPairSync('ed25519'); trust[role] = { role, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    privateKeys[role] = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
  const now = Date.now(); const workflow = new ImprovementWorkflow({ root, trust, now: () => now });
  const baseline: RoutingArtifact = { schemaVersion: 1, kind: 'cancellation_routing', onCancelled: 'complete', onActive: 'continue' };
  const training: RoutingDataset = { version: 'optimization_en_fa_1', cases: [{ cancelled: true, expected: 'stop' }, { cancelled: false, expected: 'continue' }] };
  // Final cases stay in the trusted evaluator invocation, never the review queue/candidate container.
  const final: RoutingDataset = { version: 'protected_final_1', cases: [{ cancelled: false, expected: 'continue' }, { cancelled: true, expected: 'stop' }, { cancelled: true, expected: 'stop' }] };
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceFiles = ['src/lib/adaptive/improvement/index.ts', 'src/lib/adaptive/improvement/contracts.ts', 'src/lib/adaptive/improvement/workflow.ts', 'src/lib/adaptive/improvement/sandbox.ts', 'scripts/improvement-demo.ts'];
  const sourceManifest = { baseRevision: sourceRevision, files: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await fs.readFile(file))]))) };
  const sourceDigest = hash(canonical(sourceManifest));
  const finding = { schemaVersion: 1 as const, id: 'synthetic_cancel_defect', kind: 'synthetic' as const, problemCode: 'audio_cancellation' as const, sourceDigest,
    lineageIds: [hash('synthetic_cancellation_fixture')], sampleCount: 3, failureCount: 2, purpose: 'product_improvement' as const, reviewedAt: now, expiresAt: now + 86400000 };
  await workflow.importFinding('import', attest('analyst', privateKeys.analyst, 'approved_finding', finding));
  await workflow.proposeRouting('propose', { id: 'cancel_proposal', findingId: finding.id, kind: 'routing_change', hypothesis: 'cancelled_turn_should_stop', expectedOutcome: 'zero_post_cancel_work',
    baselineRevision: sourceDigest, baselineArtifactDigest: hash(canonical(baseline)), createdAt: now, budget: { maxCandidates: 2, maxCases: 8 } });
  const optimization = optimizeRouting(baseline, training, 2, 8); const artifact = optimization.artifact;
  const candidate: ImprovementCandidate = { schemaVersion: 1, id: 'cancel_routing_candidate', authorServiceId: 'author', baselineRevision: sourceDigest,
    candidateRevision: hash(canonical(artifact)), artifactDigest: hash(canonical(artifact)), problemCode: 'audio_cancellation', evidenceIds: [finding.id], evidenceKind: 'synthetic',
    changedPaths: ['src/features/call/cancellation-routing.ts'], evaluatorVersion: EVALUATOR_DIGEST, datasetVersion: hash(canonical(final)), promotionPolicyVersion: POLICY_DIGEST,
    rollbackRevision: sourceDigest, createdAt: now };
  await workflow.registerCandidate('register', attest('author', privateKeys.author, 'candidate_artifact', { proposalId: 'cancel_proposal', candidate, artifact }));
  const evaluation = await evaluateIsolated({ candidate, artifact: await workflow.readArtifact(candidate.id), baseline, dataset: final, imageDigest,
    evaluatorKeyId: 'evaluator', evaluatorPrivateKey: privateKeys.evaluator, now });
  await workflow.attachEvaluation('evaluate', evaluation);
  const beforeApproval = await workflow.readiness(candidate.id);
  await workflow.approve('review', attest('human', privateKeys.human, 'release_review', { candidateId: candidate.id, artifactDigest: candidate.artifactDigest,
    evaluationDigest: hash(canonical(evaluation)), decision: 'approve', approvedAt: now, expiresAt: now + 3600000 }));
  const ready = await workflow.readiness(candidate.id);
  const rollback = await workflow.rollbackRehearsal('rollback', candidate.id, baseline);
  const report = { ...await workflow.report(), sourceRevision, sourceManifest, sourceDigest, optimization, isolatedEvaluation: evaluation, beforeApproval, readiness: ready, rollback,
    limitations: ['synthetic human approval', 'no live service IAM qualification', 'routing artifact is not deployed', 'no arbitrary software patch execution', 'no production memory writes'] };
  await fs.writeFile(resolve(root, 'public-trust.json'), canonical(trust), { mode: 0o600 });
  await fs.writeFile(resolve(root, 'report.json'), canonical(report), { mode: 0o600 });
  console.log(JSON.stringify({ root, report: resolve(root, 'report.json'), baselineFailures: evaluation.payload.details.baselineFailures,
    candidateFailures: evaluation.payload.details.candidateFailures, beforeApproval, ready, rollback }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'demo_failed'); process.exitCode = 1; });
