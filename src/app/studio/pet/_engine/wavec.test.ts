import { describe, expect, it } from 'vitest';
import { FREE_ACCESSORIES, KEEPSAKES, WEARABLE_IDS, type GardenState as PlayGardenState } from '@/lib/pet/play';
import { characterModel, GROUND, PRESET_LOOKS, STAGE_PARTS } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { prepareBeats, timelineEnd } from './beats';
import { detailLayers, edgesAt, fitDetails, gardenAt, gardenX, NO_DETAILS } from './details';
import { MOTION_PRIORITY, wearingState } from './extras';
import { fitGarden, FROM_PLAY, gardenArt } from './garden';
import { harness, SCENE } from './harness.fixture';
import { fitWearing, NO_WEARING, outfitLayers, WEAR_PART, WEAR_SLOT, wearsWith } from './outfits';
import { poseToSvg } from './poseToSvg';
import { BREATH_GLOW, breatheCycle, roomReaction } from './reactions/rooms';
import { seeded, variantHistory } from './rng';
import { tuningFor } from './species';
import type { Beat, MotionCue, ReactionCtx, RoomReaction, Tier } from './types';

const cloud: CharacterLook = { ...PRESET_LOOKS[0], accessory: 'none' };
const bunny = PRESET_LOOKS[3];
const ctx = (seed = 3, species: ReactionCtx['species'] = 'bunny', tier: Tier = 'full'): ReactionCtx => {
  const rng = seeded(seed);
  return { rng, species, family: 'puff', stage: 4, mood: { level: 'content', lowest: 'joy', tone: 'content', asleep: false }, tier, variantHistory: variantHistory(rng) };
};
const ends = (b: Beat[]) => timelineEnd(prepareBeats(b, { rng: seeded(1), tuning: tuningFor('bunny', 'puff'), tier: 'full', exact: true }));
/** In budget: the last key pose lands within `ms`, and everything has settled within `ms` plus the closing float. */
const inBudget = (b: Beat[], ms: number) => Math.max(...b.map((x) => x.at)) <= ms && ends(b) <= ms + 700;
const model = (look: CharacterLook, stage: Stage = 4) => characterModel(look, { uid: 'pet', mode: 'live', stage, expr: 'idle', size: 200 });
const geomOf = (h: ReturnType<typeof harness>) => (h.engine as unknown as { geom: Parameters<typeof poseToSvg>[0] }).geom;
const cues = <T extends MotionCue['type']>(h: ReturnType<typeof harness>, type: T) => h.motion.filter((c): c is Extract<MotionCue, { type: T }> & { at: number } => c.type === type);

describe('outfits on the rig (§4.3)', () => {
  it('every wearable has the slot play.ts gives it', () => {
    for (const id of WEARABLE_IDS) expect(WEAR_SLOT[id], id).toBe(id in KEEPSAKES ? KEEPSAKES[id as keyof typeof KEEPSAKES].slot : FREE_ACCESSORIES[id as keyof typeof FREE_ACCESSORIES]);
    expect(Object.keys(WEAR_SLOT).sort()).toEqual([...WEARABLE_IDS].sort());
  });

  it('follow STAGE_PARTS: closet items come with the accessory slot; a wisp keeps what it was dressed in', () => {
    const all = { head: 'pomegranateCrown', neck: 'sparkScarf', hand: 'sabzehSprout' } as const;
    for (const st of [1, 2, 3, 4] as Stage[]) {
      const f = fitWearing(all, st, cloud);
      expect(f.head !== null, `stage ${st}`).toBe(STAGE_PARTS[st].includes(WEAR_PART));
    }
    expect(fitWearing(all, 4, cloud)).toEqual(all);
    // the look rules: no hat over bunny ears (kept, not drawn); a crown is fine; an item on the wrong slot is ignored
    expect(wearsWith(bunny, 'beret')).toBe(false);
    expect(fitWearing({ head: 'beret' }, 4, bunny).head).toBeNull();
    expect(fitWearing({ head: 'pomegranateCrown' }, 4, bunny).head).toBe('pomegranateCrown');
    expect(fitWearing({ head: 'bowtie' }, 4, cloud)).toEqual(NO_WEARING);
  });

  it('draws every wearable where it rides, with its data-wear key; the look’s own accessory is not drawn twice', () => {
    const m = model(cloud);
    for (const id of WEARABLE_IDS) {
      const slot = WEAR_SLOT[id], l = outfitLayers(m, { ...NO_WEARING, [slot]: id }, { look: cloud });
      const json = JSON.stringify(l);
      expect(json, id).toContain(`"data-wear":"${slot}:${id}"`);
      const where = ['face', 'head', 'body', 'hand'].filter((k) => JSON.stringify(l[k as 'face']).includes(`${slot}:${id}`));
      expect(where, id).toEqual([id === 'glasses' || id === 'specs' ? 'face' : slot === 'head' ? 'head' : slot === 'hand' ? 'hand' : 'body']);
    }
    // soft pieces hang from a pivot (they swing with the soft-part follower); rigid ones do not
    expect(JSON.stringify(outfitLayers(m, { ...NO_WEARING, head: 'bow' }, { look: cloud }).head)).toContain('data-pivot');
    expect(JSON.stringify(outfitLayers(m, { ...NO_WEARING, neck: 'sparkScarf' }, { look: cloud }).body)).toContain('data-pivot');
    expect(JSON.stringify(outfitLayers(m, { ...NO_WEARING, head: 'beret' }, { look: cloud }).head)).not.toContain('data-pivot');
    const own = outfitLayers(model(bunny), { ...NO_WEARING, head: bunny.accessory as 'bow' }, { look: bunny });
    expect(own.head).toHaveLength(0);
    // a swing rotates the soft group about its pivot
    expect(JSON.stringify(outfitLayers(m, { ...NO_WEARING, hand: 'sabzehSprout' }, { look: cloud, swing: 6 }).hand)).toMatch(/rotate\(6 /);
  });

  it('poseToSvg is byte-identical without an outfit, and draws one inside the right layers', () => {
    const h = harness({ look: 0 });
    h.run(300);
    const f = h.engine.debug.frame!, g = geomOf(h), plain = poseToSvg(g, f);
    expect(poseToSvg(g, f, { outfit: undefined, details: undefined })).toBe(plain);
    expect(poseToSvg(g, f, { outfit: { shown: NO_WEARING, look: cloud } })).toBe(plain);
    const svg = poseToSvg(g, f, { outfit: { shown: { head: 'pomegranateCrown', neck: 'bowtie', hand: 'sabzehSprout' }, look: cloud } });
    expect(svg.indexOf('data-wear="head:pomegranateCrown"')).toBeGreaterThan(svg.indexOf('data-rig="acc-rigid"'));
    expect(svg).toContain('data-wear="neck:bowtie"');
    expect(svg).toContain('data-wear="hand:sabzehSprout"');
  });

  it('setWearing says what is worn (whole, the newest fresh), keeps what the stage cannot show and puts it on at stage 4', () => {
    const h = harness({ stage: 2, look: 0 });
    h.engine.setWearing({ head: 'pomegranateCrown' });
    expect(cues(h, 'wearing').at(-1)!.wearing).toEqual(NO_WEARING);
    h.engine.setStage(4);
    h.run(100);
    const c = cues(h, 'wearing').at(-1)!;
    expect(c.wearing.head).toBe('pomegranateCrown');
    expect(c.fresh).toBe('head:pomegranateCrown');
    // whole: a slot left out wears nothing
    h.engine.setWearing({ neck: 'starPin' });
    expect(cues(h, 'wearing').at(-1)!.wearing).toEqual({ head: null, neck: 'starPin', hand: null });
    expect(wearingState(h.engine as never)).toEqual({ head: null, neck: 'starPin', hand: null });
    // nothing here keeps the loop awake (the page draws the outfit)
    h.run(3000);
    expect(h.engine.debug.awake).toBe(false);
  });

  it('try on: a glance at the item where it is worn, a turn to the mirror, a blush; reduced keeps only the face', () => {
    const peak = (slot: 'head' | 'neck' | 'hand', tier: Tier = 'full') => {
      const h = harness({ tier, exact: true });
      h.run(300);
      h.engine.setWearing({ [slot]: slot === 'head' ? 'pomegranateCrown' : slot === 'neck' ? 'sparkScarf' : 'sabzehSprout' });
      h.engine.tryOn(slot === 'head' ? 'pomegranateCrown' : slot === 'neck' ? 'sparkScarf' : 'sabzehSprout');
      let early = 0, blush = 0, face = 0, rot = 0;
      const t0 = h.t;
      h.run(1500, () => { const p = h.engine.debug.pose, f = h.engine.debug.frame!; if (h.t - t0 < 250) early = p.gazeY; blush = Math.max(blush, p.blush); face = Math.max(face, f.face.x); rot = Math.max(rot, Math.abs(f.body.rot)); });
      return { early, blush, face, rot, kind: h.engine.debug.playing.length };
    };
    expect(peak('head').early).toBeLessThan(-0.4);
    expect(peak('neck').early).toBeGreaterThan(0.4);
    expect(peak('hand').early).toBeGreaterThan(0.4);
    const full = peak('head');
    expect(full.blush).toBeGreaterThan(0.35);
    expect(full.face).toBeGreaterThan(2);
    const red = peak('head', 'reduced');
    expect(red.blush).toBeGreaterThan(0.35);
    expect(red.face + red.rot).toBeLessThan(1e-6);
    expect(inBudget(roomReaction(ctx(), 'tryOn', {}, { slot: 'neck' }), 1300)).toBe(true);
  });
});

describe('the garden on the floor (§4.5)', () => {
  it('maps play.ts’s states forward (never back), and draws each kind and state', () => {
    const order: PlayGardenState[] = ['seeded', 'sprouting', 'ready', 'watered', 'blooming', 'bloomed'];
    const rank = { planted: 0, sprouted: 1, bloomed: 2 };
    let last = 0;
    for (const s of order) { const g = fitGarden({ seed: 'flower', state: s })!; expect(rank[g.state]).toBeGreaterThanOrEqual(last); last = rank[g.state]; }
    expect(fitGarden({ seed: 'flower', state: 'empty' })).toBeNull();
    expect(FROM_PLAY.watered).toEqual({ state: 'sprouted', wet: true });
    expect(fitGarden({ kind: 'sabzeh', state: 'bloomed' })).toEqual({ kind: 'sabzeh', state: 'bloomed' });
    expect(fitGarden({ kind: 'rose' as never, state: 'bloomed' })).toBeNull();
    for (const kind of ['flower', 'sabzeh'] as const) {
      // seed → sprout → bloom read apart: each stage draws different art, and each taller than the last
      const arts = (['planted', 'sprouted', 'bloomed'] as const).map((state) => JSON.stringify(gardenArt({ kind, state })));
      expect(new Set(arts).size).toBe(3);
      const top = (a: string) => Math.min(...[...a.matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => Number(x[0])).filter((n) => n < 0));
      expect(top(arts[1])).toBeLessThan(top(arts[0]));
      expect(top(arts[2])).toBeLessThan(top(arts[1]));
    }
    for (const kind of ['flower', 'sabzeh'] as const) for (const state of ['planted', 'sprouted', 'bloomed'] as const) {
      const art = JSON.stringify(gardenArt({ kind, state }));
      expect(art.includes('"data-anim":"sway"'), `${kind} ${state}`).toBe(state !== 'planted');
      expect(art.includes('"data-anim":"shimmer"'), `${kind} ${state}`).toBe(state === 'bloomed');
    }
  });

  it('stands right of the pet’s widest point at every stage, the seasonal keepsake further out; poseToSvg unchanged without it', () => {
    for (const st of [1, 4] as Stage[]) {
      const m = model(bunny, st), cx = m.pivots.body[0];
      const widest = Math.max(...[12, 22, 32, 42, 52].map((d) => edgesAt(m, GROUND - d / m.growth)[1]));
      expect(gardenX(m)).toBeGreaterThan(cx + (widest - cx) * m.growth);
      const l = detailLayers(m, fitDetails({ garden: { kind: 'flower', state: 'bloomed' }, seasonal: 'yalda', keepsakes: ['play'] }, st));
      const xs = [...l.floor, ...l.back].map((g) => [g.attrs['data-detail'], Number(/translate\(([-\d.]+)/.exec(JSON.stringify(g))![1])] as const);
      const pot = xs.find(([k]) => k === 'garden:flower:bloomed')![1], keep = xs.find(([k]) => k === 'keepsake:play')![1];
      expect(keep).toBeLessThan(cx);
      expect(pot).toBeGreaterThan(cx);
      // the pot stands on the right: the room props keep to the left (nothing hides behind the pot)
      expect(xs.filter(([k]) => k !== 'garden:flower:bloomed').every(([, x]) => x < cx)).toBe(true);
      const season = detailLayers(m, fitDetails({ seasonal: 'yalda', keepsakes: ['play'] }, st)).back.find((g) => g.attrs['data-detail'] === 'seasonal')!;
      expect(Number(/translate\(([-\d.]+)/.exec(JSON.stringify(season))![1])).toBeGreaterThan(cx);
      // the pot stands in front (the floor layer, drawn over the body); the keepsakes in the room behind it
      expect(l.floor.map((g) => g.attrs['data-detail'])).toEqual(['garden:flower:bloomed']);
      // the Garden room's hero: bigger and a step in front of the pet
      const hero = gardenAt(m, true), side = gardenAt(m);
      expect(hero.k).toBeGreaterThan(side.k * 1.3);
      expect(hero.y).toBeGreaterThan(GROUND);
      expect(JSON.stringify(detailLayers(m, fitDetails({ garden: { kind: 'flower', state: 'bloomed' } }, st), { hero: true }).floor)).toContain(`scale(${hero.k})`);
    }
    const h = harness();
    h.run(300);
    const f = h.engine.debug.frame!, g = geomOf(h);
    expect(poseToSvg(g, f, { details: { shown: NO_DETAILS } })).toBe(poseToSvg(g, f, { details: { shown: fitDetails({ garden: null }, 4) } }));
    expect(poseToSvg(g, f, { details: { shown: fitDetails({ garden: { kind: 'sabzeh', state: 'sprouted' } }, 4) } })).toContain('data-detail="garden:sabzeh:sprouted"');
  });

  it('a late listener (the lazy overlay mounting after setGarden) hears the garden at once: the pot is on stage before any line (P-07)', () => {
    const h = harness();
    h.engine.setGarden({ seed: 'flower', state: 'bloomed' });
    h.engine.setWearing({ head: 'pomegranateCrown' });
    const got: MotionCue[] = [];
    const off = h.engine.onMotion((c) => got.push(c));
    expect(got.find((c) => c.type === 'details')).toMatchObject({ details: { garden: { kind: 'flower', state: 'bloomed' } } });
    expect(got.some((c) => c.type === 'wearing')).toBe(true);
    off();
  });

  it('setGarden rides the details cue to the floor layer (every stage), and the loop rests after', () => {
    const h = harness({ stage: 1 });
    h.engine.setGarden({ seed: 'sabzeh', state: 'watered' });
    expect(cues(h, 'details').at(-1)!.details.garden).toEqual({ kind: 'sabzeh', state: 'sprouted', wet: true });
    h.engine.setGarden(null);
    expect(cues(h, 'details').at(-1)!.details.garden).toBeUndefined();
    h.run(3000);
    expect(h.engine.debug.awake).toBe(false);
  });

  const rainXs = (garden: boolean, seed = 5) => {
    const h = harness({ seed, exact: true });
    h.engine.setRoom('garden', { instant: true });
    if (garden) h.engine.setGarden({ kind: 'flower', state: 'sprouted' });
    h.run(1200);
    h.engine.roomReact('rain');
    const xs: number[] = [];
    let maxX = 0;
    h.run(2400, () => { for (const p of h.engine.debug.particles()) if (p.kind === 'drop') xs.push(p.x); maxX = Math.max(maxX, h.engine.debug.frame!.body.x); });
    return { xs, maxX, h };
  };
  it('rain aims at the pot: the body drifts over and the drops fall on its soil (deterministic)', () => {
    const plain = rainXs(false), aimed = rainXs(true);
    // in the Garden room the pot is the hero (gardenAt): the rain aims where it is drawn
    const potX = SCENE.character.x + gardenAt(model(bunny), true).x * (SCENE.character.size / 200);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(aimed.xs.length).toBeGreaterThan(4);
    expect(Math.abs(mean(aimed.xs) - potX)).toBeLessThan(12);
    expect(Math.max(...aimed.xs) - Math.min(...aimed.xs)).toBeLessThan(26);
    expect(Math.abs(mean(plain.xs) - (SCENE.character.x + 100))).toBeLessThan(10);
    expect(aimed.maxX).toBeGreaterThan(5);
    expect(rainXs(true).xs).toEqual(aimed.xs);
  });

  it('the frame guard thins aimed rain to the lite cap; reduced motion rains no particles and keeps the body still', () => {
    const h = harness();
    h.engine.setGarden({ kind: 'flower', state: 'sprouted' });
    h.run(300);
    for (let i = 0; i < 200; i++) h.engine.debug.guardFrame(40, NaN);
    expect(h.engine.motion.tier).toBe('lite');
    h.engine.roomReact('rain');
    let most = 0;
    h.run(2400, () => { most = Math.max(most, h.engine.debug.particles().length); });
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(6);
    const r = harness({ tier: 'reduced' });
    r.engine.setGarden({ kind: 'flower', state: 'sprouted' });
    r.run(300);
    r.engine.roomReact('rain');
    let parts = 0, moved = 0;
    r.run(2400, () => { parts += r.engine.debug.particles().length; const f = r.engine.debug.frame!; moved = Math.max(moved, Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot)); });
    expect(parts).toBe(0);
    expect(moved).toBeLessThan(1e-6);
  });

  it('a bloom: eyes down to the pot, a squeezed-shut delighted blink, one sparkle over the flower (≤ 1.4 s)', () => {
    const h = harness({ exact: true });
    h.engine.setGarden({ kind: 'flower', state: 'bloomed' });
    h.run(300);
    h.engine.roomReact('bloom');
    let gaze = 0, lid = 1, sparks = 0, sx = 0;
    const potX = SCENE.character.x + gardenX(model(bunny));
    h.run(1600, () => { const p = h.engine.debug.pose; gaze = Math.max(gaze, p.gazeY); lid = Math.min(lid, p.lidL); for (const q of h.engine.debug.particles()) if (q.kind === 'sparkle') { if (!sparks) sx = q.x; sparks++; } });
    expect(gaze).toBeGreaterThan(0.6);
    expect(lid).toBeLessThan(0.3);
    expect(sparks).toBeGreaterThan(0);
    expect(Math.abs(sx - potX)).toBeLessThan(16);
    expect(inBudget(roomReaction(ctx(), 'bloom', {}, { aim: 80 }), 1400)).toBe(true);
    expect(MOTION_PRIORITY.bloom).toBe('touch');
  });

  it('breathe with me: a faint glow swells on the breath in and fades on the breath out; reduced: opacity only', () => {
    const glowAt = (tier: Tier) => {
      const h = harness({ tier });
      h.engine.setRoom('garden', { instant: true });
      h.run(600);
      h.engine.setGuidedBreath(6);
      const t0 = h.t, top: number[] = [], low: number[] = [];
      h.run(6000, () => { const u = (h.t - t0) / 6000, g = h.engine.debug.pose.glow; if (u > 0.33 && u < 0.42) top.push(g); if (u > 0.85 && u < 0.92) low.push(g); });
      return { top: Math.max(...top), low: Math.min(...low) };
    };
    for (const tier of ['full', 'reduced'] as Tier[]) {
      const g = glowAt(tier);
      expect(g.top, tier).toBeGreaterThan(0.12);
      expect(g.top, tier).toBeLessThanOrEqual(BREATH_GLOW.high + 0.02);
      expect(g.low, tier).toBeLessThan(g.top - 0.08);
    }
    const r = breatheCycle(6000, 0.4, true);
    expect(r.some((b) => b.target.glow !== undefined)).toBe(true);
    expect(r.some((b) => b.target.sy !== undefined || b.target.y !== undefined)).toBe(false);
  });
});

describe('Guess my word (§4.2): reactions to a guess, never sad', () => {
  const kinds: Array<[RoomReaction, number]> = [['guessThink', 1200], ['guessHeard', 700], ['guessRight', 900], ['guessWrong', 1000], ['guessReveal', 1100]];
  it('stay in their durations, play as talk, and Zen is one preset softer with nothing flashing', () => {
    for (const [k, ms] of kinds) {
      expect(inBudget(roomReaction(ctx(), k), ms), k).toBe(true);
      expect(MOTION_PRIORITY[k], k).toBe('talk');
      const z = roomReaction(ctx(), k, { zen: true });
      expect(z.some((b) => b.particles || b.haptic), k).toBe(false);
      expect(z.map((b) => b.spring), k).not.toEqual(roomReaction(ctx(), k).map((b) => b.spring));
    }
  });

  it('right: a hop and a glint; wrong: a head-shake and a smile, never droopy; reveal: speech shapes', () => {
    const right = roomReaction(ctx(), 'guessRight');
    expect(right.some((b) => b.hop)).toBe(true);
    expect(right.some((b) => b.particles && JSON.stringify(b.particles).includes('sparkle'))).toBe(true);
    for (const seed of [1, 2, 3, 4]) {
      const wrong = roomReaction(ctx(seed), 'guessWrong');
      expect(wrong.some((b) => b.osc && JSON.stringify(b.osc).includes('headTilt'))).toBe(true);
      for (const b of wrong) {
        expect(b.target.headY ?? 0).toBeLessThanOrEqual(0);
        expect(b.target.earDroop ?? 0).toBe(0);
        expect((b.target.browInner ?? 0)).toBeLessThanOrEqual(0);
        expect(Math.min(b.target.lidL ?? 1, b.target.lidR ?? 1) < 0.5 && (b.target.lidL ?? 1) < 0.5 && (b.target.lidR ?? 1) < 0.5).toBe(false);
        expect(['sad', 'droopy'].includes(String(b.expr))).toBe(false);
      }
    }
    const mouths = roomReaction(ctx(), 'guessReveal').map((b) => b.mouth).filter(Boolean);
    expect(mouths).toEqual(expect.arrayContaining(['A', 'D', 'B', 'E']));
  });

  it('guessReact plays them on the engine, deterministically; a droopy pet’s wrong guess still never droops', () => {
    const run = (k: 'think' | 'heard' | 'right' | 'wrong' | 'reveal', seed = 9) => {
      const h = harness({ seed, mood: { level: 'droopy', lowest: 'energy', tone: 'tired', asleep: false } });
      h.run(300);
      const base = h.engine.debug.pose.headY;
      h.engine.guessReact(k);
      const kind = h.engine.debug.playing.map((p) => p.kind);
      const trace: number[] = [];
      let lowest = 0;
      h.run(1300, () => { const p = h.engine.debug.pose; trace.push(Math.round(p.headTilt * 1000)); lowest = Math.max(lowest, p.headY - base); });
      return { kind, trace, lowest };
    };
    expect(run('right').kind).toContain('guessRight');
    expect(run('reveal').kind).toContain('guessReveal');
    expect(run('think').kind).toContain('guessThink');
    expect(run('wrong').trace).toEqual(run('wrong').trace);
    expect(run('wrong').lowest).toBeLessThan(0.5);
  });
});
