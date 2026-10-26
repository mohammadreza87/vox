/** Pet care game flags (design §8.7, §8A.3): parsed only, defaults change nothing. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePetDecisionsMode, parseTtsProvider, petFlags, resetPetFlagWarningsForTests } from '../pet-flags';

describe('pet care game flags', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { resetPetFlagWarningsForTests(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('defaults to off and eleven with both unset, silently', () => {
    expect(petFlags({})).toMatchObject({ petDecisions: 'off', ttsProvider: 'eleven' });
    expect(petFlags({ STUDIO_PET_DECISIONS: '  ', STUDIO_TTS_PROVIDER: '' })).toMatchObject({ petDecisions: 'off', ttsProvider: 'eleven' });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['off', 'shadow', 'on', ' Shadow ', 'ON'])('reads STUDIO_PET_DECISIONS=%j', (value) => {
    expect(petFlags({ STUDIO_PET_DECISIONS: value }).petDecisions).toBe(value.trim().toLowerCase());
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['eleven', 'gemini', 'GEMINI'])('reads STUDIO_TTS_PROVIDER=%j', (value) => {
    expect(petFlags({ STUDIO_TTS_PROVIDER: value }).ttsProvider).toBe(value.toLowerCase());
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back on an invalid value and warns once per flag, without echoing the value', () => {
    expect(parsePetDecisionsMode('1')).toBe('off');
    expect(parsePetDecisionsMode('live')).toBe('off');
    expect(parseTtsProvider('openai')).toBe('eleven');
    expect(petFlags({ STUDIO_PET_DECISIONS: 'yes', STUDIO_TTS_PROVIDER: 'openai' })).toMatchObject({ petDecisions: 'off', ttsProvider: 'eleven' });
    expect(warn.mock.calls).toEqual([['[flags] STUDIO_PET_DECISIONS_invalid using off'], ['[flags] STUDIO_TTS_PROVIDER_invalid using eleven']]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/openai|live|yes/);
  });

  it('reads process.env at call time', () => {
    vi.stubEnv('STUDIO_PET_DECISIONS', 'shadow');
    vi.stubEnv('STUDIO_TTS_PROVIDER', 'gemini');
    expect(petFlags()).toMatchObject({ petDecisions: 'shadow', ttsProvider: 'gemini' });
    vi.unstubAllEnvs();
  });
});
