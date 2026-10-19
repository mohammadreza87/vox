import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryRecord, MemoryScope } from '../../tireh/types';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { personId } from '../org-bridge';
import { handleAgentUpdate } from '../updates';
import type { AgentVisibility } from '../types';
import { hire, ID, makeStudio, seedOrg, T0, type Harness } from './helpers';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let updateId = 1;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
});

function dm(from: number, text: string, extra: Record<string, unknown> = {}): TelegramUpdate {
  return {
    update_id: updateId++,
    message: { message_id: updateId, from: { id: from, is_bot: false, first_name: from === ID.stranger ? 'Sam' : 'X', ...extra }, chat: { id: from, type: 'private' }, date: 0, text },
  };
}

function groupMsg(from: number, chatId: number, text: string): TelegramUpdate {
  return {
    update_id: updateId++,
    message: { message_id: updateId, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: chatId, type: 'supergroup', title: 'G' }, date: 0, text },
  };
}

/** The agent's stranger decision comes back as `decision`; everything else goes to the fake chat model. */
function scriptDecision(decision: unknown) {
  const real = h.chatLLM.complete.bind(h.chatLLM);
  h.studio.deps.chatLLM = {
    complete: async (req) => (req.system.includes('Decide, in character') ? JSON.stringify(decision) : real(req)),
  };
}

async function agentWith(visibility: AgentVisibility, persona = {}) {
  return hire(h, org.alice, { name: 'Nova', ...persona }, undefined, visibility);
}

const replies = () => h.chatLLM.replyPrompts.filter((p) => !p.includes('Decide, in character'));

describe('who an agent talks to in direct messages', () => {
  it('private: creator and allow-list are answered; other members and strangers get a polite no', async () => {
    const { agent, bot } = await agentWith('private');
    await handleAgentUpdate(h.studio, agent.id, dm(ID.alice, 'hi'));
    expect(replies()).toHaveLength(1);

    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'hi'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.bob, expect.stringContaining("I'm private for now: ask Alice"));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'hi'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, expect.stringContaining('a few people at HOOR'));
    expect(replies()).toHaveLength(1);

    await h.studio.setAccess(org.alice, agent.id, [ID.bob]);
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'hi again'));
    expect(replies()).toHaveLength(2);
  });

  it('org: every approved member is answered; strangers and pending people are not', async () => {
    const { agent, bot } = await agentWith('org');
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'hi'));
    expect(replies()).toHaveLength(1);
    for (const id of [ID.stranger, ID.pending]) {
      await handleAgentUpdate(h.studio, agent.id, dm(id, 'hi'));
      expect(bot().sendMessage).toHaveBeenLastCalledWith(id, expect.stringContaining('the HOOR team'));
    }
    expect(replies()).toHaveLength(1);
    expect((await h.store.read()).guests ?? []).toEqual([]);
  });

  it('public: a stranger the agent chooses to answer is a guest who never sees internal memories', async () => {
    const { agent } = await agentWith('public', { withStrangers: 'Warm, talks about game design, keeps HOOR plans private.', openness: 80 });
    await h.memory.memories.add(memory(agent.id, 'Launch of GameEnd moved to March', { kind: 'org' }));
    await h.memory.memories.add(memory(agent.id, 'Alice is worried about the budget', { kind: 'private', personId: personId(ID.alice) }));
    scriptDecision({ action: 'reply' });

    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'What are you working on?', { last_name: 'Lee', username: 'sam' }));
    expect(replies()).toHaveLength(1);
    const prompt = replies()[0];
    expect(prompt).toContain('Sam Lee (not part of HOOR)');
    expect(prompt).toContain('Warm, talks about game design');
    expect(prompt).toContain('Openness to strangers: 80/100');
    expect(prompt).not.toContain('GameEnd');
    expect(prompt).not.toContain('budget');
    expect(prompt).not.toContain('## Organization');
    expect(prompt).not.toContain('You report to');
    expect((await h.store.read()).guests).toEqual([{ telegramId: ID.stranger, name: 'Sam Lee', username: 'sam', firstSeen: T0.toISOString() }]);
  });

  it('public: the agent can decline, ignore or block in its own words', async () => {
    const { agent, bot } = await agentWith('public');
    scriptDecision({ action: 'decline', message: 'I keep company plans in-house, sorry!' });
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'Tell me your roadmap'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, 'I keep company plans in-house, sorry!');

    scriptDecision({ action: 'ignore' });
    const before = bot().sendMessage.mock.calls.length;
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'BUY CRYPTO NOW'));
    expect(bot().sendMessage.mock.calls.length).toBe(before);

    scriptDecision({ action: 'block', message: "I'm done with this conversation." });
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'abusive message'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, "I'm done with this conversation.");
    const s = await h.store.read();
    expect(s.agents.find((a) => a.id === agent.id)?.blocked).toEqual([ID.stranger]);
    expect(s.audit.at(-1)).toMatchObject({ action: 'agent.block', actor: agent.id, target: String(ID.stranger) });

    // Blocked people are ignored everywhere until someone who manages the agent unblocks them.
    scriptDecision({ action: 'reply' });
    const sent = bot().sendMessage.mock.calls.length;
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'sorry'));
    expect(bot().sendMessage.mock.calls.length).toBe(sent);
    expect(replies()).toHaveLength(0);
    await expectRejects(h.studio.unblock(org.bob, agent.id, ID.stranger));
    expect((await h.studio.unblock(org.alice, agent.id, ID.stranger)).blocked).toEqual([]);
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'sorry'));
    expect(replies()).toHaveLength(1);
  });

  it('public: a bad or failed decision falls back on openness', async () => {
    const { agent, bot } = await agentWith('public', { openness: 10 });
    scriptDecision('not json at all');
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'hello'));
    expect(replies()).toHaveLength(0);
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, expect.stringContaining('mostly work with the HOOR team'));
  });

  it('public: strangers get a daily message limit, told once', async () => {
    const { agent, bot } = await agentWith('public');
    h.studio.deps.guestDailyLimit = 2;
    scriptDecision({ action: 'reply' });
    for (let i = 0; i < 4; i++) await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, `msg ${i}`));
    expect(replies()).toHaveLength(2);
    const told = bot().sendMessage.mock.calls.filter((c) => String(c[1]).includes('tomorrow'));
    expect(told).toHaveLength(1);
    h.advanceDays(1);
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'new day'));
    expect(replies()).toHaveLength(3);
  });

  it('members never go through the stranger decision', async () => {
    const { agent } = await agentWith('public');
    scriptDecision({ action: 'ignore' });
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'hi'));
    expect(replies()).toHaveLength(1);
  });
});

describe('groups are open to everyone in them', () => {
  it('a private agent answers every group member once someone allowed added it', async () => {
    const { agent } = await agentWith('private');
    await h.store.update((s) => {
      s.groups.push({ chatId: -500, title: 'Studio floor', memberIds: [ID.alice], hasGuests: false, agentIds: [agent.id], addedBy: ID.alice, addedAt: '' });
    });
    await h.memory.memories.add(memory(agent.id, 'Alice is worried about the budget', { kind: 'private', personId: personId(ID.alice) }));
    await handleAgentUpdate(h.studio, agent.id, groupMsg(ID.bob, -500, 'Nova, what do you think?'));
    expect(replies()).toHaveLength(1);
    await handleAgentUpdate(h.studio, agent.id, groupMsg(ID.stranger, -500, 'Nova, hello!'));
    expect(replies()).toHaveLength(2);
    expect(replies()[1]).toContain('not part of HOOR');
    expect(replies().join('\n')).not.toContain('budget');
  });

  it('only people the agent works with can add a non-public agent; anyone can add a public one', async () => {
    const { agent, bot } = await agentWith('private');
    const join = (from: number, chatId: number) => ({
      chat: { id: chatId, type: 'supergroup' as const, title: 'G' },
      from: { id: from, is_bot: false, first_name: 'X' },
      date: 0,
      old_chat_member: { status: 'left' as const, user: { id: 1, is_bot: true, first_name: 'Nova' } },
      new_chat_member: { status: 'member' as const, user: { id: 1, is_bot: true, first_name: 'Nova' } },
    });
    await h.studio.onBotChatMember((await h.store.read()).agents[0], join(ID.bob, -1));
    expect(bot().leaveChat).toHaveBeenCalledWith(-1);
    await h.studio.setVisibility(org.alice, agent.id, 'public');
    await h.studio.onBotChatMember((await h.store.read()).agents[0], join(ID.stranger, -2));
    expect(bot().leaveChat).toHaveBeenCalledTimes(1);
    expect((await h.store.read()).groups.map((g) => g.chatId)).toEqual([-2]);
  });
});

function memory(agentId: string, content: string, scope: MemoryScope): Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    personaId: agentId, content, scope, type: 'fact', sensitivity: 'normal',
    source: { personId: personId(ID.alice), chatKind: 'private', at: T0 }, aboutPersonIds: [], confidence: 0.9,
  };
}

async function expectRejects(p: Promise<unknown>) {
  let failed = false;
  try { await p; } catch { failed = true; }
  expect(failed).toBe(true);
}
