/**
 * Deterministic synthetic style streams for the identity tests. These prove
 * the mechanics only, not real-world accuracy. Library constants must never be
 * tuned to make these fixtures pass; adjust the fixture separation instead.
 */
import { DAY_MS, emptyProfile, foldFeatures, type StyleProfile, type StyleProfileKey } from '../profile';
import {
  quantize, STYLE_FEATURES_VERSION, type DigitScript, type HourBucket, type LengthBucket, type StyleFeatures,
  type TextStyleFeatures, type VoiceDurationBucket,
} from '../style-features';

export interface TimedFeatures {
  readonly features: StyleFeatures;
  readonly at: number;
}

export const FIXTURE_T0 = Date.UTC(2026, 0, 5, 12, 0);
/** 200 messages over 30 days. */
export const DEFAULT_STEP_MS = (30 * DAY_MS) / 200;

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

const ZERO_TEXT: TextStyleFeatures = {
  lengthBucket: 0, persianScriptRatio: 0, latinScriptRatio: 0, finglishRatio: 0, punctuationRate: 0, emoticonRate: 0,
  zwnjRate: 0, arabicVariantRatio: 0, repeatedCharRate: 0, uppercaseRatio: 0, terminalPunctuation: false, digitScript: 0,
};

export interface FeatureOverrides {
  readonly modality?: 'text' | 'voice';
  readonly hourBucket?: HourBucket;
  readonly followOn?: boolean;
  readonly edited?: boolean;
  readonly text?: Partial<TextStyleFeatures>;
  readonly voiceDurationBucket?: VoiceDurationBucket;
}

/** Valid StyleFeatures (ratios quantized onto the grid). */
export function makeFeatures(partial: FeatureOverrides = {}): StyleFeatures {
  const common = {
    version: STYLE_FEATURES_VERSION,
    hourBucket: partial.hourBucket ?? 0,
    followOn: partial.followOn ?? false,
    edited: partial.edited ?? false,
  };
  if (partial.modality === 'voice') {
    return { ...common, modality: 'voice', voiceDurationBucket: partial.voiceDurationBucket ?? 1 };
  }
  const text = { ...ZERO_TEXT, ...partial.text };
  return {
    ...common,
    modality: 'text',
    text: {
      ...text,
      persianScriptRatio: quantize(text.persianScriptRatio), latinScriptRatio: quantize(text.latinScriptRatio),
      finglishRatio: quantize(text.finglishRatio), punctuationRate: quantize(text.punctuationRate),
      emoticonRate: quantize(text.emoticonRate), zwnjRate: quantize(text.zwnjRate),
      arabicVariantRatio: quantize(text.arabicVariantRatio), repeatedCharRate: quantize(text.repeatedCharRate),
      uppercaseRatio: quantize(text.uppercaseRatio),
    },
  };
}

function pick<T>(rand: () => number, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, weight] of options) {
    r -= weight;
    if (r < 0) return value;
  }
  return options[options.length - 1][0];
}

/** Small symmetric jitter in [-scale, scale]. */
function jitter(rand: () => number, scale: number): number {
  return (rand() + rand() - 1) * scale;
}

/** Persian script ~0.95, ZWNJ ~0.3, ')' runs, Persian digits, evening hours, 20% voice. */
export function personA(seed: number, n: number, startAt: number = FIXTURE_T0, stepMs: number = DEFAULT_STEP_MS): TimedFeatures[] {
  const rand = mulberry32(seed);
  const out: TimedFeatures[] = [];
  for (let i = 0; i < n; i++) {
    const at = startAt + i * stepMs;
    const hourBucket = pick<HourBucket>(rand, [[4, 0.45], [5, 0.45], [3, 0.1]]);
    const followOn = rand() < 0.4;
    const edited = rand() < 0.05;
    if (rand() < 0.2) {
      out.push({ at, features: makeFeatures({ modality: 'voice', hourBucket, followOn, edited, voiceDurationBucket: pick<VoiceDurationBucket>(rand, [[1, 0.5], [2, 0.5]]) }) });
      continue;
    }
    const persian = 0.95 + jitter(rand, 0.02);
    out.push({ at, features: makeFeatures({
      hourBucket, followOn, edited,
      text: {
        lengthBucket: pick<LengthBucket>(rand, [[1, 0.3], [2, 0.5], [3, 0.2]]),
        persianScriptRatio: persian,
        latinScriptRatio: 1 - persian,
        finglishRatio: 0,
        punctuationRate: 0.15 + jitter(rand, 0.02),
        emoticonRate: 0.1 + jitter(rand, 0.02),
        zwnjRate: 0.3 + jitter(rand, 0.02),
        arabicVariantRatio: 0,
        repeatedCharRate: 0.05 + jitter(rand, 0.01),
        uppercaseRatio: 0,
        terminalPunctuation: rand() < 0.2,
        digitScript: pick<DigitScript>(rand, [[0, 0.7], [2, 0.3]]),
      },
    }) });
  }
  return out;
}

/** Finglish / Latin ~0.9, finglishRatio ~0.4, emoji, ASCII digits, morning hours, no voice. */
export function personB(seed: number, n: number, startAt: number = FIXTURE_T0, stepMs: number = DEFAULT_STEP_MS): TimedFeatures[] {
  const rand = mulberry32(seed);
  const out: TimedFeatures[] = [];
  for (let i = 0; i < n; i++) {
    const at = startAt + i * stepMs;
    const latin = 0.9 + jitter(rand, 0.02);
    out.push({ at, features: makeFeatures({
      hourBucket: pick<HourBucket>(rand, [[1, 0.5], [2, 0.5]]),
      followOn: rand() < 0.2,
      edited: rand() < 0.02,
      text: {
        lengthBucket: pick<LengthBucket>(rand, [[2, 0.3], [3, 0.5], [4, 0.2]]),
        persianScriptRatio: 1 - latin,
        latinScriptRatio: latin,
        finglishRatio: 0.4 + jitter(rand, 0.03),
        punctuationRate: 0.05 + jitter(rand, 0.01),
        emoticonRate: 0.2 + jitter(rand, 0.03),
        zwnjRate: 0,
        arabicVariantRatio: 0,
        repeatedCharRate: 0,
        uppercaseRatio: 0.1 + jitter(rand, 0.02),
        terminalPunctuation: rand() < 0.6,
        digitScript: pick<DigitScript>(rand, [[0, 0.7], [1, 0.3]]),
      },
    }) });
  }
  return out;
}

export const FIXTURE_KEY: StyleProfileKey = { personaId: 'persona-fixture', personId: 'member-a', space: 'work' };

/** Folds a stream into a fresh profile (epoch 0). */
export function trainProfile(stream: readonly TimedFeatures[], key: StyleProfileKey = FIXTURE_KEY): StyleProfile {
  const start = stream.length ? stream[0].at : FIXTURE_T0;
  return stream.reduce((profile, m) => foldFeatures(profile, m.features, m.at), emptyProfile(key, 0, start));
}
