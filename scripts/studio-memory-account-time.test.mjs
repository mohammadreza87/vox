/** Independent MI1 source-time tests: real private FILE/FRO ownership, local
 * Ed25519 provider functions. No native helper, production root or socket. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import * as time from './studio-memory-account-time.mjs';
import { assertFileRuntimeFixture } from './studio-file-runtime-owner.mjs';
import { UTC_BASE, REAL_MANAGED_BASE, withManagedTimeFixture, image, denyRealManagedIo } from './fixtures/memory-account-managed-fixture.mjs';

test('C17: actual registered private managed-layout fixture admits signed UTC interval without a network provider', () => withManagedTimeFixture(async f => {
  assert.doesNotThrow(() => assertFileRuntimeFixture(f.dataRoot));
  assert.ok(fs.existsSync(join(f.base, 'production.env')) && fs.existsSync(join(f.base, 'current')));
  const permit = await f.acquire(), interval = permit.sampleNow();
  assert.deepEqual(interval, { nowMs: UTC_BASE + 25, utcLowerMs: UTC_BASE - 25, utcUpperMs: UTC_BASE + 25 });
  assert.equal(f.control.providerCalls, 1); assert.equal(time.qualifiedMemoryTimeForRoot(f.dataRoot), permit);
  const request = f.control.requests[0];
  assert.deepEqual(Object.keys(request), ['version', 'nonce', 'rootBinding', 'artifactDigest', 'policyDigest', 'purpose']);
  assert.equal(request.artifactDigest, f.artifactDigest); assert.equal(request.policyDigest, f.registration.policyDigest);
  assert.equal(request.nonce.length, 64); assert.equal(request.rootBinding.length, 64);
  assert.ok(!JSON.stringify(request).includes(f.dataRoot) && !JSON.stringify(request).includes(f.base));
}, { manual: true }));

test('C17: each acquisition gets a fresh opaque binding and independent sequence while extrapolation uses conservative endpoints', () => withManagedTimeFixture(async f => {
  const a = await f.acquire(); f.control.manualNow = 100; const first = a.sampleNow();
  assert.equal(first.utcLowerMs, UTC_BASE + 75); assert.equal(first.utcUpperMs, UTC_BASE + 125);
  await f.acquire(); assert.equal(f.control.providerCalls, 2);
  assert.notEqual(f.control.requests[0].nonce, f.control.requests[1].nonce);
  assert.notEqual(f.control.requests[0].rootBinding, f.control.requests[1].rootBinding);
}, { manual: true }));

test('C54: pure exact-last-sample lookup does no FILE/owner/policy/provider work after the final clock', () => withManagedTimeFixture(async f => {
  const permit = await f.acquire(), clock = time.qualifiedMemoryClock(permit), observed = clock();
  const methods = ['lstatSync', 'statSync', 'readFileSync', 'openSync', 'realpathSync', 'readdirSync'];
  const originals = Object.fromEntries(methods.map(k => [k, fs[k]])); let calls = 0;
  try {
    for (const k of methods) fs[k] = () => { calls++; throw Error('QA_IO_AFTER_FINAL_SAMPLE'); };
    syncBuiltinESMExports();
    assert.equal(time.qualifiedMemoryInterval(clock, observed).nowMs, observed);
    assert.throws(() => time.qualifiedMemoryInterval(clock, observed + 1));
    assert.equal(calls, 0); assert.equal(f.control.providerCalls, 1);
  } finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
}, { manual: true }));

test('C08/C09: copied methods or serialized time objects never inherit full time authority', () => withManagedTimeFixture(async f => {
  const permit = await f.acquire();
  for (const forged of [{}, { ...permit }, JSON.parse(JSON.stringify(permit))]) {
    assert.throws(() => time.assertQualifiedMemoryTime(forged));
    assert.throws(() => time.qualifiedMemoryClock(forged));
  }
  assert.doesNotThrow(() => time.assertQualifiedMemoryTime(permit, { dataRoot: f.dataRoot, owner: f.owner }));
}));

for (const field of ['providerId', 'keyId', 'publicKey', 'utcEvidenceDigest', 'sourceEvidenceDigest']) {
  test(`C18/C20: policy ${field} rejects a terminal newline before any provider call`, () => withManagedTimeFixture(f => {
    f.policy[field] += '\n'; const before = image(f.parent);
    assert.throws(() => f.register()); assert.equal(f.control.providerCalls, 0); assert.deepEqual(image(f.parent), before);
  }, { register: false }));
}
for (const [field, value] of [['maxRequestElapsedMs', 0], ['maxDriftPpm', 1000001], ['maxUncertaintyMs', -0], ['sourceQuantumMs', 999], ['sourcePositiveSkewMs', 2001], ['keyNotAfterMs', UTC_BASE - 60001]]) {
  test(`C21: strict policy refuses ${field}=${Object.is(value, -0) ? '-0' : value}`, () => withManagedTimeFixture(f => {
    f.policy[field] = value; const before = image(f.parent);
    assert.throws(() => f.register()); assert.equal(f.control.providerCalls, 0); assert.deepEqual(image(f.parent), before);
  }, { register: false }));
}
test('C21: policy accessors and unknown fields are not accepted as data', () => withManagedTimeFixture(f => {
  let accessed = 0; Object.defineProperty(f.policy, 'providerId', { enumerable: true, configurable: true, get() { accessed++; return 'MI1-independent-provider'; } });
  assert.throws(() => f.register()); assert.equal(accessed, 0); assert.equal(f.control.providerCalls, 0);
}, { register: false }));

const signedInvalid = {
  'request digest': a => ({ ...a, requestDigest: '0'.repeat(64) }),
  'provider identity': a => ({ ...a, providerId: 'different-provider' }),
  'key identity': a => ({ ...a, keyId: 'different-key' }),
  'uncertainty over limit': a => ({ ...a, uncertaintyMs: 101 }),
  'negative zero sequence': a => ({ ...a, sequence: -0 }),
  'unsafe UTC': a => ({ ...a, utcMs: Number.MAX_SAFE_INTEGER + 1 }),
  'issue later than UTC': a => ({ ...a, issuedAtMs: a.utcMs + 1 }),
  'nonpositive lifetime': a => ({ ...a, expiresAtMs: a.issuedAtMs }),
};
for (const [name, mutate] of Object.entries(signedInvalid)) test(`C19/C21: a correctly signed ${name} assertion refuses without FILE mutation`, () => withManagedTimeFixture(async f => {
  f.control.mutate = mutate; const before = image(f.parent);
  await assert.rejects(f.acquire()); assert.equal(f.control.providerCalls, 1); assert.deepEqual(image(f.parent), before);
}));
for (const [name, alter] of Object.entries({
  'unknown field': a => ({ ...a, unreviewed: 'FORBIDDEN' }),
  'signature bit flip': a => ({ ...a, signature: Buffer.alloc(64).toString('base64url') }),
  'signature whitespace': a => ({ ...a, signature: a.signature + '\n' }),
})) test(`C21: ${name} is rejected rather than normalized`, () => withManagedTimeFixture(async f => {
  f.control.afterSign = alter; const before = image(f.parent);
  await assert.rejects(f.acquire()); assert.deepEqual(image(f.parent), before);
}));

test('C20: a duplicate signed sequence cannot refresh an admitted lease', () => withManagedTimeFixture(async f => {
  f.control.mutate = a => ({ ...a, sequence: 7 }); await f.acquire();
  const before = image(f.parent); await assert.rejects(f.acquire());
  assert.equal(f.control.providerCalls, 2); assert.deepEqual(image(f.parent), before);
}));
test('C22: already-cancelled acquisition makes zero provider calls', () => withManagedTimeFixture(async f => {
  const controller = new AbortController(); controller.abort(); const before = image(f.parent);
  await assert.rejects(f.acquire({ signal: controller.signal }));
  assert.equal(f.control.providerCalls, 0); assert.deepEqual(image(f.parent), before);
}));
test('C22: cancellation during provider work cannot return a late capability', () => withManagedTimeFixture(async f => {
  f.control.providerMode = 'never'; const controller = new AbortController(), before = image(f.parent);
  const pending = f.acquire({ signal: controller.signal }); await Promise.resolve(); controller.abort();
  await assert.rejects(pending); assert.equal(f.control.providerCalls, 1); assert.deepEqual(image(f.parent), before);
}));
test('C22: finite provider timeout does not publish time or retry the provider', { timeout: 2000 }, () => withManagedTimeFixture(async f => {
  f.control.providerMode = 'never'; const before = image(f.parent);
  await assert.rejects(f.acquire()); assert.equal(f.control.providerCalls, 1); assert.deepEqual(image(f.parent), before);
}, { policy: { maxRequestElapsedMs: 10 } }));

for (const fault of ['boot', 'monotonic regression', 'suspend', 'lease expiry', 'revoked policy', 'owner drain']) test(`C23/C24/C54: ${fault} invalidates a previously genuine permit`, () => withManagedTimeFixture(async f => {
  const permit = await f.acquire();
  if (fault === 'boot') f.control.boot = 'different-independent-boot';
  if (fault === 'monotonic regression') f.control.manualNow = -1;
  if (fault === 'suspend') f.control.manualNow = 20001;
  if (fault === 'lease expiry') f.control.manualNow = 5001;
  if (fault === 'revoked policy') f.registration.revoke();
  if (fault === 'owner drain') f.owner.beginDrain();
  const before = image(f.parent); assert.throws(() => permit.sampleNow()); assert.deepEqual(image(f.parent), before);
}, { manual: true }));

test('C24: durable high-water ahead of the qualified interval refuses and is never reset', () => withManagedTimeFixture(async f => {
  const permit = await f.acquire(); f.mark(UTC_BASE + 1000000); const before = image(f.parent);
  assert.throws(() => permit.sampleNow()); assert.deepEqual(image(f.parent), before);
}, { manual: true }));
test('C24: replacing the admitted manifest invalidates time instead of trusting only its release tuple', () => withManagedTimeFixture(async f => {
  const permit = await f.acquire(), path = join(f.artifact, 'studio-release.json');
  fs.writeFileSync(path, f.manifestBytes + '\n', { mode: 0o600 }); const before = image(f.parent);
  assert.throws(() => permit.sampleNow()); assert.deepEqual(image(f.parent), before);
}));
test('C46: environment policy JSON and a matching-looking fixture file cannot register a production provider', () => withManagedTimeFixture(async f => {
  const key = 'STUDIO_MEMORY_ACCOUNT_POLICY_JSON', previous = process.env[key];
  process.env[key] = JSON.stringify(f.policy);
  try { await assert.rejects(f.acquire()); assert.equal(f.control.providerCalls, 0); }
  finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
}, { register: false }));
test('QF16: a real managed root is refused before any private-root filesystem access', () => denyRealManagedIo(async attempts => {
  assert.throws(() => assertFileRuntimeFixture(join(REAL_MANAGED_BASE, 'data')));
  assert.equal(attempts.length, 0);
}));

// Additive strict-encoding vectors selected by independent security review.
// Original LF cases above remain unchanged.
for (const [label, suffix] of [['CR','\r'],['CRLF','\r\n'],['LINE_SEPARATOR','\u2028'],['PARAGRAPH_SEPARATOR','\u2029']]) {
  for (const field of ['providerId','keyId','publicKey','utcEvidenceDigest','sourceEvidenceDigest']) {
    test(`C18/C20: policy ${field} rejects terminal ${label} before provider work`, () => withManagedTimeFixture(f => {
      f.policy[field] += suffix; const before=image(f.parent);
      assert.throws(()=>f.register());assert.equal(f.control.providerCalls,0);assert.deepEqual(image(f.parent),before);
    },{register:false}));
  }
}

// Regression for the first real admission failure: keyNotBeforeMs must be
// explicitly numeric; evidence-digest strings must never join that field list.
for (const [label,value] of [['string','0'],['negative',-1],['fraction',UTC_BASE+0.5],['negative-zero',-0],['NaN',NaN],['infinity',Infinity],['unsafe',Number.MAX_SAFE_INTEGER+1]]) {
  test(`C21: keyNotBeforeMs rejects ${label} before provider acquisition`,()=>withManagedTimeFixture(f=>{
    f.policy.keyNotBeforeMs=value;const before=image(f.parent);assert.throws(()=>f.register());assert.equal(f.control.providerCalls,0);assert.deepEqual(image(f.parent),before);
  },{register:false}));
}
