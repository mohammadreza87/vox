/** Portable reader/exclusion portion of MI1. No native proof or compiled
 * runtime is inferred from these checks. Actual C73-C76 need artifact GO. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ADAPTIVE_RELEASE_CAPABILITIES, assertReleaseAdaptiveCompatibility } from './studio-adaptive-compatibility.mjs';
import { assertReleaseAdaptiveCompatibility as old9e } from './fixtures/memory-account-prior-reader/studio-adaptive-compatibility.mjs';
import { assertReleaseAdaptiveCompatibility as oldAe } from './fixtures/memory-account-managed-prior-reader/studio-adaptive-compatibility.mjs';
import { hash, image, withManagedTimeFixture } from './fixtures/memory-account-managed-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const oracle = name => {
  const directory = join(root, 'scripts', 'fixtures', name), frozen = JSON.parse(fs.readFileSync(join(directory, 'manifest.json'), 'utf8'));
  for (const [file, meta] of Object.entries(frozen.files)) assert.equal(hash(fs.readFileSync(join(directory, file))), meta.sha256, `frozen_oracle_changed:${file}`);
  return JSON.parse(fs.readFileSync(join(directory, 'studio-release.json'), 'utf8'));
};
const nine = oracle('memory-account-prior-reader'), ae = oracle('memory-account-managed-prior-reader');

test('C67/C71: actual frozen9e and ae readers admit a valid unmarked FILE root', () => withManagedTimeFixture(f => {
  const before = image(f.parent), env = { STUDIO_DATA_DIR: f.dataRoot };
  assert.doesNotThrow(() => old9e(env, nine)); assert.doesNotThrow(() => oldAe(env, ae));
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));
test('C68: ae lifecycle parser can read a pair but cannot satisfy the new operational capability requirement', () => withManagedTimeFixture(f => {
  f.mark(); const before = image(f.parent), env = { STUDIO_DATA_DIR: f.dataRoot };
  assert.doesNotThrow(() => oldAe(env, ae));
  assert.throws(() => old9e(env, nine));
  assert.throws(() => assertReleaseAdaptiveCompatibility(env, ae));
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));
test('C69: every prior ae capability is preserved; the managed parser flag alone claims no qualified runtime', () => {
  for (const [name, value] of Object.entries(ae)) if (name.startsWith('supported') || name.endsWith('EnforcementVersion')) assert.deepEqual(ADAPTIVE_RELEASE_CAPABILITIES[name], value, `prior_capability_changed:${name}`);
  assert.deepEqual(ADAPTIVE_RELEASE_CAPABILITIES.supportedMemoryAccountManagedRuntimeVersions, [1]);
});
for (const state of ['time-only', 'marker-only', 'bad-marker', 'bad-time', 'future-time', 'noncanonical-time', 'linked-time', 'public-time']) {
  test(`C70: actual readers refuse ${state} even with feature switches off and no accounts`, () => withManagedTimeFixture(f => {
    f.mark(); const marker = join(f.directory, 'memory-account-lifecycle-v1.json'), time = join(f.directory, 'memory-account-time-v1.json');
    if (state === 'time-only') fs.unlinkSync(marker);
    if (state === 'marker-only') fs.unlinkSync(time);
    if (state === 'bad-marker') fs.writeFileSync(marker, '{}\n', { mode: 0o600 });
    if (state === 'bad-time') fs.writeFileSync(time, '{', { mode: 0o600 });
    if (state === 'future-time') fs.writeFileSync(time, '{"version":2,"highWaterMs":1}\n', { mode: 0o600 });
    if (state === 'noncanonical-time') fs.writeFileSync(time, fs.readFileSync(time, 'utf8') + '\n', { mode: 0o600 });
    if (state === 'linked-time') fs.linkSync(time, join(f.parent, 'time-hardlink'));
    if (state === 'public-time') fs.chmodSync(time, 0o640);
    const before = image(f.parent), env = { STUDIO_DATA_DIR: f.dataRoot, STUDIO_ASSISTANT_TEXT_DELIVERY: '0', STUDIO_TELEGRAM_ARCHIVE_SNAPSHOTS: '0' };
    assert.throws(() => old9e(env, nine)); assert.throws(() => oldAe(env, ae));
    assert.throws(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
    assert.deepEqual(image(f.parent), before);
  }));
}
test('C70: paired empty-root admission is only a reader shape, not proof of physical erasure or enrollment', () => withManagedTimeFixture(f => {
  f.mark(); const before = image(f.parent);
  assert.doesNotThrow(() => assertReleaseAdaptiveCompatibility({ STUDIO_DATA_DIR: f.dataRoot }, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));
test('C70: removing already observed permanent controls is refused rather than resetting to legacy', () => withManagedTimeFixture(f => {
  f.mark(); const env = { STUDIO_DATA_DIR: f.dataRoot };
  assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES);
  fs.unlinkSync(join(f.directory, 'memory-account-lifecycle-v1.json')); fs.unlinkSync(join(f.directory, 'memory-account-time-v1.json'));
  const before = image(f.parent); assert.throws(() => assertReleaseAdaptiveCompatibility(env, ADAPTIVE_RELEASE_CAPABILITIES));
  assert.deepEqual(image(f.parent), before);
}));

test('C05/C06: a real separate source process cannot acquire the held FILE writer; no native identity proof is claimed', () => withManagedTimeFixture(f => {
  const before = image(f.parent), url = new URL('./studio-file-runtime-owner.mjs', import.meta.url).href;
  const code = `import net from'node:net';import http from'node:http';import https from'node:https';
    let denied=0;const deny=()=>{denied++;throw Error('QA_NETWORK_DENIED')};globalThis.fetch=deny;net.Socket.prototype.connect=deny;http.request=deny;http.get=deny;https.request=deny;https.get=deny;
    const api=await import(${JSON.stringify(url)});let admitted=false;try{api.acquireFileRuntimeOwner({dataRoot:${JSON.stringify(f.dataRoot)},release:${JSON.stringify(f.release)}});admitted=true}catch{}
    process.stdout.write(JSON.stringify({admitted,denied}));process.exitCode=admitted?9:0;`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: f.base, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { admitted: false, denied: 0 });
  assert.deepEqual(image(f.parent), before); f.owner.assertCurrent();
}));

// No default .next/current/3107 or real launchd label is selected here.
// Actual built C73-C76 and all native managed positives are a separately
// frozen Phase-B command packet after registered topology/isolation review.
