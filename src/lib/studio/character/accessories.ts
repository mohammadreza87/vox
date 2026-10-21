/**
 * Accessories (STYLE §5.4), from stage 4, in one accent colour. Small clips
 * (bow, flower, star, bowtie) are flat fills; worn pieces (hats, headphone
 * cups) take the body's soft matte language, a two-stop gradient
 * and a soft contact shade on the head, so nothing reads as a sticker.
 * Glasses are the reference rings, their ink tinted toward the body's deep
 * tone. Rigid pieces (lenses, hats, headphones) ride the head; soft ones
 * (bow, flower, star, bowtie) bounce on their own pivot.
 */

import type { Accessory, HairStyle } from '../types';
import { GROUND, domePt, r1, type Box, type Pt, type Silhouette } from './geometry';
import { mix } from './palette';
import { node as n, type SvgNode } from './node';

export interface AccCtx {
  s: Silhouette;
  /** eye centres and the mouth line */
  eL: number; eR: number; ey: number; my: number;
  color: string;
  /** body clip url (the hat's contact shade) */
  clip: string;
  /** id factory for the accessory's own paint servers and clips */
  id: (s: string) => string;
  /** line-weight multiplier (small sizes draw heavier lines and slightly larger lenses) */
  lw?: number;
  /** the body's deep tone: frames are tinted toward it and hats cast it as a soft contact shade */
  deep?: string;
  /** small LOD: drop the fiddly bits (the headset boom) */
  small?: boolean;
  /** the body's mid shade: the headphone band is tinted toward it, so it never reads as a thin dark line */
  tint?: string;
  /** the body's base tone */
  body?: string;
  /** 48 px and under: the glasses drop their bridge and thin their rings, so eyes, mouth and frame stay apart */
  micro?: boolean;
  /** the hairstyle: a pony's tie owns the upper right of the head, so the bow moves to the left */
  hair?: HairStyle;
}

export interface AccBuild { rigid: SvgNode[]; soft: SvgNode[]; pivot: Pt; box: Box; defs?: SvgNode[] }

/** The bowtie: centre at `at` of the body height, scale over the sketch. */
export const BOWTIE = { at: 0.86, k: 1.45 };
/** Bow and flower scale at icon sizes (56 px and under), over their card size. */
export const SMALL_CLIP = 1.8;
/** Card-size scale of the side clips (bow, flower) over the sketch: big enough to read as an object. */
export const CLIP_K = 1.3;

/** Line weight of every accessory line (STYLE §4 stroke tiers). */
export const ACC_LINE = 2;
/** The glasses and specs frame: a touch heavier than the other lines, the reference's weight. */
export const GLASSES_LINE = 2.55;
const lineAttrs = (color: string, w: number): SvgNode['attrs'] => ({ fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const fold = { fill: '#000', opacity: 0.12 };
const f = (x: number, y: number) => `${r1(x)} ${r1(y)}`;
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${f(cx - rx, cy)}A${r1(rx)} ${r1(ry)} 0 1 1 ${f(cx + rx, cy)}A${r1(rx)} ${r1(ry)} 0 1 1 ${f(cx - rx, cy)}Z`;
const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${f(x + r, y)}H${r1(x + w - r)}A${r1(r)} ${r1(r)} 0 0 1 ${f(x + w, y + r)}V${r1(y + h - r)}A${r1(r)} ${r1(r)} 0 0 1 ${f(x + w - r, y + h)}H${r1(x + r)}A${r1(r)} ${r1(r)} 0 0 1 ${f(x, y + h - r)}V${r1(y + r)}A${r1(r)} ${r1(r)} 0 0 1 ${f(x + r, y)}Z`;

/**
 * Glasses ring geometry (STYLE §4): slightly tall ovals, centreline 12 × 13.6 (so a lensed eye has a good 2.5 u of
 * air above and below), centres ±18.5 from the face axis, 0.9 above the eyes.
 */
export const ringsOf = (eL: number, eR: number, ey: number, k = 1) => {
  const fx = (eL + eR) / 2;
  // A1's rings are about 8 % wider than the STYLE §4 centreline (12 × 13.6): 13 × 14.7, centres ±19.2
  return { L: fx - 19.2 * k, R: fx + 19.2 * k, y: ey - 0.9, rx: 13 * k, ry: 14.7 * k };
};
/** Ring line weight multiplier at 48 px and under (over the small-size line weight): thin rings keep the eyes apart. */
export const MICRO_RING = 0.8;

/** The soft matte two-stop material of worn pieces (hats, cups): the accent lifted at the top, a shade step below. */
const matte = (id: string, color: string, k = 1) => n('linearGradient', { id, x1: 0, y1: 0, x2: 0.12, y2: 1 }, [
  n('stop', { offset: 0, 'stop-color': mix(color, '#FFFFFF', 0.2 * k) }), n('stop', { offset: 1, 'stop-color': mix(color, '#0B1622', 0.24 * k) }),
]);
/** A soft contact shade a worn piece casts on the body (radial, falling to nothing; clipped to the body). */
const occlusion = (id: string, deep: string) => n('radialGradient', { id }, [
  n('stop', { offset: 0, 'stop-color': deep, 'stop-opacity': 0.42 }), n('stop', { offset: 0.6, 'stop-color': deep, 'stop-opacity': 0.2 }), n('stop', { offset: 1, 'stop-color': deep, 'stop-opacity': 0 }),
]);

export function accessoryParts(kind: Accessory, c: AccCtx): AccBuild | null {
  const { s, eL, eR, ey, my, color } = c;
  const lw = c.lw ?? 1;
  const deep = c.deep ?? '#1B2A33';
  const line = (col: string, w = ACC_LINE) => lineAttrs(col, w * lw);
  const fx = (eL + eR) / 2;
  const { cx: dcx, cy: dcy, r: R } = s.dome;
  const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
  const gid = c.id('ag'), oid = c.id('ao');
  const fill = `url(#${gid})`;
  const shade = (cx: number, cy: number, rx: number, ry: number): SvgNode =>
    n('ellipse', { cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: `url(#${oid})`, 'clip-path': c.clip });
  // side clips and the bowtie are drawn a quarter larger than the sketch so they read at card size
  const soft = (at: Pt, rot: number, kids: SvgNode[], half: number, k = 1.25, rot2?: number): AccBuild => ({
    rigid: [], soft: [n('g', { transform: `translate(${f(...at)}) rotate(${rot2 ?? rot}) scale(${r1(k * 100) / 100})` }, kids)], pivot: at,
    box: box(at[0] - half * k, at[1] - half * k, at[0] + half * k, at[1] + half * k),
  });
  // frames: ink tinted a step toward the body's deep tone (A1's dark teal rim), still a dark line
  const rim = mix(color, deep, 0.15);
  switch (kind) {
    case 'glasses': {
      const g = ringsOf(eL, eR, ey, lw > 1 ? 1.15 : 1);
      // a thick bridge arched up, sitting high between the rings (dropped at 48 px and under, where it joins the
      // rings and eyes into one dark mass)
      const by = g.y - 5 * (g.ry / 13.6), bx = g.rx * Math.sqrt(1 - (by - g.y) ** 2 / g.ry ** 2);
      const bridge = c.micro ? '' : `M${f(g.L + bx, by)}Q${f(fx, by - 5.5)} ${f(g.R - bx, by)}`;
      return {
        rigid: [n('path', { d: ell(g.L, g.y, g.rx, g.ry) + ell(g.R, g.y, g.rx, g.ry) + bridge, ...line(rim, GLASSES_LINE * (c.micro ? MICRO_RING : 1)) })],
        soft: [], pivot: [fx, ey], box: box(g.L - g.rx - 1, g.y - g.ry - 1, g.R + g.rx + 1, g.y + g.ry + 1),
      };
    }
    case 'specs': {
      // soft rounded-rectangle frames (the round glasses' square sibling), a small arched bridge
      const y = ey + 0.5, L = fx - 18.5, Rr = fx + 18.5, w = 22 * (lw > 1 ? 1.12 : 1), h = 19 * (lw > 1 ? 1.12 : 1);
      const bridge = c.micro ? '' : `M${f(L + w / 2, y - 3)}Q${f(fx, y - 7)} ${f(Rr - w / 2, y - 3)}`;
      return {
        rigid: [n('path', { d: rrect(L - w / 2, y - h / 2, w, h, 6.5) + rrect(Rr - w / 2, y - h / 2, w, h, 6.5) + bridge, ...line(rim, GLASSES_LINE * (c.micro ? MICRO_RING : 1)) })],
        soft: [], pivot: [fx, ey], box: box(L - w / 2 - 1, y - h / 2 - 1, Rr + w / 2 + 1, y + h / 2 + 1),
      };
    }
    case 'bow': {
      // two rounded triangular loops and a centre knot, seated well inside the head's upper-right edge (a tenth of
      // the body width in), so it never sits on the silhouette like a bone
      // a pony's tie owns the upper right, so the bow moves to the mirror spot; at icon sizes it grows and sits
      // deeper inside the dome, so it keeps a readable two-loop shape
      // (a third larger than the sketch, nearly twice that at icon sizes, so it is still a bow at 48 px; seated deep
      // in the dome so the bigger bow stays on the head)
      const side = c.hair === 'pony' ? -1 : 1, at = domePt(s, side * (c.small ? 30 : 36), c.small ? -21 : -18);
      const loop = 'M0 0C-2.5 -2.6 -6.5 -7.2 -9.6 -6.6C-12 -6.1 -12.4 -2.4 -12.4 0C-12.4 2.4 -12 6.1 -9.6 6.6C-6.5 7.2 -2.5 2.6 0 0Z';
      return soft(at, 18, [
        n('path', { d: loop + loop.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${-Number(x)} ${y}`), fill: color }),
        n('path', { d: 'M-6.5 -2.6Q-9 0 -6.5 2.6ZM6.5 -2.6Q9 0 6.5 2.6Z', ...fold }),
        n('rect', { x: -2.8, y: -3.4, width: 5.6, height: 6.8, rx: 2.6, fill: color }), n('rect', { x: -2.8, y: -3.4, width: 5.6, height: 6.8, rx: 2.6, ...fold }),
      ], 12.5, 1.05 * CLIP_K * (c.small ? SMALL_CLIP / CLIP_K : 1), side * 18);
    }
    case 'flower': {
      // five round petals (r 4.6) round a warm centre, seated well inside the dome so the bigger flower sits on the head
      const at = domePt(s, c.small ? -34 : -40, c.small ? -20 : -18);
      const petals = Array.from({ length: 5 }, (_, k) => { const t = (k * 72 * Math.PI) / 180; return ell(5.4 * Math.sin(t), -5.4 * Math.cos(t), 4.6, 4.6); }).join('');
      return soft(at, -10, [n('path', { d: petals, fill: color }), n('circle', { r: 3.1, fill: '#F2C76B' })], 10.2, 1.25 * (c.small ? SMALL_CLIP / CLIP_K : 1));
    }
    case 'star': {
      // a plump rounded star (outer radius 12), seated well inside the dome edge
      const side = c.hair === 'pony' ? -1 : 1, at = domePt(s, side * (c.small ? 32 : 38), c.small ? -20 : -17);
      const d = Array.from({ length: 10 }, (_, k) => { const t = (k * 36 * Math.PI) / 180, r = k % 2 ? 5.6 : 12; return `${k ? 'L' : 'M'}${f(r * Math.sin(t), -r * Math.cos(t))}`; }).join('') + 'Z';
      return soft(at, side * 14, [n('path', { d, fill: color, stroke: color, 'stroke-width': ACC_LINE * 1.3, 'stroke-linejoin': 'round' })], 13, c.small ? SMALL_CLIP / CLIP_K : 1);
    }
    case 'headphones':
    case 'headset': {
      // a thick soft band hugging the dome (its inner edge on the head's outline) and chunky pastel cups at the
      // sides of the head, sitting into the saddles over the tops of the side lobes. A soft rounded strap in the
      // accent's light tone, never a wire; at icon sizes the band and cups grow a little so they still read
      // the band's centreline rides 2 u off the dome (its inner edge ON the head's outline): it hugs the head, never a
      // halo floating over it
      const bw = c.small ? 8 : 6, crx = c.small ? 10 : 8.8, cry = c.small ? 13 : 11.5;
      const Rb = R + 2, end = 74, cupY = dcy - 1.5;
      const at = (deg: number): Pt => [dcx + Rb * Math.sin((deg * Math.PI) / 180), dcy - Rb * Math.cos((deg * Math.PI) / 180)];
      const [a0, a1] = [at(-end), at(end)];
      const arc = `M${f(...a0)}A${r1(Rb)} ${r1(Rb)} 0 0 1 ${f(...a1)}`;
      const cL: Pt = [dcx - R - 1.5, cupY], cR: Pt = [dcx + R + 1.5, cupY];
      const band = color;
      const rigid: SvgNode[] = [
        n('path', { d: arc, ...lineAttrs(band, bw), 'data-part': 'band' }),
        n('path', { d: ell(cL[0], cL[1], crx, cry) + ell(cR[0], cR[1], crx, cry), fill, 'data-part': 'cups' }),
        // one flat fold on the lower half of each cup (no gloss)
        n('path', { d: `M${f(cL[0] - crx, cL[1] + 1)}A${r1(crx)} ${r1(cry - 1)} 0 0 0 ${f(cL[0] + crx, cL[1] + 1)}ZM${f(cR[0] - crx, cR[1] + 1)}A${r1(crx)} ${r1(cry - 1)} 0 0 0 ${f(cR[0] + crx, cR[1] + 1)}Z`, ...fold, opacity: 0.08 }),
      ];
      // the mic: a soft boom off the bottom of the left cup that sweeps forward across the cheek and ends in a
      // rounded capsule pointing at the mouth (never a hook or an earring); kept at icon sizes, a touch thicker
      let y1 = cupY + cry;
      if (kind === 'headset') {
        const x0 = cL[0] + 2, y0 = cupY + cry - 3, ex = cL[0] + 16, eY = my - 4;
        // the capsule lies along the boom's end, a few degrees down toward the mouth
        const ang = 4;
        const cw = 8 * (c.small ? 1.15 : 1), ch = 5 * (c.small ? 1.2 : 1);
        rigid.push(
          n('path', { d: `M${f(x0, y0)}Q${f(x0 + 1, eY)} ${f(ex - cw / 2 + 1, eY)}`, ...lineAttrs(band, c.small ? 3.4 : 2.8), 'data-part': 'boom' }),
          n('path', { d: rrect(-cw / 2, -ch / 2, cw, ch, ch / 2), fill, transform: `translate(${f(ex, eY)}) rotate(${r1(ang)})`, 'data-part': 'mic' }),
        );
        y1 = Math.max(y1, eY + ch / 2);
      }
      return {
        rigid, soft: [], pivot: [dcx, dcy], defs: [matte(gid, color, 0.7)],
        box: box(cL[0] - crx - 1, dcy - Rb - bw / 2 - 1, cR[0] + crx + 1, y1 + 1),
      };
    }
    case 'beret': {
      // a soft beret seated on the dome: its band follows the head's curve, its puffy top overhangs to the right
      const P = (u: number, v: number): Pt => [dcx + u * R, dcy + v * R];
      const L0 = P(-0.74, -0.68), R0 = P(0.86, -0.58);
      const d = `M${f(...L0)}Q${f(...P(0.06, -0.36))} ${f(...R0)}C${f(...P(1.18, -0.74))} ${f(...P(0.68, -1.26))} ${f(...P(0.06, -1.17))}`
        + `C${f(...P(-0.5, -1.1))} ${f(...P(-0.9, -0.92))} ${f(...L0)}Z`;
      const nub = P(0.1, -1.18);
      return {
        rigid: [shade(dcx + 0.05 * R, dcy - 0.44 * R, R * 0.95, 8), n('path', { d, fill }), n('circle', { cx: r1(nub[0]), cy: r1(nub[1] - 2), r: 2.8, fill })],
        soft: [], defs: [matte(gid, color), occlusion(oid, deep)], pivot: [dcx, dcy - R * 0.6],
        box: box(dcx - R * 0.92, nub[1] - 5, dcx + R * 1.06, dcy - R * 0.38),
      };
    }
    case 'cap':
    case 'beanie': {
      // the crown is the dome's own cap: its lower edge sags with the head's curve; matte two-tone, a soft contact shade
      const cut = dcy - 20, clipId = c.id('hc'), Rc = R + 3.5;
      const A: Pt = [dcx - Rc - 2, cut - 4], E: Pt = [dcx + Rc + 2, cut - 4], B: Pt = [dcx, cut + 10];
      const defs = [
        n('clipPath', { id: clipId }, [n('path', { d: `M${f(...A)}Q${f(...B)} ${f(...E)}L${f(E[0], 0)}L${f(A[0], 0)}Z` })]),
        matte(gid, color), occlusion(oid, deep),
      ];
      const rigid: SvgNode[] = [shade(dcx + (kind === 'cap' ? 6 : 0), cut + 8, Rc * 0.95, 7), n('circle', { cx: r1(dcx), cy: r1(dcy), r: r1(Rc), fill, 'clip-path': `url(#${clipId})` })];
      let x1 = dcx + Rc + 2, y0 = dcy - Rc;
      if (kind === 'cap') {
        // a short curved brim (a crescent) hugging the crown's lower edge, out to the right
        const bd = `M${f(dcx - 16, cut + 1.5)}Q${f(dcx + 14, cut + 5)} ${f(dcx + Rc + 5, cut - 5)}Q${f(dcx + Rc + 12, cut)} ${f(dcx + Rc + 4, cut + 5)}`
          + `Q${f(dcx + 10, cut + 19)} ${f(dcx - 16, cut + 1.5)}Z`;
        rigid.push(n('path', { d: bd, fill }), n('path', { d: bd, ...fold, opacity: 0.1 }));
        x1 = dcx + Rc + 11;
      } else {
        // a fold band following the same curve, and a pompom
        // the band is as wide as the crown where it sits, so it wraps the head instead of standing out like a brim
        const hwc = Math.sqrt(Rc ** 2 - (dcy - cut + 2) ** 2) + 1;
        const a: Pt = [dcx - hwc, cut - 2.5], e: Pt = [dcx + hwc, cut - 2.5], o = 2.5;
        const band = `M${f(a[0], a[1] - o)}Q${f(B[0], B[1] - o)} ${f(e[0], e[1] - o)}Q${f(e[0] + 2.5, e[1] + 3)} ${f(e[0] - 1, e[1] + 7)}`
          + `Q${f(B[0], B[1] + 8.5)} ${f(a[0] + 1, a[1] + 7)}Q${f(a[0] - 2.5, a[1] + 3)} ${f(a[0], a[1] - o)}Z`;
        rigid.push(n('path', { d: band, fill }), n('path', { d: band, ...fold }), n('circle', { cx: r1(dcx), cy: r1(dcy - Rc - 3), r: 5.8, fill }));
        y0 = dcy - Rc - 9;
      }
      return { rigid, soft: [], defs, pivot: [dcx, cut], box: box(dcx - Rc - 3, y0, x1, cut + 12) };
    }
    case 'bowtie': {
      // low on the base (about 0.85 of the body height, past the widest point where the body narrows), well clear of
      // the mouth, and big enough to read as an object: never a second mouth or a moustache
      const at: Pt = [fx, s.top + BOWTIE.at * (GROUND - s.top)];
      return soft(at, 0, [
        n('path', { d: 'M0 0L-10 -6Q-12 0 -10 6ZM0 0L10 -6Q12 0 10 6Z', fill: color, stroke: color, 'stroke-width': ACC_LINE, 'stroke-linejoin': 'round' }),
        n('circle', { r: 2.8, fill: color }), n('circle', { r: 2.8, ...fold }),
      ], 12, BOWTIE.k);
    }
    default:
      return null;
  }
}

