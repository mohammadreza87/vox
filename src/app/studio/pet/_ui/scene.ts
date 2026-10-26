/**
 * Pure layout and colour for the pet page (brief §1.1, §3.2): where the character sits, the static
 * backdrop of each room in the agent's hue, and the anchors the engine aims gaze, feed reach and particles at.
 */

import { mix, TONES } from '@/lib/studio/character';
import { GROUND } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/pet/types';
import type { Point } from '../_engine/types';
import type { SceneAnchors, ToyKind } from './contract';

/** Soft Weather ground (studio.css --ground): every backdrop deepens toward it. */
export const PET_GROUND = '#0E1013';

export interface Backdrop {
  /** which room's light this is (the Stage cross-fades when it changes) */
  room: SceneRoom;
  /** the edge colour: Telegram header, background and bottom bar */
  edge: string;
  /** the static backdrop: gradients only (never animated, no filters) */
  image: string;
  /** the pool of light the character stands in */
  floor: string;
  /** stage-up glow ellipse */
  glow: string;
  /** ring fill and bubble accents that read on this ground */
  hue: string;
}

export type SceneRoom = 'home' | 'play' | 'garden' | 'closet' | 'bedroom' | 'book';

/** The away rooms' own light (roomLight.ts, a lazy chunk: the first paint never carries it). */
export type AwayBackdrop = (look: Pick<CharacterLook, 'hue'>, room: Exclude<SceneRoom, 'home'>, groundY?: number) => Backdrop;

/**
 * A room in the agent's hue, lit softly behind the character and deepening to the Soft Weather ground at the edges,
 * so the pastel body always has contrast. Home is the dusk room as before; Play is the same room brighter. Garden,
 * Closet, Bedroom and Life Book are their own places (`away`, roomLight.ts); until that chunk is in they keep Home's
 * light. Gradients only: static, no filters, no blur (§10.7).
 */
export function backdrop(look: Pick<CharacterLook, 'hue'>, room: SceneRoom = 'home', groundY?: number, away?: AwayBackdrop): Backdrop {
  if (room !== 'home') { if (away) return away(look, room, groundY); if (room !== 'play') room = 'home'; }
  const t = TONES[look.hue], play = room === 'play';
  const core = mix(play ? t.light : t.base, PET_GROUND, play ? 0.5 : 0.62);
  const mid = mix(t.shadow, PET_GROUND, play ? 0.72 : 0.8);
  const edge = mix(t.deep, PET_GROUND, play ? 0.86 : 0.9);
  return {
    room, edge, hue: t.light,
    image: `radial-gradient(${play ? '135% 88% at 50% 38%' : '120% 78% at 50% 40%'}, ${core} 0%, ${mid} 52%, ${edge} 100%)`,
    floor: `radial-gradient(closest-side, ${mix(t.light, PET_GROUND, play ? 0.4 : 0.55)}66, ${mid}00)`,
    glow: glowOf(look),
  };
}

/** The away rooms' horizon sits this far behind the character's ground line (px): the pet stands on the floor, its room props on the seam. */
export const HORIZON_PX = 34;

/** The stage-up glow ellipse, in the agent's hue in every room. */
export const glowOf = (look: Pick<CharacterLook, 'hue'>) => { const t = TONES[look.hue]; return `radial-gradient(closest-side, ${t.light}cc, ${t.base}55 55%, ${t.base}00)`; };

export interface CharacterBox { x: number; y: number; size: number }

/** How big the character is and where it stands, per height class (§9.2, §9.3). */
const FIT = {
  // Peek and Short: ~74% of the width, centred near 45% of the height (360×640 reads balanced: kept as it was)
  small: { w: 0.74, h: 0.68 },
  // Regular and Tall: the character fills the stage (the body ~70% of the width), standing low on a floor line ~85%
  // down the free stage, so the gap to the rail is about a bubble zone and the bubble and thought zones sit above the
  // head; Tall grows toward the 520 cap
  regular: { w: 0.92, h: 0.58, ground: 0.85 },
  tall: { w: 0.94, h: 0.6, ground: 0.85 },
} as const;

/**
 * The character's box (the body fills ~3/4 of its 200 box). Peek and Short: ~74% of the viewport width, centred near
 * 45% of the height (§1.1), shrunk on short screens so the head keeps room for the bubble under the safe area and the
 * feet never meet the dock. Regular and Tall (`cls`): bigger, standing low on a floor line ~85% down the free stage,
 * so the stage is never half empty above the dock.
 */
export function characterBox(vw: number, vh: number, top = 0, dockTop = vh, cls?: 'peek' | 'short' | 'regular' | 'tall', tray?: number): CharacterBox {
  const room = Math.max(120, dockTop - top);
  let box: CharacterBox;
  if (cls === 'regular' || cls === 'tall') {
    const f = FIT[cls];
    const size = Math.round(Math.max(120, Math.min(vw * f.w, room * f.h, 520)));
    const ground = top + room * f.ground;
    box = { x: Math.round((vw - size) / 2), y: Math.round(ground - (size * GROUND) / 200), size };
  } else {
    const size = Math.round(Math.max(120, Math.min(vw * FIT.small.w, room * FIT.small.h, 520)));
    const cy = Math.min(top + room * 0.52, vh * 0.45 + top * 0.5);
    box = { x: Math.round((vw - size) / 2), y: Math.round(cy - size / 2), size };
  }
  // a room's tray (Closet, Life Book) rises over the stage: the pet stands on its top edge (the tray may cover the
  // shadow, never the body), a little smaller only if the bubble zone above the head would not fit
  if (tray === undefined || groundPoint(box).y <= tray - TRAY.gap) return box;
  const ground = tray - TRAY.gap, zone = cls === 'tall' ? TRAY.zone.tall : cls === 'regular' ? TRAY.zone.regular : TRAY.zone.small;
  const size = Math.round(Math.max(120, Math.min(box.size, (ground - top - zone) / (GROUND / 200 - 0.2))));
  return { x: Math.round((vw - size) / 2), y: Math.round(ground - (size * GROUND) / 200), size };
}

/** Over a tray: the body's foot this far above the tray's top (px), and the bubble zone kept above the head (px). */
const TRAY = { gap: 2, zone: { small: 100, regular: 150, tall: 170 } } as const;

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
