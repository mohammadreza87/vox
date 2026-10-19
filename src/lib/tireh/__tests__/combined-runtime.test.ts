import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacyState } from '../gateway';
import type { LLMRequest } from '../llm';
import type { RelationshipLoop } from '../../relationships';
import { InMemoryUpdateDeduper, StaleMemoryWriteError } from '../memory/store';
import { GAMEEND_CHAT, TG, groupText, makeGateway, memory, privateText } from './fixtures';

function setup() {
  const ctx = makeGateway();
  let state: RuntimePrivacyState = { revision: '1', memoryEnabled: false, historyEnabled: false, context: ['PERMITTED_CONTEXT'] };
  let valid = true;
  const context = vi.fn(async () => 'RELATIONSHIP_PRIVATE_CANARY');
  const observeTurn = vi.fn();
  // Deliberately inject a live legacy loop: the gateway must independently
  // enforce the adaptive boundary even if runtime wiring is misconfigured.
  const relationships = { mode: 'live', context, observeTurn, invalidatePersona: vi.fn(async () => undefined) } as unknown as RelationshipLoop;
  const gateway = new PersonaGateway({
    ...ctx, voice: null, botFor: () => ctx.bot, deduper: new InMemoryUpdateDeduper(),
    relationships, relationshipEnabled: () => true,
    runtimePrivacy: { read: async () => state, validateAudience: async () => valid },
  });
  return { ...ctx, gateway, context, observeTurn,
    change: (next: Partial<RuntimePrivacyState>) => { state = { ...state, ...next }; },
    revokeAudience: () => { valid = false; } };
}

describe('composed live, relationship and adaptive runtime boundaries', () => {
  it.each(['denied', 'unavailable'] as const)('keeps core replies usable when asynchronous relationship authority is %s', async (authority) => {
    const ctx = makeGateway();
    const context = vi.fn(async () => 'UNAUTHORIZED_RELATIONSHIP_CONTEXT');
    const observeTurn = vi.fn();
    const relationshipEnabled = vi.fn(async () => {
      if (authority === 'unavailable') throw new Error('synthetic authority outage');
      return false;
    });
    const gateway = new PersonaGateway({
      ...ctx, voice: null, botFor: () => ctx.bot,
      relationships: { mode: 'live', context, observeTurn } as unknown as RelationshipLoop,
      relationshipEnabled,
    });
    expect(await gateway.converse('aria', 'reza', 'hello')).toBe('Sure.');
    expect(relationshipEnabled).toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    expect(observeTurn).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.llm.replyRequests)).not.toContain('UNAUTHORIZED_RELATIONSHIP_CONTEXT');
    expect(ctx.llm.lastPrompt).not.toContain('Vox supports your initiating friendly check-ins');
  });

  it('denies legacy relationship observation and context despite an injected live loop', async () => {
    const ctx = setup();
    await ctx.gateway.converse('aria', 'reza', 'hello');
    await ctx.gateway.handleUpdate('aria', privateText(TG.reza, 'hello again'));
    expect(ctx.context).not.toHaveBeenCalled();
    expect(ctx.observeTurn).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.llm.replyRequests)).not.toContain('RELATIONSHIP_PRIVATE_CANARY');
    await expect(ctx.gateway.proactiveContext('aria', 'reza', 'follow up')).rejects.toThrow('unavailable');
  });

  it('keeps passive group extraction disabled when optional memory is declined', async () => {
    const ctx = setup();
    ctx.llm.nextExtraction = { memories: [{ content: 'MUST_NOT_PERSIST', type: 'fact', kind: 'work' }] };
    await ctx.gateway.handleUpdate('aria', groupText(GAMEEND_CHAT, TG.reza, 'Aria, remember the plan'));
    expect(ctx.llm.extractionCalls).toBe(0);
    expect(await ctx.memories.listActive('aria')).toEqual([]);
    expect(ctx.history.chats.size).toBe(0);
  });

  it('streams permitted context and stops later chunks when consent changes', async () => {
    const ctx = setup();
    const requests: LLMRequest[] = [];
    Object.assign(ctx.llm, { async *stream(request: LLMRequest) {
      requests.push(request);
      yield 'First permitted fragment';
      ctx.change({ revision: '2', context: [] });
      yield 'REVOKED_FRAGMENT';
    } });
    const chunks: string[] = [];
    for await (const part of ctx.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'help' }])) chunks.push(part);
    expect(chunks).toEqual(['First permitted fragment']);
    expect(JSON.stringify(requests)).toContain('PERMITTED_CONTEXT');
    expect(ctx.history.chats.size).toBe(0);
    expect(ctx.observeTurn).not.toHaveBeenCalled();
  });

  it('refreshes Studio audience authority before every streamed chunk', async () => {
    const ctx = setup();
    Object.assign(ctx.llm, { async *stream() {
      yield 'Before access removal';
      ctx.revokeAudience();
      yield 'AFTER_ACCESS_REMOVAL';
    } });
    const chunks: string[] = [];
    for await (const part of ctx.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'help' }])) chunks.push(part);
    expect(chunks).toEqual(['Before access removal']);
  });

  it('keeps Work and raw platform history out of Personal live turns', async () => {
    const ctx = setup();
    ctx.change({ context: ['PERSONAL_ALLOWED'] });
    await ctx.memories.add(memory({ content: 'WORK_MEMORY_CANARY', scope: { kind: 'private', personId: 'reza' } }));
    await ctx.history.append('aria', 'private-reza', { role: 'user', text: 'LEGACY_HISTORY_CANARY', at: new Date() });
    const chunks: string[] = [];
    for await (const part of ctx.gateway.liveTurn('aria', 'reza', [
      { role: 'assistant', content: 'RAW_PLATFORM_HISTORY_CANARY' },
      { role: 'user', content: 'current personal request' },
    ], { space: 'personal' })) chunks.push(part);
    expect(chunks).toEqual(['Sure.']);
    const sent = JSON.stringify(ctx.llm.replyRequests);
    expect(sent).toContain('PERSONAL_ALLOWED');
    expect(sent).toContain('current personal request');
    for (const hidden of ['WORK_MEMORY_CANARY', 'LEGACY_HISTORY_CANARY', 'RAW_PLATFORM_HISTORY_CANARY', '## Organization', 'You report to']) expect(sent).not.toContain(hidden);
  });

  it('acknowledges the limited forget scope while explicit adaptive notes remain saved', async () => {
    const ctx = setup();
    ctx.change({ context: ['PRIVATE_NOTE_REMAINS'] });
    const receipt = await ctx.gateway.converse('aria', 'reza', 'forget everything');
    expect(receipt).toContain('earlier conversation history and automatically captured memories');
    expect(receipt).toContain('Saved Private and Shared notes remain saved');
    expect(receipt).toContain('Privacy and Shared Memories');
    expect(receipt).not.toContain('cleared what you told me from memory and future conversation context');
    expect(ctx.llm.replyRequests).toHaveLength(0);
    await ctx.gateway.converse('aria', 'reza', 'what is saved?');
    expect(JSON.stringify(ctx.llm.replyRequests)).toContain('PRIVATE_NOTE_REMAINS');
  });

  it('sharing CAS advances memory authority and rejects a stale guarded write', async () => {
    const ctx = setup();
    const record = await ctx.memories.add(memory({ content: 'shareable fact', scope: { kind: 'private', personId: 'reza' } }));
    const revision = await ctx.memories.safetyRevision('aria');
    expect(await ctx.memories.updateIfShareVersion(record.id, 0, { shareVersion: 1 }, { expectedRevision: revision })).toBe(true);
    expect(await ctx.memories.safetyRevision('aria')).toBe(revision + 1);
    await expect(ctx.memories.add(memory({ content: 'STALE_WRITE', scope: { kind: 'private', personId: 'reza' } }), { expectedRevision: revision })).rejects.toBeInstanceOf(StaleMemoryWriteError);
    await expect(ctx.memories.updateIfShareVersion(record.id, 1, { shareVersion: 2 }, { expectedRevision: revision })).rejects.toBeInstanceOf(StaleMemoryWriteError);
  });
});
