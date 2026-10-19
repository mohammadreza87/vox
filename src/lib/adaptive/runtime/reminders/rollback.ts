/** Offline rollback projection only. Stop every scheduler before applying, retain
 * a protected copy of the original ledger, and migrate the rest of the aggregate
 * with its owning subsystem. This never sends or re-arms a reminder. */
export function removeReminderDeliveryForRollback<T>(document: T): T {
  const copy = structuredClone(document);
  if (!copy || typeof copy !== 'object' || !('experience' in copy) || !copy.experience || typeof copy.experience !== 'object') return copy;
  const experience = copy.experience as { reminderDelivery?: unknown; inbox?: unknown[] };
  delete experience.reminderDelivery;
  for (const item of experience.inbox ?? []) if (item && typeof item === 'object' && 'delivery' in item) delete item.delivery;
  return copy;
}

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileAdaptiveStorage } from '../../persistence/storage';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Explicit single-account CAS migration. Defaults to content-free dry run. */
export async function pruneFileReminderDelivery(options: { directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const filename = createHash('sha256').update(options.accountId).digest('hex') + '.json';
  const current: unknown = JSON.parse(await readFile(join(options.directory, filename), 'utf8'));
  if (!current || typeof current !== 'object' || !('accountId' in current) || current.accountId !== options.accountId) throw new Error('rollback_scope_mismatch');
  const preview = removeReminderDeliveryForRollback(current);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: hash(preview) !== hash(current) };
  if (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) throw new Error('rollback_stop_producers_and_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, document => {
    if (hash(document) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const cleaned = removeReminderDeliveryForRollback(document);
    return { document: cleaned, result: { mode: 'applied', afterContentSha256: hash(cleaned) } };
  });
}
