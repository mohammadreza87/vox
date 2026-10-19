import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { AdaptiveService } from '../persistence/service';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { DecisionService, type DecisionInput } from '../decisions';
import { prepareNotification, type NotificationIntent, type NotificationPolicySnapshot } from '../notifications';
import { projectOutcomes } from '../observation';
import { AdaptiveExperienceService } from '../runtime/service';
import { handleExperienceRequest } from '../runtime/http';
import { signInitData } from '../../studio/auth';
import { MemoryAdaptiveStorage } from '../runtime/storage';
import { SharedMemoryService } from '../shared/service';
import { SharedMemoryRepository } from '../shared/repository';
import type { AdaptiveStorage } from '../persistence/storage';
import { makeStudio, seedOrg, hire, ID, type Harness } from '../../studio/__tests__/helpers';
import { groupText } from '../../tireh/__tests__/fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const PRIVATE = 'EXPLICIT_PRIVATE_DELIVERY_CANARY';
const WORK_DIRECTORY = 'WORK_DIRECTORY_CANARY';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function adaptiveFor(h: Harness, enabled = true) {
  const directory = join(h.dir, 'adaptive-security');
  const now = h.clock.now.getTime();
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-security',
    enabledCapabilities: ['core_text', 'personalization', 'auto_memory', 'product_analytics'],
    accounts: [ID.alice, ID.bob, ID.superadmin].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization', 'auto_memory', 'product_analytics'].map((capability, index) => ({
      schemaVersion: 1, id: `synthetic-approval-${index}`, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-security',
      effectiveAt: now, reviewExpiresAt: now + 400 * 86_400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-test-only',
    })),
  });
  const factory = () => new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), {
    ...(enabled ? adaptiveOptionsFromManifest(manifest) : {}), now: () => h.clock.now.getTime(),
  });
  return { service: factory(), factory, directory };
}

async function grantPersonalization(service: AdaptiveService, space: 'work' | 'personal' = 'work', telegramId: number = ID.alice) {
  const initial = await service.read(telegramId, space);
  const p = initial.purposes.find(p => p.purpose === 'optional.personalization')!;
  const shown = await service.present(telegramId, { space, purpose: p.purpose, locale: 'en', expectedRevision: p.revision,
    eventId: `present-${space}-0001`, deliberateReopen: true });
  return service.changeConsent(telegramId, { space, purpose: p.purpose, state: 'granted',
    expectedRevision: shown.purposes.find(p => p.purpose === 'optional.personalization')!.revision,
    receipt: shown.receipt, eventId: `grant-${space}-000001` });
}

async function setup() {
  const h = makeStudio(); directories.push(h.dir);
  const org = await seedOrg(h);
  const { agent, bot, botId } = await hire(h, org.alice);
  const adaptive = adaptiveFor(h);
  h.studio.deps.adaptive = adaptive.service;
  await adaptive.service.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  return { h, org, agent, bot, botId, ...adaptive };
}

async function save(service: AdaptiveService, space: 'work' | 'personal', text: string, suffix: string) {
  const current = await service.read(ID.alice, space);
  return service.createMemory(ID.alice, { space, text, expectedRevision: current.revision, eventId: `memory-${suffix}-0001` });
}

async function permitAgent(service: AdaptiveService, agentId: string, space: 'work' | 'personal', allowed: boolean, suffix: string) {
  const current = await service.read(ID.alice, space);
  return service.setAgentAccess(ID.alice, agentId, { space, allowed, expectedRevision: current.revision, eventId: `agent-${suffix}-0001` });
}

describe('independent composed delivery security', () => {
  it('optional defaults remain off without a release manifest even after account confirmation', async () => {
    const h = makeStudio(); directories.push(h.dir);
    const { service } = adaptiveFor(h, false);
    const current = await service.confirm(ID.alice, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
    expect(current.purposes.every(p => p.state === 'not_asked' && !p.available)).toBe(true);
    expect(current.explicitMemoryAvailable).toBe(false);
    await expect(save(service, 'work', PRIVATE, 'no-policy')).rejects.toMatchObject({ code: 'capability_unavailable' });
  });

  it('neither agent ownership nor personalization permission infers an agent memory grant', async () => {
    const { service, agent } = await setup();
    await grantPersonalization(service);
    await save(service, 'work', PRIVATE, 'grant-boundary');
    expect((await service.readPrivateContext(ID.alice, 'work', agent.id)).memories).toEqual([]);
    await permitAgent(service, agent.id, 'work', true, 'allow');
    expect((await service.readPrivateContext(ID.alice, 'work', agent.id)).memories.map(m => m.text)).toEqual([PRIVATE]);
    await permitAgent(service, agent.id, 'work', false, 'remove');
    expect((await service.readPrivateContext(ID.alice, 'work', agent.id)).memories).toEqual([]);
  });

  it('private context remains isolated by account and space with independent grants', async () => {
    const { service, agent } = await setup();
    await grantPersonalization(service, 'work');
    await grantPersonalization(service, 'personal');
    await save(service, 'work', 'WORK_SAVED_CANARY', 'work');
    await save(service, 'personal', 'PERSONAL_SAVED_CANARY', 'personal');
    await permitAgent(service, agent.id, 'work', true, 'work');
    await permitAgent(service, agent.id, 'personal', true, 'personal');
    expect((await service.readPrivateContext(ID.alice, 'work', agent.id)).memories.map(m => m.text)).toEqual(['WORK_SAVED_CANARY']);
    expect((await service.readPrivateContext(ID.alice, 'personal', agent.id)).memories.map(m => m.text)).toEqual(['PERSONAL_SAVED_CANARY']);
    await service.confirm(ID.bob, { confirm: true, adultConfirmed: true });
    expect((await service.readPrivateContext(ID.bob, 'work', agent.id)).memories).toEqual([]);
  });

  it('deletion removes persisted text and old create-event replay cannot restore it', async () => {
    const { service, factory, directory } = await setup();
    const initial = await service.read(ID.alice, 'work');
    const command = { space: 'work' as const, text: PRIVATE, expectedRevision: initial.revision, eventId: 'memory-replay-0001' };
    const created = await service.createMemory(ID.alice, command);
    const memory = created.memories[0];
    await service.deleteMemory(ID.alice, memory.id, { space: 'work', expectedRevision: memory.revision, eventId: 'delete-replay-0001' });
    expect((await factory().createMemory(ID.alice, command)).memories).toEqual([]);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.json'))) {
      expect(await readFile(join(directory, file), 'utf8')).not.toContain(PRIVATE);
    }
  });

  it('a Personal call never includes the Work directory in any conversational model field', async () => {
    const { h, org, agent } = await setup();
    await h.store.update(s => { s.members.find(m => m.telegramId === ID.bob)!.name = WORK_DIRECTORY; });
    await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(4), 'audio/webm', 'personal');
    expect(h.chatLLM.replyRequests).toHaveLength(1);
    for (const request of h.chatLLM.replyRequests) expect(JSON.stringify(request)).not.toContain(WORK_DIRECTORY);
  });

  it('an unconfirmed account profile can use core current-turn text without private context', async () => {
    const h = makeStudio(); directories.push(h.dir);
    const org = await seedOrg(h);
    const { agent } = await hire(h, org.alice);
    h.studio.deps.adaptive = adaptiveFor(h).service;
    const response = await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(4), 'audio/webm', 'work');
    expect(response.reply).toBe('Sure.');
    expect(JSON.stringify(h.chatLLM.replyRequests)).not.toContain(PRIVATE);
  });

  it('group requests never invoke private note/preference loaders and pass the full audience to shared retrieval', async () => {
    const { h, service, agent, bot, botId } = await setup();
    const chatId = -888;
    const roster = [ID.alice, ID.bob, botId];
    bot().getChatMemberCount.mockResolvedValue(roster.length);
    Object.assign(bot(), { getChatMember: vi.fn(async (_chatId: number, id: number) => ({
      status: roster.includes(id) ? 'member' : 'left', user: { id, is_bot: id === botId, first_name: 'Synthetic reader' },
    })) });
    await h.store.update(s => s.groups.push({ chatId, title: 'Synthetic group', memberIds: [ID.alice, ID.bob],
      hasGuests: false, agentIds: [agent.id], addedAt: h.clock.now.toISOString() }));
    const privateRead = vi.spyOn(service, 'readPrivateContext');
    const experience = new AdaptiveExperienceService(service);
    const preferenceRead = vi.spyOn(experience, 'readPreferences');
    h.studio.deps.experience = experience;
    const readShared = vi.fn(async () => ({ revision: 'authorized-group-v1', memories: [
      { id: 'authorized-shared', text: 'SHARED_GROUP_CANARY', containerId: 'group-shared' },
    ] }));
    h.studio.deps.shared = { readContext: readShared } as unknown as SharedMemoryService;
    const { gateway } = await h.studio.gateway();
    expect(await gateway.handleUpdate(agent.id, groupText(chatId, ID.alice, 'Nova, hello'))).toBe('replied');
    expect(privateRead).not.toHaveBeenCalled();
    expect(preferenceRead).not.toHaveBeenCalled();
    expect(readShared).toHaveBeenCalled();
    for (const call of readShared.mock.calls as unknown as [number, string, string, { audienceTelegramIds: number[]; groupId: string }][]) {
      expect(call[1]).toBe('work'); expect(call[2]).toBe(agent.id);
      expect([...call[3].audienceTelegramIds].sort((a, b) => a - b)).toEqual([ID.alice, ID.bob]);
      expect(call[3].groupId).toBe('chat-888');
    }
    expect(JSON.stringify(h.chatLLM.replyRequests)).toContain('SHARED_GROUP_CANARY');
  });

  it.each(['withdrawal', 'delete', 'agent_revoke', 'member_revoke', 'profile_expiry'] as const)('suppresses Mini App text/audio when %s commits during TTS', async kind => {
    const { h, org, agent, service } = await setup();
    await grantPersonalization(service);
    const created = await save(service, 'work', PRIVATE, 'tts');
    await permitAgent(service, agent.id, 'work', true, 'tts');
    await h.store.update(s => { s.agents.find(a => a.id === agent.id)!.voice = { provider: 'elevenlabs', voiceId: 'synthetic-voice', label: 'Synthetic', source: 'library' }; });
    h.chatLLM.nextReply = PRIVATE;
    const reachedTts = deferred<void>(), finishTts = deferred<Buffer>();
    h.eleven.speak.mockImplementationOnce(async () => { reachedTts.resolve(); return finishTts.promise; });
    const pending = h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(4), 'audio/webm', 'work');
    await reachedTts.promise;
    expect(JSON.stringify(h.chatLLM.replyRequests.at(-1))).toContain(PRIVATE);
    if (kind === 'withdrawal') {
      const snapshot = await service.read(ID.alice, 'work');
      const permission = snapshot.purposes.find(p => p.purpose === 'optional.personalization')!;
      await service.changeConsent(ID.alice, { space: 'work', purpose: permission.purpose, state: 'withdrawn', expectedRevision: permission.revision, eventId: 'withdraw-tts-0001' });
    } else if (kind === 'delete') {
      await service.deleteMemory(ID.alice, created.memories[0].id, { space: 'work', expectedRevision: created.memories[0].revision, eventId: 'delete-tts-0001' });
    } else if (kind === 'agent_revoke') await permitAgent(service, agent.id, 'work', false, 'tts-revoke');
    else if (kind === 'member_revoke') await h.store.update(s => { s.members.find(m => m.telegramId === ID.alice)!.role = 'pending'; });
    else h.clock.now = new Date(h.clock.now.getTime() + 13 * 60 * 60 * 1000);
    finishTts.resolve(Buffer.from(PRIVATE));
    await expect(pending).rejects.toMatchObject({ status: 409 });
  });

  it('cannot deliver private content if access changes during awaited observation recording', async () => {
    const { h, org, agent, service } = await setup();
    await grantPersonalization(service);
    await save(service, 'work', PRIVATE, 'observation-await');
    await permitAgent(service, agent.id, 'work', true, 'observation-await');
    const experience = new AdaptiveExperienceService(service);
    h.studio.deps.experience = experience;
    h.chatLLM.nextReply = PRIVATE;
    const reached = deferred<void>(), finish = deferred<void>();
    vi.spyOn(experience, 'recordTurn').mockImplementationOnce(async () => { reached.resolve(); await finish.promise; return { recorded: false, inboxCreated: false }; });
    const pending = h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(4), 'audio/webm', 'work');
    await reached.promise;
    await permitAgent(service, agent.id, 'work', false, 'observation-revoke');
    finish.resolve();
    await expect(pending).rejects.toMatchObject({ status: 409 });
  });

  it('a permitted analytics write cannot invalidate an otherwise current private reply', async () => {
    const { h, org, agent, service } = await setup();
    await grantPersonalization(service);
    await save(service, 'work', PRIVATE, 'analytics-positive');
    await permitAgent(service, agent.id, 'work', true, 'analytics-positive');
    const current = await service.read(ID.alice, 'work');
    const permission = current.purposes.find(p => p.purpose === 'optional.product_analytics')!;
    const shown = await service.present(ID.alice, { space: 'work', purpose: permission.purpose, locale: 'en',
      expectedRevision: permission.revision, eventId: 'present-analytics-positive' });
    await service.changeConsent(ID.alice, { space: 'work', purpose: permission.purpose, state: 'granted',
      expectedRevision: shown.purposes.find(p => p.purpose === permission.purpose)!.revision,
      receipt: shown.receipt, eventId: 'grant-analytics-positive' });
    h.studio.deps.experience = new AdaptiveExperienceService(service);
    h.chatLLM.nextReply = PRIVATE;
    expect((await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(4), 'audio/webm', 'work')).reply).toBe(PRIVATE);
    const observations = await service.withAccountDocument(ID.alice, d => d.experience.observations);
    expect(observations).toHaveLength(1);
    expect(JSON.stringify(observations)).not.toContain(PRIVATE);
  });


  it('filters experience snapshots using current Studio access after awaited private projection', async () => {
    const { h, service, agent } = await setup();
    const experience = new AdaptiveExperienceService(service);
    const before = await service.read(ID.alice, 'work');
    await experience.savePreference(ID.alice, { space: 'work', agentId: agent.id, expectedRevision: before.revision,
      eventId: 'snapshot-preference', setting: { key: 'language', value: 'fa' }, action: 'set' });
    const entered = deferred<void>(), release = deferred<void>();
    const original = experience.read.bind(experience);
    let reads = 0;
    vi.spyOn(experience, 'read').mockImplementation(async (...args) => {
      const snapshot = await original(...args);
      if (++reads === 2) { entered.resolve(); await release.promise; }
      return snapshot;
    });
    const token = '12345:synthetic-independent-experience';
    const request = new Request('https://vox.test/api/studio/experience?space=work', { headers: {
      'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, token),
    } });
    const pending = handleExperienceRequest(h.studio, experience, request, [], token);
    await entered.promise;
    await h.store.update(s => { s.members.find(m => m.telegramId === ID.alice)!.role = 'pending'; });
    release.resolve();
    const response = await pending;
    const body = await response.json();
    expect(body.preferences ?? []).toEqual([]);
    expect(body.inbox ?? []).toEqual([]);
  });

  it('rechecks Studio access after the final awaited Mini App context projection', async () => {
    const { h, org, service, agent } = await setup();
    await grantPersonalization(service);
    await save(service, 'work', PRIVATE, 'final-context');
    await permitAgent(service, agent.id, 'work', true, 'final-context');
    const experience = new AdaptiveExperienceService(service);
    h.studio.deps.experience = experience;
    let afterRecord = false;
    vi.spyOn(experience, 'recordTurn').mockImplementation(async () => { afterRecord = true; return { recorded: false, inboxCreated: false }; });
    const entered = deferred<void>(), release = deferred<void>();
    const original = service.readPrivateContext.bind(service);
    vi.spyOn(service, 'readPrivateContext').mockImplementation(async (...args) => {
      const context = await original(...args);
      if (afterRecord) { entered.resolve(); await release.promise; }
      return context;
    });
    h.chatLLM.nextReply = PRIVATE;
    const pending = h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(4), 'audio/webm', 'work');
    const rejected = expect(pending).rejects.toMatchObject({ status: 409 });
    await entered.promise;
    await h.store.update(s => { s.members.find(m => m.telegramId === ID.alice)!.role = 'pending'; });
    release.resolve();
    await rejected;
  });

  it('Decisions accepts the official typed response shape and drops a late revoked result', async () => {
    const input: DecisionInput = { input: 'Synthetic request', questions: [{ name: 'route', type: 'choice', instructions: 'Choose a route',
      choices: [{ value: 'other', description: 'Other' }, { value: 'recall', description: 'Recall' }] }] };
    const answer = { model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'route', choice: 'recall', confidence: 0.93,
      probabilities: [{ value: 'other', probability: 0.05 }, { value: 'recall', probability: 0.95 }] }],
      usage: { input_tokens: 42, output_tokens: 0, total_tokens: 42 } };
    let authorization = 'current';
    const provider = { evaluate: vi.fn(async () => answer) };
    const service = new DecisionService(provider);
    const context = { enabled: true, revision: 1, currentRevision: () => 1, authorize: async () => authorization, loadInput: async () => input };
    expect(await service.evaluate(context)).toMatchObject({ status: 'answered', inputTokens: 42 });
    provider.evaluate.mockImplementationOnce(async () => { authorization = 'withdrawn'; return answer; });
    expect(await service.evaluate(context)).toMatchObject({ status: 'unknown', reason: 'stale' });
  });

  it('notification preparation rechecks source access after eligibility and never includes private details', async () => {
    const now = Date.UTC(2026, 9, 19, 12);
    const intent: NotificationIntent = { schemaVersion: 1, id: 'opaque', tenantId: 't', spaceId: 'work', containerId: 'private',
      recipientPersonId: 'alice', category: 'proactive', channel: 'telegram', sourceIds: ['private-source'], sourceRevision: 1,
      policyVersion: 'v1', createdAt: now - 100, dueAt: now - 50, expiresAt: now + 100, dedupeKey: 'once' };
    const policy: NotificationPolicySnapshot = { preferences: { personId: 'alice', revision: 1, enabled: true, proactiveEnabled: true,
      reminderEnabled: false, channel: 'telegram', timezone: 'Europe/Tallinn' }, ledger: [], consent: { purpose: true, channel: true },
      authorizationFingerprint: 'source1', revision: '1' };
    const result = await prepareNotification(intent, { now: () => now, current: async () => policy });
    expect(result).toMatchObject({ status: 'eligible', payload: { text: 'You have an update in Vox.', reference: 'opaque' } });
    expect(JSON.stringify(result)).not.toContain('private-source');
    let calls = 0;
    expect(await prepareNotification(intent, { now: () => now, current: async () => ++calls === 1 ? policy : { ...policy, authorizationFingerprint: null, revision: '2' } }))
      .toEqual({ status: 'suppressed', reason: 'stale' });
  });

  it('conflicting copies of the same analytics event revision cannot become verified task success', async () => {
    const now = 1_800_000_000_000;
    const event = { schemaVersion: 1, id: 'same-event', producer: 'studio', revision: 1,
      tenantId: 'tenant', spaceId: 'work', containerId: 'private', personId: 'alice', sessionId: 'session', turnId: 'turn',
      occurredAt: now - 100, receivedAt: now, sourceRevision: 1, policyVersion: 'v1', purpose: 'optional.product_analytics',
      origin: 'human', trust: 'server_verified', sampleRate: 1, expiresAt: now + 1000, name: 'tool.commit_verified' };
    const success = { ...event, payload: { outcome: 'success' } }, failure = { ...event, payload: { outcome: 'failure' } };
    const context = { tenantId: 'tenant', spaceId: 'work', containerId: 'private', from: now - 1000, until: now + 1, now,
      authorize: async () => true, complete: false };
    const first = await projectOutcomes([success, failure], context);
    const reversed = await projectOutcomes([failure, success], context);
    expect(first).toEqual(reversed);
    expect(first.verifiedSuccesses).toBe(0);
    expect(first.verifiedFailures).toBe(0);
  });

  it('shared text is not published when its initiating binding expires before the write authorization runs', async () => {
    const { h, service, agent } = await setup();
    const start = h.clock.now.getTime();
    h.clock.now = new Date(start + 6 * 60 * 60 * 1000);
    await service.confirm(ID.bob, { confirm: true, adultConfirmed: true });
    h.clock.now = new Date(start + 12 * 60 * 60 * 1000 - 1);
    const backing = new MemoryAdaptiveStorage();
    let arm = false, calls = 0;
    const storage: AdaptiveStorage = {
      transact: (key, mutate) => backing.transact(key, current => {
        // create performs event/preview reads first; expire Alice before its
        // third shared transaction executes the actual contribution policy.
        if (arm && ++calls === 3) h.clock.now = new Date(h.clock.now.getTime() + 2);
        return mutate(current);
      }),
    };
    const shared = new SharedMemoryService(new SharedMemoryRepository(storage), service, {
      member: async () => ({ active: true, agentIds: [agent.id] }),
      agent: async () => ({ active: true }), group: async () => null,
    }, () => h.clock.now.getTime());
    const preview = await shared.preview(ID.alice, { space: 'work', kind: 'selected', recipientTelegramIds: [ID.bob] });
    arm = true;
    await expect(shared.create(ID.alice, { space: 'work', eventId: 'expired-author-create', expectedRevision: 0,
      previewToken: preview.previewToken, agentIds: [], text: 'EXPIRED_AUTHOR_SHARE_CANARY' })).rejects.toBeDefined();
    const bob = await shared.list(ID.bob, 'work');
    expect(JSON.stringify(bob)).not.toContain('EXPIRED_AUTHOR_SHARE_CANARY');
  });

  it('an explicit selected-person share works in the recipient DM without granting a workspace owner access', async () => {
    const { h, service, org, agent } = await setup();
    for (const id of [ID.bob, ID.superadmin]) await service.confirm(id, { confirm: true, adultConfirmed: true });
    for (const id of [ID.alice, ID.bob, ID.superadmin]) await grantPersonalization(service, 'work', id);
    const shared = new SharedMemoryService(new SharedMemoryRepository(new MemoryAdaptiveStorage()), service, {
      member: async () => ({ active: true, agentIds: [agent.id] }), agent: async () => ({ active: true }), group: async () => null,
    }, () => h.clock.now.getTime());
    h.studio.deps.shared = shared;
    const preview = await shared.preview(ID.alice, { space: 'work', kind: 'selected', recipientTelegramIds: [ID.bob] });
    await shared.create(ID.alice, { space: 'work', eventId: 'selected-share-0001', expectedRevision: 0,
      previewToken: preview.previewToken, agentIds: [agent.id], text: 'APPROVED_SHARED_DM_CANARY' });
    expect(JSON.stringify(await shared.list(ID.bob, 'work'))).toContain('APPROVED_SHARED_DM_CANARY');
    await h.studio.callTurn(org.bob, agent.id, new ArrayBuffer(4), 'audio/webm', 'work');
    expect(JSON.stringify(h.chatLLM.replyRequests.at(-1))).toContain('APPROVED_SHARED_DM_CANARY');
    expect(JSON.stringify(await shared.list(ID.superadmin, 'work'))).not.toContain('APPROVED_SHARED_DM_CANARY');
    await h.studio.callTurn(org.superadmin, agent.id, new ArrayBuffer(4), 'audio/webm', 'work');
    expect(JSON.stringify(h.chatLLM.replyRequests.at(-1))).not.toContain('APPROVED_SHARED_DM_CANARY');
  });
});
