import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./studio-production.mjs', import.meta.url));
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vox-prepare-test-'));
  const source = join(dir, 'source.env'), destination = join(dir, 'production.env');
  const base = `STUDIO_SECRET='synthetic-only-secret-more-than-32-characters'\nSTUDIO_DATA_DIR='${join(dir, 'data')}'\n`;
  const prepare = () => spawnSync(process.execPath, [script, 'prepare', source], {
    env: { PATH: process.env.PATH, VOX_PRODUCTION_DIR: dir }, encoding: 'utf8', timeout: 10000,
  });
  try { run({ dir, source, destination, base, prepare }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('prepare imports reviewed feature settings, round trips JSON and keeps the private file mode', () => fixture(f => {
  const trust = JSON.stringify({ author: 'synthetic-public-key', note: 'quote " and slash \\n' });
  const manifest = JSON.stringify({ schemaVersion: 1, syntheticOnly: true });
  writeFileSync(f.source, f.base + `STUDIO_MAINTENANCE='1'\nSTUDIO_REMINDER_DELIVERY='1'\nSTUDIO_IMPROVEMENT_TRUST_JSON='${trust}'\nSTUDIO_ADAPTIVE_POLICY_JSON='${manifest}'\nSTUDIO_SCOPED_RELATIONSHIPS='1'\nSTUDIO_RELATIONSHIP_ROLES='owner,superadmin'\nSTUDIO_RELATIONSHIP_AGENTS='*'\nUNLISTED_SOURCE_VALUE='must-not-import'\n`);
  const result = f.prepare();
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(readFileSync(f.destination, 'utf8'));
  assert.equal(env.STUDIO_MAINTENANCE, '1');
  assert.equal(env.STUDIO_REMINDER_DELIVERY, '1');
  assert.equal(env.STUDIO_IMPROVEMENT_TRUST_JSON, trust);
  assert.equal(env.STUDIO_ADAPTIVE_POLICY_JSON, manifest);
  assert.equal(env.STUDIO_SCOPED_RELATIONSHIPS, '1');
  assert.equal(env.STUDIO_RELATIONSHIP_ROLES, 'owner,superadmin');
  assert.equal(env.STUDIO_RELATIONSHIP_AGENTS, '*');
  assert.equal(env.UNLISTED_SOURCE_VALUE, undefined);
  assert.equal(statSync(f.destination).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes('synthetic-public-key'));
}));

test('repeated prepare preserves current disabled flags, blank trust, credentials and private extensions', () => fixture(f => {
  writeFileSync(f.destination, f.base + "STUDIO_MAINTENANCE='0'\nSTUDIO_REMINDER_DELIVERY=''\nSTUDIO_IMPROVEMENT_TRUST_JSON=''\nOPENAI_API_KEY=''\nSTUDIO_RELATIONSHIPS='off'\nSTUDIO_RELATIONSHIP_ROLES='owner,superadmin'\nPRIVATE_EXTENSION='preserve-this'\n");
  writeFileSync(f.source, f.base + "STUDIO_MAINTENANCE='1'\nSTUDIO_REMINDER_DELIVERY='1'\nSTUDIO_IMPROVEMENT_TRUST_JSON='new-trust'\nOPENAI_API_KEY='synthetic-key'\nSTUDIO_RELATIONSHIPS='live'\nSTUDIO_RELATIONSHIP_ROLES='owner'\nPRIVATE_EXTENSION='overwrite-attempt'\n");
  for (let i = 0; i < 2; i++) {
    const result = f.prepare(); assert.equal(result.status, 0, result.stderr);
    const env = parseEnv(readFileSync(f.destination, 'utf8'));
    assert.equal(env.STUDIO_MAINTENANCE, '0');
    assert.equal(env.STUDIO_REMINDER_DELIVERY, '');
    assert.equal(env.STUDIO_IMPROVEMENT_TRUST_JSON, '');
    assert.equal(env.OPENAI_API_KEY, '');
    assert.equal(env.STUDIO_RELATIONSHIPS, 'off');
    assert.equal(env.STUDIO_RELATIONSHIP_ROLES, 'owner,superadmin');
    assert.equal(env.PRIVATE_EXTENSION, 'preserve-this');
    assert.equal(env.STUDIO_SECRET, 'synthetic-only-secret-more-than-32-characters');
  }
}));

test('prepare carries explicit storage selection and preserves an existing legacy selection without conversion', () => fixture(f => {
  writeFileSync(f.source, f.base + "STUDIO_ADAPTIVE_FORMAT='file-v2'\n");
  assert.equal(f.prepare().status, 0);
  assert.equal(parseEnv(readFileSync(f.destination, 'utf8')).STUDIO_ADAPTIVE_FORMAT, 'file-v2');
  assert.equal(existsSync(join(f.dir, 'data', 'adaptive.managed')), false);
  writeFileSync(f.destination, f.base + "STUDIO_ADAPTIVE_FORMAT=''\n");
  assert.equal(f.prepare().status, 0);
  assert.equal(parseEnv(readFileSync(f.destination, 'utf8')).STUDIO_ADAPTIVE_FORMAT, '');
  assert.equal(existsSync(join(f.dir, 'data', 'adaptive.managed')), false);
}));
