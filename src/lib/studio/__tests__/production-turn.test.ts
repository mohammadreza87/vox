/**
 * What a Studio text turn loads and retains in the production configuration
 * (runtime.ts always wires the adaptive service, and so does makeStudio()).
 *
 * Today the adaptive privacy adapter disables TIREH history and memory
 * unconditionally (docs/AGENT_INTELLIGENCE_SOLUTION.md section 3.2): each reply
 * sees only the persona and the current message. These assertions make that
 * explicit. Step 4 of the plan (continuity under consent) is expected to
 * change them deliberately; nothing else should.
 */
import { readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { memory } from '../../tireh/__tests__/fixtures';
import { personId } from '../org-bridge';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg, T0 } from './helpers';

let updateId = 920_000;
/** Every file under a directory, relative, sorted: proves no adaptive document appeared. */
function files(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath: string }>)
    .filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length)).sort();
}
function callbacks(options: unknown): string[] {
  return ((options as { keyboard?: { inline_keyboard: Array<Array<{ callback_data?: string }>> } } | undefined)?.keyboard?.inline_keyboard ?? [])
    .flat().map((b) => b.callback_data).filter((d): d is string => !!d);
}
function dm(from: number, text: string): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, date: 0, text, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: from, type: 'private' } } };
}

describe('a Studio text turn with the adaptive service wired (production default)', () => {
  it('replies from the persona and the current message only, and retains nothing in history or memory', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    expect(h.adaptive).toBeDefined();
    expect(h.studio.deps.adaptive).toBe(h.adaptive);
    const { agent, bot } = await hire(h, org.alice);
    const alice = personId(ID.alice);

    // What the legacy path would load: a private memory and an earlier turn.
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

    // It does reply, every time.
    expect(bot().sendMessage).toHaveBeenCalledTimes(2);
    // Loads: only the current message reaches the model; neither the seeded
    // turn nor the previous turn of this conversation is replayed.
    expect(h.chatLLM.replyRequests.map((request) => request.messages)).toEqual([
      [{ role: 'user', content: 'First turn: I prefer short standups.' }],
      [{ role: 'user', content: 'Second turn: what do I prefer?' }],
    ]);
    for (const prompt of h.chatLLM.replyPrompts) {
      expect(prompt).not.toContain('SEEDED_MEMORY_CANARY');
      expect(prompt).toContain('Nothing yet that is relevant and allowed in this conversation.');
    }
    expect(JSON.stringify(h.chatLLM.replyRequests)).not.toContain('SEEDED_HISTORY_CANARY');
    expect(listActive).not.toHaveBeenCalled();
    expect(recent).not.toHaveBeenCalled();
    // Retains: no history row, no extraction request and no new memory.
    expect(append).not.toHaveBeenCalled();
    expect(h.chatLLM.extractionCalls).toBe(0);
    listActive.mockRestore();
    expect((await h.memory.memories.listActive(agent.id)).map((m) => m.content)).toEqual(['SEEDED_MEMORY_CANARY']);
  });

  it('with Circles off, sends nothing to a stranger the public agent decides to answer, because the adaptive audience check refuses guests', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, {}, undefined, 'public');
    const chat = h.chatLLM;
    const decisions: string[] = [];
    h.studio.deps.chatLLM = { complete: async (request) => {
      if (!request.system.includes('Decide, in character')) return chat.complete(request);
      decisions.push('reply');
      return JSON.stringify({ action: 'reply' });
    } };
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'Hello, what do you work on?'));
    expect(decisions).toEqual(['reply']);
    expect(chat.replyRequests).toEqual([]);
    expect(bot().sendMessage).not.toHaveBeenCalled();
    expect((await h.store.read()).guests?.map((guest) => guest.telegramId)).toEqual([ID.stranger]);
  });

  it('with Circles on, an unchosen stranger gets the agent card, with no chatLLM or decider call', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, {}, undefined, 'public');
    h.studio.deps.circles = () => 'reply';
    const complete = vi.fn(h.chatLLM.complete.bind(h.chatLLM));
    const decide = vi.fn(async () => ({ decision: null }));
    h.studio.deps.chatLLM = { complete };
    h.studio.deps.decider = { decide } as unknown as NonNullable<typeof h.studio.deps.decider>;
    const before = files(h.dir);
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'Hello, what do you work on?'));
    expect(complete).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    const [[chatId, text, options]] = bot().sendMessage.mock.calls;
    expect(chatId).toBe(ID.stranger);
    expect(text).toContain('Join also lets Nova keep your own notes and use notes from groups you join.');
    expect(callbacks(options)).toEqual([expect.stringMatching(/^cj:/), expect.stringMatching(/^cr:/), expect.stringMatching(/^cd:/)]);
    expect(await h.studio.deps.choices!.listForUser(ID.stranger)).toEqual([expect.objectContaining({ receipts: [expect.anything()] })]);
    expect((await h.studio.deps.choices!.listForUser(ID.stranger))[0]).not.toHaveProperty('join');
    expect(files(h.dir).filter((f) => f.includes('adaptive'))).toEqual(before.filter((f) => f.includes('adaptive')));
  });

  it('with Circles on, a reply_only stranger gets a reply with no stored context and no organization, and no adaptive document is created', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, {}, undefined, 'public');
    h.studio.deps.circles = () => 'reply';
    const stranger = personId(ID.stranger);
    await h.memory.memories.add(memory({ personaId: agent.id, content: 'SEEDED_MEMORY_CANARY', scope: { kind: 'private', personId: stranger },
      source: { personId: stranger, chatKind: 'private', at: T0 }, authorizedPersonIds: [stranger] }));
    await h.memory.history.append(agent.id, `private-${stranger}`, { role: 'user', personId: stranger, text: 'SEEDED_HISTORY_CANARY', at: T0, audiencePersonIds: [stranger] });
    const adaptiveBefore = files(h.dir).filter((f) => f.includes('adaptive'));
    expect(files(h.dir)).toContain('/studio.json');
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, '/start'));
    const receipt = callbacks(bot().sendMessage.mock.calls[0][2])[1];
    h.clock.now = new Date(T0.getTime() + 1000);
    await handleAgentUpdate(h.studio, agent.id, { update_id: updateId++, callback_query: { id: 'cb-reply', from: { id: ID.stranger, is_bot: false, first_name: 'S' }, data: receipt,
      message: { message_id: 1, date: 0, chat: { id: ID.stranger, type: 'private' } } } });
    expect((await h.studio.deps.choices!.listForUser(ID.stranger)).map((r) => r.join)).toEqual([expect.objectContaining({ choice: 'reply_only', telegramId: ID.stranger })]);

    const chat = h.chatLLM;
    h.studio.deps.chatLLM = { complete: async (request) => request.system.includes('Decide, in character') ? JSON.stringify({ action: 'reply' }) : chat.complete(request) };
    const append = vi.spyOn(h.memory.history, 'append');
    const listActive = vi.spyOn(h.memory.memories, 'listActive');
    h.chatLLM.nextExtraction = { memories: [{ content: 'Stranger likes puzzles', type: 'preference', kind: 'work' }] };
    bot().sendMessage.mockClear();
    await handleAgentUpdate(h.studio, agent.id, dm(ID.stranger, 'Hello, what do you work on?'));
    expect(bot().sendMessage).toHaveBeenCalledWith(ID.stranger, 'Sure.', expect.anything());
    expect(chat.replyRequests.map((request) => request.messages)).toEqual([[{ role: 'user', content: 'Hello, what do you work on?' }]]);
    const [prompt] = chat.replyPrompts;
    expect(prompt).not.toContain('SEEDED_MEMORY_CANARY');
    expect(prompt).not.toContain('## Organization');
    expect(prompt).not.toContain('Alice');
    expect(JSON.stringify(chat.replyRequests)).not.toContain('SEEDED_HISTORY_CANARY');
    expect(listActive).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(chat.extractionCalls).toBe(0);
    expect(files(h.dir).filter((f) => f.includes('adaptive'))).toEqual(adaptiveBefore);
  });
});
