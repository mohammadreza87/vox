import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

test('prepare preserves existing configuration and never copies provider credentials into Studio', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'vox-config-fixture-')));
  try {
    const production = join(base, 'production'); await mkdir(production, { mode: 0o700 });
    assert.equal(await realpath(production), production);
    assert.equal((await stat(base)).mode & 0o777, 0o700);
    assert.equal((await stat(production)).mode & 0o777, 0o700);
    const envFile = join(production, 'production.env');
    await writeFile(envFile, `STUDIO_SECRET='fixture-not-a-secret-01234567890123456789'\nSTUDIO_CONNECTIONS_CONFIG_FILE='/private/operator/manifest.json'\nSTUDIO_REVIEWED_EXISTING_FLAG='keep'\n`, { mode: 0o600 });
    const source = join(base, 'input.env');
    await writeFile(source, `STUDIO_CONNECTIONS_BROKER_URL='http://127.0.0.1:3210'\nSTUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE='/private/studio/auth.key'\nGITHUB_TOKEN='fixture-must-not-copy'\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [resolve('scripts/studio-production.mjs'), 'prepare', source], { encoding: 'utf8', env: { PATH: process.env.PATH, VOX_PRODUCTION_DIR: production } });
    assert.equal(result.status, 0, result.stderr);
    const output = parseEnv(await readFile(envFile, 'utf8'));
    assert.equal(output.STUDIO_CONNECTIONS_CONFIG_FILE, '/private/operator/manifest.json');
    assert.equal(output.STUDIO_CONNECTIONS_BROKER_URL, 'http://127.0.0.1:3210');
    assert.equal(output.STUDIO_REVIEWED_EXISTING_FLAG, 'keep');
    assert.equal(output.GITHUB_TOKEN, undefined);
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);
    assert.equal(result.stdout.includes('fixture-not-a-secret'), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});
