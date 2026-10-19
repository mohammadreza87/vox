import type { RelationshipKey, RelationshipState, TurnInput } from '../types';

/** Adapter implemented by the real Studio/gateway wiring and by deterministic tests. */
export interface RelationshipSimulationPort {
  turn(input: TurnInput): Promise<unknown>;
  reconsider(): Promise<unknown>;
  control(key: RelationshipKey, action: 'pause' | 'resume' | 'stop' | 'forget', options?: { until?: Date; sourceIds?: string[] }): Promise<unknown>;
  state(key: RelationshipKey): Promise<RelationshipState>;
  advanceTo(at: Date): void;
}

export type SimulationCommand =
  | { id?: string; op: 'turn'; input: TurnInput }
  | { id?: string; op: 'reconsider' }
  | { id?: string; op: 'advance'; at: string }
  | { id?: string; op: 'control'; key: RelationshipKey; action: 'pause' | 'resume' | 'stop' | 'forget'; until?: string; sourceIds?: string[] }
  | { id?: string; op: 'state'; key: RelationshipKey }
  | { id?: string; op: 'quit' };

export type SimulationResponse = { id?: string; ok: true; op: string; result: unknown } | { id?: string; ok: false; op?: string; error: string };

/** One JSON command in, one JSON response out. Intended for local, synthetic sessions only. */
export async function dispatchSimulationCommand(
  port: RelationshipSimulationPort,
  command: SimulationCommand,
): Promise<SimulationResponse> {
  try {
    switch (command.op) {
      case 'turn': return { id: command.id, ok: true, op: command.op, result: await port.turn(command.input) };
      case 'reconsider': return { id: command.id, ok: true, op: command.op, result: await port.reconsider() };
      case 'advance': {
        const at = new Date(command.at);
        if (!Number.isFinite(at.getTime())) throw new Error('advance.at must be a valid ISO timestamp');
        port.advanceTo(at);
        return { id: command.id, ok: true, op: command.op, result: { now: at.toISOString() } };
      }
      case 'control': return {
        id: command.id, ok: true, op: command.op,
        result: await port.control(command.key, command.action, {
          ...(command.until ? { until: new Date(command.until) } : {}),
          ...(command.sourceIds ? { sourceIds: command.sourceIds } : {}),
        }),
      };
      case 'state': return { id: command.id, ok: true, op: command.op, result: await port.state(command.key) };
      case 'quit': return { id: command.id, ok: true, op: command.op, result: { quit: true } };
    }
  } catch (error) {
    return { id: command.id, ok: false, op: command.op, error: error instanceof Error ? error.message : 'simulation command failed' };
  }
}
