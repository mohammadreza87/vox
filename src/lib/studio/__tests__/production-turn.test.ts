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
import { describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { memory } from '../../tireh/__tests__/fixtures';
import { personId } from '../org-bridge';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg, T0 } from './helpers';

let updateId = 920_000;
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

  it('sends nothing to a stranger the public agent decides to answer, because the adaptive audience check refuses guests', async () => {
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
});
