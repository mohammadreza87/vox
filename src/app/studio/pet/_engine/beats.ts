/**
 * Beat preparation (brief §2.1, §2.9): what the loop does to a reaction's beats before it plays them. One time
 * factor (±12 %) and one amplitude factor (±15 %) per reaction from the seeded rng (not on `fixed` beats: the
 * chomp rhythm), species/family scaling of hops, landings and jelly, the volume rule sx = sy^(−α), the mood's
 * tempo, and the tier rules: lite drops hit-stops; reduced drops every translation, rotation, hop and
 * oscillation and plays what is left (scale, face, light) as 150 ms crossfades.
 */

import type { Stage } from '@/lib/studio/types';
import { stageMotion, weightTime } from './motion';
import { range } from './rng';
import { alphaFor, volumeSx, type Tuning } from './species';
import { presetKC } from './spring';
import { MULTIPLY, SPRINGS, springKC, TIER_BUDGET, type Beat, type Channel, type Hop, type Oscillation, type ParticleBurst, type PoseTargets, type Rng, type SpringPreset, type Tier } from './types';

export interface KC { k: number; c: number }
export interface PreparedBeat extends Beat {
  /** stiffness for the beat's channels (per-channel overrides in kcs) */
  kc: KC;
  kcs?: Partial<Record<Channel, KC>>;
  /** roughly when this beat's springs have arrived (ms after `at`) */
  settleMs: number;
}

/** Jitter limits (§2.1, Cozmo ranges). */
export const JITTER = { time: 0.12, amp: 0.15 } as const;
/** Reduced motion: every surviving beat is a short crossfade. */
export const CROSSFADE = springKC(0.15, 0);
/** Channels a reduced-motion beat never moves (translation, rotation, secondary swing). */
export const REDUCED_DROP: ReadonlySet<Channel> = new Set<Channel>(['x', 'y', 'rot', 'lean', 'headX', 'headY', 'headTilt', 'earL', 'earR', 'earDroop', 'tail', 'hair', 'acc']);
/** Channels whose values are levels, not amplitudes: never jittered. */
const LEVELS: ReadonlySet<Channel> = new Set<Channel>(['dim', 'glow', 'morph', 'fx', 'blush', 'mouthOpen', 'lidL', 'lidR', 'gazeX', 'gazeY', 'sparkle']);
/** Reduced motion keeps scale changes small (a crossfade, not a squash). */
const REDUCED_SCALE = 0.04;

export interface PrepareOpts {
  rng: Rng;
  tuning: Tuning;
  tier: Tier;
  /** mood tempo (droopy 0.85: a little slower) */
  tempo?: number;
  /** no jitter (tests, frame sheets of the bare timeline) */
  exact?: boolean;
  /**
   * the character's stage (§10.3, default 4): a wisp's beats land a little later and imprecisely on slower,
   * softer springs with tiny hops; a puff's springs bounce more. Stage 4 is the tuned baseline.
   */
  stage?: Stage;
}

const clampLevel = (c: Channel, v: number) => (c === 'lidL' || c === 'lidR' ? Math.max(0.05, v) : c === 'blush' || c === 'mouthOpen' || c === 'fx' || c === 'glow' || c === 'morph' || c === 'sparkle' ? Math.max(0, Math.min(1, v)) : v);

export function prepareBeats(beats: readonly Beat[], o: PrepareOpts): PreparedBeat[] {
  const sm = stageMotion(o.stage ?? 4);
  const tf = (o.exact ? 1 : range(o.rng, 1 - JITTER.time, 1 + JITTER.time)) / (o.tempo ?? 1);
  const af = o.exact ? 1 : range(o.rng, 1 - JITTER.amp - sm.ampJitter, 1 + JITTER.amp + sm.ampJitter);
  const reduced = o.tier === 'reduced';
  const budget = TIER_BUDGET[o.tier];
  const out: PreparedBeat[] = [];
  // play order is time order (a stable sort keeps same-time beats as written)
  const sorted = beats.map((b, i) => [b, i] as const).sort((x, y) => x[0].at - y[0].at || x[1] - y[1]).map(([b]) => b);
  let prevAt = 0;
  for (const b of sorted) {
    const t = b.fixed ? 1 : tf * sm.time, a = b.fixed ? 1 : af;
    const target: Partial<PoseTargets> = {};
    for (const [c, v0] of Object.entries(b.target) as Array<[Channel, number]>) {
      if (reduced && REDUCED_DROP.has(c)) continue;
      // a wisp squashes and stretches a little less deep (its springs are softer too)
      const sq = c === 'sx' || c === 'sy' ? a * sm.squash : a;
      const v = LEVELS.has(c) ? v0 : MULTIPLY.has(c) ? 1 + (v0 - 1) * sq : v0 * a;
      target[c] = clampLevel(c, v);
    }
    // the volume rule: a squash or stretch on sy alone keeps its volume; a pair written volume-true stays so after
    // the jitter (sx leads, sy follows)
    const al = alphaFor(o.tuning, b.springs?.sy ?? b.spring);
    if (target.sy !== undefined && b.target.sx === undefined) target.sx = volumeSx(target.sy, al);
    else if (target.sx !== undefined && target.sy !== undefined && b.target.sx !== b.target.sy && b.target.sy !== 1 && b.target.sx !== 1
      && Math.abs((b.target.sx ?? 1) * Math.pow(b.target.sy ?? 1, al) - 1) < 0.02) target.sy = Math.pow(target.sx, -1 / al);
    if (reduced) for (const c of ['sx', 'sy'] as const) if (target[c] !== undefined) target[c] = 1 + Math.max(-REDUCED_SCALE, Math.min(REDUCED_SCALE, target[c]! - 1));
    // imprecision (a wisp): each beat lands a little off its mark, never before the one ahead of it
    let at = Math.round(b.at * t);
    if (sm.scatterMs && !b.fixed && !o.exact && at > 0) at = Math.max(prevAt, at + Math.round(range(o.rng, -sm.scatterMs, sm.scatterMs)));
    prevAt = at;
    const sp = b.fixed ? 1 : sm.spring;
    const prepared: PreparedBeat = { ...b, at, target, kc: kcFor(b.spring, t, sp, o.tuning, reduced, sm.bounce), settleMs: SPRINGS[b.spring].visualDuration * 1000 * t * feel(b.spring, sp, o.tuning) };
    if (b.springs) {
      prepared.kcs = {};
      for (const [c, p] of Object.entries(b.springs) as Array<[Channel, SpringPreset]>) prepared.kcs[c] = kcFor(p, t, sp, o.tuning, reduced, sm.bounce);
    }
    if (b.hop) {
      const hop: Hop = { h: b.hop.h * o.tuning.hop * a * sm.hop, land: (b.hop.land ?? 0.12) * o.tuning.land * (0.6 + 0.4 * sm.squash) };
      if (reduced) { delete prepared.hop; mergeTarget(prepared, { sy: 1 + REDUCED_SCALE * 0.75 }); } else prepared.hop = hop;
    }
    if (b.osc) {
      if (reduced) delete prepared.osc;
      else prepared.osc = (Array.isArray(b.osc) ? b.osc : [b.osc]).map((x): Oscillation => ({ ...x, amp: x.amp * a, ms: x.ms * t, hz: x.hz / t }));
    }
    if (b.gulp !== undefined) { if (reduced) delete prepared.gulp; else prepared.gulp = b.gulp * t; }
    if (b.hitStop !== undefined) { if (budget.hitStop) prepared.hitStop = b.hitStop; else delete prepared.hitStop; }
    if (b.particles) prepared.particles = particlesFor(b.particles, o.tier);
    if (reduced && b.look === 'away') delete prepared.look;
    out.push(prepared);
  }
  return out;
}

/**
 * The felt duration factor of a spring: the stage's (a wisp is slower) times the weight's (§10.2: heavy settles
 * slower, light flicks faster), held to 0.85–1.12 so no species on any stage leaves its reaction's ±20 % budget.
 */
const feel = (p: SpringPreset, stage: number, tuning: Tuning) => Math.min(1.12, Math.max(0.85, stage * weightTime(p, tuning.weight)));

/** A beat's spring: the preset at the beat's time scale, the felt weight and stage, and the stage's bounce. */
function kcFor(p: SpringPreset, t: number, stage: number, tuning: Tuning, reduced: boolean, bounce = 1): KC {
  if (reduced) return CROSSFADE;
  return presetKC(p, t * feel(p, stage, tuning), (p === 'jelly' ? tuning.jelly : 1) * bounce);
}

function mergeTarget(b: PreparedBeat, t: Partial<PoseTargets>) { b.target = { ...t, ...b.target }; }

/** Particle counts by tier: lite halves them (max 6 live); reduced motion has none (§10.8). */
export function particlesFor(p: ParticleBurst | ParticleBurst[], tier: Tier): ParticleBurst[] {
  const list = Array.isArray(p) ? p : [p];
  if (tier === 'reduced') return [];
  if (tier === 'lite') return list.map((x) => ({ ...x, n: Math.max(1, Math.min(TIER_BUDGET.lite.particles, Math.round(x.n * 0.5))) }));
  return list;
}

/** When a prepared timeline has played out: the last moment any beat's springs are still travelling. */
export const timelineEnd = (beats: readonly PreparedBeat[]) => beats.reduce((m, b) => Math.max(m, b.at + b.settleMs * 0.8 + (b.hitStop ?? 0) + oscMs(b) + hopMs(b), b.at + (b.gulp ?? 0)), 0);
const oscMs = (b: Beat) => (b.osc ? Math.max(...(Array.isArray(b.osc) ? b.osc : [b.osc]).map((o) => o.ms)) : 0);
const hopMs = (b: Beat) => (b.hop ? 2 * Math.sqrt((2 * b.hop.h) / 2400) * 1000 + 160 : 0);
