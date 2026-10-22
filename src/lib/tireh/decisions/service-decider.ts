/**
 * The triage Decider over the vendor-neutral DecisionService seam
 * (src/lib/adaptive/decisions). runtime.ts selects it only under
 * STUDIO_DECIDER=service; nothing here reads credentials, flags or the network.
 *
 * Callers keep their own authority checks, exactly as with OpenAIMedia: the
 * gateway calls unchanged() before deciding, so the service's authorize hook
 * is a constant fingerprint and there is no authorizeNow or signal.
 *
 * Never throws. Any unknown outcome (refusal, malformed, timeout, invalid
 * input, open circuit, a throwing service) gives answers {}, so readTriage
 * returns null and the reply takes the full path.
 */

import {
  DEFAULT_DECISION_DEADLINE_MS,
  type DecisionInput, type DecisionQuestion as ServiceQuestion, type DecisionService,
} from '../../adaptive/decisions';
import type { DecideDetail, Decider, DeciderPart, DecisionAnswer, DecisionQuestion } from '../triage';

type Evidence = DecisionInput['input'];

export interface ServiceDeciderOptions {
  /** Upper bound for every call's deadline; DecisionService clamps to 5 s anyway. */
  deadlineMs?: number;
  /** Clock for elapsedMs when the service itself throws (default Date.now). */
  now?: () => number;
}

const usable = (ms: number | undefined): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms >= 1;

/** Triage descriptions are optional; the seam requires them, so the value or label stands in. Never clipped. */
export function toServiceQuestion(q: DecisionQuestion): ServiceQuestion {
  if (q.type === 'predicate') return { type: 'predicate', name: q.name, instructions: q.instructions };
  if (q.type === 'choice') return { type: 'choice', name: q.name, instructions: q.instructions, choices: q.choices.map((c) => ({ value: c.value, description: c.description ?? c.value })) };
  return { type: 'score', name: q.name, instructions: q.instructions, levels: q.levels.map((l) => ({ label: l.label, description: l.description ?? l.label })) };
}

export class ServiceDecider implements Decider {
  private readonly now: () => number;

  constructor(private readonly service: DecisionService, private readonly options: ServiceDeciderOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async decide(input: string, questions: DecisionQuestion[], timeoutMs?: number): Promise<Record<string, DecisionAnswer>> {
    return (await this.run(input, questions, timeoutMs)).answers;
  }

  async decideParts(input: readonly DeciderPart[], questions: DecisionQuestion[], timeoutMs?: number): Promise<Record<string, DecisionAnswer>> {
    // Built lazily, after authorization, as the seam requires. Images go
    // through the seam's minimizeImageDataUrl: png/jpeg, <=512 px, <=64 KiB.
    const evidence = (): Evidence => [{
      role: 'user',
      content: input.map((part) => part.type === 'text'
        ? { type: 'input_text' as const, text: part.text }
        : { type: 'input_image' as const, image_url: `data:${part.image.mimeType};base64,${part.image.data}`, detail: 'low' as const }),
    }];
    return (await this.run(evidence, questions, timeoutMs)).answers;
  }

  decideDetailed(input: string, questions: DecisionQuestion[], timeoutMs?: number): Promise<DecideDetail> {
    return this.run(input, questions, timeoutMs);
  }

  /** min(timeoutMs, options.deadlineMs), ignoring missing or invalid values; 500 ms when neither is usable. */
  private deadline(timeoutMs: number | undefined): number {
    const bounds = [timeoutMs, this.options.deadlineMs].filter(usable);
    return bounds.length ? Math.min(...bounds) : DEFAULT_DECISION_DEADLINE_MS;
  }

  private async run(input: string | (() => Evidence), questions: DecisionQuestion[], timeoutMs: number | undefined): Promise<DecideDetail> {
    const started = this.now();
    try {
      const mapped = questions.map(toServiceQuestion);
      const result = await this.service.evaluate({
        enabled: true,
        revision: 0,
        currentRevision: () => 0,
        authorize: async () => 'tireh-decider-v1',
        // The seam validates the request with its strict schema after loading.
        loadInput: async () => ({ input: typeof input === 'string' ? input : input(), questions: mapped } as DecisionInput),
        deadlineMs: this.deadline(timeoutMs),
      });
      const tokens = result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens };
      if (result.status !== 'answered') return { answers: {}, elapsedMs: result.elapsedMs, ...tokens, outcome: 'unknown', unknownReason: result.reason };
      const answers: Record<string, DecisionAnswer> = {};
      for (const a of result.answers) {
        if (a.type === 'predicate') answers[a.name] = { type: 'predicate', probability: a.probability };
        else if (a.type === 'choice') answers[a.name] = { type: 'choice', choice: a.choice, confidence: a.confidence, probabilities: a.probabilities.map((p) => ({ value: p.value, probability: p.probability })) };
        else if (a.type === 'score') answers[a.name] = { type: 'score', score: a.score, confidence: a.confidence };
      }
      return { answers, elapsedMs: result.elapsedMs, ...tokens, outcome: 'answered' };
    } catch {
      return { answers: {}, elapsedMs: Math.max(0, this.now() - started), outcome: 'unknown', unknownReason: 'provider_error' };
    }
  }
}
