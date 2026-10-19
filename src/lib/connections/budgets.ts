import { z } from 'zod';
import type { AdaptiveStorage } from '../adaptive/persistence/storage';
import { digest } from './repository';
import { ConnectionsError } from './errors';

const reservation = z.object({ id: z.string().length(64), units: z.number().int().positive(), kind: z.enum(['model_tokens', 'tool_calls']), at: z.number().int() }).strict();
const document = z.object({ schemaVersion: z.literal(1), key: z.string().length(64), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modelTokensReserved: z.number().int().nonnegative(), toolCallsReserved: z.number().int().nonnegative(), reservations: z.array(reservation).max(5000) }).strict();
/** Pessimistic durable reservation: failed/uncertain calls still count. Units are
 * documented input-byte + maximum-output-token ceilings, not fabricated dollar
 * estimates. A deployment must configure a positive ceiling to use paid models. */
export class ConnectionsBudgetLedger {
  constructor(private readonly storage: AdaptiveStorage, private readonly now: () => number = Date.now) {}
  async reserve(input: { accountId: string; space: 'work' | 'personal'; providerId: string; requestId: string;
    kind: 'model_tokens' | 'tool_calls'; units: number; ceiling: number }): Promise<void> {
    if (!Number.isSafeInteger(input.units) || input.units < 1 || !Number.isSafeInteger(input.ceiling) || input.ceiling < 1)
      throw new ConnectionsError(403, 'budget_not_configured');
    const at = this.now(); const day = new Date(at).toISOString().slice(0, 10);
    const key = digest([input.accountId, input.space, input.providerId, day]);
    const id = digest([input.requestId, input.kind]);
    await this.storage.transact(key, raw => {
      const value = raw === null ? { schemaVersion: 1 as const, key, day, modelTokensReserved: 0, toolCallsReserved: 0, reservations: [] as z.infer<typeof reservation>[] } : document.parse(raw);
      if (value.key !== key || value.day !== day) throw new ConnectionsError(503, 'budget_partition_invalid');
      const existing = value.reservations.find(row => row.id === id);
      // A reservation is consumed once, including failed/unknown transport. A
      // duplicate task cannot spend again under the same reservation identifier.
      if (existing) throw new ConnectionsError(409, 'budget_reservation_replayed');
      const field = input.kind === 'model_tokens' ? 'modelTokensReserved' : 'toolCallsReserved';
      if (value[field] + input.units > input.ceiling || value.reservations.length >= 5000) throw new ConnectionsError(429, 'budget_exhausted');
      value[field] += input.units; value.reservations.push({ id, kind: input.kind, units: input.units, at });
      document.parse(value);
      return { document: value, result: undefined };
    });
  }
}
