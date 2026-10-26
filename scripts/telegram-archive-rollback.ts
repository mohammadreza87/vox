/** Offline, explicitly scoped administration. Dry-run unless --apply is supplied. */
import { rollbackFileTelegramArchive } from '../src/lib/adaptive/telegram-archive-rollback';
async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flags.has(flag) || !['--directory', '--account-id', '--expected-content-sha256', '--apply', '--producers-stopped'].includes(flag)) throw new Error('arguments');
    if (['--apply', '--producers-stopped'].includes(flag)) flags.set(flag, true);
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('arguments'); flags.set(flag, value); }
  }
  const directory = flags.get('--directory'), accountId = flags.get('--account-id');
  if (typeof directory !== 'string' || typeof accountId !== 'string') throw new Error('scope');
  const result = await rollbackFileTelegramArchive({ directory, accountId, apply: flags.has('--apply'),
    producersStopped: flags.has('--producers-stopped'), expectedContentSha256: flags.get('--expected-content-sha256') as string | undefined });
  console.log(JSON.stringify(result));
}
main().catch(() => { console.error('archive_rollback_not_applied'); process.exitCode = 1; });
