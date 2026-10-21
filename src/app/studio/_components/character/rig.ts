'use client';

/**
 * The character rig's motion (motion §4): blink, gaze, tilt, ear twitch, expression morph and
 * lip-sync. Everything here writes MotionValues, never React state, so a living character costs no
 * re-renders. Timers check the page and the viewport at fire time instead of subscribing to them.
 */

import { animate, motionValue, type MotionValue } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { EyeShape, MouthShape } from '@/lib/studio/character';
import { EASE, SPRING } from '../../_lib/motion';
import { pageActive } from '../motion/activity';

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- morphable face shapes: one MotionValue per numeric field ---------- */

export type EyeMV = Record<'w' | 't' | 'b' | 'dx' | 'dy', MotionValue<number>>;
export type MouthMV = Record<'w' | 'lift' | 'u' | 'l' | 'dx', MotionValue<number>>;
const eyeVec = (e: EyeShape) => ({ w: e.w, t: e.t, b: e.b, dx: e.dx ?? 0, dy: e.dy ?? 0 });
const mouthVec = (m: MouthShape) => ({ w: m.w, lift: m.lift, u: m.u, l: m.l, dx: m.dx ?? 0 });

function useMVs<K extends string>(init: () => Record<K, number>): Record<K, MotionValue<number>> {
  const ref = useRef<Record<K, MotionValue<number>> | null>(null);
  if (!ref.current) ref.current = Object.fromEntries(Object.entries(init()).map(([k, v]) => [k, motionValue(v as number)])) as Record<K, MotionValue<number>>;
  return ref.current;
}
export const useEyeMV = (e: EyeShape): EyeMV => useMVs(() => eyeVec(e));
export const useMouthMV = (m: MouthShape): MouthMV => useMVs(() => mouthVec(m));
export const readEye = (m: EyeMV): EyeShape => ({ w: m.w.get(), t: m.t.get(), b: m.b.get(), dx: m.dx.get(), dy: m.dy.get() });
export const readMouth = (m: MouthMV): MouthShape => ({ w: m.w.get(), lift: m.lift.get(), u: m.u.get(), l: m.l.get(), dx: m.dx.get() });

/** Tween every field to the target (default 220 ms standard); `instant` snaps (reduced motion, first frame). */
export function morphTo<K extends string>(mvs: Record<K, MotionValue<number>>, target: Record<K, number>, o: { instant?: boolean; duration?: number } = {}) {
  for (const k of Object.keys(target) as K[]) {
    const mv = mvs[k];
    if (!mv) continue;
    if (o.instant) { mv.stop(); mv.set(target[k]); } else animate(mv, target[k], { duration: o.duration ?? 0.22, ease: EASE.standard });
  }
}
export const morphEye = (m: EyeMV, e: EyeShape, o?: { instant?: boolean; duration?: number }) => morphTo(m, eyeVec(e), o);
export const morphMouth = (m: MouthMV, s: MouthShape, o?: { instant?: boolean; duration?: number }) => morphTo(m, mouthVec(s), o);

/* ---------- blink ---------- */

/** One blink: close 60 ms (ease-in), hold 30, open 90 (ease-out); lids reach .08. Slow blinks close in 160 ms. */
export async function blinkOnce(lid: MotionValue<number>, slow = false) {
  await animate(lid, 0.08, { duration: slow ? 0.16 : 0.06, ease: [0.4, 0, 1, 1] });
  await animate(lid, 1, { duration: 0.09, delay: 0.03, ease: [0, 0, 0.2, 1] });
}

export interface BlinkOpts {
  on: boolean;
  /** seconds between blinks */
  every: [number, number];
  doubles?: number;
  slow?: number;
  /** read at fire time: skip while off screen */
  visible?: { current: boolean };
}

/** Random blink (motion §4.3): never on a fixed beat, sometimes double, skipped while hidden or off screen. */
export function useBlink(lid: MotionValue<number>, { on, every, doubles = 0, slow = 0, visible }: BlinkOpts) {
  const [lo, hi] = every;
  useEffect(() => {
    if (!on) { lid.set(1); return; }
    let t: ReturnType<typeof setTimeout>;
    let live = true;
    const loop = () => {
      t = setTimeout(async () => {
        if (!live) return;
        if (pageActive() && visible?.current !== false && lid.get() > 0.9) {
          await blinkOnce(lid, Math.random() < slow);
          if (live && Math.random() < doubles) { await wait(80); if (live) await blinkOnce(lid); }
        }
        if (live) loop();
      }, rand(lo, hi) * 1000);
    };
    loop();
    return () => { live = false; clearTimeout(t); };
  }, [lid, on, lo, hi, doubles, slow, visible]);
}

/* ---------- gaze, tilt, ear twitch (hero only) ---------- */

const SACCADE = { type: 'spring', visualDuration: 0.12, bounce: 0 } as const;

/**
 * Rare gaze drift: every 3.5–8 s the face glances ±2.5 x / ±1.5 y (view-box units) and comes home
 * the next time (a calm face looks at you most of the time); 1 in 5 glances brings a blink.
 */
export function useGaze(gx: MotionValue<number>, gy: MotionValue<number>, lid: MotionValue<number>, on: boolean, visible?: { current: boolean }) {
  useEffect(() => {
    if (!on) { animate(gx, 0, SACCADE); animate(gy, 0, SACCADE); return; }
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (pageActive() && visible?.current !== false) {
          const home = gx.get() !== 0 || gy.get() !== 0;
          animate(gx, home ? 0 : rand(-2.5, 2.5), SACCADE);
          animate(gy, home ? 0 : rand(-1.5, 1.2), SACCADE);
          if (!home && Math.random() < 1 / 5 && lid.get() > 0.9) void blinkOnce(lid);
        }
        loop();
      }, gx.get() !== 0 || gy.get() !== 0 ? rand(900, 1800) : rand(3500, 8000));
    };
    loop();
    return () => clearTimeout(t);
  }, [gx, gy, lid, on, visible]);
}

/**
 * Thinking: the eyes already glance up toward the thought puffs (face kit); every 1.4–2.8 s the face
 * swings to look up the other side and back, a slow "hmm". Writes `gx` only; home when off.
 */
export function useGlance(gx: MotionValue<number>, on: boolean, visible?: { current: boolean }, reach = 3.2) {
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    let away = false;
    const loop = () => {
      t = setTimeout(() => {
        if (pageActive() && visible?.current !== false) {
          away = !away;
          animate(gx, away ? -reach : 0, { type: 'spring', visualDuration: 0.34, bounce: 0.1 });
        }
        loop();
      }, rand(1400, 2800));
    };
    loop();
    return () => { clearTimeout(t); animate(gx, 0, SACCADE); };
  }, [gx, on, visible, reach]);
}

/** Stage 4 only: every 8–14 s the head tilts ±3° on the gentle spring, holds 1.2 s, comes back. */
export function useTilt(rot: MotionValue<number>, on: boolean, visible?: { current: boolean }) {
  useEffect(() => {
    if (!on) { animate(rot, 0, SPRING.gentle); return; }
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (pageActive() && visible?.current !== false && rot.get() === 0) {
          void animate(rot, (Math.random() < 0.5 ? -1 : 1) * rand(2, 3), SPRING.gentle)
            .then(() => wait(1200)).then(() => animate(rot, 0, SPRING.gentle));
        }
        loop();
      }, rand(8000, 14000));
    };
    loop();
    return () => clearTimeout(t);
  }, [rot, on, visible]);
}

/** Pointed ears are still, then twitch: one ear to 14° in 70 ms, back on the jelly spring (6–12 s apart). */
export function useTwitch(ears: [MotionValue<number>, MotionValue<number>], on: boolean, visible?: { current: boolean }) {
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    let live = true;
    const loop = () => {
      t = setTimeout(async () => {
        if (!live) return;
        if (pageActive() && visible?.current !== false) {
          const side = Math.random() < 0.5 ? 0 : 1;
          const ear = ears[side];
          await animate(ear, side ? 14 : -14, { duration: 0.07, ease: EASE.exit });
          // cut short (unmount, or the face stopped being calm): settle back unless something else now drives the ear
          if (live || !ear.isAnimating()) animate(ear, 0, SPRING.jelly);
        }
        if (live) loop();
      }, rand(6000, 12000));
    };
    loop();
    return () => { live = false; clearTimeout(t); };
  }, [ears, on, visible]);
}

/* ---------- lip-sync ---------- */

/** Mouth openness from an audio level (0..1): gate the noise floor, then a soft knee. */
export const openFromLevel = (level: number) => clamp01((level - 0.02) / 0.18) ** 0.6;

/** ≈5 syllables/s with phrase gaps: still beats a fixed loop when no audio level is available. */
export function syllables(t: number): number {
  const s = Math.sin(t * 2 * Math.PI * 4.6) * 0.5 + Math.sin(t * 7.3) * 0.35 + 0.2;
  const phrase = Math.sin(t * 0.85) > -0.7 ? 1 : 0.08;
  return clamp01(s) * phrase;
}

/**
 * Envelope follower (attack τ 35 ms, release τ 110 ms) from `level` into `open`; the procedural
 * syllables stand in when there is no level. Lite devices sample at 30 fps. Writes a MotionValue only.
 */
export function useLipSync(level: MotionValue<number> | undefined, active: boolean, open: MotionValue<number>, lite = false) {
  useEffect(() => {
    if (!active) { animate(open, 0, { duration: 0.11, ease: EASE.standard }); return; }
    let raf = 0, last = performance.now(), env = open.get(), t = 0, acc = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(64, Math.max(0, now - last));
      last = now;
      if (!pageActive()) return;
      acc += dt; t += dt / 1000;
      if (lite && acc < 33) return;
      const step = acc; acc = 0;
      const target = level ? openFromLevel(level.get()) : syllables(t);
      env += (target - env) * (1 - Math.exp(-step / (target > env ? 35 : 110)));
      open.set(env);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, active, open, lite]);
}

export interface OnsetOpts { rise: number; floor: number; gap: number; rearm: number }

/**
 * Syllable onsets from the mouth envelope: a rise of `rise` above the last trough that reaches `floor`,
 * at least `gap` ms after the last onset. After firing it waits for the envelope to fall `rearm` below
 * its peak, so one long vowel never bounces twice. Pure: feed it (value, ms), it answers "bounce now".
 */
export function onsetDetector(o: OnsetOpts) {
  let low = Infinity, peak = 0, armed = true, last = -Infinity;
  return (v: number, now: number): boolean => {
    if (!armed) {
      peak = Math.max(peak, v);
      if (v < peak - o.rearm) { armed = true; low = v; }
      return false;
    }
    low = Math.min(low, v);
    if (v - low >= o.rise && v >= o.floor && now - last >= o.gap) {
      armed = false; peak = v; last = now;
      return true;
    }
    return false;
  };
}

/**
 * Speaking bounce: on every syllable onset of `open`, `bump` kicks to 1 in 70 ms and falls back on a
 * springy release. Subscribes to the MotionValue (no React state); stops and rests when inactive.
 */
export function useSyllableBounce(open: MotionValue<number>, bump: MotionValue<number>, active: boolean, o: OnsetOpts) {
  const { rise, floor, gap, rearm } = o;
  useEffect(() => {
    if (!active) { animate(bump, 0, SPRING.gentle); return; }
    const hit = onsetDetector({ rise, floor, gap, rearm });
    let live = true;
    const off = open.on('change', (v) => {
      if (!hit(v, performance.now())) return;
      void animate(bump, 1, { duration: 0.07, ease: EASE.enter }).then(() => { if (live) animate(bump, 0, { type: 'spring', visualDuration: 0.26, bounce: 0.35 }); });
    });
    return () => { live = false; off(); };
  }, [open, bump, active, rise, floor, gap, rearm]);
}

/* ---------- hero budget: at most two full rigs at a time (motion §4.2) ---------- */

export const MAX_HERO_RIGS = 2;
const heroQueue: object[] = [];
const heroListeners = new Set<() => void>();
const emitHero = () => { for (const l of heroListeners) l(); };
const subscribeHero = (l: () => void) => { heroListeners.add(l); return () => { heroListeners.delete(l); }; };

/** True while this component holds one of the hero slots; extra hero rigs run at card LOD until one frees. */
export function useHeroSlot(want: boolean): boolean {
  const token = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!want) return;
    const t = {};
    token.current = t;
    heroQueue.push(t);
    emitHero();
    return () => {
      const i = heroQueue.indexOf(t);
      if (i >= 0) heroQueue.splice(i, 1);
      token.current = null;
      emitHero();
    };
  }, [want]);
  return useSyncExternalStore(subscribeHero, () => {
    const i = token.current ? heroQueue.indexOf(token.current) : -1;
    return i >= 0 && i < MAX_HERO_RIGS;
  }, () => false);
}

/* ---------- viewport: one shared observer, no React state ---------- */

const watched = new Map<Element, (inView: boolean) => void>();
let observer: IntersectionObserver | null = null;
function io(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver((entries) => { for (const e of entries) watched.get(e.target)?.(e.isIntersecting); }, { rootMargin: '64px' });
  return observer;
}

/**
 * Tracks whether the element is near the viewport (64 px margin) in a ref, and mirrors it to
 * `data-off` so CSS loops pause off screen. Timers read the ref when they fire.
 */
export function useOnScreen(el: { current: HTMLElement | null }): { current: boolean } {
  const vis = useRef(true);
  useEffect(() => {
    const node = el.current, obs = io();
    if (!node || !obs) return;
    watched.set(node, (v) => { vis.current = v; node.toggleAttribute('data-off', !v); });
    obs.observe(node);
    return () => { obs.unobserve(node); watched.delete(node); };
  }, [el]);
  return vis;
}
