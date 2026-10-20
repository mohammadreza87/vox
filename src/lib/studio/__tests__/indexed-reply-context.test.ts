import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hire, ID, makeStudio, seedOrg, T0} from './helpers';
import {AdaptiveRepository, accountIdFor} from '../../adaptive/persistence/repository';
import {AdaptiveService} from '../../adaptive/persistence/service';
import {SqliteAdaptiveStorage} from '../../adaptive/persistence/indexed/sqlite-storage';
import {adaptiveOptionsFromManifest} from '../../adaptive/persistence/config';
import {AdaptiveExperienceService} from '../../adaptive/runtime/service';
import {DecisionService} from '../../adaptive/decisions';
import {handleConversationRequest} from '../conversation';
import {signInitData} from '../auth';
import {personId, groupId, studioToOrg} from '../org-bridge';
import {AnthropicLLM} from '../../tireh/llm';
import {FileAdaptiveStorage} from '../../adaptive/persistence/storage';
import {SharedMemoryRepository} from '../../adaptive/shared/repository';
import {SharedMemoryService} from '../../adaptive/shared/service';
import {sharedAuthorityFromStudioStore} from '../shared-authority';
import {ElevenLabsStudio} from '../media';
import {TelegramBotClient} from '../../tireh/telegram/client';
import {privateText} from '../../tireh/__tests__/fixtures';
import {AdaptiveRelationshipService} from '../../adaptive/relationships/service';
import {InMemoryRelationshipStore, RelationshipLoop} from '../../relationships';

const NOW = T0.getTime(), TOKEN = '123:synthetic-manager';
const paths: string[] = [], stores: SqliteAdaptiveStorage[] = [];
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const store of stores.splice(0)) store.close(); for (const path of paths.splice(0)) rmSync(path, {recursive: true, force: true});});
async function fixture(personalization = true, consent = true, relationships = false) {
  const h = makeStudio(), users = await seedOrg(h), {agent} = await hire(h, users.alice);
  let now = NOW;
  const directory = mkdtempSync(join(tmpdir(), 'vox-indexed-reply-')); paths.push(directory);
  const capabilities = personalization ? ['core_text', 'personalization'] : ['core_text'];
  if (relationships) capabilities.push('auto_memory', 'proactive_suggestions');
  const options = adaptiveOptionsFromManifest(JSON.stringify({schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [ID.alice, ID.bob].map(id => ({accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true})),
    approvals: capabilities.map((capability, i) => ({schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: NOW, reviewExpiresAt: NOW + 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only'}))}));
  const storage = new SqliteAdaptiveStorage(join(directory, 'synthetic.sqlite'), {now: () => now}); stores.push(storage);
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), {...options, scopedRelationshipsEnabled: relationships, now: () => now});
  Object.defineProperty(h.chatLLM, 'committedExportFence', {value: true});
  h.studio.deps.adaptive = adaptive; h.studio.deps.experience = new AdaptiveExperienceService(adaptive);
  await adaptive.confirm(ID.alice, {confirm: true, adultConfirmed: true});
  const before = await adaptive.read(ID.alice, 'work'), purpose = 'optional.personalization';
  if (personalization && consent) {
  const shown = await adaptive.present(ID.alice, {space: 'work', purpose, locale: 'en', expectedRevision: before.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID()});
  await adaptive.changeConsent(ID.alice, {space: 'work', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt});
  }
  const consented = await adaptive.read(ID.alice, 'work');
  await adaptive.setAgentAccess(ID.alice, agent.id, {space: 'work', allowed: true, expectedRevision: consented.revision, eventId: randomUUID()});
  now = NOW + 300; h.clock.now = new Date(now);
  await adaptive.withAccountDocument(ID.alice, d => {
    d.memories = Array.from({length: 300}, (_, i) => ({id: `memory-${i}`, revision: 1, space: 'work',
      text: i === 0 ? 'Launchcodename is Sapphire.' : i === 1 ? 'کد پرتاب یاقوت است.' : `Unrelated calendar distractor ${i}.`,
      status: 'active', createdAt: NOW + i, updatedAt: NOW + i, expiresAt: NOW + 80_000, revocationEpoch: 0}));
    d.revision++;
  });
  const reset = () => {for (const key of Object.keys(storage.io) as (keyof typeof storage.io)[]) storage.io[key] = 0;};
  const unavailableLegacy = () => {
    for (const [object, method] of [[h.memory.memories, 'safetyRevision'], [h.memory.memories, 'listActive'], [h.memory.history, 'getEpoch'], [h.memory.history, 'recent']] as const)
      vi.spyOn(object, method as never).mockImplementation((() => {throw Error(`forbidden legacy ${method}`);}) as never);
  };
  reset();
  const request = (text: string) => new Request('https://vox.example/api/studio/conversation', {method: 'POST', headers: {origin: 'https://vox.example', 'content-type': 'application/json', 'x-telegram-init-data': signInitData({id: ID.alice, first_name: 'Alice'}, TOKEN)}, body: JSON.stringify({agentId: agent.id, space: 'work', text})});
  return {h, agent, users, adaptive, storage, reset, request, unavailableLegacy, setNow: (value: number) => {now = value; h.clock.now = new Date(value);}};
}

function attachShared(f: Awaited<ReturnType<typeof fixture>>) {
  const directory = mkdtempSync(join(tmpdir(), 'vox-indexed-shared-reply-')); paths.push(directory);
  const shared = new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(directory)), f.adaptive,
    sharedAuthorityFromStudioStore(f.h.store), () => f.h.clock.now.getTime());
  f.h.studio.deps.shared = shared;
  return shared;
}

async function attachRelationship(f: Awaited<ReturnType<typeof fixture>>) {
  await f.adaptive.withAccountDocument(ID.alice, (d, now) => {
    for (const permission of d.permissions) if (permission.id.startsWith('permission:work:')) {permission.state = 'granted'; permission.expiresAt = NOW + 80_000;}
    d.relationships.bindings = [{id: 'synthetic-durable', revision: 1, accountId: d.accountId, personId: d.personId, space: 'work', status: 'active', confirmedAt: now, expiresAt: NOW + 80_000, originBindingId: d.binding!.id}]; d.revision++;
  });
  const authority = new AdaptiveRelationshipService(f.adaptive), store = new InMemoryRelationshipStore();
  const loop = new RelationshipLoop({store, mode: 'live', now: () => f.h.clock.now, assessor: {assess: async () => ({})},
    authorize: input => authority.authorize(input.key, input.sourceIds, input.phase, input.expectedFingerprint)});
  Object.assign(f.h.studio.deps, {relationshipAuthority: authority, relationships: loop, relationshipStore: store,
    relationshipConfig: {mode: 'live', agentIds: [f.agent.id], personIds: [personId(ID.alice)]}});
  const permit = (await authority.resolve(ID.alice, f.agent.id, 'work'))!; expect(permit).not.toBeNull();
  await authority.acceptSource(permit, {id: 'synthetic-style-source', at: f.h.clock.now.getTime(), channel: 'telegram'});
  await store.update(permit.key, state => {state.preferences.push({key: 'style', value: 'SYNTHETIC_LIVE_RELATIONSHIP_STYLE', sourceId: 'synthetic-style-source', updatedAt: f.h.clock.now.toISOString()}); state.revision++;});
  return {authority, store, permit};
}

describe('real indexed Studio reply acquisition and compact rechecks', () => {
  it.each([['What is launchcodename?', 'Launchcodename is Sapphire.'], ['كد پرتاب چيست؟', 'کد پرتاب یاقوت است.']])('selects the actual EN/FA query %s among 300 notes with one private acquisition', async (query, expected) => {
    const f = await fixture(); f.unavailableLegacy(); const acquire = vi.spyOn(f.adaptive, 'readPrivateContext');
    const response = await handleConversationRequest(f.h.studio, f.request(query), TOKEN);
    expect(response.status).toBe(200); expect(acquire).toHaveBeenCalledExactlyOnceWith(ID.alice, 'work', f.agent.id, query);
    expect(f.h.chatLLM.replyRequests).toHaveLength(1);
    const payload = JSON.stringify(f.h.chatLLM.replyRequests[0].messages);
    expect(payload).toContain(expected); expect(payload).not.toContain('Unrelated calendar distractor 299');
    expect(f.storage.io.canonicalImageReads).toBe(0); expect(f.storage.io.bodyRowsRead).toBeGreaterThan(0); expect(f.storage.io.bodyRowsRead).toBeLessThanOrEqual(64);
  });
  it('keeps a core-only reply usable when configured shared context is denied by capability', async () => {
    const f = await fixture(false); const shared = attachShared(f), read = vi.spyOn(shared, 'readContextAuthorityNow');
    const response = await handleConversationRequest(f.h.studio, f.request('Synthetic core question'), TOKEN);
    expect(response.status).toBe(200); expect(read).toHaveBeenCalled();
    expect(JSON.stringify(f.h.chatLLM.replyRequests)).not.toContain('Launchcodename is Sapphire.');
    expect(f.storage.io.bodyRowsRead).toBe(0);
  });
  it('changes the paired revision when formerly empty shared/personalization permission is granted', async () => {
    const f = await fixture(true, false); attachShared(f);
    const before = await f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work');
    const state = await f.adaptive.readAuthority(ID.alice, 'work');
    const shown = await f.adaptive.present(ID.alice, {space: 'work', purpose: 'optional.personalization', locale: 'en', expectedRevision: state.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID()});
    await f.adaptive.changeConsent(ID.alice, {space: 'work', purpose: 'optional.personalization', state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID(), receipt: shown.receipt});
    const after = f.h.studio.adaptiveContextAuthorityNow(f.agent.id, personId(ID.alice), 'work');
    expect(after.revision).not.toBe(before.revision);
    expect(after.revision).toBe((await f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work')).revision);
  });
  it('pairs body acquisition and query-independent authority revisions without reloading bodies', async () => {
    const f = await fixture(), context = await f.h.studio.adaptiveContext(f.agent.id, personId(ID.alice), 'work', 'launchcodename');
    const bodies = f.storage.io.bodyRowsRead; expect(bodies).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      const current = await f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work');
      expect(current.revision).toBe(context.revision); expect(current).not.toHaveProperty('context');
    }
    expect(f.storage.io.bodyRowsRead).toBe(bodies); expect(f.storage.io.canonicalImageReads).toBe(0);
  });
  it('invalidates a paired context after actual Studio block/restore without loading bodies', async () => {
    const f = await fixture();
    const before = await f.h.studio.adaptiveContext(f.agent.id, personId(ID.alice), 'work', 'launchcodename');
    await f.h.studio.blockByAgent(f.agent.id, ID.alice);
    await expect(f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work')).rejects.toMatchObject({status: 403});
    await f.h.studio.unblock(f.users.alice, f.agent.id, ID.alice);
    f.reset();
    const restored = await f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work');
    expect(restored.revision).not.toBe(before.revision);
    expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  });
  it('ignores display chatter but denies malformed Studio authority generations', async () => {
    const f = await fixture(), before = await f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work');
    await f.h.studio.deps.store.update(s => {const m = s.members.find(m => m.telegramId === ID.alice)!; m.name = 'Changed display name';});
    expect((await f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work')).revision).toBe(before.revision);
    await f.h.studio.deps.store.update(s => {s.agents.find(a => a.id === f.agent.id)!.learningAuthorityRevision = null as unknown as number;});
    await expect(f.h.studio.adaptiveContextAuthority(f.agent.id, personId(ID.alice), 'work')).rejects.toMatchObject({status: 503});
  });
  it('suppresses output after an actual Studio block/restore during inference', async () => {
    const f = await fixture();
    vi.spyOn(f.h.chatLLM, 'complete').mockImplementationOnce(async () => {
      await f.h.studio.blockByAgent(f.agent.id, ID.alice);
      await f.h.studio.unblock(f.users.alice, f.agent.id, ID.alice);
      f.reset(); return 'RESTORED_AUTHORITY_STALE_OUTPUT';
    });
    const response = await handleConversationRequest(f.h.studio, f.request('launchcodename'), TOKEN);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('RESTORED_AUTHORITY_STALE_OUTPUT');
    expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  });
  it('prepares after a genuine prediction reservation using only one acquisition and compact validation', async () => {
    const f = await fixture(); f.unavailableLegacy();
    const experience = new AdaptiveExperienceService(f.adaptive, {decisionsEnabled: true, decisions: new DecisionService({evaluate: async () => ({model: 'gpt-6-luna', answers: [{type: 'predicate', name: 'explicit_correction', probability: 0.8}]})})});
    const input = {space: 'work' as const, agentId: f.agent.id, sessionId: 'session', turnId: 'turn', revision: 1, text: 'launchcodename', question: 'explicit_correction' as const};
    const prediction = await experience.predict(ID.alice, input); expect(prediction.status).toBe('answered'); f.reset();
    const {gateway} = await f.h.studio.gateway(), acquire = vi.spyOn(f.adaptive, 'readPrivateContext');
    expect(await gateway.prepareContext(f.agent.id, personId(ID.alice), input.text, {space: 'work', authorize: async () => (await experience.validatePrediction(ID.alice, {space: input.space, agentId: input.agentId, sessionId: input.sessionId, turnId: input.turnId, revision: input.revision, policyReceipt: prediction.policyReceipt!})).valid})).toBe(true);
    expect(acquire).toHaveBeenCalledTimes(1); expect(f.storage.io.canonicalImageReads).toBe(0); expect(f.storage.io.bodyRowsRead).toBeGreaterThan(0);
    expect(f.h.chatLLM.replyRequests).toHaveLength(0);
  });
  it('suppresses output after an actual unselected-source correction without loading context again', async () => {
    const f = await fixture(), acquire = vi.spyOn(f.adaptive, 'readPrivateContext');
    vi.spyOn(f.h.chatLLM, 'complete').mockImplementationOnce(async request => {
      expect(JSON.stringify(request.messages)).not.toContain('Unrelated calendar distractor 299');
      expect(f.storage.io.canonicalImageReads).toBe(0);
      await f.adaptive.correctMemory(ID.alice, 'memory-299', {space: 'work', text: 'Corrected unrelated source.', expectedRevision: 1, eventId: randomUUID()}, {authorizeNow: () => true});
      f.reset(); return 'STALE_OUTPUT_CANARY';
    });
    const response = await handleConversationRequest(f.h.studio, f.request('launchcodename'), TOKEN);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('STALE_OUTPUT_CANARY');
    expect(acquire).toHaveBeenCalledTimes(1); expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  });
  it('suppresses output on expiry while all final rechecks remain body-free', async () => {
    const f = await fixture();
    vi.spyOn(f.h.chatLLM, 'complete').mockImplementationOnce(async () => {f.setNow(NOW + 80_001); f.reset(); return 'EXPIRED_OUTPUT_CANARY';});
    const response = await handleConversationRequest(f.h.studio, f.request('launchcodename'), TOKEN);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('EXPIRED_OUTPUT_CANARY');
    expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  });
  it('live preparation availability uses compact controls rather than detailed experience or account reads', async () => {
    const f = await fixture(); f.h.studio.deps.webhookBase = 'https://vox.example';
    f.h.studio.deps.experience = new AdaptiveExperienceService(f.adaptive, {decisionsEnabled: true, decisions: new DecisionService({evaluate: async () => ({})})});
    Object.assign(f.h.eleven, {partialTranscriptVersion: vi.fn(async () => 'verified-synthetic-version')});
    const detail = vi.spyOn(f.h.studio.deps.experience, 'read'), account = vi.spyOn(f.adaptive, 'withAccountDocument');
    const result = await f.h.studio.startLiveCall(f.users.alice, f.agent.id);
    expect(result).toMatchObject({live: true, partialPrediction: {available: true, configurationVersion: 'verified-synthetic-version'}});
    expect(detail).not.toHaveBeenCalled(); expect(account).not.toHaveBeenCalled();
    expect(f.storage.io.canonicalImageReads).toBe(0); expect(f.storage.io.bodyRowsRead).toBe(0);
  });
  it('tap-to-talk revision/output checks use authority-only reads while retrieval receives the actual transcript', async () => {
    const f = await fixture(); f.unavailableLegacy(); f.h.openai.transcribe.mockResolvedValue('launchcodename');
    const acquire = vi.spyOn(f.adaptive, 'readPrivateContext');
    let optionalRecordingReads = 0;
    const record = f.h.studio.deps.experience!.recordTurn.bind(f.h.studio.deps.experience!);
    vi.spyOn(f.h.studio.deps.experience!, 'recordTurn').mockImplementation(async (...args) => {
      const before = f.storage.io.canonicalImageReads, result = await record(...args);
      optionalRecordingReads += f.storage.io.canonicalImageReads - before; return result;
    });
    const result = await f.h.studio.callTurn(f.users.alice, f.agent.id, new ArrayBuffer(3), 'audio/webm');
    expect(result.transcript).toBe('launchcodename'); expect(result.audio).toBeUndefined(); expect(f.h.eleven.speak).not.toHaveBeenCalled(); expect(acquire).toHaveBeenCalledExactlyOnceWith(ID.alice, 'work', f.agent.id, 'launchcodename');
    expect(optionalRecordingReads).toBe(1); expect(f.storage.io.canonicalImageReads).toBe(optionalRecordingReads); expect(f.storage.io.bodyRowsRead).toBeLessThanOrEqual(64);
  });
  it.each(['positive', 'grant-revoke', 'correction', 'block-restore', 'expiry', 'clock-during-snapshot', 'shared-permission-revoke'] as const)('actual SDK final configured fetch fences %s during preparation', async mode => {
    const f = await fixture();
    if (mode === 'shared-permission-revoke') attachShared(f);
    const transports: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      transports.push(String(init?.body));
      return new Response(JSON.stringify({id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{type: 'text', text: 'SDK_POSITIVE_REPLY'}], stop_reason: 'end_turn', stop_sequence: null, usage: {input_tokens: 1, output_tokens: 1}}), {headers: {'content-type': 'application/json'}});
    };
    vi.stubGlobal('window', undefined);
    const llm = new AnthropicLLM('synthetic-not-real-key', 'synthetic-model', fetcher);
    f.h.studio.deps.chatLLM = llm;
    const client = (llm as unknown as {getClient(): {prepareOptions(options: unknown): Promise<void>}}).getClient();
    const prepare = client.prepareOptions.bind(client);
    let prepared = false, clockArmed = false;
    const readStudio = f.h.store.readCommittedForEffect.bind(f.h.store);
    vi.spyOn(f.h.store, 'readCommittedForEffect').mockImplementation(() => {
      const result = readStudio();
      if (clockArmed) {clockArmed = false; f.setNow(NOW + 80_001);}
      return result;
    });
    client.prepareOptions = async options => {
      prepared = true;
      if (mode === 'shared-permission-revoke') {
        const state = await f.adaptive.readAuthority(ID.alice, 'work');
        await f.adaptive.changeConsent(ID.alice, {space: 'work', purpose: 'optional.personalization', state: 'withdrawn', expectedRevision: state.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID()});
      } else if (mode === 'grant-revoke') {
        const snapshot = await f.adaptive.readAuthority(ID.alice, 'work');
        await f.adaptive.setAgentAccess(ID.alice, f.agent.id, {space: 'work', allowed: false, expectedRevision: snapshot.revision, eventId: randomUUID()});
      } else if (mode === 'correction') {
        await f.adaptive.correctMemory(ID.alice, 'memory-0', {space: 'work', text: 'Corrected SDK fact.', expectedRevision: 1, eventId: randomUUID()}, {authorizeNow: () => true});
      } else if (mode === 'block-restore') {
        await f.h.studio.blockByAgent(f.agent.id, ID.alice);
        await f.h.studio.unblock(f.users.alice, f.agent.id, ID.alice);
      } else if (mode === 'expiry') f.setNow(NOW + 80_001);
      if (mode === 'clock-during-snapshot') clockArmed = true;
      f.reset(); await prepare(options);
    };
    const response = await handleConversationRequest(f.h.studio, f.request('launchcodename'), TOKEN);
    expect(prepared).toBe(true);
    if (mode === 'positive') {
      expect(response.status).toBe(200); expect(transports).toHaveLength(1);
      expect(transports[0]).toContain('Launchcodename is Sapphire.');
      expect(await response.text()).toContain('SDK_POSITIVE_REPLY');
    } else {
      expect(response.status).not.toBe(200); expect(transports).toHaveLength(0);
      expect(await response.text()).not.toContain('SDK_POSITIVE_REPLY');
    }
    expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  });

  it.each(['positive', 'audience', 'block-restore', 'role-restore', 'group-policy'] as const)('actual SDK group fence sees committed authority changes: %s', async change => {
    const f = await fixture();
    const chatId = -100800;
    await f.h.store.update(s => {s.groups.push({chatId, title: 'Synthetic group', memberIds: [ID.alice], hasGuests: false, agentIds: [f.agent.id], addedAt: T0.toISOString()}); s.agents.find(a => a.id === f.agent.id)!.groupBehavior = {participation: 'balanced', remember: true};});
    vi.stubGlobal('window', undefined);
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{type: 'text', text: 'GROUP_REPLY'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}), {headers: {'content-type': 'application/json'}}));
    const llm = new AnthropicLLM('synthetic-key', 'synthetic-model', transport); f.h.studio.deps.chatLLM = llm;
    const client = (llm as unknown as {getClient(): {prepareOptions(options: unknown): Promise<void>}}).getClient();
    const prepare = client.prepareOptions.bind(client);
    let prepared = false;
    client.prepareOptions = async options => {
      prepared = true;
      if (change === 'audience') await f.h.store.update(s => {const g = s.groups.find(g => g.chatId === chatId)!; g.hasGuests = true; g.audienceEpoch = (g.audienceEpoch ?? 0) + 1;});
      if (change === 'block-restore') {await f.h.studio.blockByAgent(f.agent.id, ID.alice); await f.h.studio.unblock(f.users.alice, f.agent.id, ID.alice);}
      if (change === 'role-restore') {await f.h.studio.setRole(f.users.superadmin, ID.alice, 'admin'); await f.h.studio.setRole(f.users.superadmin, ID.alice, 'member');}
      if (change === 'group-policy') {
        await f.h.studio.setGroupBehavior(f.users.alice, f.agent.id, {participation: 'mentions', remember: false});
        await f.h.studio.setGroupBehavior(f.users.alice, f.agent.id, {participation: 'balanced', remember: true});
      }
      await prepare(options);
    };
    const {gateway, state} = await f.h.studio.gateway(), org = studioToOrg(state, 'HOOR');
    const chat = {kind: 'group' as const, chatKey: `group-${groupId(chatId)}`, group: org.getGroup(groupId(chatId))!};
    const result = gateway.generateReply(org.getPersona(f.agent.id)!, chat, personId(ID.alice), 'Synthetic group question');
    if (change !== 'positive') {await expect(result).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();}
    else {expect(await result).toBe('GROUP_REPLY'); expect(transport).toHaveBeenCalledTimes(1);}
    expect(prepared).toBe(true);
  });

  it.each([false, true])('actual SDK streaming fence blocks revoked context before any configured fetch: %s', async revoke => {
    const f = await fixture(); vi.stubGlobal('window', undefined);
    const events = [
      {type: 'message_start', message: {id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [], usage: {input_tokens: 1, output_tokens: 0}}},
      {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
      {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'STREAM_POSITIVE'}},
      {type: 'content_block_stop', index: 0},
      {type: 'message_delta', delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 1}},
      {type: 'message_stop'},
    ];
    const transport = vi.fn<typeof fetch>(async () => new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}}));
    const llm = new AnthropicLLM('synthetic-key', 'synthetic-model', transport); f.h.studio.deps.chatLLM = llm;
    const client = (llm as unknown as {getClient(): {prepareOptions(options: unknown): Promise<void>}}).getClient();
    const prepare = client.prepareOptions.bind(client); let prepared = false;
    client.prepareOptions = async options => {
      prepared = true;
      if (revoke) await f.adaptive.correctMemory(ID.alice, 'memory-0', {space: 'work', text: 'Corrected streaming source.', expectedRevision: 1, eventId: randomUUID()}, {authorizeNow: () => true});
      await prepare(options);
    };
    const {gateway} = await f.h.studio.gateway(), chunks: string[] = [];
    const run = async () => {for await (const part of gateway.liveTurn(f.agent.id, personId(ID.alice), [{role: 'user', content: 'launchcodename'}])) chunks.push(part);};
    if (revoke) {await expect(run()).rejects.toThrow(); expect(transport).not.toHaveBeenCalled(); expect(chunks).toEqual([]);}
    else {await run(); expect(chunks).toEqual(['STREAM_POSITIVE']); expect(transport).toHaveBeenCalledTimes(1);}
    expect(prepared).toBe(true);
  });

  it('actual SDK core-only reply needs Studio/core authority but no optional-memory grant', async () => {
    const f = await fixture(false); attachShared(f);
    await f.adaptive.withAccountDocument(ID.alice, d => {d.agentGrants = []; d.revision++;});
    vi.stubGlobal('window', undefined);
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{type: 'text', text: 'CORE_NO_OPTIONAL_REPLY'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}), {headers: {'content-type': 'application/json'}}));
    f.h.studio.deps.chatLLM = new AnthropicLLM('synthetic-key', 'synthetic-model', transport);
    f.reset(); const {gateway} = await f.h.studio.gateway();
    expect(await gateway.converse(f.agent.id, personId(ID.alice), 'Synthetic core only question')).toBe('CORE_NO_OPTIONAL_REPLY');
    expect(transport).toHaveBeenCalledTimes(1); expect(String(transport.mock.calls[0][1]?.body)).not.toContain('Launchcodename is Sapphire.');
    expect(f.storage.io.bodyRowsRead).toBe(0); expect(f.storage.io.canonicalImageReads).toBe(0);
  });

  it.each([false, true])('qualified tap-to-talk speech rechecks after adapter preparation: revoked=%s', async revoke => {
    const f = await fixture(); f.h.openai.transcribe.mockResolvedValue('launchcodename');
    vi.spyOn(f.h.chatLLM, 'complete').mockResolvedValue('SYNTHETIC_SAVED_FACT_VOICE_REPLY');
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'audio/mpeg'}}));
    const eleven = new ElevenLabsStudio('synthetic-key', fetcher); f.h.studio.deps.eleven = eleven;
    const adapter = eleven as unknown as {request(url: string, init: RequestInit, authority?: {authorizeNow?: () => boolean; signal?: AbortSignal}): Promise<Response>};
    const request = adapter.request.bind(adapter); let prepared = false;
    adapter.request = async (...args) => {
      prepared = true;
      if (revoke) await f.adaptive.correctMemory(ID.alice, 'memory-0', {space: 'work', text: 'Corrected before TTS export.', expectedRevision: 1, eventId: randomUUID()}, {authorizeNow: () => true});
      return request(...args);
    };
    const result = f.h.studio.callTurn(f.users.alice, f.agent.id, new ArrayBuffer(3), 'audio/webm');
    if (revoke) {await expect(result).rejects.toMatchObject({status: 409}); expect(fetcher).not.toHaveBeenCalled();}
    else {expect((await result).audio).toBe('AQID'); expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text).toBe('SYNTHETIC_SAVED_FACT_VOICE_REPLY');}
    expect(prepared).toBe(true);
  });
  it('actual indexed Telegram voice uses qualified synthesis and send guards end to end', async () => {
    const f = await fixture(); vi.spyOn(f.h.chatLLM, 'complete').mockResolvedValue('SYNTHETIC_TELEGRAM_SAVED_REPLY');
    const speech = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'audio/mpeg'}}));
    f.h.studio.deps.eleven = new ElevenLabsStudio('synthetic-key', speech);
    const methods: string[] = [];
    const telegram = vi.fn<typeof fetch>(async (url, init) => {
      const method = String(url).split('/').at(-1)!; methods.push(method);
      if (typeof init?.body === 'string') expect(init.body).not.toMatch(/authorizeNow|signal/);
      return new Response(JSON.stringify({ok: true, result: method === 'sendChatAction' ? true : {message_id: 900, chat: {id: ID.alice, type: 'private'}}}), {headers: {'content-type': 'application/json'}});
    });
    const bot = new TelegramBotClient('synthetic-bot-token', telegram); f.h.studio.deps.botFor = () => bot;
    const {gateway} = await f.h.studio.gateway();
    expect(await gateway.handleUpdate(f.agent.id, privateText(ID.alice, 'Please reply as a voice message: launchcodename'))).toBe('replied');
    expect(speech).toHaveBeenCalledTimes(1); expect(JSON.parse(String(speech.mock.calls[0][1]?.body)).text).toBe('SYNTHETIC_TELEGRAM_SAVED_REPLY');
    expect(methods.filter(m => m === 'sendVoice')).toHaveLength(1); expect(methods.filter(m => m === 'sendMessage')).toHaveLength(1);
  });

  it.each(['positive', 'epoch', 'correction'] as const)('real relationship reservation is compatible with the complete SDK fence: %s', async mode => {
    const f = await fixture(true, true, true), relation = await attachRelationship(f), shared = attachShared(f);
    await f.adaptive.confirm(ID.bob, {confirm: true, adultConfirmed: true});
    await f.adaptive.withAccountDocument(ID.bob, d => {const permission = d.permissions.find(p => p.id === 'permission:work:optional.personalization')!; permission.state = 'granted'; permission.expiresAt = NOW + 80_000; d.revision++;});
    const preview = await shared.preview(ID.alice, {space: 'work', kind: 'selected', recipientTelegramIds: [ID.bob]});
    await shared.create(ID.alice, {space: 'work', expectedRevision: 0, eventId: randomUUID(), previewToken: preview.previewToken, agentIds: [f.agent.id], text: 'SYNTHETIC_SELECTED_SHARED_FACT'});
    const prefs = await f.h.studio.deps.experience!.readPreferenceState(ID.alice, 'work', f.agent.id);
    await f.h.studio.deps.experience!.savePreference(ID.alice, {space: 'work', agentId: f.agent.id, expectedRevision: prefs.revision, eventId: randomUUID(), action: 'set', setting: {key: 'response_length', value: 'brief'}});
    vi.stubGlobal('window', undefined);
    const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{type: 'text', text: 'LIVE_RELATIONSHIP_REPLY'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}), {headers: {'content-type': 'application/json'}}));
    const llm = new AnthropicLLM('synthetic-key', 'synthetic-model', transport); f.h.studio.deps.chatLLM = llm;
    const client = (llm as unknown as {getClient(): {prepareOptions(options: unknown): Promise<void>}}).getClient(), prepare = client.prepareOptions.bind(client); let prepared = false;
    client.prepareOptions = async options => {
      prepared = true;
      if (mode === 'epoch') await relation.store.bumpEpoch(f.agent.id);
      if (mode === 'correction') await f.adaptive.correctMemory(ID.alice, 'memory-0', {space: 'work', text: 'External correction after observation.', expectedRevision: 1, eventId: randomUUID()}, {authorizeNow: () => true});
      await prepare(options);
    };
    const response = await handleConversationRequest(f.h.studio, f.request('launchcodename'), TOKEN);
    expect(prepared).toBe(true);
    if (mode === 'positive') {
      expect(response.status).toBe(200); expect(transport).toHaveBeenCalledTimes(1);
      const payload = String(transport.mock.calls[0][1]?.body);
      for (const text of ['Launchcodename is Sapphire.', 'SYNTHETIC_SELECTED_SHARED_FACT', 'SYNTHETIC_LIVE_RELATIONSHIP_STYLE', 'response_length']) expect(payload).toContain(text);
    } else {expect(response.status).not.toBe(200); expect(transport).not.toHaveBeenCalled();}
    const sources = await f.adaptive.withAccountDocument(ID.alice, d => d.relationships.sources.map(source => source.id));
    expect(sources.some(id => id.startsWith('call:'))).toBe(true);
  });
  it('real tap-to-talk relationship reservation returns a response rather than invalidating its own admission', async () => {
    const f = await fixture(true, true, true); await attachRelationship(f); f.h.openai.transcribe.mockResolvedValue('launchcodename');
    const result = await f.h.studio.callTurn(f.users.alice, f.agent.id, new ArrayBuffer(3), 'audio/webm');
    expect(result.reply).toBe('Sure.'); expect(f.h.chatLLM.replyRequests).toHaveLength(1);
    expect(JSON.stringify(f.h.chatLLM.replyRequests[0])).toContain('SYNTHETIC_LIVE_RELATIONSHIP_STYLE');
  });

});
