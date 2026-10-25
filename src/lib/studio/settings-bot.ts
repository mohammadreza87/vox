/**
 * Settings as Telegram commands (Settings v2, Part 3). Every entry point reads STUDIO_SETTINGS_V2 per use; with it
 * off nothing here answers, sends or pushes, and every path is exactly as before.
 *
 *  - Manager bot (the only bot whose initData Studio verifies): /settings and `/start settings` open Vox › You;
 *    `/start s_<code>[_<letter>]` opens Settings › Agent X (› section). The reply's web_app button carries the
 *    same opaque code (`?settings=`), and the app asks the server again (GET settings-link). An unknown, malformed
 *    (any `s_…` the grammar does not read) or forbidden code gets the hub reply, word for word: it never says
 *    whether an agent exists.
 *  - Agent bots, private chat: /settings, /memory, /activity and /voice (/connectors and /ask stay the Connectors
 *    handoff in updates.ts). A Studio member who may open this agent in Studio (canUseAgent) gets a URL button into
 *    the manager bot (`?startapp=` when its Main Mini App is set, else `?start=`) plus, where useful, a web_app
 *    button to an agent-signed page. Anyone else talking to a public agent gets only agent-signed web_app pages
 *    (the pet page, /studio/connect/<id>). /voice is read-only: a sample of the voice, and for the creator while
 *    the agent forms a link to change it in Vox. Nothing in an agent bot changes voice or skills.
 *  - Groups: nothing personal is posted. One agent answers (the one named, or the group's speaker). The group sees
 *    the same short reply whoever asked and whatever happened (with a URL button that starts the bot,
 *    `?start=settings`), so it never learns who may use the agent, who chose "Not me", or who hit a limit. A person
 *    the agent talks to also gets a quiet private message, sent only once a chat action shows the private chat is
 *    reachable (so nothing is spent for someone who never started the bot). Never a web_app button in a group.
 *  - Menus: the manager bot's private-chat menu (settings). What was pushed is kept in the Studio state, so it is
 *    pushed when it changes, not on every process start; a process that pushed it removes it if the flag goes off.
 */

import { createHash } from 'crypto';
import type { InlineButton, InlineKeyboard, TelegramBotClient, TelegramMessage, TelegramUser } from '../tireh/telegram/client';
import { logTelegramDiagnostic } from '../tireh/telegram/diagnostics';
import { agentShortCode, sameShort } from '../circles/codec';
import { circleCopy, localeOf } from '../circles/notice';
import { petPageUrl } from '../pet/links';
import { settingsV2 } from './flags';
import { canShapeIdentity, canUseAgent, isLocked, visibilityOf, visibleAgents } from './permissions';
import { StudioRateLimiter, type StudioRequestRateLimiter } from './ratelimit';
import { UNREACHABLE } from './receipts';
import { BOT_SETTINGS_COMMANDS, MANAGER_MENU, parseSettingsLink, settingsCommandOf, settingsLinkCode, type BotSettingsCommand, type MenuLocale, type SettingsLetter, type SettingsSectionName } from './settings-commands';
import { connectPageUrl } from './updates';
import type { Studio } from './service';
import type { Agent, Member, StudioState } from './types';

/**
 * Who is asking, for this agent: a Studio member who may open it in Studio; someone else talking to it as a public
 * agent; someone who chose "Not me" for it (silent, as everywhere else while Circles is on); or nobody it talks to.
 */
export type SettingsAudience = 'member' | 'outsider' | 'declined' | 'none';
type Reply = { text: string; keyboard?: InlineKeyboard };

const COPY = {
  en: {
    hub: 'Your Vox settings.',
    agent: (name: string) => `Settings for ${name}.`,
    open: 'Open settings',
    settings: 'Here are my settings. Your memory and connectors are just yours.',
    settingsOutsider: 'Your notes with me, your choice to join, and apps you connected.',
    openAgentSettings: (name: string) => `⚙︎ Open ${name} settings`,
    openPet: (name: string) => `Open ${name}`,
    connectApp: 'Connect an app',
    memory: 'What I remember about you, and how to see or delete it.',
    memoryOutsider: 'Your notes with me are on my page, where you can see and erase them.',
    openMemory: 'Open Memory settings',
    myNotes: 'My notes',
    activity: 'What I did for you with the apps you connected.',
    activityOutsider: 'What I did with the apps you connected is on my Connections page.',
    openActivity: 'Open Activity',
    openConnections: 'Open connections',
    openCheckins: 'Open check-ins',
    openInVox: 'Open in Vox',
    connectors: (name: string) => `Open Connectors to ask ${name} with an app you connected. Each use is reviewed there, and answers stay private to you.`,
    openConnectors: 'Open Connectors',
    noVoice: "I don't have a voice yet; I talk by text.",
    voice: (label: string) => `I sound “${label}”.`,
    forming: " My voice is shaped in Vox while I'm forming, and after that it stays mine.",
    settled: ' Everyone hears the same voice.',
    sample: (name: string) => `Hi, I'm ${name}. This is how I sound.`,
    changeVoice: 'Change voice in Vox',
    inPrivate: 'Settings open in a private chat with me.',
    openChat: 'Open chat',
  },
  fa: {
    hub: 'تنظیمات Vox شما.',
    agent: (name: string) => `تنظیمات ${name}.`,
    open: 'باز کردن تنظیمات',
    settings: 'تنظیمات من اینجاست. حافظه و اتصال‌های شما فقط مال خود شماست.',
    settingsOutsider: 'یادداشت‌های شما با من، انتخاب شما برای پیوستن و برنامه‌هایی که وصل کرده‌اید.',
    openAgentSettings: (name: string) => `⚙︎ باز کردن تنظیمات ${name}`,
    openPet: (name: string) => `باز کردن ${name}`,
    connectApp: 'وصل کردن یک برنامه',
    memory: 'آنچه درباره شما به خاطر دارم، و راه دیدن یا پاک کردنش.',
    memoryOutsider: 'یادداشت‌های شما با من در صفحه من است؛ آنجا می‌توانید ببینید و پاکشان کنید.',
    openMemory: 'باز کردن تنظیمات حافظه',
    myNotes: 'یادداشت‌های من',
    activity: 'کارهایی که با برنامه‌های وصل‌شده برای شما کردم.',
    activityOutsider: 'کارهایی که با برنامه‌های وصل‌شده شما کردم در صفحه اتصال‌های من است.',
    openActivity: 'باز کردن فعالیت',
    openConnections: 'باز کردن اتصال‌ها',
    openCheckins: 'باز کردن بررسی‌ها',
    openInVox: 'باز کردن در Vox',
    connectors: (name: string) => `برای پرسیدن از ${name} با برنامه‌ای که وصل کرده‌اید، اتصال‌ها را باز کنید. هر استفاده همان‌جا بررسی می‌شود و پاسخ‌ها فقط برای شما می‌ماند.`,
    openConnectors: 'باز کردن اتصال‌ها',
    noVoice: 'هنوز صدایی ندارم؛ با نوشتن حرف می‌زنم.',
    voice: (label: string) => `صدای من «${label}» است.`,
    forming: ' صدای من تا وقتی در حال شکل گرفتنم در Vox ساخته می‌شود و بعد از آن همین می‌ماند.',
    settled: ' همه همین صدا را می‌شنوند.',
    sample: (name: string) => `سلام، من ${name} هستم. صدای من این‌طور است.`,
    changeVoice: 'تغییر صدا در Vox',
    inPrivate: 'تنظیمات در گفتگوی خصوصی با من باز می‌شود.',
    openChat: 'باز کردن گفتگو',
  },
} as const;

/** The copy, exported for tests and copy review. */
export const settingsBotCopy = (locale: MenuLocale) => COPY[locale];

const PRIVATE_SCOPE = { type: 'all_private_chats' } as const;
const START_SETTINGS = /^\/start(?:@[A-Za-z0-9_]{1,64})?\s+settings$/i;
/** A payload meant as a settings link (`s_…`), parsed or not: one the grammar does not read still opens the hub. */
const SETTINGS_PAYLOAD = /^s_/;
/** The person's /voice samples in agent bots: their own bucket of the voice limit, apart from choosing a voice in Vox. */
const BOT_VOICE_IDENTITY = (telegramId: number) => `agent-bot:${telegramId}`;
const HUB_COMMAND = BOT_SETTINGS_COMMANDS.find((c) => c.command === 'settings')!;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0, 16);
const url = (text: string, href: string | null): InlineButton | null => href ? { text: text.slice(0, 64), url: href } : null;
const webApp = (text: string, href: string | null): InlineButton | null => href ? { text: text.slice(0, 64), web_app: { url: href } } : null;
/** One button per row; rows whose link is missing are left out, and no rows means no keyboard. */
const keyboardOf = (...buttons: Array<InlineButton | null>): InlineKeyboard | undefined => {
  const rows = buttons.filter((b): b is InlineButton => !!b).map((b) => [b]);
  return rows.length ? { inline_keyboard: rows } : undefined;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** `webAppUrl` with one query parameter set (the manager bot's web_app button), or null when it is not a URL. */
function withParam(webAppUrl: string, key: string, value: string): string | null {
  try { const u = new URL(webAppUrl); u.searchParams.set(key, value); return u.href; } catch { return null; }
}

export class StudioSettingsBot {
  /** The manager menu this process knows is in place (a hash; null = none); undefined = not read from the state yet. */
  private managerMenu?: string | null;
  /** The menu sync in flight, so updates arriving together share one push. */
  private menuSync?: Promise<void>;
  private readonly ownLimiter = new StudioRateLimiter();

  constructor(private readonly studio: Studio) {}

  private get log() { return this.studio.deps.logger ?? console; }
  private now() { return this.studio.deps.now?.() ?? new Date(); }
  private limiter(): StudioRequestRateLimiter { return this.studio.deps.rateLimiter ?? this.ownLimiter; }
  private botOf(agent: Agent): TelegramBotClient | null {
    const token = this.studio.botToken(agent);
    return token ? this.studio.deps.botFor(token) : null;
  }

  async audienceOf(state: StudioState, agent: Agent, telegramId: number): Promise<SettingsAudience> {
    if (agent.status !== 'active' || (agent.blocked ?? []).includes(telegramId)) return 'none';
    const member = state.members.find((m) => m.telegramId === telegramId);
    if (member && canUseAgent(member, agent)) return 'member';
    if (visibilityOf(agent) !== 'public') return 'none';
    if (this.studio.circlesMode() !== 'off' && (await this.studio.agentChoice(agent.id, telegramId))?.choice === 'declined') return 'declined';
    return 'outsider';
  }

  /** `t.me/<manager>?startapp=s_<code>[_x]` (its Main Mini App is set), else `?start=`; null without a manager username. */
  voxLink(agent: Agent, letter?: SettingsLetter): string | null {
    const manager = this.studio.deps.managerUsername.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,64}$/.test(manager)) return null;
    let code: string;
    try { code = settingsLinkCode(agentShortCode(this.studio.deps.secret, agent.id), letter); } catch { return null; }
    return `https://t.me/${manager}?${this.studio.settingsMainApp() ? 'startapp' : 'start'}=${code}`;
  }

  /** The active agent a short code names, among those this member may open in Studio; null for anything else. */
  async resolveLink(member: Member, code: string): Promise<Agent | null> {
    if (member.role === 'pending') return null;
    const state = await this.studio.deps.store.read(), secret = this.studio.deps.secret;
    return visibleAgents(state, member).find((a) => a.status === 'active' && sameShort(agentShortCode(secret, a.id), code)) ?? null;
  }

  /** GET settings-link: where a deep link lands for this member, re-checked now; null = the hub (unknown, forbidden or malformed alike). */
  async resolveTarget(member: Member, raw: string | null): Promise<{ agentId: string; section?: SettingsSectionName } | null> {
    const link = parseSettingsLink(raw);
    if (link?.kind !== 'agent') return null;
    const agent = await this.resolveLink(member, link.code);
    return agent ? { agentId: agent.id, ...(link.section ? { section: link.section } : {}) } : null;
  }

  /* ---------- manager bot ---------- */

  /** /settings, `/start settings` and `/start s_…` in the manager bot's DM; false = not one of them (today's greeting). */
  async managerCommand(member: Member, msg: TelegramMessage): Promise<boolean> {
    const manager = this.studio.deps.managerBot, webAppUrl = this.studio.deps.webAppUrl;
    if (!settingsV2() || !manager || !webAppUrl || !msg.from || member.role === 'pending') return false;
    const match = /^\/(settings|start)(?:@([A-Za-z0-9_]{1,64}))?(?:\s+(\S+))?$/i.exec((msg.text ?? '').trim());
    if (!match || (match[2] && match[2].toLowerCase() !== this.studio.deps.managerUsername.replace(/^@/, '').toLowerCase())) return false;
    const isSettings = match[1].toLowerCase() === 'settings';
    if (isSettings && match[3]) return false;
    const link = isSettings ? { kind: 'hub' as const } : parseSettingsLink(match[3]) ?? (SETTINGS_PAYLOAD.test(match[3] ?? '') ? { kind: 'hub' as const } : null);
    if (!link) return false;
    const agent = link.kind === 'agent' ? await this.resolveLink(member, link.code) : null;
    const target = withParam(webAppUrl, 'settings', agent ? match[3]! : 'account');
    if (!target) return false;
    const copy = COPY[localeOf(msg.from.language_code)];
    await manager.sendMessage(msg.chat.id, agent ? copy.agent(agent.persona.name) : copy.hub, { keyboard: keyboardOf(webApp(copy.open, target))! });
    return true;
  }

  /**
   * The manager bot's private-chat menu (EN and FA). What was pushed is kept in the Studio state (`managerMenu`, a
   * hash), so a new process reads it once and pushes only when the menu changed. With the flag off a process that
   * pushed it removes it once; one that did not touches nothing (no read, no call: today's path exactly). Never
   * throws; a failure is retried on the next call.
   */
  syncManagerMenu(): Promise<void> {
    const want = settingsV2() ? hash(MANAGER_MENU) : null;
    if (!this.studio.deps.managerBot || this.managerMenu === want || (!want && this.managerMenu === undefined)) return Promise.resolve();
    this.menuSync ??= this.pushManagerMenu().finally(() => { this.menuSync = undefined; });
    return this.menuSync;
  }

  private async pushManagerMenu(): Promise<void> {
    const manager = this.studio.deps.managerBot!;
    const want = settingsV2() ? hash(MANAGER_MENU) : null;
    const known = this.managerMenu;
    try {
      const had = known !== undefined ? known : (await this.studio.deps.store.read()).managerMenu ?? null;
      if (had === want) { this.managerMenu = want; return; }
      // Claimed before the calls, so the update that triggered this does not start a second push alongside it.
      this.managerMenu = want;
      for (const locale of ['en', 'fa'] as const) {
        const target = { scope: PRIVATE_SCOPE, ...(locale === 'fa' ? { languageCode: 'fa' } : {}) };
        if (want) await manager.setMyCommands(MANAGER_MENU[locale], target);
        else await manager.deleteMyCommands(target);
      }
      await this.studio.deps.store.update((s) => { if (want) s.managerMenu = want; else delete s.managerMenu; });
    } catch {
      if (this.managerMenu === want) this.managerMenu = known;
      logTelegramDiagnostic(this.log, 'menu_failed');
    }
  }

  /* ---------- agent bots: private chat ---------- */

  /** /settings, /memory, /activity, /voice and `/start settings` in an agent's DM; false = today's path. */
  async privateCommand(live: Agent, msg: TelegramMessage, updateId: number, state: StudioState): Promise<boolean> {
    if (!settingsV2() || !msg.from) return false;
    const text = (msg.text ?? '').trim();
    const entry = START_SETTINGS.test(text) ? HUB_COMMAND : settingsCommandOf(text, live.bot?.username);
    if (!entry || entry.command === 'connectors') return false;
    const from = msg.from, audience = await this.audienceOf(state, live, from.id);
    if (audience !== 'member' && audience !== 'outsider') return false;
    const member = state.members.find((m) => m.telegramId === from.id);
    const reply = entry.command === 'voice' ? null : this.reply(live, entry, from, audience);
    const bot = this.botOf(live);
    if (!bot || (entry.command !== 'voice' && !reply)) return false;
    if (!await this.studio.deps.memory.deduper.firstSeen(`settings:${live.id}:${updateId}`)) return true;
    if (audience === 'outsider') {
      const standing = await this.studio.admitGuest(live.id, from);
      if (standing === 'blocked' || standing === 'over-limit') return true;
      if (standing === 'limit-reached') { await bot.sendMessage(msg.chat.id, circleCopy(localeOf(from.language_code)).limit).catch(() => this.failed()); return true; }
    }
    try {
      if (entry.command === 'voice') await this.voiceSample(live, from, audience, member, bot, msg.chat.id);
      else await bot.sendMessage(msg.chat.id, reply!.text, { silent: true, keyboard: reply!.keyboard });
    } catch { this.failed(); }
    return true;
  }

  /** The private reply to one settings command (not /voice); null when there is no page to open. */
  reply(agent: Agent, entry: BotSettingsCommand, from: TelegramUser, audience: 'member' | 'outsider'): Reply | null {
    const copy = COPY[localeOf(from.language_code)], name = agent.persona.name, webAppUrl = this.studio.deps.webAppUrl;
    const pet = petPageUrl(webAppUrl, agent.id), member = audience === 'member';
    let text: string, keyboard: InlineKeyboard | undefined;
    switch (entry.command) {
      case 'settings':
        text = member ? copy.settings : copy.settingsOutsider;
        keyboard = member ? keyboardOf(url(copy.openAgentSettings(name), this.voxLink(agent)), webApp(copy.openPet(name), pet))
          : keyboardOf(webApp(copy.openPet(name), pet), webApp(copy.connectApp, connectPageUrl(webAppUrl, agent.id, { ask: false })));
        break;
      case 'memory':
        text = member ? copy.memory : copy.memoryOutsider;
        keyboard = member ? keyboardOf(url(copy.openMemory, this.voxLink(agent, 'm')), webApp(copy.myNotes, pet)) : keyboardOf(webApp(copy.openMemory, pet));
        break;
      case 'activity':
        text = member ? copy.activity : copy.activityOutsider;
        keyboard = member ? keyboardOf(url(copy.openActivity, this.voxLink(agent, 'a'))) : keyboardOf(webApp(copy.openConnections, connectPageUrl(webAppUrl, agent.id, { ask: false })));
        break;
      case 'connectors':
        return this.connectorsReply(agent, from, member);
      case 'voice':
        // Answered with a sample (voiceSample), never with a page.
        return null;
      default: {
        // A command added to the table without an answer here does not compile.
        const unanswered: never = entry.command;
        return unanswered;
      }
    }
    return keyboard ? { text, keyboard } : null;
  }

  /**
   * /connectors and /ask: a web_app button to the agent's own Connections page (the reviewed task runs there); a
   * member also gets "Open in Vox". Null when there is no page to open.
   */
  connectorsReply(agent: Agent, from: TelegramUser | undefined, member: boolean): Reply | null {
    const page = connectPageUrl(this.studio.deps.webAppUrl, agent.id);
    if (!page) return null;
    const copy = COPY[localeOf(from?.language_code)];
    const vox = member && settingsV2() ? url(copy.openInVox, this.voxLink(agent, 'c')) : null;
    return { text: copy.connectors(agent.persona.name), keyboard: keyboardOf(webApp(copy.openConnectors, page), vox) };
  }

  /**
   * /voice, read-only: the agent's voice saying one fixed line (the same for everyone), with what it sounds like as
   * the caption; the creator, while it forms, also gets the way to change it in Vox. Text only without a voice, a
   * speech provider, or when the person's voice budget is spent. Throws only when the text itself cannot be sent.
   */
  async voiceSample(agent: Agent, from: TelegramUser, audience: 'member' | 'outsider', member: Member | undefined, bot: TelegramBotClient, chatId: number): Promise<void> {
    const copy = COPY[localeOf(from.language_code)], now = this.now(), voice = agent.voice;
    const label = voice?.label.split(' · ')[0].trim() || voice?.label;
    const text = voice && label ? copy.voice(label) + (isLocked(agent, now) ? copy.settled : copy.forming) : copy.noVoice;
    const change = audience === 'member' && canShapeIdentity(member, agent, now) ? url(copy.changeVoice, this.voxLink(agent, 'v')) : null;
    const keyboard = keyboardOf(change);
    const eleven = this.studio.deps.eleven;
    if (voice && eleven) {
      try {
        await this.limiter().consume('voice', BOT_VOICE_IDENTITY(from.id));
        const audio = await eleven.speak(copy.sample(agent.persona.name).slice(0, 300), voice.voiceId);
        if (audio.length) {
          await bot.sendVoice(chatId, Uint8Array.from(audio).buffer, { mimeType: 'audio/mpeg', filename: 'voice.mp3', caption: text, silent: true, ...(keyboard ? { keyboard } : {}) });
          return;
        }
      } catch { /* spent budget, speech or a refused voice message: the text alone below */ }
    }
    await bot.sendMessage(chatId, text, { silent: true, ...(keyboard ? { keyboard } : {}) });
  }

  /**
   * The button under an existing command's private reply (/memories, /forget, /forgetall, /notes → Memory settings;
   * /pause, /resume, /stop → check-ins; /leave → settings), following the member/outsider rule. Undefined with the
   * flag off, in groups (callers pass private chats only), and when there is nothing to open.
   */
  async trailingKeyboard(agentId: string, command: string, from: TelegramUser): Promise<InlineKeyboard | undefined> {
    if (!settingsV2()) return undefined;
    try {
      const state = await this.studio.deps.store.read();
      const agent = state.agents.find((a) => a.id === agentId && a.status === 'active');
      if (!agent) return undefined;
      const audience = await this.audienceOf(state, agent, from.id);
      if (audience !== 'member' && audience !== 'outsider') return undefined;
      const copy = COPY[localeOf(from.language_code)], member = audience === 'member', pet = petPageUrl(this.studio.deps.webAppUrl, agent.id);
      switch (command.replace(/^\//, '').toLowerCase()) {
        case 'memories': case 'forget': case 'forgetall': case 'forgetnote': case 'notes':
          return keyboardOf(member ? url(copy.openMemory, this.voxLink(agent, 'm')) : webApp(copy.openMemory, pet));
        case 'pause': case 'resume': case 'stop':
          return member ? keyboardOf(url(copy.openCheckins, this.voxLink(agent, 'p'))) : undefined;
        case 'leave':
          return keyboardOf(member ? url(copy.open, this.voxLink(agent)) : webApp(copy.open, pet));
        default:
          return undefined;
      }
    } catch { return undefined; }
  }

  /* ---------- agent bots: groups ---------- */

  /**
   * A settings command in a group: never answered in the group itself. One agent answers (the one named, else the
   * group's speaker). The group gets the same short reply whoever asked and whatever happened privately, with a URL
   * button that starts this bot; a person the agent talks to also gets a quiet private message. true = handled
   * (other agents stay silent too).
   */
  async groupCommand(live: Agent, msg: TelegramMessage, state: StudioState): Promise<boolean> {
    if (!settingsV2() || !msg.from) return false;
    const text = (msg.text ?? '').trim(), entry = settingsCommandOf(text, live.bot?.username);
    if (!entry) return false;
    const chatId = msg.chat.id, from = msg.from;
    if (!text.includes('@') && !await this.responds(live, chatId, state)) return true;
    if (!await this.studio.deps.memory.deduper.firstSeen(`settings:group:${chatId}:${msg.message_id}`)) return true;
    const bot = this.botOf(live);
    if (!bot) return true;
    await this.answerPrivately(live, entry, from, state, bot);
    const copy = COPY[localeOf(from.language_code)];
    const start = live.bot?.username ? `https://t.me/${live.bot.username}?start=settings` : null;
    const keyboard = keyboardOf(url(copy.openChat, start));
    await bot.sendMessage(chatId, copy.inPrivate, { replyTo: msg.message_id, silent: true, ...(keyboard ? { keyboard } : {}) }).catch(() => this.failed());
    return true;
  }

  /**
   * The private half of a group command, for a member or an outsider of a public agent (nobody else hears anything).
   * A chat action first shows the private chat is reachable, so someone who never started the bot costs no guest
   * admission and no speech. Never throws.
   */
  private async answerPrivately(live: Agent, entry: BotSettingsCommand, from: TelegramUser, state: StudioState, bot: TelegramBotClient): Promise<void> {
    const audience = await this.audienceOf(state, live, from.id);
    if (audience !== 'member' && audience !== 'outsider') return;
    try {
      await bot.sendChatAction(from.id, entry.command === 'voice' ? 'record_voice' : 'typing');
      if (audience === 'outsider') {
        const standing = await this.studio.admitGuest(live.id, from);
        if (standing === 'limit-reached') await bot.sendMessage(from.id, circleCopy(localeOf(from.language_code)).limit);
        if (standing !== 'ok') return;
      }
      if (entry.command === 'voice') {
        await this.voiceSample(live, from, audience, state.members.find((m) => m.telegramId === from.id), bot, from.id);
        return;
      }
      const reply = this.reply(live, entry, from, audience);
      if (reply) await bot.sendMessage(from.id, reply.text, { silent: true, keyboard: reply.keyboard });
    } catch (error) {
      // Never started, or blocked the bot: the group reply's button starts it.
      if (!UNREACHABLE.test(errorText(error))) this.failed();
    }
  }

  /** The agent that answers an unnamed command in this group: the circle's speaker, else the first active agent in it. */
  private async responds(live: Agent, chatId: number, state: StudioState): Promise<boolean> {
    if (this.studio.circleGroups.on(chatId)) {
      const doc = await this.studio.deps.circleLedger?.get(chatId).catch(() => null);
      const speaker = doc ? this.studio.circleGroups.speaker(doc) : undefined;
      if (speaker) return speaker === live.id;
    }
    const group = state.groups.find((g) => g.chatId === chatId);
    return group?.agentIds.find((id) => state.agents.some((a) => a.id === id && a.status === 'active' && !!a.tokenEnc)) === live.id;
  }

  private failed() { logTelegramDiagnostic(this.log, 'update_failed'); }
}
