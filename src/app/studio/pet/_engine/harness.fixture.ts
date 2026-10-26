/**
 * A pet engine on a fake clock for tests: 60 Hz frames run only when requested, timers only when due, the motion
 * extras chunk already loaded, the engine and motion cues recorded with their times. Deterministic under the
 * seeded rng.
 */

import type { Mood } from '@/lib/pet/types';
import { PRESET_LOOKS } from '@/lib/studio/character';
import type { Stage } from '@/lib/studio/types';
import type { EngineCue } from '../_ui/contract';
import * as motionExtras from './extras';
import { createPetEngine } from './loop';
import type { MotionCue, Tier } from './types';

export const CONTENT: Mood = { level: 'content', lowest: 'joy', tone: 'content', asleep: false };
export const SCENE = {
  character: { x: 95, y: 200, size: 200 },
  toys: { cookie: { x: 80, y: 640 }, ball: { x: 195, y: 640 }, moon: { x: 310, y: 640 } },
  pill: { x: 195, y: 720 }, viewport: { w: 390, h: 800 },
};

export function harness(o: { tier?: Tier; stage?: Stage; seed?: number; ambient?: boolean; look?: number; mood?: Mood; exact?: boolean } = {}) {
  let t = 1000, id = 0;
  const raf = new Map<number, (t: number) => void>();
  const timers = new Set<{ at: number; fn: () => void }>();
  const motion: Array<MotionCue & { at: number }> = [];
  const cues: Array<EngineCue & { at: number }> = [];
  const engine = createPetEngine({
    look: PRESET_LOOKS[o.look ?? 3], stage: o.stage ?? 4, size: 200, tier: o.tier ?? 'full', mood: o.mood ?? CONTENT, seed: o.seed ?? 5,
    onCue: (c) => cues.push({ ...c, at: t }),
    clock: { now: () => t, raf: (cb) => { raf.set(++id, cb); return id; }, caf: (i) => { raf.delete(i); } },
    timers: { set: (fn, ms) => { const h = { at: t + ms, fn }; timers.add(h); return h; }, clear: (h) => { timers.delete(h as never); } },
    ambient: o.ambient ?? false, activity: false, followOS: false, motionExtras, exact: o.exact,
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
  /** Engine internals tests may read (the lip-sync output, the extras host). */
  const inner = engine as unknown as { lipOut: { open: number }; currentMouth(): string };
  return { engine, motion, cues, frame, run, idle, inner, get t() { return t; } };
}
export type Harness = ReturnType<typeof harness>;
