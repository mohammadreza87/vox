/**
 * Second-order followers (brief §2.2, t3ssel8r's form): ears, tufts, the sprout, hair, acc-soft, cheeks and the
 * shadow chase the final body instead of being driven, so overlap and follow-through come for free. f is the
 * natural frequency (Hz), z the damping ratio, r the response (r < 0 dips the wrong way first: anticipation).
 * Stepped in the same fixed 1/120 s substeps as the springs, with the k2 stability clamp.
 */

import { FOLLOWERS, LOOP, type Follower, type FollowerParams, type FollowerPreset } from './types';

export function followerK(p: FollowerParams): Pick<Follower, 'k1' | 'k2' | 'k3'> {
  const w = 2 * Math.PI * p.f;
  return { k1: p.z / (Math.PI * p.f), k2: 1 / (w * w), k3: (p.r * p.z) / w };
}

export function makeFollower(x0: number, p: FollowerPreset | FollowerParams): Follower {
  return { y: x0, yd: 0, xp: x0, ...followerK(typeof p === 'string' ? FOLLOWERS[p] : p) };
}

/** Swap dynamics (dog's ears go floppy asleep) without a jump: position and velocity are kept. */
export function retune(f: Follower, p: FollowerPreset | FollowerParams): void {
  Object.assign(f, followerK(typeof p === 'string' ? FOLLOWERS[p] : p));
}

/**
 * Advance toward input x over dt ms. The input velocity comes from the difference over the frame (held across
 * the substeps), so the result is frame-rate independent like the springs.
 */
export function follow(f: Follower, x: number, dtMs: number): number {
  const T = Math.min(dtMs, LOOP.maxDtMs) / 1000;
  if (T <= 0) return f.y;
  const xd = (x - f.xp) / T;
  f.xp = x;
  let left = T;
  while (left > 1e-9) {
    const h = Math.min(left, LOOP.substep);
    // the stability clamp keeps a stiff follower from exploding at a long substep
    const k2 = Math.max(f.k2, (h * h) / 2 + (h * f.k1) / 2, h * f.k1);
    f.y += h * f.yd;
    f.yd += (h * (x + f.k3 * xd - f.y - f.k1 * f.yd)) / k2;
    left -= h;
  }
  return f.y;
}

/**
 * Rest for a follower: its swing (degrees, px or a scale) is under ε, and it is settled exactly onto its input.
 * Followers ring longer than springs (a dog's floppy ear), so their ε is a visible threshold, not the springs'.
 */
export const FOLLOWER_EPS = 0.02;
export function followerAtRest(f: Follower, eps = FOLLOWER_EPS): boolean {
  if (Math.abs(f.yd) * 0.05 >= eps || Math.abs(f.y - f.xp) >= eps) return false;
  f.y = f.xp; f.yd = 0;
  return true;
}

/** Jump (first frame, look change). */
export function resetFollower(f: Follower, x: number): void { f.y = x; f.yd = 0; f.xp = x; }
