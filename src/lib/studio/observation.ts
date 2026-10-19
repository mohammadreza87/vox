import { randomUUID } from 'crypto';
import type { SpaceKind } from '../adaptive/persistence/repository';
import type { ServerObservationInput } from '../adaptive/observation/contracts';
import { canUseAgent } from './permissions';
import type { Studio } from './service';

export async function observationAgents(studio: Studio, telegramId: number): Promise<string[]> {
  const state = await studio.deps.store.read();
  const member = state.members.find(m => m.telegramId === telegramId);
  return state.agents.filter(a => canUseAgent(member, a) && !(a.blocked ?? []).includes(telegramId)).map(a => a.id).sort();
}

/** Optional measurements cannot break conversation delivery. Authority is checked
 * before work starts and again at append; no content or exception is retained. */
export async function beginObservation(studio: Studio, telegramId: number, agentId: string, space: SpaceKind,
  channel: ServerObservationInput['channel'], turnId: string = randomUUID()) {
  const started = Date.now();
  const observer = studio.deps.observer;
  const receipt = observer ? await (async () => (await observationAgents(studio, telegramId)).includes(agentId)
    ? observer.authorize(telegramId, space, agentId) : null)().catch(() => null) : null;
  let revision = 0;
  return async (outcome: ServerObservationInput['outcome']): Promise<string | undefined> => {
    if (!observer || !receipt) return undefined;
    try {
      if (!(await observationAgents(studio, telegramId)).includes(agentId)) return undefined;
      const result = await observer.recordServer(telegramId, { eventId: turnId, turnId, agentId, space,
        revision: ++revision, channel, kind: 'response', outcome, durationMs: Math.min(86_400_000, Math.max(0, Date.now() - started)), policyReceipt: receipt });
      return result.recorded || result.duplicate ? turnId : undefined;
    } catch { return undefined; }
  };
}
