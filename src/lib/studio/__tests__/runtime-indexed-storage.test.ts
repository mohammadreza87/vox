import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getStudio, validateStudioConfig } from '../runtime';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { openLocalAdaptiveStorage } from '../../adaptive/persistence/runtime-storage';
import { migrateAdaptiveStorage } from '../../adaptive/persistence/indexed/migration';
import { rollbackAdaptiveStorage } from '../../adaptive/persistence/indexed/rollback';
import { managedDirectory } from '../../adaptive/persistence/indexed/managed-storage';
const roots: string[] = [];
const state = globalThis as unknown as { __voxStudio?: unknown; __voxAdaptiveClose?: () => void };
afterEach(() => {
  state.__voxAdaptiveClose?.(); delete state.__voxAdaptiveClose; delete state.__voxStudio;
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const env = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', STUDIO_SECRET: 'synthetic-secret-at-least-32-characters', ANTHROPIC_API_KEY: 'synthetic',
  VOXX_BOT_TOKEN: '123456789:abcdefghijklmnopqrstuvwxyz0123456789', VOXX_BOT_USERNAME: 'VoxxBot', STUDIO_SUPERADMIN_IDS: '123',
  STUDIO_WEBAPP_URL: 'https://synthetic.example/studio', STUDIO_DATA_DIR: '/srv/synthetic', STUDIO_STORAGE: 'file', STUDIO_PUBLIC_URL: '',
  STUDIO_BOTS: '0', STUDIO_RELATIONSHIPS: 'off', STUDIO_SCOPED_RELATIONSHIPS: '', STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '',
  STUDIO_IMPROVEMENT_TRUST_JSON: '', OPENAI_API_KEY: '', K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '' });
async function prepare() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vox-runtime-indexed-'))); roots.push(root);
  const adaptive = join(root, 'adaptive'); mkdirSync(adaptive);
  await new AdaptiveRepository(new FileAdaptiveStorage(adaptive)).transaction(accountIdFor(123), Date.now, () => {});
  return { root, adaptive };
}
it('keeps original FILE default and rejects managed selection in distributed/unknown environments', () => {
  expect(validateStudioConfig(env()).adaptiveFormat).toBe('file');
  for (const overrides of [{ STUDIO_ADAPTIVE_FORMAT: 'guess' }, { STUDIO_ADAPTIVE_FORMAT: 'sqlite-v1', STUDIO_STORAGE: 'firestore' },
    { STUDIO_ADAPTIVE_FORMAT: 'file-v2', VERCEL: '1' }, { STUDIO_ADAPTIVE_FORMAT: 'sqlite-v1', STUDIO_PUBLIC_URL: 'https://synthetic.example' }])
    expect(() => validateStudioConfig({ ...env(), ...overrides })).toThrow();
});
it('never selects or creates an empty managed target and refuses legacy fallback after transition', async () => {
  const f = await prepare();
  expect(() => openLocalAdaptiveStorage(f.adaptive, 'sqlite-v1')).toThrow();
  expect(existsSync(managedDirectory(f.adaptive))).toBe(false);
  await migrateAdaptiveStorage(f.adaptive, { quiesced: true });
  expect(() => openLocalAdaptiveStorage(f.adaptive, 'file')).toThrow('explicit current format');
  expect(() => openLocalAdaptiveStorage(f.adaptive, 'file-v2')).toThrow();
  const indexed = openLocalAdaptiveStorage(f.adaptive, 'sqlite-v1'); expect(indexed.storage.indexed).toBeDefined(); indexed.close();
  await rollbackAdaptiveStorage(f.adaptive, { quiesced: true });
  const file = openLocalAdaptiveStorage(f.adaptive, 'file-v2'); expect(file.storage.identity).toBeDefined(); expect(file.storage.indexed).toBeUndefined(); file.close();
});
it('closes managed leases after failed production initialization and retries the same current store', async () => {
  const f = await prepare(); const migrated = await migrateAdaptiveStorage(f.adaptive, { quiesced: true });
  for (const [key, value] of Object.entries({ ...env(), STUDIO_DATA_DIR: f.root, STUDIO_ADAPTIVE_FORMAT: 'sqlite-v1' })) vi.stubEnv(key, value);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: false, description: 'Unauthorized' }))
    .mockResolvedValueOnce(Response.json({ ok: true, result: { id: 1, is_bot: true, username: 'VoxxBot', first_name: 'Synthetic' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(getStudio()).rejects.toThrow('VOXX_BOT_TOKEN authentication failed');
  expect(existsSync(`${f.adaptive}.managed.lock`)).toBe(false);
  const studio = await getStudio();
  expect(studio.deps.adaptive!.repository.storage.indexed!.identity).toEqual(migrated.identity);
  expect(studio.deps.maintenance).toBeUndefined(); expect(studio.deps.relationships!.deps.mode).toBe('off');
  expect(fetch).toHaveBeenCalledTimes(2);
});
