/**
 * Pure layout and colour for the pet page (brief §1.1, §3.2): where the character sits, the static
 * backdrop in the agent's hue, and the anchors the engine aims gaze, feed reach and particles at.
 */

import { mix, TONES } from '@/lib/studio/character';
import { GROUND } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/pet/types';
import type { Point } from '../_engine/types';
import type { SceneAnchors, ToyKind } from './contract';

/** Soft Weather ground (studio.css --ground): every backdrop deepens toward it. */
export const PET_GROUND = '#0E1013';

export interface Backdrop {
  /** the edge colour: Telegram header, background and bottom bar */
  edge: string;
  /** the static radial gradient (never animated) */
  image: string;
  /** the pool of light the character stands in */
  floor: string;
  /** stage-up glow ellipse */
  glow: string;
  /** ring fill and bubble accents that read on this ground */
  hue: string;
}

/**
 * A dusk room in the agent's hue: lit softly behind the character, deepening to the Soft Weather
 * ground at the edges, so the pastel body always has contrast and lights-off reads as night.
 */
export function backdrop(look: Pick<CharacterLook, 'hue'>): Backdrop {
  const t = TONES[look.hue];
  const core = mix(t.base, PET_GROUND, 0.62);
  const mid = mix(t.shadow, PET_GROUND, 0.8);
  const edge = mix(t.deep, PET_GROUND, 0.9);
  return {
    edge,
    image: `radial-gradient(120% 78% at 50% 40%, ${core} 0%, ${mid} 52%, ${edge} 100%)`,
    floor: `radial-gradient(closest-side, ${mix(t.light, PET_GROUND, 0.55)}66, ${mid}00)`,
    glow: `radial-gradient(closest-side, ${t.light}cc, ${t.base}55 55%, ${t.base}00)`,
    hue: t.light,
  };
}

export interface CharacterBox { x: number; y: number; size: number }

/**
 * The character: its body ~56% of the viewport width (the body fills ~3/4 of its 200 box, so the box is
 * ~74%), centred near 45% of the height (§1.1), shrunk on short screens so the head keeps room for
 * the bubble under the safe area and the feet never meet the dock.
 */
export function characterBox(vw: number, vh: number, top = 0, dockTop = vh): CharacterBox {
  const room = Math.max(120, dockTop - top);
  const size = Math.round(Math.max(120, Math.min(vw * 0.74, room * 0.68, 520)));
  const cy = Math.min(top + room * 0.52, vh * 0.45 + top * 0.5);
  return { x: Math.round((vw - size) / 2), y: Math.round(cy - size / 2), size };
}

/** The character's ground point (where the shadow sits) in stage px. */
export const groundPoint = (c: CharacterBox): Point => ({ x: c.x + c.size / 2, y: c.y + (c.size * GROUND) / 200 });

/** A client rect, already in stage px (the page's stage is the viewport; the lab subtracts its frame). */
export interface RectLike { left: number; top: number; width: number; height: number }
const centre = (r: RectLike): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export function sceneAnchors(vw: number, vh: number, character: CharacterBox, toys: Partial<Record<ToyKind, RectLike | undefined>>, pill: RectLike | null): SceneAnchors {
  const fallback = (i: number): Point => ({ x: (vw * (i + 1)) / 4, y: vh - 140 });
  return {
    character,
    toys: {
      cookie: toys.cookie ? centre(toys.cookie) : fallback(0),
      ball: toys.ball ? centre(toys.ball) : fallback(1),
      moon: toys.moon ? centre(toys.moon) : fallback(2),
    },
    pill: pill ? centre(pill) : { x: vw / 2, y: vh - 60 },
    viewport: { w: vw, h: vh },
  };
}

/** "Days together": counts up from the first meeting, never down (day 1 is the first day). */
export const daysTogether = (firstMetAt: number, now: number) => Math.max(1, Math.floor((now - firstMetAt) / 86_400_000) + 1);
