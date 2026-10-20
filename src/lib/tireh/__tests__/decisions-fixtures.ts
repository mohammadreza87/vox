/** S09 test fixtures: a gateway with a scripted decider, a distinct fast model and an optional decision-log sink. */
import { vi } from 'vitest';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { Decider, DecisionAnswer, DecisionQuestion } from '../triage';
import type { DecisionLogSink, NewDecisionLogRow } from '../decisions/log';
import { FakeLLM, fakeBot, testOrg } from './fixtures';

export const pred = (probability: number): DecisionAnswer => ({ type: 'predicate', probability });

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
