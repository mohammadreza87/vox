import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveLifecycleService } from '../../adaptive/lifecycle/service';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { NOW, rightsFixture, syntheticRightsPolicy } from '../../adaptive/rights-intake/fixtures';
import { RightsIntakeService } from '../../adaptive/rights-intake/service';
import { newCare } from '../../pet/care';
import { menuLabel, petPageUrl } from '../../pet/links';
import { agentInit } from './initdata-keys';
import { PET_GUEST_RETENTION_MS, petStoreFor, sweepPetCare } from '../pet-store';
import { assertRightsAccountNow, handleRightsRequest } from '../rights-http';
import { Studio } from '../service';
import { StudioStore } from '../store';
import { personId } from '../org-bridge';
import { InMemorySupersededNoticeStore } from '../../tireh/audit';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const STUDIO_URL = 'https://vox.example/studio';

describe('menu button profile step', () => {
  let h: Harness;
  let hired: Awaited<ReturnType<typeof hire>>;
  beforeEach(async () => {
    h = makeStudio();
    const org = await seedOrg(h);
    hired = await hire(h, org.alice, { name: 'Neda' });
  });
  const stored = async () => (await h.store.read()).agents.find((a) => a.id === hired.agent.id)!;

  it('without an HTTPS Studio URL there is no menu step', async () => {
    await h.studio.configureBotProfile(await stored(), { force: true });
    expect(hired.bot().setChatMenuButton).not.toHaveBeenCalled();
    h.studio.deps.webAppUrl = 'http://localhost:3000/studio';
    await h.studio.configureBotProfile(await stored(), { force: true });
    expect(hired.bot().setChatMenuButton).not.toHaveBeenCalled();
  });

  it('an existing synced bot picks the button up on reconcile, once per URL/label hash, and nothing else re-pushes', async () => {
    expect((await stored()).profileSync).toMatchObject({ status: 'synced' });
    hired.bot().setMyName.mockClear();
    h.studio.deps.webAppUrl = STUDIO_URL;
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setChatMenuButton).toHaveBeenCalledTimes(1);
    expect(hired.bot().setChatMenuButton).toHaveBeenCalledWith('Neda', `https://vox.example/studio/pet/${hired.agent.id}`);
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', steps: { menu: expect.any(String) } });

    await h.studio.reconcileBotProfiles();
    await new Studio({ ...h.studio.deps, store: new StudioStore(h.dir) }).reconcileBotProfiles();
    expect(hired.bot().setChatMenuButton).toHaveBeenCalledTimes(1);

    // a new name is a new label: one more push
    await h.store.update((s) => { s.agents.find((a) => a.id === hired.agent.id)!.persona.name = 'Bartholomew-the-Magnificent'; });
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setChatMenuButton).toHaveBeenCalledTimes(2);
    expect(hired.bot().setChatMenuButton).toHaveBeenLastCalledWith('Play', expect.stringContaining('/studio/pet/'));
  });

  it('a refused menu push is recorded as a failed step and retried later', async () => {
    h.studio.deps.webAppUrl = STUDIO_URL;
    hired.bot().setChatMenuButton.mockRejectedValueOnce(new Error('Synthetic Telegram error'));
    expect(await h.studio.configureBotProfile(await stored())).toEqual(['menu']);
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['menu'] });
  });

  it('labels and links', () => {
    expect(menuLabel('Mochi')).toBe('Mochi');
    expect(menuLabel('  Neda Karimi ')).toBe('Neda');
    expect(menuLabel('Abcdefghijklmnop')).toBe('Abcdefghijklmnop');
    expect(menuLabel('Abcdefghijklmnopq')).toBe('Play');
    expect(menuLabel('   ')).toBe('Play');
    expect(menuLabel('ابرک')).toBe('ابرک');
    expect(petPageUrl(STUDIO_URL, 'abc_1')).toBe('https://vox.example/studio/pet/abc_1');
    expect(petPageUrl('https://vox.example/studio/', 'abc')).toBe('https://vox.example/studio/pet/abc');
    for (const bad of [undefined, '', 'not a url', 'http://vox.example/studio', 'https://u:p@vox.example/studio', 'https://vox.example/studio?x=1']) {
      expect(petPageUrl(bad, 'abc')).toBeNull();
    }
    expect(petPageUrl(STUDIO_URL, '../x')).toBeNull();
  });
});

describe('agent retirement', () => {
  it('fire deletes every person’s care for that agent and restores the default menu', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, { name: 'Neda' });
    const other = await hire(h, org.alice, { name: 'Other' });
    const pets = await petStoreFor(h.studio);
    for (const [agentId, userId] of [[agent.id, ID.alice], [agent.id, ID.bob], [other.agent.id, ID.bob]] as const) {
      await pets.update(agentId, userId, () => ({ care: newCare(agentId, userId, NOW, 'UTC', 2), result: null }));
    }
    const reset = vi.fn(async () => true);
    (bot() as unknown as { resetChatMenuButton: typeof reset }).resetChatMenuButton = reset;
    await h.studio.fire(org.admin, agent.id, { reason: 'Done', memoryPolicy: 'archive', confirmName: 'Neda' });
    expect(await pets.get(agent.id, ID.alice)).toBeNull();
    expect(await pets.get(agent.id, ID.bob)).toBeNull();
    expect(await pets.get(other.agent.id, ID.bob)).not.toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('the pet sweep clears what a failed or raced cleanup left, and stale records of people who cannot use the agent', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent } = await hire(h, org.alice, { name: 'Neda' }, undefined, 'public');
    const fired = await hire(h, org.alice, { name: 'Gone' });
    const pets = await petStoreFor(h.studio);
    const now = h.clock.now.getTime(), old = now - PET_GUEST_RETENTION_MS - 1;
    const seen = (agentId: string, userId: number, at: number) => pets.update(agentId, userId, () => ({ care: { ...newCare(agentId, userId, at, 'UTC', 2), lastSeenAt: at }, result: null }));
    await h.studio.fire(org.admin, fired.agent.id, { reason: 'Done', memoryPolicy: 'archive', confirmName: 'Gone' });
    // a write that raced the firing
    await seen(fired.agent.id, ID.bob, now);
    await seen(agent.id, ID.stranger, old);
    await seen(agent.id, ID.alice, old);
    await seen(agent.id, ID.bob, now);
    expect(await sweepPetCare(h.studio)).toEqual({ fired: 1, stale: 1 });
    expect(await pets.get(fired.agent.id, ID.bob)).toBeNull();
    // a long-gone guest goes; a member's record and a recent guest stay
    expect(await pets.get(agent.id, ID.stranger)).toBeNull();
    expect(await pets.get(agent.id, ID.alice)).not.toBeNull();
    expect(await pets.get(agent.id, ID.bob)).not.toBeNull();
    // throttled, idempotent
    expect(await sweepPetCare(h.studio)).toBeNull();
    expect(await sweepPetCare(h.studio, true)).toEqual({ fired: 0, stale: 0 });
    // a broken store is logged and never throws
    h.studio.deps.pets = { clearAgent: vi.fn(async () => { throw new Error('disk'); }) } as never;
    expect(await sweepPetCare(h.studio, true)).toBeNull();
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] pet_sweep_failed');
  });

  it('a failing pet store never stops the firing', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent } = await hire(h, org.alice, { name: 'Neda' });
    h.studio.deps.pets = { clearAgent: vi.fn(async () => { throw new Error('disk'); }) } as never;
    expect((await h.studio.fire(org.admin, agent.id, { reason: 'Done', memoryPolicy: 'archive', confirmName: 'Neda' })).status).toBe('fired');
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] pet_cleanup_failed');
  });
});

describe('rights export and erasure', () => {
  const TOKEN = '123:synthetic-rights-only';
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); });

  async function setup() {
    const f = await rightsFixture();
    cleanup.push(f.close);
    const h = makeStudio();
    await seedOrg(h);
    const manifest = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-pet', enabledCapabilities: ['core_text'],
      accounts: [ID.alice, ID.bob].map((id) => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
      approvals: [{ schemaVersion: 1, id: 'core-only', revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability: 'core_text', state: 'approved',
        configurationVersion: 'synthetic-pet', effectiveAt: NOW, reviewExpiresAt: NOW + 100_000_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
    const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(f.directory, 'canonical'))), { ...manifest, now: () => NOW });
    await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
    const lifecycle = new AdaptiveLifecycleService(adaptive);
    h.studio.deps.lifecycle = lifecycle;
    h.studio.deps.adaptive = adaptive;
    f.setPolicy({ ...syntheticRightsPolicy(), privacyOperatorIds: [ID.superadmin] });
    h.studio.deps.rights = new RightsIntakeService(f.repository, { ...f.options,
      assertAccountNow: (id) => assertRightsAccountNow(h.studio, id), assertOperatorNow: (id) => assertRightsAccountNow(h.studio, id, 'operator'),
      prepareExport: async (id, space) => {
        assertRightsAccountNow(h.studio, id, 'export');
        const prepared = await lifecycle.prepareAccountExport(id, space);
        return { data: prepared.data, revalidate: () => { assertRightsAccountNow(h.studio, id, 'export'); prepared.revalidate(); } };
      } });
    const request = (path: string, body?: unknown) => {
      const req = new Request(`https://vox.synthetic/api/studio/rights/${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { origin: 'https://vox.synthetic', 'content-type': 'application/json', 'x-telegram-init-data': agentInit({ id: ID.alice, first_name: 'A' }, TOKEN) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return handleRightsRequest(h.studio, req, path.split('?')[0].split('/').filter(Boolean), TOKEN);
    };
    const pets = await petStoreFor(h.studio);
    for (const [agentId, userId] of [['agent-a', ID.alice], ['agent-b', ID.alice], ['agent-a', ID.bob]] as const) {
      await pets.update(agentId, userId, () => ({ care: newCare(agentId, userId, NOW, 'UTC', 2), result: null }));
    }
    return { f, h, pets, request };
  }

  it('an export carries the person’s pet care for every agent, and nobody else’s', async () => {
    const { f, request } = await setup();
    const created = await request('requests', f.input('access_export'));
    expect(created.status).toBe(201);
    const row = (await created.json()).request;
    const res = await request(`requests/${row.requestId}/actions?space=work`, { version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    const data = await res.json();
    expect(data.petCare.map((c: { agentId: string; userId: number }) => [c.agentId, c.userId]).sort()).toEqual([['agent-a', ID.alice], ['agent-b', ID.alice]]);
  });

  it('a failing pet store never fails an export or a filed erasure', async () => {
    const { f, h, pets, request } = await setup();
    const real = h.studio.deps.pets;
    h.studio.deps.pets = { listForUser: vi.fn(async () => { throw new Error('disk'); }), eraseUser: vi.fn(async () => { throw new Error('disk'); }) } as never;
    const created = await request('requests', f.input('access_export'));
    const row = (await created.json()).request;
    const res = await request(`requests/${row.requestId}/actions?space=work`, { version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.petCareUnavailable).toBe(true);
    expect(data).not.toHaveProperty('petCare');
    const input = f.input('erasure');
    expect((await request('requests', input)).status).toBe(201);
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] pet_erasure_failed');
    expect(await pets.listForUser(ID.alice)).toHaveLength(2);
    // replaying the filed request retries the erasure
    h.studio.deps.pets = real ?? pets;
    expect((await request('requests', input)).status).toBe(200);
    expect(await pets.listForUser(ID.alice)).toEqual([]);
  });

  it('an erasure request deletes the person’s pet care at once, and a replay is still safe', async () => {
    const { f, pets, request } = await setup();
    const input = f.input('erasure');
    expect((await request('requests', input)).status).toBe(201);
    expect(await pets.listForUser(ID.alice)).toEqual([]);
    expect(await pets.get('agent-a', ID.bob)).not.toBeNull();
    expect((await request('requests', input)).status).toBe(200);
  });

  it('agent-card choices (Circles) a member made as an outsider are exported and erased with the rest; none adds nothing', async () => {
    const { f, h, request } = await setup();
    const exportNow = async () => {
      const row = (await (await request('requests', f.input('access_export'))).json()).request;
      return (await request(`requests/${row.requestId}/actions?space=work`, { version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' })).json();
    };
    expect(await exportNow()).not.toHaveProperty('agentChoices');
    // Just enough of a public agent for each tap, gone again before the export.
    for (const id of [ID.alice, ID.bob]) {
      const receipt = await h.studio.presentAgentCard('agent-a', id, { copyHash: 'a'.repeat(64), locale: 'en' });
      h.clock.now = new Date(h.clock.now.getTime() + 1000);
      await h.studio.deps.store.update((s) => { s.agents.push({ id: 'agent-a', status: 'active', visibility: 'public' } as never); });
      expect(await h.studio.recordAgentChoice('agent-a', id, receipt.id, 'reply_only', `cb-${id}`)).toMatchObject({ ok: true });
      await h.studio.deps.store.update((s) => { s.agents = s.agents.filter((a) => a.id !== 'agent-a'); });
    }
    expect((await exportNow()).agentChoices).toEqual([expect.objectContaining({ agentId: 'agent-a', telegramId: ID.alice, choice: 'reply_only' })]);
    expect((await request('requests', f.input('erasure'))).status).toBe(201);
    expect(await h.studio.deps.choices!.listForUser(ID.alice)).toEqual([]);
    expect(await h.studio.deps.choices!.listForUser(ID.bob)).toHaveLength(1);
  });

  it('an erasure request removes every S08 supersede notice naming the person, and only those', async () => {
    const { f, h, request } = await setup();
    const notices = new InMemorySupersededNoticeStore();
    h.studio.deps.memoryNotices = notices;
    const at = h.clock.now;
    const alice = personId(ID.alice), bob = personId(ID.bob), carol = 'tg-900';
    await notices.record({ personaId: 'agent-a', oldMemoryId: 'm1', newMemoryId: 'm2', ownerPersonId: alice, recipientPersonIds: [bob], at });
    await notices.record({ personaId: 'agent-a', oldMemoryId: 'm3', newMemoryId: 'm4', ownerPersonId: bob, recipientPersonIds: [alice, carol], at });
    await notices.record({ personaId: 'agent-a', oldMemoryId: 'm5', newMemoryId: 'm6', ownerPersonId: bob, recipientPersonIds: [carol], at });
    expect((await request('requests', f.input('erasure'))).status).toBe(201);
    expect(notices.notices.map((n) => n.oldMemoryId)).toEqual(['m5']);
  });

  it('circle participation (Circles S2): the export carries only the requester\'s rows, and erasure removes only theirs', async () => {
    const { f, h, request } = await setup();
    const exportNow = async () => {
      const row = (await (await request('requests', f.input('access_export'))).json()).request;
      return (await request(`requests/${row.requestId}/actions?space=work`, { version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' })).json();
    };
    expect(await exportNow()).not.toHaveProperty('circles');
    const chatId = -100999, ledger = h.studio.deps.circleLedger!;
    await ledger.open({ chatId, agentId: 'agent-a', openedBy: ID.alice, at: h.clock.now, card: { id: 'gcard', copyHash: 'a'.repeat(64), locale: 'en', noticeVersion: 'circle-v1' } });
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    for (const id of [ID.alice, ID.bob]) {
      await ledger.index(id, chatId);
      expect(await ledger.decide(chatId, { telegramId: id, choice: id === ID.alice ? 'joined' : 'declined', cardId: 'gcard', eventId: `cb-${id}`, at: h.clock.now, surface: 'group_card' })).toMatchObject({ ok: true });
    }
    const exported = await exportNow();
    expect(exported.circles).toEqual([expect.objectContaining({ chatId, state: 'joined', windows: [{ joinedAt: h.clock.now.toISOString() }] })]);
    expect(JSON.stringify(exported.circles)).not.toContain(String(ID.bob));
    expect((await request('requests', f.input('erasure'))).status).toBe(201);
    expect((await ledger.get(chatId))!.participants.map((p) => [p.telegramId, p.state])).toEqual([[ID.bob, 'declined']]);
  });
});
