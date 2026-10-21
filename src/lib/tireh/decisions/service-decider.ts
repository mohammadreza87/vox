/**
 * The triage Decider over the vendor-neutral DecisionService seam
 * (src/lib/adaptive/decisions), selected only by STUDIO_DECIDER=service.
 *
 * Callers (the gateway, Studio) have already run their own authority checks
 * (groupAllowed, unchanged()) before deciding, exactly as for OpenAIMedia; the
 * service's authorize hook here is a constant fingerprint. The adapter never
 * throws: refusals, invalid input, timeouts and an open circuit all give {},
 * so readTriage returns null and the reply takes the full path.
 */

import {
  DecisionService, OpenAIDecisionProvider, DEFAULT_DECISION_DEADLINE_MS, MAX_DECISION_DEADLINE_MS,
  type DecisionInput, type DecisionQuestion as ServiceQuestion,
} from '../../adaptive/decisions';
import { tirehFlags } from '../flags';
import { TRIAGE_TIMEOUT_MS, type DecideDetail, type Decider, type DeciderPart, type DecisionAnswer, type DecisionQuestion } from '../triage';

type Evidence = DecisionInput['input'];

export interface ServiceDeciderOptions {
  /** Upper bound for every call's deadline (default 5000 ms, the service maximum). */
  deadlineMs?: number;
  now?: () => number;
}

export class ServiceDecider implements Decider {
  private readonly now: () => number;

  constructor(private readonly service: DecisionService, private readonly options: ServiceDeciderOptions = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  async decide(input: string, questions: DecisionQuestion[], timeoutMs?: number): Promise<Record<string, DecisionAnswer>> {
    return (await this.decideDetailed(input, questions, timeoutMs)).answers;
  }

  decideDetailed(input: string, questions: DecisionQuestion[], timeoutMs?: number): Promise<DecideDetail> {
    return this.run(() => input, questions, timeoutMs);
  }

  async decideParts(input: readonly DeciderPart[], questions: DecisionQuestion[], timeoutMs?: number): Promise<Record<string, DecisionAnswer>> {
    const evidence = (): Evidence => [{
      role: 'user',
      content: input.map((part) => part.type === 'text'
        ? { type: 'input_text' as const, text: part.text }
        : { type: 'input_image' as const, image_url: `data:${part.image.mimeType};base64,${part.image.data}`, detail: 'low' as const }),
    }];
    return (await this.run(evidence, questions, timeoutMs)).answers;
  }

  private async run(evidence: () => Evidence, questions: DecisionQuestion[], timeoutMs: number | undefined): Promise<DecideDetail> {
    const start = this.now();
    try {
      const requested = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 1 ? timeoutMs : DEFAULT_DECISION_DEADLINE_MS;
      const deadlineMs = Math.min(requested, this.options.deadlineMs ?? MAX_DECISION_DEADLINE_MS);
      const mapped = questions.map(serviceQuestion);
      const result = await this.service.evaluate({
        enabled: true,
        revision: 0,
        currentRevision: () => 0,
        authorize: async () => 'tireh-decider-v1',
        // Evidence is built lazily, after authorization, as the seam requires.
        loadInput: async () => ({ input: evidence(), questions: mapped } as DecisionInput),
        deadlineMs,
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
      return { answers: {}, outcome: 'unknown', unknownReason: 'threw', elapsedMs: Math.max(0, this.now() - start) };
    }
  }
}

/** Triage descriptions are optional; the seam requires them (value or label stands in). */
function serviceQuestion(q: DecisionQuestion): ServiceQuestion {
  if (q.type === 'predicate') return { type: 'predicate', name: q.name, instructions: q.instructions };
  if (q.type === 'choice') return { type: 'choice', name: q.name, instructions: q.instructions, choices: q.choices.map((c) => ({ value: c.value, description: c.description ?? c.value })) };
  return { type: 'score', name: q.name, instructions: q.instructions, levels: q.levels.map((l) => ({ label: l.label, description: l.description ?? l.label })) };
}

/**
 * The Studio decider. STUDIO_DECIDER=service with OPENAI_API_KEY gives a
 * ServiceDecider over a dedicated DecisionService (its own circuit); anything
 * else returns `fallback` itself. Read once at startup.
 */
export function studioDecider(fallback: Decider, env: NodeJS.ProcessEnv = process.env): Decider {
  if (tirehFlags(env).decider !== 'service' || !env.OPENAI_API_KEY) return fallback;
  return new ServiceDecider(new DecisionService(OpenAIDecisionProvider.guarded({ apiKey: env.OPENAI_API_KEY })), { deadlineMs: TRIAGE_TIMEOUT_MS });
}
