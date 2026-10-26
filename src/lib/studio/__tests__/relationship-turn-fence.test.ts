/**
 * Legacy FILE adaptive storage (the production profile) with live scoped relationships: a Studio,
 * pet or voice turn records its own relationship observation, which bumps the relationship revision.
 * The turn's outer authority must not read that as a settings change, while a real relationship
 * control during the turn must still void the reply, before or after the provider returns.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hire, ID, makeStudio, seedOrg, T0} from './helpers';
import {AdaptiveRepository, accountIdFor} from '../../adaptive/persistence/repository';
import {AdaptiveService} from '../../adaptive/persistence/service';
import {FileAdaptiveStorage} from '../../adaptive/persistence/storage';
import {adaptiveOptionsFromManifest} from '../../adaptive/persistence/config';
import {AdaptiveRelationshipService} from '../../adaptive/relationships/service';
import {InMemoryRelationshipStore, RelationshipLoop} from '../../relationships';
import type {LLMRequest} from '../../tireh/llm';
import {handleConversationRequest} from '../conversation';
import {handlePetRequest} from '../pet-http';
import {signInitData} from '../auth';
import {agentInit} from './initdata-keys';
import {personId} from '../org-bridge';

const NOW = T0.getTime(), TOKEN = '123:synthetic-manager', ORIGIN = 'https://vox.example', REPLY = 'Sure.';
const paths: string[] = [];
afterEach(() => {vi.restoreAllMocks(); for (const path of paths.splice(0)) rmSync(path, {recursive: true, force: true});});

async function fixture() {
  const h = makeStudio(), users = await seedOrg(h), {agent, token} = await hire(h, users.alice);
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  let now = NOW;
  const directory = mkdtempSync(join(tmpdir(), 'vox-relationship-fence-')); paths.push(directory);
  const capabilities = ['core_text', 'personalization', 'auto_memory', 'proactive_suggestions'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: capabilities,
    accounts: [ID.alice].map(id => ({accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true})),
    approvals: capabilities.map((capability, i) => ({schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: NOW, reviewExpiresAt: NOW + 86_400_000, owner: 'synthetic', approvalReference: 'synthetic-only'}))}));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(directory)), {...options, scopedRelationshipsEnabled: true, now: () => now});
  Object.defineProperty(h.chatLLM, 'committedExportFence', {value: true});
  h.studio.deps.adaptive = adaptive;
  const confirmed = await adaptive.confirm(ID.alice, {confirm: true, adultConfirmed: true});
  await adaptive.setAgentAccess(ID.alice, agent.id, {space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: randomUUID()});
  now = NOW + 300; h.clock.now = new Date(now);
  await adaptive.withAccountDocument(ID.alice, (d, at) => {
    for (const permission of d.permissions) if (permission.id.startsWith('permission:work:')) {permission.state = 'granted'; permission.expiresAt = NOW + 80_000;}
    d.relationships.bindings = [{id: 'synthetic-durable', revision: 1, accountId: d.accountId, personId: d.personId, space: 'work', status: 'active', confirmedAt: at, expiresAt: NOW + 80_000, originBindingId: d.binding!.id}]; d.revision++;
  });
  const authority = new AdaptiveRelationshipService(adaptive), store = new InMemoryRelationshipStore();
  const loop = new RelationshipLoop({store, mode: 'live', now: () => h.clock.now, assessor: {assess: async () => ({})},
    authorize: input => authority.authorize(input.key, input.sourceIds, input.phase, input.expectedFingerprint),
    synchronize: (key, ids) => authority.synchronize(key, ids)});
  Object.assign(h.studio.deps, {relationshipAuthority: authority, relationships: loop, relationshipStore: store,
    relationshipConfig: {mode: 'live', agentIds: [agent.id], personIds: [personId(ID.alice)]}});
  const permit = (await authority.resolve(ID.alice, agent.id, 'work'))!; expect(permit).not.toBeNull();
  const studioText = (text: string) => handleConversationRequest(h.studio, new Request(`${ORIGIN}/api/studio/conversation`, {method: 'POST',
    headers: {origin: ORIGIN, 'content-type': 'application/json', 'x-telegram-init-data': signInitData({id: ID.alice, first_name: 'Alice'}, TOKEN)},
    body: JSON.stringify({agentId: agent.id, space: 'work', text})}), TOKEN);
  const petText = (text: string) => handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${agent.id}/talk`, {method: 'POST',
    headers: {origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'UTC', 'x-telegram-init-data': agentInit({id: ID.alice, first_name: 'Alice'}, token)},
    body: JSON.stringify({text})}), agent.id, ['talk']);
  const voice = () => h.studio.callTurn(users.alice, agent.id, new ArrayBuffer(3), 'audio/webm');
  /** Commits `action` once, either before the reply's provider call or after it returns. */
  const controlDuring = (action: 'stop' | 'pause' | 'forget', timing: 'before' | 'after', sourceIds?: string[]) => {
    const complete = h.chatLLM.complete.bind(h.chatLLM);
    const fired = {value: false};
    const control = async () => { if (!fired.value) { fired.value = true; await loop.control(permit.key, action, sourceIds ? {sourceIds} : {}); } };
    vi.spyOn(h.chatLLM, 'complete').mockImplementation(async (request: LLMRequest) => {
      if (timing === 'before') await control();
      const out = await complete(request);
      if (timing === 'after') await control();
      return out;
    });
    return fired;
  };
  return {h, store, permit, studioText, petText, voice, controlDuring};
}

describe('a FILE-profile turn and its own relationship observation', () => {
  it('replies to consecutive Studio text turns although each one bumps the relationship revision', async () => {
    const f = await fixture();
    const before = (await f.store.read(f.permit.key)).revision;
    for (const text of ['Synthetic first turn', 'Synthetic second turn']) {
      const response = await f.studioText(text);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({reply: REPLY});
    }
    expect(f.h.chatLLM.replyRequests).toHaveLength(2);
    expect((await f.store.read(f.permit.key)).revision).toBeGreaterThanOrEqual(before + 2);
  });

  it('replies to consecutive pet talk turns', async () => {
    const f = await fixture();
    for (const text of ['Synthetic pet hello', 'Synthetic pet again']) {
      const response = await f.petText(text);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({reply: REPLY});
    }
  });

  it('replies to consecutive voice turns (pet hold-to-talk and Studio calls)', async () => {
    const f = await fixture();
    for (let i = 0; i < 2; i++) expect(await f.voice()).toMatchObject({reply: REPLY});
  });
});

describe('a relationship control during the turn still voids it', () => {
  it.each([
    ['stop', 'before'], ['pause', 'before'], ['forget', 'before'],
    ['stop', 'after'], ['pause', 'after'], ['forget', 'after'],
  ] as const)('Studio text: %s committed %s the provider call', async (action, timing) => {
    const f = await fixture();
    const fired = f.controlDuring(action, timing);
    const response = await f.studioText('Synthetic turn during a control');
    expect(fired.value).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({error: 'conversation_changed'});
    if (timing === 'before') expect(f.h.chatLLM.replyRequests).toHaveLength(0);
  });

  it.each(['stop', 'forget'] as const)('pet talk: %s committed after the provider call', async (action) => {
    const f = await fixture();
    const fired = f.controlDuring(action, 'after');
    const response = await f.petText('Synthetic pet turn during a control');
    expect(fired.value).toBe(true);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error: 'conversation_failed', message: 'conversation_changed'});
  });

  it.each(['stop', 'forget'] as const)('voice: %s committed after the provider call', async (action) => {
    const f = await fixture();
    const fired = f.controlDuring(action, 'after');
    await expect(f.voice()).rejects.toMatchObject({status: 409});
    expect(fired.value).toBe(true);
  });

  it('a single-source forget still counts once the forgotten list is at its cap', async () => {
    const f = await fixture();
    await f.store.update(f.permit.key, s => { s.forgottenSourceIds = Array.from({length: 256}, (_, i) => `synthetic-old-${i}`); s.revision++; });
    expect((await f.store.read(f.permit.key)).forgottenSourceIds).toHaveLength(256);
    const fired = f.controlDuring('forget', 'after', ['synthetic-late-source']);
    const response = await f.studioText('Synthetic turn during a capped forget');
    expect(fired.value).toBe(true);
    expect((await f.store.read(f.permit.key)).forgottenSourceIds).toHaveLength(256);
    expect(response.status).toBe(409);
  });
});
