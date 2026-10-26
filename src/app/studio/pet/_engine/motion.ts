/**
 * The motion vocabulary around the reactions (design §10.2–§10.8, §3.1): what changes with the stage (a wisp
 * moves softly and imprecisely, a puff gains bounce, a shaped character gains eye lead and gestures, a formed one
 * the full set), the felt weight, the frame-budget guard that steps a slow device down a tier, and `polish`: the principles every reaction gets on
 * its way to the player (anticipation before a hop, one overshoot on idle beats). Pure data and pure functions.
 */

import type { Stage } from '@/lib/studio/types';
import type { Beat, Oscillation, PriorityClass, SpringPreset, Tier } from './types';

/* ---------- per-stage vocabulary (§10.3) ---------- */

export interface StageMotion {
  /** beat times × (a wisp's reactions unfold a little slower) */
  time: number;
  /** spring durations × (slow springs on a wisp, snappier on a formed one) */
  spring: number;
  /** spring bounce × (a puff gains bounce) */
  bounce: number;
  /** hop heights × (a wisp only makes tiny hops) */
  hop: number;
  /** squash and stretch depth × */
  squash: number;
  /** imprecision: each beat lands up to ± this many ms off its mark (never reordered), amplitude jitter ± this */
  scatterMs: number;
  ampJitter: number;
  /** how far the eyes lead the head (ms range); near 0 reads as the head and eyes moving together */
  lead: readonly [number, number];
  /** tiny eye darts inside a long look */
  darts: boolean;
  /** chance of a blink on a big head turn */
  turnBlink: number;
  /** signature fidgets (Bond milestones and lit moments) */
  signatures: boolean;
  /** at least this share of blinks are slow */
  slowBlinks: number;
}

export const STAGE_MOTION: Readonly<Record<Stage, StageMotion>> = {
  1: { time: 1.06, spring: 1.12, bounce: 0.8, hop: 0.4, squash: 0.75, scatterMs: 40, ampJitter: 0.1, lead: [0, 15], darts: false, turnBlink: 0.25, signatures: false, slowBlinks: 0.3 },
  2: { time: 1.04, spring: 1.08, bounce: 1.15, hop: 0.8, squash: 0.95, scatterMs: 15, ampJitter: 0.05, lead: [15, 35], darts: false, turnBlink: 0.4, signatures: false, slowBlinks: 0.12 },
  3: { time: 1.02, spring: 1.04, bounce: 1.05, hop: 0.95, squash: 1, scatterMs: 0, ampJitter: 0, lead: [60, 80], darts: true, turnBlink: 1, signatures: false, slowBlinks: 0 },
  4: { time: 1, spring: 1, bounce: 1, hop: 1, squash: 1, scatterMs: 0, ampJitter: 0, lead: [60, 80], darts: true, turnBlink: 1, signatures: true, slowBlinks: 0 },
};
export const stageMotion = (s: Stage | number): StageMotion => STAGE_MOTION[Math.min(4, Math.max(1, Math.round(s))) as Stage];

/* ---------- weight (§10.2 "weight"): heavier settles slower, lighter flicks faster ---------- */

const SETTLE_SPRINGS: ReadonlySet<SpringPreset> = new Set<SpringPreset>(['pop', 'jelly', 'float', 'sleepy']);
/** Duration factor for a preset at a felt weight: settles by weight^0.5, flicks (eye, snap) by weight^0.25. */
export const weightTime = (p: SpringPreset, weight: number) => (weight === 1 ? 1 : Math.pow(weight, SETTLE_SPRINGS.has(p) ? 0.5 : 0.25));

/** Tier order: the lower of two tiers (a reduced choice always wins). */
const TIER_RANK: Record<Tier, number> = { full: 2, lite: 1, reduced: 0 };
export const lowerTier = (a: Tier, b: Tier): Tier => (TIER_RANK[a] <= TIER_RANK[b] ? a : b);

/* ---------- polish: principles applied to every reaction on its way to the player ---------- */

/** A hop with no crouch this close before it gets one (anticipation, §10.2). */
const ANTICIPATE = { lookBackMs: 180, leadMs: 80, chainMs: 450, deep: 0.97 } as const;
/** The crouch deepens with the hop (a 4 px hop dips to 0.965, a 20 px one to 0.92); the takeoff stretches 60 % of it. */
const crouchFor = (h: number) => 1 - Math.min(0.08, 0.02 + h * 0.003);
/** Idle beats: one overshoot, then rest; no jiggle longer than this (§10.2 "settle"). */
const IDLE_JIGGLE_MS = 600;

/**
 * Anticipation and settle rules over a reaction's beats (pure; the input is not mutated):
 * - every hop starts from a crouch: when nothing in the 180 ms before it squashes the body, a crouch lands 80 ms
 *   ahead (the hop moves back to 80 ms when it was sooner) and the takeoff stretches;
 * - idle-class beats settle with one overshoot: `jelly` becomes `pop`, and their sx/sy jiggles end by 600 ms.
 */
export function polish(beats: readonly Beat[], cls: PriorityClass): Beat[] {
  const out = beats.map((b) => ({ ...b }));
  const extra: Beat[] = [];
  for (const b of out) {
    if (!b.hop || b.hop.h < 2) continue;
    const crouched = out.some((o) => o !== b && o.at <= b.at && o.at >= b.at - ANTICIPATE.lookBackMs && (o.target.sy ?? 1) <= ANTICIPATE.deep);
    // a hop chained onto another takes off from that one's landing squash (the loop queues it): no extra crouch
    const chained = out.some((o) => o !== b && o.hop && o.at < b.at && b.at - o.at < ANTICIPATE.chainMs);
    if (crouched || chained) continue;
    const c = crouchFor(b.hop.h);
    if (b.at < ANTICIPATE.leadMs) b.at = ANTICIPATE.leadMs;
    extra.push({ at: b.at - ANTICIPATE.leadMs, target: { sy: c }, spring: 'snap', fixed: b.fixed });
    if (b.target.sy === undefined || b.target.sy === 1) b.target = { ...b.target, sy: 1 + (1 - c) * 0.6 };
  }
  if (cls === 'idle') {
    for (const b of out) {
      if (b.spring === 'jelly') b.spring = 'pop';
      if (b.release === 'jelly') b.release = 'pop';
      if (b.osc) b.osc = (Array.isArray(b.osc) ? b.osc : [b.osc]).map((o): Oscillation => (o.channel === 'sx' || o.channel === 'sy' ? { ...o, ms: Math.min(o.ms, IDLE_JIGGLE_MS) } : o));
    }
  }
  if (!extra.length) return out;
  // keep the release on the last beat in time order
  const all = [...out, ...extra].sort((a, b) => a.at - b.at);
  const release = out.find((b) => b.release)?.release;
  for (const b of all) delete b.release;
  if (release) all[all.length - 1].release = release;
  return all;
}
