import { frame as framerFrame, type MotionValue } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';
import type { Mood } from '@/lib/pet/types';
import { PRESET_LOOKS } from '@/lib/studio/character';
import { LISTEN } from '../../_components/character/poses';
import type { EngineCue } from '../_ui/contract';
import { sample } from './events.fixture';
import { Gaze } from './gaze';
import { AudioLipSync, openFromRms, TextLipSync } from './lipsync';
import { createPetEngine } from './loop';
import { REACTIONS } from './reactions';
import { seeded } from './rng';
import { EVENT_PRIORITY, TIER_BUDGET, type ReactionKind, type Tier } from './types';

const CONTENT: Mood = { level: 'content', lowest: 'joy', tone: 'content', asleep: false };
const SCENE = {
  character: { x: 95, y: 200, size: 200 },
  toys: { cookie: { x: 80, y: 640 }, ball: { x: 195, y: 640 }, moon: { x: 310, y: 640 } },
  pill: { x: 195, y: 720 }, viewport: { w: 390, h: 800 },
};

/** An engine on a fake clock: frames run only when requested, timers only when due. */
function harness(o: { tier?: Tier; species?: number; mood?: Mood; seed?: number } = {}) {
  let t = 1000;
  let id = 0;
  const raf = new Map<number, (t: number) => void>();
  const timers = new Set<{ at: number; fn: () => void }>();
  const cues: Array<EngineCue & { at: number }> = [];
  let requests = 0;
  const engine = createPetEngine({
    look: PRESET_LOOKS[o.species ?? 1], stage: 4, size: 200, tier: o.tier ?? 'full', mood: o.mood ?? CONTENT, seed: o.seed ?? 5,
    onCue: (c) => cues.push({ ...c, at: t }),
    clock: { now: () => t, raf: (cb) => { requests++; raf.set(++id, cb); return id; }, caf: (i) => { raf.delete(i); } },
    timers: { set: (fn, ms) => { const h = { at: t + ms, fn }; timers.add(h); return h; }, clear: (h) => { timers.delete(h as never); } },
    ambient: false, activity: false,
  });
  engine.setScene(SCENE);
  engine.start();
  /** Advance one 60 Hz frame: due timers fire, then any requested frame runs. */
  const frame = () => {
    t += 1000 / 60;
    for (const h of [...timers]) if (h.at <= t) { timers.delete(h); h.fn(); }
    const cbs = [...raf.values()];
    raf.clear();
    for (const cb of cbs) cb(t);
  };
  const run = (ms: number, each?: () => void) => { const end = t + ms; while (t < end) { frame(); each?.(); } };
  /** Time passes with no frames and no timers (the page is hidden). */
  const skip = (ms: number) => { t += ms; };
  const settle = (max = 8000) => { const end = t + max; while (raf.size && t < end) frame(); };
  return {
    engine, cues, frame, run, settle, skip,
    get t() { return t; },
    get pending() { return raf.size; },
    get requests() { return requests; },
    get timers() { return [...timers].map((h) => h.at - t); },
  };
}

const KINDS = Object.keys(EVENT_PRIORITY) as ReactionKind[];
const mv = (v: unknown) => v as MotionValue<number>;

describe('the loop (brief §3.1, §4 rows 5–6)', () => {
  it('sleeps once everything has settled: no frames are requested until the next blink timer', () => {
    const h = harness();
    h.engine.fire(sample('poke', 0));
    h.settle();
    expect(h.pending).toBe(0);
    expect(h.engine.debug.awake).toBe(false);
    // one timer stands in for the whole loop (the next blink)
    expect(h.timers.length).toBe(1);
    const before = h.requests, wakeIn = h.timers[0];
    h.run(Math.max(0, wakeIn - 20));
    expect(h.requests).toBe(before);
    // the blink wakes it, and it sleeps again after
    h.run(400);
    expect(h.requests).toBeGreaterThan(before);
    h.settle();
    expect(h.pending).toBe(0);
  });

  it('deforms the character inside the pointerdown handler (the same frame)', () => {
    const h = harness();
    h.settle();
    const sy = mv(h.engine.body.scaleY), before = sy.get();
    const took = h.engine.pointer({ kind: 'down', id: 1, x: SCENE.character.x + 100, y: SCENE.character.y + 140, t: h.t });
    expect(took).toBe(true);
    expect(sy.get()).toBeLessThan(before - 0.01);
    // and a tap off the character is not taken (the eyes track it instead)
    expect(h.engine.pointer({ kind: 'down', id: 2, x: 5, y: 5, t: h.t })).toBe(false);
  });

  for (const tier of ['full', 'lite'] as const) {
    it(`stays inside the ${tier} per-frame budget (morph paths and SVG transforms) for every reaction`, () => {
      const b = TIER_BUDGET[tier];
      let busiest = { morphs: 0, transforms: 0 };
      for (const kind of KINDS) {
        const h = harness({ tier, species: kind.length % 7 });
        let worst = { morphs: 0, transforms: 0 };
        h.engine.fire(sample(kind, 1));
        h.run(2500, () => {
          const s = h.engine.debug.stats;
          worst = { morphs: Math.max(worst.morphs, s.morphs), transforms: Math.max(worst.transforms, s.transforms) };
        });
        expect(worst.morphs, kind).toBeLessThanOrEqual(b.morphs);
        expect(worst.transforms, kind).toBeLessThanOrEqual(b.transforms);
        expect(h.engine.debug.particles().length, kind).toBeLessThanOrEqual(b.particles);
        busiest = { morphs: Math.max(busiest.morphs, worst.morphs), transforms: Math.max(busiest.transforms, worst.transforms) };
      }
      // the counts are real: the busiest reactions do reach the budget (and anything over it waited a frame)
      expect(busiest.morphs).toBeGreaterThanOrEqual(Math.min(b.morphs, 4));
      expect(busiest.transforms).toBeGreaterThanOrEqual(Math.min(b.transforms, 6));
    });
  }

  it('reduced motion never translates or rotates the body', () => {
    for (const kind of ['hello', 'poke', 'tickle', 'overpoke', 'land', 'shake', 'celebrate', 'wave', 'sad', 'welcomeBack'] as ReactionKind[]) {
      const h = harness({ tier: 'reduced' });
      for (let i = 0; i < 2; i++) {
        h.engine.fire(sample(kind, i));
        h.run(2500, () => {
          const f = h.engine.debug.frame!;
          expect(Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot), kind).toBeLessThan(1e-6);
          expect(Math.abs(f.body.sy - 1), kind).toBeLessThanOrEqual(0.05);
        });
      }
    }
  });

  it('reduced motion never flings, spins, bounces or hops: a released drag eases home', () => {
    const h = harness({ tier: 'reduced' });
    h.settle();
    const c = SCENE.character;
    const at = (x: number, y: number) => ({ x: c.x + x, y: c.y + y });
    const ptr = (kind: 'down' | 'move' | 'up', p: { x: number; y: number }) => h.engine.pointer({ kind, id: 4, ...p, t: h.t });
    ptr('down', at(100, 140));
    for (let i = 1; i <= 12; i++) { h.frame(); ptr('move', at(100 + i * 9, 140 - i * 11)); }
    h.frame();
    const held = h.engine.debug.frame!.body;
    // the drag still moves the character (no stretch)
    expect(Math.hypot(held.x, held.y)).toBeGreaterThan(20);
    ptr('up', at(100 + 13 * 40, 140 - 13 * 40));
    let peakY = 0, rot = 0, squash = 0;
    h.run(600, () => {
      const f = h.engine.debug.frame!.body;
      peakY = Math.min(peakY, f.y - held.y); rot = Math.max(rot, Math.abs(f.rot)); squash = Math.max(squash, Math.abs(f.sy - 1));
    });
    expect(rot).toBeLessThan(1e-6);
    expect(squash).toBeLessThanOrEqual(0.05);
    // never thrown upward, and home within the crossfade
    expect(peakY).toBeGreaterThan(-0.5);
    const home = h.engine.debug.frame!.body;
    expect(Math.abs(home.x) + Math.abs(home.y)).toBeLessThan(0.5);
    expect(h.engine.debug.playing.some((p) => p.kind === 'fling' || p.kind === 'land')).toBe(false);
  });

  it('reduced motion plays a Bop round without shuffles, hops or head travel', () => {
    const h = harness({ tier: 'reduced', mood: { level: 'happy', lowest: 'joy', tone: 'happy', asleep: false } });
    h.engine.toy({ type: 'ballTap' });
    let moved = 0, squash = 0;
    h.run(11_000, () => {
      const f = h.engine.debug.frame!;
      moved = Math.max(moved, Math.abs(f.body.x) + Math.abs(f.body.y) + Math.abs(f.body.rot) + Math.abs(f.face.x) + Math.abs(f.face.y));
      squash = Math.max(squash, Math.abs(f.body.sy - 1));
    });
    expect(h.cues.some((c) => c.type === 'playOver')).toBe(true);
    expect(moved).toBeLessThan(1e-6);
    expect(squash).toBeLessThanOrEqual(0.05);
  });

  it('is listening within 100 ms of focus', () => {
    const h = harness();
    h.settle();
    h.engine.talk('listening');
    h.run(100);
    expect(h.engine.debug.frame!.body.sy - 1).toBeGreaterThanOrEqual(0.7 * (LISTEN.sy - 1));
    expect(h.cues.some((c) => c.type === 'expr' && c.expr === 'listening')).toBe(true);
  });

  it('speaks text at the reveal rate and has the mouth at rest within 110 ms of the end', () => {
    const h = harness();
    h.engine.talk('thinking');
    h.run(500);
    const text = 'Hello there! I missed you.';
    const start = h.t;
    h.engine.speakText(text, 28);
    let open = 0;
    h.run(1500, () => { open = Math.max(open, h.engine.debug.frame!.mouth.l - h.engine.debug.frame!.mouth.u); });
    const spoken = h.cues.find((c) => c.type === 'spoken');
    expect(spoken).toBeDefined();
    expect(spoken!.at - (start + (text.length / 28) * 1000)).toBeLessThanOrEqual(110);
    // the mouth really opened while speaking
    expect(open).toBeGreaterThan(6);
  });

  it('feeds: a tapped cookie arcs into the mouth, the bite posts the care action, the chain plays out', () => {
    const h = harness();
    h.engine.toy({ type: 'cookieTap' });
    h.run(300);
    expect(h.cues.some((c) => c.type === 'care')).toBe(false);
    h.run(400);
    expect(h.cues.find((c) => c.type === 'care')).toMatchObject({ action: 'feed' });
    h.run(3500);
    expect(h.cues.some((c) => c.type === 'say' && c.line === 'yum')).toBe(true);
  });

  it('rests: yawn → drift → asleep (lights down, care posted); a double tap wakes', () => {
    const h = harness();
    h.engine.toy({ type: 'moonTap' });
    h.run(6500);
    expect(h.cues.find((c) => c.type === 'care')).toMatchObject({ action: 'sleep' });
    expect(mv(h.engine.dim).get()).toBeGreaterThan(0.5);
    expect(h.cues.filter((c) => c.type === 'expr').at(-1)).toMatchObject({ expr: 'sleeping' });
    const tap = (dt: number) => {
      h.engine.pointer({ kind: 'down', id: 9, x: SCENE.character.x + 100, y: SCENE.character.y + 140, t: h.t });
      h.run(60);
      h.engine.pointer({ kind: 'up', id: 9, x: SCENE.character.x + 100, y: SCENE.character.y + 140, t: h.t });
      h.run(dt);
    };
    tap(800);
    expect(h.cues.some((c) => c.type === 'say' && c.line === 'fiveMore')).toBe(true);
    tap(2500);
    expect(h.cues.filter((c) => c.type === 'care').at(-1)).toMatchObject({ action: 'wake' });
    expect(mv(h.engine.dim).get()).toBeLessThan(0.05);
  });

  it('plays Bop: the round posts play, scores and ends within 10 s', () => {
    const h = harness({ mood: { level: 'happy', lowest: 'joy', tone: 'happy', asleep: false } });
    h.engine.toy({ type: 'ballTap' });
    expect(h.cues.find((c) => c.type === 'care')).toMatchObject({ action: 'play' });
    h.run(11500);
    const over = h.cues.find((c) => c.type === 'playOver');
    expect(over).toBeDefined();
    expect(h.cues.some((c) => c.type === 'score')).toBe(true);
  });
});

describe('gaze: eyes lead, the head follows, the eyes counter-move (brief §2.4)', () => {
  it('locks on target while the head catches up', () => {
    const g = new Gaze(seeded(1));
    let t = 0;
    g.look(0.9, 0, t);
    const totals: number[] = [];
    for (let i = 0; i < 90; i++) { t += 1000 / 60; g.update(t, 1000 / 60); if (t > 150) totals.push(g.x); }
    // the head carries about half, the eyes the rest, and the sum stayed on target throughout
    expect(g.hx.x).toBeGreaterThan(0.4);
    expect(g.ex.x).toBeLessThan(0.6);
    for (const x of totals) expect(Math.abs(x - 0.9)).toBeLessThan(0.06);
  });

  it('saccades take 21 + 2.2·A ms', () => {
    const g = new Gaze(seeded(2));
    g.look(0.5, 0, 0);
    let t = 0;
    while (g.ex.x < 0.45 && t < 300) { t += 4; g.update(t, 4); }
    // A = 15°: D ≈ 54 ms to arrive
    expect(t).toBeGreaterThan(30);
    expect(t).toBeLessThan(90);
  });
});

describe('lip-sync (brief §2.5)', () => {
  it('gates below −50 dB and opens fully at the top of the range', () => {
    expect(openFromRms(10 ** (-55 / 20))).toBe(0);
    expect(openFromRms(10 ** (-49 / 20))).toBeGreaterThan(0);
    expect(openFromRms(1)).toBe(1);
  });

  it('text: vowels open, spaces close, done shortly after the last character', () => {
    const l = new TextLipSync('aaa   aaa', 28, 0);
    let t = 0, maxOpen = 0, minInGap = 1;
    while (t < 2000) {
      t += 8;
      const s = l.sample(t, 8);
      if (t < 107) maxOpen = Math.max(maxOpen, s.open);
      if (t > 180 && t < 214) minInGap = Math.min(minInGap, s.open);
      if (s.done) break;
    }
    expect(maxOpen).toBeGreaterThan(0.6);
    expect(minInGap).toBeLessThan(maxOpen * 0.6);
    expect(t - (9 / 28) * 1000).toBeLessThanOrEqual(110);
  });

  it('audio: silence for 120 ms is a rest, and stop() closes the mouth', () => {
    let level = 0.3;
    const an = {
      fftSize: 1024, frequencyBinCount: 512, context: { sampleRate: 48000 },
      getFloatTimeDomainData: (a: Float32Array) => { for (let i = 0; i < a.length; i++) a[i] = (i % 2 ? 1 : -1) * level; },
      getByteFrequencyData: (a: Uint8Array) => a.fill(100),
    };
    const lip = new AudioLipSync(an);
    let t = 0, s = lip.sample(t, 16);
    for (let i = 0; i < 20; i++) s = lip.sample((t += 16), 16);
    expect(s.open).toBeGreaterThan(0.7);
    level = 0;
    for (let i = 0; i < 20; i++) s = lip.sample((t += 16), 16);
    expect(s.open).toBeLessThan(0.1);
    level = 0.3;
    for (let i = 0; i < 10; i++) s = lip.sample((t += 16), 16);
    lip.stop();
    let ms = 0;
    while (!s.done && ms < 300) { s = lip.sample((t += 16), 16); ms += 16; }
    expect(ms).toBeLessThanOrEqual(112);
  });
});

describe('pausing with the page', () => {
  it('moves every timeline by the time away: nothing that came due while hidden fires at once', () => {
    const h = harness();
    h.engine.toy({ type: 'moonTap' });
    h.run(500);
    h.engine.stop();
    h.skip(10_000);
    h.engine.start();
    h.frame();
    // bedtime (yawn → drift → asleep → the care post) carries on from where it was
    expect(h.cues.some((c) => c.type === 'care')).toBe(false);
    h.run(6500);
    expect(h.cues.filter((c) => c.type === 'care')).toEqual([expect.objectContaining({ action: 'sleep' })]);
    // a reaction's own beats too: the souvenir bubble still waits for its moment
    const w = harness();
    w.engine.fire({ type: 'welcomeBack', souvenir: 'Shiraz!' });
    w.run(300);
    w.engine.stop();
    w.skip(10_000);
    w.engine.start();
    w.frame();
    expect(w.cues.some((c) => c.type === 'say')).toBe(false);
    w.run(900);
    expect(w.cues.some((c) => c.type === 'say')).toBe(true);
  });

  it('keeps a reply’s lip-sync across a pause (the audio pauses and resumes with it)', () => {
    const h = harness();
    h.engine.speakText('Hello there, how was your day today?', 28);
    h.run(300);
    h.engine.stop();
    h.skip(200);
    h.engine.start();
    h.run(3000);
    expect(h.cues.some((c) => c.type === 'spoken')).toBe(true);
  });

  it('ticks inside framer’s frame batch, so MotionValues render in the frame the tick wrote', () => {
    const update = vi.spyOn(framerFrame, 'update');
    const engine = createPetEngine({ look: PRESET_LOOKS[0], stage: 3, size: 200, tier: 'full', mood: CONTENT, activity: false, ambient: false });
    engine.start();
    engine.fire(sample('poke', 0));
    expect(update).toHaveBeenCalled();
    engine.dispose();
    update.mockRestore();
  });
});

describe('waking and the server', () => {
  it('every real wake from sleep posts a wake: two taps, the talk pill, a reply, the cookie, the ball', () => {
    const wakes = (act: (h: ReturnType<typeof harness>) => void) => {
      const h = harness({ mood: { ...CONTENT, asleep: true } });
      act(h);
      h.run(200);
      return h.cues.filter((c) => c.type === 'care' && c.action === 'wake').length;
    };
    expect(wakes((h) => h.engine.talk('listening'))).toBe(1);
    expect(wakes((h) => h.engine.speakText('Hi!'))).toBe(1);
    expect(wakes((h) => h.engine.toy({ type: 'cookieTap' }))).toBe(1);
    expect(wakes((h) => h.engine.toy({ type: 'ballTap', tired: true }))).toBe(1);
    // the server woke it (a new care state): nothing to post back
    expect(wakes((h) => h.engine.setMood(CONTENT))).toBe(0);
  });

  it('decides "too tired to play" from the care rule the page passes, not the mood band', () => {
    const droopyTired: Mood = { level: 'droopy', lowest: 'energy', tone: 'tired', asleep: false };
    const h = harness({ mood: droopyTired });
    h.engine.toy({ type: 'ballTap', tired: false });
    expect(h.cues.find((c) => c.type === 'care')).toMatchObject({ action: 'play' });
    const t = harness();
    t.engine.toy({ type: 'ballTap', tired: true });
    expect(t.cues.some((c) => c.type === 'care' && c.action === 'play')).toBe(false);
    expect(t.engine.debug.playing.some((p) => p.kind === 'playStart')).toBe(true);
  });
});

describe('parked DOM', () => {
  it('parks the particle pool, ball and cookie without a 3D transform; only live ones carry one', () => {
    const el = () => ({ style: {} as Record<string, string>, dataset: {} as Record<string, string> });
    const pool = Array.from({ length: 16 }, el), ball = el(), cookie = el();
    const h = harness();
    h.engine.attach({ particles: pool as never, ball: ball as never, cookie: cookie as never });
    for (const e of [...pool, ball, cookie]) expect(e.style).toMatchObject({ visibility: 'hidden', transform: 'none' });
    h.engine.fire({ type: 'celebrate', why: 'bond' });
    h.run(500);
    const live = pool.filter((e) => e.style.visibility === 'visible');
    expect(live.length).toBeGreaterThan(0);
    for (const e of live) expect(e.style.transform).toMatch(/^translate3d/);
    h.run(3000);
    for (const e of pool) expect(e.style).toMatchObject({ visibility: 'hidden', transform: 'none' });
    h.engine.toy({ type: 'cookieTap' });
    h.run(200);
    expect(cookie.style.transform).toMatch(/^translate3d/);
    h.run(1500);
    expect(cookie.style).toMatchObject({ visibility: 'hidden', transform: 'none' });
  });
});

describe('the end of a Bop round', () => {
  const ctx = (seed = 3) => {
    let s = seed;
    const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const last = new Map<string, number>();
    return { rng, species: 'cat' as const, family: 'puff' as const, stage: 4 as const, mood: CONTENT, tier: 'full' as const,
      variantHistory: { last, pick: (k: string, n: number) => { let v = Math.floor(rng() * n); if (v === last.get(k)) v = (v + 1) % n; last.set(k, v); return v; } } };
  };
  const exprs = (e: Parameters<typeof REACTIONS.playEnd>[0]) => REACTIONS.playEnd(e, ctx() as never).map((b) => b.expr).filter(Boolean);

  it('looks sad only after three misses; a round that ran out of time is a happy "that was fun"', () => {
    expect(exprs({ type: 'playEnd', bops: 2, won: false, misses: 3 })).toContain('sad');
    for (const misses of [0, 1, 2]) {
      const e = exprs({ type: 'playEnd', bops: 2, won: false, misses });
      expect(e).not.toContain('sad');
      expect(e).toContain('happy');
    }
    expect(REACTIONS.playEnd({ type: 'playEnd', bops: 1, won: false, misses: 0 }, ctx() as never).some((b) => b.hop)).toBe(true);
  });
});

describe('the page seams (integration)', () => {
  const tap = (h: ReturnType<typeof harness>, x: number, y: number, id: number) => {
    h.engine.pointer({ kind: 'down', id, x, y, t: h.t });
    h.frame();
    h.engine.pointer({ kind: 'up', id, x, y, t: h.t });
    h.run(400);
  };

  it('entering listening plays the perk exactly once, with the mic variant when the mic opened it', () => {
    const h = harness();
    h.engine.talk('listening', 'mic');
    expect(h.engine.debug.playing.filter((p) => p.kind === 'listen')).toHaveLength(1);
    h.engine.talk('listening', 'mic');
    expect(h.engine.debug.playing.filter((p) => p.kind === 'listen')).toHaveLength(1);
    h.engine.talk('thinking');
    expect(h.engine.debug.playing.filter((p) => p.kind === 'ack')).toHaveLength(1);
  });

  it('a moon tap during the hello is not lost: bedtime starts as soon as the hello ends', () => {
    const h = harness();
    h.engine.fire({ type: 'hello', firstName: 'Reza' });
    h.frame();
    h.engine.toy({ type: 'moonTap' });
    expect(h.engine.debug.playing.some((p) => p.kind === 'yawn')).toBe(false);
    h.run(6000);
    expect(h.cues.some((c) => c.type === 'care' && c.action === 'sleep')).toBe(true);
  });

  it('asleep, two taps anywhere on the stage wake it (the first gets "five more minutes")', () => {
    const h = harness({ mood: { ...CONTENT, asleep: true } });
    tap(h, 12, 40, 1);
    expect(h.cues.some((c) => c.type === 'say' && c.line === 'fiveMore')).toBe(true);
    tap(h, 370, 120, 2);
    expect(h.cues.some((c) => c.type === 'care' && c.action === 'wake')).toBe(true);
  });

  it('Bond milestones unlock signature fidgets in the long-fidget tier (never before one)', () => {
    /** Idle kinds played in the 30–90 s watch window (a doze ends it), over a few seeds. */
    const idleKinds = (bond: number) => {
      const kinds = new Set<string>();
      for (let seed = 1; seed <= 8; seed++) {
        let t = 0;
        const engine = createPetEngine({
          look: PRESET_LOOKS[0], stage: 3, size: 200, tier: 'full', mood: CONTENT, seed,
          clock: { now: () => t, raf: () => 1, caf: () => {} }, timers: { set: () => 1, clear: () => {} }, activity: false,
        });
        engine.setScene(SCENE);
        engine.setBond(bond);
        engine.start();
        for (; t < 95_000; t += 50) { engine.debug.tick(t); for (const p of engine.debug.playing) kinds.add(p.kind); }
      }
      return kinds;
    };
    expect(idleKinds(60).has('signature')).toBe(true);
    expect(idleKinds(20).has('signature')).toBe(false);
  });
});
