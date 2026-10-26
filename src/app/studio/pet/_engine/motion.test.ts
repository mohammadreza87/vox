import { describe, expect, it } from 'vitest';
import type { Mood } from '@/lib/pet/types';
import { PRESET_LOOKS } from '@/lib/studio/character';
import type { Stage } from '@/lib/studio/types';
import { prepareBeats, timelineEnd } from './beats';
import { sample } from './events.fixture';
import { createPetEngine } from './loop';
import * as motionExtras from './extras';
import { FRAME_GUARD, SETTLE } from './extras';
import { polish, STAGE_MOTION } from './motion';
import { REACTIONS } from './reactions';
import { growthLit, roomIdle, roomLeave, roomReaction, settleFloat } from './reactions/rooms';
import { seeded, variantHistory } from './rng';
import { tuningFor } from './species';
import {
  EVENT_PRIORITY, ROOM_ORDER, type Beat, type MotionCue, type ReactionCtx, type ReactionEvent, type ReactionKind, type RoomReaction, type Species, type Tier,
} from './types';

const CONTENT: Mood = { level: 'content', lowest: 'joy', tone: 'content', asleep: false };
const SCENE = {
  character: { x: 95, y: 200, size: 200 },
  toys: { cookie: { x: 80, y: 640 }, ball: { x: 195, y: 640 }, moon: { x: 310, y: 640 } },
  pill: { x: 195, y: 720 }, viewport: { w: 390, h: 800 },
};
const KINDS = Object.keys(EVENT_PRIORITY) as ReactionKind[];
const ROOM_REACTIONS: RoomReaction[] = ['catch', 'nearMiss', 'roundEnd', 'rain', 'admire', 'storyNod', 'pageFlip', 'ownDrawing'];

/** An engine on a fake clock (60 Hz frames, timers only when due), with its motion cues. */
function harness(o: { tier?: Tier; stage?: Stage; seed?: number; ambient?: boolean; look?: number; mood?: Mood } = {}) {
  let t = 1000, id = 0;
  const raf = new Map<number, (t: number) => void>();
  const timers = new Set<{ at: number; fn: () => void }>();
  const motion: Array<MotionCue & { at: number }> = [];
  const engine = createPetEngine({
    look: PRESET_LOOKS[o.look ?? 3], stage: o.stage ?? 4, size: 200, tier: o.tier ?? 'full', mood: o.mood ?? CONTENT, seed: o.seed ?? 5,
    clock: { now: () => t, raf: (cb) => { raf.set(++id, cb); return id; }, caf: (i) => { raf.delete(i); } },
    timers: { set: (fn, ms) => { const h = { at: t + ms, fn }; timers.add(h); return h; }, clear: (h) => { timers.delete(h as never); } },
    ambient: o.ambient ?? false, activity: false, followOS: false, motionExtras,
  });
  engine.setScene(SCENE);
  engine.onMotion((c) => motion.push({ ...c, at: t }));
  engine.start();
  const frame = () => {
    t += 1000 / 60;
    for (const h of [...timers]) if (h.at <= t) { timers.delete(h); h.fn(); }
    const cbs = [...raf.values()];
    raf.clear();
    for (const cb of cbs) cb(t);
  };
  const run = (ms: number, each?: () => void) => { const end = t + ms; while (t < end) { frame(); each?.(); } };
  /** Jump the clock with no frames (between taps), firing due timers. */
  const idle = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 250);
      for (const h of [...timers]) if (h.at <= t) { timers.delete(h); h.fn(); }
      const cbs = [...raf.values()];
      raf.clear();
      for (const cb of cbs) cb(t);
    }
  };
  return { engine, motion, frame, run, idle, get t() { return t; } };
}

function ctxFor(species: Species, seed: number, stage: Stage = 4, tier: Tier = 'full'): ReactionCtx {
  const rng = seeded(seed);
  return { rng, species, family: 'puff', stage, mood: CONTENT, tier, variantHistory: variantHistory(rng) };
}
const react = (kind: ReactionKind, i: number, ctx: ReactionCtx) => (REACTIONS[kind] as (e: ReactionEvent, c: ReactionCtx) => Beat[])(sample(kind, i), ctx);

describe('polish: anticipation and settles on every reaction (§10.2)', () => {
  it('every hop starts from a crouch, unless it is chained onto another hop or already crouched', () => {
    const lone: Beat[] = [{ at: 40, target: { headTilt: 4 }, spring: 'pop' }, { at: 60, target: {}, spring: 'pop', hop: { h: 10 } }];
    const out = polish(lone, 'touch');
    const hop = out.find((b) => b.hop)!;
    expect(hop.at).toBe(80);
    expect(hop.target.sy).toBeGreaterThan(1);
    const crouch = out.find((b) => b.target.sy !== undefined && b.target.sy < 1)!;
    expect(crouch.at).toBe(0);
    expect(crouch.target.sy).toBeLessThan(0.97);
    // already crouched (celebrate's double hop): untouched
    const celebrated = react('celebrate', 0, ctxFor('cat', 3));
    expect(polish(celebrated, 'touch').length).toBe(celebrated.length);
    // a chain of little hops (a signature) takes off from each landing
    const chain: Beat[] = [0, 260, 520].map((at) => ({ at: at + 100, target: { sy: 0.95 }, spring: 'snap', hop: { h: 5 } }));
    expect(polish(chain, 'idle').filter((b) => b.hop).map((b) => b.at)).toEqual([100, 360, 620]);
  });

  it('idle beats settle with one overshoot: no jelly, no jiggle past 600 ms', () => {
    const beats: Beat[] = [{ at: 0, target: { sy: 0.9 }, spring: 'jelly', osc: [{ channel: 'sy', amp: 0.05, hz: 4, ms: 900 }, { channel: 'rot', amp: 3, hz: 2, ms: 1200 }], release: 'jelly' }];
    const [b] = polish(beats, 'idle');
    expect(b.spring).toBe('pop');
    expect(b.release).toBe('pop');
    const osc = b.osc as Array<{ channel: string; ms: number }>;
    expect(osc.find((o) => o.channel === 'sy')!.ms).toBe(600);
    expect(osc.find((o) => o.channel === 'rot')!.ms).toBe(1200);
    // not idle: untouched
    expect(polish(beats, 'touch')[0].spring).toBe('jelly');
  });

  it('keeps every reaction within ±20 % of its duration, on every stage and every species weight', () => {
    const base = tuningFor('cat', 'puff');
    for (const species of ['cloud', 'cat', 'bear', 'chick'] as Species[]) {
      const tuning = tuningFor(species, 'puff');
      for (const stage of [1, 2, 3, 4] as Stage[]) {
        for (const kind of KINDS) for (let i = 0; i < 4; i++) {
          const raw = react(kind, i, ctxFor(species, 9 + i));
          const before = timelineEnd(prepareBeats(raw, { rng: seeded(1), tuning: base, tier: 'full', exact: true }));
          const after = timelineEnd(prepareBeats(polish(raw, EVENT_PRIORITY[kind]), { rng: seeded(1), tuning, tier: 'full', exact: true, stage }));
          if (before < 200) continue;
          expect(after / before, `${species} stage ${stage} ${kind}#${i} ${before.toFixed(0)} → ${after.toFixed(0)} ms`).toBeLessThanOrEqual(1.2);
          expect(after / before, `${species} stage ${stage} ${kind}#${i}`).toBeGreaterThanOrEqual(0.8);
        }
      }
    }
  });
});

describe('per-stage vocabulary (§10.3)', () => {
  it('a wisp only makes tiny hops on slower springs; a puff bounces more than a shaped one', () => {
    const tuning = tuningFor('cloud', 'puff');
    const hop: Beat[] = [{ at: 0, target: { sy: 0.9 }, spring: 'snap' }, { at: 100, target: { sy: 1.06 }, spring: 'pop', hop: { h: 20 } }];
    const at = (stage: Stage) => prepareBeats(hop, { rng: seeded(1), tuning, tier: 'full', exact: true, stage });
    expect(at(1)[1].hop!.h / at(4)[1].hop!.h).toBeCloseTo(STAGE_MOTION[1].hop, 5);
    expect(at(1)[1].kc.k).toBeLessThan(at(4)[1].kc.k);
    // more bounce: a lower damping for the same preset at stage 2 than at stage 3
    const c = (stage: Stage) => at(stage)[1].kc.c / Math.sqrt(at(stage)[1].kc.k);
    expect(c(2)).toBeLessThan(c(3));
  });

  it('a wisp’s beats land imprecisely but deterministically, never out of order', () => {
    const tuning = tuningFor('cloud', 'puff');
    const beats = react('hello', 0, ctxFor('cloud', 2));
    const a = prepareBeats(beats, { rng: seeded(4), tuning, tier: 'full', stage: 1 });
    const b = prepareBeats(beats, { rng: seeded(4), tuning, tier: 'full', stage: 1 });
    expect(a.map((x) => x.at)).toEqual(b.map((x) => x.at));
    for (let i = 1; i < a.length; i++) expect(a[i].at).toBeGreaterThanOrEqual(a[i - 1].at);
  });

  it('eyes lead the head from the shaped stage on; darts never on a wisp or on reduced motion', () => {
    expect(harness({ stage: 1 }).engine.debug.gaze.lead[1]).toBeLessThanOrEqual(20);
    expect(harness({ stage: 4 }).engine.debug.gaze.lead).toEqual([60, 80]);
    expect(harness({ stage: 1 }).engine.debug.gaze.darts).toBe(false);
    expect(harness({ stage: 4 }).engine.debug.gaze.darts).toBe(true);
    expect(harness({ stage: 4, tier: 'reduced' }).engine.debug.gaze.darts).toBe(false);
    // setStage moves the vocabulary with the look
    const h = harness({ stage: 1 });
    h.engine.setStage(4);
    expect(h.engine.motion.stage).toBe(4);
    expect(h.engine.debug.gaze.lead).toEqual([60, 80]);
  });

  it('the eyes arrive before the head on a big look (60–80 ms), with tiny darts inside a long look', () => {
    const h = harness({ stage: 4 });
    h.run(500);
    h.engine.pointer({ kind: 'down', id: 3, x: 5, y: 210, t: h.t });
    let eyesAt = -1, headAt = -1;
    const t0 = h.t;
    h.run(400, () => {
      const g = h.engine.debug.gaze;
      if (eyesAt < 0 && Math.abs(g.ex) > 0.3) eyesAt = h.t - t0;
      if (headAt < 0 && Math.abs(g.hx) > 0.05) headAt = h.t - t0;
    });
    expect(eyesAt).toBeGreaterThanOrEqual(0);
    expect(headAt - eyesAt).toBeGreaterThanOrEqual(30);
    h.engine.pointer({ kind: 'up', id: 3, x: 5, y: 210, t: h.t });
  });
});

describe('the settle rule (§3.1 T9)', () => {
  /** Tap the body every 20 s for `ms`. */
  const play = (h: ReturnType<typeof harness>, ms: number) => {
    for (let s = 0; s < ms; s += 20_000) {
      h.engine.pointer({ kind: 'down', id: 1, x: SCENE.character.x + 100, y: SCENE.character.y + 140, t: h.t });
      h.frame();
      h.engine.pointer({ kind: 'up', id: 1, x: SCENE.character.x + 100, y: SCENE.character.y + 140, t: h.t });
      h.run(2500);
      h.idle(17_500);
    }
  };

  it('six minutes of continuous play settles into the content float once: slower breath, rarer fidgets, no words', () => {
    const run = () => {
      const h = harness({ seed: 7 });
      const before = h.engine.debug.idle.period;
      play(h, 5 * 60_000);
      expect(h.motion.some((c) => c.type === 'settle')).toBe(false);
      play(h, 2 * 60_000);
      h.run(2500);
      const settles = h.motion.filter((c) => c.type === 'settle');
      expect(settles).toHaveLength(1);
      expect(h.engine.motion.contentFloat).toBe(true);
      expect(h.engine.debug.idle.period).toBeCloseTo(before * SETTLE.breath, 5);
      return settles[0].at;
    };
    const a = run(), b = run();
    // deterministic under the seeded rng and the fake clock
    expect(a).toBe(b);
    // the float itself says nothing (the UI owns the T9 line)
    expect(settleFloat(ctxFor('cat', 1)).some((x) => x.say || x.thought)).toBe(false);
  });

  it('a gap ends the stretch: the float lifts on the next play and the six minutes start over', () => {
    const h = harness();
    play(h, 4 * 60_000);
    h.idle(SETTLE.gapMs + 30_000);
    play(h, 3 * 60_000);
    expect(h.motion.some((c) => c.type === 'settle')).toBe(false);
  });

  it('idle tiers stay content-free: no idle beat or room idle carries words', () => {
    for (const kind of ['fidgetSmall', 'fidgetLong', 'signature'] as ReactionKind[]) for (let i = 0; i < 10; i++) {
      expect(react(kind, i, ctxFor('bunny', i)).some((b) => b.say), kind).toBe(false);
    }
    for (const room of ROOM_ORDER) expect(roomIdle(ctxFor('cat', 2), room).some((b) => b.say || b.thought), room).toBe(false);
  });
});

describe('rooms (§10.4, §10.5)', () => {
  it('a transition counter-leans, leans with the slide on an arc, swaps at ~150 ms and settles by ~300 ms', () => {
    const h = harness();
    h.run(600);
    h.engine.setRoom('garden');
    const t0 = h.t;
    const lean: Array<[number, number, number]> = [];
    h.run(700, () => { const f = h.engine.debug.frame!; lean.push([h.t - t0, f.body.rot, f.body.y]); });
    const swap = h.motion.find((c) => c.type === 'roomSwap')!;
    expect(swap).toMatchObject({ room: 'garden' });
    expect(swap.at - t0).toBeGreaterThanOrEqual(140);
    expect(swap.at - t0).toBeLessThanOrEqual(170);
    // garden is to the right of home: a counter-lean one way first, then the lean the other way
    const early = lean.filter(([t]) => t <= 70).map(([, r]) => r), mid = lean.filter(([t]) => t > 90 && t < 220).map(([, r]) => r);
    expect(Math.min(...early)).toBeLessThan(-0.5);
    expect(Math.max(...mid)).toBeGreaterThan(2);
    // the arc: a lift during the lean, never a straight slide
    expect(Math.min(...lean.filter(([t]) => t < 250).map(([, , y]) => y))).toBeLessThan(-0.8);
    expect(h.engine.motion.room).toBe('garden');
  });

  it('each room changes the idle flavour (bedroom slower breath and heavier lids, garden hovers)', () => {
    const h = harness();
    h.run(300);
    const home = h.engine.debug.idle;
    h.engine.setRoom('bedroom', { instant: true });
    h.run(1500);
    expect(h.engine.debug.idle.period).toBeGreaterThan(home.period * 1.2);
    expect(h.engine.debug.idle.lid).toBeLessThan(home.lid);
    h.engine.setRoom('garden', { instant: true });
    h.run(2500);
    expect(h.engine.debug.frame!.body.y).toBeLessThan(-4);
  });

  it('a room reaction asked before the extras chunk lands plays as soon as it does', async () => {
    const t = 0;
    const engine = createPetEngine({ look: PRESET_LOOKS[3], stage: 4, size: 200, tier: 'full', mood: CONTENT, clock: { now: () => t, raf: () => 1, caf: () => {} }, timers: { set: () => 1, clear: () => {} }, activity: false });
    engine.setScene(SCENE);
    engine.start();
    const h = { engine };
    h.engine.roomReact('admire');
    expect(h.engine.debug.playing.some((p) => p.kind === 'admire')).toBe(false);
    await h.engine.loadRooms();
    expect(h.engine.debug.playing.some((p) => p.kind === 'admire')).toBe(true);
  });

  it('reduced motion cuts: the swap cue comes at once and the character never moves', () => {
    const h = harness({ tier: 'reduced' });
    h.run(300);
    const t0 = h.t;
    h.engine.setRoom('closet');
    expect(h.motion.find((c) => c.type === 'roomSwap')!.at).toBe(t0);
    h.run(800, () => { const f = h.engine.debug.frame!; expect(Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot) + Math.abs(f.face.x)).toBeLessThan(1e-6); });
  });

  it('every room reaction and transition is well formed and short; rain stays inside the particle budget', async () => {
    for (const kind of ROOM_REACTIONS) for (const won of [false, true]) {
      const beats = roomReaction(ctxFor('cat', 3), kind, { won });
      expect(beats.length, kind).toBeGreaterThan(0);
      const end = timelineEnd(prepareBeats(beats, { rng: seeded(1), tuning: tuningFor('cat', 'puff'), tier: 'full', exact: true }));
      expect(end, kind).toBeLessThan(3200);
    }
    expect(timelineEnd(prepareBeats(roomLeave(ctxFor('cat', 1), 1), { rng: seeded(1), tuning: tuningFor('cat', 'puff'), tier: 'full', exact: true }))).toBeLessThan(600);
    const h = harness();
    await h.engine.loadRooms();
    h.engine.roomReact('rain');
    let most = 0;
    h.run(2500, () => { most = Math.max(most, h.engine.debug.particles().length); });
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(16);
  });
});

describe('growth moments and unlocked moves (§4.11, §10.3)', () => {
  it('lighting a moment looks up, glows and peaks at ~600 ms (the litPeak cue), then rests', () => {
    const h = harness();
    h.run(300);
    const t0 = h.t;
    h.engine.lightMoment();
    let glow = 0, up = 0;
    h.run(1800, () => { const f = h.engine.debug.frame!; glow = Math.max(glow, f.glow); up = Math.min(up, h.engine.debug.pose.gazeY); });
    const peak = h.motion.find((c) => c.type === 'litPeak')!;
    expect(peak.at - t0).toBeGreaterThanOrEqual(590);
    expect(peak.at - t0).toBeLessThanOrEqual(640);
    expect(glow).toBeGreaterThan(0.5);
    expect(up).toBeLessThan(-0.1);
    expect(growthLit(ctxFor('cat', 1)).some((b) => b.particles)).toBe(false);
  });

  it('unlockFidget adds one move per moment (stable by id) without touching Bond; lockFidget takes it back', () => {
    const h = harness();
    expect(h.engine.motion.signatures).toBe(0);
    expect(h.engine.unlockFidget('release-planning')).toBe(true);
    expect(h.engine.unlockFidget('release-planning')).toBe(false);
    expect(h.engine.motion.signatures).toBe(1);
    h.engine.setBond(50);
    expect(h.engine.motion.signatures).toBe(3);
    h.engine.lockFidget('release-planning');
    expect(h.engine.motion.signatures).toBe(2);
    // a shaped pet holds its moves until it is formed
    const s3 = harness({ stage: 3 });
    s3.engine.unlockFidget('x');
    expect(s3.engine.motion.signatures).toBe(0);
  });

  it('a long watch plays the unlocked move among the long fidgets', () => {
    const played = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      let t = 0;
      const e = createPetEngine({
        look: PRESET_LOOKS[0], stage: 4, size: 200, tier: 'full', mood: CONTENT, seed,
        clock: { now: () => t, raf: () => 1, caf: () => {} }, timers: { set: () => 1, clear: () => {} }, activity: false, followOS: false, motionExtras,
      });
      e.setScene(SCENE);
      e.unlockFidget('first-task');
      e.start();
      for (; t < 95_000; t += 50) { e.debug.tick(t); for (const p of e.debug.playing) played.add(p.kind); }
    }
    expect(played.has('signature')).toBe(true);
  });
});

describe('reduced motion (§10.8)', () => {
  it('setReducedMotion crossfades: no particles, no travel, blink and breath only; null hands back to the tier', () => {
    const h = harness();
    h.engine.setReducedMotion(true);
    expect(h.engine.motion.tier).toBe('reduced');
    h.engine.fire({ type: 'celebrate', why: 'bond' });
    h.run(1600, () => {
      const f = h.engine.debug.frame!;
      expect(h.engine.debug.particles()).toHaveLength(0);
      expect(Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot)).toBeLessThan(1e-6);
    });
    // a gentle breath stays
    expect(h.engine.debug.frame!.breath.by).toBeGreaterThan(1);
    expect(h.engine.debug.frame!.breath.sway).toBeLessThan(0.05);
    h.engine.setReducedMotion(null);
    expect(h.engine.motion.tier).toBe('full');
  });
});

describe('the frame-budget guard (§10.7)', () => {
  it('steps full → lite once after a window of slow frames or heavy script, never to reduced; setTier starts over', () => {
    const h = harness();
    for (let i = 0; i < FRAME_GUARD.window; i++) h.engine.debug.guardFrame(1000 / 60, 1);
    expect(h.engine.motion.tier).toBe('full');
    for (let i = 0; i < FRAME_GUARD.window; i++) h.engine.debug.guardFrame(32, NaN);
    expect(h.engine.motion.tier).toBe('lite');
    expect(h.motion.filter((c) => c.type === 'degraded')).toEqual([expect.objectContaining({ tier: 'lite', reason: 'frames' })]);
    for (let i = 0; i < FRAME_GUARD.window * 3; i++) h.engine.debug.guardFrame(80, 20);
    expect(h.engine.motion.tier).toBe('lite');
    h.engine.setTier('full');
    expect(h.engine.motion.tier).toBe('full');
    for (let i = 0; i < FRAME_GUARD.window; i++) h.engine.debug.guardFrame(1000 / 60, FRAME_GUARD.scriptMs + 1);
    expect(h.engine.motion.tier).toBe('lite');
    expect(h.motion.at(-1)).toMatchObject({ type: 'degraded', reason: 'script' });
  });

  it('measures only chained busy frames on the real loop (a 60 Hz run never degrades)', () => {
    const h = harness();
    for (let i = 0; i < 6; i++) { h.engine.fire({ type: 'tickle' }); h.run(1500); }
    expect(h.engine.motion.tier).toBe('full');
  });
});

describe('overlap and blinks (§10.2)', () => {
  it('the face lands a beat after the body on a hop, and rides it exactly on reduced motion', () => {
    for (const tier of ['full', 'reduced'] as Tier[]) {
      const h = harness({ tier });
      h.run(300);
      h.engine.fire({ type: 'hello' });
      let lag = 0;
      h.run(1200, () => { const f = h.engine.debug.frame!; lag = Math.max(lag, Math.abs(f.face.y - h.engine.debug.pose.headY)); });
      if (tier === 'full') expect(lag).toBeGreaterThan(0.2); else expect(lag).toBeLessThan(1e-6);
    }
  });

  it('a soft accessory trails a spin', () => {
    const h = harness({ look: 3 });
    h.run(300);
    h.engine.fire({ type: 'signature', index: 0 });
    let swing = 0;
    h.run(1500, () => { swing = Math.max(swing, Math.abs(h.engine.debug.frame!.accSoft.rot)); });
    expect(swing).toBeGreaterThan(2);
  });

  it('blinks on most hop landings', () => {
    let blinked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const h = harness({ seed });
      h.run(300);
      // the jump for the ball: a 26–30 px hop with wide eyes (no happy arcs hiding a blink)
      h.engine.fire({ type: 'ballNear' });
      h.run(380);
      let closed = false;
      h.run(350, () => { if (h.engine.debug.frame!.lids < 0.6) closed = true; });
      if (closed) blinked++;
    }
    expect(blinked).toBeGreaterThanOrEqual(5);
  });
});
