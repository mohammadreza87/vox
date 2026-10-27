import { describe, expect, it } from 'vitest';
import { characterModel, GROUND, PRESET_LOOKS, STAGE_PARTS } from '@/lib/studio/character';
import type { Stage } from '@/lib/studio/types';
import { DETAIL_FADE_MS, DETAIL_PART, detailFade, detailLayers, edgesAt, fitDetails, NO_DETAILS, type Details } from './details';
import { detailState } from './extras';
import { harness } from './harness.fixture';
import { poseToSvg } from './poseToSvg';
import { growthLit } from './reactions/rooms';
import { seeded, variantHistory } from './rng';

const ALL: Details = { glint: true, pin: true, charm: true, keepsakes: ['play', 'garden', 'book', 'bedroom'], seasonal: 'yalda' };
const ctx = () => { const rng = seeded(2); return { rng, species: 'bunny' as const, family: 'puff' as const, stage: 4 as const, mood: { level: 'content', lowest: 'joy', tone: 'content', asleep: false } as const, tier: 'full' as const, variantHistory: variantHistory(rng) }; };

describe('growth details on the rig (§4.11)', () => {
  it('follow STAGE_PARTS: a wisp never wears a pin; floor keepsakes show at every stage (the newest three)', () => {
    for (const st of [1, 2, 3, 4] as Stage[]) {
      const f = fitDetails(ALL, st);
      expect(f.glint).toBe(STAGE_PARTS[st].includes(DETAIL_PART.glint));
      expect(f.pin).toBe(STAGE_PARTS[st].includes('accessory'));
      expect(f.charm).toBe(STAGE_PARTS[st].includes('accessory'));
      expect(f.keepsakes).toEqual(['garden', 'book', 'bedroom']);
      expect(f.seasonal).toBe('yalda');
    }
    expect(fitDetails(ALL, 1).pin).toBe(false);
    expect(fitDetails(ALL, 4)).toMatchObject({ glint: true, pin: true, charm: true });
    expect(fitDetails({}, 4)).toEqual(NO_DETAILS);
  });

  it('poseToSvg is unchanged without details, and draws each detail where it rides', () => {
    const h = harness();
    h.run(300);
    const geom = (h.engine as unknown as { geom: Parameters<typeof poseToSvg>[0] }).geom, f = h.engine.debug.frame!;
    const plain = poseToSvg(geom, f);
    expect(poseToSvg(geom, f, {})).toBe(plain);
    expect(poseToSvg(geom, f, { details: { shown: NO_DETAILS } })).toBe(plain);
    const svg = poseToSvg(geom, f, { details: { shown: fitDetails(ALL, 4) } });
    for (const k of ['glint', 'pin', 'charm', 'keepsake:bedroom', 'seasonal']) expect(svg).toContain(`data-detail="${k}"`);
    // the glint rides inside the lids (a blink closes it); the room keepsakes stand behind the body, outside its transform (they never hop)
    const lids = svg.indexOf('data-part="lids"'), glint = svg.indexOf('data-detail="glint"'), body = svg.indexOf('<g transform="translate(');
    expect(glint).toBeGreaterThan(lids);
    expect(svg.indexOf('data-details="back"')).toBeLessThan(body);
    const wisp = characterModel(PRESET_LOOKS[3], { uid: 'pet', mode: 'live', stage: 1, expr: 'idle', size: 200 });
    const l1 = detailLayers(wisp, fitDetails(ALL, 1));
    expect(l1.lids).toHaveLength(0);
    expect(l1.body).toHaveLength(0);
    expect(l1.back).toHaveLength(2);
    expect(l1.floor).toHaveLength(0);
  });

  it('places worn details on the body and floor ones clear of it, for every species', () => {
    for (const look of PRESET_LOOKS.slice(0, 12)) {
      const m = characterModel(look, { uid: 'pet', mode: 'live', stage: 4, expr: 'idle', size: 200 });
      const l = detailLayers(m, fitDetails(ALL, 4));
      const pin = l.body.find((g) => g.attrs['data-detail'] === 'pin')!, charm = l.body.find((g) => g.attrs['data-detail'] === 'charm')!;
      const px = Number(pin.children![1].attrs.cx), py = Number(pin.children![1].attrs.cy);
      expect(px).toBeGreaterThan(30); expect(px).toBeLessThan(100); expect(py).toBeGreaterThan(m.face.cheeks.y); expect(py).toBeLessThan(166);
      const [cx] = String(charm.attrs['data-pivot']).split(' ').map(Number);
      expect(cx).toBeGreaterThan(100); expect(cx).toBeLessThan(178);
      for (const g of l.back) {
        const x = Number(/translate\(([-\d.]+)/.exec(JSON.stringify(g))![1]);
        expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(200);
      }
    }
  });

  it('room props stand on the backdrop\'s horizon, spaced clear of the pet, one per room (two at Home); the Closet bow sits on the head (P-24)', () => {
    for (const look of PRESET_LOOKS.slice(0, 12)) {
      const m = characterModel(look, { uid: 'pet', mode: 'live', stage: 3, expr: 'idle', size: 200 });
      const l = detailLayers(m, fitDetails({ keepsakes: ['play', 'closet', 'book', 'bedroom'], seasonal: 'yalda' }, 3), { horizon: 20 });
      // on the horizon (behind the pet), never in the front floor layer; at most two at Home
      expect(l.floor).toHaveLength(0);
      expect(l.back.length).toBeLessThanOrEqual(2);
      for (const g of l.back) {
        const [x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(JSON.stringify(g))!.slice(1).map(Number);
        expect(y).toBe(GROUND - 20);
        // clear of the body's side at its height (it stands in the room, it is not lying against the pet)
        const [lo, hi] = edgesAt(m, GROUND + (y - 6 - GROUND) / m.growth).map((v) => 100 + (v - 100) * m.growth);
        expect(x < lo - 6 || x > hi + 6, `${look.hue} ${x} ${lo} ${hi}`).toBe(true);
      }
      const free = !m.layers['acc-rigid'].length && !m.layers['acc-soft'].length;
      expect(l.head.map((g) => g.attrs['data-detail'])).toEqual(free ? ['keepsake:closet'] : []);
      if (free) {
        const y = Number(/translate\([-\d.]+ ([-\d.]+)\)/.exec(JSON.stringify(l.head[0]))![1]);
        expect(y).toBeLessThan(m.face.eyes[0].cy - 10);
      }
      // an away room shows only its own keepsake (the Bedroom never collects the others at the pet's feet)
      const keys = (room: string) => detailLayers(m, fitDetails({ keepsakes: ['play', 'garden', 'bedroom', 'book'], seasonal: 'yalda' }, 3), { room }).back.map((g) => g.attrs['data-detail']);
      expect(keys('bedroom')).toEqual(['keepsake:bedroom']);
      expect(keys('play')).toEqual([]);
      expect(keys('book')).toEqual(['keepsake:book']);
      expect(keys('home')).toEqual(['keepsake:book', 'seasonal']);
    }
    // a closet head item takes the head: the bow goes back into the room
    const m = characterModel(PRESET_LOOKS[0], { uid: 'pet', mode: 'live', stage: 3, expr: 'idle', size: 200 });
    expect(detailLayers(m, fitDetails({ keepsakes: ['closet'] }, 3), { headWorn: true }).head).toHaveLength(0);
  });

  it('fades in with one overshoot (opacity only on reduced motion)', () => {
    const s = Array.from({ length: 21 }, (_, i) => detailFade(i / 20));
    expect(Math.max(...s.map((x) => x.s))).toBeGreaterThan(1.08);
    expect(Math.max(...s.map((x) => x.s))).toBeLessThan(1.2);
    expect(s[20]).toEqual({ o: 1, s: 1 });
    expect(s[0].o).toBe(0);
    expect(detailFade(0.5, true)).toEqual({ o: 0.5, s: 1 });
  });

  it('setDetails says what this stage shows; a stage-up shows the rest', () => {
    const h = harness({ stage: 3 });
    h.engine.setDetails({ pin: true, keepsakes: ['play'] });
    const first = h.motion.filter((c) => c.type === 'details').at(-1);
    expect(first).toMatchObject({ details: { pin: false, keepsakes: ['play'] } });
    h.engine.setStage(4);
    h.run(100);
    expect(h.motion.filter((c) => c.type === 'details').at(-1)).toMatchObject({ details: { pin: true } });
  });

  it('lightMoment({ detail }) names it at the litPeak (~600 ms) and starts its fade there; a stage that cannot wear it keeps it', () => {
    const h = harness();
    h.run(300);
    const t0 = h.t;
    h.engine.lightMoment({ detail: 'pin' });
    h.run(500);
    expect(detailState(h.engine as never, DETAIL_FADE_MS).shown.pin).toBe(false);
    h.run(1300);
    const peak = h.motion.find((c) => c.type === 'litPeak')!;
    expect(peak).toMatchObject({ detail: 'pin', shown: true });
    expect(peak.at - t0).toBeGreaterThanOrEqual(590);
    expect(peak.at - t0).toBeLessThanOrEqual(640);
    const ds = detailState(h.engine as never, DETAIL_FADE_MS);
    expect(ds.shown.pin).toBe(true);
    expect(ds.fade).toMatchObject({ key: 'pin', u: 1 });
    // a keepsake by id
    h.engine.lightMoment({ detail: 'keepsake', id: 'garden' });
    h.run(1500);
    expect(h.motion.filter((c) => c.type === 'litPeak').at(-1)).toMatchObject({ detail: 'keepsake', id: 'garden', shown: true });
    // a puff cannot wear a pin yet: kept, not shown
    const p = harness({ stage: 2 });
    p.engine.lightMoment({ detail: 'pin' });
    p.run(1500);
    expect(p.motion.find((c) => c.type === 'litPeak')).toMatchObject({ detail: 'pin', shown: false });
    p.engine.setStage(4);
    p.run(50);
    expect(detailState(p.engine as never, DETAIL_FADE_MS).shown.pin).toBe(true);
  });

  it('asleep, the detail appears with no motion; awake, the pet glances at it with one twinkle (never confetti)', () => {
    const h = harness({ mood: { level: 'content', lowest: 'joy', tone: 'content', asleep: true } });
    h.run(200);
    const t0 = h.t;
    h.engine.lightMoment({ detail: 'charm' });
    h.run(50);
    expect(h.motion.find((c) => c.type === 'litPeak')!.at).toBe(t0);
    expect(h.engine.debug.playing.some((p) => p.kind === 'growthLit')).toBe(false);
    const beats = growthLit(ctx(), 'pin');
    expect(beats.filter((b) => b.particles)).toHaveLength(1);
    expect(beats.some((b) => (b.target.gazeY ?? 0) > 0.5)).toBe(true);
    expect(growthLit(ctx()).some((b) => b.particles)).toBe(false);
    const r = harness({ tier: 'reduced' });
    r.engine.lightMoment({ detail: 'glint' });
    r.run(1500, () => { const f = r.engine.debug.frame!; expect(Math.abs(f.body.y) + Math.abs(f.body.rot) + Math.abs(f.face.y)).toBeLessThan(1e-6); });
    expect(r.motion.find((c) => c.type === 'litPeak')).toMatchObject({ detail: 'glint', shown: true });
  });
});
