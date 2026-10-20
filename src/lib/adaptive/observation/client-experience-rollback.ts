import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileAdaptiveStorage } from '../persistence/storage';
import { observerDocumentSchema } from './contracts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Restore the 7f0b0ef observer parser using CURRENT account state. No snapshots,
 * source-memory rollback, tombstone removal, or consent restoration. */
export function stripClientExperienceForRollback(value: unknown, accountId: string): unknown {
  if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId) throw new Error('rollback_scope_mismatch');
  if (!('observer' in value)) return structuredClone(value);
  const observer = observerDocumentSchema.parse(value.observer);
  return { ...value, observer: { schemaVersion: 1, events: observer.events.filter(e => e.outcome !== 'text_rendered'), projections: [] } };
}
export async function pruneFileClientExperience(options: { directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const filename = createHash('sha256').update(options.accountId).digest('hex') + '.json';
  const current: unknown = JSON.parse(await readFile(join(options.directory, filename), 'utf8'));
  const preview = stripClientExperienceForRollback(current, options.accountId);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: hash(preview) !== hash(current) };
  if (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) throw new Error('rollback_stop_producers_and_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, document => {
    if (hash(document) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const cleaned = stripClientExperienceForRollback(document, options.accountId);
    return { document: cleaned, result: { mode: 'applied', afterContentSha256: hash(cleaned) } };
  });
}
