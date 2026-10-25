/**
 * S09: gateway triage with the decision log and the versioned question sets.
 * A fake decider and a recorder sink; no provider or network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionService } from '../../adaptive/decisions';
import { ServiceDecider } from '../decisions/service-decider';
import { V2_QUESTION_NAMES } from '../decisions/catalog';
import type { NewDecisionLogRow } from '../decisions/log';
import { TRIAGE_TIMEOUT_MS, type DecisionAnswer } from '../triage';
import { GAMEEND_CHAT, groupText, privateText, TG } from './fixtures';
import { decisionsGateway, pred, scriptedProvider, v1Answers } from './decisions-fixtures';

const recorder = () => {
  const rows: NewDecisionLogRow[] = [];
  return { rows, record: vi.fn((row: NewDecisionLogRow) => { rows.push(row); }) };
};
const TRIAGE_FAILED = { type: 'telegram_ingress', stage: 'triage', reason: 'operation_failed', outcome: 'full_reply_path' };
const sentText = (h: ReturnType<typeof decisionsGateway>) => h.bot.sent.find((s) => s.method === 'sendMessage')?.text;

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('gateway decision log (TIREH_DECISION_LOG sink)', () => {
  // Pin v1 so the suite also passes under the flag matrix (TRIAGE_QUESTION_SET=v2).
  beforeEach(() => { vi.stubEnv('TRIAGE_QUESTION_SET', ''); });

  it('a private text turn produces exactly one content-free row matching the questions sent', async () => {
    const sink = recorder();
    const h = decisionsGateway({ decisionLog: sink });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'CANARY_MSG_7f3 please plan the launch'))).toBe('replied');
    expect(sink.record).toHaveBeenCalledOnce();
    const row = sink.rows[0];
    expect(row).toMatchObject({ chatKind: 'private', questionSetVersion: 'v1', personaId: 'aria', outcome: 'answered', language: 'en' });
    expect(row.names).toEqual(h.decide.mock.calls[0][1].map((q) => q.name));
    const json = JSON.stringify(row);
    for (const forbidden of ['CANARY_MSG_7f3', 'launch', 'Reza', 'reza', 'Aria', 'Product Lead', String(TG.reza)]) expect(json).not.toContain(forbidden);
  });

  it('effort quick with a fast model logs routeTaken quick, and the fast model replied', async () => {
    const sink = recorder();
    const h = decisionsGateway({ decisionLog: sink, answers: v1Answers({ effort: { type: 'choice', choice: 'quick', confidence: 0.9 } }) });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'thanks!'))).toBe('replied');
    expect(sink.rows[0].routeTaken).toBe('quick');
    expect(sentText(h)).toBe('FAST_MODEL_REPLY');
    expect(h.llm.replyPrompts).toHaveLength(0);
  });

  it('effort thoughtful logs routeTaken thoughtful, and the main model replied', async () => {
    const sink = recorder();
    const h = decisionsGateway({ decisionLog: sink });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'plan the quarter'))).toBe('replied');
    expect(sink.rows[0].routeTaken).toBe('thoughtful');
    expect(sentText(h)).toBe('MAIN_MODEL_REPLY');
  });

  it('a throwing decider logs unknown decider_error; the main model replies and triage_failed is logged as before', async () => {
    const sink = recorder();
    const h = decisionsGateway({ decisionLog: sink, decider: { decide: async () => { throw new Error('CANARY_DECIDER'); } } });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]).toMatchObject({ outcome: 'unknown', unknownReason: 'decider_error', routeTaken: 'untriaged', answers: [] });
    expect(JSON.stringify(sink.rows[0])).not.toContain('CANARY_DECIDER');
    expect(sentText(h)).toBe('MAIN_MODEL_REPLY');
    expect(h.logger.warn.mock.calls).toContainEqual([TRIAGE_FAILED]);

    const base = decisionsGateway({ decider: { decide: async () => { throw new Error('x'); } } });
    await base.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'));
    expect(h.logger.warn.mock.calls).toEqual(base.logger.warn.mock.calls);
  });

  it('a sink whose record throws leaves the reply unaffected', async () => {
    const h = decisionsGateway({ decisionLog: { record: () => { throw new Error('sink'); } } });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    expect(sentText(h)).toBe('MAIN_MODEL_REPLY');
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('without a sink decideDetailed is never called and decide gets (input, questions, 2000, authority) once', async () => {
    const decide = vi.fn(async () => v1Answers());
    const decideDetailed = vi.fn();
    const h = decisionsGateway({ decider: { decide, decideDetailed } });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    expect(decideDetailed).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledOnce();
    // The fourth argument is main's per-request authority (8a7dc55), revalidated at the guarded transport.
    const call = decide.mock.calls[0] as unknown as [string, unknown[], number, { authorize: () => Promise<string | null>; authorizeNow?: () => boolean }];
    expect(call.slice(0, 3)).toEqual([expect.any(String), expect.any(Array), TRIAGE_TIMEOUT_MS]);
    expect(call).toHaveLength(4);
    expect(typeof call[3].authorize).toBe('function');
    expect(call[3].authorizeNow).toBeUndefined();
    expect(typeof await call[3].authorize()).toBe('string');
  });

  it('with a ServiceDecider the row carries elapsedMs and inputTokens from the detail', async () => {
    const sink = recorder();
    let clock = 1_000;
    const { provider } = scriptedProvider({ effort: { choice: 'thoughtful', confidence: 0.9 }, live_info: { probability: 0 }, memorable: { probability: 0 }, wants_voice: { probability: 0 } });
    const decider = new ServiceDecider(new DecisionService(provider, () => (clock += 37)));
    const detailed = vi.spyOn(decider, 'decideDetailed');
    const h = decisionsGateway({ decisionLog: sink, decider });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hello'))).toBe('replied');
    const detail = await detailed.mock.results[0].value;
    expect(detail.elapsedMs).toBe(37);
    expect(sink.rows[0]).toMatchObject({ inputTokens: 42, elapsedMs: 37, outcome: 'answered' });
  });

  it('a group message logs chatKind group with no member names or chat ids', async () => {
    const sink = recorder();
    const h = decisionsGateway({ decisionLog: sink });
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, '@hoor_aria_bot CANARY_GROUP_31 launch date?'));
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0].chatKind).toBe('group');
    const json = JSON.stringify(sink.rows[0]);
    for (const forbidden of ['CANARY_GROUP_31', 'Milad', 'milad', 'Reza', 'Parastoo', 'gameend', String(GAMEEND_CHAT), String(TG.milad)]) expect(json).not.toContain(forbidden);
  });
});

describe('gateway question sets', () => {
  const v2Extra: Record<string, DecisionAnswer> = {
    route: { type: 'choice', choice: 'smalltalk', confidence: 0.99 },
    context_need: { type: 'choice', choice: 'none', confidence: 0.9 },
    thread_status: { type: 'choice', choice: 'new', confidence: 0.9 },
    explicit_style_request: { type: 'choice', choice: 'unspecified', confidence: 0.9 },
    personal_life: pred(0.1), confidential: pred(0.1), explicit_correction: pred(0.1),
  };
  const run = async (set: string | undefined, answers: Record<string, DecisionAnswer>) => {
    vi.stubEnv('TRIAGE_QUESTION_SET', set);
    const sink = recorder();
    const h = decisionsGateway({ answers, decisionLog: sink });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hey there'))).toBe('replied');
    return { h, sink };
  };

  it('v2 sends v1 + 7 questions with the same input, and the reply prompt and model match v1 (shadow)', async () => {
    const v1 = await run(undefined, v1Answers());
    const v2 = await run('v2', { ...v1Answers(), ...v2Extra });
    const v1Names = v1.h.decide.mock.calls[0][1].map((q) => q.name);
    expect(v2.h.decide.mock.calls[0][1].map((q) => q.name)).toEqual([...v1Names, ...V2_QUESTION_NAMES]);
    expect(v2.h.decide.mock.calls[0][0]).toBe(v1.h.decide.mock.calls[0][0]);
    expect(v2.h.decide.mock.calls[0][2]).toBe(TRIAGE_TIMEOUT_MS);
    expect(v2.h.llm.replyPrompts).toEqual(v1.h.llm.replyPrompts);
    expect(v2.h.fastLlm.replyPrompts).toEqual([]);
    expect(sentText(v2.h)).toBe(sentText(v1.h));
    expect(v2.sink.rows[0]).toMatchObject({ questionSetVersion: 'v2' });
    expect(v2.sink.rows[0].answers.find((a) => a.name === 'route')).toMatchObject({ choice: 'smalltalk' });
    expect(v2.sink.rows[0].routeTaken).toBe('thoughtful');
  });

  it('v2-live routes the same answers to the fast model', async () => {
    const live = await run('v2-live', { ...v1Answers(), ...v2Extra });
    expect(sentText(live.h)).toBe('FAST_MODEL_REPLY');
    expect(live.h.llm.replyPrompts).toEqual([]);
    expect(live.sink.rows[0]).toMatchObject({ questionSetVersion: 'v2-live', routeTaken: 'quick' });
  });
});
