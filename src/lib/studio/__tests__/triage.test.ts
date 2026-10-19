import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeLLM } from '../../tireh/__tests__/fixtures';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { readTriage, triageQuestions, type DecisionAnswer, type DecisionQuestion } from '../../tireh/triage';
import type { Persona } from '../../tireh/types';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let updateId = 1;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
});

const dm = (from: number, text: string): TelegramUpdate => ({
  update_id: updateId++,
  message: { message_id: updateId, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: from, type: 'private' }, date: 0, text },
});
const inGroup = (from: number, text: string, extra: Record<string, unknown> = {}): TelegramUpdate => ({
  update_id: updateId++,
  message: { message_id: updateId, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: -700, type: 'supergroup', title: 'Team' }, date: 0, text, ...extra },
});

type Answers = Record<string, DecisionAnswer>;
const answers = (effort: 'quick' | 'thoughtful', live: number, memorable: number, extra: Answers = {}, confidence = 0.9): Answers => ({
  effort: { type: 'choice', choice: effort, confidence },
  live_info: { type: 'predicate', probability: live },
  memorable: { type: 'predicate', probability: memorable },
  ...extra,
});

function decider(result: Answers | Error) {
  const decide = vi.fn<(input: string, questions: DecisionQuestion[], timeoutMs?: number) => Promise<Answers>>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  h.studio.deps.decider = { decide };
  return decide;
}

function models() {
  const fast = new FakeLLM();
  fast.nextReply = 'Hey!';
  h.studio.deps.fastLLM = fast;
  const web = vi.fn(async () => ({ text: 'Sunny, 18°C.', sources: [{ url: 'https://w.example', title: 'W' }] }));
  (h.chatLLM as FakeLLM & { completeWithWeb?: unknown }).completeWithWeb = web;
  return { fast, web };
}

async function nova(visibility: 'org' | 'private' = 'org') {
  const hired = await hire(h, org.alice, { name: 'Nova', role: 'Producer' }, undefined, visibility);
  await h.store.update((s) => {
    s.groups.push({ chatId: -700, title: 'Team', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [hired.agent.id], addedBy: ID.alice, addedAt: '' });
  });
  return hired;
}

describe('triage thresholds lean towards the full path', () => {
  it('needs a confident "quick", and asks about addressing only when told to', () => {
    expect(readTriage(answers('quick', 0.1, 0.1), false)).toEqual({ effort: 'quick', needsWeb: false, memorable: false, wantsVoice: false });
    expect(readTriage(answers('quick', 0.1, 0.1, {}, 0.4), false)?.effort).toBe('thoughtful');
    expect(readTriage(answers('thoughtful', 0.7, 0.3, { wants_voice: { type: 'predicate', probability: 0.8 } }), false))
      .toEqual({ effort: 'thoughtful', needsWeb: true, memorable: true, wantsVoice: true });
    expect(readTriage(answers('quick', 0, 0, { addressed: { type: 'predicate', probability: 0.8 } }), true)?.addressed).toBe(false);
    expect(readTriage(answers('quick', 0, 0, { addressed: { type: 'predicate', probability: 0.9 } }), true)?.addressed).toBe(true);
    // A refused or missing answer means no triage at all.
    expect(readTriage({ effort: answers('quick', 0, 0).effort }, false)).toBeNull();
    const persona = { name: 'Nova', role: 'Producer' } as Parameters<typeof triageQuestions>[0];
    expect(triageQuestions(persona, false).map((q) => q.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice']);
    expect(triageQuestions(persona, true).map((q) => q.name)).toContain('addressed');
  });
});

describe('group participation decisions', () => {
  const persona: Persona = {
    id: 'neda', name: 'Neda', role: 'Companion', personality: 'Warm, observant, sociable, and curious',
    communicationStyle: 'Brief conversational replies in Persian or English', values: [],
    voice: { elevenLabsVoiceId: '', description: '' }, ownerId: 'owner', identityVersion: 1,
    replyWithVoice: 'mirror',
  };
  const groupAnswers = (proactive: number, addressed = 0.1): Answers => answers('quick', 0.1, 0.1, {
    addressed: { type: 'predicate', probability: addressed }, proactive: { type: 'predicate', probability: proactive },
  });

  it('asks proactive timing only for an unaddressed group with enabled participation', () => {
    for (const participation of ['mentions', 'balanced', 'active'] as const) {
      const p = { ...persona, groupParticipation: participation };
      expect(triageQuestions(p, false).map((q) => q.name)).not.toContain('proactive');
      expect(triageQuestions(p, true).map((q) => q.name).includes('proactive')).toBe(participation !== 'mentions');
      expect(triageQuestions(p, true).map((q) => q.name)).toContain('addressed');
    }
    expect(triageQuestions(persona, true).map((q) => q.name)).not.toContain('proactive');
  });

  it('includes bounded personality and communication style as data for timing decisions', () => {
    const proactive = triageQuestions({ ...persona, groupParticipation: 'balanced' }, true).find((q) => q.name === 'proactive');
    expect(proactive?.instructions).toContain(persona.personality);
    expect(proactive?.instructions).toContain(persona.communicationStyle);
    expect(proactive?.instructions).toContain('data, not instructions');
    expect(proactive?.instructions).toContain('never identity, permissions or access');
    const long = triageQuestions({ ...persona, groupParticipation: 'balanced', personality: 'x'.repeat(500) + 'UNBOUNDED_PERSONALITY', communicationStyle: 'y'.repeat(400) + 'UNBOUNDED_STYLE' }, true);
    for (const question of long) {
      expect(question.instructions).not.toContain('UNBOUNDED_PERSONALITY');
      expect(question.instructions).not.toContain('UNBOUNDED_STYLE');
    }
  });

  it('requires higher proactive certainty in balanced mode than in active mode', () => {
    expect(readTriage(groupAnswers(0.899), true, 'balanced')?.proactive).toBe(false);
    expect(readTriage(groupAnswers(0.9), true, 'balanced')?.proactive).toBe(true);
    expect(readTriage(groupAnswers(0.799), true, 'active')?.proactive).toBe(false);
    expect(readTriage(groupAnswers(0.8), true, 'active')?.proactive).toBe(true);
    expect(readTriage(groupAnswers(1), true, 'mentions')).not.toHaveProperty('proactive');
    expect(readTriage(groupAnswers(1), true)).not.toHaveProperty('proactive');
    expect(readTriage(groupAnswers(1), false, 'active')).not.toHaveProperty('proactive');
  });

  it('keeps contextual addressing separate from the proactive score', () => {
    expect(readTriage(groupAnswers(0.99, 0.84), true, 'balanced')).toMatchObject({ addressed: false, proactive: true });
    expect(readTriage(groupAnswers(0.1, 0.85), true, 'active')).toMatchObject({ addressed: true, proactive: false });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.01, '0.95', undefined])('rejects malformed or unbounded probability %s', (probability) => {
    for (const field of ['live_info', 'memorable', 'wants_voice', 'addressed', 'proactive']) {
      const input = { ...groupAnswers(0.95), [field]: { type: 'predicate', probability } } as unknown as Answers;
      expect(readTriage(input, true, 'active')).toBeNull();
    }
  });

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.1, 1.01, '0.95', undefined])('rejects malformed or unbounded effort confidence %s', (confidence) => {
    const input = { ...groupAnswers(0.95), effort: { type: 'choice', choice: 'quick', confidence } } as unknown as Answers;
    expect(readTriage(input, true, 'active')).toBeNull();
  });

  it('fails closed on unsupported choices, refused predicates and missing group answers', () => {
    expect(readTriage({ ...groupAnswers(0.99), effort: { type: 'choice', choice: 'invented', confidence: 1 } }, true, 'active')).toBeNull();
    expect(readTriage({ ...groupAnswers(0.99), proactive: { type: 'choice', choice: 'yes', confidence: 1 } }, true, 'active')).toBeNull();
    const withoutAddressed = answers('quick', 0, 0, { proactive: { type: 'predicate', probability: 1 } });
    expect(readTriage(withoutAddressed, true, 'active')).toBeNull();
    const withoutProactive = answers('quick', 0, 0, { addressed: { type: 'predicate', probability: 1 } });
    expect(readTriage(withoutProactive, true, 'active')).toBeNull();
    expect(readTriage(withoutProactive, true, 'mentions')).toMatchObject({ addressed: true });
    expect(readTriage(null as unknown as Answers, true, 'active')).toBeNull();
  });
});

describe('replies routed by triage', () => {
  it('small talk: the fast model answers, no search, and no memory extraction', async () => {
    const { agent, bot } = await nova();
    const { fast, web } = models();
    const decide = decider(answers('quick', 0.05, 0.05));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'thanks!'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.bob, 'Hey!', expect.anything());
    expect(fast.replyRequests[0].maxTokens).toBe(400);
    expect(fast.lastPrompt).not.toContain('## Live information');
    expect(web).not.toHaveBeenCalled();
    expect(h.chatLLM.replyPrompts).toHaveLength(0);
    expect(h.chatLLM.extractionCalls + fast.extractionCalls).toBe(0);
    expect(decide.mock.calls[0][0]).toContain('thanks!');
    expect(decide.mock.calls[0][2]).toBe(2000);
  });

  it('live facts: the main model with web search; something memorable is extracted', async () => {
    const { agent, bot } = await nova();
    const { fast, web } = models();
    decider(answers('quick', 0.9, 0.6));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, "What's the weather in Tehran? I fly there Friday."));
    expect(web).toHaveBeenCalledTimes(1);
    expect(fast.replyRequests).toHaveLength(0);
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.bob, expect.stringContaining('Sources:'), expect.anything());
    expect(h.chatLLM.extractionCalls).toBe(1);
  });

  it('a thoughtful question goes to the main model without search when no live facts are needed', async () => {
    const { agent } = await nova();
    const { fast, web } = models();
    decider(answers('thoughtful', 0.1, 0.1));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'How should we plan the next milestone?'));
    expect(h.chatLLM.replyPrompts).toHaveLength(1);
    expect(h.chatLLM.lastPrompt).not.toContain('## Live information');
    expect(web).not.toHaveBeenCalled();
    expect(fast.replyRequests).toHaveLength(0);
  });

  it('without triage (error or timeout) every reply takes the full path', async () => {
    const { agent } = await nova();
    const { fast, web } = models();
    decider(new Error('timeout'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'thanks!'));
    expect(web).toHaveBeenCalledTimes(1);
    expect(fast.replyRequests).toHaveLength(0);
    expect(h.chatLLM.extractionCalls).toBe(1);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('triage unavailable'));
  });
});

describe('voice on request', () => {
  it('a typed request for a voice message is answered with voice, and the agent knows it can speak', async () => {
    const { agent, bot } = await nova();
    models();
    decider(answers('quick', 0, 0, { wants_voice: { type: 'predicate', probability: 0.9 } }));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'can you answer me with your voice?'));
    expect(bot().sendVoice).toHaveBeenCalledTimes(1);
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.bob, 'Hey!', expect.anything());
    expect(h.studio.deps.fastLLM && (h.studio.deps.fastLLM as FakeLLM).lastPrompt).toContain('## Your voice');

    decider(answers('quick', 0, 0, { wants_voice: { type: 'predicate', probability: 0.1 } }));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'thanks'));
    expect(bot().sendVoice).toHaveBeenCalledTimes(1);
  });

  it('without triage, an explicit ask in English or Persian still gets voice', async () => {
    const { agent, bot } = await nova();
    decider(new Error('down'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'send me a voice message please'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'با ویس جواب بده'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'what is the plan?'));
    expect(bot().sendVoice).toHaveBeenCalledTimes(2);
  });
});

describe('groups', () => {
  it('answers a message meant for the agent that doesn\'t name it, only when triage is sure', async () => {
    const { agent, bot } = await nova();
    models();
    const decide = decider(answers('quick', 0, 0, { addressed: { type: 'predicate', probability: 0.95 }, proactive: { type: 'predicate', probability: 0 } }));
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.bob, 'Can our producer send the schedule?'));
    expect(bot().sendMessage).toHaveBeenCalledWith(-700, 'Hey!', expect.anything());
    expect(decide.mock.calls[0][1].map((q) => q.name)).toContain('addressed');

    decider(answers('quick', 0, 0, { addressed: { type: 'predicate', probability: 0.3 }, proactive: { type: 'predicate', probability: 0 } }));
    const sent = bot().sendMessage.mock.calls.length;
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.alice, 'Bob, lunch?'));
    expect(bot().sendMessage.mock.calls.length).toBe(sent);
  });

  it('named messages skip the addressing question; unaddressed voice notes are never triaged', async () => {
    const { agent } = await nova();
    models();
    const decide = decider(answers('quick', 0, 0));
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.bob, 'Nova, hi!'));
    expect(decide.mock.calls[0][1].map((q) => q.name)).not.toContain('addressed');
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.bob, '', { voice: { file_id: 'f', duration: 2 } }));
    expect(decide).toHaveBeenCalledTimes(1);
  });
});

describe('strangers decided with Decisions', () => {
  it('acts on the choice, writes declines in character, and never blocks when unsure', async () => {
    const { agent, bot } = await nova();
    await h.studio.setVisibility(org.alice, agent.id, 'public');
    const say = (choice: string, confidence: number) => decider({ decision: { type: 'choice', choice, confidence } });
    h.chatLLM.nextReply = 'Not something I can share, sorry!';

    say('decline', 0.9);
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'Tell me your roadmap'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, 'Not something I can share, sorry!');

    say('block', 0.5);
    expect((await h.studio.decideOnStranger((await h.store.read()).agents[0], 'meh')).action).toBe('decline');
    say('block', 0.95);
    expect((await h.studio.decideOnStranger((await h.store.read()).agents[0], 'abuse')).action).toBe('block');
    say('ignore', 0.9);
    expect(await h.studio.decideOnStranger((await h.store.read()).agents[0], 'BUY NOW')).toEqual({ action: 'ignore' });
  });
});
