#!/usr/bin/env node
// Offline deployment preflight. Does not load dotenv, create users/keys/services, or contact a provider.
import { promises as fs, constants } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { brokerConfigurationSchema } from '../src/lib/connections/broker/bootstrap.ts';
import { checkConfiguration } from './connections-config.mjs';
const execute = promisify(execFile);
const roles = ['brokerConfig', 'vaultDirectory', 'vaultKey', 'brokerAuthKey', 'studioAuthKey'];
export function verifyRoleMetadata(configuration, metadata, keyProof, principalProof = { broker: false, studio: false }) {
  const issues = [];
  if (configuration.brokerUid === 0 || configuration.studioUid === 0 || configuration.brokerUid === configuration.studioUid) issues.push({ code: 'independent_nonroot_uids_required' });
  if (!principalProof.broker) issues.push({ code: 'broker_principal_unavailable' });
  if (!principalProof.studio) issues.push({ code: 'studio_principal_unavailable' });
  for (const role of roles) {
    const expectedUid = role === 'studioAuthKey' ? configuration.studioUid : configuration.brokerUid;
    const record = metadata[role];
    if (!record) { issues.push({ code: `${role}_metadata_unavailable` }); continue; }
    if (record.symbolicLink || record.kind !== (role === 'vaultDirectory' ? 'directory' : 'file') || record.uid !== expectedUid || (record.mode & 0o077) !== 0) issues.push({ code: `${role}_ownership_or_permissions_invalid` });
    if (role !== 'vaultDirectory' && record.links !== 1) issues.push({ code: `${role}_hardlink_denied` });
  }
  if (!keyProof.readable) issues.push({ code: 'private_key_role_proof_unavailable' });
  else {
    if (!keyProof.validEncoding) issues.push({ code: 'private_key_encoding_invalid' });
    if (!keyProof.controlCopiesMatch) issues.push({ code: 'studio_broker_control_key_mismatch' });
    if (!keyProof.vaultDistinct) issues.push({ code: 'vault_control_key_reuse_denied' });
  }
  return { status: issues.length ? 'FAIL' : 'PASS', issues, checkedRoles: roles, keyValuesPrinted: false,
    runtimeIamProof: 'UNAVAILABLE', aclProof: 'UNAVAILABLE', serviceActivation: false, usersOrSecretsCreated: false };
}
async function metadata(path) {
  try { const stat = await fs.lstat(path); return { kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other', uid: stat.uid, mode: stat.mode, symbolicLink: stat.isSymbolicLink(), links: stat.nlink }; }
  catch { return undefined; }
}
async function privateKey(path, expectedUid) {
  if (!isAbsolute(path)) throw new Error('key_path_invalid');
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== expectedUid || (stat.mode & 0o077) !== 0 || stat.size > 200) throw new Error('key_role_invalid');
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('key_role_invalid');
    const buffer = Buffer.alloc(201); const { bytesRead } = await handle.read(buffer, 0, 201, 0); const text = buffer.subarray(0, bytesRead).toString('utf8').trim(); buffer.fill(0);
    if (!/^[a-f0-9]{64}$/i.test(text)) throw new Error('key_encoding_invalid');
    return Buffer.from(text, 'hex');
  } finally { await handle.close(); }
}
const equal = (left, right) => left.length === right.length && timingSafeEqual(left, right);
async function verifyKeys(configuration, studioAuthPath) {
  const buffers = [];
  try {
    const vault = await privateKey(configuration.vaultKeyFile, configuration.brokerUid); buffers.push(vault);
    const broker = await privateKey(configuration.authKeyFile, configuration.brokerUid); buffers.push(broker);
    const studio = await privateKey(studioAuthPath, configuration.studioUid); buffers.push(studio);
    return { readable: true, validEncoding: true, controlCopiesMatch: equal(broker, studio), vaultDistinct: !equal(vault, broker) && !equal(vault, studio) };
  } catch (error) { return { readable: false, validEncoding: error.message !== 'key_encoding_invalid', controlCopiesMatch: false, vaultDistinct: false }; }
  finally { buffers.forEach(buffer => buffer.fill(0)); }
}
async function principalExists(uid) {
  if (!Number.isSafeInteger(uid) || uid <= 0) return false;
  try { await execute('/usr/bin/id', ['-nu', String(uid)], { timeout: 2000, maxBuffer: 1000, env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' } }); return true; } catch { return false; }
}
async function boundedJson(path, limit) {
  const stat = await fs.lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('preflight_file_invalid');
  const bytes = await fs.readFile(path); if (bytes.length > limit) throw new Error('preflight_file_invalid'); return JSON.parse(bytes.toString('utf8'));
}
export async function deploymentPreflight({ manifestPath, brokerPath, studioAuthPath }) {
  if ([manifestPath, brokerPath, studioAuthPath].some(path => !isAbsolute(path))) throw new Error('preflight_absolute_paths_required');
  const broker = brokerConfigurationSchema.parse(await boundedJson(brokerPath, 200000));
  const configuration = checkConfiguration(await boundedJson(manifestPath, 512000), broker, { manifestPath });
  const [brokerConfig, vaultDirectory, vaultKey, brokerAuthKey, studioAuthKey, keyProof, brokerPrincipal, studioPrincipal] = await Promise.all([
    metadata(brokerPath), metadata(broker.vaultDirectory), metadata(broker.vaultKeyFile), metadata(broker.authKeyFile), metadata(studioAuthPath), verifyKeys(broker, studioAuthPath), principalExists(broker.brokerUid), principalExists(broker.studioUid),
  ]);
  const roleProof = verifyRoleMetadata(broker, { brokerConfig, vaultDirectory, vaultKey, brokerAuthKey, studioAuthKey }, keyProof, { broker: brokerPrincipal, studio: studioPrincipal });
  return { status: configuration.status === 'PASS' && roleProof.status === 'PASS' ? 'PASS' : 'FAIL', offline: true,
    configuration, roleProof, realProviderProof: 'UNAVAILABLE', runtimeIamProof: 'UNAVAILABLE', servicesActivated: false };
}
async function cli(args) {
  const options = {}; if (args.length !== 6) throw new Error('preflight_arguments_invalid');
  for (let index = 0; index < args.length; index += 2) { const key = args[index]; if (!['--manifest', '--broker', '--studio-auth-key'].includes(key) || options[key]) throw new Error('preflight_arguments_invalid'); options[key] = args[index + 1]; }
  if (!options['--manifest'] || !options['--broker'] || !options['--studio-auth-key']) throw new Error('preflight_arguments_invalid');
  const report = await deploymentPreflight({ manifestPath: resolve(options['--manifest']), brokerPath: resolve(options['--broker']), studioAuthPath: resolve(options['--studio-auth-key']) });
  process.stdout.write(JSON.stringify(report) + '\n'); if (report.status !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).catch(error => {
  const allowed = ['preflight_arguments_invalid', 'preflight_file_invalid', 'preflight_absolute_paths_required'];
  process.stderr.write((allowed.includes(error.message) ? error.message : 'preflight_check_failed') + '\n'); process.exitCode = 1;
});
