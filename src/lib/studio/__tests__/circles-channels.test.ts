/**
 * Circles S5 (GROUP_AGENTS_SPEC F9, §9 S5, §13): channels are post-only. Only a host's add is recorded (kind
 * 'channel', hasGuests for good, nobody in it); anyone else's add records nothing and the bot leaves. Nothing is
 * subscribed to or stored from a channel. A post is drafted from the persona alone, previewed to the host with
 * Post / Edit / Cancel (callbacks ≤64 bytes, bound to the host, expiring), and sent only on Post, with the
 * [Meet <agent> 🐾] button to `start=c_<opaque code>`, which S1 routes to the agent DM card. With
 * STUDIO_CIRCLES below 'circles' everything is exactly as before (the channel early return included).
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramApiError, type TelegramChatMemberUpdated, type TelegramMessage, type TelegramUpdate, type TelegramUser } from '../../tireh/telegram/client';
import { ChannelDrafts, channelCode, channelLink, clip, draftKey, DRAFT_TTL_MS, MAX_DRAFT_CHANNELS, meetUrl, parsePostCallback, parsePostCommand, postCallback, textHash } from '../../circles/channels';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { parseStartPayload } from '../../circles/codec';
import { AGENT_UPDATES, handleAgentUpdate } from '../updates';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { hire, ID, makeStudio, SECRET, seedOrg, type Harness } from './helpers';

const CHANNEL = -100555;
const COMMENTS = -100556;
let updateId = 990_000;
type Button = { text: string; callback_data?: string; url?: string };
const rows = (options: unknown) => ((options as { keyboard?: { inline_keyboard: Button[][] } } | undefined)?.keyboard?.inline_keyboard ?? []);
const flat = (options: unknown) => rows(options).flat();
const later = (h: Harness, ms = 1000) => { h.clock.now = new Date(h.clock.now.getTime() + ms); };

beforeEach(() => { vi.stubEnv('STUDIO_GROUP_OBSERVATION', 'on'); vi.stubEnv('TIREH_CACHED_PROMPT', ''); });
afterEach(() => vi.unstubAllEnvs());

const user = (id: number, language_code?: string): TelegramUser => ({ id, is_bot: false, first_name: 'U', ...(language_code ? { language_code } : {}) });
const channelUpdate = (from: number, status = 'administrator', old = 'left', title = 'Cookie News'): TelegramChatMemberUpdated => ({
  chat: { id: CHANNEL, type: 'channel', title }, from: user(from), date: 0,
  old_chat_member: { status: old, user: { id: 1, is_bot: true, first_name: 'b' } }, new_chat_member: { status, user: { id: 1, is_bot: true, first_name: 'b' } },
});
function dm(from: number, text: string, extra: Partial<TelegramMessage> = {}): TelegramUpdate {
  const id = updateId++;
  return { update_id: id, message: { message_id: id, date: 0, text, from: user(from), chat: { id: from, type: 'private' }, ...extra } };
}
function tap(from: number, data: string, message: { id: number; text?: string }, chat = from): TelegramUpdate {
  return { update_id: updateId++, callback_query: { id: `cb-${updateId}`, from: user(from), data, message: { message_id: message.id, date: 0, chat: { id: chat, type: 'private' }, text: message.text } } };
}

async function setup(mode: 'circles' | 'reply' | 'off' = 'circles', visibility: 'public' | 'org' = 'public') {
  const h = makeStudio();
  const org = await seedOrg(h);
  const cookie = await hire(h, org.alice, { name: 'Cookie', role: 'Companion' }, undefined, visibility);
  h.studio.deps.circles = () => mode;
  h.studio.deps.circleChats = () => new Set<number>();
  const getChat = vi.fn(async (chatId: number) => ({ id: chatId, type: 'channel' as const, title: 'Cookie News', linked_chat_id: COMMENTS }));
  // The bot's own rights in a channel: an admin who may post, unless a test says otherwise.
  const getChatMember = vi.fn(async (_chatId: number, userId: number) => ({ status: 'administrator', user: { id: userId, is_bot: true, first_name: 'b' }, can_post_messages: true as boolean }));
  Object.assign(cookie.bot(), { getChat, getChatMember });
  const agent = async () => (await h.store.read()).agents.find((a) => a.id === cookie.agent.id)!;
  const add = async (from = ID.alice, status = 'administrator', old = 'left') => h.studio.onBotChatMember(await agent(), channelUpdate(from, status, old));
  const send = (u: TelegramUpdate) => handleAgentUpdate(h.studio, cookie.agent.id, u);
  const channels = async () => (await h.store.read()).groups.filter((g) => g.chatId === CHANNEL);
  /** The preview sent to `who`'s DM: its message id, text and buttons. */
  const preview = (who = ID.alice) => {
    const calls = cookie.bot().sendMessage.mock.calls.map((c, i) => ({ c, i })).filter(({ c }) => c[0] === who && flat(c[2]).some((b) => b.callback_data?.startsWith('pp:')));
    const last = calls.at(-1)!;
    const id = (cookie.bot().sendMessage.mock.results[last.i].value as Promise<TelegramMessage>);
    return { text: last.c[1], buttons: flat(last.c[2]), rows: rows(last.c[2]), message: id };
  };
  const posts = () => cookie.bot().sendMessage.mock.calls.filter((c) => c[0] === CHANNEL);
  const drafts = () => h.studio.deps.channelDrafts!;
  return { h, org, cookie, agent, add, send, channels, preview, posts, getChat, getChatMember, drafts };
}

async function previewed(x: Awaited<ReturnType<typeof setup>>, brief = 'Tell people the pet can dance now', reply = 'Big news: I can dance now 🐾') {
  await x.add();
  x.h.chatLLM.nextReply = reply;
  await x.send(dm(ID.alice, `/post ${brief}`));
  const p = x.preview();
  return { ...p, messageId: (await p.message).message_id, data: (prefix: string) => p.buttons.find((b) => b.callback_data?.startsWith(prefix))!.callback_data! };
}

describe('no channel_post', () => {
  it('agent bots never subscribe to channel posts, and a stray one is dropped untouched', async () => {
    expect(AGENT_UPDATES).not.toContain('channel_post');
    expect(AGENT_UPDATES).not.toContain('edited_channel_post');
    const x = await setup();
    await x.add();
    const before = readFileSync(join(x.h.dir, 'studio.json'), 'utf8');
    const stray = { update_id: updateId++, channel_post: { message_id: 5, date: 0, chat: { id: CHANNEL, type: 'channel' }, text: 'subscriber-visible SECRET' } } as unknown as TelegramUpdate;
    await x.send(stray);
    expect(readFileSync(join(x.h.dir, 'studio.json'), 'utf8')).toBe(before);
    expect(x.h.chatLLM.replyRequests).toHaveLength(0);
    expect(x.cookie.bot().sendMessage).not.toHaveBeenCalled();
    const files = readdirSync(x.h.dir, { recursive: true }) as string[];
    for (const f of files.filter((f) => !f.endsWith('/') && f.includes('.json'))) {
      try { expect(readFileSync(join(x.h.dir, f), 'utf8')).not.toContain('SECRET'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EISDIR') throw e; }
    }
  });

  it('a channel post mirrored into its comments group is not kept as anyone speaking', async () => {
    const x = await setup();
    await x.h.store.update((s) => { s.groups.push({ chatId: COMMENTS, title: 'Cookie chat', memberIds: [ID.alice], hasGuests: false, agentIds: [x.cookie.agent.id], addedAt: x.h.clock.now.toISOString() }); });
    const before = readFileSync(join(x.h.dir, 'studio.json'), 'utf8');
    const id = updateId++;
    await x.send({ update_id: id, message: { message_id: id, date: 0, text: 'From the channel', from: { id: 777000, is_bot: false, first_name: 'Telegram' },
      chat: { id: COMMENTS, type: 'supergroup' }, is_automatic_forward: true, sender_chat: { id: CHANNEL, type: 'channel' } } });
    expect(readFileSync(join(x.h.dir, 'studio.json'), 'utf8')).toBe(before);
    expect(x.h.chatLLM.replyRequests).toHaveLength(0);
  });
});

describe('adding the agent to a channel', () => {
  it('a host records the channel post-only: kind channel, guests for good, nobody in it; nothing is said there', async () => {
    const x = await setup();
    await x.add();
    expect(await x.channels()).toEqual([{ chatId: CHANNEL, title: 'Cookie News', memberIds: [], hasGuests: true, agentIds: [x.cookie.agent.id], addedAt: expect.any(String), kind: 'channel', audienceEpoch: 1 }]);
    expect(x.cookie.bot().sendMessage).not.toHaveBeenCalled();
    expect(x.cookie.bot().leaveChat).not.toHaveBeenCalled();
    // Never listed as a group (it is no audience), and never touched by the group paths.
    expect((await x.h.studio.listGroups(x.org.superadmin)).map((g) => g.chatId)).not.toContain(CHANNEL);
  });

  for (const [label, from] of [['a stranger', ID.stranger], ['a pending person', ID.pending]] as const) {
    it(`${label}'s add records nothing and the bot leaves, silently`, async () => {
      const x = await setup();
      await x.add(from);
      expect(await x.channels()).toEqual([]);
      expect(x.cookie.bot().leaveChat).toHaveBeenCalledWith(CHANNEL);
      expect(x.cookie.bot().sendMessage).not.toHaveBeenCalled();
    });
  }

  it('an agent that is not public is not kept in a channel, even by its creator', async () => {
    const x = await setup('circles', 'org');
    await x.add();
    expect(await x.channels()).toEqual([]);
    expect(x.cookie.bot().leaveChat).toHaveBeenCalledWith(CHANNEL);
  });

  it("a rights change by another channel admin keeps a host's channel; a new add by them would not", async () => {
    const x = await setup();
    await x.add();
    await x.add(ID.stranger, 'administrator', 'administrator');
    expect(await x.channels()).toHaveLength(1);
    expect(x.cookie.bot().leaveChat).not.toHaveBeenCalled();
  });

  for (const status of ['left', 'kicked']) {
    it(`${status}: the channel is marked removed (the agent leaves the record; the row goes with its last agent)`, async () => {
      const x = await setup();
      await x.add();
      await x.add(ID.stranger, status, 'administrator');
      expect(await x.channels()).toEqual([]);
    });
  }

  for (const mode of ['off', 'reply'] as const) {
    it(`STUDIO_CIRCLES=${mode}: identical to before (the channel early return): nothing recorded, no leave, no Telegram call`, async () => {
      const x = await setup(mode);
      const before = readFileSync(join(x.h.dir, 'studio.json'), 'utf8');
      for (const fn of Object.values(x.cookie.bot())) if (vi.isMockFunction(fn)) fn.mockClear();
      await x.add();
      await x.add(ID.stranger);
      for (const status of ['left', 'kicked']) await x.add(ID.stranger, status, 'administrator');
      expect(readFileSync(join(x.h.dir, 'studio.json'), 'utf8')).toBe(before);
      for (const fn of Object.values(x.cookie.bot())) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
      await expect(x.h.studio.circleChannels.list(x.org.alice, x.cookie.agent.id)).rejects.toMatchObject({ status: 404 });
      await expect(x.h.studio.channelLink(x.org.alice, x.cookie.agent.id)).rejects.toMatchObject({ status: 404 });
    });
  }
});

describe('the kill switch and removal', () => {
  it('flag off: a kick still drops a recorded channel, so a later re-add by someone else never comes back postable', async () => {
    const x = await setup();
    await x.add();
    x.h.studio.deps.circles = () => 'off';
    await x.add(ID.stranger, 'kicked', 'administrator');
    expect(await x.channels()).toEqual([]);
    // Re-added by a stranger while off: ignored as before (nothing recorded, no call).
    await x.add(ID.stranger, 'administrator', 'left');
    x.h.studio.deps.circles = () => 'circles';
    expect(await x.channels()).toEqual([]);
    await x.send(dm(ID.alice, '/post hello'));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.alice, "Cookie isn't in any channel yet. Open Cookie in Studio, then Groups → Add to a channel.");
    // A rights change by that stranger now meets the adder check (not `was && recorded`): the bot leaves.
    await x.add(ID.stranger, 'administrator', 'administrator');
    expect(await x.channels()).toEqual([]);
    expect(x.cookie.bot().leaveChat).toHaveBeenCalledWith(CHANNEL);
  });

  it(`at most ${MAX_DRAFT_CHANNELS} channels: a further add is left and said so, and Studio withholds the link`, async () => {
    const x = await setup();
    for (let i = 0; i < MAX_DRAFT_CHANNELS; i++) await x.h.studio.onBotChatMember(await x.agent(), { ...channelUpdate(ID.alice), chat: { id: CHANNEL - i, type: 'channel', title: `C${i}` } });
    expect((await x.h.store.read()).groups.filter((g) => g.kind === 'channel')).toHaveLength(MAX_DRAFT_CHANNELS);
    const sixth = CHANNEL - MAX_DRAFT_CHANNELS;
    await x.h.studio.onBotChatMember(await x.agent(), { ...channelUpdate(ID.alice), chat: { id: sixth, type: 'channel', title: 'C6' } });
    expect((await x.h.store.read()).groups.some((g) => g.chatId === sixth)).toBe(false);
    expect(x.cookie.bot().leaveChat).toHaveBeenCalledWith(sixth);
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.alice, `Cookie is already in ${MAX_DRAFT_CHANNELS} channels, the most it can post to, so it left this one. Remove it from another channel first.`);
    const view = await x.h.studio.circleChannels.list(x.org.alice, x.cookie.agent.id);
    expect(view).toMatchObject({ full: true });
    expect(view.link).toBeUndefined();
    await expect(x.h.studio.channelLink(x.org.alice, x.cookie.agent.id)).rejects.toMatchObject({ status: 409 });
    // Every recorded channel gets a Post button.
    await x.send(dm(ID.alice, '/post hello'));
    expect(x.preview().rows.slice(0, MAX_DRAFT_CHANNELS).map((r) => r[0].text)).toEqual(['C0', 'C1', 'C2', 'C3', 'C4'].map((t) => `Post to ${t}`));
  });

  it('subscriber chat_member updates in a channel are dropped before anything is built, deduped or kept (flag off: as before)', async () => {
    const x = await setup();
    await x.add();
    const firstSeen = vi.spyOn(x.h.studio.deps.memory.deduper, 'firstSeen');
    const gateway = vi.spyOn(x.h.studio, 'gateway');
    const before = readFileSync(join(x.h.dir, 'studio.json'), 'utf8');
    const subscriber = (): TelegramUpdate => ({ update_id: updateId++, chat_member: { ...channelUpdate(ID.stranger, 'member', 'left'), new_chat_member: { status: 'member', user: user(ID.stranger) } } });
    await x.send(subscriber());
    expect(firstSeen).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
    expect(readFileSync(join(x.h.dir, 'studio.json'), 'utf8')).toBe(before);
    x.h.studio.deps.circles = () => 'off';
    await x.send(subscriber());
    expect(firstSeen).toHaveBeenCalledWith(expect.stringMatching(/^audience:/));
  });
});

describe('posting', () => {
  it('a post goes out only after the host previews it and taps Post, with the Meet button and an opaque code', async () => {
    const x = await setup();
    const p = await previewed(x);
    // The preview is exactly the post, in the host's DM; nothing has reached the channel.
    expect(p.text).toBe('Big news: I can dance now 🐾');
    expect(x.posts()).toEqual([]);
    expect(p.rows.map((r) => r.map((b) => b.text))).toEqual([['Post'], ['🔔 Notify subscribers'], ['Edit', 'Cancel']]);
    for (const b of p.buttons) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
    // The draft keeps no text: only its hash.
    const drafts = (readdirSync(join(x.h.dir, 'circles', 'channel-drafts')) as string[]).map((f) => readFileSync(join(x.h.dir, 'circles', 'channel-drafts', f), 'utf8')).join('');
    expect(drafts).not.toContain('dance');
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toHaveLength(1);
    const [chatId, text, options] = x.posts()[0];
    const code = channelCode(SECRET, CHANNEL);
    expect([chatId, text]).toEqual([CHANNEL, 'Big news: I can dance now 🐾']);
    expect(options).toEqual({ keyboard: { inline_keyboard: [[{ text: 'Meet Cookie 🐾', url: meetUrl(x.cookie.agent.bot!.username, code) }]] } });
    expect(flat(options)[0].url).toBe(`https://t.me/${x.cookie.agent.bot!.username}?start=c_${code}`);
    expect(flat(options)[0].url).not.toContain(String(Math.abs(CHANNEL)));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'Posted to Cookie News ✓', true);
    expect(x.cookie.bot().editMessageText).toHaveBeenLastCalledWith(ID.alice, p.messageId, 'Big news: I can dance now 🐾\n\nPosted to Cookie News ✓');
    // A second tap (or a redelivery) posts nothing more.
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toHaveLength(1);
  });

  it('posts contain no stored context: the persona and the brief only (no memory, history, org directory or notes are read)', async () => {
    const x = await setup();
    const listActive = vi.spyOn(x.h.memory.memories, 'listActive');
    const notes = vi.spyOn(x.h.studio.circleNotes, 'read');
    const adaptive = vi.spyOn(x.h.studio, 'adaptiveContext');
    await previewed(x, 'Tell people the pet can dance now');
    const request = x.h.chatLLM.replyRequests.at(-1)!;
    expect(request.messages).toEqual([{ role: 'user', content: 'Tell people the pet can dance now' }]);
    const system = x.h.chatLLM.lastPrompt;
    expect(system).toContain('You are Cookie, Companion at HOOR.');
    expect(system).toContain('## Channel post');
    expect(system).toContain('"Cookie News"');
    for (const leak of ['## Organization', '## How people relate', '## What you remember', '## Conversation', 'Server-authorized saved context', 'Alice', 'Bob', 'Parastoo', 'Reza']) expect(system).not.toContain(leak);
    expect(listActive).not.toHaveBeenCalled();
    expect(notes).not.toHaveBeenCalled();
    expect(adaptive).not.toHaveBeenCalled();
  });

  it('the host chooses notification: on by default, a tap posts silently', async () => {
    const x = await setup();
    const p = await previewed(x);
    await x.send(tap(ID.alice, p.data('ps:'), { id: p.messageId, text: p.text }));
    const [, , text, keyboard] = x.cookie.bot().editMessageText.mock.calls.at(-1)! as unknown as [number, number, string, { inline_keyboard: Button[][] }];
    expect(text).toBe(p.text);
    expect(keyboard.inline_keyboard[1][0].text).toBe('🔕 Post silently');
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()[0][2]).toMatchObject({ silent: true });
  });

  it('Cancel posts nothing, and a later Post tap on that preview is refused', async () => {
    const x = await setup();
    const p = await previewed(x);
    await x.send(tap(ID.alice, p.data('px:'), { id: p.messageId, text: p.text }));
    expect(x.cookie.bot().editMessageText).toHaveBeenLastCalledWith(ID.alice, p.messageId, 'Cancelled. Nothing was posted.');
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'This preview has expired. Send /post for a fresh one.', true);
  });

  it('Edit: the host replies with their own words (no model call), the new preview replaces the old, and only it posts', async () => {
    const x = await setup();
    const p = await previewed(x);
    const calls = x.h.chatLLM.replyRequests.length;
    await x.send(tap(ID.alice, p.data('pe:'), { id: p.messageId, text: p.text }));
    const [promptChat, promptText, promptOptions] = x.cookie.bot().sendMessage.mock.calls.at(-1)!;
    expect([promptChat, promptText]).toEqual([ID.alice, 'Send the new text for this post, word for word.']);
    expect(promptOptions).toMatchObject({ replyTo: p.messageId, forceReply: { placeholder: 'New post text' } });
    const prompt = await (x.cookie.bot().sendMessage.mock.results.at(-1)!.value as Promise<TelegramMessage>);
    await x.send(dm(ID.alice, '  Dancing pets, tonight at 8!  ', { reply_to_message: { message_id: prompt.message_id, date: 0, chat: { id: ID.alice, type: 'private' } } }));
    expect(x.h.chatLLM.replyRequests).toHaveLength(calls);
    expect(x.cookie.bot().editMessageText).toHaveBeenCalledWith(ID.alice, p.messageId, 'Replaced by your edit below.');
    const next = x.preview();
    expect(next.text).toBe('Dancing pets, tonight at 8!');
    // The old preview's text no longer matches the draft: its Post is refused.
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
    const nextId = (await next.message).message_id;
    await x.send(tap(ID.alice, next.buttons.find((b) => b.callback_data?.startsWith('pp:'))!.callback_data!, { id: nextId, text: next.text }));
    expect(x.posts().map((c) => c[1])).toEqual(['Dancing pets, tonight at 8!']);
  });

  it('a preview expires', async () => {
    const x = await setup();
    const p = await previewed(x);
    later(x.h, DRAFT_TTL_MS + 1);
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
  });

  it('Telegram refusing the post puts the draft back: the same preview posts on a second tap', async () => {
    const x = await setup();
    const p = await previewed(x);
    x.cookie.bot().sendMessage.mockRejectedValueOnce(new TelegramApiError('sendMessage', 'Too Many Requests: retry after 3'));
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toHaveLength(1);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), "Telegram didn't take the post. Check I'm still an admin who can post there, then tap Post again.", true);
    // The buttons stay.
    expect(x.cookie.bot().editMessageText).not.toHaveBeenCalledWith(ID.alice, p.messageId, p.text);
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toHaveLength(2);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), 'Posted to Cookie News ✓', true);
  });

  it('no answer from Telegram (it may have posted): the draft stays taken, so a retry never posts twice', async () => {
    const x = await setup();
    const p = await previewed(x);
    x.cookie.bot().sendMessage.mockRejectedValueOnce(new Error('socket hang up'));
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), "Telegram didn't confirm the post. Check the channel before you send /post again.", true);
    expect(x.cookie.bot().editMessageText).toHaveBeenLastCalledWith(ID.alice, p.messageId, p.text);
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toHaveLength(1);
  });

  it('a Post that read the preview before an Edit committed sends nothing: the edit wins', async () => {
    const x = await setup();
    const p = await previewed(x);
    const stale = await x.drafts().list(x.cookie.agent.id, ID.alice, x.h.clock.now);
    await x.send(tap(ID.alice, p.data('pe:'), { id: p.messageId, text: p.text }));
    const prompt = await (x.cookie.bot().sendMessage.mock.results.at(-1)!.value as Promise<TelegramMessage>);
    await x.send(dm(ID.alice, 'Edited text', { reply_to_message: { message_id: prompt.message_id, date: 0, chat: { id: ID.alice, type: 'private' } } }));
    // The old tap's read happened before the edit: it passed the hash check on that snapshot.
    vi.spyOn(x.drafts(), 'list').mockResolvedValueOnce(stale);
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
    const next = x.preview();
    await x.send(tap(ID.alice, next.buttons.find((b) => b.callback_data?.startsWith('pp:'))!.callback_data!, { id: (await next.message).message_id, text: next.text }));
    expect(x.posts().map((c) => c[1])).toEqual(['Edited text']);
  });

  it('a refused Post says why and ends the preview: the agent was removed from the channel', async () => {
    const x = await setup();
    const p = await previewed(x);
    await x.add(ID.stranger, 'kicked', 'administrator');
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), "Cookie isn't in that channel any more.", true);
    expect(x.cookie.bot().editMessageText).toHaveBeenLastCalledWith(ID.alice, p.messageId, p.text);
  });

  it('posting rights: missing rights are shown in Studio, /post asks for them before any model call, and a Post waits for them', async () => {
    const x = await setup();
    const p = await previewed(x);
    x.getChatMember.mockResolvedValue({ status: 'administrator', user: { id: 1, is_bot: true, first_name: 'b' }, can_post_messages: false });
    expect((await x.h.studio.circleChannels.list(x.org.alice, x.cookie.agent.id)).channels[0].posting).toBe('needs_rights');
    expect(x.getChatMember).toHaveBeenCalledWith(CHANNEL, x.cookie.agent.bot!.id);
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
    const ask = 'Allow Cookie to post in Cookie News: in the channel\'s admin settings, turn on Post messages for Cookie.';
    expect(x.cookie.bot().answerCallbackQuery).toHaveBeenLastCalledWith(expect.any(String), ask, true);
    const calls = x.h.chatLLM.replyRequests.length;
    await x.send(dm(ID.alice, '/post another one'));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.alice, ask);
    expect(x.h.chatLLM.replyRequests).toHaveLength(calls);
    await expect(x.h.studio.circleChannels.draft(x.org.alice, x.cookie.agent.id, 'x')).rejects.toMatchObject({ status: 409, message: ask });
    // Rights fixed: the same preview posts.
    x.getChatMember.mockResolvedValue({ status: 'administrator', user: { id: 1, is_bot: true, first_name: 'b' }, can_post_messages: true });
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toHaveLength(1);
  });

  it('a preview Telegram refuses is said, and its draft dropped; long titles are cut by code point, never mid-emoji', async () => {
    const x = await setup();
    await x.add();
    x.h.chatLLM.nextReply = 'Hello';
    x.cookie.bot().sendMessage.mockRejectedValueOnce(new TelegramApiError('sendMessage', 'Bad Request: invalid button text'));
    await x.send(dm(ID.alice, '/post hello'));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.alice, "I can't write posts right now. Try again in a minute.");
    expect(await x.drafts().list(x.cookie.agent.id, ID.alice, x.h.clock.now)).toEqual([]);
    const title = `${'a'.repeat(55)}📣 news`;
    expect(clip(`Post to ${title}`, 64)).toBe(`Post to ${'a'.repeat(55)}📣`);
    expect(`Post to ${title}`.slice(0, 64)).not.toBe(clip(`Post to ${title}`, 64));
  });

  it('several channels: one Post button per channel, each posting only there', async () => {
    const x = await setup();
    await x.add();
    const other = { ...channelUpdate(ID.alice), chat: { id: CHANNEL - 1, type: 'channel' as const, title: 'Cookie FA' } };
    await x.h.studio.onBotChatMember(await x.agent(), other);
    await x.send(dm(ID.alice, '/post hello'));
    const p = x.preview();
    expect(p.rows.slice(0, 2).map((r) => r.map((b) => b.text))).toEqual([['Post to Cookie News'], ['Post to Cookie FA']]);
    await x.send(tap(ID.alice, p.rows[1][0].callback_data!, { id: (await p.message).message_id, text: p.text }));
    expect(x.cookie.bot().sendMessage.mock.calls.filter((c) => c[0] === CHANNEL - 1)).toHaveLength(1);
    expect(x.posts()).toEqual([]);
  });

  it('/post with no channel, or with no brief, explains and drafts nothing', async () => {
    const x = await setup();
    await x.send(dm(ID.alice, '/post hello'));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.alice, "Cookie isn't in any channel yet. Open Cookie in Studio, then Groups → Add to a channel.");
    await x.add();
    await x.send(dm(ID.alice, '/post'));
    expect(x.cookie.bot().sendMessage).toHaveBeenLastCalledWith(ID.alice, 'Send /post followed by the text, or what the post should be about.');
    expect(x.h.chatLLM.replyRequests).toHaveLength(0);
  });

  it('flag off: /post is not intercepted and no preview is ever offered', async () => {
    const x = await setup();
    await x.add();
    x.h.studio.deps.circles = () => 'off';
    await x.send(dm(ID.alice, '/post hello'));
    expect(x.cookie.bot().sendMessage.mock.calls.flatMap((c) => flat(c[2])).some((b) => b.callback_data?.startsWith('pp:'))).toBe(false);
    expect(x.posts()).toEqual([]);
  });
});

describe('who can make the agent post', () => {
  it('a non-member cannot: /post from a stranger never drafts or posts', async () => {
    const x = await setup();
    await x.add();
    await x.send(dm(ID.stranger, '/post buy my crypto'));
    expect(x.h.chatLLM.lastPrompt).not.toContain('## Channel post');
    expect(x.cookie.bot().sendMessage.mock.calls.flatMap((c) => flat(c[2])).some((b) => b.callback_data?.startsWith('pp:'))).toBe(false);
    expect(x.posts()).toEqual([]);
  });

  it("someone else's tap on a host's preview finds nothing (drafts are keyed by the tapper)", async () => {
    const x = await setup();
    const p = await previewed(x);
    await x.send(tap(ID.bob, p.data('pp:'), { id: p.messageId, text: p.text }));
    await x.send(tap(ID.stranger, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
  });

  it('a host who loses access before Post posts nothing', async () => {
    const x = await setup();
    const p = await previewed(x);
    await x.h.studio.setRole(x.org.superadmin, ID.alice, 'pending');
    await x.send(tap(ID.alice, p.data('pp:'), { id: p.messageId, text: p.text }));
    expect(x.posts()).toEqual([]);
  });

  it('Studio: any member who may use it drafts and posts; only managers get the Add to channel link', async () => {
    const x = await setup();
    await x.add();
    x.h.chatLLM.nextReply = 'Hello, channel';
    const bob = await x.h.studio.circleChannels.list(x.org.bob, x.cookie.agent.id);
    expect(bob.link).toBeUndefined();
    await expect(x.h.studio.channelLink(x.org.bob, x.cookie.agent.id)).rejects.toMatchObject({ status: 403 });
    const alice = await x.h.studio.circleChannels.list(x.org.alice, x.cookie.agent.id);
    expect(alice.link).toBe(channelLink(x.cookie.agent.bot!.username));
    expect(alice.link).toBe(`https://t.me/${x.cookie.agent.bot!.username}?startchannel&admin=post_messages+edit_messages`);
    const draft = await x.h.studio.circleChannels.draft(x.org.bob, x.cookie.agent.id, 'say hello');
    expect(draft).toMatchObject({ text: 'Hello, channel', silent: false, channels: [{ chatId: CHANNEL, title: 'Cookie News' }] });
    expect(x.posts()).toEqual([]);
    await expect(x.h.studio.circleChannels.post(x.org.alice, x.cookie.agent.id, { id: draft.id, chatId: CHANNEL, text: 'Hi', silent: false })).rejects.toMatchObject({ status: 409 });
    expect(await x.h.studio.circleChannels.post(x.org.bob, x.cookie.agent.id, { id: draft.id, chatId: CHANNEL, text: 'Hello, channel!', silent: true })).toEqual({ posted: true, title: 'Cookie News' });
    expect(x.posts()).toEqual([[CHANNEL, 'Hello, channel!', expect.objectContaining({ silent: true })]]);
    await expect(x.h.studio.circleChannels.post(x.org.bob, x.cookie.agent.id, { id: draft.id, chatId: CHANNEL, text: 'again', silent: false })).rejects.toMatchObject({ status: 409 });
    await expect(x.h.studio.circleChannels.draft(x.org.pending, x.cookie.agent.id, 'x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('drafts and rights', () => {
  const docs = (x: Awaited<ReturnType<typeof setup>>) => {
    const dir = join(x.h.dir, 'circles', 'channel-drafts');
    return (readdirSync(dir) as string[]).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown);
  };

  it('forget me and rights erasure blank the person\'s drafts for every agent, and only theirs', async () => {
    const x = await setup();
    await previewed(x);
    x.h.chatLLM.nextReply = 'Bob post';
    await x.h.studio.circleChannels.draft(x.org.bob, x.cookie.agent.id, 'b');
    expect(await x.h.studio.forgetChannelDrafts(ID.alice)).toBe(1);
    expect(await x.drafts().list(x.cookie.agent.id, ID.alice, x.h.clock.now)).toEqual([]);
    expect(await x.drafts().list(x.cookie.agent.id, ID.bob, x.h.clock.now)).toHaveLength(1);
    expect(await x.h.studio.forgetChannelDrafts(ID.alice)).toBe(0);
    expect(docs(x).filter((d) => d !== null)).toHaveLength(1);
  });

  it('nothing outlives its use: a taken draft blanks the document, and an expired one goes on the next read', async () => {
    const x = await setup();
    const p = await previewed(x);
    await x.send(tap(ID.alice, p.data('px:'), { id: p.messageId, text: p.text }));
    expect(docs(x)).toEqual([null]);
    x.h.chatLLM.nextReply = 'Another';
    await x.send(dm(ID.alice, '/post again'));
    expect(docs(x)).toEqual([expect.objectContaining({ v: 1 })]);
    later(x.h, DRAFT_TTL_MS + 1);
    expect(await x.drafts().list(x.cookie.agent.id, ID.alice, x.h.clock.now)).toEqual([]);
    expect(docs(x)).toEqual([null]);
  });

  it('take is bound to the hash it is given; erasure writes nothing where nobody drafted', async () => {
    const storage = new FileAdaptiveStorage(join(makeStudio().dir, 'drafts'));
    const transact = vi.spyOn(storage, 'transact');
    const store = new ChannelDrafts(storage), now = new Date('2026-10-23T10:00:00Z');
    expect(await store.eraseUser(ID.alice, ['a', 'b'])).toBe(0);
    expect(transact).not.toHaveBeenCalled();
    const draft = { id: 'abcdefghijkl', chatIds: [CHANNEL], silent: false, textHash: textHash('one'), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(), via: 'dm' as const };
    await store.update('a', ID.alice, now, (d) => ({ drafts: [...d, draft], result: undefined }));
    expect(await store.take('a', ID.alice, draft.id, now, textHash('two'))).toBeNull();
    expect(await store.take('a', ID.alice, draft.id, now, textHash('one'))).toEqual(draft);
    expect(await store.restore('a', ID.alice, draft, now)).toBe(true);
    expect(await store.restore('a', ID.alice, draft, now)).toBe(false);
    expect(draftKey('a', ID.alice)).not.toContain(String(ID.alice));
  });
});

describe('the Meet link and the comments group', () => {
  it('c_<code> opens the agent DM card for someone outside the team', async () => {
    const x = await setup();
    await x.add();
    const code = channelCode(SECRET, CHANNEL);
    expect(parseStartPayload(`c_${code}`)).toEqual({ kind: 'channel', code });
    await x.send(dm(ID.stranger, `/start c_${code}`));
    const [chatId, text, options] = x.cookie.bot().sendMessage.mock.calls.at(-1)!;
    expect(chatId).toBe(ID.stranger);
    expect(text).toContain("Hi, I'm Cookie 🐾");
    expect(flat(options).map((b) => b.callback_data?.slice(0, 3))).toEqual(expect.arrayContaining(['cj:', 'cr:', 'cd:']));
  });

  it('getChat(channel).linked_chat_id offers "add to the comments group too" until the agent is there', async () => {
    const x = await setup();
    await x.add();
    const offered = await x.h.studio.circleChannels.list(x.org.bob, x.cookie.agent.id);
    expect(offered).toEqual({ channels: [{ chatId: CHANNEL, title: 'Cookie News', comments: 'offer', posting: 'ok' }], public: true, full: false, groupLink: `https://t.me/${x.cookie.agent.bot!.username}?startgroup=hoor` });
    expect(x.getChat).toHaveBeenCalledWith(CHANNEL);
    await x.h.store.update((s) => { s.groups.push({ chatId: COMMENTS, title: 'Cookie chat', memberIds: [], hasGuests: true, agentIds: [x.cookie.agent.id], addedAt: x.h.clock.now.toISOString() }); });
    expect((await x.h.studio.circleChannels.list(x.org.bob, x.cookie.agent.id)).channels[0].comments).toBe('added');
    x.getChat.mockResolvedValueOnce({ id: CHANNEL, type: 'channel', title: 'Cookie News' } as never);
    expect((await x.h.studio.circleChannels.list(x.org.bob, x.cookie.agent.id)).channels[0].comments).toBe('none');
    x.getChat.mockRejectedValueOnce(new Error('chat not found'));
    expect((await x.h.studio.circleChannels.list(x.org.bob, x.cookie.agent.id)).channels[0].comments).toBe('unknown');
  });
});

describe('wire formats', () => {
  it('callbacks are short, strict and bound to an index only for Post; /post parses', () => {
    const data = postCallback('pp', 'abcdefghijkl', 4);
    expect(data).toBe('pp:abcdefghijkl.4');
    expect(parsePostCallback(data)).toEqual({ action: 'pp', id: 'abcdefghijkl', index: 4 });
    expect(parsePostCallback('pe:abcdefghijkl')).toEqual({ action: 'pe', id: 'abcdefghijkl' });
    for (const bad of ['pp:abcdefghijkl', 'pe:abcdefghijkl.1', 'pp:abcdefghijkl.5', 'pq:abcdefghijkl', 'pp:short.1', 'cj:abcdefghijkl']) expect(parsePostCallback(bad)).toBeNull();
    expect(() => postCallback('pp', 'abcdefghijkl')).toThrow();
    expect(parsePostCommand('/post@cookie_bot  hello world ')).toEqual({ brief: 'hello world' });
    expect(parsePostCommand('/post')).toEqual({ brief: '' });
    expect(parsePostCommand('/postman')).toBeNull();
    expect(channelCode(SECRET, CHANNEL)).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

describe('Studio routes', () => {
  const BOT_TOKEN = '555:voxx-test-token';
  const call = async (h: Harness, method: string, path: string, as: number, body?: unknown) => {
    const headers: Record<string, string> = { 'x-telegram-init-data': signInitData({ id: as, first_name: 'U' }, BOT_TOKEN) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await handleStudioRequest(h.studio, new Request(`http://localhost/api/studio/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), path.split('/'), { botToken: BOT_TOKEN, devUser: null });
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };

  it('channels, channel-link, channel-draft, channel-post and channel-cancel; 404 with Circles off; drafting spends the generation budget', async () => {
    const x = await setup();
    await x.add();
    const limiter = { consume: vi.fn(async () => undefined) };
    x.h.studio.deps.rateLimiter = limiter;
    const id = x.cookie.agent.id;
    expect((await call(x.h, 'GET', `agents/${id}/channels`, ID.alice)).json).toMatchObject({ channels: [{ chatId: CHANNEL, comments: 'offer' }], link: channelLink(x.cookie.agent.bot!.username) });
    expect((await call(x.h, 'GET', `agents/${id}/channel-link`, ID.bob)).status).toBe(403);
    x.h.chatLLM.nextReply = 'Hi all';
    const drafted = await call(x.h, 'POST', `agents/${id}/channel-draft`, ID.bob, { brief: 'greet everyone' });
    expect(drafted.json).toMatchObject({ draft: { text: 'Hi all', channels: [{ chatId: CHANNEL }] } });
    expect(limiter.consume).toHaveBeenCalledWith('expensive', ID.bob);
    const draftId = (drafted.json.draft as { id: string }).id;
    expect((await call(x.h, 'POST', `agents/${id}/channel-cancel`, ID.bob, { id: draftId })).json).toEqual({ ok: true });
    expect((await call(x.h, 'POST', `agents/${id}/channel-post`, ID.bob, { id: draftId, chatId: CHANNEL, text: 'Hi all', silent: false })).status).toBe(409);
    expect(x.posts()).toEqual([]);
    x.h.studio.deps.circles = () => 'off';
    for (const path of ['channels', 'channel-link']) expect((await call(x.h, 'GET', `agents/${id}/${path}`, ID.alice)).status).toBe(404);
    expect((await call(x.h, 'POST', `agents/${id}/channel-draft`, ID.alice, { brief: 'x' })).status).toBe(404);
  });
});
