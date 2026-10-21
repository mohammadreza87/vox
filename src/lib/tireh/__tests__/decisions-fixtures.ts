/** S09 test fixtures: a gateway with a scripted decider, a distinct fast model and an optional decision-log sink. */
import { vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { Decider, DecisionAnswer, DecisionQuestion } from '../triage';
import type { DecisionLogSink, NewDecisionLogRow } from '../decisions/log';
import type { DecisionInput, DecisionProvider, DecisionProviderOptions } from '../../adaptive/decisions';
import { FakeLLM, fakeBot, testOrg } from './fixtures';

export const pred = (probability: number): DecisionAnswer => ({ type: 'predicate', probability });

export type ProviderScript = Record<string, { choice?: string; confidence?: number; probability?: number } | 'refusal'>;

/** A fake DecisionProvider answering every question validly; `script` picks choices/probabilities per name. */
export function scriptedProvider(script: ProviderScript = {}) {
  const calls: Array<{ input: DecisionInput; options?: DecisionProviderOptions }> = [];
  const provider: DecisionProvider = {
    committedExportFence: true,
    evaluate: vi.fn(async (input: DecisionInput, _signal: AbortSignal, _now?: () => boolean, options?: DecisionProviderOptions) => {
      // Model the real guarded adapter at its final mock transport boundary.
      if (_signal.aborted || options?.authorize && !await options.authorize() || _now && !_now()) throw new Error('synthetic_authority_changed');
      calls.push({ input, options });
      return {
        model: 'gpt-6-luna', usage: { input_tokens: 42 },
        answers: input.questions.map((q) => {
          const s = script[q.name];
          if (s === 'refusal') return { name: q.name, type: 'refusal' };
          if (q.type === 'predicate') return { name: q.name, type: 'predicate', probability: s?.probability ?? 0.5 };
          if (q.type === 'score') return { name: q.name, type: 'score', score: 0, confidence: 1, probabilities: q.levels.map((l, i) => ({ value: i, label: l.label, probability: i === 0 ? 1 : 0 })) };
          const values = q.choices.map((c) => c.value);
          const chosen = s?.choice ?? (values.includes('none') ? 'none' : values[0]);
          const confidence = s?.confidence ?? 0.8;
          return { name: q.name, type: 'choice', choice: chosen, confidence,
            probabilities: values.map((v) => ({ value: v, probability: v === chosen ? confidence : (1 - confidence) / (values.length - 1) })) };
        }),
      };
    }),
  };
  return { provider, calls };
}

/** Valid v1 answers (thoughtful, nothing live, nothing memorable) plus any extras. */
export function v1Answers(extra: Record<string, DecisionAnswer> = {}): Record<string, DecisionAnswer> {
  return {
    effort: { type: 'choice', choice: 'thoughtful', confidence: 0.9 }, live_info: pred(0), memorable: pred(0), wants_voice: pred(0),
    addressed: pred(0.95), ...extra,
  };
}

export function collectingSink(): DecisionLogSink & { rows: NewDecisionLogRow[] } {
  const rows: NewDecisionLogRow[] = [];
  return { rows, record: (row) => { rows.push(row); } };
}

export function decisionsGateway(options: { answers?: Record<string, DecisionAnswer>; decider?: Decider; decisionLog?: DecisionLogSink } = {}) {
  const org = testOrg();
  const llm = new FakeLLM();
  llm.nextReply = 'MAIN_MODEL_REPLY';
  const fastLlm = new FakeLLM();
  fastLlm.nextReply = 'FAST_MODEL_REPLY';
  const epochs = new Map<string, number>();
  const memories = new InMemoryMemoryStore(epochs);
  const history = new InMemoryChatHistoryStore(epochs);
  const bot = fakeBot();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const decide = vi.fn<(input: string, questions: DecisionQuestion[], timeoutMs?: number) => Promise<Record<string, DecisionAnswer>>>(async () => options.answers ?? v1Answers());
  const decider = options.decider ?? { decide };
  const gateway = new PersonaGateway({
    org, llm, fastLlm, memories, offers: new InMemoryShareOfferStore(), history, deduper: new InMemoryUpdateDeduper(), voice: null,
    botFor: () => bot as unknown as TelegramBotClient, logger, decider,
    ...(options.decisionLog ? { decisionLog: options.decisionLog } : {}),
    now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return { org, llm, fastLlm, memories, history, bot, logger, decide, gateway };
}
