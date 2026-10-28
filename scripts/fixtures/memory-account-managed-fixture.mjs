/** Independent MI1 prerequisite fixture. Files and signatures are synthetic inputs,
 * never qualification reports. No runtime, native observer or network is started. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { ADAPTIVE_RELEASE_CAPABILITIES } from '../studio-adaptive-compatibility.mjs';
import * as ownerApi from '../studio-file-runtime-owner.mjs';
import * as timeApi from '../studio-memory-account-time.mjs';
import { MEMORY_ACCOUNT_MANAGED_HELPERS } from '../studio-memory-account-operation.mjs';

export const UTC_BASE = Date.parse('2026-10-28T08:00:00Z');
export const REAL_MANAGED_BASE = '/Users/reza/Library/Application Support/Vox Studio';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const identity = path => {
  const s = fs.lstatSync(path, { bigint: true });
  return { dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs) };
};
export function image(root) {
  const rows = [];
  const visit = (path, relative = '') => {
    const s = fs.lstatSync(path), row = { path: relative, mode: s.mode & 0o777, links: s.nlink };
    if (s.isSymbolicLink()) { rows.push({ ...row, target: fs.readlinkSync(path) }); return; }
    if (s.isDirectory()) {
      rows.push({ ...row, kind: 'directory' });
      for (const n of fs.readdirSync(path).sort()) visit(join(path, n), relative ? `${relative}/${n}` : n);
    } else {
      assert.ok(s.isFile(), 'synthetic_fixture_special_file');
      const bytes = fs.readFileSync(path);
      rows.push({ ...row, kind: 'file', bytes: bytes.length, sha256: hash(bytes) });
    }
  };
  visit(root); return rows;
}

const assertionFields = ['version', 'requestDigest', 'providerId', 'keyId', 'utcMs', 'uncertaintyMs', 'sequence', 'issuedAtMs', 'expiresAtMs'];
export function signAssertion(assertion, privateKey) {
  const message = JSON.stringify(Object.fromEntries(assertionFields.map(k => [k, assertion[k]])));
  return { ...assertion, signature: sign(null, Buffer.from(message), privateKey).toString('base64url') };
}

/** Scoped test trap proves a real-root refusal without reading that root. */
export async function denyRealManagedIo(run) {
  const names = ['lstatSync', 'statSync', 'realpathSync', 'readFileSync', 'openSync', 'readdirSync'];
  const originals = Object.fromEntries(names.map(n => [n, fs[n]]));
  const attempts = [];
  try {
    for (const n of names) fs[n] = (...args) => {
      const p = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].pathname : '';
      if (p === REAL_MANAGED_BASE || p.startsWith(REAL_MANAGED_BASE + '/')) {
        attempts.push({ operation: n, path: p });
        throw Error('QA_REAL_MANAGED_IO_DENIED');
      }
      return originals[n](...args);
    };
    syncBuiltinESMExports();
    return await run(attempts);
  } finally {
    Object.assign(fs, originals); syncBuiltinESMExports();
  }
}

export function createManagedTimeFixture(options = {}) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(fs.realpathSync('/tmp'), 'vox-mi1-independent-')));
  const parentIdentity = identity(parent);
  const base = join(parent, 'base'), dataRoot = join(parent, 'data'), artifact = join(parent, 'artifact'), sourceRoot = join(parent, 'source');
  let guard,authorization,owner,registration;
  const unwindOwnFixture = () => {
    const named=fs.lstatSync(parent,{throwIfNoEntry:false});
    if(!named||!named.isDirectory()||named.isSymbolicLink()||named.uid!==process.getuid?.()||(named.mode&0o777)!==0o700||JSON.stringify(identity(parent))!==JSON.stringify(parentIdentity))return 'HOLD_PARENT_IDENTITY';
    if(owner){
      if(owner.state!=='active')return 'HOLD_OWNER_NOT_ACTIVE';
      try{ownerApi.releaseMaintenanceFileRuntimeOwner(owner,authorization);}catch{return 'HOLD_OWNER_RELEASE_UNAVAILABLE';}
    }else if(fs.existsSync(join(dataRoot,ownerApi.FILE_RUNTIME_OWNER_GUARD)))return 'HOLD_UNRETURNED_OWNER';
    if(guard){try{guard.release();}catch{return 'HOLD_OPERATION_RELEASE_UNAVAILABLE';}}
    else if(fs.existsSync(join(base,'.studio-operation.lock')))return 'HOLD_UNRETURNED_OPERATION';
    fs.rmSync(parent,{recursive:true,force:true});return 'REMOVED_OWN_FIXTURE';
  };
  try {
  for (const p of [base, dataRoot, artifact, sourceRoot, join(dataRoot, 'adaptive'), join(artifact, '.next'), join(sourceRoot, '.next')]) fs.mkdirSync(p, { mode: 0o700 });
  const release = { revision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), buildId: 'MI1-independent-source-fixture' };
  // Source-only manifest closure: the entry is deliberately never imported or
  // executed. It supplies format/provenance inputs to the source time tests,
  // and cannot be reported as an emitted/genuine compiled artifact.
  const helpers = {};
  for (const [destination, source] of Object.entries(MEMORY_ACCOUNT_MANAGED_HELPERS)) {
    const content = fs.readFileSync(new URL('../' + source, import.meta.url));
    fs.writeFileSync(join(artifact, destination), content, { mode: 0o600 }); helpers[destination] = hash(content);
  }
  const entry = 'studio-memory-account-maintenance.mjs', entryBytes = '// MI1 unexecuted source fixture entry; not a built maintenance implementation.\n';
  fs.writeFileSync(join(artifact, entry), entryBytes, { mode: 0o600 });
  const manifest = { ...release, ...ADAPTIVE_RELEASE_CAPABILITIES, memoryAccountManagedRuntime: {
    version: 1, entry, entrySha256: hash(entryBytes), sourceDigest: hash('MI1-SOURCE-ONLY-FIXTURE-NOT-A-BUILD'),
    // The fixed packet binds repository cwd and this actual file. A static
    // asset URL is rewritten to HTTP by Vitest/Vite under jsdom.
    lockfileSha256: hash(fs.readFileSync(join(process.cwd(), 'package-lock.json'))), bundlerVersion: '0.28.2', helpers,
  } };
  const manifestBytes = JSON.stringify(manifest) + '\n';
  fs.writeFileSync(join(artifact, 'studio-release.json'), manifestBytes, { mode: 0o600 });
  fs.writeFileSync(join(artifact, '.next', 'BUILD_ID'), release.buildId, { mode: 0o600 });
  fs.writeFileSync(join(artifact, 'revision'), release.revision + '\n', { mode: 0o600 });
  fs.writeFileSync(join(artifact, 'server.js'), '// Synthetic source fixture: never executed.\n', { mode: 0o600 });
  fs.writeFileSync(join(sourceRoot, '.next', 'BUILD_ID'), release.buildId, { mode: 0o600 });
  fs.writeFileSync(join(sourceRoot, '.next', 'studio-release.json'), manifestBytes, { mode: 0o600 });
  fs.symlinkSync(artifact, join(base, 'current'));
  fs.writeFileSync(join(base, 'production.env'), `STUDIO_DATA_DIR=${dataRoot}\nSTUDIO_ADAPTIVE_FORMAT=file\nSTUDIO_BOTS=0\n`, { mode: 0o600 });
  const receipt = { version: 1, kind: 'studio-file-runtime-fixture', fixtureId: randomUUID(), root: dataRoot, artifact,
    sourceRoot, rootIdentity: identity(dataRoot), artifactIdentity: identity(artifact), ...release,
    providerBlocking: true, metadataSource: 'next-build-source-binding' };
  const receiptPath = join(parent, 'file-runtime-owner-fixture-v1.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt) + '\n', { mode: 0o600 });
  ownerApi.registerFileRuntimeFixture({ dataRoot, artifactRoot: artifact, release });
  fs.writeFileSync(join(dataRoot, 'adaptive', ownerApi.FILE_RUNTIME_OWNER_MARKER), ownerApi.FILE_RUNTIME_OWNER_MARKER_BYTES, { mode: 0o600 });
  guard = ownerApi.acquireFileRuntimeOperationGuard(base, 'backup');
  authorization = ownerApi.createMaintenanceAuthorization(guard);
  owner = ownerApi.acquireFileRuntimeOwner({ dataRoot, release, role: 'maintenance', authorization });
  const keys = generateKeyPairSync('ed25519'), publicHex = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const started = performance.now();
  const control = { offsetMs: 0, manualNow: 0, boot: 'MI1-independent-boot', sequence: 0, providerCalls: 0,
    requests: [], mutate: undefined, afterSign: undefined, onAcquire: undefined, providerMode: 'reply' };
  const monotonic = () => (options.manual ? control.manualNow : performance.now() - started) + control.offsetMs;
  const now = () => UTC_BASE + Math.floor(monotonic());
  const policy = { version: 1, scope: 'synthetic', providerId: 'MI1-independent-provider', keyId: 'MI1-independent-key', algorithm: 'Ed25519', publicKey: publicHex,
    keyNotBeforeMs: UTC_BASE - 60000, keyNotAfterMs: UTC_BASE + 3600000,
    maxUncertaintyMs: 100, maxRequestElapsedMs: 250, maxAssertionLifetimeMs: 10000, maxExtrapolationAgeMs: 5000,
    maxDriftPpm: 0, maxSuspendGapMs: 10000, sourcePositiveSkewMs: 2000, sourceQuantumMs: 1000, sourceNegativeSkewMs: null,
    utcEvidenceDigest: 'c'.repeat(64), sourceEvidenceDigest: 'd'.repeat(64), ...options.policy };
  const provider = { async acquire(request, signal) {
    control.providerCalls++; control.requests.push({ ...request });
    if (control.providerMode === 'never') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('synthetic-provider-aborted')), { once: true }));
    if (control.onAcquire) await control.onAcquire(request, signal);
    const utcMs = now();
    let value = { version: 1, requestDigest: hash(JSON.stringify(request)), providerId: policy.providerId, keyId: policy.keyId,
      utcMs, uncertaintyMs: options.uncertaintyMs ?? 25, sequence: ++control.sequence, issuedAtMs: utcMs - (options.uncertaintyMs ?? 25) - 500, expiresAtMs: utcMs + (options.assertionLifetimeMs ?? 5000) };
    if (control.mutate) value = control.mutate(value, request) ?? value;
    value = signAssertion(value, keys.privateKey);
    return control.afterSign ? control.afterSign(value, request) ?? value : value;
  } };
  const register = () => registration = timeApi.registerSyntheticMemoryTimePolicy({ dataRoot, policy, provider, monotonic, bootIdentity: () => control.boot });
  if (options.register !== false) register();
  let closed = false;
  return { parent, base, dataRoot, directory: join(dataRoot, 'adaptive'), artifact, sourceRoot, release, manifest, manifestBytes,
    artifactDigest: hash(manifestBytes), receipt, receiptPath, owner, guard, authorization, keys, policy, provider, control, monotonic, now,
    register, get registration() { return registration; },
    acquire: (extra = {}) => timeApi.acquireQualifiedMemoryTime({ dataRoot, owner, artifactDigest: hash(manifestBytes), purpose: 'initialize', ...extra }),
    mark: (highWaterMs = now()) => {
      fs.writeFileSync(join(dataRoot, 'adaptive', 'memory-account-time-v1.json'), JSON.stringify({ version: 1, highWaterMs }) + '\n', { mode: 0o600 });
      fs.writeFileSync(join(dataRoot, 'adaptive', 'memory-account-lifecycle-v1.json'), '{"version":1,"kind":"memory-account-lifecycle"}\n', { mode: 0o600 });
    },
    close: () => {
      if (closed) return; closed = true;
      registration?.revoke();
      // Genuine maintenance release closes descriptors. Unknown/lost/drained
      // holder truth is retained; never delete its tree or invent an exit.
      control.ownerRelease = unwindOwnFixture();
    },
  };
  } catch(error) {
    registration?.revoke();const cleanup=unwindOwnFixture();
    if(error&&typeof error==='object'&&Object.isExtensible(error))Object.defineProperty(error,'fixtureCleanup',{value:cleanup,enumerable:true});
    throw error;
  }
}

export async function withManagedTimeFixture(run, options = {}) {
  const f = createManagedTimeFixture(options);
  try { return await run(f); } finally { f.close(); }
}
