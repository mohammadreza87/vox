/** Read-only release admission. Runtime storage validation remains authoritative. */
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, opendirSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve, parse, relative, sep } from 'node:path';

export const ADAPTIVE_RELEASE_CAPABILITIES = Object.freeze({
  supportedAdaptiveDataSchemas: Object.freeze([1, 2]),
  supportedAdaptiveControlSchemas: Object.freeze([1, 2]),
  productPauseEnforcementVersion: 1,
  supportedFileAuthorityProjectionVersions: Object.freeze([1]),
  supportedObserverClientExperienceVersions: Object.freeze([1]),
  supportedRightsLedgerVersions: Object.freeze([1, 2]),
  supportedExperimentLedgerSchemas: Object.freeze([1]),
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
  const fileProjection = marker?.version === 2 && format === 'file-v2' ? ['fileAuthorityProjectionVersion'] : [];
  if (!object(marker) || ![1, 2].includes(marker.version) ||
      !keys(marker, marker.version === 1 ? common : [...common, ...extra, ...fileProjection]) || marker.state !== 'ready' || marker.format !== format ||
      !uuid(marker.rootId) || !uuid(marker.store) || !keys(marker.identity, ['incarnation', 'generation']) ||
      !uuid(marker.identity.incarnation) || !integer(marker.identity.generation) || marker.identity.generation < 1 || !integer(marker.watermarkFloor)) fail();
  if (marker.version === 1) return { canonicalSchemaVersion: 1, controlsSchemaVersion: 1, productPauseEnforcementVersion: 0 };
  if (marker.canonicalSchemaVersion !== 2 || marker.controlsSchemaVersion !== 2 || marker.productPauseEnforcementVersion !== 1) fail();
  if (fileProjection.length && marker.fileAuthorityProjectionVersion !== 1) fail();
  return { canonicalSchemaVersion: 2, controlsSchemaVersion: 2, productPauseEnforcementVersion: 1,
    ...(fileProjection.length ? { fileAuthorityProjectionVersion: 1 } : {}) };
}

function scanObserver(observer, required) {
  if (observer === undefined) return;
  if (!object(observer) || observer.schemaVersion !== 1 || Object.keys(observer).some(k => !['schemaVersion', 'events', 'projections', 'corrections'].includes(k)) ||
      !Array.isArray(observer.events) || observer.events.length > 200 || !Array.isArray(observer.projections) || observer.projections.length > 2) fail();
  if (Object.hasOwn(observer, 'corrections')) {
    if (!Array.isArray(observer.corrections) || observer.corrections.length > 200 || observer.corrections.some(r => !object(r) || r.version !== 1 || !digest(r.id) || !['correction_client_saved', 'correction_client_unconfirmed'].includes(r.outcome))) fail();
    required.observerClientExperienceVersion = 1;
  }
  const outcomes = ['responded', 'failed', 'cancelled', 'unknown', 'playback_started', 'playback_completed', 'playback_failed', 'interrupted', 'task_succeeded', 'task_failed', 'task_unknown', 'text_rendered'];
  for (const event of observer.events) {
    if (!knownKeys(event, ['schemaVersion', 'version', 'id', 'fingerprint', 'revision', 'turnKey', 'origin', 'purpose', 'policyVersion', 'consentEpoch', 'permissionRevision', 'grantRevision', 'bindingRevision', 'accountId', 'personId', 'space', 'spaceId', 'agentId', 'policyReceipt', 'clientExperienceVersion', 'trust', 'channel', 'outcome', 'telemetry', 'operation', 'durationMs', 'occurredAt', 'receivedAt', 'expiresAt', 'state', 'attempts', 'nextAttemptAt', 'leaseId', 'leaseUntil', 'processedAt', 'failureCode']) || event.schemaVersion !== 1 || event.version !== 'vox-observer-v1' || !digest(event.id) || !outcomes.includes(event.outcome)) fail();
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
function scanCanonical(doc, key, version, required) {
  if (!object(doc) || doc.schemaVersion !== version || !account(doc.accountId) || hash(doc.accountId) !== key ||
      doc.personId !== `account-profile:${hashValue(doc.accountId).slice(0, 32)}` || !positive(doc.revision) || !integer(doc.createdAt) || !integer(doc.updatedAt) || doc.updatedAt < doc.createdAt) fail();
  scanObserver(doc.observer, required);
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
    // SQL returns only identity/version/observer metadata, never canonical source text.
    for (const row of db.prepare("SELECT account_key,account_id,json_valid(canonical) AS valid,json_extract(canonical,'$.schemaVersion') AS schemaVersion,json_extract(canonical,'$.accountId') AS accountId,json_extract(canonical,'$.personId') AS personId,json_extract(canonical,'$.revision') AS revision,json_extract(canonical,'$.createdAt') AS createdAt,json_extract(canonical,'$.updatedAt') AS updatedAt,json_extract(canonical,'$.observer') AS observer FROM accounts LIMIT ?").iterate(MAX_ACCOUNTS + 1)) {
      if (row.valid !== 1 || row.account_id !== row.accountId || row.observer !== null && typeof row.observer !== 'string') fail();
      scanCanonical({ ...row, observer: row.observer === null ? undefined : JSON.parse(row.observer) }, row.account_key, marker.version, required);
    }
    db.exec('ROLLBACK'); safePath(safe, 'file');
  } finally { db?.close(); }
}
function scanAdaptive(env, required, budget) {
  const root = join(env.STUDIO_DATA_DIR, 'adaptive'), format = env.STUDIO_ADAPTIVE_FORMAT?.trim() || 'file';
  if (format === 'file') {
    for (const name of entries(root)) { if (!/^[a-f0-9]{64}\.json$/.test(name)) fail(); scanCanonical(readPlainJson(join(root, name), MAX_ACCOUNT_BYTES, budget), name.slice(0, -5), 1, required); }
    return;
  }
  const managed = `${resolve(root)}.managed`, marker = readPlainJson(join(managed, 'format.json'));
  if (readBounded(root, 256) !== `VOX_MANAGED_STORAGE_V1:${marker.rootId}\n`) fail();
  const path = join(managed, 'stores', marker.store);
  if (format === 'sqlite-v1') return scanSqlite(path, marker, required, budget);
  const head = readPlainJson(join(path, 'head.json'), 4 * 1024 * 1024, budget);
  const expected = ['formatVersion', 'incarnation', 'generation', 'lifecycleWatermark', 'accounts', ...(marker.version === 2 ? ['schemaVersion', 'authorityProjectionVersion'] : [])];
  if (!keys(head, expected) || head.formatVersion !== 2 || head.incarnation !== marker.identity.incarnation || head.generation !== marker.identity.generation || !integer(head.lifecycleWatermark) || head.lifecycleWatermark < marker.watermarkFloor || !Array.isArray(head.accounts) || head.accounts.length > MAX_ACCOUNTS ||
      marker.version === 2 && (head.schemaVersion !== 2 || head.authorityProjectionVersion !== 1)) fail();
  safePath(join(path, 'records'), 'directory'); const seen = new Set();
  for (const ref of head.accounts) {
    if (!keys(ref, ['key', 'accountId', 'file', 'digest', ...(marker.version === 2 ? ['authorityFile', 'authorityDigest'] : [])]) || !digest(ref.key) || !account(ref.accountId) || hash(ref.accountId) !== ref.key || !uuid(ref.file) || !digest(ref.digest) || seen.has(ref.key) || marker.version === 2 && (!uuid(ref.authorityFile) || !digest(ref.authorityDigest))) fail();
    seen.add(ref.key); const doc = readPlainJson(join(path, 'records', `${ref.file}.json`), MAX_ACCOUNT_BYTES, budget);
    if (hashValue(doc) !== ref.digest || doc.accountId !== ref.accountId) fail(); scanCanonical(doc, ref.key, marker.version, required);
    if (marker.version === 2) {
      const image = readPlainJson(join(path, 'authority', `${ref.authorityFile}.json`), MAX_ACCOUNT_BYTES, budget);
      if (!keys(image, ['version', 'schemaVersion', 'incarnation', 'generation', 'key', 'accountId', 'canonicalFile', 'canonicalDigest', 'controls', 'catalogs']) || image.version !== 1 || image.schemaVersion !== 2 || image.incarnation !== head.incarnation || image.generation !== head.generation || image.key !== ref.key || image.accountId !== ref.accountId || image.canonicalFile !== ref.file || image.canonicalDigest !== ref.digest || !object(image.controls) || !Array.isArray(image.catalogs) || image.catalogs.length !== 2 || hashValue(image) !== ref.authorityDigest) fail();
    }
  }
}
function scanSeparate(env, required, budget) {
  const rights = join(env.STUDIO_DATA_DIR, 'rights-intake', 'v1');
  for (const name of entries(rights)) {
    if (name === '.clock-v1.json') { const clock = readPlainJson(join(rights, name), 256, budget); if (!keys(clock, ['version', 'observedServerTime']) || clock.version !== 1 || !integer(clock.observedServerTime)) fail(); continue; }
    if (!/^[a-f0-9]{64}\.json$/.test(name)) fail(); const d = readPlainJson(join(rights, name), 65536, budget);
    if (!object(d) || ![1, 2].includes(d.version) || !keys(d, ['version', 'accountId', 'revision', 'observedServerTime', 'requests', 'commandReceipts', ...(d.version === 2 ? ['tombstones'] : [])]) || !account(d.accountId) || hash(d.accountId) !== name.slice(0, -5) || !positive(d.revision) || !integer(d.observedServerTime) || !Array.isArray(d.requests) || d.requests.length > 100 || !Array.isArray(d.commandReceipts) || d.commandReceipts.length > 128 || d.version === 2 && (!Array.isArray(d.tombstones) || d.tombstones.length > 128)) fail();
    for (const r of d.requests) if (!knownKeys(r, ['version', 'requestId', 'accountId', 'space', 'kind', 'revision', 'createdAt', 'updatedAt', 'localeAtSubmission', 'intakePolicy', 'requester', 'state', 'reasonCode', 'deadline', 'coverage', 'localExport', 'retention', 'audit']) || !['received', 'operator_review', 'awaiting_requester', 'operator_action_pending', 'local_export_prepared', 'closed_unfulfilled'].includes(r.state) || !['access_export', 'correction', 'erasure', 'restriction', 'objection', 'portability', 'withdrawal'].includes(r.kind) || !['work', 'personal'].includes(r.space) || r.version !== 1 || r.accountId !== d.accountId || !uuid(r.requestId) || !positive(r.revision) || !integer(r.createdAt) || !integer(r.updatedAt) || !object(r.retention) || !Array.isArray(r.audit) || r.audit.length < 1 || r.audit.length > 32) fail();
    for (const r of d.commandReceipts) if (!object(r) || !uuid(r.eventId) || !digest(r.fingerprint) || !uuid(r.requestId) || !positive(r.resultingRequestRevision) || !integer(r.recordedAt) || !integer(r.retainUntil)) fail();
    if (d.version === 2) { for (const t of d.tombstones) if (!keys(t, ['requestId', 'space', 'lastRevision', 'purgedAt', 'retainUntil']) || !uuid(t.requestId) || !['work', 'personal'].includes(t.space) || !positive(t.lastRevision) || !integer(t.purgedAt) || !integer(t.retainUntil) || t.retainUntil <= t.purgedAt) fail(); required.rightsLedgerVersion = 2; }
    else if (d.requests.some(r => Object.hasOwn(r.retention, 'auditRetainUntil') || Object.hasOwn(r.retention, 'terminalRetainUntil') || r.audit.some(a => a.action === 'retention_reassessed'))) fail();
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
}
/** Bounded structural metadata admission; this does not replace runtime validation. */
export function requiredAdaptiveCapabilities(env) {
  try { safePath(env.STUDIO_DATA_DIR, 'directory', true); const required = coreCapabilities(env), budget = { bytes: 0 };
    scanAdaptive(env, required, budget); scanSeparate(env, required, budget); return required;
  } catch { fail(); }
}

export function assertReleaseAdaptiveCompatibility(env, manifest) {
  const required = requiredAdaptiveCapabilities(env);
  const fields = Object.keys(ADAPTIVE_RELEASE_CAPABILITIES);
  const supplied = fields.some(key => object(manifest) && Object.hasOwn(manifest, key));
  const supported = supplied ? manifest : { supportedAdaptiveDataSchemas: [1], supportedAdaptiveControlSchemas: [1], productPauseEnforcementVersion: 0 };
  const schemas = value => Array.isArray(value) && value.length > 0 && value.length <= 2 && new Set(value).size === value.length && value.every(x => x === 1 || x === 2);
  const fileVersions = Object.hasOwn(supported, 'supportedFileAuthorityProjectionVersions') ? supported.supportedFileAuthorityProjectionVersions : [];
  if (!schemas(supported.supportedAdaptiveDataSchemas) || !schemas(supported.supportedAdaptiveControlSchemas) ||
      !Array.isArray(fileVersions) || fileVersions.length > 1 || fileVersions.some(version => version !== 1) ||
      ![0, 1].includes(supported.productPauseEnforcementVersion) ||
      !supported.supportedAdaptiveDataSchemas.includes(required.canonicalSchemaVersion) ||
      !supported.supportedAdaptiveControlSchemas.includes(required.controlsSchemaVersion) ||
      supported.productPauseEnforcementVersion < required.productPauseEnforcementVersion ||
      required.fileAuthorityProjectionVersion === 1 && !fileVersions.includes(1)) fail();
  for (const [field, requiredKey, allowed] of [
    ['supportedObserverClientExperienceVersions', 'observerClientExperienceVersion', [1]],
    ['supportedRightsLedgerVersions', 'rightsLedgerVersion', [1, 2]],
    ['supportedExperimentLedgerSchemas', 'experimentLedgerSchema', [1]],
  ]) {
    const versions = Object.hasOwn(supported, field) ? supported[field] : field === 'supportedRightsLedgerVersions' ? [1] : [];
    if (!Array.isArray(versions) || versions.length > allowed.length || new Set(versions).size !== versions.length || versions.some(v => !allowed.includes(v)) || required[requiredKey] !== undefined && !versions.includes(required[requiredKey])) fail();
  }
  return required;
}
