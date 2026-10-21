/**
 * Character geometry in the 200×200 viewBox (ground y = 166): the one rig
 * silhouette every family and stage shares (STYLE §1), its dome anchors and
 * the few shape primitives the parts are built from.
 *
 * The body is ONE path, `M + 8 C + Z` (base → widest → shoulder lobe →
 * saddle → dome → top, mirrored), built from the reference's own circles: a
 * round dome over two shoulder lobes on a wide flat base. A `d` tween works
 * between any two families or stages. Puff is the canonical three-lobed
 * cloud, tower the same bun under a taller dome, drift the reference's lean.
 */

import type { CloudFamily, CloudSpecies, Stage } from '../types';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Circle { k: 'c'; cx: number; cy: number; r: number }
export interface Ellipse { k: 'e'; cx: number; cy: number; rx: number; ry: number; rot: number }
/** An absolute path (transforms baked in) with its bounding box. */
export interface PathShape { k: 'p'; d: string; box: Box }
export type Shape = Circle | Ellipse | PathShape;
export type Pt = [number, number];

export const GROUND = 166;
/** Body width at stage 4 (the reference body is 150 of a 200 box). */
export const BODY_W = 150;

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const circle = (cx: number, cy: number, r: number): Circle => ({ k: 'c', cx, cy, r });
export const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0): Ellipse => ({ k: 'e', cx, cy, rx, ry, rot });

/* ---------- the rig silhouette ---------- */

/**
 * One half of the silhouette, in body-width units (base at v = 0, up +): a
 * shoulder lobe (circle of radius rL whose outer edge is the widest point,
 * hw out at height yw), the dome (circle of radius rD centred at height cyD
 * on the dome axis), a concave fillet of half-length `fil` where the two
 * circles meet, and the base corner handles a1/b1. `h` (the top) is derived:
 * cyD + rD.
 */
export interface HalfParams { h: number; hw: number; yw: number; rL: number; cyD: number; rD: number; fil: number; a1: number; b1: number }
type Knobs = Omit<HalfParams, 'h'>;
const half = (k: Knobs): HalfParams => ({ ...k, h: k.cyD + k.rD });

/**
 * Canonical fit to the four reference portraits: the dome and shoulder
 * circles of STYLE §1.1, joined by a soft concave saddle (a fillet of about
 * 0.05 bw each side, never a crease or a cusp), as in A1/B1. Refit against
 * the A1/B1/B2 masks (width- and base-normalised IoU .988 / .940 / .963): the
 * shoulder lobes sit a touch lower and leaner, so the saddle dips deeper at
 * the notch (STYLE §1.2: xn .315, yn .563), and the base corners run longer
 * and flatter (a1 .36, b1 .16: the reference's 0.30 bw flat run).
 */
export const CANON: HalfParams = half({ hw: 0.5, yw: 0.31, rL: 0.265, cyD: 0.525, rD: 0.282, fil: 0.05, a1: 0.36, b1: 0.16 });

/**
 * Per-stage body (STYLE §6): a small, round, convex wisp (the shoulders still
 * inside the dome), then the shoulders bud and grow out day by day.
 */
const STAGE_BODY: Record<Stage, { scale: number; p: HalfParams }> = {
  1: { scale: 0.62, p: half({ hw: 0.5, yw: 0.32, rL: 0.4, cyD: 0.43, rD: 0.42, fil: 0.12, a1: 0.3, b1: 0.2 }) },
  2: { scale: 0.82, p: half({ hw: 0.5, yw: 0.32, rL: 0.31, cyD: 0.49, rD: 0.315, fil: 0.1, a1: 0.33, b1: 0.2 }) },
  3: { scale: 0.92, p: half({ hw: 0.5, yw: 0.32, rL: 0.27, cyD: 0.515, rD: 0.286, fil: 0.07, a1: 0.35, b1: 0.18 }) },
  4: { scale: 1, p: CANON },
};
export const stageScale = (stage: number) => STAGE_BODY[Math.max(1, Math.min(4, Math.round(stage))) as Stage].scale;

/** A family: deltas on the right/left halves, a dome lean (bw units, + right) and a width factor. */
export interface Family { right: Partial<HalfParams>; left: Partial<HalfParams>; lean: number; w: number }
export const FAMILIES: Record<CloudFamily, Family> = {
  // three soft lobes: the reference cloud
  puff: { right: {}, left: {}, lean: 0, w: 1 },
  // the same bun and shoulders as puff (same base width, same saddle), only a taller dome (STYLE §1.2: h ≈ .83)
  tower: { right: { cyD: 0.045 }, left: { cyD: 0.045 }, lean: 0, w: 1 },
  // the reference's own asymmetry (A2): the dome leans left over a full, low left lobe; the right one is smaller and higher
  drift: { right: { rL: -0.02, yw: 0.01, hw: -0.02, cyD: -0.025, fil: 0.006 }, left: { rL: 0.01, yw: -0.045, hw: 0.01 }, lean: -0.045, w: 1.03 },
};

/**
 * Drift on an animal: A2's full lean is intentional on a plain cloud, but under ears it reads as a body tipping
 * over. Eared species take the subtle asymmetry measured in STYLE §1: the dome about 0.02 bw to the left and the
 * left saddle a little higher than the right (the left lobe a touch up, the right a touch down).
 */
export const SPECIES_DRIFT: Family = { right: { yw: -0.015 }, left: { yw: 0.015 }, lean: -0.02, w: 1 };

/** Family deltas grow in with the shoulders: a wisp is just a gumdrop. */
const FAMILY_K = [0, 0.1, 0.6, 0.85, 1];

export interface Silhouette {
  stage: Stage;
  cx: number; W: number; R: HalfParams; L: HalfParams; lean: number;
  /** top of the body (y) */
  top: number;
  /** the dome circle every head part is anchored on */
  dome: { cx: number; cy: number; r: number };
}

const add = (p: HalfParams, d: Partial<HalfParams>, k: number): HalfParams => {
  const o = Object.fromEntries(Object.entries(p).map(([key, v]) => [key, v + (d[key as keyof HalfParams] ?? 0) * k])) as unknown as HalfParams;
  return { ...o, h: o.cyD + o.rD };
};

export function silhouette(family: CloudFamily, stage: number, cx = 100, species: CloudSpecies = 'cloud'): Silhouette {
  const st = Math.max(1, Math.min(4, Math.round(stage))) as Stage;
  const fam = family === 'drift' && species !== 'cloud' ? SPECIES_DRIFT : FAMILIES[family] ?? FAMILIES.puff, k = FAMILY_K[st];
  const base = STAGE_BODY[st].p;
  // the dome is shared: both halves take the right half's dome
  const dome = { rD: fam.right.rD ?? 0, cyD: fam.right.cyD ?? 0 };
  const R = add(base, fam.right, k), L = add(base, { ...fam.left, ...dome }, k);
  const W = BODY_W * (1 + (fam.w - 1) * k), lean = fam.lean * k;
  const top = GROUND - R.h * W;
  return { stage: st, cx, W, R, L, lean, top, dome: { cx: cx + lean * W, cy: GROUND - R.cyD * W, r: R.rD * W } };
}

type V = [number, number];
const add2 = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k];

/**
 * The four cubics of one half in outward units (u > 0 away from the axis, v up):
 * base → widest → lobe arc → saddle fillet → dome arc → top. `d0` is the dome
 * axis offset on this side (the lean, mirrored for the left half).
 */
function halfSegs(p: HalfParams, d0: number): V[][] {
  const lc: V = [p.hw - p.rL, p.yw], dc: V = [d0, p.cyD];
  // the outer, upper meeting point of the shoulder and dome circles
  const dx = lc[0] - dc[0], dy = lc[1] - dc[1], dd = Math.hypot(dx, dy);
  const a = (p.rD ** 2 - p.rL ** 2 + dd ** 2) / (2 * dd), hh = Math.sqrt(Math.max(0, p.rD ** 2 - a ** 2));
  const mx = dc[0] + (a * dx) / dd, my = dc[1] + (a * dy) / dd;
  const I: V = [mx - (hh * dy) / dd, my + (hh * dx) / dd];
  const angL = Math.atan2(I[1] - lc[1], I[0] - lc[0]) - p.fil / p.rL;
  const angD = Math.min(Math.PI / 2 - 0.05, Math.atan2(I[1] - dc[1], I[0] - dc[0]) + p.fil / p.rD);
  const P1: V = [lc[0] + p.rL * Math.cos(angL), lc[1] + p.rL * Math.sin(angL)];
  const P2: V = [dc[0] + p.rD * Math.cos(angD), dc[1] + p.rD * Math.sin(angD)];
  const tL: V = [-Math.sin(angL), Math.cos(angL)], tD: V = [-Math.sin(angD), Math.cos(angD)];
  const kL = (4 / 3) * Math.tan(angL / 4) * p.rL, kD = (4 / 3) * Math.tan((Math.PI / 2 - angD) / 4) * p.rD;
  const f = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]) * 0.42;
  const W0: V = [p.hw, p.yw], T: V = [d0, p.h];
  return [
    [[0, 0], [p.a1, 0], [p.hw, p.yw - p.b1], W0],
    [W0, [p.hw, p.yw + kL], add2(P1, tL, -kL), P1],
    [P1, add2(P1, tL, f), add2(P2, tD, -f), P2],
    [P2, add2(P2, tD, kD), [d0 + kD, p.h], T],
  ];
}

/**
 * The body path: ONE command structure (M + 8 C + Z) for every family and
 * stage, so a `d` tween works between any two of them. The lean moves the
 * dome circle; the base stays centred.
 */
export function bodyD(s: Silhouette): string {
  const { W, cx, lean } = s;
  const P = (side: 1 | -1, [u, v]: V) => `${r1(cx + side * u * W)} ${r1(GROUND - v * W)}`;
  const R = halfSegs(s.R, lean), L = halfSegs(s.L, -lean);
  let d = `M${P(1, R[0][0])}`;
  for (const sg of R) d += `C${P(1, sg[1])} ${P(1, sg[2])} ${P(1, sg[3])}`;
  for (let j = L.length - 1; j >= 0; j--) d += `C${P(-1, L[j][2])} ${P(-1, L[j][1])} ${P(-1, L[j][0])}`;
  return d + 'Z';
}

/** Points along the body outline (the cubics sampled), for widths and bounds. */
export function bodyOutline(s: Silhouette, n = 10): Pt[] {
  const pts = pathPts(bodyD(s));
  const out: Pt[] = [];
  for (let i = 0; i + 3 < pts.length; i += 3) {
    const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    for (let j = 0; j < n; j++) {
      const t = j / n, m = 1 - t;
      out.push([m ** 3 * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t ** 3 * p3[0], m ** 3 * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t ** 3 * p3[1]]);
    }
  }
  return out;
}

/** A point on (or off, by `off`) the dome circle at θ degrees from vertical (+ right). */
export function domePt(s: Silhouette, deg: number, off = 0): Pt {
  const t = (deg * Math.PI) / 180, R = s.dome.r + off;
  return [s.dome.cx + R * Math.sin(t), s.dome.cy - R * Math.cos(t)];
}

/** The body's left and right edge at height y (from the sampled outline). */
export function edgesAt(s: Silhouette, y: number): [number, number] {
  const xs = bodyOutline(s, 16).filter((_, i, a) => { const p = a[i], q = a[(i + 1) % a.length]; return (p[1] - y) * (q[1] - y) <= 0; }).map((p) => p[0]);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : [s.cx, s.cx];
}

/** Body half-width at height y. */
export function widthAt(s: Silhouette, y: number): number {
  const [l, r] = edgesAt(s, y);
  return (r - l) / 2;
}

/* ---------- primitives ---------- */

/**
 * A soft rounded triangle (ear, tuft, spike): base centred at b, pointing
 * along deg (0 = up), base half-width w, length len; `round` softens the tip.
 */
export function softTri([bx, by]: Pt, deg: number, w: number, len: number, round = 0.45): PathShape {
  const t = (deg * Math.PI) / 180, ux = Math.sin(t), uy = -Math.cos(t), px = -uy, py = ux;
  const a: Pt = [bx - px * w, by - py * w], c: Pt = [bx + px * w, by + py * w], tip: Pt = [bx + ux * len, by + uy * len];
  const q1: Pt = [tip[0] - ux * len * round * 0.5 - px * w * round * 0.6, tip[1] - uy * len * round * 0.5 - py * w * round * 0.6];
  const q2: Pt = [tip[0] - ux * len * round * 0.5 + px * w * round * 0.6, tip[1] - uy * len * round * 0.5 + py * w * round * 0.6];
  const m1: Pt = [a[0] + ux * len * 0.55, a[1] + uy * len * 0.55], m2: Pt = [c[0] + ux * len * 0.55, c[1] + uy * len * 0.55];
  const f = (p: Pt) => `${r1(p[0])} ${r1(p[1])}`;
  return { k: 'p', d: `M${f(a)}Q${f(m1)} ${f(q1)}Q${f(tip)} ${f(q2)}Q${f(m2)} ${f(c)}Z`, box: boundsOf([a, c, tip, m1, m2]) };
}

/**
 * A rounded triangle (cat ear, owl tuft): base centred at b and buried behind the body, pointing along deg
 * (0 = up), base half-width w, length len, with a true round tip of radius tipR and gently convex sides, so it
 * shows one smooth tapered point (never a flat, squarish tip). Cubics only (no arcs), so its points bound it.
 */
export function roundTri([bx, by]: Pt, deg: number, w: number, len: number, tipR: number): PathShape {
  const t = (deg * Math.PI) / 180, u: Pt = [Math.sin(t), -Math.cos(t)], p: Pt = [-u[1], u[0]];
  // local frame: `along` the axis from the base, `across` it (+ to the right of the axis)
  const at = ([a, b]: Pt): Pt => [bx + u[0] * a + p[0] * b, by + u[1] * a + p[1] * b];
  const side = Math.hypot(w, len), sy = len / side, sx = w / side, al = Math.atan2(w, len), tt = tipR / Math.tan(al);
  // the tip circle's tangent points on each side, and the arc between them as one cubic
  const tl: Pt = [len - tt * sy, -tt * sx], tr: Pt = [len - tt * sy, tt * sx];
  const k = (4 / 3) * Math.tan((Math.PI - 2 * al) / 4) * tipR;
  const cl: Pt = [tl[0] + k * sy, tl[1] + k * sx], cr: Pt = [tr[0] + k * sy, tr[1] - k * sx];
  // gently convex sides: the first handle bulges out, the second stays on the side line (smooth into the tip arc)
  const run = (side - tt) / 3, bulge = 0.08 * side;
  const a: Pt = [0, -w], c: Pt = [0, w];
  const m1: Pt = [a[0] + run * sy + bulge * sx, a[1] + run * sx - bulge * sy], m2: Pt = [tl[0] - run * sy, tl[1] - run * sx];
  const n2: Pt = [tr[0] - run * sy, tr[1] + run * sx], n1: Pt = [c[0] + run * sy + bulge * sx, c[1] - run * sx + bulge * sy];
  // the base closes round below, buried behind the body
  const b1: Pt = [-w * 0.55, w * 0.75], b0: Pt = [-w * 0.55, -w * 0.75];
  const q = (v: Pt) => { const [x, y] = at(v); return `${r1(x)} ${r1(y)}`; };
  return {
    k: 'p', d: `M${q(a)}C${q(m1)} ${q(m2)} ${q(tl)}C${q(cl)} ${q(cr)} ${q(tr)}C${q(n2)} ${q(n1)} ${q(c)}C${q(b1)} ${q(b0)} ${q(a)}Z`,
    box: boundsOf([a, m1, m2, tl, cl, cr, tr, n2, n1, c, b1, b0].map(at)),
  };
}

export function boxOf(s: Shape): Box {
  if (s.k === 'c') return { x0: s.cx - s.r, y0: s.cy - s.r, x1: s.cx + s.r, y1: s.cy + s.r };
  if (s.k === 'e') {
    const a = (s.rot * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a);
    const hw = Math.hypot(s.rx * c, s.ry * n), hh = Math.hypot(s.rx * n, s.ry * c);
    return { x0: s.cx - hw, y0: s.cy - hh, x1: s.cx + hw, y1: s.cy + hh };
  }
  return s.box;
}
/** Points on a shape's outline (paths: their knots and control points, which bound the curve). */
export function outlineOf(s: Shape): Pt[] {
  if (s.k === 'p') return pathPts(s.d);
  const rx = s.k === 'c' ? s.r : s.rx, ry = s.k === 'c' ? s.r : s.ry, a = s.k === 'e' ? (s.rot * Math.PI) / 180 : 0;
  return Array.from({ length: 24 }, (_, i): Pt => {
    const t = (i * Math.PI) / 12, x = rx * Math.cos(t), y = ry * Math.sin(t);
    return [s.cx + x * Math.cos(a) - y * Math.sin(a), s.cy + x * Math.sin(a) + y * Math.cos(a)];
  });
}
/** Coordinate pairs of an absolute path with no arcs. */
export const pathPts = (d: string): Pt[] => {
  const v = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return Array.from({ length: v.length >> 1 }, (_, i): Pt => [v[2 * i], v[2 * i + 1]]);
};
/** A box's outline as a rounded rectangle (accessories only report a box; their corners are never square). */
export function roundedOutline(b: Box, round = 0.35): Pt[] {
  const r = Math.min(b.x1 - b.x0, b.y1 - b.y0) * round;
  return ([[b.x1 - r, b.y1 - r, 0], [b.x0 + r, b.y1 - r, 1], [b.x0 + r, b.y0 + r, 2], [b.x1 - r, b.y0 + r, 3]] as const)
    .flatMap(([x, y, q]) => [0, 1, 2, 3].map((j): Pt => { const t = ((q + j / 3) * Math.PI) / 2; return [x + r * Math.cos(t), y + r * Math.sin(t)]; }));
}
export const unionBox = (bs: Box[]): Box => bs.reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const boundsOf = (pts: Pt[]): Box => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});

/** Clockwise path data for a shape. */
export function shapeD(s: Shape): string {
  if (s.k === 'p') return s.d;
  if (s.k === 'c') return `M${r1(s.cx - s.r)} ${r1(s.cy)}A${r1(s.r)} ${r1(s.r)} 0 1 1 ${r1(s.cx + s.r)} ${r1(s.cy)}A${r1(s.r)} ${r1(s.r)} 0 1 1 ${r1(s.cx - s.r)} ${r1(s.cy)}Z`;
  const a = (s.rot * Math.PI) / 180, dx = s.rx * Math.cos(a), dy = s.rx * Math.sin(a);
  const [x0, y0, x1, y1] = [s.cx - dx, s.cy - dy, s.cx + dx, s.cy + dy].map(r1);
  return `M${x0} ${y0}A${r1(s.rx)} ${r1(s.ry)} ${r1(s.rot)} 1 1 ${x1} ${y1}A${r1(s.rx)} ${r1(s.ry)} ${r1(s.rot)} 1 1 ${x0} ${y0}Z`;
}
export const unionD = (shapes: Shape[]) => shapes.map(shapeD).join('');
