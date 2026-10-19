import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { test } from 'node:test';
import { DEFAULT_PUBLIC_URL, FIREBASE_PUBLIC_KEYS, dotenvLine, firebaseProductionEnv, writeProductionEnv } from './firebase-production-env.mjs';

function fixture() {
  return {
    FIREBASE_PROJECT_ID: 'vox-fixture-123', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'vox-fixture-123',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaFixtureOnlyNotARealCredential',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'vox-fixture-123.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'vox-fixture-123.firebasestorage.app',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '987654321000',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:987654321000:web:abc123fixture',
    STUDIO_SECRET: 'fixture-only-secret-with-more-than-32-characters',
    VOXX_BOT_TOKEN: '987654321:fixtureOnlyTokenWithEnoughCharacters',
    STUDIO_SUPERADMIN_IDS: '7070,8080', ANTHROPIC_API_KEY: 'fixture-anthropic',
    OPENAI_API_KEY: 'fixture-openai', ELEVENLABS_API_KEY: 'fixture-elevenlabs',
    STUDIO_REVISION: 'a'.repeat(40),
  };
}

test('production config requires every Firebase and full-launch provider value', () => {
  for (const key of [...FIREBASE_PUBLIC_KEYS, 'FIREBASE_PROJECT_ID', 'STUDIO_SECRET', 'VOXX_BOT_TOKEN', 'STUDIO_SUPERADMIN_IDS', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'STUDIO_REVISION']) {
    const env = fixture(); delete env[key];
    assert.throws(() => firebaseProductionEnv(env), new RegExp(key));
  }
});

test('known build placeholders, mismatched projects, unsafe origin and revision are rejected', () => {
  for (const [key, value] of [['NEXT_PUBLIC_FIREBASE_API_KEY', 'test-key'], ['NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com'], ['NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', '123456'], ['NEXT_PUBLIC_FIREBASE_APP_ID', '1:123:web:abc'], ['FIREBASE_PROJECT_ID', 'another-project'], ['STUDIO_PUBLIC_URL', 'https://vox.example/studio'], ['STUDIO_PUBLIC_URL', 'http://vox.example'], ['STUDIO_PUBLIC_URL', 'https://user:password@vox.example'], ['STUDIO_REVISION', 'short-sha'], ['STUDIO_SUPERADMIN_IDS', '7070,invalid']]) {
    assert.throws(() => firebaseProductionEnv({ ...fixture(), [key]: value }));
  }
});

test('Firebase config defaults to the real bucket and existing production origin', () => {
  const config = firebaseProductionEnv(fixture());
  assert.equal(config.STUDIO_PUBLIC_URL, DEFAULT_PUBLIC_URL);
  assert.equal(config.STUDIO_WEBAPP_URL, `${DEFAULT_PUBLIC_URL}/studio`);
  assert.equal(config.STUDIO_MEDIA_BUCKET, fixture().NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  assert.equal(config.STUDIO_STORAGE, 'firestore');
  assert.equal(config.STUDIO_ONLY, '1'); assert.equal(config.STUDIO_BOTS, '0');
  assert.equal(config.VOXX_BOT_USERNAME, 'VoxxBot'); assert.equal(config.STUDIO_ORG_NAME, 'HOOR');
  assert.equal(firebaseProductionEnv({ ...fixture(), STUDIO_MEDIA_BUCKET: 'another-private-bucket' }).STUDIO_MEDIA_BUCKET, 'another-private-bucket');
});

test('private atomic dotenv output round trips quotes, hashes, backslashes and line breaks exactly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vox-firebase-env-test-'));
  try {
    const path = join(dir, '.env');
    for (const value of ['say "hello" # keep \\n literal', "a single ' quote", 'both\' and " quotes', 'line one\nline two', ' preserve outer spaces ']) {
      const config = firebaseProductionEnv({ ...fixture(), STUDIO_ORG_NAME: value });
      writeProductionEnv(path, config);
      assert.deepEqual(parseEnv(readFileSync(path, 'utf8')), config);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
    writeFileSync(path, 'preserved');
    assert.throws(() => writeProductionEnv(path, { STUDIO_SECRET: 'all\' " quotes # prevent safe encoding' }), /encoded exactly/);
    assert.equal(readFileSync(path, 'utf8'), 'preserved');
    assert.throws(() => writeProductionEnv(path, { STUDIO_SECRET: 'literal$VALUE' }), /literal dollar/);
    assert.equal(readFileSync(path, 'utf8'), 'preserved');
    assert.throws(() => dotenvLine('SECRET', 'contains\0null'), /NUL/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('relationship activation is explicit and survives production environment packaging', () => {
  assert.equal(firebaseProductionEnv(fixture()).STUDIO_RELATIONSHIPS, 'off');
  assert.throws(() => firebaseProductionEnv({ ...fixture(), STUDIO_RELATIONSHIPS: 'live' }), /STUDIO_RELATIONSHIP_AGENTS/);
  const env = { ...fixture(), STUDIO_RELATIONSHIPS: 'shadow', STUDIO_RELATIONSHIP_AGENTS: 'synthetic-agent', STUDIO_RELATIONSHIP_PEOPLE: '7070', STUDIO_RELATIONSHIP_WORKER_SECRET: 'fixture-only-worker-secret-with-more-than-32-characters' };
  const config = firebaseProductionEnv(env);
  for (const key of ['STUDIO_RELATIONSHIPS', 'STUDIO_RELATIONSHIP_AGENTS', 'STUDIO_RELATIONSHIP_PEOPLE', 'STUDIO_RELATIONSHIP_WORKER_SECRET']) assert.equal(config[key], env[key]);
  assert.throws(() => firebaseProductionEnv({ ...env, STUDIO_RELATIONSHIP_PEOPLE: '-1' }), /positive Telegram/);
});
