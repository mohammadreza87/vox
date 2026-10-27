#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, rmSync, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Compile only during an explicitly authorized production build. The helper
 * is never executed here and never selected through PATH at installation. */
export function buildRuntimeProcessMetadata() {
  const output = join(root, '.next', 'studio-process-metadata');
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return { version: 1, abi: 1, available: false, platform: process.platform, arch: process.arch };
  }
  const query = args => {
    const r = spawnSync('/usr/bin/xcrun', ['--sdk', 'macosx', ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 16384 });
    if (r.status !== 0 || !r.stdout?.trim()) throw new Error('Cannot identify the native process metadata compiler.');
    return r.stdout.trim();
  };
  const compiler = query(['--find', 'clang']);
  const version = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 16384 });
  if (version.status !== 0 || !version.stdout) throw new Error('Cannot identify the native process metadata compiler.');
  const sdkVersion = query(['--show-sdk-version']);
  const source = join(root, 'scripts', 'native', 'studio-process-metadata-darwin.c');
  const args = ['--sdk', 'macosx', 'clang', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-arch', 'arm64', '-mmacosx-version-min=11.0', source, '-lproc', '-o', output];
  const compiled = spawnSync('/usr/bin/xcrun', args, { cwd: root, stdio: 'inherit', timeout: 60000 });
  if (compiled.status !== 0) throw new Error('Native process metadata helper compilation failed.');
  chmodSync(output, 0o700);
  const info = lstatSync(output), bytes = readFileSync(output);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !bytes.length || bytes.length > 1024 * 1024) {
    throw new Error('Native process metadata helper artifact is invalid.');
  }
  return { version: 1, abi: 1, available: true, platform: 'darwin', arch: 'arm64',
    file: 'studio-process-metadata', bytes: bytes.length, binarySha256: digest(bytes), sourceSha256: digest(readFileSync(source)),
    compilerPath: compiler, compilerSha256: digest(readFileSync(compiler)), compilerVersionSha256: digest(version.stdout), sdkVersion, deploymentTarget: '11.0' };
}
export function buildStudio() {
  if (git('status', '--porcelain')) throw new Error('Commit the release before building its production artifact.');
  const revision = git('rev-parse', 'HEAD');
  const sourceTree = git('rev-parse', 'HEAD^{tree}');
  rmSync(join(root, '.next', 'studio-release.json'), { force: true });
  rmSync(join(root, '.next', 'studio-process-metadata'), { force: true });
  const build = spawnSync(process.execPath, [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, STUDIO_BOTS: '0', NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (build.status !== 0) throw new Error('Production build failed.');
  const runtimeProcessMetadata = buildRuntimeProcessMetadata();
  if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== revision) throw new Error('Source changed during the build. Rebuild the committed release.');
  const buildId = readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim();
  const artifactId = readFileSync(join(root, '.next', 'standalone', '.next', 'BUILD_ID'), 'utf8').trim();
  if (buildId !== artifactId || !existsSync(join(root, '.next', 'standalone', 'server.js'))) throw new Error('Standalone artifact is incomplete.');
  writeFileSync(join(root, '.next', 'studio-release.json'), JSON.stringify({ revision, sourceTree, buildId,
    builtAt: new Date().toISOString(), ...ADAPTIVE_RELEASE_CAPABILITIES, runtimeProcessMetadata }, null, 2) + '\n');
  console.log(`Production artifact verified for ${revision}.`);
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try { buildStudio(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
