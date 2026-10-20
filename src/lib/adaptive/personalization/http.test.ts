import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountIdFor } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { handleExperienceRequest } from '../runtime/http';
import { handleConversationRequest } from '../../studio/conversation';
import { signInitData } from '../../studio/auth';
import { hire, ID, makeStudio, seedOrg } from '../../studio/__tests__/helpers';
import { NOW, preferenceFixture } from './__tests__/fixtures';
const TOKEN = '123:synthetic-preferences';
const fixtures: Awaited<ReturnType<typeof preferenceFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
async function setup(file = true) {
  const h = makeStudio({ adaptive: false }), users = await seedOrg(h), { agent } = await hire(h, users.alice);
  const f = await preferenceFixture({ file, telegramId: ID.alice, agentId: agent.id }); fixtures.push(f);
  h.studio.deps.adaptive = f.adaptive; h.studio.deps.experience = f.experience;
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN);
  const request = (path: string, method = 'GET', body?: unknown, extras: Record<string, string> = {}) => handleExperienceRequest(h.studio, f.experience,
    new Request(`https://vox.synthetic/api/studio/experience/${path}`, { method, headers: { origin: 'https://vox.synthetic',
      'content-type': 'application/json', 'x-telegram-init-data': auth, ...extras }, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split('?')[0].split('/').filter(Boolean), TOKEN);
  const view = () => request(`preferences?space=work&agentId=${agent.id}`);
  return { h, f, agent, auth, request, view };
}
it('uses real authenticated handlers/file state for save, explanation and absence-preserving undo with no analytics consent', async () => {
  const { f, agent, request, view } = await setup();
  expect((await request(`preferences?agentId=${agent.id}`, 'GET', undefined, { 'x-telegram-init-data': '' })).status).toBe(401);
  const state = await (await view()).json();
  const input = { space: 'work', agentId: agent.id, setting: { key: 'response_length', value: 'brief' }, action: 'set', expectedRevision: state.revision, eventId: randomUUID() };
  expect((await request('preferences', 'PUT', input, { origin: 'https://hostile.invalid' })).status).toBe(403);
  expect((await request('preferences', 'PUT', { ...input, personId: 'someone-else' })).status).toBe(400);
  expect((await request('preferences', 'PUT', input)).status).toBe(200);
  const response = await view(), saved = await response.json(); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(saved.entries[0]).toMatchObject({ explanation: 'personalization_off', applied: false, saved: { setting: { value: 'brief' } }, undo: { restore: null } });
  const undo = { space: 'work', agentId: agent.id, expectedRevision: saved.revision, changeId: saved.entries[0].undo.changeId, eventId: randomUUID() };
  expect((await request('preferences/undo', 'POST', undo)).status).toBe(200);
  expect((await (await view()).json()).entries[0].saved).toBeUndefined();
  expect(await f.adaptive.withAccountDocument(f.telegramId, d => d.observer.events)).toEqual([]);
});
it('requires the exact space, agent and latest change and never accepts client-supplied restoration content', async () => {
  const { f, agent, request } = await setup(); const saved = await f.save({ key: 'response_length', value: 'brief' });
  const common = { space: 'work', agentId: agent.id, expectedRevision: saved.snapshot.revision, changeId: saved.input.eventId, eventId: randomUUID() };
  expect((await request('preferences/undo', 'POST', { ...common, previous: { value: 'detailed' } })).status).toBe(400);
  expect((await request('preferences/undo', 'POST', { ...common, space: 'personal' })).status).toBe(409);
  expect((await request('preferences/undo', 'POST', { ...common, agentId: 'other-agent' })).status).toBe(403);
  expect((await request('preferences/undo', 'POST', { ...common, expectedRevision: common.expectedRevision - 1 })).status).toBe(409);
  expect((await f.state()).entries[0].saved?.setting.value).toBe('brief');
});
it('suppresses saved explanations when Studio blocks an agent during awaited preference loading', async () => {
  const { h, f, agent, view } = await setup(); await f.save({ key: 'language', value: 'fa' });
  const read = f.experience.readPreferenceState.bind(f.experience);
  vi.spyOn(f.experience, 'readPreferenceState').mockImplementationOnce(async (...args) => {
    const result = await read(...args); await h.store.update(state => { state.agents.find(row => row.id === agent.id)!.blocked = [ID.alice]; }); return result;
  });
  const response = await view(); expect(response.status).toBe(403); expect(await response.text()).not.toContain('saved');
});
it('rejects a stale applied explanation after canonical withdrawal without erasing the saved choice', async () => {
  const { f, view } = await setup(); await f.grant(); await f.agent(); await f.save({ key: 'language', value: 'fa' });
  const read = f.experience.readPreferenceState.bind(f.experience);
  vi.spyOn(f.experience, 'readPreferenceState').mockImplementationOnce(async (...args) => {
    const result = await read(...args), privacy = await f.adaptive.read(f.telegramId, 'work');
    await f.adaptive.changeConsent(f.telegramId, { space: 'work', purpose: 'optional.personalization', state: 'withdrawn',
      expectedRevision: privacy.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID() });
    return result;
  });
  const response = await view(); expect(response.status).toBe(409); expect(await response.text()).not.toContain('saved');
  expect((await f.state()).entries.find(e => e.setting.key === 'language')).toMatchObject({ applied: false, explanation: 'personalization_off', saved: { setting: { value: 'fa' } } });
});
it('suppresses a preference view after canonical confirmation clears during the final awaited load', async () => {
  const { f, view } = await setup(); await f.save({ key: 'language', value: 'fa' });
  const read = f.experience.readPreferenceState.bind(f.experience);
  vi.spyOn(f.experience, 'readPreferenceState').mockImplementationOnce(async (...args) => {
    const result = await read(...args); await f.adaptive.withAccountDocument(f.telegramId, d => { delete d.binding; d.revision++; }); return result;
  });
  const response = await view(); expect(response.status).toBe(409); expect(await response.text()).not.toContain('saved');
});
it.each(['writer', 'partition', 'studio'] as const)('denies a final committed projection with a %s failure before serializing saved choices', async failure => {
  const { h, f, view } = await setup(); await f.save({ key: 'language', value: 'fa' });
  const read = f.experience.readPreferenceState.bind(f.experience);
  vi.spyOn(f.experience, 'readPreferenceState').mockImplementationOnce(async (...args) => {
    const result = await read(...args);
    const file = join(f.directory!, createHash('sha256').update(accountIdFor(f.telegramId)).digest('hex') + '.json');
    if (failure === 'writer') await mkdir(`${file}.lock`);
    else if (failure === 'partition') {
      const document = JSON.parse(await readFile(file, 'utf8')); document.accountId = 'telegram-account:999'; await writeFile(file, JSON.stringify(document));
    } else {
      const file = join(h.store.dir, 'studio.json'), document = JSON.parse(await readFile(file, 'utf8'));
      document.agents[0].visibility = 'invalid'; await writeFile(file, JSON.stringify(document));
    }
    return result;
  });
  const response = await view(); expect(response.status).toBe(failure === 'writer' ? 409 : failure === 'studio' ? 403 : 503);
  expect(await response.text()).not.toContain('saved');
});
it.each(['binding', 'permission', 'permission_without_grant', 'undo', 'capability', 'capability_expiry'] as const)('rechecks %s validity after synchronous Studio I/O, immediately before serialization', async expiry => {
  const { h, f, view } = await setup(); await f.grant(); if (expiry !== 'permission_without_grant') await f.agent(); await f.save({ key: 'language', value: 'fa' });
  const at = expiry === 'undo' ? (await f.state()).entries.find(e => e.setting.key === 'language')!.undo!.expiresAt - 1 : NOW + 1000;
  f.setNow(at);
  if (expiry === 'capability_expiry') f.expirePersonalizationAt(at + 1);
  if (expiry === 'binding' || expiry === 'permission' || expiry === 'permission_without_grant') await f.adaptive.withAccountDocument(f.telegramId, d => {
    if (expiry === 'binding') d.binding!.expiresAt = at + 1;
    else d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.expiresAt = at + 1;
  });
  const read = h.store.readCommittedForEffect.bind(h.store);
  vi.spyOn(h.store, 'readCommittedForEffect').mockImplementationOnce(() => {
    const committed = read();
    if (expiry === 'capability') f.denyPersonalization(); else f.setNow(at + 2);
    return committed;
  });
  const response = await view(); expect(response.status).toBe(409); expect(await response.text()).not.toContain('saved');
});
it('uses a fresh canonical clock after the canonical file read itself crosses a deadline', async () => {
  const { f, view } = await setup(); await f.save({ key: 'language', value: 'fa' });
  const at = (await f.state()).entries.find(e => e.setting.key === 'language')!.undo!.expiresAt - 1;
  f.setNow(at); const storage = f.adaptive.repository.storage as FileAdaptiveStorage, read = storage.readCommittedForEffect.bind(storage);
  vi.spyOn(storage, 'readCommittedForEffect').mockImplementationOnce(accountId => {
    const result = read(accountId); f.setNow(at + 2); return result;
  });
  const response = await view(); expect(response.status).toBe(409); expect(await response.text()).not.toContain('saved');
});
it('fails the detailed projection closed on unsupported storage while existing ordinary preference controls remain usable', async () => {
  const { f, agent, request, view } = await setup(false);
  const unavailable = await view(); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ error: 'preference_projection_unavailable' });
  const current = await f.experience.read(f.telegramId, 'work');
  expect((await request('preferences', 'PUT', { space: 'work', agentId: agent.id, action: 'set', setting: { key: 'language', value: 'fa' },
    expectedRevision: current.revision, eventId: randomUUID() })).status).toBe(200);
  expect((await (await request('?space=work')).json()).preferences[0].setting).toEqual({ key: 'language', value: 'fa' });
});
it('the actual conversation boundary receives resolved explicit settings and loses them after undo', async () => {
  const { h, f, agent, auth } = await setup(); await f.grant(); await f.agent();
  const saved = await f.save({ key: 'response_length', value: 'brief' });
  const speak = () => handleConversationRequest(h.studio, new Request('https://vox.synthetic/api/studio/conversation', { method: 'POST', headers: {
    origin: 'https://vox.synthetic', 'content-type': 'application/json', 'x-telegram-init-data': auth,
  }, body: JSON.stringify({ agentId: agent.id, space: 'work', text: 'Synthetic current request.' }) }), TOKEN);
  expect((await speak()).status).toBe(200);
  const exported = JSON.stringify(h.chatLLM.replyRequests.at(-1)); expect(exported).toContain('response_length'); expect(exported).toContain('brief');
  expect(exported).toContain('current user instructions take precedence'); expect(exported).toContain('Synthetic current request.');
  expect(exported).not.toContain('afterFingerprint'); expect(exported).not.toContain('changeId');
  const current = await f.state(); await f.experience.undoPreference(f.telegramId, { space: 'work', agentId: agent.id, expectedRevision: current.revision,
    changeId: saved.input.eventId, eventId: randomUUID() });
  expect((await speak()).status).toBe(200);
  expect(JSON.stringify(h.chatLLM.replyRequests.at(-1))).not.toContain('response_length');
});
