import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileAdaptiveStorage } from '../../persistence/storage';
import { experienceDocumentSchema } from '../../runtime/contracts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Stop all learning producers first. No current explicit choice, Undo, budget
 * count, canonical consent/grant or deletion record is restored or removed. */
export function stripPreferenceLearningForRollback(value: unknown, accountId: string): unknown {
  if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId || !('experience' in value)) throw new Error('rollback_scope_mismatch');
  const experience = experienceDocumentSchema.parse(value.experience);
  delete experience.preferenceLearning;
  for (const turn of experience.predictionTurns) { delete turn.finalFingerprint; delete turn.learningEvidenceId; delete turn.learningReservation; }
  return { ...value, experience };
}
export async function pruneFilePreferenceLearning(options: { directory: string; accountId: string; apply?: boolean; producersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const file = join(options.directory, createHash('sha256').update(options.accountId).digest('hex') + '.json');
  const current: unknown = JSON.parse(await readFile(file, 'utf8')), preview = stripPreferenceLearningForRollback(current, options.accountId);
  if (!options.apply) return { mode: 'dry-run', contentSha256: hash(current), changed: hash(preview) !== hash(current) };
  if (!options.producersStopped || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256 ?? '')) throw new Error('rollback_stop_producers_and_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, document => {
    if (hash(document) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const cleaned = stripPreferenceLearningForRollback(document, options.accountId);
    return { document: cleaned, result: { mode: 'applied', afterContentSha256: hash(cleaned) } };
  });
}
if (process.argv[1]?.endsWith('/learning/rollback.ts')) {
  const args = process.argv.slice(2), values = new Set(['--directory', '--account-id', '--expected-content-sha256']), flags = new Set([...values, '--apply', '--producers-stopped']);
  for (let i = 0; i < args.length; i++) { if (!flags.has(args[i])) throw new Error('unknown_rollback_argument'); if (values.has(args[i])) { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('missing_rollback_argument'); i++; } }
  const arg = (name: string) => args[args.indexOf(name) + 1];
  if (!args.includes('--directory') || !args.includes('--account-id')) throw new Error('rollback_explicit_scope_required');
  pruneFilePreferenceLearning({ directory: arg('--directory'), accountId: arg('--account-id'), apply: args.includes('--apply'), producersStopped: args.includes('--producers-stopped'), expectedContentSha256: args.includes('--expected-content-sha256') ? arg('--expected-content-sha256') : undefined })
    .then(result => console.log(JSON.stringify(result))).catch(() => { console.error('rollback_not_applied'); process.exitCode = 1; });
}
