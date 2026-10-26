/**
 * Pet care game flags (design PET_CARE_GAME_DESIGN_2026_10_26 §8.7, §8A.3). Kept out of `flags.ts`, which is a
 * hash-pinned shared contract file (llm-blocks.test.ts). Parsed only: the defaults change nothing.
 */

/** §8.7: `shadow` runs the local ranker and logs Decisions beside it; `on` consumes Decisions after the calibration gate. */
export type PetDecisionsMode = 'off' | 'shadow' | 'on';
/** §8A.3: speech synthesis provider seam (re-exported by `src/lib/studio/tts/types.ts`). */
export type TtsProvider = 'eleven' | 'gemini';

/** §5, open decision 2: the check-in master switch. Off means nothing is ever sent, even when a trigger fires. */
export type PetCheckinsMode = 'off' | 'on';

export const PET_DECISIONS_MODES: readonly PetDecisionsMode[] = ['off', 'shadow', 'on'];
export const PET_CHECKINS_MODES: readonly PetCheckinsMode[] = ['off', 'on'];
export const TTS_PROVIDERS: readonly TtsProvider[] = ['eleven', 'gemini'];

export interface PetFlags {
  /** STUDIO_PET_DECISIONS=off | shadow | on; unset or invalid means off (an invalid value warns once). */
  readonly petDecisions: PetDecisionsMode;
  /** STUDIO_TTS_PROVIDER=eleven | gemini; unset or invalid means eleven (an invalid value warns once), so a typo never silences voice. */
  readonly ttsProvider: TtsProvider;
  /** STUDIO_PET_CHECKINS=off | on; unset or invalid means off (an invalid value warns once). */
  readonly petCheckins: PetCheckinsMode;
  /**
   * STUDIO_PET_DECISIONS_CALIBRATED: comma-separated `question:language` pairs (`checkin_moment:fa,tip:en`) that passed
   * the calibration gate (tireh/decisions/calibration.ts petCalibrationPasses, 200 labelled examples per language and
   * question). Only these answers are ever consumed under STUDIO_PET_DECISIONS=on; unset means none (local ranker).
   */
  readonly petDecisionsCalibrated: ReadonlySet<string>;
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
export const parsePetCheckinsMode = (value: string | undefined): PetCheckinsMode => oneOf('STUDIO_PET_CHECKINS', value, PET_CHECKINS_MODES, 'off');

const CALIBRATED_PAIR = /^[a-z][a-z0-9_]{0,63}:(fa|en)$/;
/** `question:language` pairs; malformed entries are dropped (one warning per process, never the value). */
export function parsePetCalibrated(value: string | undefined): ReadonlySet<string> {
  const pairs = (value ?? '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const good = pairs.filter((p) => CALIBRATED_PAIR.test(p));
  if (good.length !== pairs.length && !warned.has('STUDIO_PET_DECISIONS_CALIBRATED')) {
    warned.add('STUDIO_PET_DECISIONS_CALIBRATED');
    console.warn('[flags] STUDIO_PET_DECISIONS_CALIBRATED_invalid ignoring malformed entries');
  }
  return new Set(good);
}

export function petFlags(env: NodeJS.ProcessEnv = process.env): PetFlags {
  return {
    petDecisions: parsePetDecisionsMode(env.STUDIO_PET_DECISIONS),
    ttsProvider: parseTtsProvider(env.STUDIO_TTS_PROVIDER),
    petCheckins: parsePetCheckinsMode(env.STUDIO_PET_CHECKINS),
    petDecisionsCalibrated: parsePetCalibrated(env.STUDIO_PET_DECISIONS_CALIBRATED),
  };
}

/** Tests only: lets the once-per-process warning fire again. */
export function resetPetFlagWarningsForTests(): void { warned.clear(); }
