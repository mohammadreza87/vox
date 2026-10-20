import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ credentials: 32768, stdout: 1048576, stderr: 32768, channels: 1000, display: 100, timeout: 30000 });
const VERSION = '15.34.0';
const SELF = fileURLToPath(import.meta.url);
const fail = (code) => { throw new Error(code); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => Object.keys(v).every((k) => allowed.includes(k));
const projectId = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v);

function scopeFailure(name, project) {
  // Classify only rejected resources. No identifier or additional scope is accepted or emitted.
  if (/[\x00-\x20\x7f]/.test(name)) return 'UNEXPECTED_SCOPE_MALFORMED';
  const simple = /^sites\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/channels\/([a-z0-9][a-z0-9-]{0,62})$/.exec(name);
  if (simple) return 'UNEXPECTED_SCOPE_FOREIGN_SITE';
  const qualified = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{1,30})\/sites\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/channels\/([a-z0-9][a-z0-9-]{0,62})$/.exec(name);
  if (!qualified) return 'UNEXPECTED_SCOPE_MALFORMED';
  if (qualified[2] !== project) return 'UNEXPECTED_SCOPE_FOREIGN_SITE';
  if (qualified[1] === project) return 'UNEXPECTED_SCOPE_PROJECT_EXACT';
  if (/^[0-9]+$/.test(qualified[1])) return 'UNEXPECTED_SCOPE_PROJECT_NUMERIC';
  return 'UNEXPECTED_SCOPE_PROJECT_OTHER';
}

export function projectInventory(raw, project, forbidden = []) {
  if (Buffer.byteLength(raw) > LIMITS.stdout) fail('OUTPUT_LIMIT');
  let data;
  try { data = JSON.parse(raw); } catch { fail('INVALID_RESULT'); }
  if (!object(data) || !keys(data, ['status', 'result']) || data.status !== 'success' ||
      !object(data.result) || !keys(data.result, ['channels']) || !Array.isArray(data.result.channels)) fail('INVALID_RESULT');
  const channels = data.result.channels;
  if (channels.length > LIMITS.channels) fail('CHANNEL_LIMIT');
  const seen = new Set();
  const previews = [];
  let liveCount = 0;
  let omittedOtherCount = 0;
  for (const item of channels) {
    // Provider metadata is deliberately never copied to output, including URL/release/user fields.
    if (!object(item) || typeof item.name !== 'string' || item.name.length > 200) fail('INVALID_CHANNEL');
    const prefix = `sites/${project}/channels/`;
    if (!item.name.startsWith(prefix)) fail(scopeFailure(item.name, project));
    const id = item.name.slice(prefix.length);
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || seen.has(id) || forbidden.some((s) => s && id.includes(s))) fail('UNSAFE_CHANNEL');
    seen.add(id);
    if (id === 'live') { liveCount++; continue; }
    const expiry = item.expireTime;
    if (expiry != null && (typeof expiry !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(expiry) || !Number.isFinite(Date.parse(expiry)))) fail('INVALID_EXPIRY');
    // Reject normalized-invalid calendar dates as well as control characters and non-timestamps.
    if (expiry != null && new Date(expiry).toISOString().slice(0, 19) !== expiry.slice(0, 19)) fail('INVALID_EXPIRY');
    if (/^pr[0-9]+-[a-z0-9-]+$/.test(id)) previews.push({ id, expiry: expiry ?? null });
    else omittedOtherCount++;
  }
  previews.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { totalChannelCount: channels.length, liveCount, prChannelCount: previews.length, reportedPrCount: Math.min(previews.length, LIMITS.display), omittedPrCount: Math.max(0, previews.length - LIMITS.display), omittedOtherCount, completeForPrChannels: previews.length <= LIMITS.display, channels: previews.slice(0, LIMITS.display) };
}

export function capture(command, args, options, { spawnFn = spawn, timeout = LIMITS.timeout } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let output = '';
    let outBytes = 0;
    let errBytes = 0;
    let failure;
    let killTimer;
    const kill = (signal) => { try { process.kill(-child.pid, signal); } catch { try { child?.kill(signal); } catch {} } };
    const stop = (code) => {
      if (failure) return;
      failure = code;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 200);
    };
    try { child = spawnFn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false }); }
    catch { reject(new Error('CHILD_START')); return; }
    options.onChild?.(child);
    const timer = setTimeout(() => stop('TIMEOUT'), timeout);
    child.stdout.on('data', (chunk) => {
      outBytes += Buffer.byteLength(chunk);
      if (outBytes > LIMITS.stdout) stop('OUTPUT_LIMIT');
      else if (!failure) output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      // Count and discard; raw provider stderr is never retained or replayed.
      errBytes += Buffer.byteLength(chunk);
      if (errBytes > LIMITS.stderr) stop('OUTPUT_LIMIT');
    });
    child.on('error', () => { failure = 'CHILD_START'; });
    child.on('close', (code) => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (failure || code !== 0) reject(new Error(failure || 'CLI_FAILED'));
      else resolve(output);
    });
  });
}

export async function runInventory(env, { fsApi = fs, captureFn = capture, signalTarget = process, exitFn = (code) => process.exit(code) } = {}) {
  let dir;
  let child;
  const cleanup = () => { if (dir) { fsApi.rmSync(dir, { recursive: true, force: true }); dir = undefined; } };
  const signal = () => { try { process.kill(-child?.pid, 'SIGKILL'); } catch {} cleanup(); exitFn(130); };
  try {
    const project = env.FIREBASE_PROJECT_ID;
    if (!projectId(project)) fail('INVALID_PROJECT');
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > LIMITS.credentials) fail('INVALID_CREDENTIALS');
    let credential;
    try { credential = JSON.parse(raw); } catch { fail('INVALID_CREDENTIALS'); }
    if (!object(credential) || credential.type !== 'service_account' || credential.project_id !== project ||
        typeof credential.private_key !== 'string' || !credential.private_key.startsWith('-----BEGIN PRIVATE KEY-----\n') ||
        typeof credential.client_email !== 'string' || !/^[a-zA-Z0-9._-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(credential.client_email) ||
        credential.token_uri !== 'https://oauth2.googleapis.com/token' ||
        ['universe_domain', 'auth_uri'].some((key) => credential[key] && credential[key] !== ({ universe_domain: 'googleapis.com', auth_uri: 'https://accounts.google.com/o/oauth2/auth' })[key])) fail('INVALID_CREDENTIALS');
    const root = fsApi.realpathSync(env.FIREBASE_INVENTORY_CLI_ROOT || '');
    const pkg = JSON.parse(fsApi.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'firebase-tools' || pkg.version !== VERSION) fail('UNSUPPORTED_CLI');
    dir = fsApi.mkdtempSync(path.join(os.tmpdir(), 'vox-preview-inventory-'));
    fsApi.chmodSync(dir, 0o700);
    signalTarget.once('SIGINT', signal); signalTarget.once('SIGTERM', signal);
    const credentialPath = path.join(dir, 'credential.json');
    // Serialize only fields used for service-account auth; do not inherit credential-controlled endpoints.
    const minimal = { type: 'service_account', project_id: project, private_key: credential.private_key, client_email: credential.client_email, token_uri: 'https://oauth2.googleapis.com/token' };
    fsApi.writeFileSync(credentialPath, JSON.stringify(minimal), { mode: 0o600, flag: 'wx' });
    fsApi.writeFileSync(path.join(dir, 'firebase.json'), '{}', { mode: 0o600, flag: 'wx' });
    // An allowlist prevents inherited tokens, DEBUG, proxy/endpoint overrides, npm hooks and secrets entering the child.
    const childEnv = { PATH: path.dirname(process.execPath), XDG_CONFIG_HOME: dir, TMPDIR: dir, CI: 'true', NO_UPDATE_NOTIFIER: '1', GOOGLE_APPLICATION_CREDENTIALS: credentialPath };
    const result = await captureFn(process.execPath, [SELF, '--readonly-child', root, project], { cwd: dir, env: childEnv, onChild: (p) => { child = p; } });
    return projectInventory(result, project, [credential.private_key, credential.client_email, raw]);
  } finally {
    signalTarget.removeListener('SIGINT', signal); signalTarget.removeListener('SIGTERM', signal);
    cleanup();
  }
}

function readonlyChild(root, project) {
  if (!projectId(project)) fail('INVALID_PROJECT');
  const require = createRequire(path.join(root, 'package.json'));
  const pkg = require('./package.json');
  if (pkg.name !== 'firebase-tools' || pkg.version !== VERSION) fail('UNSUPPORTED_CLI');
  // Unmodified pinned CLI; CI suppresses MOTD and isolated config has no usage opt-in.
  // Its ephemeral debug file stays inside the restricted directory and is never emitted.
  process.umask(0o077);
  process.argv = [process.execPath, path.join(root, 'lib/bin/firebase.js'), 'hosting:channel:list', '--project', project, '--site', project, '--config', path.join(process.cwd(), 'firebase.json'), '--non-interactive', '--json'];
  require('./lib/bin/firebase.js');
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const allowed = new Set(['OUTPUT_LIMIT', 'INVALID_RESULT', 'CHANNEL_LIMIT', 'INVALID_CHANNEL', 'UNEXPECTED_SCOPE', 'UNEXPECTED_SCOPE_PROJECT_EXACT', 'UNEXPECTED_SCOPE_PROJECT_NUMERIC', 'UNEXPECTED_SCOPE_PROJECT_OTHER', 'UNEXPECTED_SCOPE_FOREIGN_SITE', 'UNEXPECTED_SCOPE_MALFORMED', 'UNSAFE_CHANNEL', 'INVALID_EXPIRY', 'CHILD_START', 'TIMEOUT', 'CLI_FAILED', 'INVALID_PROJECT', 'INVALID_CREDENTIALS', 'UNSUPPORTED_CLI']);
  try {
    if (process.argv[2] === '--readonly-child' && process.argv.length === 5) readonlyChild(process.argv[3], process.argv[4]);
    else if (process.argv.length === 2) console.log(JSON.stringify(await runInventory(process.env)));
    else fail('INVALID_INPUT');
  } catch (error) {
    console.error(`preview_inventory_failed:${allowed.has(error?.message) ? error.message : 'INTERNAL'}`);
    process.exitCode = 1;
  }
}
