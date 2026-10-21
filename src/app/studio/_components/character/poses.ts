/**
 * The character's motion poses as data (no React, no DOM): the live rig (Cloud.tsx, moments.tsx,
 * motion.css) and the keyframe contact sheet (scripts/motion-keyframes.ts) read the same numbers.
 *
 * Every body pose scales about the ground point (50 %, 83 % of the box = (100, GROUND) in the
 * 200 view box), so the base stays planted and the gumdrop squashes and stretches from its bun.
 * Wrapper distances are px at a 200 px character (the rig multiplies them by k = size / 200).
 */

export interface BodyPose { sx: number; sy: number; y?: number; rot?: number }

/**
 * Idle breath (mirrored in motion.css `vxBreathe*`): a slow stretch up from the base, no lift, so
 * the contact shadow never leaves the ground. A sleeper breathes slower and deeper, mostly sideways.
 */
export const BREATHE = {
  /** seconds per breath by stage 1–4 (the wisp breathes quickest) and asleep */
  period: { 1: 3.4, 2: 3.8, 3: 4.2, 4: 4.6, sleeping: 6.8 },
  low: { sx: 1, sy: 1 },
  high: { sx: 0.985, sy: 1.032 },
  sleepHigh: { sx: 1.018, sy: 1.022 },
} as const satisfies { period: Record<string, number>; low: BodyPose; high: BodyPose; sleepHigh: BodyPose };

/** Listening: the body leans in (a touch bigger and taller), and swells a little more with the mic level. */
export const LISTEN = { sx: 1.022, sy: 1.034, faceLift: -1.2, levelSwell: 0.05 } as const;

/** Speaking: each syllable lifts and stretches the body; a syllable onset adds a small bounce. */
export const TALK = {
  /** px lift and stretch at full openness (follows the lip-sync envelope) */
  lift: 2.2, stretch: 0.035, narrow: 0.018,
  /** the onset bounce: px lift and extra stretch at its peak */
  bounceLift: 2.6, bounceStretch: 0.022,
  /** an onset is a rise of `rise` above the last trough, reaching at least `floor`, ≥ `gap` ms after the last */
  rise: 0.28, floor: 0.4, gap: 150, rearm: 0.14,
} as const;

/** Joy hop: anticipation squash, stretch on the rise, squash on landing, a small rebound. */
export const HOP = {
  y: [0, 2, -15, 0, -3, 0],
  sx: [1, 1.08, 0.93, 1.12, 0.98, 1],
  sy: [1, 0.92, 1.08, 0.88, 1.02, 1],
  times: [0, 0.12, 0.42, 0.66, 0.82, 1],
  duration: 0.72,
} as const;

/** Tap: a squish into the ground, then a giggle wobble that rocks on the base and dies away. */
export const SQUISH = {
  sx: [1, 1.15, 0.94, 1.05, 0.98, 1.01, 1],
  sy: [1, 0.84, 1.08, 0.96, 1.02, 0.995, 1],
  rot: [0, 0, -4.5, 3.6, -2.4, 1.2, 0],
  times: [0, 0.13, 0.32, 0.5, 0.68, 0.85, 1],
  duration: 0.86,
  /** giggle eyes (happy arcs) hold this long from the press */
  giggleMs: 820,
} as const;

/** Long-press: a shy blush grows on both cheeks, the body shrinks into itself and the gaze drops aside. */
export const SHY = {
  body: { sx: 1.035, sy: 0.955 },
  blushFrom: 0.5, blushTo: 1.32,
  tilt: 5, gx: -2.2, gy: 1.8,
  /** how long a press must last to read as a long-press (ms) */
  holdMs: 420,
  /** the moment version holds the blush this long (ms) */
  holdForMs: 1400,
} as const;

/** Evolve: an inhale at the old size, then the body puffs up out of the old geometry and settles. */
export const EVOLVE = {
  gather: { sx: 1.07, sy: 0.91 },
  puff: { sx: 0.96, sy: 1.07, y: -4 },
  land: { sx: 1.06, sy: 0.94 },
  /** body path tween from the old stage's silhouette (s) */
  grow: 0.5,
} as const;

/** Blink: the lids close to this scale (motion §4.3). */
export const BLINK_LID = 0.08;

/** CSS transform for a pose about the ground point of a 200 box (the sheet uses it; the rig uses framer). */
export function poseTransform(p: BodyPose, groundY = 166, cx = 100): string {
  const y = p.y ?? 0, rot = p.rot ?? 0;
  return `translate(${cx} ${groundY + y}) rotate(${rot}) scale(${p.sx} ${p.sy}) translate(${-cx} ${-groundY})`;
}
