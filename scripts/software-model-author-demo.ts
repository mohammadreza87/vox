/** Bounded synthetic issue -> model patch -> protected Docker evaluation.
 * Requires an explicit transport choice. Never edits Git, publishes or deploys. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { attest, canonical, hash, type Authority, type TrustStore } from '../src/lib/adaptive/improvement/contracts';
import { authorSoftwarePatch, createOpenAISoftwareAuthorTransport, type SoftwareAuthorTransport } from '../src/lib/adaptive/improvement/software-author';
import { SOFTWARE_AUTHOR_MODEL, SOFTWARE_AUTHOR_POLICY_DIGEST } from '../src/lib/adaptive/improvement/software-author-contracts';
import { readFrozenSoftwareBase, createSyntheticPersianPatch } from '../src/lib/adaptive/improvement/software-patch';
import { evaluateSoftwareIsolated, SOFTWARE_IMAGE_DIGEST, SOFTWARE_POLICY_DIGEST } from '../src/lib/adaptive/improvement/software-sandbox';
import { SoftwareImprovementWorkflow, softwareBaseBinding, softwareFindingSchema, modelSoftwareProposalSchema } from '../src/lib/adaptive/improvement/software-workflow';

async function main() {
  const [, , outputDirectory, baselineCommit, mode] = process.argv;
  if (!outputDirectory || !baselineCommit || !['mock', 'provider'].includes(mode) || process.argv.length !== 5) {
    throw new Error('usage: software-model-author-demo.ts <new-output-directory> <exact-baseline-commit> <mock|provider>');
  }
  if (process.env.VOX_IMPROVEMENT_IMAGE !== SOFTWARE_IMAGE_DIGEST) throw new Error('pinned_local_image_required');
  if (mode === 'provider' && !process.env.OPENAI_API_KEY?.trim()) throw new Error('provider_credential_required');
  const root = resolve(outputDirectory);
  await fs.mkdir(root, { mode: 0o700 }); // Deliberately refuses existing output, including crashed attempts.
  const repositoryRoot = process.cwd();
  const base = await readFrozenSoftwareBase(repositoryRoot, baselineCommit);
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const paths = ['src/lib/adaptive/improvement/contracts.ts', 'src/lib/adaptive/improvement/software-contracts.ts',
    'src/lib/adaptive/improvement/software-patch.ts', 'src/lib/adaptive/improvement/software-sandbox.ts',
    'src/lib/adaptive/improvement/software-workflow.ts', 'src/lib/adaptive/improvement/software-author-contracts.ts',
    'src/lib/adaptive/improvement/software-author.ts', 'scripts/software-model-author-demo.ts'];
  const readManifest = async () => ({ baseRevision: sourceRevision,
    files: Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await fs.readFile(resolve(repositoryRoot, path)))]))) });
  const sourceManifest = await readManifest();
  const write = (name: string, value: unknown) => fs.writeFile(resolve(root, name), canonical(value), { flag: 'wx', mode: 0o600 });
  const manifest = { schemaVersion: 1, mode, sourceManifest, sourceDigest: hash(canonical(sourceManifest)), baselineCommit,
    baselineSelection: 'explicit immutable historical commit, not current branch HEAD or production revision',
    corpus: 'one synthetic Persian sentence-boundary issue and frozen repository module; no user data',
    provider: mode === 'provider' ? 'OpenAI Responses' : 'scripted fake Responses transport', model: SOFTWARE_AUTHOR_MODEL,
    maxProviderRequests: mode === 'provider' ? 1 : 0, maxOutputTokens: 2048, timeoutMs: 30000, retries: 0,
    authorPolicyDigest: SOFTWARE_AUTHOR_POLICY_DIGEST, evaluationPolicyDigest: SOFTWARE_POLICY_DIGEST,
    permittedEffects: ['one bounded provider request only in provider mode', 'local immutable evidence', 'network-disabled Docker'],
    retention: 'store:false; provider account retention policy not independently qualified', createdAt: Date.now() };
  await write('manifest.json', manifest);
  const trust: TrustStore = {}; const privateKeys: Record<string, string> = {};
  for (const role of ['analyst', 'author', 'evaluator', 'human'] as Authority[]) {
    const pair = generateKeyPairSync('ed25519');
    trust[role] = { role, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    privateKeys[role] = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
  await write('public-trust.json', trust);
  const workflow = new SoftwareImprovementWorkflow({ root: resolve(root, 'registry'), trust,
    currentBase: () => readFrozenSoftwareBase(repositoryRoot, baselineCommit) });
  const now = Date.now();
  const finding = softwareFindingSchema.parse({ schemaVersion: 1, id: 'synthetic_persian_boundary', issueId: 'VOX-045-persian-boundary',
    kind: 'synthetic', problemCode: 'persian_sentence_boundary', purpose: 'product_improvement', base: softwareBaseBinding(base),
    lineageIds: [hash('synthetic_persian_question_mark_fixture_v1')], sampleCount: 2, failureCount: 1,
    reviewedAt: now, expiresAt: now + 3600000 });
  await workflow.importFinding('import', attest('analyst', privateKeys.analyst, 'software_finding', finding));
  const proposal = modelSoftwareProposalSchema.parse({ schemaVersion: 2, id: 'model_persian_boundary_proposal', findingId: finding.id,
    hypothesis: 'recognize_persian_question_mark', authorMode: 'openai_responses', base: softwareBaseBinding(base),
    policyDigest: SOFTWARE_POLICY_DIGEST, authorPolicyDigest: SOFTWARE_AUTHOR_POLICY_DIGEST, createdAt: Date.now(),
    budget: { maxCandidates: 1, maxCases: 12 } });
  await workflow.propose('propose', attest('author', privateKeys.author, 'software_proposal', proposal));
  const realTransport = mode === 'provider' ? createOpenAISoftwareAuthorTransport(process.env.OPENAI_API_KEY!) : undefined;
  let transportCalls = 0;
  const transport: SoftwareAuthorTransport = { async create(request, options) {
    transportCalls++;
    assert.equal(transportCalls, 1, 'single_request_budget_exhausted');
    if (realTransport) return realTransport.create(request, options);
    return { id: 'mock_response_only', model: SOFTWARE_AUTHOR_MODEL, status: 'completed',
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
        text: JSON.stringify({ patch: createSyntheticPersianPatch(base, finding.issueId, SOFTWARE_POLICY_DIGEST).patch }) }] }],
      usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } };
  } };
  const authored = await authorSoftwarePatch({ context: () => workflow.authorContext(proposal.id),
    reserve: () => workflow.reserveAuthorAttempt('reserve_once', proposal.id), trust, authorKeyId: 'author',
    authorPrivateKey: privateKeys.author, transport });
  await write('author-receipt.json', authored.receipt);
  assert.deepEqual(await readManifest(), sourceManifest, 'workflow_source_changed_during_authoring');
  if (!authored.artifact) {
    await write('report.json', { manifest, transportCalls, authorStatus: authored.receipt.payload.status,
      providerEvidence: mode === 'provider' ? 'attempted' : 'simulated', candidateCreated: false,
      evaluation: 'NOT_RUN', productionMutation: false, workflow: await workflow.report() });
    console.log(JSON.stringify({ root, status: authored.receipt.payload.status, candidateCreated: false, transportCalls }));
    process.exitCode = 1; return;
  }
  const artifact = authored.artifact; const candidateId = 'model_persian_boundary_candidate';
  await workflow.registerCandidate('register', attest('author', privateKeys.author, 'software_candidate', {
    schemaVersion: 2, id: candidateId, proposalId: proposal.id, createdAt: Date.now(), artifact, authorReceipt: authored.receipt,
  }));
  const evaluation = await evaluateSoftwareIsolated({ artifact: await workflow.readArtifact(candidateId), base,
    imageDigest: SOFTWARE_IMAGE_DIGEST, evaluatorKeyId: 'evaluator', evaluatorPrivateKey: privateKeys.evaluator, now: Date.now() });
  await workflow.attachEvaluation('evaluate', candidateId, evaluation);
  const beforeApproval = await workflow.readiness(candidateId);
  if (evaluation.payload.status === 'passed') {
    assert.deepEqual(beforeApproval, { ready: false, reason: 'human_release_required' });
    const reviewedAt = Date.now();
    await workflow.review('synthetic_review', attest('human', privateKeys.human, 'software_release_review', {
      candidateId, artifactDigest: hash(canonical(artifact)), evaluationDigest: hash(canonical(evaluation)),
      decision: 'approve', approvedAt: reviewedAt, expiresAt: reviewedAt + 3600000,
    }));
  }
  const packet = await workflow.reviewPacket(candidateId);
  assert.equal(packet.evidence.readiness.ready, evaluation.payload.status === 'passed');
  assert.deepEqual(await readManifest(), sourceManifest, 'workflow_source_changed_during_evaluation');
  await write('review-packet.json', packet);
  await fs.writeFile(resolve(root, 'candidate.patch'), artifact.patch, { flag: 'wx', mode: 0o600 });
  await write('report.json', { manifest, transportCalls, providerEvidence: mode === 'provider' ? 'actual_provider' : 'simulated',
    authorReceipt: authored.receipt, candidateCreated: true, beforeApproval, readiness: packet.evidence.readiness,
    isolatedEvaluation: evaluation, workflow: await workflow.report(),
    environment: { node: process.version, platform: process.platform, loader: 'tsx' }, productionMutation: false,
    limitations: ['one synthetic defect; finite module corpus, not measured conversation benefit',
      'ephemeral role keys and synthetic human review; not production IAM or human release authorization',
      'trusted host and Docker daemon; no repository writes, publication or deployment',
      'provider billing and account retention not independently verified',
      'historical baseline is fixed by CLI argument; demo does not enforce branch HEAD or production freshness',
      'readiness is advisory at exact reviewed baseline; rebase requires new evaluation'] });
  console.log(JSON.stringify({ root, mode, transportCalls, status: authored.receipt.payload.status,
    checks: evaluation.payload.checks, baselineFailures: evaluation.payload.baselineFailures,
    candidateFailures: evaluation.payload.candidateFailures, beforeApproval, readiness: packet.evidence.readiness, productionMutation: false }));
  if (evaluation.payload.status !== 'passed') process.exitCode = 1;
}
main().catch(() => { console.error('software_model_author_demo_failed; inspect minimized local evidence'); process.exitCode = 1; });
