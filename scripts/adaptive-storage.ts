#!/usr/bin/env node
/** Explicit local administration only. No default command/root/format, no
 * activation, provider requests, feature grants or migration-time restore. */
import { resolve } from 'path';
import { migrateAdaptiveStorage, inspectManagedTransition, finalizeManagedTransition } from '../src/lib/adaptive/persistence/indexed/migration';
import { rollbackAdaptiveStorage } from '../src/lib/adaptive/persistence/indexed/rollback';
import { IndexedStorageError } from '../src/lib/adaptive/persistence/indexed/contracts';
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const allowed = new Set(['--root', '--quiesced', '--transition-id', '--source-digest', '--reclaim-dead-lease']);
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (!allowed.has(flag) || flags.has(flag)) throw new IndexedStorageError('invalid_scope');
    if (flag === '--quiesced' || flag === '--reclaim-dead-lease') flags.set(flag, true);
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new IndexedStorageError('invalid_scope'); flags.set(flag, value); }
  }
  const requested = flags.get('--root'); if (typeof requested !== 'string') throw new IndexedStorageError('invalid_scope'); const root = resolve(requested);
  if (command === 'inspect') { if (flags.size !== 1) throw new IndexedStorageError('invalid_scope'); console.log(JSON.stringify(inspectManagedTransition(root))); return; }
  if (flags.get('--quiesced') !== true) throw new IndexedStorageError('invalid_scope');
  if (command === 'migrate' || command === 'rollback') {
    if (flags.size !== 2) throw new IndexedStorageError('invalid_scope');
    console.log(JSON.stringify(await (command === 'migrate' ? migrateAdaptiveStorage : rollbackAdaptiveStorage)(root, { quiesced: true }))); return;
  }
  if (command === 'finalize') {
    const transitionId = flags.get('--transition-id'), sourceDigest = flags.get('--source-digest');
    if (typeof transitionId !== 'string' || typeof sourceDigest !== 'string') throw new IndexedStorageError('invalid_scope');
    console.log(JSON.stringify(await finalizeManagedTransition(root, { quiesced: true, transitionId, sourceDigest,
      reclaimDeadLease: flags.get('--reclaim-dead-lease') === true }))); return;
  }
  throw new IndexedStorageError('invalid_scope');
}
main().catch(error => {
  // Never print private input/parser excerpts or canonical data in diagnostics.
  console.error(JSON.stringify({ status: 'unavailable', reason: error instanceof IndexedStorageError ? error.reason : 'corrupt' })); process.exitCode = 1;
});
