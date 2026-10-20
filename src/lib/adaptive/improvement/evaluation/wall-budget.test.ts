import { afterEach, expect, it, vi } from 'vitest';
import { canonical, hash, type RoutingArtifact } from '../contracts';
import type { ImprovementCandidate } from '../index';
import { EVALUATOR_DIGEST, POLICY_DIGEST } from '../sandbox';
import { evaluationProtocolDigest } from './manifest';
import { deterministicSyntheticAdapter, runEvaluation, type SyntheticEvaluationAdapter } from './runner';
import { syntheticProtocolInputs, SYNTHETIC_PROTOCOL_NOW } from './synthetic';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('stops all further dispatch after the global timer fires even when the wall clock stays below its deadline', async () => {
  vi.useFakeTimers();
  vi.spyOn(Date, 'now').mockReturnValue(1_000);
  const { manifest, corpus } = syntheticProtocolInputs();
  manifest.budget.maxWallTimeMs = 5;
  const baseline: RoutingArtifact = { schemaVersion: 1, kind: 'cancellation_routing', onCancelled: 'complete', onActive: 'continue' };
  const artifact: RoutingArtifact = { ...baseline, onCancelled: 'stop' };
  const candidate: ImprovementCandidate = {
    schemaVersion: 1, id: 'wall-budget-candidate', authorServiceId: 'author',
    baselineRevision: hash('base'), candidateRevision: hash(canonical(artifact)),
    artifactDigest: hash(canonical(artifact)), problemCode: 'audio_cancellation',
    evidenceIds: ['finding'], evidenceKind: 'synthetic', changedPaths: ['src/features/call/cancellation-routing.ts'],
    evaluatorVersion: EVALUATOR_DIGEST, datasetVersion: hash('separately-frozen-routing-final-dataset'),
    promotionPolicyVersion: POLICY_DIGEST, rollbackRevision: hash('base'),
    createdAt: SYNTHETIC_PROTOCOL_NOW, evaluationProtocolDigest: evaluationProtocolDigest(manifest),
  };
  const observedSignals: AbortSignal[] = [];
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const adapter: SyntheticEvaluationAdapter = {
    ...deterministicSyntheticAdapter,
    async run(_input, signal) {
      observedSignals.push(signal);
      started();
      return new Promise(() => {});
    },
  };
  const cancellation = new AbortController();
  const pending = runEvaluation({
    manifest, corpus, candidate, artifact, baseline, evaluatorServiceId: 'evaluator',
    adapter, clock: () => SYNTHETIC_PROTOCOL_NOW, signal: cancellation.signal,
  });
  try {
    await dispatched;
    await vi.advanceTimersByTimeAsync(5);
    expect(Date.now()).toBe(1_000);
    expect(observedSignals).toHaveLength(1);
    expect(observedSignals[0].aborted).toBe(true);
    const receipt = await pending;
    expect(receipt).toMatchObject({
      status: 'incomplete', calls: 1,
      baseline: { assigned: 6, unavailable: 1, skipped: 5 },
      candidate: { assigned: 6, unavailable: 0, skipped: 6 },
    });
  } finally {
    cancellation.abort();
    await pending;
  }
});
