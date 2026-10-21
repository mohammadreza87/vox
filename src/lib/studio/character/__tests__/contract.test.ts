import { describe, expect, it } from 'vitest';
import {
  ACCESSORIES, characterModel, characterSvg, eyeD, EYE, FAMILY_IDS, HAIR_STYLES, isCompatible, lookKey, modelToSvg, normalizeLook, parseLookPatch,
  PRESET_LOOKS, RIG_LAYERS, SPECIES, silhouette, stageFor, STAGE_PARTS, suggestAccessories,
} from '..';
import { HUES, type CharacterLook } from '../../types';

const legacy: CharacterLook = { hue: 'sky', family: 'drift', features: { cheeks: true, lashes: false, brows: true } };

describe('character contract', () => {
  it('normalises a legacy look to a plain cloud with stable identity', () => {
    const n = normalizeLook(legacy);
    expect(n).toMatchObject({ species: 'cloud', hair: 'none', hairTone: 'deep', accessory: 'none', accent: 'ink' });
    expect(lookKey(legacy)).toBe(lookKey(n));
    expect(lookKey({ ...legacy, hue: 'rose' })).not.toBe(lookKey(legacy));
    expect(lookKey({ ...legacy, species: 'cat' })).not.toBe(lookKey(legacy));
    expect(normalizeLook({ hue: 'neon', family: 'blob', features: 'x' })).toMatchObject({ hue: 'lilac', family: 'puff' });
  });

  it('renders a legacy look as a plain cloud: no species parts, hair or accessory', () => {
    const m = characterModel(legacy, { uid: 'l', mode: 'still' });
    expect(m.layers.back).toEqual([]);
    expect(m.layers.ears).toEqual([]);
    expect(m.layers.hair).toEqual([]);
    expect([...m.layers['acc-rigid'], ...m.layers['acc-soft']]).toEqual([]);
    expect(m.face.mouthKind).toBe('lens');
  });

  it('validates patches like setLook does and never takes photo fields', () => {
    expect(parseLookPatch({ hue: 'neon' }, legacy)).toEqual({ ok: false, error: 'Unknown colour' });
    expect(parseLookPatch({ family: 'blob' }, legacy)).toEqual({ ok: false, error: 'Unknown shape' });
    expect(parseLookPatch({ species: 'fox' }, legacy)).toEqual({ ok: false, error: 'Unknown species' });
    expect(parseLookPatch({ features: { brows: 'yes' } }, legacy)).toEqual({ ok: false, error: 'Face features can only be on or off.' });
    const r = parseLookPatch({ hue: 'rose', features: { lashes: true }, avatar: 'x.jpg' }, legacy);
    expect(r.ok && r.look).toMatchObject({ hue: 'rose', family: 'drift', features: { cheeks: true, lashes: true, brows: true } });
    expect(r.ok && 'avatar' in r.look).toBe(false);
    expect(parseLookPatch({ accessory: 'beret' }, legacy)).toMatchObject({ ok: true, look: { accessory: 'beret', accent: 'berry' } });
    expect(parseLookPatch({ species: 'bunny', hair: 'spiky' }, legacy)).toMatchObject({ ok: false });
  });

  it('keeps a saved look that a newer rule forbids editable, but still rejects a chosen clash', () => {
    const saved = normalizeLook({ ...legacy, family: 'puff', species: 'dog', accessory: 'headphones', accent: 'ink' });
    expect(isCompatible(saved)).toMatchObject({ ok: false, field: 'accessory' });
    expect(parseLookPatch({ hue: 'rose' }, saved)).toMatchObject({ ok: true, look: { hue: 'rose', species: 'dog', accessory: 'none' } });
    expect(parseLookPatch({ accessory: 'headset' }, saved)).toMatchObject({ ok: false });
    expect(parseLookPatch({ species: 'bunny' }, normalizeLook({ ...legacy, accessory: 'beret' }))).toMatchObject({ ok: false });
  });

  it('enforces the compatibility rules', () => {
    const l = normalizeLook(legacy);
    expect(isCompatible(l)).toEqual({ ok: true });
    for (const hat of ['beret', 'cap', 'beanie'] as const) for (const hair of ['tuft', 'bun', 'spiky'] as const) {
      expect(isCompatible({ ...l, accessory: hat, hair })).toMatchObject({ ok: false, field: 'accessory' });
    }
    expect(isCompatible({ ...l, accessory: 'cap', hair: 'fringe' })).toEqual({ ok: true });
    expect(isCompatible({ ...l, species: 'chick', hair: 'tuft' })).toMatchObject({ ok: false, field: 'hair' });
    expect(isCompatible({ ...l, species: 'owl', hair: 'curls' })).toMatchObject({ ok: false, field: 'hair' });
    expect(isCompatible({ ...l, species: 'owl', hair: 'fringe' })).toEqual({ ok: true });
    expect(isCompatible({ ...l, species: 'bunny', accessory: 'beanie' })).toMatchObject({ ok: false, field: 'accessory' });
    expect(isCompatible({ ...l, species: 'bunny', accessory: 'beret' })).toMatchObject({ ok: false, field: 'accessory' });
    expect(isCompatible({ ...l, species: 'bunny', accessory: 'bow' })).toEqual({ ok: true });
    for (const hat of ['beret', 'cap', 'beanie'] as const) expect(isCompatible({ ...l, accessory: hat, hair: 'curls' })).toMatchObject({ ok: false, field: 'accessory' });
    expect(isCompatible({ ...l, species: 'bunny', hair: 'spiky' })).toMatchObject({ ok: false, field: 'hair' });
    for (const hair of ['bun', 'curls'] as const) expect(isCompatible({ ...l, species: 'bunny', hair })).toMatchObject({ ok: false, field: 'hair' });
    expect(isCompatible({ ...l, species: 'dog', family: 'drift', accessory: 'headset' })).toMatchObject({ ok: false });
    for (const family of FAMILY_IDS) expect(isCompatible({ ...l, species: 'dog', family, accessory: 'headphones' })).toMatchObject({ ok: false, field: 'accessory' });
    expect(isCompatible({ ...l, species: 'dog', family: 'puff', accessory: 'glasses' })).toEqual({ ok: true });
  });

  it('keeps the D7 stage thresholds in one place', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => stageFor(d, 'active'))).toEqual([1, 2, 2, 3, 3, 4, 4]);
    expect(stageFor(3, 'draft')).toBe(4);
    expect(stageFor(1, 'awaiting_bot')).toBe(4);
    expect(stageFor(null, 'active')).toBe(4);
    expect(STAGE_PARTS[1]).toEqual([]);
    expect(STAGE_PARTS[3]).toContain('hair');
    expect(STAGE_PARTS[3]).not.toContain('accessory');
    expect(STAGE_PARTS[4]).toContain('accessory');
  });

  it('suggests accessories by role', () => {
    expect(suggestAccessories('Customer support lead')).toEqual(['headset']);
    expect(suggestAccessories('Data analyst')).toContain('specs');
    expect(suggestAccessories('Gardener')).toEqual(['none', 'bow']);
  });

  it('curates at least 24 compatible presets covering every species, hair, accessory, family and hue', () => {
    expect(PRESET_LOOKS.length).toBeGreaterThanOrEqual(24);
    for (const look of PRESET_LOOKS) expect(isCompatible(look)).toEqual({ ok: true });
    const seen = (k: keyof CharacterLook) => new Set(PRESET_LOOKS.map((l) => l[k]));
    for (const s of SPECIES) expect(seen('species')).toContain(s);
    for (const h of HAIR_STYLES) expect(seen('hair')).toContain(h);
    for (const a of ACCESSORIES) if (a !== 'none') expect(seen('accessory')).toContain(a);
    for (const f of FAMILY_IDS) expect(seen('family')).toContain(f);
    for (const h of HUES) expect(seen('hue')).toContain(h);
    expect(new Set(PRESET_LOOKS.map(lookKey)).size).toBe(PRESET_LOOKS.length);
  });

  it('keeps the presets rich: every species several times on several families, varied tones, lineup first', () => {
    expect(PRESET_LOOKS.slice(0, SPECIES.length).map((l) => l.species)).toEqual([...SPECIES]);
    for (const s of SPECIES) {
      const of = PRESET_LOOKS.filter((l) => l.species === s);
      expect(of.length).toBeGreaterThanOrEqual(5);
      expect(new Set(of.map((l) => l.family)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(of.map((l) => l.hue)).size).toBeGreaterThanOrEqual(4);
    }
    const tones = new Set(PRESET_LOOKS.filter((l) => l.hair !== 'none').map((l) => l.hairTone));
    for (const t of ['deep', 'cocoa', 'ink'] as const) expect(tones).toContain(t);
    expect([...tones].some((t) => (HUES as readonly string[]).includes(t!))).toBe(true);
    expect(PRESET_LOOKS.some((l) => (HUES as readonly string[]).includes(l.accent!))).toBe(true);
    // hair never in the body's own hue (it would vanish)
    for (const l of PRESET_LOOKS) expect(l.hairTone).not.toBe(l.hue);
  });

  it('builds one model for stills and live, with no filters and no aura anywhere', () => {
    const still = characterModel(legacy, { uid: 's', mode: 'still' });
    const live = characterModel(legacy, { uid: 'l', mode: 'live' });
    expect(Object.keys(still.layers)).toEqual([...RIG_LAYERS]);
    expect(modelToSvg(still)).not.toContain('<filter');
    expect(modelToSvg(live)).not.toContain('<filter');
    expect(still.layers.aura).toEqual([]);
    expect(live.layers.aura).toEqual([]);
    const eyeL = (m: typeof live) => m.layers.face.flatMap((n) => [n, ...(n.children ?? [])]).find((n) => n.attrs['data-part'] === 'eye-l')?.attrs.d;
    // the face sits on the dome axis at half the body height: drift leans it left
    const s = silhouette('drift', 4), fx = 100 + s.lean * s.W * 0.7, ey = 166 - 0.5 * s.R.h * s.W;
    expect(eyeL(live)).toBe(eyeD(fx - 17.3, ey, EYE.idle));
    expect(eyeL(still)).toBe(eyeL(live));
    expect(characterSvg(legacy)).toMatch(/^<svg[^>]+width="640"/);
  });

  it('starts the presets with the reference look: a lagoon cloud in round glasses with blush', () => {
    expect(PRESET_LOOKS[0]).toMatchObject({ hue: 'lagoon', species: 'cloud', hair: 'none', accessory: 'glasses', features: { cheeks: true } });
  });
});
