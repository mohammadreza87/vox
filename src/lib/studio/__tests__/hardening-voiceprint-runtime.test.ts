/**
 * H5 (F178, VF-S11L-low-allSettled): runtime.ts's S11L block chains the invalidators with allSettled, starts the
 * daily sweep at boot and logs content-free codes instead of discarding failures. Flags unset; file storage; no
 * network. With VOICEPRINT_KEY unset nothing is wired (base behaviour).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Studio } from '../service';

let dir: string | undefined;
afterEach(() => {
  delete (globalThis as { __voxStudio?: unknown }).__voxStudio;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A fixed synthetic 32-byte key, never a real one. */
const SYNTHETIC_VOICEPRINT_KEY = Buffer.from(new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff)).toString('base64');
const EXPIRED = '2020-01-01T00:00:00.000Z';

async function boot(voiceprintKey: string, seed?: (dataDir: string) => void): Promise<Studio> {
  dir = mkdtempSync(join(tmpdir(), 'vox-voiceprint-runtime-'));
  seed?.(dir);
  const env = {
    NODE_ENV: 'test', STUDIO_STORAGE: 'file', STUDIO_DATA_DIR: dir,
    STUDIO_SECRET: 'synthetic-voiceprint-runtime-secret-32-chars',
    ANTHROPIC_API_KEY: 'synthetic', VOXX_BOT_TOKEN: '', VOXX_BOT_USERNAME: '',
    STUDIO_BOTS: '0', STUDIO_PUBLIC_URL: '', STUDIO_ADAPTIVE_FORMAT: '',
    STUDIO_ADAPTIVE_POLICY_JSON: '', STUDIO_CONNECTIONS_CONFIG_FILE: '',
    STUDIO_RELATIONSHIPS: 'off', STUDIO_SCOPED_RELATIONSHIPS: '',
    STUDIO_MAINTENANCE: '', STUDIO_REMINDER_DELIVERY: '', STUDIO_REQUESTED_ROUTINES: '',
    STUDIO_EXPERIMENTS_ENABLED: '', STUDIO_IMPROVEMENT_TRUST_JSON: '',
    STUDIO_VOICE_RECOGNITION: '', STUDIO_VOICE_SHADOW: '', VOICEPRINT_KEY: voiceprintKey, PYANNOTE_API_KEY: '',
    OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '',
    K_SERVICE: '', FUNCTION_TARGET: '', FUNCTION_NAME: '', VERCEL: '',
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this fixture'); }));
  vi.resetModules();
  const { getStudio } = await import('../runtime');
  return getStudio();
}

const invalidatorOf = (studio: Studio) =>
  (studio.deps.adaptive as unknown as { voiceIdentityInvalidator?: (input: { telegramId: number; space?: 'work' | 'personal'; reason: string }) => Promise<void> })
    .voiceIdentityInvalidator!;

describe('runtime S11L wiring (H5)', () => {
  it('without VOICEPRINT_KEY nothing is wired (flags unset base behaviour)', async () => {
    const studio = await boot('');
    expect(studio.deps.voiceprints).toBeUndefined();
  });

  it('a rejecting VoiceIdentityService still lets the voiceprint invalidation run, and the chain rejects afterwards', async () => {
    const studio = await boot(SYNTHETIC_VOICEPRINT_KEY);
    expect(studio.deps.voiceprints).toBeDefined();
    const identity = vi.spyOn(studio.deps.voiceIdentity!, 'invalidate').mockRejectedValue(new Error('identity down'));
    let finishDeletion!: () => void;
    const voiceprints = vi.spyOn(studio.deps.voiceprints!, 'invalidate')
      .mockImplementation(() => new Promise<void>(resolve => { finishDeletion = resolve; }));
    let settled = false;
    const chained = invalidatorOf(studio)({ telegramId: 42, space: 'work', reason: 'consent_withdrawn' });
    chained.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    // allSettled: the chain waits for the voiceprint deletion although the first handler already rejected.
    expect(settled).toBe(false);
    finishDeletion();
    await expect(chained).rejects.toThrow('identity down');
    expect(identity).toHaveBeenCalledWith(42, 'work');
    expect(voiceprints).toHaveBeenCalledWith(42, 'work');
  });

  it('the boot sweep deletes an expired template and a failing sweep logs only "[vox] voiceprint sweep_failed"', async () => {
    const studio = await boot(SYNTHETIC_VOICEPRINT_KEY, dataDir => {
      writeFileSync(join(dataDir, 'voiceprints-v1.json'), JSON.stringify({ version: 1, rows: [{
        personId: 'tg-7', space: 'work', provider: 'pyannoteai', modelVersion: 'pyannoteai:precision-2', channel: 'mini_app',
        consentEventId: 'event-7', createdAt: EXPIRED, template: 'vp1.k.iv.tag.ct' }] }));
    });
    expect(studio.deps.voiceprints).toBeDefined();
    await vi.waitFor(() => expect(JSON.parse(readFileSync(join(dir!, 'voiceprints-v1.json'), 'utf8'))).toEqual({ version: 1, rows: [] }));
  });

  it('a corrupt store makes the boot sweep warn with the fixed code, never the error text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await boot(SYNTHETIC_VOICEPRINT_KEY, dataDir => {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'voiceprints-v1.json'), 'not json PRIVATE_CANARY');
    });
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[vox] voiceprint sweep_failed'));
    for (const call of warn.mock.calls) expect(String(call.join(' '))).not.toContain('PRIVATE_CANARY');
  });
});
