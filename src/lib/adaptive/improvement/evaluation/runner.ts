import { canonical, hash, routingArtifactSchema, type RoutingArtifact } from '../contracts';
import { improvementCandidateSchema, type ImprovementCandidate } from '../index';
import { PROTOCOL_SCHEMA_DIGEST, RESERVATION_SCHEMA_DIGEST, adapterOutputSchema, metricsSchema, protocolReceiptSchema, type AdapterOutput, type EvaluationCase, type EvaluationMetrics, type ProtocolReceipt } from './contracts';
import { validateEvaluationInputs, evaluationProtocolDigest, protocolCommitment } from './manifest';
export interface SyntheticEvaluationAdapter {
  readonly evidence: 'synthetic_local'; readonly digest: string;
  run(input: { artifact: RoutingArtifact; input: EvaluationCase['input'] }, signal: AbortSignal): Promise<unknown>;
}
function syntheticRun({ artifact, input }: { artifact: RoutingArtifact; input: EvaluationCase['input'] }): AdapterOutput {
  const action = input.cancelled ? artifact.onCancelled === 'stop' ? 'stop' : 'continue' : input.identity === 'unknown' || input.sharing === 'revoked' ? 'deny' : input.notification === 'verified' ? 'notify_verified' : input.notification === 'unknown' ? 'notify_unknown' : artifact.onActive;
  return { status: 'complete', action, outcome: action === 'notify_unknown' ? 'unavailable' : 'verified_success', privacyFailure: false, latencyMs: 1, costMicrousd: 0, discardedCostMicrousd: 0, judgeScore: 1 };
}
export const SYNTHETIC_ADAPTER_DIGEST = hash(syntheticRun.toString());
export const deterministicSyntheticAdapter: SyntheticEvaluationAdapter = { evidence: 'synthetic_local', digest: SYNTHETIC_ADAPTER_DIGEST,
  async run(input, signal) { if (signal.aborted) throw new Error('cancelled'); return syntheticRun(input); } };
type Row = { example: EvaluationCase; output: AdapterOutput };
const absent = (status: AdapterOutput['status']): AdapterOutput => ({ status, outcome: 'unavailable', privacyFailure: false, latencyMs: null, costMicrousd: null, discardedCostMicrousd: null, judgeScore: null });
function summarize(rows: Row[]): EvaluationMetrics {
  const outputs = rows.map(r => r.output), assigned = rows.length;
  // Unknown delivery cannot become verified success/failure by adapter or judge
  // assertion. Keep its assigned denominator and reject the contradictory claim.
  const correct = ({example, output}: Row) => output.status === 'complete' && output.action === example.expected &&
    (example.scenario !== 'notification_unknown' || output.outcome === 'unavailable');
  const privacy = ({example, output}: Row) => output.privacyFailure || output.status === 'complete' && (
    ['revoked_sharing','unknown_identity'].includes(example.scenario) && output.action !== 'deny' || example.scenario === 'notification_unknown' && output.action === 'notify_verified');
  const successes = rows.filter(r => correct(r) && !privacy(r) && r.output.outcome === 'verified_success').length;
  const complete = outputs.filter(o => o.status === 'complete').length;
  const latencies = outputs.flatMap(o => o.latencyMs === null ? [] : [o.latencyMs]).sort((a,b) => a-b);
  const costs = outputs.flatMap(o => o.costMicrousd === null || o.discardedCostMicrousd === null ? [] : [o.costMicrousd + o.discardedCostMicrousd]);
  const totalCost = costs.length === assigned ? costs.reduce((a,b) => a+b,0) : null;
  const percentile = (q: number) => latencies.length === assigned ? latencies[Math.max(0, Math.ceil(q * assigned) - 1)] : null;
  return metricsSchema.parse({ assigned, complete, invalid: outputs.filter(o => o.status === 'invalid').length, refused: outputs.filter(o => o.status === 'refused').length,
    unavailable: outputs.filter(o => o.status === 'unavailable').length, skipped: outputs.filter(o => o.status === 'skipped').length,
    successes, deterministicFailures: rows.filter(r => r.output.status === 'complete' && !correct(r)).length, privacyFailures: rows.filter(privacy).length,
    coverage: complete / assigned, successRate: successes / assigned, p50LatencyMs: percentile(.5), p95LatencyMs: percentile(.95), latencyAvailable: latencies.length,
    totalCostMicrousd: totalCost, costAvailable: costs.length, costPerSuccessMicrousd: totalCost === null || successes === 0 ? null : totalCost / successes,
    judgeAvailable: outputs.filter(o => o.judgeScore !== null).length, qualityPerAssignedCase: rows.reduce((sum,r) => sum + (correct(r) && !privacy(r) ? r.output.judgeScore ?? 0 : 0), 0) / assigned });
}
/** Trusted evaluator adapter contract only. Supplying an object with this shape
 * does not establish separate credentials, process isolation or provider authority. */
export async function runEvaluation(options: { manifest: unknown; corpus: unknown; candidate: ImprovementCandidate; artifact: RoutingArtifact; baseline: RoutingArtifact;
  evaluatorServiceId: string; adapter: SyntheticEvaluationAdapter; clock: () => number; signal?: AbortSignal }): Promise<ProtocolReceipt> {
  const now = options.clock();
  const { manifest, corpus } = validateEvaluationInputs(options.manifest, options.corpus, now);
  const candidate = improvementCandidateSchema.parse(options.candidate), artifact = routingArtifactSchema.parse(options.artifact), baseline = routingArtifactSchema.parse(options.baseline);
  if (candidate.evaluationProtocolDigest !== evaluationProtocolDigest(manifest) || candidate.artifactDigest !== hash(canonical(artifact)) || candidate.candidateRevision !== candidate.artifactDigest ||
    options.evaluatorServiceId === candidate.authorServiceId || options.adapter.evidence !== 'synthetic_local' || manifest.digests.adapter !== options.adapter.digest || manifest.digests.runner !== RUNNER_DIGEST) throw new Error('evaluation_protocol_binding_mismatch');
  const rows: { baseline: Row[]; candidate: Row[] } = { baseline: [], candidate: [] };
  let calls = 0, cost = 0, reportedLatency = 0, stopped = false;
  const started = Date.now();
  for (const example of corpus.final) for (const arm of ['baseline','candidate'] as const) {
    let output = absent('skipped');
    if (!stopped && !options.signal?.aborted && calls < manifest.budget.maxCalls) {
      calls++; const controller = new AbortController();
      const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const remaining = Math.max(0, manifest.budget.maxWallTimeMs - (Date.now() - started));
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('evaluation_timeout')); }, remaining); });
        const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('evaluation_cancelled')), { once: true }));
        const raw = await Promise.race([options.adapter.run({ artifact: structuredClone(arm === 'baseline' ? baseline : artifact), input: structuredClone(example.input) }, controller.signal), timeout, aborted]);
        const parsed = adapterOutputSchema.safeParse(raw); output = parsed.success ? parsed.data : absent('invalid');
        if (output.status === 'complete' && !output.action) output = absent('invalid');
        if (output.costMicrousd !== null && output.discardedCostMicrousd !== null) cost += output.costMicrousd + output.discardedCostMicrousd;
        if (output.latencyMs !== null) reportedLatency += output.latencyMs;
      } catch { output = absent('unavailable'); }
      finally { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
      if (cost > manifest.budget.maxCostMicrousd || reportedLatency > manifest.budget.maxReportedLatencyMs || Date.now() - started >= manifest.budget.maxWallTimeMs) stopped = true;
    }
    rows[arm].push({ example, output });
  }
  const base = summarize(rows.baseline), proposed = summarize(rows.candidate), gain = proposed.successRate - base.successRate;
  const complete = base.coverage === 1 && proposed.coverage === 1 && base.costAvailable === base.assigned && proposed.costAvailable === proposed.assigned &&
    base.latencyAvailable === base.assigned && proposed.latencyAvailable === proposed.assigned && base.judgeAvailable === base.assigned && proposed.judgeAvailable === proposed.assigned && !stopped && !options.signal?.aborted;
  const passed = complete && proposed.deterministicFailures === 0 && proposed.privacyFailures === 0 && proposed.successRate >= manifest.scoring.minimumSuccessRate &&
    gain >= manifest.scoring.minimumPairedSuccessGain && proposed.qualityPerAssignedCase >= manifest.scoring.minimumQualityPerAssignedCase && proposed.p95LatencyMs! <= manifest.scoring.maximumP95LatencyMs && proposed.costPerSuccessMicrousd !== null && proposed.costPerSuccessMicrousd <= manifest.scoring.maximumCostPerSuccessMicrousd;
  const testedAt = options.clock();
  if (!Number.isSafeInteger(testedAt) || testedAt < now || testedAt >= manifest.expiresAt || testedAt >= manifest.retention.retainUntil) throw new Error('evaluation_protocol_expired');
  return protocolReceiptSchema.parse({ schemaVersion: 1, evidence: 'synthetic_local_preflight', protocolDigest: evaluationProtocolDigest(manifest), protocolMetadata: protocolCommitment(manifest).protocolMetadata,
    candidateId: candidate.id, candidateRevision: candidate.candidateRevision, artifactDigest: candidate.artifactDigest, baselineRevision: candidate.baselineRevision,
    baselineArtifactDigest: hash(canonical(baseline)), legacyDatasetDigest: candidate.datasetVersion, candidateEvaluatorDigest: candidate.evaluatorVersion, promotionPolicyDigest: candidate.promotionPolicyVersion,
    bindings: manifest.digests, evaluatorServiceId: options.evaluatorServiceId, testedAt, retainUntil: manifest.retention.retainUntil,
    status: !complete ? 'incomplete' : passed ? 'passed' : 'failed', baseline: base, candidate: proposed, pairedSuccessGain: gain, calls, budget: manifest.budget });
}
export const RUNNER_DIGEST = hash(canonical({ version: 1, schemasDigest: PROTOCOL_SCHEMA_DIGEST, reservationSchemaDigest: RESERVATION_SCHEMA_DIGEST, RESERVATION_SCHEMA_DIGEST, inputValidation: validateEvaluationInputs.toString(), commitment: protocolCommitment.toString(), protocolDigest: evaluationProtocolDigest.toString(), run: runEvaluation.toString(), summarize: summarize.toString(), absent: absent.toString(),
  outputSchema: adapterOutputSchema.toJSONSchema(), metricSchema: metricsSchema.toJSONSchema(), receiptSchema: protocolReceiptSchema.toJSONSchema() }));
