#!/usr/bin/env node
/** Explicit trusted local administration. The flags attest that the operator
 * controls this host and has stopped writers; they are not account authentication
 * or automatic proof of process shutdown. No production defaults or activation. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { prepareRightsLocalUseLedger } from '../src/lib/adaptive/rights-intake/conversion';
import { RightsRepository, RightsError } from '../src/lib/adaptive/rights-intake/repository';
import { RightsFileStorage } from '../src/lib/adaptive/rights-intake/storage';

const invalid = (): never => { throw new RightsError(400, 'invalid_conversion_arguments'); };
function readPolicy(path: string): unknown {
  let current = parse(path).root;
  for (const part of relative(current, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (current !== path && !stat.isDirectory())) return invalid();
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65_536) return invalid();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 65_536) return invalid();
    const buffer = Buffer.alloc(65_537); let length = 0, count: number;
    do { count = readSync(fd, buffer, length, buffer.length - length, null); length += count; } while (count > 0 && length < buffer.length);
    if (length > 65_536) return invalid();
    const text = buffer.subarray(0, length).toString('utf8'), after = lstatSync(path);
    if (Buffer.byteLength(text) > 65_536 || after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev ||
        after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return invalid();
    return JSON.parse(text);
  } finally { closeSync(fd); }
}
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2), flags = new Map<string, string | true>();
  const switches = new Set(['--quiesced', '--local-administrator']);
  const values = new Set(['--data-dir', '--account-id', '--policy-file']);
  if (command !== 'prepare-local-use') return invalid();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flags.has(flag)) return invalid();
    if (switches.has(flag)) flags.set(flag, true);
    else if (values.has(flag)) {
      const value = args[++i]; if (!value || value.startsWith('--')) return invalid(); flags.set(flag, value);
    } else return invalid();
  }
  const dataDir = flags.get('--data-dir'), accountId = flags.get('--account-id'), policyFile = flags.get('--policy-file');
  if (flags.size !== 5 || flags.get('--quiesced') !== true || flags.get('--local-administrator') !== true ||
      typeof dataDir !== 'string' || !isAbsolute(dataDir) || resolve(dataDir) === '/' ||
      typeof policyFile !== 'string' || !isAbsolute(policyFile) || typeof accountId !== 'string' ||
      !/^telegram-account:[1-9]\d{0,15}$/.test(accountId) || !Number.isSafeInteger(Number(accountId.slice(17)))) return invalid();
  const repository = new RightsRepository(new RightsFileStorage(join(resolve(dataDir), 'rights-intake', 'v1')));
  await prepareRightsLocalUseLedger({ repository, accountId, policy: () => readPolicy(resolve(policyFile)), clock: Date.now,
    assertLocalAdministrationNow: () => { if (flags.get('--local-administrator') !== true) return invalid(); },
    assertQuiescedNow: () => { if (flags.get('--quiesced') !== true) return invalid(); },
  });
  const current = repository.read(accountId);
  if (current?.version !== 3) throw new RightsError(503, 'rights_conversion_unavailable');
  console.log(JSON.stringify({ status: 'prepared', rightsLedgerVersion: 3, revision: current.revision }));
}
main().catch(error => {
  // No policy content, account identifiers, paths or exception/parser text.
  console.error(JSON.stringify({ status: 'unavailable', reason: RightsError.is(error) ? error.code : 'rights_conversion_unavailable' }));
  process.exitCode = 1;
});
