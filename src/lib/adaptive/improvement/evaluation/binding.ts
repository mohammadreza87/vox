import { attest, canonical, hash, protectedEvaluationSchema, verifyAttestation, routingArtifactSchema, type Attestation, type TrustStore } from '../contracts';
import { protocolCommitment, evaluationProtocolDigest } from './manifest';
import type { EvaluationManifest } from './contracts';
import { runEvaluation, isProducedLearningCaseReceipt } from './runner';
import { improvementCandidateSchema, type ImprovementCandidate } from '../index';
import type { ImprovementWorkflow, ProtectedEvaluation } from '../workflow';
import { withEvaluationLearningCaseAuthority, type EvaluationLearningCaseAuthority } from './authority';
import { corpusSchema, manifestSchema, protocolReceiptSchema, protocolReservationSchema, type ProtocolReservation, type ProtocolReceipt } from './contracts';
/** Evaluator-owned host integration. The existing protected Docker receipt is
 * still required; this companion never manufactures container execution. */
export interface ProtocolFinalBindingOptions { candidate: ImprovementCandidate; evaluation: Attestation<ProtectedEvaluation>;
  protocol: Attestation<ProtocolReceipt>; trust: TrustStore; evaluatorKeyId: string; evaluatorPrivateKey: string; now: number }
function bindFinal(options: ProtocolFinalBindingOptions, learningCasesAuthorized: boolean): Attestation<ProtectedEvaluation> {
  const candidate = improvementCandidateSchema.parse(options.candidate), trust = options.trust;
  if (!learningCasesAuthorized && (candidate.learningCases || options.protocol.payload.learningCases || options.evaluation.payload.receipt.learningCases))
    throw new Error('learning_case_authority_required');
  if (!verifyAttestation(options.evaluation, 'evaluator', 'protected_evaluation', trust) ||
    !verifyAttestation(options.protocol, 'evaluator', 'evaluation_protocol', trust) || options.evaluation.keyId !== options.evaluatorKeyId || options.protocol.keyId !== options.evaluatorKeyId || options.evaluatorKeyId === candidate.authorServiceId) throw new Error('untrusted_protocol_binding');
  const evaluation = protectedEvaluationSchema.parse(options.evaluation.payload), protocol = protocolReceiptSchema.parse(options.protocol.payload);
  if (canonical(candidate.learningCases) !== canonical(protocol.learningCases)) throw new Error('learning_case_authority_binding_mismatch');
  if (!candidate.evaluationProtocolDigest || protocol.protocolDigest !== candidate.evaluationProtocolDigest || protocol.status !== 'passed' || Math.min(protocol.retainUntil, protocol.protocolMetadata.expiresAt) <= options.now ||
      protocol.testedAt > evaluation.receipt.testedAt || evaluation.receipt.testedAt > options.now || protocol.evaluatorServiceId !== options.evaluatorKeyId ||
      protocol.candidateId !== candidate.id || protocol.candidateRevision !== candidate.candidateRevision || protocol.artifactDigest !== candidate.artifactDigest ||
      protocol.baselineRevision !== candidate.baselineRevision || protocol.baselineArtifactDigest !== evaluation.details.baselineArtifactDigest ||
      protocol.legacyDatasetDigest !== candidate.datasetVersion || protocol.candidateEvaluatorDigest !== candidate.evaluatorVersion || protocol.promotionPolicyDigest !== candidate.promotionPolicyVersion ||
      evaluation.receipt.candidateId !== candidate.id || evaluation.receipt.candidateRevision !== candidate.candidateRevision || evaluation.receipt.artifactDigest !== candidate.artifactDigest ||
      evaluation.details.datasetDigest !== candidate.datasetVersion || evaluation.details.evaluatorDigest !== candidate.evaluatorVersion || evaluation.details.policyDigest !== candidate.promotionPolicyVersion ||
      evaluation.receipt.evaluationProtocolDigest !== undefined || evaluation.details.protocolReceiptDigest !== undefined) throw new Error('evaluation_protocol_binding_mismatch');
  return attest(options.evaluatorKeyId, options.evaluatorPrivateKey, 'protected_evaluation', {
    receipt: { ...evaluation.receipt, evaluationProtocolDigest: candidate.evaluationProtocolDigest, ...(candidate.learningCases ? { schemaVersion: 2 as const, learningCases: candidate.learningCases } : {}) },
    details: { ...evaluation.details, protocolReceiptDigest: hash(canonical(options.protocol)) },
  });
}

/** Legacy binding deliberately cannot qualify an LC1 candidate. */
export function bindProtocolFinalEvaluation(options: ProtocolFinalBindingOptions): Attestation<ProtectedEvaluation> {
  return bindFinal(options, false);
}
/** Sign only inside the current workflow receipt fence, after the reserved run.
 * Returning unsigned metrics from the runner is not signing permission. */
export async function attestLearningCaseProtocol(authority: EvaluationLearningCaseAuthority, rawReceipt: ProtocolReceipt, keyId: string, privateKey: string): Promise<Attestation<ProtocolReceipt>> {
  if (!isProducedLearningCaseReceipt(rawReceipt)) throw new Error('learning_case_runner_receipt_required');
  const receipt = protocolReceiptSchema.parse(rawReceipt);
  if (!receipt.learningCases || keyId !== receipt.evaluatorServiceId) throw new Error('learning_case_authority_binding_mismatch');
  return withEvaluationLearningCaseAuthority(authority, receipt.learningCases, { protocolDigest: receipt.protocolDigest, candidateId: receipt.candidateId, artifactDigest: receipt.artifactDigest },
    'receipt', receipt.bindings.corpus, () => attest(keyId, privateKey, 'evaluation_protocol', receipt));
}
export async function bindLearningCaseFinalEvaluation(authority: EvaluationLearningCaseAuthority, rawOptions: ProtocolFinalBindingOptions): Promise<Attestation<ProtectedEvaluation>> {
  const options = structuredClone(rawOptions), candidate = improvementCandidateSchema.parse(options.candidate);
  if (!candidate.learningCases || !candidate.evaluationProtocolDigest) throw new Error('learning_case_authority_required');
  return withEvaluationLearningCaseAuthority(authority, candidate.learningCases, { protocolDigest: candidate.evaluationProtocolDigest, candidateId: candidate.id, artifactDigest: candidate.artifactDigest },
    'receipt', options.protocol.payload.bindings.corpus, () => bindFinal(options, true));
}

/** Minimized evaluator-owned request; contains no corpus examples/scoring config. */
export function protocolReservationRequest(candidate: ImprovementCandidate, manifest: EvaluationManifest, baselineArtifactDigest: string, evaluatorServiceId: string, reservedAt: number): ProtocolReservation {
  if (canonical(candidate.learningCases) !== canonical(manifest.learningCases)) throw new Error('learning_case_authority_binding_mismatch');
  return { schemaVersion: manifest.schemaVersion, protocolDigest: evaluationProtocolDigest(manifest), candidateId: candidate.id, candidateRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest,
    baselineRevision: candidate.baselineRevision, baselineArtifactDigest, legacyDatasetDigest: candidate.datasetVersion, candidateEvaluatorDigest: candidate.evaluatorVersion, promotionPolicyDigest: candidate.promotionPolicyVersion,
    ...protocolCommitment(manifest), evaluatorServiceId, reservedAt };
}
/** Authoritative workflow entrypoint: reserve final access durably before any
 * adapter call. An exact retry does not rerun an already consumed final set. */
export async function evaluateReservedProtocol(workflow: ImprovementWorkflow, operationId: string, reservation: Attestation<ProtocolReservation>, options: Parameters<typeof runEvaluation>[0]) {
  const frozenReservation = structuredClone(reservation);
  protocolReservationSchema.parse(frozenReservation.payload);
  const frozenOptions: Parameters<typeof runEvaluation>[0] = { ...options, manifest: manifestSchema.parse(options.manifest), corpus: corpusSchema.parse(options.corpus),
    candidate: improvementCandidateSchema.parse(options.candidate), artifact: routingArtifactSchema.parse(options.artifact), baseline: routingArtifactSchema.parse(options.baseline),
    learningCaseAuthority: options.learningCaseAuthority ? { ...options.learningCaseAuthority } : undefined,
    adapter: { evidence: options.adapter.evidence, digest: options.adapter.digest, run: options.adapter.run.bind(options.adapter) } };
  const manifest = manifestSchema.parse(frozenOptions.manifest);
  if (frozenOptions.candidate.id !== frozenReservation.payload.candidateId || frozenOptions.candidate.evaluationProtocolDigest !== frozenReservation.payload.protocolDigest ||
    evaluationProtocolDigest(manifest) !== frozenReservation.payload.protocolDigest) throw new Error('evaluation_protocol_binding_mismatch');
  if (manifest.learningCases && frozenOptions.learningCaseAuthority?.workflow !== workflow) throw new Error('learning_case_authority_required');
  if (manifest.learningCases) await withEvaluationLearningCaseAuthority(frozenOptions.learningCaseAuthority, manifest.learningCases,
    { protocolDigest: evaluationProtocolDigest(manifest) }, 'reservation', manifest.digests.corpus, () => undefined);
  const claimed = await workflow.reserveEvaluationProtocol(operationId, frozenReservation, frozenOptions.learningCaseAuthority?.handle);
  if (!claimed) throw new Error('protocol_attempt_already_reserved');
  return runEvaluation(frozenOptions);
}
