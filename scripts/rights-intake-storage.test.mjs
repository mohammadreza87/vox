import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url)), script = join(root, 'scripts/rights-intake-storage.ts');
const accountId = 'telegram-account:123', accountKey = createHash('sha256').update(accountId).digest('hex');
function fixture(run) {
  // Canonical absolute path avoids platform /tmp aliases in the policy reader.
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'vox-rf1-cli-'));
  const data = join(directory, 'data'), ledgerDirectory = join(data, 'rights-intake/v1'), policyFile = join(directory, 'policy.json');
  mkdirSync(ledgerDirectory, { recursive: true, mode: 0o700 }); chmodSync(ledgerDirectory, 0o700);
  const ledgerFile = join(ledgerDirectory, `${accountKey}.json`);
  const before = { version: 2, accountId, revision: 1, observedServerTime: 0, requests: [], commandReceipts: [], tombstones: [] };
  writeFileSync(ledgerFile, JSON.stringify(before), { mode: 0o600 });
  const policySource = new URL('../src/lib/adaptive/rights-intake/local-use-fixtures.ts', import.meta.url).href;
  const generated = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import {syntheticLocalUsePolicy} from ${JSON.stringify(policySource)}; const p=syntheticLocalUsePolicy();p.effectiveAt=Date.now()-1000;p.expiresAt=Date.now()+3600000;console.log(JSON.stringify(p));`],
  { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(generated.status, 0, generated.stderr);
  const policy = JSON.parse(generated.stdout); writeFileSync(policyFile, JSON.stringify(policy), { mode: 0o600 });
  const args = ['prepare-local-use', '--data-dir', data, '--account-id', accountId, '--policy-file', policyFile, '--quiesced', '--local-administrator'];
  const invoke = (input = args) => spawnSync(process.execPath, ['--import', 'tsx', script, ...input], { cwd: root, encoding: 'utf8', timeout: 10000 });
  try { run({ directory, data, ledgerDirectory, ledgerFile, policyFile, policy, before, args, invoke }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
test('actual rights CLI explicitly converts existing metadata and keeps replayed ledger bytes unchanged', () => fixture(f => {
  const result = f.invoke(); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'prepared', rightsLedgerVersion: 3, revision: 2 });
  assert.equal(result.stdout.includes(accountId), false);
  const converted = JSON.parse(readFileSync(f.ledgerFile, 'utf8'));
  assert.deepEqual(converted.requests, f.before.requests); assert.deepEqual(converted.commandReceipts, f.before.commandReceipts);
  assert.deepEqual(converted.tombstones, f.before.tombstones);
  assert.deepEqual(converted.localUse, { version: 1, intents: [], acknowledgements: [] });
  const bytes = readFileSync(f.ledgerFile), again = f.invoke(); assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(readFileSync(f.ledgerFile), bytes); // Clock sidecar may legitimately advance.
}));
test('actual rights CLI has no implicit root, account, policy or administration defaults', () => fixture(f => {
  const bytes = readFileSync(f.ledgerFile);
  for (const args of [[], f.args.filter(x => x !== '--quiesced'), f.args.filter(x => x !== '--local-administrator'),
    [...f.args, '--operator-id', '999'], [...f.args, '--quiesced']]) {
    const result = f.invoke(args); assert.equal(result.status, 1); assert.deepEqual(readFileSync(f.ledgerFile), bytes);
    assert.equal(result.stderr.includes(accountId), false); assert.equal(result.stderr.includes(f.data), false);
  }
  assert.deepEqual(readdirSync(f.ledgerDirectory), [`${accountKey}.json`]);
}));
test('actual rights CLI refuses absent or expired conversion policy and unsafe policy files without ledger mutation', () => fixture(f => {
  const bytes = readFileSync(f.ledgerFile);
  const missing = structuredClone(f.policy); delete missing.localFulfillment.ledgerConversion;
  for (const policy of [missing, { ...f.policy, expiresAt: Date.now() - 1 }]) {
    writeFileSync(f.policyFile, JSON.stringify(policy)); const result = f.invoke(); assert.equal(result.status, 1);
    assert.deepEqual(readFileSync(f.ledgerFile), bytes);
  }
  rmSync(f.policyFile); const target = join(f.directory, 'policy-target.json'); writeFileSync(target, JSON.stringify(f.policy)); symlinkSync(target, f.policyFile);
  assert.equal(f.invoke().status, 1); assert.deepEqual(readFileSync(f.ledgerFile), bytes);
  rmSync(f.policyFile); writeFileSync(f.policyFile, ' '.repeat(65_537));
  assert.equal(f.invoke().status, 1); assert.deepEqual(readFileSync(f.ledgerFile), bytes);
}));
test('actual rights CLI refuses absent accounts without creating a clock or replacement ledger', () => fixture(f => {
  rmSync(f.ledgerFile); const result = f.invoke(); assert.equal(result.status, 1);
  assert.deepEqual(readdirSync(f.ledgerDirectory), []);
  assert.equal(existsSync(f.ledgerFile), false);
}));
