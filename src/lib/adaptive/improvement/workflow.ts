/** Server-only local review queue. A filesystem operator is trusted; candidates
 * receive no registry mount. A crashed writer lock requires operator recovery. */
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { protocolReceiptSchema, protocolReservationSchema, type ProtocolReservation, type ProtocolReceipt } from './evaluation/contracts';
import { assessPromotion, improvementCandidateSchema, type ImprovementCandidate, type EvaluationReceipt } from './index';
import { approvalSchema, canonical, evaluationDetailsSchema, findingSchema, hash, identifier, proposalSchema, protectedEvaluationSchema, routingArtifactSchema,
  validateTrust, verifyAttestation, routeCancellation, type Attestation, type HumanApproval, type MinimizedFinding, type Proposal, type RoutingArtifact, type TrustStore } from './contracts';
export interface ProtectedEvaluation {
  receipt: EvaluationReceipt;
  details: z.infer<typeof evaluationDetailsSchema>;
}
interface CandidateRecord { candidate: ImprovementCandidate; proposalId: string; authorKeyId: string; protocol?: Attestation<ProtocolReceipt>; protocolReservation?: Attestation<ProtocolReservation>; evaluation?: Attestation<ProtectedEvaluation>; approval?: Attestation<HumanApproval> }
interface State { findings: Record<string, MinimizedFinding>; proposals: Record<string, Proposal>; candidates: Record<string, CandidateRecord>;
  revokedLineages: string[]; finalUses: string[]; protocolUses?: string[]; rollbacks: Record<string, RollbackReceipt>; operations: Record<string, string> }
interface Event { sequence: number; previous: string; action: string; operationId: string; at: number; state: State; digest: string }
export interface RollbackReceipt { candidateId: string; artifactDigest: string; restoredRevision: string; restoredArtifactDigest: string;
  scope: 'local_rehearsal'; comparisonOnly: true; productionMutation: false; derivedState: 'none_created'; rehearsedAt: number; checks: { candidateOnCancelled: 'stop' | 'continue'; restoredOnCancelled: 'stop' | 'continue' } }
const empty = (): State => ({ findings: {}, proposals: {}, candidates: {}, revokedLineages: [], finalUses: [], rollbacks: {}, operations: {} });
const fail = (reason: string): never => { throw new Error(reason); };
export class ImprovementWorkflow {
  readonly root: string;
  private readonly trust: TrustStore;
  constructor(options: { root: string; trust: TrustStore; now?: () => number }) {
    this.root = resolve(options.root); this.trust = structuredClone(options.trust); validateTrust(this.trust); this.now = options.now ?? Date.now;
  }
  private readonly now: () => number;
  private async load(): Promise<{ state: State; events: Event[] }> {
    const files = (await fs.readdir(join(this.root, 'audit')).catch((e: NodeJS.ErrnoException) => e.code === 'ENOENT' ? [] : Promise.reject(e)))
      .filter(name => name.endsWith('.json')).sort();
    if (files.length > 5000) fail('audit_capacity_reached');
    const events: Event[] = []; let previous = '0'.repeat(64);
    for (const name of files) {
      const entry = JSON.parse(await fs.readFile(join(this.root, 'audit', name), 'utf8')) as Event;
      const { digest, ...body } = entry;
      if (name !== `${String(events.length + 1).padStart(10, '0')}.json` || entry.sequence !== events.length + 1 || entry.previous !== previous || digest !== hash(canonical(body))) fail('audit_corrupt');
      events.push(entry); previous = digest;
    }
    return { state: events.length ? structuredClone(events[events.length - 1].state) : empty(), events };
  }
  private async transaction(operationId: string, action: string, payload: unknown, mutate: (state: State) => void): Promise<void> {
    identifier.parse(operationId);
    await fs.mkdir(join(this.root, 'audit'), { recursive: true, mode: 0o700 });
    const lock = join(this.root, 'writer.lock'); const deadline = Date.now() + 3000;
    while (true) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (Date.now() > deadline) fail('workflow_busy'); await new Promise(r => setTimeout(r, 10)); }
    }
    try {
      const { state, events } = await this.load(); const request = hash(canonical({ action, payload }));
      if (state.operations[operationId]) { if (state.operations[operationId] !== request) fail('idempotency_conflict'); return; }
      mutate(state); state.operations[operationId] = request;
      const body = { sequence: events.length + 1, previous: events.at(-1)?.digest ?? '0'.repeat(64), action, operationId, at: this.now(), state };
      const event = { ...body, digest: hash(canonical(body)) };
      if (Buffer.byteLength(canonical(event)) > 2000000) fail('workflow_capacity_reached');
      const temporary = join(this.root, `.${randomUUID()}.tmp`); const target = join(this.root, 'audit', `${String(body.sequence).padStart(10, '0')}.json`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(canonical(event)); await handle.sync(); } finally { await handle.close(); }
      // Hard link commits once without replacing an existing audit entry.
      await fs.link(temporary, target); await fs.unlink(temporary);
      const directory = await fs.open(join(this.root, 'audit'), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.rmdir(lock); }
  }
  private eligible(state: State, findingId: string): MinimizedFinding {
    const finding = state.findings[findingId];
    if (!finding || finding.expiresAt <= this.now() || finding.lineageIds.some(id => state.revokedLineages.includes(id))) return fail('finding_ineligible');
    return finding;
  }
  async importFinding(operationId: string, envelope: Attestation<MinimizedFinding>): Promise<void> {
    if (!verifyAttestation(envelope, 'analyst', 'approved_finding', this.trust)) fail('untrusted_finding');
    const finding = findingSchema.parse(envelope.payload);
    if (finding.reviewedAt > this.now() || finding.expiresAt <= this.now()) fail('finding_ineligible');
    await this.transaction(operationId, 'finding_imported', envelope, state => { if (state.findings[finding.id]) fail('finding_exists');
      if (finding.lineageIds.some(id => state.revokedLineages.includes(id))) fail('finding_ineligible'); state.findings[finding.id] = finding; });
  }
  async proposeRouting(operationId: string, input: Proposal): Promise<void> {
    const proposal = proposalSchema.parse(input);
    if (proposal.createdAt > this.now()) fail('invalid_proposal_time');
    await this.transaction(operationId, 'proposal_created', proposal, state => { const finding = this.eligible(state, proposal.findingId); if (proposal.baselineRevision !== finding.sourceDigest) fail('proposal_source_mismatch');
      if (state.proposals[proposal.id]) fail('proposal_exists'); state.proposals[proposal.id] = proposal; });
  }
  async registerCandidate(operationId: string, envelope: Attestation<{ proposalId: string; candidate: ImprovementCandidate; artifact: RoutingArtifact }>): Promise<void> {
    if (!verifyAttestation(envelope, 'author', 'candidate_artifact', this.trust)) fail('untrusted_candidate');
    const payload = z.object({ proposalId: identifier, candidate: improvementCandidateSchema, artifact: routingArtifactSchema }).strict().parse(envelope.payload);
    const candidate = payload.candidate; identifier.parse(candidate.id); const artifact = payload.artifact;
    const digest = hash(canonical(artifact));
    if (candidate.artifactDigest !== digest || candidate.candidateRevision !== digest || candidate.authorServiceId !== envelope.keyId ||
      candidate.problemCode !== 'audio_cancellation' || candidate.changedPaths.length !== 1 || candidate.changedPaths[0] !== 'src/features/call/cancellation-routing.ts' || candidate.createdAt > this.now()) fail('candidate_binding_mismatch');
    await this.transaction(operationId, 'candidate_registered', envelope, state => {
      const proposal = state.proposals[payload.proposalId]; if (!proposal) fail('proposal_missing');
      const finding = this.eligible(state, proposal.findingId);
      if (candidate.evidenceKind !== finding.kind || candidate.evidenceIds.length !== 1 || candidate.evidenceIds[0] !== finding.id || candidate.baselineRevision !== proposal.baselineRevision || candidate.createdAt < proposal.createdAt || candidate.evaluationProtocolDigest !== proposal.evaluationProtocolDigest) fail('candidate_binding_mismatch');
      if (Object.values(state.candidates).filter(c => c.proposalId === proposal.id).length >= proposal.budget.maxCandidates) fail('candidate_budget_exhausted');
      if (state.candidates[candidate.id]) fail('candidate_exists');
      state.candidates[candidate.id] = { candidate, proposalId: proposal.id, authorKeyId: envelope.keyId };
    });
    await this.putObject(digest, canonical(artifact));
  }
  private async putObject(digest: string, contents: string): Promise<void> {
    await fs.mkdir(join(this.root, 'objects'), { recursive: true, mode: 0o700 });
    const file = join(this.root, 'objects', digest);
    const temporary = join(this.root, 'objects', `.${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', 0o400);
    try {
      try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
      // A digest path is visible only after complete bytes are durable. Retried
      // registration can repair a crash between registry append and object commit.
      try { await fs.link(temporary, file); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (hash(await fs.readFile(file)) !== digest) fail('artifact_corrupt'); }
      const directory = await fs.open(join(this.root, 'objects'), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  async readArtifact(candidateId: string): Promise<RoutingArtifact> {
    const { state } = await this.load(); const record = state.candidates[candidateId]; if (!record) return fail('candidate_missing');
    this.eligible(state, state.proposals[record.proposalId].findingId);
    const bytes = await fs.readFile(join(this.root, 'objects', record.candidate.artifactDigest));
    if (hash(bytes) !== record.candidate.artifactDigest) fail('artifact_corrupt'); return routingArtifactSchema.parse(JSON.parse(bytes.toString()));
  }
  /** Returns true only for the first committed attempt, false for exact replay.
   * Reserve before giving the protected runner final-case access. A crash burns
   * this final-set attempt; neither a retry nor another candidate may rerun it. */
  async reserveEvaluationProtocol(operationId: string, envelope: Attestation<ProtocolReservation>): Promise<boolean> {
    if (!verifyAttestation(envelope, 'evaluator', 'evaluation_protocol_reservation', this.trust)) fail('untrusted_evaluation_protocol');
    const reservation = protocolReservationSchema.parse(envelope.payload); await this.readArtifact(reservation.candidateId);
    let claimed = false;
    await this.transaction(operationId, 'evaluation_protocol_reserved', envelope, state => {
      const record = state.candidates[reservation.candidateId]; if (!record) return fail('candidate_missing');
      const candidate = record.candidate, proposal = state.proposals[record.proposalId]; this.eligible(state, proposal.findingId);
      if (record.protocolReservation || !candidate.evaluationProtocolDigest || reservation.protocolDigest !== candidate.evaluationProtocolDigest || envelope.keyId === record.authorKeyId ||
        reservation.evaluatorServiceId !== envelope.keyId || reservation.reservedAt < candidate.createdAt || reservation.reservedAt > this.now() || Math.min(reservation.retainUntil, reservation.protocolMetadata.expiresAt) <= this.now() ||
        reservation.candidateRevision !== candidate.candidateRevision || reservation.artifactDigest !== candidate.artifactDigest || reservation.baselineRevision !== candidate.baselineRevision ||
        reservation.baselineArtifactDigest !== proposal.baselineArtifactDigest || reservation.legacyDatasetDigest !== candidate.datasetVersion || reservation.candidateEvaluatorDigest !== candidate.evaluatorVersion ||
        reservation.promotionPolicyDigest !== candidate.promotionPolicyVersion || reservation.budget.maxCases > proposal.budget.maxCases) fail('evaluation_protocol_binding_mismatch');
      state.protocolUses ??= [];
      if (state.protocolUses.includes(reservation.bindings.final)) fail('protocol_final_dataset_consumed');
      state.protocolUses.push(reservation.bindings.final); record.protocolReservation = envelope; claimed = true;
    });
    return claimed;
  }
  async attachEvaluationProtocol(operationId: string, envelope: Attestation<ProtocolReceipt>): Promise<void> {
    if (!verifyAttestation(envelope, 'evaluator', 'evaluation_protocol', this.trust)) fail('untrusted_evaluation_protocol');
    const protocol = protocolReceiptSchema.parse(envelope.payload);
    await this.readArtifact(protocol.candidateId);
    await this.transaction(operationId, 'evaluation_protocol_attached', envelope, state => {
      const record = state.candidates[protocol.candidateId]; if (!record) return fail('candidate_missing');
      const candidate = record.candidate, proposal = state.proposals[record.proposalId]; this.eligible(state, proposal.findingId);
      if (!record.protocolReservation || record.protocolReservation.keyId !== envelope.keyId || record.protocolReservation.payload.protocolDigest !== protocol.protocolDigest || record.protocolReservation.payload.reservedAt > protocol.testedAt) fail('evaluation_protocol_reservation_required');
      if (record.protocol || !candidate.evaluationProtocolDigest || protocol.protocolDigest !== candidate.evaluationProtocolDigest || proposal.evaluationProtocolDigest !== candidate.evaluationProtocolDigest ||
          envelope.keyId === record.authorKeyId || protocol.evaluatorServiceId !== envelope.keyId || protocol.testedAt < candidate.createdAt || protocol.testedAt > this.now() || Math.min(protocol.retainUntil, protocol.protocolMetadata.expiresAt) <= this.now() ||
          protocol.candidateRevision !== candidate.candidateRevision || protocol.artifactDigest !== candidate.artifactDigest || protocol.baselineRevision !== candidate.baselineRevision ||
          protocol.baselineArtifactDigest !== proposal.baselineArtifactDigest || protocol.legacyDatasetDigest !== candidate.datasetVersion || protocol.candidateEvaluatorDigest !== candidate.evaluatorVersion ||
          protocol.promotionPolicyDigest !== candidate.promotionPolicyVersion || protocol.budget.maxCases > proposal.budget.maxCases) fail('evaluation_protocol_binding_mismatch');
      if (!state.protocolUses?.includes(protocol.bindings.final)) fail('evaluation_protocol_reservation_required');
      record.protocol = envelope;
    });
  }
  async attachEvaluation(operationId: string, envelope: Attestation<ProtectedEvaluation>): Promise<void> {
    if (!verifyAttestation(envelope, 'evaluator', 'protected_evaluation', this.trust)) fail('untrusted_evaluation');
    const { details, receipt } = protectedEvaluationSchema.parse(envelope.payload);
    await this.readArtifact(receipt.candidateId);
    await this.transaction(operationId, 'evaluation_attached', envelope, state => {
      const record = state.candidates[receipt.candidateId]; if (!record) fail('candidate_missing');
      const candidate = record.candidate; this.eligible(state, state.proposals[record.proposalId].findingId);
      if (candidate.evaluationProtocolDigest ? (!record.protocol || record.protocol.keyId !== envelope.keyId || record.protocol.payload.status !== 'passed' || Math.min(record.protocol.payload.retainUntil, record.protocol.payload.protocolMetadata.expiresAt) <= this.now() ||
        receipt.evaluationProtocolDigest !== candidate.evaluationProtocolDigest || details.protocolReceiptDigest !== hash(canonical(record.protocol)) || receipt.testedAt < record.protocol.payload.testedAt) :
        (receipt.evaluationProtocolDigest !== undefined || details.protocolReceiptDigest !== undefined)) fail('evaluation_protocol_required');
      if (details.checks > state.proposals[record.proposalId].budget.maxCases) fail('evaluation_case_budget_exceeded');
      if (record.evaluation || envelope.keyId === record.authorKeyId || receipt.evaluatorServiceId !== envelope.keyId ||
        details.baselineArtifactDigest !== state.proposals[record.proposalId].baselineArtifactDigest || details.artifactDigest !== candidate.artifactDigest || details.sourceDigest !== candidate.baselineRevision || details.datasetDigest !== candidate.datasetVersion ||
        details.evaluatorDigest !== candidate.evaluatorVersion || details.policyDigest !== candidate.promotionPolicyVersion || details.checks < 1 || details.candidateFailures > details.checks || details.baselineFailures > details.checks ||
        receipt.failedChecks !== details.candidateFailures || receipt.skippedChecks !== 0 || receipt.privacyFailures !== 0 ||
        receipt.status !== (details.candidateFailures === 0 ? 'passed' : 'failed') || receipt.testedAt < candidate.createdAt || receipt.testedAt > this.now() ||
        receipt.candidateRevision !== candidate.candidateRevision || receipt.artifactDigest !== candidate.artifactDigest || receipt.baselineRevision !== candidate.baselineRevision ||
        receipt.datasetVersion !== candidate.datasetVersion || receipt.evaluatorVersion !== candidate.evaluatorVersion || receipt.promotionPolicyVersion !== candidate.promotionPolicyVersion) fail('evaluation_binding_mismatch');
      // Final corpus is consumed once in this registry, even if failed. A retry needs a newly reviewed final dataset.
      const use = details.datasetDigest; if (state.finalUses.includes(use)) fail('final_dataset_consumed');
      state.finalUses.push(use); record.evaluation = envelope;
    });
  }
  async approve(operationId: string, envelope: Attestation<HumanApproval>): Promise<void> {
    if (!verifyAttestation(envelope, 'human', 'release_review', this.trust)) fail('untrusted_approval'); const approval = approvalSchema.parse(envelope.payload);
    await this.transaction(operationId, 'human_reviewed', envelope, state => {
      const record = state.candidates[approval.candidateId]; if (!record?.evaluation) fail('evaluation_missing');
      this.eligible(state, state.proposals[record.proposalId].findingId);
      if (record.candidate.evaluationProtocolDigest && (!record.protocol || record.protocol.payload.status !== 'passed' || Math.min(record.protocol.payload.retainUntil, record.protocol.payload.protocolMetadata.expiresAt) <= this.now())) fail('evaluation_protocol_required');
      if (record.approval || approval.artifactDigest !== record.candidate.artifactDigest || approval.evaluationDigest !== hash(canonical(record.evaluation)) ||
        approval.approvedAt < record.evaluation!.payload.receipt.testedAt || approval.approvedAt > this.now() || approval.expiresAt <= this.now()) fail('approval_binding_mismatch');
      record.approval = envelope;
    });
  }
  async readiness(candidateId: string) {
    const { state } = await this.load(); const record = state.candidates[candidateId]; if (!record) fail('candidate_missing');
    this.eligible(state, state.proposals[record.proposalId].findingId); await this.readArtifact(candidateId);
    if (record.candidate.evaluationProtocolDigest && (!record.protocol || record.protocol.payload.status !== 'passed' || Math.min(record.protocol.payload.retainUntil, record.protocol.payload.protocolMetadata.expiresAt) <= this.now())) return { ready: false as const, reason: 'failed' as const };
    return assessPromotion(record.candidate, record.evaluation?.payload.receipt, { now: this.now(),
      verifyReceipt: async () => !!record.evaluation && verifyAttestation(record.evaluation, 'evaluator', 'protected_evaluation', this.trust),
      verifyProtocol: async () => !!record.protocol && verifyAttestation(record.protocol, 'evaluator', 'evaluation_protocol', this.trust) &&
        record.protocol.payload.protocolDigest === record.candidate.evaluationProtocolDigest && record.evaluation?.payload.details.protocolReceiptDigest === hash(canonical(record.protocol)),
      humanApproved: async () => !!record.approval && verifyAttestation(record.approval, 'human', 'release_review', this.trust) &&
        record.approval.payload.decision === 'approve' && record.approval.payload.expiresAt > this.now() && record.approval.payload.evaluationDigest === hash(canonical(record.evaluation)),
    });
  }
  async revokeLineage(operationId: string, envelope: Attestation<{ lineageId: string }>): Promise<void> {
    if (!verifyAttestation(envelope, 'human', 'revoke_lineage', this.trust) || !/^[a-f0-9]{64}$/.test(envelope.payload.lineageId)) fail('untrusted_revocation');
    await this.transaction(operationId, 'lineage_revoked', envelope, state => { if (!state.revokedLineages.includes(envelope.payload.lineageId)) state.revokedLineages.push(envelope.payload.lineageId); });
  }
  async rollbackRehearsal(operationId: string, candidateId: string, baseline: RoutingArtifact): Promise<RollbackReceipt> {
    const artifact = routingArtifactSchema.parse(baseline); const { state } = await this.load(); const record = state.candidates[candidateId]; if (!record) fail('candidate_missing');
    if (!(await this.readiness(candidateId)).ready) fail('promotion_not_ready');
    const proposal = state.proposals[record.proposalId]; if (hash(canonical(artifact)) !== proposal.baselineArtifactDigest) fail('rollback_artifact_mismatch');
    await this.putObject(proposal.baselineArtifactDigest, canonical(artifact));
    const result: RollbackReceipt = { candidateId, artifactDigest: record.candidate.artifactDigest, restoredRevision: record.candidate.rollbackRevision,
      restoredArtifactDigest: proposal.baselineArtifactDigest, scope: 'local_rehearsal', comparisonOnly: true, productionMutation: false, derivedState: 'none_created', rehearsedAt: this.now(),
      checks: { candidateOnCancelled: routeCancellation(await this.readArtifact(candidateId), true), restoredOnCancelled: routeCancellation(artifact, true) } };
    await this.transaction(operationId, 'rollback_rehearsed', { candidateId, baseline: artifact }, current => { current.rollbacks[candidateId] = result; });
    return (await this.load()).state.rollbacks[candidateId];
  }
  async listReviewQueue() {
    const { state } = await this.load();
    return { findings: Object.values(state.findings).filter(f => f.expiresAt > this.now() && !f.lineageIds.some(id => state.revokedLineages.includes(id))),
      proposals: Object.values(state.proposals).filter(p => { try { this.eligible(state, p.findingId); return true; } catch { return false; } }),
      candidates: Object.values(state.candidates).map(r => ({ ...r, eligible: (() => { try { this.eligible(state, state.proposals[r.proposalId].findingId); return true; } catch { return false; } })() })) };
  }
  async report() {
    const { state, events } = await this.load(); const queue = await this.listReviewQueue();
    return { schemaVersion: 1, evidenceLevel: 'E1_local_workflow' as const, auditHead: events.at(-1)?.digest ?? null, auditEvents: events.length,
      candidates: queue.candidates.map(r => ({ candidateId: r.candidate.id, artifactDigest: r.candidate.artifactDigest, eligible: r.eligible,
        evaluationStatus: r.evaluation?.payload.receipt.status ?? 'UNAVAILABLE', humanDecision: r.approval?.payload.decision ?? 'UNAVAILABLE',
        rollback: state.rollbacks[r.candidate.id] ?? 'UNAVAILABLE' })), ci: 'UNAVAILABLE', deployment: 'UNAVAILABLE', measuredProductionEffect: 'UNAVAILABLE',
      causalClaim: 'hypothesis_only', cost: 'UNAVAILABLE', productionMutation: false };
  }
}
