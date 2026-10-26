/**
 * Pet care game flags (design PET_CARE_GAME_DESIGN_2026_10_26 §8.7, §8A.3). Kept out of `flags.ts`, which is a
 * hash-pinned shared contract file (llm-blocks.test.ts). Parsed only: the defaults change nothing.
 */

/** §8.7: `shadow` runs the local ranker and logs Decisions beside it; `on` consumes Decisions after the calibration gate. */
export type PetDecisionsMode = 'off' | 'shadow' | 'on';
/** §8A.3: speech synthesis provider seam (re-exported by `src/lib/studio/tts/types.ts`). */
export type TtsProvider = 'eleven' | 'gemini';

export const PET_DECISIONS_MODES: readonly PetDecisionsMode[] = ['off', 'shadow', 'on'];
export const TTS_PROVIDERS: readonly TtsProvider[] = ['eleven', 'gemini'];

export interface PetFlags {
  /** STUDIO_PET_DECISIONS=off | shadow | on; unset or invalid means off (an invalid value warns once). */
  readonly petDecisions: PetDecisionsMode;
  /** STUDIO_TTS_PROVIDER=eleven | gemini; unset or invalid means eleven (an invalid value warns once), so a typo never silences voice. */
  readonly ttsProvider: TtsProvider;
}

const warned = new Set<string>();

/**
 * An enumerated flag: unset or blank is the default silently; any other unknown value is the default
 * plus one console warning per process (a fixed code, the variable name only, never the value).
 */
function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  if (!warned.has(name)) { warned.add(name); console.warn(`[flags] ${name}_invalid using ${fallback}`); }
  return fallback;
}

export const parsePetDecisionsMode = (value: string | undefined): PetDecisionsMode => oneOf('STUDIO_PET_DECISIONS', value, PET_DECISIONS_MODES, 'off');
export const parseTtsProvider = (value: string | undefined): TtsProvider => oneOf('STUDIO_TTS_PROVIDER', value, TTS_PROVIDERS, 'eleven');

export function petFlags(env: NodeJS.ProcessEnv = process.env): PetFlags {
  return {
    petDecisions: parsePetDecisionsMode(env.STUDIO_PET_DECISIONS),
    ttsProvider: parseTtsProvider(env.STUDIO_TTS_PROVIDER),
  };
}

/** Tests only: lets the once-per-process warning fire again. */
export function resetPetFlagWarningsForTests(): void { warned.clear(); }
