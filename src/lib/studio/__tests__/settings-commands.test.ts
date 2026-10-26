/**
 * Settings as Telegram commands: the deep-link grammar, and the one command table agreeing with the settings
 * registry, the command menus and the connectors handoff.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS, settingById, settingCommands, type SettingsCtx } from '../../../app/studio/_lib/settings/registry';
import { agentSettingsStack, settingsLinkOf } from '../../../app/studio/_lib/settings/links';
import {
  agentMenus, BOT_SETTINGS_COMMANDS, botCommandFor, commandNames, legacyAgentMenu, MANAGER_MENU, parseSettingsLink, SECTION_LETTERS, settingsCommandOf, settingsLinkCode,
  type SettingsLetter,
} from '../settings-commands';
import { CONNECTORS_COMMANDS } from '../updates';
import { agentShortCode } from '../../circles/codec';
import { SECRET } from './helpers';

describe('settings deep links', () => {
  it('reads the hub and agent codes, with every section letter', () => {
    expect(parseSettingsLink('settings')).toEqual({ kind: 'hub' });
    expect(parseSettingsLink('account')).toEqual({ kind: 'hub' });
    expect(parseSettingsLink('s_AbCd-_12')).toEqual({ kind: 'agent', code: 'AbCd-_12' });
    for (const [letter, section] of Object.entries(SECTION_LETTERS)) {
      expect(parseSettingsLink(`s_AbCd-_12_${letter}`)).toEqual({ kind: 'agent', code: 'AbCd-_12', section });
    }
  });
  it('the fixed-length code keeps codes that contain _ and - unambiguous', () => {
    // A code that ends in "_m" is a code, not a memory section, when it is 8 characters on its own.
    expect(parseSettingsLink('s_AbCdEf_m')).toEqual({ kind: 'agent', code: 'AbCdEf_m' });
    expect(parseSettingsLink('s_AbCdEf_m_m')).toEqual({ kind: 'agent', code: 'AbCdEf_m', section: 'memory' });
    expect(parseSettingsLink('s_--------_v')).toEqual({ kind: 'agent', code: '--------', section: 'voice' });
  });
  it.each([
    ['an unknown letter', 's_AbCd-_12_z'], ['a 7-character code', 's_AbCd-_1'], ['a 9-character code', 's_AbCd-_123'], ['a bad charset', 's_AbCd!@12'],
    ['two letters', 's_AbCd-_12_mv'], ['a pet launch', 'p_AbCdEf12_abcdefghijklmnopqrstuv'], ['another start param', 'welcome'], ['empty', ''],
    ['over 64 characters', `s_${'a'.repeat(63)}`], ['upper-case hub', 'Settings'], ['a trailing space', 's_AbCd-_12 '],
  ])('ignores %s', (_name, value) => {
    expect(parseSettingsLink(value)).toBeNull();
  });
  it('ignores null and undefined', () => {
    expect(parseSettingsLink(null)).toBeNull();
    expect(parseSettingsLink(undefined)).toBeNull();
  });
  it('builds codes that read back, within Telegram\'s payload limits', () => {
    for (const id of ['ag-1', 'ag-2', 'x', 'agent_with-long-id-0123456789']) {
      const short = agentShortCode(SECRET, id);
      for (const letter of [undefined, ...Object.keys(SECTION_LETTERS)] as Array<SettingsLetter | undefined>) {
        const code = settingsLinkCode(short, letter);
        expect(code).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(parseSettingsLink(code)).toEqual({ kind: 'agent', code: short, ...(letter ? { section: SECTION_LETTERS[letter] } : {}) });
      }
    }
    expect(settingsLinkCode('AbCd-_12', 'm')).toBe('s_AbCd-_12_m');
    expect(() => settingsLinkCode('short')).toThrow('invalid_settings_link');
    expect(() => settingsLinkCode('AbCd-_12', 'z' as SettingsLetter)).toThrow('invalid_settings_link');
  });
  it('the Mini App takes ?settings= first, then start_param, then tgWebAppStartParam, and ignores the rest', () => {
    expect(settingsLinkOf('https://vox.example/studio?settings=account', 's_AbCd-_12_m')).toEqual({ raw: 'account', link: { kind: 'hub' }, fromQuery: true });
    expect(settingsLinkOf('https://vox.example/studio', 's_AbCd-_12_m')).toEqual({ raw: 's_AbCd-_12_m', link: { kind: 'agent', code: 'AbCd-_12', section: 'memory' }, fromQuery: false });
    expect(settingsLinkOf('https://vox.example/studio?tgWebAppStartParam=settings')).toEqual({ raw: 'settings', link: { kind: 'hub' }, fromQuery: false });
    expect(settingsLinkOf('https://vox.example/studio?tgWebAppStartParam=p_AbCdEf12_abcdefghijklmnopqrstuv')).toBeNull();
    expect(settingsLinkOf('https://vox.example/studio', 'welcome')).toBeNull();
    expect(settingsLinkOf('https://vox.example/studio?settings=junk!')).toBeNull();
  });
  it('an agent link opens Agents › its settings › the section\'s own page or route, when the viewer can see it there', () => {
    const ctx = (manages: boolean, agentId = 'ag1') => ({ me: { member: { role: 'member' }, features: { settingsV2: true } }, locale: 'en',
      agent: { id: agentId, status: 'active', canManageAccess: manages, canManageSettings: manages } }) as unknown as SettingsCtx;
    expect(agentSettingsStack('ag1')).toEqual([{ name: 'home' }, { name: 'settings', page: 'agent', params: { agentId: 'ag1' } }]);
    expect(agentSettingsStack('ag1', 'voice', ctx(true)).at(-1)).toEqual({ name: 'settings', page: 'agent', params: { agentId: 'ag1', section: 'voice' } });
    expect(agentSettingsStack('ag1', 'memory', ctx(false)).at(-1)).toEqual({ name: 'memories', id: 'ag1' });
    expect(agentSettingsStack('ag1', 'activity', ctx(false)).at(-1)).toEqual({ name: 'settings', page: 'agent-connections', params: { agentId: 'ag1', view: 'activity' } });
    expect(agentSettingsStack('ag1', 'nope', ctx(true))).toHaveLength(2);
    // A section the viewer cannot see, or with no agent (or another agent) to check it against, stops at the hub: never the hub twice.
    for (const section of ['voice', 'skills']) expect(agentSettingsStack('ag1', section, ctx(false))).toHaveLength(2);
    expect(agentSettingsStack('ag1', 'memory')).toHaveLength(2);
    expect(agentSettingsStack('ag1', 'memory', ctx(true, 'ag2'))).toHaveLength(2);
    // Every letter lands somewhere real for someone who may see it.
    for (const section of Object.values(SECTION_LETTERS)) expect(agentSettingsStack('ag1', section, ctx(true))).toHaveLength(3);
  });
});

describe('the command table, the registry, the menus and the handlers agree', () => {
  it('every registry entry with a bot command is exactly one table entry, and every section entry names a real setting', () => {
    const registry = settingCommands();
    const table = BOT_SETTINGS_COMMANDS.filter((c) => c.settingId);
    expect(registry.map((r) => r.id).sort()).toEqual(table.map((c) => c.settingId).sort());
    for (const entry of table) {
      const def = settingById(entry.settingId!)!;
      expect(def).toBeDefined();
      expect(def.bot).toEqual(botCommandFor(entry.settingId!));
      expect(def.bot).toEqual({ command: entry.command, scope: 'private', ...(entry.aliases ? { aliases: entry.aliases } : {}) });
      // The section letter opens the page this setting lives on.
      expect(SECTION_LETTERS[entry.letter!]).toBe(def.section);
    }
    // The hub command opens no single setting.
    expect(BOT_SETTINGS_COMMANDS.filter((c) => !c.settingId).map((c) => c.command)).toEqual(['settings']);
    // Every section letter names an agent section of the registry.
    for (const section of Object.values(SECTION_LETTERS)) expect(SETTINGS.some((d) => d.level === 'agent' && d.section === section)).toBe(true);
  });
  it('names are Telegram-valid, unique and have English and Persian menu words', () => {
    const names = BOT_SETTINGS_COMMANDS.flatMap(commandNames);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_]{1,32}$/);
    for (const c of BOT_SETTINGS_COMMANDS) { expect(c.menu.en.length).toBeGreaterThan(0); expect(c.menu.fa).toMatch(/[؀-ۿ]/); }
    for (const locale of ['en', 'fa'] as const) expect(MANAGER_MENU[locale].map((c) => c.command)).toEqual(['settings']);
  });
  it('the private menu carries every table command (EN and FA); the group menu only group-safe ones and /whoami', () => {
    const menus = agentMenus('Nova');
    for (const locale of ['en', 'fa'] as const) {
      const priv = menus.private[locale].map((c) => c.command), group = menus.group[locale].map((c) => c.command);
      for (const c of BOT_SETTINGS_COMMANDS) expect(priv).toContain(c.command);
      expect(priv).toEqual(expect.arrayContaining(['start', 'memories', 'forget', 'whoami']));
      expect(group).toEqual([...BOT_SETTINGS_COMMANDS.filter((c) => c.groupSafe).map((c) => c.command), 'whoami']);
      for (const c of [...menus.private[locale], ...menus.group[locale]]) expect(c.description.length).toBeLessThanOrEqual(256);
    }
    expect(menus.private.fa.find((c) => c.command === 'start')!.description).toBe('آشنایی با Nova');
    // The default scope keeps the pre-Part-3 menu byte for byte.
    expect(menus.default).toEqual(legacyAgentMenu('Nova'));
    expect(legacyAgentMenu('Nova')).toEqual([
      { command: 'start', description: 'Meet Nova' }, { command: 'memories', description: 'What I remember that you can see' },
      { command: 'forget', description: 'Delete something you told me' }, { command: 'whoami', description: 'How I know you' },
    ]);
  });
  it('the handlers answer every table command and alias, aimed at this bot only; lookalikes are not settings commands', () => {
    for (const c of BOT_SETTINGS_COMMANDS) for (const name of commandNames(c)) {
      expect(settingsCommandOf(`/${name}`, 'hoor_nova_bot')).toBe(c);
      expect(settingsCommandOf(`/${name}@hoor_nova_bot`, 'hoor_nova_bot')).toBe(c);
      expect(settingsCommandOf(`/${name}@Hoor_Nova_Bot`, 'hoor_nova_bot')).toBe(c);
      expect(settingsCommandOf(`/${name}@other_bot`, 'hoor_nova_bot')).toBeNull();
    }
    for (const text of ['/connect', '/memory2', '/memories', '/settings now', 'settings', '/voices', '/start', '/start settings']) expect(settingsCommandOf(text, 'hoor_nova_bot')).toBeNull();
  });
  it('the connectors handoff answers exactly the connectors entry', () => {
    expect([...CONNECTORS_COMMANDS].sort()).toEqual(commandNames(BOT_SETTINGS_COMMANDS.find((c) => c.settingId === 'agent.connectors')!).sort());
  });
});
