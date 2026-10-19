import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStudio, validateStudioConfig } from '../runtime';

const production = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  STUDIO_SECRET: 'a-test-encryption-secret-with-32-characters',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  VOXX_BOT_TOKEN: '123456789:abcdefghijklmnopqrstuvwxyz0123456789',
  VOXX_BOT_USERNAME: 'VoxxBot',
  STUDIO_SUPERADMIN_IDS: '123, 456',
  STUDIO_WEBAPP_URL: 'https://studio.example.com/studio',
  STUDIO_DATA_DIR: '/srv/vox-data',
});

describe('Studio production initialization', () => {
  const dirs: string[] = [];
  const globalState = globalThis as unknown as { __voxStudio?: unknown };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete globalState.__voxStudio;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const configure = () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-studio-startup-'));
    dirs.push(dir);
    for (const [key, value] of Object.entries({ ...production(), STUDIO_DATA_DIR: dir })) vi.stubEnv(key, value!);
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
});
