import { describe, expect, it } from 'vitest';
import { EYE, eyeD, MOUTH, mouthD, PRESET_LOOKS, characterModel } from '@/lib/studio/character';
import { bulgePath, gapeMouth, MOUTH_KEY, PET_EYE, petEyeD, petMouthD, tongueOf } from './face';
import { Gaze } from './gaze';
import { seeded } from './rng';

describe('pet face range (eating, laughing, dizzy)', () => {
  it('draws the kit eye and mouth byte for byte when the pet morphs are off', () => {
    for (const e of [EYE.idle, EYE.happy, EYE.surprised, PET_EYE.bliss]) {
      expect(petEyeD(83, 105, e, 1)).toBe(eyeD(83, 105, e));
      expect(petEyeD(117, 105, { ...e, v: 0 }, -1)).toBe(eyeD(117, 105, e));
    }
    for (const m of [MOUTH.idle, MOUTH.happy, MOUTH.listening]) {
      expect(petMouthD(100, 125, m)).toBe(mouthD(100, 125, m));
      expect(gapeMouth(m, 0, 4)).toBe(m);
    }
  });

  it('squeezed eyes are chevrons pointing at the nose (>_<)', () => {
    const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = (d: string) => nums(d).filter((_, i) => i % 2 === 0);
    const l = xs(petEyeD(83, 105, PET_EYE.squeeze, 1)), r = xs(petEyeD(117, 105, PET_EYE.squeeze, -1));
    // the left eye's tip handles reach right of its centre, the right eye's left of it
    expect(Math.max(...l)).toBeGreaterThan(83 + PET_EYE.squeeze.w);
    expect(Math.min(...r)).toBeLessThan(117 - PET_EYE.squeeze.w);
    expect(PET_EYE.dizzy.sw).toBe(1);
  });

  it('gapes from the mouth through "aah" to the widest (~45 % of the cheek span), with a tongue only when open', () => {
    const m = characterModel(PRESET_LOOKS[1], { uid: 't', mode: 'live', stage: 4, expr: 'idle', size: 200 });
    const span = m.face.cheeks.x[1] - m.face.cheeks.x[0];
    const wide = gapeMouth(MOUTH.idle, 2, 4);
    expect((2 * wide.w) / span).toBeGreaterThan(0.5);
    expect(gapeMouth(MOUTH.idle, 1, 4).w).toBeCloseTo(MOUTH_KEY.aah.w, 5);
    expect(tongueOf(wide, 100, 125).o).toBe(1);
    expect(tongueOf(MOUTH.idle, 100, 125).o).toBe(0);
    // the tongue sits inside the opening (above its lowest point)
    const t = tongueOf(wide, 100, 125), bottom = 0.25 * (125 - wide.lift) + 0.75 * (125 + wide.l);
    expect(t.y + t.ry).toBeLessThan(bottom);
  });

  it('bulges the outline smoothly and leaves it alone at rest', () => {
    const d = characterModel(PRESET_LOOKS[0], { uid: 't', mode: 'live', stage: 4, expr: 'idle', size: 200 }).bodyD;
    expect(bulgePath(d, 100, [])).toBe(d);
    expect(bulgePath(d, 100, [{ y: 120, a: 0, s: 12 }])).toBe(d);
    const b = bulgePath(d, 100, [{ y: 120, a: 0.1, s: 12 }]);
    expect(b.replace(/[-\d.]+/g, '#')).toBe(d.replace(/[-\d.]+/g, '#'));
    const w = (p: string) => { const n = (p.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number); const x = n.filter((_, i) => i % 2 === 0); return Math.max(...x) - Math.min(...x); };
    expect(w(b)).toBeGreaterThan(w(d) * 1.05);
  });
});

describe('gaze saccades stay stable on the 1/120 s substep', () => {
  it('a tiny saccade converges instead of diverging', () => {
    const g = new Gaze(seeded(3));
    let t = 0;
    g.look(0.3, 0.1, t);
    for (let i = 0; i < 60; i++) { t += 1000 / 60; g.update(t, 1000 / 60); }
    // a 1 % jump: the shortest saccade spring there is
    g.look(0.31, 0.1, t);
    for (let i = 0; i < 120; i++) { t += 1000 / 60; g.update(t, 1000 / 60); }
    expect(Math.abs(g.ex.x)).toBeLessThan(1.01);
    expect(Math.abs(g.ex.x + g.hx.x - 0.31)).toBeLessThan(0.02);
  });
});
