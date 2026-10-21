/**
 * Morphable face geometry, shared by the live <CharacterView> and the still characterSvg().
 * Every eye and every mouth uses ONE command structure (M + 2 cubic + Z), so framer-motion can
 * interpolate `d` between any two expressions: no swaps, no pops.
 *
 * Minimal face (STYLE §4, §7): small solid ink ovals (ry/rx ≈ 2) set on the dome axis, one
 * small dim catchlight, a tiny stroked smile. Sizes are view-box units on the stage-4 body (150 wide).
 */
export type Expression = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'sleeping';
const K = 4 / 3; // one-cubic half-ellipse handle factor
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Eye lens: half-width w; top bulge t (up); bottom bulge b (down). t+b≈0 → closed arc. */
export interface EyeShape { w: number; t: number; b: number; dx?: number; dy?: number }
/** Mouth lens: corners ±w around mx (+dx), corner lift, upper-lip sag u, lower-lip sag l (both +down). */
export interface MouthShape { w: number; lift: number; u: number; l: number; dx?: number }

export function eyeD(cx: number, cy: number, e: EyeShape): string {
  const x = cx + (e.dx ?? 0), y = cy + (e.dy ?? 0);
  return `M${r2(x - e.w)} ${r2(y)}C${r2(x - e.w)} ${r2(y - K * e.t)} ${r2(x + e.w)} ${r2(y - K * e.t)} ${r2(x + e.w)} ${r2(y)}`
    + `C${r2(x + e.w)} ${r2(y + K * e.b)} ${r2(x - e.w)} ${r2(y + K * e.b)} ${r2(x - e.w)} ${r2(y)}Z`;
}
export function mouthD(mx: number, my: number, m: MouthShape): string {
  const x = mx + (m.dx ?? 0), y = my - m.lift;
  return `M${r2(x - m.w)} ${r2(y)}C${r2(x - m.w / 2)} ${r2(my + m.u)} ${r2(x + m.w / 2)} ${r2(my + m.u)} ${r2(x + m.w)} ${r2(y)}`
    + `C${r2(x + m.w / 2)} ${r2(my + m.l)} ${r2(x - m.w / 2)} ${r2(my + m.l)} ${r2(x - m.w)} ${r2(y)}Z`;
}
/** Open eyes are filled ovals with a highlight; closed eyes (arcs) are 2.55 ink strokes. */
export const eyeOpen = (e: EyeShape) => e.t + e.b > 4;
/** The lips part (an open mouth: speaking, happy, an "o"). */
export const mouthFilled = (m: MouthShape) => m.l - m.u > 4;

/** Stage-1/2 eyes are smaller (progressive face): a dot, then a small oval. Stage ≥ 3 uses the expression table. */
export const STAGE_EYE: Record<1 | 2, EyeShape> = { 1: { w: 3.5, t: 3.5, b: 3.5 }, 2: { w: 3.4, t: 6.2, b: 6.2 } };
/**
 * Tall narrow ovals (rendered height ≈ 2 × width, as the reference). Listening opens them wider; thinking
 * glances up toward the thought dots and narrows a little, so each state reads without its fx.
 */
export const EYE: Record<Expression | 'blink' | 'surprised', EyeShape> = {
  idle: { w: 4, t: 8.6, b: 8.6 },
  listening: { w: 4.8, t: 10.2, b: 9.8 },
  thinking: { w: 3.9, t: 7.2, b: 6.4, dx: 2.2, dy: -2.8 },
  speaking: { w: 4, t: 8.1, b: 8.1 },
  happy: { w: 5, t: 3.4, b: -3.4, dy: 1.5 }, // ∩ arch
  sleeping: { w: 5, t: -2.6, b: 2.6, dy: 1 }, // ∪ lid
  blink: { w: 4.6, t: 0.6, b: 0.6 },
  surprised: { w: 5, t: 10.2, b: 10.2 },
};
export const MOUTH = {
  none: { w: 0.5, lift: 0, u: 0, l: 0 },
  wisp: { w: 2.2, lift: 0.9, u: 0.8, l: 1.2 }, // stage 1: the smallest smile, so stage 2 is a gentle step
  flat: { w: 3, lift: 1.3, u: 1.1, l: 1.6 }, // stage 2: a tiny upturned smile (the first warm cue)
  idle: { w: 7.7, lift: 2.2, u: 2.3, l: 2.9 }, // near-hairline lens under a 2.55 stroke: the reference smile (A1's width)
  happy: { w: 8.6, lift: 2.6, u: -0.4, l: 7.5 }, // open D-smile
  listening: { w: 1.8, lift: 0, u: -2.3, l: 2.3 }, // a small "o"
  thinking: { w: 3.4, lift: 1, u: 0.2, l: 0.8, dx: 3.4 }, // a short side smirk
  sleeping: { w: 0.6, lift: 0, u: -0.9, l: 0.9 }, // dot
  yawn: { w: 3, lift: -1, u: -4, l: 4.5 },
} satisfies Record<string, MouthShape>;
/** Speaking mouth from openness o∈[0,1] and optional width bias wb∈[-1,1] (spectral centroid: ee vs oo). */
export const talkMouth = (o: number, wb = 0): MouthShape => ({ w: (6.5 - o * 1.5) * (1 + 0.15 * wb), lift: 0.6 - o * 1.4, u: -o * 2, l: 1.2 + o * 7.5 });
/**
 * How far a mouth shape stands open (0 closed .. 1 a full talking "ah"), from its lip gap: the beak's lower
 * mandible drops by this (a talking beak opens; a resting one stays shut).
 */
export const mouthOpenness = (m: MouthShape) => Math.max(0, Math.min(1, (m.l - m.u - 2.5) / 7.5));

/** Openness a still "speaking" frame shows. */
export const SPEAKING_STILL = 0.6;
/** Eye shape for an expression at a stage (dot eyes until stage 3; a sleeper's lids close at any stage). */
export const eyeFor = (expr: Expression, stage: number): EyeShape => (stage < 3 && expr !== 'sleeping' ? STAGE_EYE[Math.max(1, stage) as 1 | 2] : EYE[expr]);
/** Mouth shape for an expression at a stage (the smallest smile at stage 1, a tiny smile at stage 2). */
export function mouthFor(expr: Expression, stage: number): MouthShape {
  if (stage <= 1) return expr === 'sleeping' ? MOUTH.sleeping : MOUTH.wisp;
  if (stage === 2) return expr === 'speaking' ? talkMouth(SPEAKING_STILL * 0.7) : expr === 'sleeping' ? MOUTH.sleeping : MOUTH.flat;
  return expr === 'speaking' ? talkMouth(SPEAKING_STILL) : MOUTH[expr];
}
/** Uniform eye scale (small LOD enlarges the eyes so faces read at 24–56 px). */
export const scaleEye = (e: EyeShape, s: number): EyeShape => (s === 1 ? e : { ...e, w: e.w * s, t: e.t * s, b: e.b * s });
