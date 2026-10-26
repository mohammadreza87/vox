/**
 * The away rooms' backdrops (P-04, design §4, §10.5): Garden, Closet, Bedroom and Life Book are places of their own,
 * each with a floor from a horizon behind the pet. A lazy chunk the page loads after hello (the first paint and Home
 * never carry it). Gradients only: static, no filters, no blur (§10.7).
 */

import { mix, TONES } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/pet/types';
import { glowOf, type Backdrop, type SceneRoom } from './scene';

type Away = Exclude<SceneRoom, 'home' | 'play'>;
/** A room's light (design §4, §10.5): fixed tints the agent's hue warms a little, so every room is still its world. */
interface RoomLight { core: string; mid: string; edge: string; floor: [string, string]; line: string; pool: string }
const ROOM_LIGHT: Record<Away, RoomLight> = {
  // fresh green: a lit sky, grass from the horizon, a soft line where they meet
  garden: { core: '#4F8466', mid: '#2C5341', edge: '#12241B', floor: ['#3A6E40', '#17301C'], line: '#A9DB8F66', pool: '#8FD39A' },
  // soft neutral: a warm grey wall and floor
  closet: { core: '#4D4756', mid: '#2F2B37', edge: '#141218', floor: ['#2B2731', '#121015'], line: '#FFFFFF1F', pool: '#D9CDEB' },
  // dark, warm night: a plum wall lit low and warm by the lamp
  bedroom: { core: '#4A3241', mid: '#211A31', edge: '#0A0913', floor: ['#1C1626', '#09080F'], line: '#FFD9A01A', pool: '#FFC98A' },
  // paper-warm: a sepia study
  book: { core: '#62492F', mid: '#3A2B1E', edge: '#18120C', floor: ['#33271B', '#140F0A'], line: '#FFE7BF26', pool: '#FFE2B0' },
};
/** the bedroom's stars, high on the wall (x %, y % of the stage, radius px) */
const STARS: ReadonlyArray<[number, number, number]> = [[12, 9, 1.4], [27, 17, 1], [44, 7, 1.2], [63, 14, 1.5], [81, 8, 1], [90, 21, 1.2], [8, 27, 1]];

/**
 * A room's own place, lit in its own way and warmed a little by the agent's hue, standing on a floor from a horizon
 * behind the pet (`groundY`: the character's ground line in stage px; without it, the room's light alone).
 */
export function awayBackdrop(look: Pick<CharacterLook, 'hue'>, room: Away, groundY?: number): Backdrop {
  const t = TONES[look.hue], L = ROOM_LIGHT[room], warm = (c: string) => mix(c, t.base, 0.1);
  const core = warm(L.core), mid = warm(L.mid), edge = L.edge;
  const layers: string[] = [];
  if (groundY) {
    const h = Math.round(groundY - HORIZON);
    // a floor from the horizon down: a soft seam line, then the floor darkening toward the viewer
    layers.push(`linear-gradient(180deg, #0000 ${h - 1}px, ${L.line} ${h}px, ${L.line} ${h + 1}px, ${warm(L.floor[0])} ${h + 2}px, ${L.floor[1]} 100%)`);
    // two low hills behind the garden's horizon
    if (room === 'garden') {
      const hill = mix(L.floor[0], L.core, 0.3);
      layers.push(`radial-gradient(34% 5% at 10% ${h}px, ${hill} 98%, #0000 100%)`, `radial-gradient(30% 4% at 92% ${h}px, ${hill} 98%, #0000 100%)`);
    }
  }
  if (room === 'bedroom') layers.push(...STARS.map(([x, y, r]) => `radial-gradient(circle at ${x}% ${y}%, #FFF4D6cc 0 ${r}px, #0000 ${r + 0.8}px)`));
  // the room's light: high and open in the garden, low and warm by the lamp in the bedroom
  const at = room === 'bedroom' ? '110% 70% at 32% 58%' : room === 'garden' ? '130% 80% at 50% 30%' : '120% 78% at 50% 42%';
  layers.push(`radial-gradient(${at}, ${core} 0%, ${mid} 55%, ${edge} 100%)`);
  return { room, edge, glow: glowOf(look), hue: t.light, image: layers.join(', '), floor: `radial-gradient(closest-side, ${L.pool}40, ${L.pool}00)` };
}

/** The horizon sits this far behind the character's ground line (px): the pet stands on the floor, not on the seam. */
const HORIZON = 34;
