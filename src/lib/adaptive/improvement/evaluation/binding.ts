import { attest, canonical, hash, protectedEvaluationSchema, verifyAttestation, type Attestation, type TrustStore } from '../contracts';
import { protocolCommitment, evaluationProtocolDigest } from './manifest';
import type { EvaluationManifest } from './contracts';
import { runEvaluation } from './runner';
import type { ImprovementCandidate } from '../index';
import type { ImprovementWorkflow, ProtectedEvaluation } from '../workflow';
import { protocolReceiptSchema, type ProtocolReservation, type ProtocolReceipt } from './contracts';
/** Evaluator-owned host integration. The existing protected Docker receipt is
 * still required; this companion never manufactures container execution. */
export function bindProtocolFinalEvaluation(options: { candidate: ImprovementCandidate; evaluation: Attestation<ProtectedEvaluation>;
  protocol: Attestation<ProtocolReceipt>; trust: TrustStore; evaluatorKeyId: string; evaluatorPrivateKey: string; now: number }): Attestation<ProtectedEvaluation> {
  const { candidate, trust } = options;
  if (!verifyAttestation(options.evaluation, 'evaluator', 'protected_evaluation', trust) ||
    !verifyAttestation(options.protocol, 'evaluator', 'evaluation_protocol', trust) || options.evaluation.keyId !== options.evaluatorKeyId || options.protocol.keyId !== options.evaluatorKeyId || options.evaluatorKeyId === candidate.authorServiceId) throw new Error('untrusted_protocol_binding');
  const evaluation = protectedEvaluationSchema.parse(options.evaluation.payload), protocol = protocolReceiptSchema.parse(options.protocol.payload);
  if (!candidate.evaluationProtocolDigest || protocol.protocolDigest !== candidate.evaluationProtocolDigest || protocol.status !== 'passed' || Math.min(protocol.retainUntil, protocol.protocolMetadata.expiresAt) <= options.now ||
      protocol.testedAt > evaluation.receipt.testedAt || evaluation.receipt.testedAt > options.now || protocol.evaluatorServiceId !== options.evaluatorKeyId ||
      protocol.candidateId !== candidate.id || protocol.candidateRevision !== candidate.candidateRevision || protocol.artifactDigest !== candidate.artifactDigest ||
      protocol.baselineRevision !== candidate.baselineRevision || protocol.baselineArtifactDigest !== evaluation.details.baselineArtifactDigest ||
      protocol.legacyDatasetDigest !== candidate.datasetVersion || protocol.candidateEvaluatorDigest !== candidate.evaluatorVersion || protocol.promotionPolicyDigest !== candidate.promotionPolicyVersion ||
      evaluation.receipt.candidateId !== candidate.id || evaluation.receipt.candidateRevision !== candidate.candidateRevision || evaluation.receipt.artifactDigest !== candidate.artifactDigest ||
      evaluation.details.datasetDigest !== candidate.datasetVersion || evaluation.details.evaluatorDigest !== candidate.evaluatorVersion || evaluation.details.policyDigest !== candidate.promotionPolicyVersion ||
      evaluation.receipt.evaluationProtocolDigest !== undefined || evaluation.details.protocolReceiptDigest !== undefined) throw new Error('evaluation_protocol_binding_mismatch');
  return attest(options.evaluatorKeyId, options.evaluatorPrivateKey, 'protected_evaluation', {
    receipt: { ...evaluation.receipt, evaluationProtocolDigest: candidate.evaluationProtocolDigest },
    details: { ...evaluation.details, protocolReceiptDigest: hash(canonical(options.protocol)) },
  });
}

/** Minimized evaluator-owned request; contains no corpus examples/scoring config. */
export function protocolReservationRequest(candidate: ImprovementCandidate, manifest: EvaluationManifest, baselineArtifactDigest: string, evaluatorServiceId: string, reservedAt: number): ProtocolReservation {
  return { schemaVersion: 1, protocolDigest: evaluationProtocolDigest(manifest), candidateId: candidate.id, candidateRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest,
    baselineRevision: candidate.baselineRevision, baselineArtifactDigest, legacyDatasetDigest: candidate.datasetVersion, candidateEvaluatorDigest: candidate.evaluatorVersion, promotionPolicyDigest: candidate.promotionPolicyVersion,
    ...protocolCommitment(manifest), evaluatorServiceId, reservedAt };
}
/** Authoritative workflow entrypoint: reserve final access durably before any
 * adapter call. An exact retry does not rerun an already consumed final set. */
export async function evaluateReservedProtocol(workflow: ImprovementWorkflow, operationId: string, reservation: Attestation<ProtocolReservation>, options: Parameters<typeof runEvaluation>[0]) {
  if (options.candidate.id !== reservation.payload.candidateId || options.candidate.evaluationProtocolDigest !== reservation.payload.protocolDigest) throw new Error('evaluation_protocol_binding_mismatch');
  const claimed = await workflow.reserveEvaluationProtocol(operationId, reservation);
  if (!claimed) throw new Error('protocol_attempt_already_reserved');
  return runEvaluation(options);
}
