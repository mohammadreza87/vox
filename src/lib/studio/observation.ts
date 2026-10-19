import { TurnTrace } from '../adaptive/observation/trace';
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
  channel: ServerObservationInput['channel'], turnId: string = randomUUID(), options: { operation?: 'conversation' | 'prediction' } = {}) {
  const started = Date.now();
  const observer = studio.deps.observer;
  const receipt = observer ? await (async () => (await observationAgents(studio, telegramId)).includes(agentId)
    ? observer.authorize(telegramId, space, agentId) : null)().catch(() => null) : null;
  let revision = 0;
  const trace = new TurnTrace(!!receipt);
  const finish = async (outcome: ServerObservationInput['outcome']): Promise<string | undefined> => {
    if (!observer || !receipt) return undefined;
    try {
      if (!(await observationAgents(studio, telegramId)).includes(agentId)) { trace.clear(); return undefined; }
      const result = await observer.recordServer(telegramId, { eventId: turnId, turnId, agentId, space,
        revision: ++revision, channel, ...(options.operation ? { operation: options.operation } : {}), kind: 'response', outcome, durationMs: Math.min(86_400_000, Math.max(0, Date.now() - started)), policyReceipt: receipt, ...(trace.snapshot() ? { telemetry: trace.snapshot() } : {}) });
      if (!result.recorded && !result.duplicate) trace.clear();
      return result.recorded || result.duplicate ? turnId : undefined;
    } catch { return undefined; }
  };
  return Object.assign(finish, { run: <T>(fn: () => Promise<T>) => trace.run(fn) });
}

export function observationCancelled(error: unknown): boolean {
  try { return error instanceof Error && ['AbortError', 'LLMAuthorizationError'].includes(error.name); } catch { return false; }
}
