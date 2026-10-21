/**
 * Rolling per-person style profile (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.6, 4.9).
 *
 * A row holds ONLY aggregate statistics: decayed weights, means, second moments
 * and category counts over content-free features. It never holds text, a
 * single message's features, session state or hints. It exists only under
 * optional.personalization.
 *
 * Retention (resolves 4.9 phase 0 "7-day-expiring" against Step 10's rolling
 * profile): statistics reset after 7 days without a learned message, the
 * per-person calibration survives up to 90 days of inactivity, then the whole
 * row is deleted.
 */
import { z } from 'zod';
import type { StyleFeatures } from './style-features';

export const DAY_MS = 86_400_000;
export const STYLE_PROFILE_VERSION = 1 as const;
export const HALF_LIFE_MS = 90 * DAY_MS;
export const MIN_PROFILE_MESSAGES = 50;
export const STYLE_PROFILE_TTL_MS = 7 * DAY_MS;
export const ABSENCE_REBASELINE_MS = STYLE_PROFILE_TTL_MS;
export const CALIBRATION_RETENTION_MS = 90 * DAY_MS;
export const VARIANCE_FLOOR = 0.0025;
/** Mirrors test.ts DEFAULT_THRESHOLD (kept separate to avoid an import cycle; a test asserts equality). */
const INITIAL_THRESHOLD = 5;

export const BERNOULLI_KEYS = Object.freeze(['voice', 'followOn', 'edited', 'terminalPunctuation'] as const);
export const CATEGORICAL_SIZES = Object.freeze({ hourBucket: 6, lengthBucket: 6, digitScript: 5, voiceDurationBucket: 4 } as const);
export const GAUSSIAN_KEYS = Object.freeze([
  'persianScriptRatio', 'latinScriptRatio', 'finglishRatio', 'punctuationRate', 'emoticonRate', 'zwnjRate',
  'arabicVariantRatio', 'repeatedCharRate', 'uppercaseRatio',
] as const);

export type BernoulliKey = typeof BERNOULLI_KEYS[number];
export type CategoricalKey = keyof typeof CATEGORICAL_SIZES;
export type GaussianKey = typeof GAUSSIAN_KEYS[number];

export interface BernoulliStat { readonly w: number; readonly p: number }
export interface CategoricalStat { readonly w: number; readonly counts: readonly number[] }
export interface GaussianStat { readonly w: number; readonly mean: number; readonly m2: number }

export interface StyleCalibration {
  readonly threshold: number;
  readonly sessions: number;
  readonly falsePrompts: number;
  readonly truePrompts: number;
  readonly falsePromptAt: readonly number[];
  readonly lastRelaxAt: number;
  readonly mutedUntil: number;
  readonly disabled: boolean;
}

export interface StyleProfileKey {
  readonly personaId: string;
  readonly personId: string;
  readonly space: 'work' | 'personal';
}

export interface StyleProfile extends StyleProfileKey {
  readonly version: typeof STYLE_PROFILE_VERSION;
  readonly purpose: 'optional.personalization';
  readonly epoch: number;
  readonly messages: number;
  readonly baselineAt: number;
  readonly lastAt: number;
  readonly expiresAt: number;
  readonly bernoulli: Readonly<Record<BernoulliKey, BernoulliStat>>;
  readonly categorical: Readonly<Record<CategoricalKey, CategoricalStat>>;
  readonly gaussian: Readonly<Record<GaussianKey, GaussianStat>>;
  readonly calibration: StyleCalibration;
}

const finite = z.number().refine(Number.isFinite, { message: 'not_finite' });
const nonNegative = finite.refine(x => x >= 0, { message: 'negative' });
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const idSchema = z.string().min(1).max(200);

const bernoulliStatSchema = z.object({ w: nonNegative, p: finite.refine(x => x >= 0 && x <= 1) }).strict();
const gaussianStatSchema = z.object({ w: nonNegative, mean: finite, m2: nonNegative }).strict();
const categoricalStatSchema = (size: number) => z.object({ w: nonNegative, counts: z.array(nonNegative).length(size) }).strict();

const calibrationSchema = z.object({
  threshold: finite.refine(x => x > 0),
  sessions: count,
  falsePrompts: count,
  truePrompts: count,
  falsePromptAt: z.array(nonNegative).max(8),
  lastRelaxAt: nonNegative,
  mutedUntil: nonNegative,
  disabled: z.boolean(),
}).strict();

/** Strict at every level; ids 1..200 chars; all numbers finite; counts length = CATEGORICAL_SIZES. */
export const styleProfileSchema: z.ZodType<StyleProfile> = z.object({
  personaId: idSchema,
  personId: idSchema,
  space: z.enum(['work', 'personal']),
  version: z.literal(STYLE_PROFILE_VERSION),
  purpose: z.literal('optional.personalization'),
  epoch: count,
  messages: count,
  baselineAt: nonNegative,
  lastAt: nonNegative,
  expiresAt: nonNegative,
  bernoulli: z.object({
    voice: bernoulliStatSchema, followOn: bernoulliStatSchema, edited: bernoulliStatSchema, terminalPunctuation: bernoulliStatSchema,
  }).strict(),
  categorical: z.object({
    hourBucket: categoricalStatSchema(CATEGORICAL_SIZES.hourBucket),
    lengthBucket: categoricalStatSchema(CATEGORICAL_SIZES.lengthBucket),
    digitScript: categoricalStatSchema(CATEGORICAL_SIZES.digitScript),
    voiceDurationBucket: categoricalStatSchema(CATEGORICAL_SIZES.voiceDurationBucket),
  }).strict(),
  gaussian: z.object({
    persianScriptRatio: gaussianStatSchema, latinScriptRatio: gaussianStatSchema, finglishRatio: gaussianStatSchema,
    punctuationRate: gaussianStatSchema, emoticonRate: gaussianStatSchema, zwnjRate: gaussianStatSchema,
    arabicVariantRatio: gaussianStatSchema, repeatedCharRate: gaussianStatSchema, uppercaseRatio: gaussianStatSchema,
  }).strict(),
  calibration: calibrationSchema,
}).strict();

function initialCalibration(at: number): StyleCalibration {
  return { threshold: INITIAL_THRESHOLD, sessions: 0, falsePrompts: 0, truePrompts: 0, falsePromptAt: [], lastRelaxAt: at, mutedUntil: 0, disabled: false };
}

function emptyStats(): Pick<StyleProfile, 'bernoulli' | 'categorical' | 'gaussian'> {
  const bernoulli = Object.fromEntries(BERNOULLI_KEYS.map(k => [k, { w: 0, p: 0 }])) as Record<BernoulliKey, BernoulliStat>;
  const zeros = (k: CategoricalKey): CategoricalStat => ({ w: 0, counts: new Array<number>(CATEGORICAL_SIZES[k]).fill(0) });
  const categorical: Record<CategoricalKey, CategoricalStat> = {
    hourBucket: zeros('hourBucket'), lengthBucket: zeros('lengthBucket'), digitScript: zeros('digitScript'),
    voiceDurationBucket: zeros('voiceDurationBucket'),
  };
  const gaussian = Object.fromEntries(GAUSSIAN_KEYS.map(k => [k, { w: 0, mean: 0, m2: 0 }])) as Record<GaussianKey, GaussianStat>;
  return { bernoulli, categorical, gaussian };
}

/** Next time the sweeper must act: the statistics TTL while there are statistics, else the row's deletion time. */
function nextExpiry(messages: number, lastAt: number): number {
  return lastAt + (messages > 0 ? STYLE_PROFILE_TTL_MS : CALIBRATION_RETENTION_MS);
}

export function emptyProfile(key: StyleProfileKey, epoch: number, at: number, calibration?: StyleCalibration): StyleProfile {
  return {
    personaId: key.personaId, personId: key.personId, space: key.space,
    version: STYLE_PROFILE_VERSION, purpose: 'optional.personalization', epoch,
    messages: 0, baselineAt: at, lastAt: at, expiresAt: nextExpiry(0, at),
    ...emptyStats(),
    calibration: calibration ?? initialCalibration(at),
  };
}

export function decayFactor(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 1;
  return 0.5 ** (dtMs / HALF_LIFE_MS);
}

function decayBernoulli(stat: BernoulliStat, d: number, x?: boolean): BernoulliStat {
  const w = d * stat.w + (x === undefined ? 0 : 1);
  if (x === undefined) return d === 1 ? stat : { w, p: stat.p };
  return { w, p: stat.p + ((x ? 1 : 0) - stat.p) / w };
}

function decayCategorical(stat: CategoricalStat, d: number, index?: number): CategoricalStat {
  if (index === undefined && d === 1) return stat;
  const counts = stat.counts.map((c, i) => d * c + (i === index ? 1 : 0));
  return { w: d * stat.w + (index === undefined ? 0 : 1), counts };
}

function decayGaussian(stat: GaussianStat, d: number, x?: number): GaussianStat {
  if (x === undefined) return d === 1 ? stat : { w: d * stat.w, mean: stat.mean, m2: d * stat.m2 };
  // Weighted Welford with exponential decay (new observation weight 1).
  const w = d * stat.w + 1;
  const delta = x - stat.mean;
  const mean = stat.mean + delta / w;
  const m2 = Math.max(0, d * stat.m2 + delta * (x - mean));
  return { w, mean, m2 };
}

/**
 * Folds one message's features into the profile. Every statistic decays by the
 * elapsed time; only the dimensions present in this message receive the new
 * observation (text-only keys on text, voiceDurationBucket on voice). Pure.
 */
export function foldFeatures(profile: StyleProfile, features: StyleFeatures, at: number): StyleProfile {
  const d = decayFactor(at - profile.lastAt);
  const text = features.modality === 'text' ? features.text : undefined;
  const voiceBucket = features.modality === 'voice' ? features.voiceDurationBucket : undefined;
  const bernoulli: Record<BernoulliKey, BernoulliStat> = {
    voice: decayBernoulli(profile.bernoulli.voice, d, features.modality === 'voice'),
    followOn: decayBernoulli(profile.bernoulli.followOn, d, features.followOn),
    edited: decayBernoulli(profile.bernoulli.edited, d, features.edited),
    terminalPunctuation: decayBernoulli(profile.bernoulli.terminalPunctuation, d, text?.terminalPunctuation),
  };
  const categorical: Record<CategoricalKey, CategoricalStat> = {
    hourBucket: decayCategorical(profile.categorical.hourBucket, d, features.hourBucket),
    lengthBucket: decayCategorical(profile.categorical.lengthBucket, d, text?.lengthBucket),
    digitScript: decayCategorical(profile.categorical.digitScript, d, text?.digitScript),
    voiceDurationBucket: decayCategorical(profile.categorical.voiceDurationBucket, d, voiceBucket),
  };
  const gaussian = Object.fromEntries(GAUSSIAN_KEYS.map(k => [k, decayGaussian(profile.gaussian[k], d, text?.[k])])) as Record<GaussianKey, GaussianStat>;
  const lastAt = Math.max(profile.lastAt, at);
  const messages = profile.messages + 1;
  return { ...profile, messages, lastAt, expiresAt: nextExpiry(messages, lastAt), bernoulli, categorical, gaussian };
}

/** Drops every statistic and keeps the calibration and the last-activity time. */
export function resetStatistics(profile: StyleProfile, at: number): StyleProfile {
  return { ...profile, ...emptyStats(), messages: 0, baselineAt: at, expiresAt: nextExpiry(0, profile.lastAt) };
}

export function isScorable(profile: StyleProfile): boolean {
  return profile.messages >= MIN_PROFILE_MESSAGES;
}

export function needsRebaseline(profile: StyleProfile, at: number, epoch: number): boolean {
  return profile.epoch !== epoch || profile.version !== STYLE_PROFILE_VERSION || at - profile.lastAt >= ABSENCE_REBASELINE_MS;
}

/** lastAt + CALIBRATION_RETENTION_MS <= now. */
export function needsDeletion(profile: StyleProfile, now: number): boolean {
  return profile.lastAt + CALIBRATION_RETENTION_MS <= now;
}

export function bernoulliP(stat: BernoulliStat): number {
  const p = (stat.w * stat.p + 1) / (stat.w + 2);
  return Math.min(0.98, Math.max(0.02, p));
}

export function categoricalP(stat: CategoricalStat, index: number): number {
  const size = stat.counts.length;
  const c = stat.counts[index] ?? 0;
  return (c + 1) / (stat.w + size);
}

export function gaussianParams(stat: GaussianStat): { mean: number; variance: number } {
  const variance = stat.w > 0 ? stat.m2 / stat.w : VARIANCE_FLOOR;
  return { mean: stat.mean, variance: Math.max(VARIANCE_FLOOR, Number.isFinite(variance) ? variance : VARIANCE_FLOOR) };
}
