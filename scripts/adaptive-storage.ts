#!/usr/bin/env node
/** Explicit local administration only. No default command/root/format, no
 * activation, provider requests, feature grants or migration-time restore. */
import { resolve } from 'path';
import { prepareFileAuthorityAdaptiveStorage, prepareProductPauseAdaptiveStorage, prepareRightsUseHoldsAdaptiveStorage, migrateAdaptiveStorage, inspectManagedTransition, finalizeManagedTransition, recoverManagedReadyStorage, abortPreparedManagedTransition } from '../src/lib/adaptive/persistence/indexed/migration';
import { rollbackAdaptiveStorage } from '../src/lib/adaptive/persistence/indexed/rollback';
import { IndexedStorageError } from '../src/lib/adaptive/persistence/indexed/contracts';
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const allowed = new Set(['--root', '--quiesced', '--transition-id', '--source-digest', '--reclaim-dead-lease', '--format', '--incarnation', '--generation']);
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (!allowed.has(flag) || flags.has(flag)) throw new IndexedStorageError('invalid_scope');
    if (flag === '--quiesced' || flag === '--reclaim-dead-lease') flags.set(flag, true);
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new IndexedStorageError('invalid_scope'); flags.set(flag, value); }
  }
  const requested = flags.get('--root'); if (typeof requested !== 'string') throw new IndexedStorageError('invalid_scope'); const root = resolve(requested);
  if (command === 'inspect') { if (flags.size !== 1) throw new IndexedStorageError('invalid_scope'); console.log(JSON.stringify(inspectManagedTransition(root))); return; }
  if (flags.get('--quiesced') !== true) throw new IndexedStorageError('invalid_scope');
  if (command === 'prepare-file-authority') {
    if (flags.size !== 2) throw new IndexedStorageError('invalid_scope');
    console.log(JSON.stringify(await prepareFileAuthorityAdaptiveStorage(root, { quiesced: true }))); return;
  }
  if (command === 'prepare-product-pause' || command === 'prepare-rights-use-holds') {
    const format = flags.get('--format');
    if (flags.size !== 3 || !['sqlite-v1', 'file-v2'].includes(String(format))) throw new IndexedStorageError('invalid_scope');
    const prepare = command === 'prepare-rights-use-holds' ? prepareRightsUseHoldsAdaptiveStorage : prepareProductPauseAdaptiveStorage;
    console.log(JSON.stringify(await prepare(root, format as 'sqlite-v1' | 'file-v2', { quiesced: true }))); return;
  }
  if (command === 'migrate' || command === 'rollback') {
    if (flags.size !== 2) throw new IndexedStorageError('invalid_scope');
    console.log(JSON.stringify(await (command === 'migrate' ? migrateAdaptiveStorage : rollbackAdaptiveStorage)(root, { quiesced: true }))); return;
  }
  if (command === 'recover-ready') {
    const format = flags.get('--format'), incarnation = flags.get('--incarnation'), generation = Number(flags.get('--generation'));
    if (flags.size !== 6 || !['sqlite-v1', 'file-v2'].includes(String(format)) || typeof incarnation !== 'string' ||
        !Number.isSafeInteger(generation) || generation < 1 || flags.get('--reclaim-dead-lease') !== true) throw new IndexedStorageError('invalid_scope');
    console.log(JSON.stringify(await recoverManagedReadyStorage(root, { quiesced: true, format: format as 'sqlite-v1' | 'file-v2',
      identity: { incarnation, generation }, reclaimDeadLease: true }))); return;
  }
  if (command === 'finalize' || command === 'abort-prepared') {
    const transitionId = flags.get('--transition-id'), sourceDigest = flags.get('--source-digest');
    if (flags.size !== (flags.has('--reclaim-dead-lease') ? 5 : 4) || typeof transitionId !== 'string' || typeof sourceDigest !== 'string') throw new IndexedStorageError('invalid_scope');
    console.log(JSON.stringify(await (command === 'finalize' ? finalizeManagedTransition : abortPreparedManagedTransition)(root, { quiesced: true, transitionId, sourceDigest,
      reclaimDeadLease: flags.get('--reclaim-dead-lease') === true }))); return;
  }
  throw new IndexedStorageError('invalid_scope');
}
main().catch(error => {
  // Never print private input/parser excerpts or canonical data in diagnostics.
  console.error(JSON.stringify({ status: 'unavailable', reason: error instanceof IndexedStorageError ? error.reason : 'corrupt' })); process.exitCode = 1;
});
