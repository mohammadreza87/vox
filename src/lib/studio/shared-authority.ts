import { createHash } from 'crypto';
import type { SharedAuthority } from '../adaptive/shared/service';
import type { StudioStorage } from './store';
import type { StudioState } from './types';
import { canUseAgent, visibilityOf } from './permissions';
import { groupId } from './org-bridge';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function epoch(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Studio authority');
  return value;
}
/** Shared participant authority uses the same durable Studio permission facts
 * at acquisition and the configured transport boundary. */
export function sharedAuthorityFromStudioStore(store: StudioStorage): SharedAuthority {
  const committed = () => {
    if (!store.readCommittedForEffect) throw new Error('Committed Studio authority unavailable');
    return store.readCommittedForEffect();
  };
  const agent = (state: StudioState, id: string) => {
    const row = state.agents.find(a => a.id === id);
    return { active: row?.status === 'active', revision: digest(row ? [row.id, row.status, row.createdBy, visibilityOf(row),
      Array.isArray(row.access) ? [...row.access].sort((a,b) => a-b) : row.access,
      [...(row.blocked ?? [])].sort((a,b) => a-b), epoch(row.learningAuthorityRevision)] : null) };
  };
  const member = (state: StudioState, id: number) => {
    const row = state.members.find(m => m.telegramId === id);
    const agents = row ? state.agents.filter(a => canUseAgent(row, a) && !(a.blocked ?? []).includes(id)) : [];
    return { active: !!row && row.role !== 'pending', agentIds: agents.map(a => a.id),
      revision: digest([row ? [row.telegramId, row.role, epoch(row.learningAuthorityRevision)] : null,
        agents.map(a => [a.id, agent(state, a.id).revision]).sort((a,b) => a[0].localeCompare(b[0]))]) };
  };
  const group = (state: StudioState, id: string) => {
    const row = state.groups.find(g => groupId(g.chatId) === id);
    if (!row) return null;
    const memberTelegramIds = [...row.memberIds].sort((a,b) => a-b);
    const hasGuests = row.hasGuests || memberTelegramIds.some(id => !state.members.some(m => m.telegramId === id && m.role !== 'pending'));
    return { memberTelegramIds, hasGuests, revision: digest([id, memberTelegramIds, hasGuests, epoch(row.audienceEpoch)]) };
  };
  return { member: async id => member(await store.read(), id), agent: async id => agent(await store.read(), id), group: async id => group(await store.read(), id),
    memberNow: id => member(committed(), id), agentNow: id => agent(committed(), id), groupNow: id => group(committed(), id) };
}
