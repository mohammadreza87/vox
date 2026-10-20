#!/usr/bin/env node
/** Single-host Vox Studio releases. Secrets stay in an owner-only env file. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, symlinkSync, renameSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { assertReleaseAdaptiveCompatibility, readInstalledReleaseManifest } from './studio-adaptive-compatibility.mjs';
import { assertCurrent, assertIdentifiedRuntime, assertReleaseDirectory, guardedBackup, parseExpected, readControlText, readCurrent, readRelease, releaseDirectoryIdentity, transitionRelease, withOperation } from './studio-operation-guard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let base = process.env.VOX_PRODUCTION_DIR ?? join(homedir(), 'Library', 'Application Support', 'Vox Studio');
let envFile = join(base, 'production.env');
const label = 'io.ludaxis.vox-studio';
const domain = `gui/${process.getuid()}`;
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_TTS_MODEL', 'VOXX_BOT_TOKEN', 'VOXX_BOT_USERNAME', 'STUDIO_SECRET', 'STUDIO_SUPERADMIN_IDS', 'STUDIO_WEBAPP_URL', 'STUDIO_DATA_DIR', 'STUDIO_ORG_NAME', 'STUDIO_CHAT_MODEL', 'STUDIO_VOICE_MODEL', 'STUDIO_PERSONA_MODEL', 'STUDIO_DECISIONS', 'OPENAI_DECISION_MODEL', 'STUDIO_GROUP_OBSERVATION',
  'OPENAI_IMAGE_MODEL', 'OPENAI_STT_MODEL', 'STUDIO_WEB_SEARCH', 'STUDIO_DECISIONS_ENABLED', 'STUDIO_SKILL_ROUTING',
  'STUDIO_RELATIONSHIPS', 'STUDIO_RELATIONSHIP_ROLES', 'STUDIO_RELATIONSHIP_AGENTS', 'STUDIO_RELATIONSHIP_PEOPLE', 'STUDIO_RELATIONSHIP_WORKER_SECRET',
  'STUDIO_SCOPED_RELATIONSHIPS', 'STUDIO_ADAPTIVE_POLICY_JSON', 'STUDIO_MAINTENANCE', 'STUDIO_REMINDER_DELIVERY', 'STUDIO_IMPROVEMENT_TRUST_JSON'];
keys.push('STUDIO_CONNECTIONS_CONFIG_FILE', 'STUDIO_CONNECTIONS_BROKER_URL', 'STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE');
keys.push('STUDIO_ADAPTIVE_FORMAT');
keys.push('STUDIO_REQUESTED_ROUTINES', 'STUDIO_RIGHTS_POLICY_JSON', 'STUDIO_RIGHTS_KEY_BASE64');
const readEnv = (file) => existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
function envLine(key, value) {
  // Dotenv does not use JSON string escapes. Verify exact round trips before
  // replacing a configuration containing the token encryption key.
  for (const quote of ["'", '"', '`']) {
    if (value.includes(quote)) continue;
    const line = `${key}=${quote}${value}${quote}`;
    if (parseEnv(line)[key] === value) return line;
  }
  throw new Error(`${key} cannot be safely encoded as dotenv; the existing file was preserved.`);
}
function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); }
function config() {
  if (!existsSync(envFile)) throw new Error('Run prepare first, then fill in production.env.');
  return { ...readEnv(envFile), NODE_ENV: 'production', STUDIO_STORAGE: 'file', STUDIO_PUBLIC_URL: '', STUDIO_ONLY: '1', STUDIO_BOTS: '1' };
}
function prepare() {
  privateDir(base);
  const source = readEnv(resolve(process.argv[3] ?? join(root, '.env.local')));
  const env = readEnv(envFile);
  // Existing values, including an intentional empty/off setting, take priority.
  // Only allowlisted source values are imported; existing private extensions
  // are retained so preparing a release cannot silently erase configured policy.
  for (const key of keys) if (!Object.hasOwn(env, key) && Object.hasOwn(source, key)) env[key] = source[key];
  env.STUDIO_SECRET ||= randomBytes(32).toString('hex');
  env.STUDIO_DATA_DIR ||= join(base, 'data');
  env.VOXX_BOT_USERNAME ||= 'VoxxBot';
  env.STUDIO_ORG_NAME ||= 'HOOR';
  const contents = [...new Set([...keys, ...Object.keys(env)])].map(k => envLine(k, env[k] ?? '')).join('\n') + '\n';
  const temporary = `${envFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, envFile);
  } finally { rmSync(temporary, { force: true }); }
  chmodSync(envFile, 0o600);
  privateDir(env.STUDIO_DATA_DIR);
  return `Production configuration prepared: ${envFile}\nExisting secret values were preserved. No service has been started.`;
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
  for (const model of new Set([env.STUDIO_CHAT_MODEL || 'claude-sonnet-5-5', env.STUDIO_VOICE_MODEL || 'claude-haiku-5-5', env.STUDIO_PERSONA_MODEL || 'claude-sonnet-5-5'])) {
    if (!models.data.some(x => x.id === model)) throw new Error(`Anthropic model unavailable: ${model}`);
  }
  console.log(`✓ Telegram: @${bot.result.username}`);
  console.log('✓ Anthropic: key valid, chat and persona models available');
  // A webhook on the manager bot means another deployment (e.g. Firebase) owns
  // its updates; long polling here would fight it.
  const hook = await fetch(`https://api.telegram.org/bot${env.VOXX_BOT_TOKEN}/getWebhookInfo`, { signal: AbortSignal.timeout(15_000) })
    .then(r => r.json()).catch(() => null);
  if (hook?.result?.url) {
    throw new Error(`@${bot.result.username} has a webhook (${new URL(hook.result.url).host}). Another deployment owns this bot; run only one.`);
  }
  // Read-only provider checks: no images, transcriptions or speech are generated.
  if (env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response?.ok) throw new Error(`OpenAI authentication failed${response ? ` (HTTP ${response.status})` : ''}. Check OPENAI_API_KEY.`);
    const ids = new Set(((await response.json().catch(() => null))?.data ?? []).map(m => m.id));
    for (const model of [env.OPENAI_IMAGE_MODEL || 'gpt-image-1', env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe']) {
      if (!ids.has(model)) throw new Error(`OpenAI model unavailable to this key: ${model}`);
    }
    console.log('✓ OpenAI: key valid, image and transcription models available');
    // Reply triage uses the Decisions API; replies still work without it, just slower.
    const decisions = env.STUDIO_DECISIONS === 'off' ? null : env.OPENAI_DECISION_MODEL || 'gpt-6-luna';
    if (decisions && ids.has(decisions)) console.log(`✓ OpenAI Decisions: ${decisions} available for fast reply triage`);
    else if (decisions) console.log(`  ! OpenAI Decisions model ${decisions} not available to this key (needs the Decisions permission): replies skip triage.`);
  } else console.log('– OpenAI: OPENAI_API_KEY absent (no avatars, no calls)');
  if (env.ELEVENLABS_API_KEY) {
    const headers = { 'xi-api-key': env.ELEVENLABS_API_KEY };
    const response = await fetch('https://api.elevenlabs.io/v1/models', { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response?.ok) throw new Error(`ElevenLabs authentication failed${response ? ` (HTTP ${response.status})` : ''}. Check ELEVENLABS_API_KEY.`);
    const models = (await response.json().catch(() => null)) ?? [];
    const tts = env.ELEVENLABS_TTS_MODEL || 'eleven_v4';
    const speechModel = models.find(m => m.model_id === tts && m.can_do_text_to_speech);
    if (!speechModel) throw new Error(`ElevenLabs speech model unavailable to this key: ${tts}`);
    if (!speechModel.languages?.some(language => language.language_id === 'fa')) {
      console.log(`  ! ${tts} does not advertise Persian support. Set ELEVENLABS_TTS_MODEL=eleven_v4 for Persian agents.`);
    }
    const user = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const sub = user?.ok ? await user.json().catch(() => null) : null;
    if (sub && typeof sub.character_limit === 'number') {
      const left = sub.character_limit - (sub.character_count ?? 0);
      console.log(`✓ ElevenLabs: key valid, ${tts} available, ${left.toLocaleString('en-US')} characters left this period`);
      if (sub.tier === 'free') console.log('  ! ElevenLabs free plans cannot use Voice Library voices through the API. Choose a default voice or upgrade.');
      if (left < 1000) console.log('  ! ElevenLabs is nearly out of characters: voice replies will fail soon.');
    } else console.log(`✓ ElevenLabs: key valid, ${tts} available (subscription details not readable with this key)`);
    // Live calls create and use an ElevenLabs agent: the key needs the Agents permission.
    const agents = await fetch('https://api.elevenlabs.io/v1/convai/agents?page_size=1', { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (agents?.ok) console.log('✓ ElevenLabs Agents: available for live calls');
    else console.log(`  ! ElevenLabs Agents not accessible${agents ? ` (HTTP ${agents.status})` : ''}: give the key the "ElevenLabs Agents" permission for live calls.`);
  } else console.log('– ElevenLabs: ELEVENLABS_API_KEY absent (no voices)');
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
  const temp = join(base, `current-${process.pid}-${randomBytes(8).toString('hex')}`);
  try {
    symlinkSync(path, temp);
    renameSync(temp, join(base, 'current'));
  } finally { rmSync(temp, { force: true }); }
}
function xml(value) { return String(value).replace(/[<>&"']/g, x => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[x]); }
function installPlist() {
  privateDir(join(base, 'logs'));
  mkdirSync(dirname(plist), { recursive: true });
  const contents = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(base, 'current', 'studio-runtime.mjs'))}</string><string>run</string></array>
<key>EnvironmentVariables</key><dict><key>VOX_PRODUCTION_DIR</key><string>${xml(base)}</string></dict>
<key>WorkingDirectory</key><string>${xml(base)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(join(base, 'logs', 'server.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(base, 'logs', 'error.log'))}</string>
</dict></plist>\n`;
  const temporary = `${plist}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, plist);
  } finally { rmSync(temporary, { force: true }); }
}
async function ready(revision, checkpoint) {
  for (let attempt = 0; attempt < 15; attempt++) {
    checkpoint();
    const response = await fetch('http://127.0.0.1:3107/api/studio/health', { signal: AbortSignal.timeout(2000) }).catch(() => null);
    const health = response?.ok ? await response.json().catch(() => null) : null;
    checkpoint();
    if (health?.status === 'healthy' && health.bots && health.revision === revision) return;
    await new Promise(done => setTimeout(done, 2000));
  }
  throw new Error('New release failed its readiness check.');
}
function transitionOperations() {
  return {
    running, stop, start, snapshot, pointTo, ready,
    clearCurrent: () => unlinkSync(join(base, 'current')),
    compatible: release => assertReleaseAdaptiveCompatibility(config(), readInstalledReleaseManifest(release.path)),
  };
}
async function install(guard, baseline) {
  guard.check(); assertCurrent(base, baseline);
  const env = config();
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
  assertReleaseAdaptiveCompatibility(env, manifest);
  await check();
  guard.check(); assertCurrent(base, baseline); // No release/config/previous mutation before this fence.
  const release = join(base, 'releases', `${stamp()}-${revision.slice(0, 12)}`);
  privateDir(join(base, 'releases'));
  mkdirSync(release, { mode: 0o700 }); // Exclusive creation: never adopt another operation's candidate.
  const createdIdentity = releaseDirectoryIdentity(release);
  cpSync(artifact, release, { recursive: true, filter: source => !/^\.env(?:\.|$)/.test(basename(source)) });
  cpSync(join(root, '.next', 'static'), join(release, '.next', 'static'), { recursive: true });
  cpSync(join(root, 'public'), join(release, 'public'), { recursive: true });
  cpSync(fileURLToPath(import.meta.url), join(release, 'studio-runtime.mjs'));
  cpSync(new URL('./studio-adaptive-compatibility.mjs', import.meta.url), join(release, 'studio-adaptive-compatibility.mjs'));
  cpSync(new URL('./studio-operation-guard.mjs', import.meta.url), join(release, 'studio-operation-guard.mjs'));
  cpSync(join(root, '.next', 'studio-release.json'), join(release, 'studio-release.json'));
  writeFileSync(join(release, 'revision'), revision + '\n');
  assertReleaseDirectory(release, createdIdentity);
  const target = readRelease(release);
  if (target.revision !== revision || target.sourceTree !== sourceTree || target.buildId !== buildId) throw new Error('Copied release provenance changed.');
  await transitionRelease(guard, baseline, target, {
    ...transitionOperations(),
    beforeSwitch: () => { if (!baseline.absent) writeFileSync(join(base, 'previous'), baseline.release.path); },
    afterSwitch: installPlist,
  });
  return `Installed revision ${revision}. Run status, then verify the public HTTPS endpoint and Telegram.`;
}
async function rollback(guard, baseline) {
  guard.check(); assertCurrent(base, baseline);
  const previous = readControlText(join(base, 'previous'));
  if (!existsSync(join(previous, 'server.js'))) throw new Error('Previous release is unavailable.');
  const target = readRelease(previous);
  assertReleaseAdaptiveCompatibility(config(), readInstalledReleaseManifest(previous));
  await transitionRelease(guard, baseline, target, transitionOperations());
  return 'Previous release restored; verify status.';
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

async function dispatch(command, guard, baseline) {
  switch (command) {
    case 'prepare': return prepare();
    case 'check': await check(); break;
    case 'install': return install(guard, baseline);
    case 'status': await status(); break;
    case 'stop': {
      const current = readCurrent(base);
      assertIdentifiedRuntime(current, running());
      guard.check(); assertCurrent(base, current);
      await stop();
      guard.check(); assertCurrent(base, current); break;
    }
    case 'run': run(); break;
    case 'backup': await guardedBackup(guard, { running, stop, snapshot, start, ready }); break;
    case 'rollback': return rollback(guard, baseline);
    default: console.log('Usage: node scripts/studio-production.mjs prepare|check|install|status|stop|backup|rollback\nInstall/rollback: --expect-current <resolved-path> --expect-revision <full-sha> --expect-build <build-id>\nInitial install only: --expect-absent'); process.exitCode = 1;
  }
}
try {
  const command = process.argv[2];
  if (['prepare', 'install', 'stop', 'backup', 'rollback'].includes(command)) {
    const expected = ['install', 'rollback'].includes(command) ? parseExpected(process.argv.slice(3), command) : undefined;
    const receipt = await withOperation(base, command, expected, async (guard, baseline) => {
      base = guard.base; envFile = join(base, 'production.env');
      return dispatch(command, guard, baseline);
    }, { onCancel: signal => { process.exitCode = signal === 'SIGINT' ? 130 : 143; } });
    if (receipt) console.log(receipt);
  } else {
    // launchd's run child must start while install owns the operation lock and awaits health.
    await dispatch(command);
  }
} catch (error) { console.error(error.message); process.exitCode ||= 1; }
