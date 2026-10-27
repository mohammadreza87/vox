import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { test } from 'node:test';

const scripts = dirname(fileURLToPath(import.meta.url));

function fixture(run) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vox-skill-routing-config-')));
  try {
    for (const name of ['studio-production.mjs', 'studio-adaptive-compatibility.mjs', 'studio-file-runtime-owner.mjs']) {
      cpSync(join(scripts, name), join(dir, name));
    }
    // The earlier installer has no operation helper; guarded releases import it.
    const guard = join(scripts, 'studio-operation-guard.mjs');
    if (existsSync(guard)) cpSync(guard, join(dir, 'studio-operation-guard.mjs'));
    const source = join(dir, 'source.env');
    const destination = join(dir, 'production.env');
    const base = `STUDIO_SECRET='synthetic-only-secret-more-than-32-characters'\nSTUDIO_DATA_DIR='${join(dir, 'data')}'\n`;
    const prepare = () => {
      const result = spawnSync(process.execPath, [join(dir, 'studio-production.mjs'), 'prepare', source], {
        env: { PATH: process.env.PATH, VOX_PRODUCTION_DIR: dir },
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      return parseEnv(readFileSync(destination, 'utf8'));
    };
    run({ source, destination, base, prepare });
  }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const mode of ['on', 'shadow', 'off']) {
  test(`prepare imports skill routing ${mode} when production has no setting`, () => fixture(f => {
    writeFileSync(f.source, `${f.base}STUDIO_SKILL_ROUTING='${mode}'\n`);
    assert.equal(f.prepare().STUDIO_SKILL_ROUTING, mode);
    assert.equal(statSync(f.destination).mode & 0o777, 0o600);
  }));
}

for (const existing of ['on', 'shadow', 'off', '']) {
  test(`repeated prepare preserves existing skill routing ${existing || '(blank)'} over the source`, () => fixture(f => {
    const incoming = existing === 'on' ? 'off' : 'on';
    writeFileSync(f.destination, `${f.base}STUDIO_SKILL_ROUTING='${existing}'\n`);
    writeFileSync(f.source, `${f.base}STUDIO_SKILL_ROUTING='${incoming}'\n`);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal(f.prepare().STUDIO_SKILL_ROUTING, existing);
      assert.equal(statSync(f.destination).mode & 0o777, 0o600);
    }
  }));
}
