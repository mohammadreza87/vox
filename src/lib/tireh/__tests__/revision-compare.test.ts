/**
 * The cancel/abort cases of history-privacy, audience-boundary, gateway,
 * voice-call and adaptive-integration, reproduced through the snapshot +
 * revision-compare path. Every case also asserts that path actually ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequest } from '../llm';
import { systemText } from '../llm-content';
import { PersonaGateway } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { OrgDirectory } from '../org/directory';
import type { TelegramBotClient } from '../telegram/client';
import { callback, FakeLLM, fakeBot, fakeVoice, GAMEEND_CHAT, groupText, memory, privateText, privateVoice, testOrgConfig, TG } from './fixtures';
import { revisionedGateway, revisionedPrivacy } from './revisioned-privacy';
import { closeFileStudios, fileStudio } from '../../studio/__tests__/file-studio';
import { callToken, handleVoiceLlm, voiceLlmKey } from '../../studio/voice-call';
import { ID, SECRET } from '../../studio/__tests__/helpers';

afterEach(async () => { vi.restoreAllMocks(); await closeFileStudios(); });

const fact = (content: string, extra: Record<string, unknown> = {}) => ({ memories: [{ content, type: 'fact', kind: 'work', confidence: 0.9, ...extra }] });
function gate<T = void>() {
  let open!: (value: T) => void;
  const opened = new Promise<T>(resolve => { open = resolve; });
  return { opened, open };
}
const usedRevisions = (x: { snapshots: { mock: { calls: unknown[] } }; revisionReads: { mock: { calls: unknown[] } } }) => {
  expect(x.snapshots.mock.calls.length).toBeGreaterThan(0);
  expect(x.revisionReads.mock.calls.length).toBeGreaterThan(0);
};

describe('history-privacy cases through revision compares', () => {
  it('keeps a full core reply with optional memory and history declined', async () => {
    const x = revisionedGateway({ memoryEnabled: false, historyEnabled: false });
    x.llm.nextExtraction = fact('SHOULD_NOT_BE_STORED');
    expect(await x.gateway.converse('aria', 'reza', 'help with the current task')).toBe('Sure.');
    expect(x.llm.extractionCalls).toBe(0);
    expect(await x.history.recent('aria', 'private-reza', 20)).toEqual([]);
    usedRevisions(x);
  });

  it('retains history across turns while the policy key is stable', async () => {
    const x = revisionedGateway({ memoryEnabled: false });
    await x.gateway.converse('aria', 'reza', 'first');
    await x.gateway.converse('aria', 'reza', 'second');
    expect(x.llm.replyRequests.at(-1)?.messages.map(m => m.content)).toEqual(['first', 'Sure.', 'second']);
    usedRevisions(x);
  });

  it('fails closed on unavailable consent while the current turn still works', async () => {
    const x = revisionedGateway();
    x.fail();
    expect(await x.gateway.converse('aria', 'reza', 'still help me')).toBe('Sure.');
    expect(x.history.chats.size).toBe(0);
    expect(x.memories.records.size).toBe(0);
    expect(x.snapshots).toHaveBeenCalled();
  });

  it('checks silent audience members and never injects their private context in groups', async () => {
    const x = revisionedGateway({ context: ['PRIVATE_CONTEXT_CANARY'] });
    await x.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello'));
    expect(x.readers).toEqual(expect.arrayContaining(['reza', 'parastoo', 'milad']));
    expect(JSON.stringify([...x.llm.replyRequests, ...x.llm.extractionRequests])).not.toContain('PRIVATE_CONTEXT_CANARY');
    usedRevisions(x);
  });

  it('keeps Personal isolated from Work and replays a changed explicit context only after it commits', async () => {
    const x = revisionedGateway();
    x.llm.nextExtraction = fact('WORK_CANARY');
    await x.gateway.converse('aria', 'reza', 'WORK_CANARY');
    x.change({ revision: '2', context: ['PERSONAL_EXPLICIT_CONTEXT'] });
    await x.gateway.converse('aria', 'reza', 'hello', { space: 'personal' });
    const request = x.llm.replyRequests.at(-1)!;
    expect(JSON.stringify(request)).not.toContain('WORK_CANARY');
    // TIREH_CACHED_PROMPT moves saved context from an unshifted message into the per-turn block.
    expect([request.messages[0].content, ...request.messages.flatMap(m => m.trailingText ?? []), request.systemTail ?? ''].join('\n')).toContain('PERSONAL_EXPLICIT_CONTEXT');
  });

  it('drops output if the server audience changes while generation is running', async () => {
    const x = revisionedGateway();
    const entered = gate(), release = gate();
    x.llm.complete = async () => { entered.open(); await release.opened; return 'STALE_REPLY_CANARY'; };
    const turn = x.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello'));
    await entered.opened; x.invalidateAudience(); release.open();
    expect(await turn).toBe('ignored');
    expect(x.bot.sent).toEqual([]);
    usedRevisions(x);
  });

  it('stops extraction and new history after withdrawal while an extractor is in flight', async () => {
    const x = revisionedGateway();
    const entered = gate(), release = gate();
    const original = x.llm.complete.bind(x.llm);
    x.llm.complete = async (request: LLMRequest) => {
      if (systemText(request.system).startsWith('You extract')) { entered.open(); await release.opened; return JSON.stringify(fact('WITHDRAWN_CANARY')); }
      return original(request);
    };
    const turn = x.gateway.converse('aria', 'reza', 'WITHDRAWN_CANARY');
    await entered.opened;
    x.change({ revision: '2', memoryEnabled: false, historyEnabled: false });
    await x.gateway.invalidateHistory('aria');
    release.open(); await turn;
    expect(x.memories.records.size).toBe(0);
    expect(x.history.chats.size).toBe(0);
    usedRevisions(x);
  });

  it('fences an extraction completing after source deletion', async () => {
    const x = revisionedGateway();
    x.llm.nextExtraction = fact('RACE_CANARY');
    await x.gateway.converse('aria', 'reza', 'RACE_CANARY');
    const [record] = await x.memories.listActive('aria');
    const entered = gate(), release = gate();
    const original = x.llm.complete.bind(x.llm);
    x.llm.complete = async (request: LLMRequest) => {
      if (systemText(request.system).startsWith('You extract')) { entered.open(); await release.opened; return JSON.stringify(fact('RACE_CANARY')); }
      return original(request);
    };
    const turn = x.gateway.converse('aria', 'reza', 'say more');
    await entered.opened;
    await x.gateway.forgetMemory('aria', record.id);
    release.open(); await turn;
    expect(await x.memories.listActive('aria')).toEqual([]);
    expect(x.history.chats.size).toBe(0);
    usedRevisions(x);
  });
});

describe('gateway privacy mutation fences through revision compares', () => {
  it.each(['private', 'group'])('suppresses a %s reply if its speaker disappears before delivery', async (kind) => {
    const x = revisionedGateway();
    const speaker = x.org.getPersonByTelegramId(TG.reza)!;
    vi.spyOn(x.org, 'getPersonByTelegramId').mockReturnValueOnce(speaker).mockReturnValue(undefined);
    const update = kind === 'group' ? groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello') : privateText(TG.reza, 'Hello');
    await expect(x.gateway.handleUpdate('aria', update)).resolves.toBe('ignored');
    expect(x.bot.sent).toEqual([]);
    expect(x.snapshots).toHaveBeenCalled();
  });

  it.each(['private', 'group'])('does not send or retain a %s answer generated before an authorized history reset', async (kind) => {
    const x = revisionedGateway();
    const atModel = gate(), generated = gate<string>();
    const original = x.llm.complete.bind(x.llm);
    x.llm.complete = async (request: LLMRequest) => {
      if (systemText(request.system).startsWith('You extract')) return original(request);
      atModel.open(); return generated.opened;
    };
    const running = x.gateway.handleUpdate('aria', kind === 'group' ? groupText(GAMEEND_CHAT, TG.reza, 'Aria, can you remind me?') : privateText(TG.reza, 'Can you remind me?'));
    await atModel.opened;
    await x.history.clearPersona('aria');
    generated.open('REVOKED_OUTPUT_CANARY');
    await running;
    expect(x.bot.sent.some(m => m.text?.includes('REVOKED_OUTPUT_CANARY'))).toBe(false);
    expect(await x.history.recent('aria', 'private-reza', 10)).toEqual([]);
    usedRevisions(x);
  });

  it.each(['private', 'group'])('does not retain %s extraction that finishes after authorized forgetting', async (kind) => {
    const x = revisionedGateway();
    const atExtractor = gate(), extracted = gate<string>();
    const original = x.llm.complete.bind(x.llm);
    x.llm.complete = async (request: LLMRequest) => {
      if (!systemText(request.system).startsWith('You extract')) return original(request);
      atExtractor.open(); return extracted.opened;
    };
    const running = x.gateway.handleUpdate('aria', kind === 'group' ? groupText(GAMEEND_CHAT, TG.reza, 'Aria, remember my appointment on Friday') : privateText(TG.reza, 'Remember my appointment on Friday'));
    await atExtractor.opened;
    await x.history.clearPersona('aria');
    extracted.open(JSON.stringify(fact('Reza has an appointment Friday', { type: 'event' })));
    await running;
    expect(await x.memories.listActive('aria')).toEqual([]);
    usedRevisions(x);
  });

  it('rejects a pending offer after its source owner revoked sharing', async () => {
    const x = revisionedGateway();
    x.llm.nextExtraction = fact('Launch is Friday', { type: 'decision', projectId: 'gameend' });
    await x.gateway.handleUpdate('aria', privateText(TG.reza, 'Launch is Friday'));
    const offer = x.bot.sent.find(m => m.text?.includes('Should I share'))!;
    const data = (offer.options as { keyboard: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).keyboard.inline_keyboard[0][0].callback_data;
    const stored = [...x.memories.records.values()][0];
    await x.memories.updateIfShareVersion(stored.id, 0, { scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'], shareVersion: 1 });
    await x.gateway.handleUpdate('aria', callback(TG.reza, data));
    expect((await x.memories.get(stored.id))?.scope).toEqual({ kind: 'private', personId: 'reza' });
    expect(x.bot.sent.at(-1)?.text).toBe('That memory has since been changed or deleted.');
    usedRevisions(x);
  });

  it('advances the turn fence only for its own correction and never widens it', async () => {
    const x = revisionedGateway();
    x.llm.nextExtraction = fact('Launch is Friday', { type: 'decision', topic: 'launch' });
    await x.gateway.handleUpdate('aria', privateText(TG.reza, 'Launch is Friday'));
    const old = [...x.memories.records.values()][0];
    await x.memories.updateIfShareVersion(old.id, 0, { scope: { kind: 'people', personIds: ['reza', 'parastoo'] }, authorizedPersonIds: ['reza', 'parastoo'], shareVersion: 1 });
    x.llm.nextExtraction = fact('Launch is Monday', { type: 'decision', topic: 'launch' });
    await x.gateway.handleUpdate('aria', privateText(TG.reza, 'Correction privately: launch is Monday'));
    const current = await x.memories.listActive('aria');
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ content: 'Launch is Monday', scope: { kind: 'private', personId: 'reza' } });
    await x.gateway.handleUpdate('aria', privateText(TG.parastoo, 'What is the launch date now?'));
    expect(JSON.stringify(x.llm.replyRequests.at(-1))).not.toMatch(/Launch is (Friday|Monday)/);
    usedRevisions(x);
  });

  it('does not send synthesized content after authorized forgetting during synthesis', async () => {
    const voice = fakeVoice('Could you remind me?');
    const atSynthesis = gate(), synthesized = gate();
    voice.synthesize.mockImplementation(async () => { atSynthesis.open(); await synthesized.opened; return { audio: new ArrayBuffer(4), mimeType: 'audio/mpeg', filename: 'voice.mp3' }; });
    const x = revisionedGateway({}, { voice });
    x.llm.nextReply = 'REVOKED_VOICE_CANARY';
    const running = x.gateway.handleUpdate('aria', privateVoice(TG.reza));
    await atSynthesis.opened;
    await x.history.clearPersona('aria');
    synthesized.open();
    await running;
    expect(x.bot.sendVoice).not.toHaveBeenCalled();
    expect(x.bot.sent.some(m => m.text?.includes('REVOKED_VOICE_CANARY'))).toBe(false);
    usedRevisions(x);
  });

  it.each(['call', 'live'] as const)('%s forget deletes source records without asking a model', async (channel) => {
    const x = revisionedGateway();
    const at = new Date('2026-10-19T10:00:00Z');
    await x.memories.add({ personaId: 'aria', content: 'FORGET_CANARY', type: 'fact', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'normal', source: { personId: 'reza', chatKind: 'private', at }, aboutPersonIds: ['reza'], confidence: 1 });
    let receipt = '';
    if (channel === 'call') receipt = await x.gateway.converse('aria', 'reza', 'Forget everything about me.');
    else for await (const chunk of x.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Forget everything about me.' }])) receipt += chunk;
    expect(receipt).toContain('I cleared');
    expect(x.llm.replyRequests).toHaveLength(0);
    expect(await x.memories.listActive('aria')).toEqual([]);
  });
});

describe('audience boundary through revision compares', () => {
  it.each(['silent guest', 'unknown person'] as const)('keeps internal canaries out of every model request for a %s on a fresh group turn', async (mode) => {
    const config = testOrgConfig();
    config.people.find(p => p.id === 'milad')!.name = 'NON_AUDIENCE_PERSON_CANARY';
    const group = config.groups[0];
    group.memberIds = ['reza', 'parastoo'];
    if (mode === 'silent guest') group.hasGuests = true; else group.memberIds.push('unresolved-person');
    const org = new OrgDirectory(config), llm = new FakeLLM(), memories = new InMemoryMemoryStore(), history = new InMemoryChatHistoryStore(), bot = fakeBot();
    const x = revisionedPrivacy({ context: ['PRIVATE_MEMBER_CONTEXT_CANARY'] });
    const gateway = new PersonaGateway({ org, llm, memories, history, offers: new InMemoryShareOfferStore(), deduper: new InMemoryUpdateDeduper(),
      voice: null, botFor: () => bot as unknown as TelegramBotClient, logger: { info() {}, warn() {}, error() {} }, runtimePrivacy: x.privacy });
    for (const record of [memory({ content: 'PRIVATE_MEMORY_CANARY', scope: { kind: 'private', personId: 'reza' } }), memory({ content: 'ORGANIZATION_MEMORY_CANARY', scope: { kind: 'org' } })]) await memories.add(record);
    await gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, hello'));
    expect(llm.replyRequests).toHaveLength(1);
    const everyField = JSON.stringify([...llm.replyRequests, ...llm.extractionRequests]);
    for (const hidden of ['NON_AUDIENCE_PERSON_CANARY', 'PRIVATE_MEMORY_CANARY', 'ORGANIZATION_MEMORY_CANARY', 'PRIVATE_MEMBER_CONTEXT_CANARY']) expect(everyField).not.toContain(hidden);
    expect(x.snapshots).toHaveBeenCalled();
  });
});

describe('live turns through revision compares', () => {
  it('streams permitted context and stops later chunks once consent changes', async () => {
    const x = revisionedGateway({ memoryEnabled: false, historyEnabled: false, context: ['PERMITTED_CONTEXT'] });
    const requests: LLMRequest[] = [];
    Object.assign(x.llm, { async *stream(request: LLMRequest) {
      requests.push(request);
      yield 'First permitted fragment';
      x.change({ revision: '2', context: [] });
      yield ' REVOKED_FRAGMENT';
    } });
    const chunks: string[] = [];
    for await (const part of x.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'help' }])) chunks.push(part);
    expect(chunks).toEqual(['First permitted fragment']);
    expect(JSON.stringify(requests)).toContain('PERMITTED_CONTEXT');
    usedRevisions(x);
  });

  it('stops a stream at once when the audience is revoked, well inside the 500 ms recheck window', async () => {
    const x = revisionedGateway({ memoryEnabled: false, historyEnabled: false });
    Object.assign(x.llm, { async *stream() { yield 'Before access removal.'; x.invalidateAudience(); yield 'AFTER_ACCESS_REMOVAL.'; } });
    const chunks: string[] = [];
    for await (const part of x.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'help' }])) chunks.push(part);
    expect(chunks).toEqual(['Before access removal.']);
  });

  it('answers a Studio voice-llm turn through the snapshot and refuses one after access is lost', async () => {
    const { h, agent } = await fileStudio();
    const snapshots = vi.spyOn(h.studio, 'loadTurnSnapshot');
    let attempt = 0;
    h.studio.deps.fastLLM = { complete: vi.fn(), stream: vi.fn(async function* () {
      if (attempt++ === 0) throw new Error('overloaded');
      yield 'Launch is '; yield 'on track.';
    }) };
    const post = (body: unknown) => handleVoiceLlm(h.studio, new Request('https://vox.example/api/studio/voice-llm/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${voiceLlmKey(SECRET)}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const call = { elevenlabs_extra_body: { call: callToken(SECRET, agent.id, ID.alice, new Date()) } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await post({ stream: true, messages: [{ role: 'user', content: 'How is the launch?' }], ...call })).status).toBe(503);
    const response = await post({ stream: true, messages: [{ role: 'user', content: 'How is the launch?' }], ...call });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('on track.');
    expect(snapshots).toHaveBeenCalled();
    await h.store.update(s => { s.agents.find(a => a.id === agent.id)!.blocked = [ID.alice]; });
    expect((await post({ stream: true, messages: [{ role: 'user', content: 'Again?' }], ...call })).status).toBe(503);
    warn.mockRestore();
  });

  it('suppresses a Studio live chunk generated after a block and closes the upstream stream', async () => {
    const { h, agent } = await fileStudio();
    const snapshots = vi.spyOn(h.studio, 'loadTurnSnapshot');
    let closed = false;
    h.studio.deps.fastLLM = { complete: vi.fn(), stream: async function* () {
      try { yield 'Already delivered.'; await h.store.update(s => { s.agents.find(a => a.id === agent.id)!.blocked = [ID.alice]; }); yield 'BLOCKED_LATE_CANARY'; }
      finally { closed = true; }
    } };
    const iterator = (await h.studio.liveTurn(agent.id, ID.alice, [{ role: 'user', content: 'Synthetic current voice turn.' }]))[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: 'Already delivered.', done: false });
    expect(await iterator.next()).toMatchObject({ done: true });
    expect(closed).toBe(true);
    expect(snapshots).toHaveBeenCalled();
  });
});

describe('adaptive integration through revision compares', () => {
  it('suppresses group output when the live roster cannot verify the authorized snapshot', async () => {
    const { h, agent } = await fileStudio();
    const snapshots = vi.spyOn(h.studio, 'loadTurnSnapshot');
    const chatId = -998;
    await h.store.update(s => s.groups.push({ chatId, title: 'Synthetic group', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [agent.id], addedAt: h.clock.now.toISOString() }));
    const { gateway } = await h.studio.gateway();
    const bot = h.bots.get([...h.bots.keys()][0])!;
    expect(await gateway.handleUpdate(agent.id, groupText(chatId, ID.alice, 'Nova, hello'))).toBe('ignored');
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect((await h.store.read()).groups[0]).toMatchObject({ hasGuests: true, audienceEpoch: 1 });
    expect(snapshots).toHaveBeenCalled();
  });
});
