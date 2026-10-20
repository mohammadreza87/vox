import { z } from 'zod';
import { hash, canonical, sha256, type RoutingArtifact } from '../contracts';
import { optimizeRouting } from '../sandbox';
import { withEvaluationLearningCaseAuthority, type EvaluationLearningCaseAuthority } from './authority';
import { evaluationProtocolDigest, validateEvaluationInputs } from './manifest';
import { manifestSchema, type EvaluationManifest } from './contracts';
import { evaluationCaseSchema } from './contracts';
/** Only the separately projected optimization capability crosses this boundary.
 * No final corpus, judge, scoring configuration or evaluator key is an argument. */
const capabilitySchema = z.object({ schemaVersion: z.literal(1), purpose: z.literal('optimization_only'), protocolDigest: sha256,
  evidence: z.literal('synthetic_only'), budget: z.object({ maxCases: z.number().int().positive().max(128) }).strict(),
  cases: z.array(evaluationCaseSchema).min(1).max(128) }).strict();
export function optimizeProtocolRouting(baseline: RoutingArtifact, rawCapability: unknown, maxCandidates: number) {
  const capability = capabilitySchema.parse(rawCapability);
  if (capability.cases.length > capability.budget.maxCases) throw new Error('optimization_budget_exceeded');
  const routing = capability.cases.filter(c => ['cancellation','active_continue'].includes(c.scenario));
  const training = { version: 'protocol-optimization-only', cases: routing.map(c => c.input.cancelled
    ? { cancelled: true as const, expected: 'stop' as const } : { cancelled: false as const, expected: 'continue' as const }) };
  return { ...optimizeRouting(baseline, training, maxCandidates, capability.budget.maxCases), protocolDigest: capability.protocolDigest };
}

/** Trusted server integration; only the copied optimization projection reaches
 * the bounded optimizer. A caller cannot serialize this authority into a job. */
export async function optimizeLearningCaseRouting(
  authority: EvaluationLearningCaseAuthority, rawManifest: EvaluationManifest, baseline: RoutingArtifact, maxCandidates: number, now: number,
) {
  const manifest = manifestSchema.parse(rawManifest), frozenBaseline = structuredClone(baseline);
  if (!manifest.learningCases) throw new Error('learning_case_authority_required');
  return withEvaluationLearningCaseAuthority(authority, manifest.learningCases, { protocolDigest: evaluationProtocolDigest(manifest) }, 'optimization', manifest.digests.corpus, corpus => {
    const validated = validateEvaluationInputs(manifest, corpus, now);
    const result = optimizeProtocolRouting(frozenBaseline, { schemaVersion: 1, purpose: 'optimization_only', protocolDigest: evaluationProtocolDigest(validated.manifest),
      evidence: 'synthetic_only', budget: { maxCases: validated.corpus.optimization.length }, cases: structuredClone(validated.corpus.optimization) }, maxCandidates);
    return { ...result, learningCases: structuredClone(manifest.learningCases), optimizationDigest: hash(canonical(validated.corpus.optimization)) };
  });
}
