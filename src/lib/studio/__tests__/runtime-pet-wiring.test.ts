import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

let dir: string | undefined;
afterEach(() => {
  delete (globalThis as { __voxStudio?: unknown }).__voxStudio;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

it('keeps FILE Pet authority available when instrumentation and routes use different module graphs', async () => {
  dir = mkdtempSync(join(tmpdir(), 'vox-pet-runtime-'));
  const env = {
    NODE_ENV: 'test', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: dir,
    STUDIO_SECRET: 'synthetic-pet-runtime-secret-32-characters',
    ANTHROPIC_API_KEY: 'synthetic', VOXX_BOT_TOKEN: '', VOXX_BOT_USERNAME: '',
    STUDIO_BOTS: '0', STUDIO_PUBLIC_URL: '', STUDIO_ADAPTIVE_FORMAT: '',
    STUDIO_ADAPTIVE_POLICY_JSON: '', STUDIO_CONNECTIONS_CONFIG_FILE: '',
    STUDIO_RELATIONSHIPS: 'off', STUDIO_SCOPED_RELATIONSHIPS: '',
    STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '', STUDIO_REQUESTED_ROUTINES: '',
    STUDIO_EXPERIMENTS_ENABLED: '', STUDIO_IMPROVEMENT_TRUST_JSON: '',
    STUDIO_VOICE_RECOGNITION: '', VOICEPRINT_KEY: '',
    OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '',
    K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const network = vi.fn(() => { throw new Error('Network is forbidden in this fixture'); });
  vi.stubGlobal('fetch', network);
  vi.resetModules();
  const { getStudio } = await import('../runtime');
  const studio = await getStudio();
  // Next instrumentation shares this object with independently bundled route modules.
  vi.resetModules();
  const { petStoreFor } = await import('../pet-store');
  const pets = await petStoreFor(studio);
  expect(pets).toBe(studio.deps.pets);
  expect(await pets.erasureEpoch(123)).toBe('initial');
  expect(pets.erasureEpochNow?.(123)).toBe('initial');
  expect(network).not.toHaveBeenCalled();
});

it('wires the play, growth and check-in stores and the speech seam explicitly, so route bundles never derive them by instanceof', async () => {
  dir = mkdtempSync(join(tmpdir(), 'vox-pet-runtime-'));
  const env = {
    NODE_ENV: 'test', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: dir,
    STUDIO_SECRET: 'synthetic-pet-runtime-secret-32-characters',
    ANTHROPIC_API_KEY: 'synthetic', VOXX_BOT_TOKEN: '', VOXX_BOT_USERNAME: '',
    STUDIO_BOTS: '0', STUDIO_PUBLIC_URL: '', STUDIO_ADAPTIVE_FORMAT: '',
    STUDIO_ADAPTIVE_POLICY_JSON: '', STUDIO_CONNECTIONS_CONFIG_FILE: '',
    STUDIO_RELATIONSHIPS: 'off', STUDIO_SCOPED_RELATIONSHIPS: '',
    STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '', STUDIO_REQUESTED_ROUTINES: '',
    STUDIO_EXPERIMENTS_ENABLED: '', STUDIO_IMPROVEMENT_TRUST_JSON: '',
    STUDIO_VOICE_RECOGNITION: '', VOICEPRINT_KEY: '',
    OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', STUDIO_TTS_PROVIDER: 'gemini', GEMINI_API_KEY: '', GOOGLE_API_KEY: '',
    K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this fixture'); }));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.resetModules();
  const { getStudio } = await import('../runtime');
  const studio = await getStudio();
  vi.resetModules();
  const { petPlayStoreFor } = await import('../pet-play-store');
  expect(await petPlayStoreFor(studio)).toBe(studio.deps.petPlay);
  const { petGrowthStoreFor } = await import('../pet-growth-store');
  expect(await petGrowthStoreFor(studio)).toBe(studio.deps.petGrowth);
  expect(studio.deps.petGrowth).toBeDefined();
  const { petCheckinStoreFor } = await import('../pet-checkins/store');
  expect(studio.deps.petCheckins).toBeDefined();
  expect(await petCheckinStoreFor(studio)).toBe(studio.deps.petCheckins);
  expect(studio.deps.tts).toMatchObject({ provider: 'gemini', canSynthesize: false });
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('STUDIO_TTS_PROVIDER=gemini'));
});
