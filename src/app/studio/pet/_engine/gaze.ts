/**
 * Gaze (brief §2.4). Saccades take D = 21 + 2.2·A ms (A in degrees, the eye range maps to 30°) on a critically
 * damped spring; smooth pursuit for small target moves. Eyes lead and the head follows: when the target is more
 * than 40 % of the range away, the head (face layer + lean) joins 40–80 ms later on `float`, and the eyes
 * counter-move every frame so the gaze stays locked on target (the VOR: the single most important "alive" tell).
 */

import { range } from './rng';
import { atRest, makeSpring, retarget, step } from './spring';
import { springKC, type Rng, type Spring } from './types';

/** Degrees per unit of eye range. */
export const GAZE_DEG = 30;
export const saccadeMs = (ampDeg: number) => 21 + 2.2 * ampDeg;
/** Above this jump (fraction of the range) a moving target gets a fresh saccade, below it pursuit. */
export const PURSUIT = 0.15;
/** The head engages beyond this distance and carries this share of the gaze. */
export const HEAD_ENGAGE = 0.4, HEAD_SHARE = 0.55;

/**
 * Micro-saccades (§10.2): inside a long look the eyes dart 2–3 times, tiny (0.3–0.5 of the eye range, which is
 * 0.7–1.2 view units on the face) and quick (each held 30–50 ms), then return. Only while a look is held.
 */
export const DART = { afterMs: [700, 1400] as const, gapMs: [600, 1600] as const, holdMs: [30, 50] as const, amp: [0.3, 0.5] as const, perLook: [2, 3] as const };

/** The quickest saccade spring the 1/120 s semi-implicit substep keeps stable (critically damped: d > ~63 ms; margin to 80). */
const SACCADE_MIN_S = 0.08;

const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

export class Gaze {
  readonly ex: Spring = makeSpring(0, 'eye');
  readonly ey: Spring = makeSpring(0, 'eye');
  readonly hx: Spring = makeSpring(0, 'float');
  readonly hy: Spring = makeSpring(0, 'float');
  gx = 0;
  gy = 0;
  private headAt = Infinity;
  private headGoal = { x: 0, y: 0 };
  /** how far the eyes lead the head (ms range; §10.3: a wisp's head and eyes move together) */
  lead: readonly [number, number] = [60, 80];
  /** micro-saccades on (stage ≥ 3, not on reduced motion, never asleep) */
  darts = false;
  /** the current dart offset (eye-range units) and its schedule */
  private dart = { x: 0, y: 0, until: -Infinity, next: Infinity, left: 0 };
  /** the head joined a turn this big (range units) on the last look; the loop blinks on it */
  lastHeadTurn = 0;

  constructor(private rng: Rng) {}

  /**
   * Look at a point in eye-range units. Returns the jump size (fraction of the range) so the loop can force a
   * blink on big shifts (§2.4: > 60 %, 25 % of the time).
   */
  look(x: number, y: number, now: number, pursuit = false): number {
    const tx = clamp1(x), ty = clamp1(y);
    const jump = Math.hypot(tx - this.gx, ty - this.gy);
    this.gx = tx; this.gy = ty;
    if (jump < 1e-4) return 0;
    if (!pursuit || jump > PURSUIT) {
      // a saccade: the amplitude sets the eye spring's speed (max ~87 ms across the full range)
      const ms = saccadeMs(Math.min(1, jump) * GAZE_DEG);
      // never stiffer than the 1/120 s substep integrates stably (a tiny saccade's 24 ms spring diverged)
      const kc = springKC(Math.max(SACCADE_MIN_S, (ms * 1.15) / 1000), 0);
      this.ex.k = this.ey.k = kc.k;
      this.ex.c = this.ey.c = kc.c;
    }
    const far = Math.hypot(tx - this.hx.t, ty - this.hy.t) > HEAD_ENGAGE;
    const home = Math.hypot(tx, ty) < 0.25;
    this.lastHeadTurn = 0;
    if (far || home) {
      const goal = home ? { x: 0, y: 0 } : { x: tx * HEAD_SHARE, y: ty * HEAD_SHARE };
      this.lastHeadTurn = Math.hypot(goal.x - this.hx.t, goal.y - this.hy.t);
      this.headGoal = goal;
      this.headAt = now + (pursuit ? 0 : range(this.rng, this.lead[0], this.lead[1]));
    }
    // a new look: any dart ends, the next comes once this look has been held a while
    this.dart.x = this.dart.y = 0; this.dart.until = -Infinity;
    this.dart.left = pursuit ? 0 : Math.round(range(this.rng, DART.perLook[0], DART.perLook[1] + 0.99));
    this.dart.next = this.darts && this.dart.left > 0 ? now + range(this.rng, DART.afterMs[0], DART.afterMs[1]) : Infinity;
    return jump;
  }

  /** Darts on or off (off clears any dart in flight). */
  setDarts(on: boolean): void {
    this.darts = on;
    if (!on) { this.dart.x = this.dart.y = 0; this.dart.until = -Infinity; this.dart.next = Infinity; }
  }

  /** When the loop must wake for the next dart (Infinity: none due). */
  nextWake(): number { return this.dart.until > -Infinity ? this.dart.until : this.dart.next; }

  /** Total gaze offset in range units (eye-in-head + head). */
  get x() { return this.ex.x + this.hx.x; }
  get y() { return this.ey.x + this.hy.x; }

  update(now: number, dtMs: number): void {
    const d = this.dart;
    if (d.until > -Infinity && now >= d.until) {
      d.x = d.y = 0; d.until = -Infinity;
      d.next = d.left > 0 ? now + range(this.rng, DART.gapMs[0], DART.gapMs[1]) : Infinity;
    } else if (this.darts && now >= d.next && d.left > 0) {
      const a = range(this.rng, DART.amp[0], DART.amp[1]), th = range(this.rng, 0, Math.PI * 2);
      d.x = Math.cos(th) * a; d.y = Math.sin(th) * a * 0.6;
      d.until = now + range(this.rng, DART.holdMs[0], DART.holdMs[1]);
      d.next = Infinity; d.left--;
    }
    if (now >= this.headAt) {
      retarget(this.hx, this.headGoal.x);
      retarget(this.hy, this.headGoal.y);
      this.headAt = Infinity;
    }
    step(this.hx, dtMs);
    step(this.hy, dtMs);
    // counter-rotation: the eyes aim at target minus where the head is now
    retarget(this.ex, clamp1(this.gx + d.x - this.hx.x));
    retarget(this.ey, clamp1(this.gy + d.y - this.hy.x));
    step(this.ex, dtMs);
    step(this.ey, dtMs);
  }

  pending(): boolean { return this.headAt !== Infinity; }
  atRest(): boolean { return this.headAt === Infinity && atRest(this.ex) && atRest(this.ey) && atRest(this.hx) && atRest(this.hy); }
}
