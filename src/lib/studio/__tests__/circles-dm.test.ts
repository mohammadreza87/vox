/**
 * Circles S1 (GROUP_AGENTS_SPEC R2, §9 S1): agent DM cards and reply-only outsiders, no notes.
 * Pressing Start grants nothing; typing before choosing re-shows the card without a model call;
 * a tap is recorded with its evidence before it is acknowledged, only for the person it was shown to;
 * Not me stops processing at once; /leave withdraws durably first; the kill switch restores today.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { agentCard, AGENT_NOTICE, copyHash } from '../../circles/notice';
import { FirestoreAgentChoiceStore } from '../../circles/choice-store';
import { fakeFirestore } from '../../tireh/identity/__tests__/fake-firestore';
import { personId } from '../org-bridge';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg, T0, type Harness } from './helpers';

const OTHER = 1001;
let updateId = 970_000;
type Keyboard = { inline_keyboard: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string } }>> };

function dm(from: number, text: string, language_code?: string): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, date: 0, text, from: { id: from, is_bot: false, first_name: 'X', ...(language_code ? { language_code } : {}) }, chat: { id: from, type: 'private' } } };
}
function tap(from: number, data: string, chatId = from): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, callback_query: { id: `cb-${id}`, from: { id: from, is_bot: false, first_name: 'X' }, data, message: { message_id: 77, date: 0, chat: { id: chatId, type: 'private' } } } };
}
const keyboardOf = (options: unknown) => (options as { keyboard?: Keyboard } | undefined)?.keyboard;
const buttons = (options: unknown) => keyboardOf(options)?.inline_keyboard.flat() ?? [];
const data = (options: unknown, prefix: 'cj' | 'cr' | 'cd') => buttons(options).find((b) => b.callback_data?.startsWith(`${prefix}:`))!.callback_data!;
const later = (h: Harness, ms = 1000) => { h.clock.now = new Date(h.clock.now.getTime() + ms); };
const recordsOf = (h: Harness, who: number = ID.stranger) => h.studio.deps.choices!.listForUser(who);
const joinsOf = async (h: Harness, who: number = ID.stranger) => (await recordsOf(h, who)).flatMap((r) => r.join ? [r.join] : []);
const receiptsOf = async (h: Harness, who: number = ID.stranger) => (await recordsOf(h, who)).flatMap((r) => r.receipts);
/** Every adaptive file under the harness dir: proves no adaptive document appeared. */
const adaptiveFiles = (h: Harness) => (readdirSync(h.dir, { recursive: true }) as string[]).filter((f) => f.includes('adaptive')).sort();

async function setup(mode: 'reply' | 'circles' | 'off' | 'unset' = 'reply') {
  const h = makeStudio();
  const org = await seedOrg(h);
  const hired = await hire(h, org.alice, { name: 'Cookie' }, undefined, 'public');
  if (mode !== 'unset') h.studio.deps.circles = () => mode;
  const complete = vi.fn(h.chatLLM.complete.bind(h.chatLLM));
  const decide = vi.fn(async () => ({ decision: null }));
  h.studio.deps.chatLLM = { complete };
  h.studio.deps.decider = { decide } as unknown as NonNullable<typeof h.studio.deps.decider>;
  const send = (u: TelegramUpdate) => handleAgentUpdate(h.studio, hired.agent.id, u);
  /** Sends /start (or text) and returns the card's sendMessage call. */
  const card = async (from = ID.stranger, text = '/start', lang?: string) => {
    hired.bot().sendMessage.mockClear();
    await send(dm(from, text, lang));
    return hired.bot().sendMessage.mock.calls.at(-1)!;
  };
  return { h, org, ...hired, complete, decide, send, card };
}

describe('the agent DM card', () => {
  it('Start grants nothing: the card offers Join · 18+, Only reply, Not me and the pet, and records only a receipt', async () => {
    const { h, agent, card, complete } = await setup();
    h.studio.deps.webAppUrl = 'https://vox.example/studio';
    const [chatId, text, options] = await card();
    expect(chatId).toBe(ID.stranger);
    const expected = agentCard('Cookie', 'en', undefined, true);
    expect(text).toBe(expected.text);
    expect(text).toContain('Talk with Cookie privately. Join also lets Cookie keep your own notes and use notes from groups you join.');
    expect(buttons(options).map((b) => b.text)).toEqual(['Join · 18+', 'Only reply to me', 'Not me', 'Open Cookie 🐾']);
    expect(buttons(options)[3].web_app?.url).toBe(`https://vox.example/studio/pet/${agent.id}`);
    for (const b of buttons(options)) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(await joinsOf(h)).toEqual([]);
    // Choices and receipts live in their own per-person records, never in the single Studio document.
    expect(readFileSync(join(h.dir, 'studio.json'), 'utf8')).not.toMatch(/joins|joinReceipts|receipts/);
    expect(await receiptsOf(h)).toEqual([expect.objectContaining({ agentId: agent.id, telegramId: ID.stranger, surface: 'dm_card',
      notice: { id: AGENT_NOTICE.id, version: AGENT_NOTICE.version, copyHash: expected.copyHash, locale: 'en', presentedAt: T0.toISOString() } })]);
    expect(expected.copyHash).toBe(copyHash(text, ['Join · 18+', 'Only reply to me', 'Not me', 'Open Cookie 🐾']));
    expect(complete).not.toHaveBeenCalled();
  });

  it('typing before choosing re-shows the card: no model call, no stranger decision, and the daily limit still applies', async () => {
    const { h, card, complete, decide, bot, send } = await setup();
    h.studio.deps.guestDailyLimit = 2;
    const [, text, options] = await card(ID.stranger, 'Hi! What do you do?');
    expect(text).toBe(agentCard('Cookie', 'en').text);
    expect(buttons(options)).toHaveLength(3);
    expect(complete).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect((await h.store.read()).guestUsage).toEqual({ [`${(await h.store.read()).agents[0].id}:${ID.stranger}`]: { day: '2026-10-19', count: 1 } });
    await card(ID.stranger, 'hello again');
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, 'third'));
    expect(bot().sendMessage.mock.calls).toEqual([[ID.stranger, "I've enjoyed talking, but I need a break. Let's pick this up tomorrow."]]);
    await send(dm(ID.stranger, 'fourth'));
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it('speaks Persian to a Persian Telegram, and records that locale as evidence', async () => {
    const { h, agent, card, send } = await setup();
    const [, text, options] = await card(ID.stranger, '/start', 'fa');
    expect(text).toBe(agentCard('Cookie', 'fa').text);
    expect(buttons(options).map((b) => b.text)).toEqual(['می‌پیوندم · ۱۸+', 'فقط به من جواب بده', 'مرا حساب نکن']);
    later(h);
    await send(tap(ID.stranger, data(options, 'cj')));
    expect(await joinsOf(h)).toEqual([expect.objectContaining({ agentId: agent.id, choice: 'joined',
      notice: expect.objectContaining({ locale: 'fa', copyHash: agentCard('Cookie', 'fa').copyHash }) })]);
  });
});

describe('a tap on the card', () => {
  it('Join stores the evidence (notice, version, copyHash, locale, presentedAt < decidedAt, surface, adult declaration) before acknowledging', async () => {
    const { h, agent, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h, 4000);
    const recorded: unknown[] = [];
    bot().answerCallbackQuery.mockImplementation(async () => { recorded.push((await joinsOf(h))[0]?.choice); return true; });
    const update = tap(ID.stranger, data(options, 'cj'));
    await send(update);
    const [join] = await joinsOf(h);
    expect(join).toEqual({ agentId: agent.id, telegramId: ID.stranger, choice: 'joined', surface: 'dm_card', revision: 1,
      eventId: update.callback_query!.id, receiptId: data(options, 'cj').slice(3),
      notice: { id: AGENT_NOTICE.id, version: AGENT_NOTICE.version, copyHash: agentCard('Cookie', 'en').copyHash, locale: 'en', presentedAt: T0.toISOString() },
      decidedAt: new Date(T0.getTime() + 4000).toISOString(), adultDeclaredAt: new Date(T0.getTime() + 4000).toISOString() });
    expect(Date.parse(join.notice.presentedAt)).toBeLessThan(Date.parse(join.decidedAt));
    expect(recorded).toEqual(['joined']);
    expect(bot().answerCallbackQuery).toHaveBeenCalledWith(update.callback_query!.id, 'You joined Cookie. Talk with me any time. Send /leave to undo.', true);
    expect(bot().editMessageText).toHaveBeenCalledWith(ID.stranger, 77, 'You joined Cookie. Talk with me any time. Send /leave to undo.', undefined);
  });

  it('Only reply records no adult declaration; a second tap on the same card is refused', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cr')));
    expect((await joinsOf(h))[0]).not.toHaveProperty('adultDeclaredAt');
    await send(tap(ID.stranger, data(options, 'cj')));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'You already chose on this card. Send /start to change it.', true);
    expect(await joinsOf(h)).toEqual([expect.objectContaining({ choice: 'reply_only', revision: 1 })]);
  });

  it('rejects a forwarded card pressed by someone else, and leaves it usable by its owner', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(OTHER, data(options, 'cj'), OTHER));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'This card is for someone else. Send /start to get your own.', true);
    expect(await joinsOf(h)).toEqual([]);
    expect(await recordsOf(h, OTHER)).toEqual([]);
    expect(bot().editMessageText).not.toHaveBeenCalled();
    await send(tap(ID.stranger, data(options, 'cj')));
    expect(await joinsOf(h)).toEqual([expect.objectContaining({ telegramId: ID.stranger, choice: 'joined' })]);
  });

  it('never records a decision at or before the moment the card was presented, or after the card expired', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    await send(tap(ID.stranger, data(options, 'cj')));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'One moment, then tap again.', true);
    later(h, 25 * 3_600_000);
    await send(tap(ID.stranger, data(options, 'cj')));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'This card has expired. Send /start for a fresh one.', true);
    await send(tap(ID.stranger, 'cj:unknownReceipt'));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'This card has expired. Send /start for a fresh one.', true);
    expect(await joinsOf(h)).toEqual([]);
  });

  it('group-card actions of later slices and taps outside a DM record nothing', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, 'ci:abcdefabcdef'));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), "This button isn't available yet.");
    const inGroup = tap(ID.stranger, data(options, 'cj'));
    inGroup.callback_query!.message!.chat = { id: -42, type: 'supergroup' };
    await send(inGroup);
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'This card has expired. Send /start for a fresh one.', true);
    expect(await joinsOf(h)).toEqual([]);
  });

  it('a duplicate delivery of one callback update is handled once', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    const update = tap(ID.stranger, data(options, 'cj'));
    await send(update);
    await send(update);
    expect(bot().answerCallbackQuery).toHaveBeenCalledTimes(1);
  });
});

describe('after choosing', () => {
  it('Not me stops processing at once: no reply, no model call, no count, until a deliberate /start', async () => {
    const { h, bot, card, send, complete, decide } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cd')));
    expect(await joinsOf(h)).toEqual([expect.objectContaining({ choice: 'declined' })]);
    expect(bot().editMessageText).toHaveBeenCalledWith(ID.stranger, 77, 'Okay, I\'ll stay quiet. Send /start if you change your mind.', undefined);
    const usage = (await h.store.read()).guestUsage;
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, 'are you there?'));
    await send(dm(ID.stranger, 'stop'));
    expect(bot().sendMessage).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect((await h.store.read()).guestUsage).toEqual(usage);
    const [, text] = await card();
    expect(text).toBe(agentCard('Cookie', 'en', 'declined').text);
  });

  for (const how of ['Not me', '/leave', 'the kill switch'] as const) it(`${how} voids a reply that was already being written, and creates no adaptive document`, async () => {
    const { h, agent, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cr')));
    let release!: () => void, writing = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const chat = h.chatLLM;
    h.studio.deps.chatLLM = { complete: async (request) => {
      if (request.system.includes('Decide, in character')) return JSON.stringify({ action: 'reply' });
      writing = true;
      await gate;
      return chat.complete(request);
    } };
    const adaptive = adaptiveFiles(h);
    const read = vi.spyOn(h.adaptive!.runtimePrivacy, 'read');
    bot().sendMessage.mockClear();
    const turn = send(dm(ID.stranger, 'Tell me about puzzles'));
    await vi.waitFor(() => expect(writing).toBe(true));
    if (how === 'Not me') {
      const fresh = await h.studio.presentAgentCard(agent.id, ID.stranger, agentCard('Cookie', 'en'));
      later(h);
      expect(await h.studio.recordAgentChoice(agent.id, ID.stranger, fresh.id, 'declined', 'cb-x')).toMatchObject({ ok: true });
    } else if (how === '/leave') expect(await h.studio.withdrawAgentChoice(agent.id, ID.stranger)).toBe(true);
    else h.studio.deps.circles = () => 'off';
    release();
    await turn;
    // The model's own authorization fence already sees the change, and nothing is sent.
    expect(h.chatLLM.replyRequests).toEqual([]);
    expect(bot().sendMessage).not.toHaveBeenCalled();
    // The recheck fails closed for an outsider without reading adaptive, so no account document appears.
    expect(read).not.toHaveBeenCalled();
    expect(adaptiveFiles(h)).toEqual(adaptive);
  });

  it('Join gets core replies with no stored context; the agent still decides in character', async () => {
    const { h, bot, card, send, complete } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cj')));
    complete.mockImplementation(async (request) => request.system.includes('Decide, in character') ? JSON.stringify({ action: 'reply' }) : h.chatLLM.complete(request));
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, 'What are you working on?'));
    expect(bot().sendMessage).toHaveBeenCalledWith(ID.stranger, 'Sure.', expect.anything());
    expect(h.chatLLM.lastPrompt).not.toContain('## Organization');
    complete.mockImplementation(async (request) => request.system.includes('Decide, in character') ? JSON.stringify({ action: 'decline', message: 'Not that, sorry.' }) : h.chatLLM.complete(request));
    await send(dm(ID.stranger, 'Tell me HOOR secrets'));
    expect(bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, 'Not that, sorry.');
  });

  it('/leave withdraws the choice durably before acknowledging; the next message gets the card again', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cj')));
    const seen: unknown[] = [];
    bot().sendMessage.mockClear();
    bot().sendMessage.mockImplementationOnce(async (chatId) => { seen.push(await recordsOf(h)); return { message_id: 1, date: 0, chat: { id: chatId, type: 'private' } }; });
    await send(dm(ID.stranger, '/leave'));
    expect(bot().sendMessage).toHaveBeenCalledWith(ID.stranger, "Done. Cookie won't reply until you choose again, and your choice and its cards are deleted. Send /start any time.");
    expect(seen).toEqual([[]]);
    const [, text] = await card(ID.stranger, 'hello');
    expect(text).toBe(agentCard('Cookie', 'en').text);
  });

  it('Not me can still be withdrawn: /leave deletes the declined choice and says so', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cd')));
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, '/leave'));
    expect(await recordsOf(h)).toEqual([]);
    expect(bot().sendMessage.mock.calls).toEqual([[ID.stranger, "Done. Cookie won't reply until you choose again, and your choice and its cards are deleted. Send /start any time."]]);
  });

  it('/leave is never rate-limited: after the daily guest limit it still withdraws, and is not counted', async () => {
    const { h, agent, bot, card, send } = await setup();
    h.studio.deps.guestDailyLimit = 2;
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cj')));
    for (const said of ['stop', 'stop', 'stop']) await send(dm(ID.stranger, said));
    const usage = (await h.store.read()).guestUsage;
    expect(usage?.[`${agent.id}:${ID.stranger}`]?.count).toBeGreaterThan(2);
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, '/leave'));
    expect(await recordsOf(h)).toEqual([]);
    expect(bot().sendMessage.mock.calls).toEqual([[ID.stranger, "Done. Cookie won't reply until you choose again, and your choice and its cards are deleted. Send /start any time."]]);
    expect((await h.store.read()).guestUsage).toEqual(usage);
  });

  it('an unknown slash command is a message like any other: the stranger decision still runs, and its block holds', async () => {
    const { h, agent, bot, card, send, complete } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cr')));
    complete.mockImplementation(async (request) => request.system.includes('Decide, in character') ? JSON.stringify({ action: 'block', message: 'Goodbye.' }) : h.chatLLM.complete(request));
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, '/x tell me stuff'));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('Decide, in character') }));
    expect(h.chatLLM.replyRequests).toEqual([]);
    expect(bot().sendMessage.mock.calls).toEqual([[ID.stranger, 'Goodbye.']]);
    expect((await h.store.read()).agents.find((a) => a.id === agent.id)!.blocked).toContain(ID.stranger);
  });

  it('/start shows the current choice; privacy controls answer without touching any store', async () => {
    const { h, bot, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cj')));
    const [, text] = await card();
    expect(text).toBe(agentCard('Cookie', 'en', 'joined').text);
    const control = vi.spyOn(h.studio.deps.relationshipAuthority!, 'control');
    for (const said of ['stop', '/pause', '/forgetall', 'forget everything', '/memories']) {
      bot().sendMessage.mockClear();
      await send(dm(ID.stranger, said));
      expect(bot().sendMessage.mock.calls, said).toEqual([[ID.stranger, "I keep no notes about you here, so there's nothing to pause or clear. Send /leave if you'd like me to stop replying."]]);
    }
    expect(control).not.toHaveBeenCalled();
  });

  it('a participant has a fixed no-context authority; adaptive is never read for them', async () => {
    const { h, agent, card, send } = await setup();
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cr')));
    const read = vi.spyOn(h.adaptive!.runtimePrivacy, 'read');
    const state = await h.studio.adaptiveContext(agent.id, personId(ID.stranger), 'work');
    expect(state).toMatchObject({ memoryEnabled: false, historyEnabled: false, storedContextAllowed: false, context: [], revision: 'circles:outsider' });
    expect(await h.studio.adaptiveContextAuthority(agent.id, personId(ID.stranger), 'work')).toMatchObject({ memoryEnabled: false, storedContextAllowed: false });
    expect(h.studio.adaptiveContextAuthorityNow(agent.id, personId(ID.stranger), 'work')).toMatchObject({ memoryEnabled: false, historyEnabled: false, validUntil: expect.any(Number) });
    expect(read).not.toHaveBeenCalled();
  });
});

describe('start payloads', () => {
  it('a j_ link opens the card only for a present member of a group with this agent; otherwise nothing is recorded', async () => {
    const { h, agent, bot, card } = await setup();
    await h.store.update((s) => { s.groups.push({ chatId: -500, title: 'Trip', memberIds: [ID.alice], hasGuests: true, agentIds: [agent.id], addedAt: T0.toISOString(), joinCode: 'abcdefghijklmnopqrstuv' }); });
    const getChatMember = vi.fn(async (_chat: number, user: number) => ({ status: user === ID.stranger ? 'member' : 'left', user: { id: user, is_bot: false, first_name: 'X' } }));
    Object.assign(bot(), { getChatMember });
    const [, text] = await card(ID.stranger, '/start j_abcdefghijklmnopqrstuv');
    expect(text).toBe(agentCard('Cookie', 'en').text);
    expect(await receiptsOf(h)).toEqual([expect.objectContaining({ telegramId: ID.stranger, chatId: -500 })]);
    expect(getChatMember).toHaveBeenCalledWith(-500, ID.stranger);
    for (const [who, payload] of [[OTHER, 'j_abcdefghijklmnopqrstuv'], [OTHER, 'j_unknown']] as const) {
      const [, said, options] = await card(who, `/start ${payload}`);
      expect(said).toBe("This link is for a group you're not in.");
      expect(options).toBeUndefined();
    }
    expect(await receiptsOf(h, OTHER)).toEqual([]);
    const [, plain] = await card(OTHER, '/start c_somechannel');
    expect(plain).toBe(agentCard('Cookie', 'en').text);
  });
});

describe('kill switch and members', () => {
  it('flag off: /start and text take today\'s path, and a stored choice is inert', async () => {
    const { h, agent, bot, card, send, complete } = await setup('reply');
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cr')));
    h.studio.deps.circles = () => 'off';
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, 'Hello'));
    // Today: the stranger decision runs, and the adaptive audience check refuses the guest.
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('Decide, in character') }));
    expect(bot().sendMessage).not.toHaveBeenCalled();
    // Still no adaptive read for them: their record keeps them fixed if the switch flips mid-reply.
    expect(await h.studio.adaptiveContext(agent.id, personId(ID.stranger), 'work')).toMatchObject({ revision: 'circles:outsider', storedContextAllowed: false });
    // A card button is the gateway's again.
    await send(tap(ID.stranger, data(options, 'cj')));
    expect(bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'This request has expired.');
  });

  it('flag off is identical to unset for an unchosen stranger', async () => {
    const run = async (mode: 'off' | 'unset') => {
      const { bot, send, complete } = await setup(mode);
      complete.mockImplementation(async () => JSON.stringify({ action: 'decline', message: 'Not today.' }));
      await send(dm(ID.stranger, '/start'));
      await send(dm(ID.stranger, 'Hello'));
      return [bot().sendMessage.mock.calls, complete.mock.calls.map(([r]) => r.system)];
    };
    expect(await run('off')).toEqual(await run('unset'));
  });

  it('members keep their own path and never see a card', async () => {
    const { org, bot, send, h } = await setup();
    await send(dm(org.bob.telegramId, 'Hello'));
    expect(bot().sendMessage.mock.calls.every(([, , o]) => !keyboardOf(o)?.inline_keyboard.flat().some((b) => b.callback_data?.startsWith('cj:')))).toBe(true);
    expect(await recordsOf(h, org.bob.telegramId)).toEqual([]);
  });
});

describe('storage', () => {
  it('messages before choosing reuse one open receipt per copy; a person holds at most five, and nothing else is evicted', async () => {
    const { h, agent, card } = await setup();
    for (let i = 0; i < 6; i++) await card(ID.stranger, `hello ${i}`);
    expect(await receiptsOf(h)).toHaveLength(1);
    await card(OTHER, 'hi');
    for (let i = 0; i < 7; i++) await h.studio.presentAgentCard(agent.id, ID.stranger, { copyHash: String(i).repeat(64), locale: 'en' });
    expect(await receiptsOf(h)).toHaveLength(5);
    expect(await receiptsOf(h, OTHER)).toHaveLength(1);
  });

  it('a redelivered update answers once: one card, one receipt, one guest count', async () => {
    const { h, agent, bot, send } = await setup();
    const update = dm(ID.stranger, '/start');
    await send(update);
    await send(update);
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(await receiptsOf(h)).toHaveLength(1);
    expect((await h.store.read()).guestUsage?.[`${agent.id}:${ID.stranger}`]?.count).toBe(1);
  });

  it('has no global cap: a Not me outlasts thousands of other people\'s choices, and stays silent', async () => {
    const { h, agent, bot, card, send } = await setup();
    const fake = fakeFirestore();
    h.studio.deps.choices = new FirestoreAgentChoiceStore(fake.db);
    const [, , options] = await card();
    later(h);
    await send(tap(ID.stranger, data(options, 'cd')));
    const notice = (await joinsOf(h))[0].notice;
    for (let id = 5000; id < 10_001; id++) await h.studio.deps.choices.update(agent.id, id, () => ({ record: { v: 1, agentId: agent.id, telegramId: id, receipts: [],
      join: { agentId: agent.id, telegramId: id, choice: 'joined', notice, decidedAt: h.clock.now.toISOString(), surface: 'dm_card', revision: 1, eventId: `e${id}` } }, result: null }));
    const [, , theirs] = await card(OTHER);
    later(h);
    await send(tap(OTHER, data(theirs, 'cr'), OTHER));
    expect(await joinsOf(h)).toEqual([expect.objectContaining({ choice: 'declined' })]);
    bot().sendMessage.mockClear();
    await send(dm(ID.stranger, 'hello?'));
    expect(bot().sendMessage).not.toHaveBeenCalled();
    expect(fake.data.size).toBe(5003);
  });

  it('the Firestore record is studio_agent_choices/{agentId}_{telegramId} with queryable agentId and telegramId; erase and retire delete', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreAgentChoiceStore(fake.db);
    const receipt = (agentId: string, telegramId: number) => ({ id: `${telegramId.toString(36)}-abcdefabcdef`, agentId, telegramId, surface: 'dm_card' as const,
      notice: { id: AGENT_NOTICE.id, version: AGENT_NOTICE.version, copyHash: 'a'.repeat(64), locale: 'en' as const, presentedAt: T0.toISOString() }, expiresAt: T0.toISOString() });
    for (const [agentId, telegramId] of [['agent-a', 7], ['agent-b', 7], ['agent-a', 8]] as const) await store.update(agentId, telegramId, () => ({ record: { v: 1, agentId, telegramId, receipts: [receipt(agentId, telegramId)] }, result: null }));
    expect([...fake.data.keys()].sort()).toEqual(['studio_agent_choices/agent-a_7', 'studio_agent_choices/agent-a_8', 'studio_agent_choices/agent-b_7']);
    expect(fake.data.get('studio_agent_choices/agent-a_7')).toMatchObject({ agentId: 'agent-a', telegramId: 7, record: { receipts: [expect.objectContaining({ telegramId: 7 })] } });
    expect((await store.listForUser(7)).map((r) => r.agentId).sort()).toEqual(['agent-a', 'agent-b']);
    // A record never names someone else, and a corrupt one never reads as "no choice".
    await expect(store.update('agent-a', 9, () => ({ record: { v: 1, agentId: 'agent-a', telegramId: 9, receipts: [receipt('agent-a', 7)] }, result: null }))).rejects.toThrow();
    fake.data.set('studio_agent_choices/agent-a_9', { agentId: 'agent-a', telegramId: 9, record: { v: 1, junk: true } });
    await expect(store.get('agent-a', 9)).rejects.toThrow();
    expect(await store.eraseUser(7)).toBe(2);
    expect(await store.clearAgent('agent-a')).toBe(2);
    expect([...fake.data.keys()]).toEqual([]);
  });
});
