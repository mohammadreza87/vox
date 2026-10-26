/**
 * Check-ins end to end (design §5, §6.2 P1): GET/POST …/checkins, the run (planner → delivery fence → the agent's own
 * bot), the Why this? / Stop callbacks, the `?ci=` replay on open, the trigger route, export and erasure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitDataUser } from '../auth';
import { agentInit } from './initdata-keys';
import { handleMyDataRequest } from '../my-data-http';
import { handlePetRequest } from '../pet-http';
import { handleAgentUpdate } from '../updates';
import { petCheckinStoreFor } from '../pet-checkins/store';
import { checkinLine, noteCheckinStop, parseCheckinCallback } from '../pet-checkins/deliver';
import { runPetCheckins } from '../pet-checkins/run';
import { handleCheckinTrigger } from '../pet-checkins/trigger';
import type { MyDataForgetResponse, MyDataResponse } from '../my-data-contract';
import type { PetCheckinsView } from '../../pet/checkins';
import type { PetView } from '../../pet/types';
import type { AgentVisibility } from '../types';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const ORIGIN = 'https://vox.example';
const MANAGER = '123:synthetic-manager';
const SECRET = 'synthetic-trigger-secret-0123456789abcdef';
const user = (id: number, lang?: string): InitDataUser => ({ id, first_name: `U${id}`, ...(lang ? { language_code: lang } : {}) } as InitDataUser);
const HOUR = 3_600_000;

beforeEach(() => { vi.stubEnv('STUDIO_PET_CHECKINS', 'on'); vi.stubEnv('STUDIO_PET_DECISIONS', 'off'); });
afterEach(() => { vi.unstubAllEnvs(); });

interface Call { method?: string; as?: number; lang?: string; body?: unknown; query?: string; headers?: Record<string, string> }

async function setup(visibility: AgentVisibility = 'public') {
  const h = makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const mochi = await hire(h, org.alice, { name: 'Mochi' }, undefined, visibility);
  const call = (path: string[] = [], c: Call = {}) => {
    const method = c.method ?? (c.body === undefined ? 'GET' : 'POST');
    return handlePetRequest(h.studio, new Request(`${ORIGIN}/api/studio/pet/${mochi.agent.id}${path.length ? `/${path.join('/')}` : ''}${c.query ?? ''}`, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'Asia/Tehran', 'x-telegram-init-data': agentInit(user(c.as ?? ID.alice, c.lang), mochi.token), ...c.headers },
      ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    }), mochi.agent.id, path);
  };
  const checkins = async (body?: unknown, c: Omit<Call, 'body'> = {}) => {
    const res = await call(['checkins'], { ...c, ...(body !== undefined ? { body } : {}) });
    return { status: res.status, body: await res.json() as PetCheckinsView & { error?: string } };
  };
  const consent = (o: Record<string, unknown> = {}) => ({ variant: 'default', lang: 'en', eventId: 'evt-abcdefgh', presentedAt: h.clock.now.getTime() - 5000, ...o });
  const store = () => petCheckinStoreFor(h.studio);
  return { h, org, mochi, call, checkins, consent, store };
}

/** Opens the pet on day 1 (stage 1 seen), turns check-ins on, and moves to day 2 (stage 2: a stage-up is due). */
async function stageUpDue() {
  const s = await setup();
  await s.call();
  expect((await s.checkins({ enabled: true, consent: s.consent() })).status).toBe(200);
  s.h.clock.now = new Date(s.h.clock.now.getTime() + 26 * HOUR);
  return s;
}

describe('GET/POST …/checkins', () => {
  it('starts off with the §5.2 defaults, and turning on needs the P1 sheet\'s evidence', async () => {
    const { checkins, consent, store } = await setup();
    expect((await checkins()).body).toEqual({ enabled: false, types: { growingUp: true, seasons: true, garden: true, hellos: false, careNudges: false }, sound: false, inboxOnly: true, sentThisWeek: 0, live: true });
    expect(await checkins({ enabled: true })).toMatchObject({ status: 400, body: { error: 'consent_required' } });
    expect(await checkins({ enabled: true, consent: consent({ presentedAt: Date.now() + 60_000 }) })).toMatchObject({ status: 400, body: { error: 'consent_invalid' } });
    const on = await checkins({ enabled: true, consent: consent(), types: { hellos: true } });
    expect(on).toMatchObject({ status: 200, body: { enabled: true, types: { growingUp: true, hellos: true, careNudges: false }, live: true } });
    expect(on.body.inboxOnly).toBeUndefined();
    const record = (await (await store()).get(ID.alice))!;
    expect(record.tz).toBe('Asia/Tehran');
    expect(Object.values(record.agents)[0].consent).toMatchObject({ purpose: 'optional.pet_checkins', state: 'granted', revision: 1,
      evidence: { eventId: 'evt-abcdefgh', noticeId: 'perm.P1', noticeVersion: 'pet-checkins-v1', locale: 'en', surface: 'mini_app', affirmative: true, copyHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    // nothing but ids, hashes, times, counts and flags is stored
    expect(JSON.stringify(record)).not.toMatch(/Mochi|check in|Yes/);
  });

  it('changes types and sound while on; stops a type, then all (withdrawing consent); validates strictly', async () => {
    const { checkins, consent, store, mochi } = await setup();
    await checkins({ enabled: true, consent: consent() });
    expect((await checkins({ enabled: true, types: { seasons: false }, sound: true })).body).toMatchObject({ enabled: true, sound: true, types: { seasons: false, growingUp: true } });
    expect((await checkins({ op: 'stop', type: 'growingUp' })).body).toMatchObject({ enabled: true, types: { growingUp: false, garden: true } });
    expect((await checkins({ op: 'stop' })).body).toMatchObject({ enabled: false });
    expect((await (await store()).get(ID.alice))!.agents[mochi.agent.id].consent).toMatchObject({ state: 'withdrawn', revision: 2, withdrawnVia: 'stop_all' });
    for (const bad of [{ enabled: true, types: { hunger: true } }, { op: 'stop', type: 'hunger' }, { op: 'delete' }, { enabled: 'yes' }, { enabled: false, extra: 1 }]) {
      expect((await checkins(bad)).status).toBe(400);
    }
  });

  it('members only: a guest of a public agent is never asked', async () => {
    const { checkins, consent } = await setup('public');
    expect(await checkins(undefined, { as: ID.stranger })).toMatchObject({ status: 403, body: { error: 'checkins_unavailable' } });
    expect(await checkins({ enabled: true, consent: consent() }, { as: ID.stranger })).toMatchObject({ status: 403, body: { error: 'checkins_unavailable' } });
  });

  it('the view carries this agent\'s check-ins once answered, and never for a guest', async () => {
    const { call, checkins, consent } = await setup();
    expect(((await (await call()).json()) as PetView).checkins).toBeUndefined();
    await checkins({ enabled: true, consent: consent() });
    expect(((await (await call()).json()) as PetView).checkins).toMatchObject({ enabled: true, sentThisWeek: 0 });
    expect(((await (await call([], { as: ID.stranger })).json()) as PetView).checkins).toBeUndefined();
  });
});

describe('the run and the delivery fence', () => {
  it('sends one silent stage-up from the agent\'s own bot, with Open (web_app ?ci=), Why this? and Stop', async () => {
    const { h, mochi, store } = await stageUpDue();
    const report = await runPetCheckins(h.studio);
    expect(report).toMatchObject({ people: 1, sent: 1, outcomes: { sent: 1 } });
    const bot = mochi.bot();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = bot.sendMessage.mock.calls[0] as [number, string, { keyboard: { inline_keyboard: Array<Array<{ text: string; web_app?: { url: string }; callback_data?: string }>> }; silent: boolean }];
    expect(chatId).toBe(ID.alice);
    expect(text).toBe('Something changed overnight. Want to see?');
    expect(opts.silent).toBe(true);
    const [[open], [why, stop]] = opts.keyboard.inline_keyboard;
    expect(open.text).toBe('Open Mochi');
    const ref = new URL(open.web_app!.url).searchParams.get('ci')!;
    expect(open.web_app!.url).toBe(`${ORIGIN}/studio/pet/${mochi.agent.id}?ci=${ref}`);
    expect(why).toEqual({ text: 'Why this?', callback_data: `kw:${ref}` });
    expect(stop).toEqual({ text: 'Stop these', callback_data: `ks:${ref}` });
    const record = (await (await store()).get(ID.alice))!;
    expect(record.sent).toEqual([expect.objectContaining({ ref, agentId: mochi.agent.id, moment: 'C2', occurrence: 'stage:2', state: 'accepted', lang: 'en', by: 'local' })]);
    expect(record.agents[mochi.agent.id]).toMatchObject({ lastSentAt: h.clock.now.getTime(), week: [h.clock.now.getTime()] });
    // idempotent per person, agent and day: a second run (or the other entry point) sends nothing
    expect(await runPetCheckins(h.studio)).toMatchObject({ sent: 0, skipped: { agent_day: 1 } });
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('nothing is ever sent with STUDIO_PET_CHECKINS off, even with consent and a moment due', async () => {
    const { h, mochi } = await stageUpDue();
    vi.stubEnv('STUDIO_PET_CHECKINS', 'off');
    expect(await runPetCheckins(h.studio)).toMatchObject({ off: true, sent: 0 });
    expect(mochi.bot().sendMessage).not.toHaveBeenCalled();
  });

  it('sound on sends with notification; Persian writes the Persian template and buttons', async () => {
    const { h, mochi, checkins } = await stageUpDue();
    await checkins({ enabled: true, sound: true });
    const s = await petCheckinStoreFor(h.studio);
    await s.update(ID.alice, (r) => ({ record: r && { ...r, lang: 'fa' }, result: undefined }));
    await runPetCheckins(h.studio);
    const [, text, opts] = mochi.bot().sendMessage.mock.calls[0] as [number, string, { silent: boolean; keyboard: { inline_keyboard: Array<Array<{ text: string }>> } }];
    expect(opts.silent).toBe(false);
    expect(text).toBe('دیشب یه کم بزرگ‌تر شدم! دوست داری ببینی؟');
    expect(opts.keyboard.inline_keyboard[0][0].text).toBe('سر زدن به ⁨Mochi⁩');
  });

  it('a Stop recorded after the plan cancels the send in flight; a refused send never counts', async () => {
    const { h, mochi, checkins } = await stageUpDue();
    const bot = mochi.bot();
    bot.sendMessage.mockImplementationOnce(async () => { throw Object.assign(new Error('Telegram sendMessage failed: Forbidden'), { method: 'sendMessage', description: 'Forbidden: bot was blocked by the user', errorCode: 403 }); });
    expect(await runPetCheckins(h.studio)).toMatchObject({ sent: 0, outcomes: { failed: 1 } });
    // failed rows do not count: the next run may send
    expect(await runPetCheckins(h.studio)).toMatchObject({ sent: 1 });
    // a new day, a new due moment, then Stop before the send
    h.clock.now = new Date(h.clock.now.getTime() + 2 * 24 * HOUR);
    await checkins({ op: 'stop', type: 'growingUp' });
    expect(await runPetCheckins(h.studio)).toMatchObject({ sent: 0, skipped: { none_eligible: 1 } });
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('the final fence at the POST', () => {
  it('a Stop that lands between the reservation and the request cancels it; nothing counts', async () => {
    const { h, mochi, store } = await stageUpDue();
    const bot = mochi.bot();
    // The real client runs authorizeNow right before fetch and throws ExportAuthorityError when it fails.
    bot.sendMessage.mockImplementationOnce(async (_chat: number, _text: string, opts?: unknown) => {
      noteCheckinStop(ID.alice);
      if (!(opts as { authorizeNow: () => boolean }).authorizeNow()) throw Object.assign(new Error('export_authority_changed'), { name: 'ExportAuthorityError' });
      throw new Error('unreachable');
    });
    expect(await runPetCheckins(h.studio)).toMatchObject({ sent: 0, outcomes: { cancelled: 1 } });
    expect((await (await store()).get(ID.alice))!.sent.map((s) => s.state)).toEqual(['cancelled']);
    // a timeout after the request may have been accepted: unknown, counted, never retried
    bot.sendMessage.mockImplementationOnce(async () => { throw new TypeError('socket hang up'); });
    expect(await runPetCheckins(h.studio)).toMatchObject({ outcomes: { unknown: 1 } });
    expect(await runPetCheckins(h.studio)).toMatchObject({ sent: 0, skipped: { agent_day: 1 } });
  });
});

describe('Why this? and Stop in the DM', () => {
  async function sentOne() {
    const s = await stageUpDue();
    await runPetCheckins(s.h.studio);
    const bot = s.mochi.bot();
    const keyboard = (bot.sendMessage.mock.calls[0][2] as { keyboard: { inline_keyboard: Array<Array<{ callback_data?: string; web_app?: { url: string } }>> } }).keyboard;
    const ref = new URL(keyboard.inline_keyboard[0][0].web_app!.url).searchParams.get('ci')!;
    let update = 9000;
    const tap = (data: string, from = ID.alice) => handleAgentUpdate(s.h.studio, s.mochi.agent.id, { update_id: update++, callback_query: {
      id: `cb${update}`, from: { id: from, is_bot: false, first_name: 'A' }, data, message: { message_id: 77, chat: { id: from, type: 'private' }, date: 0 } } } as never);
    return { ...s, bot, ref, tap };
  }

  it('parses only its own buttons', () => {
    expect(parseCheckinCallback('kw:abcdefghijklmnopqrstuv')).toEqual({ action: 'why', ref: 'abcdefghijklmnopqrstuv' });
    expect(parseCheckinCallback('ka:abcdefghijklmnopqrstuv')).toEqual({ action: 'stopAll', ref: 'abcdefghijklmnopqrstuv' });
    for (const d of ['kx:abcdefghijklmnopqrstuv', 'kw:short', 'cj:abcdefghijklmnop', undefined]) expect(parseCheckinCallback(d)).toBeNull();
  });

  it('Why this? appends the reason line in place and records the tap', async () => {
    const { bot, ref, tap, store } = await sentOne();
    await tap(`kw:${ref}`);
    expect(bot.answerCallbackQuery).toHaveBeenCalled();
    const [chat, message, text] = bot.editMessageText.mock.calls[0] as [number, number, string];
    expect([chat, message]).toEqual([ID.alice, 77]);
    expect(text).toBe(`Something changed overnight. Want to see?\n\n${checkinLine('ci.why.growing', 'en', { name: 'Mochi' })}`);
    expect(text).toContain('never 21:00–08:00');
    expect((await (await store()).get(ID.alice))!.sent[0].whyAt).toBeTypeOf('number');
  });

  it('Stop turns the type off, confirms in place and offers Stop all, which turns this agent\'s check-ins off', async () => {
    const { bot, ref, tap, store, mochi } = await sentOne();
    await tap(`ks:${ref}`);
    expect(bot.editMessageText.mock.calls[0][2]).toBe('Okay, no more Growing up messages from Mochi.');
    expect(bot.editMessageText.mock.calls[0][3]).toEqual({ inline_keyboard: [[{ text: 'Stop all check-ins', callback_data: `ka:${ref}` }]] });
    let record = (await (await store()).get(ID.alice))!;
    expect(record.agents[mochi.agent.id]).toMatchObject({ enabled: true, types: { growingUp: false } });
    expect(record.sent[0].stoppedAt).toBeTypeOf('number');
    await tap(`ka:${ref}`);
    record = (await (await store()).get(ID.alice))!;
    expect(record.agents[mochi.agent.id]).toMatchObject({ enabled: false, consent: { state: 'withdrawn', withdrawnVia: 'stop_all' } });
  });

  it('someone else\'s tap on the reference does nothing', async () => {
    const { bot, ref, tap, store } = await sentOne();
    await tap(`ks:${ref}`, ID.bob);
    expect(bot.editMessageText).not.toHaveBeenCalled();
    expect(Object.values((await (await store()).get(ID.alice))!.agents)[0].types.growingUp).toBe(true);
  });

  it('opening with ?ci= replays the moment and marks the send opened', async () => {
    const { call, ref, store } = await sentOne();
    const view = await (await call([], { query: `?ci=${ref}` })).json() as PetView;
    expect(view.checkin).toEqual({ ref, momentId: 'C2', type: 'growingUp' });
    expect((await (await store()).get(ID.alice))!.sent[0]).toMatchObject({ openedVia: 'ref', openedAt: expect.any(Number) });
    // a made-up or someone else's reference replays nothing
    expect(((await (await call([], { query: '?ci=AAAAAAAAAAAAAAAAAAAAAA' })).json()) as PetView).checkin).toBeUndefined();
    expect(((await (await call([], { query: '?ci=<script>' })).json()) as PetView).checkin).toBeUndefined();
  });
});

describe('the pause and the paused note', () => {
  it('three unopened in a row pause every check-in; the note shows once; only "Yes, send them" resumes', async () => {
    const { h, call, checkins, store } = await setup();
    await call();
    await checkins({ enabled: true, consent: { variant: 'default', lang: 'en', eventId: 'evt-abcdefgh', presentedAt: h.clock.now.getTime() - 1000 } });
    const s = await store();
    const at = h.clock.now.getTime();
    await s.update(ID.alice, (r) => ({ record: r && { ...r, sent: [3, 5, 7].map((d, i) => ({ ref: `pausedref${i}aaaaaaaaaaaaa`, agentId: Object.keys(r.agents)[0], moment: 'C4' as const,
      occurrence: `away:x:${i}`, day: '2026-10-1' + i, personHash: 'b'.repeat(32), at: at - d * 24 * HOUR, state: 'accepted' as const, lang: 'en' as const, variant: 0 })) }, result: undefined }));
    expect(await runPetCheckins(h.studio)).toMatchObject({ paused: 1, skipped: { pause_now: 1 } });
    expect((await s.get(ID.alice))!.pausedAt).toBe(at);
    const first = await (await call()).json() as PetView;
    expect(first.checkins).toMatchObject({ pausedAt: at, pausedNote: true });
    expect(((await (await call()).json()) as PetView).checkins?.pausedNote).toBeUndefined();
    expect(await runPetCheckins(h.studio)).toMatchObject({ skipped: { paused: 1 } });
    expect((await checkins({ op: 'resume' })).body.pausedAt).toBeUndefined();
    expect((await s.get(ID.alice))!.resumedAt).toBe(at);
  });
});

describe('POST /api/studio/pet/checkins/run', () => {
  const post = (auth?: string, body?: string) => new Request(`${ORIGIN}/api/studio/pet/checkins/run`, { method: 'POST', headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' }, ...(body ? { body } : {}) });

  it('does not exist without the secret; refuses a wrong bearer before starting anything; runs with the right one', async () => {
    const { h, mochi } = await stageUpDue();
    const studio = vi.fn(async () => h.studio);
    expect((await handleCheckinTrigger(post(`Bearer ${SECRET}`), studio, {})).status).toBe(404);
    expect((await handleCheckinTrigger(post('Bearer short'), studio, { STUDIO_PET_CHECKINS_TRIGGER_SECRET: 'short' })).status).toBe(404);
    const env = { STUDIO_PET_CHECKINS_TRIGGER_SECRET: SECRET };
    expect((await handleCheckinTrigger(post(`Bearer ${SECRET}x`), studio, env)).status).toBe(401);
    expect((await handleCheckinTrigger(post(), studio, env)).status).toBe(401);
    expect(studio).not.toHaveBeenCalled();
    expect((await handleCheckinTrigger(post(`Bearer ${SECRET}`, '{"maxSends":0}'), studio, env)).status).toBe(400);
    expect((await handleCheckinTrigger(post(`Bearer ${SECRET}`, '{"other":1}'), studio, env)).status).toBe(400);
    const res = await handleCheckinTrigger(post(`Bearer ${SECRET}`, '{"maxSends":5,"deadlineMs":5000}'), studio, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { sent: 1 } });
    expect(mochi.bot().sendMessage).toHaveBeenCalledTimes(1);
  });

  it('stops at the send cap', async () => {
    const { h } = await stageUpDue();
    expect(await runPetCheckins(h.studio, { maxSends: 1 })).toMatchObject({ sent: 1 });
  });
});

describe('My data', () => {
  it('exports the record and erases it with the rest', async () => {
    const { h, checkins, consent } = await setup();
    await checkins({ enabled: true, consent: consent() });
    const mine = (path: string[] = [], body?: unknown) => handleMyDataRequest(h.studio, new Request(`${ORIGIN}/api/studio/my-data${path.length ? `/${path.join('/')}` : ''}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-telegram-init-data': agentInit(user(ID.alice), MANAGER) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }), path, MANAGER);
    const exported = await (await mine()).json() as MyDataResponse;
    expect(exported.petCheckins).toMatchObject({ userId: ID.alice, lang: 'en' });
    const forgot = await (await mine(['forget'], { confirm: true })).json() as MyDataForgetResponse;
    expect(forgot.checkinsErased).toBe(1);
    expect(await (await petCheckinStoreFor(h.studio)).get(ID.alice)).toBeNull();
  });
});
