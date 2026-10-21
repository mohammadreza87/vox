/**
 * Hair (STYLE §5.3): one tiny shape in the hair-tone material, from stage 3.
 * Pieces either sit in front of the body (tuft, curls, bun, and the fringe and
 * pony part clipped to it), hang from behind the head over a shoulder (the
 * pony tail), or peek out from behind it (spiky), so nothing ever reads as a
 * wig, a helmet, a cap or a patch pasted on the body.
 * Every piece is a soft rounded form: no hard wedge, stem or floating ball.
 */

import type { HairStyle } from '../types';
import { boundsOf, circle, domePt, ellipse, r1, roundTri, type Pt, type Shape, type Silhouette } from './geometry';

export interface HairBuild {
  /** in front of the body; `clip` pieces are clipped to the body */
  front: Shape[];
  clip?: boolean;
  /** front pieces clipped to outside the dome circle: they hang from behind the head */
  outside?: boolean;
  /** in front of the body, clipped to outside the dome circle (the pony tail falling over the shoulder) */
  hang?: Shape[];
  /** behind the body */
  back: Shape[];
  /** a tie (a small band in the accent colour, `len` long, across the hair at `rot` degrees): the pony's where the tail leaves the head, the bun's wrap */
  tie?: { x: number; y: number; rot: number; len?: number };
  /** transform origin of the hair rig (sway, pop) */
  root: Pt;
}

const path = (d: string, pts: Pt[]): Shape => ({ k: 'p', d, box: boundsOf(pts) });
const P = ([x, y]: Pt) => `${r1(x)} ${r1(y)}`;

/** A closed smooth path through points (Catmull-Rom as cubics): soft, rounded ends, no corners. */
function smooth(pts: Pt[]): Shape {
  const m = pts.length, at = (i: number) => pts[(i + m) % m];
  let d = `M${P(pts[0])}`;
  const all: Pt[] = [...pts];
  for (let i = 0; i < m; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${P(c1)} ${P(c2)} ${P(p2)}`;
    all.push(c1, c2);
  }
  return path(d + 'Z', all);
}

/** A teardrop from a narrow root (hidden behind the body) out to a round bulb. */
function teardrop(root: Pt, bulb: Pt, rb: number, w0: number): Shape {
  const L = Math.hypot(bulb[0] - root[0], bulb[1] - root[1]), u: Pt = [(bulb[0] - root[0]) / L, (bulb[1] - root[1]) / L], nn: Pt = [-u[1], u[0]];
  const q = (p: Pt, a: Pt, k: number, b: Pt = [0, 0], j = 0): Pt => [p[0] + a[0] * k + b[0] * j, p[1] + a[1] * k + b[1] * j];
  const a = q(root, nn, w0), b = q(bulb, nn, rb), tip = q(bulb, u, rb), c = q(bulb, nn, -rb), d = q(root, nn, -w0);
  const pts: Pt[] = [a, q(a, u, L * 0.45), q(b, u, -rb * 0.55), b, q(b, u, rb * 0.55), q(tip, nn, rb * 0.55), tip, q(tip, nn, -rb * 0.55), q(c, u, rb * 0.55), c, q(c, u, -rb * 0.55), q(d, u, L * 0.45), d];
  const [p0, ...rest] = pts;
  let dd = `M${P(p0)}`;
  for (let i = 0; i < rest.length; i += 3) dd += `C${P(rest[i])} ${P(rest[i + 1])} ${P(rest[i + 2])}`;
  return path(dd + 'Z', pts);
}

/**
 * A crescent of hair along the dome (clipped to the body, so its outer edge IS the head's outline): from θ0 to θ1
 * degrees, its inner edge `th` deep at most, thickest at `peak` (0..1 along it) and tapering to soft points.
 */
function swoop(s: Silhouette, th0: number, th1: number, th: number, peak = 0.4, lead = 0.9): Shape {
  const n = 11, out: Pt[] = [], inn: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, a = th0 + (th1 - th0) * f;
    // a skewed bump: 0 at both ends, 1 at `peak`; a low `lead` keeps the leading end full (a bang falling down the side)
    const x = f < peak ? f / peak : (1 - f) / (1 - peak), d = 0.6 + th * Math.sin((Math.PI / 2) * Math.max(0, x)) ** (f < peak ? lead : 0.9);
    out.push(domePt(s, a, 3));
    inn.push(domePt(s, a, -d));
  }
  return smooth([...out, ...inn.slice(1, -1).reverse()]);
}

/** Where a hairstyle has to make room: a hat (the fringe gives way), ears on the crown (cat, bunny). */
export interface HairOpts { hat?: boolean; crownEars?: boolean }

export function hairParts(hair: HairStyle, s: Silhouette, o: HairOpts = {}): HairBuild | null {
  const { cx: dx } = s.dome, top = s.top;
  const root: Pt = [dx, top + 4];
  switch (hair) {
    case 'tuft': {
      const k = TUFT_K;
      if (o.crownEars) {
        // between ears, three curls read as a dark spiky leaf in the ear gap: one plump rounded curl instead, its
        // root a little forward on the dome (in front of the ear gap), its tip curling over to the right
        const oy = top + 6 + TUFT_FORWARD;
        const z = ([x, y]: Pt): Pt => [dx + x * k, oy + y * k];
        return {
          front: [smooth(([[-6.5, 3.5], [-7.5, -3], [-4.5, -8.5], [1.5, -11], [7.5, -9.5], [10, -5.5], [6.5, -5], [3, -3.5], [4.5, 3.5]] as Pt[]).map(z))],
          back: [], root: [dx, oy - 2],
        };
      }
      // a short swoosh of three rounded curls on the crown, sweeping right: plump enough to read at 48 px (never a
      // stalk or a stem); the roots sit inside the dome so the curls grow out of it
      const o0: Pt = [dx, top + 6];
      const z = ([x, y]: Pt): Pt => [o0[0] + (x - o0[0]) * k, o0[1] + (y - o0[1]) * k];
      return {
        front: [
          teardrop(z([dx - 7, top + 6.5]), z([dx - 4.5, top - 3.5]), 4.6 * k, 4 * k),
          teardrop(z([dx - 2, top + 6.5]), z([dx + 3.5, top - 5]), 4.3 * k, 3.6 * k),
          teardrop(z([dx + 2.5, top + 7]), z([dx + 10, top - 1]), 3.5 * k, 3 * k),
        ],
        back: [], root: [dx, top + 2],
      };
    }
    case 'fringe': {
      // under a hat the fringe gives way entirely: what showed under the brim was only a stray sliver
      if (o.hat) return null;
      // a side-swept bang across the upper-left dome, clipped to the head (so its outer edge IS the head's outline):
      // thick on the left, where it falls toward the brow line, tapering over the crown past the centre. A mass of
      // hair, never a rim line or a headband
      return { front: [swoop(s, -86, 54, FRINGE.th, FRINGE.peak, 0.45)], clip: true, back: [], root };
    }
    case 'bun': {
      // a slightly flattened top-knot sitting ON the crown (in front of the body, seated into the dome), with a short
      // wrap in the accent colour at its base: hair gathered into a knot, never a lid knob
      const cy = top + BUN.drop;
      return { front: [ellipse(dx, cy, BUN.rx, BUN.ry)], back: [], tie: { x: dx, y: cy + BUN.ry * 0.72, rot: 90, len: BUN.rx * 1.5 }, root: [dx, cy + BUN.ry] };
    }
    case 'curls': {
      // three soft puffs (STYLE §5.3: r 9 / 10 / 9 on the crown) drawn as ONE shape, so a single gradient runs over
      // them and they read as one wavy crown of curls (never three separate beads)
      const puffs = ([[-32, 9], [0, 10], [32, 9]] as const).map(([a, r]) => { const [x, y] = domePt(s, a, -5); return circle(x, y, r); });
      // (circles as cubics, not arcs: the outline points then stay real points for the photo crop)
      const k = 0.5523;
      const ring = ({ cx, cy, r }: { cx: number; cy: number; r: number }) => {
        const q = r * k;
        return `M${P([cx + r, cy])}C${P([cx + r, cy + q])} ${P([cx + q, cy + r])} ${P([cx, cy + r])}C${P([cx - q, cy + r])} ${P([cx - r, cy + q])} ${P([cx - r, cy])}`
          + `C${P([cx - r, cy - q])} ${P([cx - q, cy - r])} ${P([cx, cy - r])}C${P([cx + q, cy - r])} ${P([cx + r, cy - q])} ${P([cx + r, cy])}Z`;
      };
      return { front: [path(puffs.map(ring).join(''), puffs.flatMap((c) => [[c.cx - c.r, c.cy - c.r], [c.cx + c.r, c.cy + c.r]] as Pt[]))], back: [], root };
    }
    case 'spiky':
      // a messy shock of three soft spikes of uneven length, the outer ones flung well out (never a symmetric crown
      // or a row of dino plates), close enough on the crown that cat and bear ears never hide them
      return { front: [], back: SPIKES.map(([a, len, lean]) => roundTri(domePt(s, a, -4), a * 1.8 + lean, 8, len, 3)), root };
    case 'pony': {
      // a swept part over the crown (clipped to the head), gathered by a tie at the upper right, from where a soft
      // teardrop tail hangs down and out over the right shoulder: the crown says hair, the tail says pony
      const part = swoop(s, -34, 60, 7.5, 0.62);
      const tie = domePt(s, PONY.at - 9, 0.5);
      const rootT = domePt(s, PONY.at - 4, -3), a = (PONY.hang * Math.PI) / 180;
      const bulb: Pt = [rootT[0] + Math.sin(a) * PONY.len, rootT[1] - Math.cos(a) * PONY.len];
      return { front: [part], clip: true, hang: [teardrop(rootT, bulb, PONY.rb, PONY.w0)], back: [], tie: { x: tie[0], y: tie[1], rot: PONY.at - 9 }, root: tie };
    }
    default:
      return null;
  }
}

/** The fringe: depth `th` of the side-swept bang, thickest at `peak` (0..1 from the left side). */
export const FRINGE = { th: 15, peak: 0.3 };
/** The crown tuft between ears sits this much further forward (down onto the dome) than the three-curl tuft. */
export const TUFT_FORWARD = 4;
/** The bun: a flattened knot (rx × ry) whose centre sits `drop` below the top of the head. */
export const BUN = { rx: 13, ry: 11, drop: -1 };
/** Spiky: [angle on the dome, length, extra lean] per spike (the outer ones lean out at 1.8 × their angle). */
export const SPIKES: ReadonlyArray<readonly [number, number, number]> = [[-19, 17, 0], [0, 24, 6], [19, 15, 0]];

/** Tuft scale over the sketch (so its curls still read at 48 px). */
export const TUFT_K = 1.4;
/**
 * The pony: the tie's angle on the dome (+9 past it, clear of cat and bear ears), and the tail: a teardrop hanging
 * at `hang` degrees from vertical (down and out over the right shoulder lobe), `len` to its bulb centre, bulb radius
 * `rb`, root half-width `w0`.
 */
export const PONY = { at: 70, hang: 150, len: 17, rb: 7.8, w0: 4.4 };
