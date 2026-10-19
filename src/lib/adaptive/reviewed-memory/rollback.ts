import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileAdaptiveStorage } from '../persistence/storage';
import { z } from 'zod';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = z.array(z.object({ id: z.string(), sourceRefs: z.array(z.object({ id: z.string(), revision: z.number().int().positive() }).strict()).min(1).max(8).optional() }).passthrough()).max(300);
/** Remove derived rows, never their authored ancestors or current authority.
 * Acceptance tombstones remain, so an old signed nonce cannot recreate a row. */
export function removeReviewedMemoryForRollback(value: unknown, accountId: string): unknown {
  if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId || !('memories' in value)) throw new Error('rollback_scope_mismatch');
  const memories = rows.parse(value.memories);
  return { ...structuredClone(value), memories: memories.filter(memory => !memory.sourceRefs) };
}
export async function pruneFileReviewedMemory(options: { directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const filename = createHash('sha256').update(options.accountId).digest('hex') + '.json';
  const current: unknown = JSON.parse(await readFile(join(options.directory, filename), 'utf8'));
  const cleaned = removeReviewedMemoryForRollback(current, options.accountId);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: hash(current) !== hash(cleaned) };
  if (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) throw new Error('rollback_stop_producers_and_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, value => {
    if (hash(value) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const document = removeReviewedMemoryForRollback(value, options.accountId);
    return { document, result: { mode: 'applied', contentSha256: hash(document) } };
  });
}
