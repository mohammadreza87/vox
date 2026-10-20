import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const setMarker = value => {
    writeFileSync(marker, JSON.stringify(value));
    rmSync(join(managed, 'stores'), { recursive: true, force: true }); mkdirSync(join(managed, 'stores'), { mode: 0o700 });
    writeFileSync(join(env.STUDIO_DATA_DIR, 'adaptive'), `VOX_MANAGED_STORAGE_V1:${uuid}\n`);
    if (![1, 2].includes(value.version) || !['sqlite-v1', 'file-v2'].includes(value.format)) return;
    const path = join(managed, 'stores', uuid);
    if (value.format === 'sqlite-v1') {
      const db = new Database(path);
      const source = readFileSync(new URL('../src/lib/adaptive/persistence/indexed/sqlite-storage.ts', import.meta.url), 'utf8');
      const ddl = source.match(/const DDL = `([\s\S]*?)`;/)?.[1]; assert.ok(ddl); db.exec(ddl);
      db.pragma(`user_version = ${value.version}`);
      db.prepare('INSERT INTO store_meta(singleton,json) VALUES(1,?)').run(JSON.stringify({ formatVersion: 1, schemaVersion: value.version, incarnation: uuid, generation: 1, lifecycleWatermark: 200 })); db.close();
    } else {
      mkdirSync(join(path, 'records'), { recursive: true, mode: 0o700 });
      writeFileSync(join(path, 'head.json'), JSON.stringify({ formatVersion: 2, incarnation: uuid, generation: 1, lifecycleWatermark: 200, accounts: [], ...(value.version === 2 ? { schemaVersion: 2, authorityProjectionVersion: 1 } : {}) }));
    }
  };
  try { run({ dir, env, managed, marker, setMarker }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('legacy original and managed v1 admit old releases without capability metadata', () => fixture(f => {
  f.setMarker(ready(1));
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, null).canonicalSchemaVersion, 1);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).canonicalSchemaVersion, 1);
  rmSync(f.managed, { recursive: true }); rmSync(join(f.env.STUDIO_DATA_DIR, 'adaptive'));
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

test('prepared FILE requires explicit body-free authority capability without changing SQLite or legacy admission', () => fixture(f => {
  const env = { ...f.env, STUDIO_ADAPTIVE_FORMAT: 'file-v2' };
  const fileMarker = { ...ready(2), format: 'file-v2', fileAuthorityProjectionVersion: 1 };
  f.setMarker(fileMarker);
  assert.equal(assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES).fileAuthorityProjectionVersion, 1);
  const { supportedFileAuthorityProjectionVersions: omitted, ...priorCapabilities } = ADAPTIVE_RELEASE_CAPABILITIES;
  assert.deepEqual(omitted, [1]);
  for (const candidate of [priorCapabilities, { ...priorCapabilities, supportedFileAuthorityProjectionVersions: [] },
    { ...priorCapabilities, supportedFileAuthorityProjectionVersions: [2] },
    { ...priorCapabilities, supportedFileAuthorityProjectionVersions: null }]) {
    assert.throws(() => assertReleaseAdaptiveCompatibility(env, candidate), /incompatible/);
  }
  for (const version of [undefined, 0, 2, null]) {
    f.setMarker({ ...fileMarker, fileAuthorityProjectionVersion: version });
    assert.throws(() => requiredAdaptiveCapabilities(env), /incompatible/);
  }
  f.setMarker(ready(2));
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, priorCapabilities).canonicalSchemaVersion, 2);
  f.setMarker({ ...ready(1), format: 'file-v2' });
  assert.equal(assertReleaseAdaptiveCompatibility(env, null).canonicalSchemaVersion, 1);
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
    writeFileSync(join(project, '.gitignore'), '.next/\nnode_modules/\n');
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(project, 'node_modules'));
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

test('actual install and rollback reject projection-unaware releases before any effects', () => cliFixture(f => {
  writeFileSync(join(f.production, 'production.env'), `STUDIO_DATA_DIR='${f.env.STUDIO_DATA_DIR}'\nSTUDIO_ADAPTIVE_FORMAT='file-v2'\n`);
  f.setMarker({ ...ready(2), format: 'file-v2', fileAuthorityProjectionVersion: 1 });
  const manifestPath = join(f.project, '.next', 'studio-release.json');
  const provenance = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { supportedFileAuthorityProjectionVersions: omitted, ...priorCapabilities } = ADAPTIVE_RELEASE_CAPABILITIES;
  assert.deepEqual(omitted, [1]);
  writeFileSync(manifestPath, JSON.stringify({ ...provenance, ...priorCapabilities }));
  const install = f.invoke('install');
  assert.equal(install.status, 1); assert.match(install.stderr, /Adaptive storage is incompatible/);
  const current = join(f.production, 'current-release'), previous = join(f.production, 'previous-release');
  for (const dir of [current, previous]) { mkdirSync(dir); writeFileSync(join(dir, 'server.js'), 'synthetic'); }
  writeFileSync(join(previous, 'studio-release.json'), JSON.stringify({ ...releaseMetadata, ...priorCapabilities }));
  symlinkSync(current, join(f.production, 'current')); writeFileSync(join(f.production, 'previous'), previous);
  const rollback = f.invoke('rollback');
  assert.equal(rollback.status, 1); assert.match(rollback.stderr, /Adaptive storage is incompatible/);
  assert.equal(existsSync(f.signal), false); assert.equal(existsSync(join(f.production, 'releases')), false);
  assert.equal(realpathSync(join(f.production, 'current')), realpathSync(current));
}));

const accountId = 'telegram-account:123', accountKey = createHash('sha256').update(accountId).digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baselineCapabilities = Object.fromEntries(Object.entries(ADAPTIVE_RELEASE_CAPABILITIES).filter(([key]) => !['supportedObserverClientExperienceVersions', 'supportedRightsLedgerVersions', 'supportedExperimentLedgerSchemas'].includes(key)));
const observerExtension = () => ({ schemaVersion: 1, events: [], projections: [], corrections: [] });
const document = (version = 1, observer) => ({ schemaVersion: version, accountId, personId: `account-profile:${hash(accountId).slice(0, 32)}`, revision: 1, createdAt: 100, updatedAt: 100, ...(observer ? { observer } : {}) });
function putCanonical(f, doc, format = f.env.STUDIO_ADAPTIVE_FORMAT) {
  if (format === 'file') { mkdirSync(join(f.env.STUDIO_DATA_DIR, 'adaptive'), { recursive: true }); writeFileSync(join(f.env.STUDIO_DATA_DIR, 'adaptive', `${accountKey}.json`), JSON.stringify(doc)); return; }
  const store = join(f.managed, 'stores', uuid);
  if (format === 'sqlite-v1') { const db = new Database(store); try { db.prepare('INSERT OR REPLACE INTO accounts(account_key,account_id,canonical,canonical_digest) VALUES(?,?,?,?)').run(accountKey, accountId, JSON.stringify(doc), hash(doc)); } finally { db.close(); } return; }
  const headPath = join(store, 'head.json'), head = JSON.parse(readFileSync(headPath, 'utf8'));
  const ref = { key: accountKey, accountId, file: uuid, digest: hash(doc) };
  if (doc.schemaVersion === 2) {
    const image = { version: 1, schemaVersion: 2, incarnation: uuid, generation: 1, key: accountKey, accountId, canonicalFile: uuid, canonicalDigest: ref.digest, controls: {}, catalogs: [{ space: 'work', digest: 'a'.repeat(64) }, { space: 'personal', digest: 'b'.repeat(64) }] };
    mkdirSync(join(store, 'authority'), { recursive: true }); writeFileSync(join(store, 'authority', `${uuid}.json`), JSON.stringify(image)); ref.authorityFile = uuid; ref.authorityDigest = hash(image);
  }
  head.accounts = [ref]; writeFileSync(headPath, JSON.stringify(head)); writeFileSync(join(store, 'records', `${uuid}.json`), JSON.stringify(doc));
}
function legacy(f) { rmSync(f.managed, { recursive: true }); rmSync(join(f.env.STUDIO_DATA_DIR, 'adaptive'), { force: true }); f.env.STUDIO_ADAPTIVE_FORMAT = 'file'; }
function putRights(f, version = 2) {
  const directory = join(f.env.STUDIO_DATA_DIR, 'rights-intake', 'v1'); mkdirSync(directory, { recursive: true });
  const file = join(directory, `${accountKey}.json`); writeFileSync(file, JSON.stringify({ version, accountId, revision: 1, observedServerTime: 200, requests: [], commandReceipts: [], ...(version === 2 ? { tombstones: [] } : {}) })); return file;
}
function putExperiments(f, patch = {}) {
  const directory = join(f.env.STUDIO_DATA_DIR, 'controlled-experiments', 'v1'); mkdirSync(directory, { recursive: true });
  const file = join(directory, 'ledger.json'); writeFileSync(file, JSON.stringify({ schemaVersion: 1, version: 'vox-controlled-experiments-v1', observedAt: 200, definitions: [], assignments: [], derived: [], exposures: [], tombstones: [], ...patch })); return file;
}
for (const format of ['file', 'sqlite-v1', 'file-v2']) test(`${format} actual observer extension requires its declared reader capability`, () => fixture(f => {
  if (format === 'file') legacy(f); else { f.env.STUDIO_ADAPTIVE_FORMAT = format; f.setMarker({ ...ready(1), format }); }
  putCanonical(f, document(1), format);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, baselineCapabilities).observerClientExperienceVersion, undefined);
  for (const observer of [observerExtension(), { schemaVersion: 1, events: [{ schemaVersion: 1, version: 'vox-observer-v1', id: 'a'.repeat(64), outcome: 'text_rendered', clientExperienceVersion: 1, channel: 'text', trust: 'client_unverified' }], projections: [] },
    { schemaVersion: 1, events: [], projections: [{ space: 'work', clientExperience: { version: 1, trust: 'client_unverified', textRendered: 1, textTimingSamples: 1, meanTimeToTextMs: 10, correctionSaved: 0, correctionUnconfirmed: 0, correctionAcceptedReceipts: 0 } }] }]) {
    putCanonical(f, document(1, observer), format);
    assert.equal(requiredAdaptiveCapabilities(f.env).observerClientExperienceVersion, 1);
    assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, baselineCapabilities), /incompatible/);
    assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).observerClientExperienceVersion, 1);
  }
  putCanonical(f, document(1, { ...observerExtension(), schemaVersion: 2 }), format); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
test('prepared FILE follows canonical references and verifies projection lineage without reading source into diagnostics', () => fixture(f => {
  f.env.STUDIO_ADAPTIVE_FORMAT = 'file-v2'; f.setMarker({ ...ready(2), format: 'file-v2', fileAuthorityProjectionVersion: 1 });
  putCanonical(f, document(2, observerExtension()));
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).observerClientExperienceVersion, 1);
  const file = join(f.managed, 'stores', uuid, 'records', `${uuid}.json`); const doc = JSON.parse(readFileSync(file, 'utf8')); doc.syntheticPrivateCanary = 'PRIVATE_METADATA_SCAN_CANARY'; writeFileSync(file, JSON.stringify(doc));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), error => /incompatible/.test(error.message) && !error.message.includes('CANARY'));
}));
test('rights v1 remains baseline-compatible; rights v2 even empty requires tombstone-aware reader', () => fixture(f => {
  f.setMarker(ready(1)); putRights(f, 1); assert.equal(assertReleaseAdaptiveCompatibility(f.env, null).rightsLedgerVersion, undefined);
  const file = putRights(f, 2); const before = readFileSync(file);
  assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, baselineCapabilities), /incompatible/);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).rightsLedgerVersion, 2); assert.deepEqual(readFileSync(file), before);
  putRights(f, 3); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
test('empty experiments ledger still requires its reader; absent ledger preserves baseline compatibility', () => fixture(f => {
  f.setMarker(ready(1)); assert.equal(assertReleaseAdaptiveCompatibility(f.env, null).experimentLedgerSchema, undefined);
  putExperiments(f); assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, baselineCapabilities), /incompatible/);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).experimentLedgerSchema, 1);
  putExperiments(f, { schemaVersion: 2 }); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
test('unsafe separate stores, corrupt metadata and oversized canonical input fail closed without mutation', () => fixture(f => {
  f.setMarker(ready(1)); const file = putRights(f); const before = readFileSync(file); const target = join(f.dir, 'private-target.json'); writeFileSync(target, before); rmSync(file); symlinkSync(target, file);
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/); assert.deepEqual(readFileSync(target), before);
  rmSync(file); writeFileSync(file, 'x'.repeat(65537)); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  rmSync(join(f.env.STUDIO_DATA_DIR, 'rights-intake'), { recursive: true }); legacy(f); const dir = join(f.env.STUDIO_DATA_DIR, 'adaptive'); mkdirSync(dir); writeFileSync(join(dir, `${accountKey}.json`), ' '.repeat(700001));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
for (const extension of ['observer', 'rights', 'experiments']) test(`actual install/rollback refuse ${extension}-unaware release before network, launchctl or pointer swap`, () => cliFixture(f => {
  f.setMarker(ready(1));
  if (extension === 'observer') putCanonical(f, document(1, observerExtension())); else if (extension === 'rights') putRights(f); else putExperiments(f);
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES));
  const manifest = join(f.project, '.next', 'studio-release.json'), provenance = JSON.parse(readFileSync(manifest, 'utf8'));
  writeFileSync(manifest, JSON.stringify({ ...provenance, ...baselineCapabilities }));
  const install = f.invoke('install'); assert.equal(install.status, 1); assert.match(install.stderr, /Adaptive storage is incompatible/);
  const current = join(f.production, 'current-release'), previous = join(f.production, 'previous-release');
  for (const dir of [current, previous]) { mkdirSync(dir); writeFileSync(join(dir, 'server.js'), 'synthetic'); }
  writeFileSync(join(previous, 'studio-release.json'), JSON.stringify({ ...releaseMetadata, ...baselineCapabilities })); symlinkSync(current, join(f.production, 'current')); writeFileSync(join(f.production, 'previous'), previous);
  const rollback = f.invoke('rollback'); assert.equal(rollback.status, 1); assert.match(rollback.stderr, /Adaptive storage is incompatible/);
  assert.equal(existsSync(f.signal), false); assert.equal(existsSync(join(f.production, 'releases')), false); assert.equal(realpathSync(join(f.production, 'current')), realpathSync(current));
}));
test('SQLite scans current WAL metadata read-only without altering canonical or WAL bytes', () => fixture(f => {
  f.setMarker(ready(1)); const file = join(f.managed, 'stores', uuid), writer = new Database(file);
  try {
    writer.pragma('journal_mode = WAL'); const doc = document(1, observerExtension());
    writer.prepare('INSERT INTO accounts(account_key,account_id,canonical,canonical_digest) VALUES(?,?,?,?)').run(accountKey, accountId, JSON.stringify(doc), hash(doc));
    const before = readFileSync(file), wal = readFileSync(`${file}-wal`);
    assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).observerClientExperienceVersion, 1);
    assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, baselineCapabilities), /incompatible/);
    assert.deepEqual(readFileSync(file), before); assert.deepEqual(readFileSync(`${file}-wal`), wal);
  } finally { writer.close(); }
}));
test('unknown observer variants, corrupt canonical JSON and store identity mismatch cannot pass admission', () => fixture(f => {
  f.setMarker(ready(1)); putCanonical(f, document(1, { schemaVersion: 1, events: [{ schemaVersion: 1, version: 'vox-observer-v1', id: 'a'.repeat(64), outcome: 'future_outcome' }], projections: [] }));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  const file = join(f.managed, 'stores', uuid), db = new Database(file);
  try { db.prepare('UPDATE accounts SET canonical=?').run('{PRIVATE_CANARY'); } finally { db.close(); }
  assert.throws(() => requiredAdaptiveCapabilities(f.env), error => /incompatible/.test(error.message) && !error.message.includes('CANARY'));
  f.setMarker(ready(1)); const altered = new Database(file);
  try { altered.prepare('UPDATE store_meta SET json=?').run(JSON.stringify({ formatVersion: 1, schemaVersion: 1, incarnation: uuid, generation: 2, lifecycleWatermark: 200 })); } finally { altered.close(); }
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
test('malformed extension capability declarations never become implicit supported versions', () => fixture(f => {
  f.setMarker(ready(1));
  for (const key of ['supportedObserverClientExperienceVersions', 'supportedRightsLedgerVersions', 'supportedExperimentLedgerSchemas']) for (const value of [null, [9], [1, 1], '1'])
    assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, { ...ADAPTIVE_RELEASE_CAPABILITIES, [key]: value }), /incompatible/);
}));
test('guest namespace requires its reader even with admissions disabled; unknown versions refuse without mutation', () => fixture(f => {
  legacy(f); const directory = join(f.env.STUDIO_DATA_DIR, 'guest-rights', 'v1'); mkdirSync(directory, { recursive: true });
  const file = join(directory, createHash('sha256').update('guest-rights-ledger:v1').digest('hex')+'.json');
  const ledger = { schemaVersion: 1, keyId:'a'.repeat(64),revision:1,observedAt:200,admission:{windowStart:200,count:0},requests:[],tombstones:[],receipts:[] };
  writeFileSync(file, JSON.stringify(ledger)); const before=readFileSync(file);
  const {supportedGuestRightsLedgerSchemas: omitted,...old}=ADAPTIVE_RELEASE_CAPABILITIES; assert.deepEqual(omitted,[1]);
  assert.throws(()=>assertReleaseAdaptiveCompatibility(f.env,old),/incompatible/);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env,ADAPTIVE_RELEASE_CAPABILITIES).guestRightsLedgerSchema,1); assert.deepEqual(readFileSync(file),before);
  writeFileSync(file,JSON.stringify({...ledger,schemaVersion:2})); assert.throws(()=>requiredAdaptiveCapabilities(f.env),/incompatible/);
}));

// Small metadata-only fixtures for installer format admission. The workflow's
// independent tests validate real migrated records and signatures separately.
const workflowCanonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(workflowCanonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${workflowCanonical(value[key])}`).join(',')}}`;
const workflowHash = value => createHash('sha256').update(workflowCanonical(value)).digest('hex');
const workflowState = (version, generation = 1, at = 200) => ({
  findings: {}, proposals: {}, candidates: {}, revokedLineages: ['c'.repeat(64)], finalUses: ['d'.repeat(64)],
  protocolUses: [], rollbacks: {}, operations: {},
  ...(version === 2 ? { schemaVersion: 2, trustDigest: 'a'.repeat(64), registryId: uuid, generation, observedAt: at,
    learningCases: {}, learningCorpora: {}, withdrawnCases: ['e'.repeat(64)] } : {}),
});
function workflowEvent(version, sequence, previous, state = workflowState(version), patch = {}) {
  const body = { ...(version === 2 ? { schemaVersion: 2, kind: 'vox_improvement_audit' } : {}),
    sequence, previous, action: 'synthetic_fixture', operationId: `fixture_${sequence}`, at: state.observedAt ?? 100, state, ...patch };
  return { ...body, digest: workflowHash(version === 2 ? { domain: 'vox.improvement.audit.v2', body } : body) };
}
function putWorkflow(f, events) {
  const root = join(f.env.STUDIO_DATA_DIR, 'improvement-review'), audit = join(root, 'audit');
  rmSync(root, { force: true, recursive: true }); mkdirSync(audit, { recursive: true, mode: 0o700 });
  for (const event of events) writeFileSync(join(audit, `${String(event.sequence).padStart(10, '0')}.json`), JSON.stringify(event), { mode: 0o600 });
  return { root, audit, file: join(audit, '0000000001.json') };
}
test('workflow migration requires the v2 reader even with improvement runtime disabled, without data writes', () => fixture(f => {
  legacy(f);
  const v1 = workflowEvent(1, 1, '0'.repeat(64)), v2 = workflowEvent(2, 2, v1.digest);
  const paths = putWorkflow(f, [v1]);
  const { supportedImprovementWorkflowSchemas: omitted, ...old } = ADAPTIVE_RELEASE_CAPABILITIES;
  assert.deepEqual(omitted, [1, 2]);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, old).improvementWorkflowSchema, 1);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, null).improvementWorkflowSchema, 1);
  writeFileSync(join(paths.audit, '0000000002.json'), JSON.stringify(v2));
  const before = [1, 2].map(n => { const path = join(paths.audit, `000000000${n}.json`); return [readFileSync(path), lstatSync(path).mtimeMs]; });
  assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, old), /incompatible/);
  assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, null), /incompatible/);
  assert.equal(assertReleaseAdaptiveCompatibility(f.env, ADAPTIVE_RELEASE_CAPABILITIES).improvementWorkflowSchema, 2);
  assert.deepEqual([1, 2].map(n => { const path = join(paths.audit, `000000000${n}.json`); return [readFileSync(path), lstatSync(path).mtimeMs]; }), before);
}));
test('workflow admission refuses downgrade tails, changed identity/trust, regressed clocks and missing generations', () => fixture(f => {
  legacy(f);
  const first = workflowEvent(2, 1, '0'.repeat(64));
  const valid = workflowEvent(2, 2, first.digest, workflowState(2, 2, 201));
  putWorkflow(f, [first, valid]); assert.equal(requiredAdaptiveCapabilities(f.env).improvementWorkflowSchema, 2);
  for (const next of [
    workflowEvent(1, 2, first.digest),
    workflowEvent(2, 2, first.digest, workflowState(2, 1, 201)),
    workflowEvent(2, 2, first.digest, workflowState(2, 2, 199)),
    workflowEvent(2, 2, first.digest, { ...workflowState(2, 2, 201), trustDigest: 'b'.repeat(64) }),
    workflowEvent(2, 2, first.digest, { ...workflowState(2, 2, 201), registryId: '4cde5210-3599-4a0b-b34a-d74ebc815f18' }),
  ]) {
    putWorkflow(f, [first, next]); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  }
}));
test('workflow corrupt or future envelopes cannot become a legacy or empty ledger', () => fixture(f => {
  legacy(f);
  const first = workflowEvent(2, 1, '0'.repeat(64));
  for (const event of [
    { ...first, schemaVersion: 3 }, { ...first, digest: '0'.repeat(64) },
    workflowEvent(2, 1, '0'.repeat(64), { ...workflowState(2), schemaVersion: 3 }),
    workflowEvent(2, 1, '0'.repeat(64), { ...workflowState(2), learningCases: undefined }),
    workflowEvent(2, 1, '0'.repeat(64), { ...workflowState(2), raw: 'PRIVATE_CANARY' }),
    workflowEvent(2, 1, '0'.repeat(64), workflowState(2), { kind: 'unknown' }),
    workflowEvent(2, 1, '0'.repeat(64), workflowState(2), { unexpected: true }),
  ]) {
    putWorkflow(f, [event]);
    assert.throws(() => requiredAdaptiveCapabilities(f.env), error => /incompatible/.test(error.message) && !error.message.includes('CANARY'));
  }
  const p = putWorkflow(f, [first]); writeFileSync(p.file, '{PRIVATE_CANARY');
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
test('workflow scan refuses writer locks, gaps, unsafe files and oversized committed metadata', () => fixture(f => {
  legacy(f); const first = workflowEvent(2, 1, '0'.repeat(64));
  let p = putWorkflow(f, [first]); mkdirSync(join(p.root, 'writer.lock'));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  p = putWorkflow(f, [first]); writeFileSync(join(p.audit, '0000000003.json'), JSON.stringify(first));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  p = putWorkflow(f, [first]); const outside = join(f.dir, 'outside.json'); writeFileSync(outside, JSON.stringify(first));
  rmSync(p.file); symlinkSync(outside, p.file); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  rmSync(p.file); linkSync(outside, p.file); assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
  p = putWorkflow(f, [first]); writeFileSync(p.file, ' '.repeat(2_000_001));
  assert.throws(() => requiredAdaptiveCapabilities(f.env), /incompatible/);
}));
test('workflow capability declaration must be a supported unique version array', () => fixture(f => {
  legacy(f); putWorkflow(f, [workflowEvent(2, 1, '0'.repeat(64))]);
  for (const value of [null, [9], [1, 1], [1], [], '2']) {
    assert.throws(() => assertReleaseAdaptiveCompatibility(f.env, { ...ADAPTIVE_RELEASE_CAPABILITIES, supportedImprovementWorkflowSchemas: value }), /incompatible/);
  }
}));
