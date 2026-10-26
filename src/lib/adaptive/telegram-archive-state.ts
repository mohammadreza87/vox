import { z } from 'zod';
import { archiveEventSchema, archiveStateSchema } from '../tireh/memory/telegram-archive/contracts';

export const telegramArchiveEntrySchema = z.object({ agentId: z.string().min(1).max(200), space: z.enum(['work', 'personal']),
  enabled: z.boolean(), generation: z.number().int().nonnegative().safe(), clearedAt: z.number().int().nonnegative().safe(),
  authorityStamp: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: archiveStateSchema.optional(), index: z.array(archiveEventSchema).max(32),
}).strict();
export const telegramArchivesSchema = z.array(telegramArchiveEntrySchema).max(4)
  .refine(rows => new Set(rows.map(r => `${r.space}:${r.agentId}`)).size === rows.length);
export type TelegramArchiveEntry = z.infer<typeof telegramArchiveEntrySchema>;
/** Conservative source barrier: without fact-to-transcript lineage, a correction
 * or forget invalidates the complete recent archive for the affected scope. */
export function resetTelegramArchives(d: { telegramArchives?: TelegramArchiveEntry[] }, now: number, space?: 'work' | 'personal', agentId?: string, disable = false): void {
  for (const row of d.telegramArchives ?? []) if ((!space || row.space === space) && (!agentId || row.agentId === agentId)) {
    row.generation++; row.clearedAt = Math.max(row.clearedAt, now); row.index = []; delete row.state;
    if (disable) row.enabled = false;
  }
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
      row.generation++; row.clearedAt = Math.max(row.clearedAt, now); row.index = []; delete row.state; changed = true;
    }
  }
  return changed;
}
