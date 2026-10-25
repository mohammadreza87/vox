import { describe, expect, it } from 'vitest';
import type { AgentView, Me } from '../client';
import { settingsCopy } from '../settings-copy';
import { accountRows, agentRows, canChange, canSee, settingById, settingCommands, SETTINGS, type SettingsCtx } from './registry';

const view = (o: Partial<AgentView> = {}): AgentView => ({
  id: 'a1', status: 'active', persona: { name: 'Nova' } as AgentView['persona'], look: {} as AgentView['look'], stage: 2,
  locked: false, formingDay: 2, isAdmin: false, visibility: 'org', liveWeb: true, mainMiniApp: false, groupBehavior: { participation: 'balanced', remember: true },
  access: [], createdBy: 1, canEdit: false, canEditLook: false, canFire: false, canManageAccess: false, canManageSettings: false, canShapeIdentity: false, formingDaysLeft: 5, ...o,
});
const me = (role: Me['member']['role'] = 'member', settingsV2 = true): SettingsCtx['me'] => ({
  member: { telegramId: 1, name: 'Reza', role, joinedAt: '' }, features: { avatars: true, voices: true, calls: true, settingsV2 },
});
const ctx = (agent?: AgentView, role?: Me['member']['role'], flag = true): SettingsCtx => ({ me: me(role, flag), agent, locale: 'en' });
const ids = (defs: Array<{ id: string }>) => defs.map((d) => d.id);

describe('settings registry', () => {
  it('declares every setting once, with English and Persian words', () => {
    expect(new Set(SETTINGS.map((d) => d.id)).size).toBe(SETTINGS.length);
    for (const d of SETTINGS) {
      expect(settingsCopy.en.rows[d.id]?.title, d.id).toBeTruthy();
      expect(settingsCopy.fa.rows[d.id]?.title, d.id).toBeTruthy();
      if (d.level === 'agent') expect(d.group).toMatch(/^(everyone|you)$/);
    }
  });

  it('the creator of a forming agent sees and may change everything, voice and skills included', () => {
    const c = ctx(view({ canManageAccess: true, canManageSettings: true, canShapeIdentity: true }));
    expect(ids(agentRows(c, 'everyone'))).toEqual(['agent.profile', 'agent.voice', 'agent.skills', 'agent.access', 'agent.groups']);
    expect(ids(agentRows(c, 'you'))).toEqual(['agent.memory', 'agent.permissions', 'agent.connectors', 'agent.notifications', 'agent.activity']);
    for (const d of agentRows(c, 'everyone')) expect(canChange(d, c), d.id).toBe(true);
  });

  it('a manager who is not the creator sees voice and skills read-only (audience creator)', () => {
    const c = ctx(view({ canManageAccess: true, canManageSettings: true, canShapeIdentity: false }), 'admin');
    expect(ids(agentRows(c, 'everyone'))).toContain('agent.voice');
    expect(canChange(settingById('agent.voice')!, c)).toBe(false);
    expect(canChange(settingById('agent.skills')!, c)).toBe(false);
    expect(canChange(settingById('agent.access')!, c)).toBe(true);
  });

  it('a plain user gets only the "and you" half', () => {
    const c = ctx(view());
    expect(agentRows(c, 'everyone')).toEqual([]);
    expect(ids(agentRows(c, 'you'))).toHaveLength(5);
    for (const d of agentRows(c, 'you')) expect(canChange(d, c)).toBe(true);
  });

  it('a retired agent shows no manager rows, even to its managers (reads stay on the server)', () => {
    const c = ctx(view({ status: 'fired', canManageAccess: true, canManageSettings: false }), 'admin');
    expect(agentRows(c, 'everyone')).toEqual([]);
    expect(agentRows(c, 'you')).toEqual([]);
    // Older payloads without canManageSettings derive it from status.
    expect(canSee(settingById('agent.access')!, ctx(view({ status: 'fired', canManageAccess: true, canManageSettings: undefined }), 'admin'))).toBe(false);
  });

  it('super rows only for owners and superadmins', () => {
    expect(ids(accountRows(ctx(undefined, 'member'), 'admin'))).toEqual([]);
    expect(ids(accountRows(ctx(undefined, 'admin'), 'admin'))).toEqual([]);
    expect(ids(accountRows(ctx(undefined, 'superadmin'), 'admin'))).toEqual(['account.diagnostics', 'account.operatorRequests']);
    expect(ids(accountRows(ctx(undefined, 'owner'), 'admin'))).toHaveLength(2);
  });

  it('nothing shows with the flag off', () => {
    const c = ctx(view({ canManageAccess: true, canManageSettings: true, canShapeIdentity: true }), 'owner', false);
    expect(agentRows(c, 'everyone')).toEqual([]);
    expect(agentRows(c, 'you')).toEqual([]);
    expect(accountRows(c, 'privacy')).toEqual([]);
  });

  it('groups the Vox-wide rows by section and lists the bot command mirrors for Part 3', () => {
    expect(ids(accountRows(ctx(), 'notifications'))).toEqual(['account.inbox', 'account.reminders']);
    expect(ids(accountRows(ctx(), 'privacy'))).toEqual(['account.agentAccess', 'account.sharedMemories', 'account.connections', 'account.pause', 'account.requests', 'account.purposes', 'account.notes']);
    expect(settingCommands().map((c) => c.command)).toEqual(['voice', 'memory', 'connect', 'activity']);
  });
});
