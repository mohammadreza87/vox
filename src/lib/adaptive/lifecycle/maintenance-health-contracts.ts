/** Browser-safe metadata contract. No stored identifiers or operational authority. */
import { z } from 'zod';
const time = z.number().int().nonnegative().safe();
const unavailableReasons = ['unsupported_store', 'unsafe_path', 'oversized_checkpoint', 'unreadable_checkpoint', 'invalid_checkpoint', 'invalid_clock', 'clock_regressed'] as const;
const checkpoint = z.object({ updatedAt: time, recordedStatus: z.enum(['continued', 'completed', 'failed']),
  checkpointedPages: time, checkpointedAccounts: time, failure: z.literal('sweep_failed').nullable(),
}).strict().superRefine((v, c) => { if ((v.recordedStatus === 'failed') !== (v.failure === 'sweep_failed')) c.addIssue({ code: 'custom', message: 'Invalid checkpoint outcome' }); });
export const maintenanceHealthSchema = z.object({ version: z.literal(1),
  state: z.enum(['not_configured', 'not_started', 'leased', 'continued', 'completed', 'failed', 'busy', 'stale', 'unavailable']),
  observedAt: time.nullable(), checkpoint: checkpoint.nullable(), leaseExpiresAt: time.nullable(),
  reason: z.enum(['health_not_configured', 'checkpoint_locked', 'lease_expired', ...unavailableReasons]).nullable(),
}).strict().superRefine((v, c) => {
  const invalid = () => c.addIssue({ code: 'custom', message: 'Invalid maintenance health combination' });
  if (v.state === 'not_configured') { if (v.observedAt !== null || v.checkpoint !== null || v.leaseExpiresAt !== null || v.reason !== 'health_not_configured') invalid(); return; }
  if (v.state === 'unavailable') {
    if (v.checkpoint !== null || v.leaseExpiresAt !== null || !unavailableReasons.includes(v.reason as typeof unavailableReasons[number]) || (v.reason === 'invalid_clock') !== (v.observedAt === null)) invalid(); return;
  }
  if (v.observedAt === null) { invalid(); return; }
  if (v.state === 'busy' || v.state === 'not_started') { if (v.checkpoint !== null || v.leaseExpiresAt !== null || v.reason !== (v.state === 'busy' ? 'checkpoint_locked' : null)) invalid(); return; }
  if (!v.checkpoint || v.checkpoint.updatedAt > v.observedAt) { invalid(); return; }
  if (v.state === 'leased' || v.state === 'stale') {
    if (v.leaseExpiresAt === null || v.leaseExpiresAt <= v.checkpoint.updatedAt || (v.state === 'leased') !== (v.observedAt < v.leaseExpiresAt) || v.reason !== (v.state === 'stale' ? 'lease_expired' : null)) invalid();
  } else if (v.leaseExpiresAt !== null || v.reason !== null || v.state !== v.checkpoint.recordedStatus) invalid();
});
export type MaintenanceHealth = z.infer<typeof maintenanceHealthSchema>;
export const unconfiguredMaintenanceHealth = (): MaintenanceHealth => ({ version: 1, state: 'not_configured', observedAt: null, checkpoint: null, leaseExpiresAt: null, reason: 'health_not_configured' });
