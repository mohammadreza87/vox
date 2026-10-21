/**
 * Seeded randomness (brief §2.1 "alive = variable"): every random choice in the engine and the reactions comes
 * from one of these, so frame sheets and property tests replay exactly. Never Math.random in _engine/.
 */

import type { ReactionKind, Rng, VariantHistory } from './types';

/** mulberry32: tiny, fast, good enough for motion. */
export function seeded(seed = 1): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);
export const chance = (rng: Rng, p: number) => rng() < p;
export const sign = (rng: Rng): -1 | 1 => (rng() < 0.5 ? -1 : 1);
export const pickOf = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

/** Standard normal (Box–Muller). */
export function normal(rng: Rng): number {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal gap around a median: exp(ln(median) + σ·N(0,1)), clamped (blink gaps, §2.4). */
export const logNormal = (rng: Rng, median: number, sigma: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.exp(Math.log(median) + sigma * normal(rng))));

/** Variant memory: pick(kind, n) never returns last(kind) twice in a row (n ≥ 2). */
export function variantHistory(rng: Rng): VariantHistory {
  const last = new Map<ReactionKind, number>();
  return {
    last: (kind) => last.get(kind),
    pick(kind, n) {
      const prev = last.get(kind);
      let i = Math.floor(rng() * n);
      if (n > 1 && i === prev) i = (i + 1 + Math.floor(rng() * (n - 1))) % n;
      i = Math.min(n - 1, Math.max(0, i));
      last.set(kind, i);
      return i;
    },
  };
}
