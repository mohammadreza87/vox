import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { ADAPTIVE_RELEASE_CAPABILITIES, assertReleaseAdaptiveCompatibility, requiredAdaptiveCapabilities, readInstalledReleaseManifest } from './studio-adaptive-compatibility.mjs';

const uuid = 'b3c708bb-58bd-4504-93da-bc0c95f485e3';
const releaseMetadata = { revision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), buildId: 'synthetic-build', builtAt: '2026-10-20T00:00:00.000Z' };
const ready = version => ({ version, state: 'ready', rootId: uuid, format: 'sqlite-v1', store: uuid,
  identity: { incarnation: uuid, generation: 1 }, watermarkFloor: 200,
  ...(version === 2 ? { canonicalSchemaVersion: 2, controlsSchemaVersion: 2, productPauseEnforcementVersion: 1 } : {}) });
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-release-pause-'));
  const env = { STUDIO_DATA_DIR: join(dir, 'data'), STUDIO_ADAPTIVE_FORMAT: 'sqlite-v1' };
  const managed = join(env.STUDIO_DATA_DIR, 'adaptive.managed');
  mkdirSync(managed, { recursive: true });
  const marker = join(managed, 'format.json');
  const setMarker = value => writeFileSync(marker, JSON.stringify(value));
  try { run({ dir, env, managed, marker, setMarker }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('legacy original and managed v1 admit old releases without capability metadata', () => fixture(f => {
  f.setMarker(ready(1));
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, null).canonicalSchemaVersion, 1);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).canonicalSchemaVersion, 1);
  rmSync(f.managed, { recursive: true });
  assert.equal(assertReleaseAdaptiveCompatibility({ ...f.env, STUDIO_ADAPTIVE_FORMAT: '' }, null).canonicalSchemaVersion, 1);
  assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, null), /incompatible/);
}));

test('prepared v2 rejects an old or incomplete candidate even when no person is currently paused', () => fixture(f => {
  f.setMarker(ready(2));
  const before = readFileSync(f.marker);
  for (const candidate of [null, {}, { supportedAdaptiveDataSchemas: [1, 2] },
    { ...ADAPTIVE_RELEASE_CAPABILITIES, productPauseEnforcementVersion: 0 },
    { ...ADAPTIVE_RELEASE_CAPABILITIES, supportedAdaptiveControlSchemas: [1] },
    { ...ADAPTIVE_RELEASE_CAPABILITIES, supportedAdaptiveDataSchemas: [1] },
    { ...ADAPTIVE_RELEASE_CAPABILITIES, productPauseEnforcementVersion: 2 }]) {
    assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, candidate), /incompatible/);
  }
  assert.deepEqual(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES), {
    canonicalSchemaVersion: 2, controlsSchemaVersion: 2, productPauseEnforcementVersion: 1,
  });
  assert.deepEqual(readFileSync(f.marker), before);
}));

test('transitions, missing controls, unknown markers and mixed configured formats deny admission', () => fixture(f => {
  for (const patch of [{ state: 'transition' }, { version: 3 }, { controlsSchemaVersion: undefined },
    { canonicalSchemaVersion: 1 }, { productPauseEnforcementVersion: 2 }, { unexpected: false },
    { identity: { incarnation: uuid, generation: 0 } }, { watermarkFloor: -1 }, { format: 'file-v2' }]) {
    f.setMarker({ ...ready(2), ...patch });
    assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  }
  f.setMarker({ ...ready(1), productPauseEnforcementVersion: 1 });
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  f.setMarker(ready(2));
  assert.throws(() => requiredAdaptiveCapabilities({ ...f.env, STUDIO_ADAPTIVE_FORMAT: 'file' }), /incompatible/);
  assert.throws(() => requiredAdaptiveCapabilities({ ...f.env, STUDIO_DATA_DIR: '/' }), /incompatible/);
  writeFileSync(f.marker, '{broken');
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));

test('symlinked or oversized markers and malformed installed metadata never become legacy fallback', () => fixture(f => {
  const other = join(f.dir, 'other.json'); writeFileSync(other, JSON.stringify(ready(2)));
  symlinkSync(other, f.marker);
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  rmSync(f.marker); writeFileSync(f.marker, ' '.repeat(65537));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  assert.equal(readInstalledReleaseManifest(f.dir), null);
  writeFileSync(join(f.dir, 'studio-release.json'), '{bad');
  assert.throws(() => readInstalledReleaseManifest(f.dir), /incompatible/);
}));

test('existing null, arrays, partial or invalid release records cannot fall back to legacy admission', () => fixture(f => {
  f.setMarker(ready(1));
  for (const value of [null, [], {}, { ...releaseMetadata, revision: 'bad' }, { ...releaseMetadata, sourceTree: null }, { ...releaseMetadata, revision: ['a'.repeat(40)] },
    { ...releaseMetadata, buildId: '' }, { ...releaseMetadata, builtAt: '2026-02-30T00:00:00.000Z' }]) {
    writeFileSync(join(f.dir, 'studio-release.json'), JSON.stringify(value));
    assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, readInstalledReleaseManifest(f.dir)), /incompatible/);
  }
  writeFileSync(join(f.dir, 'studio-release.json'), JSON.stringify(releaseMetadata));
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, readInstalledReleaseManifest(f.dir)).canonicalSchemaVersion, 1);
  writeFileSync(join(f.dir, 'studio-release.json'), JSON.stringify({ ...releaseMetadata, supportedAdaptiveDataSchemas: [1, 2] }));
  assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, readInstalledReleaseManifest(f.dir)), /incompatible/);
}));

/** Exercise the actual CLI's pre-swap ordering with a real clean fixture Git
 * tree. Every network or launchctl attempt is separately recorded and denied. */
function cliFixture(run) {
  fixture(f => {
    const source = fileURLToPath(new URL('.', import.meta.url));
    const project = join(f.dir, 'source'); mkdirSync(join(project, 'scripts'), { recursive: true });
    for (const name of ['studio-production.mjs', 'studio-adaptive-compatibility.mjs']) cpSync(join(source, name), join(project, 'scripts', name));
    writeFileSync(join(project, '.gitignore'), '.next/\n');
    const git = (...args) => { const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=Vox fixture', '-c', 'user.email=fixture@invalid.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'synthetic release fixture');
    mkdirSync(join(project, '.next', 'standalone', '.next'), { recursive: true });
    writeFileSync(join(project, '.next', 'standalone', 'server.js'), 'throw new Error("must not start");\n');
    for (const dir of [join(project, '.next'), join(project, '.next', 'standalone', '.next')]) writeFileSync(join(dir, 'BUILD_ID'), 'synthetic-build');
    writeFileSync(join(project, '.next', 'studio-release.json'), JSON.stringify({ revision: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'), buildId: 'synthetic-build' }));
    const production = join(f.dir, 'production'), bin = join(f.dir, 'bin'); mkdirSync(production); mkdirSync(bin);
    const signal = join(f.dir, 'unexpected-effect');
    writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\nprintf called >> '${signal}'\nexit 1\n`, { mode: 0o700 });
    const guard = join(f.dir, 'network-guard.mjs');
    writeFileSync(guard, `import{appendFileSync}from'node:fs';globalThis.fetch=async()=>{appendFileSync(${JSON.stringify(signal)},'fetch');throw new Error('network denied')};`);
    writeFileSync(join(production, 'production.env'), `STUDIO_DATA_DIR='${f.env.STUDIO_DATA_DIR}'\nSTUDIO_ADAPTIVE_FORMAT='sqlite-v1'\n`);
    f.setMarker(ready(2));
    const invoke = command => spawnSync(process.execPath, ['--import', guard, join(project, 'scripts', 'studio-production.mjs'), command], {
      cwd: project, env: { PATH: `${bin}:${process.env.PATH}`, VOX_PRODUCTION_DIR: production }, encoding: 'utf8', timeout: 10000,
    });
    run({ ...f, project, production, signal, invoke });
  });
}

test('actual install refuses pause-unaware artifact before provider checks or stopping current service', () => cliFixture(f => {
  const result = f.invoke('install');
  assert.equal(result.status, 1); assert.match(result.stderr, /Adaptive storage is incompatible/);
  assert.equal(existsSync(f.signal), false); assert.equal(existsSync(join(f.production, 'releases')), false);
}));

test('actual rollback refuses old release before launchctl and leaves current pointer untouched', () => cliFixture(f => {
  const current = join(f.production, 'current-release'), previous = join(f.production, 'previous-release');
  for (const dir of [current, previous]) { mkdirSync(dir); writeFileSync(join(dir, 'server.js'), 'synthetic'); }
  writeFileSync(join(current, 'studio-release.json'), JSON.stringify({ ...releaseMetadata, ...ADAPTIVE_RELEASE_CAPABILITIES }));
  symlinkSync(current, join(f.production, 'current')); writeFileSync(join(f.production, 'previous'), previous);
  const result = f.invoke('rollback');
  assert.equal(result.status, 1); assert.match(result.stderr, /Adaptive storage is incompatible/);
  assert.equal(existsSync(f.signal), false); assert.equal(realpathSync(join(f.production, 'current')), realpathSync(current));
}));
