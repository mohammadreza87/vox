/**
 * The pet's faces as morph targets (brief §2.4, §2.5): eye shapes per PetExpr, mouth shapes per MouthKey and
 * viseme, brow geometry and the body path tween. Pure: the loop springs between these numbers and rebuilds the
 * `d` strings (no CSS `d` animation, §3.1). Pet-only faces never become a CharacterView prop (decision 11).
 */

import { EYE, eyeD, MOUTH, mouthD, STAGE_EYE, talkMouth, type Expression, type EyeShape, type MouthShape } from '@/lib/studio/character';
import { ringsOf } from '@/lib/studio/character/accessories';
import type { Stage } from '@/lib/studio/types';
import type { MouthKey, PetExpr } from './types';

/* ---------- eyes ---------- */

/**
 * A pet eye: the kit's lens plus two pet-only morphs. `v` blends the lens into a '>' / '<' chevron pointing at the
 * nose (squeezed laughing eyes); `sw` shows the dizzy swirl over the eye (the eye itself shrinks to its centre dot).
 * Both 0 is exactly the kit's eye.
 */
export interface PetEyeShape extends EyeShape { v?: number; sw?: number }

/** Stage ≥ 3 eyes per expression (view-box units on the stage-4 body, before the model's eye scale). */
export const PET_EYE: Record<PetExpr, PetEyeShape> = {
  idle: EYE.idle, listening: EYE.listening, thinking: EYE.thinking, speaking: EYE.speaking, happy: EYE.happy, sleeping: EYE.sleeping,
  surprised: EYE.surprised,
  // >_< : squeezed chevrons pointing at the nose (laughing, tickled, sneezing)
  squeeze: { w: 4.4, t: 1.2, b: -1.2, dy: 0.4, v: 1 },
  // @_@ : the eye shrinks to a dot under a turning swirl
  dizzy: { w: 0.9, t: 0.9, b: 0.9, sw: 1 },
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
export function petEye(expr: PetExpr, stage: Stage): PetEyeShape {
  if (stage >= 3) return PET_EYE[expr] ?? EYE.idle;
  const dot = STAGE_EYE[Math.max(1, stage) as 1 | 2];
  if (CLOSED_EYES.has(expr)) { const a = PET_EYE[expr], k = stage === 2 ? 0.75 : 0.6; return { ...a, w: a.w * k, t: a.t * k, b: a.b * k, dy: (a.dy ?? 0) * k }; }
  if (expr === 'surprised') return { ...dot, w: dot.w * 1.15, t: dot.t * 1.15, b: dot.b * 1.15 };
  if (expr === 'dizzy') return PET_EYE.dizzy;
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
export function lidEye(e: PetEyeShape, lid: number, pupil: number): PetEyeShape {
  // a closed arc (happy, asleep, squeezed) is already shut: lids do not apply
  const l = e.t + e.b < 1 ? 1 : Math.max(0.06, Math.min(1.2, lid));
  const t = e.t * pupil, b = e.b * pupil;
  const out: PetEyeShape = { w: e.w * pupil, t: t * l, b: b * (0.55 + 0.45 * l), dx: e.dx ?? 0, dy: (e.dy ?? 0) + (1 - Math.min(1, l)) * t * 0.35 };
  if (e.v) out.v = e.v;
  if (e.sw) out.sw = e.sw;
  return out;
}

const K = 4 / 3;
const p2 = (x: number, y: number) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
/**
 * The eye path with the pet morphs: the kit's eyeD when `v` is 0 (byte for byte), else the lens's six points blended
 * toward a chevron pointing `dir` (+1 right: the left eye's '>', −1 left: the right eye's '<'). Same command
 * structure (M + 2 C + Z), so it springs number by number.
 */
export function petEyeD(cx: number, cy: number, e: PetEyeShape, dir: 1 | -1): string {
  const v = Math.max(0, Math.min(1, e.v ?? 0));
  if (v < 1e-3) return eyeD(cx, cy, e);
  const x = cx + (e.dx ?? 0), y = cy + (e.dy ?? 0), w = e.w, s = dir;
  const lens: Array<[number, number]> = [[x - w, y], [x - w, y - K * e.t], [x + w, y - K * e.t], [x + w, y], [x + w, y + K * e.b], [x - w, y + K * e.b]];
  // outer ends at ±h, the outer edge pulled to a rounded tip at the nose side, the inner edge a little behind it
  const h = w * 0.9;
  const chev: Array<[number, number]> = [[x - s * w, y - h], [x + s * w * 1.55, y - h * 0.08], [x + s * w * 1.55, y + h * 0.08], [x - s * w, y + h], [x + s * w * 1.1, y + h * 0.06], [x + s * w * 1.1, y - h * 0.06]];
  const p = lens.map(([a, b], i) => p2(a + (chev[i][0] - a) * v, b + (chev[i][1] - b) * v));
  return `M${p[0]}C${p[1]} ${p[2]} ${p[3]}C${p[4]} ${p[5]} ${p[0]}Z`;
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
  // the eating mouths: 'aah' (anticipation, a dark rounded opening with a tongue), 'wide' (the biggest, ~45 % of the
  // face, cheek to cheek), and 'chew' (pressed small between puffed cheeks)
  aah: { w: 11.5, lift: -1.2, u: -2.8, l: 14.5 },
  wide: { w: 16, lift: -1.4, u: -4.6, l: 20.5 },
  chew: { w: 5.6, lift: 1.1, u: 0.5, l: 3 },
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

const lerpMouth = (a: MouthShape, b: MouthShape, t: number): MouthShape => ({
  w: a.w + (b.w - a.w) * t, lift: a.lift + (b.lift - a.lift) * t, u: a.u + (b.u - a.u) * t, l: a.l + (b.l - a.l) * t, dx: (a.dx ?? 0) * (1 - t) + (b.dx ?? 0) * t,
});

/** A pet mouth: the kit's lens plus `r`, how round the opening's bowl is (0 the kit's lens … 1 a round "D"). */
export interface PetMouthShape extends MouthShape { r?: number }

/**
 * The eating gape over whatever the mouth shows: g 0 leaves it, 1 is the 'aah', 2 the widest (a spring's overshoot
 * past 2 opens a touch more, up to 2.25). The opening rounds out as it gapes.
 */
export function gapeMouth(base: MouthShape, g: number, stage: Stage): PetMouthShape {
  if (g <= 1e-3) return base;
  const k = stage >= 3 ? 1 : stage === 2 ? 0.72 : 0.5;
  const aah = scaleMouth(MOUTH_KEY.aah, k), wide = scaleMouth(MOUTH_KEY.wide, k);
  const m = g <= 1 ? lerpMouth(base, aah, g) : lerpMouth(aah, wide, Math.min(1.25, g - 1));
  return { ...m, r: Math.min(1, g) };
}

/**
 * The mouth path with the pet's roundness: the kit's mouthD when `r` is 0 (byte for byte); else the handles spread
 * out toward the corners, so a wide-open mouth is a rounded bowl instead of a pointed lens. Same command structure.
 */
export function petMouthD(mx: number, my: number, m: PetMouthShape): string {
  const r = Math.max(0, Math.min(1, m.r ?? 0));
  if (r < 1e-3) return mouthD(mx, my, m);
  const x = mx + (m.dx ?? 0), y = my - m.lift, hu = m.w * (0.5 + 0.38 * r), hl = m.w * (0.5 + 0.5 * r);
  const q = (a: number, b: number) => `${Math.round(a * 100) / 100} ${Math.round(b * 100) / 100}`;
  return `M${q(x - m.w, y)}C${q(x - hu, my + m.u)} ${q(x + hu, my + m.u)} ${q(x + m.w, y)}C${q(x + hl, my + m.l)} ${q(x - hl, my + m.l)} ${q(x - m.w, y)}Z`;
}

/**
 * The tongue inside an open lens mouth (centre x/y in view-box units, radii, opacity): a pink mound resting on the
 * lower lip, clipped by the mouth. Hidden until the lips part ~5 u.
 */
export function tongueOf(m: MouthShape, mx: number, my: number): { x: number; y: number; rx: number; ry: number; o: number } {
  const h = 0.75 * (m.l - m.u), bottom = 0.25 * (my - m.lift) + 0.75 * (my + m.l);
  const o = Math.max(0, Math.min(1, (h - 8) / 4));
  // it rests just inside the lower lip's ink rim (the bowl's sides clip its flanks), never over the rim
  const ry = Math.max(0.5, h * 0.3);
  return { x: mx + (m.dx ?? 0), y: bottom - 1.5 - ry, rx: Math.max(0.5, m.w * 0.62), ry, o };
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

/**
 * How far a beak's lower mandible drops for a mouth (the kit's mouthOpenness, which stops at a talking "ah"), let
 * run on to 1.7 for the eating gape: a chick's beak opens wide for the cookie.
 */
export const beakOpen = (m: MouthShape) => Math.max(0, Math.min(1.7, (m.l - m.u - 2.5) / 7.5));

/** A bump on the body outline: at height y (view-box), relative amount a (of the half-width there), spread s. */
export interface Bulge { y: number; a: number; s: number }

/**
 * Bulge the body outline sideways about the axis cx: each knot moves out by Σ a·exp(−((y − yᵢ)/sᵢ)²) of its distance
 * from the axis, and its two handles move with it (the same affine stretch), so the outline stays smooth (cheeks
 * puffing at the cheek line, a gulp travelling down). For an M + n C + Z path; the command structure is kept.
 */
export function bulgePath(d: string, cx: number, bulges: readonly Bulge[]): string {
  const live = bulges.filter((b) => Math.abs(b.a) > 1e-4);
  if (!live.length) return d;
  const at = (y: number) => { let f = 0; for (const b of live) f += b.a * Math.exp(-(((y - b.y) / b.s) ** 2)); return f; };
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length % 2) return d;
  const pts = Array.from({ length: nums.length / 2 }, (_, i) => [Number(nums[2 * i]), Number(nums[2 * i + 1])]);
  // knot of each point: M and every third point after it are knots; a handle follows the knot it leaves or meets
  const knotOf = (i: number) => (i === 0 ? 0 : i % 3 === 1 ? i - 1 : i % 3 === 2 ? i + 1 : i);
  let i = 0;
  return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_m, xs: string, ys: string) => {
    const k = pts[Math.min(pts.length - 1, knotOf(i++))], f = at(k[1]);
    return `${Math.round((cx + (Number(xs) - cx) * (1 + f)) * 100) / 100} ${ys}`;
  });
}
