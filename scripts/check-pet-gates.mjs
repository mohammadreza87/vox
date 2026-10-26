#!/usr/bin/env node
/**
 * Pet care game gates (design §13, Phase 0), in order: the copy lint (check-pet-copy.mjs) and its own tests, the pet
 * unit tests (`vitest run src/lib/pet src/app/studio/pet`), and, when a `next build` exists in `.next`, the bundle
 * check (check-pet-bundle.mjs). Every gate runs even after a failure; prints a one-screen summary with the tail of
 * each failing gate's output and exits 1 if any failed. Node built-ins only.
 *
 *   node scripts/check-pet-gates.mjs        (npm run check:pet)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const TAIL = 12;

export const gates = (root = ROOT) => [
  { name: 'copy lint', cmd: process.execPath, args: ['scripts/check-pet-copy.mjs'] },
  { name: 'copy lint tests', cmd: process.execPath, args: ['--test', 'scripts/pet-copy-lint.test.mjs', 'scripts/check-pet-gates.test.mjs'] },
  { name: 'pet unit tests', cmd: NPX, args: ['vitest', 'run', 'src/lib/pet', 'src/app/studio/pet'] },
  existsSync(join(root, '.next', 'app-build-manifest.json'))
    ? { name: 'pet bundle', cmd: process.execPath, args: ['scripts/check-pet-bundle.mjs'] }
    : { name: 'pet bundle', skip: 'no .next build (run `npm run build` first)' },
];

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
/** A test runner's failing files and totals when it printed them (vitest, node --test), else the last lines. */
export function tailOf(lines) {
  const summary = [...new Set(lines.filter((l) => /^\s*(FAIL\s|Test Files\s|Tests\s|# (fail|pass)\s|not ok\s)/.test(l)).map((l) => l.trim()))];
  return summary.length ? summary.slice(0, TAIL) : lines.slice(-TAIL);
}

export function runGates(root = ROOT, list = gates(root)) {
  return list.map((g) => {
    if (g.skip) return { name: g.name, status: 'skip', note: g.skip, ms: 0, tail: [] };
    const started = Date.now();
    const r = spawnSync(g.cmd, g.args, { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' }, maxBuffer: 64 * 1024 * 1024 });
    const output = plain(`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`).split('\n').filter((l) => l.trim());
    return { name: g.name, status: r.status === 0 ? 'pass' : 'fail', code: r.status, ms: Date.now() - started, tail: tailOf(output), command: [g.cmd === process.execPath ? 'node' : g.cmd, ...g.args].join(' ') };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = runGates();
  console.log('Pet gates');
  for (const r of results) console.log(`  ${r.status.toUpperCase().padEnd(4)}  ${r.name.padEnd(16)} ${r.status === 'skip' ? r.note : `${(r.ms / 1000).toFixed(1)} s`}`);
  for (const r of results.filter((x) => x.status === 'fail')) {
    console.log(`\n${r.name} failed (exit ${r.code ?? 'signal'}): ${r.command}`);
    for (const l of r.tail) console.log(`  ${l}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(failed ? `\n${failed} gate${failed === 1 ? '' : 's'} failed` : '\nall gates passed');
  process.exit(failed ? 1 : 0);
}
