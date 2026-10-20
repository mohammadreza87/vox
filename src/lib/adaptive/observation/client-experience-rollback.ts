import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { FileAdaptiveStorage, type AdaptiveStorage } from '../persistence/storage';
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
export interface ClientExperienceRollbackOptions { accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }
/** Exact-account CAS is evaluated inside the supplied adapter's canonical writer
 * transaction. Prepared SQLite/FILEv2 retain their existing schema/control/store
 * identity fences and rebuild native projections from current canonical state. */
export async function pruneClientExperience(storage: AdaptiveStorage, options: ClientExperienceRollbackOptions) {
  if (!/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  if (options.apply && (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256))) throw new Error('rollback_stop_producers_and_digest_required');
  if (!options.apply) {
    const snapshot = storage.readCommittedForEffect?.(options.accountId);
    if (snapshot?.status !== 'ready') throw new Error('rollback_preview_unavailable');
    const cleaned = stripClientExperienceForRollback(snapshot.document, options.accountId);
    return { mode: 'dry-run', contentSha256: hash(snapshot.document), changed: hash(cleaned) !== hash(snapshot.document) };
  }
  await storage.transact(options.accountId, current => {
    const cleaned = stripClientExperienceForRollback(current, options.accountId);
    if (hash(current) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    return { document: cleaned, result: undefined };
  });
  const after = storage.readCommittedForEffect?.(options.accountId);
  if (after?.status !== 'ready') throw new Error('rollback_result_unavailable');
  return { mode: 'applied', afterContentSha256: hash(after.document) };
}
export async function pruneFileClientExperience(options: ClientExperienceRollbackOptions & { directory: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  // Preview is read-only; apply rechecks the digest under the writer lock.
  return pruneClientExperience(new FileAdaptiveStorage(options.directory), options);
}
