import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

const root = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const [phase, name, portArg = '3142'] = process.argv.slice(2);
assert(['build', 'run'].includes(phase), 'use: node qualify.mjs build|run fresh-attempt-name [3142]');
assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(name ?? ''), 'bounded attempt name required');
assert.equal(process.version, 'v22.23.3', 'exact qualified Node 22.23.3 required');
assert(['darwin', 'linux'].includes(process.platform));
assert((process.platform === 'darwin' && process.arch === 'arm64') || (process.platform === 'linux' && process.arch === 'x64'), 'qualified target candidates only');
if (process.platform === 'linux') assert(process.report.getReport().header.glibcVersionRuntime, 'glibc required');
const target = `${process.platform}-${process.arch}-node22`;
const attempt = path.join(root, 'attempts', name);
const app = path.join(attempt, 'app');
const runtime = path.join(attempt, 'runtime');
const evidence = path.join(attempt, 'evidence');
const data = path.join(attempt, 'data');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (filename, value) => fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
function snapshot(directory) {
  const rows = [];
  function visit(relative) {
    for (const item of fs.readdirSync(path.join(directory, relative), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const entry = path.posix.join(relative, item.name);
      const filename = path.join(directory, entry);
      assert(!item.isSymbolicLink(), `symlink disallowed: ${filename}`);
      if (item.isDirectory()) visit(entry);
      else { assert(item.isFile()); const bytes = fs.readFileSync(filename); rows.push({path: entry, bytes: bytes.length, sha256: hash(bytes)}); }
    }
  }
  visit('');
  return rows;
}
function artifact() {
  return {
    standalone: snapshot(path.join(app, '.next/standalone')),
    static: snapshot(path.join(app, '.next/static')),
    public: snapshot(path.join(app, 'public')),
  };
}
const manifestFile = path.join(root, 'source-manifest.json');
const manifestBytes = fs.readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes);
for (const row of manifest.files) {
  const bytes = fs.readFileSync(path.join(root, row.path));
  assert.equal(bytes.length, row.bytes, row.path);
  assert.equal(hash(bytes), row.sha256, row.path);
}
assert.equal(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8').includes('"13.0.3"'), true);
const cleanEnv = () => ({
  PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
  HOME: path.join(attempt, 'home'),
  TMPDIR: path.join(attempt, 'tmp'),
  LANG: 'en_US.UTF-8',
  NEXT_TELEMETRY_DISABLED: '1',
  npm_config_cache: path.join(root, 'npm-cache'),
  npm_config_registry: 'https://registry.npmjs.org/',
  npm_config_engine_strict: 'true',
});
function command(command, args, options, logName, timeout = 600000) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(path.join(evidence, logName), 'wx');
    const child = spawn(command, args, {...options, stdio: ['ignore', log, log]});
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.once('error', error => { clearTimeout(timer); fs.closeSync(log); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); fs.closeSync(log);
      if (code === 0) resolve(); else reject(new Error(`${logName}: exit ${code}, signal ${signal}`));
    });
  });
}
function verifyInputs() {
  for (const row of manifest.files) assert.equal(hash(fs.readFileSync(path.join(root, row.path))), row.sha256, row.path);
}
let server;
try {
  if (phase === 'build') {
    assert(!fs.existsSync(attempt), 'attempt already exists; retain it and choose a fresh name');
    for (const directory of [app, evidence, data, path.join(attempt, 'tmp'), path.join(attempt, 'home')]) fs.mkdirSync(directory, {recursive: true});
    for (const item of ['package.json', 'package-lock.json', 'next.config.mjs', 'app', 'public']) fs.cpSync(path.join(root, item), path.join(app, item), {recursive: true, errorOnExist: true});
    json(path.join(evidence, 'input.json'), {at: new Date().toISOString(), node: process.version, target, manifestSha256: hash(manifestBytes)});
    await command('npm', ['ci', '--ignore-scripts', '--engine-strict', '--no-audit', '--no-fund'], {cwd: app, env: cleanEnv()}, 'install.log');
    await command('npm', ['audit', '--json'], {cwd: app, env: cleanEnv()}, 'audit.json');
    await command(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {cwd: app, env: {...cleanEnv(), NODE_ENV: 'production', NODE_OPTIONS: `--require=${path.join(root, 'boundary.cjs')}`, FIXTURE_BOUNDARY_LOG: path.join(evidence, 'build-boundary.jsonl')}}, 'build.log');
    verifyInputs();
    const rows = artifact();
    const nativeRelative = `node_modules/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`;
    for (const required of [nativeRelative, 'node_modules/better-sqlite3/package.json', 'node_modules/better-sqlite3/lib/binding.js', 'node_modules/better-sqlite3/lib/database.js', 'server.js']) assert(rows.standalone.some(row => row.path === required), `missing standalone file: ${required}`);
    const packageJson = JSON.parse(fs.readFileSync(path.join(app, '.next/standalone/node_modules/better-sqlite3/package.json')));
    assert.equal(packageJson.version, '13.0.3');
    assert.equal(hash(fs.readFileSync(path.join(app, '.next/standalone', nativeRelative))), hash(fs.readFileSync(path.join(app, nativeRelative))));
    json(path.join(evidence, 'artifact.json'), {target, node: process.version, buildId: fs.readFileSync(path.join(app, '.next/BUILD_ID'), 'utf8').trim(), inputManifestSha256: hash(manifestBytes), files: rows});
    console.log(`Built synthetic ${target}; no server started. Run the same reviewed attempt separately.`);
  } else {
    const compiled = JSON.parse(fs.readFileSync(path.join(evidence, 'artifact.json')));
    assert.equal(compiled.target, target);
    assert.equal(compiled.inputManifestSha256, hash(manifestBytes));
    assert.deepEqual(artifact(), compiled.files, 'original compiled artifact changed');
    assert(!fs.existsSync(runtime), 'runtime attempt already exists; never implicitly rerun');
    fs.cpSync(path.join(app, '.next/standalone'), runtime, {recursive: true});
    fs.cpSync(path.join(app, '.next/static'), path.join(runtime, '.next/static'), {recursive: true});
    fs.cpSync(path.join(app, 'public'), path.join(runtime, 'public'), {recursive: true});
    const copied = snapshot(runtime);
    const expected = [...compiled.files.standalone, ...compiled.files.static.map(row => ({...row, path: `.next/static/${row.path}`})), ...compiled.files.public.map(row => ({...row, path: `public/${row.path}`}))].sort((a, b) => a.path.localeCompare(b.path, 'en'));
    assert.deepEqual([...copied].sort((a, b) => a.path.localeCompare(b.path, 'en')), expected, 'copy is not exact');
    json(path.join(evidence, 'runtime-files-before.json'), copied);
    const port = Number(portArg);
    assert(Number.isSafeInteger(port) && port >= 3140 && port <= 3190, 'isolated fixture ports only');
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    const events = [];
    let generation = 0;
    async function request(route, options = {}) {
      assert(['/api/storage', '/api/network-probe', '/qualification.txt'].includes(route));
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {...options, signal: AbortSignal.timeout(2000)});
      const text = await response.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      const event = {at: Date.now(), generation, route, method: options.method ?? 'GET', status: response.status, body};
      events.push(event);
      fs.appendFileSync(path.join(evidence, 'api-responses.jsonl'), JSON.stringify(event) + '\n');
      return {status: response.status, body};
    }
    async function stop() {
      const owned = server;
      server = undefined;
      if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
      const exited = once(owned, 'exit');
      owned.kill('SIGTERM');
      const timer = setTimeout(() => owned.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    async function start(enabled) {
      generation += 1;
      const log = fs.openSync(path.join(evidence, `server-${generation}.log`), 'wx');
      server = spawn(process.execPath, ['--require', path.join(root, 'boundary.cjs'), 'server.js'], {
        cwd: runtime,
        env: {...cleanEnv(), NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port), FIXTURE_RUNTIME_ROOT: runtime, FIXTURE_BOUNDARY_LOG: path.join(evidence, 'runtime-boundary.jsonl'), SQLITE_FIXTURE_DATA: fs.realpathSync(data), ...(enabled ? {SQLITE_FIXTURE_ENABLED: '1'} : {})},
        stdio: ['ignore', log, log],
      });
      server.once('exit', () => fs.closeSync(log));
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        assert.equal(server.exitCode, null, 'owned server exited before readiness');
        try { const result = await request('/api/storage'); if ([404, 503, 200].includes(result.status)) return; throw new Error(`readiness returned ${result.status}`); }
        catch (error) { if (error.message?.startsWith('readiness returned')) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
      }
      throw new Error('owned server readiness deadline');
    }
    await start(false);
    assert.deepEqual(await request('/api/storage'), {status: 503, body: {error: 'synthetic_storage_disabled'}});
    assert.deepEqual(await request('/api/storage', {method: 'POST', headers: {'x-synthetic-fixture': 'initialize-fixed-row-v1'}}), {status: 503, body: {error: 'synthetic_storage_disabled'}});
    assert.deepEqual(fs.readdirSync(data), [], 'disabled mode wrote data');
    const network = await request('/api/network-probe');
    assert.equal(network.status, 200);
    assert.deepEqual(network.body.checks, {fetch: true, net: true, tls: true, http: true, https: true, dns: true, resolve: true});
    assert.equal((await request('/qualification.txt')).body, fs.readFileSync(path.join(root, 'public/qualification.txt'), 'utf8'));
    await stop();
    await start(true);
    assert.deepEqual(await request('/api/storage'), {status: 404, body: {error: 'synthetic_storage_not_initialized'}});
    assert.deepEqual(fs.readdirSync(data), [], 'uninitialized GET wrote a database');
    assert.equal((await request('/api/storage', {method: 'POST'})).status, 403);
    assert.deepEqual(fs.readdirSync(data), [], 'guard-denied POST wrote a database');
    const initialized = await request('/api/storage', {method: 'POST', headers: {'x-synthetic-fixture': 'initialize-fixed-row-v1'}});
    assert.equal(initialized.status, 201);
    function validateNative(result) {
      assert.equal(result.row.value, 'synthetic-native-qualified-v1');
      assert.equal(result.sqliteVersion, '3.53.4');
      assert.equal(result.sqliteSourceId, '2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc');
      assert.equal(result.node, process.version);
      assert.equal(result.platform, process.platform);
      assert.equal(result.arch, process.arch);
      const native = fs.realpathSync(result.nativePath);
      assert(native.startsWith(fs.realpathSync(runtime) + path.sep), 'native loaded outside copied runtime');
      const original = compiled.files.standalone.find(row => row.path === path.relative(fs.realpathSync(runtime), native));
      assert(original, 'native absent from original artifact digest');
      assert.equal(hash(fs.readFileSync(native)), original.sha256);
    }
    validateNative(initialized.body);
    await stop();
    const before = snapshot(data);
    await start(true);
    const reopened = await request('/api/storage');
    assert.equal(reopened.status, 200);
    validateNative(reopened.body);
    await stop();
    assert.deepEqual(snapshot(data), before, 'readonly reopened query changed durable bytes');
    assert.deepEqual(snapshot(runtime), copied, 'copied runtime changed or gained an unapproved file');
    assert.deepEqual(artifact(), compiled.files, 'source artifact changed during runtime');
    verifyInputs();
    const boundary = fs.readFileSync(path.join(evidence, 'runtime-boundary.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert(boundary.filter(event => event.event === 'network_denied').length >= 7);
    assert(boundary.filter(event => event.event === 'native_loaded').length >= 2);
    assert(boundary.filter(event => event.event === 'native_loaded').every(event => event.path.startsWith(fs.realpathSync(runtime) + path.sep)));
    json(path.join(evidence, 'api-responses.json'), events);
    json(path.join(evidence, 'success.json'), {state: 'SYNTHETIC_STANDALONE_PACKAGING_PASS', at: new Date().toISOString(), target, node: process.version, port, buildId: compiled.buildId, inputManifestSha256: hash(manifestBytes), artifactManifestSha256: hash(fs.readFileSync(path.join(evidence, 'artifact.json'))), runtimeSnapshotSha256: hash(JSON.stringify(copied)), databaseSnapshot: before, checks: ['exact native plus required package content in copied standalone', 'no source node_modules resolution', 'all original standalone/static/public bytes bound before and after', 'no unapproved runtime additions', 'strict outbound JS transport denial', 'default unavailable and guard-denied routes create no database', 'fixed native write returns exact engine identity', 'restart readonly query preserves DB bytes'], limits: ['Synthetic standalone route only; not actual Vox runtime integration or authority acceptance', 'Boundary is JavaScript/module guard plus minimal environment, not OS sandbox', 'Only this process OS/arch is qualified', 'No current real-data migration, provider or production interaction']});
    console.log(`PASS ${target}; copied standalone restart and no-write default checked.`);
  }
} catch (error) {
  if (fs.existsSync(evidence)) fs.writeFileSync(path.join(evidence, `failure-${phase}.json`), JSON.stringify({at: new Date().toISOString(), phase, error: String(error), stack: error.stack}, null, 2), {flag: 'wx'});
  throw error;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    const owned = server;
    const ended = once(owned, 'exit');
    owned.kill('SIGTERM');
    const timer = setTimeout(() => owned.kill('SIGKILL'), 5000);
    await ended;
    clearTimeout(timer);
  }
}
