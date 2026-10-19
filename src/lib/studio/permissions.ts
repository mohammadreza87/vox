/**
 * Authority rules for Vox Studio. Pure functions, enforced by every API route.
 *
 *  superadmin  everything; the only role that can create admins (human or AI)
 *  admin       approves people, fires agents, edits any forming agent
 *  member      uses agents, spawns agents, edits agents they created while forming
 *  pending     opened the Mini App but not yet approved; can do nothing
 *
 * Personality is editable only while an agent is forming (7 days after its
 * bot is created). After that it is locked for good: change means fire & re-hire.
 */

import type { Agent, Member, Role, StudioState } from './types';

const RANK: Record<Role, number> = { pending: 0, member: 1, admin: 2, superadmin: 3 };

export function atLeast(member: Member | undefined, role: Role): boolean {
  return !!member && RANK[member.role] >= RANK[role];
}

export function isLocked(agent: Agent, now = new Date()): boolean {
  if (agent.status !== 'active' || !agent.lockAt) return false;
  return now.getTime() >= new Date(agent.lockAt).getTime();
}

export function formingDay(agent: Agent, now = new Date()): number | null {
  if (agent.status !== 'active' || !agent.hiredAt || isLocked(agent, now)) return null;
  const days = (now.getTime() - new Date(agent.hiredAt).getTime()) / 86_400_000;
  return Math.min(7, Math.floor(days) + 1);
}

export function canUseAgent(member: Member | undefined, agent: Agent): boolean {
  if (!atLeast(member, 'member') || agent.status !== 'active') return false;
  return agent.access === 'everyone' || agent.access.includes(member!.telegramId) || atLeast(member, 'admin');
}

export function canSpawn(member: Member | undefined): boolean {
  return atLeast(member, 'member');
}

/** Drafts can be edited by their creator; forming agents by creator or admins. */
export function canEditPersona(member: Member | undefined, agent: Agent, now = new Date()): boolean {
  if (!atLeast(member, 'member')) return false;
  if (agent.status === 'fired' || isLocked(agent, now)) return false;
  if (agent.status === 'draft' || agent.status === 'awaiting_bot') {
    return agent.createdBy === member!.telegramId || atLeast(member, 'admin');
  }
  return agent.createdBy === member!.telegramId || atLeast(member, 'admin');
}

export function canFire(member: Member | undefined, agent: Agent): boolean {
  return atLeast(member, 'admin') && agent.status === 'active';
}

export function canDeleteDraft(member: Member | undefined, agent: Agent): boolean {
  return (agent.status === 'draft' || agent.status === 'awaiting_bot') &&
    (agent.createdBy === member?.telegramId || atLeast(member, 'admin'));
}

export function canSetAgentAdmin(member: Member | undefined): boolean {
  return atLeast(member, 'superadmin');
}

export function canManageAccess(member: Member | undefined, agent: Agent): boolean {
  return atLeast(member, 'admin') || agent.createdBy === member?.telegramId;
}

export type RoleChangeResult = { ok: true } | { ok: false; reason: string };

/**
 * Who may move whom to which role.
 *  - Superadmins: anything, except removing the last superadmin.
 *  - Admins: approve pending → member, or remove members (→ pending). Never touch admins.
 *  - Nobody changes their own role.
 */
export function checkRoleChange(
  state: StudioState,
  actor: Member | undefined,
  target: Member,
  next: Role
): RoleChangeResult {
  if (!actor || !atLeast(actor, 'admin')) return { ok: false, reason: 'Only admins can change roles.' };
  if (actor.telegramId === target.telegramId) return { ok: false, reason: "You can't change your own role." };
  if (target.role === next) return { ok: true };

  if (actor.role === 'admin') {
    const allowed = (target.role === 'pending' && next === 'member') || (target.role === 'member' && next === 'pending');
    return allowed ? { ok: true } : { ok: false, reason: 'Only a superadmin can grant or remove admin rights.' };
  }

  if (target.role === 'superadmin' && next !== 'superadmin') {
    const supers = state.members.filter((m) => m.role === 'superadmin').length;
    if (supers <= 1) return { ok: false, reason: 'HOOR needs at least one superadmin. Promote someone else first.' };
  }
  return { ok: true };
}

export function visibleAgents(state: StudioState, member: Member | undefined): Agent[] {
  if (!atLeast(member, 'member')) return [];
  return state.agents.filter((a) => {
    if (a.status === 'fired') return atLeast(member, 'admin');
    if (a.status === 'draft' || a.status === 'awaiting_bot') return a.createdBy === member!.telegramId || atLeast(member, 'admin');
    return canUseAgent(member, a);
  });
}
