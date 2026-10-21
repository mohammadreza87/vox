/**
 * Legacy FILE adaptive storage (the production profile) with live scoped relationships: a Studio or
 * pet text turn records its own relationship observation, which bumps the relationship revision.
 * The turn's outer authority must not read that as a settings change, while a real relationship
 * control during the turn must still suppress the reply.
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
import {handleConversationRequest} from '../conversation';
import {signInitData} from '../auth';
import {personId} from '../org-bridge';

const NOW = T0.getTime(), TOKEN = '123:synthetic-manager';
const paths: string[] = [];
afterEach(() => {vi.restoreAllMocks(); for (const path of paths.splice(0)) rmSync(path, {recursive: true, force: true});});

async function fixture() {
  const h = makeStudio(), users = await seedOrg(h), {agent} = await hire(h, users.alice);
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
  const request = (text: string) => new Request('https://vox.example/api/studio/conversation', {method: 'POST', headers: {origin: 'https://vox.example', 'content-type': 'application/json',
    'x-telegram-init-data': signInitData({id: ID.alice, first_name: 'Alice'}, TOKEN)}, body: JSON.stringify({agentId: agent.id, space: 'work', text})});
  return {h, store, permit, request};
}

describe('relationship observation inside a FILE-profile text turn', () => {
  it('replies to consecutive turns although each one bumps the relationship revision', async () => {
    const f = await fixture();
    const before = (await f.store.read(f.permit.key)).revision;
    for (const text of ['Synthetic first turn', 'Synthetic second turn']) {
      const response = await handleConversationRequest(f.h.studio, f.request(text), TOKEN);
      expect(response.status).toBe(200);
    }
    expect(f.h.chatLLM.replyRequests).toHaveLength(2);
    expect((await f.store.read(f.permit.key)).revision).toBeGreaterThanOrEqual(before + 2);
  });

  it.each(['stop', 'pause', 'forget'] as const)('still suppresses the reply when a relationship %s commits during inference', async (action) => {
    const f = await fixture();
    const complete = f.h.chatLLM.complete.bind(f.h.chatLLM);
    let fired = false;
    vi.spyOn(f.h.chatLLM, 'complete').mockImplementation(async (request) => {
      if (!fired) { fired = true; await f.h.studio.deps.relationships!.control(f.permit.key, action); }
      return complete(request);
    });
    const response = await handleConversationRequest(f.h.studio, f.request('Synthetic turn during a control'), TOKEN);
    expect(fired).toBe(true);
    expect(response.status).toBe(409);
  });
});
