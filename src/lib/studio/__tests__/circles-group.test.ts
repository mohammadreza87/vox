/**
 * Circles S2 (GROUP_AGENTS_SPEC §9 S2 as amended by R2): the circle ledger, the in-group Join card and
 * "N of M". A host-added agent in an allowlisted chat posts one silent card; taps are checked (current
 * card, present member, not blocked, ≤12, flag, idempotent) and committed before any acknowledgement;
 * withdrawals invalidate every agent before they are acknowledged; leaving erases nothing (membership
 * windows close); cards and nudges show counts only; the kill switch restores today's behaviour.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { TelegramApiError, type TelegramChatMemberUpdated, type TelegramMessage, type TelegramUpdate, type TelegramUser } from '../../tireh/telegram/client';
import { PURPOSES } from '../../adaptive/types';
import { AdaptiveRepository, accountIdFor, OPTIONAL_PURPOSES } from '../../adaptive/persistence/repository';
import { FirestoreAdaptiveStorage, MemoryAdaptiveStorage } from '../../adaptive/persistence/storage';
import { CIRCLE_COLLECTION, CircleRepository, circleKey, MAX_CIRCLE_BYTES } from '../../circles/repository';
import { CircleService, groupIdOf } from '../../circles/service';
import { CIRCLE_MAX_WINDOWS, type CircleDocument, type CircleParticipant } from '../../circles/contracts';
import { ALERT_MAX, GROUP_NOTICE, groupCard, groupCopy, includeCard, joinedAlert, nameAlert, welcomeText } from '../../circles/notice';
import { circleJoinUrl, parseCircleChats } from '../../circles/codec';
import { groupId } from '../org-bridge';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const CHAT = -100777;
const SARA = 1234;
let updateId = 880_000;
const EN = groupCopy('en');
type Button = { text: string; callback_data?: string; url?: string };
const buttonsOf = (options: unknown) => ((options as { keyboard?: { inline_keyboard: Button[][] } } | undefined)?.keyboard?.inline_keyboard ?? []);
const flat = (options: unknown) => buttonsOf(options).flat();

beforeEach(() => { vi.stubEnv('STUDIO_GROUP_OBSERVATION', 'on'); vi.stubEnv('TIREH_CACHED_PROMPT', ''); });
afterEach(() => vi.unstubAllEnvs());

const user = (id: number, first_name = id === ID.stranger ? 'Parastoo' : 'Reza', language_code?: string): TelegramUser =>
  ({ id, is_bot: false, first_name, ...(language_code ? { language_code } : {}) });
const added = (from: number, status = 'member', chatId = CHAT): TelegramChatMemberUpdated => ({
  chat: { id: chatId, type: 'supergroup', title: 'HOOR family' }, from: user(from), date: 0,
  old_chat_member: { status: 'left', user: { id: 1, is_bot: true, first_name: 'b' } }, new_chat_member: { status, user: { id: 1, is_bot: true, first_name: 'b' } },
});
function groupMessage(from: number, text: string, extra: Partial<TelegramMessage> = {}): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, from: user(from), chat: { id: CHAT, type: 'supergroup' }, date: 0, text, ...extra } };
}
function tap(from: number, data: string, messageId: number, callbackId = `cb-${updateId}`, language_code?: string): TelegramUpdate {
  return { update_id: updateId++, callback_query: { id: callbackId, from: user(from, 'X', language_code), data, message: { message_id: messageId, date: 0, chat: { id: CHAT, type: 'supergroup' } } } };
}
function dm(from: number, text: string): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, date: 0, text, from: user(from), chat: { id: from, type: 'private' } } };
}
const later = (h: Harness, ms = 1000) => { h.clock.now = new Date(h.clock.now.getTime() + ms); };

async function setup(options: { mode?: 'circles' | 'reply' | 'off'; allow?: boolean } = {}) {
  const h = makeStudio();
  const org = await seedOrg(h);
  const cookie = await hire(h, org.alice, { name: 'Cookie', role: 'Companion' }, undefined, 'public');
  h.studio.deps.circles = () => options.mode ?? 'circles';
  h.studio.deps.circleChats = () => new Set(options.allow === false ? [] : [CHAT]);
  /** Who Telegram says is in the chat; Vox bots join it as they are added. */
  const roster = new Set<number>([ID.alice, ID.stranger]);
  const bots = new Set<number>();
  const telegram = (hired: { bot: () => ReturnType<typeof cookie.bot>; botId: number }) => {
    Object.assign(hired.bot(), { getChatMember: vi.fn(async (_chat: number, id: number) => ({ status: roster.has(id) || bots.has(id) ? 'member' : 'left', user: { id, is_bot: bots.has(id), first_name: 'S' } })) });
    hired.bot().getChatMemberCount.mockImplementation(async () => roster.size + bots.size);
  };
  telegram(cookie);
  const ledger = h.studio.deps.circleLedger!;
  const add = async (hired: typeof cookie, from = ID.alice) => {
    bots.add(hired.botId);
    await h.studio.onBotChatMember((await h.store.read()).agents.find((a) => a.id === hired.agent.id)!, added(from));
  };
  const send = (u: TelegramUpdate, agentId = cookie.agent.id) => handleAgentUpdate(h.studio, agentId, u);
  /** The posted circle card: [chatId, text, options] and its callback data. */
  const card = (bot = cookie.bot()) => {
    const call = bot.sendMessage.mock.calls.find(([, , o]) => flat(o).some((b) => b.callback_data?.startsWith('cj:')))!;
    const data = (p: 'cj' | 'cr' | 'cd') => flat(call[2]).find((b) => b.callback_data?.startsWith(`${p}:`))!.callback_data!;
    return { call, data };
  };
  return { h, org, cookie, ledger, roster, bots, telegram, add, send, card, doc: () => ledger.get(CHAT) };
}

/** Adds Cookie and returns the card's message id (what Telegram returned for the post). */
async function opened(x: Awaited<ReturnType<typeof setup>>) {
  await x.add(x.cookie);
  const doc = await x.doc();
  later(x.h);
  return doc!.card!.messageId!;
}

describe('opening a circle', () => {
  it('a host-added agent in an allowlisted chat posts one silent card, "0 of 2" with Vox bots excluded, and stores its message id', async () => {
    const x = await setup();
    await x.add(x.cookie);
    const sent = x.cookie.bot().sendMessage.mock.calls;
    expect(sent).toHaveLength(1);
    const [chatId, text, options] = sent[0];
    const group = (await x.h.store.read()).groups[0];
    const url = circleJoinUrl(x.cookie.agent.bot!.username, group.joinCode!);
    const expected = groupCard(['Cookie'], 'en', { on: false, joined: 0, total: 2 }, true);
    expect(chatId).toBe(CHAT);
    expect(text).toBe(expected.text);
    expect(text).toContain('Notes: off · 0 of 2 joined');
    // R2: notes are kept by each member; notes saved while you're here stay with everyone who was here; adults only.
    expect(text).toContain('Every member who joins keeps their own copy');
    expect(text).toContain("Notes saved while you're here stay with everyone who was here.");
    expect(text).toContain('Adults (18+) only.');
    expect(options).toMatchObject({ silent: true });
    const rows = buttonsOf(options);
    expect(rows[0].map((b) => b.text)).toEqual(['Join · 18+', 'Only reply to me', 'Not me']);
    expect(new Set(rows[0].map((b) => b.callback_data!.slice(3))).size).toBe(1);
    expect(rows[1]).toEqual([{ text: 'Details & pet 🐾', url }]);
    expect(url).toBe(`https://t.me/${x.cookie.agent.bot!.username}?start=j_${group.joinCode}`);
    for (const b of rows.flat()) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    const doc = await x.doc();
    expect(doc).toMatchObject({ groupId: groupId(CHAT), chatId: CHAT, status: 'active', openedBy: { telegramId: ID.alice }, participants: [], readers: { humans: 2 },
      card: { agentId: x.cookie.agent.id, agentIds: [x.cookie.agent.id], messageId: expect.any(Number), noticeVersion: GROUP_NOTICE.version, copyHash: expected.copyHash, locale: 'en', shown: { joined: 0, total: 2, on: false } } });
    // The ledger is its own store: never the single Studio document.
    expect(readFileSync(join(x.h.dir, 'studio.json'), 'utf8')).not.toMatch(/participants|copyHash/);
    // A redelivered my_chat_member posts nothing more.
    await x.add(x.cookie);
    expect(x.cookie.bot().sendMessage).toHaveBeenCalledTimes(1);
  });

  it('a stranger-added public agent never opens a circle, even in an allowlisted chat', async () => {
    const x = await setup();
    await x.add(x.cookie, ID.stranger);
    expect(x.cookie.bot().sendMessage).not.toHaveBeenCalled();
    expect(x.cookie.bot().leaveChat).not.toHaveBeenCalled();
    expect((await x.h.store.read()).groups).toHaveLength(1);
    expect(await x.doc()).toBeNull();
  });

  for (const [label, options] of [['STUDIO_CIRCLES=off', { mode: 'off' }], ['STUDIO_CIRCLES=reply', { mode: 'reply' }], ['a chat not on STUDIO_CIRCLE_CHATS', { allow: false }]] as const) {
    it(`${label}: no card, and no circle key is written`, async () => {
      const x = await setup(options);
      await x.add(x.cookie);
      expect(x.cookie.bot().sendMessage).not.toHaveBeenCalled();
      expect(existsSync(join(x.h.dir, 'circles', 'ledger'))).toBe(false);
      expect((await x.h.store.read()).groups[0].joinCode).toBeUndefined();
    });
  }

  it('fails closed when Telegram cannot count: the card says "N joined" and the circle is never complete', async () => {
    const x = await setup();
    x.cookie.bot().getChatMemberCount.mockRejectedValue(new Error('timeout'));
    await x.add(x.cookie);
    expect(x.cookie.bot().sendMessage.mock.calls[0][1]).toContain('Notes: off · 0 joined');
    expect((await x.doc())!.readers).toMatchObject({ humans: null });
    expect((await x.h.studio.circleGroups.audience(CHAT)).complete).toBe(false);
  });

  it('a second host-added agent posts its own include card; a stranger-added one does not', async () => {
    const x = await setup();
    const mina = await hire(x.h, x.org.alice, { name: 'Mina' }, undefined, 'public');
    x.telegram(mina);
    await opened(x);
    await x.add(mina);
    const [[, text, options]] = mina.bot().sendMessage.mock.calls;
    expect(text).toBe(includeCard('Mina', 'en', 0, 2).text);
    expect(text).toContain('0 of 2 said yes');
    expect(options).toMatchObject({ silent: true });
    expect(flat(options)).toEqual([{ text: 'Include Mina', callback_data: expect.stringMatching(/^ci:/) }]);
    expect((await x.doc())!.agents.map((a) => [a.agentId, a.status])).toEqual([[x.cookie.agent.id, 'active'], [mina.agent.id, 'active']]);

    const y = await setup();
    const zed = await hire(y.h, y.org.alice, { name: 'Zed' }, undefined, 'public');
    y.telegram(zed);
    await opened(y);
    await y.add(zed, ID.stranger);
    expect(zed.bot().sendMessage).not.toHaveBeenCalled();
    expect((await y.doc())!.agents.map((a) => a.agentId)).toEqual([y.cookie.agent.id]);
  });
});

describe('the in-group Join tap', () => {
  it('commits joined with full evidence in one transaction, and only then alerts, records the agent choice and edits the card to "1 of 2"', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const bot = x.cookie.bot();
    const before = (await x.doc())!.revision;
    const seen: Record<string, unknown> = {};
    bot.answerCallbackQuery.mockImplementation(async () => {
      const doc = await x.doc();
      seen.alert = { revision: doc!.revision, state: doc!.participants[0]?.state, choices: (await x.h.studio.deps.choices!.listForUser(ID.stranger)).length, edits: bot.editMessageText.mock.calls.length };
      return true;
    });
    bot.editMessageText.mockImplementation(async () => { seen.edit = { choices: (await x.h.studio.deps.choices!.listForUser(ID.stranger)).length }; return true; });
    const index = vi.spyOn(x.ledger.repository, 'updateIndex'), decide = vi.spyOn(x.ledger, 'decide');
    const update = tap(ID.stranger, x.card().data('cj'), messageId);
    await x.send(update);
    // Person index before the circle commit; the commit is the only change the alert can see.
    expect(index.mock.invocationCallOrder[0]).toBeLessThan(decide.mock.invocationCallOrder[0]);
    expect(seen.alert).toEqual({ revision: before + 1, state: 'joined', choices: 0, edits: 0 });
    expect(seen.edit).toEqual({ choices: 1 });
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith(update.callback_query!.id, EN.alert.joined('Cookie'), true);
    const doc = (await x.doc())!;
    const decidedAt = x.h.clock.now.toISOString();
    expect(doc.participants).toEqual([{
      telegramId: ID.stranger, personId: `tg-${ID.stranger}`, key: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/), state: 'joined', coveredAgentIds: [x.cookie.agent.id],
      consent: { id: `consent:${groupId(CHAT)}:${ID.stranger}`, revision: 1, purpose: 'optional.group_memory', purposeVersion: 1, policyVersion: 'circle-v1', state: 'granted',
        epoch: 1, effectiveAt: decidedAt, expiresAt: new Date(x.h.clock.now.getTime() + 365 * 86_400_000).toISOString() },
      evidence: { eventId: update.callback_query!.id, noticeId: 'notice:optional.group_memory', noticeVersion: 'circle-v1', copyHash: doc.card!.copyHash, locale: 'en',
        presentedAt: doc.card!.revisionAt, decidedAt, surface: 'group_card', affirmative: true, adultDeclared: true },
      history: [{ state: 'joined', at: decidedAt, eventId: update.callback_query!.id }],
      windows: [{ joinedAt: decidedAt }],
    }]);
    expect(Date.parse(doc.participants[0].evidence.presentedAt)).toBeLessThan(Date.parse(decidedAt));
    expect(bot.editMessageText).toHaveBeenCalledWith(CHAT, messageId, groupCard(['Cookie'], 'en', { on: false, joined: 1, total: 2 }, true).text, expect.objectContaining({ inline_keyboard: expect.any(Array) }));
    expect(bot.editMessageText.mock.calls[0][2]).toContain('1 of 2 joined');
    // Her DMs work too: the S1 choice is joined for the covered agent, from the group card.
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toMatchObject({ choice: 'joined', surface: 'group_card', eventId: update.callback_query!.id, adultDeclaredAt: decidedAt,
      notice: { id: 'notice:optional.group_memory', version: 'circle-v1', copyHash: doc.card!.copyHash, locale: 'en' } });
    expect(await x.ledger.repository.readIndex(ID.stranger)).toEqual({ v: 1, groupIds: [groupId(CHAT)] });
  });

  it('a non-member pressing in a public group is refused by getChatMember, and nothing is recorded', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const outsider = 4321;
    await x.send(tap(outsider, x.card().data('cj'), messageId));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notMember, true);
    expect((await x.doc())!.participants).toEqual([]);
    expect(await x.ledger.repository.readIndex(outsider)).toEqual({ v: 1, groupIds: [] });
  });

  it('a stale card, a blocked person, a full circle and the kill switch refuse in that order', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const bot = x.cookie.bot();
    await x.send(tap(ID.stranger, 'cj:gstalestalest', messageId));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.expired, true);
    await x.h.store.update((s) => { s.agents[0].blocked = [ID.stranger]; });
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String));
    await x.h.store.update((s) => { s.agents[0].blocked = []; });
    // Twelve joined already: a thirteenth Join is refused, a Not me is not.
    await x.ledger.repository.transaction(groupIdOf(CHAT), (doc) => {
      for (let i = 0; i < 12; i++) doc!.participants.push({ ...structuredClone(fakeJoined(doc!, 50_000 + i)) });
      return { document: doc, result: undefined };
    });
    for (let i = 0; i < 12; i++) x.roster.add(50_000 + i);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.full, true);
    x.h.studio.deps.circleChats = () => new Set();
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    // Off for this chat: the tap never reaches the ledger.
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.unavailable, true);
    x.h.studio.deps.circleChats = () => new Set([CHAT]);
    x.h.studio.deps.circles = () => 'reply';
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    expect((await x.doc())!.participants.some((p) => p.telegramId === ID.stranger)).toBe(false);
  });

  it('is idempotent by callback_query.id: a second delivery of the same tap commits nothing more', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const data = x.card().data('cj');
    await x.send(tap(ID.stranger, data, messageId, 'same-callback'));
    const after = (await x.doc())!;
    later(x.h, 20_000);
    await x.send(tap(ID.stranger, data, messageId, 'same-callback'));
    const again = (await x.doc())!;
    expect(again.participants).toEqual(after.participants);
    expect(again.events.filter((e) => e.id === 'same-callback')).toHaveLength(1);
    expect((await x.h.studio.deps.choices!.listForUser(ID.stranger))[0].join!.revision).toBe(1);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenCalledTimes(2);
    // The same update redelivered is handled once.
    const update = tap(ID.stranger, data, messageId, 'other-callback');
    await x.send(update);
    await x.send(update);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenCalledTimes(3);
  });

  it('Not me and Only reply never name anyone: the group sees counts only', async () => {
    const x = await setup();
    const messageId = await opened(x);
    x.roster.add(ID.bob);
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.bob, x.card().data('cr'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    const bot = x.cookie.bot();
    const posted = [...bot.sendMessage.mock.calls.map(([, text]) => text), ...bot.editMessageText.mock.calls.map(([, , text]) => text)];
    expect(posted.length).toBeGreaterThan(1);
    for (const text of posted) for (const name of ['Parastoo', 'Bob', 'Alice', 'Reza', String(ID.stranger), String(ID.bob)]) expect(text).not.toContain(name);
    expect(bot.editMessageText.mock.calls.at(-1)![2]).toContain('Notes: off · 1 of 3 joined');
    expect((await x.doc())!.participants.map((p) => [p.telegramId, p.state, p.consent.state, p.evidence.adultDeclared])).toEqual([
      [ID.stranger, 'declined', 'declined', false], [ID.bob, 'reply_only', 'declined', false], [ID.alice, 'joined', 'granted', true]]);
    // The alerts went to the tapper only.
    expect(bot.answerCallbackQuery.mock.calls.map(([, text, alert]) => [text, alert])).toEqual([[EN.alert.declined(), true], [EN.alert.reply_only(), true], [EN.alert.joined('Cookie'), true]]);
  });

  it('Persian taps get Persian alerts; the evidence keeps the card\'s locale and copy hash', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId, 'fa-tap', 'fa'));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith('fa-tap', groupCopy('fa').alert.joined('Cookie'), true);
    expect((await x.doc())!.participants[0].evidence).toMatchObject({ locale: 'en', copyHash: groupCard(['Cookie'], 'en', { on: false, joined: 0, total: 2 }, true).copyHash });
  });
});

/** A joined participant row for seeding (consent valid a year from the doc's card time). */
function fakeJoined(doc: { groupId: string; card?: { copyHash: string; revisionAt: string; agentIds: string[] } }, telegramId: number) {
  const at = new Date(Date.parse(doc.card!.revisionAt) + 1).toISOString();
  return { telegramId, personId: `tg-${telegramId}`, key: `seedkey${telegramId}`.padEnd(16, '_'), state: 'joined' as const, coveredAgentIds: [...doc.card!.agentIds],
    consent: { id: `consent:${doc.groupId}:${telegramId}`, revision: 1, purpose: 'optional.group_memory' as const, purposeVersion: 1 as const, policyVersion: 'circle-v1' as const, state: 'granted' as const, epoch: 1, effectiveAt: at, expiresAt: new Date(Date.parse(at) + 365 * 86_400_000).toISOString() },
    evidence: { eventId: `seed-${telegramId}`, noticeId: 'notice:optional.group_memory', noticeVersion: 'circle-v1', copyHash: doc.card!.copyHash, locale: 'en' as const, presentedAt: doc.card!.revisionAt, decidedAt: at, surface: 'group_card' as const, affirmative: true as const, adultDeclared: true },
    history: [], windows: [{ joinedAt: at }] };
}

describe('N of M and "Everyone\'s in"', () => {
  it('posts "Everyone\'s in" once, with a normal notification, when N reaches M; edits are debounced to one per 10 s', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const bot = x.cookie.bot();
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    expect(bot.editMessageText).toHaveBeenCalledTimes(1);
    later(x.h, 2000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    // Within 10 s of the last edit: no edit yet; the next refresh after the window catches up.
    expect(bot.editMessageText).toHaveBeenCalledTimes(1);
    const everyone = () => bot.sendMessage.mock.calls.filter(([, text]) => text === EN.everyone('Cookie'));
    expect(everyone()).toHaveLength(1);
    expect(everyone()[0][2]).toBeUndefined();
    later(x.h, 10_000);
    await x.h.studio.circleGroups.refresh(CHAT);
    expect(bot.editMessageText).toHaveBeenCalledTimes(2);
    expect(bot.editMessageText.mock.calls[1][2]).toContain('Notes: on · 2 of 2 joined');
    expect(await x.h.studio.circleGroups.audience(CHAT)).toMatchObject({ complete: true, joined: 2, humans: 2 });
    // Leave and rejoin the same day: no second celebration.
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(everyone()).toHaveLength(1);
    later(x.h, 25 * 3_600_000);
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    later(x.h, 1000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(everyone()).toHaveLength(2);
  });

  it('the audience: complete only when every human reader joined; coveredBy names only agents every reader covers; hasGuests is unchanged', async () => {
    const x = await setup();
    const mina = await hire(x.h, x.org.alice, { name: 'Mina' }, undefined, 'public');
    x.telegram(mina);
    const messageId = await opened(x);
    await x.add(mina);
    later(x.h);
    const include = flat(mina.bot().sendMessage.mock.calls[0][2])[0].callback_data!;
    const minaCard = (await x.doc())!.agents[1].card!.messageId!;
    // Not joined yet: Include is refused.
    await x.send(tap(ID.stranger, include, minaCard), mina.agent.id);
    expect(mina.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.joinFirst, true);
    for (const who of [ID.alice, ID.stranger]) { await x.send(tap(who, x.card().data('cj'), messageId)); later(x.h, 11_000); }
    let audience = await x.h.studio.circleGroups.audience(CHAT);
    expect(audience).toMatchObject({ complete: true, joined: 2, humans: 2 });
    expect(audience.coveredBy(x.cookie.agent.id)).toBe(true);
    expect(audience.coveredBy(mina.agent.id)).toBe(false);
    await x.send(tap(ID.stranger, include, minaCard), mina.agent.id);
    expect(mina.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.included('Mina'), true);
    expect(await x.h.studio.agentChoice(mina.agent.id, ID.stranger)).toMatchObject({ choice: 'joined', surface: 'group_card' });
    expect((await x.h.studio.circleGroups.audience(CHAT)).coveredBy(mina.agent.id)).toBe(false);
    later(x.h, 11_000);
    await x.send(tap(ID.alice, include, minaCard), mina.agent.id);
    audience = await x.h.studio.circleGroups.audience(CHAT);
    expect(audience.coveredBy(mina.agent.id)).toBe(true);
    expect(mina.bot().editMessageText.mock.calls.at(-1)![2]).toContain('2 of 2 said yes');
    // A guest still reads this group: hasGuests (org and private memory) keeps its meaning.
    const verified = await x.h.studio.verifyGroupAudience(x.cookie.agent.id, CHAT);
    expect((await x.h.store.read()).groups[0].hasGuests).toBe(true);
    expect(verified).toMatchObject({ count: 4 });
    expect([...verified!.verifiedHumans].sort()).toEqual([ID.stranger, ID.alice].sort());
    // A third person in the chat: no longer complete, with or without a join.
    x.roster.add(SARA);
    await x.h.studio.verifyGroupAudience(x.cookie.agent.id, CHAT);
    expect((await x.h.studio.circleGroups.audience(CHAT)).complete).toBe(false);
    // The kill switch: never complete.
    x.roster.delete(SARA);
    await x.h.studio.verifyGroupAudience(x.cookie.agent.id, CHAT);
    expect((await x.h.studio.circleGroups.audience(CHAT)).complete).toBe(true);
    x.h.studio.deps.circles = () => 'reply';
    expect((await x.h.studio.circleGroups.audience(CHAT)).complete).toBe(false);
  });

  it('listGroups gains joined, total and notes, counts only', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    const [group] = await x.h.studio.listGroups(x.org.alice);
    expect(group).toMatchObject({ chatId: CHAT, joined: 1, total: 2, notes: 'off' });
    x.h.studio.deps.circles = () => 'off';
    const [off] = await x.h.studio.listGroups(x.org.alice);
    expect(off).not.toHaveProperty('joined');
    expect(off).not.toHaveProperty('notes');
  });
});

describe('withdrawal and leaving', () => {
  it('/leave in the group flips the state, consent and card, and bumps the audience, before acknowledging', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    const bot = x.cookie.bot();
    const epoch = (await x.h.store.read()).groups[0].audienceEpoch ?? 0;
    let seen: unknown;
    bot.sendMessage.mockImplementation(async (chatId: number, text: string) => {
      if (text === EN.left) {
        const doc = (await x.doc())!, p = doc.participants[0];
        seen = { state: p.state, consent: p.consent.state, window: p.windows[0].leftAt !== undefined, card: doc.card!.shown, edited: bot.editMessageText.mock.calls.at(-1)![2], epoch: (await x.h.store.read()).groups[0].audienceEpoch };
      }
      return { message_id: 9, date: 0, chat: { id: chatId, type: 'supergroup' } } as TelegramMessage;
    });
    const leave = groupMessage(ID.stranger, '/leave');
    await x.send(leave);
    expect(seen).toEqual({ state: 'withdrawn', consent: 'withdrawn', window: true, card: { joined: 0, total: 2, on: false }, edited: expect.stringContaining('0 of 2 joined'), epoch: expect.any(Number) });
    expect((seen as { epoch: number }).epoch).toBeGreaterThan(epoch);
    expect(bot.sendMessage).toHaveBeenLastCalledWith(CHAT, EN.left, { replyTo: leave.message!.message_id, silent: true });
    // No model call for it, and a second /leave is told they're not in.
    expect(x.h.chatLLM.replyRequests).toEqual([]);
    await x.send(groupMessage(ID.stranger, '/leave'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(CHAT, EN.notIn, expect.objectContaining({ silent: true }));
  });

  it('Not me after joining withdraws: the commit, then every agent\'s window and epoch, then the alert', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    const bot = x.cookie.bot();
    const epoch = (await x.h.store.read()).groups[0].audienceEpoch ?? 0;
    let seen: unknown;
    bot.answerCallbackQuery.mockImplementation(async () => { seen = { state: (await x.doc())!.participants[0].state, epoch: (await x.h.store.read()).groups[0].audienceEpoch }; return true; });
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    expect(seen).toEqual({ state: 'declined', epoch: epoch + 1 });
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.alert.declined() + EN.keptSuffix, true);
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toMatchObject({ choice: 'joined' });
  });

  it('/leave in a DM (outsider or member) withdraws from the circles covering that agent before acknowledging', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    const bot = x.cookie.bot();
    bot.sendMessage.mockClear();
    await x.send(dm(ID.stranger, '/leave'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, `Done. Cookie won't reply until you choose again, and your choice and its cards are deleted. Send /start any time. ${EN.leftCircles(1)}`);
    await x.send(dm(ID.alice, '/leave'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.alice, EN.leftGroups(1));
    expect((await x.doc())!.participants.map((p) => [p.telegramId, p.state])).toEqual([[ID.stranger, 'withdrawn'], [ID.alice, 'withdrawn']]);
    // Nothing to leave: a member's /leave takes today's path.
    bot.sendMessage.mockClear();
    await x.send(dm(ID.alice, '/leave'));
    expect(bot.sendMessage.mock.calls.map(([, text]) => text)).not.toContain(EN.leftGroups(1));
  });

  it('R2: leaving erases nothing. left_chat_member and a per-turn verify close the window; a rejoin opens a new one', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    const first = (await x.doc())!.participants[0];
    later(x.h, 60_000);
    x.roster.delete(ID.stranger);
    await x.send(groupMessage(ID.alice, '', { left_chat_member: user(ID.stranger) }));
    const left = (await x.doc())!.participants[0];
    expect(left).toMatchObject({ state: 'left', consent: { state: 'withdrawn' }, coveredAgentIds: [], evidence: first.evidence,
      windows: [{ joinedAt: first.windows[0].joinedAt, leftAt: x.h.clock.now.toISOString() }] });
    expect(left.history.map((e) => e.state)).toEqual(['joined', 'left']);
    // Back in the chat, a fresh Join: a second window; the first is kept as it was.
    x.roster.add(ID.stranger);
    later(x.h, 60_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    const rejoined = (await x.doc())!.participants[0];
    expect(rejoined.windows).toEqual([left.windows[0], { joinedAt: x.h.clock.now.toISOString() }]);
    expect(rejoined.consent).toMatchObject({ state: 'granted', revision: 3 });
    // Gone without a service message: the next verify notices and closes the window.
    later(x.h, 60_000);
    x.roster.delete(ID.stranger);
    await x.h.studio.verifyGroupAudience(x.cookie.agent.id, CHAT);
    const gone = (await x.doc())!.participants[0];
    expect(gone.state).toBe('left');
    expect(gone.windows).toEqual([left.windows[0], { joinedAt: rejoined.windows[1].joinedAt, leftAt: x.h.clock.now.toISOString() }]);
    expect((await x.doc())!.readers).toMatchObject({ humans: 1 });
  });

  it('consent expires after 365 days: not counted as joined, and prune closes the window without erasing it', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 366 * 86_400_000);
    expect((await x.h.studio.circleGroups.audience(CHAT)).joined).toBe(0);
    const expiresAt = (await x.doc())!.participants[0].consent.expiresAt;
    expect(await x.ledger.prune(CHAT, x.h.clock.now)).toBe(1);
    // The window closes when the consent ended, not when someone noticed.
    expect((await x.doc())!.participants[0]).toMatchObject({ state: 'withdrawn', consent: { state: 'expired' }, windows: [{ leftAt: expiresAt }] });
  });
});

describe('newcomers and the nudge', () => {
  it('a newcomer gets one silent welcome with the three buttons, once', async () => {
    const x = await setup();
    await opened(x);
    const bot = x.cookie.bot();
    bot.sendMessage.mockClear();
    x.roster.add(SARA);
    await x.send(groupMessage(ID.alice, '', { new_chat_members: [{ id: SARA, is_bot: false, first_name: 'Sara' }] }));
    const welcomes = () => bot.sendMessage.mock.calls.filter(([, text]) => text.startsWith('Hi Sara!'));
    expect(welcomes()).toHaveLength(1);
    const [[, text, options]] = welcomes();
    expect(text).toBe(welcomeText(['Sara'], 'Cookie', ['Cookie'], 'en'));
    expect(options).toMatchObject({ silent: true });
    expect(flat(options).map((b) => b.text)).toEqual(['Join · 18+', 'Only reply to me', 'Not me', 'Details & pet 🐾']);
    expect(flat(options)[0].callback_data).toBe(x.card().data('cj'));
    expect((await x.doc())!.welcomed).toEqual([SARA]);
    await x.send(groupMessage(ID.alice, '', { new_chat_members: [{ id: SARA, is_bot: false, first_name: 'Sara' }] }));
    expect(welcomes()).toHaveLength(1);
    // A tap on the welcome is a tap on the card: same notice, same evidence.
    later(x.h);
    await x.send(tap(SARA, flat(options)[0].callback_data!, 999));
    expect((await x.doc())!.participants.find((p) => p.telegramId === SARA)!.evidence.copyHash).toBe((await x.doc())!.card!.copyHash);
  });

  it('the first reply to someone who never chose carries [Tap to join 🐾], at most once per 24 h, and never for a joined person', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const bot = x.cookie.bot();
    const url = circleJoinUrl(x.cookie.agent.bot!.username, (await x.h.store.read()).groups[0].joinCode!);
    const replies = () => bot.sendMessage.mock.calls.filter(([, text]) => text === 'Sure.');
    await x.send(groupMessage(ID.stranger, 'Cookie, are you there?'));
    expect(replies()).toHaveLength(1);
    expect(replies()[0][2]).toMatchObject({ keyboard: { inline_keyboard: [[{ text: 'Tap to join 🐾', url }]] } });
    await x.send(groupMessage(ID.stranger, 'Cookie, and now?'));
    expect(replies()).toHaveLength(2);
    expect(replies()[1][2]).not.toHaveProperty('keyboard');
    later(x.h, 25 * 3_600_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    await x.send(groupMessage(ID.stranger, 'Cookie, hello again'));
    expect(replies().at(-1)![2]).not.toHaveProperty('keyboard');
  });

  it('with Circles off the same group turn carries no button, exactly as today', async () => {
    const x = await setup({ mode: 'reply' });
    await x.add(x.cookie);
    await x.send(groupMessage(ID.stranger, 'Cookie, are you there?'));
    const reply = x.cookie.bot().sendMessage.mock.calls.find(([, text]) => text === 'Sure.')!;
    expect(reply[2]).toEqual({ replyTo: expect.any(Number) });
  });
});

describe('/start, rights and the account ledger', () => {
  it('/start with no payload changes no circle', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    const before = await x.doc();
    await x.send(dm(ID.stranger, '/start'));
    expect(x.cookie.bot().sendMessage.mock.calls.at(-1)![1]).toContain("Hi, I'm Cookie");
    expect(await x.doc()).toEqual(before);
    expect(await x.ledger.repository.readIndex(ID.stranger)).toEqual({ v: 1, groupIds: [] });
  });

  it('export returns only the requester\'s participation; forget removes only theirs and invalidates the audience', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    const mine = await x.h.studio.circleParticipationFor(ID.stranger);
    expect(mine).toEqual([expect.objectContaining({ groupId: groupId(CHAT), chatId: CHAT, state: 'joined', windows: [expect.objectContaining({ joinedAt: expect.any(String) })] })]);
    expect(JSON.stringify(mine)).not.toContain(String(ID.alice));
    const epoch = (await x.h.store.read()).groups[0].audienceEpoch ?? 0;
    expect(await x.h.studio.forgetCircles(ID.stranger)).toBe(1);
    expect((await x.doc())!.participants.map((p) => p.telegramId)).toEqual([ID.alice]);
    expect((await x.h.store.read()).groups[0].audienceEpoch).toBe(epoch + 1);
    expect(await x.h.studio.circleParticipationFor(ID.stranger)).toEqual([]);
    expect(await x.ledger.repository.readIndex(ID.stranger)).toEqual({ v: 1, groupIds: [] });
    // Erasure works with the kill switch off too.
    x.h.studio.deps.circles = () => 'off';
    expect(await x.h.studio.forgetCircles(ID.alice)).toBe(1);
    expect((await x.ledger.get(CHAT))!.participants).toEqual([]);
  });

  it('optional.group_memory is vocabulary only: account documents still have exactly 16 permission rows', async () => {
    expect(PURPOSES).toContain('optional.group_memory');
    expect(OPTIONAL_PURPOSES).not.toContain('optional.group_memory' as never);
    const repository = new AdaptiveRepository(new MemoryAdaptiveStorage());
    const rows = await repository.transaction(accountIdFor(4242), 1_000, (document) => document.permissions.map((p) => p.purpose));
    expect(rows).toHaveLength(16);
    expect(rows).not.toContain('optional.group_memory');
    const h = makeStudio();
    await seedOrg(h);
    const stored = await h.adaptive!.repository.transaction(accountIdFor(ID.alice), h.clock.now.getTime(), (document) => document.permissions.length);
    expect(stored).toBe(16);
  });
});

describe('the ledger store', () => {
  it('rejects corrupt documents and broken invariants (fail closed), and commits nothing when nothing changed', async () => {
    const storage = new MemoryAdaptiveStorage();
    const ledger = new CircleService(new CircleRepository(storage));
    const at = new Date('2026-10-19T10:00:00Z');
    await ledger.open({ chatId: CHAT, agentId: 'agent-a', openedBy: 1, at, card: { id: 'gabc', copyHash: 'a'.repeat(64), locale: 'en', noticeVersion: 'circle-v1' } });
    const transact = vi.spyOn(storage, 'transact');
    expect(await ledger.withdraw(CHAT, 77, 'e1', at)).toEqual({ changed: false, wasJoined: false });
    expect(await ledger.claimWelcome(CHAT, 77)).toBe(true);
    expect(await ledger.claimWelcome(CHAT, 77)).toBe(false);
    expect(transact).toHaveBeenCalledTimes(3);
    // Consent granted without a join, or coverage of an agent that is not in the circle, never commits.
    await expect(ledger.repository.transaction(groupIdOf(CHAT), (doc) => {
      doc!.participants.push({ ...fakeJoined(doc!, 5), state: 'reply_only' });
      return { document: doc, result: undefined };
    })).rejects.toThrow();
    await expect(ledger.repository.transaction(groupIdOf(CHAT), (doc) => {
      doc!.participants.push({ ...fakeJoined(doc!, 5), coveredAgentIds: ['agent-b'] });
      return { document: doc, result: undefined };
    })).rejects.toThrow();
    await storage.transact(circleKey(groupIdOf(CHAT)), () => ({ document: { schemaVersion: 1, junk: true }, result: undefined }));
    await expect(ledger.get(CHAT)).rejects.toThrow();
    expect(groupIdOf(CHAT)).toBe(groupId(CHAT));
    expect(parseCircleChats(' -100777, x, 12,,-0 ')).toEqual(new Set([-100777, 12]));
  });

  it('Firestore keeps circles in adaptiveCircles, keyed by circle id', async () => {
    const docs = new Map<string, Record<string, unknown>>();
    const snapshot = (path: string) => ({ exists: docs.has(path), get: (field: string) => docs.get(path)?.[field] });
    const db = { collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }),
      runTransaction: async (fn: (tx: unknown) => unknown) => fn({ get: async (r: { path: string }) => snapshot(r.path), set: (r: { path: string }, value: Record<string, unknown>) => { docs.set(r.path, value); } }) } as unknown as Firestore;
    const ledger = new CircleService(new CircleRepository(new FirestoreAdaptiveStorage(db, CIRCLE_COLLECTION)));
    await ledger.open({ chatId: CHAT, agentId: 'agent-a', openedBy: 1, at: new Date('2026-10-19T10:00:00Z'), card: { id: 'gabc', copyHash: 'a'.repeat(64), locale: 'en', noticeVersion: 'circle-v1' } });
    await ledger.index(5, CHAT);
    expect([...docs.keys()].every((k) => k.startsWith('adaptiveCircles/'))).toBe(true);
    expect(docs.size).toBe(2);
    expect((await ledger.get(CHAT))!.agents[0].agentId).toBe('agent-a');
  });
});

/* ---------- review fixes (S2 round 2) ---------- */

const removed = (from: number, chatId = CHAT): TelegramChatMemberUpdated => ({ ...added(from, 'left', chatId), old_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'b' } } });
const everyoneOf = (bot: { sendMessage: { mock: { calls: Array<[number, string, unknown?]> } } }) => bot.sendMessage.mock.calls.filter(([, text]) => text.startsWith("Everyone's in"));
/** A JSON view of the document without timestamps, message ids and counters, to look for a Telegram id. */
const idTrace = (doc: unknown) => JSON.stringify(doc, (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) || ['messageId', 'revision', 'epoch', 'chatId', 'humans', 'seen'].includes(k) ? undefined : v);
/** A Telegram id as a whole token in an idTrace. Bounded by hex digits, not only decimal ones: events carry random
 * 32-hex fingerprints and hashes, which contain an id's digits by chance (a substring check failed on `f2ee0935d5999…`). */
const idToken = (id: number) => new RegExp(`(?<![0-9a-fA-F])${id}(?![0-9a-fA-F])`);
const ledgerAt = () => {
  const storage = new MemoryAdaptiveStorage();
  return { storage, ledger: new CircleService(new CircleRepository(storage)) };
};
const T0 = new Date('2026-10-19T10:00:00Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);
const DAY = 86_400_000;
async function openAt(ledger: CircleService, agentId = 'agent-a') {
  await ledger.open({ chatId: CHAT, agentId, openedBy: 1, at: T0, card: { id: 'gabc', copyHash: 'a'.repeat(64), locale: 'en', noticeVersion: 'circle-v1' } });
}
const decideAt = (ledger: CircleService, telegramId: number, choice: 'joined' | 'reply_only' | 'declined', at: Date, eventId = `e-${telegramId}-${at.getTime()}-${choice}`) =>
  ledger.decide(CHAT, { telegramId, choice, cardId: 'gabc', eventId, at, surface: 'group_card' });

describe('review fixes: closing, erasure, cards', () => {
  it('a circle that closes with its last agent ends every join (windows closed, nothing erased); a re-added agent needs fresh taps', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const bot = x.cookie.bot();
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect((await x.h.studio.circleGroups.audience(CHAT)).complete).toBe(true);
    const oldCard = x.card().data('cj');
    later(x.h, 60_000);
    const agent = () => x.h.store.read().then((s) => s.agents.find((a) => a.id === x.cookie.agent.id)!);
    await x.h.studio.onBotChatMember(await agent(), removed(ID.alice));
    x.bots.delete(x.cookie.botId);
    const closed = (await x.doc())!;
    expect(closed.status).toBe('closed');
    const closedAt = x.h.clock.now.toISOString();
    for (const p of closed.participants) {
      expect(p).toMatchObject({ state: 'withdrawn', consent: { state: 'withdrawn' }, coveredAgentIds: [] });
      expect(p.windows).toEqual([{ joinedAt: expect.any(String), leftAt: closedAt }]);
      expect(p.history.at(-1)!.eventId).toMatch(/^agent-removed:/);
    }
    // Three days later Alice adds Cookie back: a fresh card, nobody counted until they tap it.
    later(x.h, 3 * 86_400_000);
    bot.sendMessage.mockClear();
    await x.add(x.cookie);
    expect(x.card().call[1]).toContain('Notes: off · 0 of 2 joined');
    expect(await x.h.studio.circleGroups.view(CHAT)).toEqual({ joined: 0, total: 2, notes: 'off' });
    expect((await x.h.studio.circleGroups.audience(CHAT)).complete).toBe(false);
    later(x.h);
    // The old card is stale; Alice's tap on the new one is "1 of 2" and celebrates nothing.
    await x.send(tap(ID.alice, oldCard, messageId));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.expired, true);
    const fresh = (await x.doc())!.card!.messageId!;
    await x.send(tap(ID.alice, x.card().data('cj'), fresh));
    expect(everyoneOf(bot)).toHaveLength(0);
    expect(bot.editMessageText.mock.calls.at(-1)![2]).toContain('Notes: off · 1 of 2 joined');
    const parastoo = (await x.doc())!.participants.find((p) => p.telegramId === ID.stranger)!;
    expect(parastoo).toMatchObject({ state: 'withdrawn', coveredAgentIds: [] });
    expect((await x.doc())!.participants.find((p) => p.telegramId === ID.alice)!.windows).toHaveLength(2);
  });

  it('forget me leaves no trace of the requester: their events go, and a host\'s erasure drops openedBy\'s id', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    expect((await x.doc())!.events).toHaveLength(3);
    // Controls for the bounded match: a stored id is found, the same digits inside a random hex hash are not.
    expect(idTrace({ events: [{ telegramId: ID.stranger }] })).toMatch(idToken(ID.stranger));
    expect(idTrace({ events: [{ personId: `tg-${ID.stranger}` }] })).toMatch(idToken(ID.stranger));
    expect(idTrace({ events: [{ fingerprint: 'f2ee0935d5999decc' }] })).not.toMatch(idToken(ID.stranger));
    // Events are content-free: no Telegram id in them even before erasure.
    expect(idTrace({ events: (await x.doc())!.events })).not.toMatch(idToken(ID.stranger));
    expect(await x.h.studio.forgetCircles(ID.stranger)).toBe(1);
    const after = (await x.doc())!;
    expect(after.events).toHaveLength(1);
    expect(idTrace(after)).not.toMatch(idToken(ID.stranger));
    // Alice opened it: her own erasure takes her id from openedBy too.
    expect(await x.h.studio.forgetCircles(ID.alice)).toBe(1);
    const none = (await x.doc())!;
    expect(none.openedBy).toEqual({ at: expect.any(String) });
    expect(none.events).toEqual([]);
    expect(idTrace(none)).not.toMatch(idToken(ID.alice));
  });

  it('a card whose post failed is posted again (redelivered add, or a refresh a minute later); an include card too', async () => {
    const x = await setup();
    const mina = await hire(x.h, x.org.alice, { name: 'Mina' }, undefined, 'public');
    x.telegram(mina);
    const bot = x.cookie.bot();
    bot.sendMessage.mockRejectedValueOnce(new Error('429'));
    await x.add(x.cookie);
    expect((await x.doc())!.card!.messageId).toBeUndefined();
    await x.add(x.cookie);
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    later(x.h, 61_000);
    await x.add(x.cookie);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.sendMessage.mock.calls[1][1]).toContain('0 of 2 joined');
    expect((await x.doc())!.card!.messageId).toEqual(expect.any(Number));
    mina.bot().sendMessage.mockRejectedValueOnce(new Error('network'));
    await x.add(mina);
    expect((await x.doc())!.agents[1].card!.messageId).toBeUndefined();
    later(x.h, 61_000);
    await x.h.studio.circleGroups.refresh(CHAT);
    expect(mina.bot().sendMessage).toHaveBeenCalledTimes(2);
    expect((await x.doc())!.agents[1].card!.messageId).toEqual(expect.any(Number));
    // Posted once: later refreshes post nothing more.
    later(x.h, 61_000);
    await x.h.studio.circleGroups.refresh(CHAT);
    expect(mina.bot().sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('"Everyone\'s in" names only agents every reader covers', async () => {
    const x = await setup();
    const mina = await hire(x.h, x.org.alice, { name: 'Mina' }, undefined, 'public');
    x.telegram(mina);
    const messageId = await opened(x);
    await x.add(mina);
    later(x.h);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(everyoneOf(x.cookie.bot()).map(([, text]) => text)).toEqual([EN.everyone('Cookie')]);
  });

  it('a silent swap is never complete: joined people are verified present before "on" and "Everyone\'s in"', async () => {
    const x = await setup();
    const messageId = await opened(x);
    x.roster.add(SARA);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    // Parastoo leaves and someone else arrives, with no service message either way.
    x.roster.delete(ID.stranger);
    x.roster.add(6060);
    await x.send(tap(SARA, x.card().data('cj'), messageId));
    expect(everyoneOf(x.cookie.bot())).toHaveLength(0);
    const doc = (await x.doc())!;
    expect(doc.participants.find((p) => p.telegramId === ID.stranger)).toMatchObject({ state: 'left', windows: [{ leftAt: x.h.clock.now.toISOString() }] });
    expect(doc.readers).toMatchObject({ humans: 3, present: [ID.alice, SARA].sort((a, b) => a - b) });
    expect(await x.h.studio.circleGroups.view(CHAT)).toEqual({ joined: 2, total: 3, notes: 'off' });
    expect(x.cookie.bot().editMessageText.mock.calls.at(-1)![2]).toContain('Notes: off · 2 of 3 joined');
    // Stored "present" decides for readers that do not verify: none stored is never complete.
    const bare = { ...doc, readers: { humans: 2, at: doc.readers!.at } } as CircleDocument;
    expect(CircleService.audience(bare, x.h.clock.now, { humans: 2 }).complete).toBe(false);
  });

  it('expired consents expire inside the transaction: the cap and the schema agree, and a re-Join opens a new window', async () => {
    const { ledger } = ledgerAt();
    await openAt(ledger);
    expect(await decideAt(ledger, 5000, 'joined', plus(1000))).toMatchObject({ ok: true });
    for (let i = 1; i <= 11; i++) await decideAt(ledger, 5000 + i, 'joined', plus(200 * DAY));
    // Day 366: 5000's consent is over; a 13th person joins without the commit failing.
    expect(await decideAt(ledger, 6000, 'joined', plus(366 * DAY))).toMatchObject({ ok: true, joined: 12 });
    const first = (await ledger.get(CHAT))!.participants.find((p) => p.telegramId === 5000)!;
    expect(first).toMatchObject({ state: 'withdrawn', consent: { state: 'expired' }, windows: [{ joinedAt: plus(1000).toISOString(), leftAt: first.consent.expiresAt }] });
    expect(await decideAt(ledger, 5000, 'joined', plus(367 * DAY))).toEqual({ ok: false, reason: 'full' });
    // Alone, an expired person's re-Join is a new window: the gap is not covered.
    const solo = ledgerAt().ledger;
    await openAt(solo);
    await decideAt(solo, 7000, 'joined', plus(1000));
    expect(await decideAt(solo, 7000, 'joined', plus(400 * DAY))).toMatchObject({ ok: true });
    const p = (await solo.get(CHAT))!.participants[0];
    expect(p.windows).toEqual([{ joinedAt: plus(1000).toISOString(), leftAt: new Date(plus(1000).getTime() + 365 * DAY).toISOString() }, { joinedAt: plus(400 * DAY).toISOString() }]);
    expect(p.consent).toMatchObject({ state: 'granted', expiresAt: new Date(plus(400 * DAY).getTime() + 365 * DAY).toISOString() });
  });

  it('a ledger failure on a tap is answered, never left spinning', async () => {
    const x = await setup();
    const messageId = await opened(x);
    vi.spyOn(x.ledger, 'decide').mockRejectedValueOnce(new Error('too many joined'));
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId, 'spin'));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith('spin', EN.unavailable, true);
  });

  it('withdrawals, leaves and erasure commit past the soft byte cap; a Join does not; windows are capped per person', async () => {
    const { storage, ledger } = ledgerAt();
    await openAt(ledger);
    await decideAt(ledger, 77, 'joined', plus(1000));
    await decideAt(ledger, 78, 'joined', plus(1000));
    const doc = (await ledger.get(CHAT))!;
    const long = (i: number, j: number) => `cb-${i}-${j}-`.padEnd(190, 'x');
    for (let i = 0; i < 46; i++) {
      const at = plus(2000).toISOString();
      const row: CircleParticipant = { telegramId: 90_000 + i, personId: `tg-${90_000 + i}`, key: `stuffedkey${i}`.padEnd(16, '_'), state: 'declined', coveredAgentIds: [], windows: [],
        consent: { id: `consent:${doc.groupId}:${90_000 + i}`, revision: 1, purpose: 'optional.group_memory', purposeVersion: 1, policyVersion: 'circle-v1', state: 'declined', epoch: 0, effectiveAt: at, expiresAt: at },
        evidence: { eventId: long(i, 99), noticeId: 'notice:optional.group_memory', noticeVersion: 'circle-v1', copyHash: 'a'.repeat(64), locale: 'en', presentedAt: T0.toISOString(), decidedAt: at, surface: 'group_card', affirmative: true, adultDeclared: false },
        history: Array.from({ length: 20 }, (_, j) => ({ state: 'declined' as const, at, eventId: long(i, j) })) };
      doc.participants.push(row);
    }
    doc.events = Array.from({ length: 500 }, (_, i) => ({ id: long(1000, i), fingerprint: 'b'.repeat(32), owner: 'c'.repeat(32) }));
    await storage.transact(circleKey(groupIdOf(CHAT)), () => ({ document: JSON.parse(JSON.stringify(doc)), result: undefined }));
    expect(Buffer.byteLength(JSON.stringify(await ledger.get(CHAT)))).toBeGreaterThan(MAX_CIRCLE_BYTES);
    await expect(decideAt(ledger, 79, 'joined', plus(3000))).rejects.toThrow('circle_capacity_reached');
    expect(await ledger.withdraw(CHAT, 77, 'leave-77', plus(3000))).toEqual({ changed: true, wasJoined: true });
    expect(await decideAt(ledger, 78, 'declined', plus(3000))).toMatchObject({ ok: true });
    expect(await ledger.onLeft(CHAT, [90_000], plus(3000))).toEqual([]);
    expect((await ledger.eraseFor(90_001)).erased).toBe(0); // not in their index: nothing to find, nothing thrown
    // Append-only windows: past CIRCLE_MAX_WINDOWS a Join is refused, and nothing is trimmed.
    const { ledger: cycle } = ledgerAt();
    await openAt(cycle);
    for (let i = 0; i < CIRCLE_MAX_WINDOWS; i++) {
      expect(await decideAt(cycle, 55, 'joined', plus(1000 + i * 2000))).toMatchObject({ ok: true });
      expect(await decideAt(cycle, 55, 'declined', plus(2000 + i * 2000))).toMatchObject({ ok: true });
    }
    expect(await decideAt(cycle, 55, 'joined', plus(DAY))).toEqual({ ok: false, reason: 'limit' });
    expect((await cycle.get(CHAT))!.participants[0].windows).toHaveLength(CIRCLE_MAX_WINDOWS);
  });

  it('a DM /leave withdraws the agent choice and answers even when a circle document cannot be read (and with Circles at reply)', async () => {
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toMatchObject({ choice: 'joined' });
    await x.ledger.repository.storage.transact(circleKey(groupIdOf(CHAT)), () => ({ document: { schemaVersion: 1, junk: true }, result: undefined }));
    x.h.studio.deps.circles = () => 'reply';
    await x.send(dm(ID.stranger, '/leave'));
    expect(await x.h.studio.agentChoice(x.cookie.agent.id, ID.stranger)).toBeUndefined();
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, expect.stringContaining("Cookie won't reply until you choose again"));
    // A member's /leave in circles mode takes today's path too.
    x.h.studio.deps.circles = () => 'circles';
    await expect(x.send(dm(ID.alice, '/leave'))).resolves.toBeUndefined();
  });

  it('/leave in a group with two circle agents: one withdrawal, one acknowledgement', async () => {
    const x = await setup();
    const mina = await hire(x.h, x.org.alice, { name: 'Mina' }, undefined, 'public');
    x.telegram(mina);
    const messageId = await opened(x);
    await x.add(mina);
    later(x.h);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    const leave = groupMessage(ID.stranger, '/leave');
    await x.send(leave, mina.agent.id);
    await x.send(leave, x.cookie.agent.id);
    const said = [...mina.bot().sendMessage.mock.calls, ...x.cookie.bot().sendMessage.mock.calls].map(([, text]) => text).filter((t) => t === EN.left || t === EN.notIn);
    expect(said).toEqual([EN.left]);
    // A later /leave (a different message) is still told they're not in, by the speaker only.
    await x.send(groupMessage(ID.stranger, '/leave'), mina.agent.id);
    await x.send(groupMessage(ID.stranger, '/leave'), x.cookie.agent.id);
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(CHAT, EN.notIn, expect.objectContaining({ silent: true }));
    expect(mina.bot().sendMessage.mock.calls.filter(([, t]) => t === EN.notIn)).toHaveLength(0);
  });

  it('card edits are claimed in the ledger: counts come from the committed document, one edit per 10 s, the loser schedules a refresh', async () => {
    const { ledger } = ledgerAt();
    await openAt(ledger);
    await ledger.markCard(CHAT, 'gabc', { messageId: 5, shown: { joined: 0, total: 2, on: false } });
    await ledger.setReaders(CHAT, 2, plus(500));
    await decideAt(ledger, 101, 'joined', plus(1000));
    expect(await ledger.claimEdit(CHAT, { cardId: 'gabc' }, plus(1000), 10_000)).toMatchObject({ kind: 'edit', shown: { joined: 1, total: 2, on: false }, messageId: 5 });
    await decideAt(ledger, 102, 'joined', plus(2000));
    expect(await ledger.claimEdit(CHAT, { cardId: 'gabc' }, plus(2000), 10_000)).toEqual({ kind: 'wait', ms: 9000 });
    expect(await ledger.claimEdit(CHAT, { cardId: 'gabc' }, plus(11_000), 10_000)).toMatchObject({ kind: 'edit', shown: { joined: 2, total: 2 } });
    expect(await ledger.claimEdit(CHAT, { cardId: 'gabc' }, plus(30_000), 10_000)).toEqual({ kind: 'skip' });
    // Through the handlers: the second tap inside 10 s waits for its trailing refresh.
    const x = await setup();
    const messageId = await opened(x);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    later(x.h, 2000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    const timers = (x.h.studio.circleGroups as unknown as { timers: Map<number, ReturnType<typeof setTimeout>> }).timers;
    expect(timers.has(CHAT)).toBe(true);
    clearTimeout(timers.get(CHAT));
    timers.clear();
  });

  it('third-party bots: when everyone a full verify saw has joined but M is higher, the card says other bots count as readers', async () => {
    const x = await setup();
    x.bots.add(7777);
    const messageId = await opened(x);
    expect(x.card().call[1]).toContain('0 of 3 joined');
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    later(x.h, 11_000);
    await x.h.studio.verifyGroupAudience(x.cookie.agent.id, CHAT);
    const text = x.cookie.bot().editMessageText.mock.calls.at(-1)![2];
    expect(text).toContain('Notes: off · 2 of 3 joined');
    expect(text).toContain(EN.others);
    expect(groupCopy('fa').others).toBeTruthy();
  });

  it('a repeat Not me commits nothing and invalidates nothing', async () => {
    const x = await setup();
    const messageId = await opened(x);
    const epoch = async () => (await x.h.store.read()).groups[0].audienceEpoch ?? 0;
    const e0 = await epoch();
    await x.send(tap(ID.stranger, x.card().data('cd'), messageId));
    expect(await epoch()).toBe(e0 + 1);
    const revision = (await x.doc())!.revision;
    for (let i = 0; i < 3; i++) { later(x.h); await x.send(tap(ID.stranger, x.card().data('cd'), messageId)); }
    expect((await x.doc())!.revision).toBe(revision);
    expect(await epoch()).toBe(e0 + 1);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.alert.declined(), true);
  });

  it('a card deleted in the chat is marked gone and left alone; include cards still update', async () => {
    const x = await setup();
    const mina = await hire(x.h, x.org.alice, { name: 'Mina' }, undefined, 'public');
    x.telegram(mina);
    const messageId = await opened(x);
    await x.add(mina);
    later(x.h);
    const bot = x.cookie.bot();
    bot.editMessageText.mockRejectedValue(new TelegramApiError('editMessageText', 'Bad Request: message to edit not found'));
    x.roster.add(SARA);
    await x.send(tap(ID.alice, x.card().data('cj'), messageId));
    expect((await x.doc())!.card).toMatchObject({ gone: true });
    expect((await x.doc())!.card!.messageId).toBeUndefined();
    expect(mina.bot().editMessageText.mock.calls.at(-1)![2]).toContain('0 of 3 said yes');
    const sends = bot.sendMessage.mock.calls.length, edits = bot.editMessageText.mock.calls.length;
    later(x.h, 70_000);
    await x.send(tap(ID.stranger, x.card().data('cj'), messageId));
    expect(bot.editMessageText.mock.calls.length).toBe(edits);
    expect(bot.sendMessage.mock.calls.length).toBe(sends);
  });

  it('newcomers in one batch get one welcome; a welcome that fails to send is tried again on the next service message', async () => {
    const x = await setup();
    await opened(x);
    const bot = x.cookie.bot();
    bot.sendMessage.mockClear();
    const newcomers = [{ id: SARA, is_bot: false, first_name: 'Sara' }, { id: 6001, is_bot: false, first_name: 'Ali' }, { id: 6002, is_bot: false, first_name: 'Bo' }];
    for (const u of newcomers) x.roster.add(u.id);
    await x.send(groupMessage(ID.alice, '', { new_chat_members: newcomers }));
    const welcomes = () => bot.sendMessage.mock.calls.filter(([, text]) => text.startsWith('Hi '));
    expect(welcomes().map(([, text]) => text)).toEqual([welcomeText(['Sara', 'Ali', 'Bo'], 'Cookie', ['Cookie'], 'en')]);
    expect(welcomes()[0][1]).toMatch(/^Hi Sara, Ali and Bo!/);
    expect(welcomeText(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 'Cookie', ['Cookie'], 'en')).toMatch(/^Hi A, B, C, D and 3 more!/);
    x.roster.add(6003);
    bot.sendMessage.mockRejectedValueOnce(new Error('429'));
    await x.send(groupMessage(ID.alice, '', { new_chat_members: [{ id: 6003, is_bot: false, first_name: 'Dee' }] }));
    expect((await x.doc())!.welcomed).not.toContain(6003);
    await x.send(groupMessage(ID.alice, '', { new_chat_members: [{ id: 6003, is_bot: false, first_name: 'Dee' }] }));
    expect(welcomes().at(-1)![1]).toMatch(/^Hi Dee!/);
    expect((await x.doc())!.welcomed).toContain(6003);
  });

  it('every alert fits Telegram\'s 200 characters with 40-character agent names, and Join always keeps how to leave', () => {
    for (const locale of ['en', 'fa'] as const) {
      const c = groupCopy(locale);
      for (let n = 1; n <= 10; n++) {
        const names = Array.from({ length: n }, (_, i) => `${'ن'.repeat(38)}${i}`.slice(0, 40));
        const alert = joinedAlert(names, locale);
        expect(alert.length).toBeLessThanOrEqual(ALERT_MAX);
        expect(alert).toContain('/leave');
        expect(alert).toContain(names[0]);
      }
      expect(joinedAlert(['x'.repeat(400)], locale).length).toBeLessThanOrEqual(ALERT_MAX);
      expect(joinedAlert(['Cookie'], locale)).toBe(c.alert.joined('Cookie'));
      expect(nameAlert(c.included, 'M'.repeat(40)).length).toBeLessThanOrEqual(ALERT_MAX);
      for (const text of [c.alert.declined() + c.keptSuffix, c.alert.reply_only() + c.keptSuffix, c.expired, c.notMember, c.full, c.limit, c.joinFirst, c.early, c.unavailable]) expect(text.length).toBeLessThanOrEqual(ALERT_MAX);
    }
    // Two 20-character names in Persian: both named in full, then how to leave.
    const fa = joinedAlert(['ب'.repeat(20), 'پ'.repeat(20)], 'fa');
    expect(fa).toContain('ب'.repeat(20));
    expect(fa).toContain('پ'.repeat(20));
    expect(fa.endsWith('/leave.')).toBe(true);
  });
});
