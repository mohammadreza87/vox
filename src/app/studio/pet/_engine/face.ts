/**
 * The pet's faces as morph targets (brief §2.4, §2.5): eye shapes per PetExpr, mouth shapes per MouthKey and
 * viseme, brow geometry and the body path tween. Pure: the loop springs between these numbers and rebuilds the
 * `d` strings (no CSS `d` animation, §3.1). Pet-only faces never become a CharacterView prop (decision 11).
 */

import { EYE, MOUTH, STAGE_EYE, talkMouth, type Expression, type EyeShape, type MouthShape } from '@/lib/studio/character';
import { ringsOf } from '@/lib/studio/character/accessories';
import type { Stage } from '@/lib/studio/types';
import type { MouthKey, PetExpr } from './types';

/* ---------- eyes ---------- */

/** Stage ≥ 3 eyes per expression (view-box units on the stage-4 body, before the model's eye scale). */
export const PET_EYE: Record<PetExpr, EyeShape> = {
  idle: EYE.idle, listening: EYE.listening, thinking: EYE.thinking, speaking: EYE.speaking, happy: EYE.happy, sleeping: EYE.sleeping,
  surprised: EYE.surprised,
  // >_< : flat squeezed arcs
  squeeze: { w: 5.4, t: 1.5, b: -1.5, dy: 0.6 },
  // round, a touch small: the gaze rolls them (an oscillation), the spiral is the motion
  dizzy: { w: 4.6, t: 6.2, b: 6.2 },
  // lids at ~0.45: the top flattens, the eye sits low
  bliss: { w: 4.5, t: 2.4, b: 5.2, dy: 1.6 },
  shy: { w: 4, t: 7.8, b: 8.2, dy: 0.6 },
  // outer lid down
  sad: { w: 4, t: 7, b: 8.6, dy: 0.6 },
  offended: { w: 4.3, t: 5, b: 8.2, dy: 1 },
  grumpy: { w: 4.4, t: 4, b: 7.6, dy: 1.4 },
  wink: EYE.idle,
};

/** Faces whose eyes are closed arcs (no blinks, no glints). */
export const CLOSED_EYES: ReadonlySet<PetExpr> = new Set(['happy', 'sleeping', 'squeeze']);

/** The eye an expression shows at a stage: dot eyes until stage 3 (closed arcs scale down with them). */
export function petEye(expr: PetExpr, stage: Stage): EyeShape {
  if (stage >= 3) return PET_EYE[expr] ?? EYE.idle;
  const dot = STAGE_EYE[Math.max(1, stage) as 1 | 2];
  if (CLOSED_EYES.has(expr)) { const a = PET_EYE[expr], k = stage === 2 ? 0.75 : 0.6; return { ...a, w: a.w * k, t: a.t * k, b: a.b * k, dy: (a.dy ?? 0) * k }; }
  if (expr === 'surprised') return { ...dot, w: dot.w * 1.15, t: dot.t * 1.15, b: dot.b * 1.15 };
  if (expr === 'bliss' || expr === 'grumpy') return { ...dot, t: dot.t * 0.45, dy: 0.6 };
  return dot;
}

/** The structural Expression CharacterView draws for a pet face (brows, blush on happy, fx puffs, Z). */
export function structural(expr: PetExpr): Expression {
  switch (expr) {
    case 'idle': case 'listening': case 'thinking': case 'speaking': case 'happy': case 'sleeping': return expr;
    case 'squeeze': return 'happy';
    default: return 'idle';
  }
}

/** Eye with a per-eye lid (1 open … ~0.08 shut): the upper lid comes down, the lower barely moves. */
export function lidEye(e: EyeShape, lid: number, pupil: number): EyeShape {
  // a closed arc (happy, asleep, squeezed) is already shut: lids do not apply
  const l = e.t + e.b < 1 ? 1 : Math.max(0.06, Math.min(1.2, lid));
  const t = e.t * pupil, b = e.b * pupil;
  return { w: e.w * pupil, t: t * l, b: b * (0.55 + 0.45 * l), dx: e.dx ?? 0, dy: (e.dy ?? 0) + (1 - Math.min(1, l)) * t * 0.35 };
}

/** How open an eye shape reads (0 a closed arc … 1 a full oval): the stroke/fill mix and the glint follow it. */
export const eyeOpenness = (e: EyeShape) => Math.max(0, Math.min(1, (e.t + e.b - 1.5) / 6));

/* ---------- mouths ---------- */

/** Mouth per key at stage ≥ 3; X is the stage's rest (the mood mouth). */
export const MOUTH_KEY: Record<Exclude<MouthKey, 'X'>, MouthShape> = {
  A: { w: 5.6, lift: 1.2, u: 1.4, l: 1.7 }, // pressed (MBP, "mm-mm")
  B: talkMouth(0.3, 0.9), // teeth, EE
  C: talkMouth(0.55, 0.3), // open EH
  D: talkMouth(0.95, 0.15), // wide AA
  E: talkMouth(0.6, -0.5), // round AO ("aww")
  F: talkMouth(0.32, -1), // pucker OO ("mmm", hum)
  smile: MOUTH.idle,
  grin: MOUTH.happy,
  o: MOUTH.listening,
  w: { w: 4.4, lift: 1.9, u: 0.5, l: 2.8 },
  yawn: { w: 4, lift: -1.5, u: -5.6, l: 6.4 },
  sleep: MOUTH.sleeping,
  smirk: MOUTH.thinking,
};

const scaleMouth = (m: MouthShape, k: number): MouthShape => ({ w: m.w * k, lift: m.lift * k, u: m.u * k, l: m.l * k, dx: (m.dx ?? 0) * k });

/** The mouth a key shows at a stage (a wisp at 1, the tiny smile at 2). */
export function petMouth(key: MouthKey, stage: Stage): MouthShape {
  if (key === 'X') return stage <= 1 ? MOUTH.wisp : stage === 2 ? MOUTH.flat : MOUTH.idle;
  const m = MOUTH_KEY[key] ?? MOUTH.idle;
  return stage >= 3 ? m : scaleMouth(m, stage === 2 ? 0.72 : 0.5);
}

/** Lip-sync on top of the key: the talking mouth by openness o (0 … 1) and width bias wb (−1 OO … +1 EE). */
export function mixMouth(base: MouthShape, o: number, wb: number, stage: Stage): MouthShape {
  if (o <= 0.001) return base;
  const k = stage >= 3 ? 1 : stage === 2 ? 0.72 : 0.5;
  const t = scaleMouth(talkMouth(Math.min(1, o), Math.max(-1, Math.min(1, wb))), k);
  const w = Math.min(1, o * 3);
  return { w: base.w + (t.w - base.w) * w, lift: base.lift + (t.lift - base.lift) * w, u: base.u + (t.u - base.u) * w, l: base.l + (t.l - base.l) * w, dx: (base.dx ?? 0) * (1 - w) };
}

/** Text → viseme (§1.4): vowels → D/E/F, consonants → B, spaces and punctuation → X. */
export function visemeOf(ch: string): 'X' | 'B' | 'D' | 'E' | 'F' {
  const c = ch.toLowerCase();
  if (/[aeiäàáâæıíìîéèêë]/.test(c)) return 'D';
  if (/[oòóôöœ]/.test(c)) return 'E';
  if (/[uùúûüwy]/.test(c)) return 'F';
  if (/[\s.,!?;:…'"()\-–—]/.test(c) || c === '') return 'X';
  // other scripts: letters still talk (alternating open and teeth reads as speech)
  return /\p{L}/u.test(c) ? (c.charCodeAt(0) % 2 ? 'D' : 'B') : 'X';
}
/** Openness and width per viseme (what the text path and the reactions' `viseme` aim at). */
export const VISEME_SHAPE: Record<'X' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F', { open: number; width: number }> = {
  X: { open: 0, width: 0 }, A: { open: 0.04, width: 0 }, B: { open: 0.3, width: 0.85 }, C: { open: 0.55, width: 0.3 },
  D: { open: 0.88, width: 0.15 }, E: { open: 0.6, width: -0.5 }, F: { open: 0.32, width: -1 },
};

/* ---------- brows ---------- */

/**
 * Both brows as one path (the model's `brows` part: soft dashes over the glasses-ring centres, 19 u above the
 * eyes). raise lifts each brow, inner lifts the inner ends (− furrows), arch 1 is the model's curve, 0 flat.
 */
export function browsD(eyes: [{ cx: number; cy: number }, { cx: number; cy: number }], raiseL: number, raiseR: number, inner: number, arch = 1): string {
  const ey = eyes[0].cy, rings = ringsOf(eyes[0].cx, eyes[1].cx, ey), by = ey - 19;
  const r = (n: number) => Math.round(n * 100) / 100;
  return [rings.L, rings.R].map((x, i) => {
    const raise = i ? raiseR : raiseL;
    // the inner end of the left brow is its right end, and the other way round
    const yl = by + 1 - raise - (i === 1 ? inner : 0), yr = by + 1 - raise - (i === 0 ? inner : 0);
    const yc = by + 1 - raise - 2.6 * arch - inner * 0.5;
    return `M${r(x - 4)} ${r(yl)}Q${r(x)} ${r(yc)} ${r(x + 4)} ${r(yr)}`;
  }).join('');
}

/* ---------- body path tween (stage-up morph) ---------- */

const NUM = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;
/** Tween two paths of one command structure number by number (the body rig is always M + 8 C + Z). */
export function lerpPath(a: string, b: string, t: number): string {
  if (t <= 0 || a === b) return a;
  if (t >= 1) return b;
  const nb = b.match(NUM);
  if (!nb) return t < 0.5 ? a : b;
  let i = 0;
  const out = a.replace(NUM, (m) => { const v = Number(m), w = Number(nb[i++] ?? m); return String(Math.round((v + (w - v) * t) * 100) / 100); });
  return i === nb.length ? out : t < 0.5 ? a : b;
}
