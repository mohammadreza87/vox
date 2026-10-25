import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { AdaptiveService } from '../../adaptive/persistence/service';
import { createStudioVoiceprints } from '../identity';
import { parseVoiceprintKey, VoiceprintCipher, type VoiceprintAad } from '../identity/crypto';
import { FileVoiceprintStore, FirestoreVoiceprintStore, voiceprintDocId, type VoiceprintRow } from '../identity/store';
import { AUDIO_CANARY, AUDIO_CANARY_TEXT, setupVoiceprints, TEMPLATE_CANARY, TEST_KEY } from './voiceprint-fixtures';

const forms = (text: string) => {
  const bytes = Buffer.from(text, 'utf8');
  return [text, bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('hex')];
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('no audio, transcript or score is persisted or logged', () => {
  it('the voiceprints file never contains the audio or template canary, and logs carry no content', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level));
    const s = await setupVoiceprints({ store: 'file' });
    await s.enroll();
    s.provider.scores.set('owner', 0.8123);
    await s.service.verifyVoiceNote(s.voiceNote());
    s.provider.mode = 'throw';
    await s.service.verifyVoiceNote(s.voiceNote());
    const files = readdirSync(join(s.directory, 'voiceprints'));
    expect(files).toEqual(['voiceprints-v1.json']);
    const raw = readFileSync(s.storePath, 'utf8');
    for (const canary of [...forms(TEMPLATE_CANARY), ...forms(AUDIO_CANARY_TEXT), Buffer.from(AUDIO_CANARY).toString('base64')]) {
      expect(raw).not.toContain(canary);
    }
    expect(raw).not.toContain('0.8123');
    const logged = JSON.stringify([...s.logger.warn.mock.calls, ...s.logger.info.mock.calls, ...s.logger.error.mock.calls, ...consoleSpies.flatMap(spy => spy.mock.calls)]);
    for (const needle of [TEMPLATE_CANARY, AUDIO_CANARY_TEXT, s.personId, String(s.telegramId), '0.8123', 'MATCH']) expect(logged).not.toContain(needle);
    expect(s.logger.warn.mock.calls).toEqual([['voiceprint_provider_error']]);
  });

  it('the row schema rejects an extra audio key on write and drops it on read', async () => {
    const s = await setupVoiceprints({ store: 'file' });
    await s.enroll();
    const row = (await s.store.get(s.personId, 'work'))!;
    await expect(s.store.put({ ...row, audio: 'AAAA' } as unknown as VoiceprintRow)).rejects.toThrow('invalid_voiceprint_row');
    const doc = JSON.parse(readFileSync(s.storePath, 'utf8')) as { version: number; rows: Record<string, unknown>[] };
    doc.rows[0].sample = 'AAAA';
    writeFileSync(s.storePath, JSON.stringify(doc));
    expect(await s.store.get(s.personId, 'work')).toBeNull();
    expect(await s.store.list()).toEqual([]);
  });

  it('the file is written with mode 0600 inside a 0700 directory', async () => {
    const s = await setupVoiceprints({ store: 'file' });
    await s.enroll();
    expect(statSync(s.storePath).mode & 0o777).toBe(0o600);
    const store = new FileVoiceprintStore(join(s.directory, 'fresh', 'voiceprints-v1.json'));
    void store;
    expect(statSync(join(s.directory, 'fresh')).mode & 0o777).toBe(0o700);
  });
});

describe('VoiceprintCipher and VOICEPRINT_KEY', () => {
  const aad: VoiceprintAad = { personId: 'tg-1', space: 'work', provider: 'p', modelVersion: 'm', consentEventId: 'e1' };
  const template = new TextEncoder().encode(TEMPLATE_CANARY);

  it('round-trips and fails on any AAD field or a different key', () => {
    const cipher = new VoiceprintCipher(TEST_KEY);
    const sealed = cipher.seal(template, aad);
    expect(sealed.split('.')).toHaveLength(5);
    expect(sealed.startsWith(`vp1.${cipher.keyId}.`)).toBe(true);
    expect(sealed).not.toContain(Buffer.from(TEMPLATE_CANARY).toString('base64'));
    expect(new TextDecoder().decode(cipher.open(sealed, aad))).toBe(TEMPLATE_CANARY);
    for (const change of [{ personId: 'tg-2' }, { space: 'personal' as const }, { consentEventId: 'e2' }, { provider: 'q' }, { modelVersion: 'n' }]) {
      expect(() => cipher.open(sealed, { ...aad, ...change })).toThrow();
    }
    expect(() => new VoiceprintCipher(new Uint8Array(32).fill(1)).open(sealed, aad)).toThrow();
    expect(() => cipher.open(sealed.replace(/^vp1/, 'vp2'), aad)).toThrow();
    expect(() => cipher.seal(new Uint8Array(0), aad)).toThrow();
    expect(() => cipher.seal(new Uint8Array(65_537), aad)).toThrow();
  });

  it('parseVoiceprintKey requires 32 bytes and refuses STUDIO_SECRET reuse', () => {
    const secret = 'a-studio-secret-that-is-32-chars!';
    expect(parseVoiceprintKey(undefined)).toBeNull();
    expect(parseVoiceprintKey('  ')).toBeNull();
    expect(parseVoiceprintKey(Buffer.from(TEST_KEY).toString('base64'), secret)?.byteLength).toBe(32);
    expect(() => parseVoiceprintKey(Buffer.alloc(31, 1).toString('base64'))).toThrow('VOICEPRINT_KEY must be base64 of 32 bytes');
    expect(() => parseVoiceprintKey(Buffer.alloc(33, 1).toString('base64'))).toThrow('VOICEPRINT_KEY must be base64 of 32 bytes');
    expect(() => parseVoiceprintKey(secret, secret)).toThrow('VOICEPRINT_KEY must not reuse STUDIO_SECRET');
    expect(() => parseVoiceprintKey(createHash('sha256').update(secret).digest('base64'), secret)).toThrow('VOICEPRINT_KEY must not reuse STUDIO_SECRET');
    const secret32 = 'exactly-thirty-two-characters-!!';
    expect(Buffer.from(secret32).byteLength).toBe(32);
    expect(() => parseVoiceprintKey(Buffer.from(secret32).toString('base64'), secret32)).toThrow('VOICEPRINT_KEY must not reuse STUDIO_SECRET');
  });
});

function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  const ref = (collection: string, id: string) => ({
    get: vi.fn(async () => { const data = docs.get(`${collection}/${id}`); return { exists: !!data, data: () => (data ? { ...data } : undefined) }; }),
    set: vi.fn(async (data: Record<string, unknown>) => {
      for (const [field, value] of Object.entries(data)) if (value === undefined) throw new Error(`undefined field ${field}`);
      docs.set(`${collection}/${id}`, { ...data });
    }),
    delete: vi.fn(async () => { docs.delete(`${collection}/${id}`); }),
  });
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ref(name, id),
      get: vi.fn(async () => ({ docs: [...docs.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([, data]) => ({ data: () => ({ ...data }) })) })),
    }),
  };
  return { db: db as unknown as Firestore, docs };
}

describe('FirestoreVoiceprintStore', () => {
  it('uses voiceprintDocId, writes only the contract fields and deletes both spaces', async () => {
    const { db, docs } = fakeFirestore();
    const store = new FirestoreVoiceprintStore(db);
    const cipher = new VoiceprintCipher(TEST_KEY);
    const base = { personId: 'tg-7', provider: 'p', modelVersion: 'm', channel: 'mini_app' as const, consentEventId: 'e', createdAt: new Date('2026-10-20T00:00:00Z') };
    for (const space of ['work', 'personal'] as const) {
      await store.put({ ...base, space, template: cipher.seal(new TextEncoder().encode(TEMPLATE_CANARY), { ...base, space }) });
    }
    expect([...docs.keys()].sort()).toEqual([`vox_voiceprints/${voiceprintDocId('tg-7', 'personal')}`, `vox_voiceprints/${voiceprintDocId('tg-7', 'work')}`].sort());
    expect(voiceprintDocId('tg-7', 'work')).toMatch(/^[0-9a-f]{40}$/);
    for (const data of docs.values()) {
      expect(Object.keys(data).sort()).toEqual(['channel', 'consentEventId', 'createdAt', 'modelVersion', 'personId', 'provider', 'space', 'template']);
      expect(JSON.stringify(data)).not.toContain(TEMPLATE_CANARY);
    }
    // Firestore returns Timestamps; the store converts them back to Dates.
    const key = `vox_voiceprints/${voiceprintDocId('tg-7', 'work')}`;
    docs.set(key, { ...docs.get(key), createdAt: { toDate: () => new Date('2026-10-20T00:00:00Z') } });
    expect((await store.get('tg-7', 'work'))?.createdAt).toEqual(new Date('2026-10-20T00:00:00Z'));
    await store.touch('tg-7', 'work', new Date('2026-10-21T00:00:00Z'));
    expect((await store.get('tg-7', 'work'))?.lastConfirmedAt).toEqual(new Date('2026-10-21T00:00:00Z'));
    expect(await store.list()).toHaveLength(2);
    expect(await store.delete('tg-7')).toBe(2);
    expect(docs.size).toBe(0);
    expect(await store.delete('tg-7', 'work')).toBe(0);
  });
});

describe('createStudioVoiceprints', () => {
  const adaptive = {} as AdaptiveService;
  const readState = async () => ({ members: [{ telegramId: 5, name: 'x', role: 'member', joinedAt: '' }], agents: [] }) as never;

  it('returns null without VOICEPRINT_KEY (base behaviour) and refuses STUDIO_SECRET reuse', async () => {
    const s = await setupVoiceprints();
    expect(await createStudioVoiceprints({ env: {}, storage: 'file', dataDir: s.directory, orgKey: 'HOOR', adaptive, readState, eleven: null })).toBeNull();
    const secret = 'exactly-thirty-two-characters-!!';
    await expect(createStudioVoiceprints({ env: { VOICEPRINT_KEY: Buffer.from(secret).toString('base64'), STUDIO_SECRET: secret }, storage: 'file',
      dataDir: s.directory, orgKey: 'HOOR', adaptive, readState, eleven: null })).rejects.toThrow('VOICEPRINT_KEY must not reuse STUDIO_SECRET');
  });

  it('with a key but no provider key, status/delete work and enrollment is provider_unavailable; invalid thresholds warn once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is not allowed in tests'); }));
    const s = await setupVoiceprints();
    const logger = { warn: vi.fn() };
    const service = await createStudioVoiceprints({ env: { VOICEPRINT_KEY: Buffer.from(TEST_KEY).toString('base64'), VOICE_MATCH_THRESHOLDS_JSON: '{bad' },
      storage: 'file', dataDir: join(s.directory, 'studio'), orgKey: 'HOOR', adaptive: s.adaptive, readState, eleven: null, logger });
    expect(service).not.toBeNull();
    expect(logger.warn.mock.calls).toEqual([['voiceprint_thresholds_invalid']]);
    await expect(service!.enroll({ telegramId: s.telegramId, audio: AUDIO_CANARY, mimeType: 'audio/webm', space: 'work', channel: 'mini_app' }))
      .rejects.toMatchObject({ status: 503, code: 'provider_unavailable' });
    expect(await service!.status(s.telegramId, 'work')).toMatchObject({ enrolled: false, available: false, reason: 'provider_unavailable' });
    const pilot = await createStudioVoiceprints({ env: { VOICEPRINT_KEY: Buffer.from(TEST_KEY).toString('base64'), PYANNOTE_API_KEY: 'fake-test-key',
      STUDIO_ADAPTIVE_POLICY_JSON: JSON.stringify({ schemaVersion: 2 }) }, storage: 'file', dataDir: join(s.directory, 'pilot'), orgKey: 'HOOR', adaptive: s.adaptive, readState, eleven: null });
    expect(await pilot!.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a constant-off flag reader (runtime.ts, local voice engine selected) keeps voiceprints off with STUDIO_VOICE_RECOGNITION=1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is not allowed in tests'); }));
    const s = await setupVoiceprints();
    expect(process.env.STUDIO_VOICE_RECOGNITION).toBe('1');
    const service = await createStudioVoiceprints({ env: { VOICEPRINT_KEY: Buffer.from(TEST_KEY).toString('base64'), PYANNOTE_API_KEY: 'fake-test-key', STUDIO_VOICE_RECOGNITION: '0' },
      flags: () => ({ voiceRecognition: false }), storage: 'file', dataDir: join(s.directory, 'masked'), orgKey: 'HOOR', adaptive: s.adaptive, readState, eleven: null });
    await expect(service!.enroll({ telegramId: s.telegramId, audio: AUDIO_CANARY, mimeType: 'audio/webm', space: 'work', channel: 'mini_app' }))
      .rejects.toMatchObject({ status: 404, code: 'disabled' });
    expect(await service!.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
    expect(await service!.status(s.telegramId, 'work')).toMatchObject({ available: false, reason: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses Firestore in production with STUDIO_VOICE_RECOGNITION=1 until Cloud KMS exists; a constant-off flag reader still starts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is not allowed in tests'); }));
    const s = await setupVoiceprints();
    expect(process.env.STUDIO_VOICE_RECOGNITION).toBe('1');
    const getAdminDb = vi.fn(async () => ({ collection: () => ({}) }) as unknown as Firestore);
    vi.doMock('@/lib/firebase-admin', () => ({ getAdminDb }));
    try {
      const base = { env: { VOICEPRINT_KEY: Buffer.from(TEST_KEY).toString('base64'), STUDIO_VOICE_RECOGNITION: '1' }, storage: 'firestore' as const, production: true,
        dataDir: s.directory, orgKey: 'HOOR', adaptive: s.adaptive, readState, eleven: null };
      await expect(createStudioVoiceprints(base))
        .rejects.toThrow('Voiceprints on Firebase require Cloud KMS envelope encryption (docs/implementation/VOICE_PROVIDER_INTEGRATION.md)');
      expect(getAdminDb).not.toHaveBeenCalled();
      expect(await createStudioVoiceprints({ ...base, flags: () => ({ voiceRecognition: false }) })).not.toBeNull();
      expect(await createStudioVoiceprints({ ...base, production: false })).not.toBeNull();
    } finally {
      vi.doUnmock('@/lib/firebase-admin');
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
