/**
 * Authority rules for Vox Studio. Pure functions, enforced by every API route.
 *
 *  owner       everything, including making other owners; founders come from
 *              STUDIO_SUPERADMIN_IDS and can't be demoted from the app
 *  superadmin  everything except touching owners; creates admins (human or AI)
 *  admin       approves people, fires agents, edits any forming agent
 *  member      uses agents, spawns agents, edits agents they created while forming
 *  pending     opened the Mini App but not yet approved; can do nothing
 *
 * Personality is editable only while an agent is forming (7 days after its
 * bot is created). After that it is locked for good: change means fire & re-hire.
 * Voice and skills follow the same lock and belong to the creator alone (canShapeIdentity).
 * Look and photo are cosmetic, so they stay editable after the lock.
 */

import type { Agent, AgentVisibility, Member, Role, StudioState } from './types';

const RANK: Record<Role, number> = { pending: 0, member: 1, admin: 2, superadmin: 3, owner: 4 };

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

export function visibilityOf(agent: Agent): AgentVisibility {
  return agent.visibility ?? (agent.access === 'everyone' ? 'org' : 'private');
}

/** May this member use the agent in Studio and in direct messages? */
export function canUseAgent(member: Member | undefined, agent: Agent): boolean {
  if (!atLeast(member, 'member') || agent.status !== 'active') return false;
  if (visibilityOf(agent) !== 'private' || atLeast(member, 'admin') || agent.createdBy === member!.telegramId) return true;
  return Array.isArray(agent.access) && agent.access.includes(member!.telegramId);
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

/**
 * Look and profile photo: the creator or an admin, for any agent that isn't
 * fired. Not lock-gated: the lock freezes personality only. To lock them too, return
 * canEditPersona(member, agent) here.
 */
export function canEditLook(member: Member | undefined, agent: Agent): boolean {
  if (!atLeast(member, 'member') || agent.status === 'fired') return false;
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

/**
 * Changing how an agent works for everyone (who can talk, live web, groups, Main Mini App):
 * a manager, while the agent isn't retired. Reading those settings stays canManageAccess.
 */
export function canManageSettings(member: Member | undefined, agent: Agent): boolean {
  return agent.status !== 'fired' && canManageAccess(member, agent);
}

/**
 * Voice and skills shape who an agent is, so only its creator shapes them, and only while it
 * forms: as a draft, while its bot is being made, and in the 7 days after hiring. Admins and
 * superadmins don't get this. Once the lock passes the agent is formed and keeps learning from
 * conversations, but its voice and skills never change again.
 */
export function canShapeIdentity(member: Member | undefined, agent: Agent, now = new Date()): boolean {
  if (!atLeast(member, 'member') || agent.createdBy !== member!.telegramId) return false;
  if (agent.status === 'draft' || agent.status === 'awaiting_bot') return true;
  return agent.status === 'active' && !isLocked(agent, now);
}

/** Whole days left to shape an active agent, rounded up (null outside the forming period). */
export function formingDaysLeft(agent: Agent, now = new Date()): number | null {
  if (agent.status !== 'active' || !agent.lockAt || isLocked(agent, now)) return null;
  return Math.max(1, Math.ceil((new Date(agent.lockAt).getTime() - now.getTime()) / 86_400_000));
}

export type RoleChangeResult = { ok: true } | { ok: false; reason: string };

/**
 * Who may move whom to which role.
 *  - Owners: anything, except removing the last owner.
 *  - Superadmins: grant up to superadmin; never make or touch owners.
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

  if (actor.role === 'superadmin' && (target.role === 'owner' || next === 'owner')) {
    return { ok: false, reason: 'Only an owner can make or change owners.' };
  }
  if (target.role === 'owner' && next !== 'owner' && state.members.filter((m) => m.role === 'owner').length <= 1) {
    return { ok: false, reason: 'HOOR needs at least one owner. Make someone else an owner first.' };
  }
  const leaders = state.members.filter((m) => atLeast(m, 'superadmin')).length;
  if (atLeast(target, 'superadmin') && RANK[next] < RANK.superadmin && leaders <= 1) {
    return { ok: false, reason: 'HOOR needs at least one superadmin. Promote someone else first.' };
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
