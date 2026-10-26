/** Explicit offline FILE downgrade preparation. Never restores old authority. */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { telegramArchivesSchema } from './telegram-archive-state';
import { FileAdaptiveStorage } from './persistence/storage';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function stripTelegramArchiveForRollback(value: unknown, accountId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('accountId' in value) || value.accountId !== accountId) {
    throw new Error('archive_rollback_scope_mismatch');
  }
  const document = structuredClone(value) as Record<string, unknown>;
  const rows = document.telegramArchives === undefined ? [] : telegramArchivesSchema.parse(document.telegramArchives);
  // A downgrade must not silently discard an accepted event or an uncertain send.
  if (rows.some(row => row.state && (row.state.pending.length || row.state.operation))) {
    throw new Error('archive_rollback_pending_work');
  }
  const changed = Object.hasOwn(document, 'telegramArchives');
  delete document.telegramArchives;
  return { document, changed, scopes: rows.length };
}

export async function rollbackFileTelegramArchive(options: {
  directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string;
}) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('archive_rollback_explicit_scope_required');
  const root = await lstat(options.directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('archive_rollback_invalid_store');
  const path = join(options.directory, createHash('sha256').update(options.accountId).digest('hex') + '.json');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 700_000) throw new Error('archive_rollback_invalid_file');
  const current: unknown = JSON.parse(await readFile(path, 'utf8'));
  const preview = stripTelegramArchiveForRollback(current, options.accountId);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: preview.changed, scopes: preview.scopes };
  if (!options.producersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) {
    throw new Error('archive_rollback_stop_producers_and_digest_required');
  }
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, value => {
    if (hash(value) !== options.expectedContentSha256) throw new Error('archive_rollback_document_changed');
    const result = stripTelegramArchiveForRollback(value, options.accountId);
    return { document: result.document, result: { mode: 'applied', contentSha256: hash(result.document), changed: result.changed, scopes: result.scopes } };
  });
}
