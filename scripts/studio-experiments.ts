/** Local operator only. This script does not discover credentials or remote targets.
 * Run with node --import tsx scripts/studio-experiments.ts <absolute-ledger-directory>
 * install <reviewed-config.json> | advance <id> <expected-revision> <offline|shadow|pilot>
 * kill <id> <expected-revision> <quarantine|purge> | failure <id> <expected-revision> | sweep
 * Inspect the reviewed config/ledger locally; stdout contains counts/status only. */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlledExperimentService, FileExperimentStorage } from '../src/lib/adaptive/experiments';
export function runExperimentCommand(args: string[], now = Date.now()): unknown {
  const [directory, command, ...parameters] = args;
  if (!directory || !isAbsolute(directory) || directory === '/' || directory.includes('\0')) throw new Error('Absolute local ledger directory required');
  const service = new ControlledExperimentService(new FileExperimentStorage(directory));
  const expected = (raw: string | undefined) => { if (!raw || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Explicit expected revision required'); return Number(raw); };
  if (command === 'install' && parameters.length === 1) return service.install(JSON.parse(readFileSync(parameters[0], 'utf8')), now);
  if (command === 'advance' && parameters.length === 3 && ['offline', 'shadow', 'pilot'].includes(parameters[2]))
    return service.transition(parameters[0], expected(parameters[1]), parameters[2] as 'offline' | 'shadow' | 'pilot', now);
  if (command === 'kill' && parameters.length === 3 && ['quarantine', 'purge'].includes(parameters[2]))
    return service.kill(parameters[0], expected(parameters[1]), parameters[2] as 'quarantine' | 'purge', now);
  if (command === 'failure' && parameters.length === 2) return service.failure(parameters[0], expected(parameters[1]), now);
  if (command === 'sweep' && parameters.length === 0) { service.sweep(now); return { swept: true }; }
  throw new Error('Invalid controlled experiment command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(runExperimentCommand(process.argv.slice(2)))}\n`); }
  catch { process.stderr.write('Controlled experiment operation rejected; inspect local configuration/revision.\n'); process.exitCode = 1; }
}
