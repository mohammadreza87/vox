import { describe, expect, it, vi } from 'vitest';
import { hire, ID, makeStudio, seedOrg } from './helpers';
import { handleAgentUpdate } from '../updates';
import type { TelegramUpdate } from '../../tireh/telegram/client';

describe('group updates completing out of order', () => {
  it('extracts both distinct sources when the newer decision finishes first', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot, botId } = await hire(h, org.alice, { name: 'Nova', role: 'Producer' });
    await h.store.update((state) => {
      state.groups.push({ chatId: -700, title: 'QA', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [agent.id], addedBy: ID.alice, addedAt: '' });
    });
    // A verifiable roster keeps the audience complete; an unverified group is
    // treated as having guests, where no memory may be formed.
    const roster = [ID.alice, ID.bob, botId];
    bot().getChatMemberCount.mockResolvedValue(roster.length);
    Object.assign(bot(), { getChatMember: vi.fn(async (_chatId: number, id: number) => ({ status: roster.includes(id) ? 'member' : 'left', user: { id, is_bot: id === botId, first_name: 'Synthetic' } })) });
    let release!: () => void;
    let entered!: () => void;
    const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    h.studio.deps.decider = { decide: vi.fn(async (input) => {
      if (input.endsWith('FIRST_FACT')) { entered(); await pending; }
      return {
        effort: { type: 'choice', choice: 'quick', confidence: 1 },
        live_info: { type: 'predicate', probability: 0 },
        memorable: { type: 'predicate', probability: 1 },
        addressed: { type: 'predicate', probability: 0 },
        proactive: { type: 'predicate', probability: 0 },
      };
    }) };
    vi.spyOn(h.chatLLM, 'complete').mockImplementation(async (request) => JSON.stringify({ memories: [{
      content: request.messages[0].content.includes('FIRST_FACT') ? 'First distinct fact' : 'Second distinct fact',
      type: 'fact', kind: 'work', saidBy: `tg-${ID.bob}`, about: [],
    }] }));
    const update = (id: number, text: string): TelegramUpdate => ({
      update_id: id, message: { message_id: id, from: { id: ID.bob, is_bot: false, first_name: 'Bob' }, chat: { id: -700, type: 'supergroup' }, text, date: 0 },
    });
    const first = handleAgentUpdate(h.studio, agent.id, update(101, 'FIRST_FACT'));
    await firstEntered;
    await handleAgentUpdate(h.studio, agent.id, update(102, 'SECOND_FACT'));
    release();
    await first;
    const memories = await h.memory.memories.listActive(agent.id);
    expect(memories.map((row) => row.source.telegramMessageId).sort()).toEqual([101, 102]);
    expect(memories.map((row) => row.content).sort()).toEqual(['First distinct fact', 'Second distinct fact']);
    expect(bot().sendMessage).not.toHaveBeenCalled();
    expect((await h.store.read()).groups[0].hasGuests).toBe(false);
  });
});
