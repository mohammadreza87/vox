/**
 * Circles S3 (GROUP_AGENTS_SPEC §9 S3 as amended by R2): personal notes, group copies, quiet DM
 * delivery, recall and the NoteSelector seam. A save is proposed only for an explicit "remember this"
 * and confirmed only by the asker; a group save writes one copy per joined recipient and only then
 * confirms (counts only) and DMs each recipient quietly. Recall: a DM uses the person's own copies;
 * a group uses a note only while every reader holds it and the turn is circle-complete for the agent,
 * re-checked at send. Erasing removes only your own copy; leaving erases nothing; the kill switch
 * restores today's behaviour.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramApiError, type TelegramChat, type TelegramChatMemberUpdated, type TelegramMessage, type TelegramUpdate, type TelegramUser } from '../../tireh/telegram/client';
import { MemoryAdaptiveStorage } from '../../adaptive/persistence/storage';
import { accountIdFor } from '../../adaptive/persistence/repository';
import { CircleNotes, MAX_NOTES_BYTES, notesKey, NotesRepository, parseNotes, usableCopies } from '../../circles/notes';
import { decisionsSelector, explicitSelector, noteSelectorFor, parseNoteSelector, parseRememberIntent } from '../../circles/note-selector';
import { agentShortCode, noteCallback, parseNoteCallback, receiptIdFor } from '../../circles/codec';
import { NOTES_MAX_ACTIVE } from '../../circles/contracts';
import { groupCopy, notesCopy } from '../../circles/notice';
import { groupIdOf } from '../../circles/service';
import type { ChatContext } from '../../tireh/types';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, SECRET, seedOrg, type Harness } from './helpers';

const CHAT = -100778;
const SARA = 1234;
const TITLE = 'HOOR family';
const TRIP = "we're going to Shiraz in May";
const EN = notesCopy('en');
let updateId = 990_000;
type Button = { text: string; callback_data?: string; url?: string };
const flat = (options: unknown) => ((options as { keyboard?: { inline_keyboard: Button[][] } } | undefined)?.keyboard?.inline_keyboard ?? []).flat();

beforeEach(() => { vi.stubEnv('STUDIO_GROUP_OBSERVATION', 'on'); vi.stubEnv('TIREH_CACHED_PROMPT', ''); });
afterEach(() => vi.unstubAllEnvs());

const user = (id: number, language_code?: string): TelegramUser => ({ id, is_bot: false, first_name: id === ID.stranger ? 'Parastoo' : id === ID.alice ? 'Reza' : 'Sara', ...(language_code ? { language_code } : {}) });
const added = (from: number): TelegramChatMemberUpdated => ({
  chat: { id: CHAT, type: 'supergroup', title: TITLE }, from: user(from), date: 0,
  old_chat_member: { status: 'left', user: { id: 1, is_bot: true, first_name: 'b' } }, new_chat_member: { status: 'member', user: { id: 1, is_bot: true, first_name: 'b' } },
});
function groupMessage(from: number, text: string, extra: Partial<TelegramMessage> = {}): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, from: user(from), chat: { id: CHAT, type: 'supergroup' }, date: 0, text, ...extra } };
}
function dm(from: number, text: string): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, date: 0, text, from: user(from), chat: { id: from, type: 'private' } } };
}
function tap(from: number, data: string, chat: TelegramChat = { id: CHAT, type: 'supergroup' }, messageId = 4242): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, callback_query: { id: `cb-${id}`, from: user(from), data, message: { message_id: messageId, date: 0, chat } } };
}
const later = (h: Harness, ms = 11_000) => { h.clock.now = new Date(h.clock.now.getTime() + ms); };
/** Everything the model was shown for a reply (system, messages and saved context). */
const lastReply = (h: Harness) => JSON.stringify(h.chatLLM.replyRequests.at(-1) ?? null);

/**
 * Reza (member, ID.alice) and Parastoo (outsider, ID.stranger) in an allowlisted group with Cookie and
 * Mina, both public. Both joined on Cookie's card; `minaBy` include Mina.
 */
async function circle(options: { minaBy?: number[]; mode?: 'circles' | 'reply' | 'off'; solo?: true } = {}) {
  const h = makeStudio();
  const org = await seedOrg(h);
  const cookie = await hire(h, org.alice, { name: 'Cookie', role: 'Companion' }, undefined, 'public');
  const mina = await hire(h, org.alice, { name: 'Mina', role: 'Companion' }, undefined, 'public');
  let mode: 'circles' | 'reply' | 'off' = 'circles';
  h.studio.deps.circles = () => mode;
  h.studio.deps.circleChats = () => new Set([CHAT]);
  const roster = new Set<number>([ID.alice, ID.stranger]), bots = new Set<number>();
  for (const hired of [cookie, mina]) {
    Object.assign(hired.bot(), { getChatMember: vi.fn(async (_chat: number, id: number) => ({ status: roster.has(id) || bots.has(id) ? 'member' : 'left', user: { id, is_bot: bots.has(id), first_name: 'S' } })) });
    hired.bot().getChatMemberCount.mockImplementation(async () => roster.size + bots.size);
  }
  const send = (u: TelegramUpdate, agentId = cookie.agent.id) => handleAgentUpdate(h.studio, agentId, u);
  const add = async (hired: typeof cookie) => {
    bots.add(hired.botId);
    await h.studio.onBotChatMember((await h.store.read()).agents.find((a) => a.id === hired.agent.id)!, added(ID.alice));
  };
  await add(cookie);
  later(h, 1000);
  const ledger = h.studio.deps.circleLedger!;
  const cardId = (await ledger.get(CHAT))!.card!.id;
  for (const who of [ID.alice, ID.stranger]) { await send(tap(who, `cj:${cardId}`)); later(h); }
  if (!options.solo) {
    await add(mina);
    later(h, 1000);
    const include = (await ledger.get(CHAT))!.agents.find((a) => a.agentId === mina.agent.id)!.card!.id;
    for (const who of options.minaBy ?? [ID.alice, ID.stranger]) { await send(tap(who, `ci:${include}`), mina.agent.id); later(h); }
  }
  // Both people have spoken in the group (the gateway knows them as its readers).
  for (const who of [ID.alice, ID.stranger]) await h.studio.noteGroupSpeaker(CHAT, user(who));
  await h.studio.verifyGroupAudience(cookie.agent.id, CHAT);
  mode = options.mode ?? 'circles';
  const notes = h.studio.deps.notesLedger!;
  /** "Cookie, remember for us: …" from Reza, then his tap on 📌 Save; returns the proposal's callback data. */
  const save = async (text = `Cookie, remember for us: ${TRIP}`, from = ID.alice, agent = cookie) => {
    agent.bot().sendMessage.mockClear();
    await send(groupMessage(from, text), agent.agent.id);
    const proposal = agent.bot().sendMessage.mock.calls.find(([, , o]) => flat(o).some((b) => b.callback_data?.startsWith('cs:')));
    const data = proposal ? flat(proposal[2]).find((b) => b.callback_data!.startsWith('cs:'))!.callback_data! : undefined;
    if (data) { later(h, 1000); await send(tap(from, data), agent.agent.id); }
    return { proposal, data };
  };
  return { h, org, cookie, mina, roster, bots, send, save, ledger, notes, setMode: (m: typeof mode) => { mode = m; } };
}

describe('saving in a complete circle', () => {
  it('Reza saves via Cookie: one copy each (shared noteId), then a silent "Saved for the 2 of you" and a quiet DM to each; Mina recalls it in the group', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    const { proposal } = await x.save();
    expect(proposal).toBeDefined();
    const [chatId, text, options] = proposal!;
    expect(chatId).toBe(CHAT);
    expect(text).toBe(EN.propose(TRIP));
    expect(options).toMatchObject({ silent: true, replyTo: expect.any(Number) });
    expect(flat(options).map((b) => b.text)).toEqual(['📌 Save', 'No']);
    for (const b of flat(options)) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
    // No model call for a proposal, and nothing was replied to the message itself.
    expect(x.h.chatLLM.replyRequests).toEqual([]);

    const reza = (await x.notes.read(ID.alice))!.copies, parastoo = (await x.notes.read(ID.stranger))!.copies;
    expect(reza).toHaveLength(1);
    expect(parastoo).toHaveLength(1);
    expect(reza[0]).toMatchObject({ noteId: parastoo[0].noteId, text: TRIP, origin: 'group', savedByAgentId: x.cookie.agent.id, fromGroupId: groupIdOf(CHAT), groupTitle: TITLE,
      authorTelegramId: ID.alice, status: 'active' });
    expect(new Set(reza[0].agentIds)).toEqual(new Set([x.cookie.agent.id, x.mina.agent.id]));
    expect(parastoo[0].agentIds).toEqual(reza[0].agentIds);
    expect(parastoo[0].copyId).not.toBe(reza[0].copyId);
    expect(Date.parse(reza[0].expiresAt) - Date.parse(reza[0].savedAt)).toBe(365 * 86_400_000);
    // Counts only in the group, silent; a quiet DM to each recipient from the saving agent's bot.
    expect(bot.sendMessage).toHaveBeenCalledWith(CHAT, EN.savedFor(2), expect.objectContaining({ silent: true }));
    expect(bot.sendMessage).toHaveBeenCalledWith(ID.alice, EN.delivered(TITLE, TRIP), { silent: true });
    expect(bot.sendMessage).toHaveBeenCalledWith(ID.stranger, EN.delivered(TITLE, TRIP), { silent: true });
    expect(JSON.stringify(bot.sendMessage.mock.calls.filter(([c]) => c === CHAT))).not.toMatch(/Parastoo|Reza/);
    expect(x.mina.bot().sendMessage.mock.calls.filter(([c]) => c === ID.alice || c === ID.stranger)).toEqual([]);
    // Notes live in their own store, never the Studio document; nothing became memory.
    expect(existsSync(join(x.h.dir, 'circles', 'notes'))).toBe(true);

    await x.send(groupMessage(ID.stranger, "Mina, when's our trip?"), x.mina.agent.id);
    expect(lastReply(x.h)).toContain(`From ${TITLE}: ${TRIP}`);
    expect(x.mina.bot().sendMessage).toHaveBeenLastCalledWith(CHAT, 'Sure.', expect.objectContaining({ replyTo: expect.any(Number) }));
    expect(x.h.chatLLM.extractionCalls).toBe(0);
    // hasGuests keeps its meaning: an outsider still reads, so org and private memory stay off.
    expect((await x.h.store.read()).groups[0].hasGuests).toBe(true);
    expect(lastReply(x.h)).not.toContain('## Organization');
  });

  it('Parastoo asks Cookie (and Mina) in her DM and gets the note labelled with the group; Reza too', async () => {
    const x = await circle();
    await x.save();
    await x.send(dm(ID.stranger, 'what did we plan?'));
    expect(lastReply(x.h)).toContain(`From ${TITLE}: ${TRIP}`);
    await x.send(dm(ID.stranger, 'and you, Mina?'), x.mina.agent.id);
    expect(lastReply(x.h)).toContain(`From ${TITLE}: ${TRIP}`);
    await x.send(dm(ID.alice, 'what did we plan?'));
    expect(lastReply(x.h)).toContain(`From ${TITLE}: ${TRIP}`);
    // Her DM stays the S1 fixed no-context path: no adaptive document for the outsider.
    const storage = x.h.adaptive!.repository.storage;
    expect(storage.readCommittedForEffect!(accountIdFor(ID.stranger))).toEqual({ status: 'ready', document: null });
    expect(storage.readCommittedForEffect!(accountIdFor(ID.alice))).not.toEqual({ status: 'ready', document: null });
  });

  it('a third person arriving: the next group turn of both bots has no note context, while the DMs still recall it', async () => {
    const x = await circle();
    await x.save();
    x.roster.add(SARA);
    await x.send(groupMessage(ID.alice, 'Mina, remind me?'), x.mina.agent.id);
    expect(lastReply(x.h)).not.toContain(TRIP);
    await x.send(groupMessage(ID.alice, 'Cookie, remind me?'));
    expect(lastReply(x.h)).not.toContain(TRIP);
    await x.send(dm(ID.stranger, 'what did we plan?'));
    expect(lastReply(x.h)).toContain(`From ${TITLE}: ${TRIP}`);
    await x.send(dm(ID.alice, 'what did we plan?'), x.mina.agent.id);
    expect(lastReply(x.h)).toContain(`From ${TITLE}: ${TRIP}`);
    // And a save is refused kindly while the circle is incomplete: nothing written.
    const { proposal } = await x.save(`Cookie, remember for us: dinner on Friday`);
    expect(proposal).toBeUndefined();
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(CHAT, EN.notComplete, expect.objectContaining({ silent: true }));
    expect((await x.notes.read(ID.alice))!.copies).toHaveLength(1);
  });

  it('if Parastoo did not cover Mina, Mina never sees the note anywhere', async () => {
    const x = await circle({ minaBy: [ID.alice] });
    await x.save();
    for (const who of [ID.alice, ID.stranger]) expect((await x.notes.read(who))!.copies[0].agentIds).toEqual([x.cookie.agent.id]);
    await x.send(groupMessage(ID.alice, 'Mina, when is the trip?'), x.mina.agent.id);
    expect(lastReply(x.h)).not.toContain(TRIP);
    for (const who of [ID.alice, ID.stranger]) {
      await x.send(dm(who, 'what did we plan?'), x.mina.agent.id);
      expect(lastReply(x.h)).not.toContain(TRIP);
    }
    await x.send(groupMessage(ID.stranger, 'Cookie, when is the trip?'));
    expect(lastReply(x.h)).toContain(TRIP);
  });

  it('Parastoo erases her copy: the note leaves the group, Reza\'s DM still has it, and only her copy changed', async () => {
    const x = await circle();
    await x.save();
    const before = (await x.notes.read(ID.alice))!;
    const bot = x.cookie.bot();
    bot.sendMessage.mockClear();
    await x.send(dm(ID.stranger, '/notes'));
    const [chatId, text, options] = bot.sendMessage.mock.calls.at(-1)!;
    expect(chatId).toBe(ID.stranger);
    expect(text).toContain(`1. ${TRIP}${EN.from(TITLE)}`);
    expect(text).toContain('Erasing removes only your own copy.');
    const erase = flat(options)[0];
    expect(erase.text).toBe('Erase 1');
    expect(Buffer.byteLength(erase.callback_data!)).toBeLessThanOrEqual(64);
    // Reza cannot press her button.
    await x.send(tap(ID.alice, erase.callback_data!, { id: ID.alice, type: 'private' }));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notYourNotes, true);
    await x.send(tap(ID.stranger, erase.callback_data!, { id: ID.stranger, type: 'private' }, 77));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.erased(TRIP));
    expect(bot.editMessageText).toHaveBeenLastCalledWith(ID.stranger, 77, EN.none('Cookie'), undefined);
    const mine = (await x.notes.read(ID.stranger))!.copies[0];
    expect(mine).toMatchObject({ status: 'deleted', deletedAt: expect.any(String) });
    expect(mine).not.toHaveProperty('text');
    expect(await x.notes.read(ID.alice)).toEqual(before);

    await x.send(groupMessage(ID.alice, 'Mina, when is the trip?'), x.mina.agent.id);
    expect(lastReply(x.h)).not.toContain(TRIP);
    await x.send(dm(ID.alice, 'what did we plan?'));
    expect(lastReply(x.h)).toContain(TRIP);
    await x.send(dm(ID.stranger, 'what did we plan?'));
    expect(lastReply(x.h)).not.toContain(TRIP);
  });

  it('/forget <n> erases your own copy from the list shown; a member\'s /forget means /notes only while /notes was the last list', async () => {
    const x = await circle();
    await x.save();
    const bot = x.cookie.bot();
    // Nothing was listed yet: no number to count against.
    await x.send(dm(ID.stranger, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.pick);
    await x.send(dm(ID.stranger, '/notes'));
    await x.send(dm(ID.stranger, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.erased(TRIP));
    // The same number again names the same (now erased) copy, never the next one.
    await x.send(dm(ID.stranger, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.gone);
    // Reza (a member): /forget is today's /memories command until he asks for /notes.
    await x.send(dm(ID.alice, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.alice, 'Send /memories first, then /forget with a number from the list.');
    await x.send(dm(ID.alice, '/notes'));
    // /memories shown since: his /forget is the memory list's again, and his note stays.
    await x.send(dm(ID.alice, '/memories'));
    await x.send(dm(ID.alice, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.alice, 'Send /memories first, then /forget with a number from the list.');
    expect(usableCopies(await x.notes.read(ID.alice), x.cookie.agent.id, x.h.clock.now)).toHaveLength(1);
    await x.send(dm(ID.alice, '/notes'));
    await x.send(dm(ID.alice, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.alice, EN.erased(TRIP));
  });

  it('/forget <n> counts against the list shown: a save landing in between never shifts the number', async () => {
    const x = await circle();
    await x.save();
    const bot = x.cookie.bot();
    await x.send(dm(ID.stranger, '/notes'));
    expect(bot.sendMessage.mock.calls.at(-1)![1]).toContain(`1. ${TRIP}`);
    // Reza saves a newer note: it would be number 1 in a fresh list.
    later(x.h, 60_000);
    await x.save('Cookie, remember for us: dinner on Friday');
    expect(usableCopies(await x.notes.read(ID.stranger), x.cookie.agent.id, x.h.clock.now)).toHaveLength(2);
    await x.send(dm(ID.stranger, '/forget 1'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.erased(TRIP));
    expect(usableCopies(await x.notes.read(ID.stranger), x.cookie.agent.id, x.h.clock.now).map((c) => c.text)).toEqual(['dinner on Friday']);
    // /forgetnote is the unambiguous form, for a member too.
    await x.send(dm(ID.alice, '/notes'));
    await x.send(dm(ID.alice, '/forgetnote 2'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.alice, EN.erased(TRIP));
  });

  it('/notes in the group is answered by one agent with a silent DM, never in the group', async () => {
    const x = await circle();
    await x.save();
    for (const hired of [x.cookie, x.mina]) hired.bot().sendMessage.mockClear();
    for (const hired of [x.cookie, x.mina]) await x.send(groupMessage(ID.stranger, '/notes'), hired.agent.id);
    const all = [...x.cookie.bot().sendMessage.mock.calls, ...x.mina.bot().sendMessage.mock.calls];
    expect(all.filter(([c]) => c === CHAT)).toEqual([]);
    expect(all).toHaveLength(1);
    expect(all[0][0]).toBe(ID.stranger);
    expect(all[0][1]).toContain(TRIP);
    expect(all[0][2]).toMatchObject({ silent: true });
    // A DM that cannot be sent is dropped, still nothing in the group.
    x.cookie.bot().sendMessage.mockRejectedValueOnce(new TelegramApiError('sendMessage', "Forbidden: bot can't initiate conversation with a user"));
    await x.send(groupMessage(ID.stranger, '/notes'));
    expect(x.cookie.bot().sendMessage.mock.calls.filter(([c]) => c === CHAT)).toEqual([]);
  });

  it('a DM that fails (403) still stores the copy', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    const real = bot.sendMessage.getMockImplementation()!;
    bot.sendMessage.mockImplementation(async (chatId: number, text: string, o?: unknown) => {
      if (chatId === ID.stranger) throw new TelegramApiError('sendMessage', "Forbidden: bot can't initiate conversation with a user");
      return real(chatId, text, o);
    });
    await x.save();
    expect((await x.notes.read(ID.stranger))!.copies).toEqual([expect.objectContaining({ text: TRIP, status: 'active' })]);
    expect(bot.sendMessage).toHaveBeenCalledWith(CHAT, EN.savedFor(2), expect.objectContaining({ silent: true }));
    expect(bot.sendMessage).toHaveBeenCalledWith(ID.alice, EN.delivered(TITLE, TRIP), { silent: true });
  });

  it('only the asker can confirm; a forwarded button is refused; a replay saves once; No saves nothing', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    await x.send(groupMessage(ID.alice, `Cookie, remember for us: ${TRIP}`));
    const data = flat(bot.sendMessage.mock.calls.at(-1)![2]).find((b) => b.callback_data!.startsWith('cs:'))!.callback_data!;
    later(x.h, 1000);
    await x.send(tap(ID.stranger, data));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notYours, true);
    // Forwarded into Parastoo's DM and pressed there by her: refused the same way.
    await x.send(tap(ID.stranger, data, { id: ID.stranger, type: 'private' }));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notYours, true);
    // The asker pressing a copy of it in another chat: refused (it is bound to its chat).
    await x.send(tap(ID.alice, data, { id: ID.alice, type: 'private' }));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.expired, true);
    expect(await x.notes.read(ID.stranger)).toBeNull();
    await x.send(tap(ID.alice, data));
    await x.send(tap(ID.alice, data));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.saved);
    for (const who of [ID.alice, ID.stranger]) expect((await x.notes.read(who))!.copies).toHaveLength(1);
    expect(bot.sendMessage.mock.calls.filter(([, text]) => text === EN.savedFor(2))).toHaveLength(1);

    await x.send(groupMessage(ID.alice, 'Cookie, remember for us: dinner on Friday'));
    const no = flat(bot.sendMessage.mock.calls.at(-1)![2]).find((b) => b.callback_data!.startsWith('cn:'))!.callback_data!;
    await x.send(tap(ID.alice, no));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.dismissed);
    expect((await x.notes.read(ID.alice))!.copies).toHaveLength(1);
    expect((await x.notes.read(ID.alice))!.proposals).toEqual([]);
  });

  it('proposals expire after 10 minutes', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    await x.send(groupMessage(ID.alice, `Cookie, remember for us: ${TRIP}`));
    const data = flat(bot.sendMessage.mock.calls.at(-1)![2]).find((b) => b.callback_data!.startsWith('cs:'))!.callback_data!;
    later(x.h, 10 * 60_000 + 1);
    await x.send(tap(ID.alice, data, undefined, 555));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.expired, true);
    expect(bot.editMessageText).toHaveBeenLastCalledWith(CHAT, 555, EN.expired);
    expect(await x.notes.read(ID.stranger)).toBeNull();
    expect((await x.notes.read(ID.alice))!.copies).toEqual([]);
  });

  it('the circle is re-checked at the tap: a reader who withdrew before the confirm means nothing is saved', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    await x.send(groupMessage(ID.alice, `Cookie, remember for us: ${TRIP}`));
    const data = flat(bot.sendMessage.mock.calls.at(-1)![2]).find((b) => b.callback_data!.startsWith('cs:'))!.callback_data!;
    await x.send(groupMessage(ID.stranger, '/leave'));
    await x.send(tap(ID.alice, data));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notComplete, true);
    expect(await x.notes.read(ID.stranger)).toBeNull();
    expect((await x.notes.read(ID.alice))!.copies).toEqual([]);
  });
});

describe('leaving, races and fences', () => {
  it('Parastoo leaves: she keeps her copy; notes saved after she left do not reach her', async () => {
    const x = await circle();
    await x.save();
    x.roster.delete(ID.stranger);
    await x.send(groupMessage(ID.alice, '', { left_chat_member: user(ID.stranger) }));
    expect((await x.ledger.get(CHAT))!.participants.find((p) => p.telegramId === ID.stranger)!.state).toBe('left');
    expect((await x.notes.read(ID.stranger))!.copies).toEqual([expect.objectContaining({ text: TRIP, status: 'active' })]);
    // Reza alone is a complete circle now: his next save is his only.
    await x.save('Cookie, remember for us: dinner on Friday');
    expect((await x.notes.read(ID.alice))!.copies.map((c) => c.text)).toEqual([TRIP, 'dinner on Friday']);
    expect((await x.notes.read(ID.stranger))!.copies.map((c) => c.text)).toEqual([TRIP]);
    expect(x.cookie.bot().sendMessage).toHaveBeenCalledWith(CHAT, EN.savedFor(1), expect.objectContaining({ silent: true }));
    expect(x.cookie.bot().sendMessage.mock.calls.filter(([c, t]) => c === ID.stranger && String(t).includes('Friday'))).toEqual([]);
    // Her DM still recalls the note she kept.
    await x.send(dm(ID.stranger, 'what did we plan?'));
    expect(lastReply(x.h)).toContain(TRIP);
    expect(lastReply(x.h)).not.toContain('Friday');
  });

  it('withdrawal racing a reply: the send is blocked (no reply carries the note)', async () => {
    const x = await circle();
    await x.save();
    const complete = x.h.chatLLM.complete.bind(x.h.chatLLM);
    let raced = false;
    x.h.chatLLM.complete = async (request) => {
      if (!raced) { raced = true; await x.h.studio.circleGroups.leave(CHAT, ID.stranger, 'race-leave'); }
      return complete(request);
    };
    x.mina.bot().sendMessage.mockClear();
    await x.send(groupMessage(ID.alice, 'Mina, when is the trip?'), x.mina.agent.id);
    expect(raced).toBe(true);
    expect(x.mina.bot().sendMessage.mock.calls.filter(([c]) => c === CHAT)).toEqual([]);
  });

  it('an erasure racing a reply is caught by the notes revision; one after every gate, by the final fence', async () => {
    const x = await circle();
    await x.save();
    const copyId = (await x.notes.read(ID.stranger))!.copies[0].copyId;
    const complete = x.h.chatLLM.complete.bind(x.h.chatLLM);
    x.h.chatLLM.complete = async (request) => { await x.notes.erase(ID.stranger, copyId, x.h.clock.now); return complete(request); };
    x.mina.bot().sendMessage.mockClear();
    await x.send(groupMessage(ID.alice, 'Mina, when is the trip?'), x.mina.agent.id);
    expect(x.mina.bot().sendMessage.mock.calls.filter(([c]) => c === CHAT)).toEqual([]);

    // The final fence: the erasure lands after canSend passed (while the reply keyboard is fetched).
    const y = await circle();
    await y.save();
    const theirs = (await y.notes.read(ID.stranger))!.copies[0].copyId;
    const fence = vi.spyOn(y.h.studio.circleNotes, 'authority');
    const nudge = vi.spyOn(y.h.studio.circleGroups, 'nudge').mockImplementation(async () => { await y.notes.erase(ID.stranger, theirs, y.h.clock.now); return undefined; });
    y.mina.bot().sendMessage.mockClear();
    await y.send(groupMessage(ID.alice, 'Mina, when is the trip?'), y.mina.agent.id);
    expect(nudge).toHaveBeenCalled();
    expect(fence).toHaveBeenCalled();
    expect(y.mina.bot().sendMessage.mock.calls.filter(([c]) => c === CHAT)).toEqual([]);
  });
});

describe('DM saves', () => {
  it('a joined outsider saves in her DM: a proposal, then one copy and a silent 📌 Saved; recalled as "Your notes"', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    bot.sendMessage.mockClear();
    await x.send(dm(ID.stranger, 'remember this: my locker code is 42'));
    const [chatId, text, options] = bot.sendMessage.mock.calls.at(-1)!;
    expect([chatId, text]).toEqual([ID.stranger, EN.propose('my locker code is 42')]);
    const data = flat(options).find((b) => b.callback_data!.startsWith('cs:'))!.callback_data!;
    later(x.h, 1000);
    await x.send(tap(ID.stranger, data, { id: ID.stranger, type: 'private' }, 31));
    expect(bot.answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.saved);
    expect(bot.editMessageText).toHaveBeenLastCalledWith(ID.stranger, 31, EN.saved);
    const [copy] = (await x.notes.read(ID.stranger))!.copies;
    expect(copy).toMatchObject({ origin: 'dm', agentIds: [x.cookie.agent.id], savedByAgentId: x.cookie.agent.id, authorTelegramId: ID.stranger, text: 'my locker code is 42' });
    expect(copy).not.toHaveProperty('fromGroupId');
    await x.send(dm(ID.stranger, 'what is my code?'));
    expect(lastReply(x.h)).toContain('Your notes: my locker code is 42');
    // Mina was not part of that save.
    await x.send(dm(ID.stranger, 'what is my code?'), x.mina.agent.id);
    expect(lastReply(x.h)).not.toContain('locker');
    // Not in groups: a DM note is never group context.
    await x.send(groupMessage(ID.alice, 'Cookie, what is the code?'));
    expect(lastReply(x.h)).not.toContain('locker');
  });

  it('Persian works too; a member saves in his DM; Only reply to me saves nothing', async () => {
    const x = await circle();
    const bot = x.cookie.bot();
    await x.send(dm(ID.alice, 'فردا ساعت ۵ جلسه داریم، یادت باشه'));
    expect(bot.sendMessage.mock.calls.at(-1)![1]).toBe(EN.propose('فردا ساعت ۵ جلسه داریم'));
    const data = flat(bot.sendMessage.mock.calls.at(-1)![2])[0].callback_data!;
    await x.send(tap(ID.alice, data, { id: ID.alice, type: 'private' }));
    expect((await x.notes.read(ID.alice))!.copies[0]).toMatchObject({ origin: 'dm', text: 'فردا ساعت ۵ جلسه داریم' });
    // An outsider who chose Only reply: told how to join, nothing proposed or kept.
    const y = await circle();
    await y.h.studio.deps.choices!.update(y.cookie.agent.id, ID.stranger, (current) => ({ result: undefined, record: { ...current!, join: { ...current!.join!, choice: 'reply_only' } } }));
    await y.send(dm(ID.stranger, 'remember this: my locker code is 42'));
    expect(y.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.notJoined('Cookie'));
    expect(await y.notes.read(ID.stranger)).toBeNull();
    expect(y.h.chatLLM.replyRequests).toEqual([]);
  });
});

describe('group saves under concurrency and failure', () => {
  /** Reza's "remember for us" proposal in the group; returns its cs: data. */
  const propose = async (x: Awaited<ReturnType<typeof circle>>, text = TRIP) => {
    x.cookie.bot().sendMessage.mockClear();
    await x.send(groupMessage(ID.alice, `Cookie, remember for us: ${text}`));
    const data = flat(x.cookie.bot().sendMessage.mock.calls.at(-1)![2]).find((b) => b.callback_data!.startsWith('cs:'))!.callback_data!;
    later(x.h, 1000);
    x.cookie.bot().sendMessage.mockClear();
    return data;
  };
  const delivered = (x: Awaited<ReturnType<typeof circle>>, who: number) => x.cookie.bot().sendMessage.mock.calls.filter(([c, t]) => c === who && String(t).startsWith('📌 Saved from'));

  it('a withdrawal that commits while the copies are written: nobody keeps a copy, nobody is told it was saved', async () => {
    const x = await circle();
    const data = await propose(x);
    const save = x.notes.save.bind(x.notes);
    vi.spyOn(x.notes, 'save').mockImplementation(async (owner, input) => {
      if (owner === ID.stranger) await x.h.studio.circleGroups.leave(CHAT, ID.stranger, 'race-withdraw');
      return save(owner, input);
    });
    await x.send(tap(ID.alice, data));
    expect([EN.notComplete, EN.notSaved]).toContain(x.cookie.bot().answerCallbackQuery.mock.calls.at(-1)![1]);
    for (const who of [ID.alice, ID.stranger]) expect(usableCopies(await x.notes.read(who), x.cookie.agent.id, x.h.clock.now)).toEqual([]);
    expect(delivered(x, ID.stranger)).toEqual([]);
    expect(x.cookie.bot().sendMessage.mock.calls.filter(([, t]) => t === EN.savedFor(2))).toEqual([]);
  });

  it('forget me while the copies are written: the save is refused for her, so no copy outlives the erasure', async () => {
    const x = await circle();
    const data = await propose(x);
    const save = x.notes.save.bind(x.notes);
    vi.spyOn(x.notes, 'save').mockImplementation(async (owner, input) => {
      if (owner === ID.stranger) await x.h.studio.forgetNotes(ID.stranger);
      return save(owner, input);
    });
    await x.send(tap(ID.alice, data));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notSaved, true);
    expect((await x.notes.read(ID.stranger))!.copies).toEqual([]);
    expect(usableCopies(await x.notes.read(ID.alice), x.cookie.agent.id, x.h.clock.now)).toEqual([]);
    expect(delivered(x, ID.stranger)).toEqual([]);
  });

  it('a double tap (two updates at once) writes, confirms and DMs once', async () => {
    const x = await circle();
    const data = await propose(x);
    await Promise.all([x.send(tap(ID.alice, data)), x.send(tap(ID.alice, data))]);
    const bot = x.cookie.bot();
    expect(bot.sendMessage.mock.calls.filter(([, t]) => t === EN.savedFor(2))).toHaveLength(1);
    for (const who of [ID.alice, ID.stranger]) {
      expect(delivered(x, who)).toHaveLength(1);
      expect((await x.notes.read(who))!.copies).toHaveLength(1);
    }
    expect(bot.answerCallbackQuery.mock.calls.filter(([, t]) => t === EN.saved || t === EN.saving)).toHaveLength(2);
  });

  it('a copy that committed before its error is rolled back with the rest; the proposal can be tapped again', async () => {
    const x = await circle();
    const data = await propose(x);
    const save = x.notes.save.bind(x.notes);
    const failing = vi.spyOn(x.notes, 'save').mockImplementation(async (owner, input) => {
      const saved = await save(owner, input);
      if (owner === ID.stranger) throw new Error('deadline exceeded');
      return saved;
    });
    await x.send(tap(ID.alice, data));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), EN.notSaved, true);
    for (const who of [ID.alice, ID.stranger]) expect(usableCopies(await x.notes.read(who), x.cookie.agent.id, x.h.clock.now)).toEqual([]);
    failing.mockRestore();
    later(x.h, 1000);
    await x.send(tap(ID.alice, data));
    for (const who of [ID.alice, ID.stranger]) expect(usableCopies(await x.notes.read(who), x.cookie.agent.id, x.h.clock.now)).toHaveLength(1);
    expect(x.cookie.bot().sendMessage.mock.calls.filter(([, t]) => t === EN.savedFor(2))).toHaveLength(1);
  });

  it('a callback answer that fails after the commit (query too old) still confirms in the group and DMs each recipient', async () => {
    const x = await circle();
    const data = await propose(x);
    x.cookie.bot().answerCallbackQuery.mockRejectedValue(new TelegramApiError('answerCallbackQuery', 'Bad Request: query is too old and response timeout expired'));
    await x.send(tap(ID.alice, data));
    expect(x.cookie.bot().sendMessage).toHaveBeenCalledWith(CHAT, EN.savedFor(2), expect.objectContaining({ silent: true }));
    for (const who of [ID.alice, ID.stranger]) expect(delivered(x, who)).toHaveLength(1);
    expect(x.cookie.bot().editMessageText).toHaveBeenLastCalledWith(CHAT, 4242, EN.pinned(TRIP));
  });

  it('in a group with a single agent, unaddressed chatter never proposes or refuses', async () => {
    const x = await circle({ solo: true });
    x.roster.add(SARA);
    x.cookie.bot().sendMessage.mockClear();
    for (const text of ['remember this: bring the cake tomorrow', 'یادت باشه فردا کیک بیاری'])
      await x.send(groupMessage(ID.alice, text));
    const said = x.cookie.bot().sendMessage.mock.calls.map(([, t]) => t);
    expect(said.filter((t) => t === EN.notComplete || String(t).startsWith('Save this?'))).toEqual([]);
    // Addressed, the same words do get an answer (here: not complete, Sara is in the chat).
    await x.send(groupMessage(ID.alice, 'Cookie, remember this: bring the cake tomorrow'));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(CHAT, EN.notComplete, expect.objectContaining({ silent: true }));
  });
});

describe('outsider DM controls and limits', () => {
  it('"/notes@OtherBot" from an outsider is not a notes command: it takes the stranger decision', async () => {
    const x = await circle();
    await x.save();
    const decide = vi.spyOn(x.h.studio, 'decideOnStranger');
    x.cookie.bot().sendMessage.mockClear();
    await x.send(dm(ID.stranger, '/notes@SomeOtherBot'));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(x.cookie.bot().sendMessage.mock.calls.map(([, t]) => String(t)).filter((t) => t.includes(EN.header('Cookie')))).toEqual([]);
    await x.send(dm(ID.stranger, '/forget@SomeOtherBot 1'));
    expect(usableCopies(await x.notes.read(ID.stranger), x.cookie.agent.id, x.h.clock.now)).toHaveLength(1);
  });

  it('an outsider holding notes: /memories lists them, /pause points at /notes, "forget everything about me" erases her own copies', async () => {
    const x = await circle();
    await x.save();
    const bot = x.cookie.bot();
    await x.send(dm(ID.stranger, '/memories'));
    expect(bot.sendMessage.mock.calls.at(-1)![1]).toContain(`1. ${TRIP}`);
    await x.send(dm(ID.stranger, '/pause'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.kept('Cookie'));
    const reza = await x.notes.read(ID.alice);
    await x.send(dm(ID.stranger, 'forget everything about me'));
    expect(bot.sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.erasedAll(1, 'Cookie'));
    expect(usableCopies(await x.notes.read(ID.stranger), x.cookie.agent.id, x.h.clock.now)).toEqual([]);
    expect(await x.notes.read(ID.alice)).toEqual(reza);
    // Nothing left: the S1 answer is true again.
    await x.send(dm(ID.stranger, '/forgetall'));
    expect(String(bot.sendMessage.mock.calls.at(-1)![1])).toContain('I keep no notes about you here');
  });

  it('/notes stays within Telegram\'s 4096 limit, one button per line shown, and so does its refresh after Erase', async () => {
    const x = await circle();
    const long = `${'x'.repeat(130)} ${TITLE}`;
    for (let i = 0; i < 20; i++) {
      await x.notes.save(ID.stranger, { eventId: receiptIdFor(ID.stranger), noteId: `n-${i}`, text: `${i} ${'ب'.repeat(400)}`, origin: 'group', savedByAgentId: x.cookie.agent.id,
        agentIds: [x.cookie.agent.id], fromGroupId: groupIdOf(CHAT), groupTitle: long, authorTelegramId: ID.alice, at: new Date(x.h.clock.now.getTime() + i) });
    }
    const bot = x.cookie.bot();
    await x.send(dm(ID.stranger, '/notes'));
    const [, text, options] = bot.sendMessage.mock.calls.at(-1)!;
    expect(String(text).length).toBeLessThanOrEqual(4096);
    const lines = String(text).split('\n').filter((l) => /^\d+\. /.test(l));
    // Each line and its group title are clipped, so all 20 fit, each with its own button.
    expect(lines).toHaveLength(20);
    expect(flat(options)).toHaveLength(lines.length);
    for (const line of lines) expect(line.length).toBeLessThan(200);
    await x.send(tap(ID.stranger, flat(options)[2].callback_data!, { id: ID.stranger, type: 'private' }, 88));
    const edit = bot.editMessageText.mock.calls.at(-1)!;
    expect(String(edit[2]).length).toBeLessThanOrEqual(4096);
  });

  it('a notebook too full for one more proposal says so instead of failing the update', async () => {
    const x = await circle();
    const fill = async (chars: number) => {
      for (let i = 0; ; i++) {
        const outcome = await x.notes.save(ID.stranger, { eventId: receiptIdFor(ID.stranger), noteId: `f-${chars}-${i}`, text: 'ش'.repeat(chars), origin: 'dm', savedByAgentId: x.cookie.agent.id,
          agentIds: [x.cookie.agent.id], authorTelegramId: ID.stranger, at: x.h.clock.now });
        if (!outcome.ok) return;
      }
    };
    await fill(2000);
    await fill(100);
    await x.send(dm(ID.stranger, `remember this: ${'ق'.repeat(1500)}`));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.stranger, EN.full);
    // Shrinking writes still commit at the cap: an erasure goes through.
    const first = (await x.notes.read(ID.stranger))!.copies[0];
    expect(await x.notes.erase(ID.stranger, first.copyId, x.h.clock.now)).toMatchObject({ copyId: first.copyId });
  }, 120_000);
});

describe('rights', () => {
  it('export returns only the requester\'s copies; forget me deletes only theirs', async () => {
    const x = await circle();
    await x.save();
    const ownCopy = (await x.notes.read(ID.stranger))!.copies[0];
    const mine = await x.h.studio.notesFor(ID.stranger);
    expect(mine).toEqual([expect.objectContaining({ text: TRIP, author: 'another member', groupTitle: TITLE })]);
    expect(mine).toStrictEqual([{
      copyId: ownCopy.copyId, noteId: ownCopy.noteId, text: TRIP, origin: 'group',
      agentIds: [x.cookie.agent.id, x.mina.agent.id], fromGroupId: groupIdOf(CHAT), groupTitle: TITLE,
      author: 'another member', savedAt: ownCopy.savedAt, expiresAt: ownCopy.expiresAt,
    }]);
    expect((await x.h.studio.notesFor(ID.alice))[0].author).toBe('you');
    const reza = await x.notes.read(ID.alice);
    expect(await x.h.studio.forgetNotes(ID.stranger)).toBe(1);
    expect(await x.h.studio.notesFor(ID.stranger)).toEqual([]);
    expect(await x.notes.read(ID.stranger)).toEqual({ v: 1, copies: [], proposals: [], events: [], forgottenAt: x.h.clock.now.toISOString() });
    expect(await x.notes.read(ID.alice)).toEqual(reza);
    // Whatever the flag.
    x.setMode('off');
    expect(await x.h.studio.forgetNotes(ID.alice)).toBe(1);
    expect(await x.h.studio.notesFor(ID.alice)).toEqual([]);
  });

  it('exports an opaque agent ID containing an author ID without exposing private identity fields', async () => {
    const x = await circle();
    // A historical agent reference may contain the same digits as a person's ID.
    const agentId = 'ag3000000000';
    expect(agentId).toContain(String(ID.alice));
    expect(await x.notes.save(ID.stranger, {
      eventId: receiptIdFor(ID.stranger), noteId: 'opaque-collision', text: TRIP, origin: 'group',
      savedByAgentId: agentId, agentIds: [agentId], fromGroupId: groupIdOf(CHAT), groupTitle: TITLE,
      authorTelegramId: ID.alice, at: x.h.clock.now,
    })).toMatchObject({ ok: true, replay: false });
    const ownCopy = (await x.notes.read(ID.stranger))!.copies[0];
    expect(ownCopy.authorTelegramId).toBe(ID.alice);
    expect(await x.h.studio.notesFor(ID.stranger)).toStrictEqual([{
      copyId: ownCopy.copyId, noteId: 'opaque-collision', text: TRIP, origin: 'group',
      agentIds: [agentId], fromGroupId: groupIdOf(CHAT), groupTitle: TITLE,
      author: 'another member', savedAt: ownCopy.savedAt, expiresAt: ownCopy.expiresAt,
    }]);
  });
});

describe('the kill switch', () => {
  for (const mode of ['reply', 'off'] as const) {
    it(`STUDIO_CIRCLES=${mode}: no proposal, no note reads or writes, no note context, and the same boundary key`, async () => {
      const x = await circle();
      await x.save();
      const before = { reza: await x.notes.read(ID.alice), parastoo: await x.notes.read(ID.stranger) };
      x.setMode(mode);
      const read = vi.spyOn(x.notes, 'read'), propose = vi.spyOn(x.notes, 'propose');
      x.cookie.bot().sendMessage.mockClear();
      await x.send(groupMessage(ID.alice, 'Cookie, remember for us: dinner on Friday'));
      expect(x.cookie.bot().sendMessage.mock.calls.map(([, t]) => t)).toEqual(['Sure.']);
      expect(lastReply(x.h)).not.toContain(TRIP);
      await x.send(dm(ID.alice, 'what did we plan?'));
      expect(lastReply(x.h)).not.toContain(TRIP);
      expect(read).not.toHaveBeenCalled();
      expect(propose).not.toHaveBeenCalled();
      expect({ reza: await x.notes.read(ID.alice), parastoo: await x.notes.read(ID.stranger) }).toEqual(before);
      // The boundary key is the one computed without any notes hook at all.
      type Internals = { deps: { runtimePrivacy: Record<string, unknown>; org: { getPersona(id: string): unknown } }; boundary(...a: unknown[]): Promise<{ key: string }> };
      const chat: ChatContext = { kind: 'private', chatKey: `private-tg-${ID.alice}`, personId: `tg-${ID.alice}` };
      const g1 = (await x.h.studio.gateway()).gateway as unknown as Internals, g2 = (await x.h.studio.gateway()).gateway as unknown as Internals;
      for (const k of ['readNotes', 'readNotesAuthority', 'readNotesAuthorityNow']) delete g2.deps.runtimePrivacy[k];
      const persona = g1.deps.org.getPersona(x.cookie.agent.id);
      expect((await g1.boundary(persona, chat, chat.personId)).key).toBe((await g2.boundary(persona, chat, chat.personId)).key);
      // A notes button from before the switch takes the pre-S3 path.
      const data = noteCallback('cs', receiptIdFor(ID.alice));
      await x.send(tap(ID.alice, data));
      expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), ...(mode === 'reply' ? ["This button isn't available yet."] : ['This request has expired.']));
    });
  }

  it('STUDIO_NOTE_SELECTOR=decisions is a disabled placeholder: nothing is proposed', async () => {
    const x = await circle();
    x.h.studio.deps.noteSelector = () => 'decisions';
    x.cookie.bot().sendMessage.mockClear();
    await x.send(groupMessage(ID.alice, `Cookie, remember for us: ${TRIP}`));
    expect(x.cookie.bot().sendMessage.mock.calls.map(([, t]) => t)).toEqual(['Sure.']);
    expect(await x.notes.read(ID.alice)).toBeNull();
    expect(parseNoteSelector('decisions')).toBe('decisions');
    expect(parseNoteSelector(undefined)).toBe('explicit');
    expect(parseNoteSelector('anything')).toBe('explicit');
    expect(noteSelectorFor('explicit')).toBe(explicitSelector);
    expect(() => decisionsSelector.select({ text: 'remember this: x', chatKind: 'private', names: [] })).toThrow('note_selector_unavailable');
  });
});

describe('the remember intent (deterministic, no model)', () => {
  const pick = (text: string, replied?: string) => parseRememberIntent({ text, chatKind: 'group', names: ['Cookie', '@cookie_bot'], ...(replied ? { replied } : {}) });
  it('finds explicit saves in English and Persian, and nothing else', () => {
    expect(pick(`Cookie, remember for us: ${TRIP}`)).toEqual({ text: TRIP, forUs: true });
    expect(pick('@cookie_bot remember this: pick up the cake')).toEqual({ text: 'pick up the cake', forUs: false });
    expect(pick('please remember that the gate code is 1234')).toEqual({ text: 'the gate code is 1234', forUs: false });
    expect(pick('The gate code is 1234, remember this')).toEqual({ text: 'The gate code is 1234', forUs: false });
    expect(pick('remember this', 'Flight at 9')).toEqual({ text: 'Flight at 9', forUs: false });
    expect(pick('یادت باشه که فردا تولد ساراست')).toEqual({ text: 'فردا تولد ساراست', forUs: false });
    expect(pick('اینو یادت بمونه: کلید زیر گلدونه')).toEqual({ text: 'کلید زیر گلدونه', forUs: false });
    expect(pick('برای ما یادت باشه: سفر شیراز در اردیبهشت')).toEqual({ text: 'سفر شیراز در اردیبهشت', forUs: true });
    expect(pick('کوکی، جمعه شام خونه مامان، برای ما یادت باشه')).toEqual({ text: 'کوکی، جمعه شام خونه مامان', forUs: true });
    expect(pick('یادت نره فردا نون بخری')).toEqual({ text: 'فردا نون بخری', forUs: false });
    expect(pick('فردا جلسه داریم یادت باشه')).toEqual({ text: 'فردا جلسه داریم', forUs: false });
    expect(pick('remember that Mom lands at 9')).toEqual({ text: 'Mom lands at 9', forUs: false });
    for (const no of ['do you remember the trip?', "don't remember this: secret", 'I remember the trip', 'remember this', 'یادته؟', 'یادت نمونه اینو', 'what was it again', '/remember x',
      "Thanks, I'll remember that.", "I can't remember that", "I don't want you to remember this", "you don't have to remember this",
      'Remember when we went to Paris, it was amazing', 'Remember when we went to Paris', 'Cookie, remember that trip we planned', 'remember me', 'Remember to bring the cake tomorrow',
      'دیروز گفتی یادت باشه زنگ بزنم ولی یادت رفت', 'من یادداشت کن رو نوشتم', 'یادت باشه دیروز چی گفتم', 'دیروز گفتی یادت باشه'])
      expect(pick(no)).toBeNull();
  });
});

describe('the notes store', () => {
  const at = new Date('2026-10-19T10:00:00Z');
  const input = (n: number) => ({ eventId: receiptIdFor(7), noteId: `note-${n}`, text: `note ${n}`, origin: 'dm' as const, savedByAgentId: 'a1', agentIds: ['a1'], authorTelegramId: 7, at });

  it('is idempotent per event, caps active copies at 500, keeps tombstones textless, expires copies after 365 days', async () => {
    const notes = new CircleNotes(new NotesRepository(new MemoryAdaptiveStorage()));
    const first = input(1);
    const saved = await notes.save(7, first);
    expect(saved).toMatchObject({ ok: true, replay: false });
    expect(await notes.save(7, first)).toEqual({ ok: true, copyId: (saved as { copyId: string }).copyId, replay: true });
    for (let i = 2; i <= NOTES_MAX_ACTIVE; i++) expect((await notes.save(7, input(i))).ok).toBe(true);
    expect(await notes.save(7, input(501))).toEqual({ ok: false, reason: 'full' });
    const doc = (await notes.read(7))!;
    expect(doc.copies.filter((c) => c.status === 'active')).toHaveLength(NOTES_MAX_ACTIVE);
    const erased = await notes.erase(7, doc.copies[0].copyId, at);
    expect(erased!.text).toBe('note 1');
    expect((await notes.read(7))!.copies[0]).not.toHaveProperty('text');
    // An erased save never comes back on replay.
    expect(await notes.save(7, first)).toMatchObject({ ok: true, replay: true });
    expect((await notes.read(7))!.copies.filter((c) => c.noteId === 'note-1').map((c) => c.status)).toEqual(['deleted']);
    expect(usableCopies(await notes.read(7), 'a1', new Date(at.getTime() + 365 * 86_400_000))).toEqual([]);
    expect(usableCopies(await notes.read(7), 'a2', at)).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(await notes.read(7)))).toBeLessThan(MAX_NOTES_BYTES);
  });

  it('a save past the byte cap is refused like a full notebook', async () => {
    const notes = new CircleNotes(new NotesRepository(new MemoryAdaptiveStorage()));
    let refused = false;
    for (let i = 0; i < NOTES_MAX_ACTIVE && !refused; i++) {
      const outcome = await notes.save(7, { ...input(i), text: 'ش'.repeat(2000) });
      refused = !outcome.ok;
    }
    expect(refused).toBe(true);
  });

  it('rejects documents that are not this person\'s, or break invariants (fail closed)', async () => {
    const storage = new MemoryAdaptiveStorage(), notes = new CircleNotes(new NotesRepository(storage));
    await notes.save(7, input(1));
    const raw = (await storage.load(notesKey(7))).value as { copies: Array<Record<string, unknown>> };
    expect(() => parseNotes(raw, 8)).toThrow();
    const textless = structuredClone(raw); delete textless.copies[0].text;
    expect(() => parseNotes(textless, 7)).toThrow();
    const tombstoneWithText = structuredClone(raw); tombstoneWithText.copies[0].status = 'deleted'; tombstoneWithText.copies[0].deletedAt = at.toISOString();
    expect(() => parseNotes(tombstoneWithText, 7)).toThrow();
    expect(() => parseNotes({ ...raw, extra: 1 }, 7)).toThrow();
  });

  it('callback data stays within 64 bytes and binds an owner', () => {
    const id = receiptIdFor(Number.MAX_SAFE_INTEGER);
    for (const action of ['cs', 'cn', 'ce'] as const) {
      const data = noteCallback(action, id);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseNoteCallback(data)).toEqual({ action, id });
    }
    expect(parseNoteCallback('cj:abc')).toBeNull();
    expect(parseNoteCallback(`cs:${'a'.repeat(70)}`)).toBeNull();
  });

  it('copy keeps the EN and FA keys in step', () => {
    expect(Object.keys(notesCopy('fa')).sort()).toEqual(Object.keys(notesCopy('en')).sort());
    expect(groupCopy('en').left).toContain('stay with everyone');
  });
});

describe('Settings v2: the settings button under /notes, /forget and /leave', () => {
  it('a member gets Memory settings in Vox, an outsider My data (VoxxBot); an erase keeps the row; /leave offers settings', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '1');
    const x = await circle();
    x.h.studio.deps.webAppUrl = 'https://vox.example/studio';
    await x.save();
    const bot = x.cookie.bot(), pet = `https://vox.example/studio/pet/${x.cookie.agent.id}`, myData = 'https://t.me/VoxxBot?start=mydata';
    const vox = `https://t.me/VoxxBot?start=s_${agentShortCode(SECRET, x.cookie.agent.id)}_m`;
    await x.send(dm(ID.stranger, '/notes'));
    const [, , options] = bot.sendMessage.mock.calls.at(-1)!;
    expect(flat(options).map((b) => b.text)).toEqual(['Erase 1', 'Open My data']);
    expect(flat(options)[1]).toEqual({ text: 'Open My data', url: myData });
    await x.send(tap(ID.stranger, flat(options)[0].callback_data!, { id: ID.stranger, type: 'private' }, 77));
    expect(bot.editMessageText).toHaveBeenLastCalledWith(ID.stranger, 77, EN.none('Cookie'), { inline_keyboard: [[{ text: 'Open My data', url: myData }]] });
    await x.send(dm(ID.stranger, '/forget 1'));
    expect(flat(bot.sendMessage.mock.calls.at(-1)![2])).toEqual([{ text: 'Open My data', url: myData }]);
    await x.send(dm(ID.alice, '/notes'));
    expect(flat(bot.sendMessage.mock.calls.at(-1)![2]).at(-1)).toEqual({ text: 'Open Memory settings', url: vox });
    await x.send(dm(ID.stranger, '/leave'));
    expect(flat(bot.sendMessage.mock.calls.at(-1)![2])).toEqual([{ text: 'Open settings', web_app: { url: pet } }]);
  });
});
