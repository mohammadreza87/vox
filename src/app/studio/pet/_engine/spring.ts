/**
 * Damped springs (brief §2.2, §3.1): mass 1, semi-implicit Euler in fixed 1/120 s substeps against the real
 * frame dt, clamped to 64 ms, so a trajectory is the same at 30, 60 and 120 Hz and a hitch never launches a
 * spring. Retargeting keeps velocity: interrupts never restart.
 */

import { LOOP, SPRINGS, springKC, type Spring, type SpringPreset } from './types';

export function makeSpring(x: number, preset: SpringPreset = 'pop'): Spring {
  const p = SPRINGS[preset];
  return { x, v: 0, t: x, k: p.k, c: p.c };
}

/** k and c of a preset with its visual duration scaled (jitter, tempo) and its bounce scaled (species jelly). */
export function presetKC(preset: SpringPreset, timeK = 1, bounceK = 1): { k: number; c: number } {
  const p = SPRINGS[preset];
  if (timeK === 1 && bounceK === 1) return { k: p.k, c: p.c };
  return springKC(p.visualDuration * timeK, Math.min(0.95, p.bounce * bounceK));
}

/** Advance by dt ms (frame-rate independent; identical trajectory at 30/60/120 Hz within ε). */
export function step(s: Spring, dtMs: number): void {
  let left = Math.min(dtMs, LOOP.maxDtMs) / 1000;
  while (left > 1e-9) {
    const h = Math.min(left, LOOP.substep);
    const a = -s.k * (s.x - s.t) - s.c * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
}

/**
 * New target (and optionally new stiffness); velocity is kept. Handing a stiff spring's speed to a much softer
 * one (an `eye` squash released on `jelly`) would fling it far past where either meant to go, so then the speed
 * is bounded by what the softer spring could itself produce over the distance: generous toward the new target,
 * tight away from it.
 */
export function retarget(s: Spring, t: number, kc?: { k: number; c: number }): void {
  if (kc && kc.k < s.k * 0.5 && s.v !== 0) {
    const d = Math.max(Math.abs(t - s.x), Math.abs(t - s.t) * 0.25, 1e-4);
    const toward = Math.sign(s.v) === Math.sign(t - s.x);
    const vmax = (toward ? 1.5 : 0.35) * Math.sqrt(kc.k) * d;
    if (Math.abs(s.v) > vmax) s.v = Math.sign(s.v) * vmax;
  }
  s.t = t;
  if (kc) { s.k = kc.k; s.c = kc.c; }
}

/** Rest: both the velocity and the distance to target are under ε. */
export const atRest = (s: Spring, eps: number = LOOP.restEps) => Math.abs(s.v) < eps && Math.abs(s.x - s.t) < eps;

/** Settle exactly on target (called once at rest so values never drift by ε). */
export function settle(s: Spring): void { s.x = s.t; s.v = 0; }

/** Jump without motion (first frame, reduced motion). */
export function jump(s: Spring, x: number): void { s.x = x; s.t = x; s.v = 0; }

/**
 * Step response of a preset sampled at `hz` for `ms`: what scripts/pet-frames.ts plots and the tests compare.
 * Returns x(t) for a unit step from 0 to 1.
 */
export function stepResponse(kc: { k: number; c: number }, ms: number, hz: number, hitchAtMs?: number): Array<[number, number]> {
  const s: Spring = { x: 0, v: 0, t: 1, ...kc };
  const out: Array<[number, number]> = [[0, 0]];
  const dt = 1000 / hz;
  let t = 0;
  while (t < ms - 1e-9) {
    const d = hitchAtMs !== undefined && t <= hitchAtMs && t + dt > hitchAtMs ? LOOP.maxDtMs : dt;
    step(s, d);
    t += d;
    out.push([t, s.x]);
  }
  return out;
}

/**
 * Of a step response toward `target` (from `from`): the first overshoot (fraction of the step), the visible
 * oscillations (half-waves past the target that reach `visible` of the step) and the time after which the curve
 * stays within `tol` of the step.
 */
export function analyse(curve: Array<[number, number]>, target = 1, from = 0, tol = 0.02, visible = 0.01): { overshoot: number; peaks: number; settleMs: number } {
  const span = Math.abs(target - from) || 1;
  let peaks = 0, overshoot = 0, settleMs = 0, side = -1, segMax = 0, crossed = false;
  for (const [t, x] of curve) {
    const e = (x - target) / span * Math.sign(target - from || 1);
    if (Math.abs(e) > tol) settleMs = t;
    const sd = Math.sign(e);
    if (sd !== 0 && sd !== side) {
      if (crossed && segMax >= visible) peaks++;
      crossed = true; side = sd; segMax = 0;
    }
    if (crossed) segMax = Math.max(segMax, Math.abs(e));
    if (e > overshoot) overshoot = e;
  }
  if (crossed && segMax >= visible) peaks++;
  return { overshoot, peaks, settleMs };
}
