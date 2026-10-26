/**
 * Circles S4 (GROUP_AGENTS_SPEC R2 decision 5, §9 S4 as amended): each person opens their own pet over the group.
 * Link precedence (agent's own Main Mini App > the manager bot's > the S2 DM hop), manager-signed launches accepted
 * only for the launch routes and only for the agent their signed code names, the Join sheet's decision through the
 * group card's own path (same ledger state, surface mini_app, same copyHash), membership re-checked, notes limited
 * to the requester's own copies, the S2 debounce on the card, and the kill switch keeping HEAD's behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramChatMemberUpdated, TelegramUpdate, TelegramUser } from '../../tireh/telegram/client';
import { agentInit } from './initdata-keys';
import { signInitData } from '../auth';
import { generateKeyPairSync } from 'crypto';
import { handlePetLaunch, handlePetRequest } from '../pet-http';
import { handleAgentUpdate } from '../updates';
import { StudioRateLimiter } from '../ratelimit';
import { agentShortCode, circleJoinUrl, parsePetLaunch } from '../../circles/codec';
import { groupIdOf } from '../../circles/service';
import { groupCard } from '../../circles/notice';
import type { CirclesMode } from '../../circles/codec';
import type { PetCircle, PetNotesResponse, PetView } from '../../pet/types';
import { hire, ID, makeStudio, memberOf, seedOrg, SECRET } from './helpers';

const CHAT = -100777;
const ORIGIN = 'https://vox.example';
const MANAGER = '7777:synthetic-manager-token-abcdefghij';
const NAMES: Record<number, string> = { [ID.alice]: 'Reza', [ID.stranger]: 'Parastoo' };
let updateId = 990_000;

beforeEach(() => { vi.stubEnv('STUDIO_GROUP_OBSERVATION', 'on'); vi.stubEnv('TIREH_CACHED_PROMPT', ''); });
afterEach(() => vi.unstubAllEnvs());

const user = (id: number): TelegramUser => ({ id, is_bot: false, first_name: NAMES[id] ?? 'S' });
const added = (from: number, botId: number): TelegramChatMemberUpdated => ({
  chat: { id: CHAT, type: 'supergroup', title: 'HOOR family' }, from: user(from), date: 0,
  old_chat_member: { status: 'left', user: { id: botId, is_bot: true, first_name: 'b' } }, new_chat_member: { status: 'member', user: { id: botId, is_bot: true, first_name: 'b' } },
});
const tap = (from: number, data: string, messageId: number): TelegramUpdate =>
  ({ update_id: updateId++, callback_query: { id: `cb-${updateId}`, from: user(from), data, message: { message_id: messageId, date: 0, chat: { id: CHAT, type: 'supergroup' } } } });
type Button = { text: string; callback_data?: string; url?: string };
const flat = (options: unknown) => ((options as { keyboard?: { inline_keyboard: Button[][] } } | undefined)?.keyboard?.inline_keyboard ?? []).flat();

interface PetCall { as?: number; token?: string; startParam?: string; body?: unknown; method?: string; query?: string; agentId?: string; manager?: string }

async function setup(o: { mode?: CirclesMode; mainApp?: string | null } = {}) {
  const h = makeStudio();
  h.studio.deps.webAppUrl = `${ORIGIN}/studio`;
  const org = await seedOrg(h);
  const cookie = await hire(h, org.alice, { name: 'Cookie' }, undefined, 'public');
  const mina = await hire(h, org.alice, { name: 'Mina' }, undefined, 'public');
  h.studio.deps.circles = () => o.mode ?? 'circles';
  h.studio.deps.circleChats = () => new Set([CHAT]);
  h.studio.deps.mainAppBot = () => o.mainApp === undefined ? 'VoxxBot' : o.mainApp ?? undefined;
  const roster = new Set<number>([ID.alice, ID.stranger]);
  const bots = new Set<number>();
  for (const hired of [cookie, mina]) {
    Object.assign(hired.bot(), { getChatMember: vi.fn(async (_chat: number, id: number) => ({ status: roster.has(id) || bots.has(id) ? 'member' : 'left', user: { id, is_bot: bots.has(id), first_name: NAMES[id] ?? 'S' } })) });
    hired.bot().getChatMemberCount.mockImplementation(async () => roster.size + bots.size);
  }
  const add = async (hired: typeof cookie) => {
    bots.add(hired.botId);
    await h.studio.onBotChatMember((await h.store.read()).agents.find((a) => a.id === hired.agent.id)!, added(ID.alice, hired.botId));
  };
  const later = (ms = 1000) => { h.clock.now = new Date(h.clock.now.getTime() + ms); };
  const ledger = h.studio.deps.circleLedger!;
  const doc = () => ledger.get(CHAT);
  const joinCode = async () => (await h.store.read()).groups.find((g) => g.chatId === CHAT)!.joinCode!;
  /** The posted circle card's buttons. */
  const card = (bot = cookie.bot()) => {
    const call = bot.sendMessage.mock.calls.find(([, , opts]) => flat(opts).some((b) => b.callback_data?.startsWith('cj:')))!;
    return { url: flat(call[2]).find((b) => b.url)?.url, data: (p: 'cj' | 'cr' | 'cd') => flat(call[2]).find((b) => b.callback_data?.startsWith(`${p}:`))!.callback_data! };
  };
  const codeFor = async (agentId: string) => `p_${agentShortCode(SECRET, agentId)}_${await joinCode()}`;
  const pet = (path: string[], c: PetCall = {}) => {
    const agentId = c.agentId ?? cookie.agent.id;
    const method = c.method ?? (c.body === undefined ? 'GET' : 'POST');
    const extra: Record<string, string> = c.startParam ? { start_param: c.startParam, chat_type: 'supergroup', chat_instance: '-8812' } : {};
    const request = new Request(`${ORIGIN}/api/studio/pet/${agentId}${path.length ? `/${path.join('/')}` : ''}${c.query ?? ''}`, {
      method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-pet-tz': 'UTC',
        'x-telegram-init-data': agentInit({ id: c.as ?? ID.stranger, first_name: NAMES[c.as ?? ID.stranger] ?? 'S' }, c.token ?? MANAGER, undefined, extra) },
      ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}),
    });
    return handlePetRequest(h.studio, request, agentId, path, c.manager ?? MANAGER);
  };
  /** Cookie opens the circle (one silent card); returns the card's message id. */
  const open = async () => { await add(cookie); later(); return (await doc())!.card!.messageId!; };
  return { h, org, cookie, mina, roster, bots, add, later, ledger, doc, joinCode, card, codeFor, pet, open, send: (u: TelegramUpdate, agentId = cookie.agent.id) => handleAgentUpdate(h.studio, agentId, u) };
}

describe('the group card link (R2 decision 5: a > b > c)', () => {
  it('c: Circles on with no Main Mini App keeps the S2 DM hop, byte for byte', async () => {
    const x = await setup({ mainApp: null });
    await x.open();
    const bot = x.cookie.agent.bot!.username, code = await x.joinCode();
    expect(x.card().url).toBe(`https://t.me/${bot}?start=j_${code}`);
    expect(circleJoinUrl(bot, code)).toBe(`https://t.me/${bot}?start=j_${code}`);
    expect(x.h.studio.petLaunch(x.cookie.agent)).toBeUndefined();
  });

  it('b: STUDIO_MAIN_APP_BOT naming the manager bot opens its Main Mini App with an opaque p_ code of at most 64 characters', async () => {
    const x = await setup();
    await x.open();
    const url = new URL(x.card().url!), code = url.searchParams.get('startapp')!;
    expect(`${url.origin}${url.pathname}`).toBe('https://t.me/VoxxBot');
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(code).toBe(await x.codeFor(x.cookie.agent.id));
    // Opaque: never the agent id; the short is the same 8 characters the server maps back.
    expect(code).not.toContain(x.cookie.agent.id);
    expect(parsePetLaunch(code)).toEqual({ short: agentShortCode(SECRET, x.cookie.agent.id), joinCode: await x.joinCode() });
    // The URL changes, the notice and labels do not: the same copyHash as the DM-hop card.
    expect((await x.doc())!.card!.copyHash).toBe(groupCard(['Cookie'], 'en', { on: false, joined: 0, total: 2 }, true).copyHash);
  });

  it('b is off unless STUDIO_MAIN_APP_BOT names the manager bot itself and Circles is at circles', async () => {
    for (const [mode, mainApp] of [['circles', 'SomeOtherBot'], ['circles', ''], ['reply', 'VoxxBot'], ['off', 'VoxxBot']] as const) {
      const x = await setup({ mode, mainApp });
      expect(x.h.studio.mainApp()).toBeUndefined();
      expect(x.h.studio.petLaunch(x.cookie.agent)).toBeUndefined();
    }
    const x = await setup({ mainApp: '@voxxbot' });
    expect(x.h.studio.mainApp()).toBe('VoxxBot');
  });

  it('a: an agent its owner marked mainMiniApp uses its own bot, ahead of the manager; only someone who manages it can set that', async () => {
    const x = await setup();
    await expect(x.h.studio.setMainMiniApp(await memberOf(x.h, ID.bob), x.cookie.agent.id, true)).rejects.toMatchObject({ status: 403 });
    const view = await x.h.studio.setMainMiniApp(x.org.alice, x.cookie.agent.id, true);
    expect(view.mainMiniApp).toBe(true);
    await x.open();
    const url = new URL(x.card().url!);
    expect(`${url.origin}${url.pathname}`).toBe(`https://t.me/${x.cookie.agent.bot!.username}`);
    expect(url.searchParams.get('startapp')).toBe(await x.codeFor(x.cookie.agent.id));
    expect((await x.h.studio.setMainMiniApp(x.org.alice, x.cookie.agent.id, false)).mainMiniApp).toBe(false);
    expect((await x.h.store.read()).agents.find((a) => a.id === x.cookie.agent.id)).not.toHaveProperty('mainMiniApp');
  });

  it('flag off or reply: no card, no launch route, and a manager signature opens nothing (identical to HEAD)', async () => {
    for (const mode of ['off', 'reply'] as const) {
      const x = await setup({ mode });
      await x.add(x.cookie);
      expect(x.cookie.bot().sendMessage).not.toHaveBeenCalled();
      x.joinCode = async () => 'A'.repeat(22);
      const code = await x.codeFor(x.cookie.agent.id);
      expect((await x.pet([], { startParam: code })).status).toBe(401);
      expect((await x.pet(['circle'], { startParam: code })).status).toBe(401);
    }
  });
});

describe('a pet launched over the group', () => {
  it("opens that person's own pet for the agent the signed code names; talk stays in the agent's DM", async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    const res = await x.pet([], { startParam: code });
    expect(res.status).toBe(200);
    const view = await res.json() as PetView;
    expect(view).toMatchObject({ agentId: x.cookie.agent.id, role: 'guest', talkInDm: true, listen: false, care: { agentId: x.cookie.agent.id, userId: ID.stranger } });
    expect((await x.pet(['care'], { startParam: code, body: { action: 'feed' } })).status).toBe(200);
    // Talk is not a launch route: the manager's signature never speaks to the agent.
    expect((await x.pet(['talk'], { startParam: code, body: { text: 'hi' } })).status).toBe(401);
    // The agent's own launch (route a) is the old path: no talkInDm.
    expect(await (await x.pet([], { token: x.cookie.token, startParam: code })).json()).not.toHaveProperty('talkInDm');
  });

  it('initData from bot A never reads or decides for bot B, and a code for agent X never acts for agent Y', async () => {
    const x = await setup();
    await x.open();
    await x.add(x.mina);
    x.later();
    const cookieCode = await x.codeFor(x.cookie.agent.id), minaCode = await x.codeFor(x.mina.agent.id);
    const revision = (await x.doc())!.card!.id;
    // Cookie's own bot signed it: Mina's routes refuse it.
    expect((await x.pet(['circle'], { token: x.cookie.token, agentId: x.mina.agent.id, query: `?code=${minaCode}` })).status).toBe(401);
    expect((await x.pet(['circle', 'decision'], { token: x.cookie.token, agentId: x.mina.agent.id, body: { code: minaCode, choice: 'joined', revision } })).status).toBe(401);
    // The manager signed a launch for Cookie: Mina's path refuses it, reads and decisions alike.
    for (const path of [[], ['circle'], ['notes']]) expect((await x.pet(path, { startParam: cookieCode, agentId: x.mina.agent.id })).status).toBe(401);
    expect((await x.pet(['circle', 'decision'], { startParam: cookieCode, agentId: x.mina.agent.id, body: { code: cookieCode, choice: 'joined', revision } })).status).toBe(401);
    // ...and a launch for Mina never opens Cookie.
    expect((await x.pet(['circle'], { startParam: minaCode })).status).toBe(401);
    // Cookie's own bot with Mina's code: that code names nothing for Cookie.
    const crossed = await x.pet(['circle', 'decision'], { token: x.cookie.token, body: { code: minaCode, choice: 'joined', revision } });
    expect(crossed.status).toBe(404);
    expect(await crossed.json()).toEqual({ error: 'circle_unavailable' });
    // A manager-signed launch speaks only for its own signed code.
    expect((await x.pet(['circle'], { startParam: cookieCode, query: `?code=${minaCode}` })).status).toBe(404);
    expect((await x.doc())!.participants).toEqual([]);
  });

  it('a manager-signed code must name a group the agent is in, and the manager token must have signed it', async () => {
    const x = await setup();
    await x.open();
    const forged = `p_${agentShortCode(SECRET, x.cookie.agent.id)}_${'B'.repeat(22)}`;
    expect((await x.pet([], { startParam: forged })).status).toBe(401);
    expect((await x.pet([], { startParam: await x.codeFor(x.cookie.agent.id), token: '8888:another-bot-token-abcdefghijk' })).status).toBe(401);
    expect((await x.pet([], { startParam: await x.codeFor(x.cookie.agent.id), manager: '' })).status).toBe(401);
  });
});

describe('joining from the pet', () => {
  it('writes the same ledger state as the group card, with surface mini_app and the same copyHash; the person sees the others by first name', async () => {
    const x = await setup();
    const messageId = await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    x.later();
    const before = await (await x.pet(['circle'], { startParam: code })).json() as PetCircle;
    const doc0 = (await x.doc())!;
    expect(before).toMatchObject({ chatTitle: 'HOOR family', agents: ['Cookie'], joined: 1, total: 2, myState: null,
      card: { copyHash: doc0.card!.copyHash, revision: doc0.card!.id, locale: 'en', copy: { join: 'Join · 18+', reply: 'Only reply to me', decline: 'Not me' } } });
    expect(before.card.copy.notice).toBe(groupCard(['Cookie'], 'en', { on: false, joined: 1, total: 2 }, true).notice);
    expect(before).not.toHaveProperty('members');
    const res = await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision: before.card.revision, eventId: 'tap-0001' } });
    expect(res.status).toBe(200);
    const after = await res.json() as PetCircle;
    expect(after).toMatchObject({ myState: 'joined', joined: 2, total: 2, on: true, members: ['Reza'] });
    const rows = (await x.doc())!.participants, a = rows.find((q) => q.telegramId === ID.alice)!, p = rows.find((q) => q.telegramId === ID.stranger)!;
    const same = (q: typeof a) => ({ state: q.state, consent: { state: q.consent.state, purpose: q.consent.purpose, policyVersion: q.consent.policyVersion }, coveredAgentIds: q.coveredAgentIds,
      evidence: { noticeId: q.evidence.noticeId, noticeVersion: q.evidence.noticeVersion, copyHash: q.evidence.copyHash, locale: q.evidence.locale, presentedAt: q.evidence.presentedAt, adultDeclared: q.evidence.adultDeclared },
      windows: q.windows.length });
    expect(same(p)).toEqual(same(a));
    expect(a.evidence.surface).toBe('group_card');
    expect(p.evidence).toMatchObject({ surface: 'mini_app', eventId: 'pet:tap-0001', copyHash: doc0.card!.copyHash });
    // Their DMs work too: the agent choice, with the same notice, from the mini app.
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toMatchObject({ choice: 'joined', surface: 'mini_app', notice: { copyHash: doc0.card!.copyHash } });
    // A double tap is one decision.
    const again = await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision: before.card.revision, eventId: 'tap-0001' } });
    expect(again.status).toBe(200);
    expect((await x.doc())!.participants.find((q) => q.telegramId === ID.stranger)!.history).toHaveLength(1);
  });

  it('a non-member is refused even with a valid code, and learns nothing about the group', async () => {
    const x = await setup();
    await x.open();
    x.roster.delete(ID.stranger);
    const code = await x.codeFor(x.cookie.agent.id), revision = (await x.doc())!.card!.id;
    const read = await x.pet(['circle'], { startParam: code });
    expect(read.status).toBe(403);
    expect(await read.json()).toEqual({ error: 'circle_not_member' });
    const decided = await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision } });
    expect(decided.status).toBe(403);
    expect(await decided.json()).toEqual({ error: 'circle_not_member' });
    expect((await x.doc())!.participants).toEqual([]);
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toBeUndefined();
  });

  it('the card counter updates through the S2 debounce (one silent edit per 10 s)', async () => {
    const x = await setup();
    const messageId = await x.open();
    const code = await x.codeFor(x.cookie.agent.id), bot = x.cookie.bot();
    const revision = (await x.doc())!.card!.id;
    await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision } });
    expect(bot.editMessageText).toHaveBeenCalledTimes(1);
    expect(bot.editMessageText.mock.calls[0][1]).toBe(messageId);
    expect(bot.editMessageText.mock.calls[0][2]).toContain('Notes: off · 1 of 2 joined');
    x.later(2000);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    expect(bot.editMessageText).toHaveBeenCalledTimes(1);
    x.later(10_000);
    await x.h.studio.circleGroups.refresh(CHAT);
    expect(bot.editMessageText).toHaveBeenCalledTimes(2);
    expect(bot.editMessageText.mock.calls[1][2]).toContain('Notes: on · 2 of 2 joined');
  });

  it('a stale revision is refused and nothing is recorded; Not me and Leave invalidate before the answer and erase nothing', async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id), revision = (await x.doc())!.card!.id;
    const stale = await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision: 'gstalestalest' } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'circle_stale' });
    expect((await x.doc())!.participants).toEqual([]);
    await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision } });
    const epoch = async () => (await x.h.store.read()).groups.find((g) => g.chatId === CHAT)!.audienceEpoch ?? 0;
    const e0 = await epoch();
    x.later(2000);
    const left = await x.pet(['circle', 'leave'], { startParam: code, body: { code } });
    expect(await left.json()).toEqual({ left: true });
    expect(await epoch()).toBe(e0 + 1);
    const row = (await x.doc())!.participants[0];
    expect(row).toMatchObject({ state: 'withdrawn', consent: { state: 'withdrawn' }, coveredAgentIds: [] });
    expect(row.windows).toHaveLength(1);
    expect(row.windows[0].leftAt).toBeDefined();
    // Not me from the pet: a change is invalidated too; a repeat changes nothing.
    x.later(2000);
    const declined = await (await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'declined', revision } })).json() as PetCircle;
    expect(declined.myState).toBe('declined');
    expect(await epoch()).toBe(e0 + 2);
    await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'declined', revision } });
    expect(await epoch()).toBe(e0 + 2);
  });

  it('decisions, leaves and erasures are rate limited like the other pet writes, and need the Studio origin', async () => {
    const x = await setup();
    await x.open();
    x.h.studio.deps.rateLimiter = new StudioRateLimiter({ policies: { mutation: { requests: 1, windowMs: 60_000 } } });
    const code = await x.codeFor(x.cookie.agent.id), revision = (await x.doc())!.card!.id;
    expect((await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'reply_only', revision } })).status).toBe(200);
    expect((await x.pet(['circle', 'leave'], { startParam: code, body: { code } })).status).toBe(429);
    expect((await x.pet(['notes', 'aa-aaaaaaaaaaaa'], { startParam: code, method: 'DELETE' })).status).toBe(429);
    const hostile = new Request(`${ORIGIN}/api/studio/pet/${x.cookie.agent.id}/circle/leave`, { method: 'POST', body: JSON.stringify({ code }),
      headers: { origin: 'https://hostile.example', 'content-type': 'application/json', 'x-telegram-init-data': agentInit({ id: ID.stranger, first_name: 'P' }, MANAGER, undefined, { start_param: code }) } });
    expect((await handlePetRequest(x.h.studio, hostile, x.cookie.agent.id, ['circle', 'leave'], MANAGER)).status).toBe(403);
  });
});

describe('the DM hop (c) into the pet', () => {
  it("a verified j_ link's DM card opens the pet with ?j=, and the agent's own initData reads that group with the bare join code", async () => {
    const x = await setup({ mainApp: null });
    await x.open();
    const code = await x.joinCode(), bot = x.cookie.bot();
    await x.send({ update_id: updateId++, message: { message_id: updateId, date: 0, text: `/start j_${code}`, from: user(ID.stranger), chat: { id: ID.stranger, type: 'private' } } });
    const sent = bot.sendMessage.mock.calls.at(-1)!;
    const pet = (sent[2] as { keyboard: { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> } }).keyboard.inline_keyboard.flat().find((b) => b.web_app)!;
    expect(pet.web_app!.url).toBe(`${ORIGIN}/studio/pet/${x.cookie.agent.id}?j=${code}`);
    const read = await x.pet(['circle'], { token: x.cookie.token, query: `?code=${code}` });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ chatTitle: 'HOOR family', myState: null });
    // A plain /start (no group) keeps the plain pet URL.
    await x.send({ update_id: updateId++, message: { message_id: updateId, date: 0, text: '/start', from: user(ID.stranger), chat: { id: ID.stranger, type: 'private' } } });
    const plain = (bot.sendMessage.mock.calls.at(-1)![2] as { keyboard: { inline_keyboard: Array<Array<{ web_app?: { url: string } }>> } }).keyboard.inline_keyboard.flat().find((b) => b.web_app)!;
    expect(plain.web_app!.url).toBe(`${ORIGIN}/studio/pet/${x.cookie.agent.id}`);
  });
});

describe('notes in the pet', () => {
  it("a guest sees only their own copies (My notes / From this group) and erases only their own copy", async () => {
    const x = await setup();
    await x.open();
    const notes = x.h.studio.deps.notesLedger!, at = x.h.clock.now, gid = groupIdOf(CHAT), cookieId = x.cookie.agent.id;
    const group = { eventId: 'aa-groupsave012', noteId: 'note-shiraz', text: 'Shiraz in May', origin: 'group' as const, savedByAgentId: cookieId, agentIds: [cookieId],
      fromGroupId: gid, groupTitle: 'HOOR family', authorTelegramId: ID.alice, at };
    const mine = await notes.save(ID.stranger, group), theirs = await notes.save(ID.alice, group);
    await notes.save(ID.alice, { eventId: 'aa-alicedm00001', noteId: 'note-alice', text: 'Alice private', origin: 'dm', savedByAgentId: cookieId, agentIds: [cookieId], authorTelegramId: ID.alice, at });
    await notes.save(ID.stranger, { eventId: 'aa-parastoodm01', noteId: 'note-p', text: 'Tea with cardamom', origin: 'dm', savedByAgentId: cookieId, agentIds: [cookieId], authorTelegramId: ID.stranger, at });
    await notes.save(ID.stranger, { eventId: 'aa-parastoomi01', noteId: 'note-m', text: 'For Mina only', origin: 'dm', savedByAgentId: x.mina.agent.id, agentIds: [x.mina.agent.id], authorTelegramId: ID.stranger, at });
    const code = await x.codeFor(cookieId);
    const listed = await (await x.pet(['notes'], { startParam: code })).json() as PetNotesResponse;
    expect(listed.group.map((n) => n.text)).toEqual(['Shiraz in May']);
    expect(listed.group[0]).not.toHaveProperty('byMe');
    expect(listed.mine.map((n) => [n.text, n.byMe])).toEqual([['Tea with cardamom', true]]);
    expect(JSON.stringify(listed)).not.toMatch(/Alice private|For Mina only|authorTelegramId|300/);
    // Erasing removes only the requester's copy; another person's copy id is never theirs to erase.
    const ok = mine.ok ? mine.copyId : '', other = theirs.ok ? theirs.copyId : '';
    expect(await (await x.pet(['notes', other], { startParam: code, method: 'DELETE' })).json()).toEqual({ erased: false });
    expect(await (await x.pet(['notes', ok], { startParam: code, method: 'DELETE' })).json()).toEqual({ erased: true });
    expect((await notes.read(ID.alice))!.copies.find((c) => c.copyId === other)).toMatchObject({ status: 'active', text: 'Shiraz in May' });
    expect((await (await x.pet(['notes'], { startParam: code })).json() as PetNotesResponse).group).toEqual([]);
  });

  it('with Circles not at circles there are no notes to show', async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    x.h.studio.deps.circles = () => 'reply';
    // The manager route is off with the flag; the agent's own bot sees no notes either.
    expect((await x.pet(['notes'], { startParam: code })).status).toBe(401);
    // The agent's own bot never serves notes now (hotfix): they are read and erased in Vox.
    const own = await x.pet(['notes'], { token: x.cookie.token, query: `?code=${code}` });
    expect(own.status).toBe(403);
    expect(await own.json()).toEqual({ error: 'circle_use_vox' });
  });
});

describe('the pet launch page resolver', () => {
  const resolve = (x: Awaited<ReturnType<typeof setup>>, code: string, token = MANAGER, manager = MANAGER) =>
    handlePetLaunch(x.h.studio, new Request(`${ORIGIN}/api/studio/pet/launch`, { headers: { 'x-telegram-init-data': agentInit({ id: ID.stranger, first_name: 'P' }, token, undefined, { start_param: code }) } }), manager);

  it('maps a signed launch code to its agent (manager bot, or the agent bot itself), and nothing else', async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    expect(await (await resolve(x, code)).json()).toEqual({ agentId: x.cookie.agent.id });
    expect(await (await resolve(x, code, x.cookie.token)).json()).toEqual({ agentId: x.cookie.agent.id });
    expect((await resolve(x, code, '8888:another-bot-token-abcdefghijk')).status).toBe(401);
    expect((await resolve(x, `p_${agentShortCode(SECRET, x.mina.agent.id)}_${await x.joinCode()}`)).status).toBe(404);
    expect((await resolve(x, 'p_junk')).status).toBe(404);
    x.h.studio.deps.circles = () => 'reply';
    expect((await resolve(x, code)).status).toBe(404);
  });

  it("the agent's own bot branch needs Telegram's signature: missing or forged is 401; the manager's present signature must verify", async () => {
    const x = await setup({ mainApp: null });
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    const launch = (init: string) => handlePetLaunch(x.h.studio, new Request(`${ORIGIN}/api/studio/pet/launch`, { headers: { 'x-telegram-init-data': init } }), MANAGER);
    const who = { id: ID.stranger, first_name: 'P' };
    expect((await launch(agentInit(who, x.cookie.token, undefined, { start_param: code }))).status).toBe(200);
    expect((await launch(signInitData(who, x.cookie.token, undefined, { start_param: code }))).status).toBe(401);
    const otherKey = generateKeyPairSync('ed25519').privateKey;
    expect((await launch(signInitData(who, x.cookie.token, undefined, { start_param: code }, { botId: x.cookie.botId, privateKey: otherKey }))).status).toBe(401);
    // the shadow switch relaxes this low-value lookup only for a missing signature, never a forged one
    x.h.studio.deps.initDataSignature = () => 'shadow';
    expect((await launch(signInitData(who, x.cookie.token, undefined, { start_param: code }))).status).toBe(200);
    expect((await launch(signInitData(who, x.cookie.token, undefined, { start_param: code }, { botId: x.cookie.botId, privateKey: otherKey }))).status).toBe(401);
  });
});

describe('S4 review fixes', () => {
  it("route b says the 📌 copies come from the agent's own bot (dm), so the pet never asks write access for the manager; route a and the DM pet do not", async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    const viaManager = await (await x.pet(['circle'], { startParam: code })).json() as PetCircle;
    expect(viaManager.dm).toEqual({ bot: x.cookie.agent.bot!.username, name: 'Cookie' });
    const revision = viaManager.card.revision;
    const joined = await (await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision } })).json() as PetCircle;
    expect(joined.dm).toEqual({ bot: x.cookie.agent.bot!.username, name: 'Cookie' });
    // The agent's own bot opened it (route a, or the DM's ?j= pet): its write access is the right one, no dm.
    expect(await (await x.pet(['circle'], { token: x.cookie.token, startParam: code, query: `?code=${code}` })).json()).not.toHaveProperty('dm');
    expect(await (await x.pet(['circle'], { token: x.cookie.token, query: `?code=${await x.joinCode()}` })).json()).not.toHaveProperty('dm');
  });

  it('someone Telegram says left the group is never named to the others, and is marked left', async () => {
    const x = await setup();
    const messageId = await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    x.later();
    const revision = (await x.doc())!.card!.id;
    expect(await (await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision } })).json()).toMatchObject({ joined: 2, members: ['Reza'] });
    // Alice leaves the Telegram group; the ledger has not heard (no chat_member update).
    x.roster.delete(ID.alice);
    x.later(20_000);
    const after = await (await x.pet(['circle'], { startParam: code })).json() as PetCircle;
    expect(after.members).toEqual([]);
    expect(after.joined).toBe(1);
    expect((await x.doc())!.participants.find((q) => q.telegramId === ID.alice)!.state).toBe('left');
    // Telegram failing to answer (unknown) names nobody either, and marks nobody left.
    x.roster.add(ID.alice);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    x.later(20_000);
    x.cookie.bot().getChatMember.mockImplementation(async (_c: number, id: number) => {
      if (id === ID.alice) throw new Error('telegram down');
      return { status: 'member', user: { id, is_bot: false, first_name: NAMES[id] ?? 'S' } };
    });
    expect((await (await x.pet(['circle'], { startParam: code })).json() as PetCircle).members).toEqual([]);
    expect((await x.doc())!.participants.find((q) => q.telegramId === ID.alice)!.state).toBe('joined');
  });

  it('a chat pulled from STUDIO_CIRCLE_CHATS stops the manager-signed entrance too: launch, view and care', async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id);
    const resolve = () => handlePetLaunch(x.h.studio, new Request(`${ORIGIN}/api/studio/pet/launch`, { headers: { 'x-telegram-init-data': agentInit({ id: ID.stranger, first_name: 'P' }, MANAGER, undefined, { start_param: code }) } }), MANAGER);
    expect((await resolve()).status).toBe(200);
    expect((await x.pet([], { startParam: code })).status).toBe(200);
    x.h.studio.deps.circleChats = () => new Set();
    expect((await resolve()).status).toBe(404);
    for (const [path, c] of [[[], {}], [['care'], { body: { action: 'feed' } }], [['circle'], {}]] as const) {
      expect((await x.pet([...path], { startParam: code, ...c })).status).toBe(401);
    }
    // export left the pet altogether (moved to My data), whoever signs
    expect((await x.pet(['export'], { startParam: code })).status).toBe(410);
    // The agent's own bot still opens its own pet (that never depended on the group).
    expect((await x.pet([], { token: x.cookie.token })).status).toBe(200);
  });

  it("a pet decision checks the card's agents' blocks, whichever agent's pet asks", async () => {
    const x = await setup();
    await x.open();
    await x.add(x.mina);
    x.later();
    await x.h.store.update((s) => { s.agents.find((a) => a.id === x.cookie.agent.id)!.blocked = [ID.stranger]; });
    const revision = (await x.doc())!.card!.id, joinCode = await x.joinCode();
    expect((await x.doc())!.card!.agentIds).toEqual([x.cookie.agent.id]);
    const viaMina = await x.pet(['circle', 'decision'], { token: x.mina.token, agentId: x.mina.agent.id, body: { code: joinCode, choice: 'joined', revision } });
    expect(viaMina.status).toBe(404);
    expect(await viaMina.json()).toEqual({ error: 'circle_unavailable' });
    expect((await x.doc())!.participants).toEqual([]);
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toBeUndefined();
    // Unblocked, the same request joins.
    await x.h.store.update((s) => { s.agents.find((a) => a.id === x.cookie.agent.id)!.blocked = []; });
    expect((await x.pet(['circle', 'decision'], { token: x.mina.token, agentId: x.mina.agent.id, body: { code: joinCode, choice: 'joined', revision } })).status).toBe(200);
  });

  it('a store failing under a circle route answers circle_failed (shown in the sheet), never pet_unavailable', async () => {
    const x = await setup();
    await x.open();
    const code = await x.codeFor(x.cookie.agent.id), notes = x.h.studio.deps.notesLedger!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(notes, 'read').mockRejectedValue(new Error('firestore unavailable'));
    vi.spyOn(notes, 'erase').mockRejectedValue(new Error('firestore unavailable'));
    for (const res of [await x.pet(['notes'], { startParam: code }), await x.pet(['notes', `${ID.stranger.toString(36)}-aaaaaaaaaaaa`], { startParam: code, method: 'DELETE' })]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'circle_failed' });
    }
    vi.spyOn(x.h.studio.circleGroups, 'leave').mockRejectedValue(new Error('transaction failed'));
    const left = await x.pet(['circle', 'leave'], { startParam: code, body: { code } });
    expect(left.status).toBe(503);
    expect(await left.json()).toEqual({ error: 'circle_failed' });
    // Refusals keep their own codes.
    expect(await (await x.pet(['circle', 'decision'], { startParam: code, body: { code, choice: 'joined', revision: 'gstalestalest' } })).json()).toEqual({ error: 'circle_stale' });
    warn.mockRestore();
  });
});
