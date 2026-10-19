import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const cliVersion = '15.34.0';
const esbuild = require('esbuild');
let directory;
let configBundle;
let baselineBundle;
let sourceModule;
let productionNames;
let firebaseTools;

function findFirebaseTools() {
  if (process.env.FIREBASE_TOOLS_ROOT) {
    const candidate = resolve(process.env.FIREBASE_TOOLS_ROOT);
    assert.equal(JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8')).version, cliVersion, 'FIREBASE_TOOLS_ROOT must select the pinned Firebase CLI');
    return candidate;
  }
  const cache = execFileSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' }).trim();
  const npx = join(cache, '_npx');
  const candidates = existsSync(npx) ? readdirSync(npx).map(name => join(npx, name, 'node_modules', 'firebase-tools')) : [];
  const found = candidates.find(candidate => {
    const manifest = join(candidate, 'package.json');
    return existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version === cliVersion;
  });
  assert.ok(found, `Firebase CLI ${cliVersion} must be installed first (npx --yes firebase-tools@${cliVersion} --version), or set FIREBASE_TOOLS_ROOT`);
  return found;
}

function invoke(path, phase, dsn, pruned = true) {
  const script = `
    (async () => {
      const loaded = require(process.argv[1]);
      const exported = loaded.default ?? loaded;
      const config = typeof exported === 'function' ? await exported(process.argv[2]) : await exported;
      const rewrites = typeof config.rewrites === 'function' ? await config.rewrites() : [];
      console.log('PACKAGING_RESULT=' + JSON.stringify({ output: config.output, images: config.images, serverExternalPackages: config.serverExternalPackages, webpack: typeof config.webpack, rewrites, env: config.env }));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  const child = spawnSync(process.execPath, [...(pruned ? ['--preserve-symlinks'] : []), '-e', script, path, phase], {
    cwd: pruned ? dirname(path) : root, encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, NODE_ENV: phase === 'phase-development-server' ? 'development' : 'production', NODE_PATH: '', NEXT_PUBLIC_SENTRY_DSN: dsn },
  });
  const result = child.stdout?.split('\n').find(line => line.startsWith('PACKAGING_RESULT='));
  return { status: child.status, stderr: child.stderr, config: result ? JSON.parse(result.slice('PACKAGING_RESULT='.length)) : null };
}

before(async () => {
  firebaseTools = findFirebaseTools();
  const utils = require(join(firebaseTools, 'lib/frameworks/next/utils.js'));
  const constants = require(join(firebaseTools, 'lib/frameworks/constants.js'));
  // Use Firebase's actual recursive npm production dependency closure, rather than
  // externalizing only the application's direct package.json dependencies.
  productionNames = await utils.getProductionDependencyNames(root);
  directory = mkdtempSync(join(tmpdir(), 'vox-firebase-config-'));
  const pruned = join(directory, 'pruned');
  mkdirSync(join(pruned, 'node_modules'), { recursive: true });
  writeFileSync(join(pruned, 'package.json'), '{"private":true}\n');
  // Logical production-only tree. --preserve-symlinks keeps dependency resolution
  // in this isolated tree instead of leaking back into the checkout's dev tree.
  // Omit the exact transitive dependency confirmed missing in the Cloud runtime.
  for (const name of productionNames.filter(name => name !== 'import-in-the-middle')) {
    const installed = join(root, 'node_modules', name);
    if (!existsSync(installed)) continue;
    const destination = join(pruned, 'node_modules', name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(installed, destination, 'dir');
  }
  assert.equal(existsSync(join(pruned, 'node_modules', '@sentry', 'nextjs')), false, 'Sentry must remain a pruned development dependency');
  assert.equal(existsSync(join(pruned, 'node_modules', 'import-in-the-middle')), false);
  configBundle = join(pruned, 'next.config.js');
  // These are the actual Firebase 15.34.0 codegen options for next.config.ts.
  const options = { entryPoints: [join(root, 'next.config.ts')], outfile: configBundle, bundle: true, platform: 'node', target: `node${constants.NODE_VERSION}`, logLevel: 'error', external: productionNames };
  const adapterSource = readFileSync(join(firebaseTools, 'lib/frameworks/next/index.js'), 'utf8');
  assert.match(adapterSource, /external: productionDeps/);
  assert.match(adapterSource, /getProductionDependencyNames\)\(sourceDir\)/);
  await esbuild.build(options);
  baselineBundle = join(pruned, 'static-import-control.js');
  // Negative control reproduces the former unconditional import even when DSN
  // is absent. It uses the same SDK and Firebase bundle/external rules.
  const source = "import { withSentryConfig } from '@sentry/nextjs'; const config = {output:'standalone'}; export default process.env.NEXT_PUBLIC_SENTRY_DSN ? withSentryConfig(config) : config;";
  const controlOptions = { ...options };
  delete controlOptions.entryPoints;
  await esbuild.build({ ...controlOptions, outfile: baselineBundle, stdin: { contents: source, resolveDir: root, sourcefile: 'static-import-control.ts', loader: 'ts' } });
  const configured = join(directory, 'configured-source');
  mkdirSync(configured); symlinkSync(join(root, 'node_modules'), join(configured, 'node_modules'), 'dir');
  sourceModule = join(configured, 'next.config.cjs');
  const transformed = await esbuild.transform(readFileSync(join(root, 'next.config.ts'), 'utf8'), { loader: 'ts', format: 'cjs', target: `node${constants.NODE_VERSION}` });
  writeFileSync(sourceModule, transformed.code);
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test('Firebase production config loads without Sentry or its missing instrumentation dependency', () => {
  const result = invoke(configBundle, 'phase-production-build', '');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.config.output, 'standalone');
  assert.deepEqual(result.config.serverExternalPackages, ['firebase-admin']);
  assert.deepEqual(result.config.images.remotePatterns, [{ protocol: 'https', hostname: '**' }]);
  assert.equal(result.config.webpack, 'undefined');
});

test('production-server config avoids build-time Sentry with either DSN state', () => {
  for (const dsn of ['', 'https://public@example.invalid/1']) {
    const result = invoke(configBundle, 'phase-production-server', dsn);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.config.output, 'standalone');
    assert.equal(result.config.webpack, 'undefined');
  }
});

test('old static-import control reproduces the missing import-in-the-middle failure', () => {
  const result = invoke(baselineBundle, 'phase-production-server', '');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find module 'import-in-the-middle'/);
});

test('configured build and development still use actual Sentry SDK configuration', () => {
  for (const phase of ['phase-production-build', 'phase-development-server']) {
    const result = invoke(sourceModule, phase, 'https://public@example.invalid/1', false);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.config.output, 'standalone');
    assert.equal(result.config.webpack, 'function');
    assert.ok(result.config.serverExternalPackages.includes('firebase-admin'));
    assert.ok(result.config.serverExternalPackages.includes('mongodb'));
    assert.ok(result.config.serverExternalPackages.includes('pg'));
    assert.equal(result.config.env._sentryRewritesTunnelPath, '/monitoring');
    const rewrites = Array.isArray(result.config.rewrites) ? result.config.rewrites : result.config.rewrites.beforeFiles;
    assert.equal(rewrites.length, 2);
    assert.ok(rewrites.every(rewrite => rewrite.source === '/monitoring(/?)' && rewrite.destination.includes('sentry.io/api/:projectid/envelope/')));
  }
});
