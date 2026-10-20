import { z } from 'zod';
import { sha256, type RoutingArtifact } from '../contracts';
import { optimizeRouting } from '../sandbox';
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
