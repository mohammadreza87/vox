/**
 * Deterministic synthetic style data for the S10L tests. Not a test file.
 * The distributions are synthetic and uncalibrated: they prove the mechanics
 * and determinism of the sequential test, not real-world accuracy.
 */
import type { IdentityConfidenceService } from '../index';
import type { SessionConsistency, StyleFeatures } from '../types';

/** Seeded PRNG (mulberry32): uniform [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantised ratio, as the extractor produces. */
function q(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 20) / 20;
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.min(values.length - 1, Math.floor(rng() * values.length))];
}

const VOICE_BASE = {
  version: 1, kind: 'voice', lengthBucket: 0, wordBucket: 0,
  persianScriptRatio: null, latinScriptRatio: null, finglishRatio: null, zwnjPerWord: null,
  persianDigitShare: null, arabicVariantShare: null, latinUpperShare: null, punctuationPer100: null,
  persianQuestionShare: null, repeatedPunctuation: false, endsWithPunctuation: false, emojiCount: 0, emoticonCount: 0,
} as const;

/** A Persian-dominant owner who writes short evening messages and sometimes sends voice notes. */
export function ownerFeatures(rng: () => number, at: number): StyleFeatures {
  void at; // timestamps do not shape this synthetic owner
  const burstIndex = 1 + Math.floor(rng() * 3);
  const hourBucket = pick(rng, [6, 7]);
  if (rng() < 0.15) {
    return { ...VOICE_BASE, burstIndex, edited: false, hourBucket, voiceDurationBucket: pick(rng, [0, 1, 1, 2]) };
  }
  const persian = q(0.9 + rng() * 0.1);
  const lengthBucket = pick(rng, [2, 3]);
  return {
    version: 1, kind: 'text', lengthBucket, wordBucket: lengthBucket,
    persianScriptRatio: persian, latinScriptRatio: q(1 - persian), finglishRatio: null,
    zwnjPerWord: q(0.2 + rng() * 0.2), persianDigitShare: rng() < 0.1 ? 1 : null,
    arabicVariantShare: rng() < 0.5 ? 0 : null, latinUpperShare: null,
    punctuationPer100: Math.floor(rng() * 4), persianQuestionShare: rng() < 0.2 ? 1 : null,
    repeatedPunctuation: false, endsWithPunctuation: rng() < 0.2,
    emojiCount: rng() < 0.3 ? 1 : 0, emoticonCount: 0,
    burstIndex, edited: rng() < 0.05, hourBucket, voiceDurationBucket: null,
  };
}

/** A Latin/English-dominant sender: longer, punctuated morning messages with emoticons and no voice. */
export function impostorFeatures(rng: () => number, at: number): StyleFeatures {
  void at;
  const latin = q(0.85 + rng() * 0.1);
  const lengthBucket = pick(rng, [4, 5]);
  const persian = q(1 - latin);
  return {
    version: 1, kind: 'text', lengthBucket, wordBucket: lengthBucket,
    persianScriptRatio: persian, latinScriptRatio: latin, finglishRatio: q(rng() * 0.1),
    zwnjPerWord: persian > 0 ? 0 : null, persianDigitShare: rng() < 0.2 ? 0 : null,
    arabicVariantShare: null, latinUpperShare: q(0.03 + rng() * 0.07),
    punctuationPer100: 6 + Math.floor(rng() * 5), persianQuestionShare: rng() < 0.3 ? 0 : null,
    repeatedPunctuation: rng() < 0.2, endsWithPunctuation: rng() < 0.7,
    emojiCount: 0, emoticonCount: rng() < 0.5 ? 1 : 0,
    burstIndex: 1 + Math.floor(rng() * 2), edited: rng() < 0.1, hourBucket: pick(rng, [2, 3]), voiceDurationBucket: null,
  };
}

export const SIM_START = Date.UTC(2026, 0, 5, 18, 0);
export const SIM_PERSONA = 'persona-sim';
export const SIM_PERSON = 'owner';
const WEEK = 7 * 86_400_000;

export interface SimulationOptions {
  readonly weeks: number;
  readonly sessionsPerWeek: number;
  readonly messagesPerSession: number;
  readonly seed: number;
  readonly impostorSessionShare: number;
  /** Answer the one neutral question when a session is first flagged (default true). */
  readonly answerPrompts?: boolean;
}

export interface SessionOutcome {
  readonly week: number;
  readonly session: number;
  readonly impostor: boolean;
  /** Worst hint the session produced, or null when it produced none. */
  readonly worst: SessionConsistency | null;
  readonly hints: number;
  readonly prompted: boolean;
}

const SEVERITY: Record<SessionConsistency, number> = { consistent: 0, uncertain: 1, inconsistent: 2 };

/** Enrolls the owner, then drives observeStyle with deterministic timestamps. */
export async function simulateWeeks(service: IdentityConfidenceService, options: SimulationOptions): Promise<SessionOutcome[]> {
  const rng = mulberry32(options.seed);
  const enrolled = await service.enroll({ personId: SIM_PERSON, space: 'work', kind: 'style_baseline', at: SIM_START, personalizationAllowed: true });
  if (!enrolled.enrolled) throw new Error('simulation_enroll_failed');
  const gap = Math.floor(WEEK / options.sessionsPerWeek);
  const outcomes: SessionOutcome[] = [];
  for (let week = 0; week < options.weeks; week++) {
    for (let session = 0; session < options.sessionsPerWeek; session++) {
      const start = SIM_START + 60_000 + week * WEEK + session * gap;
      const impostor = rng() < options.impostorSessionShare;
      let worst: SessionConsistency | null = null;
      let hints = 0;
      let prompted = false;
      for (let m = 0; m < options.messagesPerSession; m++) {
        const at = start + m * 60_000;
        const features = impostor ? impostorFeatures(rng, at) : ownerFeatures(rng, at);
        const result = await service.observeStyle({ personaId: SIM_PERSONA, personId: SIM_PERSON, space: 'work', features, at, personalizationAllowed: true });
        if (!result.hint) continue;
        hints++;
        if (worst === null || SEVERITY[result.hint.consistency] > SEVERITY[worst]) worst = result.hint.consistency;
        if (result.hint.consistency !== 'consistent' && !prompted && options.answerPrompts !== false) {
          prompted = true;
          await service.recordPromptOutcome({ personaId: SIM_PERSONA, personId: SIM_PERSON, space: 'work',
            outcome: impostor ? 'other_person' : 'confirmed_self', at });
        }
      }
      outcomes.push({ week, session, impostor, worst, hints, prompted });
    }
  }
  return outcomes;
}
