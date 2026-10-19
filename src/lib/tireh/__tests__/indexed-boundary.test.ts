import {describe, expect, it, vi} from 'vitest';
import {PersonaGateway, type RuntimePrivacy} from '../gateway';
import {InMemoryUpdateDeduper} from '../memory/store';
import {makeGateway, memory} from './fixtures';
import type {LLM} from '../llm';

function fixture(privacy: RuntimePrivacy, llm?: LLM) {
  const h = makeGateway();
  const gateway = new PersonaGateway({org: h.org, llm: llm ?? h.llm, memories: h.memories, offers: h.offers, history: h.history,
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => h.bot, runtimePrivacy: privacy, now: () => new Date('2026-10-19T10:00:00Z')});
  return {...h, gateway};
}
function compact() {
  let revision = 'scope-v1';
  const authority = () => ({revision, memoryEnabled: false, historyEnabled: false});
  const read = vi.fn(async (_persona: string, _person: string, _space?: 'work' | 'personal', _chat?: unknown, query?: string) => ({...authority(), context: [`Current selected context for ${query}`]}));
  const readAuthority = vi.fn(async () => authority());
  const privacy: RuntimePrivacy = {legacyStores: 'unavailable', read, readAuthority, validateAudience: async () => true};
  return {privacy, read, readAuthority, change: () => {revision = 'scope-v2';}};
}
describe('indexed complete authority gateway boundary', () => {
  it('reads context once then only authority, and structurally unavailable legacy stores never get read', async () => {
    const c = compact(), h = fixture(c.privacy);
    await h.memories.add(memory({content: 'LEGACY_PRIVATE_CANARY', scope: {kind: 'private', personId: 'reza'}}));
    await h.history.append('aria', 'private-reza', {role: 'assistant', text: 'LEGACY_HISTORY_CANARY', at: new Date()});
    const safety = vi.spyOn(h.memories, 'safetyRevision'), active = vi.spyOn(h.memories, 'listActive'), history = vi.spyOn(h.history, 'recent');
    expect(await h.gateway.converse('aria', 'reza', 'the actual draft')).toBe('Sure.');
    expect(c.read).toHaveBeenCalledExactlyOnceWith('aria', 'reza', 'work', expect.objectContaining({kind: 'private'}), 'the actual draft');
    expect(c.readAuthority.mock.calls.length).toBeGreaterThan(2); expect(safety).not.toHaveBeenCalled(); expect(active).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
    const payload = JSON.stringify(h.llm.replyRequests); expect(payload).toContain('Current selected context for the actual draft');
    expect(payload).not.toContain('LEGACY_PRIVATE_CANARY'); expect(payload).not.toContain('LEGACY_HISTORY_CANARY');
  });
  it('retains body hashing and real legacy safetyRevision without the explicit structural contract', async () => {
    const c = compact();
    c.read.mockImplementation(async () => ({revision: 'scope-v1', memoryEnabled: false, historyEnabled: false, context: ['Stable legacy snapshot']}));
    const privacy: RuntimePrivacy = {read: c.read, readAuthority: c.readAuthority, validateAudience: c.privacy.validateAudience};
    const h = fixture(privacy);
    const safety = vi.spyOn(h.memories, 'safetyRevision');
    expect(await h.gateway.converse('aria', 'reza', 'legacy shape')).toBe('Sure.');
    expect(c.read.mock.calls.length).toBeGreaterThan(1); expect(c.readAuthority).not.toHaveBeenCalled(); expect(safety.mock.calls.length).toBeGreaterThan(1);
  });
  it('does not bypass the legacy fence when a marked adapter contradicts explicit memory/history denial', async () => {
    const c = compact(); c.privacy.read = async () => ({revision: 'scope', memoryEnabled: true, historyEnabled: false, context: ['MUST_NOT_EXPORT']});
    c.privacy.readAuthority = async () => ({revision: 'scope', memoryEnabled: true, historyEnabled: false});
    const h = fixture(c.privacy), safety = vi.spyOn(h.memories, 'safetyRevision');
    await h.gateway.converse('aria', 'reza', 'unsafe contract');
    expect(safety).toHaveBeenCalled(); expect(h.llm.replyRequests).toHaveLength(0);
  });
  it('a changed complete authority suppresses output without loading a replacement body', async () => {
    const c = compact(), h = fixture(c.privacy);
    vi.spyOn(h.llm, 'complete').mockImplementation(async () => {c.change(); return 'STALE_RESULT_CANARY';});
    const reply = await h.gateway.converse('aria', 'reza', 'draft');
    expect(reply).not.toContain('STALE_RESULT_CANARY'); expect(c.read).toHaveBeenCalledTimes(1);
  });
  it('each streamed chunk rechecks authority without another candidate/body acquisition', async () => {
    const c = compact();
    const llm: LLM = {complete: async () => 'unused', stream: async function* (request) {
      expect(await request.authorize?.()).toBe(true); yield 'first'; yield 'STALE_SECOND_CANARY';
    }};
    const h = fixture(c.privacy, llm), parts: string[] = [];
    for await (const part of h.gateway.liveTurn('aria', 'reza', [{role: 'user', content: 'current final utterance'}])) {parts.push(part); c.change();}
    expect(parts).toEqual(['first']); expect(c.read).toHaveBeenCalledTimes(1); expect(c.read.mock.calls[0][4]).toBe('current final utterance');
  });
  it('preparation selects one current body and never calls the reply model or retains history', async () => {
    const c = compact(), h = fixture(c.privacy), append = vi.spyOn(h.history, 'append');
    expect(await h.gateway.prepareContext('aria', 'reza', 'unsent draft')).toBe(true);
    expect(c.read).toHaveBeenCalledTimes(1); expect(c.read.mock.calls[0][4]).toBe('unsent draft');
    expect(h.llm.replyRequests).toHaveLength(0); expect(append).not.toHaveBeenCalled();
  });
});
