import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileAdaptiveStorage } from '../persistence/storage';
import { observerDocumentSchema } from './contracts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Before restoring ee800d9: stop new producers, preview exact single account,
 * CAS apply under the file writer lock. Original source memory is untouched. */
export function stripObserverTelemetryForRollback(value: unknown, accountId: string): unknown {
  if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId) throw new Error('rollback_scope_mismatch');
  if (!('observer' in value)) return structuredClone(value);
  const observer = observerDocumentSchema.parse(value.observer);
  const events = observer.events.filter(event => !event.outcome.startsWith('task_') && event.operation !== 'prediction').map(event => {
    const original = { ...event }; delete original.telemetry; delete original.operation; return original;
  });
  // Old projections rebuild from preserved original events; no invented history.
  return { ...value, observer: { schemaVersion: 1, events, projections: [] } };
}
export async function pruneFileObserverTelemetry(options: { directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const filename = createHash('sha256').update(options.accountId).digest('hex') + '.json';
  const current: unknown = JSON.parse(await readFile(join(options.directory, filename), 'utf8'));
  const preview = stripObserverTelemetryForRollback(current, options.accountId);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: hash(preview) !== hash(current) };
  if (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) throw new Error('rollback_stop_producers_and_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, document => {
    if (hash(document) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const cleaned = stripObserverTelemetryForRollback(document, options.accountId);
    return { document: cleaned, result: { mode: 'applied', afterContentSha256: hash(cleaned) } };
  });
}
