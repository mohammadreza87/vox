import { describe, expect, it, vi } from 'vitest';
import { handleConversationRequest } from '../conversation';
import { signInitData } from '../auth';
import { hire, ID, makeStudio, seedOrg } from './helpers';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { AdaptiveObserverService } from '../../adaptive/observation/service';
import { randomUUID } from 'crypto';

const TOKEN = '123:synthetic-manager';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
function request(body: unknown, extras: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request('https://vox.example/api/studio/conversation', { method: 'POST', signal,
    headers: { origin: 'https://vox.example', 'content-type': 'application/json',
      'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Alice' }, TOKEN), ...extras }, body: JSON.stringify(body) });
}
async function setup() {
  const h = makeStudio({ adaptive: false }), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const now = Date.now(), capabilities = ['core_text', 'single_party_image', 'product_analytics'];
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'test', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `approval${i}`, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'test', effectiveAt: now,
      reviewExpiresAt: now + 86_400_000, owner: 'test-owner', approvalReference: 'synthetic' })) }));
  let imageAllowed = true;
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), { ...options,
    capabilityPolicy: (context, at) => context.capability === 'single_party_image' && !imageAllowed ? undefined : options.capabilityPolicy?.(context, at) });
  h.studio.deps.adaptive = adaptive;
  const confirmed = await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'grant-agent-1' });
  const input = { agentId: agent.id, space: 'work', text: 'Describe the colors in this shared image.' };
  return { h, adaptive, input, setImageAllowed: (allowed: boolean) => { imageAllowed = allowed; } };
}
describe('scoped current-turn conversations', () => {
  it('observes consented outcomes without text/images and purges them on withdrawal', async () => {
    const { h, adaptive, input, setImageAllowed } = await setup();
    const observer = new AdaptiveObserverService(adaptive); h.studio.deps.observer = observer;
    await handleConversationRequest(h.studio, request(input), TOKEN);
    expect(await adaptive.withAccountDocument(ID.alice, d => d.observer.events.length)).toBe(0);
    const before = await adaptive.read(ID.alice, 'work');
    const shown = await adaptive.present(ID.alice, { space: 'work', purpose: 'optional.product_analytics', locale: 'en',
      expectedRevision: before.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID() });
    await adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.product_analytics', state: 'granted',
      expectedRevision: shown.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID(), receipt: shown.receipt });
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(200);
    await observer.process(ID.alice);
    expect((await observer.snapshot(ID.alice, 'work')).projection).toMatchObject({ responseTurns: 1, responded: 1 });
    const stored = JSON.stringify(await adaptive.withAccountDocument(ID.alice, d => d.observer));
    expect(stored).not.toContain(input.text); expect(stored).not.toContain(PNG.split(',')[1]);
    expect((await observer.snapshot(ID.alice, 'personal')).projection.responseTurns).toBe(0);
    const record = observer.recordServer.bind(observer);
    vi.spyOn(observer, 'recordServer').mockImplementationOnce(async (...args) => { setImageAllowed(false); return record(...args); });
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(409);
    const current = await adaptive.read(ID.alice, 'work');
    await adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn',
      expectedRevision: current.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID() });
    expect(await adaptive.withAccountDocument(ID.alice, d => d.observer.events.length)).toBe(0);
  });
  it('requires real authentication, same origin and exact agent/space grants', async () => {
    const { h, input } = await setup();
    for (const [body, headers, status] of [
      [input, { 'x-telegram-init-data': '' }, 401], [input, { origin: 'https://hostile.example' }, 403],
      [{ ...input, space: 'personal' }, {}, 403], [{ ...input, personId: 'someone-else' }, {}, 400],
    ] as const) expect((await handleConversationRequest(h.studio, request(body, headers), TOKEN)).status).toBe(status);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
  });
  it('denies a blocked member despite an existing agent grant, before exporting text or images', async () => {
    const { h, input } = await setup();
    await h.store.update(s => { s.agents.find(a => a.id === input.agentId)!.blocked = [ID.alice]; });
    for (const body of [input, { ...input, image: PNG }]) {
      expect((await handleConversationRequest(h.studio, request(body), TOKEN)).status).toBe(403);
    }
    expect(h.chatLLM.replyRequests).toHaveLength(0);
  });
  it('rechecks a new block at provider entry and after provider completion', async () => {
    const { h, input } = await setup();
    const block = () => h.store.update(s => { s.agents.find(a => a.id === input.agentId)!.blocked = [ID.alice]; });
    const original = h.studio.gateway.bind(h.studio);
    const spy = vi.spyOn(h.studio, 'gateway').mockImplementation(async () => {
      const built = await original(); const converse = built.gateway.converse.bind(built.gateway);
      vi.spyOn(built.gateway, 'converse').mockImplementation(async (...args) => { await block(); return converse(...args); });
      return built;
    });
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(409);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
    spy.mockRestore();
    await h.store.update(s => { s.agents.find(a => a.id === input.agentId)!.blocked = []; });
    vi.spyOn(h.chatLLM, 'complete').mockImplementation(async () => { await block(); return 'BLOCKED_PROVIDER_CANARY'; });
    const response = await handleConversationRequest(h.studio, request(input), TOKEN);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('BLOCKED_PROVIDER_CANARY');
  });
  it('exports the minimized current image only and never records its bytes in memory/history', async () => {
    const { h, input } = await setup();
    const response = await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ reply: 'Sure.' });
    expect(h.chatLLM.replyRequests.at(-1)?.messages.at(-1)?.images).toEqual([{ mimeType: 'image/png', data: PNG.split(',')[1] }]);
    const next = await handleConversationRequest(h.studio, request(input), TOKEN);
    expect(next.status).toBe(200);
    expect(h.chatLLM.replyRequests.at(-1)?.messages.some(m => m.images?.length)).toBe(false);
    expect(h.chatLLM.extractionCalls).toBe(0);
    expect(await h.memory.history.recent(input.agentId, `private-tg-${ID.alice}`, 20)).toEqual([]);
  });
  it('denies image export without its own capability, even with core text permission', async () => {
    const { h, input, setImageAllowed } = await setup(); setImageAllowed(false);
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(403);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
    expect((await handleConversationRequest(h.studio, request(input), TOKEN)).status).toBe(200);
  });
  it('rechecks image authorization at the provider boundary, not only HTTP entry', async () => {
    const { h, input, setImageAllowed } = await setup();
    const original = h.studio.gateway.bind(h.studio);
    vi.spyOn(h.studio, 'gateway').mockImplementation(async () => {
      const built = await original(); const converse = built.gateway.converse.bind(built.gateway);
      vi.spyOn(built.gateway, 'converse').mockImplementation((...args) => { setImageAllowed(false); return converse(...args); });
      return built;
    });
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(409);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
  });
  it('suppresses provider output when approval changes or the request is aborted', async () => {
    const { h, input, setImageAllowed } = await setup();
    vi.spyOn(h.chatLLM, 'complete').mockImplementation(async () => { setImageAllowed(false); return 'PRIVATE_PROVIDER_CANARY'; });
    const response = await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('PRIVATE_PROVIDER_CANARY');
    const controller = new AbortController(); controller.abort();
    expect((await handleConversationRequest(h.studio, request(input, {}, controller.signal), TOKEN)).status).toBe(409);
  });
  it('denies image export when approval changes during the final context read', async () => {
    const { h, input, setImageAllowed } = await setup();
    const originalGateway = h.studio.gateway.bind(h.studio);
    vi.spyOn(h.studio, 'gateway').mockImplementation(async () => {
      const built = await originalGateway();
      const converse = built.gateway.converse.bind(built.gateway);
      vi.spyOn(built.gateway, 'converse').mockImplementation((persona, speaker, text, options) => {
        let checks = 0;
        return converse(persona, speaker, text, { ...options, authorize: async () => {
          if (++checks === 4) {
            const context = h.studio.adaptiveContext.bind(h.studio);
            const spy = vi.spyOn(h.studio, 'adaptiveContext').mockImplementationOnce(async (...args) => {
              const result = await context(...args); setImageAllowed(false); return result;
            });
            try { return await options!.authorize!(); } finally { spy.mockRestore(); }
          }
          return await options!.authorize!();
        } });
      });
      return built;
    });
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(409);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
  });
  it('denies export when a block commits during the final canonical read at transport entry', async () => {
    const { h, adaptive, input } = await setup();
    const originalGateway = h.studio.gateway.bind(h.studio);
    vi.spyOn(h.studio, 'gateway').mockImplementation(async () => {
      const built = await originalGateway();
      const converse = built.gateway.converse.bind(built.gateway);
      vi.spyOn(built.gateway, 'converse').mockImplementation((persona, speaker, text, options) => {
        let checks = 0;
        return converse(persona, speaker, text, { ...options, authorize: async () => {
          // The fifth caller check is the LLM transport callback, after the
          // gateway's own export check. A prior check would mask this race.
          if (++checks === 5) {
            const read = h.store.read.bind(h.store);
            const readAccount = adaptive.withAccountDocument.bind(adaptive);
            let accountSpy: ReturnType<typeof vi.spyOn> | undefined;
            const storeSpy = vi.spyOn(h.store, 'read').mockImplementationOnce(async () => {
              const snapshot = await read();
              accountSpy = vi.spyOn(adaptive, 'withAccountDocument').mockImplementationOnce(async (id, fn) => {
                await h.store.update(state => { state.agents.find(a => a.id === input.agentId)!.blocked = [ID.alice]; });
                return readAccount(id, fn);
              });
              return snapshot;
            });
            try { return await options!.authorize!(); } finally { storeSpy.mockRestore(); accountSpy?.mockRestore(); }
          }
          return await options!.authorize!();
        } });
      });
      return built;
    });
    expect((await handleConversationRequest(h.studio, request({ ...input, image: PNG }), TOKEN)).status).toBe(409);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
  });
  it('rejects remote, malformed and oversize attachments without fetching or echoing content', async () => {
    const { h, input } = await setup();
    for (const image of ['https://private.example/SECRET', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      const response = await handleConversationRequest(h.studio, request({ ...input, image }), TOKEN);
      expect(response.status).toBe(400); expect(await response.text()).not.toContain('SECRET');
    }
    expect((await handleConversationRequest(h.studio, request({ ...input, image: 'x'.repeat(120_000) }), TOKEN)).status).toBe(413);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
  });
});
