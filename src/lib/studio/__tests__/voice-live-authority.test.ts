import { expect, it, vi } from 'vitest';
import { hire, ID, makeStudio, seedOrg } from './helpers';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { personId } from '../org-bridge';
import { makeGateway } from '../../tireh/__tests__/fixtures';

async function setup(adaptiveEnabled = false) {
  // Without adaptiveEnabled these cases cover the legacy path ("even without adaptive privacy").
  const h = makeStudio({ adaptive: false }), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  h.studio.deps.webhookBase = 'https://vox.synthetic';
  if (adaptiveEnabled) {
    const now = Date.now();
    const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), adaptiveOptionsFromManifest(JSON.stringify({
      schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: ['core_text'],
      accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
      approvals: [{ schemaVersion: 1, id: 'live-core', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC',
        capability: 'core_text', state: 'approved', configurationVersion: 'synthetic', effectiveAt: now,
        reviewExpiresAt: now + 86_400_000, owner: 'synthetic', approvalReference: 'synthetic' }],
    })));
    h.studio.deps.adaptive = adaptive;
    const confirmed = await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
    await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'live-grant' });
  }
  const block = () => h.store.update(state => { state.agents.find(a => a.id === agent.id)!.blocked = [ID.alice]; });
  return { h, users, agent, block };
}
const turns = [{ role: 'user' as const, content: 'Synthetic current voice turn.' }];
async function collect(iterable: AsyncIterable<string>) { let text = ''; for await (const part of iterable) text += part; return text; }

it('blocks live bootstrap and provider entry despite existing membership and canonical grants', async () => {
  const { h, users, agent, block } = await setup(true); await block();
  await expect(h.studio.startLiveCall(users.alice, agent.id)).rejects.toThrow();
  await expect(h.studio.liveTurn(agent.id, ID.alice, turns)).rejects.toThrow();
  expect(h.eleven.signedUrl).not.toHaveBeenCalled(); expect(h.eleven.createAgent).not.toHaveBeenCalled();
  expect(h.chatLLM.replyRequests).toHaveLength(0);
});
it('withholds a signed session URL when a block commits during provider bootstrap', async () => {
  const { h, users, agent, block } = await setup();
  h.eleven.signedUrl.mockImplementationOnce(async () => { await block(); return 'wss://synthetic.invalid/DO_NOT_RETURN'; });
  await expect(h.studio.startLiveCall(users.alice, agent.id)).rejects.toThrow();
  expect(h.eleven.signedUrl).toHaveBeenCalledOnce();
});
it('checks a new block after awaited gateway construction even without adaptive privacy', async () => {
  const { h, agent, block } = await setup();
  const build = h.studio.gateway.bind(h.studio);
  vi.spyOn(h.studio, 'gateway').mockImplementationOnce(async () => { const value = await build(); await block(); return value; });
  expect(await collect(await h.studio.liveTurn(agent.id, ID.alice, turns))).toBe('');
  expect(h.chatLLM.replyRequests).toHaveLength(0);
});
it('centrally rejects blocked private audiences even when a caller bypasses the Studio live wrapper', async () => {
  const { h, agent, block } = await setup(true);
  const { gateway } = await h.studio.gateway(); await block();
  expect(await collect(gateway.liveTurn(agent.id, personId(ID.alice), turns))).toBe('');
  expect(h.chatLLM.replyRequests).toHaveLength(0);
});
it('does not retain a turn when a block commits during awaited history loading', async () => {
  const { h, agent, block } = await setup();
  const read = h.memory.history.recent.bind(h.memory.history);
  vi.spyOn(h.memory.history, 'recent').mockImplementationOnce(async (...args) => { const history = await read(...args); await block(); return history; });
  const append = vi.spyOn(h.memory.history, 'append');
  expect(await collect(await h.studio.liveTurn(agent.id, ID.alice, turns))).toBe('');
  expect(append).not.toHaveBeenCalled(); expect(h.chatLLM.replyRequests).toHaveLength(0);
});
it('withholds the forget confirmation when a block commits while deletion awaits', async () => {
  const { h, agent, block } = await setup();
  const clear = h.memory.history.clearPersona.bind(h.memory.history);
  vi.spyOn(h.memory.history, 'clearPersona').mockImplementationOnce(async (...args) => { await clear(...args); await block(); });
  expect(await collect(await h.studio.liveTurn(agent.id, ID.alice, [{ role: 'user', content: 'forget everything' }]))).toBe('');
  expect(h.chatLLM.replyRequests).toHaveLength(0);
});
it('rechecks Studio access after the final canonical context await at the real LLM transport boundary', async () => {
  const { h, agent, block } = await setup(true);
  const complete = h.chatLLM.complete.bind(h.chatLLM);
  vi.spyOn(h.chatLLM, 'complete').mockImplementationOnce(async request => {
    const read = h.studio.adaptiveContext.bind(h.studio);
    const spy = vi.spyOn(h.studio, 'adaptiveContext').mockImplementationOnce(async (...args) => {
      const context = await read(...args); await block(); return context;
    });
    try { return await complete(request); } finally { spy.mockRestore(); }
  });
  await expect(collect(await h.studio.liveTurn(agent.id, ID.alice, turns))).rejects.toThrow();
  expect(h.chatLLM.replyRequests).toHaveLength(0);
});
it.each([false, true])('suppresses a chunk generated after a block and closes the upstream stream (adaptive %s)', async adaptive => {
  const { h, agent, block } = await setup(adaptive);
  let closed = false;
  h.studio.deps.fastLLM = { complete: vi.fn(), stream: async function* () {
    try { yield 'Already delivered.'; await block(); yield 'BLOCKED_LATE_CANARY'; }
    finally { closed = true; }
  } };
  const iterator = (await h.studio.liveTurn(agent.id, ID.alice, turns))[Symbol.asyncIterator]();
  expect(await iterator.next()).toMatchObject({ value: 'Already delivered.', done: false });
  expect(await iterator.next()).toMatchObject({ done: true }); expect(closed).toBe(true);
});
it('denies blocked call-end reflection before loading or exporting retained history', async () => {
  const { h, users, agent, block } = await setup(); await block();
  await expect(h.studio.endLiveCall(users.alice, agent.id)).rejects.toThrow();
  expect(h.chatLLM.extractionCalls).toBe(0);
});
it('does not reflect when access is blocked during awaited gateway construction', async () => {
  const { h, users, agent, block } = await setup();
  const build = h.studio.gateway.bind(h.studio);
  vi.spyOn(h.studio, 'gateway').mockImplementationOnce(async () => { const value = await build(); await block(); return value; });
  await h.studio.endLiveCall(users.alice, agent.id);
  expect(h.chatLLM.extractionCalls).toBe(0);
});
it('rechecks call-end access inside the extraction transport after its final awaited memory revision', async () => {
  const { h, users, agent, block } = await setup();
  const complete = h.chatLLM.complete.bind(h.chatLLM);
  vi.spyOn(h.chatLLM, 'complete').mockImplementationOnce(async request => {
    const read = h.memory.memories.safetyRevision.bind(h.memory.memories);
    const spy = vi.spyOn(h.memory.memories, 'safetyRevision').mockImplementationOnce(async (...args) => {
      const revision = await read(...args); await block(); return revision;
    });
    try { return await complete(request); } finally { spy.mockRestore(); }
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try { await h.studio.endLiveCall(users.alice, agent.id); } finally { warn.mockRestore(); }
  expect(h.chatLLM.extractionCalls).toBe(0);
});
it('withholds a private share-offer message when access is blocked during offer creation', async () => {
  const h = makeGateway();
  await collect(h.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Synthetic project decision.' }]));
  h.llm.nextExtraction = { memories: [{ content: 'Synthetic project decision', type: 'fact', kind: 'work', projectId: 'gameend' }] };
  let allowed = true;
  const create = h.offers.create.bind(h.offers);
  const offer = vi.spyOn(h.offers, 'create').mockImplementationOnce(async (...args) => { const value = await create(...args); allowed = false; return value; });
  await h.gateway.reflect('aria', 'reza', { authorize: async () => allowed });
  expect(offer).toHaveBeenCalledOnce(); expect(h.bot.sent).toEqual([]);
});
