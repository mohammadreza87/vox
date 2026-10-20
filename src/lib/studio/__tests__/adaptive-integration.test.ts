import { describe, expect, it, vi } from 'vitest';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { InMemoryRelationshipStore, RelationshipLoop } from '../../relationships';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { groupText } from '../../tireh/__tests__/fixtures';
import { hire, ID, makeStudio, seedOrg } from './helpers';

async function setup() {
  // These fences cover an in-memory adaptive service without the relationship authority.
  const h = makeStudio({ adaptive: false });
  const users = await seedOrg(h);
  const { agent, bot } = await hire(h, users.alice);
  h.studio.deps.adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
  h.studio.deps.webhookBase = 'https://vox.example';
  return { h, users, agent, bot };
}

const options = { botToken: '123:synthetic-manager', devUser: null };
function request(path: string, method: string, body?: unknown) {
  return new Request(`https://vox.example/api/studio/${path}`, { method,
    headers: { 'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Alice' }, options.botToken),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('Studio adaptive integration fences', () => {
  it('routes Personal live-call requests to tap-to-talk without provisioning a realtime session', async () => {
    const { h, agent } = await setup();
    const response = await handleStudioRequest(h.studio, request(`agents/${agent.id}/live-call`, 'POST', { space: 'personal' }), ['agents', agent.id, 'live-call'], options);
    expect(await response.json()).toEqual({ live: false });
    expect(h.eleven.createAgent).not.toHaveBeenCalled();
    expect(h.eleven.signedUrl).not.toHaveBeenCalled();
  });

  it('rejects invalid call space and never reflects adaptive or Personal call transcripts into legacy memories', async () => {
    const { h, users, agent } = await setup();
    const gateway = vi.spyOn(h.studio, 'gateway');
    await h.studio.endLiveCall(users.alice, agent.id, 'work');
    await h.studio.endLiveCall(users.alice, agent.id, 'personal');
    expect(gateway).not.toHaveBeenCalled();
    const response = await handleStudioRequest(h.studio, request(`agents/${agent.id}/live-call`, 'POST', { space: 'other' }), ['agents', agent.id, 'live-call'], options);
    expect(response.status).toBe(400);
  });

  it('advertises one sharing authority and denies legacy sharing before any memory mutation', async () => {
    const { h, users, agent } = await setup();
    const get = vi.spyOn(h.memory.memories, 'get');
    const response = await handleStudioRequest(h.studio, request('me', 'GET'), ['me'], options);
    expect((await response.json()).features.legacyMemorySharing).toBe(false);
    await expect(h.studio.shareMemory(users.alice, agent.id, 'legacy-memory', [ID.bob])).rejects.toMatchObject({ status: 409 });
    expect(get).not.toHaveBeenCalled();
  });

  it('suppresses group output when the live roster cannot verify the authorized snapshot', async () => {
    const { h, agent, bot } = await setup();
    const chatId = -998;
    await h.store.update(s => s.groups.push({ chatId, title: 'Synthetic group', memberIds: [ID.alice, ID.bob],
      hasGuests: false, agentIds: [agent.id], addedAt: h.clock.now.toISOString() }));
    const { gateway } = await h.studio.gateway();
    expect(await gateway.handleUpdate(agent.id, groupText(chatId, ID.alice, 'Nova, hello'))).toBe('ignored');
    expect(bot().sendMessage).not.toHaveBeenCalled();
    expect((await h.store.read()).groups[0]).toMatchObject({ hasGuests: true, audienceEpoch: 1 });
  });

  it('denies legacy relationship state, observation and worker execution even with a live injected loop', async () => {
    const { h, users, agent } = await setup();
    const loop = new RelationshipLoop({ store: new InMemoryRelationshipStore(), mode: 'live', assessor: { assess: async () => ({}) } });
    h.studio.deps.relationships = loop;
    const status = vi.spyOn(loop, 'status');
    const drain = vi.spyOn(loop, 'drain');
    const observe = vi.spyOn(loop, 'observeTurn');
    const { gateway } = await h.studio.gateway();
    await gateway.converse(agent.id, `tg-${ID.alice}`, 'A synthetic current turn.');
    expect(observe).not.toHaveBeenCalled();
    expect(await h.studio.relationshipFor(users.alice, agent.id)).toMatchObject({ available: false, mode: 'off', pending: 0 });
    await expect(h.studio.updateRelationship(users.alice, agent.id, { action: 'resume' })).rejects.toMatchObject({ status: 503 });
    expect(await h.studio.drainRelationships()).toMatchObject({ claimed: 0, sent: 0 });
    expect(status).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });
});
