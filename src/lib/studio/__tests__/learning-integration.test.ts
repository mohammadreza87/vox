import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveObserverService } from '../../adaptive/observation/service';
import { AdaptiveLifecycleService } from '../../adaptive/lifecycle/service';
import { signInitData } from '../auth';
import { handleLearningRequest } from '../learning-http';
import { beginObservation } from '../observation';
import { handleAgentUpdate } from '../updates';
import { ID, hire, makeStudio, seedOrg } from './helpers';

const TOKEN = '12345:synthetic-learning-test';
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const h = makeStudio(); dirs.push(h.dir);
  const org = await seedOrg(h), { agent } = await hire(h, org.alice);
  const now = Date.now();
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic', enabledCapabilities: ['core_text', 'product_analytics'],
    accounts: [ID.alice, ID.bob, ID.superadmin].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'product_analytics'].map((capability, i) => ({ schemaVersion: 1, id: `test-${i}`, revision: 1, createdAt: now, updatedAt: now,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic', effectiveAt: now, reviewExpiresAt: now + 86_400_000,
      owner: 'synthetic', approvalReference: 'synthetic-only' })) });
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), adaptiveOptionsFromManifest(manifest));
  const observer = new AdaptiveObserverService(adaptive), lifecycle = new AdaptiveLifecycleService(adaptive);
  h.studio.deps.observer = observer; h.studio.deps.lifecycle = lifecycle;
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  const before = await adaptive.read(ID.alice, 'work');
  const shown = await adaptive.present(ID.alice, { space: 'work', purpose: 'optional.product_analytics', locale: 'en',
    expectedRevision: before.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID() });
  await adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.product_analytics', state: 'granted',
    expectedRevision: shown.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID(), receipt: shown.receipt });
  await adaptive.setAgentAccess(ID.alice, agent.id, { space: 'work', allowed: true,
    expectedRevision: (await adaptive.read(ID.alice, 'work')).revision, eventId: randomUUID() });
  const request = (path: string, method = 'GET', body?: unknown, options: { id?: number; auth?: string; origin?: string; raw?: string; contentType?: string } = {}) => {
    const headers = { 'x-telegram-init-data': options.auth ?? signInitData({ id: options.id ?? ID.alice, first_name: 'Synthetic' }, TOKEN),
      origin: options.origin ?? 'https://vox.test', 'content-type': options.contentType ?? 'application/json' };
    const req = new Request(`https://vox.test/api/studio/learning/${path}`, { method, headers,
      ...(body !== undefined || options.raw !== undefined ? { body: options.raw ?? JSON.stringify(body) } : {}) });
    return handleLearningRequest(h.studio, req, path.split('?')[0].split('/'), TOKEN);
  };
  return { h, org, agent, adaptive, observer, lifecycle, request };
}

describe('Studio observation producers and authenticated learning API', () => {
  it('preserves rollback-compatible account storage while observation is empty or withdrawn', async () => {
    const { h, agent, adaptive } = await setup();
    const raw = () => adaptive.repository.storage.transact(accountIdFor(ID.alice), document => ({ document, result: structuredClone(document) }));
    expect(await raw()).not.toHaveProperty('observer');
    const finish = await beginObservation(h.studio, ID.alice, agent.id, 'work', 'voice');
    await finish('responded'); expect(await raw()).toHaveProperty('observer');
    const current = await adaptive.read(ID.alice, 'work');
    await adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.product_analytics', state: 'withdrawn',
      expectedRevision: current.purposes.find(p => p.purpose === 'optional.product_analytics')!.revision, eventId: randomUUID() });
    expect(await raw()).not.toHaveProperty('observer');
    expect((await adaptive.read(ID.alice, 'work')).purposes.find(p => p.purpose === 'optional.product_analytics')!.state).toBe('withdrawn');
  });
  it('joins actual voice response and client playback while keeping task success unknown', async () => {
    const { h, org, agent, observer, request, adaptive } = await setup();
    const turn = await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm');
    expect(turn.turnId).toBeTypeOf('string');
    const client = { eventId: randomUUID(), space: 'work', agentId: agent.id, turnId: turn.turnId, outcome: 'playback_completed' };
    expect((await (await request('events', 'POST', client)).json()).recorded).toBe(true);
    expect((await (await request('events', 'POST', client)).json()).duplicate).toBe(true);
    const snapshot = await (await request('observations/process?space=work', 'POST', {})).json();
    expect(snapshot.projection).toMatchObject({ responseTurns: 1, responded: 1, playbackCompleted: 1, taskOutcomesUnknown: 1 });
    expect(snapshot.completeness.verifiedTaskSuccess).toBeNull();
    expect(JSON.stringify(await adaptive.withAccountDocument(ID.alice, d => d.observer))).not.toContain('hello there');
    expect((await observer.snapshot(ID.alice, 'personal')).projection.responseTurns).toBe(0);
    expect((await (await request('observations', 'GET', undefined, { id: ID.bob })).json()).projection.responseTurns).toBe(0);
    expect((await (await request('observations', 'GET', undefined, { id: ID.superadmin })).json()).projection.responseTurns).toBe(0);
  });
  it('does not create a correlation without analytics, and records failed and empty response outcomes truthfully', async () => {
    const { h, org, agent, observer } = await setup();
    expect((await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm', 'personal')).turnId).toBeUndefined();
    h.openai.transcribe.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_CANARY'));
    await expect(h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm')).rejects.toThrow('PRIVATE_PROVIDER_CANARY');
    h.openai.transcribe.mockResolvedValueOnce('');
    await h.studio.callTurn(org.alice, agent.id, new ArrayBuffer(8), 'audio/webm');
    await observer.process(ID.alice);
    const snapshot = await observer.snapshot(ID.alice, 'work');
    expect(snapshot.projection).toMatchObject({ failed: 1, unknownResponses: 1, responded: 0 });
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_PROVIDER_CANARY');
  });
  it('records private Telegram replies once and excludes duplicate delivery', async () => {
    const { h, agent, observer } = await setup();
    const update = { update_id: 701, message: { message_id: 701, date: 0, chat: { id: ID.alice, type: 'private' as const },
      from: { id: ID.alice, first_name: 'Synthetic', is_bot: false }, text: 'PRIVATE_TELEGRAM_CANARY' } };
    await handleAgentUpdate(h.studio, agent.id, update);
    await handleAgentUpdate(h.studio, agent.id, update);
    await observer.process(ID.alice);
    expect((await observer.snapshot(ID.alice, 'work')).projection).toMatchObject({ responded: 1, responseTurns: 1 });
  });
  it('does not record after access revocation and hides measurements for subsequently blocked agents', async () => {
    const { h, agent, observer, request } = await setup();
    const finish = await beginObservation(h.studio, ID.alice, agent.id, 'work', 'voice');
    await finish('responded'); await observer.process(ID.alice);
    await h.store.update(s => { s.agents.find(a => a.id === agent.id)!.blocked = [ID.alice]; });
    expect(await finish('failed')).toBeUndefined();
    const snapshot = await (await request('observations')).json();
    expect(snapshot.projection.responseTurns).toBe(0);
    expect((await request('events', 'POST', { eventId: 'e', space: 'work', agentId: agent.id, turnId: 't', outcome: 'playback_started' })).status).toBe(403);
  });
  it('enforces signed identity, bounded bodies, origin, strict trust and correlation', async () => {
    const { request, agent } = await setup();
    expect((await request('observations', 'GET', undefined, { auth: '' })).status).toBe(401);
    expect((await request('observations', 'GET', undefined, { id: ID.pending })).status).toBe(403);
    const body = { eventId: 'e', space: 'work', agentId: agent.id, turnId: 'invented', outcome: 'playback_completed' };
    expect((await request('events', 'POST', body, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await request('events', 'POST', body, { contentType: 'text/plain' })).status).toBe(415);
    expect((await request('events', 'POST', undefined, { raw: 'x'.repeat(16_385) })).status).toBe(413);
    expect((await request('events', 'POST', { ...body, trust: 'server', personId: 'victim' })).status).toBe(400);
    expect((await (await request('events', 'POST', body)).json()).recorded).toBe(false);
  });
  it('exports only the confirmed own space and protects operations with fresh role checks', async () => {
    const { h, adaptive, request } = await setup();
    for (const space of ['work', 'personal'] as const) await adaptive.withAccountDocument(ID.alice, d => { d.memories.push({ id: `memory-${space}`, space,
      revision: 1, text: `PRIVATE_${space}`, status: 'active', createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 60_000, revocationEpoch: 0 }); });
    const exported = await request('export?space=work');
    expect(exported.headers.get('cache-control')).toBe('no-store');
    expect(exported.headers.get('content-disposition')).toContain('vox-work-export.json');
    const body = await exported.text(); expect(body).toContain('PRIVATE_work'); expect(body).not.toContain('PRIVATE_personal');
    expect((await request('export', 'GET', undefined, { id: ID.bob })).status).toBe(403);
    expect((await request('operations')).status).toBe(403);
    expect((await request('operations', 'GET', undefined, { id: ID.superadmin })).status).toBe(200);
    h.studio.deps.improvement = { report: vi.fn(async () => {
      await h.store.update(s => { s.members.find(m => m.telegramId === ID.superadmin)!.role = 'member'; });
      return {} as never;
    }) };
    expect((await request('operations', 'GET', undefined, { id: ID.superadmin })).status).toBe(409);
  });
});
