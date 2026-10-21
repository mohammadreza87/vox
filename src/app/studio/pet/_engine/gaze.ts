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
      const kc = springKC((ms * 1.15) / 1000, 0);
      this.ex.k = this.ey.k = kc.k;
      this.ex.c = this.ey.c = kc.c;
    }
    const far = Math.hypot(tx - this.hx.t, ty - this.hy.t) > HEAD_ENGAGE;
    const home = Math.hypot(tx, ty) < 0.25;
    if (far || home) {
      this.headGoal = home ? { x: 0, y: 0 } : { x: tx * HEAD_SHARE, y: ty * HEAD_SHARE };
      this.headAt = now + (pursuit ? 0 : range(this.rng, 40, 80));
    }
    return jump;
  }

  /** Total gaze offset in range units (eye-in-head + head). */
  get x() { return this.ex.x + this.hx.x; }
  get y() { return this.ey.x + this.hy.x; }

  update(now: number, dtMs: number): void {
    if (now >= this.headAt) {
      retarget(this.hx, this.headGoal.x);
      retarget(this.hy, this.headGoal.y);
      this.headAt = Infinity;
    }
    step(this.hx, dtMs);
    step(this.hy, dtMs);
    // counter-rotation: the eyes aim at target minus where the head is now
    retarget(this.ex, clamp1(this.gx - this.hx.x));
    retarget(this.ey, clamp1(this.gy - this.hy.x));
    step(this.ex, dtMs);
    step(this.ey, dtMs);
  }

  pending(): boolean { return this.headAt !== Infinity; }
  atRest(): boolean { return this.headAt === Infinity && atRest(this.ex) && atRest(this.ey) && atRest(this.hx) && atRest(this.hy); }
}
