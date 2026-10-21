import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ACCESSORIES, ACCENT_COLORS, characterModel, characterSvg, circleFit, countDrawn, eyeFor, EYE, FAMILY_IDS, HAIR_STYLES, HAIR_TONES,
  INK, isCompatible, MOUTH, mouthFor, normalizeLook, mouthOpenness, beakLowerD, RIG_LAYERS, SPECIES, STAGE_EYE, talkMouth, type Expression, type SvgNode,
} from '..';
import { accessoryParts } from '../accessories';
import { bodyD, bodyOutline, edgesAt, pathPts, silhouette, stageScale } from '../geometry';
import { hairParts } from '../hair';
import { ACCENTS, FILL_MIN_L, HAIR_MIN_L, INK_HAIR, accentColor, derivePalette, hairMaterial, hueDist, luminance, oklch } from '../palette';
import { PRESET_LOOKS } from '../presets';
import { HUES, type CharacterLook, type Stage } from '../../types';

const EXPRS: Expression[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleeping'];
const STAGES: Stage[] = [1, 2, 3, 4];

/** Seeded matrix of compatible looks (Park–Miller). */
function matrix(count: number, seed = 42): CharacterLook[] {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const out: CharacterLook[] = [];
  while (out.length < count) {
    const l: CharacterLook = {
      hue: pick(HUES), family: pick(FAMILY_IDS), species: pick(SPECIES), hair: pick(HAIR_STYLES), hairTone: pick(HAIR_TONES),
      accessory: pick(ACCESSORIES), accent: pick(ACCENT_COLORS), features: { cheeks: r() < 0.5, lashes: r() < 0.5, brows: r() < 0.5 },
    };
    if (isCompatible(l).ok) out.push(l);
  }
  return out;
}
const LOOKS = matrix(300);
const drawn = (m: ReturnType<typeof characterModel>) => RIG_LAYERS.reduce((n, l) => n + countDrawn(m.layers[l]), 0);
const all = (nodes: SvgNode[]): SvgNode[] => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
const part = (m: ReturnType<typeof characterModel>, p: string) => all(m.layers.face).find((n) => n.attrs['data-part'] === p);
const commands = (d: string) => d.replace(/[^A-Za-z]/g, '');

describe('character renderer (minimal)', () => {
  it('keeps every still within 45 drawn elements, with no filters, still or live', () => {
    let worst = 0;
    for (const look of LOOKS) for (const stage of STAGES) for (const expr of ['idle', 'happy', 'speaking'] as const) {
      const still = characterModel(look, { uid: 'a', mode: 'still', stage, expr, size: 640 });
      const live = characterModel(look, { uid: 'b', mode: 'live', stage, expr, size: 240 });
      worst = Math.max(worst, drawn(still));
      expect(characterSvg(look, { stage, expr, size: 640 })).not.toMatch(/<filter|feGaussianBlur/);
      expect(all([...live.defs, ...RIG_LAYERS.flatMap((l) => live.layers[l])]).some((n) => n.tag === 'filter' || 'filter' in n.attrs)).toBe(false);
      expect(drawn(live)).toBeLessThanOrEqual(drawn(still));
    }
    expect(worst).toBeLessThanOrEqual(45);
  });

  it('draws no aura, glow, gloss or outline: one body path in one gradient, a matte form shade, a dark contact shadow', () => {
    for (const look of LOOKS.slice(0, 80)) {
      const m = characterModel(look, { uid: 'n', mode: 'still' });
      expect(m.layers.aura).toEqual([]);
      const body = m.layers.body;
      expect(body).toHaveLength(2);
      expect(body[0].attrs).toMatchObject({ d: m.bodyD, fill: 'url(#np0)' });
      // the form shade is the same path in the body's deep tone, clear over the face and at most a third along the
      // underside: a matte occlusion, never a gloss or a glow
      expect(body[1].attrs).toMatchObject({ d: m.bodyD, fill: 'url(#np1)', 'data-part': 'shade' });
      const shade = m.defs.find((d) => d.attrs.id === 'np1')!.children!;
      expect(new Set(shade.map((x) => x.attrs['stop-color']))).toEqual(new Set([m.palette.deep]));
      expect(shade[0].attrs['stop-opacity']).toBe(0);
      expect(Math.max(...shade.map((x) => Number(x.attrs['stop-opacity'])))).toBeLessThanOrEqual(0.35);
      for (const b of body) expect('stroke' in b.attrs).toBe(false);
      // ears and hair carry no outline either
      for (const nd of all([...m.layers.back, ...m.layers.ears, ...m.layers.hair])) expect('stroke' in nd.attrs).toBe(false);
      // the shadow is black falling to nothing: darker than the ground, never a lit halo
      const cs = m.defs.find((d) => d.attrs.id === 'ncs')!;
      expect(cs.children!.map((s) => s.attrs['stop-color'])).toEqual(['#000', '#000', '#000']);
      expect(m.layers.shadow[0].attrs.fill).toBe('url(#ncs)');
    }
  });

  it('rasterises the 300-look matrix at every stage without error', async () => {
    const jobs = LOOKS.flatMap((look, i) => STAGES.map((stage) => characterSvg(look, { stage, size: 64, uid: `m${i}`, bg: i % 3 ? 'none' : 'halo', fit: i % 3 ? undefined : 'circle' })));
    for (let i = 0; i < jobs.length; i += 50) {
      const pngs = await Promise.all(jobs.slice(i, i + 50).map((svg) => sharp(Buffer.from(svg)).png().toBuffer()));
      for (const png of pngs) expect(png.length).toBeGreaterThan(200);
    }
  }, 60_000);

  it('emits morphable face paths: every eye and mouth shares one M C C Z structure', () => {
    for (const look of LOOKS.slice(0, 40)) for (const stage of STAGES) for (const expr of EXPRS) {
      const m = characterModel(look, { uid: 'f', mode: 'live', stage, expr });
      for (const p of ['eye-l', 'eye-r', 'mouth']) expect(commands(String(part(m, p)?.attrs.d))).toBe('MCCZ');
    }
    for (const e of [...Object.values(EYE), ...Object.values(STAGE_EYE)]) expect(e.w).toBeGreaterThan(0);
    for (const m of [...Object.values(MOUTH), talkMouth(0), talkMouth(1)]) expect(m.w).toBeGreaterThan(0);
  });

  it('keeps one tweenable body rig (M + 8 C + Z) across every family and stage', () => {
    for (const family of FAMILY_IDS) for (const stage of STAGES) {
      const d = bodyD(silhouette(family, stage));
      expect(commands(d)).toBe('MCCCCCCCCZ');
      // the silhouette is closed at the base point it starts from
      expect(d.startsWith(`M${100} 166`)).toBe(true);
    }
    // each family reads at a glance: tower is the same bun (same base width and saddle) under a taller dome; drift
    // (A2) leans its dome left over a full, low left lobe, its right shoulder smaller and higher
    const puff = silhouette('puff', 4), tower = silhouette('tower', 4), drift = silhouette('drift', 4);
    expect(tower.top).toBeLessThan(puff.top - 5);
    expect(tower.R.hw * tower.W).toBeCloseTo(puff.R.hw * puff.W, 5);
    expect(edgesAt(tower, 160)).toEqual(edgesAt(puff, 160));
    expect(tower.R.rL).toBe(puff.R.rL);
    expect(drift.dome.cx).toBeLessThan(100 - 0.04 * drift.W);
    expect(drift.L.yw).toBeLessThan(drift.R.yw - 0.03);
    expect(drift.R.rL).toBeLessThan(drift.L.rL);
  });

  it('cuts a clear shoulder saddle at stage 4 and keeps the stage-1 wisp convex', () => {
    // signed turn of the sampled outline (convex turns are negative here): a formed cloud turns back (concave) at
    // its saddles, a wisp never does
    const turns = (family: (typeof FAMILY_IDS)[number], stage: Stage) => {
      const p = bodyOutline(silhouette(family, stage), 24);
      return p.map((a, i) => { const b = p[(i + 1) % p.length], c = p[(i + 2) % p.length]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); });
    };
    for (const family of FAMILY_IDS) {
      expect(Math.max(...turns(family, 1))).toBeLessThan(0);
      expect(Math.max(...turns(family, 4))).toBeGreaterThan(0);
    }
    // and the wisp is clearly smaller than the stage-2 puff
    expect(stageScale(1) / stageScale(2)).toBeLessThan(0.8);
  });

  it('grows the body, face and parts by stage (STYLE §6)', () => {
    const look: CharacterLook = { hue: 'lagoon', family: 'puff', species: 'cat', hair: 'fringe', hairTone: 'ink', accessory: 'bow', accent: 'coral', features: { cheeks: true, lashes: true, brows: false } };
    const m = STAGES.map((stage) => characterModel(look, { uid: 'g', mode: 'still', stage }));
    expect(m.map((x) => x.growth)).toEqual([0.62, 0.82, 0.92, 1]);
    // a wisp already shows one faint species cue: half-size ear nubs, still half mist
    expect(m[0].layers.back).toHaveLength(2);
    expect(m[0].layers.back.every((g) => Number(g.attrs.opacity) < 1)).toBe(true);
    expect(m[1].layers.back.length).toBeGreaterThan(0); // budding ears
    expect(m.map((x) => x.layers.hair.length > 0)).toEqual([false, false, true, true]);
    expect(m.map((x) => x.layers['acc-soft'].length > 0)).toEqual([false, false, false, true]);
    // the wisp already smiles (the smallest smile), so stage 2 is a gentle step, not a new face
    expect(part(m[0], 'mouth')?.attrs.opacity).toBeUndefined();
    expect(mouthFor('idle', 1)).toBe(MOUTH.wisp);
    expect(MOUTH.wisp.w).toBeLessThan(MOUTH.flat.w);
    // a wisp is paler, but keeps a clear tint of its own hue (it is not the formed light tone)
    expect(luminance(m[0].palette.base)).toBeGreaterThan(luminance(derivePalette('lagoon', 4).base));
    expect(m[0].palette.base).not.toBe(derivePalette('lagoon', 4).light);
    expect(eyeFor('idle', 1)).toBe(STAGE_EYE[1]);
    // stage 2 adds one warm cue each: a tiny upturned smile (corners lifted) and a faint blush
    expect(mouthFor('idle', 2)).toBe(MOUTH.flat);
    expect(MOUTH.flat.lift).toBeGreaterThan(0.8);
    const blush = (x: ReturnType<typeof characterModel>) => all(x.layers.face).filter((nd) => nd.tag === 'ellipse' && String(nd.attrs.fill).endsWith('bl)'));
    expect(blush(m[0])).toEqual([]);
    expect(blush(m[1]).length).toBe(2);
    expect(Number(blush(m[1])[0].attrs.opacity)).toBeLessThan(Number(blush(m[3])[0].attrs.opacity));
  });

  it('draws the reference face: small ink ovals with one highlight, a stroked smile, deep-shade brows', () => {
    const m = characterModel({ hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: true } }, { uid: 'r', mode: 'still' });
    expect(part(m, 'eye-l')?.attrs.fill).toBe(INK);
    expect(EYE.idle.t / EYE.idle.w).toBeGreaterThan(2);
    // one small dim catchlight per eye, near the top
    const lids = all(m.layers.face).find((nd) => nd.attrs['data-part'] === 'lids')!;
    const glints = lids.children!.filter((nd) => nd.attrs.fill === '#FCFFFA');
    expect(glints).toHaveLength(1);
    expect(String(glints[0].attrs.d).match(/M/g)).toHaveLength(2);
    expect(Number(glints[0].attrs.opacity)).toBeLessThan(0.8);
    expect(part(m, 'mouth')?.attrs['stroke-width']).toBe(2.55);
    // brows are the body's own deep shade (B1's #5B8BB3), never ink
    expect(part(m, 'brows')?.attrs.stroke).toBe(derivePalette('sky', 4).deep);
    expect(part(m, 'brows')?.attrs.stroke).not.toBe(INK);
    const [l, r] = m.face.eyes;
    expect(r.cx - l.cx).toBeCloseTo(34.6, 1);
  });

  it('puts a readable beak on owls and chicks, over a small smile, and keeps owl eyes the kit eyes', () => {
    const cat: CharacterLook = { hue: 'rose', family: 'puff', species: 'cat', features: { cheeks: true, lashes: false, brows: false } };
    expect(characterModel(cat, { uid: 'c', mode: 'live' }).face.mouthKind).toBe('lens');
    expect(part(characterModel(cat, { uid: 'c', mode: 'live' }), 'mouth')?.attrs.opacity).toBeUndefined();
    for (const species of ['owl', 'chick'] as const) {
      const idle = characterModel({ ...cat, species }, { uid: 'o', mode: 'live' });
      expect(idle.face.mouthKind).toBe('beak');
      const beak = part(idle, 'mouth-deco');
      // a saturated orange with an ink-toned edge, well apart from any warm body tone
      expect(beak?.attrs.fill).toBe('#F08A3C');
      expect(beak?.attrs.stroke).toBeDefined();
      // the smile stays under the beak (idle, happy); the quiet smirk and the sleeper's dot give way to it
      expect(part(idle, 'mouth')?.attrs.opacity).toBeUndefined();
      expect(part(characterModel({ ...cat, species }, { uid: 'o', mode: 'live', expr: 'happy' }), 'mouth')?.attrs.opacity).toBeUndefined();
      expect(part(characterModel({ ...cat, species }, { uid: 'o', mode: 'live', expr: 'thinking' }), 'mouth')?.attrs.opacity).toBe(0);
      expect(idle.face.mouth.y).toBeGreaterThan(idle.face.eyes[0].cy + 15);
    }
    // owls keep the same eyes as every species, and no whitish face disc or halo round them (no glow rule): the
    // tufts and the beak are the tell
    const owl = characterModel({ ...cat, species: 'owl' }, { uid: 'o', mode: 'live' });
    expect(owl.face.eyeTune).toEqual([1, 1]);
    expect(part(owl, 'face-disc')).toBeUndefined();
    expect(owl.defs.some((d) => d.attrs.id === 'ofd')).toBe(false);
  });

  it('opens the beak to talk: the lower mandible drops over a dark opening, one mouth only', () => {
    const look: CharacterLook = { hue: 'matcha', family: 'puff', species: 'owl', features: { cheeks: true, lashes: false, brows: false } };
    const lowY = (m: ReturnType<typeof characterModel>) => Math.max(...[...String(part(m, 'beak-lo')!.attrs.d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((x) => Number(x[2])));
    const idle = characterModel(look, { uid: 'b', mode: 'still' }), talk = characterModel(look, { uid: 'b', mode: 'still', expr: 'speaking' });
    // a still speaking frame drops the lower mandible a clear 3 u or more; at rest it stays shut
    expect(lowY(talk) - lowY(idle)).toBeGreaterThan(3);
    expect(beakLowerD(100, 100, 1.3, 0)).toBe(beakLowerD(100, 100, 1.3));
    expect(mouthOpenness(MOUTH.idle)).toBe(0);
    expect(mouthOpenness(talkMouth(1))).toBeGreaterThan(0.95);
    // the opening is a dark wedge, painted under both halves; no lip or second mouth is drawn
    const faceParts = all(talk.layers.face).map((nd) => nd.attrs['data-part']).filter(Boolean);
    expect(faceParts.indexOf('mouth')).toBeLessThan(faceParts.indexOf('beak-lo'));
    expect(faceParts.indexOf('beak-lo')).toBeLessThan(faceParts.indexOf('mouth-deco'));
    expect(faceParts.filter((p) => p === 'mouth')).toHaveLength(1);
    expect(talk.face.beak).toBeDefined();
  });

  it('applies the small-size LOD: bigger eyes, heavier strokes, fewer marks, no glasses at 32 px', () => {
    const look: CharacterLook = { hue: 'sky', family: 'puff', species: 'cat', accessory: 'glasses', features: { cheeks: true, lashes: true, brows: false } };
    const big = characterModel(look, { uid: 'b', mode: 'still', size: 240 });
    const small = characterModel(look, { uid: 's', mode: 'still', size: 48 });
    const tiny = characterModel(look, { uid: 't', mode: 'still', size: 32 });
    expect(small.face.eyeScale).toBeGreaterThan(big.face.eyeScale);
    expect(small.face.strokeW).toBeGreaterThan(big.face.strokeW);
    const bare = { ...look, accessory: 'none' as const };
    expect(drawn(characterModel(bare, { uid: 's', mode: 'still', size: 48 }))).toBeLessThan(drawn(characterModel(bare, { uid: 'b', mode: 'still', size: 240 })));
    expect(big.layers['acc-rigid'].length).toBeGreaterThan(0);
    expect(tiny.layers['acc-rigid']).toEqual([]);
    // at 48 px the glasses drop the bridge and thin their rings, and the lensed eyes shrink, so eyes, frame and
    // mouth stay three separate marks
    const rings = (m: ReturnType<typeof characterModel>) => m.layers['acc-rigid'][0].attrs;
    expect(String(rings(big).d).match(/M/g)).toHaveLength(3);
    expect(String(rings(small).d).match(/M/g)).toHaveLength(2);
    const at56 = characterModel(look, { uid: 'm', mode: 'still', size: 56 });
    expect(Number(rings(small)['stroke-width'])).toBeLessThan(Number(rings(at56)['stroke-width']));
    expect(small.face.eyeScale).toBeLessThan(at56.face.eyeScale * 0.9);
  });

  it('keeps the reference two-dot face: lashes give way to glasses, brows and icon sizes', () => {
    const look: CharacterLook = { hue: 'lilac', family: 'puff', features: { cheeks: true, lashes: true, brows: false } };
    expect(part(characterModel(look, { uid: 'l', mode: 'still' }), 'lashes')).toBeDefined();
    expect(part(characterModel({ ...look, accessory: 'glasses' }, { uid: 'l', mode: 'still' }), 'lashes')).toBeUndefined();
    expect(part(characterModel({ ...look, accessory: 'specs' }, { uid: 'l', mode: 'still' }), 'lashes')).toBeUndefined();
    expect(part(characterModel({ ...look, features: { ...look.features, brows: true } }, { uid: 'l', mode: 'still' }), 'lashes')).toBeUndefined();
    expect(part(characterModel(look, { uid: 'l', mode: 'still', size: 56 }), 'lashes')).toBeUndefined();
  });

  it('sets lensed eyes inside the rings with clear air above and below', () => {
    const m = characterModel({ hue: 'lagoon', family: 'puff', accessory: 'glasses', features: { cheeks: true, lashes: false, brows: false } }, { uid: 'e', mode: 'still' });
    const ring = 13.6, line = 2.55, eye = EYE.idle.t * m.face.eyeScale * m.face.eyeTune[1];
    expect(ring - line / 2 - eye).toBeGreaterThan(2.5);
    expect(eye / ring).toBeLessThan(0.66);
  });

  it('seats every hat on the crown of every family and species', () => {
    for (const family of FAMILY_IDS) for (const species of SPECIES) for (const accessory of ['beret', 'cap', 'beanie'] as const) {
      const look: CharacterLook = { hue: 'ash', family, species, accessory, features: { cheeks: false, lashes: false, brows: false } };
      if (!isCompatible(look).ok) continue;
      const s = silhouette(family, 4);
      const box = accessoryParts(accessory, { s, eL: 80, eR: 120, ey: 107, my: 125, color: '#000', clip: 'url(#c)', id: (x) => x })!.box;
      // the hat straddles the crown: its top above it, its band below it, never floating
      expect(box.y0).toBeLessThan(s.top - 3);
      expect(box.y1).toBeGreaterThan(s.top + 4);
      expect(box.y0).toBeGreaterThan(s.top - 34);
    }
  });

  it('fits every look inside the Telegram circle crop', () => {
    for (const look of LOOKS.slice(0, 120)) {
      const m = characterModel(look, { uid: 'p', mode: 'still', stage: 4 });
      const { fit, shift } = circleFit(m);
      const cx = m.pivots.body[0], k = m.growth * fit;
      const map = (x: number, y: number) => [cx + shift[0] + (x - cx) * k, 166 + shift[1] + (y - 166) * k];
      const [, top] = map(m.box.x0, m.box.y0), [, bottom] = map(m.box.x0, 172);
      const [left] = map(m.box.x0, 0), [right] = map(m.box.x1, 0);
      expect(fit).toBeGreaterThan(0.6);
      expect(top).toBeGreaterThan(-15 + 6);
      expect(bottom).toBeLessThan(225 - 6);
      expect(left).toBeGreaterThan(-20 + 4);
      expect(right).toBeLessThan(220 - 4);
      for (const [x, y] of m.outline) expect(Math.hypot(map(x, y)[0] - 100, map(x, y)[1] - 105)).toBeLessThan(120 - 8);
    }
  });

  it('frames the Telegram photo large enough to read at 40 px, forming stages included', () => {
    const share = (look: CharacterLook, stage: Stage) => {
      const m = characterModel(look, { uid: 'p', mode: 'still', stage });
      const k = m.growth * circleFit(m).fit;
      return { w: ((m.box.x1 - m.box.x0) * k) / 240, h: ((172 - m.box.y0) * k) / 240 };
    };
    // (tall-eared and hatted looks keep about 10 % clearance above the head, so they frame a touch smaller)
    for (const i of [0, 3, 9]) for (const stage of [2, 4] as const) {
      const { w, h } = share(PRESET_LOOKS[i], stage);
      expect(Math.max(w, h)).toBeGreaterThanOrEqual(0.66);
      expect(Math.max(w, h)).toBeLessThanOrEqual(0.86);
    }
    for (const look of PRESET_LOOKS) expect(Math.max(...Object.values(share(look, 2)))).toBeGreaterThan(0.65);
  });

  it('draws hair as one matte material: a two-stop gradient, ink lifted off black, no strands or gloss', () => {
    expect(luminance(hairMaterial('ink', derivePalette('lagoon', 4)).base)).toBeGreaterThan(luminance(ACCENTS.ink) + 0.015);
    for (const look of LOOKS.filter((l) => l.hair !== 'none').slice(0, 60)) {
      const m = characterModel(look, { uid: 'k', mode: 'still', stage: 4 });
      // (a fringe gives way to a hat entirely)
      if (look.hair === 'fringe' && ['beret', 'cap', 'beanie'].includes(look.accessory ?? 'none')) { expect(m.layers.hair).toEqual([]); continue; }
      const hk = m.defs.find((d) => d.attrs.id === 'khk');
      expect(hk?.children).toHaveLength(2);
      for (const nd of all(m.layers.hair)) if (nd.attrs['data-part'] !== 'tie') expect(nd.attrs.fill).toBe('url(#khk)');
    }
  });

  it('puts each hair style where it reads: small swoops and puffs, never a cap, a helmet or a backpack', () => {
    for (const family of FAMILY_IDS) {
      const s = silhouette(family, 4);
      for (const h of ['tuft', 'fringe', 'curls'] as const) expect(hairParts(h, s)!.front.length).toBeGreaterThan(0);
      expect(hairParts('spiky', s)!.back).toHaveLength(3);
      expect(hairParts('spiky', s)!.front).toEqual([]);
      // the fringe is a side-swept bang clipped to the head (STYLE §5.3), not a cap over the whole dome
      const fringe = hairParts('fringe', s)!;
      expect(fringe.clip).toBe(true);
      const fb = fringe.front[0].k === 'p' ? fringe.front[0].box : null;
      expect(fb!.x0).toBeLessThan(s.dome.cx - 0.7 * s.dome.r);
      expect(fb!.y1).toBeLessThan(s.dome.cy);
      // a mass of hair, never a rim line: about 15 u deep at its fullest, still well above the eyes
      const depth = [...String(fringe.front[0].k === 'p' && fringe.front[0].d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => s.dome.r - Math.hypot(Number(m[1]) - s.dome.cx, Number(m[2]) - s.dome.cy));
      expect(Math.max(...depth)).toBeGreaterThan(12);
      expect(Math.max(...depth)).toBeLessThan(19);
      // under a hat the fringe gives way (a sliver under the brim reads as a glitch)
      expect(hairParts('fringe', s, { hat: true })).toBeNull();
      // the bun: a flattened knot sitting on the crown, in front, with a wrap across its base
      const bun = hairParts('bun', s)!;
      expect(bun.back).toEqual([]);
      const knot = bun.front[0];
      expect(knot.k).toBe('e');
      if (knot.k === 'e') { expect(knot.rx).toBeGreaterThan(knot.ry); expect(knot.cy - knot.ry).toBeLessThan(s.top - 5); expect(knot.cy + knot.ry).toBeGreaterThan(s.top + 5); }
      expect(bun.tie?.rot).toBe(90);
      // the pony: a swept part over the crown, tied at the upper right, and a teardrop tail hanging down and out over
      // the right shoulder (never a floating bead beside the head)
      const pony = hairParts('pony', s)!;
      expect(pony.clip).toBe(true);
      expect(pony.front).toHaveLength(1);
      expect(pony.tie).toBeDefined();
      expect(pony.back).toEqual([]);
      const tail = pony.hang![0];
      expect(tail.k).toBe('p');
      if (tail.k === 'p') {
        expect(tail.box.x1).toBeGreaterThan(s.dome.cx + s.dome.r);
        expect(tail.box.y1).toBeGreaterThan(pony.tie!.y + 15);
      }
      // between ears the tuft is one rounded curl; elsewhere three
      expect(hairParts('tuft', s, { crownEars: true })!.front).toHaveLength(1);
      expect(hairParts('tuft', s)!.front).toHaveLength(3);
      // the curls are the spec's three soft puffs (r 9 / 10 / 9), not chocolate chips
      const curls = hairParts('curls', s)!.front[0];
      const cb = curls.k === 'p' ? curls.box : null;
      expect(cb!.y1 - cb!.y0).toBeGreaterThan(18);
      expect(hairParts('none', s)).toBeNull();
    }
  });

  it('keeps hair a soft matte form: never below L .55, always a clear step off the body', () => {
    expect(oklch(INK_HAIR.base)[0]).toBeGreaterThan(0.6);
    for (const hue of HUES) for (const tone of HAIR_TONES) {
      const pal = derivePalette(hue, 4), m = hairMaterial(tone, pal);
      expect(oklch(m.base)[0], `${hue} ${tone}`).toBeGreaterThanOrEqual(HAIR_MIN_L - 0.005);
      expect(oklch(m.shadow)[0], `${hue} ${tone}`).toBeGreaterThanOrEqual(HAIR_MIN_L - 0.005);
      // a hair darker than the body sits at least ΔL .12 under it (paler hairs go as pale as the gamut allows)
      const d = oklch(pal.base)[0] - oklch(m.base)[0];
      if (d > 0) expect(d, `${hue} ${tone}`).toBeGreaterThanOrEqual(0.115);
    }
  });

  it('gives the dog floppy ears a step deeper than the body that break the silhouette outward (no cap line round the dome)', () => {
    const m = characterModel({ hue: 'apricot', family: 'puff', species: 'dog', features: { cheeks: true, lashes: false, brows: false } }, { uid: 'd', mode: 'still' });
    const sil = silhouette('puff', 4, 100, 'dog');
    expect(m.layers.ears).toHaveLength(2);
    for (const g of m.layers.ears) {
      expect(g.attrs['data-rig']).toMatch(/^ear-[lr]$/);
      expect('clip-path' in g.attrs).toBe(false);
      expect(g.children![0].attrs.fill).toBe('url(#dfl)');
      // the ear reaches past the body's edge at its own height: it reads outside the cloud, not as a patch on it
      const pts = [...String(g.children![0].attrs.d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((x) => [Number(x[1]), Number(x[2])]);
      // (over the saddle, where the body edge dips in: the silhouette shows two droops)
      const right = g.attrs['data-rig'] === 'ear-r';
      const out = Math.max(...pts.map(([x, y]) => { const [l, r] = edgesAt(sil, y); return right ? x - r : l - x; }));
      expect(out).toBeGreaterThan(3);
    }
    // the flap is opaque and a step deeper than the body base (never paler), and never a dark patch
    const fl = m.defs.find((d) => d.attrs.id === 'dfl')!;
    for (const st of fl.children!) {
      const c = String(st.attrs['stop-color']);
      expect(luminance(c)).toBeLessThan(luminance(m.palette.base));
      expect(luminance(c)).toBeGreaterThan(luminance(m.palette.deep));
      expect(st.attrs['stop-opacity']).toBeUndefined();
    }
  });

  it('gives each rendered instance its own paint-server ids', () => {
    const a = characterSvg(LOOKS[0], { uid: 'one' }), b = characterSvg(LOOKS[0], { uid: 'two' });
    const ids = (s: string) => [...s.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]);
    expect(ids(a).every((id) => id.startsWith('one'))).toBe(true);
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
    expect(new Set(ids(a)).size).toBe(ids(a).length);
  });

  it('keeps thinking and sleeping fx clear of side accessories', () => {
    for (const species of SPECIES) for (const accessory of ['bow', 'flower', 'star'] as const) for (const expr of ['thinking', 'sleeping'] as const) {
      const look: CharacterLook = { hue: 'lagoon', family: 'puff', species, accessory, features: { cheeks: false, lashes: false, brows: false } };
      if (!isCompatible(look).ok) continue;
      const m = characterModel(look, { uid: 'f', mode: 'still', expr });
      const accX = Number(String(m.layers['acc-soft'][0].attrs.transform).match(/translate\((-?[\d.]+)/)![1]);
      const xs = [...String(m.layers.fx[0].attrs.d).matchAll(/M(-?\d+(?:\.\d+)?) /g)].map((x) => Number(x[1]));
      for (const x of xs) expect(Math.abs(x - accX), `${species} ${accessory} ${expr}`).toBeGreaterThan(26);
    }
  });

  it('never ties a pony in volt, and keeps the band readable on the hair', () => {
    for (const look of LOOKS.filter((l) => l.hair === 'pony')) {
      const m = characterModel(look, { uid: 't', mode: 'still' });
      const tie = all([...m.layers.back, ...m.layers.hair]).find((n) => n.attrs['data-part'] === 'tie');
      expect(tie).toBeDefined();
      expect(tie?.attrs.fill).not.toBe(ACCENTS.volt);
    }
    // a line accessory keeps its true ink accent on the frames, but the filled band never goes ink or navy
    for (const accessory of ['glasses', 'specs'] as const) for (const accent of ['ink', 'navy'] as const) {
      const look: CharacterLook = { hue: 'lagoon', family: 'puff', species: 'cloud', hair: 'pony', hairTone: 'cream', accessory, accent, features: { cheeks: true, lashes: false, brows: false } };
      const m = characterModel(look, { uid: 't', mode: 'still' });
      const tie = all([...m.layers.back, ...m.layers.hair]).find((n) => n.attrs['data-part'] === 'tie');
      expect(tie?.attrs.fill, `${accessory} ${accent}`).not.toBe(ACCENTS[accent]);
    }
  });

  it('dresses a stored look wearing the retired scarf in a bowtie', () => {
    const look = { hue: 'apricot', family: 'puff', species: 'dog', accessory: 'scarf', accent: 'sky', features: { cheeks: true, lashes: false, brows: false } } as unknown as CharacterLook;
    expect(normalizeLook(look)).toMatchObject({ accessory: 'bowtie', accent: 'sky' });
    expect(characterSvg(look, { stage: 4 })).toBe(characterSvg({ ...look, accessory: 'bowtie' }, { stage: 4 }));
    expect(PRESET_LOOKS.some((l) => (l.accessory as string) === 'scarf')).toBe(false);
  });

  it('seats the bowtie low on the base, well clear of the mouth, in a pastel', () => {
    for (const species of SPECIES) for (const family of FAMILY_IDS) {
      const look: CharacterLook = { hue: 'matcha', family, species, accessory: 'bowtie', features: { cheeks: true, lashes: false, brows: false } };
      if (!isCompatible(look).ok) continue;
      const m = characterModel(look, { uid: 'b', mode: 'still' });
      const sil = silhouette(family, 4, 100, species), H = 166 - sil.top;
      const [, y] = m.pivots['acc-soft'];
      expect(y).toBeGreaterThan(sil.top + 0.8 * H);
      expect(y - m.face.mouth.y).toBeGreaterThan(20);
      const fill = String(all(m.layers['acc-soft']).find((nd) => nd.tag === 'path')!.attrs.fill);
      expect(oklch(fill)[0]).toBeGreaterThanOrEqual(FILL_MIN_L - 0.005);
    }
  });

  it('picks a star (and other clip) colour that reads on the body', () => {
    for (const hue of HUES) for (const accessory of ['star', 'bow', 'flower'] as const) {
      const m = characterModel({ hue, family: 'puff', accessory, features: { cheeks: true, lashes: false, brows: false } }, { uid: 'x', mode: 'still' });
      const fill = String(all(m.layers['acc-soft']).find((nd) => nd.tag === 'path')!.attrs.fill);
      const [L, C, h] = oklch(fill), [bl, bc, bh] = oklch(m.palette.base);
      expect(Math.abs(L - bl), `${hue} ${accessory}`).toBeGreaterThanOrEqual(accessory === 'star' ? 0.1 : 0.08);
      if (C > 0.035 && bc > 0.035) expect(hueDist(h, bh), `${hue} ${accessory}`).toBeGreaterThanOrEqual(accessory === 'star' ? 60 : 45);
    }
  });

  it('hangs dog ears from the upper dome, tipped outward, ending above the cheeks', () => {
    const m = characterModel({ hue: 'apricot', family: 'puff', species: 'dog', features: { cheeks: true, lashes: false, brows: false } }, { uid: 'd', mode: 'still' });
    const cheekY = m.face.mouth.y - 4;
    for (const g of m.layers.ears) {
      const d = String(g.children![0].attrs.d);
      const pts = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((x) => [Number(x[1]), Number(x[2])]);
      expect(Math.max(...pts.map((p) => p[1]))).toBeLessThan(cheekY - 5);
    }
  });

  it('keeps the species cue under a hat: ears peek out either side of it in the body material, owl tufts sit below it, only the sprout hides', () => {
    for (const species of ['cat', 'bear', 'owl', 'chick'] as const) {
      const bare = characterModel({ hue: 'sky', family: 'puff', species, features: { cheeks: true, lashes: false, brows: false } }, { uid: 'h', mode: 'still' });
      expect(bare.layers.back.length).toBeGreaterThan(0);
      for (const accessory of ['beret', 'cap', 'beanie'] as const) {
        const m = characterModel({ hue: 'sky', family: 'puff', species, accessory, features: { cheeks: true, lashes: false, brows: false } }, { uid: 'h', mode: 'still' });
        const ears = all(m.layers['acc-rigid']).filter((nd) => String(nd.attrs['data-rig'] ?? '').startsWith('ear-'));
        if (species === 'cat' || species === 'bear') {
          // never repainted in the hat's colour or drawn over it (horns): the body's own ears, behind the hat, their
          // tips reaching past the hat's sides or crown so they peek out either side
          expect(ears, `${species} ${accessory}`).toHaveLength(0);
          expect(m.layers.back, `${species} ${accessory}`).toHaveLength(2);
          const dome = silhouette('puff', 4, 100, species).dome;
          const hat = accessoryParts(accessory, { s: silhouette('puff', 4), eL: 80, eR: 120, ey: 107, my: 125, color: '#000', clip: 'url(#c)', id: (x) => x })!.box;
          for (const g of m.layers.back) {
            const p = all([g]).find((nd) => nd.tag !== 'g')!;
            expect(p.attrs.fill, `${species} ${accessory}`).toBe('url(#hp0)');
            const pts: number[][] = p.tag === 'ellipse'
              ? Array.from({ length: 24 }, (_, i) => [Number(p.attrs.cx) + Number(p.attrs.rx) * Math.cos(i * Math.PI / 12), Number(p.attrs.cy) + Number(p.attrs.ry) * Math.sin(i * Math.PI / 12)])
              : [...String(p.attrs.d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((x) => [Number(x[1]), Number(x[2])]);
            // the tip reaches well past the hat crown (R + 3.5), so it peeks out
            expect(Math.max(...pts.map(([x, y]) => Math.hypot(x - dome.cx, y - dome.cy))), `${species} ${accessory}`).toBeGreaterThan(dome.r + 7);
            // under the wide beret the ears sit out past its sides
            if (accessory === 'beret') {
              const left = g.attrs['data-rig'] === 'ear-l', xs = pts.map(([x]) => x);
              expect(left ? Math.min(...xs) < hat.x0 + 4 : Math.max(...xs) > hat.x1 - 4, `${species} beret ${g.attrs['data-rig']}`).toBe(true);
            }
          }
        } else if (species === 'owl') {
          // the tufts sit low on the shoulders, below any hat's edge
          expect(m.layers.back, `${species} ${accessory}`).toHaveLength(2);
          const dome = silhouette('puff', 4, 100, 'owl').dome;
          for (const g of m.layers.back) {
            const ys = [...String(all([g]).find((nd) => nd.tag === 'path')!.attrs.d).matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((x) => Number(x[2]));
            // the root sits lower than any hat's lower edge (about 0.47 R over the dome centre)
            expect(Math.max(...ys)).toBeGreaterThan(dome.cy - 0.45 * dome.r);
          }
        } else expect(m.layers.back, `${species} ${accessory}`).toEqual([]);
      }
    }
  });

  it('never paints a filled accessory in near-black ink (glasses keep the reference ink line)', () => {
    for (const accessory of ['bowtie', 'headphones', 'cap', 'beret'] as const) {
      const m = characterModel({ hue: 'butter', family: 'puff', species: 'bear', accessory, accent: 'ink', features: { cheeks: true, lashes: false, brows: false } }, { uid: 'i', mode: 'still' });
      const fills = all([...m.layers['acc-rigid'], ...m.layers['acc-soft']]).map((nd) => nd.attrs.fill).filter((c): c is string => typeof c === 'string' && c.startsWith('#') && c !== '#000');
      for (const c of fills) expect(luminance(c), accessory).toBeGreaterThan(luminance(INK) + 0.04);
    }
    // every filled accessory in every accent sits in the matte pastel band (OKLCH L ≥ .72, C ≤ .12): no navy or slate
    for (const accent of ACCENT_COLORS) {
      const c = accentColor(accent, true), [L, C] = oklch(c);
      expect(L, accent).toBeGreaterThanOrEqual(FILL_MIN_L - 0.005);
      expect(C, accent).toBeLessThanOrEqual(0.125);
    }
    expect(accentColor('navy', true)).toBe('#9DB4D8');
    const g = characterModel({ hue: 'butter', family: 'puff', accessory: 'glasses', accent: 'ink', features: { cheeks: true, lashes: false, brows: false } }, { uid: 'g', mode: 'still' });
    expect(luminance(String(g.layers['acc-rigid'][0].attrs.stroke))).toBeLessThan(0.2);
  });

  it('keeps a clear gap between the eyes and the smile at 32 px (no "U" face)', () => {
    const m = characterModel({ hue: 'lagoon', family: 'puff', features: { cheeks: true, lashes: false, brows: false } }, { uid: 'u', mode: 'still', size: 32 });
    const eye = m.face.eyes[0].cy + 8.6 * m.face.eyeScale, smileTop = m.face.mouth.y - MOUTH.idle.lift - m.face.strokeW / 2;
    // 1.5 px at 32 px is ~9.4 view-box units
    expect(smileTop - eye).toBeGreaterThan(6.5);
  });

  it('gives drift on eared species the subtle STYLE §1 asymmetry: the dome about 0.02 bw left, the left saddle a little higher', () => {
    const cloud = silhouette('drift', 4), cat = silhouette('drift', 4, 100, 'cat'), puff = silhouette('puff', 4, 100, 'cat');
    expect(Math.abs(cat.lean)).toBeLessThan(Math.abs(cloud.lean) * 0.7);
    expect(cat.lean).toBeLessThanOrEqual(-0.015);
    expect(cat.dome.cx).toBeLessThan(puff.dome.cx - 2);
    // the saddle is the concave run between the lobe and the dome: its knots are points 6 and 9 (right), 15 and 18 (left)
    const P = pathPts(bodyD(cat)), yR = (P[6][1] + P[9][1]) / 2, yL = (P[15][1] + P[18][1]) / 2;
    expect(yR - yL).toBeGreaterThan(1.5);
    expect(yR - yL).toBeLessThan(0.05 * cat.W);
    // the base stays the same width as puff
    expect(cat.W).toBeCloseTo(puff.W, 5);
  });

  it('rolls the underside off softly: no body tone falls into a dark band or a muddy brown', () => {
    for (const hue of HUES) {
      const p = derivePalette(hue, 4);
      expect(luminance(p.deep), hue).toBeGreaterThan(0.18);
      expect(luminance(p.shadow), hue).toBeGreaterThan(0.3);
    }
  });
});
