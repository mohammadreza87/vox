import { describe, expect, it, vi } from 'vitest';
import { InMemoryObservationStore, InMemoryRelationshipStore, RelationshipLoop, SafeRelationshipObserver } from '../../relationships';
import type { Assessment } from '../../relationships';
import { handleAgentUpdate } from '../updates';
import { relationshipConfig } from '../relationship-config';
import { parseRelationshipAssessment, StudioRelationshipAssessor } from '../relationship-assessor';
import { hire, ID, makeStudio, seedOrg, SECRET } from './helpers';

async function setup(mode: 'off' | 'shadow' | 'live' = 'live') {
  // Legacy relationship loop: adaptive runtimes refuse unscoped relationship state (adaptive-integration.test.ts).
  const h = makeStudio({ adaptive: false });
  const users = await seedOrg(h);
  const hired = await hire(h, users.alice);
  const store = new InMemoryRelationshipStore();
  const observations = new InMemoryObservationStore();
  const assess = vi.fn(async ({ text }: { text: string }): Promise<Assessment> => /resolved/i.test(text)
    ? { situations: [{ topic: 'boss', summary: 'Resolved by the user.', status: 'closed' }] }
    : { preferences: [{ key: 'detail', value: 'brief and gentle' }], situations: [{ topic: 'boss', summary: 'A difficult discussion with the boss.', status: 'open' }], followUp: { topic: 'boss', purpose: 'Check how things are going.', timing: { kind: 'ongoing', evidenceQuote: text }, dueAt: new Date(h.clock.now.getTime() + 86400_000).toISOString() } });
  const loop = new RelationshipLoop({ store, mode, assessor: { assess }, decisions: { choose: async () => 'send' }, observer: new SafeRelationshipObserver(observations, SECRET, () => h.clock.now), now: () => h.clock.now });
  h.studio.deps.relationships = loop;
  h.studio.deps.relationshipStore = store;
  h.studio.deps.observations = observations;
  h.studio.deps.relationshipConfig = { mode, agentIds: [hired.agent.id], personIds: [`tg-${ID.alice}`] };
  const key = { personaId: hired.agent.id, chatKey: `private-tg-${ID.alice}`, audience: { kind: 'private' as const, personId: `tg-${ID.alice}` } };
  await loop.configure(key, { timeZone: 'UTC', quietHours: { start: 22, end: 8 } });
  let sequence = 81000;
  const turn = (text: string, person = ID.alice) => handleAgentUpdate(h.studio, hired.agent.id, {
    update_id: sequence++, message: { message_id: sequence++, date: Math.floor(h.clock.now.getTime() / 1000), chat: { id: person, type: 'private' }, from: { id: person, is_bot: false, first_name: 'Synthetic' }, text },
  });
  return { h, users, hired, store, loop, key, assess, observations, turn };
}

describe('relationship vertical slice', () => {
  it('uses live privileged roles for UI, settings, gateway observations and delivery', async () => {
    const x = await setup();
    x.h.studio.deps.relationshipConfig = { mode: 'live', agentIds: ['*'], personIds: [], roles: ['owner', 'superadmin'] };
    expect((await x.h.studio.relationshipFor(x.users.superadmin, x.hired.agent.id)).available).toBe(true);
    expect((await x.h.studio.relationshipFor(x.users.admin, x.hired.agent.id)).available).toBe(false);
    const changeRole = async (role: 'member' | 'superadmin') => x.h.store.update((s) => { s.members.find((m) => m.telegramId === ID.alice)!.role = role; });
    expect((await x.h.studio.relationshipFor(x.users.alice, x.hired.agent.id)).available).toBe(false);
    await expect(x.h.studio.updateRelationship(x.users.alice, x.hired.agent.id, { action: 'configure', timeZone: 'UTC' })).rejects.toThrow('not available');
    await x.turn('My boss criticized my presentation.');
    expect(x.assess).not.toHaveBeenCalled();
    // This gateway predates promotion: its relationship gate must read current roles.
    const { gateway } = await x.h.studio.gateway();
    await changeRole('superadmin');
    expect((await x.h.studio.relationshipFor(x.users.alice, x.hired.agent.id)).available).toBe(true);
    await x.turn('My boss criticized my presentation.');
    expect(x.assess).toHaveBeenCalledOnce();
    await changeRole('member');
    x.assess.mockClear();
    for await (const chunk of gateway.liveTurn(x.hired.agent.id, `tg-${ID.alice}`, [{ role: 'user', content: 'Still thinking about it.' }])) void chunk;
    expect(x.h.chatLLM.lastPrompt).not.toContain('brief and gentle');
    expect(x.h.chatLLM.lastPrompt).not.toContain('Follow-up capability:');
    expect(x.assess).not.toHaveBeenCalled();
    x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockClear();
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
  });

  it('rechecks a role demoted during composition before Telegram transport', async () => {
    const x = await setup();
    x.h.studio.deps.relationshipConfig = { mode: 'live', agentIds: ['*'], personIds: [], roles: ['owner', 'superadmin'] };
    await x.h.store.update((s) => { s.members.find((m) => m.telegramId === ID.alice)!.role = 'superadmin'; });
    await x.turn('My boss criticized my presentation.');
    x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockClear();
    const originalComplete = x.h.chatLLM.complete.bind(x.h.chatLLM);
    vi.spyOn(x.h.chatLLM, 'complete').mockImplementation(async (input) => {
      await x.h.store.update((s) => { s.members.find((m) => m.telegramId === ID.alice)!.role = 'member'; });
      return originalComplete(input);
    });
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
  });

  it('intersects privileged roles with people and retains agent restrictions', async () => {
    const x = await setup();
    x.h.studio.deps.relationshipConfig = { mode: 'live', agentIds: ['*'], personIds: [`tg-${ID.alice}`], roles: ['owner', 'superadmin'] };
    expect((await x.h.studio.relationshipFor(x.users.superadmin, x.hired.agent.id)).available).toBe(false);
    await x.h.store.update((s) => { s.members.find((m) => m.telegramId === ID.alice)!.role = 'superadmin'; });
    expect((await x.h.studio.relationshipFor(x.users.alice, x.hired.agent.id)).available).toBe(true);
    x.h.studio.deps.relationshipConfig.agentIds = ['other-agent'];
    expect((await x.h.studio.relationshipFor(x.users.alice, x.hired.agent.id)).available).toBe(false);
    x.h.studio.deps.relationshipConfig.agentIds = ['*'];
    await x.h.store.update((s) => { s.agents.find((a) => a.id === x.hired.agent.id)!.blocked = [ID.alice]; });
    expect((await x.h.studio.relationshipFor(x.users.alice, x.hired.agent.id)).available).toBe(false);
  });

  it('preserves a queued Telegram message source date across midnight in assessment and history', async () => {
    const x = await setup();
    x.h.clock.now = new Date('2026-10-20T00:10:00Z');
    await handleAgentUpdate(x.h.studio, x.hired.agent.id, { update_id: 99001, message: { message_id: 99002, date: Date.parse('2026-10-19T23:50:00Z') / 1000, chat: { id: ID.alice, type: 'private' }, from: { id: ID.alice, is_bot: false, first_name: 'Synthetic' }, text: 'My interview is tomorrow.' } });
    expect(x.assess).toHaveBeenCalledWith(expect.objectContaining({ now: new Date('2026-10-20T00:10:00Z'), sourceAt: new Date('2026-10-19T23:50:00Z'), timeZone: 'UTC' }));
    expect((await x.loop.status(x.key)).intentions[0].sourceAt).toBe('2026-10-19T23:50:00.000Z');
    const { gateway } = await x.h.studio.gateway();
    const context = await gateway.proactiveContext(x.hired.agent.id, `tg-${ID.alice}`, 'Interview check-in');
    expect(context).toContain('"text":"My interview is tomorrow.","at":"2026-10-19T23:50:00.000Z"');
  });
  it('carries a Telegram preference into voice and sends one fresh private check-in', async () => {
    const x = await setup();
    await x.turn('My boss criticized my presentation. Keep replies brief.');
    expect(x.h.chatLLM.lastPrompt).toContain('brief and gentle');
    const { gateway } = await x.h.studio.gateway();
    const chunks = [];
    for await (const chunk of gateway.liveTurn(x.hired.agent.id, `tg-${ID.alice}`, [{ role: 'user', content: 'Still thinking about it.' }])) chunks.push(chunk);
    expect(chunks.join('')).toBe('Sure.');
    expect(x.h.chatLLM.lastPrompt).toContain('brief and gentle');
    x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockClear();
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 1 });
    expect(x.hired.bot().sendMessage).toHaveBeenCalledOnce();
    expect(x.hired.bot().sendMessage.mock.calls[0][0]).toBe(ID.alice);
    x.h.advanceDays(2);
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
    expect((await x.loop.status(x.key)).unansweredCount).toBe(1);
  });

  it('reconsiders resolution and stops without requesting follow-up permission', async () => {
    const x = await setup();
    await x.turn('My boss criticized my presentation.');
    x.h.advanceDays(0.5);
    await x.turn('We resolved it today.');
    x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockClear();
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
    await x.turn('/stop');
    expect((await x.loop.status(x.key)).disabled).toBe(true);
    expect(x.hired.bot().sendMessage.mock.calls.at(-1)?.[1]).toContain('stop initiating');
  });

  it('blocks pending delivery when access changes during composition', async () => {
    const x = await setup();
    await x.turn('A difficult conversation with my boss.');
    x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockClear();
    const original = x.h.chatLLM.complete.bind(x.h.chatLLM);
    vi.spyOn(x.h.chatLLM, 'complete').mockImplementation(async (request) => {
      if (request.system.startsWith('Write one brief natural')) await x.h.store.update((s) => { s.agents.find((a) => a.id === x.hired.agent.id)!.blocked = [ID.alice]; });
      return original(request);
    });
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
  });

  it('defers a truncated provider completion without sending any partial text', async () => {
    const x = await setup(); await x.turn('My interview is tomorrow.'); x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockClear();
    const original = x.h.chatLLM.complete.bind(x.h.chatLLM);
    vi.spyOn(x.h.chatLLM, 'complete').mockImplementation(async (request) => {
      if (request.requireComplete) throw new Error('LLM completion truncated');
      return original(request);
    });
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0, failed: 1, deferred: 1 });
    // Thinking shares the cap, so the composer runs at low effort with headroom.
    expect(vi.mocked(x.h.chatLLM.complete).mock.calls.map(([request]) => request).find((request) => request.system.startsWith('Write one brief natural')))
      .toMatchObject({ maxTokens: 2048, effort: 'low', requireComplete: true });
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
    expect((await x.loop.status(x.key)).intentions[0].status).toBe('pending');
  });

  it('never shares private personalization with another user or exports its content to admins', async () => {
    const x = await setup();
    await x.turn('PRIVATE_CANARY_X a hard day with my boss.');
    await x.turn('What do you know?', ID.bob);
    expect(x.h.chatLLM.lastPrompt).not.toContain('brief and gentle');
    expect(x.assess).toHaveBeenCalledTimes(1);
    const report = await x.h.studio.relationshipObservations(x.users.admin);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_CANARY|brief and gentle|tg-300|scopeHash/);
    expect(report.sampledEvents).toBeGreaterThan(0);
    await expect(x.h.studio.relationshipObservations(x.users.alice)).rejects.toMatchObject({ status: 403 });
  });

  it.each(['off', 'shadow'] as const)('%s cannot cause outreach or foreground personalization', async (mode) => {
    const x = await setup(mode);
    await x.turn('My boss criticized my presentation.');
    expect(x.h.chatLLM.lastPrompt).not.toContain('brief and gentle');
    expect((await x.loop.status(x.key)).intentions).toHaveLength(0);
    x.h.advanceDays(2);
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
    if (mode === 'off') expect(x.assess).not.toHaveBeenCalled();
  });

  it('treats uncertain Telegram delivery as terminal rather than retrying', async () => {
    const x = await setup();
    await x.turn('My boss criticized my presentation.');
    x.h.advanceDays(1);
    x.hired.bot().sendMessage.mockRejectedValue(new Error('synthetic timeout after transport attempt'));
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0, failed: 1 });
    expect((await x.loop.status(x.key)).intentions.some((j) => j.status === 'delivery_unknown')).toBe(true);
    x.hired.bot().sendMessage.mockClear();
    x.h.advanceDays(2);
    await x.h.studio.drainRelationships();
    expect(x.hired.bot().sendMessage).not.toHaveBeenCalled();
  });

  it('natural forget-all clears source memories, derived history and future purposes', async () => {
    const x = await setup();
    await x.turn('My boss criticized my presentation.');
    await x.h.memory.memories.add({ personaId: x.hired.agent.id, content: 'FORGET_CANARY', type: 'fact', scope: { kind: 'private', personId: `tg-${ID.alice}` }, sensitivity: 'normal', source: { personId: `tg-${ID.alice}`, chatKind: 'private', at: x.h.clock.now }, aboutPersonIds: [], confidence: 1 });
    await x.turn('Forget everything about me.');
    expect(await x.h.memory.memories.listActive(x.hired.agent.id)).toEqual([]);
    expect(await x.h.memory.history.recent(x.hired.agent.id, x.key.chatKey, 20)).toEqual([]);
    expect((await x.loop.status(x.key)).preferences).toEqual([]);
    x.h.advanceDays(1);
    expect(await x.h.studio.drainRelationships()).toMatchObject({ sent: 0 });
  });

  it('detects equal-count silent group replacement and removes departed readers', async () => {
    const x = await setup();
    await x.h.store.update((s) => { s.groups.push({ chatId: -500, title: 'Synthetic group', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [x.hired.agent.id], addedAt: x.h.clock.now.toISOString() }); });
    const bot = x.hired.bot();
    bot.getChatMemberCount.mockResolvedValue(3); // One person left and an unknown one joined.
    Object.assign(bot, { getChatMember: vi.fn(async (_chatId: number, id: number) => ({ status: id === ID.bob ? 'left' : 'member', user: { id, is_bot: id === x.hired.botId, first_name: 'Synthetic' } })) });
    await x.h.studio.verifyGroupAudience(x.hired.agent.id, -500);
    const group = (await x.h.store.read()).groups[0];
    expect(group.hasGuests).toBe(true);
    expect(group.memberIds).not.toContain(ID.bob);
    expect(await x.h.memory.history.getEpoch(x.hired.agent.id)).toBeGreaterThan(0);
  });
});

describe('relationship extraction and runtime configuration', () => {
  it('validates bounded model records and timezone instead of accepting arbitrary directives', () => {
    expect(parseRelationshipAssessment('{"preferences":[{"key":"language","value":"Persian"}]}')).toMatchObject({ preferences: [{ value: 'Persian' }] });
    expect(() => parseRelationshipAssessment('{"sendTo":123}')).toThrow();
    expect(parseRelationshipAssessment('{"control":{"action":"stop"}}')).toMatchObject({ control: { action: 'stop' } });
    expect(() => parseRelationshipAssessment('{"control":{"action":"resume"}}')).toThrow();
    expect(() => parseRelationshipAssessment('{"timeZone":"somewhere"}')).toThrow();
    expect(() => parseRelationshipAssessment('{"quietHours":{"start":25,"end":8}}')).toThrow();
  });
  it('bounds slow contextual assessments', async () => {
    const assessor = new StudioRelationshipAssessor({ complete: () => new Promise(() => undefined) }, 5);
    await expect(assessor.assess({ key: { personaId: 'a', chatKey: 'private-a', audience: { kind: 'private', personId: 'a' } }, text: 'synthetic', context: '', now: new Date() })).rejects.toThrow('timeout');
  });
  it('defaults off and rejects activation without explicit provider, pilot and scheduler configuration', () => {
    const privileged = { STUDIO_RELATIONSHIPS: 'live', OPENAI_API_KEY: 'test', STUDIO_RELATIONSHIP_AGENTS: '*', STUDIO_RELATIONSHIP_ROLES: 'owner,superadmin' };
    expect(relationshipConfig(privileged)).toMatchObject({ agentIds: ['*'], personIds: [], roles: ['owner', 'superadmin'] });
    for (const role of ['admin', 'member', 'pending', '*']) expect(() => relationshipConfig({ ...privileged, STUDIO_RELATIONSHIP_ROLES: role })).toThrow('only owner');
    expect(() => relationshipConfig({ ...privileged, STUDIO_RELATIONSHIP_ROLES: '', STUDIO_RELATIONSHIP_PEOPLE: '300' })).toThrow('Wildcard');
    expect(() => relationshipConfig({ ...privileged, STUDIO_RELATIONSHIP_AGENTS: '*,a' })).toThrow('Wildcard');
    expect(relationshipConfig({})).toMatchObject({ mode: 'off' });
    expect(() => relationshipConfig({ STUDIO_RELATIONSHIPS: 'oops' })).toThrow();
    expect(() => relationshipConfig({ STUDIO_RELATIONSHIPS: 'live', OPENAI_API_KEY: 'test' })).toThrow('allowlists');
    expect(() => relationshipConfig({ STUDIO_RELATIONSHIPS: 'live', OPENAI_API_KEY: 'test', STUDIO_RELATIONSHIP_AGENTS: 'a', STUDIO_RELATIONSHIP_PEOPLE: '300', STUDIO_PUBLIC_URL: 'https://example.test' })).toThrow('WORKER_SECRET');
  });
});
