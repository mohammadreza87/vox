#!/usr/bin/env node
/** Single-host Vox Studio releases. Secrets stay in an owner-only env file. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, symlinkSync, renameSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.VOX_PRODUCTION_DIR ?? join(homedir(), 'Library', 'Application Support', 'Vox Studio');
const envFile = join(base, 'production.env');
const label = 'io.ludaxis.vox-studio';
const domain = `gui/${process.getuid()}`;
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'VOXX_BOT_TOKEN', 'VOXX_BOT_USERNAME', 'STUDIO_SECRET', 'STUDIO_SUPERADMIN_IDS', 'STUDIO_WEBAPP_URL', 'STUDIO_DATA_DIR', 'STUDIO_ORG_NAME', 'STUDIO_CHAT_MODEL', 'STUDIO_PERSONA_MODEL'];
const readEnv = (file) => existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); }
function config() {
  if (!existsSync(envFile)) throw new Error('Run prepare first, then fill in production.env.');
  return { ...readEnv(envFile), NODE_ENV: 'production', STUDIO_ONLY: '1', STUDIO_BOTS: '1' };
}
function prepare() {
  privateDir(base);
  const source = readEnv(resolve(process.argv[3] ?? join(root, '.env.local')));
  const env = readEnv(envFile);
  for (const key of keys) if (!env[key] && source[key]) env[key] = source[key];
  env.STUDIO_SECRET ||= randomBytes(32).toString('hex');
  env.STUDIO_DATA_DIR ||= join(base, 'data');
  env.VOXX_BOT_USERNAME ||= 'VoxxBot';
  env.STUDIO_ORG_NAME ||= 'HOOR';
  writeFileSync(envFile, keys.map(k => `${k}=${JSON.stringify(env[k] ?? '')}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(envFile, 0o600);
  privateDir(env.STUDIO_DATA_DIR);
  console.log(`Production configuration prepared: ${envFile}`);
  console.log('Existing secret values were preserved. No service has been started.');
}
async function check() {
  const env = config();
  const missing = ['STUDIO_SECRET', 'VOXX_BOT_TOKEN', 'STUDIO_SUPERADMIN_IDS', 'STUDIO_WEBAPP_URL', 'STUDIO_DATA_DIR', 'ANTHROPIC_API_KEY'].filter(k => !env[k]);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  if (env.STUDIO_SECRET.length < 32) throw new Error('STUDIO_SECRET must have at least 32 characters.');
  if (!env.STUDIO_DATA_DIR.startsWith('/') || env.STUDIO_DATA_DIR === '/') throw new Error('STUDIO_DATA_DIR must be an absolute private directory.');
  if (!env.STUDIO_SUPERADMIN_IDS.split(/[,\s]+/).filter(Boolean).every(x => /^[1-9]\d*$/.test(x) && Number.isSafeInteger(Number(x)))) throw new Error('Invalid STUDIO_SUPERADMIN_IDS.');
  const url = new URL(env.STUDIO_WEBAPP_URL);
  if (url.protocol !== 'https:' || !/^\/studio\/?$/.test(url.pathname) || url.username || url.password || url.search || url.hash) throw new Error('STUDIO_WEBAPP_URL must be a public HTTPS URL ending in /studio.');
  // Never log URLs or exception objects containing the Telegram token.
  const response = await fetch(`https://api.telegram.org/bot${env.VOXX_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const bot = response ? await response.json().catch(() => null) : null;
  if (!bot?.ok) throw new Error('VoxxBot authentication failed. Check VOXX_BOT_TOKEN.');
  if (bot.result.username?.toLowerCase() !== env.VOXX_BOT_USERNAME.toLowerCase()) throw new Error('VOXX_BOT_TOKEN belongs to a different bot than VOXX_BOT_USERNAME.');
  const modelsResponse = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const models = modelsResponse?.ok ? await modelsResponse.json() : null;
  if (!models?.data) throw new Error('Anthropic authentication/model lookup failed.');
  for (const model of [env.STUDIO_CHAT_MODEL || 'claude-haiku-5-5', env.STUDIO_PERSONA_MODEL || 'claude-sonnet-5-5']) {
    if (!models.data.some(x => x.id === model)) throw new Error(`Anthropic model unavailable: ${model}`);
  }
  for (const key of ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY']) if (!env[key]) console.log(`Optional feature provider absent: ${key}`);
  console.log(`Preflight passed for @${bot.result.username} at ${url.origin}/studio.`);
  return env;
}
function running() { return spawnSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }).status === 0; }
function listening() {
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port: 3107 });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => { socket.destroy(); done(false); });
    socket.once('timeout', () => { socket.destroy(); done(true); });
  });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function stop() {
  if (running()) {
    const result = spawnSync('launchctl', ['bootout', `${domain}/${label}`], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Could not stop Vox Studio.');
  }
  const pid = existsSync(join(base, 'server.pid')) ? Number(readFileSync(join(base, 'server.pid'), 'utf8')) : NaN;
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((!Number.isSafeInteger(pid) || !alive(pid)) && !(await listening())) return;
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error('Studio has not fully stopped, or port 3107 belongs to another process. No snapshot was taken.');
}
function start() {
  const result = spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not start launch agent; inspect launchctl status.');
}
function snapshot() {
  const env = config();
  if (!existsSync(env.STUDIO_DATA_DIR)) return;
  privateDir(join(base, 'backups'));
  const dest = join(base, 'backups', stamp());
  privateDir(dest);
  cpSync(env.STUDIO_DATA_DIR, join(dest, 'data'), { recursive: true });
  cpSync(envFile, join(dest, 'production.env'));
  chmodSync(join(dest, 'production.env'), 0o600);
  console.log(`Stopped-process backup: ${dest}`);
}
function pointTo(path) {
  const temp = join(base, `current-${process.pid}`);
  symlinkSync(path, temp);
  renameSync(temp, join(base, 'current'));
}
function xml(value) { return String(value).replace(/[<>&"']/g, x => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[x]); }
function installPlist() {
  privateDir(join(base, 'logs'));
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(base, 'current', 'studio-runtime.mjs'))}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict><key>VOX_PRODUCTION_DIR</key><string>${xml(base)}</string></dict>
<key>WorkingDirectory</key><string>${xml(base)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(base, 'logs', 'server.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(base, 'logs', 'error.log'))}</string>
</dict></plist>\n`, { mode: 0o600 });
}
async function install() {
  await check();
  const artifact = join(root, '.next', 'standalone');
  if (!existsSync(join(artifact, 'server.js'))) throw new Error('Run npm run build first; standalone/server.js is missing.');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (!revision || dirty) throw new Error('Commit the tested release before installing it.');
  const sourceTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const manifest = existsSync(join(root, '.next', 'studio-release.json')) ? JSON.parse(readFileSync(join(root, '.next', 'studio-release.json'), 'utf8')) : null;
  const buildId = readFileSync(join(artifact, '.next', 'BUILD_ID'), 'utf8').trim();
  if (!manifest || manifest.revision !== revision || manifest.sourceTree !== sourceTree || manifest.buildId !== buildId || buildId !== readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim()) {
    throw new Error('Build provenance does not match this committed source. Run npm run studio:build.');
  }
  const release = join(base, 'releases', `${stamp()}-${revision.slice(0, 12)}`);
  privateDir(release);
  cpSync(artifact, release, { recursive: true, filter: source => !/^\.env(?:\.|$)/.test(basename(source)) });
  cpSync(join(root, '.next', 'static'), join(release, '.next', 'static'), { recursive: true });
  cpSync(join(root, 'public'), join(release, 'public'), { recursive: true });
  cpSync(fileURLToPath(import.meta.url), join(release, 'studio-runtime.mjs'));
  writeFileSync(join(release, 'revision'), revision + '\n');
  const previous = existsSync(join(base, 'current')) ? realpathSync(join(base, 'current')) : null;
  const wasRunning = running();
  if (previous) writeFileSync(join(base, 'previous'), previous);
  try {
    await stop();
    snapshot();
    pointTo(release);
    installPlist();
    start();
    let ready = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const response = await fetch('http://127.0.0.1:3107/api/studio/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
      const health = response?.ok ? await response.json().catch(() => null) : null;
      if (health?.status === 'healthy' && health.bots && health.revision === revision) { ready = true; break; }
      await new Promise(done => setTimeout(done, 2000));
    }
    if (!ready) throw new Error('New release failed its readiness check.');
  } catch (error) {
    await stop();
    if (previous) { pointTo(previous); if (wasRunning) start(); }
    throw error;
  }
  console.log(`Installed revision ${revision}. Run status, then verify the public HTTPS endpoint and Telegram.`);
}
async function status() {
  console.log(`Launch agent: ${running() ? 'loaded' : 'not loaded'}`);
  const response = await fetch('http://127.0.0.1:3107/api/studio/health', { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response) throw new Error('Studio is not reachable on 127.0.0.1:3107.');
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify(body));
  const expected = readFileSync(join(base, 'current', 'revision'), 'utf8').trim();
  if (!response.ok || body?.status !== 'healthy' || !body?.bots || body.revision !== expected) throw new Error('Studio readiness check failed.');
}
function run() {
  const env = config();
  const current = realpathSync(join(base, 'current'));
  const revision = readFileSync(join(current, 'revision'), 'utf8').trim();
  process.umask(0o077);
  const child = spawn(process.execPath, [join(current, 'server.js')], {
    cwd: current, stdio: 'inherit', env: { ...process.env, ...env, HOSTNAME: '127.0.0.1', PORT: '3107', STUDIO_REVISION: revision },
  });
  child.on('spawn', () => writeFileSync(join(base, 'server.pid'), String(child.pid), { mode: 0o600 }));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Studio process failed to start.'); process.exit(1); });
  child.on('exit', code => process.exit(code ?? 1));
}

try {
  switch (process.argv[2]) {
    case 'prepare': prepare(); break;
    case 'check': await check(); break;
    case 'install': await install(); break;
    case 'status': await status(); break;
    case 'stop': await stop(); break;
    case 'run': run(); break;
    case 'backup': { const wasRunning = running(); try { await stop(); snapshot(); } finally { if (wasRunning && !running()) start(); } break; }
    case 'rollback': {
      const previous = readFileSync(join(base, 'previous'), 'utf8');
      if (!existsSync(join(previous, 'server.js'))) throw new Error('Previous release is unavailable.');
      const current = realpathSync(join(base, 'current'));
      const wasRunning = running();
      try { await stop(); snapshot(); pointTo(previous); start(); }
      catch (error) { await stop(); pointTo(current); if (wasRunning) start(); throw error; }
      console.log('Previous release restored; verify status.'); break;
    }
    default: console.log('Usage: node scripts/studio-production.mjs prepare|check|install|status|stop|backup|rollback'); process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
