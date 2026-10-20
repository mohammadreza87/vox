/** Fictional fixtures only. No real-user provenance or provider qualification. */
import { canonical, hash } from '../contracts';
import { scenarios, type EvaluationCase, type EvaluationCorpus, type EvaluationManifest } from './contracts';
import { RUNNER_DIGEST, SYNTHETIC_ADAPTER_DIGEST } from './runner';
export const SYNTHETIC_PROTOCOL_NOW = 500;
export function syntheticProtocolInputs(): { manifest: EvaluationManifest; corpus: EvaluationCorpus } {
  const makeCases = (partition: string, time: number): EvaluationCase[] => scenarios.map((scenario, i) => ({
    id: hash(`${partition}:case:${i}`), taskId: hash(`${partition}:task:${i}`), personId: hash(`${partition}:person:${i}`),
    ...(scenario === 'revoked_sharing' ? { groupId: hash(`${partition}:group:${i}`) } : {}), conversationId: hash(`${partition}:conversation:${i}`),
    occurredAt: time + i, scenario, input: { locale: (['en','fa','mixed'] as const)[i % 3], text: i % 3 === 0 ? 'Fictional task.' : i % 3 === 1 ? 'درخواست کاملاً ساختگی.' : 'Synthetic request / درخواست ساختگی',
      cancelled: scenario === 'cancellation', identity: scenario === 'unknown_identity' ? 'unknown' : 'known', sharing: scenario === 'revoked_sharing' ? 'revoked' : 'none',
      notification: scenario === 'notification_verified' ? 'verified' : scenario === 'notification_unknown' ? 'unknown' : 'none' },
    expected: scenario === 'cancellation' ? 'stop' : scenario === 'active_continue' ? 'continue' : ['revoked_sharing','unknown_identity'].includes(scenario) ? 'deny' : scenario === 'notification_verified' ? 'notify_verified' : 'notify_unknown',
  }));
  const corpus: EvaluationCorpus = { schemaVersion: 1, provenance: 'synthetic_only', optimization: makeCases('optimization',100), validation: makeCases('validation',200), final: makeCases('final',300) };
  const judge = { version: 'deterministic-policy-v1' as const, calibration: 'synthetic_only' as const, calibrationDigest: hash('fictional-calibration-v1') };
  const scoring = { version: 'strict-synthetic-v1' as const, minimumCoverage: 1 as const, minimumSuccessRate: .8, minimumPairedSuccessGain: .1, minimumQualityPerAssignedCase: 1,
    maximumP95LatencyMs: 100, maximumCostPerSuccessMicrousd: 1000, deterministicFailuresAllowed: 0 as const, privacyFailuresAllowed: 0 as const, inference: 'descriptive_synthetic_only' as const };
  const manifest: EvaluationManifest = { schemaVersion: 1, id: 'fictional-generalization-v1', purpose: 'product_improvement', provenance: 'synthetic_only', reviewedAt: 10, expiresAt: 1000,
    retention: { approvalReference: 'synthetic-not-production-approval', retainUntil: 2000 },
    split: { policy: 'disjoint_task_person_group_conversation_forward_time_v1', optimization: { startsAt: 100, endsAt: 200 }, validation: { startsAt: 200, endsAt: 300 }, final: { startsAt: 300, endsAt: 400 } },
    counts: { optimization: 6, validation: 6, final: 6 }, digests: { corpus: hash(canonical(corpus)), optimization: hash(canonical(corpus.optimization)), validation: hash(canonical(corpus.validation)), final: hash(canonical(corpus.final)),
      judge: hash(canonical(judge)), scoring: hash(canonical(scoring)), runner: RUNNER_DIGEST, adapter: SYNTHETIC_ADAPTER_DIGEST },
    budget: { maxCases: 6, maxCalls: 12, maxCostMicrousd: 10000, maxReportedLatencyMs: 10000, maxWallTimeMs: 1000 }, requiredScenarios: [...scenarios], requiredLocales: ['en','fa','mixed'], statistics: { unit: 'person_or_exact_group', method: 'descriptive_only', minimumIndependentUnits: 6, populationClaims: 'not_authorized' }, judge, scoring };
  return { manifest, corpus };
}
