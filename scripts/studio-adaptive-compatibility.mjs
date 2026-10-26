/** Read-only release admission. Runtime storage validation remains authoritative. */
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, opendirSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve, parse, relative, sep } from 'node:path';

export const ADAPTIVE_RELEASE_CAPABILITIES = Object.freeze({
  supportedAdaptiveDataSchemas: Object.freeze([1, 2, 3]),
  supportedAdaptiveControlSchemas: Object.freeze([1, 2, 3]),
  productPauseEnforcementVersion: 1,
  rightsUseHoldEnforcementVersion: 1,
  supportedFileAuthorityProjectionVersions: Object.freeze([1, 2]),
  supportedObserverClientExperienceVersions: Object.freeze([1]),
  supportedRightsLedgerVersions: Object.freeze([1, 2, 3, 4]),
  supportedExperimentLedgerSchemas: Object.freeze([1]),
  supportedGuestRightsLedgerSchemas: Object.freeze([1]),
  supportedImprovementWorkflowSchemas: Object.freeze([1, 2]),
  supportedPetCareSchemas: Object.freeze([1]),
  supportedConnectionRecordSchemas: Object.freeze([1, 2]),
  supportedSelfServiceMcpSchemas: Object.freeze([1]),
  supportedReplyUseSchemas: Object.freeze([1]),
  supportedProviderTemplateSchemas: Object.freeze([1]),
  supportedAssistantDeliveryControlVersions: Object.freeze([1]),
  supportedTelegramArchiveSchemas: Object.freeze([1]),
  supportedTelegramArchiveSourceSuppressionVersions: Object.freeze([1]),
  supportedTelegramArchiveSnapshotPublicationVersions: Object.freeze([1]),
});
const fail = () => { throw new Error('Adaptive storage is incompatible with this release; current personalization controls must be preserved.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const knownKeys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const MAX_ACCOUNT_BYTES = 700_000, MAX_SCAN_BYTES = 64 * 1024 * 1024, MAX_ACCOUNTS = 10_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const hashValue = value => hash(JSON.stringify(value));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const account = value => typeof value === 'string' && /^telegram-account:[1-9]\d{0,15}$/.test(value);
const positive = value => integer(value) && value > 0;
const stat = path => lstatSync(path, { throwIfNoEntry: false });
function safePath(path, kind, optional = false) {
  let absolute = resolve(path);
  for (const [alias, target] of [['/tmp', '/private/tmp'], ['/var', '/private/var']]) {
    if (absolute !== alias && !absolute.startsWith(`${alias}/`)) continue;
    if (stat(alias)?.isSymbolicLink()) { const link = readlinkSync(alias); if (link !== target && link !== target.slice(1)) fail(); absolute = join(target, relative(alias, absolute)); } break;
  }
  let current = parse(absolute).root;
  const parts = relative(current, absolute).split(sep).filter(Boolean);
  for (const [i, part] of parts.entries()) {
    current = join(current, part); const info = stat(current);
    if (!info) { if (optional) return null; fail(); }
    if (info.isSymbolicLink() || (i < parts.length - 1 || kind === 'directory') && !info.isDirectory() ||
      i === parts.length - 1 && kind === 'file' && (!info.isFile() || info.nlink !== 1)) fail();
  }
  return absolute;
}
function readBounded(path, max = 65536, budget) {
  const safe = safePath(path, 'file'), info = stat(safe);
  if (info.size > max || budget && (budget.bytes += info.size) > MAX_SCAN_BYTES) fail();
  const fd = openSync(safe, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd); if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev || opened.size > max) fail();
    const bytes = Buffer.alloc(max + 1); let length = 0, got;
    do { got = readSync(fd, bytes, length, bytes.length - length, null); length += got; } while (got > 0 && length < bytes.length);
    if (length > max) fail(); safePath(safe, 'file'); const latest = stat(safe);
    if (latest.ino !== opened.ino || latest.dev !== opened.dev || latest.size !== opened.size || latest.mtimeMs !== opened.mtimeMs) fail();
    return bytes.subarray(0, length).toString('utf8');
  } finally { closeSync(fd); }
}
function readPlainJson(path, max = 65536, budget) { try { return JSON.parse(readBounded(path, max, budget)); } catch { fail(); } }
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const canonicalHash = value => hash(canonical(value));
const boundedText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const rightsScopes = ['work', 'personal'].flatMap(space => ['optional.personalization', 'optional.product_analytics'].map(purpose => ({ space, purpose })));
const sameScope = (a, b) => a.space === b.space && a.purpose === b.purpose;
const rightsScope = value => object(value) && rightsScopes.some(scope => sameScope(scope, value));
const policyBinding = value => keys(value, ['id', 'revision', 'digest', 'approvalReference', 'decisionReference']) &&
  boundedText(value.id, 100) && positive(value.revision) && digest(value.digest) && boundedText(value.approvalReference, 200) && boundedText(value.decisionReference, 200);
const noticeBinding = value => keys(value, ['version', 'digest']) && boundedText(value.version, 100) && digest(value.digest);
const retentionNamespace = value => value === 'canonical' || digest(value);

/** Validate only bounded hold metadata, then reproduce the body-free projection.
 * Full canonical validation and current policy remain runtime responsibilities. */
function scanRightsUseHolds(value) {
  if (!keys(value, ['version', 'scopes', 'effects']) || value.version !== 1 || !Array.isArray(value.scopes) || value.scopes.length !== 4 ||
      !Array.isArray(value.effects) || value.effects.length > 128) fail();
  for (const [i, scope] of value.scopes.entries()) {
    if (!keys(scope, ['space', 'purpose', 'useEpoch']) || !sameScope(scope, rightsScopes[i]) || !integer(scope.useEpoch)) fail();
  }
  const seen = new Set(), effects = [];
  for (const effect of value.effects) {
    if (!object(effect) || !['active', 'released'].includes(effect.state) ||
        !keys(effect, ['version', 'effectId', 'requestId', 'space', 'purpose', 'revision', 'state', 'appliedAt', 'applyIntentDigest',
          'policy', 'notice', 'reviewAt', 'metadataRetainUntil', 'replayRetainUntil', ...(effect.state === 'released' ? ['release'] : [])]) ||
        effect.version !== 1 || !uuid(effect.effectId) || !uuid(effect.requestId) || seen.has(effect.effectId) ||
        !rightsScope(effect) || !positive(effect.revision) || !integer(effect.appliedAt) || !digest(effect.applyIntentDigest) ||
        !policyBinding(effect.policy) || !noticeBinding(effect.notice) ||
        [effect.reviewAt, effect.metadataRetainUntil, effect.replayRetainUntil].some(time => !integer(time) || time < effect.appliedAt)) fail();
    seen.add(effect.effectId);
    if (effect.state === 'released' && (!keys(effect.release, ['releasedAt', 'releaseIntentDigest', 'policy', 'notice']) ||
        !integer(effect.release.releasedAt) || effect.release.releasedAt < effect.appliedAt || effect.revision < 2 ||
        !digest(effect.release.releaseIntentDigest) || !policyBinding(effect.release.policy) || !noticeBinding(effect.release.notice))) fail();
    effects.push({ effectId: effect.effectId, requestId: effect.requestId, space: effect.space, purpose: effect.purpose,
      state: effect.state, revision: effect.revision, appliedAt: effect.appliedAt, applyIntentDigest: effect.applyIntentDigest,
      effectDigest: canonicalHash(effect), ...(effect.release ? { releasedAt: effect.release.releasedAt, releaseIntentDigest: effect.release.releaseIntentDigest } : {}) });
  }
  const scopes = value.scopes.map(scope => {
    const scoped = effects.filter(effect => sameScope(effect, scope));
    if (scope.useEpoch < scoped.reduce((count, effect) => count + (effect.state === 'released' ? 2 : 1), 0)) fail();
    const active = scoped.filter(effect => effect.state === 'active').sort((a, b) => a.effectId < b.effectId ? -1 : a.effectId > b.effectId ? 1 : 0);
    return { ...scope, effectiveBlocked: active.length > 0, activeEffectsDigest: canonicalHash(active) };
  });
  return { version: 1, scopes, effects };
}
function scanRightsUseControls(doc, controls) {
  if (doc.schemaVersion !== 3) return;
  const expected = scanRightsUseHolds(doc.rightsUseHolds);
  if (!object(controls) || controls.schemaVersion !== 3 || controls.accountId !== doc.accountId ||
      controls.personId !== doc.personId || controls.revision !== doc.revision || controls.createdAt !== doc.createdAt ||
      controls.updatedAt !== doc.updatedAt || controls.retentionStoreIdentity !== doc.retentionStoreIdentity ||
      canonical(controls.rightsUseControls) !== canonical(expected)) fail();
}
function scanLocalUseLedger(doc) {
  const value = doc.localUse, v4 = id => uuid(id) && id[14] === '4';
  if (!keys(value, ['version', 'intents', 'acknowledgements']) || value.version !== 1 || !Array.isArray(value.intents) ||
      value.intents.length > 128 || !Array.isArray(value.acknowledgements) || value.acknowledgements.length > 128) fail();
  const intents = new Map(), applies = new Map(), releaseHeads = new Map(), superseded = new Set();
  for (const intent of value.intents) {
    if (!object(intent) || !['apply', 'release'].includes(intent.action) ||
        !keys(intent, ['version', 'eventId', 'fingerprint', 'intentDigest', 'requestId', 'requestRevision', 'scope', 'action', 'effectId', 'createdAt',
          'expectedCanonicalRevision', 'expectedUseEpoch', ...(intent.action === 'release' ? ['expectedEffectRevision', 'expectedEffectDigest'] : []),
          ...(Object.hasOwn(intent, 'supersedesEventId') ? ['supersedesEventId'] : []),
          'policy', 'notice', 'reviewAt', 'metadataRetainUntil', 'replayRetainUntil', 'receiptRetainUntil']) ||
        intent.version !== 1 || !v4(intent.eventId) || !v4(intent.requestId) || !v4(intent.effectId) || intents.has(intent.eventId) ||
        !digest(intent.fingerprint) || !digest(intent.intentDigest) || !positive(intent.requestRevision) ||
        !keys(intent.scope, ['space', 'purpose']) || !rightsScope(intent.scope) || !integer(intent.createdAt) || intent.createdAt > doc.observedServerTime ||
        !positive(intent.expectedCanonicalRevision) || !integer(intent.expectedUseEpoch) ||
        intent.action === 'release' && (!positive(intent.expectedEffectRevision) || !digest(intent.expectedEffectDigest)) ||
        Object.hasOwn(intent, 'supersedesEventId') && (intent.action !== 'release' || !v4(intent.supersedesEventId)) ||
        !policyBinding(intent.policy) || !noticeBinding(intent.notice) ||
        [intent.reviewAt, intent.metadataRetainUntil, intent.replayRetainUntil, intent.receiptRetainUntil].some(time => !integer(time) || time <= intent.createdAt)) fail();
    const command = Object.fromEntries(Object.entries(intent).filter(([key]) => key !== 'version' && key !== 'intentDigest'));
    if (intent.intentDigest !== canonicalHash(['vox.rights.local-use.intent.v1', { accountId: doc.accountId, ...command }]) ||
        intent.fingerprint !== canonicalHash(['vox.rights.local-use.command.v1', { accountId: doc.accountId, requestId: intent.requestId,
          scope: intent.scope, action: intent.action, eventId: intent.eventId, policyDigest: intent.policy.digest, notice: intent.notice,
          ...(intent.action === 'release' ? { selectedEffectId: intent.effectId } : {}),
          ...(intent.supersedesEventId ? { supersedesEventId: intent.supersedesEventId } : {}) }]) ||
        !doc.requests.some(request => request.requestId === intent.requestId && request.space === intent.scope.space &&
          request.revision >= intent.requestRevision && ['restriction', 'objection'].includes(request.kind)) ||
        doc.commandReceipts.some(receipt => receipt.eventId === intent.eventId)) fail();
    if (intent.action === 'apply') { if (applies.has(intent.effectId)) fail(); applies.set(intent.effectId, intent); }
    else {
      const previous = releaseHeads.get(intent.effectId);
      if (intent.supersedesEventId) {
        if (!previous || previous.eventId !== intent.supersedesEventId || !intents.has(intent.supersedesEventId) ||
            previous.requestId !== intent.requestId || !sameScope(previous.scope, intent.scope) ||
            previous.createdAt > intent.createdAt || superseded.has(previous.eventId)) fail();
        superseded.add(previous.eventId);
      } else if (previous) fail();
      releaseHeads.set(intent.effectId, intent);
    }
    intents.set(intent.eventId, intent);
  }
  for (const intent of intents.values()) if (intent.action === 'release') {
    const apply = applies.get(intent.effectId);
    if (!apply || apply.requestId !== intent.requestId || !sameScope(apply.scope, intent.scope)) fail();
  }
  const seen = new Set();
  for (const ack of value.acknowledgements) {
    if (!keys(ack, ['version', 'eventId', 'intentDigest', 'effectId', 'accountRevision', 'useEpoch', 'effectRevision', 'effectDigest',
      'effectState', 'observedAt', 'recordedAt', 'retainUntil']) || ack.version !== 1 || !v4(ack.eventId) || !v4(ack.effectId) ||
      seen.has(ack.eventId) || !digest(ack.intentDigest) || !digest(ack.effectDigest) || !positive(ack.accountRevision) ||
      !integer(ack.useEpoch) || !positive(ack.effectRevision) || !['active', 'released'].includes(ack.effectState) ||
      !integer(ack.observedAt) || !integer(ack.recordedAt) || !integer(ack.retainUntil)) fail();
    seen.add(ack.eventId);
    const intent = intents.get(ack.eventId);
    if (!intent || superseded.has(ack.eventId) || ack.intentDigest !== intent.intentDigest || ack.effectId !== intent.effectId || ack.observedAt < intent.createdAt ||
        ack.accountRevision <= intent.expectedCanonicalRevision || ack.useEpoch <= intent.expectedUseEpoch ||
        intent.action === 'release' && ack.effectRevision <= intent.expectedEffectRevision ||
        ack.recordedAt < ack.observedAt || ack.recordedAt > doc.observedServerTime || ack.retainUntil < intent.receiptRetainUntil ||
        ack.retainUntil <= ack.recordedAt || intent.action === 'release' && ack.effectState !== 'released') fail();
  }
}
/** RF2 metadata admission matches the immutable v4 contract. This checks neither
 * current policy/authority nor canonical deletion proof; runtime owns both. */
function scanLocalErasureLedger(doc) {
  const value = doc.localErasure, v4 = id => uuid(id) && id[14] === '4';
  if (!keys(value, ['version', 'operations']) || value.version !== 1 || !Array.isArray(value.operations) || value.operations.length > 32) fail();
  for (const receipt of doc.commandReceipts) {
    if (!keys(receipt, ['eventId', 'fingerprint', 'requestId', 'resultingRequestRevision', 'action', 'recordedAt', 'retainUntil']) ||
        !v4(receipt.eventId) || !v4(receipt.requestId) || !boundedText(receipt.action, 50) ||
        receipt.recordedAt > doc.observedServerTime || receipt.retainUntil <= receipt.recordedAt) fail();
  }
  const eventIds = [...doc.commandReceipts, ...doc.localUse.intents, ...value.operations].map(row => row?.eventId);
  if (new Set(eventIds).size !== eventIds.length) fail();
  for (const operation of value.operations) {
    if (!object(operation) || !keys(operation, ['version', 'eventId', 'fingerprint', 'requestId', 'requestRevision', 'space', 'memoryId',
      'expectedCanonicalRevision', 'expectedBindingDigest', 'witness', 'witnessDigest', 'createdAt', 'expiresAt', 'executionDeadline',
      'policyDigest', 'noticeDigest', 'metadataRetainUntil', 'replayRetainUntil', 'receiptRetainUntil',
      ...(Object.hasOwn(operation, 'acknowledgement') ? ['acknowledgement'] : [])]) ||
      operation.version !== 1 || !v4(operation.eventId) || !v4(operation.requestId) || !positive(operation.requestRevision) ||
      !['work', 'personal'].includes(operation.space) || !boundedText(operation.memoryId, 200) || !positive(operation.expectedCanonicalRevision) ||
      ['fingerprint', 'expectedBindingDigest', 'witnessDigest', 'policyDigest', 'noticeDigest'].some(field => !digest(operation[field])) ||
      ['createdAt', 'expiresAt', 'executionDeadline', 'metadataRetainUntil', 'replayRetainUntil', 'receiptRetainUntil'].some(field => !integer(operation[field])) ||
      operation.createdAt > doc.observedServerTime || operation.expiresAt <= operation.createdAt || operation.executionDeadline < operation.expiresAt ||
      [operation.metadataRetainUntil, operation.replayRetainUntil, operation.receiptRetainUntil].some(time => time < operation.executionDeadline) ||
      !Array.isArray(operation.witness) || operation.witness.length < 1 || operation.witness.length > 300) fail();
    for (const [index, witness] of operation.witness.entries()) {
      if (!keys(witness, ['id', 'space', 'beforeRevision', 'beforeEpoch', 'beforeStatus', 'afterRevision', 'afterEpoch', 'afterStatus', 'sourceRefsDigest']) ||
          !boundedText(witness.id, 200) || witness.space !== operation.space || !positive(witness.beforeRevision) || !integer(witness.beforeEpoch) ||
          !['active', 'deleted'].includes(witness.beforeStatus) || !positive(witness.afterRevision) || !integer(witness.afterEpoch) ||
          witness.afterStatus !== 'deleted' || !digest(witness.sourceRefsDigest) || index > 0 && operation.witness[index - 1].id >= witness.id ||
          witness.afterRevision !== witness.beforeRevision + (witness.beforeStatus === 'active' ? 1 : 0) ||
          witness.afterEpoch !== witness.beforeEpoch + (witness.beforeStatus === 'active' ? 1 : 0)) fail();
    }
    const selected = operation.witness.find(witness => witness.id === operation.memoryId);
    const intent = Object.fromEntries(Object.entries(operation).filter(([field]) => !['fingerprint', 'acknowledgement'].includes(field)));
    if (!selected || selected.beforeStatus !== 'active' || operation.witnessDigest !== canonicalHash(operation.witness) ||
        operation.fingerprint !== canonicalHash(['vox.rights.private-note-erasure.intent.v1', doc.accountId, intent]) ||
        !doc.requests.some(request => request.requestId === operation.requestId && request.space === operation.space &&
          request.kind === 'erasure' && request.revision >= operation.requestRevision)) fail();
    if (!Object.hasOwn(operation, 'acknowledgement')) continue;
    const ack = operation.acknowledgement;
    if (!object(ack) || !keys(ack, ['effectRevision', 'observedAt', 'recordedAt', 'retainUntil',
      ...(Object.hasOwn(ack, 'recordingAuthority') ? ['recordingAuthority'] : [])]) || !positive(ack.effectRevision) ||
      ['observedAt', 'recordedAt', 'retainUntil'].some(field => !integer(ack[field])) ||
      ack.effectRevision !== operation.expectedCanonicalRevision + 1 || ack.observedAt < operation.createdAt ||
      ack.recordedAt < ack.observedAt || ack.recordedAt > doc.observedServerTime || ack.retainUntil < operation.receiptRetainUntil ||
      ack.retainUntil <= ack.recordedAt) fail();
    if (!Object.hasOwn(ack, 'recordingAuthority')) continue;
    const authority = ack.recordingAuthority;
    if (!keys(authority, ['version', 'commandEventId', 'requestRevision', 'policy', 'operatorRef']) || authority.version !== 1 ||
        !v4(authority.commandEventId) || !positive(authority.requestRevision) || authority.requestRevision < operation.requestRevision ||
        !keys(authority.policy, ['id', 'revision', 'digest']) || !boundedText(authority.policy.id, 100) ||
        !positive(authority.policy.revision) || !digest(authority.policy.digest) || !digest(authority.operatorRef) ||
        !doc.requests.some(request => request.requestId === operation.requestId && request.revision >= authority.requestRevision) ||
        !doc.commandReceipts.some(receipt => receipt.eventId === authority.commandEventId && receipt.requestId === operation.requestId &&
          receipt.resultingRequestRevision === authority.requestRevision && receipt.action === 'private_note_erasure_reconcile' &&
          receipt.recordedAt === ack.recordedAt && receipt.retainUntil >= ack.retainUntil &&
          receipt.fingerprint === canonicalHash(['vox.rights.private-note-erasure.reconcile.v1', doc.accountId, operation.requestId,
            operation.space, operation.fingerprint, operation.witnessDigest, authority]))) fail();
  }
}
function entries(directory, limit = MAX_ACCOUNTS + 4) {
  const safe = safePath(directory, 'directory', true); if (!safe) return [];
  const dir = opendirSync(safe), result = [];
  try { let item; while ((item = dir.readSync())) { if (result.length >= limit) fail(); if (item.isSymbolicLink()) fail(); result.push(item.name); } }
  finally { dir.closeSync(); } return result;
}
export function readInstalledReleaseManifest(release) {
  try { safePath(release, 'directory');
  const path = join(release, 'studio-release.json');
  if (!lstatSync(path, { throwIfNoEntry: false })) return null; // Old releases support only v1.
  const manifest = readPlainJson(path);
  // Absence on a genuinely old release differs from a present corrupt record.
  // Never reinterpret a damaged new record as an older capability declaration.
  if (!object(manifest) || typeof manifest.revision !== 'string' || !/^[a-f0-9]{40}$/.test(manifest.revision) ||
      typeof manifest.sourceTree !== 'string' || !/^[a-f0-9]{40}$/.test(manifest.sourceTree) ||
      typeof manifest.buildId !== 'string' || !manifest.buildId.trim() || manifest.buildId.length > 200 ||
      typeof manifest.builtAt !== 'string' || !Number.isFinite(Date.parse(manifest.builtAt)) ||
      new Date(manifest.builtAt).toISOString() !== manifest.builtAt) fail();
  return manifest;
  } catch { fail(); }
}

/** No data/consent writes or legacy inference from an invalid/new marker. */
function coreCapabilities(env) {
  if (typeof env.STUDIO_DATA_DIR !== 'string' || !isAbsolute(env.STUDIO_DATA_DIR) || resolve(env.STUDIO_DATA_DIR) === '/') fail();
  const format = env.STUDIO_ADAPTIVE_FORMAT?.trim() || 'file';
  if (!['file', 'sqlite-v1', 'file-v2'].includes(format)) fail();
  const root = join(env.STUDIO_DATA_DIR, 'adaptive');
  const managed = `${resolve(root)}.managed`;
  const directory = lstatSync(managed, { throwIfNoEntry: false });
  if (!directory) {
    if (format !== 'file') fail();
    const legacy = lstatSync(root, { throwIfNoEntry: false });
    if (legacy && (!legacy.isDirectory() || legacy.isSymbolicLink())) fail();
    return { canonicalSchemaVersion: 1, controlsSchemaVersion: 1, productPauseEnforcementVersion: 0 };
  }
  if (format === 'file' || !directory.isDirectory() || directory.isSymbolicLink()) fail();
  const marker = readPlainJson(join(managed, 'format.json'));
  const common = ['version', 'state', 'rootId', 'format', 'store', 'identity', 'watermarkFloor'];
  const extra = ['canonicalSchemaVersion', 'controlsSchemaVersion', 'productPauseEnforcementVersion'];
  const fileProjection = [2, 3].includes(marker?.version) && format === 'file-v2' ? ['fileAuthorityProjectionVersion'] : [];
  const rights = marker?.version === 3 ? ['rightsUseHoldEnforcementVersion'] : [];
  if (!object(marker) || ![1, 2, 3].includes(marker.version) ||
      !keys(marker, marker.version === 1 ? common : [...common, ...extra, ...rights, ...fileProjection]) || marker.state !== 'ready' || marker.format !== format ||
      !uuid(marker.rootId) || !uuid(marker.store) || !keys(marker.identity, ['incarnation', 'generation']) ||
      !uuid(marker.identity.incarnation) || !integer(marker.identity.generation) || marker.identity.generation < 1 || !integer(marker.watermarkFloor)) fail();
  if (marker.version === 1) return { canonicalSchemaVersion: 1, controlsSchemaVersion: 1, productPauseEnforcementVersion: 0 };
  if (marker.canonicalSchemaVersion !== marker.version || marker.controlsSchemaVersion !== marker.version || marker.productPauseEnforcementVersion !== 1 ||
      rights.length && marker.rightsUseHoldEnforcementVersion !== 1) fail();
  const projectionVersion = marker.version === 3 ? 2 : 1;
  if (fileProjection.length && marker.fileAuthorityProjectionVersion !== projectionVersion) fail();
  return { canonicalSchemaVersion: marker.version, controlsSchemaVersion: marker.version, productPauseEnforcementVersion: 1,
    ...(rights.length ? { rightsUseHoldEnforcementVersion: 1 } : {}),
    ...(fileProjection.length ? { fileAuthorityProjectionVersion: projectionVersion } : {}) };
}

function scanObserver(observer, required, canonicalVersion) {
  if (observer === undefined) return;
  if (!object(observer) || observer.schemaVersion !== 1 || Object.keys(observer).some(k => !['schemaVersion', 'events', 'projections', 'corrections'].includes(k)) ||
      !Array.isArray(observer.events) || observer.events.length > 200 || !Array.isArray(observer.projections) || observer.projections.length > 2) fail();
  if (Object.hasOwn(observer, 'corrections')) {
    if (!Array.isArray(observer.corrections) || observer.corrections.length > 200 || observer.corrections.some(r => !object(r) || r.version !== 1 || !digest(r.id) || !['correction_client_saved', 'correction_client_unconfirmed'].includes(r.outcome))) fail();
    for (const correction of observer.corrections) {
      if (canonicalVersion === 3) {
        if (!knownKeys(correction, ['version', 'id', 'fingerprint', 'space', 'policyReceipt', 'retentionStoreIdentity', 'trust', 'outcome', 'mutationEvidence', 'occurredAt', 'expiresAt']) ||
            !retentionNamespace(correction.retentionStoreIdentity)) fail();
      } else if (Object.hasOwn(correction, 'retentionStoreIdentity') || Object.hasOwn(correction, 'rightsUseStamp')) fail();
    }
    required.observerClientExperienceVersion = 1;
  }
  const outcomes = ['responded', 'failed', 'cancelled', 'unknown', 'playback_started', 'playback_completed', 'playback_failed', 'interrupted', 'task_succeeded', 'task_failed', 'task_unknown', 'text_rendered'];
  for (const event of observer.events) {
    if (!knownKeys(event, ['schemaVersion', 'version', 'id', 'fingerprint', 'revision', 'turnKey', 'origin', 'purpose', 'policyVersion', 'consentEpoch', 'permissionRevision', 'grantRevision', 'bindingRevision', 'accountId', 'personId', 'space', 'spaceId', 'agentId', 'policyReceipt', 'clientExperienceVersion', 'trust', 'channel', 'outcome', 'telemetry', 'operation', 'durationMs', 'occurredAt', 'receivedAt', 'expiresAt', 'state', 'attempts', 'nextAttemptAt', 'leaseId', 'leaseUntil', 'processedAt', 'failureCode', ...(canonicalVersion === 3 ? ['retentionStoreIdentity', 'rightsUseStamp'] : [])]) || event.schemaVersion !== 1 || event.version !== 'vox-observer-v1' || !digest(event.id) || !outcomes.includes(event.outcome)) fail();
    if (canonicalVersion === 3 && (!retentionNamespace(event.retentionStoreIdentity) ||
        Object.hasOwn(event, 'rightsUseStamp') && !digest(event.rightsUseStamp))) fail();
    if (Object.hasOwn(event, 'clientExperienceVersion') || event.outcome === 'text_rendered') {
      if (event.clientExperienceVersion !== 1 || event.outcome !== 'text_rendered' || event.channel !== 'text' || event.trust !== 'client_unverified') fail(); required.observerClientExperienceVersion = 1;
    }
  }
  for (const projection of observer.projections) {
    if (!knownKeys(projection, ['space', 'sourceDigest', 'sourceEvents', 'responded', 'failed', 'cancelled', 'unknownResponses', 'taskOutcomesUnknown', 'timedResponses', 'responseTurns', 'meanResponseMs', 'playbackStarted', 'playbackCompleted', 'playbackFailed', 'interruptions', 'playbackUnknown', 'telemetry', 'clientExperience', 'findings']) || !['work', 'personal'].includes(projection.space)) fail();
    if (Object.hasOwn(projection, 'clientExperience')) { const e = projection.clientExperience;
      if (!keys(e, ['version', 'trust', 'textRendered', 'textTimingSamples', 'meanTimeToTextMs', 'correctionSaved', 'correctionUnconfirmed', 'correctionAcceptedReceipts']) || e.version !== 1 || e.trust !== 'client_unverified' ||
        ['textRendered', 'textTimingSamples', 'correctionSaved', 'correctionUnconfirmed', 'correctionAcceptedReceipts'].some(k => !integer(e[k])) || e.meanTimeToTextMs !== null && (typeof e.meanTimeToTextMs !== 'number' || !Number.isFinite(e.meanTimeToTextMs) || e.meanTimeToTextMs < 0)) fail();
      required.observerClientExperienceVersion = 1;
    }
  }
}
const archiveId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
function scanArchiveFile(value, head = false) {
  if (!keys(value, ['fileId', 'digest', 'messageId', ...(head ? ['sequence'] : [])]) || !archiveId(value.fileId) ||
      !digest(value.digest) || !positive(value.messageId) || head && (!positive(value.sequence) || value.sequence > 128)) fail();
}
function scanArchiveScope(value, doc, row) {
  if (!keys(value, ['accountId', 'personId', 'agentId', 'space', 'containerId']) || value.accountId !== doc.accountId ||
      value.personId !== doc.personId || value.agentId !== row.agentId || value.space !== row.space ||
      value.containerId !== `private-tenant:${hashValue(doc.accountId).slice(0, 24)}:${row.space}:private`) fail();
}
/** Read only strict control metadata. Source text/chunks are never opened by
 * release admission, and an omitted marker cannot hide a new nested format. */
function scanArchivePublication(row, doc, required) {
  const marked = Object.hasOwn(row, 'snapshotPublicationVersion');
  const hasSnapshot = object(row.state) && Object.hasOwn(row.state, 'snapshot');
  const hasPublication = object(row.state) && Object.hasOwn(row.state, 'publication');
  const hasRetired = Object.hasOwn(row, 'retiredOperation');
  if ((marked && row.snapshotPublicationVersion !== 1) || ((hasSnapshot || hasPublication || hasRetired) && !marked)) fail();
  if (!marked) return;
  required.telegramArchiveSnapshotPublicationVersion = 1;
  if (hasSnapshot || hasPublication) {
    scanArchiveScope(row.state.scope, doc, row);
    if (!positive(row.state.botId)) fail();
  }
  if (hasSnapshot) {
    const s = row.state.snapshot;
    if (!keys(s, ['version', 'manifest', 'baseHead', 'receiptCount', 'receiptDigest', 'sourceStateDigest', 'planDigest', 'chunks']) || s.version !== 1 ||
        !positive(s.receiptCount) || s.receiptCount > 1024 || !positive(s.chunks) || s.chunks > 16 ||
        !digest(s.receiptDigest) || !digest(s.sourceStateDigest) || !digest(s.planDigest)) fail();
    scanArchiveFile(s.manifest); scanArchiveFile(s.baseHead, true);
  }
  if (hasPublication) {
    const p = row.state.publication;
    if (!object(p)) fail();
    if (hasSnapshot || row.state.operation || !keys(p, ['id', 'stage', 'authorityRevision', 'authorityDigest', 'sourceRevision', 'sourceStateDigest', 'sourceHead',
      'receiptCount', 'receiptDigest', 'createdAt', 'validUntil', 'planJson', 'planDigest', 'chunkRefs', 'ordinal', 'budgetBytes', 'reservation', ...(Object.hasOwn(p, 'manifest') ? ['manifest'] : [])]) ||
      !archiveId(p.id) || !['prepared', 'chunk_sending', 'chunk_uploaded', 'manifest_sending', 'manifest_uploaded', 'ready', 'unknown'].includes(p.stage) ||
      !archiveId(p.authorityRevision) || !digest(p.authorityDigest) || !integer(p.sourceRevision) || !digest(p.sourceStateDigest) ||
      !positive(p.receiptCount) || p.receiptCount > 1024 || !digest(p.receiptDigest) || !integer(p.createdAt) || !integer(p.validUntil) || p.validUntil <= p.createdAt ||
      typeof p.planJson !== 'string' || !p.planJson.length || Buffer.byteLength(p.planJson) > 128 * 1024 || !digest(p.planDigest) ||
      !Array.isArray(p.chunkRefs) || p.chunkRefs.length > 16 || !integer(p.ordinal) || p.ordinal > 16 ||
      !positive(p.budgetBytes) || p.budgetBytes > 192 * 1024 || typeof p.reservation !== 'string' || Buffer.byteLength(p.reservation) > 192 * 1024 || !/^[\x20-\x7e]*$/.test(p.reservation)) fail();
    scanArchiveFile(p.sourceHead, true); p.chunkRefs.forEach(ref => scanArchiveFile(ref));
    if (p.manifest) scanArchiveFile(p.manifest);
    let plan; try { plan = JSON.parse(p.planJson); } catch { fail(); }
    if (!keys(plan, ['schemaVersion', 'kind', 'scope', 'botId', 'createdAt', 'sourceRevision', 'authorityRevision', 'authorityExpiresAt', 'suppressedEventIds',
      'sourceHead', 'stateDigest', 'authorityDigest', 'receiptCount', 'sourceFiles', 'sourceBytes', 'chunks']) || plan.schemaVersion !== 1 || plan.kind !== 'snapshot-plan' ||
      !positive(plan.botId) || !integer(plan.createdAt) || !integer(plan.sourceRevision) || !archiveId(plan.authorityRevision) || !integer(plan.authorityExpiresAt) ||
      !Array.isArray(plan.suppressedEventIds) || plan.suppressedEventIds.length > 1024 || !plan.suppressedEventIds.every(archiveId) ||
      !digest(plan.stateDigest) || !digest(plan.authorityDigest) || !positive(plan.receiptCount) || plan.receiptCount > 1024 ||
      !integer(plan.sourceFiles) || plan.sourceFiles > 256 || !integer(plan.sourceBytes) || plan.sourceBytes > 32 * 1024 * 1024 ||
      !Array.isArray(plan.chunks) || !plan.chunks.length || plan.chunks.length > 16) fail();
    scanArchiveScope(plan.scope, doc, row); scanArchiveFile(plan.sourceHead, true);
    for (const ref of plan.chunks) if (!keys(ref, ['ordinal', 'digest', 'bytes', 'entries']) || !integer(ref.ordinal) || ref.ordinal > 15 ||
      !digest(ref.digest) || !positive(ref.bytes) || ref.bytes > 128 * 1024 || !positive(ref.entries) || ref.entries > 1024) fail();
  }
  if (hasRetired) {
    const r = row.retiredOperation;
    if (!keys(r, ['kind', 'id', 'scope', 'botId', 'createdAt', 'stage', 'files']) || !['checkpoint', 'snapshot'].includes(r.kind) ||
        !archiveId(r.id) || !positive(r.botId) || !integer(r.createdAt) || r.stage !== 'unknown' || !Array.isArray(r.files) || r.files.length > (r.kind === 'checkpoint' ? 1 : 17)) fail();
    scanArchiveScope(r.scope, doc, row); r.files.forEach(ref => scanArchiveFile(ref));
    if (row.state?.operation || hasPublication) fail();
    if (row.state && row.state.botId !== r.botId) fail();
  }
}
const ARC_MARKER = 'assistant-delivery-control-v1.json';
const ARC_MARKER_BYTES = '{"version":1,"kind":"assistant-delivery-control"}\n';
const arcNumber = n => integer(n) && !Object.is(n, -0);
const arcPositive = n => arcNumber(n) && n > 0;
const arcId = s => typeof s === 'string' && /^[A-Za-z0-9:_-]{1,128}(?![\s\S])/.test(s);
const arcHash = s => typeof s === 'string' && /^[a-f0-9]{64}(?![\s\S])/.test(s);
const arcUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(s);
const arcBytes = value => Buffer.byteLength(JSON.stringify(value));
function scanAssistantControl(doc, required) {
  if (!Object.hasOwn(doc, 'assistantDeliveryControl')) return;
  if (doc.schemaVersion !== 1 || required.assistantDeliveryControlVersion !== 1) fail();
  const c = doc.assistantDeliveryControl;
  if (!keys(c, ['version','policyVersion','revision','observedAt','noReplayBefore','sourceFenceSequence','historyEpoch','deletionEpoch','streams','effects']) || c.version !== 1 || c.policyVersion !== 'arc1-control-7d-v1' ||
      !['revision','observedAt','noReplayBefore','sourceFenceSequence','historyEpoch','deletionEpoch'].every(k => arcNumber(c[k])) || c.noReplayBefore > c.observedAt || c.observedAt > doc.updatedAt ||
      !Array.isArray(c.streams) || c.streams.length > 4 || !Array.isArray(c.effects) || c.effects.length > 32 || arcBytes({assistantDeliveryControl:c}) > 163840) fail();
  const streamKeys = new Set(), effectKeys = new Set();
  for (const t of c.streams) {
    const streamKey = `${t?.botId}:${t?.destinationChatId}`;
    if (!keys(t,['botId','destinationChatId','agentId','space','containerId','messageFloor','highMessageId','lastAcceptedAt']) || !arcPositive(t.botId) || !arcPositive(t.destinationChatId) ||
        doc.accountId !== `telegram-account:${t.destinationChatId}` || !arcId(t.agentId) || !['work','personal'].includes(t.space) ||
        t.containerId !== `private-tenant:${hashValue(doc.accountId).slice(0,24)}:${t.space}:private` || !arcNumber(t.messageFloor) || !arcNumber(t.highMessageId) || t.messageFloor > t.highMessageId ||
        !arcNumber(t.lastAcceptedAt) || t.lastAcceptedAt > c.observedAt || streamKeys.has(streamKey)) fail();
    streamKeys.add(streamKey);
  }
  for (const row of c.effects) {
    if (!keys(row,['state','retainUntil']) || !arcNumber(row.retainUntil)) fail();
    const s = row.state;
    if (!object(s) || !keys(s,['schemaVersion','kind','effectKey','scope','binding','source','authority','generationId','attemptId','evidence','createdAt','lastTransitionAt','expiresAt','revision','phase','contentEligible',
        ...(Object.hasOwn(s,'invalidatedAtFenceSequence')?['invalidatedAtFenceSequence']:[]),...(Object.hasOwn(s,'outcome')?['outcome']:[])]) || s.schemaVersion !== 1 || s.kind !== 'assistant-text-delivery' ||
        !arcUuid(s.generationId) || !arcUuid(s.attemptId) || !['generated','sending','sent','failed','cancelled','unknown'].includes(s.phase) || typeof s.contentEligible !== 'boolean' ||
        !['createdAt','lastTransitionAt','expiresAt','revision'].every(k=>arcNumber(s[k])) || s.createdAt > s.lastTransitionAt || s.lastTransitionAt > c.observedAt || s.expiresAt <= s.createdAt || s.expiresAt-s.createdAt>60000 ||
        row.retainUntil !== s.createdAt+7*86400_000 || !Number.isSafeInteger(s.createdAt+7*86400_000) || arcBytes(s)>4096) fail();
    const scope=s.scope,b=s.binding,source=s.source,a=s.authority,e=s.evidence;
    if (!keys(scope,['accountId','personId','agentId','space','containerId','kind']) || !Object.values(scope).every(arcId) || scope.kind!=='private' || scope.accountId!==doc.accountId || scope.personId!==doc.personId ||
        !keys(b,['botId','destinationChatId','endpointBindingId','credentialBindingId','bindingRevision']) || !arcPositive(b.botId) || !arcPositive(b.destinationChatId) || ![b.endpointBindingId,b.credentialBindingId,b.bindingRevision].every(arcId) ||
        !keys(source,['messageId','updateId','revision','occurredAt','acceptedAt']) || !Object.values(source).every(arcNumber) || !arcPositive(source.messageId) || source.revision!==0 || source.occurredAt>source.acceptedAt || source.acceptedAt>s.createdAt ||
        !keys(a,['authorityRevision','grantRevision','sourceFenceRevision','sourceFenceSequence','historyEpoch','deletionEpoch','expiresAt']) || ![a.authorityRevision,a.grantRevision,a.sourceFenceRevision].every(arcId) ||
        ![a.sourceFenceSequence,a.historyEpoch,a.deletionEpoch,a.expiresAt].every(arcNumber) || s.expiresAt>a.expiresAt ||
        !keys(e,['keyId','generatedHmac','generatedUtf16Length','submittedTextHmac','submittedUtf16Length','bodyHmac','bodyBytes']) || !arcId(e.keyId) || ![e.generatedHmac,e.submittedTextHmac,e.bodyHmac].every(arcHash) ||
        !arcPositive(e.generatedUtf16Length) || e.generatedUtf16Length>65536 || !arcPositive(e.submittedUtf16Length) || e.submittedUtf16Length>4096 || !arcPositive(e.bodyBytes) || e.bodyBytes>32768) fail();
    const stream=c.streams.find(t=>t.botId===b.botId&&t.destinationChatId===b.destinationChatId);
    if (!stream || stream.agentId!==scope.agentId || stream.space!==scope.space || stream.containerId!==scope.containerId ||
        s.effectKey!==JSON.stringify(['adp1','telegram',b.botId,b.destinationChatId,source.messageId,'initial','primary-text']) || effectKeys.has(s.effectKey)) fail();
    effectKeys.add(s.effectKey);
    if (s.contentEligible && (source.messageId<=stream.messageFloor || source.occurredAt<=c.noReplayBefore || a.sourceFenceSequence!==c.sourceFenceSequence || a.historyEpoch!==c.historyEpoch || a.deletionEpoch!==c.deletionEpoch)) fail();
    if (Object.hasOwn(s,'invalidatedAtFenceSequence') && (!arcNumber(s.invalidatedAtFenceSequence) || s.invalidatedAtFenceSequence<=a.sourceFenceSequence || s.contentEligible)) fail();
    const o=s.outcome;
    if (['generated','sending'].includes(s.phase)) {if (o!==undefined || s.revision!==(s.phase==='generated'?0:1)) fail();}
    else {
      if (!object(o)||!arcNumber(o.observedAt)||o.observedAt>s.lastTransitionAt||o.observedAt<s.createdAt||s.revision<(['sent','unknown'].includes(s.phase)?2:1))fail();
      if(s.phase==='sent'){
        const r=o.receipt;
        if(!keys(o,['reason','observedAt','receipt'])||o.reason!=='provider_accepted'||!keys(r,['messageId','botId','destinationChatId','providerDateSeconds','textEvidence'])||
          !arcPositive(r.messageId)||r.botId!==b.botId||r.destinationChatId!==b.destinationChatId||!arcNumber(r.providerDateSeconds)||!Number.isSafeInteger(r.providerDateSeconds*1000)||!['matches-submitted','different','unavailable'].includes(r.textEvidence))fail();
      }else if(!keys(o,['reason','observedAt']) || !(s.phase==='failed'?['pre_dispatch_failure']:s.phase==='cancelled'?['pre_dispatch_denied']:['dispatch_interrupted','transport_error','http_or_provider_rejection','invalid_response','invalid_receipt','receipt_commit_unconfirmed']).includes(o.reason))fail();
    }
  }
  const payload={...doc};delete payload.assistantDeliveryControl;
  if (arcBytes({...payload,revision:Number.MAX_SAFE_INTEGER,updatedAt:Number.MAX_SAFE_INTEGER})+163839>700000)fail();
}
function scanCanonical(doc, key, version, required) {
  if (!object(doc) || doc.schemaVersion !== version || !account(doc.accountId) || hash(doc.accountId) !== key ||
      doc.personId !== `account-profile:${hashValue(doc.accountId).slice(0, 32)}` || !positive(doc.revision) || !integer(doc.createdAt) || !integer(doc.updatedAt) || doc.updatedAt < doc.createdAt) fail();
  scanAssistantControl(doc,required);
  scanObserver(doc.observer, required, version);
  // Even an empty optional extension is rejected by older strict readers.
  // Full archive/source authority validation remains the runtime's responsibility.
  if (Object.hasOwn(doc, 'telegramArchives')) {
    if (!Array.isArray(doc.telegramArchives) || doc.telegramArchives.length > 4) fail();
    const seen = new Set();
    for (const row of doc.telegramArchives) {
      if (!keys(row, ['agentId', 'space', 'enabled', 'generation', 'clearedAt', 'index', ...(Object.hasOwn(row, 'state') ? ['state'] : []), ...(Object.hasOwn(row, 'authorityStamp') ? ['authorityStamp'] : []), ...(Object.hasOwn(row, 'sourceSuppressionVersion') ? ['sourceSuppressionVersion'] : []), ...(Object.hasOwn(row, 'snapshotPublicationVersion') ? ['snapshotPublicationVersion'] : []), ...(Object.hasOwn(row, 'retiredOperation') ? ['retiredOperation'] : [])]) ||
          typeof row.agentId !== 'string' || !row.agentId.length || row.agentId.length > 200 || !['personal', 'work'].includes(row.space) ||
          typeof row.enabled !== 'boolean' || !integer(row.generation) || !integer(row.clearedAt) || !Array.isArray(row.index) || row.index.length > 32 ||
          Object.hasOwn(row, 'authorityStamp') && !digest(row.authorityStamp) ||
          Object.hasOwn(row, 'state') && (!object(row.state) || row.state.schemaVersion !== 1)) fail();
      const suppressionVersion = Object.hasOwn(row, 'sourceSuppressionVersion');
      if (suppressionVersion && row.sourceSuppressionVersion !== 1) fail();
      if (object(row.state) && Object.hasOwn(row.state, 'receipts')) {
        if (!Array.isArray(row.state.receipts) || row.state.receipts.length > 1024) fail();
        for (const receipt of row.state.receipts) {
          if (!object(receipt)) fail();
          if (Object.hasOwn(receipt, 'suppressed') && (receipt.suppressed !== true || !suppressionVersion)) fail();
        }
      }
      if (suppressionVersion) required.telegramArchiveSourceSuppressionVersion = 1;
      scanArchivePublication(row, doc, required);
      const scope = JSON.stringify([row.agentId, row.space]); if (seen.has(scope)) fail(); seen.add(scope);
    }
    required.telegramArchiveSchema = 1;
  }
  if (version === 3) { if (!retentionNamespace(doc.retentionStoreIdentity)) fail(); scanRightsUseHolds(doc.rightsUseHolds); required.rightsUseHoldEnforcementVersion = 1; }
  else if (Object.hasOwn(doc, 'rightsUseHolds') || Object.hasOwn(doc, 'retentionStoreIdentity')) fail();
}
function scanSqlite(path, marker, required, budget) {
  const safe = safePath(path, 'file'); if (stat(safe).size < 100 || stat(safe).size > 1024 * 1024 * 1024) fail();
  for (const suffix of ['-wal', '-shm', '-journal']) { const side = safePath(`${safe}${suffix}`, 'file', true); if (side && stat(side).size > MAX_SCAN_BYTES) fail(); }
  const Database = createRequire(import.meta.url)('better-sqlite3'); let db;
  try {
    db = new Database(safe, { readonly: true, fileMustExist: true, timeout: 0 }); db.pragma('query_only = ON'); db.exec('BEGIN');
    if (db.pragma('user_version', { simple: true }) !== marker.version) fail();
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 32").all().map(r => r.name);
    if (JSON.stringify(names) !== JSON.stringify(['accounts', 'bodies', 'catalogs', 'controls', 'memory_expiry', 'memory_meta', 'outbox', 'postings', 'source_edges', 'source_reverse', 'store_meta'])) fail();
    const metaSize = db.prepare('SELECT count(*) AS count, coalesce(max(length(CAST(json AS BLOB))),0) AS bytes FROM store_meta').get(); if (metaSize.count !== 1 || metaSize.bytes > 4096) fail();
    const metaRow = db.prepare('SELECT json FROM store_meta WHERE singleton=1').get(); if (!metaRow || typeof metaRow.json !== 'string' || Buffer.byteLength(metaRow.json) > 4096) fail();
    const meta = JSON.parse(metaRow.json);
    if (!keys(meta, ['formatVersion', 'schemaVersion', 'incarnation', 'generation', 'lifecycleWatermark']) || meta.formatVersion !== 1 || meta.schemaVersion !== marker.version || meta.incarnation !== marker.identity.incarnation || meta.generation !== marker.identity.generation || !integer(meta.lifecycleWatermark) || meta.lifecycleWatermark < marker.watermarkFloor) fail();
    const count = db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(canonical AS BLOB))),0) AS bytes, coalesce(max(length(CAST(canonical AS BLOB))),0) AS largest FROM accounts').get();
    if (count.count > MAX_ACCOUNTS || count.bytes > MAX_SCAN_BYTES || count.largest > MAX_ACCOUNT_BYTES) fail(); budget.bytes += count.bytes; if (budget.bytes > MAX_SCAN_BYTES) fail();
    // SQL returns identity/version/observer/hold metadata, never canonical source text.
    for (const row of db.prepare("SELECT account_key,account_id,json_valid(canonical) AS valid,json_extract(canonical,'$.schemaVersion') AS schemaVersion,json_extract(canonical,'$.accountId') AS accountId,json_extract(canonical,'$.personId') AS personId,json_extract(canonical,'$.revision') AS revision,json_extract(canonical,'$.createdAt') AS createdAt,json_extract(canonical,'$.updatedAt') AS updatedAt,json_extract(canonical,'$.observer') AS observer,json_extract(canonical,'$.rightsUseHolds') AS rightsUseHolds,json_extract(canonical,'$.retentionStoreIdentity') AS retentionStoreIdentity FROM accounts LIMIT ?").iterate(MAX_ACCOUNTS + 1)) {
      if (row.valid !== 1 || row.account_id !== row.accountId || row.observer !== null && typeof row.observer !== 'string') fail();
      if (row.rightsUseHolds !== null && typeof row.rightsUseHolds !== 'string') fail();
      const doc = { ...row, observer: row.observer === null ? undefined : JSON.parse(row.observer) };
      delete doc.rightsUseHolds;
      if (row.retentionStoreIdentity === null) delete doc.retentionStoreIdentity;
      if (row.rightsUseHolds !== null) doc.rightsUseHolds = JSON.parse(row.rightsUseHolds);
      scanCanonical(doc, row.account_key, marker.version, required);
      if (marker.version === 3) {
        const size = db.prepare('SELECT length(CAST(json AS BLOB)) AS bytes FROM controls WHERE account_key=?').get(row.account_key);
        if (!size || size.bytes > MAX_ACCOUNT_BYTES || (budget.bytes += size.bytes) > MAX_SCAN_BYTES) fail();
        const control = db.prepare("SELECT json_valid(json) AS valid,json_extract(json,'$.schemaVersion') AS schemaVersion,json_extract(json,'$.accountId') AS accountId,json_extract(json,'$.personId') AS personId,json_extract(json,'$.revision') AS revision,json_extract(json,'$.createdAt') AS createdAt,json_extract(json,'$.updatedAt') AS updatedAt,json_extract(json,'$.rightsUseControls') AS rightsUseControls,json_extract(json,'$.retentionStoreIdentity') AS retentionStoreIdentity FROM controls WHERE account_key=?").get(row.account_key);
        if (!control || control.valid !== 1 || typeof control.rightsUseControls !== 'string') fail();
        scanRightsUseControls(doc, { ...control, rightsUseControls: JSON.parse(control.rightsUseControls) });
      }
    }
    db.exec('ROLLBACK'); safePath(safe, 'file');
  } finally { db?.close(); }
}
function scanAdaptive(env, required, budget) {
  const root = join(env.STUDIO_DATA_DIR, 'adaptive'), format = env.STUDIO_ADAPTIVE_FORMAT?.trim() || 'file';
  if (format === 'file') {
    const names=entries(root);
    if(names.includes(ARC_MARKER)){if(readBounded(join(root,ARC_MARKER),128,budget)!==ARC_MARKER_BYTES)fail();required.assistantDeliveryControlVersion=1;}
    for(const name of names){if(name===ARC_MARKER)continue;if(!/^[a-f0-9]{64}\.json$/.test(name))fail();scanCanonical(readPlainJson(join(root,name),MAX_ACCOUNT_BYTES,budget),name.slice(0,-5),1,required);}
    return;
  }
  const managed = `${resolve(root)}.managed`, marker = readPlainJson(join(managed, 'format.json'));
  if (readBounded(root, 256) !== `VOX_MANAGED_STORAGE_V1:${marker.rootId}\n`) fail();
  const path = join(managed, 'stores', marker.store);
  if (format === 'sqlite-v1') return scanSqlite(path, marker, required, budget);
  const head = readPlainJson(join(path, 'head.json'), 4 * 1024 * 1024, budget);
  const projected = marker.version >= 2, projectionVersion = marker.version === 3 ? 2 : 1;
  const expected = ['formatVersion', 'incarnation', 'generation', 'lifecycleWatermark', 'accounts', ...(projected ? ['schemaVersion', 'authorityProjectionVersion'] : [])];
  if (!keys(head, expected) || head.formatVersion !== 2 || head.incarnation !== marker.identity.incarnation || head.generation !== marker.identity.generation || !integer(head.lifecycleWatermark) || head.lifecycleWatermark < marker.watermarkFloor || !Array.isArray(head.accounts) || head.accounts.length > MAX_ACCOUNTS ||
      projected && (head.schemaVersion !== marker.version || head.authorityProjectionVersion !== projectionVersion)) fail();
  safePath(join(path, 'records'), 'directory'); const seen = new Set();
  for (const ref of head.accounts) {
    if (!keys(ref, ['key', 'accountId', 'file', 'digest', ...(projected ? ['authorityFile', 'authorityDigest'] : [])]) || !digest(ref.key) || !account(ref.accountId) || hash(ref.accountId) !== ref.key || !uuid(ref.file) || !digest(ref.digest) || seen.has(ref.key) || projected && (!uuid(ref.authorityFile) || !digest(ref.authorityDigest))) fail();
    seen.add(ref.key); const doc = readPlainJson(join(path, 'records', `${ref.file}.json`), MAX_ACCOUNT_BYTES, budget);
    if (hashValue(doc) !== ref.digest || doc.accountId !== ref.accountId) fail(); scanCanonical(doc, ref.key, marker.version, required);
    if (projected) {
      const image = readPlainJson(join(path, 'authority', `${ref.authorityFile}.json`), MAX_ACCOUNT_BYTES, budget);
      if (!keys(image, ['version', 'schemaVersion', 'incarnation', 'generation', 'key', 'accountId', 'canonicalFile', 'canonicalDigest', 'controls', 'catalogs']) || image.version !== projectionVersion || image.schemaVersion !== marker.version || image.incarnation !== head.incarnation || image.generation !== head.generation || image.key !== ref.key || image.accountId !== ref.accountId || image.canonicalFile !== ref.file || image.canonicalDigest !== ref.digest || !object(image.controls) || !Array.isArray(image.catalogs) || image.catalogs.length !== 2 || hashValue(image) !== ref.authorityDigest) fail();
      scanRightsUseControls(doc, image.controls);
    }
  }
}
function scanSeparate(env, required, budget) {
  const rights = join(env.STUDIO_DATA_DIR, 'rights-intake', 'v1');
  for (const name of entries(rights)) {
    if (name === '.clock-v1.json') { const clock = readPlainJson(join(rights, name), 256, budget); if (!keys(clock, ['version', 'observedServerTime']) || clock.version !== 1 || !integer(clock.observedServerTime)) fail(); continue; }
    if (!/^[a-f0-9]{64}\.json$/.test(name)) fail(); const d = readPlainJson(join(rights, name), 65536, budget);
    if (!object(d) || ![1, 2, 3, 4].includes(d.version) || !keys(d, ['version', 'accountId', 'revision', 'observedServerTime', 'requests', 'commandReceipts', ...(d.version >= 2 ? ['tombstones'] : []), ...(d.version >= 3 ? ['localUse'] : []), ...(d.version === 4 ? ['localErasure'] : [])]) || !account(d.accountId) || hash(d.accountId) !== name.slice(0, -5) || !positive(d.revision) || !integer(d.observedServerTime) || !Array.isArray(d.requests) || d.requests.length > 100 || !Array.isArray(d.commandReceipts) || d.commandReceipts.length > 128 || d.version >= 2 && (!Array.isArray(d.tombstones) || d.tombstones.length > 128)) fail();
    for (const r of d.requests) if (!knownKeys(r, ['version', 'requestId', 'accountId', 'space', 'kind', 'revision', 'createdAt', 'updatedAt', 'localeAtSubmission', 'intakePolicy', 'requester', 'state', 'reasonCode', 'deadline', 'coverage', 'localExport', 'retention', 'audit']) || !['received', 'operator_review', 'awaiting_requester', 'operator_action_pending', 'local_export_prepared', 'closed_unfulfilled'].includes(r.state) || !['access_export', 'correction', 'erasure', 'restriction', 'objection', 'portability', 'withdrawal'].includes(r.kind) || !['work', 'personal'].includes(r.space) || r.version !== 1 || r.accountId !== d.accountId || !uuid(r.requestId) || !positive(r.revision) || !integer(r.createdAt) || !integer(r.updatedAt) || !object(r.retention) || !Array.isArray(r.audit) || r.audit.length < 1 || r.audit.length > 32) fail();
    for (const r of d.commandReceipts) if (!object(r) || !uuid(r.eventId) || !digest(r.fingerprint) || !uuid(r.requestId) || !positive(r.resultingRequestRevision) || !integer(r.recordedAt) || !integer(r.retainUntil)) fail();
    if (d.version >= 2) { for (const t of d.tombstones) if (!keys(t, ['requestId', 'space', 'lastRevision', 'purgedAt', 'retainUntil']) || !uuid(t.requestId) || !['work', 'personal'].includes(t.space) || !positive(t.lastRevision) || !integer(t.purgedAt) || !integer(t.retainUntil) || t.retainUntil <= t.purgedAt) fail(); required.rightsLedgerVersion = Math.max(required.rightsLedgerVersion ?? 1, d.version); }
    else if (d.requests.some(r => Object.hasOwn(r.retention, 'auditRetainUntil') || Object.hasOwn(r.retention, 'terminalRetainUntil') || r.audit.some(a => a.action === 'retention_reassessed'))) fail();
    if (d.version >= 3) { scanLocalUseLedger(d); required.rightsUseHoldEnforcementVersion = 1; }
    if (d.version === 4) scanLocalErasureLedger(d);
  }
  const experiments = join(env.STUDIO_DATA_DIR, 'controlled-experiments', 'v1');
  const names = entries(experiments); if (names.some(name => name !== 'ledger.json')) fail();
  if (names.length) {
    const d = readPlainJson(join(experiments, 'ledger.json'), 2_000_000, budget);
    if (!keys(d, ['schemaVersion', 'version', 'observedAt', 'definitions', 'assignments', 'derived', 'exposures', 'tombstones']) || d.schemaVersion !== 1 || d.version !== 'vox-controlled-experiments-v1' || !integer(d.observedAt)) fail();
    for (const [key, limit] of [['definitions', 50], ['assignments', 1000], ['derived', 2000], ['exposures', 2000], ['tombstones', 3000]]) if (!Array.isArray(d[key]) || d[key].length > limit || d[key].some(r => !object(r))) fail();
    if (d.definitions.some(r => !object(r.config) || r.config.schemaVersion !== 1 || !positive(r.revision) || !['off', 'offline', 'shadow', 'pilot', 'killed'].includes(r.phase)) ||
      [...d.assignments, ...d.derived, ...d.exposures, ...d.tombstones].some(r => !digest(r.id)) || d.tombstones.some(r => !keys(r, ['id', 'kind', 'at']) || !['source_deleted', 'version_killed', 'scope_suppressed'].includes(r.kind) || !integer(r.at))) fail();
    for (const e of d.definitions) if (!knownKeys(e, ['config', 'revision', 'phase', 'failures', 'stopReason']) || !integer(e.failures) || !keys(e.config, ['schemaVersion', 'id', 'assignmentVersion', 'assignmentKind', 'salt', 'baselineArtifact', 'candidateArtifact', 'candidateBasisPoints', 'candidateDensity', 'baselineDensity', 'startsAt', 'expiresAt', 'review', 'retention', 'stoppingRules']) || !positive(e.config.assignmentVersion) || !['private_person', 'shared_container'].includes(e.config.assignmentKind) || !digest(e.config.salt) || !digest(e.config.baselineArtifact) || !digest(e.config.candidateArtifact) || e.config.candidateDensity !== 'compact' || e.config.baselineDensity !== 'comfortable') fail();
    for (const r of d.assignments) if (!keys(r, ['id', 'experimentId', 'assignmentVersion', 'unit', 'variant', 'scopeRevision', 'assignedAt']) || !positive(r.assignmentVersion) || !digest(r.unit) || !digest(r.scopeRevision) || !['control', 'candidate'].includes(r.variant) || !integer(r.assignedAt)) fail();
    for (const r of d.derived) if (!keys(r, ['id', 'experimentId', 'assignmentVersion', 'assignmentId', 'unit', 'source', 'configRevision', 'authorityRevision', 'scopeRevision', 'variant', 'density', 'state', 'createdAt', 'expiresAt']) || !keys(r.source, ['id', 'revision']) || !digest(r.source.id) || !positive(r.source.revision) || !['active', 'quarantined'].includes(r.state) || !['comfortable', 'compact'].includes(r.density) || !['control', 'candidate'].includes(r.variant)) fail();
    for (const r of d.exposures) if (!keys(r, ['id', 'derivedId', 'experimentId', 'assignmentVersion', 'assignmentId', 'unit', 'variant', 'occurredAt', 'trust', 'surface', 'configRevision']) || !positive(r.assignmentVersion) || !positive(r.configRevision) || !digest(r.derivedId) || !['control', 'candidate'].includes(r.variant) || r.trust !== 'client_unverified' || r.surface !== 'text_rendered' || !integer(r.occurredAt)) fail();
    required.experimentLedgerSchema = 1;
  }
  const guest = join(env.STUDIO_DATA_DIR, 'guest-rights', 'v1');
  const guestFile = `${hash('guest-rights-ledger:v1')}.json`;
  for (const name of entries(guest)) {
    if (name === '.clock-v1.json') { const clock = readPlainJson(join(guest, name), 256, budget); if (!keys(clock, ['version', 'observedServerTime']) || clock.version !== 1 || !integer(clock.observedServerTime)) fail(); continue; }
    if (name !== guestFile) fail();
    const d = readPlainJson(join(guest, name), 65536, budget);
    if (!keys(d, ['schemaVersion', 'keyId', 'revision', 'observedAt', 'admission', 'requests', 'tombstones', 'receipts']) || d.schemaVersion !== 1 || !digest(d.keyId) || !positive(d.revision) || !integer(d.observedAt) || !keys(d.admission, ['windowStart','count']) || !integer(d.admission.windowStart) || !integer(d.admission.count)) fail();
    for (const [field, limit] of [['requests',100],['tombstones',128],['receipts',128]]) if (!Array.isArray(d[field]) || d[field].length > limit) fail();
    for (const r of d.requests) if (!keys(r, ['requestId','credentialHash','context','kind','locale','revision','createdAt','updatedAt','state','policy','deadline','retention','audit']) || !uuid(r.requestId) || !digest(r.credentialHash) || !['work','personal','unknown'].includes(r.context) || !['access_export','correction','erasure','restriction','objection','portability','withdrawal'].includes(r.kind) || !['en','fa'].includes(r.locale) || !positive(r.revision) || !integer(r.createdAt) || !integer(r.updatedAt) || !['received','operator_review','awaiting_requester','operator_action_pending','closed_unfulfilled'].includes(r.state) || !keys(r.policy,['id','revision','copyVersion']) || !positive(r.policy.revision) || !keys(r.deadline,['state']) || r.deadline.state !== 'unresolved' || !knownKeys(r.retention,['reviewAt','auditUntil','terminalUntil']) || !integer(r.retention.reviewAt) || !integer(r.retention.auditUntil) || Object.hasOwn(r.retention,'terminalUntil') && !integer(r.retention.terminalUntil) || !Array.isArray(r.audit) || r.audit.length < 1 || r.audit.length > 32) fail();
    for (const t of d.tombstones) if (!keys(t,['requestId','credentialHash','lastRevision','purgedAt','retainUntil']) || !uuid(t.requestId) || !digest(t.credentialHash) || !positive(t.lastRevision) || !integer(t.purgedAt) || !integer(t.retainUntil) || t.retainUntil <= t.purgedAt) fail();
    for (const r of d.receipts) if (!keys(r,['eventHash','fingerprint','requestId','revision','at','retainUntil']) || !digest(r.eventHash) || !digest(r.fingerprint) || !uuid(r.requestId) || !positive(r.revision) || !integer(r.at) || !integer(r.retainUntil) || r.retainUntil <= r.at) fail();
    required.guestRightsLedgerSchema = 1;
  }

}
/** Detect committed workflow format even when its runtime configuration is off.
 * Deep record/signature validation belongs to the workflow, not the installer. */
function scanImprovement(env, required, budget) {
  const root = join(env.STUDIO_DATA_DIR, 'improvement-review');
  if (!safePath(root, 'directory', true)) return;
  const rootNames = entries(root, 4).sort();
  if (rootNames.some(name => !['audit', 'objects'].includes(name))) fail();
  const audit = join(root, 'audit'), names = entries(audit, 5001).sort();
  if (names.length > 5000) fail();
  let previous = '0'.repeat(64), version = 1, generation = 0, observedAt = 0, registryId, trustDigest;
  const baseFields = ['findings', 'proposals', 'candidates', 'revokedLineages', 'finalUses', 'protocolUses', 'rollbacks', 'operations'];
  const eventFields = ['sequence', 'previous', 'action', 'operationId', 'at', 'state', 'digest'];
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(10, '0')}.json`) fail();
    const event = readPlainJson(join(audit, name), 2_000_000, budget);
    const nextVersion = Object.hasOwn(event ?? {}, 'schemaVersion') ? event.schemaVersion : 1;
    if (![1, 2].includes(nextVersion) || nextVersion < version ||
        !keys(event, nextVersion === 2 ? [...eventFields, 'schemaVersion', 'kind'] : eventFields) ||
        event.sequence !== index + 1 || event.previous !== previous || !digest(event.digest) ||
        typeof event.action !== 'string' || !/^[a-z_]{1,128}$/.test(event.action) ||
        typeof event.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(event.operationId) || !integer(event.at)) fail();
    const { digest: stored, ...body } = event;
    if (stored !== hash(canonical(nextVersion === 2 ? { domain: 'vox.improvement.audit.v2', body } : body))) fail();
    const state = event.state;
    if (!object(state) || ['findings', 'proposals', 'candidates', 'rollbacks', 'operations'].some(field => !object(state[field])) ||
        ['revokedLineages', 'finalUses'].some(field => !Array.isArray(state[field]) || state[field].some(value => !digest(value))) ||
        Object.hasOwn(state, 'protocolUses') && (!Array.isArray(state.protocolUses) || state.protocolUses.some(value => !digest(value)))) fail();
    if (nextVersion === 1) {
      if (!knownKeys(state, baseFields)) fail();
    } else {
      const fields = [...baseFields, 'schemaVersion', 'trustDigest', 'registryId', 'generation', 'observedAt', 'learningCases', 'learningCorpora', 'withdrawnCases'];
      if (event.kind !== 'vox_improvement_audit' || !keys(state, fields) || state.schemaVersion !== 2 ||
          !digest(state.trustDigest) || !uuid(state.registryId) || !positive(state.generation) || state.generation !== generation + 1 ||
          !integer(state.observedAt) || state.observedAt !== event.at || state.observedAt < observedAt ||
          !Array.isArray(state.protocolUses) || !Array.isArray(state.withdrawnCases) ||
          state.withdrawnCases.some(value => !digest(value)) || new Set(state.withdrawnCases).size !== state.withdrawnCases.length ||
          ['learningCases', 'learningCorpora'].some(field => !object(state[field]) || Object.entries(state[field]).some(([key, record]) => !digest(key) || !object(record))) ||
          version === 2 && (registryId !== state.registryId || trustDigest !== state.trustDigest)) fail();
      generation = state.generation; registryId = state.registryId; trustDigest = state.trustDigest;
    }
    observedAt = Math.max(observedAt, event.at); previous = stored; version = nextVersion;
  }
  // Do not accept a moving snapshot or a writer/recovery lock. The installer
  // repeats admission after stopping the service before changing its release.
  if (canonical(entries(root, 4).sort()) !== canonical(rootNames) ||
      canonical(entries(audit, 5001).sort()) !== canonical(names)) fail();
  if (names.length) required.improvementWorkflowSchema = version;
}
/** Bounded structural metadata admission; this does not replace runtime validation. */
// Pet care is a separate rights-controlled store. Old code may serve only after
// candidate care rows are cleared; durable erasure epochs must remain in place.
function scanPetCare(env, required, budget) {
  const root = join(env.STUDIO_DATA_DIR, 'pets');
  if (!safePath(root, 'directory', true)) return;
  if (stat(join(root, '.writer.lock'))) fail();
  const dir = opendirSync(root);
  let rows = 0;
  try {
    let entry;
    while ((entry = dir.readSync())) {
      if (++rows > MAX_ACCOUNTS) fail();
      if (entry.name === '.epochs') {
        const epochs = safePath(join(root, entry.name), 'directory');
        const epochDir = opendirSync(epochs);
        try {
          let epoch;
          while ((epoch = epochDir.readSync())) {
            if (++rows > MAX_ACCOUNTS || !/^[1-9]\d*\.json$/.test(epoch.name)) fail();
            const value = readPlainJson(join(epochs, epoch.name), 256, budget);
            if (!keys(value, ['v', 'epoch']) || value.v !== 1 || !uuid(value.epoch)) fail();
          }
        } finally { epochDir.closeSync(); }
        continue;
      }
      if (!/^[A-Za-z0-9_-]{1,128}\.json$/.test(entry.name)) fail();
      const records = readPlainJson(join(root, entry.name), MAX_ACCOUNT_BYTES, budget);
      if (!object(records)) fail();
      const agent = entry.name.slice(0, -5);
      for (const [user, record] of Object.entries(records)) {
        if (!/^[1-9]\d*$/.test(user) || !object(record) || record.v !== 1 || record.agentId !== agent || record.userId !== Number(user)) fail();
        required.petCareSchema = 1;
      }
    }
  } finally { dir.closeSync(); }
}

/** Destinations that let a connected app's answer reach a chat (Settings Part 2b); they live on grants only. */
const REPLY_DESTINATIONS = Object.freeze(['studio:chat_reply', 'telegram:agent_dm']);
const REPLY_COLLECTIONS = Object.freeze(['replyUses', 'replyMessages']);
/** Only the committed generation is authoritative. Never revive orphan records or
 * inspect broker credentials; the broker vault has its own deployment boundary. */
function scanConnections(env, required, budget) {
  const versions = new Set();
  const identifier = value => boundedText(value, 200) && /^[\p{L}\p{N}_.:@/-]+$/u.test(value);
  const configPath = env.STUDIO_CONNECTIONS_CONFIG_FILE?.trim();
  let configDigest;
  const verifyConfig = () => {
    if (configPath && canonicalHash(readPlainJson(configPath, 512_000, budget)) !== configDigest) fail();
  };
  if (configPath) {
    if (!isAbsolute(configPath)) fail();
    const config = readPlainJson(configPath, 512_000, budget);
    configDigest = canonicalHash(config);
    if (!object(config) || config.schemaVersion !== 1 || !Array.isArray(config.profiles) || config.profiles.length > 500) fail();
    if (Object.hasOwn(config, 'selfServiceMcp')) {
      if (!object(config.selfServiceMcp)) fail();
      required.selfServiceMcpSchema = 1; // Old strict parsers reject even disabled setup.
    }
    // Old strict parsers reject these keys even when switched off.
    if (Object.hasOwn(config, 'chatReplies')) {
      if (!object(config.chatReplies)) fail();
      required.replyUseSchema = 1;
    }
    if (Object.hasOwn(config, 'providerTemplates')) {
      if (!object(config.providerTemplates) && !Array.isArray(config.providerTemplates)) fail();
      required.providerTemplateSchema = 1;
    }
    for (const profile of config.profiles) {
      if (!object(profile)) fail();
      if (Object.hasOwn(profile, 'agentId')) {
        if (!identifier(profile.agentId)) fail();
        versions.add(2); // Older strict configuration parsers reject even unused bound profiles.
      }
    }
  }
  const root = join(env.STUDIO_DATA_DIR, 'connections');
  if (!safePath(root, 'directory', true)) {
    verifyConfig();
    if (versions.size) required.connectionRecordSchemas = [...versions].sort();
    return;
  }
  const partitions = entries(root).sort();
  const generation = name => typeof name === 'string' && name.startsWith('generation-') && uuid(name.slice(11));
  let count = 0;
  for (const partition of partitions) {
    if (!digest(partition)) fail();
    const directory = safePath(join(root, partition), 'directory');
    const names = entries(directory, 100).sort();
    if (names.includes('lock') || names.some(name => name !== 'current.json' && !generation(name))) fail();
    for (const name of names.filter(generation)) safePath(join(directory, name), 'directory');
    if (!names.includes('current.json')) continue; // Empty partition or abandoned, uncommitted generation.
    const pointerPath = join(directory, 'current.json');
    const pointer = readPlainJson(pointerPath, 256, budget);
    if (!keys(pointer, ['generation']) || !generation(pointer.generation) || !names.includes(pointer.generation)) fail();
    const records = safePath(join(directory, pointer.generation, 'connections'), 'directory');
    const files = entries(records, 2000).sort();
    for (const file of files) {
      if (++count > MAX_ACCOUNTS || !/^[a-f0-9]{64}\.json$/.test(file)) fail();
      const row = readPlainJson(join(records, file), 300_000, budget);
      if (!object(row) || ![1, 2].includes(row.schemaVersion) || !identifier(row.id) ||
          file !== `${hash(row.id)}.json` || !identifier(row.ownerAccountId) ||
          !object(row.scope) || !['work', 'personal'].includes(row.scope.spaceKind) || !positive(row.revision) ||
          row.partitionId !== hash(JSON.stringify([row.ownerAccountId, row.scope.spaceKind])) || hash(row.partitionId) !== partition ||
          (row.schemaVersion === 1 ? Object.hasOwn(row, 'agentId') : !identifier(row.agentId))) fail();
      versions.add(row.schemaVersion);
      if (Object.hasOwn(row, 'mcp')) {
        if (row.schemaVersion !== 2 || !keys(row.mcp, ['canonicalResourceUri', 'catalog']) ||
            !boundedText(row.mcp.canonicalResourceUri, 2000) ||
            row.mcp.catalog !== null && (!object(row.mcp.catalog) || row.mcp.catalog.schemaVersion !== 1)) fail();
        required.selfServiceMcpSchema = 1;
      }
      if (Object.hasOwn(row, 'template')) {
        if (row.schemaVersion !== 2 || !object(row.template)) fail();
        required.providerTemplateSchema = 1;
      }
    }
    // A reply destination on a grant, or any stored reply row, needs a reader that knows them,
    // even with the feature flags off: an older release would drop or misread them.
    const grants = safePath(join(directory, pointer.generation, 'grants'), 'directory', true);
    const grantFiles = grants ? entries(grants, 2000).sort() : [];
    for (const file of grantFiles) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) fail();
      const row = readPlainJson(join(grants, file), 300_000, budget);
      if (!object(row) || !identifier(row.id) || file !== `${hash(row.id)}.json` || !Array.isArray(row.destinationIds) ||
          !identifier(row.partitionId) || hash(row.partitionId) !== partition) fail();
      if (row.destinationIds.some(id => REPLY_DESTINATIONS.includes(id)) || Object.hasOwn(row, 'replyDestinationIds')) required.replyUseSchema = 1;
    }
    const replies = REPLY_COLLECTIONS.map(name => {
      const path = safePath(join(directory, pointer.generation, name), 'directory', true);
      const files = path ? entries(path, 2000).sort() : [];
      if (files.length) required.replyUseSchema = 1;
      return { name, path, files };
    });
    // An account record can outlive its connection. Its new unavailable-identity
    // disclosure must also block rollback to a strict historical parser.
    const accounts = safePath(join(directory, pointer.generation, 'providerAccounts'), 'directory', true);
    const accountFiles = accounts ? entries(accounts, 2000).sort() : [];
    for (const file of accountFiles) {
      if (++count > MAX_ACCOUNTS || !/^[a-f0-9]{64}\.json$/.test(file)) fail();
      const row = readPlainJson(join(accounts, file), 300_000, budget);
      if (!object(row) || row.schemaVersion !== 1 || !identifier(row.id) || file !== `${hash(row.id)}.json` ||
          !identifier(row.ownerAccountId) || !object(row.scope) || !['work', 'personal'].includes(row.scope.spaceKind) ||
          !positive(row.revision) || row.partitionId !== hash(JSON.stringify([row.ownerAccountId, row.scope.spaceKind])) ||
          hash(row.partitionId) !== partition) fail();
      if (Object.hasOwn(row, 'identityEvidence')) {
        if (row.identityEvidence !== 'unavailable') fail();
        required.selfServiceMcpSchema = 1;
      }
    }
    // Recheck pointer and directory identities after the bounded read. Install
    // repeats admission after quiescing the application before changing code.
    if (canonical(readPlainJson(pointerPath, 256, budget)) !== canonical(pointer) ||
        canonical(entries(directory, 100).sort()) !== canonical(names) ||
        canonical(entries(records, 2000).sort()) !== canonical(files) ||
        accounts && canonical(entries(accounts, 2000).sort()) !== canonical(accountFiles) ||
        !accounts && safePath(join(directory, pointer.generation, 'providerAccounts'), 'directory', true) ||
        grants && canonical(entries(grants, 2000).sort()) !== canonical(grantFiles) ||
        !grants && safePath(join(directory, pointer.generation, 'grants'), 'directory', true) ||
        replies.some(({ name, path, files }) => path ? canonical(entries(path, 2000).sort()) !== canonical(files)
          : safePath(join(directory, pointer.generation, name), 'directory', true))) fail();
  }
  if (canonical(entries(root).sort()) !== canonical(partitions)) fail();
  verifyConfig();
  if (versions.size) required.connectionRecordSchemas = [...versions].sort();
}

export function requiredAdaptiveCapabilities(env) {
  try { safePath(env.STUDIO_DATA_DIR, 'directory', true); const required = coreCapabilities(env), budget = { bytes: 0 };
    scanAdaptive(env, required, budget); scanSeparate(env, required, budget); scanImprovement(env, required, budget); scanPetCare(env, required, budget); scanConnections(env, required, budget); return required;
  } catch { fail(); }
}

export function assertReleaseAdaptiveCompatibility(env, manifest) {
  const required = requiredAdaptiveCapabilities(env);
  const fields = Object.keys(ADAPTIVE_RELEASE_CAPABILITIES);
  const supplied = fields.some(key => object(manifest) && Object.hasOwn(manifest, key));
  const supported = supplied ? manifest : { supportedAdaptiveDataSchemas: [1], supportedAdaptiveControlSchemas: [1], productPauseEnforcementVersion: 0 };
  const schemas = value => Array.isArray(value) && value.length > 0 && value.length <= 3 && new Set(value).size === value.length && value.every(x => [1, 2, 3].includes(x));
  const fileVersions = Object.hasOwn(supported, 'supportedFileAuthorityProjectionVersions') ? supported.supportedFileAuthorityProjectionVersions : [];
  const rightsEnforcement = Object.hasOwn(supported, 'rightsUseHoldEnforcementVersion') ? supported.rightsUseHoldEnforcementVersion : 0;
  if (!schemas(supported.supportedAdaptiveDataSchemas) || !schemas(supported.supportedAdaptiveControlSchemas) ||
      !Array.isArray(fileVersions) || fileVersions.length > 2 || new Set(fileVersions).size !== fileVersions.length || fileVersions.some(version => ![1, 2].includes(version)) ||
      ![0, 1].includes(supported.productPauseEnforcementVersion) ||
      ![0, 1].includes(rightsEnforcement) || rightsEnforcement < (required.rightsUseHoldEnforcementVersion ?? 0) ||
      !supported.supportedAdaptiveDataSchemas.includes(required.canonicalSchemaVersion) ||
      !supported.supportedAdaptiveControlSchemas.includes(required.controlsSchemaVersion) ||
      supported.productPauseEnforcementVersion < required.productPauseEnforcementVersion ||
      required.fileAuthorityProjectionVersion !== undefined && !fileVersions.includes(required.fileAuthorityProjectionVersion)) fail();
  for (const [field, requiredKey, allowed] of [
    ['supportedObserverClientExperienceVersions', 'observerClientExperienceVersion', [1]],
    ['supportedRightsLedgerVersions', 'rightsLedgerVersion', [1, 2, 3, 4]],
    ['supportedExperimentLedgerSchemas', 'experimentLedgerSchema', [1]],
    ['supportedGuestRightsLedgerSchemas', 'guestRightsLedgerSchema', [1]],
    ['supportedImprovementWorkflowSchemas', 'improvementWorkflowSchema', [1, 2]],
    ['supportedPetCareSchemas', 'petCareSchema', [1]],
    ['supportedSelfServiceMcpSchemas', 'selfServiceMcpSchema', [1]],
    // Fail closed: a release that does not declare these cannot admit reply rows or template connections.
    ['supportedReplyUseSchemas', 'replyUseSchema', [1]],
    ['supportedProviderTemplateSchemas', 'providerTemplateSchema', [1]],
    ['supportedAssistantDeliveryControlVersions', 'assistantDeliveryControlVersion', [1]],
    ['supportedTelegramArchiveSchemas', 'telegramArchiveSchema', [1]],
    ['supportedTelegramArchiveSourceSuppressionVersions', 'telegramArchiveSourceSuppressionVersion', [1]],
    ['supportedTelegramArchiveSnapshotPublicationVersions', 'telegramArchiveSnapshotPublicationVersion', [1]],
  ]) {
    const versions = Object.hasOwn(supported, field) ? supported[field] : ['supportedRightsLedgerVersions', 'supportedImprovementWorkflowSchemas'].includes(field) ? [1] : [];
    if (!Array.isArray(versions) || versions.length > allowed.length || new Set(versions).size !== versions.length || versions.some(v => !allowed.includes(v)) || required[requiredKey] !== undefined && !versions.includes(required[requiredKey])) fail();
  }
  // Historical releases support only legacy unbound schema1 records. A new
  // bound-agent record must block their rollback even if the feature is off.
  const connectionVersions = Object.hasOwn(supported, 'supportedConnectionRecordSchemas') ? supported.supportedConnectionRecordSchemas : [1];
  if (!Array.isArray(connectionVersions) || connectionVersions.length > 2 || new Set(connectionVersions).size !== connectionVersions.length ||
      connectionVersions.some(version => ![1, 2].includes(version)) ||
      (required.connectionRecordSchemas ?? []).some(version => !connectionVersions.includes(version))) fail();
  return required;
}
