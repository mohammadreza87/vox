import { describe, expect, it } from 'vitest';
import {
  atLeast, canDeleteDraft, canEditPersona, canFire, canManageAccess, canSetAgentAdmin, canSpawn, canUseAgent,
  checkRoleChange, formingDay, isLocked, visibleAgents,
} from '../permissions';
import type { Agent, Member, Role, StudioState } from '../types';
import { fakeMember, ID, personaSpec, T0 } from './helpers';

const DAY = 86_400_000;

function agent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 'ag1',
    status: 'active',
    persona: personaSpec(),
    look: { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: false } },
    createdBy: ID.alice,
    createdAt: T0.toISOString(),
    hiredAt: T0.toISOString(),
    lockAt: new Date(T0.getTime() + 7 * DAY).toISOString(),
    isAdmin: false,
    access: 'everyone',
    identityVersion: 1,
    ...partial,
  };
}

const sa = fakeMember(ID.superadmin, 'superadmin');
const admin = fakeMember(ID.admin, 'admin');
const alice = fakeMember(ID.alice, 'member');
const bob = fakeMember(ID.bob, 'member');
const pending = fakeMember(ID.pending, 'pending');

function state(members: Member[], agents: Agent[] = []): StudioState {
  return { members, agents, groups: [], audit: [] };
}

describe('role ranks', () => {
  it('orders superadmin > admin > member > pending', () => {
    const order: Role[] = ['pending', 'member', 'admin', 'superadmin'];
    for (const [i, role] of order.entries()) {
      const m = fakeMember(1, role);
      for (const [j, needed] of order.entries()) expect(atLeast(m, needed)).toBe(i >= j);
    }
    expect(atLeast(undefined, 'pending')).toBe(false);
  });

  it('pending people cannot spawn; members can', () => {
    expect(canSpawn(pending)).toBe(false);
    expect(canSpawn(undefined)).toBe(false);
    expect(canSpawn(alice)).toBe(true);
  });
});

describe('forming period and lock', () => {
  const a = agent();
  it('is unlocked before lockAt and locked from lockAt on', () => {
    expect(isLocked(a, new Date(T0.getTime() + 7 * DAY - 1))).toBe(false);
    expect(isLocked(a, new Date(T0.getTime() + 7 * DAY))).toBe(true);
  });

  it('drafts and fired agents are never "locked" (lock is about active agents)', () => {
    expect(isLocked(agent({ status: 'draft', lockAt: undefined }), new Date(T0.getTime() + 30 * DAY))).toBe(false);
  });

  it('formingDay counts 1..7 and is null once locked', () => {
    expect(formingDay(a, T0)).toBe(1);
    expect(formingDay(a, new Date(T0.getTime() + 1.5 * DAY))).toBe(2);
    expect(formingDay(a, new Date(T0.getTime() + 7 * DAY - 1))).toBe(7);
    expect(formingDay(a, new Date(T0.getTime() + 7 * DAY))).toBeNull();
    expect(formingDay(agent({ status: 'draft' }), T0)).toBeNull();
  });
});

describe('persona editing', () => {
  const forming = agent();
  const later = new Date(T0.getTime() + 8 * DAY);

  it('creator and admins may edit while forming; other members and pending may not', () => {
    expect(canEditPersona(alice, forming, T0)).toBe(true);
    expect(canEditPersona(admin, forming, T0)).toBe(true);
    expect(canEditPersona(sa, forming, T0)).toBe(true);
    expect(canEditPersona(bob, forming, T0)).toBe(false);
    expect(canEditPersona({ ...alice, role: 'pending' }, forming, T0)).toBe(false);
  });

  it('nobody, not even a superadmin, edits a locked or fired agent', () => {
    for (const m of [alice, admin, sa]) {
      expect(canEditPersona(m, forming, later)).toBe(false);
      expect(canEditPersona(m, agent({ status: 'fired' }), T0)).toBe(false);
    }
  });

  it('drafts: creator and admins only', () => {
    const d = agent({ status: 'draft', hiredAt: undefined, lockAt: undefined });
    expect(canEditPersona(alice, d)).toBe(true);
    expect(canEditPersona(admin, d)).toBe(true);
    expect(canEditPersona(bob, d)).toBe(false);
  });
});

describe('using, firing, admin agents, access', () => {
  it('active agents with access "everyone" are usable by members, not pending', () => {
    expect(canUseAgent(bob, agent())).toBe(true);
    expect(canUseAgent(pending, agent())).toBe(false);
    expect(canUseAgent(bob, agent({ status: 'draft' }))).toBe(false);
    expect(canUseAgent(admin, agent({ status: 'fired' }))).toBe(false);
  });

  it('allow-lists restrict members but never admins', () => {
    const restricted = agent({ access: [ID.alice] });
    expect(canUseAgent(alice, restricted)).toBe(true);
    expect(canUseAgent(bob, restricted)).toBe(false);
    expect(canUseAgent(admin, restricted)).toBe(true);
  });

  it('only admins fire, and only active agents', () => {
    expect(canFire(alice, agent())).toBe(false);
    expect(canFire(admin, agent())).toBe(true);
    expect(canFire(sa, agent({ status: 'fired' }))).toBe(false);
    expect(canFire(sa, agent({ status: 'draft' }))).toBe(false);
  });

  it('only superadmins make an agent admin', () => {
    expect(canSetAgentAdmin(admin)).toBe(false);
    expect(canSetAgentAdmin(sa)).toBe(true);
  });

  it('drafts are deletable by their creator or admins, published agents are not', () => {
    const d = agent({ status: 'draft' });
    expect(canDeleteDraft(alice, d)).toBe(true);
    expect(canDeleteDraft(bob, d)).toBe(false);
    expect(canDeleteDraft(admin, d)).toBe(true);
    expect(canDeleteDraft(admin, agent())).toBe(false);
  });

  it('access is managed by the creator or admins', () => {
    expect(canManageAccess(alice, agent())).toBe(true);
    expect(canManageAccess(bob, agent())).toBe(false);
    expect(canManageAccess(admin, agent())).toBe(true);
  });
});

describe('role changes', () => {
  const s = state([sa, admin, alice, bob, pending]);

  it('admins approve pending → member and remove members → pending', () => {
    expect(checkRoleChange(s, admin, pending, 'member')).toEqual({ ok: true });
    expect(checkRoleChange(s, admin, alice, 'pending')).toEqual({ ok: true });
  });

  it('admins cannot grant or remove admin, nor touch superadmins', () => {
    expect(checkRoleChange(s, admin, alice, 'admin').ok).toBe(false);
    expect(checkRoleChange(s, admin, pending, 'admin').ok).toBe(false);
    expect(checkRoleChange(s, admin, sa, 'member').ok).toBe(false);
    expect(checkRoleChange(s, admin, fakeMember(201, 'admin'), 'member').ok).toBe(false);
  });

  it('members and pending people change nothing', () => {
    expect(checkRoleChange(s, alice, pending, 'member').ok).toBe(false);
    expect(checkRoleChange(s, pending, alice, 'pending').ok).toBe(false);
    expect(checkRoleChange(s, undefined, alice, 'pending').ok).toBe(false);
  });

  it('nobody changes their own role, superadmins included', () => {
    expect(checkRoleChange(s, sa, sa, 'admin')).toEqual({ ok: false, reason: "You can't change your own role." });
    expect(checkRoleChange(s, admin, admin, 'superadmin').ok).toBe(false);
  });

  it('superadmins grant and remove admin', () => {
    expect(checkRoleChange(s, sa, alice, 'admin').ok).toBe(true);
    expect(checkRoleChange(s, sa, admin, 'member').ok).toBe(true);
  });

  it('never removes the last superadmin', () => {
    const second = fakeMember(101, 'superadmin');
    expect(checkRoleChange(state([sa, second]), sa, second, 'admin').ok).toBe(true);
    // With only one superadmin, demoting them is refused (they can't be the actor; another superadmin would exist)
    const lone = state([sa, admin]);
    const r = checkRoleChange(lone, { ...fakeMember(102, 'superadmin') }, sa, 'admin');
    expect(r.ok).toBe(false);
  });
});

describe('visibleAgents', () => {
  const agents = [
    agent({ id: 'active' }),
    agent({ id: 'restricted', access: [ID.alice] }),
    agent({ id: 'alice-draft', status: 'draft', createdBy: ID.alice }),
    agent({ id: 'bob-wait', status: 'awaiting_bot', createdBy: ID.bob }),
    agent({ id: 'fired', status: 'fired' }),
  ];
  const s = state([sa, admin, alice, bob, pending], agents);
  const ids = (m: Member) => visibleAgents(s, m).map((a) => a.id).sort();

  it('members see usable active agents and their own drafts; fired agents are hidden', () => {
    expect(ids(alice)).toEqual(['active', 'alice-draft', 'restricted']);
    expect(ids(bob)).toEqual(['active', 'bob-wait']);
  });

  it('admins see everything, including fired agents', () => {
    expect(ids(admin)).toEqual(['active', 'alice-draft', 'bob-wait', 'fired', 'restricted']);
  });

  it('pending people see nothing', () => {
    expect(ids(pending)).toEqual([]);
  });
});
