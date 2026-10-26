/**
 * Settings as Telegram commands (Settings v2, Part 3): the manager bot's /settings and /start s_…, the agent bots'
 * /settings /memory /activity /voice /connectors for Studio members and for outsiders of a public agent, groups that
 * never see anything personal, the buttons under existing commands, the settings-link endpoint, and flag-off parity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../auth';
import { handleStudioRequest } from '../http';
import { handleAgentUpdate, handleManagerUpdate, registerWebhooks } from '../updates';
import { settingsBotCopy, StudioSettingsBot } from '../settings-bot';
import { BOT_SETTINGS_COMMANDS, commandNames } from '../settings-commands';
import { settingsCopy } from '../../../app/studio/_lib/settings-copy';
import { agentShortCode } from '../../circles/codec';
import { TelegramApiError, type InlineKeyboard, type TelegramMessage, type TelegramUpdate } from '../../tireh/telegram/client';
import type { AgentJoin } from '../types';
import { StudioRateLimiter } from '../ratelimit';
import { hire, ID, makeStudio, SECRET, seedOrg, type FakeTelegram, type Harness } from './helpers';

const BOT_TOKEN = '555:fixture-settings-token';
const WEB = 'https://vox.example/studio';
let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let nova: Awaited<ReturnType<typeof hire>>;

beforeEach(async () => {
  vi.stubEnv('STUDIO_SETTINGS_V2', '1');
  h = makeStudio();
  h.studio.deps.webAppUrl = WEB;
  org = await seedOrg(h);
  nova = await hire(h, org.alice, { name: 'Nova' });
});
afterEach(() => { vi.unstubAllEnvs(); });

let n = 20_000;
const user = (id: number, language_code?: string) => ({ id, is_bot: false, first_name: 'X', ...(language_code ? { language_code } : {}) });
const dm = (from: number, text: string, language_code?: string): TelegramUpdate =>
  ({ update_id: ++n, message: { message_id: n, date: 0, text, from: user(from, language_code), chat: { id: from, type: 'private' } } }) as TelegramUpdate;
const inGroup = (chatId: number, from: number, text: string, messageId = ++n, language_code?: string): TelegramUpdate =>
  ({ update_id: ++n, message: { message_id: messageId, date: 0, text, from: user(from, language_code), chat: { id: chatId, type: 'supergroup', title: 'G' } } }) as TelegramUpdate;
const short = (agentId: string) => agentShortCode(SECRET, agentId);
const calls = (bot: FakeTelegram) => bot.sendMessage.mock.calls as Array<[number, string, { keyboard?: InlineKeyboard; silent?: boolean; replyTo?: number } | undefined]>;
const buttons = (opts?: { keyboard?: InlineKeyboard }) => opts?.keyboard?.inline_keyboard.flat() ?? [];
const lastTo = (bot: FakeTelegram, chatId: number) => calls(bot).filter(([c]) => c === chatId).at(-1);
async function setVoice(agentId: string, label = 'Warm · built-in') {
  await h.store.update((s) => { s.agents.find((a) => a.id === agentId)!.voice = { provider: 'elevenlabs', voiceId: 'v-warm', label, source: 'default' }; });
}
async function publicAgent(name = 'Pip') {
  return hire(h, org.alice, { name }, undefined, 'public');
}

describe('manager bot: /settings and /start s_<code>', () => {
  const manager = (from: number, text: string, language_code?: string) => handleManagerUpdate(h.studio,
    { update_id: ++n, message: { message_id: n, date: 0, text, from: user(from, language_code), chat: { id: from, type: 'private' } } });
  const reply = () => h.manager.sendMessage.mock.calls.at(-1) as [number, string, { keyboard?: InlineKeyboard }];

  it('/settings and /start settings open Vox › You, without the account block', async () => {
    for (const text of ['/settings', '/settings@VoxxBot', '/start settings']) {
      await manager(ID.bob, text);
      const [chat, said, opts] = reply();
      expect(chat).toBe(ID.bob);
      expect(said).toBe('Your Vox settings.');
      expect(said).not.toContain('User ID');
      expect(opts.keyboard).toEqual({ inline_keyboard: [[{ text: 'Open settings', web_app: { url: `${WEB}?settings=account` } }]] });
    }
    await manager(ID.bob, '/settings', 'fa');
    expect(reply()[1]).toBe('تنظیمات Vox شما.');
    expect(buttons(reply()[2])[0].text).toBe('باز کردن تنظیمات');
  });

  it('/start s_<code>_<letter> from someone who may open the agent opens its settings section, carrying the same opaque code', async () => {
    const code = `s_${short(nova.agent.id)}_v`;
    await manager(ID.bob, `/start ${code}`);
    expect(reply()[1]).toBe('Settings for Nova.');
    expect(reply()[2].keyboard).toEqual({ inline_keyboard: [[{ text: 'Open settings', web_app: { url: `${WEB}?settings=${code}` } }]] });
    expect(JSON.stringify(reply())).not.toContain(nova.agent.id);
  });

  it('an unknown, malformed or forbidden code gets the hub reply word for word: nothing says the agent exists', async () => {
    const secret = await hire(h, org.alice, { name: 'Secret' }, undefined, 'private');
    await manager(ID.bob, '/settings');
    const hub = JSON.stringify(reply());
    for (const text of [`/start s_${short(secret.agent.id)}_m`, '/start s_ZZZZZZZZ', `/start s_${short(secret.agent.id)}`]) {
      await manager(ID.bob, text);
      expect(JSON.stringify(reply())).toBe(hub);
    }
    // Malformed s_ payloads (truncated or old code, a letter that is not a section, too long) are the hub too, never the greeting.
    for (const text of ['/start s_abc', `/start s_${short(nova.agent.id)}_z`, `/start s_${short(nova.agent.id)}_mm`, `/start s_${'A'.repeat(70)}`, '/start s_']) {
      await manager(ID.bob, text);
      expect(JSON.stringify(reply())).toBe(hub);
    }
    // The creator may open it.
    await manager(ID.alice, `/start s_${short(secret.agent.id)}_m`);
    expect(reply()[1]).toBe('Settings for Secret.');
  });

  it('a pending person, other payloads and other text get today\'s greeting', async () => {
    await manager(ID.pending, '/settings');
    expect(reply()[1]).toContain('Share your User ID with an admin');
    for (const text of ['/start', '/start j_abc', '/start welcome', 'Hello', '/settings now', '/settings@OtherBot']) {
      await manager(ID.bob, text);
      expect(reply()[1]).toContain('Spawn, call and manage');
      expect(reply()[1]).toContain(`User ID: ${ID.bob}`);
    }
  });

  it('flag off: /settings and /start s_… get today\'s greeting, and no menu is pushed', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    for (const text of ['/settings', `/start s_${short(nova.agent.id)}_m`]) {
      await manager(ID.bob, text);
      expect(reply()[1]).toContain('Spawn, call and manage');
      expect(reply()[2]).toEqual({ keyboard: { inline_keyboard: [[{ text: 'Open Vox Studio', web_app: { url: WEB } }]] } });
    }
    await registerWebhooks(h.studio, 'https://vox.example');
    expect(h.manager.setMyCommands).not.toHaveBeenCalled();
    expect(h.manager.deleteMyCommands).not.toHaveBeenCalled();
  });

  it('the manager menu: /settings in private chats, English and Persian, pushed once per process; removed once if the flag goes off', async () => {
    await registerWebhooks(h.studio, 'https://vox.example');
    await manager(ID.bob, 'Hello');
    await h.studio.settingsBot.syncManagerMenu();
    expect(h.manager.setMyCommands.mock.calls).toEqual([
      [[{ command: 'settings', description: 'Open your Vox settings' }], { scope: { type: 'all_private_chats' } }],
      [[{ command: 'settings', description: 'باز کردن تنظیمات Vox' }], { scope: { type: 'all_private_chats' }, languageCode: 'fa' }],
    ]);
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    await h.studio.settingsBot.syncManagerMenu();
    await h.studio.settingsBot.syncManagerMenu();
    expect(h.manager.deleteMyCommands.mock.calls).toEqual([[{ scope: { type: 'all_private_chats' } }], [{ scope: { type: 'all_private_chats' }, languageCode: 'fa' }]]);
  });

  it('the pushed menu is kept in the Studio state: a new process does not push it again; the flag going off removes it once', async () => {
    await h.studio.settingsBot.syncManagerMenu();
    expect(h.manager.setMyCommands).toHaveBeenCalledTimes(2);
    expect((await h.store.read()).managerMenu).toMatch(/^[\w-]{16}$/);
    // Updates arriving together share one push.
    const fresh = new StudioSettingsBot(h.studio);
    await Promise.all([fresh.syncManagerMenu(), fresh.syncManagerMenu(), new StudioSettingsBot(h.studio).syncManagerMenu()]);
    expect(h.manager.setMyCommands).toHaveBeenCalledTimes(2);
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    // A process that never pushed it reads nothing and calls nothing with the flag off (today's path).
    const read = vi.spyOn(h.store, 'read');
    await new StudioSettingsBot(h.studio).syncManagerMenu();
    expect(read).not.toHaveBeenCalled();
    expect(h.manager.deleteMyCommands).not.toHaveBeenCalled();
    await fresh.syncManagerMenu();
    await fresh.syncManagerMenu();
    expect(h.manager.deleteMyCommands).toHaveBeenCalledTimes(2);
    expect((await h.store.read()).managerMenu).toBeUndefined();
    // On again: pushed again, since the state says it is gone.
    vi.stubEnv('STUDIO_SETTINGS_V2', '1');
    await new StudioSettingsBot(h.studio).syncManagerMenu();
    expect(h.manager.setMyCommands).toHaveBeenCalledTimes(4);
  });

  it('two first updates in one process push the menu once', async () => {
    await Promise.all([h.studio.settingsBot.syncManagerMenu(), h.studio.settingsBot.syncManagerMenu()]);
    expect(h.manager.setMyCommands).toHaveBeenCalledTimes(2);
  });

  it('a refused menu push is retried on the next call', async () => {
    h.manager.setMyCommands.mockRejectedValueOnce(new Error('Too Many Requests'));
    await h.studio.settingsBot.syncManagerMenu();
    await h.studio.settingsBot.syncManagerMenu();
    expect(h.manager.setMyCommands).toHaveBeenCalledTimes(3);
  });
});

describe('GET settings-link (the Mini App re-resolves every code)', () => {
  const get = (as: number, code: string) => handleStudioRequest(h.studio, new Request(`http://localhost/api/studio/settings-link?code=${encodeURIComponent(code)}`,
    { headers: { 'x-telegram-init-data': signInitData({ id: as, first_name: 'X' }, BOT_TOKEN) } }), ['settings-link'], { botToken: BOT_TOKEN, devUser: null });

  it('a code the person may open → the agent and section; unknown, forbidden, malformed and hub codes → the same null', async () => {
    const secret = await hire(h, org.alice, { name: 'Secret' }, undefined, 'private');
    expect(await (await get(ID.bob, `s_${short(nova.agent.id)}_v`)).json()).toEqual({ target: { agentId: nova.agent.id, section: 'voice' } });
    expect(await (await get(ID.bob, `s_${short(nova.agent.id)}`)).json()).toEqual({ target: { agentId: nova.agent.id } });
    for (const code of [`s_${short(secret.agent.id)}_m`, 's_ZZZZZZZZ_m', 'account', 'p_AbCdEf12_abcdefghijklmnopqrstuv', 'junk!']) {
      const res = await get(ID.bob, code);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ target: null });
    }
    expect(await (await get(ID.alice, `s_${short(secret.agent.id)}_m`)).json()).toEqual({ target: { agentId: secret.agent.id, section: 'memory' } });
  });
  it('pending → 403; flag off → 404', async () => {
    expect((await get(ID.pending, `s_${short(nova.agent.id)}`)).status).toBe(403);
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    expect((await get(ID.bob, `s_${short(nova.agent.id)}`)).status).toBe(404);
  });
});

describe('agent bot DM: a Studio member', () => {
  const bot = () => nova.bot();
  const vox = (letter?: string) => `https://t.me/VoxxBot?start=s_${short(nova.agent.id)}${letter ? `_${letter}` : ''}`;
  const pet = () => `https://vox.example/studio/pet/${nova.agent.id}`;

  it('/settings: a URL button into Vox (the manager bot) and the agent-signed pet page; quiet; nothing reaches the model', async () => {
    const before = h.chatLLM.replyRequests.length;
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/settings'));
    expect(lastTo(bot(), ID.bob)).toEqual([ID.bob, 'Here are my settings. Your memory and connectors are just yours.', { silent: true, keyboard: { inline_keyboard: [
      [{ text: '⚙︎ Open Nova settings', url: vox() }], [{ text: 'Open Nova', web_app: { url: pet() } }]] } }]);
    expect(h.chatLLM.replyRequests.length).toBe(before);
  });

  it('/start settings is /settings; /memory → _m (and My data for notes), /activity → _a', async () => {
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/start settings'));
    expect(buttons(lastTo(bot(), ID.bob)![2])[0]).toEqual({ text: '⚙︎ Open Nova settings', url: vox() });
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/memory'));
    expect(buttons(lastTo(bot(), ID.bob)![2])).toEqual([{ text: 'Open Memory settings', url: vox('m') }, { text: 'My notes', url: 'https://t.me/VoxxBot?start=mydata' }]);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/activity', 'fa'));
    expect(lastTo(bot(), ID.bob)![1]).toBe('کارهایی که با برنامه‌های وصل‌شده برای شما کردم.');
    expect(buttons(lastTo(bot(), ID.bob)![2])).toEqual([{ text: 'باز کردن فعالیت', url: vox('a') }]);
  });

  it('with the manager bot\'s Main Mini App set (STUDIO_MAIN_APP_BOT), links open Vox directly with startapp, whatever Circles says', async () => {
    h.studio.deps.mainAppBot = () => '@VoxxBot';
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/memory'));
    expect(buttons(lastTo(bot(), ID.bob)![2])[0]).toEqual({ text: 'Open Memory settings', url: `https://t.me/VoxxBot?startapp=s_${short(nova.agent.id)}_m` });
    expect(h.studio.mainApp()).toBeUndefined();
    h.studio.deps.mainAppBot = () => 'SomeOtherBot';
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/memory'));
    expect(buttons(lastTo(bot(), ID.bob)![2])[0]).toEqual({ text: 'Open Memory settings', url: vox('m') });
  });

  it('/memories, /forget, /forgetall and /pause keep their replies and gain the matching settings button', async () => {
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/memories'));
    expect(lastTo(bot(), ID.bob)).toEqual([ID.bob, "I don't remember anything you can see yet.", { keyboard: { inline_keyboard: [[{ text: 'Open Memory settings', url: vox('m') }]] } }]);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/forget 3'));
    expect(lastTo(bot(), ID.bob)).toEqual([ID.bob, 'Send /memories first, then /forget with a number from the list.', { keyboard: { inline_keyboard: [[{ text: 'Open Memory settings', url: vox('m') }]] } }]);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/forgetall'));
    expect(buttons(lastTo(bot(), ID.bob)![2])).toEqual([{ text: 'Open Memory settings', url: vox('m') }]);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/pause'));
    expect(lastTo(bot(), ID.bob)![1]).toContain('Check-ins are paused for a week');
    expect(buttons(lastTo(bot(), ID.bob)![2])).toEqual([{ text: 'Open check-ins', url: vox('p') }]);
  });

  it('/connectors and /ask: fixed copy and one URL button into Vox (Connectors & plugins), never a page of the agent\'s own', async () => {
    for (const text of ['/connectors', '/ask', '/ask@nova_bot']) {
      await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, text));
      const [, said, opts] = lastTo(bot(), ID.bob)!;
      expect(said).toBe('Connect apps and ask Nova with them in Vox. Each use is reviewed there, and answers stay in Vox, private to you.');
      expect(opts).toEqual({ silent: true, keyboard: { inline_keyboard: [[{ text: 'Open in Vox', url: vox('c') }]] } });
    }
    expect(JSON.stringify(calls(bot()))).not.toMatch(/web_app|studio\/connect/);
  });

  it('an edit into a settings command is not answered (it goes on to the archive\'s edit handling)', async () => {
    const archive = { invalidateEditedMessage: vi.fn(async () => undefined), command: vi.fn(async () => false), capture: vi.fn(async () => undefined), context: vi.fn() };
    h.studio.deps.telegramArchive = archive as unknown as NonNullable<typeof h.studio.deps.telegramArchive>;
    bot().sendMessage.mockClear();
    for (const text of ['/settings', '/ask']) {
      const { message, update_id } = dm(ID.bob, text) as { message: TelegramMessage; update_id: number };
      await handleAgentUpdate(h.studio, nova.agent.id, { update_id, edited_message: message } as TelegramUpdate);
    }
    expect(calls(bot())).toEqual([]);
    expect(archive.invalidateEditedMessage).toHaveBeenCalledTimes(2);
    delete h.studio.deps.telegramArchive;
  });

  it('a private agent\'s non-member still hears "I\'m private"; a lookalike or another bot\'s command is not a settings command', async () => {
    const secret = await hire(h, org.alice, { name: 'Secret' }, undefined, 'private');
    await handleAgentUpdate(h.studio, secret.agent.id, dm(ID.bob, '/settings'));
    expect(lastTo(secret.bot(), ID.bob)![1]).toContain("I'm private for now");
    for (const text of ['/memories@other_bot', '/settings@other_bot', '/memory2']) {
      bot().sendMessage.mockClear();
      await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, text)).catch(() => undefined);
      expect(JSON.stringify(calls(bot()))).not.toContain('t.me/VoxxBot');
    }
  });
});

describe('agent bot /voice is read-only', () => {
  const bot = () => nova.bot();
  it('the creator, while the agent forms: the voice sample with its caption, and a link to change it in Vox', async () => {
    await setVoice(nova.agent.id);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.alice, '/voice'));
    expect(h.eleven.speak).toHaveBeenCalledWith("Hi, I'm Nova. This is how I sound.", 'v-warm');
    const [chat, , opts] = bot().sendVoice.mock.calls.at(-1) as unknown as [number, ArrayBuffer, { caption: string; keyboard?: InlineKeyboard; silent?: boolean }];
    expect(chat).toBe(ID.alice);
    expect(opts.caption).toBe("I sound “Warm”. My voice is shaped in Vox while I'm forming, and after that it stays mine.");
    expect(opts.silent).toBe(true);
    expect(opts.keyboard).toEqual({ inline_keyboard: [[{ text: 'Change voice in Vox', url: `https://t.me/VoxxBot?start=s_${short(nova.agent.id)}_v` }]] });
  });
  it('another member, and the creator after the lock: the sample, never a way to change it', async () => {
    await setVoice(nova.agent.id);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/voice'));
    expect((bot().sendVoice.mock.calls.at(-1) as unknown as [number, ArrayBuffer, { keyboard?: InlineKeyboard }])[2].keyboard).toBeUndefined();
    h.advanceDays(8);
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.alice, '/voice', 'fa'));
    const opts = (bot().sendVoice.mock.calls.at(-1) as unknown as [number, ArrayBuffer, { caption: string; keyboard?: InlineKeyboard }])[2];
    expect(opts.keyboard).toBeUndefined();
    expect(opts.caption).toBe('صدای من «Warm» است. همه همین صدا را می‌شنوند.');
  });
  it('no voice yet: text only, no speech', async () => {
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/voice'));
    expect(h.eleven.speak).not.toHaveBeenCalled();
    expect(bot().sendVoice).not.toHaveBeenCalled();
    expect(lastTo(bot(), ID.bob)).toEqual([ID.bob, "I don't have a voice yet; I talk by text.", { silent: true }]);
  });
  it('speech failing, or the person\'s voice budget spent: the caption as text', async () => {
    await setVoice(nova.agent.id);
    h.eleven.speak.mockRejectedValueOnce(new Error('quota'));
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/voice'));
    expect(bot().sendVoice).not.toHaveBeenCalled();
    expect(lastTo(bot(), ID.bob)![1]).toMatch(/^I sound “Warm”\./);
    h.studio.deps.rateLimiter = { consume: () => { throw new Error('rate_limited'); } };
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/voice'));
    expect(h.eleven.speak).toHaveBeenCalledTimes(1);
    expect(bot().sendVoice).not.toHaveBeenCalled();
  });
  it('bot samples use their own bucket of the voice limit: choosing a voice in Vox keeps its whole budget', async () => {
    await setVoice(nova.agent.id);
    const limiter = new StudioRateLimiter({ policies: { voice: { requests: 2, windowMs: 60_000 } } });
    h.studio.deps.rateLimiter = limiter;
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.alice, '/voice'));
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.alice, '/voice'));
    expect(h.eleven.speak).toHaveBeenCalledTimes(2);
    // What the Mini App's voice search, preview and speak routes consume (http.ts): untouched by the samples.
    expect(() => limiter.consume('voice', ID.alice)).not.toThrow();
    expect(() => limiter.consume('voice', ID.alice)).not.toThrow();
  });
  it('a refused voice message (privacy settings) falls back to text', async () => {
    await setVoice(nova.agent.id);
    bot().sendVoice.mockRejectedValueOnce(new TelegramApiError('sendVoice', 'Bad Request: VOICE_MESSAGES_FORBIDDEN'));
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/voice'));
    expect(lastTo(bot(), ID.bob)![1]).toMatch(/^I sound “Warm”\./);
  });
});

describe('agent bot DM: an outsider of a public agent', () => {
  it('/settings, /memory and /activity: the pet page or My data, never an agent settings link into Vox or the connect page', async () => {
    const pip = await publicAgent();
    const pet = `https://vox.example/studio/pet/${pip.agent.id}`, myData = 'https://t.me/VoxxBot?start=mydata';
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/settings'));
    expect(lastTo(pip.bot(), ID.stranger)).toEqual([ID.stranger, 'Your notes with me and your choice to join.', { silent: true, keyboard: { inline_keyboard: [
      [{ text: 'Open Pip', web_app: { url: pet } }]] } }]);
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/memory'));
    expect(lastTo(pip.bot(), ID.stranger)).toEqual([ID.stranger, 'Your notes with me are in My data in Vox, where you can see and erase them.', { silent: true, keyboard: { inline_keyboard: [
      [{ text: 'Open My data', url: myData }]] } }]);
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/activity'));
    expect(lastTo(pip.bot(), ID.stranger)).toEqual([ID.stranger, 'Apps are connected in Vox, and nothing I did with them is shown in this chat.', { silent: true }]);
    expect(JSON.stringify(calls(pip.bot()))).not.toContain('studio/connect');
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/memories'));
    expect(buttons(lastTo(pip.bot(), ID.stranger)![2])).toEqual([{ text: 'Open My data', url: myData }]);
    // The only Vox link an outsider gets is the fixed, content-free My data one: never an agent settings code.
    expect(JSON.stringify(calls(pip.bot()))).not.toMatch(/start(app)?=s_/);
    // A pending Studio member is an outsider here too.
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.pending, '/settings'));
    expect(JSON.stringify(lastTo(pip.bot(), ID.pending))).not.toContain('t.me/');
  });
  it('/voice: the sample only; /connectors and /ask: a fixed line, no button (Vox has no page for outsiders yet)', async () => {
    const pip = await publicAgent();
    await setVoice(pip.agent.id);
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/voice'));
    expect((pip.bot().sendVoice.mock.calls.at(-1) as unknown as [number, ArrayBuffer, { keyboard?: InlineKeyboard }])[2].keyboard).toBeUndefined();
    for (const text of ['/connectors', '/ask']) {
      await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, text));
      expect(lastTo(pip.bot(), ID.stranger)).toEqual([ID.stranger, "Connecting apps happens in Vox, and it isn't open to you yet.", { silent: true }]);
    }
  });
  it('counts against the guest limit', async () => {
    const pip = await publicAgent();
    h.studio.deps.guestDailyLimit = 1;
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/settings'));
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/memory'));
    await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, '/activity'));
    const said = calls(pip.bot()).filter(([c]) => c === ID.stranger).map(([, t]) => t);
    expect(said).toEqual(['Your notes with me and your choice to join.', "I've enjoyed talking, but I need a break. Let's pick this up tomorrow."]);
  });
  it('someone who chose "Not me" (Circles on) gets silence', async () => {
    const pip = await publicAgent();
    h.studio.deps.circles = () => 'reply';
    vi.spyOn(h.studio, 'agentChoice').mockResolvedValue({ choice: 'declined' } as AgentJoin);
    pip.bot().sendMessage.mockClear();
    for (const text of ['/settings', '/memory', '/voice']) await handleAgentUpdate(h.studio, pip.agent.id, dm(ID.stranger, text));
    expect(calls(pip.bot())).toEqual([]);
  });
});

describe('groups: nothing personal is posted', () => {
  const CHAT = -5005;
  let second: Awaited<ReturnType<typeof hire>>;
  beforeEach(async () => {
    second = await hire(h, org.alice, { name: 'Sol' });
    await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'G', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [nova.agent.id, second.agent.id], addedBy: ID.alice, addedAt: h.clock.now.toISOString() }); });
  });
  const groupPosts = (bot: FakeTelegram) => calls(bot).filter(([c]) => c === CHAT);
  const groupReply = (agent: { bot?: { username?: string } }, replyTo: number, locale: 'en' | 'fa' = 'en') => [CHAT, settingsBotCopy(locale).inPrivate, { replyTo, silent: true,
    keyboard: { inline_keyboard: [[{ text: settingsBotCopy(locale).openChat, url: `https://t.me/${agent.bot!.username}?start=settings` }]] } }];
  const unreachable = (bot: FakeTelegram, who: number) => {
    const refuse = () => { throw new TelegramApiError('sendMessage', "Forbidden: bot can't initiate conversation with a user"); };
    bot.sendChatAction.mockImplementation(async (chatId: number) => { if (chatId === who) refuse(); return true; });
    bot.sendMessage.mockImplementation(async (chatId: number) => {
      if (chatId === who) refuse();
      return { message_id: 1, chat: { id: chatId, type: 'supergroup' }, date: 0 };
    });
  };

  it('an edit into a settings command in the group is not answered: no DM, no group reply, no guest admission, no speech', async () => {
    const pip = await publicAgent();
    await setVoice(pip.agent.id);
    await h.store.update((s) => { s.groups.find((g) => g.chatId === CHAT)!.agentIds.push(pip.agent.id); });
    const admit = vi.spyOn(h.studio, 'admitGuest');
    h.eleven.speak.mockClear();
    for (const [agent, from, text] of [[nova, ID.bob, '/settings'], [pip, ID.stranger, `/voice@${pip.agent.bot!.username}`], [pip, ID.stranger, '/settings']] as const) {
      agent.bot().sendMessage.mockClear();
      const { message, update_id } = inGroup(CHAT, from, text) as { message: TelegramMessage; update_id: number };
      await handleAgentUpdate(h.studio, agent.agent.id, { update_id, edited_message: message } as TelegramUpdate).catch(() => undefined);
      expect(calls(agent.bot()).filter(([c, said]) => c === from || said === settingsBotCopy('en').inPrivate)).toEqual([]);
    }
    expect(admit).not.toHaveBeenCalled();
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });

  it('a named /settings sends a quiet DM; the group gets one short reply with a start link, no web_app button and nothing personal', async () => {
    const update = inGroup(CHAT, ID.bob, `/settings@${nova.agent.bot!.username}`);
    await handleAgentUpdate(h.studio, nova.agent.id, update);
    expect(lastTo(nova.bot(), ID.bob)![2]).toMatchObject({ silent: true });
    expect(buttons(lastTo(nova.bot(), ID.bob)![2])[0]).toEqual({ text: '⚙︎ Open Nova settings', url: `https://t.me/VoxxBot?start=s_${short(nova.agent.id)}` });
    expect(groupPosts(nova.bot())).toEqual([groupReply(nova.agent, update.message!.message_id)]);
    expect(JSON.stringify(groupPosts(nova.bot()))).not.toMatch(/web_app|VoxxBot|Nova settings|s_/);
  });

  it('the group cannot tell who may use the agent, who chose "Not me", or who hit the guest limit: the same reply for all', async () => {
    const secret = await hire(h, org.alice, { name: 'Secret' }, undefined, 'private');
    const pip = await publicAgent();
    await h.store.update((s) => { s.groups.find((g) => g.chatId === CHAT)!.agentIds.push(secret.agent.id, pip.agent.id); });
    const posted = async (agent: typeof nova, from: number) => {
      const update = inGroup(CHAT, from, `/settings@${agent.agent.bot!.username}`);
      await handleAgentUpdate(h.studio, agent.agent.id, update);
      const post = groupPosts(agent.bot()).at(-1)!;
      expect(post[2]!.replyTo).toBe(update.message!.message_id);
      return JSON.stringify([post[1], { ...post[2], replyTo: 0 }]);
    };
    // Private agent: Alice may use it, Bob may not.
    const allowed = await posted(secret, ID.alice), refused = await posted(secret, ID.bob);
    expect(refused).toBe(allowed);
    expect(calls(secret.bot()).filter(([c]) => c === ID.bob)).toEqual([]);
    // Public agent: an outsider, then one who chose "Not me", then one over the guest limit (told privately).
    const outsider = await posted(pip, ID.stranger);
    h.studio.deps.circles = () => 'reply';
    const choice = vi.spyOn(h.studio, 'agentChoice').mockResolvedValue({ choice: 'declined' } as AgentJoin);
    pip.bot().sendMessage.mockClear();
    expect(await posted(pip, ID.stranger)).toBe(outsider);
    expect(calls(pip.bot()).filter(([c]) => c === ID.stranger)).toEqual([]);
    choice.mockRestore();
    h.studio.deps.guestDailyLimit = 1;
    expect(await posted(pip, ID.stranger)).toBe(outsider);
    expect(lastTo(pip.bot(), ID.stranger)![1]).toBe("I've enjoyed talking, but I need a break. Let's pick this up tomorrow.");
    expect(outsider).toBe(allowed.replace(secret.agent.bot!.username!, pip.agent.bot!.username!));
  });

  it('an unnamed command gets exactly one responder and one DM, even with two agents in the chat', async () => {
    const messageId = 777;
    await handleAgentUpdate(h.studio, nova.agent.id, inGroup(CHAT, ID.bob, '/memory', messageId));
    await handleAgentUpdate(h.studio, second.agent.id, inGroup(CHAT, ID.bob, '/memory', messageId));
    expect(groupPosts(nova.bot())).toHaveLength(1);
    expect(calls(nova.bot()).filter(([c]) => c === ID.bob)).toHaveLength(1);
    expect(calls(second.bot())).toEqual([]);
    // Redelivered: still once.
    await handleAgentUpdate(h.studio, nova.agent.id, inGroup(CHAT, ID.bob, '/memory', messageId));
    expect(groupPosts(nova.bot())).toHaveLength(1);
  });

  it('never started the bot: the same group reply, whose button starts it (?start=settings) in the person\'s language; that start then answers /settings', async () => {
    unreachable(nova.bot(), ID.bob);
    const update = inGroup(CHAT, ID.bob, '/settings', ++n, 'fa');
    await handleAgentUpdate(h.studio, nova.agent.id, update);
    expect(groupPosts(nova.bot())).toEqual([groupReply(nova.agent, update.message!.message_id, 'fa')]);
    nova.bot().sendMessage.mockReset().mockImplementation(async (chatId: number) => ({ message_id: 1, chat: { id: chatId, type: 'private' }, date: 0 }));
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/start settings'));
    expect(lastTo(nova.bot(), ID.bob)![1]).toBe('Here are my settings. Your memory and connectors are just yours.');
  });

  it('never started: /voice spends no speech and no voice budget, and an outsider spends no guest admission', async () => {
    await setVoice(nova.agent.id);
    const limiter = { consume: vi.fn() };
    h.studio.deps.rateLimiter = limiter;
    unreachable(nova.bot(), ID.bob);
    for (let i = 0; i < 3; i++) await handleAgentUpdate(h.studio, nova.agent.id, inGroup(CHAT, ID.bob, `/voice@${nova.agent.bot!.username}`));
    expect(h.eleven.speak).not.toHaveBeenCalled();
    expect(limiter.consume).not.toHaveBeenCalled();
    expect(groupPosts(nova.bot()).map(([, t]) => t)).toEqual(Array(3).fill('Settings open in a private chat with me.'));
    const pip = await publicAgent();
    await setVoice(pip.agent.id);
    await h.store.update((s) => { s.groups.find((g) => g.chatId === CHAT)!.agentIds.push(pip.agent.id); });
    unreachable(pip.bot(), ID.stranger);
    const admit = vi.spyOn(h.studio, 'admitGuest');
    for (const text of ['/voice', '/settings', '/memory']) await handleAgentUpdate(h.studio, pip.agent.id, inGroup(CHAT, ID.stranger, `${text}@${pip.agent.bot!.username}`));
    expect(admit).not.toHaveBeenCalled();
    expect(h.eleven.speak).not.toHaveBeenCalled();
  });

  it('/voice in a group sends the sample by DM; /whoami posts no Telegram ID', async () => {
    await setVoice(nova.agent.id);
    await handleAgentUpdate(h.studio, nova.agent.id, inGroup(CHAT, ID.bob, `/voice@${nova.agent.bot!.username}`));
    expect(nova.bot().sendVoice.mock.calls.map(([c]) => c)).toEqual([ID.bob]);
    expect(groupPosts(nova.bot()).map(([, t]) => t)).toEqual(['Settings open in a private chat with me.']);
    await handleAgentUpdate(h.studio, nova.agent.id, inGroup(CHAT, ID.bob, `/whoami@${nova.agent.bot!.username}`));
    expect(groupPosts(nova.bot()).map(([, t]) => t)).toEqual(['Settings open in a private chat with me.', "I've sent you a message."]);
    expect(lastTo(nova.bot(), ID.bob)![1]).toMatch(/^Bob/);
    expect(JSON.stringify(groupPosts(nova.bot()))).not.toContain(String(ID.bob));
  });

  it('flag off: a group /settings takes today\'s path (no DM, no settings reply)', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    await handleAgentUpdate(h.studio, nova.agent.id, inGroup(CHAT, ID.bob, `/settings@${nova.agent.bot!.username}`)).catch(() => undefined);
    expect(calls(nova.bot()).filter(([c]) => c === ID.bob)).toEqual([]);
    expect(JSON.stringify(calls(nova.bot()))).not.toContain('Settings open in a private chat');
  });
});

describe('every command in the table is answered (spec F): DM and group, member and outsider', () => {
  const CHAT = -6006;
  it('each command and alias gets a private answer and never reaches the model; in a group, a DM plus the group reply', async () => {
    const pip = await publicAgent();
    await setVoice(nova.agent.id);
    await setVoice(pip.agent.id);
    await h.store.update((s) => { s.groups.push({ chatId: CHAT, title: 'G', memberIds: [ID.bob], hasGuests: true, agentIds: [nova.agent.id], addedBy: ID.alice, addedAt: h.clock.now.toISOString() }); });
    await h.store.update((s) => { s.groups.push({ chatId: CHAT - 1, title: 'G2', memberIds: [], hasGuests: true, agentIds: [pip.agent.id], addedBy: ID.alice, addedAt: h.clock.now.toISOString() }); });
    const answered = (bot: FakeTelegram, to: number) => calls(bot).filter(([c]) => c === to).length + bot.sendVoice.mock.calls.filter(([c]) => c === to).length;
    const llm = h.chatLLM.replyRequests.length;
    for (const entry of BOT_SETTINGS_COMMANDS) for (const name of commandNames(entry)) {
      for (const [agent, from] of [[nova, ID.bob], [pip, ID.stranger]] as const) {
        const before = answered(agent.bot(), from);
        await handleAgentUpdate(h.studio, agent.agent.id, dm(from, `/${name}`));
        expect(answered(agent.bot(), from), `DM /${name} → ${agent.agent.persona.name}`).toBe(before + 1);
        const chat = agent === nova ? CHAT : CHAT - 1, posts = calls(agent.bot()).filter(([c]) => c === chat).length;
        await handleAgentUpdate(h.studio, agent.agent.id, inGroup(chat, from, `/${name}@${agent.agent.bot!.username}`));
        expect(answered(agent.bot(), from), `group /${name} → ${agent.agent.persona.name}`).toBe(before + 2);
        expect(calls(agent.bot()).filter(([c]) => c === chat).length).toBe(posts + 1);
      }
    }
    expect(h.chatLLM.replyRequests.length).toBe(llm);
  });
});

describe('flag-off parity in agent DMs', () => {
  it('no settings handler answers, no button is added, /voice sends no sample', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    await setVoice(nova.agent.id);
    for (const text of ['/settings', '/memory', '/activity', '/voice', '/start settings']) await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, text)).catch(() => undefined);
    expect(JSON.stringify(calls(nova.bot()))).not.toMatch(/t\.me\/VoxxBot|Here are my settings|I sound/);
    expect(nova.bot().sendVoice).not.toHaveBeenCalled();
    nova.bot().sendMessage.mockClear();
    await handleAgentUpdate(h.studio, nova.agent.id, dm(ID.bob, '/memories'));
    expect(calls(nova.bot()).at(-1)).toEqual([ID.bob, "I don't remember anything you can see yet."]);
  });
});

describe('copy', () => {
  it('the bot names check-ins with the word the Permissions page uses', () => {
    expect(settingsBotCopy('fa').openCheckins).toContain(settingsCopy.fa.checkIns);
    expect(settingsBotCopy('en').openCheckins.toLowerCase()).toContain(settingsCopy.en.checkIns.toLowerCase());
  });
  it('every settings-bot string exists in English and Persian', () => {
    const en = settingsBotCopy('en'), fa = settingsBotCopy('fa');
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(fa) as Array<keyof typeof fa>) {
      const value = fa[key], said = typeof value === 'function' ? (value as (x: string) => string)('Nova') : value;
      expect(said).toMatch(/[\u0600-\u06FF]/);
    }
  });
});
