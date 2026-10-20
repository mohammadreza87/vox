/** Read-only release admission. Runtime storage validation remains authoritative. */
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const ADAPTIVE_RELEASE_CAPABILITIES = Object.freeze({
  supportedAdaptiveDataSchemas: Object.freeze([1, 2]),
  supportedAdaptiveControlSchemas: Object.freeze([1, 2]),
  productPauseEnforcementVersion: 1,
  supportedFileAuthorityProjectionVersions: Object.freeze([1]),
});
const fail = () => { throw new Error('Adaptive storage is incompatible with this release; current personalization controls must be preserved.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function readPlainJson(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail();
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { fail(); }
}
export function readInstalledReleaseManifest(release) {
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
}

/** No data/consent writes or legacy inference from an invalid/new marker. */
export function requiredAdaptiveCapabilities(env) {
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
  return required;
}
