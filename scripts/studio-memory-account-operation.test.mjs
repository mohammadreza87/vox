/** Portable MI1 strict-state/refusal tests. A parsed record is deliberately NOT
 * a capability. Actual native/controller/publication positives are Phase B. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as operation from './studio-memory-account-operation.mjs';
import { UTC_BASE, withManagedTimeFixture, createManagedTimeFixture, image } from './fixtures/memory-account-managed-fixture.mjs';

const id = () => ({ dev: '1', ino: '2', birth: '3' });
function record() {
  return { version: 1, kind: 'memory-account-initialization', operationId: randomUUID(), revision: 0, previousDigest: null, phase: 'prepared',
    baseIdentity: id(), rootIdentity: id(), adaptiveIdentity: id(), currentDigest: 'a'.repeat(64), configurationDigest: 'b'.repeat(64),
    targetArtifactDigest: 'c'.repeat(64), targetRelease: { revision: 'd'.repeat(40), sourceTree: 'e'.repeat(40), buildId: 'MI1-parser-fixture-not-a-runtime' },
    operationGuardDigest: 'f'.repeat(64), controllerIdentity: [1400000001, 1, 501, 1400000001, '101', '1700000000', '1'],
    terminalWitnessDigest: null, maintenanceHolderDigest: null, timePolicyDigest: '1'.repeat(64), protectiveQualificationDigest: '2'.repeat(64),
    initialControlDigest: '3'.repeat(64), observedControlDigest: '4'.repeat(64), inventoryDigest: '5'.repeat(64),
    createdAt: UTC_BASE, retainUntil: UTC_BASE + 86400000, reason: 'none', transients: [] };
}
const bytes = value => JSON.stringify(value) + '\n';

test('C62: strict bounded record can be parsed without granting operation or FILE authority', () => {
  const value = record(); assert.deepEqual(operation.parseManagedMemoryAccountOperation(bytes(value)), value);
  assert.throws(() => operation.readManagedMemoryAccountOperation(value));
  assert.throws(() => operation.assertManagedMemoryAccountOperation(value));
});
for (const [name, alter] of Object.entries({
  'future version': r => ({ ...r, version: 2 }),
  'unknown owner list': r => ({ ...r, accounts: ['FORBIDDEN_OWNER'] }),
  'wrong initial predecessor': r => ({ ...r, previousDigest: 'a'.repeat(64) }),
  'missing successor predecessor': r => ({ ...r, revision: 1 }),
  'refreshed retention': r => ({ ...r, retainUntil: r.retainUntil + 1 }),
  'expired deadline overflow': r => ({ ...r, retainUntil: Number.MAX_SAFE_INTEGER + 1 }),
  'unknown phase': r => ({ ...r, phase: 'pretend-complete' }),
  'unknown reason': r => ({ ...r, reason: 'raw-provider-secret' }),
  'bad native PID': r => ({ ...r, controllerIdentity: [0, 1, 501, 1, '101', '1', '0'] }),
  'unsafe native precision': r => ({ ...r, controllerIdentity: [1, 1, 501, 1, '18446744073709551616', '1', '0'] }),
  'native micros out of range': r => ({ ...r, controllerIdentity: [1, 1, 501, 1, '101', '1', '1000000'] }),
  'unknown path identity field': r => ({ ...r, rootIdentity: { ...r.rootIdentity, path: '/FORBIDDEN' } }),
  'too many transient rows': r => ({ ...r, transients: ['time', 'marker', 'record'].map(purpose => ({ purpose, basename: randomUUID(), state: 'planned', identity: null, digest: null })) }),
  'duplicate transient purpose': r => ({ ...r, transients: ['time', 'time'].map(purpose => ({ purpose, basename: randomUUID(), state: 'planned', identity: null, digest: null })) }),
  'self-registering record temp': r => ({ ...r, transients: [{ purpose: 'record', basename: randomUUID(), state: 'planned', identity: null, digest: null }] }),
  'invented planned temp identity': r => ({ ...r, transients: [{ purpose: 'time', basename: randomUUID(), state: 'planned', identity: id(), digest: null }] }),
  'created temp missing digest': r => ({ ...r, transients: [{ purpose: 'time', basename: randomUUID(), state: 'created', identity: id(), digest: null }] }),
})) test(`C62/C66: ${name} is rejected by the actual parser`, () => assert.throws(() => operation.parseManagedMemoryAccountOperation(bytes(alter(record())))));

test('C62: raw negative zero revision is rejected before canonical JSON can hide it', () => {
  assert.throws(() => operation.parseManagedMemoryAccountOperation(bytes(record()).replace('"revision":0', '"revision":-0')));
});

for (const field of ['currentDigest', 'configurationDigest', 'targetArtifactDigest', 'operationGuardDigest', 'timePolicyDigest', 'protectiveQualificationDigest', 'initialControlDigest', 'observedControlDigest', 'inventoryDigest']) {
  test(`C62: ${field} rejects terminal LF rather than accepting a matching hash prefix`, () => {
    const r = record(); r[field] += '\n'; assert.throws(() => operation.parseManagedMemoryAccountOperation(bytes(r)));
  });
}
for (const [name, transform] of Object.entries({
  BOM: b => '\uFEFF' + b,
  'extra newline': b => b + '\n',
  'pretty JSON': b => JSON.stringify(JSON.parse(b), null, 2) + '\n',
  truncated: b => b.slice(0, -3),
  oversized: () => 'X'.repeat(16385),
})) test(`C62: ${name} metadata is not silently normalized`, () => assert.throws(() => operation.parseManagedMemoryAccountOperation(transform(bytes(record())))));

test('C72: absent MI1 record is a noncreating read; well-shaped pending metadata blocks ordinary admission', () => withManagedTimeFixture(f => {
  const before = image(f.parent);
  assert.equal(operation.readManagedMemoryAccountOperationRecord(f.base), null);
  assert.doesNotThrow(() => operation.assertNoPendingMemoryAccountOperation(f.base));
  assert.deepEqual(image(f.parent), before);
  fs.writeFileSync(join(f.base, operation.MEMORY_ACCOUNT_OPERATION_FILE), bytes(record()), { mode: 0o600 });
  const pending = image(f.parent);
  assert.throws(() => operation.assertNoPendingMemoryAccountOperation(f.base));
  assert.deepEqual(image(f.parent), pending);
}));
test('C38/C72: an unexplained record-replacement temp holds without wildcard deletion', () => withManagedTimeFixture(f => {
  const p = join(f.base, `.memory-account-initialization-v1.${randomUUID()}.1.tmp`);
  fs.writeFileSync(p, bytes(record()), { mode: 0o600 }); const before = image(f.parent);
  assert.throws(() => operation.assertNoPendingMemoryAccountOperation(f.base));
  assert.deepEqual(image(f.parent), before); assert.ok(fs.existsSync(p));
}));
for (const fault of ['mode', 'symlink', 'hardlink', 'oversize']) test(`C37/C62: private record ${fault} refuses with unchanged bytes`, () => withManagedTimeFixture(f => {
  const p = join(f.base, operation.MEMORY_ACCOUNT_OPERATION_FILE), copy = join(f.parent, 'own-record-copy');
  fs.writeFileSync(copy, bytes(record()), { mode: 0o600 });
  if (fault === 'symlink') fs.symlinkSync(copy, p);
  else if (fault === 'hardlink') fs.linkSync(copy, p);
  else fs.writeFileSync(p, fault === 'oversize' ? 'X'.repeat(16385) : bytes(record()), { mode: fault === 'mode' ? 0o640 : 0o600 });
  const before = image(f.parent); assert.throws(() => operation.readManagedMemoryAccountOperationRecord(f.base));
  assert.deepEqual(image(f.parent), before);
}));

test('C08/C10: actual maintenance owner and genuine signed time do not grant a generic backup guard MI1 publication authority', () => withManagedTimeFixture(async f => {
  const permit = await f.acquire(), before = image(f.parent);
  assert.throws(() => operation.createManagedMemoryAccountOperation({ guard: f.guard, owner: f.owner, authorization: f.authorization, time: permit, action: 'initialize' }));
  assert.deepEqual(image(f.parent), before);
}));
test('C08/C09/QF02: caller-shaped preflight, callbacks and receipts never construct authority', () => {
  let invoked = 0;
  const fake = { assertCurrent() { invoked++; }, sampleNow() { invoked++; return { nowMs: UTC_BASE, utcLowerMs: UTC_BASE, utcUpperMs: UTC_BASE }; },
    dataRoot: '/NOT_A_REAL_ROOT', policyDigest: 'a'.repeat(64), result: 'passed' };
  assert.throws(() => operation.readManagedMemoryAccountPreflight(fake));
  assert.throws(() => operation.registerSyntheticManagedMemoryAccountQualification({ binding: fake, preflight: fake }));
  assert.throws(() => operation.readManagedMemoryAccountOperation(fake));
  assert.equal(invoked, 0);
});

// True C11–C16/C25–C32/C61–C65 positives are deliberately not replaced by
// fake native rows or noop operation callbacks. They await actual artifact GO.

// Additional absolute-end encodings; preserve the original LF cases above.
for (const [label,suffix] of [['CR','\r'],['CRLF','\r\n'],['LINE_SEPARATOR','\u2028'],['PARAGRAPH_SEPARATOR','\u2029']]) {
  for (const field of ['currentDigest','configurationDigest','targetArtifactDigest','operationGuardDigest','timePolicyDigest','protectiveQualificationDigest','initialControlDigest','observedControlDigest','inventoryDigest']) {
    test(`C62: ${field} rejects terminal ${label}`,()=>{const r=record();r[field]+=suffix;assert.throws(()=>operation.parseManagedMemoryAccountOperation(bytes(r)));});
  }
}

test('independent fixture constructor failure unwinds only its captured owner/guard/parent',()=>{
  const original=fs.mkdtempSync,created=[];
  fs.mkdtempSync=(...args)=>{const p=original(...args);created.push(p);return p;};
  try{assert.throws(()=>createManagedTimeFixture({policy:{utcEvidenceDigest:'invalid'}}),error=>error.fixtureCleanup==='REMOVED_OWN_FIXTURE');}
  finally{fs.mkdtempSync=original;}
  assert.equal(created.length,1);assert.equal(fs.existsSync(created[0]),false);
});
