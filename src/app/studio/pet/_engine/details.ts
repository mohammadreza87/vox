/**
 * Growth details (design §4.11, §10.3): the small accents a lit growth moment adds to the character. A `taught`
 * moment lights a second glint in each eye (the second highlight family), a `task` moment a tiny work pin, an
 * `access` moment a key charm, a `room` moment a keepsake on the floor beside the pet and a `season` moment the
 * seasonal keepsake. What the character can wear follows STAGE_PARTS: the eye glint needs `highlight2`, the pin and
 * the charm need the `accessory` slot (both stage 4), so a wisp never wears a pin; a lit moment it cannot show yet is
 * kept and appears with the part. Floor keepsakes are not worn, so every stage has them.
 *
 * Pure geometry (no DOM, no framer): poseToSvg draws these for frame sheets, and the page renders the same nodes on
 * device (see `detailLayers`: which rig binding each group rides). Not in the engine's core chunk.
 */

import { GROUND, hasPart, modelEye, type CharacterModel, type SvgNode } from '@/lib/studio/character';
import { EYE } from '@/lib/studio/character/face';
import { HIGHLIGHT } from '@/lib/studio/character/palette';
import type { Stage } from '@/lib/studio/types';
import { fitGarden, GARDEN_K, gardenArt, gardenKey, type GardenDraw, type GardenShown } from './garden';

/** What the person's view has lit (the page passes it; never stored in PetCare). */
export interface Details {
  /** a taught moment: a second glint in each eye */
  glint?: boolean;
  /** a task moment: a tiny work pin */
  pin?: boolean;
  /** an access moment: a key charm */
  charm?: boolean;
  /** room (and bloom) keepsakes on the floor, oldest first; the newest three show */
  keepsakes?: string[];
  /** the seasonal keepsake ('yalda' | 'suri' | 'nowruz' | another id), or none */
  seasonal?: string | null;
  /** the Garden's seed (§4.5), right of the pet (between it and the seasonal keepsake), or none */
  garden?: GardenShown | null;
}
/** A detail a lit moment can fade in (`keepsake` and `seasonal` name theirs by `id`). */
export type DetailName = 'glint' | 'pin' | 'charm' | 'keepsake' | 'seasonal';

/** The details this stage can show (the rest wait for their part). */
export interface ShownDetails { glint: boolean; pin: boolean; charm: boolean; keepsakes: string[]; seasonal: string | null; garden?: GardenShown | null }

/** Which STAGE_PARTS part each worn detail needs. */
export const DETAIL_PART = { glint: 'highlight2', pin: 'accessory', charm: 'accessory' } as const;
/** At most this many floor keepsakes beside the pet (the newest). */
export const KEEPSAKES_SHOWN = 3;

export function fitDetails(d: Details, stage: Stage): ShownDetails {
  return {
    glint: !!d.glint && hasPart(stage, DETAIL_PART.glint),
    pin: !!d.pin && hasPart(stage, DETAIL_PART.pin),
    charm: !!d.charm && hasPart(stage, DETAIL_PART.charm),
    keepsakes: [...new Set(d.keepsakes ?? [])].slice(-KEEPSAKES_SHOWN),
    seasonal: d.seasonal ?? null,
    // the garden stands on the floor at every stage (it is not worn)
    ...(fitGarden(d.garden) ? { garden: fitGarden(d.garden) } : {}),
  };
}

/** The key of a detail's group (`data-detail`): 'glint', 'pin', 'charm', 'keepsake:<id>', 'seasonal'. */
export const detailKey = (name: DetailName, id?: string) => (name === 'keepsake' ? `keepsake:${id ?? ''}` : name);

/**
 * A detail fading in after the `litPeak` cue (§10.3: one overshoot), u = 0 … 1 over DETAIL_FADE_MS: opacity up fast,
 * the scale over-shoots to ~1.12 and settles. Reduced motion: opacity only.
 */
export const DETAIL_FADE_MS = 420;
export function detailFade(u: number, reduced = false): { o: number; s: number } {
  const t = Math.max(0, Math.min(1, u));
  if (reduced) return { o: t, s: 1 };
  // back-out: 0.5 → 1.125 (at half way) → 1
  const c = 3, e = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  return { o: Math.min(1, t * 2.5), s: 0.5 + 0.5 * e };
}

/* ---------- paint (vinyl-toy minimal: two tones and a highlight) ---------- */

const GOLD = '#F2B93B', GOLD_DEEP = '#C98F22', CREAM = '#FFF4D2';
/** Floor keepsakes are drawn at this scale (about 13 px tall; the seasonal one about 17). */
const FLOOR_K = 1.3;
const r1 = (n: number) => Math.round(n * 10) / 10;
const g = (attrs: SvgNode['attrs'], children: SvgNode[]): SvgNode => ({ tag: 'g', attrs, children });
const p = (d: string, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'path', attrs: { d, ...attrs } });
const c = (cx: number, cy: number, r: number, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'circle', attrs: { cx: r1(cx), cy: r1(cy), r: r1(r), ...attrs } });
/** An n-point star about (x, y), outer radius r, inner ri. */
function starD(x: number, y: number, r: number, ri: number, n = 5, rot = -90): string {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180, k = i % 2 ? ri : r;
    return `${r1(x + Math.cos(a) * k)} ${r1(y + Math.sin(a) * k)}`;
  });
  return `M${pts.join('L')}Z`;
}

/** The body outline sampled from its path (one M and cubic C segments). */
function outline(bodyD: string): Array<[number, number]> {
  const v = [...bodyD.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const out: Array<[number, number]> = [];
  let x0 = v[0], y0 = v[1];
  for (let i = 2; i + 5 < v.length; i += 6) {
    const [x1, y1, x2, y2, x3, y3] = v.slice(i, i + 6);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      out.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    x0 = x3; y0 = y3;
  }
  return out;
}
/** The body's left and right edge at height y (model units, before the stage growth). */
export function edgesAt(m: Pick<CharacterModel, 'bodyD' | 'pivots'>, y: number): [number, number] {
  const pts = outline(m.bodyD);
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    if ((ay - y) * (by - y) > 0 || ay === by) continue;
    const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  const cx = m.pivots.body[0];
  return lo === Infinity ? [cx - 60, cx + 60] : [lo, hi];
}

/* ---------- worn details ---------- */

/** The second highlight family: a small twinkle low on the inner side of each eye (opposite the catch-light). */
function glintNodes(m: CharacterModel): SvgNode[] {
  const e = modelEye(m, EYE.idle), s = m.face.eyeScale;
  return m.face.eyes.map(({ cx, cy }) => p(starD(cx - e.w * 0.34, cy + e.t * 0.34, 1.9 * s, 0.75 * s, 4, -90), { fill: HIGHLIGHT }));
}

/** The work pin: a round gold enamel pin with a cream star, low on the chest on the left. */
export function pinAt(m: CharacterModel): { x: number; y: number } {
  const top = Math.min(...outline(m.bodyD).map(([, y]) => y));
  const y = m.face.cheeks.y + (GROUND - m.face.cheeks.y) * 0.5;
  const [l] = edgesAt(m, y);
  return { x: r1(Math.max(l + 12, m.face.cheeks.x[0] - 4)), y: r1(Math.min(y, GROUND - 10, top + (GROUND - top) * 0.86)) };
}
function pinNodes(m: CharacterModel): SvgNode[] {
  const { x, y } = pinAt(m);
  return [c(x, y + 0.8, 5.8, { fill: GOLD_DEEP }), c(x, y, 5.4, { fill: GOLD }), p(starD(x, y, 3.4, 1.45), { fill: CREAM })];
}

/** The key charm: hangs from a ring on the right side of the body and swings with the soft parts. */
export function charmAt(m: CharacterModel): { x: number; y: number } {
  const y = m.face.cheeks.y + (GROUND - m.face.cheeks.y) * 0.32;
  const [, rgt] = edgesAt(m, y);
  return { x: r1(rgt - 9), y: r1(y) };
}
function charmNodes(m: CharacterModel): SvgNode[] {
  const { x, y } = charmAt(m);
  const line = { fill: 'none', stroke: GOLD_DEEP, 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const key = { fill: 'none', stroke: GOLD, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  return [
    c(x, y, 2.1, line),
    c(x, y + 5.2, 2.5, key),
    p(`M${r1(x)} ${r1(y + 7.7)}V${r1(y + 14.2)}M${r1(x)} ${r1(y + 12.4)}h2.3M${r1(x)} ${r1(y + 14.2)}h1.7`, key),
  ];
}

/* ---------- floor keepsakes ---------- */

/** Each keepsake's art, drawn standing on (0, 0) (its base on the floor), about 10 px tall. */
function keepsakeArt(id: string): SvgNode[] {
  switch (id) {
    case 'play': return [p(starD(0, -5.6, 5.6, 2.5), { fill: '#FFD45C', stroke: '#E0A82E', 'stroke-width': 0.8, 'stroke-linejoin': 'round' })];
    case 'garden': case 'bloom': return [
      p('M0 0V-6', { stroke: '#6FBF73', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
      ...[0, 1, 2, 3, 4].map((i) => { const a = ((i * 72 - 90) * Math.PI) / 180; return c(Math.cos(a) * 2.5, -9 + Math.sin(a) * 2.5, 2.2, { fill: '#FF9EC0' }); }),
      c(0, -9, 1.6, { fill: '#FFD45C' }),
    ];
    case 'closet': return [p('M0 -5L-5.6 -8.6V-1.6ZM0 -5L5.6 -8.6V-1.6Z', { fill: '#B49CFF', stroke: '#8E74E8', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }), c(0, -5, 1.7, { fill: '#8E74E8' })];
    case 'bedroom': return [p('M2.4 -10.6A5.4 5.4 0 1 0 5.2 -1.2A4.2 4.2 0 0 1 2.4 -10.6Z', { fill: '#F1E3A0' })];
    case 'book': return [
      { tag: 'rect', attrs: { x: -5.8, y: -8, width: 11.6, height: 8, rx: 1.3, fill: '#7FB2FF' } },
      p('M0 -8V0M-3.8 -5.5H-1.4M1.4 -5.5H3.8', { stroke: '#F4F8FF', 'stroke-width': 0.9, 'stroke-linecap': 'round' }),
    ];
    case 'home': return [p('M0 -1.2C-6 -4.6 -6.4 -9.2 -3 -9.6C-1.4 -9.8 -0.4 -8.8 0 -7.8C0.4 -8.8 1.4 -9.8 3 -9.6C6.4 -9.2 6 -4.6 0 -1.2Z', { fill: '#FF8FAB' })];
    default: return [c(0, -4.6, 4.4, { fill: '#9CD3FF' }), c(-1.4, -6, 1.2, { fill: HIGHLIGHT, opacity: 0.8 })];
  }
}
/** The seasonal keepsake, a little bigger (about 13 px tall). */
function seasonalArt(id: string): SvgNode[] {
  switch (id) {
    // Yalda: a pomegranate with its crown
    case 'yalda': return [c(0, -6.2, 6.2, { fill: '#D8434F' }), p('M-2.2 -11.6L-1.4 -14L0 -12.4L1.4 -14L2.2 -11.6Z', { fill: '#B5303B' }), c(-2.2, -8.2, 1.4, { fill: HIGHLIGHT, opacity: 0.55 })];
    // Nowruz: a sabzeh in its dish
    case 'nowruz': return [
      p('M-4.6 -2.2L-3.4 -11M-2.2 -2.2L-1.6 -12.6M0 -2.2L0.4 -13M2.2 -2.2L2.4 -12M4.6 -2.2L4.2 -10.4', { stroke: '#7ACB6A', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
      { tag: 'ellipse', attrs: { cx: 0, cy: -1.6, rx: 7.2, ry: 2.2, fill: '#E9D6B0' } },
    ];
    // Chaharshanbe Suri: a small, safe spark (a lantern flame)
    case 'suri': return [p('M0 -13C3.4 -9 5.2 -6.4 5.2 -4.2A5.2 4.2 0 0 1 -5.2 -4.2C-5.2 -6.8 -2.6 -8.6 0 -13Z', { fill: '#FF9F43' }), p('M0 -8.6C1.6 -6.6 2.4 -5.4 2.4 -4.2A2.4 2 0 0 1 -2.4 -4.2C-2.4 -5.6 -1.2 -6.6 0 -8.6Z', { fill: '#FFD45C' })];
    default: return [p(starD(0, -6.5, 6.5, 2.9), { fill: '#FFD45C' })];
  }
}

/* ---------- layers ---------- */

/**
 * The detail nodes by what they ride, in the 200 view box. On device the page draws them in an overlay that copies
 * the character's transforms (none of this is CharacterView's: Studio never draws them):
 * - `lids`: inside a group bound to `rig.layer.face` (origin the face pivot) and, inside that, `rig.lids` (origin
 *   the face pivot x, the eye line); each path's opacity is `rig.glint` (it fades as the lids close, like the
 *   catch-light);
 * - `body`: inside the body wrapper and the model's root transform, over the face; the charm group carries
 *   `data-pivot="x y"` and swings by the `acc-soft` layer's `rotate` about it;
 * - `floor`: on the floor, outside the body wrapper (it never hops), in the character box's 200 view box.
 * Every group has `data-detail` (its key); the lit one fades in on the `litPeak` cue (class the page adds).
 */
export interface DetailLayers { lids: SvgNode[]; body: SvgNode[]; floor: SvgNode[] }

export interface DetailDraw extends GardenDraw {
  /** the detail fading in (its key) and where it is (detailFade) */
  fade?: { key: string; o: number; s: number } | null;
  /** the charm's swing (deg), the soft parts' rotation lag */
  swing?: number;
  /** the catch-light opacity this frame (the glint fades with it) */
  glint?: number;
}

export function detailLayers(m: CharacterModel, d: ShownDetails, o: DetailDraw = {}): DetailLayers {
  const out: DetailLayers = { lids: [], body: [], floor: [] };
  const fade = (key: string, ax: number, ay: number): SvgNode['attrs'] => {
    const f = o.fade?.key === key ? o.fade : null;
    if (!f) return { 'data-detail': key };
    const s = r1(f.s * 1000) / 1000;
    return { 'data-detail': key, opacity: Math.round(f.o * 1000) / 1000, ...(s !== 1 ? { transform: `translate(${r1(ax)} ${r1(ay)}) scale(${s}) translate(${r1(-ax)} ${r1(-ay)})` } : {}) };
  };
  if (d.glint) {
    const e = m.face.eyes, at = fade('glint', (e[0].cx + e[1].cx) / 2, e[0].cy);
    const op = o.glint ?? 0.72;
    out.lids.push(g({ ...at, opacity: Math.round(op * Number(at.opacity ?? 1) * 1000) / 1000 }, glintNodes(m)));
  }
  if (d.pin) { const q = pinAt(m); out.body.push(g(fade('pin', q.x, q.y), pinNodes(m))); }
  if (d.charm) {
    const q = charmAt(m), sw = o.swing ? r1(o.swing) : 0;
    const kids = charmNodes(m);
    out.body.push(g({ ...fade('charm', q.x, q.y), 'data-pivot': `${q.x} ${q.y}` }, sw ? [g({ transform: `rotate(${sw} ${q.x} ${q.y})` }, kids)] : kids));
  }
  // floor: keepsakes to the left of the body (newest nearest), the seasonal one to the right, clear of the body at
  // its stage size; a soft contact shadow under each
  const grow = m.growth, cx = m.pivots.body[0];
  const [l, rgt] = edgesAt(m, GROUND - 6).map((x) => cx + (x - cx) * grow);
  const shade = (x: number, k = 1): SvgNode => ({ tag: 'ellipse', attrs: { cx: r1(x), cy: GROUND + 0.6, rx: r1(6.6 * k), ry: 1.6, fill: '#000000', opacity: 0.14 } });
  const ks = [...d.keepsakes].reverse();
  ks.forEach((id, i) => {
    const x = Math.max(8, l - 12 - i * 18);
    out.floor.push(g(fade(detailKey('keepsake', id), x, GROUND), [shade(x), g({ transform: `translate(${r1(x)} ${GROUND}) scale(${FLOOR_K})` }, keepsakeArt(id))]));
  });
  // the garden's vessel right of the body; the seasonal keepsake steps further out to make room
  const gx = gardenX(m);
  if (d.garden) {
    out.floor.push(g(fade(gardenKey(d.garden), gx, GROUND), [shade(gx, 1.5), g({ transform: `translate(${gx} ${GROUND}) scale(${GARDEN_K})` }, gardenArt(d.garden, o))]));
  }
  if (d.seasonal) {
    const x = d.garden ? Math.min(206, gx + 24) : Math.min(191, rgt + 18);
    out.floor.push(g(fade('seasonal', x, GROUND), [shade(x), g({ transform: `translate(${r1(x)} ${GROUND}) scale(${FLOOR_K})` }, seasonalArt(d.seasonal))]));
  }
  return out;
}

/** Where the garden's vessel stands (view units, its base centre on the floor): clear of the body at its stage size. */
export function gardenX(m: CharacterModel): number {
  const cx = m.pivots.body[0];
  // the plant rises beside the body's widest point (it bulges well past its base), measured up to a bloom's height
  const widest = Math.max(...[12, 22, 32, 42, 52].map((d) => edgesAt(m, GROUND - d / m.growth)[1]));
  return r1(Math.min(184, cx + (widest - cx) * m.growth + 6));
}

export const NO_DETAILS: ShownDetails = { glint: false, pin: false, charm: false, keepsakes: [], seasonal: null };
