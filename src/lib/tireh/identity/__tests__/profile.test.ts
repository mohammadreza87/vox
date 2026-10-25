import { describe, expect, it } from 'vitest';
import {
  ABSENCE_REBASELINE_MS, DAY_MS, decayFactor, HALF_LIFE_MS, newProfile, observeProfile, personModel, profileDocId,
  profileReady, REBASELINE_WEIGHT_CAP, styleProfileSchema, UNKNOWN_MODEL, VARIANCE_FLOOR, type StyleProfile,
} from '../profile';
import { BINARY_VECTOR_DIMS, STYLE_VECTOR_DIM } from '../style-features';

const T0 = Date.UTC(2026, 0, 1);
/** Small deterministic generator (LCG) so this suite has no fixture dependency. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const constant = (value: number): number[] => Array.from({ length: STYLE_VECTOR_DIM }, () => value);
const oneDim = (value: number): (number | null)[] => Array.from({ length: STYLE_VECTOR_DIM }, (_, d) => (d === 3 ? value : null));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function observeDaily(profile: StyleProfile, vector: readonly (number | null)[], days: number, start: number): StyleProfile {
  let p = profile;
  for (let i = 0; i < days; i++) p = observeProfile(p, vector, start + i * DAY_MS);
  return p;
}

describe('style profile', () => {
  it('(a) decays by half per half-life and never grows', () => {
    expect(decayFactor(HALF_LIFE_MS)).toBe(0.5);
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(-5 * DAY_MS)).toBe(1);
    expect(decayFactor(2 * HALF_LIFE_MS)).toBe(0.25);
  });

  it('(b) converges to the steady-state weight and the constant mean', () => {
    const p = observeDaily(newProfile('alice', 'work', 1, T0), constant(0.3), 2000, T0);
    const expected = 1 / (1 - 2 ** (-1 / 90));
    expect(expected).toBeCloseTo(130.3, 0);
    for (let d = 0; d < STYLE_VECTOR_DIM; d++) {
      expect(Math.abs(p.weight[d] - expected) / expected).toBeLessThan(0.01);
      expect(p.mean[d]).toBeCloseTo(0.3, 9);
    }
  });

  it('(c) weights recent behaviour more, exactly as an exponentially weighted mean', () => {
    let p = newProfile('alice', 'work', 1, T0);
    const xs: number[] = [];
    for (let i = 0; i < 270; i++) xs.push(i < 180 ? 0.2 : 0.8);
    p = xs.reduce((acc, x, i) => observeProfile(acc, oneDim(x), T0 + i * DAY_MS), p);
    // Reference: weight of message i at the last timestamp is 2^(-(269 - i) days / half-life).
    let num = 0, den = 0;
    xs.forEach((x, i) => { const w = 2 ** (-((269 - i) * DAY_MS) / HALF_LIFE_MS); num += w * x; den += w; });
    const unweighted = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(p.mean[3]).toBeCloseTo(num / den, 9);
    expect(p.mean[3]).toBeGreaterThan(0.2);
    expect(p.mean[3]).toBeLessThan(0.8);
    expect(Math.abs(p.mean[3] - 0.8)).toBeLessThan(Math.abs(unweighted - 0.8));
  });

  it('(d) is ready only from 50 messages', () => {
    const p49 = observeDaily(newProfile('alice', 'work', 1, T0), constant(0.5), 49, T0);
    expect(profileReady(p49)).toBe(false);
    expect(profileReady(observeProfile(p49, constant(0.5), T0 + 49 * DAY_MS))).toBe(true);
    expect(profileReady({ ...observeProfile(p49, constant(0.5), T0 + 49 * DAY_MS), disabled: true })).toBe(false);
  });

  it('(e) re-baselines after a 31-day absence', () => {
    const before = observeDaily(newProfile('alice', 'work', 1, T0), constant(0.5), 60, T0);
    expect(profileReady(before)).toBe(true);
    const gapAt = (before.lastObservedAt ?? 0) + 31 * DAY_MS;
    expect(31 * DAY_MS).toBeGreaterThan(ABSENCE_REBASELINE_MS);
    let p = observeProfile(before, constant(0.5), gapAt);
    expect(p.sinceBaseline).toBe(1);
    expect(p.rebaselinedAt).toBe(gapAt);
    expect(p.messages).toBe(61);
    for (const w of p.weight) expect(w).toBeLessThanOrEqual(REBASELINE_WEIGHT_CAP);
    expect(profileReady(p)).toBe(false);
    for (let i = 1; i < 19; i++) p = observeProfile(p, constant(0.5), gapAt + i * DAY_MS);
    expect(p.sinceBaseline).toBe(19);
    expect(profileReady(p)).toBe(false);
    p = observeProfile(p, constant(0.5), gapAt + 19 * DAY_MS);
    expect(profileReady(p)).toBe(true);
  });

  it('(f) keeps variance within [floor, unknown variance]', () => {
    const rng = lcg(7);
    let p = newProfile('alice', 'work', 1, T0);
    for (let i = 0; i < 400; i++) {
      const v = Array.from({ length: STYLE_VECTOR_DIM }, (_, d) => (BINARY_VECTOR_DIMS.includes(d) ? (rng() < 0.5 ? 0 : 1) : rng()));
      p = observeProfile(p, i % 50 === 0 ? constant(0.5) : v, T0 + i * 60_000);
      for (let d = 0; d < STYLE_VECTOR_DIM; d++) {
        expect(p.variance[d]).toBeGreaterThanOrEqual(VARIANCE_FLOOR);
        expect(p.variance[d]).toBeLessThanOrEqual(UNKNOWN_MODEL.variance[d]);
      }
    }
    expect(styleProfileSchema.safeParse(p).success).toBe(true);
  });

  it('(g) leaves null dims untouched', () => {
    const p0 = newProfile('alice', 'work', 1, T0);
    const p = observeProfile(p0, oneDim(0.9), T0);
    for (let d = 0; d < STYLE_VECTOR_DIM; d++) {
      if (d === 3) { expect(p.mean[d]).toBe(0.9); expect(p.weight[d]).toBe(1); continue; }
      expect(p.mean[d]).toBe(p0.mean[d]);
      expect(p.variance[d]).toBe(p0.variance[d]);
      expect(p.weight[d]).toBe(0);
    }
  });

  it('(h) never moves lastObservedAt backwards', () => {
    const p1 = observeProfile(newProfile('alice', 'work', 1, T0), constant(0.5), T0 + 10 * DAY_MS);
    const p2 = observeProfile(p1, constant(0.5), T0 + 2 * DAY_MS);
    expect(p2.lastObservedAt).toBe(T0 + 10 * DAY_MS);
    expect(p2.weight[0]).toBe(2);
  });

  it('(i) never mutates its input', () => {
    const input = deepFreeze(observeDaily(newProfile('alice', 'work', 1, T0), constant(0.4), 5, T0));
    const snapshot = JSON.stringify(input);
    expect(() => observeProfile(input, constant(0.9), T0 + 40 * DAY_MS)).not.toThrow();
    expect(JSON.stringify(input)).toBe(snapshot);
    const model = personModel(input);
    expect(model.mean).not.toBe(input.mean);
    expect(model.mean).toEqual(input.mean);
  });

  it('(j) derives a stable 40-hex document id per person and space', () => {
    const work = profileDocId('alice', 'work');
    expect(work).toMatch(/^[0-9a-f]{40}$/);
    expect(profileDocId('alice', 'work')).toBe(work);
    expect(profileDocId('alice', 'personal')).not.toBe(work);
    expect(profileDocId('bob', 'work')).not.toBe(work);
    expect(work).not.toContain('alice');
  });

  it('starts as an empty, valid, content-free profile', () => {
    const p = newProfile('alice', 'personal', 3, T0);
    expect(styleProfileSchema.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({ purpose: 'optional.personalization', epoch: 3, messages: 0, disabled: false });
    expect(styleProfileSchema.safeParse({ ...p, text: 'x' }).success).toBe(false);
    expect(styleProfileSchema.safeParse({ ...p, mean: p.mean.slice(1) }).success).toBe(false);
    expect(styleProfileSchema.safeParse({ ...p, falsePrompts: Number.NaN }).success).toBe(false);
    expect(styleProfileSchema.safeParse({ ...p, updatedAt: Infinity }).success).toBe(false);
  });
});
