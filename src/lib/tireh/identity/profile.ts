/**
 * Rolling per-person style profile (S10L): a time-decayed exponential moving
 * average of content-free style vectors with a 90-day half-life, a diagonal
 * Gaussian per dimension, and re-baselining after long absences.
 *
 * Pure functions over an immutable StyleProfile; no I/O. Every field is a
 * number, a boolean, a fixed literal or the person id needed for erasure: a
 * profile can never hold message text. Profiles exist only under the
 * optional.personalization purpose.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { BINARY_VECTOR_DIMS, STYLE_VECTOR_DIM } from './style-features';
import type { IdentitySpace } from './types';

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
export const HALF_LIFE_MS = 90 * DAY_MS;
export const MIN_PROFILE_MESSAGES = 50;
export const ABSENCE_REBASELINE_MS = 30 * DAY_MS;
export const MIN_REBASELINE_MESSAGES = 20;
export const REBASELINE_WEIGHT_CAP = 10;
export const VARIANCE_FLOOR = 0.0025;
export const MAX_SELF_SCORES = 64;
export const PROFILE_RETENTION_MS = 180 * DAY_MS;
/** Keeps weights finite and schema-valid even under a flood of messages. */
const MAX_WEIGHT = 1e6;

export interface GaussianModel { readonly mean: readonly number[]; readonly variance: readonly number[]; readonly weight: readonly number[] }

const UNKNOWN_VARIANCE: readonly number[] = Object.freeze(Array.from({ length: STYLE_VECTOR_DIM }, (_, d) =>
  (BINARY_VECTOR_DIMS.includes(d) ? 0.25 : 1 / 12)));

/**
 * The explicit unknown class: an uninformed sender. Mean 0.5 everywhere; the
 * variance of a fair coin on binary dims and of a uniform [0, 1] value
 * otherwise. Weights are large finite numbers so every dim counts as learned.
 */
export const UNKNOWN_MODEL: GaussianModel = Object.freeze({
  mean: Object.freeze(Array.from({ length: STYLE_VECTOR_DIM }, () => 0.5)),
  variance: UNKNOWN_VARIANCE,
  weight: Object.freeze(Array.from({ length: STYLE_VECTOR_DIM }, () => 1e6)),
});

export interface StyleProfile {
  readonly version: 1; readonly personId: string; readonly space: 'work' | 'personal';
  readonly purpose: 'optional.personalization'; readonly epoch: number;
  readonly createdAt: number; readonly updatedAt: number; readonly lastObservedAt?: number; readonly rebaselinedAt?: number;
  readonly messages: number; readonly sinceBaseline: number; readonly sessions: number;
  readonly mean: readonly number[]; readonly variance: readonly number[]; readonly weight: readonly number[];
  readonly selfScores: readonly number[]; readonly falsePrompts: number;
  readonly disabled: boolean; readonly disabledReason?: 'gini' | 'budget';
}

const count = z.number().int().min(0);
const time = z.number().int().min(0);
const vector = (min: number, max: number) => z.array(z.number().min(min).max(max)).length(STYLE_VECTOR_DIM);

/** Strict: unknown keys (e.g. `text`), wrong lengths and non-finite numbers are rejected. */
export const styleProfileSchema: z.ZodType<StyleProfile> = z.object({
  version: z.literal(1),
  personId: z.string().min(1).max(200),
  space: z.enum(['work', 'personal']),
  purpose: z.literal('optional.personalization'),
  epoch: count,
  createdAt: time,
  updatedAt: time,
  lastObservedAt: time.optional(),
  rebaselinedAt: time.optional(),
  messages: count,
  sinceBaseline: count,
  sessions: count,
  mean: vector(0, 1),
  variance: vector(0, 1),
  weight: vector(0, MAX_WEIGHT),
  selfScores: z.array(z.number()).max(MAX_SELF_SCORES),
  falsePrompts: count,
  disabled: z.boolean(),
  disabledReason: z.enum(['gini', 'budget']).optional(),
}).strict();

export function newProfile(personId: string, space: IdentitySpace, epoch: number, at: number): StyleProfile {
  return {
    version: 1, personId, space, purpose: 'optional.personalization', epoch,
    createdAt: at, updatedAt: at,
    messages: 0, sinceBaseline: 0, sessions: 0,
    mean: Array.from({ length: STYLE_VECTOR_DIM }, () => 0.5),
    variance: [...UNKNOWN_VARIANCE],
    weight: Array.from({ length: STYLE_VECTOR_DIM }, () => 0),
    selfScores: [], falsePrompts: 0, disabled: false,
  };
}

/** 2^(-dt / half-life); exactly 0.5 at one half-life, 1 for dt <= 0. */
export function decayFactor(dtMs: number): number {
  if (!Number.isFinite(dtMs)) return dtMs > 0 ? 0 : 1;
  return 2 ** (-Math.max(0, dtMs) / HALF_LIFE_MS);
}

/** Folds one style vector into the profile; returns a new profile and never mutates its input. */
export function observeProfile(profile: StyleProfile, vector: readonly (number | null)[], at: number): StyleProfile {
  const last = profile.lastObservedAt;
  let weight = [...profile.weight];
  let sinceBaseline = profile.sinceBaseline;
  let rebaselinedAt = profile.rebaselinedAt;
  if (last !== undefined && at - last > ABSENCE_REBASELINE_MS) {
    sinceBaseline = 0;
    rebaselinedAt = at;
    weight = weight.map(w => Math.min(w, REBASELINE_WEIGHT_CAP));
  }
  const decay = decayFactor(at - (last ?? at));
  weight = weight.map(w => w * decay);
  const mean = [...profile.mean];
  const variance = [...profile.variance];
  for (let d = 0; d < STYLE_VECTOR_DIM; d++) {
    const raw = vector[d];
    if (raw === null || raw === undefined || !Number.isFinite(raw)) continue;
    const x = Math.min(1, Math.max(0, raw));
    const W = weight[d] + 1;
    const a = 1 / W;
    const delta = x - mean[d];
    mean[d] = Math.min(1, Math.max(0, mean[d] + a * delta));
    variance[d] = Math.min(UNKNOWN_VARIANCE[d], Math.max(VARIANCE_FLOOR, (1 - a) * (variance[d] + a * delta * delta)));
    weight[d] = Math.min(W, MAX_WEIGHT);
  }
  const next: StyleProfile = {
    ...profile,
    mean, variance, weight,
    messages: profile.messages + 1,
    sinceBaseline: sinceBaseline + 1,
    updatedAt: at,
    lastObservedAt: last === undefined ? at : Math.max(last, at),
  };
  return rebaselinedAt === undefined ? next : { ...next, rebaselinedAt };
}

export function profileReady(p: StyleProfile): boolean {
  return !p.disabled && p.messages >= MIN_PROFILE_MESSAGES &&
    p.sinceBaseline >= (p.rebaselinedAt === undefined ? MIN_PROFILE_MESSAGES : MIN_REBASELINE_MESSAGES);
}

export function personModel(p: StyleProfile): GaussianModel {
  return { mean: [...p.mean], variance: [...p.variance], weight: [...p.weight] };
}

/** Opaque storage id: sha256 over a versioned prefix, the space and the person id; 40 hex chars. */
export function profileDocId(personId: string, space: IdentitySpace): string {
  return createHash('sha256').update('vox-style-v1\u0000' + space + '\u0000' + personId).digest('hex').slice(0, 40);
}
