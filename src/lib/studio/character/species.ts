/**
 * Species cues (STYLE §5.2): tiny parts on the SAME body, never a new
 * silhouette: the cloud keeps its dome and shoulder lobes. Ears, tufts and
 * sprouts are painted behind the body in the body's own gradient, so the
 * union reads as one soft form with no seam; the dog's floppy ears are soft
 * drops falling outward from the upper dome past the shoulders, in the body's
 * own material. Owls and chicks add a beak; owl eyes stay the kit's eyes. No noses, muzzles,
 * whiskers, tails or limbs: the face stays the reference face.
 */

import type { CloudSpecies } from '../types';
import { boundsOf, domePt, ellipse, r1, roundTri, softTri, type PathShape, type Pt, type Shape, type Silhouette } from './geometry';

export interface Ear {
  side: -1 | 1;
  shape: Shape;
  /** pink inner ear (bunny) */
  inner?: Shape;
  /** transform origin for the twitch (the ear base, or the top attach for a floppy flap) */
  pivot: Pt;
  /** 'body' = the body's own gradient; 'flap' = a soft darker body tone (dog) */
  tone: 'body' | 'flap';
}

export interface SpeciesFace {
  /** a tiny beak replaces the closed mouth (owl, chick) */
  beak?: boolean;
  /** eye proportions: rounder owl eyes (multipliers on half-width and height) */
  eye?: [number, number];
  /** beak size over the kit's */
  beakK?: number;
}

export interface SpeciesBuild {
  /** behind the body: ears, tufts, sprout */
  back: Ear[];
  /** in front of the body, clipped to outside the dome so they hang from behind the head: dog ears */
  front: Ear[];
  face: SpeciesFace;
}

/** The dog's lop ear: root angle on the dome and offset, hang angle from vertical (+ outward), length, bulb and root radii. */
export const DOG_EAR = { at: 62, off: -3, deg: 135, len: 25, rb: 11.5, w0: 6 };

/** Species parts at growth k (a faint nub at stage 1, 0.7 budding at stage 2, 1 from stage 3). */
/** The owl's feather tufts: angle on the dome (its shoulders, where no hat reaches), offset, lean (up and out), half-base, length, tip radius. */
export const OWL_TUFT = { at: 52, off: -3, deg: 35, w: 7.5, len: 15, tipR: 3 };
/** Under a hat the tufts slide a little further down the shoulders, so their tips peek out below its edge either side. */
export const OWL_TUFT_HAT = { at: 60, deg: 40 };
/**
 * Cat and bear ears under a beret: still the body's own ears behind the hat, slid down the dome to its sides so
 * they peek out either side of the wide, low beret (a cap or beanie crown is narrower: the ears keep their place
 * and their tips peek either side of it). Never repainted in the hat's colour, never horns.
 * Cat: angle on the dome, offset, lean, half-base, length, tip radius. Bear: angle on the dome, offset, radius.
 */
export const BERET_EARS = { cat: { at: 54, off: -5, deg: 48, w: 11, len: 22, tipR: 3.2 }, bear: { at: 54, off: 0, r: 10 } };

/**
 * Species parts at growth k (a faint nub at stage 1, 0.7 budding at stage 2, 1 from stage 3). Under a hat (`hat`)
 * the chick's sprout hides; cat and bear ears stay in the body's material behind the hat, their tips peeking out
 * either side of it (`beret`: slid down the dome's sides, clear of its wide band), and the owl's shoulder tufts
 * sit below any hat.
 */
export function speciesParts(species: CloudSpecies, s: Silhouette, k: number, hat = false, beret = false): SpeciesBuild {
  const out: SpeciesBuild = { back: [], front: [], face: {} };
  // owls keep the kit's eyes (same size as every species); the tufts and the beak are the cue
  if (species === 'owl') out.face = { beak: true, beakK: 1.3 };
  if (species === 'chick') out.face = { beak: true, beakK: 1.5 };
  if (k <= 0 || species === 'cloud') return out;
  for (const side of [-1, 1] as const) {
    switch (species) {
      case 'cat': {
        // one smooth tapered point per side: a rounded triangle with a true round tip, its base buried in the dome
        if (hat && beret) {
          const e = BERET_EARS.cat, at = domePt(s, side * e.at, e.off);
          out.back.push({ side, shape: roundTri(at, side * e.deg, e.w * k, e.len * k, e.tipR * k), pivot: at, tone: 'body' });
          break;
        }
        const at = domePt(s, side * 33, -5);
        out.back.push({ side, shape: roundTri(at, side * 30, 11 * k, 20 * k, 3 * k), pivot: at, tone: 'body' });
        break;
      }
      case 'bear': {
        const e = BERET_EARS.bear, b = hat && beret, [x, y] = b ? domePt(s, side * e.at, e.off) : domePt(s, side * 40, -1), r = b ? e.r : 9.5;
        out.back.push({ side, shape: ellipse(x, y, r * k, r * k), pivot: [x, y + 4], tone: 'body' });
        break;
      }
      case 'bunny': {
        const at = domePt(s, side * 17, 8 * k), rot = side * 14;
        const lift = (len: number): Pt => [at[0] + Math.sin((rot * Math.PI) / 180) * len, at[1] - Math.cos((rot * Math.PI) / 180) * len];
        const c = lift(4), ci = lift(5);
        out.back.push({
          side, shape: ellipse(c[0], c[1], 6.6 * k, 15 * k, rot), inner: ellipse(ci[0], ci[1], 2.6 * k, 9 * k, rot),
          pivot: [at[0], at[1] + 8 * k], tone: 'body',
        });
        break;
      }
      case 'dog': {
        // floppy lop ears: soft drops rooted low on the dome's sides (STYLE §5.2) that hang down past the saddle,
        // their round bulbs dropping beside the cheeks, so the silhouette shows two droops; a step deeper than the
        // body (its shade), never paler, so they read as ears and not as a brim or a bandage
        const root = domePt(s, side * DOG_EAR.at, DOG_EAR.off + (1 - k) * 4), a = (side * DOG_EAR.deg * Math.PI) / 180, L = DOG_EAR.len * k;
        const bulb: Pt = [root[0] + Math.sin(a) * L, root[1] - Math.cos(a) * L];
        out.front.push({ side, shape: leaf(root, bulb, DOG_EAR.rb * k, DOG_EAR.w0 * k), pivot: root, tone: 'flap' });
        break;
      }
      case 'owl': {
        // two short feather tufts seated on the dome's shoulders (so a hat never covers them): soft round-tipped
        // points angled up and out at about 35°, the owl's tell at 48 px, never devil horns or a cat's tall ear
        const t = hat ? { ...OWL_TUFT, ...OWL_TUFT_HAT } : OWL_TUFT, at = domePt(s, side * t.at, t.off);
        out.back.push({ side, shape: roundTri(at, side * t.deg, t.w * k, t.len * k, t.tipR * k), pivot: at, tone: 'body' });
        break;
      }
      case 'chick': {
        if (hat) break;
        const at: Pt = [s.dome.cx + side * 1.5, s.top + 3];
        out.back.push({ side, shape: softTri(at, side * 28, 3.4 * k, 12 * k, 0.6), pivot: at, tone: 'body' });
        break;
      }
    }
  }
  return out;
}

/** A rounded leaf from a narrow root to a round bulb of radius rb (wider at the bottom, no corners). */
function leaf(root: Pt, bulb: Pt, rb: number, w0: number): PathShape {
  const L = Math.hypot(bulb[0] - root[0], bulb[1] - root[1]), u: Pt = [(bulb[0] - root[0]) / L, (bulb[1] - root[1]) / L], nn: Pt = [-u[1], u[0]];
  const q = (p: Pt, a: Pt, k: number, b: Pt = [0, 0], j = 0): Pt => [p[0] + a[0] * k + b[0] * j, p[1] + a[1] * k + b[1] * j];
  const a = q(root, nn, w0), b = q(bulb, nn, rb), tip = q(bulb, u, rb), c = q(bulb, nn, -rb), d = q(root, nn, -w0);
  const pts: Pt[] = [a, q(a, u, L * 0.5), q(b, u, -rb * 0.6), b, q(b, u, rb * 0.55), q(tip, nn, rb * 0.55), tip, q(tip, nn, -rb * 0.55), q(c, u, rb * 0.55), c, q(c, u, -rb * 0.6), q(d, u, L * 0.5), d];
  const [p0, ...rest] = pts;
  let dd = `M${r1(p0[0])} ${r1(p0[1])}`;
  for (let i = 0; i < rest.length; i += 3) dd += `C${rest.slice(i, i + 3).map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' ')}`;
  // the root end closes round, behind the dome edge
  dd += `C${r1(d[0] - u[0] * w0)} ${r1(d[1] - u[1] * w0)} ${r1(a[0] - u[0] * w0)} ${r1(a[1] - u[1] * w0)} ${r1(a[0])} ${r1(a[1])}Z`;
  return { k: 'p', d: dd, box: boundsOf(pts) };
}
