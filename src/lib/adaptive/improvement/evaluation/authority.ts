import { canonical, hash } from '../contracts';
import { ImprovementWorkflow } from '../workflow';
import type { PreparedLearningCases } from '../learning-cases/contracts';
import type { EvaluationCorpus, LearningCaseCommitment } from './contracts';

export interface EvaluationLearningCaseAuthority {
  readonly workflow: ImprovementWorkflow;
  readonly handle: PreparedLearningCases;
}
export type LearningCasePhase = 'optimization' | 'reservation' | 'adapter' | 'result' | 'receipt';
export interface LearningCaseBinding {
  protocolDigest: string;
  lineageDigest: string;
  candidateId?: string;
  artifactDigest?: string;
}
/** The caller cannot provide an authority callback. Dispatch through the real
 * workflow implementation, which recognizes only its privately minted handles.
 * The callback is synchronous; wrap pending adapter work so the writer is never
 * held while that asynchronous work completes. */
export async function withEvaluationLearningCaseAuthority<T>(
  authority: EvaluationLearningCaseAuthority | undefined,
  commitment: LearningCaseCommitment,
  binding: Omit<LearningCaseBinding, 'lineageDigest'>,
  phase: LearningCasePhase,
  expectedCorpusDigest: string | undefined,
  consume: (corpus: EvaluationCorpus) => T,
): Promise<T> {
  const workflow = authority?.workflow, handle = authority?.handle;
  if (!(workflow instanceof ImprovementWorkflow)) throw new Error('learning_case_authority_required');
  return ImprovementWorkflow.prototype.withLearningCaseAuthority.call(workflow, handle!,
    { ...binding, lineageDigest: commitment.lineageDigest }, phase,
    (view: { corpus: EvaluationCorpus; lineageDigest: string }) => {
      if (view.lineageDigest !== commitment.lineageDigest || expectedCorpusDigest && hash(canonical(view.corpus)) !== expectedCorpusDigest)
        throw new Error('learning_case_authority_binding_mismatch');
      return consume(view.corpus);
    }) as Promise<T>;
}
