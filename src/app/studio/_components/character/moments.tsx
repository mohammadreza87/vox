'use client';

/**
 * Character moments (motion §4.6–4.10, §4.15, D11, D20): gestures, poof, stage-up, born, retire,
 * and the look-change choreography. Each is a short async timeline over the rig's MotionValues
 * and the HTML wrapper; `alive()` stops a timeline the moment a newer one starts.
 */

import type { DOMKeyframesDefinition, MotionValue } from 'framer-motion';
import { animate } from 'framer-motion';
import { lookKey, type DerivedPalette, type Expression } from '@/lib/studio/character';
import type { Accessory, CharacterLook, Stage } from '@/lib/studio/types';
import { haptic } from '../../_lib/haptics';
import { EASE, SPRING } from '../../_lib/motion';
import type { ParticleKind } from '../motion/Burst';
import { EVOLVE, HOP, SHY, SQUISH } from './poses';
import { blinkOnce, wait } from './rig';

export type Gesture = 'perk' | 'nod' | 'hop' | 'wince' | 'spin' | 'squash' | 'squish';

/** The rig parts a timeline may move. Distances are view-box units for SVG parts, px (× k) for the wrapper. */
export interface RigParts {
  lid: MotionValue<number>;
  counterY: MotionValue<number>;
  tilt: MotionValue<number>;
  gy: MotionValue<number>;
  hairS: MotionValue<number>; hairSY: MotionValue<number>; hairY: MotionValue<number>; hairO: MotionValue<number>;
  earS: [MotionValue<number>, MotionValue<number>]; earR: [MotionValue<number>, MotionValue<number>];
  accY: MotionValue<number>; accO: MotionValue<number>; accSY: MotionValue<number>;
  fxO: MotionValue<number>; fxY: MotionValue<number>;
  auraO: MotionValue<number>; auraS: MotionValue<number>;
  /** shy blush (opacity, scale about each cheek) and face glance (x) */
  shyO: MotionValue<number>; shyS: MotionValue<number>; gx: MotionValue<number>;
}

export interface RigCtx {
  el: () => HTMLElement | null;
  parts: RigParts;
  /** wrapper distance scale: 1 at 200 px */
  k: number;
  reduced: boolean;
  lite: boolean;
  /** aura opacity at rest */
  aura: number;
  palette: () => DerivedPalette;
  setExpr: (e: Expression | null) => void;
  setStage: (s: Stage | null) => void;
  /** swap the rendered look (choreography) */
  setLook: (l: CharacterLook) => void;
  /** hold a look for the rest of a moment (retire's ash), whatever the prop says */
  holdLook: (l: CharacterLook) => void;
  /** stop-colour tween length for the next palette change (s) */
  tweenFor: (s: number) => void;
  /** slow the next expression morph (s) */
  morphFor: (s: number) => void;
  /** the next stage change's growth (s; 0 = instant: a moment starting at an older stage) */
  growFor: (s: number) => void;
  burst: (kind: ParticleKind, at?: [number, number]) => void;
  sheen: () => void;
  wag: (ms: number) => void;
  alive: () => boolean;
}

/* ---------- wrapper gestures (motion §4.6): origin on the ground line ---------- */

type Kf = DOMKeyframesDefinition;
const GROUND_ORIGIN = '50% 83%';

function gesture(g: Gesture, k: number): [Kf, Record<string, unknown>] {
  switch (g) {
    case 'perk': return [{ y: [0, -4 * k, 0], scaleX: [1, 0.97, 1], scaleY: [1, 1.04, 1] }, { duration: 0.28, ease: EASE.enter }];
    case 'nod': return [{ y: [0, 3 * k, 0], scaleY: [1, 0.97, 1] }, { duration: 0.32, ease: 'easeInOut' }];
    case 'hop': return [{ y: HOP.y.map((v) => v * k), scaleX: [...HOP.sx], scaleY: [...HOP.sy] }, { duration: HOP.duration, times: [...HOP.times], ease: 'easeInOut' }];
    case 'wince': return [{ x: [0, -5 * k, 4 * k, -2 * k, 0], scaleY: [1, 0.96, 1] }, { duration: 0.36, ease: 'easeOut' }];
    case 'spin': return [{ scaleX: [1, 0.85, 1] }, { duration: 0.26, ease: EASE.standard }];
    case 'squash': return [{ scaleX: [1, 1.03, 1], scaleY: [1, 0.97, 1] }, { duration: 0.12, ease: 'easeOut' }];
    case 'squish': return [{ scaleX: [...SQUISH.sx], scaleY: [...SQUISH.sy], rotate: [...SQUISH.rot] }, { duration: SQUISH.duration, times: [...SQUISH.times], ease: 'easeInOut' }];
  }
}

/** Face counter-motion (rule 6): the face sinks 1.5 into a squash and lifts on a stretch. */
const COUNTER: Partial<Record<Gesture, number[]>> = { hop: [0, 1.5, -1.5, 1.5, -0.4, 0], perk: [0, -1.5, 0], nod: [0, 1.5, 0], squish: [0, 2, -1, 0.5, 0, 0, 0] };

export async function play(ctx: RigCtx, g: Gesture) {
  const el = ctx.el();
  if (!el || ctx.reduced) return;
  const [kf, t] = gesture(g, ctx.k);
  el.style.transformOrigin = GROUND_ORIGIN;
  el.style.willChange = 'transform';
  const counter = COUNTER[g];
  if (counter) void animate(ctx.parts.counterY, counter, t);
  await animate(el, kf, t);
  // even when cut short: a newer timeline sets its own hint, and a stale one must not linger
  el.style.willChange = '';
}

const AT_REST = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 } as const;

/** Puts the wrapper back at rest (a cancelled timeline, a cleared retire). */
export function rest(el: HTMLElement | null) {
  if (!el) return;
  void animate(el, { ...AT_REST, opacity: 1 }, { duration: 0 });
  el.style.willChange = '';
}

/**
 * Springs the wrapper home from wherever a cut-short timeline left it (a look change mid-squash).
 * Whatever the next timeline animates takes those values over; the rest settle instead of sticking.
 */
export function settle(el: HTMLElement | null, reduced: boolean) {
  if (!el) return;
  void animate(el, AT_REST, reduced ? { duration: 0 } : SPRING.snappy);
  el.style.willChange = '';
}

/* ---------- part choreography (motion §4.10) ---------- */

const HATS: ReadonlySet<Accessory> = new Set(['beret', 'cap', 'beanie', 'headphones', 'headset', 'bow', 'flower', 'star']);
const UNFURL: ReadonlySet<Accessory> = new Set(['bowtie']);

/** Parts start hidden at their pivots, ready to pop in after a swap. */
export function hideParts(p: RigParts, which: { ears?: boolean; hair?: boolean; acc?: Accessory | false }) {
  if (which.ears) { p.earS[0].set(0); p.earS[1].set(0); }
  if (which.hair) { p.hairSY.set(0); p.hairS.set(1); p.hairY.set(0); p.hairO.set(1); }
  if (which.acc) {
    p.accO.set(0);
    if (UNFURL.has(which.acc)) p.accSY.set(0); else p.accY.set(which.acc === 'glasses' || which.acc === 'specs' ? -8 : -24);
  }
}

/** New ears pop from their pivots (L then R, 60 ms apart) and settle their lean on the jelly spring. */
export async function earsIn(p: RigParts) {
  p.earR[0].set(-12); p.earR[1].set(12);
  void animate(p.earS[0], 1, SPRING.pop);
  void animate(p.earR[0], 0, SPRING.jelly);
  await wait(60);
  void animate(p.earS[1], 1, SPRING.pop);
  await animate(p.earR[1], 0, SPRING.jelly);
}
export const earsOut = (p: RigParts) => Promise.all(p.earS.map((s) => animate(s, 0, { duration: 0.14, ease: EASE.exit })));

/** Hair grows from its root (scaleY 0→1, jelly). */
export const hairIn = (p: RigParts) => animate(p.hairSY, 1, SPRING.jelly);
/** Old hair evaporates: shrinks, rises and fades in 160 ms. */
export async function hairOut(ctx: RigCtx, at?: [number, number]) {
  const p = ctx.parts;
  ctx.burst('puffs', at);
  await Promise.all([
    animate(p.hairS, 0.6, { duration: 0.16, ease: EASE.exit }),
    animate(p.hairY, -6, { duration: 0.16, ease: EASE.exit }),
    animate(p.hairO, 0, { duration: 0.16, ease: EASE.exit }),
  ]);
}
export const accOut = (p: RigParts) => Promise.all([
  animate(p.accO, 0, { duration: 0.12, ease: EASE.exit }), animate(p.accY, -8, { duration: 0.12, ease: EASE.exit }),
]);

/** Accessories keep cause and effect: hats drop and the body squashes; glasses slide down; scarves unfurl. */
export async function accIn(ctx: RigCtx, acc: Accessory) {
  const p = ctx.parts;
  void animate(p.accO, 1, { duration: 0.12, ease: EASE.enter });
  if (UNFURL.has(acc)) { await animate(p.accSY, 1, SPRING.jelly); return; }
  if (acc === 'glasses' || acc === 'specs') {
    // the eyes glance up at the frames as they arrive
    void animate(p.gy, -1.5, SPRING.snappy).then(() => wait(260)).then(() => animate(p.gy, 0, SPRING.snappy));
    await animate(p.accY, 0, SPRING.snappy);
    return;
  }
  void animate(p.gy, -1.5, SPRING.snappy).then(() => wait(200)).then(() => animate(p.gy, 0, SPRING.snappy));
  await animate(p.accY, 0, { ...SPRING.pop, velocity: 40 });
  if (HATS.has(acc) && ctx.alive()) await play(ctx, 'squash');
}

/** Restores every part to rest instantly. */
export function partsAtRest(p: RigParts) {
  for (const mv of [p.hairS, p.hairSY, p.hairO, p.earS[0], p.earS[1], p.accO, p.accSY]) { mv.stop(); mv.set(1); }
  for (const mv of [p.hairY, p.earR[0], p.earR[1], p.accY, p.counterY, p.fxY, p.shyO]) { mv.stop(); mv.set(0); }
}

/* ---------- touch (hero): tap = squish + giggle, long-press = shy ---------- */

/** Tap: the body squishes into the ground and rocks back with a giggle (happy arcs) that dies away. */
export async function squish(ctx: RigCtx) {
  if (ctx.reduced) return;
  haptic.light();
  ctx.setExpr('happy');
  const done = play(ctx, 'squish');
  await wait(SQUISH.giggleMs);
  if (ctx.alive()) ctx.setExpr(null);
  await done;
}

/** Long-press begins: the blush grows, the body shrinks into itself and the gaze drops aside. */
export function shyIn(ctx: RigCtx) {
  const el = ctx.el(), p = ctx.parts;
  if (ctx.reduced) { p.shyS.set(1); p.shyO.set(1); return; }
  haptic.soft();
  p.shyS.set(SHY.blushFrom);
  void animate(p.shyO, 1, { duration: 0.5, ease: EASE.enter });
  void animate(p.shyS, SHY.blushTo, { type: 'spring', visualDuration: 0.9, bounce: 0.2 });
  void animate(p.tilt, SHY.tilt, SPRING.gentle);
  void animate(p.gx, SHY.gx, SPRING.gentle);
  void animate(p.gy, SHY.gy, SPRING.gentle);
  void animate(p.lid, 0.82, { duration: 0.3 });
  if (el) { el.style.transformOrigin = GROUND_ORIGIN; void animate(el, { scaleX: SHY.body.sx, scaleY: SHY.body.sy }, SPRING.gentle); }
}

/** Long-press ends: the blush fades slowly, everything else springs home. */
export async function shyOut(ctx: RigCtx) {
  const el = ctx.el(), p = ctx.parts;
  if (ctx.reduced) { p.shyO.set(0); return; }
  void animate(p.tilt, 0, SPRING.gentle);
  void animate(p.gx, 0, SPRING.gentle);
  void animate(p.gy, 0, SPRING.gentle);
  void animate(p.lid, 1, { duration: 0.18 });
  // cut short, a newer timeline owns the wrapper; the face parts still come home
  if (el && ctx.alive()) void animate(el, { scaleX: 1, scaleY: 1 }, SPRING.pop);
  await Promise.all([animate(p.shyO, 0, { duration: 0.9, ease: EASE.standard }), animate(p.shyS, 1, { duration: 0.9, ease: EASE.standard })]);
}

/** The shy moment (lab, scripted beats): blush in, hold, out. */
export async function shy(ctx: RigCtx, hold = SHY.holdForMs) {
  shyIn(ctx);
  await wait(hold);
  await shyOut(ctx);
}

/* ---------- look change: squash-swap-stretch (D11) ---------- */

export interface LookDiff { structure: boolean; species: boolean; hair: boolean; accessory: boolean; hue: boolean; quiet: boolean; count: number }
export function diffLook(a: CharacterLook, b: CharacterLook): LookDiff {
  const species = (a.species ?? 'cloud') !== (b.species ?? 'cloud');
  const structure = species || a.family !== b.family;
  const hair = (a.hair ?? 'none') !== (b.hair ?? 'none');
  const accessory = (a.accessory ?? 'none') !== (b.accessory ?? 'none');
  const hue = a.hue !== b.hue;
  const quiet = lookKey(a) !== lookKey(b) && !structure && !hair && !accessory;
  return { structure, species, hair, accessory, hue, quiet, count: [structure, hair, accessory].filter(Boolean).length };
}

/**
 * Plays the change from what is on screen (`from`) to `to`, swapping the rendered look at the
 * low point so the eye never sees a pop. Hue and tones simply tween (300 ms, through the stops).
 */
export async function changeLook(ctx: RigCtx, from: CharacterLook, to: CharacterLook, d: LookDiff, stage: Stage) {
  const p = ctx.parts;
  const hasHair = (l: CharacterLook) => stage >= 3 && (l.hair ?? 'none') !== 'none';
  const acc = (l: CharacterLook) => (stage >= 4 && (l.accessory ?? 'none') !== 'none' ? l.accessory! : false);
  const newEars = d.species && (to.species ?? 'cloud') !== 'cloud' && stage >= 2;
  const newHair = d.hair && hasHair(to);
  const newAcc = d.accessory ? acc(to) : false;

  if (d.count >= 2) {
    // dice: one spin-squash hides every change at its narrowest moment, then all parts pop at once
    const el = ctx.el();
    if (el) { el.style.transformOrigin = GROUND_ORIGIN; await animate(el, { scaleX: 0.85 }, { duration: 0.13, ease: EASE.exit }); }
    if (!ctx.alive()) return;
    hideParts(p, { ears: newEars, hair: newHair, acc: newAcc });
    ctx.setLook(to);
    if (el) void animate(el, { scaleX: 1 }, SPRING.pop);
    haptic.soft();
    await Promise.all([newEars && earsIn(p), newHair && hairIn(p), newAcc && accIn(ctx, newAcc)]);
    return;
  }

  if (d.structure) {
    const el = ctx.el();
    if (el) el.style.transformOrigin = GROUND_ORIGIN;
    const squash = el ? animate(el, { scaleX: 1.08, scaleY: 0.9, y: 3 * ctx.k }, { duration: 0.16, ease: EASE.standard }) : null;
    void animate(p.counterY, 1.5, { duration: 0.16 });
    await Promise.all([squash, d.species && earsOut(p), d.hair && hasHair(from) && hairOut(ctx)]);
    if (!ctx.alive()) return;
    hideParts(p, { ears: newEars, hair: newHair, acc: false });
    ctx.setLook(to);
    if (el) {
      await animate(el, { scaleX: 0.95, scaleY: 1.06, y: -6 * ctx.k }, { duration: 0.14, ease: EASE.enter });
      // cut short, the next timeline owns the wrapper (it settles it home) — don't fight its squash
      if (ctx.alive()) void animate(el, { scaleX: 1, scaleY: 1, y: 0 }, SPRING.pop);
    }
    void animate(p.counterY, 0, SPRING.pop);
    await Promise.all([newEars && earsIn(p), newHair && wait(60).then(() => hairIn(p)), newAcc && accIn(ctx, newAcc)]);
    return;
  }

  if (d.hair) {
    if (hasHair(from)) await hairOut(ctx);
    if (!ctx.alive()) return;
    hideParts(p, { hair: newHair });
    ctx.setLook(to);
    if (newHair) { await wait(60); await hairIn(p); } else partsAtRest(p);
    return;
  }

  if (d.accessory) {
    if (acc(from)) await accOut(p);
    if (!ctx.alive()) return;
    hideParts(p, { acc: newAcc });
    ctx.setLook(to);
    if (newAcc) await accIn(ctx, newAcc); else partsAtRest(p);
    return;
  }

  ctx.setLook(to); // hue, tones, features: the stops tween, details swap
}

/* ---------- moments ---------- */

/** Entrance (motion §4.7): vapor bursts, the body pops out of it, wakes, then parts and smile arrive. */
export async function poof(ctx: RigCtx, hold = 1200) {
  const el = ctx.el(), p = ctx.parts;
  if (!el) return;
  if (ctx.reduced) { el.style.opacity = '0'; await animate(el, { opacity: [0, 1] }, { duration: 0.16 }); return; }
  // hidden before the first paint, then it condenses out of its own vapor
  el.style.opacity = '0';
  el.style.transformOrigin = GROUND_ORIGIN;
  el.style.willChange = 'transform, opacity';
  await animate(el, { scale: 0.2, y: 12 * ctx.k, opacity: 0 }, { duration: 0 });
  p.lid.set(0.08);
  hideParts(p, { ears: true, hair: true });
  p.accO.set(0); p.accY.set(-16);
  ctx.burst('vapor');
  await wait(80); if (!ctx.alive()) return;
  haptic.soft();
  await wait(40); if (!ctx.alive()) return;
  void animate(el, { scale: 1, y: 0 }, SPRING.pop);
  void animate(el, { opacity: 1 }, { duration: 0.12, ease: EASE.enter });
  await wait(140); if (!ctx.alive()) return;
  void animate(p.lid, 1, { duration: 0.09, ease: EASE.enter }).then(() => wait(90)).then(() => blinkOnce(p.lid)).then(() => wait(90)).then(() => blinkOnce(p.lid));
  await wait(160); if (!ctx.alive()) return;
  void animate(p.hairSY, 1, SPRING.jelly);
  p.earR[0].set(-20); p.earR[1].set(20);
  for (const i of [0, 1]) { void animate(p.earS[i], 1, SPRING.jelly); void animate(p.earR[i], 0, SPRING.jelly); }
  void animate(p.accO, 1, { duration: 0.1 });
  void animate(p.accY, 0, SPRING.pop);
  await wait(100); if (!ctx.alive()) return;
  ctx.setExpr('happy');
  haptic.success();
  await wait(380 + hold); if (!ctx.alive()) return;
  el.style.willChange = '';
  ctx.setExpr(null);
}

/**
 * Stage-up (motion §4.8): an inhale at the old size, then the body puffs up out of the old
 * silhouette (the rig tweens the body path and springs the stage growth) with sparkles and the new
 * parts unlocking, a soft landing squash, then a happy beat. Reduced motion cross-fades.
 */
export async function evolve(ctx: RigCtx, from: Stage, to: Stage) {
  const el = ctx.el(), p = ctx.parts;
  if (!el) return;
  ctx.morphFor(0); ctx.tweenFor(0); ctx.growFor(0);
  ctx.setStage(from);
  if (ctx.reduced) {
    await animate(el, { opacity: 0.35 }, { duration: 0.1 });
    ctx.setStage(null);
    await animate(el, { opacity: 1 }, { duration: 0.1 });
    return;
  }
  el.style.transformOrigin = GROUND_ORIGIN;
  el.style.willChange = 'transform';
  ctx.setExpr('idle');
  await wait(260); if (!ctx.alive()) return;
  // gather: a breath in at the old size, eyes squeezed
  haptic.rigid();
  void animate(el, { scaleX: EVOLVE.gather.sx, scaleY: EVOLVE.gather.sy, y: 0 }, { duration: 0.3, ease: EASE.standard });
  void animate(p.counterY, 1.5, { duration: 0.3 });
  void animate(p.lid, 0.35, { duration: 0.3 });
  if (ctx.aura > 0) { void animate(p.auraO, 0.9, SPRING.gentle); void animate(p.auraS, 1.25, SPRING.gentle); }
  await wait(320); if (!ctx.alive()) return;
  // puff: the new stage grows out of the old silhouette; its parts unlock from their pivots, 60 ms apart
  const ears = from < 2 && to >= 2, hair = from < 3 && to >= 3, acc = from < 4 && to >= 4;
  hideParts(p, { ears, hair, acc: acc ? 'cap' : false });
  ctx.growFor(EVOLVE.grow);
  ctx.setStage(null);
  void animate(el, { scaleX: EVOLVE.puff.sx, scaleY: EVOLVE.puff.sy, y: EVOLVE.puff.y * ctx.k }, { duration: 0.26, ease: EASE.enter });
  void animate(p.counterY, -1.5, { duration: 0.26 });
  void animate(p.lid, 1, { duration: 0.12, ease: EASE.enter });
  if (!ctx.lite) ctx.sheen();
  ctx.burst('sparkle');
  haptic.medium();
  void (async () => {
    await wait(120);
    if (ears) { void earsIn(p); await wait(60); }
    if (hair) { void hairIn(p); await wait(60); }
    if (acc) { void animate(p.accO, 1, { duration: 0.12 }); void animate(p.accY, 0, SPRING.pop); }
  })();
  await wait(440); if (!ctx.alive()) return;
  // settle: a soft landing squash, then rest on the pop spring
  await animate(el, { scaleX: EVOLVE.land.sx, scaleY: EVOLVE.land.sy, y: 0 }, { duration: 0.1, ease: EASE.exit });
  if (!ctx.alive()) return;
  void animate(el, { scaleX: 1, scaleY: 1, y: 0 }, SPRING.pop);
  void animate(p.counterY, 0, SPRING.pop);
  haptic.success();
  ctx.setExpr('happy');
  await wait(1100); if (!ctx.alive()) return;
  if (ctx.aura > 0) { void animate(p.auraO, ctx.aura, SPRING.gentle); void animate(p.auraS, 1, SPRING.gentle); }
  el.style.willChange = '';
  ctx.setExpr(null);
}

/** Hired (D20): a hop and burst at the designed stage-4 look, then a 1.2 s rewind to the newborn. */
export async function born(ctx: RigCtx, to: Stage) {
  const el = ctx.el(), p = ctx.parts;
  if (!el) return;
  if (ctx.reduced) { ctx.setStage(null); return; }
  ctx.morphFor(0); ctx.tweenFor(0); ctx.growFor(0);
  ctx.setStage(4);
  ctx.setExpr('happy');
  ctx.burst('hire');
  haptic.success();
  await play(ctx, 'hop'); if (!ctx.alive()) return;
  // rewind: each step exhales the body back into the smaller silhouette (the rig tweens it down) and
  // sheds a wisp as the features fade back
  const steps = ([3, 2, 1] as Stage[]).filter((s) => s >= to);
  for (const s of steps) {
    await wait(s === 3 ? 0 : 320); if (!ctx.alive()) return;
    ctx.tweenFor(0.4);
    ctx.growFor(0.34);
    void animate(el, { scaleX: [1, 1.03, 1], scaleY: [1, 0.95, 1] }, { duration: 0.32, ease: EASE.standard });
    void animate(p.lid, [1, 0.3, 1], { duration: 0.3 });
    ctx.setStage(s === to ? null : s);
    if (s === 1) ctx.burst('wisp');
  }
  if (!steps.length) ctx.setStage(null);
  await wait(500); if (!ctx.alive()) return;
  ctx.setExpr(null);
}

/**
 * Retired (motion §4.15): ash, ∪ eyes, a slow rise to .55 with wisps; no bounce and no haptic (the
 * fire itself was the one heavy beat). Holds its end pose while the moment stays.
 */
export async function retire(ctx: RigCtx, look: CharacterLook) {
  const el = ctx.el();
  if (!el) return;
  ctx.morphFor(0.6);
  ctx.setExpr('sleeping');
  ctx.tweenFor(ctx.reduced ? 0 : 1.2);
  ctx.holdLook({ ...look, hue: 'ash' });
  if (ctx.reduced) { await animate(el, { opacity: 0.55 }, { duration: 0 }); return; }
  ctx.burst('wisp');
  await animate(el, { y: -26 * ctx.k, opacity: 0.55 }, { duration: 2.4, ease: EASE.enter });
}

