import type { Agent, AuditEntry, Member } from './types';

/**
 * An agent's change history for the people who manage it (Settings v2). Audit rows are a whitelist: only known
 * actions survive, and each detail is mapped to a fixed vocabulary or dropped. Free text (a fire reason), Telegram
 * ids (unblock), raw JSON and names never leave here; who did it is a role, never a person.
 */
export type HistoryActor = 'you' | 'creator' | 'admin' | 'member' | 'agent' | 'vox';
export type HistoryAction = 'draft' | 'hired' | 'token' | 'skills' | 'voice' | 'live-web' | 'main-mini-app' | 'group-behavior' | 'visibility' | 'access'
  | 'unblock' | 'admin-grant' | 'admin-revoke' | 'fired' | 'memory-inherit' | 'channel-post';
export interface HistoryRow { at: string; actor: HistoryActor; action: HistoryAction; detail?: string }

export const HISTORY_MAX = 100;

const ON_OFF = new Set(['on', 'off']);
const VOICE = new Set(['presentation', 'design', 'default', 'library']);
const VISIBILITY = new Set(['private', 'org', 'public']);
const PARTICIPATION = new Set(['mentions', 'balanced', 'active']);
const POLICY = new Set(['transfer', 'archive', 'delete']);
const POST = new Set(['silent', 'notify']);
const oneOf = (set: Set<string>) => (d?: string) => d && set.has(d) ? d : undefined;
const none = () => undefined;

/** action → [public name, detail scrubber]. Anything not listed is dropped. */
const ACTIONS: Record<string, [HistoryAction, (detail?: string) => string | undefined]> = {
  'agent.draft': ['draft', none],
  'agent.hired': ['hired', none],
  'agent.token': ['token', none],
  'agent.skills': ['skills', d => d && /^\d{1,3}$/.test(d) ? String(Number(d)) : undefined],
  'agent.voice': ['voice', oneOf(VOICE)],
  'agent.live-web': ['live-web', oneOf(ON_OFF)],
  'agent.main-mini-app': ['main-mini-app', oneOf(ON_OFF)],
  'agent.group-behavior': ['group-behavior', d => {
    try {
      const v = JSON.parse(d ?? '') as { participation?: unknown; remember?: unknown };
      return typeof v.participation === 'string' && PARTICIPATION.has(v.participation) && typeof v.remember === 'boolean' ? `${v.participation}:${v.remember ? 'remember' : 'forget'}` : undefined;
    } catch { return undefined; }
  }],
  'agent.visibility': ['visibility', oneOf(VISIBILITY)],
  'agent.access': ['access', d => d === 'everyone' ? d : d && /^people:\d{1,5}$/.test(d) ? `people:${Number(d.slice(7))}` : undefined],
  'agent.unblock': ['unblock', none],
  'agent.admin.grant': ['admin-grant', none],
  'agent.admin.revoke': ['admin-revoke', none],
  'agent.fired': ['fired', d => oneOf(POLICY)((d ?? '').split(':')[0])],
  'memory.inherit': ['memory-inherit', none],
  'channel.post': ['channel-post', oneOf(POST)],
};

function actorRole(actor: AuditEntry['actor'], viewerId: number, agent: Agent, members: readonly Member[]): HistoryActor {
  if (actor === 'system') return 'vox';
  if (actor === agent.id) return 'agent';
  if (typeof actor !== 'number') return 'vox';
  if (actor === viewerId) return 'you';
  if (actor === agent.createdBy) return 'creator';
  const role = members.find(m => m.telegramId === actor)?.role;
  return role === 'admin' || role === 'owner' || role === 'superadmin' ? 'admin' : 'member';
}

/** This agent's rows (target = its id), newest first, scrubbed, at most `limit` (≤ HISTORY_MAX). Pure. */
export function scrubHistory(rows: readonly AuditEntry[], o: { viewerId: number; agent: Agent; members: readonly Member[]; limit?: number }): HistoryRow[] {
  const limit = Math.min(Math.max(1, o.limit ?? 50), HISTORY_MAX);
  const out: HistoryRow[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const row = rows[i];
    if (row.target !== o.agent.id) continue;
    const known = ACTIONS[row.action];
    if (!known || typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at))) continue;
    const detail = known[1](row.detail);
    out.push({ at: new Date(row.at).toISOString(), actor: actorRole(row.actor, o.viewerId, o.agent, o.members), action: known[0], ...(detail ? { detail } : {}) });
  }
  // Stored order is append order; a clock step back must not reorder what a manager reads.
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
