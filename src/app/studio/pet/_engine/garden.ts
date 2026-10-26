/**
 * The Garden's seed on the floor (design §4.5): one seed at a time, planted → sprouted → bloomed, and it never wilts
 * (there is no wilted, dry or sad state to draw). A flower grows in a small terracotta pot; the Nowruz sabzeh in a
 * shallow turquoise dish, tied with its red ribbon once it is lush. It stands on the floor like the keepsakes, right
 * of the pet and left of the seasonal keepsake (details.ts lays the floor out), in every room.
 *
 * Motion is the page's CSS, never the frame loop (the engine sleeps at rest): the plant group carries
 * `data-anim="sway"` (a gentle idle sway about its base) and a bloom's three glints `data-anim="shimmer"`; the frame
 * sheets pass the sway angle and shimmer phase instead. Pure geometry, not in the engine's core chunk.
 */

import type { GardenState as PlayGardenState, SeedKind } from '@/lib/pet/play';
import type { SvgNode } from '@/lib/studio/character';
import type { GardenState } from './types';

/** What the floor shows (never PetCare): the seed's kind, its growth, and `wet` (watered today: darker soil, a drop). */
export interface GardenShown { kind: SeedKind; state: GardenState; wet?: boolean }
/**
 * What the page may pass: the floor state, or play.ts's view state as it is (`gardenState`, with `seed` as
 * PetPlayView.garden carries it). Either names the kind (`kind` or `seed`).
 */
export interface GardenInput { kind?: SeedKind; seed?: SeedKind; state: GardenState | PlayGardenState; wet?: boolean }

export const SEED_ART: readonly SeedKind[] = ['flower', 'sabzeh'];
export const GARDEN_STATES: readonly GardenState[] = ['planted', 'sprouted', 'bloomed'];
/**
 * play.ts's states on the floor (§4.5), never moving backwards: seeded and sprouting are a planted seed (it already
 * shows a tiny shoot), ready is a sprout, watered a sprout with wet soil (on a seed's first day it shows its sprout a
 * little early, never a step back later), blooming and bloomed a bloom; empty draws nothing.
 */
export const FROM_PLAY: Readonly<Record<PlayGardenState, { state: GardenState; wet?: boolean } | null>> = {
  empty: null, seeded: { state: 'planted' }, sprouting: { state: 'planted' }, ready: { state: 'sprouted' },
  watered: { state: 'sprouted', wet: true }, blooming: { state: 'bloomed' }, bloomed: { state: 'bloomed' },
};
/** A garden the floor can draw, or null (no seed, an unknown kind or state). */
export function fitGarden(g: GardenInput | null | undefined): GardenShown | null {
  if (!g) return null;
  const kind = g.kind ?? g.seed;
  const st = (GARDEN_STATES as readonly string[]).includes(g.state) ? { state: g.state as GardenState } : FROM_PLAY[g.state as PlayGardenState];
  if (!kind || !SEED_ART.includes(kind) || !st) return null;
  const wet = g.wet ?? st.wet;
  return { kind, state: st.state, ...(wet ? { wet: true } : {}) };
}
/** The key of the garden's floor group (`data-detail`). */
export const gardenKey = (g: GardenShown) => `garden:${g.kind}:${g.state}`;

/** Drawn at this scale on the floor beside the pet (the Garden room draws it bigger: details.ts GARDEN_HERO). */
export const GARDEN_K = 1.75;
/** Where the soil is, over the vessel's base (unscaled): rain and the bloom's sparkle aim here. */
export const soilY = (kind: SeedKind) => (kind === 'sabzeh' ? -5.3 : -11.2);
/** How far a sprout sways either way (deg) and a bloom (a little less: it is heavier). */
export const SWAY = { sprouted: 4, bloomed: 2.5 } as const;

const r1 = (n: number) => Math.round(n * 10) / 10;
const p = (d: string, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'path', attrs: { d, ...attrs } });
const c = (cx: number, cy: number, r: number, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'circle', attrs: { cx: r1(cx), cy: r1(cy), r: r1(r), ...attrs } });
const e = (cx: number, cy: number, rx: number, ry: number, attrs: SvgNode['attrs']): SvgNode => ({ tag: 'ellipse', attrs: { cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), ...attrs } });
const line = (stroke: string, w: number): SvgNode['attrs'] => ({ fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });

const LEAF = '#7ACB6A', LEAF_DEEP = '#55A652', STEM = '#5FB35A';
const SOIL = '#7A5236', SOIL_LIGHT = '#94683F', SOIL_WET = '#5C3C26';
/** A four-point glint about (x, y). */
const glintD = (x: number, y: number, r: number) => `M${r1(x)} ${r1(y - r)}Q${r1(x + r * 0.18)} ${r1(y - r * 0.18)} ${r1(x + r)} ${r1(y)}Q${r1(x + r * 0.18)} ${r1(y + r * 0.18)} ${r1(x)} ${r1(y + r)}Q${r1(x - r * 0.18)} ${r1(y + r * 0.18)} ${r1(x - r)} ${r1(y)}Q${r1(x - r * 0.18)} ${r1(y - r * 0.18)} ${r1(x)} ${r1(y - r)}Z`;
/** A teardrop leaf from (x, y) out along `deg` (0 = up), length l. */
function leafD(x: number, y: number, l: number, deg: number): string {
  const t = (deg * Math.PI) / 180, ux = Math.sin(t), uy = -Math.cos(t), nx = -uy, ny = ux, w = l * 0.42;
  const tip = [x + ux * l, y + uy * l], m1 = [x + ux * l * 0.5 + nx * w, y + uy * l * 0.5 + ny * w], m2 = [x + ux * l * 0.5 - nx * w, y + uy * l * 0.5 - ny * w];
  return `M${r1(x)} ${r1(y)}Q${r1(m1[0])} ${r1(m1[1])} ${r1(tip[0])} ${r1(tip[1])}Q${r1(m2[0])} ${r1(m2[1])} ${r1(x)} ${r1(y)}Z`;
}

/* ---------- the vessels ---------- */

/** The flower's terracotta pot: a tapered body, a rim a step lighter, soil showing at the top. */
function pot(wet: boolean): SvgNode[] {
  return [
    p('M-6.1 -8.6L-4.6 -0.9Q-4.4 0 -3.5 0H3.5Q4.4 0 4.6 -0.9L6.1 -8.6Z', { fill: '#D9805A' }),
    p('M1.6 -8.6H6.1L4.6 -0.9Q4.4 0 3.5 0H1.2Z', { fill: '#C26C49' }),
    { tag: 'rect', attrs: { x: -7.4, y: -11.6, width: 14.8, height: 3.4, rx: 1.4, fill: '#EE9A70' } },
    e(0, -11.2, 6, 1.15, { fill: wet ? SOIL_WET : SOIL }),
  ];
}
/** The sabzeh's shallow dish (a turquoise glaze, a paler lip). */
function dish(wet: boolean): SvgNode[] {
  return [
    p('M-8.4 -5.2Q-7.8 -0.4 -3 0H3Q7.8 -0.4 8.4 -5.2Z', { fill: '#3FA3B1' }),
    p('M2.6 -5.2H8.4Q7.8 -0.4 3 0H2.2Z', { fill: '#338B98' }),
    e(0, -5.2, 8.4, 1.5, { fill: '#7FD0D6' }),
    e(0, -5.3, 6.9, 0.95, { fill: wet ? '#7A5E3A' : '#9C7B4F' }),
  ];
}

/* ---------- the plants (drawn standing on the vessel's soil) ---------- */

function flowerPlant(state: GardenState): SvgNode[] {
  const y0 = -11.2;
  if (state === 'planted') return [
    // a soil mound, the seed half showing, and its first hooked shoot with two seed leaves: alive, never a bare pot,
    // and clearly smaller than a sprout (seed → sprout → bloom read apart at a glance)
    p(`M-4 ${y0}Q0 ${y0 - 3} 4 ${y0}Z`, { fill: SOIL_LIGHT }),
    e(-1.7, y0 - 1.4, 1.5, 1, { fill: '#D7B07A' }),
    p(`M0.5 ${y0 - 1.5}Q0.1 ${y0 - 3.9} 1.1 ${y0 - 4.9}`, line(STEM, 1.1)),
    p(leafD(1.1, y0 - 4.9, 2.6, 62), { fill: LEAF }),
    p(leafD(1.1, y0 - 4.9, 2.3, -48), { fill: LEAF_DEEP }),
  ];
  if (state === 'sprouted') return [
    p(`M0 ${y0}Q-0.5 ${y0 - 3.6} 0 ${y0 - 7}`, line(STEM, 1.3)),
    p(leafD(0, y0 - 6.6, 5.6, -58), { fill: LEAF }),
    p(leafD(0, y0 - 6.8, 5.2, 62), { fill: LEAF_DEEP }),
  ];
  // bloomed: a stem with two leaves and a five-petal flower, a warm centre
  const fy = y0 - 15.5;
  return [
    p(`M0 ${y0}Q-1.2 ${y0 - 7} 0 ${fy + 2}`, line(STEM, 1.4)),
    p(leafD(-0.4, y0 - 4.8, 5.8, -64), { fill: LEAF }),
    p(leafD(-0.2, y0 - 8.4, 5, 60), { fill: LEAF_DEEP }),
    ...[0, 1, 2, 3, 4].map((i) => { const a = ((i * 72 - 90) * Math.PI) / 180; return c(Math.cos(a) * 3, fy + Math.sin(a) * 3, 2.7, { fill: '#FF9EC0' }); }),
    c(0, fy, 1.9, { fill: '#FFD45C' }),
    c(-0.6, fy - 0.6, 0.6, { fill: '#FFF4D2' }),
  ];
}

function sabzehPlant(state: GardenState): SvgNode[] {
  const y0 = -5.3;
  if (state === 'planted') return [0, 1, 2, 3, 4, 5, 6].map((i) => e(-5.2 + i * 1.75, y0 - 0.2 + (i % 2) * 0.35, 0.8, 0.5, { fill: '#D9B77A' }));
  const tall = state === 'bloomed';
  const xs = [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4];
  const h = tall ? [11, 14, 16, 17, 15.5, 13.5, 10.5] : [4.4, 5.6, 6.2, 6.6, 6, 5.2, 4.2];
  const blades = xs.map((x, i) => p(`M${r1(x)} ${y0}Q${r1(x + 0.4)} ${r1(y0 - h[i] * 0.6)} ${r1(x * (tall ? 1.18 : 1.08) + (i % 2 ? 0.6 : -0.4))} ${r1(y0 - h[i])}`, line(i % 2 ? LEAF_DEEP : LEAF, 1.45)));
  if (!tall) return blades;
  // lush: the red ribbon tied round the blades (the Nowruz sabzeh's), its bow to the right
  const by = y0 - 5;
  return [
    ...blades,
    p(`M-5.8 ${by}Q0 ${by + 1.4} 5.8 ${by}`, line('#E5484D', 2.1)),
    p(`M4.6 ${by + 0.4}L7.6 ${by - 2.2}L7.8 ${by + 1.6}ZM4.6 ${by + 0.4}L7 ${by + 3.6}L5 ${by + 4.2}Z`, { fill: '#E5484D' }),
  ];
}

/** The glints around a bloom (their shimmer is the page's CSS; `phase` 0 … 1 is a sheet's moment in it). */
function shimmerNodes(kind: SeedKind, phase: number | undefined): SvgNode[] {
  const pts: Array<[number, number, number]> = kind === 'flower' ? [[-6.4, -29.5, 1.5], [6.2, -24.5, 1.2], [1.6, -33, 1]] : [[-7.2, -21, 1.4], [7.6, -18.5, 1.1], [1.4, -25.5, 1]];
  return pts.map(([x, y, r], i) => {
    const o = phase === undefined ? 0.8 : 0.2 + 0.8 * Math.abs(Math.sin(Math.PI * (phase + i / 3)));
    return p(glintD(x, y, r * 1.7), { fill: '#FFF4D2', opacity: Math.round(o * 100) / 100 });
  });
}

export interface GardenDraw {
  /** the plant's sway this frame (deg, sheets): the page sways it in CSS instead */
  sway?: number;
  /** a sheet's moment in the bloom's shimmer (0 … 1) */
  shimmer?: number;
}

/**
 * The garden's art standing on (0, 0) (the vessel's base on the floor), unscaled: the vessel, then the plant in a
 * group that sways about its base (`data-anim="sway"`, sprouted and bloomed), then a bloom's glints
 * (`data-anim="shimmer"`).
 */
export function gardenArt(g: GardenShown, o: GardenDraw = {}): SvgNode[] {
  const vessel = g.kind === 'sabzeh' ? dish(!!g.wet) : pot(!!g.wet);
  const plant = g.kind === 'sabzeh' ? sabzehPlant(g.state) : flowerPlant(g.state);
  const base = soilY(g.kind);
  const out: SvgNode[] = [...vessel];
  if (g.state === 'planted') out.push(...plant);
  else {
    const deg = o.sway ? r1(o.sway) : 0;
    out.push({ tag: 'g', attrs: { 'data-anim': 'sway', ...(deg ? { transform: `rotate(${deg} 0 ${base})` } : {}) }, children: plant });
  }
  if (g.state === 'bloomed') out.push({ tag: 'g', attrs: { 'data-anim': 'shimmer' }, children: shimmerNodes(g.kind, o.shimmer) });
  // watered today: a bead of water catching the light on the rim
  if (g.wet) out.push(p(g.kind === 'sabzeh' ? 'M-6 -7.4Q-4.9 -5.9 -6 -5.3Q-7.1 -5.9 -6 -7.4Z' : 'M-4.9 -14.2Q-3.8 -12.7 -4.9 -12.1Q-6 -12.7 -4.9 -14.2Z', { fill: '#9CD3FF' }));
  return out;
}

/** The sheet's sway at time t (ms): what the page's CSS does (a slow sine, the bloom a little less). */
export const swayAt = (g: GardenShown, tMs: number) => (g.state === 'planted' ? 0 : SWAY[g.state] * Math.sin((2 * Math.PI * tMs) / 3400));
