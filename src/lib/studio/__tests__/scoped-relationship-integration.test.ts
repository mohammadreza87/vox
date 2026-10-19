import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveRepository, accountIdFor, type OptionalPurpose, type SpaceKind } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveRelationshipService } from '../../adaptive/relationships/service';
import { InMemoryRelationshipStore, RelationshipLoop } from '../../relationships';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const options = { botToken: '123:synthetic-manager', devUser: null };
async function setup() {
  const h = makeStudio(); dirs.push(h.dir);
  const users = await seedOrg(h), hired = await hire(h, users.alice);
  await h.store.update(s => { s.members.find(m => m.telegramId === ID.alice)!.role = 'owner'; });
  const start = h.clock.now.getTime(), capabilities = ['core_text', 'personalization', 'auto_memory', 'proactive_suggestions', 'relationship_outreach'];
  const manifest = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-only', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(ID.alice), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, index) => ({ schemaVersion: 1, id: `approval-${index}`, revision: 1, createdAt: start, updatedAt: start,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-only', effectiveAt: start,
      reviewExpiresAt: start + 100 * 86400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), { ...manifest, scopedRelationshipsEnabled: true, now: () => h.clock.now.getTime() });
  const authority = new AdaptiveRelationshipService(adaptive), store = new InMemoryRelationshipStore();
  const assess = vi.fn(async ({ text }: { text: string }) => ({ preferences: [{ key: 'style', value: text.includes('PERSONAL') ? 'PERSONAL_CANARY' : 'WORK_CANARY' }],
    situations: [{ topic: 'boss', summary: 'An ongoing discussion', status: 'open' as const }],
    followUp: { topic: 'boss', purpose: 'How is the discussion going?', dueAt: new Date(h.clock.now.getTime() + 86400_000).toISOString(), timing: { kind: 'ongoing' as const, evidenceQuote: text } } }));
  const loop = new RelationshipLoop({ store, mode: 'live', now: () => h.clock.now, applyScopedControl: async (key, action, until) => { await authority.control(ID.alice, key.personaId, key.scope!.space, action, until?.getTime()); await loop.control(key, action, { until }); }, assessor: { assess }, decisions: { choose: async () => 'send' },
    authorize: async input => await h.studio.relationshipCohortEnabled(input.key.personaId, ID.alice) ? authority.authorize(input.key, input.sourceIds, input.phase, input.expectedFingerprint) : null });
  Object.assign(h.studio.deps, { adaptive, relationshipAuthority: authority, relationships: loop, relationshipStore: store,
    relationshipConfig: { mode: 'live', agentIds: ['*'], personIds: [], roles: ['owner', 'superadmin'] } });
  adaptive.setRelationshipInvalidator(async input => { for (const key of await store.keysForAccount(accountIdFor(input.telegramId)))
    if (key.scope?.space === input.space && (!input.agentId || input.agentId === key.personaId)) await loop.invalidate(key, { sourceIds: input.sourceIds, reason: input.reason }); });
  async function enroll(space: SpaceKind) {
    await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
    for (const purpose of ['optional.auto_memory', 'optional.personalization', 'optional.proactive_suggestions'] as OptionalPurpose[]) {
      const initial = await adaptive.read(ID.alice, space);
      const shown = await adaptive.present(ID.alice, { space, purpose, locale: 'en', expectedRevision: initial.purposes.find(p => p.purpose === purpose)!.revision, eventId: randomUUID(), deliberateReopen: true });
      await adaptive.changeConsent(ID.alice, { space, purpose, state: 'granted', expectedRevision: shown.purposes.find(p => p.purpose === purpose)!.revision, receipt: shown.receipt, eventId: randomUUID() });
    }
    await adaptive.setAgentAccess(ID.alice, hired.agent.id, { space, allowed: true, expectedRevision: (await adaptive.read(ID.alice, space)).revision, eventId: randomUUID() });
    await adaptive.withAccountDocument(ID.alice, d => { d.experience.settings.timezone = 'UTC'; d.experience.settings.quietStartHour = 0; d.experience.settings.quietEndHour = 0; d.experience.settings[space] = { inboxEnabled: true, proactiveEnabled: true, reminderEnabled: false }; });
  }
  let sequence = 1000;
  const turn = (text: string) => handleAgentUpdate(h.studio, hired.agent.id, { update_id: sequence++, message: { message_id: sequence++, date: Math.floor(h.clock.now.getTime() / 1000), chat: { id: ID.alice, type: 'private' }, from: { id: ID.alice, first_name: 'Synthetic', is_bot: false }, text } });
  async function api(method: string, body?: unknown, space = 'work', user = ID.alice) {
    const path = ['agents', hired.agent.id, 'relationship'];
    const request = new Request(`https://vox.example/api/studio/${path.join('/')}?space=${space}`, { method,
      headers: { 'x-telegram-init-data': signInitData({ id: user, first_name: 'Synthetic' }, options.botToken), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return handleStudioRequest(h.studio, request, path, options);
  }
  return { h, users, hired, adaptive, authority, loop, store, assess, enroll, turn, api };
}

describe('scoped relationship authenticated integration', () => {
  it('routes Telegram to Work and calls to Personal without legacy history or cross-space context', async () => {
    const x = await setup(); await x.enroll('work'); await x.enroll('personal');
    await x.turn('My WORK discussion with my boss is ongoing.');
    expect(x.assess).toHaveBeenCalledOnce(); expect(JSON.stringify(x.h.chatLLM.replyRequests.at(-1))).toContain('WORK_CANARY');
    const { gateway } = await x.h.studio.gateway();
    await gateway.converse(x.hired.agent.id, `tg-${ID.alice}`, 'My PERSONAL discussion is ongoing.', { space: 'personal' });
    expect(x.assess).toHaveBeenCalledTimes(2); expect(JSON.stringify(x.h.chatLLM.replyRequests.at(-1))).toContain('PERSONAL_CANARY');
    expect(JSON.stringify(x.h.chatLLM.replyRequests.at(-1))).not.toContain('WORK_CANARY');
    expect(await x.h.memory.history.recent(x.hired.agent.id, `private-tg-${ID.alice}`, 50)).toEqual([]);
    const keys = await x.store.keysForAccount(accountIdFor(ID.alice)); expect(keys.map(k => k.scope?.space).sort()).toEqual(['personal', 'work']);
    const response = await x.api('GET', undefined, 'personal');
    const { relationship } = await response.json(); expect(relationship).toMatchObject({ available: true, space: 'personal', externalEnabled: false });
    expect(JSON.stringify(relationship)).not.toContain('WORK_CANARY');
  });
  it('hides relationship context from foreground chat when profile confirmation expires', async () => {
    const x = await setup(); await x.enroll('work'); await x.turn('An ongoing WORK discussion.');
    expect(JSON.stringify(x.h.chatLLM.replyRequests.at(-1))).toContain('WORK_CANARY');
    x.h.advanceDays(1); await x.turn('Tell me what you remember.');
    expect(JSON.stringify(x.h.chatLLM.replyRequests.at(-1))).not.toContain('WORK_CANARY');
    expect(x.assess).toHaveBeenCalledOnce();
    expect((await (await x.api('GET')).json()).relationship.inbox).toEqual([]);
  });
  it('does not save explicitly off-record English or Persian turns', async () => {
    const x = await setup(); await x.enroll('work');
    await x.turn("Don't remember this: SECRET_OFF_RECORD"); await x.turn('این مطلب را ذخیره نکن SECRET_FA');
    expect(x.assess).not.toHaveBeenCalled();
    expect(await x.adaptive.withAccountDocument(ID.alice, d => d.relationships.sources)).toEqual([]);
  });
  it('persists Telegram stop before enrollment and permits protective API controls when disabled', async () => {
    const x = await setup(); x.loop.deps.mode = 'off';
    await x.turn('/stop');
    expect((await (await x.api('GET')).json()).relationship).toMatchObject({ disabled: true, available: false });
    await x.enroll('work'); x.loop.deps.mode = 'live'; await x.turn('A discussion is ongoing.'); expect(x.assess).not.toHaveBeenCalled();
    expect((await x.api('PUT', { action: 'resume', space: 'work' })).status).toBe(200);
    await x.turn('A new discussion is ongoing.'); expect(x.assess).toHaveBeenCalledOnce();
    hTimeAdvance(x, 31); x.loop.deps.mode = 'off';
    expect((await x.api('PUT', { action: 'stop', space: 'work' })).status).toBe(200);
    expect((await x.api('PUT', { action: 'forget', space: 'work' })).status).toBe(200);
    expect((await (await x.api('GET')).json()).relationship.disabled).toBe(true);
  });
  it('deletes only the signed actor and selected space source and rejects invalid spaces', async () => {
    const x = await setup(); await x.enroll('work'); await x.enroll('personal'); await x.turn('My work discussion is ongoing.');
    const { gateway } = await x.h.studio.gateway(); await gateway.converse(x.hired.agent.id, `tg-${ID.alice}`, 'PERSONAL ongoing discussion', { space: 'personal' });
    const work = (await (await x.api('GET')).json()).relationship.sources[0];
    expect((await x.api('PUT', { action: 'source-delete', space: 'personal', sourceId: work.id })).status).toBe(200);
    expect((await (await x.api('GET')).json()).relationship.sources).toHaveLength(1);
    await x.api('PUT', { action: 'source-delete', space: 'work', sourceId: work.id });
    expect((await (await x.api('GET')).json()).relationship.sources).toEqual([]);
    expect((await (await x.api('GET', undefined, 'personal')).json()).relationship.sources).toHaveLength(1);
    expect((await x.api('GET', undefined, 'unknown')).status).toBe(400);
    expect((await x.api('PUT', { action: 'stop', space: 'unknown' })).status).toBe(400);
    const other = await x.api('GET', undefined, 'work', ID.bob);
    expect(JSON.stringify(await other.json())).not.toMatch(/CANARY|telegram-account|profile-/);
  });
  it('current role demotion suppresses observation on an already-created gateway', async () => {
    const x = await setup(); await x.enroll('personal');
    const { gateway } = await x.h.studio.gateway();
    await x.h.store.update(s => { s.members.find(m => m.telegramId === ID.alice)!.role = 'member'; });
    await gateway.converse(x.hired.agent.id, `tg-${ID.alice}`, 'PERSONAL ongoing discussion', { space: 'personal' });
    expect(x.assess).not.toHaveBeenCalled();
    expect((await x.h.studio.relationshipFor(x.users.alice, x.hired.agent.id, 'personal')).available).toBe(false);
  });
});
function hTimeAdvance(x: Awaited<ReturnType<typeof setup>>, days: number) { x.h.advanceDays(days); }
