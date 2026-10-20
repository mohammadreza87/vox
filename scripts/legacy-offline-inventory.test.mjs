/** Synthetic native-file -> guarded child CLI -> minimized report qualification. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./legacy-offline-inventory.mjs', import.meta.url));
const CANARY = 'PRIVATE_SYNTHETIC_LIA1_CLI';
const args = ['--snapshot-fd', '3', '--selection-fd', '4'];
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-lia1-cli-'));
  const sourcePath = join(dir, CANARY + '.json'), selectionPath = join(dir, 'selection.json');
  const bytes = Buffer.from(JSON.stringify({ memories: [], offers: [], chats: { [CANARY]: [{ role: 'user', text: CANARY, at: '2026-10-20T00:00:00.000Z' }] } }, null, 2));
  writeFileSync(sourcePath, bytes, { mode: 0o600 });
  writeFileSync(selectionPath, JSON.stringify({ schema: 'vox.legacy-offline-selection/1', format: 'tireh-file-state/1', purpose: 'offline-deny-all-inventory', expectedBytes: bytes.length,
    expectedSha256: createHash('sha256').update(bytes).digest('hex'), provenance: 'operator_asserted_offline_copy' }), { mode: 0o600 });
  const source = openSync(sourcePath, 'r+'), selection = openSync(selectionPath, 'r+'), extra = [];
  const invoke = (flags = args, options = {}) => spawnSync(process.execPath, [CLI, ...flags], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 3 * 1024 * 1024,
    env: { PATH: process.env.PATH, TMPDIR: dir, TSX_DISABLE_CACHE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', source, selection], ...options,
  });
  try {
    run({ dir, source, selection, sourcePath, selectionPath, bytes, invoke, extra });
    assert.deepEqual(readFileSync(sourcePath), bytes);
  } finally {
    for (const fd of [source, selection, ...extra]) { try { closeSync(fd); } catch { /* Test-only cleanup. */ } }
    rmSync(dir, { recursive: true, force: true });
  }
}
test('LIA1 CLI inspects an explicitly inherited synthetic native snapshot', () => fixture(({ invoke }) => {
  const result = invoke();
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'vox.legacy-offline-inventory-report/1');
  assert.equal(report.mode, 'offline-snapshot-dry-run'); assert.equal(report.status, 'complete');
  assert.equal(report.rows.length, 2); assert.equal(report.sourceCoverage, 'unavailable');
  assert.equal(report.rows[1].target, null); assert.equal(report.rows[1].use, 'denied');
  assert.ok(!result.stdout.includes(CANARY)); assert.equal(result.stdout.split('\n').length, 2);
}));
for (const [name, flags] of [
  ['no arguments', []], ['unknown flag', ['--path', CANARY]], ['standard fd', ['--snapshot-fd', '1', '--selection-fd', '4']],
  ['duplicate flag', ['--snapshot-fd', '3', '--snapshot-fd', '4']], ['same fd', ['--snapshot-fd', '3', '--selection-fd', '3']],
  ['fraction', ['--snapshot-fd', '3.1', '--selection-fd', '4']], ['out of range', ['--snapshot-fd', '2147483648', '--selection-fd', '4']],
]) test('LIA1 CLI rejects ' + name, () => fixture(({ invoke }) => {
  const result = invoke(flags); assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'invalid_descriptor\n');
}));
test('same file on different inherited descriptors is rejected', () => fixture(({ invoke, source }) => {
  const result = invoke(args, { stdio: ['ignore', 'pipe', 'pipe', source, source] });
  assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).stop, 'invalid_descriptor');
}));
test('stdout input alias is refused before loader or output', () => fixture(({ invoke, source, selection }) => {
  const result = invoke(args, { stdio: ['ignore', source, 'pipe', source, selection] });
  assert.equal(result.status, 2); assert.equal(result.stderr, 'invalid_descriptor\n');
}));
test('stderr input alias is refused silently', () => fixture(({ invoke, source, selection }) => {
  const result = invoke(args, { stdio: ['ignore', 'pipe', source, source, selection] });
  assert.equal(result.status, 2); assert.equal(result.stdout, '');
}));
test('selection stdout alias is refused without mutating selector', () => fixture(({ invoke, source, selection, selectionPath }) => {
  const before = readFileSync(selectionPath);
  const result = invoke(args, { stdio: ['ignore', selection, 'pipe', source, selection] });
  assert.equal(result.status, 2); assert.deepEqual(readFileSync(selectionPath), before);
}));
test('post-guard missing module diagnostics never escape', () => fixture(({ dir, source, selection }) => {
  const entry = join(dir, CANARY + '.mjs'); writeFileSync(entry, readFileSync(CLI));
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, TMPDIR: dir, TSX_DISABLE_CACHE: '1' }, stdio: ['ignore', 'pipe', 'pipe', source, selection] });
  assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'internal_failed\n');
}));
test('report output failure has a distinct exit and fixed diagnostic', () => fixture(({ dir, invoke, source, selection, extra }) => {
  const outPath = join(dir, 'unwritable-output.json'); writeFileSync(outPath, 'synthetic', { mode: 0o600 });
  const output = openSync(outPath, 'r'); extra.push(output);
  const result = invoke(args, { stdio: ['ignore', output, 'pipe', source, selection] });
  assert.equal(result.status, 3); assert.equal(result.stderr, 'output_failed\n'); assert.equal(readFileSync(outPath, 'utf8'), 'synthetic');
}));
