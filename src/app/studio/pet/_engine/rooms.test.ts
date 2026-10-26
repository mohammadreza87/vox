import { describe, expect, it } from 'vitest';
import type { Stage } from '@/lib/studio/types';
import { prepareBeats, timelineEnd } from './beats';
import { FRAME_GUARD, ROOMS } from './extras';
import { harness, type Harness } from './harness.fixture';
import { breatheCycle, roomArrive, roomIdle, roomLeave, roomReaction, RT, zen } from './reactions/rooms';
import { seeded, variantHistory } from './rng';
import { tuningFor } from './species';
import { ROOM_ORDER, type Beat, type ReactionCtx, type Room, type Species, type Tier } from './types';

const CONTENT = { level: 'content', lowest: 'joy', tone: 'content', asleep: false } as const;
function ctxFor(species: Species, seed: number, stage: Stage = 4, tier: Tier = 'full'): ReactionCtx {
  const rng = seeded(seed);
  return { rng, species, family: 'puff', stage, mood: CONTENT, tier, variantHistory: variantHistory(rng) };
}
const ends = (beats: Beat[]) => timelineEnd(prepareBeats(beats, { rng: seeded(1), tuning: tuningFor('cat', 'puff'), tier: 'full', exact: true }));

/** The held pose of a room once everything has settled (an instant move, no idle beats). */
function still(room: Room, tier: Tier = 'full') {
  const h = harness({ tier });
  h.engine.setRoom(room, { instant: true });
  h.run(3000);
  const f = h.engine.debug.frame!, p = h.engine.debug.pose;
  return { h, f, p, mouth: h.inner.currentMouth() };
}

describe('room personality that reads in a still (§10.4)', () => {
  it('each room holds its own pose, face and mouth', () => {
    const play = still('play'), garden = still('garden'), closet = still('closet'), bedroom = still('bedroom'), book = still('book'), home = still('home');
    // Play: crouched, bright sparkly eyes, ears up, a grin
    expect(play.f.body.sy).toBeLessThan(0.97);
    expect(play.p.sparkle).toBeGreaterThan(0.3);
    expect(play.p.pupil).toBeGreaterThan(1.05);
    expect(play.mouth).toBe('grin');
    // Garden: hovering high, chin up to the sky, an "o"
    expect(garden.f.body.y).toBeLessThan(-10);
    expect(garden.p.headY).toBeLessThan(-3);
    expect(garden.p.gazeY).toBeLessThan(-0.4);
    expect(garden.mouth).toBe('o');
    // Closet: the three-quarter turn to the mirror (the face slides over, the body leans and narrows)
    expect(closet.f.face.x).toBeGreaterThan(4);
    expect(closet.f.body.rot).toBeGreaterThan(3);
    expect(closet.f.body.sx).toBeLessThan(0.97);
    // Bedroom: sunk, heavy lids, ears drooping, the lean drifted to one side
    expect(Math.abs(bedroom.f.body.rot)).toBeGreaterThan(4);
    expect(bedroom.p.lidL).toBeLessThan(0.6);
    expect(bedroom.p.earDroop).toBeGreaterThan(10);
    // Life Book: head down over the page, eyes on it
    expect(book.f.face.y).toBeGreaterThan(3);
    expect(book.p.gazeY).toBeGreaterThan(0.4);
    expect(book.p.lidL).toBeLessThan(0.9);
    // Home is the mood's own idle
    expect(Math.abs(home.f.body.rot) + Math.abs(home.f.face.x) + Math.abs(home.f.face.y)).toBeLessThan(1.5);
    // every pair of rooms differs clearly on at least one feature
    const feat = (s: ReturnType<typeof still>) => [s.f.body.y / 4, s.f.body.rot / 3, s.f.face.x / 3, s.f.face.y / 3, (1 - s.p.lidL) * 4, (1 - s.f.body.sy) * 40, s.p.gazeY * 3, s.p.sparkle * 3];
    const all: Array<[string, number[]]> = [['home', feat(home)], ['play', feat(play)], ['garden', feat(garden)], ['closet', feat(closet)], ['bedroom', feat(bedroom)], ['book', feat(book)]];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const d = Math.max(...all[i][1].map((v, k) => Math.abs(v - all[j][1][k])));
      expect(d, `${all[i][0]} vs ${all[j][0]}`).toBeGreaterThan(0.9);
    }
  });

  it('reduced motion keeps only the face of a room: no travel, turn or swing', () => {
    for (const room of ROOM_ORDER) {
      const { f, p } = still(room, 'reduced');
      expect(Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot) + Math.abs(f.face.x) + Math.abs(f.face.y), room).toBeLessThan(1e-6);
      expect(p.earL + p.earR + p.earDroop, room).toBe(0);
    }
    expect(still('book', 'reduced').p.gazeY).toBeGreaterThan(0.4);
    expect(still('bedroom', 'reduced').p.lidL).toBeLessThan(0.6);
  });

  it('a transition reads: a crouched counter-lean, a big lean on an arc, the swap at the top, settled by ~330 ms, then the room’s hello', () => {
    const h = harness();
    h.run(600);
    h.engine.setRoom('garden');
    const t0 = h.t;
    const tr: Array<[number, number, number, number]> = [];
    h.run(900, () => { const f = h.engine.debug.frame!; tr.push([h.t - t0, f.body.rot, f.body.y, f.body.sy]); });
    const early = tr.filter(([t]) => t <= 75), mid = tr.filter(([t]) => t > 90 && t < 230);
    expect(Math.min(...early.map(([, r]) => r))).toBeLessThan(-2);
    expect(Math.min(...early.map(([, , , sy]) => sy))).toBeLessThan(0.975);
    expect(Math.max(...mid.map(([, r]) => r))).toBeGreaterThan(5);
    expect(Math.min(...tr.filter(([t]) => t < 260).map(([, , y]) => y))).toBeLessThan(-3);
    const swap = h.motion.find((c) => c.type === 'roomSwap')!;
    expect(swap.at - t0).toBeGreaterThanOrEqual(140);
    expect(swap.at - t0).toBeLessThanOrEqual(170);
    // the lean is back within one overshoot by ~330 ms (the transition budget is 300 ms)
    expect(Math.max(...tr.filter(([t]) => t > 330 && t < 400).map(([, r]) => Math.abs(r)))).toBeLessThan(3);
    expect(timelineEnd(prepareBeats(roomLeave(ctxFor('cat', 1), 1), { rng: seeded(1), tuning: tuningFor('cat', 'puff'), tier: 'full', exact: true }))).toBeLessThan(600);
    expect(RT.totalMs).toBe(300);
  });

  it('the room’s hello plays as the transition settles (never on a cut, reduced motion or asleep)', () => {
    const h = harness();
    h.run(300);
    h.engine.setRoom('play');
    let arrived = -1;
    const t0 = h.t;
    h.run(800, () => { if (arrived < 0 && h.engine.debug.playing.some((p) => p.kind === 'roomArrive')) arrived = h.t - t0; });
    expect(arrived).toBeGreaterThanOrEqual(290);
    expect(arrived).toBeLessThanOrEqual(340);
    for (const o of [{ tier: 'reduced' as Tier, instant: false }, { tier: 'full' as Tier, instant: true }]) {
      const r = harness({ tier: o.tier });
      r.engine.setRoom('play', { instant: o.instant });
      let any = false;
      r.run(800, () => { any = any || r.engine.debug.playing.some((p) => p.kind === 'roomArrive'); });
      expect(any).toBe(false);
    }
    for (const room of ROOM_ORDER) expect(ends(roomArrive(ctxFor('bunny', 3), room)), room).toBeLessThan(2000);
  });

  it('idle beats: three variants per room, deterministic, content-free and short', () => {
    for (const room of ROOM_ORDER) {
      const ctx = ctxFor('bunny', 4), seen = new Set<string>();
      for (let i = 0; i < 9; i++) {
        const beats = roomIdle(ctx, room);
        seen.add(JSON.stringify(beats.map((b) => b.target)));
        expect(beats.some((b) => b.say || b.thought), room).toBe(false);
        expect(ends(beats), room).toBeLessThan(2600);
      }
      expect(seen.size, room).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(roomIdle(ctxFor('cat', 7), room))).toBe(JSON.stringify(roomIdle(ctxFor('cat', 7), room)));
    }
    // a page-steered target: Play's beats leave the eyes to it
    const ctx = ctxFor('cat', 2);
    for (let i = 0; i < 6; i++) expect(roomIdle(ctx, 'play', { target: true }).some((b) => b.look)).toBe(false);
  });

  it('the bedroom’s lean drifts over to the other side with each idle beat', async () => {
    const h = harness();
    h.engine.setRoom('bedroom', { instant: true });
    h.run(2500);
    const a = h.engine.debug.frame!.body.rot;
    const x = await import('./extras');
    x.idleBeat(h.engine as never, h.t);
    h.run(3500);
    const b = h.engine.debug.frame!.body.rot;
    expect(Math.sign(a)).not.toBe(Math.sign(b));
    expect(Math.abs(b)).toBeGreaterThan(4);
  });

  it('at Home the content mood’s own ambient beat is the content float', () => {
    const h = harness({ ambient: true, seed: 3 });
    const kinds = new Set<string>();
    h.run(45_000, () => { for (const p of h.engine.debug.playing) kinds.add(p.kind); });
    expect(kinds.has('roomIdle')).toBe(true);
  });
});

describe('Starfall reactions (§4.2, §10.6)', () => {
  const track = (h: Harness, ms: number) => {
    const s = { minSy: 9, minY: 9, sparkle: 0, rot: 0, parts: 0, lidMin: 9, lidOther: 0 };
    h.run(ms, () => {
      const f = h.engine.debug.frame!, p = h.engine.debug.pose;
      s.minSy = Math.min(s.minSy, f.body.sy); s.minY = Math.min(s.minY, f.body.y); s.sparkle = Math.max(s.sparkle, p.sparkle);
      s.rot = Math.max(s.rot, Math.abs(f.body.rot)); s.parts = Math.max(s.parts, h.engine.debug.particles().length);
      const lo = Math.min(p.lidL, p.lidR), hi = Math.max(p.lidL, p.lidR);
      if (lo < s.lidMin) { s.lidMin = lo; s.lidOther = hi; }
    });
    return s;
  };
  const inPlay = () => { const h = harness(); h.engine.setRoom('play', { instant: true }); h.run(1500); return h; };

  it('catch: a chomp, then a small satisfied bounce with a glint in the eye, within 450 ms', () => {
    const h = inPlay(), base = h.engine.debug.frame!.body.sy;
    h.engine.roomReact('catch');
    const s = track(h, 700);
    expect(s.minSy / base).toBeLessThan(0.95);
    expect(s.minY).toBeLessThan(-1.5);
    expect(s.sparkle).toBeGreaterThan(0.6);
    expect(s.parts).toBeGreaterThan(0);
    for (let seed = 1; seed < 6; seed++) {
      const beats = roomReaction(ctxFor('cat', seed), 'catch');
      expect(Math.max(...beats.map((b) => b.at))).toBeLessThanOrEqual(450);
      expect(ends(beats)).toBeLessThan(700);
    }
  });

  it('near miss: a cute wobble after the star, never sad or droopy', () => {
    const h = inPlay();
    h.engine.roomReact('nearMiss');
    const s = track(h, 900);
    expect(s.rot).toBeGreaterThan(3);
    for (let seed = 1; seed < 8; seed++) for (const z of [false, true]) {
      const beats = roomReaction(ctxFor('bunny', seed), 'nearMiss', { zen: z });
      expect(beats.some((b) => b.expr === 'sad' || (b.target.browInner ?? 0) > 0 || (b.target.earDroop ?? 0) > 0)).toBe(false);
      expect(ends(beats)).toBeLessThan(z ? 1700 : 1300);
    }
  });

  it('round end: won is a happy hop; not won a gentle shrug and a wink, never droopy', () => {
    const won = inPlay();
    won.engine.roomReact('roundEnd', { won: true });
    const w = track(won, 1300);
    expect(w.minY).toBeLessThan(-8);
    expect(w.parts).toBeGreaterThan(0);
    const lost = inPlay();
    lost.engine.roomReact('roundEnd', { won: false });
    const l = track(lost, 1300);
    // one eye shuts while the other stays open: a wink
    expect(l.lidMin).toBeLessThan(0.3);
    expect(l.lidOther).toBeGreaterThan(0.8);
    expect(l.minY).toBeGreaterThan(-6);
    for (let seed = 1; seed < 8; seed++) {
      const beats = roomReaction(ctxFor('bunny', seed), 'roundEnd', { won: false });
      expect(beats.some((b) => b.expr === 'sad' || (b.target.earDroop ?? 0) > 0 || (b.target.headY ?? 0) > 1 || (b.target.browInner ?? 0) > 0)).toBe(false);
      expect(ends(beats)).toBeLessThan(1600);
      expect(ends(roomReaction(ctxFor('bunny', seed), 'roundEnd', { won: true }))).toBeLessThan(1600);
    }
  });

  it('zen: one preset softer, nothing flashes, and no round-end flourish', () => {
    const z = inPlay();
    z.engine.roomReact('roundEnd', { zen: true, won: true });
    const s = track(z, 1000);
    expect(s.minY).toBeGreaterThan(-1);
    expect(s.parts).toBe(0);
    for (const kind of ['catch', 'nearMiss', 'roundEnd'] as const) for (let seed = 1; seed < 5; seed++) {
      const plain = roomReaction(ctxFor('cat', seed), kind, { won: true }), soft = roomReaction(ctxFor('cat', seed), kind, { won: true, zen: true });
      expect(soft.some((b) => b.particles || b.haptic || (b.hop && b.hop.h > 4)), kind).toBe(false);
      if (kind !== 'roundEnd') expect(soft.map((b) => b.spring)).toEqual(zen(plain).map((b) => b.spring));
      else expect(soft.some((b) => b.hop || b.expr === 'happy')).toBe(false);
    }
    expect(zen([{ at: 0, target: {}, spring: 'eye', springs: { sy: 'snap' } }])[0]).toMatchObject({ spring: 'snap', springs: { sy: 'pop' } });
    expect(ends(roomReaction(ctxFor('cat', 1), 'roundEnd', { zen: true }))).toBeLessThan(1200);
  });

  it('setGaze steers the eyes to a stage point (Starfall’s star); null lets go', () => {
    const h = inPlay();
    h.engine.setGaze({ x: SCENE_LEFT, y: 200 });
    h.run(600);
    expect(h.engine.debug.gaze.ex).toBeLessThan(-0.3);
    h.engine.setGaze({ x: 600, y: 600 });
    h.run(600);
    expect(h.engine.debug.gaze.ex).toBeGreaterThan(0.2);
    expect(h.engine.debug.gaze.ey).toBeGreaterThan(0.2);
    h.engine.setGaze(null);
    h.run(1500);
    expect(Math.abs(h.engine.debug.gaze.ex)).toBeLessThan(0.1);
  });
});
const SCENE_LEFT = -300;

describe('Garden rain and the guided breath (§4.5)', () => {
  it('rain: pooled drops fall straight from under the body, inside each tier’s particle budget', () => {
    const el = () => ({ style: {} as Record<string, string>, dataset: {} as Record<string, string> });
    for (const [tier, cap] of [['full', 16], ['lite', 6], ['reduced', 0]] as Array<[Tier, number]>) {
      const h = harness({ tier });
      const pool = Array.from({ length: 16 }, el);
      h.engine.attach({ particles: pool as never, ball: null, cookie: null });
      h.engine.setRoom('garden', { instant: true });
      h.run(1500);
      h.engine.roomReact('rain');
      let most = 0, drops = 0, fell = false, wide = 0;
      let prev: Array<{ x: number; y: number }> = [];
      h.run(2400, () => {
        const ps = h.engine.debug.particles().filter((p) => p.kind === 'drop');
        most = Math.max(most, h.engine.debug.particles().length);
        drops = Math.max(drops, ps.length);
        if (ps.length && prev.length && ps[0].y > prev[0].y) fell = true;
        if (ps.length > 1) wide = Math.max(wide, Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)));
        prev = ps;
      });
      expect(most, tier).toBeLessThanOrEqual(cap);
      if (tier === 'reduced') { expect(drops).toBe(0); continue; }
      expect(drops, tier).toBeGreaterThan(0);
      expect(fell, tier).toBe(true);
      if (tier === 'full') expect(wide).toBeGreaterThan(12);
      // the page styles them: data-kind="drop" on the pool's divs, no rotation
      expect(pool.some((e) => e.dataset.kind === 'drop'), tier).toBe(true);
      for (const e of pool.filter((x) => x.dataset.kind === 'drop' && x.style.visibility === 'visible')) expect(e.style.transform).toMatch(/rotate\(0deg\)/);
    }
  });

  it('the guided breath plays one cycle per period, exempt from jitter, in 40 % and out through an "o"', () => {
    const h = harness();
    h.engine.setRoom('garden', { instant: true });
    h.run(800);
    h.engine.setGuidedBreath(6);
    const starts: number[] = [];
    let last = -1, inhaleTop = 0, outO = false;
    const t0 = h.t;
    h.run(13_000, () => {
      const p = h.engine.debug.playing.find((x) => x.kind === 'breathe');
      if (p && p.start !== last) { last = p.start; starts.push(p.start - t0); }
      const u = ((h.t - t0) % 6000) / 6000;
      if (u > 0.3 && u < 0.4) inhaleTop = Math.max(inhaleTop, h.engine.debug.frame!.body.sy);
      if (u > 0.55 && u < 0.9 && h.inner.currentMouth() === 'o') outO = true;
    });
    expect(starts.length).toBe(3);
    expect(starts[1] - starts[0]).toBeCloseTo(6000, -2);
    expect(inhaleTop).toBeGreaterThan(1.03);
    expect(outO).toBe(true);
    // the CSS breath keeps only a trace of depth (the cycle is the breath)
    expect(h.engine.debug.idle.by - 1).toBeLessThan(0.01);
    const b = breatheCycle(6000);
    expect(b.every((x) => x.fixed)).toBe(true);
    expect(b[1].at).toBe(2400);
    // reduced: the face only (the deep CSS breath carries the body)
    expect(breatheCycle(6000, 0.4, true).some((x) => x.target.sy !== undefined || x.target.y !== undefined)).toBe(false);
    h.engine.setGuidedBreath(null);
    const n = starts.length;
    h.run(7000, () => { const p = h.engine.debug.playing.find((x) => x.kind === 'breathe'); if (p && p.start !== last) { last = p.start; starts.push(p.start); } });
    expect(starts.length).toBe(n);
  });
});

describe('the frame guard covers the new motion (§10.7)', () => {
  it('a slow device steps to lite mid-motion: rain thins to the lite cap, the breath cycle and idles keep playing', () => {
    const h = harness();
    h.engine.setRoom('garden', { instant: true });
    h.run(800);
    h.engine.setGuidedBreath(6);
    for (let i = 0; i < FRAME_GUARD.window * 2; i++) h.engine.debug.guardFrame(40, NaN);
    expect(h.engine.motion.tier).toBe('lite');
    h.engine.setGuidedBreath(null);
    h.engine.roomReact('rain');
    let most = 0;
    h.run(2400, () => { most = Math.max(most, h.engine.debug.particles().length); });
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(6);
    h.engine.setGuidedBreath(6);
    let breathing = false;
    h.run(500, () => { breathing = breathing || h.engine.debug.playing.some((p) => p.kind === 'breathe'); });
    expect(breathing).toBe(true);
    expect(ROOMS.garden.pose.y).toBeLessThan(0);
  });
});

describe('determinism (seeded rng, fake clock)', () => {
  it('every Wave B entry replays exactly', () => {
    const script = () => {
      const h = harness({ seed: 21 });
      const trace: string[] = [];
      const snap = () => { const f = h.engine.debug.frame!; trace.push([f.body.x, f.body.y, f.body.rot, f.body.sy, f.face.x, f.face.y, f.lids, h.inner.lipOut.open, h.engine.debug.particles().length].map((v) => v.toFixed(4)).join(',')); };
      const steps: Array<() => void> = [
        () => h.engine.setRoom('play'),
        () => h.engine.roomReact('catch'),
        () => h.engine.roomReact('nearMiss', { zen: true }),
        () => h.engine.roomReact('roundEnd', { won: false }),
        () => h.engine.setGaze({ x: 30, y: 400 }),
        () => h.engine.setRoom('garden'),
        () => h.engine.roomReact('rain'),
        () => h.engine.setGuidedBreath(5),
        () => h.engine.setGuidedBreath(null),
        () => h.engine.setListening(true),
        () => h.engine.speakQueue([{ text: 'One.', ms: 500 }, 400]),
        () => h.engine.setListening(false),
        () => h.engine.setDetails({ glint: true, keepsakes: ['garden'] }),
        () => h.engine.lightMoment({ detail: 'charm' }),
        () => h.engine.setRoom('bedroom'),
      ];
      for (const s of steps) { s(); h.run(1200, snap); }
      return { trace, motion: h.motion.map((c) => `${c.type}@${Math.round(c.at)}`) };
    };
    const a = script(), b = script();
    expect(a.trace).toEqual(b.trace);
    expect(a.motion).toEqual(b.motion);
  });
});
