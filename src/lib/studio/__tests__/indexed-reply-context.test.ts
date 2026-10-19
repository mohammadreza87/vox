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
import {personId} from '../org-bridge';

const NOW = T0.getTime(), TOKEN = '123:synthetic-manager';
const paths: string[] = [], stores: SqliteAdaptiveStorage[] = [];
afterEach(() => {vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close(); for (const path of paths.splice(0)) rmSync(path, {recursive: true, force: true});});
async function fixture() {
  const h = makeStudio(), users = await seedOrg(h), {agent} = await hire(h, users.alice);
  let now = NOW;
  const directory = mkdtempSync(join(tmpdir(), 'vox-indexed-reply-')); paths.push(directory);
  const capabilities = ['core_text', 'personalization'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [{accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true}],
    approvals: capabilities.map((capability, i) => ({schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: NOW, reviewExpiresAt: NOW + 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only'}))}));
  const storage = new SqliteAdaptiveStorage(join(directory, 'synthetic.sqlite'), {now: () => now}); stores.push(storage);
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), {...options, now: () => now});
  h.studio.deps.adaptive = adaptive; h.studio.deps.experience = new AdaptiveExperienceService(adaptive);
  await adaptive.confirm(ID.alice, {confirm: true, adultConfirmed: true});
  const before = await adaptive.read(ID.alice, 'work'), purpose = 'optional.personalization';
  const shown = await adaptive.present(ID.alice, {space: 'work', purpose, locale: 'en', expectedRevision: before.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID()});
  await adaptive.changeConsent(ID.alice, {space: 'work', purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), receipt: shown.receipt});
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
    expect(result.transcript).toBe('launchcodename'); expect(acquire).toHaveBeenCalledExactlyOnceWith(ID.alice, 'work', f.agent.id, 'launchcodename');
    expect(optionalRecordingReads).toBe(1); expect(f.storage.io.canonicalImageReads).toBe(optionalRecordingReads); expect(f.storage.io.bodyRowsRead).toBeLessThanOrEqual(64);
  });
});
