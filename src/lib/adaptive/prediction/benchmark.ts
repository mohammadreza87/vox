/** Run: npx tsx src/lib/adaptive/prediction/benchmark.ts
 * Synthetic delivered-consumer contract benchmark, not a provider quality or
 * speed benchmark. The fake provider returns fixture labels by construction. */
import { performance } from 'node:perf_hooks';
import { DecisionService, type DecisionInput } from '../decisions';
import { LivePredictionConsumer } from './client';
import { PREDICTION_FIXTURES, SYNTHETIC_IMAGE } from './fixtures';
import type { PredictionReply } from '../runtime/contracts';
const question: Extract<DecisionInput['questions'][number], { type: 'choice' }> = { name: 'intent_route', type: 'choice', instructions: 'Synthetic routing contract.', choices: [
  { value: 'conversation', description: 'Conversation' }, { value: 'recall', description: 'Recall' }, { value: 'task', description: 'Task' }, { value: 'unknown', description: 'Unknown' },
] };
export async function runSyntheticPredictionBenchmark() {
  const rows = [];
  for (const fixture of PREDICTION_FIXTURES) {
    const image = 'image' in fixture && fixture.image;
    const selectedQuestion: DecisionInput['questions'][number] = image ? { ...question, name: 'image_route', choices: ['screenshot', 'document', 'scene', 'unknown'].map(value => ({ value, description: value })) } : question;
    const service = new DecisionService({ evaluate: (_input, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve({ model: 'gpt-6-luna', usage: { input_tokens: 24 },
        answers: fixture.failure === 'refusal' ? [{ type: 'refusal', name: selectedQuestion.name }] : [{ type: 'choice', name: selectedQuestion.name, choice: fixture.route,
          confidence: 1, probabilities: (selectedQuestion.type === 'choice' ? selectedQuestion.choices.map(c => c.value) : []).map(value => ({ value, probability: value === fixture.route ? 1 : 0 })) }] }); }, fixture.delayMs);
      const abort = () => { clearTimeout(timer); reject(new Error('cancelled')); }; signal.addEventListener('abort', abort, { once: true });
    }) });
    let finished!: () => void, result!: PredictionReply;
    const complete = new Promise<void>(r => { finished = r; });
    const consumer = new LivePredictionConsumer({ debounceMs: 0,
      send: async (input, signal) => {
        const answer = await service.evaluate({ enabled: true, authorize: async () => 'synthetic-authority', revision: input.revision,
          currentRevision: () => input.revision, loadInput: async () => ({ input: input.image ? [{ role: 'user', content: [{ type: 'input_text', text: input.text }, { type: 'input_image', image_url: input.image.dataUrl, detail: 'low' }] }] : input.text, questions: [selectedQuestion] }), signal });
        result = { ...answer, sessionId: input.sessionId, turnId: input.turnId, contextKey: input.contextKey, revision: input.revision,
          policyReceipt: 'synthetic-receipt', questionVersion: 'vox-semantic-v1', expiresAt: Date.now() + 1500 };
        finished(); return result;
      }, invalidate: async () => {}, validate: async () => ({ valid: true }),
    });
    const baselineStarted = performance.now(); // Existing conversation remains independently usable.
    const baselineMs = performance.now() - baselineStarted;
    consumer.startTurn({ space: 'work', agentId: 'synthetic-agent', sessionId: fixture.id, turnId: 'synthetic-turn', contextKey: 'synthetic-audience' });
    const started = performance.now(); consumer.update({ text: fixture.text, stable: true, ...(image ? { image: { sourceId: 'synthetic-image', revision: 1, dataUrl: SYNTHETIC_IMAGE } } : {}) }); await complete;
    // Wait for send() delivery microtasks before consuming the real client result.
    await Promise.resolve(); await Promise.resolve();
    const prepared = await consumer.takePrepared();
    rows.push({ fixture: fixture.id, locale: fixture.locale, modality: image ? 'text-image' : 'text', providerDelayMs: fixture.delayMs, deadlineMs: 500, attempts: 1,
      delivered: !!prepared, expectedDelivery: fixture.failure === null, fallback: result.status === 'unknown' ? result.reason : null,
      baselineMs: +baselineMs.toFixed(3), decisionAndConsumerMs: +(performance.now() - started).toFixed(3),
      inputTokens: result.inputTokens ?? null, eventualBilledTokens: 'UNAVAILABLE: synthetic provider; no billing',
      contractPass: !!prepared === (fixture.failure === null) && (result.status !== 'unknown' || result.reason === fixture.failure) });
    consumer.cancel();
  }
  const sorted = rows.map(r => r.decisionAndConsumerMs).sort((a, b) => a - b);
  return { schemaVersion: 1, model: 'gpt-6-luna', provider: 'synthetic-only', rawAudioUsed: false, languages: ['en', 'fa'],
    sampleCount: rows.length, contractPass: rows.every(r => r.contractPass), deadlineMs: 500,
    candidateP50Ms: sorted[Math.ceil(sorted.length * .5) - 1], candidateP95Ms: sorted[Math.ceil(sorted.length * .95) - 1],
    qualityAccuracy: 'UNAVAILABLE: synthetic provider returns fixture labels by construction',
    actualProviderLatencyCost: 'UNAVAILABLE: no network or paid provider calls',
    endToEndConversationBenefit: 'UNAVAILABLE: no final conversation generation or audio playback measured',
    uncertaintyIntervals: 'UNAVAILABLE: fixed synthetic contract workload is not a sampled provider distribution', rows };
}
if (process.argv[1]?.endsWith('/prediction/benchmark.ts')) runSyntheticPredictionBenchmark().then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.contractPass) process.exitCode = 1; });
