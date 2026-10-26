/**
 * Settings as Telegram commands (Settings v2, Part 3): the one table that says which bot command opens which
 * settings page, which one-letter section a deep link carries, which commands may show in a group's menu and
 * their menu words in English and Persian. The settings registry (app/studio/_lib/settings/registry.ts), the
 * bot handlers (settings-bot.ts, updates.ts) and the command menus (service.ts profilePlan) all read it, so a
 * command is declared once.
 *
 * Browser-safe and pure: no server imports (the Mini App parses deep links with it too).
 *
 * Deep links (`start` / `startapp` payloads, at most 64 of [A-Za-z0-9_-], opaque only):
 *  - `settings` (or `account`): the Vox-wide hub (You);
 *  - `s_<code>` and `s_<code>_<letter>`: one agent's settings, and one section of them. `<code>` is the agent's
 *    8-character short code (circles/codec.ts agentShortCode, an HMAC; it can contain `_` and `-`), so the fixed
 *    length keeps the split unambiguous. The server maps the code back to an agent and re-checks access on
 *    every open; an unknown or forbidden code opens the hub and never says whether the agent exists.
 */

/** One-letter deep-link suffix → agent settings section (registry AgentSection). */
export const SECTION_LETTERS = { v: 'voice', k: 'skills', m: 'memory', a: 'activity', c: 'connectors', p: 'permissions', n: 'notifications' } as const;
export type SettingsLetter = keyof typeof SECTION_LETTERS;
export type SettingsSectionName = (typeof SECTION_LETTERS)[SettingsLetter];

export type MenuLocale = 'en' | 'fa';

/** Every settings command a bot answers. A new one is added here first, so each handler's switch must answer it to compile. */
export type SettingsCommandName = 'settings' | 'memory' | 'voice' | 'activity' | 'connectors';

export interface BotSettingsCommand {
  /** Without the slash */
  command: SettingsCommandName;
  /** Registry id of the page it opens; none = the agent's settings hub (/settings) */
  settingId?: string;
  /** Section suffix for `s_<code>_<letter>` */
  letter?: SettingsLetter;
  /** Other commands the bot answers the same way */
  aliases?: readonly string[];
  /** May show in a group's command menu (it answers by a private message) */
  groupSafe: boolean;
  /** Menu description */
  menu: Record<MenuLocale, string>;
}

export const BOT_SETTINGS_COMMANDS: readonly BotSettingsCommand[] = [
  { command: 'settings', groupSafe: true, menu: { en: 'All my settings', fa: 'همهٔ تنظیمات من' } },
  { command: 'memory', settingId: 'agent.memory', letter: 'm', groupSafe: false, menu: { en: 'What I remember', fa: 'آنچه به خاطر دارم' } },
  { command: 'voice', settingId: 'agent.voice', letter: 'v', groupSafe: false, menu: { en: 'My voice', fa: 'صدای من' } },
  { command: 'activity', settingId: 'agent.activity', letter: 'a', groupSafe: false, menu: { en: 'What I did for you', fa: 'کارهایی که برای شما کردم' } },
  { command: 'connectors', settingId: 'agent.connectors', letter: 'c', aliases: ['ask'], groupSafe: false, menu: { en: 'Connect an app', fa: 'وصل کردن یک برنامه' } },
];

const BY_COMMAND = new Map(BOT_SETTINGS_COMMANDS.flatMap((c) => [c.command, ...(c.aliases ?? [])].map((name) => [name, c] as const)));

/** The registry's `bot` field for a setting (`{command, scope, aliases}`), from this table. */
export function botCommandFor(settingId: string): { command: string; scope: 'private'; aliases?: readonly string[] } | undefined {
  const entry = BOT_SETTINGS_COMMANDS.find((c) => c.settingId === settingId);
  return entry ? { command: entry.command, scope: 'private', ...(entry.aliases ? { aliases: entry.aliases } : {}) } : undefined;
}

/** The command and its aliases, without slashes. */
export const commandNames = (entry: BotSettingsCommand): string[] => [entry.command, ...(entry.aliases ?? [])];

/**
 * The settings command a message is, or null: `/name` or `/name@bot` alone on the line (no arguments), where a
 * named bot must be `botUsername` (another agent's command is not this one's). `/memories` is not `/memory`.
 */
export function settingsCommandOf(text: string | undefined, botUsername?: string): BotSettingsCommand | null {
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{1,64}))?$/.exec((text ?? '').trim());
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== (botUsername ?? '').toLowerCase()) return null;
  return BY_COMMAND.get(match[1].toLowerCase()) ?? null;
}

export const SETTINGS_LINK = /^s_([A-Za-z0-9_-]{8})(?:_([vkmacpn]))?$/;
export type SettingsLink = { kind: 'hub' } | { kind: 'agent'; code: string; section?: SettingsSectionName };

/** A `start` / `startapp` / `?settings=` value, or null for anything else (`p_…`, `welcome`, junk): those are ignored. */
export function parseSettingsLink(value?: string | null): SettingsLink | null {
  if (!value || value.length > 64) return null;
  if (value === 'settings' || value === 'account') return { kind: 'hub' };
  const match = SETTINGS_LINK.exec(value);
  if (!match) return null;
  const letter = match[2] as SettingsLetter | undefined;
  return { kind: 'agent', code: match[1], ...(letter ? { section: SECTION_LETTERS[letter] } : {}) };
}

/** `s_<short>[_<letter>]`; throws on a short code or letter the grammar would not read back. */
export function settingsLinkCode(short: string, letter?: SettingsLetter): string {
  const code = `s_${short}${letter ? `_${letter}` : ''}`;
  const parsed = parseSettingsLink(code);
  if (parsed?.kind !== 'agent' || parsed.code !== short) throw new Error('invalid_settings_link');
  return code;
}

/* ---------- command menus ---------- */

export interface MenuCommand { command: string; description: string }
export interface AgentMenus {
  /** Default scope: exactly the menu every bot had before Part 3 */
  default: MenuCommand[];
  /** all_private_chats, by language (en = no language_code) */
  private: Record<MenuLocale, MenuCommand[]>;
  /** all_group_chats, by language: only commands that are safe to send in a group */
  group: Record<MenuLocale, MenuCommand[]>;
}

const CORE = {
  start: { en: (name: string) => `Meet ${name}`, fa: (name: string) => `آشنایی با ${name}` },
  memories: { en: 'What I remember that you can see', fa: 'آنچه به خاطر دارم و شما می‌بینید' },
  forget: { en: 'Delete something you told me', fa: 'پاک کردن چیزی که به من گفته‌اید' },
  whoami: { en: 'How I know you', fa: 'شما را چطور می‌شناسم' },
} as const;

/** The agent bot's menu before Part 3 (and with Settings v2 off): kept byte for byte so its profile hash never moves. */
export function legacyAgentMenu(name: string): MenuCommand[] {
  return [
    { command: 'start', description: `Meet ${name}`.slice(0, 256) },
    { command: 'memories', description: CORE.memories.en },
    { command: 'forget', description: CORE.forget.en },
    { command: 'whoami', description: CORE.whoami.en },
  ];
}

/** Settings v2 menus: private chats get the settings commands, groups only what answers by a private message. */
export function agentMenus(name: string): AgentMenus {
  const privateMenu = (l: MenuLocale): MenuCommand[] => [
    { command: 'start', description: CORE.start[l](name).slice(0, 256) },
    ...BOT_SETTINGS_COMMANDS.map((c) => ({ command: c.command, description: c.menu[l] })),
    { command: 'memories', description: CORE.memories[l] },
    { command: 'forget', description: CORE.forget[l] },
    { command: 'whoami', description: CORE.whoami[l] },
  ];
  const groupMenu = (l: MenuLocale): MenuCommand[] => [
    ...BOT_SETTINGS_COMMANDS.filter((c) => c.groupSafe).map((c) => ({ command: c.command, description: c.menu[l] })),
    { command: 'whoami', description: CORE.whoami[l] },
  ];
  return { default: legacyAgentMenu(name), private: { en: privateMenu('en'), fa: privateMenu('fa') }, group: { en: groupMenu('en'), fa: groupMenu('fa') } };
}

/** The manager bot's private-chat menu (Settings v2); `/start` is implicit. */
export const MANAGER_MENU: Record<MenuLocale, MenuCommand[]> = {
  en: [{ command: 'settings', description: 'Open your Vox settings' }],
  fa: [{ command: 'settings', description: 'باز کردن تنظیمات Vox' }],
};
