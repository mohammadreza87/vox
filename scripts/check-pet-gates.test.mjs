import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gates, runGates, tailOf } from './check-pet-gates.mjs';

test('gates run in order: copy lint, its tests, pet unit tests, then the bundle check only with a build', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'vox-pet-gates-'));
  try {
    const names = (list) => list.map((g) => `${g.name}:${g.skip ? 'skip' : g.args.join(' ')}`);
    assert.deepEqual(names(gates(root)), [
      'copy lint:scripts/check-pet-copy.mjs',
      'copy lint tests:--test scripts/pet-copy-lint.test.mjs scripts/check-pet-gates.test.mjs',
      'pet unit tests:vitest run src/lib/pet src/app/studio/pet',
      'pet bundle:skip',
    ]);
    mkdirSync(join(root, '.next')); writeFileSync(join(root, '.next', 'app-build-manifest.json'), '{}');
    assert.equal(gates(root)[3].args.join(' '), 'scripts/check-pet-bundle.mjs');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every gate runs after a failure; a failure keeps the tail of its output without colour codes', () => {
  const node = process.execPath;
  const results = runGates(process.cwd(), [
    { name: 'a', cmd: node, args: ['-e', 'console.log("\\x1b[31mred\\x1b[0m"); process.exit(1)'] },
    { name: 'b', cmd: node, args: ['-e', 'process.exit(0)'] },
    { name: 'c', skip: 'no build' },
  ]);
  assert.deepEqual(results.map((r) => [r.name, r.status]), [['a', 'fail'], ['b', 'pass'], ['c', 'skip']]);
  assert.deepEqual(results[0].tail, ['red']);
  assert.equal(results[0].code, 1);
});

test('a failing test runner is summarised by its failing files and totals', () => {
  const vitest = [' FAIL  src/a.test.ts > x', 'stack', ' FAIL  src/a.test.ts > x', ' Test Files  1 failed | 3 passed (4)', '      Tests  2 failed | 40 passed (42)', 'Duration 3s'];
  assert.deepEqual(tailOf(vitest), ['FAIL  src/a.test.ts > x', 'Test Files  1 failed | 3 passed (4)', 'Tests  2 failed | 40 passed (42)']);
  assert.deepEqual(tailOf(['one', 'two']), ['one', 'two']);
});
