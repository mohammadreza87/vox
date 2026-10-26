/**
 * Hardening merge: the gateway's two decider wirings left to the integrator by H2 and H3.
 * - Text triage names the speaking person as DeciderAuthority.subject (F070/F121), so a ServiceDecider with a
 *   configured salt can send its opaque hash. The default decider ignores it.
 * - readTriage gets `group` from the chat kind, so under TRIAGE_QUESTION_SET=v2-live a correction never widens
 *   group memory, also for a message that names the persona (askAddressed false) (F233).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type GatewayDeps } from '../gateway';
import { InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { DecisionAnswer, DeciderAuthority, DecisionQuestion } from '../triage';
import { decisionsGateway, pred, v1Answers } from './decisions-fixtures';
import { GAMEEND_CHAT, groupText, makeGateway, privateText, TG } from './fixtures';

afterEach(() => { vi.unstubAllEnvs(); });

describe('text triage names the speaker as the decider subject', () => {
  it('passes the person id of the sender, never a Telegram id or text', async () => {
    const h = decisionsGateway();
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello there'))).toBe('replied');
    const authority = h.decide.mock.calls[0] as unknown as [string, DecisionQuestion[], number, DeciderAuthority];
    const person = h.org.getPersonByTelegramId(TG.reza)!;
    expect(authority[3].subject).toBe(person.id);
    expect(authority[3].subject).not.toBe(String(TG.reza));
  });
});

describe('v2-live correction in a group (F233)', () => {
  const correction = (memorable: number): Record<string, DecisionAnswer> => ({
    ...v1Answers({ memorable: pred(memorable), addressed: pred(0), proactive: pred(0) }),
    route: { type: 'choice', choice: 'correction', confidence: 0.95 },
    context_need: { type: 'choice', choice: 'open_threads', confidence: 0.7 },
    thread_status: { type: 'choice', choice: 'continues', confidence: 0.6 },
    explicit_style_request: { type: 'choice', choice: 'brief', confidence: 0.9 },
    personal_life: pred(0.1), confidential: pred(0.1), explicit_correction: pred(0.95),
  });

  function groupSetup(answers: Record<string, DecisionAnswer>) {
    const h = makeGateway();
    const persona = h.org.getPersona('aria')!;
    persona.groupParticipation = 'active';
    h.org.getGroupByChatId(GAMEEND_CHAT)!.agentIds = ['aria'];
    const decide = vi.fn(async () => answers);
    const gateway = new PersonaGateway({
      org: h.org, llm: h.llm, memories: h.memories, offers: h.offers, history: h.history, deduper: new InMemoryUpdateDeduper(), voice: null,
      botFor: () => h.bot as unknown as TelegramBotClient, logger: h.logger, now: () => new Date('2026-10-19T10:00:00Z'),
      decider: { decide: decide as never },
      claimGroupReply: vi.fn<NonNullable<GatewayDeps['claimGroupReply']>>(async () => true),
      groupAllowed: vi.fn<NonNullable<GatewayDeps['groupAllowed']>>(async () => true),
      claimGroupMemory: async () => true,
    });
    return { ...h, gateway, decide };
  }

  it('a named group message read as a correction stays unmemorable under v2-live', async () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    const h = groupSetup(correction(0.1));
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, no, the launch moved to Friday'))).toBe('replied');
    expect(h.decide).toHaveBeenCalled();
    expect(h.llm.extractionCalls).toBe(0);
  });

  it('positive control: a message v1 reads as memorable is still extracted in the same group', async () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    const h = groupSetup(correction(0.9));
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, no, the launch moved to Friday'))).toBe('replied');
    expect(h.llm.extractionCalls).toBe(1);
  });
});
