import { canonical, hash } from '../contracts';
import { corpusSchema, manifestSchema, type EvaluationCorpus, type EvaluationManifest } from './contracts';
export function protocolCommitment(manifest: EvaluationManifest) {
  return { protocolMetadata: { manifestDigest: hash(canonical(manifest)), splitDigest: hash(canonical(manifest.split)), coverageDigest: hash(canonical([manifest.requiredScenarios,manifest.requiredLocales])), reviewedAt: manifest.reviewedAt, expiresAt: manifest.expiresAt, retentionApprovalReference: manifest.retention.approvalReference, counts: manifest.counts },
    bindings: manifest.digests, budget: manifest.budget, retainUntil: manifest.retention.retainUntil, ...(manifest.learningCases ? { learningCases: manifest.learningCases } : {}) };
}
export const evaluationProtocolDigest = (manifest: EvaluationManifest) => hash(canonical(protocolCommitment(manifest)));
/** Evaluator-owned validation, before granting any adapter access to examples. */
export function validateEvaluationInputs(rawManifest: unknown, rawCorpus: unknown, now: number): { manifest: EvaluationManifest; corpus: EvaluationCorpus } {
  const manifest = manifestSchema.parse(rawManifest), corpus = corpusSchema.parse(rawCorpus);
  if (!Number.isSafeInteger(now) || now < manifest.reviewedAt || now >= manifest.expiresAt || now >= manifest.retention.retainUntil) throw new Error('evaluation_protocol_expired');
  if (manifest.schemaVersion !== corpus.schemaVersion) throw new Error('learning_case_version_mismatch');
  if (manifest.digests.corpus !== hash(canonical(corpus))) throw new Error('evaluation_corpus_mismatch');
  const partitions = ['optimization','validation','final'] as const;
  const ids = new Set<string>();
  for (const partition of partitions) {
    const cases = corpus[partition], window = manifest.split[partition];
    if (manifest.counts[partition] !== cases.length || manifest.digests[partition] !== hash(canonical(cases)) || cases.some(c => c.occurredAt < window.startsAt || c.occurredAt >= window.endsAt)) throw new Error('evaluation_partition_mismatch');
    for (const c of cases) { if (ids.has(c.id)) throw new Error('evaluation_duplicate_case'); ids.add(c.id); }
    for (const other of partitions) if (other !== partition) for (const field of ['taskId','personId','groupId','conversationId'] as const) {
      const otherIds = new Set(corpus[other].map(c => c[field]).filter(Boolean));
      if (cases.some(c => c[field] && otherIds.has(c[field]))) throw new Error(`evaluation_${field}_split_leak`);
    }
  }
  const units = new Set(corpus.final.map(c => c.groupId ? `group:${c.groupId}` : `person:${c.personId}`));
  if (units.size < manifest.statistics.minimumIndependentUnits) throw new Error('evaluation_independent_units_insufficient');
  for (const scenario of manifest.requiredScenarios) if (!corpus.final.some(c => c.scenario === scenario)) throw new Error('evaluation_scenario_coverage_missing');
  for (const locale of manifest.requiredLocales) if (!corpus.final.some(c => c.input.locale === locale)) throw new Error('evaluation_locale_coverage_missing');
  return { manifest, corpus };
}
/** This is a capability projection, not process/filesystem isolation. The
 * optimizer job must receive only this object, never the inputs used to build it. */
export function optimizerProjection(rawManifest: unknown, rawCorpus: unknown, now: number) {
  const { manifest, corpus } = validateEvaluationInputs(rawManifest, rawCorpus, now);
  if (manifest.learningCases) throw new Error('learning_case_authority_required');
  return { schemaVersion: 1 as const, purpose: 'optimization_only' as const, protocolDigest: evaluationProtocolDigest(manifest),
    evidence: 'synthetic_only' as const, budget: { maxCases: corpus.optimization.length }, cases: structuredClone(corpus.optimization) };
}
