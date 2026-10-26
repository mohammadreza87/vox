import { describe, expect, it } from 'vitest';
import { GROUND, PRESET_LOOKS } from '@/lib/studio/character';
import { awayBackdrop } from './roomLight';
import { backdrop as base, characterBox, groundPoint, type SceneRoom } from './scene';

/** what the page draws once the away rooms' chunk is in */
const backdrop = (look: Parameters<typeof base>[0], room?: SceneRoom, groundY?: number) => base(look, room, groundY, awayBackdrop);

const ROOMS: SceneRoom[] = ['home', 'play', 'garden', 'closet', 'bedroom', 'book'];
/** the relative luminance of a #rrggbb colour */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('room backdrops (P-04, design §4, §10.5, §10.7)', () => {
  it('every room is its own place: its own backdrop, light and edge colour', () => {
    for (const look of PRESET_LOOKS.slice(0, 6)) {
      const all = ROOMS.map((r) => backdrop(look, r, 420));
      expect(new Set(all.map((b) => b.image)).size).toBe(ROOMS.length);
      expect(new Set(all.map((b) => b.edge)).size).toBeGreaterThanOrEqual(5);
      all.forEach((b, i) => expect(b.room).toBe(ROOMS[i]));
    }
  });

  it('Home is the dusk room as before; the bedroom is the darkest; play is brighter than home', () => {
    const look = PRESET_LOOKS[0];
    expect(backdrop(look).image).toBe(backdrop(look, 'home', 420).image);
    expect(backdrop(look).image.startsWith('radial-gradient(120% 78% at 50% 40%')).toBe(true);
    const edge = (r: SceneRoom) => lum(backdrop(look, r, 420).edge);
    for (const r of ROOMS) if (r !== 'bedroom') expect(edge('bedroom')).toBeLessThan(edge(r));
    expect(edge('play')).toBeGreaterThan(edge('home'));
  });

  it('the away rooms stand on a floor from a horizon behind the pet; the garden has hills and the bedroom stars', () => {
    const look = PRESET_LOOKS[0];
    for (const r of ['garden', 'closet', 'bedroom', 'book'] as const) expect(backdrop(look, r, 420).image).toMatch(/^linear-gradient\(180deg, #0000 385px/);
    expect(backdrop(look, 'garden', 420).image.match(/at (10|92)% 386px/g)).toHaveLength(2);
    expect(backdrop(look, 'bedroom', 420).image.match(/circle at/g)!.length).toBeGreaterThanOrEqual(5);
    // without a floor line yet (first paint) the room still has its light; before its chunk, Home's (to cross-fade from)
    expect(backdrop(look, 'garden').image).not.toContain('linear-gradient');
    expect(base(look, 'garden', 420)).toEqual(base(look, 'home', 420));
  });

  it('gradients only: nothing animated, no filters or blur (§10.7)', () => {
    for (const r of ROOMS) {
      const b = backdrop(PRESET_LOOKS[2], r, 400);
      for (const v of [b.image, b.floor, b.glow]) expect(v).not.toMatch(/blur|filter|url\(|animation/);
    }
  });
});

describe('the character on the stage (P-17, design §9.2, §9.3)', () => {
  it('Short (360×640) is unchanged: ~74% of the width, centred near 45% of the height', () => {
    expect(characterBox(360, 640, 0, 440, 'short')).toEqual(characterBox(360, 640, 0, 440));
    expect(characterBox(360, 640, 0, 440, 'short').size).toBe(266);
  });

  it('Regular and Tall: bigger, on a floor line about two thirds down the free stage, with the bubble zone above', () => {
    for (const [vw, vh, dock, cls] of [[390, 844, 625, 'regular'], [430, 932, 670, 'tall']] as const) {
      const was = characterBox(vw, vh, 0, dock);
      const box = characterBox(vw, vh, 0, dock, cls);
      expect(box.size).toBeGreaterThan(was.size * 1.15);
      const ground = groundPoint(box).y;
      expect(ground / dock).toBeGreaterThan(0.64);
      expect(ground / dock).toBeLessThan(0.72);
      // the dead stage under the feet is gone (it was ~200 px), and the head keeps ≥ 150 px for a 4-line bubble
      expect(dock - ground).toBeLessThan(220);
      expect(box.y + box.size * 0.2).toBeGreaterThan(150);
      expect(box.x).toBeGreaterThan(0);
    }
    // Tall grows toward the 520 cap with the screen
    expect(characterBox(430, 932, 0, 670, 'tall').size).toBeGreaterThan(characterBox(390, 844, 0, 625, 'regular').size);
    expect(characterBox(1200, 2000, 0, 1600, 'tall').size).toBe(520);
    expect(groundPoint({ x: 0, y: 0, size: 200 }).y).toBe(GROUND);
  });
});
