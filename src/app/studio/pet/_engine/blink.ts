/**
 * Blinks (brief §2.4): log-normal gaps per state (never a fixed beat), close 60 / hold 30 / open 90 ms (closing
 * faster than opening), slow blinks when tired, 10 % doubles 80 ms apart (always on wake). Pure and clocked: the
 * loop asks lid(now) each frame and nextWake() when it wants to sleep until the next blink.
 */

import { BLINK_LID } from '../../_components/character/poses';
import { chance, logNormal } from './rng';
import type { Rng } from './types';

export interface BlinkShape { close: number; hold: number; open: number }
export const BLINK: BlinkShape = { close: 60, hold: 30, open: 90 };
export const SLOW_BLINK: BlinkShape = { close: 180, hold: 120, open: 220 };
export const BLINK_SIGMA = 0.45;
export const BLINK_CLAMP: [number, number] = [0.8, 10];
/** Medians (s) for the talk states; the idle median comes from the mood (§2.4 table). */
export const BLINK_MEDIAN = { listening: 5, thinking: 6, speaking: 2.3 } as const;
export const DOUBLE_GAP = 80;

/** Lid openness through one blink at t ms (1 open … BLINK_LID shut): ease-in close, ease-out open. */
export function lidAt(t: number, s: BlinkShape): number {
  if (t <= 0) return 1;
  if (t < s.close) { const u = t / s.close; return 1 - (1 - BLINK_LID) * u * u; }
  if (t < s.close + s.hold) return BLINK_LID;
  const u = Math.min(1, (t - s.close - s.hold) / s.open);
  return BLINK_LID + (1 - BLINK_LID) * (1 - (1 - u) * (1 - u));
}
export const blinkMs = (s: BlinkShape) => s.close + s.hold + s.open;

/** One gap draw (s): exp(ln(median) + σ·N(0,1)), clamped to 0.8–10 s. */
export const blinkGap = (rng: Rng, median: number) => logNormal(rng, median, BLINK_SIGMA, BLINK_CLAMP[0], BLINK_CLAMP[1]);

interface Running { start: number; shape: BlinkShape; again: number }

export class Blinker {
  median = 3.5;
  slowShare = 0.05;
  doubleShare = 0.1;
  /** owl: close 90 / open 140 */
  base: BlinkShape = BLINK;
  private next = Infinity;
  private run: Running | null = null;
  private suppressed = false;
  private holdUntil = -Infinity;

  constructor(private rng: Rng) {}

  /** Draw the next gap from now (after a state change, or after each blink). */
  schedule(now: number): void { this.next = now + blinkGap(this.rng, this.median) * 1000; }

  /** Happy arcs, sleep, chomp: no blinks until allowed again. */
  suppress(on: boolean, now: number): void {
    if (this.suppressed === on) return;
    this.suppressed = on;
    if (!on) this.schedule(now);
  }
  /** Touch contact: hold blinks for ms (§2.4: 120 ms). */
  hold(now: number, ms: number): void { this.holdUntil = Math.max(this.holdUntil, now + ms); }

  /** Blink now (state change, wake, a beat's `blink`). A double always runs its second blink. */
  force(now: number, kind: 'once' | 'double' | 'slow' = 'once'): void {
    if (this.suppressed) return;
    const shape = kind === 'slow' ? SLOW_BLINK : this.base;
    if (this.run && now - this.run.start < blinkMs(this.run.shape)) { if (kind === 'double') this.run.again = 1; return; }
    this.run = { start: now, shape, again: kind === 'double' ? 1 : 0 };
  }

  /** Lid scale for this frame. `canStart` gates a scheduled blink (speaking: only in a pause ≥ 150 ms). */
  lid(now: number, canStart = true): number {
    if (this.run) {
      const t = now - this.run.start, len = blinkMs(this.run.shape);
      if (t < len) return lidAt(t, this.run.shape);
      if (this.run.again > 0 && t < len + DOUBLE_GAP) return 1;
      if (this.run.again > 0) { this.run = { start: this.run.start + len + DOUBLE_GAP, shape: this.base, again: 0 }; return lidAt(now - this.run.start, this.base); }
      this.run = null;
      this.schedule(now);
    }
    if (!this.suppressed && now >= this.next && now >= this.holdUntil && canStart) {
      const slow = chance(this.rng, this.slowShare);
      this.run = { start: now, shape: slow ? SLOW_BLINK : this.base, again: !slow && chance(this.rng, this.doubleShare) ? 1 : 0 };
      return 1;
    }
    return 1;
  }

  busy(now: number): boolean { return this.run !== null && now - this.run.start < blinkMs(this.run.shape) + (this.run.again ? DOUBLE_GAP + blinkMs(this.base) : 0) + 1; }
  /** When the loop must be awake next for a blink (Infinity while suppressed). */
  nextWake(): number { return this.suppressed ? Infinity : this.run ? -Infinity : Math.max(this.next, this.holdUntil); }
}
