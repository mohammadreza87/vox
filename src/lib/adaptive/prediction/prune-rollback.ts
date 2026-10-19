/** Local FILE-store rollback preparation. Dry-run by default. Never scans accounts,
 * logs private document contents, touches source memory or resets turn budgets. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { FileAdaptiveStorage } from '../persistence/storage';
import { experienceDocumentSchema } from '../runtime/contracts';
const removedFields = new Set(['reservation', 'policyReceipt', 'authorizationFingerprint', 'requiresImage', 'receiptExpiresAt', 'cancelled', 'superseded', 'contextKey']);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function stripPredictionMetadataForRollback(value: unknown, accountId: string): { document: unknown; records: number; properties: number } {
  if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== accountId || !('experience' in value)) throw new Error('rollback_scope_mismatch');
  const experience = experienceDocumentSchema.parse(value.experience);
  let properties = 0;
  const predictionTurns = experience.predictionTurns.map(turn => Object.fromEntries(Object.entries(turn).filter(([key]) => {
    if (!removedFields.has(key)) return true; properties++; return false;
  })));
  return { document: { ...value, experience: { ...(value.experience as object), predictionTurns } }, records: predictionTurns.length, properties };
}
export async function pruneFilePredictionMetadata(options: { directory: string; accountId: string; apply?: boolean; providersStopped?: boolean; expectedContentSha256?: string }) {
  if (!isAbsolute(options.directory) || !/^telegram-account:[1-9]\d{0,15}$/.test(options.accountId)) throw new Error('rollback_explicit_scope_required');
  const filename = createHash('sha256').update(options.accountId).digest('hex') + '.json';
  const current: unknown = JSON.parse(await readFile(join(options.directory, filename), 'utf8'));
  const preview = stripPredictionMetadataForRollback(current, options.accountId), contentSha256 = hash(current);
  if (!options.apply) return { mode: 'dry-run', contentSha256, records: preview.records, properties: preview.properties };
  if (!options.providersStopped || !options.expectedContentSha256 || !/^[a-f0-9]{64}$/.test(options.expectedContentSha256)) throw new Error('rollback_stop_providers_and_expected_digest_required');
  return new FileAdaptiveStorage(options.directory).transact(options.accountId, document => {
    if (hash(document) !== options.expectedContentSha256) throw new Error('rollback_document_changed');
    const result = stripPredictionMetadataForRollback(document, options.accountId);
    return { document: result.document, result: { mode: 'applied', beforeContentSha256: hash(document), afterContentSha256: hash(result.document), records: result.records, properties: result.properties } };
  });
}
if (process.argv[1]?.endsWith('/prediction/prune-rollback.ts')) {
  const args = process.argv.slice(2), arg = (name: string) => args[args.indexOf(name) + 1];
  const flags = new Set(['--directory', '--account-id', '--expected-content-sha256', '--apply', '--providers-stopped']);
  for (let i = 0; i < args.length; i++) {
    if (!flags.has(args[i])) throw new Error('unknown_rollback_argument');
    if (['--directory', '--account-id', '--expected-content-sha256'].includes(args[i])) { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('missing_rollback_argument'); i++; }
  }
  if (!args.includes('--directory') || !args.includes('--account-id')) throw new Error('rollback_explicit_scope_required');
  pruneFilePredictionMetadata({ directory: arg('--directory'), accountId: arg('--account-id'), apply: args.includes('--apply'), providersStopped: args.includes('--providers-stopped'),
    expectedContentSha256: args.includes('--expected-content-sha256') ? arg('--expected-content-sha256') : undefined }).then(result => console.log(JSON.stringify(result))).catch(() => { console.error('rollback_not_applied'); process.exitCode = 1; });
}
