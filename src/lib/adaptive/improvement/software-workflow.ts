/** Local, server-owned review registry. Candidate source is data here, never
 * imported or executed. Filesystem operators are trusted; candidates must not
 * receive this directory. A crashed writer lock needs operator recovery. */
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { approvalSchema, canonical, hash, identifier, sha256, timestamp, validateTrust, verifyAttestation,
  type Attestation, type HumanApproval, type TrustStore } from './contracts';
import { softwareIdentitySchema, softwarePatchArtifactSchema, softwareEvaluationSchema, syntheticSoftwarePatchArtifactSchema, modelSoftwarePatchArtifactSchema,
  type FrozenSoftwareBase, type SoftwareEvaluation, type SoftwarePatchArtifact } from './software-contracts';
import { createSyntheticPersianPatch, materializeSoftwarePatch } from './software-patch';
import { SOFTWARE_AUTHOR_MODEL, SOFTWARE_AUTHOR_POLICY_DIGEST, softwareAuthorAttemptSchema, softwareAuthorInputDigest, type SoftwareAuthorAttempt } from './software-author-contracts';
import { SOFTWARE_EVALUATOR_DIGEST, SOFTWARE_IMAGE_DIGEST, SOFTWARE_POLICY_DIGEST } from './software-sandbox';

export const softwareBaseBindingSchema = softwareIdentitySchema.pick({ repositoryCommit: true, repositoryTreeOid: true,
  targetPath: true, baseBlobOid: true, baseSourceDigest: true });
export function softwareBaseBinding(base: Pick<FrozenSoftwareBase, 'repositoryCommit' | 'repositoryTreeOid' | 'targetPath' | 'baseBlobOid' | 'baseSourceDigest'>) {
  const { repositoryCommit, repositoryTreeOid, targetPath, baseBlobOid, baseSourceDigest } = base;
  return softwareBaseBindingSchema.parse({ repositoryCommit, repositoryTreeOid, targetPath, baseBlobOid, baseSourceDigest });
}
export const softwareFindingSchema = z.object({ schemaVersion: z.literal(1), id: identifier, issueId: identifier,
  kind: z.literal('synthetic'), problemCode: z.literal('persian_sentence_boundary'), purpose: z.literal('product_improvement'),
  base: softwareBaseBindingSchema, lineageIds: z.array(sha256).min(1).max(32),
  sampleCount: z.number().int().min(1).max(128), failureCount: z.number().int().min(1).max(128),
  reviewedAt: timestamp, expiresAt: timestamp,
}).strict().refine(f => f.failureCount <= f.sampleCount && f.expiresAt > f.reviewedAt);
export type SoftwareFinding = z.infer<typeof softwareFindingSchema>;
export const syntheticSoftwareProposalSchema = z.object({ id: identifier, findingId: identifier,
  hypothesis: z.literal('recognize_persian_question_mark'), authorMode: z.literal('deterministic_synthetic'),
  base: softwareBaseBindingSchema, policyDigest: z.literal(SOFTWARE_POLICY_DIGEST), createdAt: timestamp,
  budget: z.object({ maxCandidates: z.number().int().min(1).max(4), maxCases: z.number().int().min(12).max(128) }).strict(),
}).strict();
export const modelSoftwareProposalSchema = syntheticSoftwareProposalSchema.omit({ authorMode: true }).extend({
  schemaVersion: z.literal(2), authorMode: z.literal('openai_responses'), authorPolicyDigest: z.literal(SOFTWARE_AUTHOR_POLICY_DIGEST),
}).strict();
export const softwareProposalSchema = z.union([syntheticSoftwareProposalSchema, modelSoftwareProposalSchema]);
export type SoftwareProposal = z.infer<typeof softwareProposalSchema>;
export type ModelSoftwareProposal = z.infer<typeof modelSoftwareProposalSchema>;
export interface SoftwareAuthorContext { signedFinding: Attestation<SoftwareFinding>; signedProposal: Attestation<ModelSoftwareProposal>; base: FrozenSoftwareBase }
const authorReceiptSchema = z.object({ schemaVersion:z.literal(1),keyId:identifier,purpose:z.literal('software_author_attempt'),
  payload:softwareAuthorAttemptSchema,signature:z.string().min(1).max(256) }).strict();
export const syntheticSoftwareCandidateSchema = z.object({ id: identifier, proposalId: identifier, createdAt: timestamp,
  artifact: syntheticSoftwarePatchArtifactSchema }).strict();
export const modelSoftwareCandidateSchema = z.object({ schemaVersion:z.literal(2),id:identifier,proposalId:identifier,createdAt:timestamp,
  artifact:modelSoftwarePatchArtifactSchema,authorReceipt:authorReceiptSchema }).strict();
export const softwareCandidateSchema = z.union([syntheticSoftwareCandidateSchema,modelSoftwareCandidateSchema]);
export type SoftwareCandidate = z.infer<typeof softwareCandidateSchema>;
export type SoftwareReview = HumanApproval;
interface RecordEntry { registration: Attestation<SoftwareCandidate>; artifactDigest: string;
  evaluation?: Attestation<SoftwareEvaluation>; review?: Attestation<SoftwareReview> }
export interface SoftwareAuthorReservation { schemaVersion:1; operationId:string; proposalId:string; authorKeyId:string;
  findingDigest:string; proposalDigest:string; sourceDigest:string; authorPolicyDigest:string; issuedAt:number }
interface State { authorReservations?:Record<string,SoftwareAuthorReservation>; findings: Record<string, Attestation<SoftwareFinding>>; proposals: Record<string, Attestation<SoftwareProposal>>;
  candidates: Record<string, RecordEntry>; revokedLineages: string[]; finalUses: string[]; operations: Record<string, string> }
interface Event { sequence: number; previous: string; action: string; operationId: string; at: number; state: State; digest: string }
const empty = (): State => ({ findings: {}, proposals: {}, candidates: {}, revokedLineages: [], finalUses: [], operations: {} });
const fail = (reason: string): never => { throw new Error(reason); };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export interface SoftwareWorkflowOptions { root: string; trust: TrustStore | (() => TrustStore); now?: () => number;
  /** Trusted host reads the current reviewed repository baseline, never a candidate
   * checkout. Readiness is advisory at this read's point in time; an eventual
   * mutating consumer requires shared baseline/version coordination. */
  currentBase: () => Promise<FrozenSoftwareBase> }
export class SoftwareImprovementWorkflow {
  readonly root: string;
  private readonly now: () => number;
  constructor(private readonly options: SoftwareWorkflowOptions) {
    this.root = resolve(options.root); this.now = options.now ?? Date.now; validateTrust(this.trust());
  }
  private trust() { return typeof this.options.trust === 'function' ? this.options.trust() : this.options.trust; }
  private trusted<T>(envelope: Attestation<T>, role: 'analyst' | 'author' | 'evaluator' | 'human', purpose: string) {
    const trust = this.trust(); validateTrust(trust);
    if (!verifyAttestation(envelope, role, purpose, trust)) fail(`untrusted_${purpose}`);
  }
  private async load(): Promise<{ state: State; events: Event[] }> {
    const files = (await fs.readdir(join(this.root, 'audit')).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error)))
      .filter(name => name.endsWith('.json')).sort();
    if (files.length > 5000) fail('audit_capacity_reached');
    const events: Event[] = []; let previous = '0'.repeat(64);
    for (const name of files) {
      const entry = JSON.parse(await fs.readFile(join(this.root, 'audit', name), 'utf8')) as Event;
      const { digest, ...body } = entry;
      if (name !== `${String(events.length + 1).padStart(10, '0')}.json` || entry.sequence !== events.length + 1 ||
        entry.previous !== previous || digest !== hash(canonical(body))) fail('audit_corrupt');
      events.push(entry); previous = digest;
    }
    return { state: events.length ? structuredClone(events[events.length - 1].state) : empty(), events };
  }
  private async transaction(operationId: string, action: string, payload: unknown, mutate: (state: State) => void): Promise<void> {
    identifier.parse(operationId); await fs.mkdir(join(this.root, 'audit'), { recursive: true, mode: 0o700 });
    const lock = join(this.root, 'writer.lock'); const deadline = Date.now() + 3000;
    while (true) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (Date.now() > deadline) fail('workflow_busy'); await new Promise(done => setTimeout(done, 10)); }
    }
    try {
      const { state, events } = await this.load(); const request = hash(canonical({ action, payload }));
      if (state.operations[operationId]) { if (state.operations[operationId] !== request) fail('idempotency_conflict'); return; }
      mutate(state); state.operations[operationId] = request;
      const body = { sequence: events.length + 1, previous: events.at(-1)?.digest ?? '0'.repeat(64), action, operationId, at: this.now(), state };
      const event = { ...body, digest: hash(canonical(body)) };
      if (Buffer.byteLength(canonical(event)) > 2000000) fail('workflow_capacity_reached');
      const temporary = join(this.root, `.${randomUUID()}.tmp`); const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(canonical(event)); await handle.sync(); } finally { await handle.close(); }
        await fs.link(temporary, join(this.root, 'audit', `${String(body.sequence).padStart(10, '0')}.json`));
        const directory = await fs.open(join(this.root, 'audit'), 'r'); try { await directory.sync(); } finally { await directory.close(); }
      } finally { await fs.unlink(temporary).catch(() => undefined); }
    } finally { await fs.rmdir(lock); }
  }
  private eligible(state: State, findingId: string): SoftwareFinding {
    const envelope = state.findings[findingId]; if (!envelope) return fail('finding_missing');
    this.trusted(envelope, 'analyst', 'software_finding'); const finding = softwareFindingSchema.parse(envelope.payload);
    if (finding.expiresAt <= this.now() || finding.reviewedAt > this.now() || finding.lineageIds.some(id => state.revokedLineages.includes(id))) fail('finding_ineligible');
    return finding;
  }
  private context(state: State, candidateId: string) {
    identifier.parse(candidateId); const record = state.candidates[candidateId]; if (!record) return fail('candidate_missing');
    this.trusted(record.registration, 'author', 'software_candidate');
    const registration = softwareCandidateSchema.parse(record.registration.payload);
    const proposalEnvelope = state.proposals[registration.proposalId]; if (!proposalEnvelope) return fail('proposal_missing');
    this.trusted(proposalEnvelope, 'author', 'software_proposal'); const proposal = softwareProposalSchema.parse(proposalEnvelope.payload);
    if (proposalEnvelope.keyId !== record.registration.keyId) fail('candidate_author_mismatch');
    const finding = this.eligible(state, proposal.findingId);
    if (!same(proposal.base,finding.base)) fail('proposal_binding_mismatch');
    this.validateProvenance(registration, proposalEnvelope, state.findings[finding.id],state.authorReservations?.[proposal.id]);
    return { record, registration, proposal, finding };
  }
  private validateProvenance(registration: SoftwareCandidate, signedProposal: Attestation<SoftwareProposal>, signedFinding: Attestation<SoftwareFinding>, reservation?:SoftwareAuthorReservation) {
    const proposal = softwareProposalSchema.parse(signedProposal.payload);
    if (registration.artifact.authorMode !== proposal.authorMode) fail('author_mode_mismatch');
    if (registration.artifact.authorMode === 'deterministic_synthetic') {
      if ('authorReceipt' in registration || 'schemaVersion' in registration) fail('author_mode_mismatch');
      return;
    }
    if (!('authorReceipt' in registration) || proposal.authorMode !== 'openai_responses') return fail('model_author_receipt_required');
    if (!reservation) return fail('model_author_reservation_required');
    const receipt = registration.authorReceipt;
    this.trusted(receipt,'author','software_author_attempt');
    const attempt: SoftwareAuthorAttempt = softwareAuthorAttemptSchema.parse(receipt.payload);
    if (receipt.keyId !== signedProposal.keyId || reservation.authorKeyId !== receipt.keyId || attempt.reservationDigest !== hash(canonical(reservation)) ||
      reservation.proposalId !== proposal.id || reservation.proposalDigest !== hash(canonical(signedProposal)) ||
      reservation.findingDigest !== hash(canonical(signedFinding)) || reservation.sourceDigest !== registration.artifact.identity.baseSourceDigest ||
      reservation.authorPolicyDigest !== SOFTWARE_AUTHOR_POLICY_DIGEST || attempt.startedAt < reservation.issuedAt ||
      attempt.status !== 'completed' ||
      attempt.findingDigest !== hash(canonical(signedFinding)) || attempt.proposalDigest !== hash(canonical(signedProposal)) ||
      attempt.sourceDigest !== registration.artifact.identity.baseSourceDigest || attempt.patchDigest !== registration.artifact.identity.patchDigest ||
      attempt.authorPolicyDigest !== proposal.authorPolicyDigest || attempt.authorPolicyDigest !== SOFTWARE_AUTHOR_POLICY_DIGEST ||
      attempt.requestedModel !== SOFTWARE_AUTHOR_MODEL || attempt.returnedModel !== SOFTWARE_AUTHOR_MODEL ||
      attempt.startedAt < proposal.createdAt || attempt.finishedAt > registration.createdAt || registration.createdAt > this.now() ||
      registration.artifact.authorReceiptDigest !== hash(canonical(receipt))) fail('author_receipt_binding_mismatch');
  }
  private validateArtifact(artifact: SoftwarePatchArtifact, finding: SoftwareFinding, base: FrozenSoftwareBase, registration?: SoftwareCandidate) {
    if (!same(softwareBaseBinding(base), finding.base) || !same(softwareBaseBinding(artifact.identity), finding.base) ||
      artifact.identity.issueId !== finding.issueId || artifact.identity.policyDigest !== SOFTWARE_POLICY_DIGEST) fail('software_base_mismatch');
    const materialized = materializeSoftwarePatch(base, artifact.patch);
    if (materialized.patchDigest !== artifact.identity.patchDigest || materialized.resultSourceDigest !== artifact.identity.resultSourceDigest) fail('patch_digest_mismatch');
    if (artifact.authorMode === 'deterministic_synthetic') {
      if (!same(artifact, createSyntheticPersianPatch(base, finding.issueId, SOFTWARE_POLICY_DIGEST))) fail('synthetic_patch_required');
    } else {
      if (!registration || !('authorReceipt' in registration)) return fail('model_author_receipt_required');
      if (registration.authorReceipt.payload.inputDigest !== softwareAuthorInputDigest(base.source)) fail('author_input_digest_mismatch');
    }
  }
  /** Trusted host seam for bounded model authoring. No evaluator data or keys
   * leave this method. Re-query before provider use and after its response. */
  async authorContext(proposalId: string): Promise<SoftwareAuthorContext> {
    identifier.parse(proposalId);
    const first = await this.load();
    const envelope = first.state.proposals[proposalId]; if (!envelope) return fail('proposal_missing');
    this.trusted(envelope,'author','software_proposal');
    const proposal = modelSoftwareProposalSchema.parse(envelope.payload);
    this.eligible(first.state,proposal.findingId);
    const base = await this.options.currentBase(); const latest = await this.load();
    if (first.events.at(-1)?.digest !== latest.events.at(-1)?.digest) fail('workflow_changed_retry');
    const signedProposal = latest.state.proposals[proposalId]; this.trusted(signedProposal,'author','software_proposal');
    const currentProposal = modelSoftwareProposalSchema.parse(signedProposal.payload);
    const finding = this.eligible(latest.state,currentProposal.findingId);
    if (!same(currentProposal.base,finding.base) || !same(finding.base,softwareBaseBinding(base)) || currentProposal.createdAt > this.now()) fail('software_base_mismatch');
    // Validate frozen source and blob without interpreting source as host code.
    createSyntheticPersianPatch(base,finding.issueId,SOFTWARE_POLICY_DIGEST);
    return { signedFinding:latest.state.findings[finding.id],signedProposal:{...signedProposal,payload:currentProposal},base:structuredClone(base) };
  }
  /** One durable request slot per proposal, including errors and crashes. A
   * replay never grants a second dispatch, even with an identical operation ID.
   * The trusted host owns this capability; it must reserve before paid I/O. */
  async reserveAuthorAttempt(operationId:string,proposalId:string):Promise<{reservationDigest:string;issuedAt:number}> {
    const context = await this.authorContext(proposalId); let issued:SoftwareAuthorReservation | undefined;
    await this.transaction(operationId,'author_attempt_reserved',{proposalId},state=>{
      const envelope = state.proposals[proposalId]; if (!envelope) return fail('proposal_missing');
      this.trusted(envelope,'author','software_proposal'); const proposal = modelSoftwareProposalSchema.parse(envelope.payload);
      const finding = this.eligible(state,proposal.findingId);
      if (!same(envelope,context.signedProposal) || !same(state.findings[finding.id],context.signedFinding) ||
        !same(finding.base,softwareBaseBinding(context.base))) fail('software_author_context_changed');
      if (state.authorReservations?.[proposalId]) fail('author_attempt_already_reserved');
      issued = {schemaVersion:1,operationId,proposalId,authorKeyId:envelope.keyId,
        findingDigest:hash(canonical(state.findings[finding.id])),proposalDigest:hash(canonical(envelope)),
        sourceDigest:context.base.baseSourceDigest,authorPolicyDigest:proposal.authorPolicyDigest,issuedAt:this.now()};
      (state.authorReservations ??= {})[proposalId] = issued;
    });
    if (!issued) return fail('author_attempt_already_reserved');
    return {reservationDigest:hash(canonical(issued)),issuedAt:issued.issuedAt};
  }
  async importFinding(operationId: string, envelope: Attestation<SoftwareFinding>): Promise<void> {
    this.trusted(envelope, 'analyst', 'software_finding'); const finding = softwareFindingSchema.parse(envelope.payload);
    const base = await this.options.currentBase();
    if (!same(finding.base, softwareBaseBinding(base)) || finding.reviewedAt > this.now() || finding.expiresAt <= this.now()) fail('finding_ineligible');
    // Validates source bytes and Git blob binding without running the source.
    createSyntheticPersianPatch(base, finding.issueId, SOFTWARE_POLICY_DIGEST);
    await this.transaction(operationId, 'finding_imported', envelope, state => {
      if (state.findings[finding.id] || Object.values(state.findings).some(item => item.payload.issueId === finding.issueId)) fail('finding_exists');
      if (finding.lineageIds.some(id => state.revokedLineages.includes(id))) fail('finding_ineligible'); state.findings[finding.id] = envelope;
    });
  }
  async propose(operationId: string, envelope: Attestation<SoftwareProposal>): Promise<void> {
    this.trusted(envelope, 'author', 'software_proposal'); const proposal = softwareProposalSchema.parse(envelope.payload);
    await this.transaction(operationId, 'proposal_created', envelope, state => {
      const finding = this.eligible(state, proposal.findingId);
      if (!same(proposal.base, finding.base) || proposal.createdAt < finding.reviewedAt || proposal.createdAt > this.now()) fail('proposal_binding_mismatch');
      if (state.proposals[proposal.id] || Object.values(state.proposals).some(item => item.payload.findingId === finding.id)) fail('proposal_exists');
      state.proposals[proposal.id] = envelope;
    });
  }
  private async putObject(digest: string, contents: string) {
    await fs.mkdir(join(this.root, 'objects'), { recursive: true, mode: 0o700 });
    const temporary = join(this.root, 'objects', `.${randomUUID()}.tmp`); const handle = await fs.open(temporary, 'wx', 0o400);
    try {
      try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
      try { await fs.link(temporary, join(this.root, 'objects', digest)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (hash(await fs.readFile(join(this.root, 'objects', digest))) !== digest) fail('artifact_corrupt'); }
      const directory = await fs.open(join(this.root, 'objects'), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  async registerCandidate(operationId: string, envelope: Attestation<SoftwareCandidate>): Promise<void> {
    this.trusted(envelope, 'author', 'software_candidate'); const registration = softwareCandidateSchema.parse(envelope.payload);
    const { state } = await this.load(); const proposalEnvelope = state.proposals[registration.proposalId]; if (!proposalEnvelope) fail('proposal_missing');
    this.trusted(proposalEnvelope, 'author', 'software_proposal'); const finding = this.eligible(state, proposalEnvelope.payload.findingId);
    const base = await this.options.currentBase();
    this.trusted(envelope,'author','software_candidate');
    this.validateProvenance(registration,proposalEnvelope,state.findings[finding.id],state.authorReservations?.[proposalEnvelope.payload.id]);
    this.validateArtifact(registration.artifact, finding, base, registration);
    const artifactDigest = hash(canonical(registration.artifact));
    // Publishing before the audit append avoids an observable ready record with
    // missing bytes. Failed or interrupted publication leaves at most an inert
    // digest-addressed orphan; identical retry repairs it without overwriting.
    await this.putObject(artifactDigest, canonical(registration.artifact));
    await this.transaction(operationId, 'candidate_registered', envelope, current => {
      const proposal = current.proposals[registration.proposalId]; if (!proposal) fail('proposal_missing');
      this.trusted(envelope,'author','software_candidate');
      this.trusted(proposal, 'author', 'software_proposal'); const currentFinding = this.eligible(current, proposal.payload.findingId);
      this.validateProvenance(registration,proposal,current.findings[currentFinding.id],current.authorReservations?.[proposal.payload.id]);
      this.validateArtifact(registration.artifact,currentFinding,base,registration);
      if (envelope.keyId !== proposal.keyId || registration.createdAt < proposal.payload.createdAt || registration.createdAt > this.now()) fail('candidate_binding_mismatch');
      if (current.candidates[registration.id]) fail('candidate_exists');
      if (Object.values(current.candidates).filter(item => item.registration.payload.proposalId === registration.proposalId).length >= proposal.payload.budget.maxCandidates) fail('candidate_budget_exhausted');
      current.candidates[registration.id] = { registration: envelope, artifactDigest };
    });
  }
  private async artifact(record: RecordEntry): Promise<SoftwarePatchArtifact> {
    const bytes = await fs.readFile(join(this.root, 'objects', sha256.parse(record.artifactDigest)));
    if (hash(bytes) !== record.artifactDigest) fail('artifact_corrupt');
    const artifact = softwarePatchArtifactSchema.parse(JSON.parse(bytes.toString()));
    if (!same(artifact, record.registration.payload.artifact)) fail('artifact_binding_mismatch'); return artifact;
  }
  async readArtifact(candidateId: string): Promise<SoftwarePatchArtifact> {
    return (await this.snapshot(candidateId)).artifact;
  }
  private async snapshot(candidateId: string) {
    const first = await this.load(); const original = this.context(first.state, candidateId);
    const artifact = await this.artifact(original.record); const base = await this.options.currentBase();
    const latest = await this.load();
    // All asynchronous work ends before the final authority/expiry checks. A
    // concurrent durable revoke/review/import invalidates this advisory read.
    // Host repository state is a separate authority, not atomically owned by
    // this local audit registry; there is deliberately no promotion consumer.
    if (first.events.at(-1)?.digest !== latest.events.at(-1)?.digest) fail('workflow_changed_retry');
    const context = this.context(latest.state, candidateId); this.validateArtifact(artifact, context.finding, base, context.registration);
    return { context, artifact };
  }
  private validateEvaluation(envelope: Attestation<SoftwareEvaluation>, context: ReturnType<SoftwareImprovementWorkflow['context']>) {
    this.trusted(envelope, 'evaluator', 'software_protected_evaluation'); const evaluation = softwareEvaluationSchema.parse(envelope.payload);
    if (!same(evaluation.identity, context.registration.artifact.identity) || evaluation.imageDigest !== SOFTWARE_IMAGE_DIGEST ||
      evaluation.evaluatorDigest !== SOFTWARE_EVALUATOR_DIGEST || evaluation.testedAt < context.registration.createdAt || evaluation.testedAt > this.now() ||
      evaluation.checks !== 12 || evaluation.checks > context.proposal.budget.maxCases || envelope.keyId === context.record.registration.keyId ||
      (evaluation.status === 'failed' && evaluation.candidateFailures === 0 && evaluation.baselineFailures > 0)) fail('evaluation_binding_mismatch');
    return evaluation;
  }
  async attachEvaluation(operationId: string, candidateId: string, envelope: Attestation<SoftwareEvaluation>): Promise<void> {
    await this.readArtifact(candidateId);
    await this.transaction(operationId, 'evaluation_attached', { candidateId, envelope }, state => {
      const context = this.context(state, candidateId); const evaluation = this.validateEvaluation(envelope, context);
      if (context.record.evaluation) fail('evaluation_exists');
      if (state.finalUses.includes(evaluation.datasetDigest)) fail('final_dataset_consumed');
      state.finalUses.push(evaluation.datasetDigest); context.record.evaluation = envelope;
    });
  }
  private validateReview(envelope: Attestation<SoftwareReview>, context: ReturnType<SoftwareImprovementWorkflow['context']>) {
    this.trusted(envelope, 'human', 'software_release_review'); const review = approvalSchema.parse(envelope.payload);
    if (!context.record.evaluation) return fail('evaluation_missing');
    if (review.candidateId !== context.registration.id || review.artifactDigest !== context.record.artifactDigest ||
      review.evaluationDigest !== hash(canonical(context.record.evaluation)) || review.approvedAt < context.record.evaluation.payload.testedAt ||
      review.approvedAt > this.now() || review.expiresAt <= this.now()) fail('approval_binding_mismatch'); return review;
  }
  async review(operationId: string, envelope: Attestation<SoftwareReview>): Promise<void> {
    const review = approvalSchema.parse(envelope.payload); await this.readArtifact(review.candidateId);
    await this.transaction(operationId, 'human_reviewed', envelope, state => {
      const context = this.context(state, review.candidateId); if (!context.record.evaluation) return fail('evaluation_missing');
      this.validateEvaluation(context.record.evaluation, context); this.validateReview(envelope, context);
      if (context.record.review) fail('review_exists'); context.record.review = envelope;
    });
  }
  private readinessFor(context: ReturnType<SoftwareImprovementWorkflow['context']>): { ready: boolean; reason: string } {
    if (!context.record.evaluation) return { ready: false, reason: 'evaluation_required' };
    const evaluation = this.validateEvaluation(context.record.evaluation, context);
    if (evaluation.status !== 'passed') return { ready: false, reason: evaluation.status };
    if (!context.record.review) return { ready: false, reason: 'human_release_required' };
    const review = this.validateReview(context.record.review, context);
    return review.decision === 'approve' ? { ready: true, reason: 'local_pr_review_ready' } : { ready: false, reason: 'human_rejected' };
  }
  async readiness(candidateId: string): Promise<{ ready: boolean; reason: string }> {
    return this.readinessFor((await this.snapshot(candidateId)).context);
  }
  async revokeLineage(operationId: string, envelope: Attestation<{ lineageId: string }>) {
    this.trusted(envelope, 'human', 'software_revoke_lineage'); const payload = z.object({ lineageId: sha256 }).strict().parse(envelope.payload);
    await this.transaction(operationId, 'lineage_revoked', envelope, state => {
      if (!state.revokedLineages.includes(payload.lineageId)) state.revokedLineages.push(payload.lineageId);
    });
  }
  /** Pure review material. No remote branch, PR, Git write or deployment action. */
  async reviewPacket(candidateId: string) {
    const { context, artifact } = await this.snapshot(candidateId); const readiness = this.readinessFor(context);
    return { schemaVersion: 1, scope: 'local_pr_review' as const, title: 'Recognize Persian question marks in sentence detection',
      body: `Synthetic issue ${context.finding.issueId}: the frozen sentence detector does not emit Persian question-mark boundaries.\n\n` +
        `${artifact.authorMode === 'openai_responses' ? 'Model-authored patch (OpenAI Responses)' : 'Deterministic synthetic patch'}; target: ${artifact.identity.targetPath}. Base commit: ${artifact.identity.repositoryCommit}. ` +
        `Artifact: ${context.record.artifactDigest}. Evaluation: ${context.record.evaluation?.payload.status ?? 'UNAVAILABLE'}. ` +
        `Human review: ${context.record.review?.payload.decision ?? 'UNAVAILABLE'}.\n\n` +
        'Local evidence only. CI, deployment and measured production effect: UNAVAILABLE. ' +
        'Rollback review: compare the exact recorded base blob with the materialized patch in a separate local review; no production mutation is performed.',
      patch: artifact.patch, evidence: { identity: artifact.identity, artifactDigest: context.record.artifactDigest,
        authorMode: artifact.authorMode, ...('authorReceipt' in context.registration ? {authorReceipt:context.registration.authorReceipt} : {}), evaluation: context.record.evaluation ?? null, humanReview: context.record.review ?? null, readiness },
      productionMutation: false, remotePublished: false };
  }
  async report() {
    const { state, events } = await this.load();
    return { schemaVersion: 1, scope: 'local_software_workflow', auditHead: events.at(-1)?.digest ?? null, auditEvents: events.length,
      candidates: Object.values(state.candidates).map(record => ({ candidateId: record.registration.payload.id, artifactDigest: record.artifactDigest,
        evaluationStatus: record.evaluation?.payload.status ?? 'UNAVAILABLE', humanDecision: record.review?.payload.decision ?? 'UNAVAILABLE' })),
      ci: 'UNAVAILABLE', deployment: 'UNAVAILABLE', measuredProductionEffect: 'UNAVAILABLE', productionMutation: false, remotePublished: false };
  }
}
