import type { RelationshipKey, TurnInput } from '../types';
import type { RelationshipSimulationPort } from './protocol';
import type { RelationshipScenario, ScenarioEvent } from './scenario';

export type ReplayEvidence = { index: number; day: number; kind: string; result?: unknown; hook?: unknown };
export type ReplayHooks = { event?(event: ScenarioEvent, index: number): Promise<unknown> | unknown };

function eventKey(scenario: RelationshipScenario, event: ScenarioEvent): RelationshipKey | null {
  const personaId = scenario.relationship.agentId;
  if (event.kind === 'group_message' && typeof event.groupId === 'string') {
    return { personaId, chatKey: event.groupId, audience: { kind: 'group', groupId: event.groupId } };
  }
  if (event.persona && scenario.personas.some((p) => p.id === event.persona)) {
    return { personaId, chatKey: `${event.persona}-private`, audience: { kind: 'private', personId: event.persona } };
  }
  return null;
}

function toTurn(scenario: RelationshipScenario, event: ScenarioEvent, index: number, at: Date): TurnInput | null {
  if (!['message', 'group_message', 'correction'].includes(event.kind) || typeof event.text !== 'string') return null;
  const key = eventKey(scenario, event);
  if (!key) return null;
  return {
    ...key,
    eventId: `${scenario.id}:${String(index).padStart(4, '0')}`,
    speakerId: typeof event.speaker === 'string' ? event.speaker : event.persona!,
    text: event.text,
    source: 'telegram',
    at,
  };
}

/** Replays the complete ordered timeline through an adapter; non-turn events go to hooks. */
export async function replayScenario(scenario: RelationshipScenario, port: RelationshipSimulationPort, hooks: ReplayHooks = {}): Promise<ReplayEvidence[]> {
  const evidence: ReplayEvidence[] = [];
  for (const [index, event] of scenario.events.entries()) {
    const [hour, minute] = event.time.split(':').map(Number);
    const at = new Date(Date.UTC(2026, 9, 1 + event.day - 1, hour, minute));
    port.advanceTo(at);
    const turn = toTurn(scenario, event, index, at);
    if (turn) evidence.push({ index, day: event.day, kind: event.kind, result: await port.turn(turn) });
    else if (event.kind === 'reconsider') evidence.push({ index, day: event.day, kind: event.kind, result: await port.reconsider() });
    else evidence.push({ index, day: event.day, kind: event.kind, hook: await hooks.event?.(event, index) });
  }
  return evidence;
}
