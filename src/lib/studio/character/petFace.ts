/**
 * Pet-only face parts (the agent pet Mini App): geometry for the extra marks the pet rig can show over the face kit,
 * a tongue inside a wide-open mouth, sparkle highlights for wanting eyes and dizzy swirls. Nothing here is part of
 * the character model: Studio never draws these. CharacterView renders them only when the matching rig binding is
 * given (and the pet's frame-sheet writer draws the same geometry), so every still and every Studio view is
 * unchanged.
 */

import { EYE } from './face';
import { modelEye, type CharacterModel } from './model';

/** The tongue's paint: a warm pink, a step deeper than the blush, so it reads on the ink of the open mouth. */
export const TONGUE = '#E9798C';
/** The tongue is a circle of this radius at the mouth centre, placed and scaled by its binding. */
export const TONGUE_R = 10;
/** Sparkle highlights are pure white (brighter than the dim catch-light). */
export const SPARKLE = '#FFFFFF';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The tongue's base circle (before its binding moves and scales it). */
export const tongueBase = (m: Pick<CharacterModel, 'face'>) => ({ cx: m.face.mouth.x, cy: m.face.mouth.y, r: TONGUE_R });

/**
 * Two white highlights per eye for sparkly, wanting eyes: a big one high on the outer side and a small one low on
 * the inner side (the anime "starry eye"), sized for the dilated eye (×1.15) at rest. Their group moves with the
 * eyes' gaze offset.
 */
export function sparklePts(m: Pick<CharacterModel, 'face'>): Array<{ cx: number; cy: number; r: number }> {
  const e = modelEye(m, EYE.idle), k = 1.15, w = e.w * k, t = e.t * k, s = m.face.eyeScale;
  return m.face.eyes.flatMap(({ cx, cy }, i) => {
    const out = i ? 1 : -1;
    return [
      { cx: r2(cx + out * w * 0.18 + w * 0.12), cy: r2(cy - t * 0.42), r: r2(1.75 * s) },
      { cx: r2(cx - out * w * 0.3), cy: r2(cy + t * 0.36), r: r2(0.85 * s) },
    ];
  });
}

/** One sparkle highlight as path data (a circle as two arcs). */
export const dotD = (cx: number, cy: number, r: number) => `M${r2(cx - r)} ${r2(cy)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;

/** A dizzy swirl centred on an eye: an Archimedean spiral of ~2.2 turns out to radius r, drawn as a stroked line. */
export function swirlD(cx: number, cy: number, r: number, turns = 2.2): string {
  const n = 40, pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, th = u * turns * 2 * Math.PI, rr = r * (0.12 + 0.88 * u);
    pts.push(`${r2(cx + rr * Math.cos(th))} ${r2(cy + rr * Math.sin(th))}`);
  }
  return `M${pts[0]}L${pts.slice(1).join(' ')}`;
}

/** The swirl's radius for a model (a little smaller than the open eye's half-height). */
export const swirlR = (m: Pick<CharacterModel, 'face'>) => r2(modelEye(m, EYE.idle).t * 0.78);
