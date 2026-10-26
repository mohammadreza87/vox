import { z } from 'zod';
import { archiveEventSchema, archiveRetiredOperationSchema, archiveStateSchema } from '../tireh/memory/telegram-archive/contracts';
import { retireArchiveOperation } from '../tireh/memory/telegram-archive/publication';

export const telegramArchiveEntrySchema = z.object({ agentId: z.string().min(1).max(200), space: z.enum(['work', 'personal']),
  enabled: z.boolean(), generation: z.number().int().nonnegative().safe(), clearedAt: z.number().int().nonnegative().safe(),
  authorityStamp: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: archiveStateSchema.optional(), index: z.array(archiveEventSchema).max(32),
  sourceSuppressionVersion: z.literal(1).optional(),
  snapshotPublicationVersion: z.literal(1).optional(), retiredOperation: archiveRetiredOperationSchema.optional(),
}).strict().refine(row => !row.state?.receipts.some(r => r.suppressed) || row.sourceSuppressionVersion === 1,
  'Source suppression requires its current reader version')
  .refine(row => !(row.state?.snapshot || row.state?.publication || row.retiredOperation) || row.snapshotPublicationVersion === 1,
    'Snapshot publication requires its current reader version')
  .refine(row => !row.retiredOperation || row.retiredOperation.scope.agentId === row.agentId && row.retiredOperation.scope.space === row.space,
    'Retired operation requires its current archive scope')
  .refine(row => !row.retiredOperation || !(row.state?.operation || row.state?.publication),
    'Retired effects cannot overlap a new archive operation');
export const telegramArchivesSchema = z.array(telegramArchiveEntrySchema).max(4)
  .refine(rows => new Set(rows.map(r => `${r.space}:${r.agentId}`)).size === rows.length);
export type TelegramArchiveEntry = z.infer<typeof telegramArchiveEntrySchema>;

/** Retain only uncertain external-effect metadata before removing content. An
 * existing receipt wins over repeated reset/disable/expiry attempts. New effect
 * claims are blocked while it exists, so it cannot be silently replaced. */
function retainUnknown(row: TelegramArchiveEntry): void {
  const retired = row.state && retireArchiveOperation(row.state);
  if (retired && !row.retiredOperation) row.retiredOperation = retired;
  if (row.retiredOperation) row.snapshotPublicationVersion = 1;
}

function resetRow(row: TelegramArchiveEntry, now: number, disable = false): void {
  retainUnknown(row);
  row.generation++; row.clearedAt = Math.max(row.clearedAt, now); row.index = [];
  delete row.state; delete row.sourceSuppressionVersion;
  if (!row.retiredOperation) delete row.snapshotPublicationVersion;
  if (disable) row.enabled = false;
}
/** Conservative source barrier: without fact-to-transcript lineage, a correction
 * or forget invalidates the complete recent archive for the affected scope. */
export function resetTelegramArchives(d: { telegramArchives?: TelegramArchiveEntry[] }, now: number, space?: 'work' | 'personal', agentId?: string, disable = false): void {
  for (const row of d.telegramArchives ?? []) if ((!space || row.space === space) && (!agentId || row.agentId === agentId)) {
    resetRow(row, now, disable);
  }
}

/** Reuse the bounded, durable admission ledger as the source tombstone ledger.
 * Unknown lineage must use the conservative complete reset instead. Receipts
 * and the head stay together until a complete reset installs its time barrier. */
export function suppressTelegramArchiveSource(row: TelegramArchiveEntry, logicalId: string): boolean {
  const receipts = row.state?.receipts.filter(r => r.logicalId === logicalId);
  if (!receipts?.length) return false;
  if (receipts.every(r => r.suppressed)) return true;
  row.sourceSuppressionVersion = 1;
  for (const receipt of receipts) receipt.suppressed = true;
  row.generation++;
  row.index = row.index.filter(e => e.logicalId !== logicalId);
  row.state!.pending = row.state!.pending.filter(e => e.logicalId !== logicalId);
  // A source edit fences the publication plan. Preserve known/uncertain effects
  // outside its content state before discarding the stale operation metadata.
  if (row.state!.publication) {
    retainUnknown(row);
    delete row.state!.publication;
    if (!row.state!.snapshot && !row.retiredOperation) delete row.snapshotPublicationVersion;
  }
  // Prepared operations have no external effect. Every later stage retains an
  // explicit unknown receipt, even when no pending text remains. Old writers
  // lose their generation fence; only owner reconciliation releases this op.
  if (row.state!.operation?.stage === 'prepared') delete row.state!.operation;
  else if (row.state!.operation) row.state!.operation.stage = 'unknown';
  row.state!.revision++;
  return true;
}

/** Service-side retained text expires independently of feature activation. The
 * external Telegram files retain their separate, honestly reported purge state. */
export function pruneTelegramArchives(d: {telegramArchives?: TelegramArchiveEntry[]}, now: number): boolean {
  let changed = false;
  for (const row of d.telegramArchives ?? []) {
    const newest = new Map<string, TelegramArchiveEntry['index'][number]>();
    for (const event of row.index) {
      const prior = newest.get(event.logicalId);
      if (!prior || prior.revision < event.revision) newest.set(event.logicalId, event);
    }
    const retained = [...newest.values()].filter(event => event.expiresAt > now);
    if (retained.length !== row.index.length) { row.index = retained; changed = true; }
    if (row.state?.pending.some(event => event.expiresAt <= now)) {
      // An in-flight bundle may reference an expired event. Fence the complete
      // checkpoint lineage rather than splice content beneath a stale writer.
      resetRow(row, now); changed = true;
    }
  }
  return changed;
}
