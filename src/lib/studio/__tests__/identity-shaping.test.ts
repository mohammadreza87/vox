/**
 * Settings v2 product rules, enforced on the server:
 *  - an agent's voice and skills change only in Vox Studio, only by its creator, only while it forms
 *    (draft, awaiting_bot, or active before the 7-day lock); admins and superadmins never;
 *  - no agent-signed, pet or bot path changes them;
 *  - manager toggles are refused on a retired agent, which managers can still read.
 */
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { canManageSettings, canShapeIdentity, formingDaysLeft } from '../permissions';
import { handlePetRequest } from '../pet-http';
import { StudioError } from '../service';
import type { Agent } from '../types';
import { draftJson, fakeMember, hire, ID, makeStudio, personaSpec, seedOrg, T0, type Harness } from './helpers';

const DAY = 86_400_000;
const BOT_TOKEN = '555:fixture-identity-token';

async function expectStudioError(p: Promise<unknown>, status: number, message?: RegExp) {
  const error = await p.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(StudioError);
  expect((error as StudioError).status).toBe(status);
  if (message) expect((error as StudioError).message).toMatch(message);
}

function agent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 'ag1', status: 'active', persona: personaSpec(),
    look: { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: false } },
    createdBy: ID.alice, createdAt: T0.toISOString(), hiredAt: T0.toISOString(), lockAt: new Date(T0.getTime() + 7 * DAY).toISOString(),
    isAdmin: false, access: 'everyone', identityVersion: 1, ...partial,
  };
}

describe('canShapeIdentity (pure rule)', () => {
  const alice = fakeMember(ID.alice, 'member');
  const bob = fakeMember(ID.bob, 'member');
  const admin = fakeMember(ID.admin, 'admin');
  const sa = fakeMember(ID.superadmin, 'superadmin');
  const owner = fakeMember(ID.superadmin, 'owner');
  const forming = new Date(T0.getTime() + 3 * DAY);
  const locked = new Date(T0.getTime() + 7 * DAY);

  it('lets the creator shape a draft, an agent waiting for its bot and an active agent before the lock', () => {
    expect(canShapeIdentity(alice, agent({ status: 'draft', hiredAt: undefined, lockAt: undefined }), forming)).toBe(true);
    expect(canShapeIdentity(alice, agent({ status: 'awaiting_bot', hiredAt: undefined, lockAt: undefined }), forming)).toBe(true);
    expect(canShapeIdentity(alice, agent(), forming)).toBe(true);
    expect(canShapeIdentity(alice, agent(), new Date(locked.getTime() - 1))).toBe(true);
  });

  it('refuses after the lock, on a retired agent, and for a pending creator', () => {
    expect(canShapeIdentity(alice, agent(), locked)).toBe(false);
    expect(canShapeIdentity(alice, agent({ status: 'fired' }), forming)).toBe(false);
    expect(canShapeIdentity(fakeMember(ID.alice, 'pending'), agent(), forming)).toBe(false);
    expect(canShapeIdentity(undefined, agent(), forming)).toBe(false);
  });

  it('never lets anyone but the creator shape it: not members, admins, superadmins or owners', () => {
    for (const m of [bob, admin, sa, owner]) {
      for (const status of ['draft', 'awaiting_bot', 'active'] as const) expect(canShapeIdentity(m, agent({ status }), forming)).toBe(false);
    }
  });

  it('counts whole forming days left, rounded up, only for an active agent before the lock', () => {
    expect(formingDaysLeft(agent(), T0)).toBe(7);
    expect(formingDaysLeft(agent(), new Date(T0.getTime() + 6.5 * DAY))).toBe(1);
    expect(formingDaysLeft(agent(), locked)).toBeNull();
    expect(formingDaysLeft(agent({ status: 'draft' }), T0)).toBeNull();
  });

  it('canManageSettings: managers of an agent that is not retired', () => {
    expect(canManageSettings(alice, agent())).toBe(true);
    expect(canManageSettings(admin, agent())).toBe(true);
    expect(canManageSettings(bob, agent())).toBe(false);
    for (const m of [alice, admin, sa]) expect(canManageSettings(m, agent({ status: 'fired' }))).toBe(false);
  });
});

describe('voice and skills on the server', () => {
  let h: Harness;
  let org: Awaited<ReturnType<typeof seedOrg>>;
  beforeEach(async () => { h = makeStudio(); org = await seedOrg(h); });
  afterEach(() => { rmSync(h.dir, { recursive: true, force: true }); });

  async function request(method: string, path: string, body?: unknown, userId = ID.alice, token = BOT_TOKEN) {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ id: userId, first_name: 'Fixture' }, token) };
    const response = await handleStudioRequest(h.studio, new Request(`https://fixture.invalid/api/studio/${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), path.split('/'), { botToken: BOT_TOKEN, devUser: null });
    return { status: response.status, body: await response.json() };
  }
  const stored = async (id: string) => (await h.store.read()).agents.find((a) => a.id === id)!;
  const audit = async (action: string) => (await h.store.read()).audit.filter((e) => e.action === action);

  it('every voice route lets the creator change the voice while the agent forms, and bumps its identity version', async () => {
    const { agent: a } = await hire(h, org.alice);
    h.advanceDays(3);
    const design = await request('POST', `agents/${a.id}/voice`, { action: 'design', description: 'A warm low voice with a light Tehran accent' });
    expect(design.status).toBe(200);
    expect(design.body.agent.voicePreviews).toHaveLength(3);
    expect(design.body.agent).toMatchObject({ canShapeIdentity: true, formingDaysLeft: 4 });
    expect((await request('POST', `agents/${a.id}/voice`, { action: 'choose-design', generatedVoiceId: 'gen-1' })).status).toBe(200);
    expect((await request('POST', `agents/${a.id}/voice`, { action: 'choose-default', voiceId: 'fixture-sarah' })).status).toBe(200);
    const library = await request('POST', `agents/${a.id}/voice`, { action: 'choose-library', publicOwnerId: 'o1', voiceId: 'v1', name: 'Sam' });
    expect(library.status).toBe(200);
    expect(library.body.agent.voice).toEqual({ label: 'Sam · voice library', source: 'library', choiceId: 'v1' });
    // design brief (1) + three voice choices (3)
    expect((await stored(a.id)).identityVersion).toBe(5);
    // Audit rows are content-free: where the voice came from, never its name or the brief.
    expect((await audit('agent.voice')).map((e) => [e.actor, e.target, e.detail])).toEqual([
      [ID.alice, a.id, 'design'], [ID.alice, a.id, 'default'], [ID.alice, a.id, 'library'],
    ]);
  });

  it('refuses admins, superadmins and other members on every voice route, before any provider call', async () => {
    const { agent: a } = await hire(h, org.alice);
    const before = await stored(a.id);
    h.eleven.getVoiceOptions.mockClear(); h.eleven.designVoices.mockClear();
    for (const userId of [ID.admin, ID.superadmin, ID.bob]) {
      for (const body of [{ action: 'design', description: 'A different voice for this agent' }, { action: 'choose-design', generatedVoiceId: 'gen-1' },
        { action: 'choose-default', voiceId: 'fixture-sarah' }, { action: 'choose-library', publicOwnerId: 'o', voiceId: 'v', name: 'n' }]) {
        expect((await request('POST', `agents/${a.id}/voice`, body, userId)).status).toBe(403);
      }
    }
    expect(h.eleven.getVoiceOptions).not.toHaveBeenCalled();
    expect(h.eleven.designVoices).not.toHaveBeenCalled();
    expect(await stored(a.id)).toEqual(before);
  });

  it('refuses the creator once the agent is formed, on every voice route', async () => {
    const { agent: a } = await hire(h, org.alice);
    await h.studio.designVoices(org.alice, a.id, 'Calm alto, 30s');
    h.advanceDays(7);
    for (const body of [{ action: 'design' }, { action: 'choose-design', generatedVoiceId: 'gen-1' },
      { action: 'choose-default', voiceId: 'fixture-sarah' }, { action: 'choose-library', publicOwnerId: 'o', voiceId: 'v', name: 'n' }]) {
      const r = await request('POST', `agents/${a.id}/voice`, body);
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/Nova is formed/);
    }
    const view = await h.studio.getAgent(org.alice, a.id);
    expect(view).toMatchObject({ canShapeIdentity: false, formingDaysLeft: null, locked: true });
    expect(view.voicePreviews).toBeUndefined();
  });

  it('lets the creator choose a voice while the agent waits for its bot, and refuses a retired agent', async () => {
    h.personaLLM.push(draftJson());
    const { agent: d } = await h.studio.draft(org.alice, {});
    await h.studio.publish(org.alice, d.id);
    expect((await h.studio.chooseDefaultVoice(org.alice, d.id, 'fixture-sarah')).voice?.source).toBe('default');
    await expectStudioError(h.studio.chooseDefaultVoice(org.admin, d.id, 'fixture-sarah'), 403, /Only the person who created/);

    const { agent: a } = await hire(h, org.alice);
    await h.studio.fire(org.admin, a.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' });
    await expectStudioError(h.studio.chooseDefaultVoice(org.alice, a.id, 'fixture-sarah'), 403, /retired/);
  });

  it('skills (and role) change only by the creator while forming; other persona fields keep canEditPersona', async () => {
    const { agent: a } = await hire(h, org.alice);
    const ok = await request('PATCH', `agents/${a.id}`, { persona: { skillIds: ['core.decision-memo'] } });
    expect(ok.status).toBe(200);
    expect(ok.body.agent.persona.skillIds).toEqual(['core.decision-memo']);
    expect((await stored(a.id)).identityVersion).toBe(2);
    expect((await audit('agent.skills')).map((e) => [e.actor, e.target, e.detail])).toEqual([[ID.alice, a.id, '1']]);

    // An admin may still edit the personality of a forming agent, but not its skills or role.
    expect((await request('PATCH', `agents/${a.id}`, { persona: { tagline: 'Sharper' } }, ID.admin)).status).toBe(200);
    expect((await request('PATCH', `agents/${a.id}`, { persona: { skillIds: [] } }, ID.admin)).status).toBe(403);
    expect((await request('PATCH', `agents/${a.id}`, { persona: { roleId: 'mobile.ua-manager' } }, ID.superadmin)).status).toBe(403);
    // Sending the unchanged list is not a change.
    expect((await request('PATCH', `agents/${a.id}`, { persona: { tagline: 'Again', skillIds: ['core.decision-memo'] } }, ID.admin)).status).toBe(200);
    expect((await stored(a.id)).persona.skillIds).toEqual(['core.decision-memo']);

    h.advanceDays(7);
    expect((await request('PATCH', `agents/${a.id}`, { persona: { skillIds: [] } })).status).toBe(403);
    expect((await stored(a.id)).persona.skillIds).toEqual(['core.decision-memo']);
  });

  it('admins edit a draft or an agent waiting for its bot, but never its skills or role', async () => {
    h.personaLLM.push(draftJson());
    const { agent: d } = await h.studio.draft(org.alice, {});
    for (const status of ['draft', 'awaiting_bot'] as const) {
      if (status === 'awaiting_bot') await h.studio.publish(org.alice, d.id);
      expect((await stored(d.id)).status).toBe(status);
      expect((await request('PATCH', `agents/${d.id}`, { persona: { tagline: `Admin ${status}` } }, ID.admin)).status).toBe(200);
      expect((await request('PATCH', `agents/${d.id}`, { persona: { skillIds: ['core.decision-memo'] } }, ID.admin)).status).toBe(403);
      expect((await request('PATCH', `agents/${d.id}`, { persona: { roleId: 'mobile.ua-manager' } }, ID.superadmin)).status).toBe(403);
      expect((await request('PATCH', `agents/${d.id}`, { persona: { skillIds: ['core.decision-memo'] } })).status).toBe(200);
      await h.store.update((s) => { s.agents.find((x) => x.id === d.id)!.persona.skillIds = []; });
    }
  });

  it('lets the creator design voices while the agent waits for its bot; admins still cannot', async () => {
    h.personaLLM.push(draftJson());
    const { agent: d } = await h.studio.draft(org.alice, {});
    await h.studio.publish(org.alice, d.id);
    expect((await stored(d.id)).status).toBe('awaiting_bot');
    const designed = await request('POST', `agents/${d.id}/voice`, { action: 'design', description: 'A bright quick voice' });
    expect(designed.status).toBe(200);
    expect(designed.body.agent.voicePreviews).toHaveLength(3);
    expect((await request('POST', `agents/${d.id}/voice`, { action: 'design' }, ID.admin)).status).toBe(403);
  });

  it('with no chosen voice, presentation picks the voice everyone hears: only the creator moves it, audited', async () => {
    const { agent: a } = await hire(h, org.alice);
    expect((await stored(a.id)).voice).toBeUndefined();
    const before = (await stored(a.id)).persona.presentation;
    const other = before === 'masculine' ? 'feminine' : 'masculine';
    for (const userId of [ID.admin, ID.superadmin]) {
      const r = await request('PATCH', `agents/${a.id}`, { persona: { presentation: other } }, userId);
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/Only the person who created/);
    }
    expect((await stored(a.id)).persona.presentation).toBe(before);
    // An admin's refine that rewrites presentation keeps the stored one (and so the voice).
    h.personaLLM.push(JSON.stringify({ ...personaSpec(), presentation: other, tagline: 'Refined by an admin' }));
    const refined = await h.studio.refine(org.admin, a.id, 'Sound more confident');
    expect(refined.persona).toMatchObject({ presentation: before, tagline: 'Refined by an admin' });
    expect(await audit('agent.voice')).toEqual([]);
    // The creator, while forming, may: that is a voice change, audited content-free.
    expect((await request('PATCH', `agents/${a.id}`, { persona: { presentation: other } })).status).toBe(200);
    expect((await audit('agent.voice')).map((e) => [e.actor, e.target, e.detail])).toEqual([[ID.alice, a.id, 'presentation']]);
    // Once a voice is chosen, presentation no longer picks it: admins edit it like any persona field.
    await h.studio.chooseDefaultVoice(org.alice, a.id, 'fixture-sarah');
    expect((await request('PATCH', `agents/${a.id}`, { persona: { presentation: before } }, ID.admin)).status).toBe(200);
  });

  it('a stale persona write cannot revert the creator\'s newer skills', async () => {
    const { agent: a } = await hire(h, org.alice);
    // An admin's refine reads the persona, then waits on the LLM while the creator saves new skills.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const llm = h.personaLLM;
    const original = llm.complete.bind(llm);
    llm.complete = async (...args: Parameters<typeof llm.complete>) => { await gate; return original(...args); };
    h.personaLLM.push(JSON.stringify({ ...personaSpec(), tagline: 'Slow refine' }));
    const slow = h.studio.refine(org.admin, a.id, 'Warmer');
    await new Promise((r) => setTimeout(r, 10));
    await h.studio.updatePersona(org.alice, a.id, { skillIds: ['core.decision-memo'] });
    release();
    const view = await slow;
    expect(view.persona.tagline).toBe('Slow refine');
    expect((await stored(a.id)).persona.skillIds).toEqual(['core.decision-memo']);
    // Same for a plain PATCH built from an older read.
    await h.studio.updatePersona(org.admin, a.id, { tagline: 'Later' });
    expect((await stored(a.id)).persona.skillIds).toEqual(['core.decision-memo']);
  });

  it('choosing the voice already in use changes nothing: no provider call, audit row or identity bump', async () => {
    const { agent: a } = await hire(h, org.alice);
    await h.studio.chooseLibraryVoice(org.alice, a.id, { publicOwnerId: 'o1', voiceId: 'v1', name: 'Sam' });
    const version = (await stored(a.id)).identityVersion;
    h.eleven.addLibraryVoice.mockClear();
    await h.studio.chooseLibraryVoice(org.alice, a.id, { publicOwnerId: 'o1', voiceId: 'v1', name: 'Sam' });
    expect(h.eleven.addLibraryVoice).not.toHaveBeenCalled();
    await h.studio.chooseDefaultVoice(org.alice, a.id, 'fixture-sarah');
    const afterDefault = (await stored(a.id)).identityVersion;
    await h.studio.chooseDefaultVoice(org.alice, a.id, 'fixture-sarah');
    expect((await stored(a.id)).identityVersion).toBe(afterDefault);
    expect(afterDefault).toBe(version + 1);
    expect((await audit('agent.voice')).map((e) => e.detail)).toEqual(['library', 'default']);
  });

  it('only manager-signed Studio requests reach the voice and skills routes: agent-signed initData is refused', async () => {
    const { agent: a, token } = await hire(h, org.alice);
    const before = await stored(a.id);
    expect((await request('POST', `agents/${a.id}/voice`, { action: 'choose-default', voiceId: 'fixture-sarah' }, ID.alice, token)).status).toBe(401);
    expect((await request('PATCH', `agents/${a.id}`, { persona: { skillIds: [] } }, ID.alice, token)).status).toBe(401);
    expect(await stored(a.id)).toEqual(before);
  });

  it('the pet (agent-signed) route has no voice, skills or persona action, and its writes never touch them', async () => {
    const ORIGIN = 'https://vox.example';
    h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
    const { agent: a, token } = await hire(h, org.alice);
    const identity = async () => { const x = await stored(a.id); return { voice: x.voice, persona: x.persona, identityVersion: x.identityVersion }; };
    const before = await identity();
    const initData = signInitData({ id: ID.alice, first_name: 'Alice' }, token);
    const smuggled = { action: 'feed', voiceId: 'fixture-sarah', voice: { voiceId: 'x' }, persona: { skillIds: [], presentation: 'masculine' }, skillIds: [] };
    // A trusted origin and valid agent-signed initData, so only the router itself can refuse.
    const pet = (method: string, path: string[], body: unknown = smuggled) => handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${a.id}${path.length ? `/${path.join('/')}` : ''}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'UTC', 'x-telegram-init-data': initData },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }), a.id, path, BOT_TOKEN);
    for (const [method, path] of [['POST', ['voice']], ['PUT', ['voice']], ['PATCH', []], ['POST', []], ['POST', ['skills']], ['PUT', ['persona']],
      ['POST', ['persona']], ['GET', ['voice']], ['GET', ['skills']]] as const) {
      const response = await pet(method, [...path]);
      // Unknown to the pet router: not a refused route that a later change could open.
      expect([method, path.join('/'), response.status, (await response.json()).error]).toEqual([method, path.join('/'), 404, 'pet_unavailable']);
    }
    // A write the pet does accept is strict: voice, skills or persona fields in its body are refused outright.
    expect((await pet('POST', ['care'])).status).toBe(400);
    expect((await pet('POST', ['care'], { action: 'feed' })).status).toBe(200);
    expect(await identity()).toEqual(before);
  });

  it('manager toggles are refused on a retired agent; managers can still read its settings', async () => {
    const { agent: a } = await hire(h, org.alice);
    await h.store.update((s) => { s.agents.find((x) => x.id === a.id)!.blocked = [ID.stranger]; });
    await h.studio.fire(org.admin, a.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Nova' });
    for (const actor of [org.alice, org.admin, org.superadmin]) {
      await expectStudioError(h.studio.setLiveWeb(actor, a.id, false), 403, /retired/);
      await expectStudioError(h.studio.setVisibility(actor, a.id, 'public'), 403, /retired/);
      await expectStudioError(h.studio.setAccess(actor, a.id, [ID.bob]), 403, /retired/);
      await expectStudioError(h.studio.setGroupBehavior(actor, a.id, { participation: 'active', remember: false }), 403, /retired/);
      await expectStudioError(h.studio.setMainMiniApp(actor, a.id, true), 403, /retired/);
      await expectStudioError(h.studio.unblock(actor, a.id, ID.stranger), 403, /retired/);
    }
    // Not a manager: a plain 403 that says nothing about the agent.
    await expectStudioError(h.studio.setLiveWeb(org.bob, a.id, false), 403);
    const view = await h.studio.getAgent(org.admin, a.id);
    expect(view).toMatchObject({ status: 'fired', canManageAccess: true, canManageSettings: false, blocked: [ID.stranger], liveWeb: true });
  });
});

describe('no other server path changes voice or skills', () => {
  const ROOT = join(__dirname, '..', '..', '..');
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') out.push(...sources(path)); }
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
    }
    return out;
  }

  it('only the manager-signed Studio router calls the voice and persona writers', () => {
    const callers = new Set<string>();
    for (const file of [...sources(join(ROOT, 'lib')), ...sources(join(ROOT, 'app', 'api'))]) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(\w+)\.(designVoices|chooseDesignedVoice|chooseDefaultVoice|chooseLibraryVoice|updatePersona)\(/g)) {
        if (m[1] !== 'eleven') callers.add(relative(ROOT, file));   // eleven.designVoices is the provider client
      }
    }
    expect([...callers]).toEqual([join('lib', 'studio', 'http.ts')]);
  });

  it('the pet and connect Mini Apps never reference them', () => {
    for (const dir of ['pet', 'connect']) {
      for (const file of sources(join(ROOT, 'app', 'studio', dir))) {
        expect(readFileSync(file, 'utf8')).not.toMatch(/designVoices|chooseDesignedVoice|chooseDefaultVoice|chooseLibraryVoice|updatePersona/);
      }
    }
  });
});
