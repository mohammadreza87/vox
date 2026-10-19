/** Local synthetic defect-to-patch rehearsal. No repository edits or remote
 * writes. Private signing keys live only in this host process. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { attest, canonical, hash, type Authority, type TrustStore } from '../src/lib/adaptive/improvement/contracts';
import { readFrozenSoftwareBase, createSyntheticPersianPatch } from '../src/lib/adaptive/improvement/software-patch';
import { evaluateSoftwareIsolated, SOFTWARE_IMAGE_DIGEST, SOFTWARE_POLICY_DIGEST } from '../src/lib/adaptive/improvement/software-sandbox';
import { SoftwareImprovementWorkflow, softwareBaseBinding, softwareFindingSchema, softwareProposalSchema } from '../src/lib/adaptive/improvement/software-workflow';

async function main() {
  const [, , outputDirectory, baselineCommit] = process.argv;
  if (!outputDirectory || !baselineCommit || process.argv.length !== 4) throw new Error('usage: software-improvement-demo.ts <new-output-directory> <exact-40-character-baseline-commit>');
  if (process.env.VOX_IMPROVEMENT_IMAGE !== SOFTWARE_IMAGE_DIGEST) throw new Error('VOX_IMPROVEMENT_IMAGE_must_match_pinned_local_image');
  const root = resolve(outputDirectory);
  try { await fs.access(root); throw new Error('demo_directory_must_not_exist'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const repositoryRoot = process.cwd();
  const base = await readFrozenSoftwareBase(repositoryRoot, baselineCommit);
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourcePaths = ['src/lib/adaptive/improvement/contracts.ts', 'src/lib/adaptive/improvement/software-contracts.ts',
    'src/lib/adaptive/improvement/software-patch.ts', 'src/lib/adaptive/improvement/software-sandbox.ts',
    'src/lib/adaptive/improvement/software-workflow.ts', 'scripts/software-improvement-demo.ts'];
  const readManifest = async () => ({ baseRevision: sourceRevision,
    files: Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await fs.readFile(resolve(repositoryRoot, path)))]))) });
  const sourceManifest = await readManifest();
  const trust: TrustStore = {}; const privateKeys: Record<string, string> = {};
  for (const role of ['analyst', 'author', 'evaluator', 'human'] as Authority[]) {
    const pair = generateKeyPairSync('ed25519');
    trust[role] = { role, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    privateKeys[role] = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
  const now = Date.now();
  const workflow = new SoftwareImprovementWorkflow({ root, trust, now: () => now,
    currentBase: () => readFrozenSoftwareBase(repositoryRoot, baselineCommit) });
  const finding = softwareFindingSchema.parse({ schemaVersion: 1, id: 'synthetic_persian_boundary', issueId: 'VOX-045-persian-boundary',
    kind: 'synthetic', problemCode: 'persian_sentence_boundary', purpose: 'product_improvement', base: softwareBaseBinding(base),
    lineageIds: [hash('synthetic_persian_question_mark_fixture_v1')], sampleCount: 2, failureCount: 1,
    reviewedAt: now, expiresAt: now + 3600000 });
  await workflow.importFinding('import', attest('analyst', privateKeys.analyst, 'software_finding', finding));
  const proposal = softwareProposalSchema.parse({ id: 'persian_boundary_proposal', findingId: finding.id,
    hypothesis: 'recognize_persian_question_mark', authorMode: 'deterministic_synthetic', base: softwareBaseBinding(base),
    policyDigest: SOFTWARE_POLICY_DIGEST, createdAt: now, budget: { maxCandidates: 1, maxCases: 12 } });
  await workflow.propose('propose', attest('author', privateKeys.author, 'software_proposal', proposal));
  const artifact = createSyntheticPersianPatch(base, finding.issueId, SOFTWARE_POLICY_DIGEST);
  const candidateId = 'persian_boundary_candidate';
  await workflow.registerCandidate('register', attest('author', privateKeys.author, 'software_candidate', {
    id: candidateId, proposalId: proposal.id, createdAt: now, artifact,
  }));
  const evaluation = await evaluateSoftwareIsolated({ artifact: await workflow.readArtifact(candidateId), base,
    imageDigest: SOFTWARE_IMAGE_DIGEST, evaluatorKeyId: 'evaluator', evaluatorPrivateKey: privateKeys.evaluator, now });
  await workflow.attachEvaluation('evaluate', candidateId, evaluation);
  const beforeApproval = await workflow.readiness(candidateId);
  if (evaluation.payload.status === 'passed') {
    assert.deepEqual(beforeApproval, { ready: false, reason: 'human_release_required' });
    await workflow.review('review', attest('human', privateKeys.human, 'software_release_review', {
      candidateId, artifactDigest: hash(canonical(artifact)), evaluationDigest: hash(canonical(evaluation)),
      decision: 'approve', approvedAt: now, expiresAt: now + 3600000,
    }));
  }
  const packet = await workflow.reviewPacket(candidateId);
  assert.equal(packet.evidence.readiness.ready, evaluation.payload.status === 'passed');
  assert.deepEqual(await readManifest(), sourceManifest, 'workflow_source_changed_during_evaluation');
  const report = { ...await workflow.report(), sourceRevision, sourceManifest, sourceDigest: hash(canonical(sourceManifest)),
    baselineCommit, environment: { node: process.version, platform: process.platform, loader: 'tsx' },
    beforeApproval, readiness: packet.evidence.readiness, isolatedEvaluation: evaluation,
    limitations: ['synthetic finding, deterministic author and synthetic human review', 'trusted host and Docker daemon',
      'finite synthetic module corpus; no measured conversation benefit', 'no production service IAM qualification',
      'no repository edits, remote publication or deployment', 'review packet bound to exact frozen baseline; rebase requires new evaluation'] };
  for (const [name, value] of [['public-trust.json', trust], ['report.json', report], ['review-packet.json', packet]] as const) {
    await fs.writeFile(resolve(root, name), canonical(value), { flag: 'wx', mode: 0o600 });
  }
  await fs.writeFile(resolve(root, 'candidate.patch'), artifact.patch, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ root, report: resolve(root, 'report.json'), baselineCommit, checks: evaluation.payload.checks,
    baselineFailures: evaluation.payload.baselineFailures, candidateFailures: evaluation.payload.candidateFailures,
    beforeApproval, readiness: packet.evidence.readiness, productionMutation: false }, null, 2));
  if (evaluation.payload.status !== 'passed') process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'software_demo_failed'); process.exitCode = 1; });
