#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ADAPTIVE_RELEASE_CAPABILITIES } from './studio-adaptive-compatibility.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot verify source revision.');
  return result.stdout.trim();
};
try {
  if (git('status', '--porcelain')) throw new Error('Commit the release before building its production artifact.');
  const revision = git('rev-parse', 'HEAD');
  const sourceTree = git('rev-parse', 'HEAD^{tree}');
  rmSync(join(root, '.next', 'studio-release.json'), { force: true });
  const build = spawnSync(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, STUDIO_BOTS: '0', NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (build.status !== 0) throw new Error('Production build failed.');
  if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== revision) throw new Error('Source changed during the build. Rebuild the committed release.');
  const buildId = readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim();
  const artifactId = readFileSync(join(root, '.next', 'standalone', '.next', 'BUILD_ID'), 'utf8').trim();
  if (buildId !== artifactId || !existsSync(join(root, '.next', 'standalone', 'server.js'))) throw new Error('Standalone artifact is incomplete.');
  writeFileSync(join(root, '.next', 'studio-release.json'), JSON.stringify({ revision, sourceTree, buildId, builtAt: new Date().toISOString(), ...ADAPTIVE_RELEASE_CAPABILITIES }, null, 2) + '\n');
  console.log(`Production artifact verified for ${revision}.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
