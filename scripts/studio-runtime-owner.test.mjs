/** Protected FRO1 fixtures. Real temporary FILE/processes; no production roots or providers. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ownerApi from './studio-file-runtime-owner.mjs';
import { ADAPTIVE_RELEASE_CAPABILITIES, assertReleaseAdaptiveCompatibility } from './studio-adaptive-compatibility.mjs';
import * as prior from './fixtures/runtime-owner-prior-reader/studio-adaptive-compatibility.mjs';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/runtime-owner-prior-reader/', import.meta.url));
const priorManifest = JSON.parse(readFileSync(join(fixtureDirectory, 'studio-release.json'), 'utf8'));
const admission = JSON.parse(readFileSync(join(fixtureDirectory, 'admission-fixture.json'), 'utf8'));
const release = Object.freeze({ revision: 'f895ba59fc43fe9677e08fa602cc48c08ccdf3f8',
  sourceTree: '9dddab6c6d5ed02ced0ac7f011cfb64f83f3cd44', buildId: 'synthetic-runtime-owner-only' });
const guardName = '.studio-runtime-owner-v1.lock';
const markerName = 'file-runtime-owner-v1.json';
const markerBytes = '{"version":1,"kind":"studio-file-runtime-owner"}\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

function snapshot(root) {
  const rows = [];
  function walk(path, relative = '') {
    const stat = lstatSync(path), row = { path: relative, mode: stat.mode & 0o777, links: stat.nlink };
    if (stat.isSymbolicLink()) { rows.push({ ...row, type: 'link', target: readlinkSync(path) }); return; }
    if (stat.isDirectory()) {
      rows.push({ ...row, type: 'directory' });
      for (const name of readdirSync(path).sort()) walk(join(path, name), relative ? `${relative}/${name}` : name);
      return;
    }
    assert.ok(stat.isFile(), 'fixture_contains_special_file');
    rows.push({ ...row, type: 'file', bytes: stat.size, sha256: digest(readFileSync(path)) });
  }
  walk(root); return rows;
}

async function temporary(run) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'vox-fro1-protected-')));
  const data = join(parent, 'data'); mkdirSync(data, { mode: 0o700 });
  try { return await run({ parent, data }); }
  finally { rmSync(parent, { recursive: true, force: true }); }
}

function acquire(data) { return ownerApi.acquireFileRuntimeOwner({ dataRoot: data, release }); }
function install(data) { const owner = acquire(data); ownerApi.installFileRuntimeOwnerMarker(owner); return owner; }
async function contenderFixture(run){
  const parent=realpathSync(mkdtempSync('/tmp/vox-fro1-binding-')),data=join(parent,'data'),artifact=join(parent,'artifact'),source=join(parent,'source');
  mkdirSync(data,{mode:0o700});mkdirSync(artifact,{mode:0o700});mkdirSync(source,{mode:0o700});mkdirSync(join(source,'.next'),{mode:0o700});mkdirSync(join(artifact,'.next'),{mode:0o700});mkdirSync(join(data,'adaptive'),{mode:0o700});
  writeFileSync(join(artifact,'server.js'),'// low-level unit artifact only; never executed or claimed as a Next build\n',{mode:0o600});writeFileSync(join(artifact,'.next','BUILD_ID'),release.buildId,{mode:0o600});
  writeFileSync(join(data,'adaptive',markerName),markerBytes,{mode:0o600});
  const identity=path=>{const s=lstatSync(path,{bigint:true});return{dev:String(s.dev),ino:String(s.ino),birth:String(s.birthtimeNs)};};
  writeFileSync(join(source,'.next','BUILD_ID'),release.buildId,{mode:0o600});
  const receipt={version:1,kind:'studio-file-runtime-fixture',fixtureId:randomUUID(),root:data,artifact,sourceRoot:source,rootIdentity:identity(data),artifactIdentity:identity(artifact),...release,providerBlocking:true,metadataSource:'next-build-source-binding'};
  const holder={version:1,kind:'studio-file-runtime-owner',role:'runtime',nonce:'e'.repeat(64),pid:process.pid,startedAt:1,release};
  const receiptPath=join(parent,'file-runtime-owner-fixture-v1.json'),guardPath=join(data,guardName);
  writeFileSync(receiptPath,JSON.stringify(receipt)+'\n',{mode:0o600});writeFileSync(guardPath,JSON.stringify(holder)+'\n',{mode:0o600});
  try{return await run({parent,data,artifact,receipt,holder,receiptPath,guardPath});}finally{rmSync(parent,{recursive:true,force:true});}
}

test('receipt-bound synthetic fixture registration is read-only and conveys no owner capability or same-root acquisition',()=>contenderFixture(({parent,data,artifact})=>{
  const before=snapshot(parent);ownerApi.registerFileRuntimeFixture({dataRoot:data,artifactRoot:artifact,release});
  assert.deepEqual(ownerApi.resolveFileRuntimeRelease(data),release);assert.deepEqual(snapshot(parent),before);
  assert.throws(()=>acquire(data));assert.throws(()=>ownerApi.fileRuntimeFs.writeFileSync(join(data,'forbidden.json'),'FORBIDDEN'));
  assert.deepEqual(snapshot(parent),before);
}));
test('receipt-bound synthetic fixture cannot rebind an owner already registered in this process',()=>contenderFixture(({parent,data,artifact,guardPath})=>{
  unlinkSync(guardPath);const owner=install(data),before=snapshot(parent);
  assert.throws(()=>ownerApi.registerFileRuntimeFixture({dataRoot:data,artifactRoot:artifact,release}));owner.assertCurrent();assert.deepEqual(snapshot(parent),before);owner.beginDrain();
}));
for(const damage of ['no-receipt','partial-guard','corrupt-guard','wrong-release','maintenance-holder','wrong-root-identity','wrong-artifact-identity','wrong-source-build','corrupt-marker','guard-link'])test(`receipt-bound synthetic fixture rejects ${damage} without adopting or changing the holder`,()=>contenderFixture(({parent,data,artifact,receipt,holder,receiptPath,guardPath})=>{
  if(damage==='no-receipt')unlinkSync(receiptPath);
  if(damage==='partial-guard')writeFileSync(guardPath,'{');
  if(damage==='corrupt-guard')writeFileSync(guardPath,JSON.stringify({...holder,extra:'FORBIDDEN'}));
  if(damage==='wrong-release')writeFileSync(guardPath,JSON.stringify({...holder,release:{...release,buildId:'other-synthetic-build'}}));
  if(damage==='maintenance-holder')writeFileSync(guardPath,JSON.stringify({...holder,role:'maintenance'}));
  if(damage==='wrong-root-identity')writeFileSync(receiptPath,JSON.stringify({...receipt,rootIdentity:{...receipt.rootIdentity,ino:'0'}}));
  if(damage==='wrong-artifact-identity')writeFileSync(receiptPath,JSON.stringify({...receipt,artifactIdentity:{...receipt.artifactIdentity,ino:'0'}}));
  if(damage==='wrong-source-build')writeFileSync(join(receipt.sourceRoot,'.next','BUILD_ID'),'other-build');
  if(damage==='corrupt-marker')writeFileSync(join(data,'adaptive',markerName),'{');
  if(damage==='guard-link')linkSync(guardPath,join(parent,'extra-guard-link'));
  const before=snapshot(parent);assert.throws(()=>ownerApi.registerFileRuntimeFixture({dataRoot:data,artifactRoot:artifact,release}));assert.deepEqual(snapshot(parent),before);
  assert.throws(()=>ownerApi.fileRuntimeFs.writeFileSync(join(data,'forbidden.json'),'FORBIDDEN'));assert.deepEqual(snapshot(parent),before);
}));
function scannerTree(data, { account = true, pets = false } = {}) {
  const adaptive = join(data, 'adaptive'); mkdirSync(adaptive, { mode: 0o700 });
  writeFileSync(join(adaptive, admission.markerName), admission.markerBytes, { mode: 0o600 });
  writeFileSync(join(adaptive, admission.v2MarkerName), admission.v2MarkerBytes, { mode: 0o600 });
  if (account) {
    const key = digest(admission.canonicalBase.accountId);
    writeFileSync(join(adaptive, `${key}.json`), JSON.stringify({ ...clone(admission.canonicalBase),
      assistantDeliveryControl: clone(admission.v2EmptyControl) }), { mode: 0o600 });
  }
  if (pets) {
    const base = join(data, 'pets'); mkdirSync(base, { mode: 0o700 });
    for (const name of ['play', 'growth', 'checkins', '.epochs']) mkdirSync(join(base, name), { mode: 0o700 });
    writeFileSync(join(base, 'qa-work.json'), JSON.stringify({ 70300: { v: 1, agentId: 'qa-work', userId: 70300 } }), { mode: 0o600 });
    writeFileSync(join(base, 'play', 'qa-work.json'), JSON.stringify({ 70300: admission.petPlay }), { mode: 0o600 });
    writeFileSync(join(base, 'growth', 'qa-work.json'), JSON.stringify(admission.petGrowth), { mode: 0o600 });
    writeFileSync(join(base, 'checkins', '70300.json'), JSON.stringify(admission.petCheckin), { mode: 0o600 });
    writeFileSync(join(base, '.epochs', '70300.json'), JSON.stringify(admission.petEpoch), { mode: 0o600 });
  }
  return { adaptive, env: { STUDIO_DATA_DIR: data, STUDIO_ADAPTIVE_FORMAT: 'file',
    STUDIO_TELEGRAM_ARCHIVE: '0', STUDIO_TELEGRAM_ARCHIVE_SNAPSHOTS: '0', STUDIO_ASSISTANT_TEXT_DELIVERY: '0' } };
}

function readOnlyCall(data, reader, env, manifest) {
  const before = snapshot(data);
  try { return reader.assertReleaseAdaptiveCompatibility(env, manifest); }
  finally { assert.deepEqual(snapshot(data), before, 'reader_mutated_fixture'); }
}

test('f895 oracle and actual accepted generated manifest remain byte-exact', () => {
  const expected = {
    'studio-adaptive-compatibility.mjs': '7d578fd25e35c93eab79d8a5a03f496c3b116d8ad7203d9f2a1e52669ae28d7c',
    'studio-release.json': 'c4360646ca6b0efdc0c01350a8c384cfde7014813212f815f3dd417b3eb2c4ba',
    'admission-fixture.json': 'b4af32d2ab1245b7f62eb8bda26df852987e9b74b7d1ac26cd2c6dab84582790',
  };
  for (const [name, hash] of Object.entries(expected)) assert.equal(digest(readFileSync(join(fixtureDirectory, name))), hash);
  assert.equal(priorManifest.revision, release.revision); assert.equal(priorManifest.sourceTree, release.sourceTree);
  assert.equal(Object.hasOwn(priorManifest, 'supportedFileRuntimeOwnerVersions'), false);
  for (const [name, value] of Object.entries(prior.ADAPTIVE_RELEASE_CAPABILITIES)) assert.deepEqual(priorManifest[name], value);
});

for (const account of [true, false]) test(`actual f895 positive ARC2/pets then ownership-marker refusal, account=${account}`, () => temporary(({ data }) => {
  const tree = scannerTree(data, { account, pets: true });
  const admitted = readOnlyCall(data, prior, tree.env, priorManifest);
  assert.equal(admitted.assistantDeliveryControlVersion, 2);
  assert.equal(admitted.petCareSchema, 1);
  for (const field of ['petPlaySchema', 'petGrowthSchema', 'petCheckinSchema']) assert.equal(admitted[field], 1);
  writeFileSync(join(tree.adaptive, markerName), markerBytes, { mode: 0o600 });
  assert.throws(() => readOnlyCall(data, prior, tree.env, priorManifest), /incompatible/);
  const current = readOnlyCall(data, { assertReleaseAdaptiveCompatibility }, tree.env, ADAPTIVE_RELEASE_CAPABILITIES);
  assert.equal(current.fileRuntimeOwnerVersion, 1); assert.equal(current.assistantDeliveryControlVersion, 2);
  for (const field of ['petCareSchema', 'petPlaySchema', 'petGrowthSchema', 'petCheckinSchema']) assert.equal(current[field], 1);
}));

for (const versions of [undefined, [], [0], [2], [1, 1], [1, 2], null]) test(`ownership marker requires exact supported version: ${JSON.stringify(versions)}`, () => temporary(({ data }) => {
  const tree = scannerTree(data, { account: false });
  writeFileSync(join(tree.adaptive, markerName), markerBytes, { mode: 0o600 });
  const candidate = { ...ADAPTIVE_RELEASE_CAPABILITIES };
  if (versions === undefined) delete candidate.supportedFileRuntimeOwnerVersions;
  else candidate.supportedFileRuntimeOwnerVersions = versions;
  assert.throws(() => readOnlyCall(data, { assertReleaseAdaptiveCompatibility }, tree.env, candidate), /incompatible/);
}));

for (const bytes of ['', markerBytes.trimEnd(), markerBytes + '\n', '{"kind":"studio-file-runtime-owner","version":1}\n',
  '{"version":2,"kind":"studio-file-runtime-owner"}\n']) test(`damaged ownership marker refuses: ${JSON.stringify(bytes)}`, () => temporary(({ data }) => {
  const tree = scannerTree(data, { account: false });
  writeFileSync(join(tree.adaptive, markerName), bytes, { mode: 0o600 });
  assert.throws(() => readOnlyCall(data, { assertReleaseAdaptiveCompatibility }, tree.env, ADAPTIVE_RELEASE_CAPABILITIES), /incompatible/);
}));

for (const type of ['symlink', 'hardlink']) test(`ownership marker ${type} refuses without mutation`, () => temporary(({ parent, data }) => {
  const tree = scannerTree(data, { account: false }), target = join(parent, 'marker-target');
  writeFileSync(target, markerBytes, { mode: 0o600 });
  if (type === 'symlink') symlinkSync(target, join(tree.adaptive, markerName));
  else linkSync(target, join(tree.adaptive, markerName));
  assert.throws(() => readOnlyCall(data, { assertReleaseAdaptiveCompatibility }, tree.env, ADAPTIVE_RELEASE_CAPABILITIES), /incompatible/);
}));

test('one process joins one exact owner without enrollment or account creation', () => temporary(({ data }) => {
  const owner = acquire(data); assert.equal(acquire(data), owner); assert.equal(owner.state, 'active');
  assert.equal(existsSync(join(data, 'adaptive')), false);
  const record = JSON.parse(readFileSync(join(data, guardName), 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['kind', 'nonce', 'pid', 'release', 'role', 'startedAt', 'version']);
  assert.equal(record.pid, process.pid); assert.equal(record.role, 'runtime'); assert.match(record.nonce, /^[a-f0-9]{64}$/);
  ownerApi.installFileRuntimeOwnerMarker(owner); owner.assertCurrent();
  assert.equal(readFileSync(join(data, 'adaptive', markerName), 'utf8'), markerBytes);
  assert.deepEqual(readdirSync(join(data, 'adaptive')), [markerName]);
  assert.equal(lstatSync(join(data, guardName)).mode & 0o777, 0o600);
}));

test('copied and duck-typed owner objects cannot install a marker', () => temporary(({ data }) => {
  const owner = acquire(data), before = snapshot(data);
  for (const fake of [{ ...owner }, { root: data, assertCurrent() {}, assertActive() {} }, JSON.parse(JSON.stringify(owner.snapshot()))]) {
    assert.throws(() => ownerApi.installFileRuntimeOwnerMarker(fake)); assert.deepEqual(snapshot(data), before);
  }
}));

test('guard-only acquisition prevents an unguarded second realm and fabricated inspection', () => temporary(({ data }) => {
  writeFileSync(join(data, guardName), '', { mode: 0o600 });
  const before = snapshot(data);
  assert.throws(() => acquire(data)); assert.throws(() => ownerApi.inspectFileRuntimeOwner(data));
  assert.throws(() => ownerApi.fileRuntimeFs.writeFileSync(join(data, 'forbidden.json'), '{}'));
  assert.deepEqual(snapshot(data), before);
}));

test('drain is terminal and leaves the lifetime guard and permanent marker intact', () => temporary(({ data }) => {
  const owner = install(data), guard = readFileSync(join(data, guardName));
  owner.beginDrain(); owner.beginDrain(); assert.equal(owner.signal.aborted, true);
  assert.throws(() => owner.assertActive()); assert.throws(() => acquire(data));
  assert.throws(() => ownerApi.fileRuntimeFs.writeFileSync(join(data, 'forbidden.json'), '{}'));
  assert.deepEqual(readFileSync(join(data, guardName)), guard);
  assert.equal(readFileSync(join(data, 'adaptive', markerName), 'utf8'), markerBytes);
}));

for (const damage of ['rewrite', 'replace', 'remove', 'mode', 'hardlink']) test(`owner ${damage} loss remains terminal after original bytes restored`, () => temporary(({ parent, data }) => {
  const owner = install(data), path = join(data, guardName), bytes = readFileSync(path);
  if (damage === 'rewrite') { const changed = JSON.parse(bytes); changed.startedAt++; writeFileSync(path, JSON.stringify(changed)); }
  if (damage === 'replace') { renameSync(path, join(parent, 'previous-holder')); writeFileSync(path, bytes, { mode: 0o600 }); }
  if (damage === 'remove') unlinkSync(path);
  if (damage === 'mode') chmodSync(path, 0o640);
  if (damage === 'hardlink') linkSync(path, join(parent, 'extra-holder-link'));
  assert.throws(() => owner.assertCurrent()); assert.equal(owner.state, 'lost'); assert.equal(owner.signal.aborted, true);
  if (damage === 'hardlink') unlinkSync(join(parent, 'extra-holder-link'));
  writeFileSync(path, bytes, { mode: 0o600 }); chmodSync(path, 0o600);
  assert.throws(() => owner.assertActive()); assert.throws(() => acquire(data));
  assert.throws(() => ownerApi.fileRuntimeFs.writeFileSync(join(data, 'forbidden.json'), '{}'));
}));

test('removing marker and guard cannot downgrade a registry-known root', () => temporary(({ data }) => {
  install(data); unlinkSync(join(data, guardName)); unlinkSync(join(data, 'adaptive', markerName));
  assert.throws(() => ownerApi.fileRuntimeFs.writeFileSync(join(data, 'forbidden.json'), '{}'));
  assert.equal(existsSync(join(data, 'forbidden.json')), false);
}));

test('lost cleanup can remove only its exact exclusively created staging file', () => temporary(({ data }) => {
  const owner = install(data), path = join(data, 'exact-owner-stage.tmp');
  ownerApi.prepareFileRuntimeTransient(path);
  const fd = ownerApi.fileRuntimeFs.openSync(path, 'wx', 0o600); ownerApi.fileRuntimeFs.closeSync(fd);
  owner.beginDrain(); ownerApi.fileRuntimeFs.unlinkSync(path);
  assert.equal(existsSync(path), false); assert.equal(existsSync(join(data, guardName)), true);
}));

test('lost cleanup never deletes canonical payload or another inode at a formerly owned temporary name', () => temporary(({ parent, data }) => {
  const owner = install(data), path = join(data, 'exact-owner-stage.tmp'), canonical = join(data, 'payload.json');
  ownerApi.prepareFileRuntimeTransient(path);
  const fd = ownerApi.fileRuntimeFs.openSync(path, 'wx', 0o600); ownerApi.fileRuntimeFs.closeSync(fd);
  ownerApi.fileRuntimeFs.writeFileSync(canonical, 'canonical');
  renameSync(path, join(parent, 'former-stage')); writeFileSync(path, 'new-holder-stage', { mode: 0o600 });
  owner.beginDrain();
  assert.throws(() => ownerApi.fileRuntimeFs.unlinkSync(path));
  assert.throws(() => ownerApi.fileRuntimeFs.unlinkSync(canonical));
  assert.equal(readFileSync(path, 'utf8'), 'new-holder-stage'); assert.equal(readFileSync(canonical, 'utf8'), 'canonical');
}));

for (const replace of ['parent', 'root']) test(`lost cleanup refuses changed ${replace} identity even when staging inode is preserved`, () => temporary(({ parent, data }) => {
  const owner = install(data), directory = join(data, 'stage'); mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, 'owner-stage.tmp'); ownerApi.prepareFileRuntimeTransient(path);
  const fd = ownerApi.fileRuntimeFs.openSync(path, 'wx', 0o600);
  ownerApi.fileRuntimeFs.closeSync(fd);
  const previous = join(parent, 'previous-tree');
  if (replace === 'parent') {
    renameSync(directory, previous); mkdirSync(directory, { mode: 0o700 }); renameSync(join(previous, 'owner-stage.tmp'), path);
  } else {
    renameSync(data, previous); mkdirSync(data, { mode: 0o700 }); mkdirSync(directory, { mode: 0o700 });
    renameSync(join(previous, 'stage/owner-stage.tmp'), path);
  }
  owner.beginDrain(); assert.throws(() => ownerApi.fileRuntimeFs.unlinkSync(path)); assert.equal(existsSync(path), true);
}));

for (const fence of [async () => {}, () => Promise.resolve(), () => ({ then() {} })]) test(`thenable/async commit fence refuses: ${fence.constructor.name}`, () => temporary(({ data }) => {
  install(data); const source = join(data, 'payload.tmp'), target = join(data, 'payload.json');
  writeFileSync(source, 'new'); writeFileSync(target, 'old');
  assert.throws(() => ownerApi.commitFileRuntimeRename(source, target, fence));
  assert.equal(readFileSync(target, 'utf8'), 'old'); assert.equal(readFileSync(source, 'utf8'), 'new');
}));

test('commit runs trusted fence after owner IO and catches its terminal drain without publication', () => temporary(({ data }) => {
  const owner = install(data), source = join(data, 'payload.tmp'), target = join(data, 'payload.json');
  writeFileSync(source, 'new'); writeFileSync(target, 'old'); let calls = 0;
  assert.throws(() => ownerApi.commitFileRuntimeRename(source, target, () => { calls++; owner.beginDrain(); }));
  assert.equal(calls, 1); assert.equal(readFileSync(target, 'utf8'), 'old');
}));

test('owned promise FileHandle cannot mutate or read canonical bytes after awaited loss', () => temporary(async ({ data }) => {
  const owner = install(data), path = join(data, 'payload.json');
  const handle = await ownerApi.fileRuntimePromises.open(path, 'wx+', 0o600);
  try {
    await handle.writeFile('positive'); assert.equal(readFileSync(path, 'utf8'), 'positive');
    owner.beginDrain();
    for (const action of [() => handle.writeFile('forbidden'), () => handle.truncate(0), () => handle.chmod(0o644), () => handle.readFile()]) {
      await assert.rejects(async () => action());
      assert.equal(readFileSync(path, 'utf8'), 'positive'); assert.equal(lstatSync(path).mode & 0o777, 0o600);
    }
  } finally { await handle.close(); }
}));

test('promise FileHandle numeric fd remains bound to the same live owner and inode', () => temporary(async ({ data }) => {
  const owner = install(data), path = join(data, 'payload.json');
  const handle = await ownerApi.fileRuntimePromises.open(path, 'wx+', 0o600);
  try {
    await handle.writeFile('positive');
    assert.equal(readFileSync(path, 'utf8'), 'positive');
    owner.beginDrain();
    assert.throws(() => ownerApi.fileRuntimeFs.writeFileSync(handle.fd, 'forbidden'));
    assert.equal(readFileSync(path, 'utf8'), 'positive');
  } finally { await handle.close(); }
}));

test('closed numeric descriptor cannot gain authority when its integer is reused for another file', () => temporary(async ({ data }) => {
  install(data); const original = join(data, 'original.json'), successor = join(data, 'successor.json');
  const handle = await ownerApi.fileRuntimePromises.open(original, 'wx+', 0o600), stale = handle.fd;
  await handle.writeFile('original'); await handle.close();
  // Raw fixture setup deliberately reuses a descriptor; no production writer
  // or owner capability is represented by an integer retained in an old closure.
  const replacement = openSync(successor, 'wx+', 0o600);
  try {
    assert.equal(replacement, stale, 'synthetic_descriptor_reuse_not_observed');
    writeFileSync(replacement, 'successor');
    assert.throws(() => ownerApi.fileRuntimeFs.writeFileSync(stale, 'forbidden'));
    assert.equal(readFileSync(successor, 'utf8'), 'successor');
  } finally { closeSync(replacement); }
}));

test('maintenance authority cannot be minted by a noop callback or serialized object', () => temporary(({ data }) => {
  for (const fake of [() => {}, { assertOwned() {}, check() {} }, {}, { version: 1, root: data }]) {
    assert.throws(() => ownerApi.createMaintenanceAuthorization(fake));
    assert.equal(existsSync(join(data, guardName)), false);
  }
}));

test('actual exclusive operation guard mints maintenance authority; clones and released epochs refuse', () => temporary(({ parent, data }) => {
  const base = join(parent, 'production'); mkdirSync(base, { mode: 0o700 });
  const operation = ownerApi.acquireFileRuntimeOperationGuard(base, 'backup');
  try {
    for (const fake of [{ ...operation }, { base, assertOwned: operation.assertOwned, release: operation.release },
      JSON.parse(JSON.stringify(operation))]) assert.throws(() => ownerApi.createMaintenanceAuthorization(fake));
    const authorization = ownerApi.createMaintenanceAuthorization(operation);
    const first = ownerApi.acquireFileRuntimeOwner({ dataRoot: data, release, role: 'maintenance', authorization });
    assert.equal(first.state, 'active'); assert.equal(existsSync(join(data, 'adaptive')), false);
    ownerApi.releaseMaintenanceFileRuntimeOwner(first, authorization);
    assert.equal(existsSync(join(data, guardName)), false); assert.throws(() => first.assertActive());
    // No child was started in this utility fixture; the release layer separately
    // proves actual child exit before using this explicit successor operation.
    const second = ownerApi.acquireFileRuntimeOwner({ dataRoot: data, release, role: 'maintenance', authorization });
    assert.notEqual(second, first); ownerApi.releaseMaintenanceFileRuntimeOwner(second, authorization);
    operation.release();
    assert.throws(() => ownerApi.createMaintenanceAuthorization(operation));
    assert.throws(() => ownerApi.acquireFileRuntimeOwner({ dataRoot: data, release, role: 'maintenance', authorization }));
    assert.equal(existsSync(join(data, guardName)), false);
  } finally { if (existsSync(join(base, '.studio-operation.lock'))) operation.release(); }
}));

test('even a genuine operation guard and noop assertion cannot retire this live runtime holder', () => temporary(({ parent, data }) => {
  const owner = install(data), expected = owner.snapshot(), before = readFileSync(join(data, guardName));
  const base = join(parent, 'production'); mkdirSync(base, { mode: 0o700 });
  const operation = ownerApi.acquireFileRuntimeOperationGuard(base, 'stop');
  try {
    const authorization = ownerApi.createMaintenanceAuthorization(operation);
    assert.throws(() => ownerApi.retireStoppedFileRuntimeOwner({ dataRoot: data, expected, authorization, assertStopped() {} }));
    assert.deepEqual(readFileSync(join(data, guardName)), before); owner.assertCurrent(); assert.equal(owner.state, 'active');
  } finally { operation.release(); }
}));

const processCode = `
import * as api from ${JSON.stringify(new URL('./studio-file-runtime-owner.mjs', import.meta.url).href)};
const dataRoot=process.argv[1], release=JSON.parse(process.argv[2]);
try {
  const owner=api.acquireFileRuntimeOwner({dataRoot,release});
  api.fileRuntimeFs.writeFileSync(dataRoot+'/admitted.json',JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
  process.send({admitted:true,pid:process.pid});
  process.on('message',()=>process.exit(0));
} catch { process.send({admitted:false,pid:process.pid},()=>process.exit(23)); }
`;
function launch(data, identity = release) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', processCode, data, JSON.stringify(identity)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let error = ''; child.stderr.on('data', bytes => { error += bytes; });
  const result = new Promise((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    child.once('exit', code => { if (code !== 0 && code !== 23) reject(new Error(`synthetic_child_failed:${code}:${error.length}`)); });
  });
  return { child, result };
}

test('real competing Node processes admit exactly one writer and retain crash-stale holder', { timeout: 10000 }, () => temporary(async ({ data }) => {
  const children = [launch(data), launch(data)];
  try {
    const results = await Promise.all(children.map(child => child.result));
    assert.equal(results.filter(row => row.admitted).length, 1); assert.equal(results.filter(row => !row.admitted).length, 1);
    const winner = results.find(row => row.admitted);
    assert.equal(JSON.parse(readFileSync(join(data, 'admitted.json'), 'utf8')).pid, winner.pid);
    const before = readFileSync(join(data, guardName));
    const alive = children.find(row => row.child.pid === winner.pid);
    await new Promise(resolve => { alive.child.once('exit', resolve); alive.child.kill('SIGKILL'); });
    assert.deepEqual(readFileSync(join(data, guardName)), before);
    assert.throws(() => acquire(data)); assert.deepEqual(readFileSync(join(data, guardName)), before);
  } finally { for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}));

test('managed resolver qualifies identity before acquisition bootstraps only the missing final private data root',{timeout:10000},()=>temporary(async({parent,data})=>{
  rmSync(data,{recursive:true});const artifact=join(parent,'synthetic-managed-artifact');mkdirSync(artifact,{mode:0o700});mkdirSync(join(artifact,'.next'),{mode:0o700});
  writeFileSync(join(artifact,'revision'),release.revision+'\n',{mode:0o600});writeFileSync(join(artifact,'studio-release.json'),JSON.stringify(release)+'\n',{mode:0o600});writeFileSync(join(artifact,'.next','BUILD_ID'),release.buildId+'\n',{mode:0o600});
  writeFileSync(join(artifact,'package.json'),'{"type":"module"}\n',{mode:0o600});
  const entry=join(artifact,'server.js');writeFileSync(entry,`const api=await import(${JSON.stringify(new URL('./studio-file-runtime-owner.mjs',import.meta.url).href)});
    const dataRoot=process.argv[2];const identity=api.resolveFileRuntimeRelease(dataRoot);
    const fs=await import('node:fs');if(fs.existsSync(dataRoot))throw Error('resolver mutated missing data root');
    const owner=api.acquireFileRuntimeOwner({dataRoot,release:identity});api.installFileRuntimeOwnerMarker(owner);process.send({identity,root:owner.root},()=>process.exit(0));`,{mode:0o600});
  // Explicit synthetic managed-artifact resolver unit; it does not claim this
  // source-only stub is a built or installable production release.
  const child=spawn(process.execPath,[entry,data],{cwd:artifact,env:{NODE_ENV:'production',STUDIO_REVISION:release.revision},stdio:['ignore','pipe','pipe','ipc']});
  const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const message=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error(`managed_bootstrap_failed:${code}`)));});
  assert.deepEqual(message.identity,release);assert.equal(message.root,data);assert.deepEqual(await exit,{code:0,signal:null});
  assert.equal(lstatSync(data).mode&0o777,0o700);assert.deepEqual(readdirSync(join(data,'adaptive')),[markerName]);
}));

test('bounded synthetic owner and final FILE fence timing reports fixed distributions independently of correctness',()=>temporary(({data})=>{
  const owner=install(data),ownerSamples=[],commitSamples=[];let callbacks=0;
  const elapsed=start=>Number(process.hrtime.bigint()-start)/1e6;
  for(let i=0;i<128;i++){const start=process.hrtime.bigint();owner.assertCurrent();ownerSamples.push(elapsed(start));}
  const target=join(data,'timing-canonical.json');
  for(let i=0;i<64;i++){
    const stage=join(data,`timing-stage-${i}.tmp`);writeFileSync(stage,JSON.stringify({synthetic:i}),{mode:0o600});
    const deadline=Date.now()+5000,start=process.hrtime.bigint();
    ownerApi.commitFileRuntimeRename(stage,target,()=>{callbacks++;assert.ok(Date.now()<deadline,'synthetic_final_deadline');});
    commitSamples.push(elapsed(start));assert.equal(JSON.parse(readFileSync(target)).synthetic,i);
  }
  assert.equal(callbacks,64);
  const distribution=values=>{const sorted=[...values].sort((a,b)=>a-b);return{samples:values.length,p50Ms:sorted[Math.ceil(sorted.length*.50)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1)};};
  console.info('FRO1_SYNTHETIC_FENCE_TIMING',JSON.stringify({ownerValidation:distribution(ownerSamples),ownerAndFinalFenceRename:distribution(commitSamples),deadlineCallbacks:callbacks,
    thresholdValidated:false,providerCalls:0,modelCalls:0,note:'Bounded local filesystem diagnostic; no production latency, overhead delta, cost or activation claim'}));
}));

const builtNext = process.env.FRO1_BUILT_NEXT === '1';
test('actual built Next instrumentation, guest and health bundles share one owner; separate process refuses', {
  skip: builtNext ? false : 'UNAVAILABLE: actual built Next qualification requires separate frozen build/run authorization', timeout: 60000,
}, async () => {
  assert.match(process.env.FRO1_EXPECTED_REVISION ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.FRO1_EXPECTED_TREE ?? '', /^[a-f0-9]{40}$/);
  if (process.env.FRO1_SOURCE_FREEZE_SHA256) assert.match(process.env.FRO1_SOURCE_FREEZE_SHA256, /^[a-f0-9]{64}$/);
  assert.match(process.env.FRO1_BUILD_PROOF_SHA256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(process.env.FRO1_EXPECTED_BUILD_ID, 'explicit_qualified_build_required');
  const parent = realpathSync(mkdtempSync('/tmp/vox-fro1-built-next-'));
  let stdout = '', stderr = '', child, metadata, nextContender, contenderStdout='', contenderStderr='';
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const launcher = spawn(process.execPath, ['e2e/start-guest-rights-server.mjs', 'ownership'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { PATH: process.env.PATH, GUEST_RUNTIME_DIR: parent, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  launcher.stdout.on('data', bytes => { stdout += bytes; }); launcher.stderr.on('data', bytes => { stderr += bytes; });
  try {
    for (let attempt = 0; attempt < 200 && !metadata; attempt++) {
      for (const name of readdirSync(parent)) {
        const path = join(parent, name, 'fixture-metadata.json');
        if (existsSync(path)) { const value = JSON.parse(readFileSync(path, 'utf8')); if (value.childPid) metadata = value; }
      }
      if (!metadata) await delay(100);
      if (launcher.exitCode !== null) throw new Error('synthetic_next_launcher_exited_before_metadata');
    }
    assert.ok(metadata, 'synthetic_next_metadata_unavailable');
    assert.equal(metadata.revision, process.env.FRO1_EXPECTED_REVISION); assert.equal(metadata.sourceTree, process.env.FRO1_EXPECTED_TREE);
    assert.equal(metadata.buildId, process.env.FRO1_EXPECTED_BUILD_ID);
    let healthy;
    for (let attempt = 0; attempt < 200 && !healthy; attempt++) {
      const result = await fetch('http://127.0.0.1:3194/api/studio/health', { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (result?.status === 200) healthy = await result.json(); else await delay(100);
    }
    assert.ok(healthy, 'actual_next_never_became_healthy');
    assert.equal(healthy.status, 'healthy'); assert.equal(healthy.revision, metadata.revision); assert.equal(healthy.bots, true);
    const path = join(metadata.data, guardName), before = readFileSync(path), statBefore = lstatSync(path);
    assert.equal(JSON.parse(before).pid, metadata.childPid, 'owner_is_not_actual_next_child');
    const guest = await fetch('http://127.0.0.1:3194/api/guest-rights', { signal: AbortSignal.timeout(2000) });
    assert.equal(guest.status, 200); assert.equal((await guest.json()).available, true);
    const again = await fetch('http://127.0.0.1:3194/api/studio/health', { signal: AbortSignal.timeout(2000) }); assert.equal(again.status, 200);
    assert.deepEqual(readFileSync(path), before); assert.equal(lstatSync(path).ino, statBefore.ino);
    assert.deepEqual(readdirSync(join(metadata.data, 'adaptive')), [markerName], 'runtime_boot_created_canonical_or_ARC_state');
    const baseline = snapshot(metadata.data);
    child = launch(metadata.data, { revision: metadata.revision, sourceTree: metadata.sourceTree, buildId: metadata.buildId });
    const contender = await child.result; assert.equal(contender.admitted, false); assert.deepEqual(snapshot(metadata.data), baseline);
    // This second process is the exact copied standalone server, not a helper
    // standing in for another Next runtime. Its preload has the same bounded
    // fixture binding but a separate provider-attempt counter outside the data.
    const contenderMetrics=join(parent,'contender-provider-metrics.json');
    assert.ok(metadata.contenderEnvironment,'actual_runtime_launch_binding_missing');
    nextContender=spawn(process.execPath,[join(metadata.runtime,'server.js')],{cwd:metadata.runtime,
      env:{...metadata.contenderEnvironment,PATH:process.env.PATH,PORT:'3195',FRO1_PROVIDER_METRICS:contenderMetrics},stdio:['ignore','pipe','pipe']});
    nextContender.stdout.on('data',bytes=>{contenderStdout+=bytes;});nextContender.stderr.on('data',bytes=>{contenderStderr+=bytes;});
    const secondExit=await Promise.race([new Promise((resolve,reject)=>{nextContender.once('error',reject);nextContender.once('exit',(code,signal)=>resolve({code,signal}));}),delay(15000).then(()=>{throw Error('second_actual_next_failed_to_refuse_boot');})]);
    assert.notEqual(secondExit.code,0,'second_runtime_reported_success');assert.equal(secondExit.signal,null);
    const refusedMetrics=JSON.parse(readFileSync(contenderMetrics,'utf8'));assert.equal(refusedMetrics.denied,0);assert.deepEqual(refusedMetrics.injected,{});
    assert.deepEqual(snapshot(metadata.data),baseline,'second_actual_next_changed_data_before_refusal');
    const metrics = JSON.parse(readFileSync(metadata.providerMetrics, 'utf8'));
    assert.equal(metrics.denied, 0); assert.equal(metrics.injected.getMe, 1);
    assert.equal(Object.hasOwn(metrics.injected, 'sendMessage'), false);
    // A real compiled request must consume the guard, not merely inherit a
    // preload-created marker or return healthy from a cached boolean.
    unlinkSync(path);
    const lost = await fetch('http://127.0.0.1:3194/api/studio/health', { signal: AbortSignal.timeout(2000) }); assert.equal(lost.status, 503);
    console.info('FRO1_BUILT_NEXT_QUALIFICATION', JSON.stringify({ revision: metadata.revision, tree: metadata.sourceTree, buildId: metadata.buildId,
      sourceFreeze: process.env.FRO1_SOURCE_FREEZE_SHA256 ?? null, buildProof: process.env.FRO1_BUILD_PROOF_SHA256,
      sameOwner: true, contenderWriterAdmissions: 0, actualNextContenderExit:secondExit.code, actualNextContenderProviderCalls:0, injectedGetMe: 1, actualProviderCalls: 0,
      lossHealthStatus: 503, canonicalAccountsCreated: 0, evidence: parent }));
  } finally {
    if(nextContender&&nextContender.exitCode===null&&nextContender.signalCode===null)nextContender.kill('SIGKILL');
    if (child && child.child.exitCode === null && child.child.signalCode === null) child.child.kill('SIGKILL');
    if (launcher.exitCode === null && launcher.signalCode === null) {
      const exited = new Promise(resolve => launcher.once('exit', resolve)); launcher.kill('SIGTERM');
      await Promise.race([exited, delay(10000)]);
      if (launcher.exitCode === null && launcher.signalCode === null) { launcher.kill('SIGKILL'); await exited; }
    }
    writeFileSync(join(parent, 'launcher.stdout.log'), stdout, { mode: 0o600 });
    writeFileSync(join(parent, 'launcher.stderr.log'), stderr, { mode: 0o600 });
    writeFileSync(join(parent,'contender.stdout.log'),contenderStdout,{mode:0o600});writeFileSync(join(parent,'contender.stderr.log'),contenderStderr,{mode:0o600});
    // Preserve the synthetic fixture and raw failure/success logs. No automatic
    // cleanup/retry disguises a bad realm, startup or ownership observation.
    console.info('FRO1_BUILT_NEXT_RETAINED_EVIDENCE', parent);
  }
});
