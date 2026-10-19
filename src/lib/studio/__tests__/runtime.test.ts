import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStudio, validateStudioConfig } from '../runtime';
import { FirestoreStudioStore } from '../firestore-store';

const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn(), getStorage: vi.fn(), bucket: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));
vi.mock('firebase-admin/storage', () => ({ getStorage: firebase.getStorage }));

const production = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  STUDIO_SECRET: 'a-test-encryption-secret-with-32-characters',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  VOXX_BOT_TOKEN: '123456789:abcdefghijklmnopqrstuvwxyz0123456789',
  VOXX_BOT_USERNAME: 'VoxxBot',
  STUDIO_SUPERADMIN_IDS: '123, 456',
  STUDIO_WEBAPP_URL: 'https://studio.example.com/studio',
  STUDIO_DATA_DIR: '/srv/vox-data',
  STUDIO_STORAGE: 'file',
  STUDIO_PUBLIC_URL: '',
  STUDIO_BOTS: '0',
  // Runtime wiring fixtures must not inherit a deployment's live pilot.
  STUDIO_RELATIONSHIPS: 'off',
  STUDIO_RELATIONSHIP_AGENTS: '',
  STUDIO_RELATIONSHIP_PEOPLE: '',
  STUDIO_RELATIONSHIP_ROLES: '',
  STUDIO_RELATIONSHIP_WORKER_SECRET: '',
  OPENAI_API_KEY: '',
  K_SERVICE: '',
  FUNCTION_TARGET: '',
  FUNCTION_NAME: '',
  VERCEL: '',
});

const cloudProduction = (): NodeJS.ProcessEnv => ({
  ...production(), STUDIO_STORAGE: 'firestore', STUDIO_DATA_DIR: undefined,
  STUDIO_PUBLIC_URL: 'https://studio.example.com', STUDIO_MEDIA_BUCKET: 'vox-studio.firebasestorage.app',
});

describe('Studio production initialization', () => {
  const dirs: string[] = [];
  const globalState = globalThis as unknown as { __voxStudio?: unknown };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete globalState.__voxStudio;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const configure = (overrides: NodeJS.ProcessEnv = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-studio-startup-'));
    dirs.push(dir);
    for (const [key, value] of Object.entries({ ...production(), STUDIO_DATA_DIR: dir, ...overrides })) vi.stubEnv(key, value);
    return dir;
  };

  it('rejects invalid manager credentials, then retries after the provider recovers', async () => {
    const dir = configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, description: 'Unauthorized' }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getStudio()).rejects.toThrow('VOXX_BOT_TOKEN authentication failed');
    const studio = await getStudio();
    expect(studio.deps.managerUsername).toBe('VoxxBot');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'))).toMatchObject({ members: [], agents: [] });
  });

  it('rejects a manager username that belongs to a different bot', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'OtherBot', first_name: 'Other' } })));
    await expect(getStudio()).rejects.toThrow('VOXX_BOT_USERNAME does not match');
  });

  it('wires persistent Firestore stores and webhooks without writing local state', async () => {
    const dir = configure(cloudProduction());
    vi.stubEnv('STUDIO_DATA_DIR', join(dir, 'unused-local'));
    const get = vi.fn().mockResolvedValue({ get: () => undefined });
    firebase.getAdminDb.mockResolvedValue({ doc: () => ({ get }) });
    firebase.getAdminApp.mockResolvedValue({});
    firebase.getStorage.mockReturnValue({ bucket: firebase.bucket });
    firebase.bucket.mockReturnValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(studio.deps.store).toBeInstanceOf(FirestoreStudioStore);
    expect(typeof studio.deps.rateLimiter?.consume).toBe('function');
    expect(studio.deps.webhookBase).toBe('https://studio.example.com');
    expect(firebase.bucket).toHaveBeenCalledWith('vox-studio.firebasestorage.app');
    expect(get).toHaveBeenCalledOnce();
    expect(existsSync(join(dir, 'unused-local'))).toBe(false);
  });

  it('fails startup when the configured Firestore state cannot be read', async () => {
    configure(cloudProduction());
    firebase.getAdminDb.mockResolvedValue({ doc: () => ({ get: async () => { throw new Error('Firestore unavailable'); } }) });
    firebase.getAdminApp.mockResolvedValue({});
    firebase.getStorage.mockReturnValue({ bucket: firebase.bucket });
    firebase.bucket.mockReturnValue({});
    await expect(getStudio()).rejects.toThrow('Firestore unavailable');
  });
});

describe('Studio production configuration', () => {
  it('accepts a complete deployment and parses bootstrap members without IO', () => {
    expect(validateStudioConfig(production(), '/srv/vox')).toMatchObject({
      production: true, superadminIds: [123, 456], dataDir: '/srv/vox-data',
      webAppUrl: 'https://studio.example.com/studio',
    });
  });

  it.each(['', 'short', ' '.repeat(40)])('requires an encryption secret with at least 32 characters', (secret) => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_SECRET: secret })).toThrow('STUDIO_SECRET');
  });

  it('requires the persona provider', () => {
    expect(() => validateStudioConfig({ ...production(), ANTHROPIC_API_KEY: '' })).toThrow('ANTHROPIC_API_KEY');
  });

  it.each(['', 'placeholder', '123:short', 'abc:abcdefghijklmnopqrstuvwxyz'])('rejects a missing or malformed manager token', (token) => {
    expect(() => validateStudioConfig({ ...production(), VOXX_BOT_TOKEN: token })).toThrow('VOXX_BOT_TOKEN');
  });

  it.each(['', '0', '-42', '123abc', '5.5', '1,broken,2', '9007199254740992'])('rejects unusable bootstrap IDs: %s', (ids) => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_SUPERADMIN_IDS: ids })).toThrow('STUDIO_SUPERADMIN_IDS');
  });

  it.each(['', 'http://studio.example.com/studio', 'https://studio.example.com/', 'https://studio.example.com/studio-other',
    'https://name:password@studio.example.com/studio', 'https://studio.example.com/studio?secret=x', 'https://studio.example.com/studio#x'])
  ('rejects an insecure or incorrect Mini App URL: %s', (url) => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_WEBAPP_URL: url })).toThrow('STUDIO_WEBAPP_URL');
  });

  it.each(['', './.vox-studio', '/', '/srv/vox', '/srv/vox/public', '/srv/vox/public/state', '/srv/vox/.next/state', '/srv/vox/data/../public/state'])
  ('rejects implicit, relative, or public storage: %s', (dir) => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_DATA_DIR: dir }, '/srv/vox')).toThrow('STUDIO_DATA_DIR');
  });

  it('preserves local development without a manager, public URL, or explicit storage', () => {
    const config = validateStudioConfig({ NODE_ENV: 'development', STUDIO_SECRET: production().STUDIO_SECRET, ANTHROPIC_API_KEY: 'test' }, '/local/vox');
    expect(config).toMatchObject({ production: false, dataDir: '/local/vox/.vox-studio', superadminIds: [] });
  });

  it('accepts production Firestore without a local data directory and normalizes its webhook origin', () => {
    expect(validateStudioConfig({ ...cloudProduction(), STUDIO_PUBLIC_URL: 'https://studio.example.com/' })).toMatchObject({
      storage: 'firestore', publicUrl: 'https://studio.example.com', mediaBucket: 'vox-studio.firebasestorage.app',
    });
  });

  it('uses the Firebase storage bucket when the explicit Studio bucket is omitted', () => {
    expect(validateStudioConfig({ ...cloudProduction(), STUDIO_MEDIA_BUCKET: '', NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'firebase-bucket.test' }).mediaBucket).toBe('firebase-bucket.test');
  });

  it.each(['', 'http://studio.example.com', 'https://studio.example.com/studio', 'https://user:password@studio.example.com',
    'https://studio.example.com?secret=x', 'https://studio.example.com#fragment'])('rejects invalid production webhook bases: %s', (url) => {
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_PUBLIC_URL: url })).toThrow('STUDIO_PUBLIC_URL');
  });

  it.each(['', 'gs://bucket.test', 'https://bucket.test', 'bucket/path', 'bucket with spaces'])('rejects invalid media buckets: %s', (bucket) => {
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_MEDIA_BUCKET: bucket })).toThrow('STUDIO_MEDIA_BUCKET');
  });

  it('prevents webhook and long-polling transports from competing', () => {
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_BOTS: '1' })).toThrow('STUDIO_BOTS=1');
    expect(() => validateStudioConfig({ ...production(), STUDIO_PUBLIC_URL: 'https://studio.example.com', STUDIO_BOTS: '1' })).toThrow('STUDIO_BOTS=1');
  });

  it('requires webhook transport for production Firestore storage', () => {
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_PUBLIC_URL: '', STUDIO_BOTS: '1' })).toThrow('STUDIO_BOTS=1');
  });

  it.each(['K_SERVICE', 'FUNCTION_TARGET', 'FUNCTION_NAME', 'VERCEL'])('rejects ephemeral file storage in a detected serverless runtime: %s', (key) => {
    expect(() => validateStudioConfig({ ...production(), [key]: key === 'VERCEL' ? '1' : 'vox-service' })).toThrow('STUDIO_STORAGE=firestore');
  });

  it('requires persistent shared storage when a production webhook base is set', () => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_PUBLIC_URL: 'https://studio.example.com' })).toThrow('STUDIO_STORAGE=firestore');
  });

  it('rejects unknown storage modes instead of silently falling back to local disk', () => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_STORAGE: 'firestor' })).toThrow('STUDIO_STORAGE');
  });
});
