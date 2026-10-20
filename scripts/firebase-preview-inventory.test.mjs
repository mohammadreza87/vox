import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capture, LIMITS, projectInventory, runInventory } from './firebase-preview-inventory.mjs';

const project = 'test-project';
const channel = (id, extra = {}) => ({ name: `sites/${project}/channels/${id}`, expireTime: '2026-10-27T12:00:00Z', ...extra });
const response = (channels) => JSON.stringify({ status: 'success', result: { channels } });
const credential = { type: 'service_account', project_id: project, private_key: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC_ONLY\n-----END PRIVATE KEY-----\n', client_email: 'synthetic@test-project.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' };
const scopeCases = [
  [`projects/${project}/sites/${project}/channels/pr1-canary`, 'UNEXPECTED_SCOPE_PROJECT_EXACT'],
  [`projects/123456789/sites/${project}/channels/pr1-canary`, 'UNEXPECTED_SCOPE_PROJECT_NUMERIC'],
  [`projects/other-project/sites/${project}/channels/pr1-canary`, 'UNEXPECTED_SCOPE_PROJECT_OTHER'],
  ['sites/other-project/channels/pr1-canary', 'UNEXPECTED_SCOPE_FOREIGN_SITE'],
  [`projects/${project}/sites/other-project/channels/pr1-canary`, 'UNEXPECTED_SCOPE_FOREIGN_SITE'],
  ['projects/123456789/sites/other-project/channels/pr1-canary', 'UNEXPECTED_SCOPE_FOREIGN_SITE'],
  [`projects/${project}/sites/${project}/channels/pr1-canary/extra`, 'UNEXPECTED_SCOPE_MALFORMED'],
];

test('scope diagnostics classify fixed failure categories without accepting any new resource', () => {
  for (const [name, code] of scopeCases) {
    assert.throws(() => projectInventory(response([channel('pr1-test', { name })]), project),
      (error) => error.message === code && !error.message.includes('canary'));
  }
});

test('scope diagnostics reject malformed segments, encodings, URLs and control characters', () => {
  const base = `projects/${project}/sites/${project}/channels/pr1-canary`;
  for (const name of [base + '\n', base + '\r', base + '\u0000', base + '?x=y', base + '#x',
    base.replace('pr1-canary', '..'), base.replace('pr1-canary', 'pr1%2fcanary'),
    base.replace('projects/', 'projects//'), base.replace(project, 'x'.repeat(64)),
    base.replace(project, '1'.repeat(31)), `https://example.invalid/${base}`, 'channels/pr1-canary']) {
    assert.throws(() => projectInventory(response([channel('pr1-test', { name })]), project),
      (error) => error.message === 'UNEXPECTED_SCOPE_MALFORMED');
  }
  for (const name of ['x'.repeat(201), null, 123]) {
    assert.throws(() => projectInventory(response([channel('pr1-test', { name })]), project), /INVALID_CHANNEL/);
  }
});

test('actual wrapper scope failures expose only constant codes, exit nonzero and clean private files', async () => {
  await fixture(async (env, root) => {
    const bin = path.join(root, 'lib/bin');
    const tmp = path.join(root, 'tmp');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(tmp);
    for (const [name, code] of scopeCases) {
      fs.writeFileSync(path.join(bin, 'firebase.js'),
        `require('node:fs').writeFileSync('firebase-debug.log', 'PRIVATE_DEBUG_CANARY'); console.log(${JSON.stringify(response([channel('pr1-test', { name, url: 'https://private-canary.invalid' })]))});`);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./firebase-preview-inventory.mjs', import.meta.url))],
        { env: { ...env, TMPDIR: tmp }, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, `preview_inventory_failed:${code}\n`);
      assert.deepEqual(fs.readdirSync(tmp), []);
    }
  });
});

test('projects only IDs/expiry/counts; excludes live and metadata, reports display truncation', () => {
  const items = Array.from({ length: 105 }, (_, i) => channel(`pr${i}-test`, { url: 'https://secret.example/user', release: { releaseUser: { email: 'private@example.com' } } }));
  const result = projectInventory(response([...items, channel('live', { expireTime: undefined })]), project);
  assert.equal(result.totalChannelCount, 106);
  assert.equal(result.prChannelCount, 105);
  assert.equal(result.reportedPrCount, 100);
  assert.equal(result.omittedPrCount, 5);
  assert.equal(result.channels.length, 100);
  assert.doesNotMatch(JSON.stringify(result), /https|secret|private|release/);
});

test('malformed, failed, unknown envelope/pagination, duplicate, foreign project/site and unsafe labels fail closed', () => {
  for (const value of ['broken', '{}', JSON.stringify({ status: 'error', error: 'https://secret' }), JSON.stringify({ status: 'success', result: { channels: [], nextPageToken: 'x' } }), response([channel('pr1-test'), channel('pr1-test')]), response([channel('pr1-test', { name: 'projects/other/sites/test-project/channels/pr1-test' })]), response([channel('pr1-test', { name: 'projects/test-project/sites/other/channels/pr1-test' })]), response([channel('user@example.com')]), response([channel('pr1-test', { expireTime: '2026-02-31T12:00:00Z' })]), response([channel('pr1-test', { expireTime: 'https://private' })])]) {
    assert.throws(() => projectInventory(value, project));
  }
  assert.throws(() => projectInventory(response([channel('secret-canary')]), project, ['secret-canary']), /UNSAFE_CHANNEL/);
  assert.throws(() => projectInventory(' '.repeat(LIMITS.stdout + 1), project), /OUTPUT_LIMIT/);
  assert.throws(() => projectInventory(response(Array.from({ length: 1001 }, (_, i) => channel(`pr${i}-test`))), project), /CHANNEL_LIMIT/);
});

test('empty complete listing has explicit zero counts', () => {
  assert.deepEqual(projectInventory(response([]), project), { totalChannelCount: 0, liveCount: 0, prChannelCount: 0, reportedPrCount: 0, omittedPrCount: 0, omittedOtherCount: 0, completeForPrChannels: true, channels: [] });
});

async function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-inventory-synthetic-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'firebase-tools', version: '15.34.0' }));
  const env = { FIREBASE_INVENTORY_CLI_ROOT: root, FIREBASE_PROJECT_ID: project, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(credential), DEBUG: '1', FIREBASE_TOKEN: 'MUST_NOT_INHERIT', HTTPS_PROXY: 'MUST_NOT_INHERIT' };
  try { await fn(env, root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('credentials/config restricted, child env minimized, cleanup on success and error', async () => {
  await fixture(async (env) => {
    for (const failure of [false, true]) {
      let dir;
      const signals = new EventEmitter();
      const invoke = runInventory(env, { signalTarget: signals, captureFn: async (command, args, options) => {
        dir = options.cwd;
        assert.equal(command, process.execPath);
        assert.equal(args[1], '--readonly-child');
        assert.equal(args[3], project);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(options.env.GOOGLE_APPLICATION_CREDENTIALS).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.join(dir, 'firebase.json')).mode & 0o777, 0o600);
        assert.equal(JSON.parse(fs.readFileSync(options.env.GOOGLE_APPLICATION_CREDENTIALS)).project_id, project);
        assert.equal(options.env.HOME, undefined);
        assert.equal(options.env.XDG_CONFIG_HOME, dir);
        assert.equal(options.env.CI, 'true');
        assert.equal(options.env.FIREBASE_SERVICE_ACCOUNT, undefined);
        assert.equal(options.env.FIREBASE_TOKEN, undefined);
        assert.equal(options.env.DEBUG, undefined);
        assert.equal(options.env.HTTPS_PROXY, undefined);
        fs.writeFileSync(path.join(dir, 'firebase-debug.log'), 'SYNTHETIC SENSITIVE LOG');
        if (failure) throw new Error('CLI_FAILED');
        return response([channel('pr1-test')]);
      } });
      if (failure) await assert.rejects(invoke, /CLI_FAILED/); else assert.equal((await invoke).prChannelCount, 1);
      assert.equal(fs.existsSync(dir), false);
      assert.equal(signals.listenerCount('SIGTERM'), 0);
    }
  });
});

test('signal cleanup removes entire directory and unregisters handlers', async () => {
  await fixture(async (env) => {
    const signals = new EventEmitter();
    let exitCode;
    let dir;
    await assert.rejects(runInventory(env, { signalTarget: signals, exitFn: (code) => { exitCode = code; }, captureFn: async (_command, _args, options) => {
      dir = options.cwd;
      signals.emit('SIGTERM');
      assert.equal(fs.existsSync(dir), false);
      throw new Error('CLI_FAILED');
    } }), /CLI_FAILED/);
    assert.equal(exitCode, 130);
    assert.equal(signals.listenerCount('SIGINT'), 0);
  });
});

test('unsupported CLI / foreign credential project / endpoint overrides never start child', async () => {
  await fixture(async (env, root) => {
    let calls = 0;
    const deps = { captureFn: async () => { calls++; return response([]); } };
    for (const bad of [{ ...credential, project_id: 'other-project' }, { ...credential, token_uri: 'https://evil.invalid/token' }]) {
      await assert.rejects(runInventory({ ...env, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(bad) }, deps), /INVALID_CREDENTIALS/);
    }
    await assert.rejects(runInventory({ ...env, FIREBASE_SERVICE_ACCOUNT: 'x'.repeat(LIMITS.credentials + 1) }, deps), /INVALID_CREDENTIALS/);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'firebase-tools', version: '99.0.0' }));
    await assert.rejects(runInventory(env, deps), /UNSUPPORTED_CLI/);
    assert.equal(calls, 0);
  });
});

test('raw stderr and nonzero child error never escape', async () => {
  await assert.rejects(capture(process.execPath, ['-e', 'process.stderr.write("https://private TOKEN USERNAME");process.exit(2)'], { env: {} }), (error) => error.message === 'CLI_FAILED');
});

test('bounded timeout terminates process and cleanup follows', async () => {
  await fixture(async (env) => {
    let dir;
    await assert.rejects(runInventory(env, { captureFn: (_command, _args, options) => {
      dir = options.cwd;
      return capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options, { timeout: 40 });
    } }), /TIMEOUT/);
    assert.equal(fs.existsSync(dir), false);
  });
});

test('stdout and stderr caps terminate subprocess with sanitized error', async () => {
  for (const stream of ['stdout', 'stderr']) {
    await assert.rejects(capture(process.execPath, ['-e', `process.${stream}.write('x'.repeat(${LIMITS.stdout + 1}));setInterval(()=>{},1000)`], { env: {} }), (error) => error.message === 'OUTPUT_LIMIT');
  }
});

test('child command is fixed to read-only list; no dynamic commands or deletion', () => {
  const source = fs.readFileSync(new URL('./firebase-preview-inventory.mjs', import.meta.url), 'utf8');
  assert.match(source, /'hosting:channel:list', '--project', project, '--site', project/);
  assert.doesNotMatch(source, /hosting:channel:(delete|deploy)|execSync|shell: true|npm install/);
  assert.match(source, /process\.umask\(0o077\)/);
});

 test('unknown valid labels count without disclosing their labels', () => {
  const result = projectInventory(response([channel('private-name'), channel('pr1-test'), channel('live')]), project);
  assert.equal(result.totalChannelCount, 3);
  assert.equal(result.liveCount, 1);
  assert.equal(result.omittedOtherCount, 1);
  assert.equal(result.reportedPrCount, 1);
  assert.equal(result.completeForPrChannels, true);
  assert.doesNotMatch(JSON.stringify(result), /private-name/);
});

 test('documented canonical site names and nullable/absent expiry are supported explicitly', () => {
  const result = projectInventory(response([channel('pr1-null', { expireTime: null }), channel('pr2-absent', { expireTime: undefined }), channel('pr3-date')]), project);
  assert.deepEqual(result.channels, [
    { id: 'pr1-null', expiry: null },
    { id: 'pr2-absent', expiry: null },
    { id: 'pr3-date', expiry: '2026-10-27T12:00:00Z' },
  ]);
  assert.throws(() => projectInventory(response([channel('pr1-other', { name: 'sites/other-project/channels/pr1-other' })]), project), /UNEXPECTED_SCOPE/);
  assert.throws(() => projectInventory(response([channel('pr1-other', { name: 'projects/123456789/sites/test-project/channels/pr1-other' })]), project), /UNEXPECTED_SCOPE/);
  assert.throws(() => projectInventory(response([channel('pr1-other', { name: 'sites/test-project/channels/pr1-other/extra' })]), project), /UNSAFE_CHANNEL/);
});

 test('actual workflow inventory predicate covers attempted deploy failure and preserves trust/preparation gates', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/preview.yml', import.meta.url), 'utf8');
  const step = workflow.split('      - name: Inventory preview channels (read only)')[1].split('      - name: Report preview inventory status')[0];
  const expression = step.match(/if: \$\{\{ (.*) \}\}/)[1];
  const predicate = new Function('always', 'cancelled', 'steps', 'github', `return (${expression});`);
  for (const deploy of ['success', 'failure', 'skipped', 'cancelled']) {
    for (const prepared of ['success', 'failure', 'skipped']) {
      for (const trusted of [true, false]) {
        for (const cancelled of [true, false]) {
          const github = { repository: 'org/repo', event: { pull_request: { head: { repo: { full_name: trusted ? 'org/repo' : 'other/repo' } } } } };
          assert.equal(predicate(() => true, () => cancelled, { preview: { outcome: deploy }, preview_inventory_cli: { outcome: prepared } }, github), !cancelled && trusted && prepared === 'success' && ['success', 'failure'].includes(deploy));
        }
      }
    }
  }
  assert.match(step, /continue-on-error: true/);
  assert.match(workflow, /uses: actions\/checkout@v7/);
  assert.match(workflow, /uses: actions\/setup-node@v7/);
  const deployStep = workflow.split('      - name: Deploy Preview to Firebase')[1].split('      - name: Verify preview HTTP behavior')[0];
  assert.doesNotMatch(deployStep, /continue-on-error/);
  assert.match(deployStep, /firebaseToolsVersion: 15\.34\.0/);
});

 test('child isolation does not repurpose HOME and binds scope through project/credential/site checks', async () => {
  const source = fs.readFileSync(new URL('./firebase-preview-inventory.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:\bHOME\s*:|process\.env\.HOME\s*=)/);
  assert.match(source, /credential\.project_id !== project/);
  assert.match(source, /'--project', project, '--site', project/);
  await fixture(async (env) => {
    let calls = 0;
    await assert.rejects(runInventory({ ...env, FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ ...credential, project_id: 'foreign-project' }) }, { captureFn: async () => { calls++; return response([]); } }), /INVALID_CREDENTIALS/);
    assert.equal(calls, 0);
  });
});
