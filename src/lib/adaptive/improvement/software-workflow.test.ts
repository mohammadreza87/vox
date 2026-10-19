import { afterEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attest, canonical, hash, type Authority, type TrustStore } from './contracts';
import { SOFTWARE_TARGET_PATH, type FrozenSoftwareBase, type SoftwareEvaluation } from './software-contracts';
import { createSyntheticPersianPatch, materializeSoftwarePatch } from './software-patch';
import { SOFTWARE_EVALUATOR_DIGEST, SOFTWARE_IMAGE_DIGEST, SOFTWARE_POLICY_DIGEST } from './software-sandbox';
import { SoftwareImprovementWorkflow, softwareBaseBinding, type SoftwareFinding, type SoftwareProposal } from './software-workflow';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
function fixture(): FrozenSoftwareBase {
  const source = ['export class SentenceDetector {', '  // punctuation boundary',
    '  private static SENTENCE_END = /([.!?]+)(?:\\s+|$)/g;', '  // following context', '}', ''].join('\n');
  return { repositoryCommit: 'a'.repeat(40), repositoryTreeOid: 'b'.repeat(40), targetPath: SOFTWARE_TARGET_PATH,
    baseBlobOid: createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0${source}`).digest('hex'), baseSourceDigest: hash(source), source };
}
async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'vox-software-workflow-test-')); roots.push(root);
  const trust: TrustStore = {}; const keys: Record<string, string> = {};
  for (const role of ['analyst', 'author', 'evaluator', 'human'] as Authority[]) {
    const pair = generateKeyPairSync('ed25519'); trust[role] = { role, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    keys[role] = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
  const clock = { now: 100000 }; const base = fixture(); const current = { base };
  const options = { root, trust: () => trust, now: () => clock.now, currentBase: async () => current.base };
  const workflow = new SoftwareImprovementWorkflow(options);
  const sign = <T>(role: Authority, purpose: string, payload: T) => attest(role, keys[role], purpose, payload);
  const finding: SoftwareFinding = { schemaVersion: 1, id: 'finding1', issueId: 'issue1', kind: 'synthetic',
    problemCode: 'persian_sentence_boundary', purpose: 'product_improvement', base: softwareBaseBinding(base), lineageIds: [hash('fictional_lineage')],
    sampleCount: 12, failureCount: 4, reviewedAt: clock.now, expiresAt: clock.now + 10000 };
  const imported = sign('analyst', 'software_finding', finding); await workflow.importFinding('import', imported);
  const proposal: SoftwareProposal = { id: 'proposal1', findingId: finding.id, hypothesis: 'recognize_persian_question_mark',
    authorMode: 'deterministic_synthetic', base: softwareBaseBinding(base), policyDigest: SOFTWARE_POLICY_DIGEST, createdAt: clock.now,
    budget: { maxCandidates: 2, maxCases: 12 } };
  const proposed = sign('author', 'software_proposal', proposal); await workflow.propose('proposal', proposed);
  const artifact = createSyntheticPersianPatch(base, finding.issueId, SOFTWARE_POLICY_DIGEST);
  const candidate = { id: 'candidate1', proposalId: proposal.id, createdAt: clock.now, artifact };
  const registered = sign('author', 'software_candidate', candidate); await workflow.registerCandidate('candidate', registered);
  const evaluation: SoftwareEvaluation = { identity: artifact.identity, datasetDigest: hash('host_only_random_final_set'), evaluatorDigest: SOFTWARE_EVALUATOR_DIGEST,
    imageDigest: SOFTWARE_IMAGE_DIGEST, checks: 12, baselineFailures: 4, candidateFailures: 0, status: 'passed', testedAt: clock.now,
    phase: 'protected_final', isolation: 'docker_candidate_only_host_scored' };
  // These are cryptographic workflow fixtures, not Docker execution evidence.
  const evaluated = sign('evaluator', 'software_protected_evaluation', evaluation);
  const approval = { candidateId: candidate.id, artifactDigest: hash(canonical(artifact)), evaluationDigest: hash(canonical(evaluated)),
    decision: 'approve' as const, approvedAt: clock.now, expiresAt: clock.now + 1000 };
  const reviewed = sign('human', 'software_release_review', approval);
  return { root, trust, keys, clock, current, options, workflow, base, sign, finding, imported, proposal, proposed, artifact, candidate, registered, evaluation, evaluated, approval, reviewed };
}
describe('local durable software improvement workflow', () => {
  it('restarts with immutable patch bytes and exact signed evaluation/review; emits a local review packet', async () => {
    const s = await setup(); expect(await s.workflow.readiness('candidate1')).toMatchObject({ ready: false, reason: 'evaluation_required' });
    await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated);
    expect((await s.workflow.reviewPacket('candidate1')).evidence.readiness).toMatchObject({ ready: false, reason: 'human_release_required' });
    await s.workflow.review('review', s.reviewed);
    const restarted = new SoftwareImprovementWorkflow(s.options);
    expect(await restarted.readiness('candidate1')).toEqual({ ready: true, reason: 'local_pr_review_ready' });
    const packet = await restarted.reviewPacket('candidate1');
    expect(packet).toMatchObject({ scope: 'local_pr_review', productionMutation: false, remotePublished: false,
      patch: s.artifact.patch, evidence: { authorMode: 'deterministic_synthetic', evaluation: s.evaluated, humanReview: s.reviewed } });
    expect(packet.body).toContain('CI, deployment and measured production effect: UNAVAILABLE');
    expect(packet.body).toContain('no production mutation');
    expect(JSON.stringify(packet)).not.toContain(s.root); expect(JSON.stringify(packet)).not.toContain('PRIVATE KEY');
    expect((await fs.stat(join(s.root, 'objects', s.approval.artifactDigest))).mode & 0o777).toBe(0o400);
    expect((await restarted.report()).auditEvents).toBe(5);
  });
  it('serializes concurrent identical operations and rejects changed operation replay', async () => {
    const s = await setup(); const other = new SoftwareImprovementWorkflow(s.options);
    await Promise.all([s.workflow.attachEvaluation('evaluate', 'candidate1', s.evaluated), other.attachEvaluation('evaluate', 'candidate1', s.evaluated)]);
    expect((await other.report()).auditEvents).toBe(4);
    await expect(other.attachEvaluation('evaluate', 'candidate1', s.sign('evaluator', 'software_protected_evaluation', { ...s.evaluation, datasetDigest: hash('new_set') }))).rejects.toThrow('idempotency_conflict');
  });
  it('repairs absent object publication on identical retry without duplicate audit state', async () => {
    const s = await setup(); await fs.unlink(join(s.root, 'objects', s.approval.artifactDigest));
    await expect(s.workflow.readArtifact('candidate1')).rejects.toThrow();
    await s.workflow.registerCandidate('candidate', s.registered);
    expect(await s.workflow.readArtifact('candidate1')).toEqual(s.artifact); expect((await s.workflow.report()).auditEvents).toBe(3);
  });
  it('rejects mutation of immutable published patch bytes and audit state', async () => {
    const s = await setup(); const file = join(s.root, 'objects', s.approval.artifactDigest);
    await fs.chmod(file, 0o600); await fs.writeFile(file, canonical({ ...s.artifact, patch: s.artifact.patch + '\n' }));
    await expect(s.workflow.readArtifact('candidate1')).rejects.toThrow('artifact_corrupt');
    await expect(s.workflow.registerCandidate('candidate', s.registered)).rejects.toThrow('artifact_corrupt');
    const audit = join(s.root, 'audit', '0000000001.json'); const event = JSON.parse(await fs.readFile(audit, 'utf8'));
    event.state.findings.finding1.payload.failureCount = 0; await fs.writeFile(audit, JSON.stringify(event));
    await expect(s.workflow.report()).rejects.toThrow('audit_corrupt');
  });
  it.each(['repositoryCommit', 'repositoryTreeOid', 'baseBlobOid', 'baseSourceDigest'] as const)('rejects wrong %s at registration and readiness', async field => {
    const s = await setup(); const value = field === 'baseSourceDigest' ? hash('wrong') : 'f'.repeat(40);
    await expect(s.workflow.registerCandidate('wrong-base', s.sign('author', 'software_candidate', {
      ...s.candidate, id: 'candidate2', artifact: { ...s.artifact, identity: { ...s.artifact.identity, [field]: value } },
    }))).rejects.toThrow('software_base_mismatch');
    s.current.base = { ...s.base, [field]: value };
    await expect(s.workflow.readiness('candidate1')).rejects.toThrow('software_base_mismatch');
  });
  it('rejects signed patch changes with forged digest and alternate arbitrary code even with matching digests', async () => {
    const s = await setup(); const patch = s.artifact.patch.replace('+  private', '+  protected');
    await expect(s.workflow.registerCandidate('changed', s.sign('author', 'software_candidate', {
      ...s.candidate, id: 'candidate2', artifact: { ...s.artifact, patch },
    }))).rejects.toThrow('patch_digest_mismatch');
    const materialized = materializeSoftwarePatch(s.base, patch);
    await expect(s.workflow.registerCandidate('alternate', s.sign('author', 'software_candidate', {
      ...s.candidate, id: 'candidate2', artifact: { ...s.artifact, patch, identity: { ...s.artifact.identity,
        patchDigest: materialized.patchDigest, resultSourceDigest: materialized.resultSourceDigest } },
    }))).rejects.toThrow('synthetic_patch_required');
  });
  it('consumes one final dataset across candidates, including failed or unavailable receipts', async () => {
    for (const status of ['failed', 'incomplete'] as const) {
      const s = await setup(); await s.workflow.attachEvaluation('first', 'candidate1', s.sign('evaluator', 'software_protected_evaluation', {
        ...s.evaluation, status, candidateFailures: status === 'failed' ? 1 : 0,
      }));
      expect(await s.workflow.readiness('candidate1')).toEqual({ ready: false, reason: status });
      await s.workflow.registerCandidate('second', s.sign('author', 'software_candidate', { ...s.candidate, id: 'candidate2' }));
      await expect(s.workflow.attachEvaluation('reused', 'candidate2', s.evaluated)).rejects.toThrow('final_dataset_consumed');
      await s.workflow.attachEvaluation('fresh', 'candidate2', s.sign('evaluator', 'software_protected_evaluation', { ...s.evaluation, datasetDigest: hash(`fresh_${status}`) }));
      expect(await s.workflow.readiness('candidate2')).toMatchObject({ ready: false, reason: 'human_release_required' });
    }
  });
  it('binds evaluation identity, fixed image/evaluator/policy, counts and time, excluding author-signed success', async () => {
    const s = await setup();
    for (const changed of [
      { ...s.evaluation, identity: { ...s.artifact.identity, issueId: 'another_issue' } },
      { ...s.evaluation, identity: { ...s.artifact.identity, policyDigest: hash('wrong') } },
      { ...s.evaluation, evaluatorDigest: hash('wrong') }, { ...s.evaluation, imageDigest: `sha256:${hash('wrong')}` },
      { ...s.evaluation, checks: 11 }, { ...s.evaluation, checks: 13 }, { ...s.evaluation, baselineFailures: 0 },
      { ...s.evaluation, candidateFailures: 1 }, { ...s.evaluation, testedAt: s.clock.now - 1 }, { ...s.evaluation, testedAt: s.clock.now + 1 },
    ]) await expect(s.workflow.attachEvaluation('invalid', 'candidate1', s.sign('evaluator', 'software_protected_evaluation', changed))).rejects.toThrow();
    await expect(s.workflow.attachEvaluation('author-fake', 'candidate1', s.sign('author', 'software_protected_evaluation', s.evaluation))).rejects.toThrow('untrusted_software_protected_evaluation');
    await expect(s.workflow.attachEvaluation('forged', 'candidate1', attest('evaluator', s.keys.author, 'software_protected_evaluation', s.evaluation))).rejects.toThrow('untrusted_software_protected_evaluation');
    expect((await s.workflow.report()).auditEvents).toBe(3);
  });
  it('binds human decisions to entire signed evaluation, artifact, candidate, and current approval window', async () => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated);
    for (const changed of [{ ...s.approval, artifactDigest: hash('wrong') }, { ...s.approval, evaluationDigest: hash(canonical(s.evaluation)) },
      { ...s.approval, approvedAt: s.clock.now - 1 }, { ...s.approval, approvedAt: s.clock.now + 1 }, { ...s.approval, expiresAt: s.clock.now }]) {
      await expect(s.workflow.review('invalid-review', s.sign('human', 'software_release_review', changed))).rejects.toThrow();
    }
    await expect(s.workflow.review('self-review', s.sign('author', 'software_release_review', s.approval))).rejects.toThrow('untrusted_software_release_review');
    await s.workflow.review('review', s.reviewed); s.clock.now += 1000;
    await expect(s.workflow.readiness('candidate1')).rejects.toThrow('approval_binding_mismatch');
  });
  it('honors a signed human rejection and prevents replay from replacing it', async () => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated);
    await s.workflow.review('reject', s.sign('human', 'software_release_review', { ...s.approval, decision: 'reject' }));
    expect(await s.workflow.readiness('candidate1')).toEqual({ ready: false, reason: 'human_rejected' });
    await expect(s.workflow.review('replace', s.reviewed)).rejects.toThrow('review_exists');
  });
  it('rechecks key revocation and enforces distinct authority material at readiness', async () => {
    for (const role of ['analyst', 'author', 'evaluator', 'human'] as const) {
      const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated); await s.workflow.review('review', s.reviewed);
      const pair = generateKeyPairSync('ed25519'); s.trust[role].publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      await expect(s.workflow.readiness('candidate1')).rejects.toThrow('untrusted_software_');
    }
    const s = await setup(); s.trust.human.publicKey = s.trust.author.publicKey;
    await expect(s.workflow.readiness('candidate1')).rejects.toThrow('distinct_ed25519');
  });
  it.each(['readiness', 'reviewPacket'] as const)('fences concurrent lineage revocation during %s base I/O', async method => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated); await s.workflow.review('review', s.reviewed);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const slow = new SoftwareImprovementWorkflow({ ...s.options, currentBase: async () => { entered(); await gate; return s.current.base; } });
    const pending = slow[method]('candidate1'); const rejected = expect(pending).rejects.toThrow('workflow_changed_retry'); await started;
    await s.workflow.revokeLineage('revoke', s.sign('human', 'software_revoke_lineage', { lineageId: s.finding.lineageIds[0] }));
    release(); await rejected;
  });
  it.each(['readiness', 'reviewPacket'] as const)('rechecks dynamic trust and approval expiry after %s I/O', async method => {
    for (const change of ['trust', 'expiry'] as const) {
      const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated); await s.workflow.review('review', s.reviewed);
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
      const slow = new SoftwareImprovementWorkflow({ ...s.options, currentBase: async () => { entered(); await gate; return s.current.base; } });
      const pending = slow[method]('candidate1'); const rejected = expect(pending).rejects.toThrow(change === 'trust' ? 'untrusted_software_release_review' : 'approval_binding_mismatch');
      await started;
      if (change === 'trust') { const pair = generateKeyPairSync('ed25519'); s.trust.human.publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(); }
      else s.clock.now = s.approval.expiresAt;
      release(); await rejected;
    }
  });
  it.each(['readiness', 'reviewPacket'] as const)('rejects in-flight host base drift during %s', async method => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated); await s.workflow.review('review', s.reviewed);
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const slow = new SoftwareImprovementWorkflow({ ...s.options, currentBase: async () => { entered(); await gate; return s.current.base; } });
    const pending = slow[method]('candidate1'); const rejected = expect(pending).rejects.toThrow('software_base_mismatch'); await started;
    s.current.base = { ...s.base, repositoryCommit: 'f'.repeat(40) }; release(); await rejected;
  });
  it('rechecks finding expiry and durable revoked lineage across restart/reimport', async () => {
    const s = await setup(); await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated); await s.workflow.review('review', s.reviewed);
    await s.workflow.revokeLineage('revoke', s.sign('human', 'software_revoke_lineage', { lineageId: s.finding.lineageIds[0] }));
    const restarted = new SoftwareImprovementWorkflow(s.options);
    await expect(restarted.readiness('candidate1')).rejects.toThrow('finding_ineligible');
    await expect(restarted.importFinding('new-finding', s.sign('analyst', 'software_finding', { ...s.finding, id: 'finding2', issueId: 'issue2' }))).rejects.toThrow('finding_ineligible');
    const expired = await setup(); expired.clock.now = expired.finding.expiresAt;
    await expect(expired.workflow.readiness('candidate1')).rejects.toThrow('finding_ineligible');
  });
  it('requires exact scoped signed findings/proposals and enforces overall candidate budget', async () => {
    const s = await setup();
    await expect(s.workflow.importFinding('author-finding', s.sign('author', 'software_finding', s.finding))).rejects.toThrow('untrusted_software_finding');
    await expect(s.workflow.importFinding('wrong-base', s.sign('analyst', 'software_finding', { ...s.finding, id: 'other', issueId: 'other', base: { ...s.finding.base, repositoryCommit: 'f'.repeat(40) } }))).rejects.toThrow('finding_ineligible');
    await expect(s.workflow.propose('wrong-base', s.sign('author', 'software_proposal', { ...s.proposal, id: 'other', base: { ...s.proposal.base, repositoryCommit: 'f'.repeat(40) } }))).rejects.toThrow('proposal_binding_mismatch');
    await expect(s.workflow.propose('unsigned', s.sign('analyst', 'software_proposal', s.proposal))).rejects.toThrow('untrusted_software_proposal');
    await expect(s.workflow.propose('new-budget', s.sign('author', 'software_proposal', { ...s.proposal, id: 'new_proposal' }))).rejects.toThrow('proposal_exists');
    await s.workflow.registerCandidate('candidate2', s.sign('author', 'software_candidate', { ...s.candidate, id: 'candidate2' }));
    await expect(s.workflow.registerCandidate('candidate3', s.sign('author', 'software_candidate', { ...s.candidate, id: 'candidate3' }))).rejects.toThrow('candidate_budget_exhausted');
  });
  it('rejects raw narratives/logs even when signed at all durable boundaries', async () => {
    const s = await setup(); const privateText = 'PRIVATE_VOICE_TRANSCRIPT_CANARY';
    await expect(s.workflow.importFinding('private-finding', s.sign('analyst', 'software_finding', { ...s.finding, narrative: privateText }))).rejects.toThrow();
    await expect(s.workflow.propose('private-proposal', s.sign('author', 'software_proposal', { ...s.proposal, prompt: privateText }))).rejects.toThrow();
    await expect(s.workflow.registerCandidate('private-candidate', s.sign('author', 'software_candidate', { ...s.candidate, transcript: privateText }))).rejects.toThrow();
    await expect(s.workflow.attachEvaluation('private-eval', 'candidate1', s.sign('evaluator', 'software_protected_evaluation', { ...s.evaluation, logs: privateText }))).rejects.toThrow();
    await s.workflow.attachEvaluation('evaluation', 'candidate1', s.evaluated);
    await expect(s.workflow.review('private-review', s.sign('human', 'software_release_review', { ...s.approval, reason: privateText }))).rejects.toThrow();
    const auditBytes = await Promise.all((await fs.readdir(join(s.root, 'audit'))).map(file => fs.readFile(join(s.root, 'audit', file), 'utf8')));
    expect(auditBytes.join('')).not.toContain(privateText); expect((await s.workflow.report()).auditEvents).toBe(4);
  });
});
