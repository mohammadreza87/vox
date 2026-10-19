import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type GatewayDeps } from '../gateway';
import { InMemoryUpdateDeduper } from '../memory/store';
import type { TelegramBotClient } from '../telegram/client';
import type { VoiceService } from '../voice';
import { fakeVoice, GAMEEND_CHAT, groupText, makeGateway, memory, TG } from './fixtures';

function setup(voice: VoiceService | null = null) {
  const h = makeGateway();
  const persona = h.org.getPersona('aria')!;
  persona.groupParticipation = 'balanced';
  persona.groupRemember = true;
  h.org.getGroupByChatId(GAMEEND_CHAT)!.agentIds = ['aria'];
  const result = {
    effort: { type: 'choice' as const, choice: 'thoughtful', confidence: 1 },
    live_info: { type: 'predicate' as const, probability: 0 },
    memorable: { type: 'predicate' as const, probability: 0.9 },
    addressed: { type: 'predicate' as const, probability: 0 },
    proactive: { type: 'predicate' as const, probability: 0 },
  };
  const decide = vi.fn(async () => result);
  const groupAllowed = vi.fn<NonNullable<GatewayDeps['groupAllowed']>>(async () => true);
  const claimGroupReply = vi.fn(async () => true);
  const claimGroupMemory = vi.fn(async () => true);
  const gateway = new PersonaGateway({
    ...h, deduper: new InMemoryUpdateDeduper(), voice,
    botFor: () => h.bot as unknown as TelegramBotClient,
    decider: { decide }, groupAllowed, claimGroupReply, claimGroupMemory,
  });
  return { ...h, gateway, persona, result, decide, groupAllowed, claimGroupReply, claimGroupMemory };
}

const fact = { content: 'The demo is Friday', kind: 'work', type: 'decision', saidBy: 'milad', about: ['milad'] };

describe('proactive group conversations', () => {
  it('remembers a quiet fact from its actual author and current message without sending a reply', async () => {
    const h = setup();
    h.llm.nextExtraction = { memories: [fact] };
    const update = groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday');
    expect(await h.gateway.handleUpdate('aria', update)).toBe('ignored');
    expect(h.bot.sent).toHaveLength(0);
    const [stored] = await h.memories.listActive('aria');
    expect(stored).toMatchObject({ scope: { kind: 'group', groupId: 'gameend-team' }, source: { personId: 'milad', telegramMessageId: update.message!.message_id } });
    expect(h.claimGroupMemory).toHaveBeenCalledOnce();
    expect(h.llm.extractionRequests[0].messages[0].content).toContain('The demo is Friday');
  });

  it('contributes only after a high-confidence decision and a successful shared claim', async () => {
    const h = setup();
    h.result.proactive.probability = 0.99;
    h.result.memorable.probability = 0;
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Any ideas to improve onboarding?'))).toBe('replied');
    expect(h.claimGroupReply).toHaveBeenCalledOnce();
    h.claimGroupReply.mockResolvedValue(false);
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Another open question?'))).toBe('ignored');
    expect(h.bot.sendMessage).toHaveBeenCalledOnce();
  });

  it('direct mentions bypass cooldown and still answer if Decisions is unavailable', async () => {
    const h = setup();
    h.claimGroupReply.mockResolvedValue(false);
    h.decide.mockRejectedValue(new Error('PRIVATE_PROVIDER_PAYLOAD'));
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, can you help?'))).toBe('replied');
    expect(h.claimGroupReply).not.toHaveBeenCalled();
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('PRIVATE_PROVIDER_PAYLOAD');
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Anyone?'))).toBe('ignored');
    expect(h.bot.sendMessage).toHaveBeenCalledOnce();
  });

  it('mentions-only observes useful context without semantic replies', async () => {
    const h = setup();
    h.persona.groupParticipation = 'mentions';
    h.result.addressed.probability = h.result.proactive.probability = 1;
    h.llm.nextExtraction = { memories: [fact] };
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday'));
    expect(h.bot.sent).toHaveLength(0);
    expect(h.claimGroupReply).not.toHaveBeenCalled();
    expect(await h.memories.listActive('aria')).toHaveLength(1);
  });

  it('does not answer another bot target or observe bot-authored messages', async () => {
    const h = setup();
    h.result.addressed.probability = h.result.proactive.probability = 1;
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, '@someone_else_bot help?'));
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, help', { from: { id: 123, is_bot: true, first_name: 'Bot' } }));
    expect(h.bot.sent).toHaveLength(0);
    expect(h.claimGroupReply).not.toHaveBeenCalled();
    expect(h.decide).toHaveBeenCalledOnce();
  });

  it('stops before history and providers when the agent is not invited or observation is off', async () => {
    const h = setup();
    h.org.getGroupByChatId(GAMEEND_CHAT)!.agentIds = ['another'];
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, hi'));
    h.org.getGroupByChatId(GAMEEND_CHAT)!.agentIds = ['aria'];
    h.persona.groupObservation = false;
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'An ordinary message'));
    expect(await h.history.recent('aria', 'group-gameend-team', 20)).toEqual([]);
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.llm.replyRequests).toHaveLength(0);
  });

  it('rechecks removal after generation and sends nothing', async () => {
    const h = setup();
    let allowed = true;
    h.groupAllowed.mockImplementation(async () => allowed);
    const complete = h.llm.complete.bind(h.llm);
    vi.spyOn(h.llm, 'complete').mockImplementation(async (r) => { const reply = await complete(r); allowed = false; return reply; });
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, help'))).toBe('ignored');
    expect(h.bot.sent).toHaveLength(0);
    expect(h.claimGroupMemory).not.toHaveBeenCalled();
  });

  it('rechecks access after asynchronous history reads before sending context to providers', async () => {
    const h = setup();
    let allowed = true;
    h.groupAllowed.mockImplementation(async () => allowed);
    const recent = h.history.recent.bind(h.history);
    vi.spyOn(h.history, 'recent').mockImplementation(async (...args) => { const rows = await recent(...args); allowed = false; return rows; });
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, help'));
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.llm.replyRequests).toHaveLength(0);
    expect(h.bot.sent).toHaveLength(0);
  });

  it('does not record an assistant turn when access is revoked during speech synthesis', async () => {
    const voice = fakeVoice();
    const h = setup(voice);
    h.persona.replyWithVoice = 'always';
    let allowed = true;
    h.groupAllowed.mockImplementation(async () => allowed);
    voice.synthesize.mockImplementation(async () => { allowed = false; return { audio: new ArrayBuffer(2), mimeType: 'audio/mpeg', filename: 'voice.mp3' }; });
    expect(await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, help'))).toBe('ignored');
    expect(h.bot.sent).toHaveLength(0);
    const history = await h.history.recent('aria', 'group-gameend-team', 20);
    expect(history.map((row) => row.role)).toEqual(['user']);
  });

  it('anchors provider inputs to the current event even when later concurrent messages fill history', async () => {
    const h = setup();
    const update = groupText(GAMEEND_CHAT, TG.milad, 'Aria, ORIGINAL_CURRENT_EVENT');
    const recent = h.history.recent.bind(h.history);
    vi.spyOn(h.history, 'recent').mockImplementation(async (...args) => {
      for (let i = 1; i <= 25; i++) await h.history.append('aria', 'group-gameend-team', {
        role: 'user', personId: 'reza', text: 'FUTURE_EVENT_CANARY', at: new Date(),
        telegramMessageId: update.message!.message_id + i, groupPolicyVersion: 1,
      });
      return recent(...args);
    });
    await h.gateway.handleUpdate('aria', update);
    expect(JSON.stringify(h.decide.mock.calls)).toContain('ORIGINAL_CURRENT_EVENT');
    expect(h.llm.replyRequests[0].messages.at(-1)?.content).toBe('Milad: Aria, ORIGINAL_CURRENT_EVENT');
    expect(JSON.stringify([h.decide.mock.calls, h.llm.replyRequests, h.llm.extractionRequests])).not.toContain('FUTURE_EVENT_CANARY');
  });

  it('rechecks memory revocation after extraction and saves nothing', async () => {
    const h = setup();
    let allowed = true;
    h.groupAllowed.mockImplementation(async (_a, _g, _u, action) => action !== 'remember' || allowed);
    h.llm.nextExtraction = { memories: [fact] };
    const complete = h.llm.complete.bind(h.llm);
    vi.spyOn(h.llm, 'complete').mockImplementation(async (r) => { const reply = await complete(r); allowed = false; return reply; });
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday'));
    expect(await h.memories.listActive('aria')).toHaveLength(0);
  });

  it.each(["Don't remember this: the demo is Friday", 'ذخیره نکن: جلسه جمعه است'])('honors a durable-memory opt-out: %s', async (text) => {
    const h = setup();
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, text));
    expect(h.claimGroupMemory).not.toHaveBeenCalled();
    expect(h.llm.extractionCalls).toBe(0);
  });

  it('remember off and an already-claimed source both skip extraction', async () => {
    const h = setup();
    h.persona.groupRemember = false;
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday'));
    h.persona.groupRemember = true;
    h.claimGroupMemory.mockResolvedValue(false);
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday'));
    expect(h.llm.extractionCalls).toBe(0);
  });

  it('rejects personal/confidential facts and forged author or nonparticipant claims', async () => {
    const h = setup();
    h.llm.nextExtraction = { memories: [
      { ...fact, kind: 'personal' }, { ...fact, confidential: true },
      { ...fact, saidBy: 'reza' }, { ...fact, about: ['sina'] },
    ] };
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday'));
    expect(await h.memories.listActive('aria')).toHaveLength(0);
  });

  it('does not let an older source replace a newer correction after out-of-order completion', async () => {
    const h = setup();
    h.llm.nextExtraction = { memories: [{ ...fact, topic: 'demo date' }] };
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Friday', { message_id: 102 }));
    h.llm.nextExtraction = { memories: [{ ...fact, content: 'The demo is Thursday', topic: 'demo date' }] };
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'The demo is Thursday', { message_id: 101 }));
    expect((await h.memories.listActive('aria')).map((row) => row.content)).toEqual(['The demo is Friday']);
  });

  it('never feeds legacy group transcripts, DM memories or other groups into providers', async () => {
    const h = setup();
    await h.history.append('aria', 'group-gameend-team', { role: 'assistant', text: 'LEGACY_PRIVATE_CANARY', at: new Date() });
    for (const record of [memory({ content: 'DM_CANARY', scope: { kind: 'private', personId: 'milad' } }), memory({ content: 'OTHER_GROUP_CANARY', scope: { kind: 'group', groupId: 'leads' } })]) h.memories.records.set(record.id, record);
    await h.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.milad, 'Aria, what is the plan?'));
    const providerRequests = JSON.stringify([h.decide.mock.calls, h.llm.replyRequests, h.llm.extractionRequests]);
    for (const canary of ['LEGACY_PRIVATE_CANARY', 'DM_CANARY', 'OTHER_GROUP_CANARY']) expect(providerRequests).not.toContain(canary);
  });
});
