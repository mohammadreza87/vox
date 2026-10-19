import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { FileAdaptiveStorage } from '../persistence/storage';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = z.array(z.object({ id: z.string(), origin: z.literal('user_reviewed_claim').optional() }).passthrough()).max(300);
/** Accepted notes remain the user's notes on downgrade. Strip only the additive
 * label; never remove text, descendants, current rights or replay tombstones. */
export function stripMessageMemoryMetadata(value: unknown, accountId: string): unknown {
  if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId || !('memories' in value)) throw new Error('rollback_scope_mismatch');
  rows.parse(value.memories);
  const copy = structuredClone(value) as { memories: Array<{ origin?: string }> };
  for (const row of copy.memories) delete row.origin;
  return copy;
}
export async function rollbackFileMessageMemory(options: { directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const file = join(options.directory, createHash('sha256').update(options.accountId).digest('hex') + '.json');
  const current: unknown = JSON.parse(await readFile(file, 'utf8')), cleaned = stripMessageMemoryMetadata(current, options.accountId);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: hash(current) !== hash(cleaned) };
  if (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) throw new Error('rollback_stop_producers_and_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, value => {
    if (hash(value) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const document = stripMessageMemoryMetadata(value, options.accountId);
    return { document, result: { mode: 'applied', contentSha256: hash(document) } };
  });
}
