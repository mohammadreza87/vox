/**
 * Where things are (brief §1.3 zones, §3.2): stage px ↔ the character's view box (0…200, ground at y = 166),
 * the touch zones from the model (head, eye, cheek, belly) and the anchors bursts and gaze aim at.
 */

import { GROUND, type CharacterModel } from '@/lib/studio/character';
import { pathPts } from '@/lib/studio/character/geometry';
import type { Hit, SceneAnchors } from '../_ui/contract';
import type { Anchor, Point, Side } from './types';

/** The character's box when no scene was set yet (tests, sheets). */
export const defaultScene = (size: number): SceneAnchors => ({
  character: { x: 0, y: 0, size },
  toys: { cookie: { x: size * 0.2, y: size * 1.6 }, ball: { x: size * 0.5, y: size * 1.6 }, moon: { x: size * 0.8, y: size * 1.6 } },
  pill: { x: size * 0.5, y: size * 1.9 },
  viewport: { w: size * 1.8, h: size * 2.2 },
});

/** Body offset of the wrapper (px at 200) and the stage growth, for the coordinate maps. */
export interface Placement { x: number; y: number; sx: number; sy: number; growth: number }

/** A stage point → model units (before the root growth transform). */
export function toModel(p: Point, s: SceneAnchors, pl: Placement, cx = 100): Point {
  const k = s.character.size / 200;
  // undo the wrapper (translate, then scale about the ground point) and the root growth about (cx, GROUND)
  const vx = (p.x - s.character.x) / k - pl.x, vy = (p.y - s.character.y) / k - pl.y;
  const ux = cx + (vx - cx) / pl.sx, uy = GROUND + (vy - GROUND) / pl.sy;
  return { x: cx + (ux - cx) / pl.growth, y: GROUND + (uy - GROUND) / pl.growth };
}

/** Model units → stage px. */
export function toStage(m: Point, s: SceneAnchors, pl: Placement, cx = 100): Point {
  const k = s.character.size / 200;
  const ux = cx + (m.x - cx) * pl.growth, uy = GROUND + (m.y - GROUND) * pl.growth;
  const vx = cx + (ux - cx) * pl.sx + pl.x, vy = GROUND + (uy - GROUND) * pl.sy + pl.y;
  return { x: s.character.x + vx * k, y: s.character.y + vy * k };
}

function inside(poly: Point[], p: Point): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Hull points of the body path (its control points hug the outline) plus the ears' pivots. */
export const bodyHull = (m: CharacterModel): Point[] => pathPts(m.bodyD).map(([x, y]) => ({ x, y }));

/** Zone and side of a model point (null: off the character). A little slack makes small bodies easy to hit. */
export function zoneAt(m: CharacterModel, hull: Point[], p: Point, slack = 6): Hit | null {
  const fx = m.pivots.face[0];
  const [eL, eR] = m.face.eyes;
  const onEar = [m.pivots.earL, m.pivots.earR].some(([x, y]) => Math.hypot(p.x - x, p.y - y) < 16);
  const cx = m.pivots.body[0];
  // grow the hull about its centre by the slack
  const grown = hull.map((q) => { const dx = q.x - cx, dy = q.y - (GROUND - 50), d = Math.hypot(dx, dy) || 1; return { x: q.x + (dx / d) * slack, y: q.y + (dy / d) * slack }; });
  if (!onEar && !inside(grown, p)) return null;
  const local = { x: p.x, y: p.y };
  const sideOf = (x: number): Side => (Math.abs(x - fx) < 10 ? 0 : x < fx ? -1 : 1);
  for (const [i, e] of [eL, eR].entries()) if (Math.hypot(p.x - e.cx, (p.y - e.cy) * 0.8) < 10) return { zone: 'eye', side: i ? 1 : -1, local };
  const c = m.face.cheeks;
  for (const [i, x] of c.x.entries()) if (((p.x - x) / (c.rx + 2)) ** 2 + ((p.y - c.y) / (c.ry + 2)) ** 2 < 1) return { zone: 'cheek', side: i ? 1 : -1, local };
  if (onEar || p.y < eL.cy - 8) return { zone: 'head', side: sideOf(p.x), local };
  return { zone: 'belly', side: sideOf(p.x), local };
}

/** An anchor in model units (then toStage). `touch` is the last contact point. */
export function anchorModel(a: Anchor, m: CharacterModel, touch: Point | null): Point {
  const [eL, eR] = m.face.eyes, mouth = m.face.mouth, c = m.face.cheeks;
  const top = Math.min(...pathPts(m.bodyD).map(([, y]) => y));
  switch (a) {
    case 'head': return { x: m.pivots.face[0], y: top + 6 };
    case 'eyeL': return { x: eL.cx, y: eL.cy };
    case 'eyeR': return { x: eR.cx, y: eR.cy };
    case 'mouth': return { x: mouth.x, y: mouth.y };
    case 'cheekL': return { x: c.x[0], y: c.y };
    case 'cheekR': return { x: c.x[1], y: c.y };
    case 'belly': return { x: m.pivots.body[0], y: GROUND - 22 };
    case 'ground': return { x: m.pivots.body[0], y: GROUND };
    case 'touch': return touch ?? { x: m.pivots.body[0], y: GROUND - 40 };
    default: return { x: m.pivots.body[0], y: (top + GROUND) / 2 };
  }
}

/** Gaze in eye-range units toward a stage point from the eyes (the range maps to 30° at a virtual depth). */
export function gazeTo(p: Point, eyes: Point, size: number): { x: number; y: number } {
  const depth = size * 1.3;
  const ax = Math.atan2(p.x - eyes.x, depth) * (180 / Math.PI), ay = Math.atan2(p.y - eyes.y, depth) * (180 / Math.PI);
  const c = (v: number) => Math.max(-1, Math.min(1, v / 30));
  return { x: c(ax), y: c(ay) };
}
