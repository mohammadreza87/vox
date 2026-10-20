import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ADAPTIVE_RELEASE_CAPABILITIES as capabilities, assertReleaseAdaptiveCompatibility as admit, requiredAdaptiveCapabilities as required, readInstalledReleaseManifest } from './studio-adaptive-compatibility.mjs';

// Synthetic metadata only. Contract pin: 565941dcff3ab45a4f365c60a6f3f36ce303bf38.
// Admission never executes runtime TS, loads policy/config, or establishes effect proof.
const accountId = 'telegram-account:123';
const hash = text => createHash('sha256').update(text).digest('hex');
const stable = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(stable).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest = value => hash(stable(value));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const metadata = { revision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), buildId: 'synthetic-rf2', builtAt: '2026-10-20T00:00:00.000Z' };
const sign = operation => {
  operation.witnessDigest = digest(operation.witness);
  const intent = Object.fromEntries(Object.entries(operation).filter(([key]) => !['fingerprint', 'acknowledgement'].includes(key)));
  operation.fingerprint = digest(['vox.rights.private-note-erasure.intent.v1', accountId, intent]);
  return operation;
};
function request(requestId = uuid(1), kind = 'erasure') {
  return { version: 1, requestId, accountId, space: 'work', kind, revision: 1, createdAt: 100, updatedAt: 100, localeAtSubmission: 'en',
    intakePolicy: { id: 'synthetic-only', revision: 1, copyVersion: 'synthetic' }, requester: { assurance: 'signed_telegram_account', personVerification: 'not_established' },
    state: 'received', deadline: { state: 'reviewed_policy_unavailable', dueAt: null, reason: 'policy_missing' },
    coverage: { localAccount: 'not_started', shared: 'not_started', providers: 'unsupported', backups: 'unsupported', guests: 'unsupported', deletion: 'not_implemented', formalRestriction: 'not_implemented' },
    retention: { policyId: 'synthetic-only', policyRevision: 1, reviewOrExpiryAt: 1000 },
    audit: [{ seq: 1, at: 100, action: 'request_received', actor: 'requester', actorRef: 'a'.repeat(64), from: null, to: 'received', policyRevision: 1 }] };
}
function ledger(populated = true) {
  const operation = sign({ version: 1, eventId: uuid(2), requestId: uuid(1), requestRevision: 1, space: 'work', memoryId: 'note',
    expectedCanonicalRevision: 3, expectedBindingDigest: 'b'.repeat(64),
    witness: [{ id: 'note', space: 'work', beforeRevision: 1, beforeEpoch: 0, beforeStatus: 'active', afterRevision: 2, afterEpoch: 1, afterStatus: 'deleted', sourceRefsDigest: digest([]) }],
    createdAt: 200, expiresAt: 300, executionDeadline: 400, policyDigest: 'c'.repeat(64), noticeDigest: 'd'.repeat(64), metadataRetainUntil: 600, replayRetainUntil: 700, receiptRetainUntil: 800 });
  return { version: 4, accountId, revision: 3, observedServerTime: 500, requests: populated ? [request()] : [], tombstones: [], commandReceipts: [],
    localUse: { version: 1, intents: [], acknowledgements: [] }, localErasure: { version: 1, operations: populated ? [operation] : [] } };
}
function acknowledged(reconciled = false) {
  const doc = ledger(), operation = doc.localErasure.operations[0];
  operation.acknowledgement = { effectRevision: 4, observedAt: 250, recordedAt: 450, retainUntil: 900 };
  if (reconciled) {
    const authority = { version: 1, commandEventId: uuid(3), requestRevision: 2,
      policy: { id: 'synthetic-current-recording-policy', revision: 2, digest: 'e'.repeat(64) }, operatorRef: 'f'.repeat(64) };
    const row = doc.requests[0]; row.revision = 2; row.updatedAt = 350; row.state = 'operator_review'; row.reasonCode = 'review_pending';
    row.audit.push({ seq: 2, at: 350, action: 'review_started', actor: 'privacy_operator', actorRef: 'f'.repeat(64), from: 'received', to: 'operator_review', reasonCode: 'review_pending', policyRevision: 2 });
    operation.acknowledgement.recordingAuthority = authority;
    doc.commandReceipts.push({ eventId: authority.commandEventId,
      fingerprint: digest(['vox.rights.private-note-erasure.reconcile.v1', accountId, operation.requestId, operation.space, operation.fingerprint, operation.witnessDigest, authority]),
      requestId: operation.requestId, resultingRequestRevision: 2, action: 'private_note_erasure_reconcile', recordedAt: 450, retainUntil: 900 });
  }
  return doc;
}
function withLocalUse(doc) {
  const row = request(uuid(4), 'restriction'); doc.requests.push(row);
  const intent = { version: 1, eventId: uuid(5), requestId: row.requestId, requestRevision: 1, scope: { space: 'work', purpose: 'optional.personalization' },
    action: 'apply', effectId: uuid(6), createdAt: 150, expectedCanonicalRevision: 2, expectedUseEpoch: 0,
    policy: { id: 'synthetic-only', revision: 1, digest: 'a'.repeat(64), approvalReference: 'synthetic', decisionReference: 'synthetic' },
    notice: { version: 'synthetic', digest: 'b'.repeat(64) }, reviewAt: 600, metadataRetainUntil: 700, replayRetainUntil: 800, receiptRetainUntil: 900 };
  intent.fingerprint = digest(['vox.rights.local-use.command.v1', { accountId, requestId: intent.requestId, scope: intent.scope, action: intent.action, eventId: intent.eventId, policyDigest: intent.policy.digest, notice: intent.notice }]);
  const command = Object.fromEntries(Object.entries(intent).filter(([key]) => key !== 'version'));
  intent.intentDigest = digest(['vox.rights.local-use.intent.v1', { accountId, ...command }]);
  doc.localUse.intents.push(intent); return doc;
}
function fixture(doc, run, format = 'file', raw = JSON.stringify(doc)) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-rf2-admission-')), env = { STUDIO_DATA_DIR: join(dir, 'data'), STUDIO_ADAPTIVE_FORMAT: format };
  const rights = join(env.STUDIO_DATA_DIR, 'rights-intake', 'v1'); mkdirSync(rights, { recursive: true });
  const file = join(rights, `${hash(doc.accountId)}.json`); writeFileSync(file, raw);
  if (format !== 'file') {
    const managed = join(env.STUDIO_DATA_DIR, 'adaptive.managed'), store = join(managed, 'stores', uuid(100)); mkdirSync(join(managed, 'stores'), { recursive: true });
    writeFileSync(join(env.STUDIO_DATA_DIR, 'adaptive'), `VOX_MANAGED_STORAGE_V1:${uuid(100)}\n`);
    writeFileSync(join(managed, 'format.json'), JSON.stringify({ version: 3, state: 'ready', rootId: uuid(100), format, store: uuid(100), identity: { incarnation: uuid(100), generation: 1 },
      watermarkFloor: 500, canonicalSchemaVersion: 3, controlsSchemaVersion: 3, productPauseEnforcementVersion: 1, rightsUseHoldEnforcementVersion: 1, ...(format === 'file-v2' ? { fileAuthorityProjectionVersion: 2 } : {}) }));
    if (format === 'file-v2') {
      mkdirSync(join(store, 'records'), { recursive: true });
      writeFileSync(join(store, 'head.json'), JSON.stringify({ formatVersion: 2, schemaVersion: 3, authorityProjectionVersion: 2, incarnation: uuid(100), generation: 1, lifecycleWatermark: 500, accounts: [] }));
    } else {
      const db = new Database(store);
      try {
        const ddl = readFileSync(new URL('../src/lib/adaptive/persistence/indexed/sqlite-storage.ts', import.meta.url), 'utf8').match(/const DDL = `([\s\S]*?)`;/)?.[1]; assert.ok(ddl); db.exec(ddl); db.pragma('user_version = 3');
        db.prepare('INSERT INTO store_meta(singleton,json) VALUES(1,?)').run(JSON.stringify({ formatVersion: 1, schemaVersion: 3, incarnation: uuid(100), generation: 1, lifecycleWatermark: 500 }));
      } finally { db.close(); }
    }
  }
  const before = readFileSync(file), input = structuredClone(doc);
  try { run({ dir, env, file }); assert.deepEqual(readFileSync(file), before); assert.deepEqual(doc, input); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const rejects = doc => fixture(doc, f => assert.throws(() => required(f.env), error => /incompatible/.test(error.message) && !error.message.includes('PRIVATE_CANARY')));

for (const format of ['file', 'file-v2', 'sqlite-v1']) for (const populated of [false, true]) test(`${format}: explicit v4 capability admits ${populated ? 'populated' : 'empty'} ledger without mutation`, () => fixture(ledger(populated), f => {
  const manifest = structuredClone(capabilities), before = structuredClone(manifest);
  assert.equal(admit(f.env, manifest).rightsLedgerVersion, 4); assert.equal(required(f.env).rightsUseHoldEnforcementVersion, 1); assert.deepEqual(manifest, before);
  const { supportedRightsLedgerVersions: omitted, ...missing } = capabilities; assert.ok(omitted.includes(4));
  for (const candidate of [null, {}, missing, { ...capabilities, supportedRightsLedgerVersions: [1, 2, 3] },
    ...[[], null, [4, 4], [5], '4', [1, 2, 3, 4, 5]].map(versions => ({ ...capabilities, supportedRightsLedgerVersions: versions })),
    { ...capabilities, rightsUseHoldEnforcementVersion: 0 }]) assert.throws(() => admit(f.env, candidate), /incompatible/);
}, format));
for (const doc of [acknowledged(), acknowledged(true), withLocalUse(acknowledged(true))]) test(`valid immutable v4 intent with ${doc.commandReceipts.length ? 'fresh operator authority' : 'requester acknowledgement'} and ${doc.localUse.intents.length} RF1 intents`, () => fixture(doc, f => assert.equal(admit(f.env, capabilities).rightsLedgerVersion, 4)));

test('v1/v2/v3 admission remains supported without interpreting v4 as v3', () => {
  for (const version of [1, 2, 3]) {
    const doc = ledger(false); doc.version = version; delete doc.localErasure; if (version < 3) delete doc.localUse; if (version < 2) delete doc.tombstones;
    fixture(doc, f => assert.doesNotThrow(() => admit(f.env, { ...capabilities, supportedRightsLedgerVersions: [1, 2, 3] })));
  }
  const doc = ledger(); doc.version = 3; rejects(doc);
});
const malformed = [
  ['unknown ledger field', d => { d.extra = 'PRIVATE_CANARY'; }], ['future ledger', d => { d.version = 5; }],
  ['missing RF2', d => { delete d.localErasure; }], ['null RF2', d => { d.localErasure = null; }], ['unknown RF2 field', d => { d.localErasure.extra = 1; }],
  ['wrong RF2 version', d => { d.localErasure.version = 2; }], ['operations not array', d => { d.localErasure.operations = {}; }],
  ['operations count', d => { d.localErasure.operations = Array(33).fill(d.localErasure.operations[0]); }],
  ['null operation', d => { d.localErasure.operations[0] = null; }], ['unknown operation field', (d, o) => { o.text = 'PRIVATE_CANARY'; }],
  ['missing operation field', (d, o) => { delete o.expectedBindingDigest; }], ['operation version', (d, o) => { o.version = 2; }],
  ['nonv4 UUID', (d, o) => { o.eventId = o.eventId.replace('4000', '1000'); }], ['memory ID bound', (d, o) => { o.memoryId = 'x'.repeat(201); }],
  ['unsafe request counter', (d, o) => { o.requestRevision = Number.MAX_SAFE_INTEGER + 1; }], ['negative canonical counter', (d, o) => { o.expectedCanonicalRevision = -1; }],
  ['invalid binding hash', (d, o) => { o.expectedBindingDigest = 'invalid'; }], ['uppercase notice hash', (d, o) => { o.noticeDigest = 'A'.repeat(64); }],
  ['wrong fingerprint', (d, o) => { o.fingerprint = 'f'.repeat(64); }], ['wrong witness hash', (d, o) => { o.witnessDigest = 'f'.repeat(64); }],
  ['future creation', (d, o) => { o.createdAt = 501; sign(o); }], ['empty lifetime', (d, o) => { o.expiresAt = o.createdAt; sign(o); }],
  ['deadline before expiry', (d, o) => { o.executionDeadline = o.expiresAt - 1; sign(o); }], ['receipt floor', (d, o) => { o.receiptRetainUntil = o.executionDeadline - 1; sign(o); }],
  ['unsafe time', (d, o) => { o.expiresAt = Number.MAX_SAFE_INTEGER + 1; sign(o); }], ['request missing', d => { d.requests = []; }],
  ['wrong request kind', d => { d.requests[0].kind = 'restriction'; }], ['wrong request space', d => { d.requests[0].space = 'personal'; }],
  ['stale linked request', (d, o) => { o.requestRevision = 2; sign(o); }], ['witness empty', (d, o) => { o.witness = []; sign(o); }],
  ['witness count', (d, o) => { o.witness = Array(301).fill(o.witness[0]); sign(o); }], ['witness null', (d, o) => { o.witness = [null]; sign(o); }],
  ['witness unknown key', (d, o) => { o.witness[0].text = 'PRIVATE_CANARY'; sign(o); }], ['witness duplicate ID', (d, o) => { o.witness.push({ ...o.witness[0] }); sign(o); }],
  ['witness missing selected', (d, o) => { o.memoryId = 'missing'; sign(o); }], ['witness selected already deleted', (d, o) => { o.witness[0].beforeStatus = 'deleted'; o.witness[0].afterRevision = 1; o.witness[0].afterEpoch = 0; sign(o); }],
  ['witness wrong space', (d, o) => { o.witness[0].space = 'personal'; sign(o); }], ['witness wrong epoch', (d, o) => { o.witness[0].afterEpoch = 0; sign(o); }],
  ['witness wrong revision', (d, o) => { o.witness[0].afterRevision = 1; sign(o); }], ['witness overflow', (d, o) => { o.witness[0].beforeRevision = Number.MAX_SAFE_INTEGER; o.witness[0].afterRevision = Number.MAX_SAFE_INTEGER + 1; sign(o); }],
  ['witness source hash', (d, o) => { o.witness[0].sourceRefsDigest = 'bad'; sign(o); }], ['witness after state', (d, o) => { o.witness[0].afterStatus = 'active'; sign(o); }],
  ['duplicate operation ID', (d, o) => { d.localErasure.operations.push(structuredClone(o)); }], ['RF1 omitted', d => { delete d.localUse; }],
  ['RF1 malformed under v4', d => { d.localUse.intents.push({ version: 1 }); }], ['RF1 unknown key under v4', d => { d.localUse.extra = 'PRIVATE_CANARY'; }],
];
for (const [name, mutate] of malformed) test(`v4 rejects ${name}`, () => { const doc = ledger(); mutate(doc, doc.localErasure.operations[0]); rejects(doc); });
const malformedAcks = [
  ['null acknowledgement', (d, a, o) => { o.acknowledgement = null; }], ['unknown acknowledgement field', (d, a) => { a.text = 'PRIVATE_CANARY'; }],
  ['effect counter mismatch', (d, a) => { a.effectRevision++; }], ['unsafe effect counter', (d, a) => { a.effectRevision = Number.MAX_SAFE_INTEGER + 1; }],
  ['observation before intent', (d, a) => { a.observedAt = 199; }], ['recording before observation', (d, a) => { a.recordedAt = 249; }],
  ['recording in future', (d, a) => { a.recordedAt = 501; }], ['short acknowledgement retention', (d, a) => { a.retainUntil = 799; }],
  ['null authority', (d, a) => { a.recordingAuthority = null; }], ['unknown authority field', (d, a) => { a.recordingAuthority.text = 'PRIVATE_CANARY'; }],
  ['unknown authority policy field', (d, a) => { a.recordingAuthority.policy.extra = 1; }], ['invalid authority version', (d, a) => { a.recordingAuthority.version = 2; }],
  ['invalid authority operator', (d, a) => { a.recordingAuthority.operatorRef = 'bad'; }], ['authority policy ID limit', (d, a) => { a.recordingAuthority.policy.id = 'x'.repeat(101); }],
  ['authority policy revision', (d, a) => { a.recordingAuthority.policy.revision = 0; }], ['authority policy digest', (d, a) => { a.recordingAuthority.policy.digest = 'bad'; }],
  ['authority beyond current request', (d, a) => { a.recordingAuthority.requestRevision = 3; }], ['authority missing receipt', d => { d.commandReceipts = []; }],
  ['authority receipt fingerprint', d => { d.commandReceipts[0].fingerprint = 'f'.repeat(64); }], ['authority receipt action', d => { d.commandReceipts[0].action = 'unrelated'; }],
  ['authority receipt revision', d => { d.commandReceipts[0].resultingRequestRevision = 1; }], ['authority receipt recording time', d => { d.commandReceipts[0].recordedAt--; }],
  ['authority receipt retain time', d => { d.commandReceipts[0].retainUntil--; }], ['authority receipt unknown field', d => { d.commandReceipts[0].extra = 'PRIVATE_CANARY'; }],
];
for (const [name, mutate] of malformedAcks) test(`v4 rejects ${name}`, () => { const doc = acknowledged(true), operation = doc.localErasure.operations[0]; mutate(doc, operation.acknowledgement, operation); rejects(doc); });

test('v4 rejects duplicate and cross-family command IDs', () => {
  for (const mutate of [
    d => { d.commandReceipts.push(structuredClone(d.commandReceipts[0])); },
    d => { d.localErasure.operations[0].eventId = d.commandReceipts[0].eventId; sign(d.localErasure.operations[0]); },
    d => { const op = d.localErasure.operations[0]; op.eventId = d.localUse.intents[0].eventId; sign(op); },
  ]) { const doc = withLocalUse(acknowledged(true)); mutate(doc); rejects(doc); }
});
test('v4 witness order is deterministic and deleted descendants keep unchanged counters', () => {
  const doc = ledger(), operation = doc.localErasure.operations[0];
  operation.witness.push({ ...operation.witness[0], id: 'older-note', beforeStatus: 'deleted', beforeRevision: 3, afterRevision: 3, beforeEpoch: 2, afterEpoch: 2 }); sign(operation);
  fixture(doc, f => assert.equal(required(f.env).rightsLedgerVersion, 4));
  operation.witness.reverse(); sign(operation); rejects(doc);
});
test('v4 accepts 32 operations and a large admissible witness without changing metadata', () => {
  const doc = ledger(), operation = doc.localErasure.operations[0];
  doc.localErasure.operations = Array.from({ length: 32 }, (_, index) => sign({ ...structuredClone(operation), eventId: uuid(1000 + index) }));
  fixture(doc, f => assert.equal(required(f.env).rightsLedgerVersion, 4));
  doc.localErasure.operations = [operation];
  operation.witness = Array.from({ length: 180 }, (_, index) => ({ ...operation.witness[0], id: `note-${String(index).padStart(3, '0')}` }));
  operation.memoryId = operation.witness[0].id; sign(operation);
  assert.ok(Buffer.byteLength(JSON.stringify(doc)) < 65536);
  fixture(doc, f => assert.equal(admit(f.env, { ...capabilities, supportedRightsLedgerVersions: [4] }).rightsLedgerVersion, 4));
});
test('v4 retains exact byte boundary and rejects malformed JSON without mutation', () => {
  const doc = ledger(), json = JSON.stringify(doc), length = Buffer.byteLength(json);
  fixture(doc, f => assert.equal(required(f.env).rightsLedgerVersion, 4), 'file', json + ' '.repeat(65536 - length));
  for (const raw of [json + ' '.repeat(65537 - length), '{', 'null', '[]']) fixture(doc, f => assert.throws(() => required(f.env), /incompatible/), 'file', raw);
});
test('v4 preserves RF1 policy, intent digest and acknowledgement validation', () => {
  for (const mutate of [
    d => { d.localUse.intents[0].policy.prompt = 'PRIVATE_CANARY'; },
    d => { d.localUse.intents[0].intentDigest = 'f'.repeat(64); },
    d => { d.localUse.acknowledgements.push({ version: 1, eventId: uuid(5) }); },
  ]) { const doc = withLocalUse(ledger()); mutate(doc); rejects(doc); }
});
test('fresh recording authority cannot precede the immutable execution request revision', () => {
  const doc = acknowledged(true), operation = doc.localErasure.operations[0];
  operation.requestRevision = 2; sign(operation); operation.acknowledgement.recordingAuthority.requestRevision = 1;
  const authority = operation.acknowledgement.recordingAuthority, receipt = doc.commandReceipts[0];
  receipt.resultingRequestRevision = 1;
  receipt.fingerprint = digest(['vox.rights.private-note-erasure.reconcile.v1', accountId, operation.requestId, operation.space, operation.fingerprint, operation.witnessDigest, authority]);
  rejects(doc);
});
test('v4 retains the 65,536-byte UTF-8 bound without truncating or rewriting input', () => {
  const doc = ledger(), operation = doc.localErasure.operations[0];
  operation.witness = Array.from({ length: 300 }, (_, i) => ({ ...operation.witness[0], id: `note-${String(i).padStart(3, '0')}-${'ی'.repeat(100)}` }));
  operation.memoryId = operation.witness[0].id; sign(operation); assert.ok(Buffer.byteLength(JSON.stringify(doc)) > 65536); rejects(doc);
});

// Actual CLI calls are confined to a new synthetic project/production/data root.
// Denial must precede provider checks, launchctl, backup or pointer changes.
test('actual install/rollback refuse old, missing and corrupt v4 capability before any effects, even for empty v4', () => fixture(ledger(false), f => {
  const project = join(f.dir, 'source'), scripts = join(project, 'scripts'), production = join(f.dir, 'production'), bin = join(f.dir, 'bin');
  for (const path of [scripts, production, bin]) mkdirSync(path, { recursive: true });
  for (const name of ['studio-production.mjs', 'studio-adaptive-compatibility.mjs']) cpSync(new URL(name, import.meta.url), join(scripts, name));
  writeFileSync(join(project, '.gitignore'), '.next/\n');
  const git = (...args) => { const r = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Vox fixture', '-c', 'user.email=fixture@invalid.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'synthetic RF2 release');
  mkdirSync(join(project, '.next', 'standalone', '.next'), { recursive: true }); writeFileSync(join(project, '.next', 'standalone', 'server.js'), 'throw new Error("must not start");');
  for (const path of [join(project, '.next'), join(project, '.next', 'standalone', '.next')]) writeFileSync(join(path, 'BUILD_ID'), metadata.buildId);
  const current = join(production, 'current-release'), previous = join(production, 'previous-release');
  for (const path of [current, previous]) { mkdirSync(path); writeFileSync(join(path, 'server.js'), 'synthetic'); }
  symlinkSync(current, join(production, 'current')); writeFileSync(join(production, 'previous'), previous);
  writeFileSync(join(production, 'production.env'), `STUDIO_DATA_DIR='${f.env.STUDIO_DATA_DIR}'\nSTUDIO_ADAPTIVE_FORMAT='file'\n`);
  const signal = join(f.dir, 'unexpected-effect'), guard = join(f.dir, 'guard.mjs');
  writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\nprintf called >> '${signal}'\nexit 1\n`, { mode: 0o700 });
  writeFileSync(guard, `import{appendFileSync}from'node:fs';import net from'node:net';import http from'node:http';import https from'node:https';import{syncBuiltinESMExports}from'node:module';const deny=()=>{appendFileSync(${JSON.stringify(signal)},'effect');throw Error('synthetic effect denied')};globalThis.fetch=async()=>deny();net.createConnection=deny;net.connect=deny;http.request=deny;https.request=deny;syncBuiltinESMExports();`);
  const invoke = command => spawnSync(process.execPath, ['--import', guard, join(scripts, 'studio-production.mjs'), command], { cwd: project, env: { PATH: `${bin}:${process.env.PATH}`, VOX_PRODUCTION_DIR: production }, encoding: 'utf8', timeout: 10000 });
  const { supportedRightsLedgerVersions: omitted, ...without } = capabilities; assert.ok(omitted.includes(4));
  for (const fields of [without, { ...capabilities, supportedRightsLedgerVersions: [1, 2, 3] }, { ...capabilities, supportedRightsLedgerVersions: null }, { ...capabilities, supportedRightsLedgerVersions: [4, 4] }]) {
    writeFileSync(join(project, '.next', 'studio-release.json'), JSON.stringify({ ...metadata, revision: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'), ...fields }));
    writeFileSync(join(previous, 'studio-release.json'), JSON.stringify({ ...metadata, ...fields }));
    for (const command of ['install', 'rollback']) { const result = invoke(command); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /Adaptive storage is incompatible/); }
    assert.equal(existsSync(signal), false); assert.equal(existsSync(join(production, 'releases')), false); assert.equal(existsSync(join(production, 'backups')), false);
    assert.equal(realpathSync(join(production, 'current')), realpathSync(current));
  }
  rmSync(join(previous, 'studio-release.json')); assert.equal(readInstalledReleaseManifest(previous), null);
  assert.match(invoke('rollback').stderr, /Adaptive storage is incompatible/);
  writeFileSync(join(previous, 'studio-release.json'), '{'); assert.throws(() => readInstalledReleaseManifest(previous), /incompatible/);
  assert.match(invoke('rollback').stderr, /Adaptive storage is incompatible/); assert.equal(existsSync(signal), false);
}));
