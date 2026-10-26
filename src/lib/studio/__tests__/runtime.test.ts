import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPublicKey } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStudio, validateStudioConfig } from '../runtime';
import { FirestoreStudioStore } from '../firestore-store';
import { FilePetStore, petStoreFor } from '../pet-store';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { CHECKPOINT } from '../../adaptive/lifecycle/maintenance';
import { FileExperimentStorage } from '../../adaptive/experiments/storage';

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
  STUDIO_MAINTENANCE: '',
  STUDIO_REMINDER_DELIVERY: '',
  STUDIO_EXPERIMENTS_ENABLED: '',
  STUDIO_IMPROVEMENT_TRUST_JSON: '',
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

// Public-only synthetic key material. No signers or private keys exist in this fixture.
const publicTrust = () => Object.fromEntries(['analyst', 'author', 'evaluator', 'human'].map((role, n) => [role, { role,
  publicKey: createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.alloc(32, n + 1)]), format: 'der', type: 'spki' })
    .export({ type: 'spki', format: 'pem' }).toString(),
}]));

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

  it('retains the reviewed-export fence when web search is disabled', async () => {
    configure({ STUDIO_WEB_SEARCH: 'off' });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } }));
    vi.stubGlobal('fetch', fetchMock);
    const studio = await getStudio();
    expect(studio.deps.chatLLM.completeWithWeb).toBeUndefined();
    expect(studio.deps.chatLLM.committedExportFence).toBe(true);
    fetchMock.mockClear();
    await expect(studio.deps.chatLLM.complete({ system: 'Synthetic reviewed notes only.', messages: [{ role: 'user', content: 'Synthetic note.' }],
      authorizeNow: () => false })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

  it('keeps relationship providers and workers disabled under adaptive scope even when legacy allowlists are configured', async () => {
    // STUDIO_DECIDER is pinned unset: with an OPENAI_API_KEY an ambient STUDIO_DECIDER=service would build the
    // Decisions provider (the OpenAI SDK refuses jsdom), which this relationships case is not about (F051).
    configure({ STUDIO_RELATIONSHIPS: 'live', STUDIO_RELATIONSHIP_AGENTS: 'synthetic-agent',
      STUDIO_RELATIONSHIP_PEOPLE: '300', OPENAI_API_KEY: 'synthetic-test-key', STUDIO_DECIDER: '' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(studio.deps.adaptive).toBeDefined();
    expect(studio.deps.relationships?.mode).toBe('off');
  });

  it('wires the pet store beside studio.json instead of deriving it from the store class', async () => {
    const dir = configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(studio.deps.pets).toBeInstanceOf(FilePetStore);
    expect((studio.deps.pets as FilePetStore).dir).toBe(join(dir, 'pets'));
    // A route bundle sees the instrumentation-built Studio through globalThis with its own copy of
    // StudioStore, so an instanceof derivation fails there; the wired store must win.
    Object.setPrototypeOf(studio.deps.store, Object.prototype);
    await expect(petStoreFor(studio)).resolves.toBe(studio.deps.pets);
  });

  it('rejects a manager username that belongs to a different bot', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'OtherBot', first_name: 'Other' } })));
    await expect(getStudio()).rejects.toThrow('VOXX_BOT_USERNAME does not match');
  });

  it('provides scoped rights and observer services while maintenance stays off by default', async () => {
    const dir = configure();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(studio.deps.lifecycle).toBeDefined(); expect(studio.deps.observer).toBeDefined();
    expect(studio.deps.maintenance).toBeUndefined();
    expect(studio.deps.maintenanceHealth!()).toMatchObject({ state: 'not_started' });
    expect(existsSync(join(dir, 'adaptive-maintenance'))).toBe(false);
    expect(studio.deps.improvement).toBeUndefined();
    expect(studio.deps.experiments).toBeUndefined();
  });

  it('observes retained checkpoint failure while execution is disabled without constructing a runner', async () => {
    const dir = configure();
    const storage = new FileAdaptiveStorage(join(dir, 'adaptive-maintenance'));
    await storage.transact(CHECKPOINT, () => ({ document: { schemaVersion: 1, status: 'failed', failure: 'sweep_failed', pages: 2, accounts: 4, updatedAt: Date.now() - 100 }, result: undefined }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(studio.deps.maintenance).toBeUndefined();
    expect(studio.deps.maintenanceHealth!()).toMatchObject({ state: 'failed', checkpoint: { checkpointedPages: 2, checkpointedAccounts: 4, failure: 'sweep_failed' } });
  });

  it('retains experiment lifecycle services after the presentation switch is disabled', async () => {
    const dir = configure();
    new FileExperimentStorage(join(dir, 'controlled-experiments', 'v1')).transaction(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(studio.deps.experiments).toBeDefined();
    expect(await studio.deps.experiments!.prepare(123, 'synthetic', 'work', 'synthetic-turn')).toBeUndefined();
    expect(studio.deps.experiments!.exportScope(123, 'work').derived).toEqual([]);
  });

  it.each(['file', 'firestore'])('rejects enabled maintenance before storage/provider IO without a scheduler: %s', storage => {
    const dir = configure({ ...(storage === 'firestore' ? cloudProduction() : {}), STUDIO_MAINTENANCE: '1' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    return expect(getStudio()).rejects.toThrow('STUDIO_MAINTENANCE=1 requires STUDIO_BOTS=1').then(() => {
      expect(fetchMock).not.toHaveBeenCalled();
      expect(firebase.getAdminDb).not.toHaveBeenCalled();
      expect(existsSync(join(dir, 'studio.json'))).toBe(false);
    });
  });

  it('rejects enabled reminder delivery without the persistent maintenance worker before provider IO', async () => {
    const dir = configure({ STUDIO_REMINDER_DELIVERY: '1' });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(getStudio()).rejects.toThrow('STUDIO_REMINDER_DELIVERY=1 requires STUDIO_MAINTENANCE=1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'studio.json'))).toBe(false);
  });

  it('wires maintenance into a separate durable file namespace only under its explicit switch', async () => {
    const dir = configure({ STUDIO_MAINTENANCE: '1', STUDIO_BOTS: '1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    const runner = studio.deps.maintenance!;
    expect(runner).toBeDefined();
    expect(runner.accounts).not.toBe(runner.checkpoints);
    expect((runner.checkpoints as { directory?: string }).directory).toBe(join(dir, 'adaptive-maintenance'));
    expect((runner.accounts as { directory?: string }).directory).toBe(join(dir, 'adaptive'));
    expect(await runner.runPage({ workerId: 'synthetic-check', limit: 1 })).toMatchObject({ state: 'completed', scanned: 0 });
    expect(existsSync(join(dir, 'adaptive-maintenance'))).toBe(true);
  });

  it('exposes only an empty read-only local improvement report when public trust is configured', async () => {
    const dir = configure({ STUDIO_IMPROVEMENT_TRUST_JSON: JSON.stringify(publicTrust()) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Voxx' } })));
    const studio = await getStudio();
    expect(Object.keys(studio.deps.improvement!)).toEqual(['report']);
    expect(await studio.deps.improvement!.report()).toMatchObject({ candidates: [], auditEvents: 0, productionMutation: false });
    expect(existsSync(join(dir, 'improvement-review'))).toBe(false);
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
  it('requires an explicit experiment switch and prepared local storage', () => {
    expect(validateStudioConfig(production()).experimentsEnabled).toBe(false);
    expect(() => validateStudioConfig({ ...production(), STUDIO_EXPERIMENTS_ENABLED: 'true' })).toThrow('must be 0 or 1');
    expect(() => validateStudioConfig({ ...production(), STUDIO_EXPERIMENTS_ENABLED: '1' })).toThrow('requires prepared local adaptive storage');
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_EXPERIMENTS_ENABLED: '1' })).toThrow('requires prepared local adaptive storage');
    for (const format of ['sqlite-v1', 'file-v2']) {
      expect(validateStudioConfig({ ...production(), STUDIO_ADAPTIVE_FORMAT: format, STUDIO_EXPERIMENTS_ENABLED: '1' }).experimentsEnabled).toBe(true);
    }
  });
  it.each(['broken-json', '{}', 'null', '[]', JSON.stringify({ analyst: { role: 'analyst', publicKey: 'PRIVATE KEY CANARY' } })])
  ('fails closed for malformed or incomplete improvement trust', raw => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_IMPROVEMENT_TRUST_JSON: raw })).toThrow('STUDIO_IMPROVEMENT_TRUST_JSON is invalid');
  });
  it('rejects reused authority keys and private/extra fields in runtime trust', () => {
    const trust = publicTrust();
    expect(() => validateStudioConfig({ ...production(), STUDIO_IMPROVEMENT_TRUST_JSON: JSON.stringify({ ...trust, human: { ...trust.human, publicKey: trust.author.publicKey } }) })).toThrow('STUDIO_IMPROVEMENT_TRUST_JSON is invalid');
    expect(() => validateStudioConfig({ ...production(), STUDIO_IMPROVEMENT_TRUST_JSON: JSON.stringify({ ...trust, human: { ...trust.human, privateKey: 'FORBIDDEN' } }) })).toThrow('STUDIO_IMPROVEMENT_TRUST_JSON is invalid');
  });
  it('requires file storage for the local improvement report and keeps missing trust disabled', () => {
    expect(validateStudioConfig(production()).trustedImprovementKeys).toBeUndefined();
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_IMPROVEMENT_TRUST_JSON: JSON.stringify(publicTrust()) })).toThrow('distributed workflow support is unavailable');
  });
  it.each([undefined, '', '0', 'true', 'on'])('leaves maintenance off for %s', value => {
    expect(validateStudioConfig({ ...production(), STUDIO_MAINTENANCE: value }).maintenanceEnabled).toBe(false);
  });
  it('requires an exact independent maintenance opt-in', () => {
    expect(validateStudioConfig({ ...production(), STUDIO_MAINTENANCE: '1', STUDIO_BOTS: '1' }).maintenanceEnabled).toBe(true);
  });
  it.each([undefined, '', '0', 'true'])('rejects maintenance without its polling scheduler: %s', bots => {
    expect(() => validateStudioConfig({ ...production(), STUDIO_MAINTENANCE: '1', STUDIO_BOTS: bots })).toThrow('STUDIO_MAINTENANCE=1 requires STUDIO_BOTS=1');
  });
  it('rejects maintenance on an otherwise valid Firestore webhook deployment', () => {
    expect(validateStudioConfig(cloudProduction()).storage).toBe('firestore');
    expect(() => validateStudioConfig({ ...cloudProduction(), STUDIO_MAINTENANCE: '1' })).toThrow('webhook and serverless maintenance are unsupported');
  });
  it.each(['K_SERVICE', 'FUNCTION_TARGET', 'FUNCTION_NAME', 'VERCEL'])('rejects maintenance in a development serverless process: %s', key => {
    expect(() => validateStudioConfig({ ...production(), NODE_ENV: 'development', STUDIO_BOTS: '1', STUDIO_MAINTENANCE: '1', [key]: key === 'VERCEL' ? '1' : 'service' })).toThrow('webhook and serverless maintenance are unsupported');
  });
  it('rejects maintenance on development Firestore even without webhooks', () => {
    expect(() => validateStudioConfig({ ...cloudProduction(), NODE_ENV: 'development', STUDIO_PUBLIC_URL: '', STUDIO_BOTS: '1', STUDIO_MAINTENANCE: '1' })).toThrow('webhook and serverless maintenance are unsupported');
  });
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
