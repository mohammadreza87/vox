import { describe, expect, it, vi } from 'vitest';
import { signInitData, type InitDataUser } from '../auth';
import { handleStudioRequest } from '../http';
import { handlePetRequest, petRole, plausibleInitData, souvenir } from '../pet-http';
import { petStoreFor } from '../pet-store';
import { StudioRateLimiter } from '../ratelimit';
import { handleAgentUpdate } from '../updates';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { PET_SURFACE_FRAME } from '../../tireh/gateway';
import type { PetPrivateView, PetView } from '../../pet/types';
import type { AgentVisibility } from '../types';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const ORIGIN = 'https://vox.example';
const user = (id: number): InitDataUser => ({ id, first_name: `U${id}` });

interface Call { method?: string; as?: number; token?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string>; agentId?: string }

async function setup(o: { visibility?: AgentVisibility; harness?: Harness } = {}) {
  const h = o.harness ?? makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' }, undefined, o.visibility ?? 'org');
  const call = (path: string[] = [], c: Call = {}) => {
    const agentId = c.agentId ?? mochi.agent.id;
    const method = c.method ?? (c.body === undefined && c.raw === undefined ? 'GET' : 'POST');
    const request = new Request(`${ORIGIN}/api/studio/pet/${agentId}${path.length ? `/${path.join('/')}` : ''}`, {
      method,
      headers: { origin: ORIGIN, ...(c.raw instanceof FormData ? {} : { 'content-type': 'application/json' }), 'x-pet-tz': 'UTC',
        'x-telegram-init-data': signInitData(user(c.as ?? ID.alice), c.token ?? mochi.token), ...c.headers },
      ...(c.raw !== undefined ? { body: c.raw } : c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    });
    return handlePetRequest(h.studio, request, agentId, path);
  };
  return { h, org, mochi, call };
}

/** Core text and the agent grant for one account, as the Mini App conversation requires. */
async function allowTalk(h: Harness, agentId: string, telegramId: number) {
  const now = Date.now();
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'test', enabledCapabilities: ['core_text'],
    accounts: [{ accountId: accountIdFor(telegramId), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: [{ schemaVersion: 1, id: 'approval0', revision: 1, createdAt: now, updatedAt: now, jurisdiction: 'SYNTHETIC', capability: 'core_text',
      state: 'approved', configurationVersion: 'test', effectiveAt: now, reviewExpiresAt: now + 86_400_000, owner: 'test-owner', approvalReference: 'synthetic' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), options);
  h.studio.deps.adaptive = adaptive;
  const confirmed = await adaptive.confirm(telegramId, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  await adaptive.setAgentAccess(telegramId, agentId, { space: 'work', allowed: true, expectedRevision: confirmed.revision, eventId: 'grant-pet-1' });
}

describe('per-agent authentication and roles', () => {
  it('opens the page for the creator (owner) and a member, with a trimmed view and fresh care', async () => {
    const { call, mochi } = await setup();
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const view = await res.json() as PetView;
    expect(view).toMatchObject({ agentId: mochi.agent.id, name: 'Mochi', role: 'owner', stage: 1, formingDay: 1, voice: false, listen: true,
      care: { agentId: mochi.agent.id, userId: ID.alice, tummy: 75, joy: 80, energy: 85, tz: 'UTC', asleep: false } });
    expect(view.botUsername).toBe(mochi.agent.bot!.username);
    expect(view).not.toHaveProperty('access');
    expect(view).not.toHaveProperty('blocked');
    expect(JSON.stringify(view)).not.toContain('tokenEnc');
    expect(((await (await call([], { as: ID.bob })).json()) as PetView).role).toBe('member');
  });

  it('rejects initData signed by another agent bot, the manager bot, or nobody', async () => {
    const { h, org, call } = await setup();
    const other = await hire(h, org.alice, { name: 'Other' });
    expect((await call([], { token: other.token })).status).toBe(401);
    expect((await call([], { agentId: other.agent.id })).status).toBe(401);
    expect((await call([], { agentId: other.agent.id, token: other.token })).status).toBe(200);
    expect((await call([], { token: '123:synthetic-manager' })).status).toBe(401);
    expect((await call([], { headers: { 'x-telegram-init-data': '' } })).status).toBe(401);
    expect((await call([], { headers: { 'x-telegram-init-data': 'x'.repeat(16_385) } })).status).toBe(401);
  });

  it('a stranger on a private agent gets 403 with only what the asleep screen draws, and is never enrolled', async () => {
    const { h, call } = await setup({ visibility: 'private' });
    const members = (await h.store.read()).members.length;
    const res = await call([], { as: ID.stranger });
    expect(res.status).toBe(403);
    const body = await res.json() as PetPrivateView;
    expect(Object.keys(body).sort()).toEqual(['error', 'look', 'name', 'stage']);
    expect(body).toMatchObject({ error: 'pet_private', name: 'Mochi', stage: 1 });
    // a member without access to a private agent is a stranger here too
    expect((await call([], { as: ID.bob })).status).toBe(403);
    expect((await call(['care'], { as: ID.stranger, body: { action: 'feed' } })).status).toBe(403);
    expect((await h.store.read()).members.length).toBe(members);
    expect((await h.store.read()).members.some((m) => m.telegramId === ID.stranger)).toBe(false);
    expect(await (await petStoreFor(h.studio)).listForUser(ID.stranger)).toEqual([]);
  });

  it('a public agent admits a stranger as a guest who can care but not talk, still never enrolled', async () => {
    const { h, call, mochi } = await setup({ visibility: 'public' });
    const view = await (await call([], { as: ID.stranger })).json() as PetView;
    expect(view.role).toBe('guest');
    expect(view.listen).toBe(false);
    const fed = await call(['care'], { as: ID.stranger, body: { action: 'feed' } });
    expect(fed.status).toBe(200);
    expect((await fed.json()).care.tummy).toBe(100);
    const talk = await call(['talk'], { as: ID.stranger, body: { text: 'hi' } });
    expect(talk.status).toBe(403);
    expect(await talk.json()).toEqual({ error: 'guest_talk', botUsername: mochi.agent.bot!.username });
    expect((await call(['talk-voice'], { as: ID.stranger, raw: new FormData() })).status).toBe(403);
    expect(h.chatLLM.replyRequests).toHaveLength(0);
    expect((await h.store.read()).members.some((m) => m.telegramId === ID.stranger)).toBe(false);
  });

  it('a blocked person sees the private screen, never a hint they were blocked', async () => {
    const { h, call, mochi } = await setup({ visibility: 'public' });
    await h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.blocked = [ID.bob, ID.stranger]; });
    for (const as of [ID.bob, ID.stranger]) expect((await (await call([], { as })).json()).error).toBe('pet_private');
    const state = await h.store.read();
    const agent = state.agents.find((a) => a.id === mochi.agent.id)!;
    expect(petRole(state, agent, ID.alice)).toBe('owner');
    expect(petRole(state, agent, ID.admin)).toBe('member');
  });

  it('answers unknown agents, retired agents and unknown routes with pet_unavailable', async () => {
    const { h, call, mochi } = await setup();
    expect((await call([], { agentId: 'missing' })).status).toBe(404);
    expect((await call([], { agentId: '../x' })).status).toBe(404);
    expect((await call(['feed'])).status).toBe(404);
    expect((await call(['care'], { method: 'GET' })).status).toBe(404);
    expect((await call([], { method: 'DELETE' })).status).toBe(404);
    await h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.tokenEnc = 'garbage'; });
    expect((await call()).status).toBe(503);
    await h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.status = 'fired'; });
    expect(await (await call()).json()).toEqual({ error: 'pet_unavailable' });
  });
});

describe('writes and limits', () => {
  it('requires the Studio origin on every write', async () => {
    const { h, call } = await setup();
    expect((await call(['care'], { body: { action: 'feed' }, headers: { origin: 'https://hostile.example' } })).status).toBe(403);
    expect((await call(['care'], { body: { action: 'feed' }, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/studio/pet/x/care`, { method: 'POST', body: '{}' });
    expect((await handlePetRequest(h.studio, noOrigin, 'x', ['care'])).status).toBe(401);
    h.studio.deps.webAppUrl = 'not a url';
    expect((await call(['care'], { body: { action: 'feed' } })).status).toBe(503);
  });

  it('validates care bodies: JSON only, known actions, tap counts 1–50, small bodies', async () => {
    const { call } = await setup();
    expect((await call(['care'], { body: { action: 'feed' }, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await call(['care'], { body: { action: 'poop' } })).status).toBe(400);
    expect((await call(['care'], { body: { action: 'pet', n: 51 } })).status).toBe(400);
    expect((await call(['care'], { body: { action: 'feed', userId: 1 } })).status).toBe(400);
    expect((await call(['care'], { raw: '{not json' })).status).toBe(400);
    expect((await call(['care'], { raw: JSON.stringify({ action: 'feed', pad: 'x'.repeat(2000) }) })).status).toBe(413);
  });

  it('rate limits per bucket with Retry-After', async () => {
    const { h, call } = await setup();
    h.studio.deps.rateLimiter = new StudioRateLimiter({ policies: { api: { requests: 2, windowMs: 60_000 } } });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('applies care server-side with guards as outcomes, decaying from the stored time', async () => {
    const { h, call } = await setup();
    await call();
    h.clock.now = new Date(h.clock.now.getTime() + 2 * 3_600_000);
    const fed = await (await call(['care'], { body: { action: 'feed' } })).json();
    expect(fed).toMatchObject({ now: h.clock.now.getTime(), care: { tummy: 100, joy: 72, energy: 79, bond: 1 } });
    const full = await (await call(['care'], { body: { action: 'feed' } })).json();
    expect(full).toMatchObject({ guard: 'full', care: { tummy: 100, bond: 1 } });
    const pets = await (await call(['care'], { body: { action: 'tickle', n: 50 } })).json();
    expect(pets).toMatchObject({ guard: 'capped', care: { joy: 84 } });
    await h.store.update((s) => { s.agents.find((a) => a.id === pets.care.agentId)!.status = 'active'; });
    const stored = await (await petStoreFor(h.studio)).get(pets.care.agentId, ID.alice);
    expect(stored?.joy).toBe(84);
  });

  it('maps a broken pet store to pet_unavailable', async () => {
    const { h, call } = await setup();
    h.studio.deps.pets = { update: vi.fn(async () => { throw new Error('disk'); }) } as never;
    expect(await (await call()).json()).toEqual({ error: 'pet_unavailable' });
  });

  it('preserves the stale-care conflict from an instrumentation-owned store module', async () => {
    const { h, call } = await setup();
    vi.resetModules();
    const { PetCareChangedError } = await import('../pet-store');
    h.studio.deps.pets = {
      erasureEpoch: async () => 'initial', erasureEpochNow: () => 'initial',
      update: vi.fn(async () => { throw new PetCareChangedError('Pet care changed'); }),
    } as never;
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conversation_failed', message: 'pet_care_changed' });
  });
});

describe('the open event', () => {
  it('reports welcome-back with a souvenir and stage-up once, and saves what was seen', async () => {
    const { h, call, mochi } = await setup();
    await call();
    h.advanceDays(3);
    const back = await (await call()).json() as PetView;
    expect(back.welcome).toEqual({ souvenir: souvenir(mochi.agent.id, ID.alice, h.clock.now.getTime()), awayMs: 3 * 86_400_000 });
    expect(back.stageUp).toEqual({ from: 1, to: 3 });
    for (const need of ['tummy', 'joy', 'energy'] as const) expect(back.care[need]).toBeGreaterThanOrEqual(60);
    const again = await (await call()).json() as PetView;
    expect(again.welcome).toBeUndefined();
    expect(again.stageUp).toBeUndefined();
    expect(souvenir('a', 1, 0)).not.toMatch(/miss|lonely|where were you|sad/i);
  });

  it('is asleep on open during the user night and reads the zone from the header', async () => {
    const { h, call } = await setup();
    h.clock.now = new Date('2026-10-19T19:00:00Z');
    const tehran = await (await call([], { headers: { 'x-pet-tz': 'Asia/Tehran' } })).json() as PetView;
    expect(tehran.care).toMatchObject({ asleep: true, tz: 'Asia/Tehran' });
    const woke = await (await call(['care'], { body: { action: 'wake' }, headers: { 'x-pet-tz': 'Asia/Tehran' } })).json();
    expect(woke.care.asleep).toBe(false);
  });
});

describe('talk', () => {
  it('replies through the DM chat with the pet surface hint, adds Joy and Bond, and flags a goodbye', async () => {
    const { h, call, mochi } = await setup({ harness: makeStudio({ adaptive: false }) });
    await allowTalk(h, mochi.agent.id, ID.alice);
    const res = await call(['talk'], { body: { text: 'Hello Mochi' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ reply: 'Sure.', care: { joy: 86, bond: 1 } });
    expect(body.goodbye).toBeUndefined();
    expect(h.chatLLM.lastPrompt).toContain(PET_SURFACE_FRAME);
    const bye = await (await call(['talk'], { body: { text: 'ok bye!' } })).json();
    expect(bye).toMatchObject({ goodbye: true, care: { joy: 92, bond: 2 } });
    // the client cannot steer the turn
    expect((await call(['talk'], { body: { text: 'hi', space: 'personal' } })).status).toBe(400);
    expect((await call(['talk'], { body: { text: '   ' } })).status).toBe(400);
    expect((await call(['talk'], { raw: 'hi', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
  });

  it('surfaces a refused conversation as conversation_failed without touching care', async () => {
    const { h, call, mochi } = await setup({ harness: makeStudio({ adaptive: false }) });
    const res = await call(['talk'], { body: { text: 'hi' } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'conversation_failed', message: 'conversation_unavailable' });
    await allowTalk(h, mochi.agent.id, ID.alice);
    const bob = await call(['talk'], { as: ID.bob, body: { text: 'hi' } });
    expect(bob.status).toBe(403);
    expect((await bob.json()).message).toBe('conversation_not_permitted');
    expect(await (await petStoreFor(h.studio)).get(mochi.agent.id, ID.bob)).toBeNull();
  });

  it('voice: hears, replies on the call path, returns audio only for an agent with its own voice', async () => {
    const { h, call, mochi } = await setup();
    await allowTalk(h, mochi.agent.id, ID.alice);
    const form = () => { const f = new FormData(); f.append('audio', new Blob([new Uint8Array(8)], { type: 'audio/webm' })); return f; };
    const res = await call(['talk-voice'], { raw: form() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ transcript: 'hello there', reply: 'Sure.', care: { joy: 86, bond: 1 } });
    expect(body.audio).toBeUndefined();
    // no voice of its own: no speech is made at all (never paid for and thrown away)
    expect(h.eleven.speak).not.toHaveBeenCalled();
    expect(h.chatLLM.lastPrompt).toContain(PET_SURFACE_FRAME);
    await h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.voice = { provider: 'elevenlabs', voiceId: 'v1', label: 'V', source: 'default' }; });
    h.openai.transcribe.mockResolvedValueOnce('good night');
    const spoken = await (await call(['talk-voice'], { raw: form() })).json();
    expect(spoken).toMatchObject({ goodbye: true, audio: Buffer.from('spoken-mp3').toString('base64') });
    expect(h.eleven.speak).toHaveBeenCalledTimes(1);
    h.openai.transcribe.mockResolvedValueOnce('');
    expect(await (await call(['talk-voice'], { raw: form() })).json()).toEqual({ transcript: '', reply: '' });
    expect((await call(['talk-voice'], { raw: new FormData() })).status).toBe(400);
    expect((await call(['talk-voice'], { body: { audio: 'x' } })).status).toBe(415);
  });

  it('refuses microphone export without an exact permitted account and suppresses a late voice reply after withdrawal', async () => {
    const { h, call, mochi } = await setup();
    const form = () => { const f = new FormData(); f.append('audio', new Blob([new Uint8Array(8)], { type: 'audio/webm' })); return f; };
    expect((await call(['talk-voice'], { raw: form() })).status).not.toBe(200);
    expect(h.openai.transcribe).not.toHaveBeenCalled();
    await allowTalk(h, mochi.agent.id, ID.alice);
    const pets = await petStoreFor(h.studio), update = pets.update.bind(pets);
    vi.spyOn(pets, 'update').mockImplementationOnce(async (...args) => {
      const current = await h.studio.deps.adaptive!.read(ID.alice, 'work');
      await h.studio.deps.adaptive!.setAgentAccess(ID.alice, mochi.agent.id, {
        space: 'work', allowed: false, expectedRevision: current.revision, eventId: 'revoke-pet-voice' });
      return update(...args);
    });
    h.chatLLM.nextReply = 'PRIVATE_VOICE_AFTER_WITHDRAWAL';
    const response = await call(['talk-voice'], { raw: form() });
    expect(h.openai.transcribe).toHaveBeenCalledTimes(1);
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('PRIVATE_VOICE_AFTER_WITHDRAWAL');
  });

  it('rejects an unversioned mutation after forget until an explicit fresh open supplies its epoch', async () => {
    const { call } = await setup();
    expect((await call()).status).toBe(200);
    expect((await call(['forget'], { body: {} })).status).toBe(200);
    expect((await call(['care'], { body: { action: 'feed' } })).status).toBe(409);
    const view = await (await call()).json() as PetView;
    expect(view.careEpoch).not.toBe('initial');
    expect((await call(['care'], { body: { action: 'feed' }, headers: { 'x-pet-care-epoch': view.careEpoch! } })).status).toBe(200);
  });

  it('voice without any listening provider is a clean 501, and the page is told not to show the mic', async () => {
    const { h, call, mochi } = await setup({ harness: makeStudio({ openai: false, eleven: false }) });
    await allowTalk(h, mochi.agent.id, ID.alice);
    expect(((await (await call()).json()) as PetView).listen).toBe(false);
    const f = new FormData();
    f.append('audio', new Blob([new Uint8Array(8)]));
    const res = await call(['talk-voice'], { raw: f });
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'conversation_failed', message: 'voice_unavailable' });
  });
});

describe('the pet entrance (rate limits, pre-auth)', () => {
  it('has its own entrance per agent: a busy pet never limits another agent or the Studio', async () => {
    const { h, org, call } = await setup();
    const other = await hire(h, org.alice, { name: 'Other' });
    h.studio.deps.rateLimiter = new StudioRateLimiter({ policies: { ingress: { requests: 3, windowMs: 60_000 } } });
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
    expect((await call([], { agentId: other.agent.id, token: other.token })).status).toBe(200);
    const studioReq = new Request('https://vox.example/api/studio/me', { headers: { 'x-telegram-init-data': signInitData(user(ID.alice), '123:synthetic-manager') } });
    expect((await handleStudioRequest(h.studio, studioReq, ['me'], { botToken: '123:synthetic-manager', devUser: null })).status).toBe(200);
  });

  it('turns malformed, stale or forged initData away without reading Studio state', async () => {
    const { h, call, mochi } = await setup();
    expect((await call()).status).toBe(200);
    const read = vi.spyOn(h.store, 'read');
    const signed = new URLSearchParams(signInitData(user(ID.alice), mochi.token));
    const variant = (edit: (p: URLSearchParams) => void) => { const p = new URLSearchParams(signed); edit(p); return p.toString(); };
    for (const initData of [
      'junk', 'hash=zz', variant((p) => p.set('hash', 'x'.repeat(64))), variant((p) => p.delete('user')),
      variant((p) => p.set('auth_date', String(Math.floor(Date.now() / 1000) - 2 * 86_400))), variant((p) => p.set('auth_date', 'soon')),
    ]) {
      expect((await call([], { headers: { 'x-telegram-init-data': initData } })).status, initData).toBe(401);
    }
    // well formed but signed by another bot: the cached gate answers, still no read
    expect((await call([], { token: '123:synthetic-manager' })).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(plausibleInitData(signed.toString())).toBe(true);
  });
});

describe('the person’s own pet data (guest rights)', () => {
  it('anyone the bot signed for can export and forget their care, guests included', async () => {
    const { h, call, mochi } = await setup({ visibility: 'public' });
    await call([], { as: ID.stranger });
    const exported = await call(['export'], { as: ID.stranger });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect((await exported.json()).petCare).toEqual([expect.objectContaining({ agentId: mochi.agent.id, userId: ID.stranger })]);
    expect((await call(['forget'], { as: ID.stranger, body: {}, headers: { origin: 'https://hostile.example' } })).status).toBe(403);
    expect(await (await call(['forget'], { as: ID.stranger, body: {} })).json()).toEqual({ erased: 1 });
    expect(await (await petStoreFor(h.studio)).listForUser(ID.stranger)).toEqual([]);
    // a blocked person (who now sees the private screen) can still erase what was kept
    await call([], { as: ID.bob });
    await h.store.update((s) => { s.agents.find((a) => a.id === mochi.agent.id)!.blocked = [ID.bob]; });
    expect(await (await call(['forget'], { as: ID.bob, body: {} })).json()).toEqual({ erased: 1 });
    expect((await h.store.read()).members.some((m) => m.telegramId === ID.stranger)).toBe(false);
  });
});

describe('slow requests and the cap windows', () => {
  it('a talk turn that outlasts a new hour window never resets the caps it opened', async () => {
    const { h, call, mochi } = await setup({ harness: makeStudio({ adaptive: false }) });
    await allowTalk(h, mochi.agent.id, ID.alice);
    await call();
    const complete = h.chatLLM.complete.bind(h.chatLLM);
    let raced = false;
    vi.spyOn(h.chatLLM, 'complete').mockImplementation(async (request) => {
      if (!raced) {
        raced = true;
        // while the reply is being written, an hour passes and a tap flush opens (and fills) the new hour's pet cap
        h.clock.now = new Date(h.clock.now.getTime() + 61 * 60_000);
        expect((await (await call(['care'], { body: { action: 'pet', n: 6 } })).json()).care.caps.petJoy).toBe(12);
      }
      return complete(request);
    });
    expect((await call(['talk'], { body: { text: 'hello' } })).status).toBe(200);
    const stored = await (await petStoreFor(h.studio)).get(mochi.agent.id, ID.alice);
    expect(stored?.caps).toMatchObject({ petJoy: 12, talkJoy: 6 });
  });
});

describe('entry points', () => {
  it('the /start reply carries an "Open {name}" web_app button to the agent pet page', async () => {
    const { h, mochi } = await setup();
    await handleAgentUpdate(h.studio, mochi.agent.id, { update_id: 1, message: { message_id: 1, date: 0, text: '/start',
      chat: { id: ID.alice, type: 'private' }, from: { id: ID.alice, is_bot: false, first_name: 'Alice' } } });
    expect(mochi.bot().sendMessage).toHaveBeenCalledWith(ID.alice, expect.stringContaining("I'm Mochi"),
      { keyboard: { inline_keyboard: [[{ text: 'Open Mochi', web_app: { url: `${ORIGIN}/studio/pet/${mochi.agent.id}` } }]] } });
  });

  it('no HTTPS Studio URL, no button', async () => {
    const { h, mochi } = await setup();
    h.studio.deps.webAppUrl = 'http://localhost:3000/studio';
    await handleAgentUpdate(h.studio, mochi.agent.id, { update_id: 2, message: { message_id: 2, date: 0, text: '/start',
      chat: { id: ID.alice, type: 'private' }, from: { id: ID.alice, is_bot: false, first_name: 'Alice' } } });
    expect(mochi.bot().sendMessage.mock.calls.at(-1)).toHaveLength(2);
  });
});
