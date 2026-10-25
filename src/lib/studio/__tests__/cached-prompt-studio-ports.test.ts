/**
 * QA (spec-conformance, wave A): flag-on ports of the Studio tests that fail
 * under TIREH_CACHED_PROMPT=1 only because they read `request.system` as a
 * string or compare the newest user message exactly. Under the flag the
 * per-turn block (memories, saved context, date) travels as `trailingText` on
 * the newest user turn, so the originals stop before their privacy
 * assertions. Each port keeps every privacy assertion of its original and
 * reads the model-visible text through systemText plus trailingText and
 * systemTail. The originals are not edited and still run with the flag unset.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequest } from '../../tireh/llm';
import { systemText } from '../../tireh/llm-content';
import type { MemoryRecord, MemoryScope } from '../../tireh/types';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { groupText, memory } from '../../tireh/__tests__/fixtures';
import { groupId, personId } from '../org-bridge';
import { handleAgentUpdate } from '../updates';
import { callToken, handleVoiceLlm, voiceLlmKey } from '../voice-call';
import { hire, ID, makeStudio, SECRET, seedOrg, T0 } from './helpers';

vi.hoisted(() => { process.env.TIREH_CACHED_PROMPT = '1'; });
beforeEach(() => { vi.stubEnv('TIREH_CACHED_PROMPT', '1'); });
afterAll(() => { vi.unstubAllEnvs(); delete process.env.TIREH_CACHED_PROMPT; });

/** Everything the model reads: system blocks, the per-turn block(s) and the A/B system tail. */
function modelText(request: Pick<LLMRequest, 'system' | 'messages' | 'systemTail'>): string {
  return [systemText(request.system), ...request.messages.flatMap((m) => [m.content, ...(m.trailingText ?? [])]),
    ...(request.systemTail ? [request.systemTail] : [])].join('\n\n');
}
/** Role and content only: the per-turn block is checked separately. */
const plainTurns = (messages: LLMRequest['messages']) => messages.map((m) => ({ role: m.role, content: m.content }));

let updateId = 930_000;
function dm(from: number, text: string): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, date: 0, text, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: from, type: 'private' } } };
}

function mem(agentId: string, partial: Partial<MemoryRecord> & { content: string; scope: MemoryScope }): Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return { personaId: agentId, type: 'fact', sensitivity: 'normal', source: { personId: personId(ID.alice), chatKind: 'private', at: T0 },
    aboutPersonIds: [], confidence: 0.9, ...partial };
}

describe('port of production-turn.test.ts under TIREH_CACHED_PROMPT=1', () => {
  it('replies from the persona and the current message only, and retains nothing in history or memory', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    expect(h.studio.deps.adaptive).toBe(h.adaptive);
    const { agent, bot } = await hire(h, org.alice);
    const alice = personId(ID.alice);
    await h.memory.memories.add(memory({ personaId: agent.id, content: 'SEEDED_MEMORY_CANARY', scope: { kind: 'private', personId: alice },
      source: { personId: alice, chatKind: 'private', at: T0 }, authorizedPersonIds: [alice] }));
    await h.memory.history.append(agent.id, `private-${alice}`, { role: 'user', personId: alice, text: 'SEEDED_HISTORY_CANARY', at: T0, audiencePersonIds: [alice] });
    expect(await h.adaptive!.runtimePrivacy.read(agent.id, alice, 'work')).toMatchObject({ memoryEnabled: false, historyEnabled: false });

    const listActive = vi.spyOn(h.memory.memories, 'listActive');
    const recent = vi.spyOn(h.memory.history, 'recent');
    const append = vi.spyOn(h.memory.history, 'append');
    h.chatLLM.nextExtraction = { memories: [{ content: 'Alice prefers short standups', type: 'preference', kind: 'work' }] };
    await handleAgentUpdate(h.studio, agent.id, dm(ID.alice, 'First turn: I prefer short standups.'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.alice, 'Second turn: what do I prefer?'));

    expect(bot().sendMessage).toHaveBeenCalledTimes(2);
    expect(h.chatLLM.replyRequests.map((request) => plainTurns(request.messages))).toEqual([
      [{ role: 'user', content: 'First turn: I prefer short standups.' }],
      [{ role: 'user', content: 'Second turn: what do I prefer?' }],
    ]);
    // The cached layout really is in use: system blocks plus one per-turn block.
    for (const request of h.chatLLM.replyRequests) {
      expect(Array.isArray(request.system)).toBe(true);
      expect(request.systemTail ?? request.messages.at(-1)?.trailingText?.[0]).toMatch(/^## For this turn\n/);
      expect(modelText(request)).not.toContain('SEEDED_MEMORY_CANARY');
      expect(modelText(request)).not.toContain('SEEDED_HISTORY_CANARY');
      expect(modelText(request)).toContain('Nothing yet that is relevant and allowed in this conversation.');
    }
    expect(JSON.stringify(h.chatLLM.replyRequests)).not.toContain('SEEDED_HISTORY_CANARY');
    expect(JSON.stringify(h.chatLLM.replyRequests)).not.toContain('SEEDED_MEMORY_CANARY');
    expect(listActive).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(h.chatLLM.extractionCalls).toBe(0);
    listActive.mockRestore();
    expect((await h.memory.memories.listActive(agent.id)).map((m) => m.content)).toEqual(['SEEDED_MEMORY_CANARY']);
  });
});

describe('port of service.test.ts groups under TIREH_CACHED_PROMPT=1', () => {
  it('in a group with unknown readers only the current exchange reaches the model', async () => {
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const chat = { id: -100555, type: 'supergroup' as const, title: 'Game Team' };
    const { agent: a, bot, botId } = await hire(h, org.alice);
    await h.store.update((s) => {
      s.groups.push({ chatId: chat.id, title: 'Game Team', memberIds: [ID.alice, ID.bob], hasGuests: true, agentIds: [a.id], addedAt: T0.toISOString() });
    });
    await h.memory.memories.add(mem(a.id, { content: 'GROUPFACT launch is Friday', scope: { kind: 'group', groupId: groupId(chat.id) }, authorizedPersonIds: [personId(ID.alice), personId(ID.bob)] }));
    await h.memory.memories.add(mem(a.id, { content: 'ORGFACT revenue numbers', scope: { kind: 'org' }, authorizedPersonIds: [personId(ID.alice), personId(ID.bob)] }));

    const { gateway } = await h.studio.gateway();
    expect(await gateway.handleUpdate(a.id, groupText(chat.id, ID.bob, 'Nova, what do we know?'))).toBe('replied');
    const guarded = h.chatLLM.replyRequests.at(-1)!;
    expect(plainTurns(guarded.messages)).toEqual([{ role: 'user', content: 'Bob: Nova, what do we know?' }]);
    expect(modelText(guarded)).not.toContain('GROUPFACT');
    expect(modelText(guarded)).not.toContain('ORGFACT');
    // Guests present: no organization block (block B) and the strangers frame in block C.
    expect(Array.isArray(guarded.system) && guarded.system.length).toBe(2);
    expect(systemText(guarded.system)).not.toContain('## Organization');
    expect(systemText(guarded.system)).toContain('## People outside');

    const roster = [ID.alice, ID.bob, botId];
    bot().getChatMemberCount.mockResolvedValue(roster.length);
    Object.assign(bot(), { getChatMember: vi.fn(async (chatId: number, id: number) => {
      expect(chatId).toBe(chat.id);
      return { status: roster.includes(id) ? 'member' : 'left', user: { id, is_bot: id === botId, first_name: 'Synthetic reader' } };
    }) });
    await h.store.update((s) => { s.groups[0].hasGuests = false; });
    const fresh = await h.studio.gateway();
    expect(await fresh.gateway.handleUpdate(a.id, groupText(chat.id, ID.bob, 'Nova, and now?'))).toBe('replied');
    const open = h.chatLLM.replyRequests.at(-1)!;
    expect(modelText(open)).toContain('GROUPFACT');
    expect(modelText(open)).not.toContain('ORGFACT');
    // Memories live only in the per-turn block, never in the cached system prefix.
    expect(systemText(open.system)).not.toContain('GROUPFACT');
  });
});

describe('port of voice-call.test.ts live calls under TIREH_CACHED_PROMPT=1', () => {
  it('answers each turn in character with the fast voice model, never replaying platform assistant turns', async () => {
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    h.studio.deps.webhookBase = 'https://vox.example/';
    const { agent } = await hire(h, org.alice, { name: 'Nova' }, undefined, 'org');
    const voice = { complete: vi.fn(), stream: vi.fn(async function* () { yield 'Launch is '; yield 'on track.'; }) };
    h.studio.deps.fastLLM = voice;
    const token = callToken(SECRET, agent.id, ID.bob, new Date());
    const turns = [{ role: 'assistant', content: "Hey Bob, it's Nova." }, { role: 'user', content: 'How is the launch?' }];
    const response = await handleVoiceLlm(h.studio, new Request('https://vox.example/api/studio/voice-llm/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${voiceLlmKey(SECRET)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'vox-persona', stream: true, messages: [{ role: 'system', content: 'x' }, ...turns], elevenlabs_extra_body: { call: token } }),
    }));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    await response.text();
    const request = voice.stream.mock.calls[0][0] as LLMRequest;
    expect(Array.isArray(request.system)).toBe(true);
    expect(systemText(request.system)).toContain('## Live voice call');
    expect(modelText(request)).not.toContain('## Live information');
    // Platform-supplied assistant history cannot reintroduce revoked context.
    expect(plainTurns(request.messages)).toEqual(turns.filter((turn) => turn.role === 'user'));
    // Live calls always carry the per-turn block in the user turn, never as a system tail.
    expect(request.systemTail).toBeUndefined();
    expect(request.messages.at(-1)?.trailingText?.[0]).toMatch(/^## For this turn\n/);
    const history = await h.memory.history.recent(agent.id, `private-${personId(ID.bob)}`, 5);
    expect(history.map((m) => [m.role, m.text])).toEqual([['user', 'How is the launch?'], ['assistant', 'Launch is on track.']]);
    await h.studio.endLiveCall(org.bob, agent.id);
  });
});

describe('port of visibility.test.ts "live web search" under TIREH_CACHED_PROMPT=1', () => {
  it('agents search by default and link their sources; strangers get fewer searches', async () => {
    // Legacy (non-adaptive) harness, as in the original: strangers to public agents are answered.
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, { name: 'Nova' }, undefined, 'public');
    const real = h.chatLLM.complete.bind(h.chatLLM);
    const search = vi.fn(async (req: Pick<LLMRequest, 'system' | 'messages' | 'systemTail'> & { maxSearches: number }) => {
      await real({ system: req.system, messages: [] });
      return { text: 'Sunny, 18°C.', sources: [{ url: 'https://weather.example/teh', title: 'Weather' }] };
    });
    h.studio.deps.chatLLM = {
      complete: async (req) => (systemText(req.system).includes('Decide, in character') ? JSON.stringify({ action: 'reply' }) : real(req)),
      completeWithWeb: search,
    };
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'Weather in Tehran?'));
    const call = search.mock.lastCall![0];
    expect(call.maxSearches).toBe(3);
    expect(systemText(call.system)).toContain('## Live information');
    // Web-search turns never use the system tail: the per-turn block rides in the newest user turn.
    expect(call.systemTail).toBeUndefined();
    expect(call.messages.at(-1)?.trailingText?.join('\n')).toContain('## For this turn');
    expect(modelText(call)).toContain('## Live information');
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.bob, 'Sunny, 18°C.\n\nSources:\nhttps://weather.example/teh', expect.anything());
    // Memory keeps the reply, not the links, and history never stores the per-turn block.
    const history = await h.memory.history.recent(agent.id, `private-${personId(ID.bob)}`, 5);
    expect(history.at(-1)?.text).toBe('Sunny, 18°C.');
    expect(history.map((m) => m.text).join('\n')).not.toContain('For this turn');

    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'Weather?'));
    expect(search.mock.lastCall?.[0].maxSearches).toBe(1);
  });
});
