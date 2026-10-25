/**
 * Settings registry (Settings v2). Every setting Studio shows is declared here once: its level, section,
 * who changes it, whether it is space-bound, what it needs, and where its row leads. The agent hub and
 * the regrouped You tab render from these entries; the controls themselves stay the existing components
 * (`opens` names the page, sheet or route that hosts them). Adding a setting means adding one entry here
 * and its words in `settings-copy.ts`.
 *
 * Browser-safe (no server imports). The server stays the authority: `audience` decides what a row offers,
 * and every write still goes through its own typed route, permission check and audit row.
 */

import type { AgentView, Me } from '../client';
import type { Locale } from '../i18n';

export type SettingLevel = 'account' | 'agent';
/** Who changes it: the viewer for themselves, the agent's creator while it forms, a manager, or a superadmin. */
export type SettingAudience = 'self' | 'creator' | 'manager' | 'super';
export type AccountSection = 'general' | 'language' | 'notifications' | 'voice-recognition' | 'privacy' | 'account' | 'admin';
export type AgentSection = 'profile' | 'voice' | 'skills' | 'access' | 'groups' | 'memory' | 'permissions' | 'connectors' | 'notifications' | 'activity';
export type SettingSection = AccountSection | AgentSection;
/** The two halves of an agent's hub: what changes it for everyone, and what is just between it and you. */
export type AgentGroup = 'everyone' | 'you';
export type SettingRequires = 'identity' | 'bot' | 'active' | `feature:${string}`;
export type SettingKind = 'page' | 'sheet' | 'link' | 'switch' | 'panel';

/** Where a row leads: a section page of the agent hub, an existing sheet on it, or an existing route. */
export type SettingTarget =
  | { page: AgentSection }
  | { sheet: 'visibility' }
  | { route: 'memories' | 'agent-connections' | 'preferences' | 'inbox' | 'reminders' | 'voice-recognition' | 'shared-memories' | 'connections' | 'diagnostics' | 'requests'; view?: 'activity' }
  | { local: string };

/** Part 3 mirrors some settings as bot commands in the agent's private chat. */
export interface SettingCommand { command: string; scope: 'private' }

export interface SettingDef {
  id: string;
  level: SettingLevel;
  section: SettingSection;
  /** Agent rows only */
  group?: AgentGroup;
  audience: SettingAudience;
  /** The value lives per Work / Personal space: its page shows the SpaceBar and scopes sheets to the space */
  spaceBound: boolean;
  requires?: readonly SettingRequires[];
  kind: SettingKind;
  /** Icon name from ui.tsx */
  icon: string;
  opens?: SettingTarget;
  /** Extra visibility beyond the audience rule (e.g. needs a Telegram bot) */
  visible?: (ctx: SettingsCtx) => boolean;
  bot?: SettingCommand;
  /** features.* flag from GET me that must be on */
  flag?: 'settingsV2';
}

export interface SettingsCtx {
  me: Pick<Me, 'member' | 'features'>;
  agent?: AgentView;
  locale: Locale;
}

const agentSetting = (def: Omit<SettingDef, 'level' | 'flag'>): SettingDef => ({ level: 'agent', flag: 'settingsV2', ...def });
const accountSetting = (def: Omit<SettingDef, 'level' | 'flag'>): SettingDef => ({ level: 'account', flag: 'settingsV2', ...def });
const hasBot = (ctx: SettingsCtx) => !!ctx.agent?.bot;

export const SETTINGS: readonly SettingDef[] = [
  /* ---- an agent, for everyone ---- */
  agentSetting({ id: 'agent.profile', section: 'profile', group: 'everyone', audience: 'manager', spaceBound: false, requires: ['active'], kind: 'page', icon: 'user', opens: { page: 'profile' } }),
  agentSetting({ id: 'agent.voice', section: 'voice', group: 'everyone', audience: 'creator', spaceBound: false, requires: ['active'], kind: 'page', icon: 'mic', opens: { page: 'voice' }, bot: { command: 'voice', scope: 'private' } }),
  agentSetting({ id: 'agent.skills', section: 'skills', group: 'everyone', audience: 'creator', spaceBound: false, requires: ['active'], kind: 'page', icon: 'spark', opens: { page: 'skills' } }),
  agentSetting({ id: 'agent.access', section: 'access', group: 'everyone', audience: 'manager', spaceBound: false, requires: ['active'], kind: 'sheet', icon: 'lock', opens: { sheet: 'visibility' } }),
  agentSetting({ id: 'agent.groups', section: 'groups', group: 'everyone', audience: 'manager', spaceBound: false, requires: ['active'], kind: 'page', icon: 'groups', opens: { page: 'groups' } }),
  /* ---- an agent and you ---- */
  agentSetting({ id: 'agent.memory', section: 'memory', group: 'you', audience: 'self', spaceBound: false, requires: ['active'], kind: 'link', icon: 'memory', opens: { route: 'memories' }, bot: { command: 'memory', scope: 'private' } }),
  agentSetting({ id: 'agent.permissions', section: 'permissions', group: 'you', audience: 'self', spaceBound: true, requires: ['active', 'identity'], kind: 'page', icon: 'shield', opens: { page: 'permissions' } }),
  agentSetting({ id: 'agent.connectors', section: 'connectors', group: 'you', audience: 'self', spaceBound: true, requires: ['active', 'identity'], kind: 'link', icon: 'plug', opens: { route: 'agent-connections' }, bot: { command: 'connect', scope: 'private' } }),
  agentSetting({ id: 'agent.notifications', section: 'notifications', group: 'you', audience: 'self', spaceBound: true, requires: ['active', 'identity'], kind: 'page', icon: 'bell', opens: { page: 'notifications' } }),
  agentSetting({ id: 'agent.activity', section: 'activity', group: 'you', audience: 'self', spaceBound: true, requires: ['active'], kind: 'link', icon: 'list', opens: { route: 'agent-connections', view: 'activity' }, bot: { command: 'activity', scope: 'private' } }),
  /* ---- Vox-wide (the You tab) ---- */
  accountSetting({ id: 'account.space', section: 'general', audience: 'self', spaceBound: false, kind: 'switch', icon: 'sliders', opens: { local: 'space' } }),
  accountSetting({ id: 'account.preferences', section: 'general', audience: 'self', spaceBound: true, kind: 'link', icon: 'sliders', opens: { route: 'preferences' } }),
  accountSetting({ id: 'account.language', section: 'language', audience: 'self', spaceBound: false, kind: 'sheet', icon: 'globe', opens: { local: 'language' } }),
  accountSetting({ id: 'account.inbox', section: 'notifications', audience: 'self', spaceBound: true, kind: 'link', icon: 'inbox', opens: { route: 'inbox' } }),
  accountSetting({ id: 'account.reminders', section: 'notifications', audience: 'self', spaceBound: true, kind: 'link', icon: 'bell', opens: { route: 'reminders' } }),
  accountSetting({ id: 'account.voiceRecognition', section: 'voice-recognition', audience: 'self', spaceBound: true, kind: 'sheet', icon: 'mic', opens: { local: 'voice' } }),
  accountSetting({ id: 'account.agentAccess', section: 'privacy', audience: 'self', spaceBound: true, requires: ['identity'], kind: 'sheet', icon: 'lock', opens: { local: 'agents' } }),
  accountSetting({ id: 'account.sharedMemories', section: 'privacy', audience: 'self', spaceBound: true, kind: 'link', icon: 'groups', opens: { route: 'shared-memories' } }),
  accountSetting({ id: 'account.connections', section: 'privacy', audience: 'self', spaceBound: true, requires: ['identity'], kind: 'link', icon: 'plug', opens: { route: 'connections' } }),
  accountSetting({ id: 'account.pause', section: 'privacy', audience: 'self', spaceBound: true, kind: 'switch', icon: 'pause', opens: { local: 'pause' } }),
  accountSetting({ id: 'account.requests', section: 'privacy', audience: 'self', spaceBound: true, kind: 'sheet', icon: 'download', opens: { local: 'rights' } }),
  accountSetting({ id: 'account.purposes', section: 'privacy', audience: 'self', spaceBound: true, kind: 'panel', icon: 'shield' }),
  accountSetting({ id: 'account.notes', section: 'privacy', audience: 'self', spaceBound: true, requires: ['identity'], kind: 'panel', icon: 'edit' }),
  accountSetting({ id: 'account.identity', section: 'account', audience: 'self', spaceBound: true, kind: 'sheet', icon: 'user', opens: { local: 'identity' } }),
  accountSetting({ id: 'account.telegram', section: 'account', audience: 'self', spaceBound: false, kind: 'sheet', icon: 'telegram', opens: { local: 'account' } }),
  accountSetting({ id: 'account.diagnostics', section: 'admin', audience: 'super', spaceBound: true, kind: 'link', icon: 'signal', opens: { route: 'diagnostics' } }),
  accountSetting({ id: 'account.operatorRequests', section: 'admin', audience: 'super', spaceBound: false, kind: 'link', icon: 'shield', opens: { route: 'requests' } }),
];

/** Order of the Vox-wide hub (the You tab with Settings v2). */
export const ACCOUNT_SECTIONS: readonly AccountSection[] = ['general', 'language', 'notifications', 'voice-recognition', 'privacy', 'account', 'admin'];
export const AGENT_GROUPS: readonly AgentGroup[] = ['everyone', 'you'];

const BY_ID = new Map(SETTINGS.map((d) => [d.id, d]));
export const settingById = (id: string): SettingDef | undefined => BY_ID.get(id);

export const isSuper = (ctx: Pick<SettingsCtx, 'me'>) => ctx.me.member.role === 'owner' || ctx.me.member.role === 'superadmin';
const isManager = (agent: AgentView) => agent.canManageSettings ?? (agent.canManageAccess && agent.status !== 'fired');

/**
 * Whether the viewer sees the row. Rows that change an agent for everyone are shown only to people who
 * manage it (and never on a retired agent); voice and skills show there too, read-only unless the viewer
 * may shape them. Per-person rows show to anyone who can open the agent.
 */
export function canSee(def: SettingDef, ctx: SettingsCtx): boolean {
  if (def.flag && !ctx.me.features?.[def.flag]) return false;
  if (def.requires?.includes('active') && ctx.agent?.status !== 'active') return false;
  if (def.requires?.includes('bot') && !hasBot(ctx)) return false;
  if (def.level === 'agent' && !ctx.agent) return false;
  switch (def.audience) {
    case 'self': break;
    case 'super': if (!isSuper(ctx)) return false; break;
    case 'creator':
    case 'manager': if (!ctx.agent || !isManager(ctx.agent)) return false; break;
  }
  return def.visible ? def.visible(ctx) : true;
}

/** Whether the viewer may change it (the server checks again on every write). */
export function canChange(def: SettingDef, ctx: SettingsCtx): boolean {
  if (!canSee(def, ctx)) return false;
  switch (def.audience) {
    case 'self': return true;
    case 'super': return isSuper(ctx);
    case 'creator': return ctx.agent?.canShapeIdentity === true;
    case 'manager': return !!ctx.agent && isManager(ctx.agent);
  }
}

/** The visible rows of one half of an agent's hub, in registry order. */
export const agentRows = (ctx: SettingsCtx, group: AgentGroup): SettingDef[] =>
  SETTINGS.filter((d) => d.level === 'agent' && d.group === group && canSee(d, ctx));

/** The visible rows of one section of the Vox-wide hub, in registry order. */
export const accountRows = (ctx: SettingsCtx, section: AccountSection): SettingDef[] =>
  SETTINGS.filter((d) => d.level === 'account' && d.section === section && canSee(d, ctx));

/** Settings mirrored as bot commands (Part 3 builds the agent's command menu from these). */
export const settingCommands = (): Array<SettingCommand & { id: string }> =>
  SETTINGS.flatMap((d) => (d.bot ? [{ id: d.id, ...d.bot }] : []));
