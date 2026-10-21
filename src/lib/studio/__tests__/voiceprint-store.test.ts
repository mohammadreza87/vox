import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AesGcmVoiceprintCipher, voiceprintCipherFromEnv } from '../identity/crypto';
import { FileVoiceprintStore, FirestoreVoiceprintStore, InMemoryVoiceprintStore, type VoiceprintRow } from '../identity/store';
import { voiceprintConfigFromEnv } from '../identity';
import { fakeFirestore, TEST_KEY } from './voiceprint-fixtures';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'vox-voiceprint-store-')); dirs.push(d); return d; };
const cipher = new AesGcmVoiceprintCipher(TEST_KEY);
const PLAIN = new TextEncoder().encode('TPL:PLAINTEXT_TEMPLATE_CANARY_42');
const row = (overrides: Partial<VoiceprintRow> = {}): VoiceprintRow => ({
  personId: 'tg-123', space: 'work', provider: 'fake-vp', modelVersion: 'fake-1', channel: 'mini_app', consentEventId: 'consent-1',
  createdAt: new Date('2026-10-20T12:00:00.000Z'), template: cipher.seal(PLAIN, ['tg-123', 'work', 'fake-vp', 'fake-1', 'consent-1']), ...overrides,
});
const KEY_B64 = Buffer.from(TEST_KEY).toString('base64');

describe('AesGcmVoiceprintCipher', () => {
  it('round-trips and binds the AAD, the tag and the key', () => {
    const sealed = cipher.seal(PLAIN, ['a', 'b']);
    expect(sealed.startsWith(`vpk1.${cipher.keyId}.`)).toBe(true);
    expect(Buffer.from(cipher.open(sealed, ['a', 'b'])).toString()).toBe('TPL:PLAINTEXT_TEMPLATE_CANARY_42');
    expect(() => cipher.open(sealed, ['a', 'c'])).toThrow();
    const parts = sealed.split('.');
    const tag = Buffer.from(parts[3], 'base64url'); tag[0] ^= 1; parts[3] = tag.toString('base64url');
    expect(() => cipher.open(parts.join('.'), ['a', 'b'])).toThrow();
    expect(() => new AesGcmVoiceprintCipher(new Uint8Array(32).fill(1)).open(sealed, ['a', 'b'])).toThrow('voiceprint_key_unavailable');
    expect(() => cipher.open(`vpk0${sealed.slice(4)}`, ['a', 'b'])).toThrow('voiceprint_key_unavailable');
  });
  it('rejects keys that are not 256-bit and empty or oversized plaintext', () => {
    expect(() => new AesGcmVoiceprintCipher(new Uint8Array(16))).toThrow('Voiceprint encryption requires a 256-bit key');
    expect(() => cipher.seal(new Uint8Array(0), [])).toThrow();
    expect(() => cipher.seal(new Uint8Array(65_537), [])).toThrow();
  });
  it('never contains the plaintext in utf8, base64 or hex', () => {
    const sealed = cipher.seal(PLAIN, ['x']);
    for (const encoded of [Buffer.from(PLAIN).toString('utf8'), Buffer.from(PLAIN).toString('base64'), Buffer.from(PLAIN).toString('base64url'),
      Buffer.from(PLAIN).toString('hex'), 'PLAINTEXT_TEMPLATE_CANARY']) expect(sealed).not.toContain(encoded);
  });
});

describe('voiceprintCipherFromEnv', () => {
  it('is null when unset or blank, and requires exactly 32 bytes', () => {
    expect(voiceprintCipherFromEnv({})).toBeNull();
    expect(voiceprintCipherFromEnv({ VOICEPRINT_KEY: '  ' })).toBeNull();
    expect(() => voiceprintCipherFromEnv({ VOICEPRINT_KEY: Buffer.alloc(16, 1).toString('base64') })).toThrow(/32 bytes/);
    expect(voiceprintCipherFromEnv({ VOICEPRINT_KEY: KEY_B64 })?.keyId).toBe(cipher.keyId);
  });
  it('refuses STUDIO_SECRET reuse: raw, first 32 bytes and sha256', () => {
    const secret = 'studio-secret-that-is-definitely-longer-than-32-chars';
    const reuse = 'VOICEPRINT_KEY must not reuse STUDIO_SECRET';
    expect(() => voiceprintCipherFromEnv({ STUDIO_SECRET: secret, VOICEPRINT_KEY: secret })).toThrow(reuse);
    expect(() => voiceprintCipherFromEnv({ STUDIO_SECRET: secret, VOICEPRINT_KEY: Buffer.from(secret).subarray(0, 32).toString('base64') })).toThrow(reuse);
    expect(() => voiceprintCipherFromEnv({ STUDIO_SECRET: secret, VOICEPRINT_KEY: createHash('sha256').update(secret).digest('base64') })).toThrow(reuse);
    expect(voiceprintCipherFromEnv({ STUDIO_SECRET: secret, VOICEPRINT_KEY: KEY_B64 })).not.toBeNull();
  });
});

describe('FileVoiceprintStore', () => {
  it('persists across instances with mode 0600 and deletes by space or all', async () => {
    const path = join(dir(), 'voiceprints-v1.json');
    const a = new FileVoiceprintStore(path);
    expect(await a.get('tg-123', 'work')).toBeNull();
    await a.put(row());
    await a.put(row({ space: 'personal' }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const b = new FileVoiceprintStore(path);
    expect(await b.get('tg-123', 'work')).toMatchObject({ personId: 'tg-123', space: 'work', channel: 'mini_app', createdAt: new Date('2026-10-20T12:00:00.000Z') });
    expect(await b.delete('tg-123', 'personal')).toBe(1);
    expect(await a.get('tg-123', 'personal')).toBeNull();
    await a.put(row({ space: 'personal' }));
    expect(await b.delete('tg-123')).toBe(2);
    expect(await b.delete('tg-123')).toBe(0);
    expect(readFileSync(path, 'utf8')).not.toContain('PLAINTEXT_TEMPLATE_CANARY');
  });
  it('drops invalid rows on read and refuses unsealed templates or extra fields', async () => {
    const path = join(dir(), 'voiceprints-v1.json');
    writeFileSync(path, JSON.stringify({ version: 1, rows: [
      { ...row({ personId: 'tg-1' }), createdAt: '2026-10-20T12:00:00.000Z' },
      { ...row({ personId: 'tg-2' }), createdAt: '2026-10-20T12:00:00.000Z', template: 'raw-template' },
      { ...row({ personId: 'tg-3' }), createdAt: '2026-10-20T12:00:00.000Z', audio: 'AAAA' },
    ], echo: [{ voiceId: 'v', provider: 'fake-vp', modelVersion: 'fake-1', createdAt: 'nope', template: 'vpk1.x' }] }));
    const store = new FileVoiceprintStore(path);
    expect(await store.get('tg-1', 'work')).not.toBeNull();
    expect(await store.get('tg-2', 'work')).toBeNull();
    expect(await store.get('tg-3', 'work')).toBeNull();
    expect(await store.listEcho('fake-vp', 'fake-1')).toEqual([]);
    await expect(store.put(row({ template: 'TPL:reza' }))).rejects.toThrow('Invalid voiceprint row');
    await expect(store.put({ ...row(), audio: new ArrayBuffer(4) } as unknown as VoiceprintRow)).rejects.toThrow('Invalid voiceprint row');
    await expect(new InMemoryVoiceprintStore().put(row({ template: 'plain' }))).rejects.toThrow('Invalid voiceprint row');
  });
  it('keeps echo rows separate, keyed by provider and model version', async () => {
    const store = new FileVoiceprintStore(join(dir(), 'voiceprints-v1.json'));
    const echo = { voiceId: 'voice-a', provider: 'fake-vp', modelVersion: 'fake-1', createdAt: new Date(0), template: cipher.seal(PLAIN, ['echo']) };
    await store.putEcho(echo);
    await store.putEcho({ ...echo, modelVersion: 'fake-2' });
    await store.putEcho(echo);
    expect(await store.listEcho('fake-vp', 'fake-1')).toHaveLength(1);
    expect(await store.listEcho('fake-vp', 'fake-2')).toHaveLength(1);
    expect(await store.get('voice-a', 'work')).toBeNull();
  });
});

describe('FirestoreVoiceprintStore', () => {
  it('separates person and echo kinds with hashed ids, converts Timestamps and deletes without space', async () => {
    const { db, docs } = fakeFirestore();
    const store = new FirestoreVoiceprintStore(db);
    await store.put(row());
    await store.put(row({ space: 'personal', lastConfirmedAt: new Date('2026-10-21T00:00:00.000Z') }));
    await store.putEcho({ voiceId: 'voice-a', provider: 'fake-vp', modelVersion: 'fake-1', createdAt: new Date(0), template: cipher.seal(PLAIN, ['echo']) });
    const ids = [...docs.keys()];
    expect(ids.every(id => id.startsWith('vox_voiceprints/'))).toBe(true);
    expect(ids.filter(id => /\/p_[0-9a-f]{40}$/.test(id))).toHaveLength(2);
    expect(ids.filter(id => /\/e_[0-9a-f]{40}$/.test(id))).toHaveLength(1);
    expect(ids.join(' ')).not.toContain('tg-123');
    expect([...docs.values()].map(d => d.kind).sort()).toEqual(['echo', 'person', 'person']);
    // Firestore returns Timestamps; the store converts them with toDate().
    for (const [id, data] of docs) docs.set(id, { ...data, createdAt: { toDate: () => new Date('2026-10-20T12:00:00.000Z') } });
    expect((await store.get('tg-123', 'work'))?.createdAt).toEqual(new Date('2026-10-20T12:00:00.000Z'));
    expect(await store.listEcho('fake-vp', 'fake-1')).toHaveLength(1);
    expect(await store.listEcho('fake-vp', 'fake-2')).toHaveLength(0);
    expect(await store.delete('tg-123')).toBe(2);
    expect(await store.delete('tg-123', 'work')).toBe(0);
    expect(await store.listEcho('fake-vp', 'fake-1')).toHaveLength(1);
  });
});

describe('voiceprintConfigFromEnv', () => {
  const file = { storage: 'file' as const, production: false };
  it('is null when the flag and key are unset', () => {
    expect(voiceprintConfigFromEnv({}, file)).toBeNull();
    expect(voiceprintConfigFromEnv({ STUDIO_VOICE_RECOGNITION: '0' }, file)).toBeNull();
  });
  it('requires a key with the flag and refuses Firestore production', () => {
    expect(() => voiceprintConfigFromEnv({ STUDIO_VOICE_RECOGNITION: '1' }, file)).toThrow('VOICEPRINT_KEY (base64, 32 bytes) is required with STUDIO_VOICE_RECOGNITION=1');
    expect(() => voiceprintConfigFromEnv({ STUDIO_VOICE_RECOGNITION: '1', VOICEPRINT_KEY: KEY_B64 }, { storage: 'firestore', production: true }))
      .toThrow('Voiceprints on Firebase require Cloud KMS envelope encryption (docs/implementation/VOICE_PROVIDER_INTEGRATION.md)');
  });
  it('wires status/delete-only mode with a key and the flag off', () => {
    const config = voiceprintConfigFromEnv({ VOICEPRINT_KEY: KEY_B64, VOICE_MATCH_THRESHOLDS_JSON: 'not json' }, { storage: 'firestore', production: true });
    expect(config).toMatchObject({ enabled: false, thresholds: null });
    expect(config?.provider).toBeUndefined();
  });
  it('has no provider without PYANNOTE_API_KEY and validates thresholds only with the flag', () => {
    const config = voiceprintConfigFromEnv({ STUDIO_VOICE_RECOGNITION: '1', VOICEPRINT_KEY: KEY_B64,
      VOICE_MATCH_THRESHOLDS_JSON: JSON.stringify({ default: { match: 0.8, uncertain: 0.6, echo: 0.5 } }) }, file);
    expect(config).toMatchObject({ enabled: true, thresholds: { default: { match: 0.8, uncertain: 0.6, echo: 0.5 } } });
    expect(config?.provider).toBeUndefined();
    expect(() => voiceprintConfigFromEnv({ STUDIO_VOICE_RECOGNITION: '1', VOICEPRINT_KEY: KEY_B64, VOICE_MATCH_THRESHOLDS_JSON: '{"default":{}}' }, file))
      .toThrow('VOICE_MATCH_THRESHOLDS_JSON is invalid');
  });
});
