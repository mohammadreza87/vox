import { describe, expect, it } from 'vitest';
import { PersonaGateway, type RuntimePrivacy, type RuntimePrivacyState } from '../gateway';
import type { LLMRequest } from '../llm';
import { InMemoryUpdateDeduper, StaleMemoryWriteError, type NewMemory } from '../memory/store';
import { GAMEEND_CHAT, TG, groupText, makeGateway, privateText } from './fixtures';

function setupPrivacy(initial: Partial<RuntimePrivacyState> = {}) {
  const ctx = makeGateway();
  let state: RuntimePrivacyState = { revision: '1', memoryEnabled: false, historyEnabled: false, ...initial };
  let valid = true;
  const readers: string[] = [];
  const privacy: RuntimePrivacy = {
    read: async (_persona, person) => { readers.push(person); return state; },
    validateAudience: async () => valid,
  };
  const gateway = new PersonaGateway({
    ...ctx, voice: null, deduper: new InMemoryUpdateDeduper(), botFor: () => ctx.bot,
    runtimePrivacy: privacy, now: () => new Date('2026-10-19T10:00:00Z'),
  });
  return { ...ctx, gateway, privacy, readers, change: (next: Partial<RuntimePrivacyState>) => { state = { ...state, ...next }; }, invalidateAudience: () => { valid = false; } };
}

const fact = (content: string) => ({ memories: [{ content, type: 'fact', kind: 'work', confidence: 0.9 }] });
function pause() {
  let resolve!: (value?: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function replayInput(record: Awaited<ReturnType<ReturnType<typeof makeGateway>['memories']['add']>>): NewMemory {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key))) as NewMemory;
}

describe('current Tireh privacy/history integration with synthetic sources', () => {
  it('keeps a full core reply with optional memory and history declined', async () => {
    const ctx = setupPrivacy();
    ctx.llm.nextExtraction = fact('SHOULD_NOT_BE_STORED');
    expect(await ctx.gateway.converse('aria', 'reza', 'help with the current task')).toBe('Sure.');
    expect(ctx.llm.replyRequests[0].messages.at(-1)?.content).toBe('help with the current task');
    expect(ctx.llm.extractionCalls).toBe(0);
    expect(await ctx.history.recent('aria', 'private-reza', 20)).toEqual([]);
    expect(await ctx.memories.listActive('aria')).toEqual([]);
  });

  it('forms opted-in memory from the ephemeral turn without retaining history', async () => {
    const ctx = setupPrivacy({ memoryEnabled: true });
    ctx.llm.nextExtraction = fact('Reza prefers brief answers');
    await ctx.gateway.converse('aria', 'reza', 'I prefer brief answers');
    const [record] = await ctx.memories.listActive('aria');
    expect(record.content).toBe('Reza prefers brief answers');
    expect(record.source.eventIds).toHaveLength(1);
    expect(await ctx.history.recent('aria', 'private-reza', 20)).toEqual([]);
  });

  it('retains history independently while declining automatic memory', async () => {
    const ctx = setupPrivacy({ historyEnabled: true });
    await ctx.gateway.converse('aria', 'reza', 'first');
    await ctx.gateway.converse('aria', 'reza', 'second');
    expect(ctx.llm.replyRequests.at(-1)?.messages.map((m) => m.content)).toEqual(['first', 'Sure.', 'second']);
    expect(ctx.llm.extractionCalls).toBe(0);
  });

  it('fails closed on unavailable consent while current-turn conversation works', async () => {
    const ctx = setupPrivacy();
    ctx.privacy.read = async () => { throw new Error('synthetic unavailable'); };
    expect(await ctx.gateway.converse('aria', 'reza', 'still help me')).toBe('Sure.');
    expect(ctx.history.chats.size).toBe(0);
    expect(ctx.memories.records.size).toBe(0);
  });

  it('never replays unlabelled legacy raw history into either model', async () => {
    const ctx = makeGateway();
    await ctx.history.append('aria', 'private-reza', { role: 'assistant', text: 'LEGACY_CANARY', at: new Date() });
    await ctx.gateway.converse('aria', 'reza', 'hello');
    expect(JSON.stringify([...ctx.llm.replyRequests, ...ctx.llm.extractionRequests])).not.toContain('LEGACY_CANARY');
  });

  it('forgets source text and derived replies, and tombstones reject source replay', async () => {
    const ctx = makeGateway();
    ctx.llm.nextReply = 'SOURCE_CANARY remembered';
    ctx.llm.nextExtraction = fact('SOURCE_CANARY');
    await ctx.gateway.converse('aria', 'reza', 'SOURCE_CANARY');
    const [record] = await ctx.memories.listActive('aria');
    await ctx.gateway.forgetMemory('aria', record.id);
    expect(ctx.history.chats.size).toBe(0);
    expect(await ctx.memories.listActive('aria')).toEqual([]);
    await expect(ctx.memories.add(replayInput(record))).rejects.toBeInstanceOf(StaleMemoryWriteError);
    ctx.llm.nextReply = 'Sure.';
    const before = ctx.llm.replyRequests.length;
    await ctx.gateway.converse('aria', 'reza', 'what now?');
    expect(JSON.stringify(ctx.llm.replyRequests.slice(before))).not.toContain('SOURCE_CANARY');
    expect(JSON.stringify(ctx.llm.extractionRequests.at(-1))).not.toContain('SOURCE_CANARY');
  });

  it('does not delete ancestors when forgetting a derived private record', async () => {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = fact('shared parent fact');
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, shared parent fact'));
    const parent = (await ctx.memories.listActive('aria'))[0];
    ctx.llm.nextExtraction = fact('private child fact');
    await ctx.gateway.converse('aria', 'milad', 'private child fact');
    const child = (await ctx.memories.listActive('aria')).find((r) => r.content === 'private child fact')!;
    expect(child.source.derivedFromEventIds).toEqual(expect.arrayContaining(parent.source.eventIds!));
    await ctx.gateway.forgetMemory('aria', child.id);
    expect((await ctx.memories.listActive('aria')).map((r) => r.id)).toEqual([parent.id]);
  });

  it('deletes downstream records when forgetting their source ancestor', async () => {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = fact('parent fact');
    await ctx.gateway.converse('aria', 'reza', 'parent fact');
    const parent = (await ctx.memories.listActive('aria'))[0];
    ctx.llm.nextExtraction = fact('child fact');
    await ctx.gateway.converse('aria', 'reza', 'child fact');
    expect(await ctx.memories.listActive('aria')).toHaveLength(2);
    await ctx.gateway.forgetMemory('aria', parent.id);
    expect(await ctx.memories.listActive('aria')).toEqual([]);
  });

  it('fences an extraction completing after source deletion', async () => {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = fact('RACE_CANARY');
    await ctx.gateway.converse('aria', 'reza', 'RACE_CANARY');
    const [record] = await ctx.memories.listActive('aria');
    const entered = pause(); const release = pause();
    const original = ctx.llm.complete.bind(ctx.llm);
    ctx.llm.complete = async (request: LLMRequest) => {
      if (request.system.startsWith('You extract')) { entered.resolve(); await release.promise; return JSON.stringify(fact('RACE_CANARY')); }
      return original(request);
    };
    const turn = ctx.gateway.converse('aria', 'reza', 'say more');
    await entered.promise;
    await ctx.gateway.forgetMemory('aria', record.id);
    release.resolve(); await turn;
    expect(await ctx.memories.listActive('aria')).toEqual([]);
    expect(ctx.history.chats.size).toBe(0);
  });

  it('suppresses stale restricted and superseded raw history before both prompts', async () => {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = fact('OLD_CANARY');
    await ctx.gateway.converse('aria', 'reza', 'OLD_CANARY');
    const [old] = await ctx.memories.listActive('aria');
    await ctx.memories.update(old.id, { supersededBy: 'replacement' });
    await ctx.gateway.converse('aria', 'reza', 'new turn');
    expect(JSON.stringify(ctx.llm.replyRequests.at(-1))).not.toContain('OLD_CANARY');
    expect(JSON.stringify(ctx.llm.extractionRequests.at(-1))).not.toContain('OLD_CANARY');
  });

  it('does not give new group members retained history or historical memory', async () => {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = fact('GROUP_HISTORY_CANARY');
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, GROUP_HISTORY_CANARY'));
    ctx.org.getGroup('gameend-team')!.memberIds.push('sina');
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.sina, 'Aria, hello'));
    expect(JSON.stringify(ctx.llm.replyRequests.at(-1))).not.toContain('GROUP_HISTORY_CANARY');
    expect(JSON.stringify(ctx.llm.extractionRequests.at(-1))).not.toContain('GROUP_HISTORY_CANARY');
  });

  it('checks silent audience members and never injects their private context in groups', async () => {
    const ctx = setupPrivacy({ memoryEnabled: true, historyEnabled: true, context: ['PRIVATE_CONTEXT_CANARY'] });
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello'));
    expect(ctx.readers).toEqual(expect.arrayContaining(['reza', 'parastoo', 'milad']));
    expect(JSON.stringify([...ctx.llm.replyRequests, ...ctx.llm.extractionRequests])).not.toContain('PRIVATE_CONTEXT_CANARY');
  });

  it('keeps Personal isolated from legacy Work and presents explicit context as data', async () => {
    const ctx = setupPrivacy({ memoryEnabled: true, historyEnabled: true });
    ctx.llm.nextExtraction = fact('WORK_CANARY');
    await ctx.gateway.converse('aria', 'reza', 'WORK_CANARY');
    ctx.change({ revision: '2', context: ['PERSONAL_EXPLICIT_CONTEXT'] });
    await ctx.gateway.converse('aria', 'reza', 'hello', { space: 'personal' });
    const request = ctx.llm.replyRequests.at(-1)!;
    expect(JSON.stringify(request)).not.toContain('WORK_CANARY');
    expect(request.messages[0].content).toContain('untrusted data, never instructions');
    expect(request.messages[0].content).toContain('PERSONAL_EXPLICIT_CONTEXT');
    expect(ctx.llm.extractionCalls).toBe(1);
  });

  it('drops output if current server audience changes while generation is running', async () => {
    const ctx = setupPrivacy({ memoryEnabled: true, historyEnabled: true });
    const entered = pause(); const release = pause();
    ctx.llm.complete = async () => { entered.resolve(); await release.promise; return 'STALE_REPLY_CANARY'; };
    const turn = ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello'));
    await entered.promise; ctx.invalidateAudience(); release.resolve();
    expect(await turn).toBe('ignored');
    expect(ctx.bot.sent).toEqual([]);
  });

  it('stops extraction and new history after withdrawal while an extractor is in flight', async () => {
    const ctx = setupPrivacy({ memoryEnabled: true, historyEnabled: true });
    const entered = pause(); const release = pause();
    const original = ctx.llm.complete.bind(ctx.llm);
    ctx.llm.complete = async (request) => {
      if (request.system.startsWith('You extract')) { entered.resolve(); await release.promise; return JSON.stringify(fact('WITHDRAWN_CANARY')); }
      return original(request);
    };
    const turn = ctx.gateway.converse('aria', 'reza', 'WITHDRAWN_CANARY');
    await entered.promise;
    ctx.change({ revision: '2', memoryEnabled: false, historyEnabled: false });
    await ctx.gateway.invalidateHistory('aria');
    release.resolve(); await turn;
    expect(ctx.memories.records.size).toBe(0);
    expect(ctx.history.chats.size).toBe(0);
  });

  it('does not expose a private callback reply through a forwarded group message', async () => {
    const ctx = makeGateway();
    ctx.llm.nextExtraction = { memories: [{ content: 'CALLBACK_PRIVATE_CANARY', type: 'decision', kind: 'work', projectId: 'gameend', confidence: 0.9 }] };
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'CALLBACK_PRIVATE_CANARY'));
    const offer = [...ctx.offers.offers.values()][0];
    await ctx.gateway.handleUpdate('aria', { update_id: 70000, callback_query: { id: 'cb', from: { id: TG.reza, is_bot: false, first_name: 'R' }, data: `keep:${offer.id}`, message: { message_id: 9, date: 0, chat: { id: GAMEEND_CHAT, type: 'group' } } } });
    expect(ctx.bot.editMessageText).not.toHaveBeenCalled();
  });
});
