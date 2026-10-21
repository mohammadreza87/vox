/**
 * Beat helpers for the reactions: tiny constructors so each row of the reaction table (brief §2.6) reads like its
 * spec. Pure; randomness only through ctx.rng, variants only through ctx.variantHistory.
 */

import { tuningFor } from '../species';
import type { Anchor, Beat, Channel, HapticKind, Oscillation, ParticleBurst, ParticleKind, PoseTargets, ReactionCtx, ReactionKind, SpringPreset } from '../types';

export type Extra = Omit<Beat, 'at' | 'target' | 'spring'>;

export const beat = (at: number, target: Partial<PoseTargets>, spring: SpringPreset = 'pop', extra: Extra = {}): Beat => ({ at, target, spring, ...extra });
/** A side-effect-only beat (face, gaze, words, haptics) that moves nothing. */
export const cue = (at: number, extra: Extra): Beat => ({ at, target: {}, spring: 'pop', ...extra });

/** Variant index in [0, n), never the same as last time for this kind. */
export const variant = (ctx: ReactionCtx, kind: ReactionKind, n = 3) => ctx.variantHistory.pick(kind, n);
export const rr = (ctx: ReactionCtx, a: number, b: number) => a + ctx.rng() * (b - a);
export const coin = (ctx: ReactionCtx, p = 0.5) => ctx.rng() < p;
export const side = (ctx: ReactionCtx): -1 | 1 => (ctx.rng() < 0.5 ? -1 : 1);

/** The species/family α (volume rule) for beats that squash along x: sy = sx^(−1/α). */
export const alpha = (ctx: ReactionCtx) => tuningFor(ctx.species, ctx.family).alpha;
export const squashX = (ctx: ReactionCtx, sx: number): Partial<PoseTargets> => ({ sx, sy: Math.pow(sx, -1 / alpha(ctx)) });

export const osc = (channel: Channel, amp: number, hz: number, ms: number, decay = true): Oscillation => ({ channel, amp, hz, ms, decay });
export const burst = (kind: ParticleKind, n: number, at: Anchor = 'head'): ParticleBurst => ({ kind, n, at });

/** The species' ears answer: true when there are ear groups to move. */
export const eared = (ctx: ReactionCtx) => ctx.species !== 'cloud';
/** Dot-eyed stages skip brow and pupil beats on their own (the rig draws neither). */
export const browsOn = (ctx: ReactionCtx) => ctx.stage >= 3;

/** A giggle wobble that rocks on the base and dies away (SQUISH's rot timeline, §2.6 poke belly). */
export function wobble(at: number, amps: readonly number[], every: number, spring: SpringPreset = 'pop'): Beat[] {
  return amps.map((rot, i) => beat(at + i * every, { rot }, spring));
}

/** Happy hop pair: an anticipation crouch, then two hops, the second at 70 % (celebrate, §2.6). */
export function doubleHop(at: number, h: number, haptic?: HapticKind): Beat[] {
  return [
    beat(at, { sy: 0.9 }, 'snap', { haptic }),
    beat(at + 120, { sy: 1.06 }, 'snap', { hop: { h, land: 0.14 } }),
    beat(at + 120 + hopMs(h) + 60, { sy: 1.04 }, 'snap', { hop: { h: h * 0.7, land: 0.1 } }),
  ];
}

/** Airtime of a hop of apex h (px) under the base gravity (ms). */
export const hopMs = (h: number, g = 2400) => 2 * Math.sqrt((2 * h) / g) * 1000;

/** Last beat: the release spring every touched channel goes home on. */
export function end(beats: Beat[], release: SpringPreset = 'pop'): Beat[] {
  if (beats.length) beats[beats.length - 1] = { ...beats[beats.length - 1], release };
  return beats;
}
