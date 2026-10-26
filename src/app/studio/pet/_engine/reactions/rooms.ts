/**
 * The engine's lazily loaded motion (design §10.3–§10.5, §3.1, §8A): the room transition and each room's arrival,
 * idle beats and reactions by their final names (Starfall's catch, near miss and round end, with Zen), lighting a
 * growth moment, the settle float, the four moves lit moments unlock, one cycle of the Garden's guided breath, the
 * hands-free listening hold and the breath between queued sentences. Its own chunk (§10.7): the engine preloads it a
 * few seconds after start, off the first paint. Pure like the reactions: `(ctx, …) → Beat[]`, randomness only
 * through ctx.rng (variants through ctx.variantHistory).
 */

import type { WearSlot } from '@/lib/pet/play';
import type { DetailName } from '../details';
import type { Anchor, Beat, PoseTargets, ReactionCtx, ReactionKind, Room, RoomReaction, RoomReactOpts, SpringPreset } from '../types';
import { beat, burst, cue, eared, end, hopMs, jiggle, osc, side, squashX } from './util';

/** A variant in [0, n) never the same twice in a row for this key (the engine's variant memory). */
const pick = (ctx: ReactionCtx, key: string, n = 3) => ctx.variantHistory.pick(key as ReactionKind, n);

/**
 * Room transition timing (§10.5, 300 ms): a 70 ms crouched counter-lean against the slide (anticipation), the lean
 * with it on an arc (a lift and a little drift: never a straight line), a blink as the backdrop swaps at 150 ms,
 * and a settle with one overshoot. Wave B doubles the counter-lean and the lean so the stills read.
 */
export const RT = { counterMs: 70, swapMs: 150, settleMs: 210, totalMs: 300, counterDeg: 5, leanDeg: 10, lift: 6, drift: 3, crouch: 0.95 } as const;

/**
 * Room change: `dir` 1 when the new room is to the right (the backdrop slides left). The eyes lead toward the new
 * room, the body crouches and leans away, then swings with the slide (lifted, drifting a few px, stretched), the
 * head trailing; the soft parts (ears, hair, bows) trail on their followers.
 */
export function roomLeave(_ctx: ReactionCtx, dir: -1 | 1): Beat[] {
  const s = dir;
  return end([
    beat(0, { gazeX: s * 0.6, lean: -s * RT.counterDeg, sy: RT.crouch, headX: -s * 0.6 }, 'snap', { springs: { gazeX: 'eye' } }),
    beat(RT.counterMs, { lean: s * RT.leanDeg, y: -RT.lift, x: s * RT.drift, sy: 1.05, headX: s * 1.6, headTilt: s * 3 }, 'snap', { springs: { y: 'pop', x: 'pop', headX: 'float' } }),
    cue(RT.swapMs - 20, { blink: 'once' }),
    beat(RT.settleMs, { lean: 0, y: 0, x: 0, sy: 1, headX: 0, headTilt: 0, gazeX: 0 }, 'pop'),
  ], 'pop');
}

/** The room's hello right after the transition settles (≤ 1 s): what tells you where you are, even in a still. */
export function roomArrive(ctx: ReactionCtx, room: Room): Beat[] {
  const s = side(ctx);
  switch (room) {
    // a ready bounce, eyes bright: two little hops on the spot
    case 'play': return end([
      beat(0, { sy: 0.93, pupil: 1.12 }, 'snap', { mouth: 'grin' }),
      beat(90, { sy: 1.05 }, 'snap', { hop: { h: 5, land: 0.07 } }),
      beat(330, { sy: 0.95 }, 'snap'),
      beat(420, { sy: 1.03 }, 'snap', { hop: { h: 3, land: 0.05 } }),
      beat(700, { sy: 1, pupil: 1 }, 'pop', { mouth: 'smile' }),
    ], 'pop');
    // up into the air and a look at the sky
    case 'garden': return end([
      beat(0, { gazeY: -0.8, gazeX: 0.2 * s }, 'eye', { mouth: 'o' }),
      beat(60, { headY: -1.8, y: -4, sy: 1.03 }, 'float'),
      cue(260, { blink: 'slow' }),
      beat(750, { gazeY: 0, gazeX: 0, headY: 0, y: 0, sy: 1 }, 'float', { mouth: 'smile' }),
    ], 'float');
    // a quick turn to the mirror and a pleased sparkle
    case 'closet': return end([
      beat(0, { gazeX: 0.8, gazeY: -0.1 }, 'eye'),
      beat(60, { headX: 2, headTilt: 5, lean: 3 }, 'float', { mouth: 'smile' }),
      beat(360, { pupil: 1.12, sparkle: 0.6 }, 'snap', { springs: { sparkle: 'snap' } }),
      beat(760, { gazeX: 0, gazeY: 0, headX: 0, headTilt: 0, lean: 0, pupil: 1, sparkle: 0 }, 'float'),
    ], 'float');
    // a slow sink into the cosy room, lids heavy
    case 'bedroom': return end([
      beat(0, { sy: 1.03, headY: -0.8 }, 'float', { mouth: 'o' }),
      beat(380, { sy: 0.97, headY: 1.4, lidL: 0.6, lidR: 0.6 }, 'sleepy', { mouth: 'X' }),
      beat(1000, { sy: 1, headY: 0, lidL: 1, lidR: 1 }, 'sleepy'),
    ], 'sleepy');
    // eyes straight down to the page
    case 'book': return end([
      beat(0, { gazeY: 0.75, gazeX: -0.2 }, 'eye'),
      beat(60, { headY: 2, headTilt: -2 }, 'float'),
      cue(320, { blink: 'once' }),
      beat(800, { gazeY: 0, gazeX: 0, headY: 0, headTilt: 0 }, 'float'),
    ], 'float');
    default: return end([beat(0, { sy: 1.03 }, 'pop', { mouth: 'smile', blink: 'slow' }), beat(500, { sy: 1 }, 'float')], 'float');
  }
}

/**
 * Each room's idle beat (§10.4, three variants each): what the scheduler plays there between the mood's own beats,
 * over the room's held pose (extras.ts ROOMS). `target`: the page is steering the eyes (setGaze: Starfall's star),
 * so Play's beats leave the eyes to it.
 */
export function roomIdle(ctx: ReactionCtx, room: Room, o: { target?: boolean } = {}): Beat[] {
  const s = side(ctx);
  switch (room) {
    // Play: ready, springy, eyes on the toy (or the page's target)
    case 'play': {
      const look = o.target ? {} : { look: 'ball' as const };
      switch (pick(ctx, 'roomIdle:play')) {
        case 0: return end([
          beat(0, { sy: 0.94 }, 'snap', { mouth: 'grin', ...look }),
          beat(90, { sy: 1.05 }, 'snap', { hop: { h: 6, land: 0.07 } }),
          beat(380, { sy: 0.94 }, 'snap'),
          beat(470, { sy: 1.04 }, 'snap', { hop: { h: 4, land: 0.06 } }),
          beat(820, { sy: 1 }, 'pop', { mouth: 'smile' }),
        ], 'pop');
        // a weight shift from foot to foot, on the balls of its feet
        case 1: return end([
          beat(0, { lean: -6 * s, x: -4 * s, sy: 0.96 }, 'pop', { mouth: 'grin', ...look }),
          beat(340, { lean: 6 * s, x: 4 * s }, 'pop'),
          beat(680, { lean: 0, x: 0, sy: 1 }, 'pop', { mouth: 'smile' }),
        ], 'pop');
        // an eager wiggle with bright eyes
        default: return end([
          beat(0, { pupil: 1.14, sparkle: 0.6, sy: 1.03 }, 'snap', { springs: { sparkle: 'snap' }, mouth: 'grin', ...look }),
          beat(100, {}, 'pop', { osc: osc('rot', 3, 5, 520) }),
          beat(760, { pupil: 1, sparkle: 0, sy: 1 }, 'float', { mouth: 'smile' }),
        ], 'pop');
      }
    }
    // Garden: hovering, chin up to the sky; a raindrop lands and it blinks it away with a smile
    case 'garden': switch (pick(ctx, 'roomIdle:garden')) {
      case 0: return end([
        beat(0, { gazeY: -0.4, headY: -2 }, 'float'),
        beat(520, { sy: 0.95, headY: 2.5, headTilt: 3 * s, lidL: 0.1, lidR: 0.1 }, 'snap', { haptic: 'soft' }),
        beat(720, { sy: 1.03, headY: -1.5, headTilt: 0, lidL: 1, lidR: 1 }, 'pop', { mouth: 'smile' }),
        beat(1350, { gazeY: 0, headY: 0, sy: 1 }, 'float'),
      ], 'float');
      case 1: return end([
        beat(0, { gazeY: -0.8, gazeX: 0.3 * s }, 'eye', { blink: 'slow' }),
        beat(80, { headY: -3.5, headTilt: 5 * s, y: -4 }, 'float', { mouth: 'o' }),
        beat(1400, { gazeY: 0, gazeX: 0, headY: 0, headTilt: 0, y: 0 }, 'float', { mouth: 'smile' }),
      ], 'float');
      // a peek down at the pot, then back up
      default: return end([
        beat(0, { gazeY: 0.75, gazeX: 0.1 * s }, 'eye'),
        beat(80, { headY: 5, y: 3 }, 'float', { mouth: 'smile' }),
        beat(850, { gazeY: -0.4, headY: -1.5, y: -2 }, 'float'),
        beat(1500, { gazeY: 0, gazeX: 0, headY: 0, y: 0 }, 'float'),
      ], 'float');
    }
    // Closet: at the mirror (to the right), admiring, small pose shifts
    case 'closet': switch (pick(ctx, 'roomIdle:closet')) {
      case 0: return end([
        beat(0, { gazeX: 0.4 }, 'eye'),
        beat(60, { headTilt: 6, lean: 4, headX: 2 }, 'float', { mouth: 'smile' }),
        beat(480, { sy: 0.96 }, 'snap'),
        beat(580, { sy: 1.03 }, 'pop', { osc: osc('rot', 2.5, 4, 450) }),
        beat(1300, { gazeX: 0, headTilt: 0, lean: 0, headX: 0, sy: 1 }, 'float'),
      ], 'float');
      // the other cheek to the mirror
      case 1: return end([
        beat(0, { gazeX: -0.25 }, 'eye'),
        beat(60, { headX: -10, headTilt: -13, lean: -10 }, 'float', { mouth: 'grin' }),
        beat(420, { pupil: 1.1, sparkle: 0.45 }, 'snap', { springs: { sparkle: 'snap' } }),
        beat(1150, { gazeX: 0, headX: 0, headTilt: 0, lean: 0, pupil: 1, sparkle: 0 }, 'float', { mouth: 'smile' }),
      ], 'float');
      // chin up, proud, a little blush
      default: return end([
        beat(0, { headY: -3.5, sy: 1.05, pupil: 1.1, sparkle: 0.5 }, 'float', { springs: { sparkle: 'snap' }, mouth: 'smile' }),
        beat(350, { blush: 0.55 }, 'float'),
        beat(1300, { headY: 0, sy: 1, pupil: 1, sparkle: 0, blush: 0 }, 'float'),
      ], 'float');
    }
    // Bedroom: heavy lids, a yawn, nodding off and catching itself, the lean drifting over (the held lean swaps side)
    case 'bedroom': switch (pick(ctx, 'roomIdle:bedroom')) {
      case 0: return end([
        beat(0, { sy: 1.08, headY: -3.5, lidL: 0.85, lidR: 0.85 }, 'float', { mouth: 'yawn', expr: 'squeeze' }),
        beat(750, { sy: 0.96, headY: 1.5 }, 'sleepy', { mouth: 'X', expr: 'idle' }),
        cue(950, { blink: 'slow' }),
        beat(1500, { sy: 1, headY: 0, lidL: 1, lidR: 1 }, 'sleepy'),
      ], 'sleepy');
      case 1: return end([
        beat(0, { headY: 5, headTilt: 3, lidL: 0.3, lidR: 0.3, sy: 0.97 }, 'sleepy'),
        beat(1300, { headY: -2.5, headTilt: 0, lidL: 1.5, lidR: 1.5, sy: 1.03 }, 'snap', { blink: 'double', mouth: 'o' }),
        beat(1750, { headY: 0, lidL: 1, lidR: 1, sy: 1 }, 'float', { mouth: 'X' }),
      ], 'float');
      default: return end([
        beat(0, { sy: 0.98, headY: 1.5 }, 'sleepy', { blink: 'slow' }),
        beat(1500, { sy: 1, headY: 0 }, 'sleepy'),
      ], 'sleepy');
    }
    // Life Book: reading lines, the page-flip nod, a curious "hm"
    case 'book': switch (pick(ctx, 'roomIdle:book')) {
      case 0: return end([
        beat(0, { gazeX: -0.6 }, 'eye'),
        beat(80, { headX: -2.2, headTilt: 2 }, 'float'),
        beat(560, { gazeX: 0.6, headX: 2.2, headTilt: -2 }, 'float'),
        beat(820, { gazeX: -0.6, gazeY: 0.2, headX: -2.2, headY: 1, headTilt: 2 }, 'eye', { springs: { headX: 'float', headY: 'float', headTilt: 'float' } }),
        beat(1320, { gazeX: 0.6, headX: 2.2, headTilt: -2 }, 'float'),
        beat(1650, { gazeX: 0, gazeY: 0, headX: 0, headY: 0, headTilt: 0 }, 'float'),
      ], 'float');
      case 1: return pageFlip(ctx);
      default: return end([
        beat(0, { headTilt: -9 * s, headY: -2.5, pupil: 1.1 }, 'float', { mouth: 'o' }),
        beat(300, { browL: 0.8, browR: 0.8 }, 'snap'),
        beat(950, { headTilt: 0, headY: 0, pupil: 1, browL: 0, browR: 0 }, 'float', { mouth: 'smile' }),
      ], 'float');
    }
    // Home: the content float, a slow rise with a contented slow blink (the content mood's own beat at Home)
    default: switch (pick(ctx, 'roomIdle:home')) {
      case 0: return end([beat(0, { y: -5, sy: 1.025, headY: -1 }, 'float', { mouth: 'smile', blink: 'slow' }), beat(1200, { y: 0, sy: 1, headY: 0 }, 'float')], 'float');
      case 1: return end([beat(0, { headTilt: 6 * s, y: -3, lean: 2 * s }, 'float', { mouth: 'smile' }), beat(1000, { headTilt: 0, y: 0, lean: 0 }, 'float')], 'float');
      default: return end([beat(0, { sy: 1.03, lidL: 0.78, lidR: 0.78 }, 'float', { mouth: 'smile' }), beat(1000, { sy: 1, lidL: 1, lidR: 1 }, 'float')], 'float');
    }
  }
}

/** Life Book: the page turns, the eyes follow it over and a little nod lands on the new page. */
function pageFlip(ctx: ReactionCtx): Beat[] {
  const s = side(ctx);
  return end([
    beat(0, { gazeX: 0.6 * s, gazeY: -0.1 }, 'eye', { blink: 'once' }),
    beat(60, { headX: 3 * s, headTilt: 3 * s, headY: -1.5 }, 'float'),
    beat(380, { gazeX: -0.5 * s, gazeY: 0.3 }, 'eye'),
    beat(430, { headY: 3.5, headX: -1.2 * s, headTilt: -2 * s }, 'snap'),
    beat(660, { headY: 0 }, 'pop'),
    beat(1050, { gazeX: 0, gazeY: 0, headX: 0, headTilt: 0 }, 'float'),
  ], 'float');
}

/** One preset softer (Zen, §10.6): every game spring relaxes a step. */
const SOFTER: Record<SpringPreset, SpringPreset> = { eye: 'snap', snap: 'pop', pop: 'float', jelly: 'float', float: 'sleepy', sleepy: 'sleepy' };
/** Zen: one preset softer, no particles or haptics (nothing flashes), hops halved. */
export function zen(beats: Beat[]): Beat[] {
  return beats.map((b) => {
    const z: Beat = { ...b, spring: SOFTER[b.spring] };
    delete z.particles; delete z.haptic;
    if (b.springs) z.springs = Object.fromEntries(Object.entries(b.springs).map(([c, p]) => [c, SOFTER[p as SpringPreset]]));
    if (b.release) z.release = SOFTER[b.release];
    if (b.hop) z.hop = { ...b.hop, h: b.hop.h * 0.5 };
    return z;
  });
}

/** Reactions Zen plays one preset softer (Zen's round end is its own quiet nod, already soft). */
const ZEN_SOFT: ReadonlySet<RoomReaction> = new Set<RoomReaction>(['catch', 'nearMiss', 'guessThink', 'guessHeard', 'guessRight', 'guessWrong', 'guessReveal']);

/**
 * Where a reaction aims (the engine works it out): `aim` how far right of the body the Garden's pot stands (view
 * units; rain drifts over it, a bloom looks down at it), `slot` the slot of the item a `tryOn` admires.
 */
export interface ReactionAim { aim?: number; slot?: WearSlot }

/** The room reactions (§10.4): final names; Play (Starfall), Garden, Closet, Bedroom, Life Book and Guess call these. */
export function roomReaction(ctx: ReactionCtx, kind: RoomReaction, o: RoomReactOpts = {}, a: ReactionAim = {}): Beat[] {
  const beats = reaction(ctx, kind, o, a);
  return o.zen && ZEN_SOFT.has(kind) ? zen(beats) : beats;
}

function reaction(ctx: ReactionCtx, kind: RoomReaction, o: RoomReactOpts, a: ReactionAim): Beat[] {
  const s = side(ctx);
  switch (kind) {
    // Starfall catch (≤ 450 ms, it comes often): a chomp, a small satisfied bounce, a glint in the eye
    case 'catch': {
      const v = pick(ctx, 'catch');
      return end([
        beat(0, { sy: 0.91, puff: 0.45, pupil: 1.1, sparkle: 0.85 }, 'eye', { springs: { puff: 'snap', sparkle: 'eye' }, mouth: 'chew', haptic: 'light', blink: 'suppress', particles: burst('sparkle', 1, v === 1 ? 'eyeL' : 'eyeR') }),
        beat(80, { sy: 1.05, y: -3, puff: 0, ...(v === 2 ? { headTilt: 4 * s } : {}) }, 'snap', { springs: { y: 'pop' } }),
        beat(210, { sy: 1, y: 0, headTilt: 0 }, 'pop', { mouth: 'smile' }),
        beat(270, { sparkle: 0, pupil: 1 }, 'pop', { blink: 'allow' }),
      ], 'pop');
    }
    // a near miss: a startled little "o", a cute wobble after the star, then a smile (never a frown or droop)
    case 'nearMiss': return end([
      beat(0, { gazeX: 0.6 * s, gazeY: 0.5, sy: 1.03, pupil: 1.06 }, 'eye', { springs: { sy: 'snap' }, mouth: 'o', expr: 'surprised' }),
      beat(90, { headTilt: 8 * s, x: 2 * s }, 'float'),
      beat(150, {}, 'pop', { osc: [osc('rot', 7 * s, 3.5, 600), osc('headTilt', -5 * s, 3.5, 600)] }),
      beat(600, { gazeX: 0, gazeY: 0, headTilt: 0, x: 0, sy: 1, pupil: 1 }, 'float', { expr: 'idle', mouth: 'smile' }),
    ], 'float');
    // round end: won, a happy hop with a few sparkles; not won, a gentle shrug and a wink (never droopy); Zen, no
    // flourish at all: a content nod and a slow blink
    case 'roundEnd': {
      if (o.zen) return end([beat(0, { headY: 1 }, 'float', { mouth: 'smile', blink: 'slow' }), beat(500, { headY: 0 }, 'float')], 'float');
      if (o.won) {
        const h = 14, apex = 110 + hopMs(h) / 2;
        return end([
          beat(0, { sy: 0.9, pupil: 1.12 }, 'snap', { expr: 'happy', mouth: 'grin', haptic: 'success', blink: 'suppress' }),
          ...(eared(ctx) ? [beat(100, { earL: 12, earR: -12 }, 'snap'), beat(apex + 200, { earL: 0, earR: 0 }, 'jelly')] : []),
          beat(110, { sy: 1.08 }, 'snap', { hop: { h, land: 0.12 } }),
          beat(apex, {}, 'pop', { particles: burst('sparkle', 4, 'head') }),
          beat(780, { sy: 1, pupil: 1 }, 'pop', { expr: 'idle', mouth: 'smile', blink: 'allow' }),
        ], 'pop');
      }
      const eye = s > 0 ? { lidR: 0.08 } : { lidL: 0.08 }, open = s > 0 ? { lidR: 1 } : { lidL: 1 };
      return end([
        beat(0, { ...squashX(ctx, 1.07), y: -3.5, headTilt: 6 * s }, 'pop', { mouth: 'smile', look: 'user' }),
        beat(150, { y: 0, ...(eared(ctx) ? { earL: 8, earR: -8 } : {}) }, 'pop'),
        beat(280, { ...eye, headTilt: 10 * s, blush: 0.4 }, 'snap', { springs: { blush: 'float' } }),
        beat(640, { ...open }, 'pop'),
        beat(900, { sx: 1, sy: 1, headTilt: 0, blush: 0, earL: 0, earR: 0 }, 'float'),
      ], 'float');
    }
    // Garden rain: rise and darken a little, drops fall from under the body onto the seed, a relief shake, lighter;
    // with a pot on the floor the cloud drifts over toward it, leans in and rains a narrow shower onto its soil
    case 'rain': if (a.aim) return rainAimed(ctx, a.aim); return end([
      beat(0, { sy: 0.95 }, 'snap'),
      beat(90, { y: -10, sy: 1.04, dim: 0.12, lidL: 0.85, lidR: 0.85 }, 'float', { springs: { dim: 'sleepy' }, mouth: 'o' }),
      ...[420, 640, 860, 1080].map((at) => cue(at, { particles: burst('drop', 3, 'ground') })),
      beat(1250, { dim: 0, lidL: 1, lidR: 1 }, 'float', { expr: 'squeeze', mouth: 'grin', osc: [osc('rot', 4, 6, 420), ...jiggle(ctx, 0.05, 9, 420)] }),
      beat(1700, { sy: 1.06 }, 'pop', { expr: 'happy', mouth: 'smile', particles: burst('wisp', 2, 'body') }),
      beat(1900, { sy: 1, y: 0 }, 'float'),
      cue(2200, { expr: 'idle' }),
    ], 'jelly');
    // Closet: eyes up to the new item, a happy wiggle, the soft parts settle
    case 'admire': return end([
      beat(0, { gazeY: -0.6, pupil: 1.12, sparkle: 0.7 }, 'eye', { springs: { pupil: 'snap', sparkle: 'snap' }, expr: 'surprised', mouth: 'o' }),
      beat(80, { headY: -1.2 }, 'float'),
      beat(380, { sy: 0.96 }, 'snap', { expr: 'happy', mouth: 'grin' }),
      beat(480, { sy: 1.03 }, 'pop', { osc: [osc('rot', 4, 4, 520), osc('headTilt', -3, 4, 520)] }),
      beat(1100, { gazeY: 0, headY: 0, pupil: 1, sparkle: 0, sy: 1 }, 'float', { expr: 'idle', mouth: 'smile' }),
    ], 'float');
    // Bedroom: a slow sleepy nod at every story line
    case 'storyNod': return end([
      beat(0, { headY: 1.6, lidL: 0.8, lidR: 0.8 }, 'float', { mouth: 'smile' }),
      beat(420, { headY: 0 }, 'sleepy'),
      beat(800, { lidL: 1, lidR: 1 }, 'sleepy'),
    ], 'sleepy');
    // Life Book: the page turns, the eyes follow it over
    case 'pageFlip': return pageFlip(ctx);
    // its own drawing: a little hop and a blush
    case 'ownDrawing': return end([
      beat(0, { pupil: 1.1, blush: 0.6 }, 'snap', { expr: 'happy', mouth: 'grin', springs: { blush: 'float' } }),
      beat(120, { sy: 1 }, 'snap', { hop: { h: 7, land: 0.1 } }),
      beat(900, { pupil: 1, blush: 0 }, 'float', { expr: 'idle', mouth: 'smile' }),
    ], 'jelly');
    case 'bloom': return bloom(ctx, a.aim ?? 0);
    case 'tryOn': return tryOn(a.slot ?? 'head');
    case 'guessThink': return guessThink(ctx);
    case 'guessHeard': return guessHeard(ctx);
    case 'guessRight': return guessRight(ctx);
    case 'guessWrong': return guessWrong(ctx);
    case 'guessReveal': return guessReveal(ctx);
  }
}

/* ---------- Garden: the seed (§4.5) ---------- */

/** Rain aimed at the pot `dx` view units to the right: the same rise, darken and relief shake, drifting over it. */
function rainAimed(ctx: ReactionCtx, dx: number): Beat[] {
  const d = Math.min(10, dx * 0.2), lean = Math.min(7, dx * 0.12);
  return end([
    beat(0, { sy: 0.95, gazeX: 0.45, gazeY: 0.55 }, 'snap', { springs: { gazeX: 'eye', gazeY: 'eye' } }),
    beat(90, { y: -10, x: d, lean, sy: 1.04, dim: 0.12, lidL: 0.85, lidR: 0.85 }, 'float', { springs: { dim: 'sleepy' }, mouth: 'o' }),
    ...[420, 640, 860, 1080].map((at) => cue(at, { particles: { ...burst('drop', 3, 'touch'), w: 6 } })),
    beat(1250, { dim: 0, lidL: 1, lidR: 1, gazeX: 0.2, gazeY: 0.3 }, 'float', { expr: 'squeeze', mouth: 'grin', osc: [osc('rot', 4, 6, 420), ...jiggle(ctx, 0.05, 9, 420)] }),
    beat(1700, { sy: 1.06 }, 'pop', { expr: 'happy', mouth: 'smile', particles: burst('wisp', 2, 'body') }),
    beat(1900, { sy: 1, y: 0, x: 0, lean: 0, gazeX: 0, gazeY: 0 }, 'float'),
    cue(2200, { expr: 'idle' }),
  ], 'jelly');
}

/**
 * The moment it blooms (≤ 1.4 s): eyes down to the pot (they lead, the head follows, a lean toward it), a delighted
 * blink (squeezed shut ^^, then wide and sparkly), one sparkle over the flower, a small happy bounce.
 */
function bloom(ctx: ReactionCtx, dx: number): Beat[] {
  const gx = dx > 0 ? Math.min(0.75, 0.25 + dx / 120) : 0;
  return end([
    beat(0, { gazeX: gx, gazeY: 0.8, pupil: 1.08 }, 'eye', { mouth: 'o', expr: 'surprised' }),
    beat(70, { headY: 3.5, headX: gx * 3, headTilt: gx * 8, lean: gx * 6 }, 'float'),
    beat(420, { lidL: 0.1, lidR: 0.1, sy: 0.95 }, 'snap', { expr: 'squeeze', mouth: 'grin', blink: 'suppress' }),
    beat(600, { lidL: 1, lidR: 1, pupil: 1.14, sparkle: 0.85, sy: 1.05, headY: 1 }, 'pop', { expr: 'happy', mouth: 'grin', springs: { sparkle: 'snap', lidL: 'snap', lidR: 'snap' }, particles: burst('sparkle', 1, 'touch'), haptic: 'light' }),
    beat(760, { sy: 0.98 }, 'snap'),
    beat(880, { sy: 1.02 }, 'pop', { blink: 'allow' }),
    beat(1250, { gazeX: 0, gazeY: 0, headY: 0, headX: 0, headTilt: 0, lean: 0, pupil: 1, sparkle: 0, sy: 1 }, 'float', { expr: 'idle', mouth: 'smile' }),
  ], 'float');
}

/* ---------- Closet: the mirror (§4.3) ---------- */

/** Where the eyes go to see an item on: up to a hat, down to the chest, down and over to what it holds. */
const SEE: Record<WearSlot, Partial<PoseTargets>> = { head: { gazeY: -0.7, gazeX: 0.1, headY: -1.6 }, neck: { gazeY: 0.75, gazeX: -0.1, headY: 2.2 }, hand: { gazeY: 0.8, gazeX: 0.45, headY: 2.2, headTilt: 4 } };

/**
 * Trying an item on at the mirror (≤ 1.3 s): a glance at the item where it is worn, a blink as the head comes up, a
 * turn to the mirror (to the right) with a small pose (chin up, a lean, a stretch taller), a blush and a sparkle,
 * a little dip of delight; the pose holds ~0.5 s so it reads, then a float home.
 */
function tryOn(slot: WearSlot): Beat[] {
  return end([
    beat(0, { ...SEE[slot], pupil: 1.08 }, 'eye', { mouth: 'o', springs: { headY: 'float', headTilt: 'float' } }),
    cue(300, { blink: 'once' }),
    beat(330, { gazeX: 0.75, gazeY: -0.05, headX: 4, headY: -1.2, headTilt: 8, lean: 6, sy: 1.04 }, 'pop', { mouth: 'smile', springs: { gazeX: 'eye', gazeY: 'eye' } }),
    beat(520, { blush: 0.55, sparkle: 0.55, pupil: 1.1 }, 'float', { expr: 'happy', springs: { sparkle: 'snap' } }),
    beat(580, { sy: 0.97 }, 'snap'),
    beat(680, { sy: 1.03 }, 'pop'),
    beat(1180, { gazeX: 0, gazeY: 0, headX: 0, headY: 0, headTilt: 0, lean: 0, sy: 1, blush: 0, sparkle: 0, pupil: 1 }, 'float', { expr: 'idle', mouth: 'smile' }),
  ], 'float');
}

/* ---------- Guess my word (§4.2): reactions to a guess, never sad ---------- */

/**
 * It has a word (≤ 1.2 s): eyes up and aside as it picks one, a slow blink, then a sly look back at you with a
 * secret closed smile and a sparkle (the word is in there).
 */
function guessThink(ctx: ReactionCtx): Beat[] {
  const s = side(ctx);
  return end([
    beat(0, { gazeX: -0.55 * s, gazeY: -0.6 }, 'eye', { mouth: 'o' }),
    beat(70, { headTilt: -6 * s, headY: -1.5, headX: -1.5 * s }, 'float'),
    cue(300, { blink: 'slow' }),
    beat(620, { gazeX: 0.15 * s, gazeY: 0, headTilt: 5 * s, headY: 0, headX: 0, pupil: 1.08, sparkle: 0.5 }, 'pop', { mouth: 'smirk', look: 'user', springs: { sparkle: 'snap', gazeX: 'eye', gazeY: 'eye' } }),
    beat(1150, { headTilt: 0, pupil: 1, sparkle: 0, gazeX: 0 }, 'float', { mouth: 'smile' }),
  ], 'float');
}

/** A question heard (≤ 700 ms): ears and brows perk, a small considering nod, eyes on you. */
function guessHeard(ctx: ReactionCtx): Beat[] {
  const s = side(ctx);
  return end([
    beat(0, { browL: 0.6, browR: 0.6, pupil: 1.06, sy: 1.02, ...(eared(ctx) ? { earL: 8, earR: -8 } : {}) }, 'snap', { look: 'user', mouth: 'o' }),
    beat(160, { headY: 2, headTilt: 4 * s }, 'pop'),
    beat(330, { headY: 0 }, 'pop', { mouth: 'smile' }),
    beat(640, { browL: 0, browR: 0, pupil: 1, sy: 1, headTilt: 0, earL: 0, earR: 0 }, 'float'),
  ], 'float');
}

/** A right guess (≤ 900 ms): a crouch, a pleased little hop, a glint in the eye, a happy tilt. */
function guessRight(ctx: ReactionCtx): Beat[] {
  const s = side(ctx), h = 7, apex = 110 + hopMs(h) / 2;
  return end([
    beat(0, { sy: 0.92, pupil: 1.1 }, 'snap', { expr: 'happy', mouth: 'grin', blink: 'suppress' }),
    ...(eared(ctx) ? [beat(100, { earL: 10, earR: -10 }, 'snap'), beat(apex + 160, { earL: 0, earR: 0 }, 'jelly')] : []),
    beat(110, { sy: 1.06 }, 'snap', { hop: { h, land: 0.08 }, haptic: 'light' }),
    beat(apex, { sparkle: 0.9 }, 'snap', { springs: { sparkle: 'eye' }, particles: burst('sparkle', 1, s > 0 ? 'eyeR' : 'eyeL') }),
    beat(apex + 150, { headTilt: 6 * s, sy: 1 }, 'pop'),
    beat(820, { headTilt: 0, sparkle: 0, pupil: 1 }, 'float', { expr: 'idle', mouth: 'smile', blink: 'allow' }),
  ], 'pop');
}

/**
 * A wrong guess (≤ 1 s): a playful "nope" (a quick head shake, brows up, a cheeky smile) and a wink. Never droopy:
 * the head never drops, the ears never fall, the mouth never turns down.
 */
function guessWrong(ctx: ReactionCtx): Beat[] {
  const s = side(ctx), wink = s > 0 ? { lidR: 0.1 } : { lidL: 0.1 }, open = s > 0 ? { lidR: 1 } : { lidL: 1 };
  return end([
    beat(0, { pupil: 1.06, browL: 0.7, browR: 0.7, headY: -1, sy: 1.02, ...(eared(ctx) ? { earL: 6, earR: -6 } : {}) }, 'snap', { mouth: 'smirk', look: 'user' }),
    beat(60, {}, 'pop', { osc: [osc('headTilt', 10 * s, 4.2, 600), osc('headX', 4 * s, 4.2, 600), osc('rot', 3.5 * s, 4.2, 600)] }),
    beat(640, { ...wink, headTilt: 5 * s, blush: 0.35 }, 'snap', { mouth: 'grin', springs: { blush: 'float' } }),
    beat(860, { ...open }, 'pop'),
    beat(960, { browL: 0, browR: 0, headY: 0, headTilt: 0, sy: 1, pupil: 1, blush: 0, earL: 0, earR: 0 }, 'float', { mouth: 'smile' }),
  ], 'float');
}

/**
 * The reveal (≤ 1.1 s): the pet "says" its word: a little breath in, four quick speech shapes (a closed M, an open
 * ah, a narrow ee, a round oh) with tiny head nods on the syllables, then a proud ta-da tilt and a sparkle.
 */
function guessReveal(ctx: ReactionCtx): Beat[] {
  const s = side(ctx);
  return end([
    beat(0, { sy: 1.035, headY: -1.2, pupil: 1.05 }, 'float', { mouth: 'o', look: 'user' }),
    beat(200, { sy: 1 }, 'snap', { mouth: 'A' }),
    beat(270, { headY: 0.8 }, 'snap', { mouth: 'D' }),
    beat(400, { headY: 0 }, 'snap', { mouth: 'B' }),
    beat(490, { headY: 0.6 }, 'snap', { mouth: 'E' }),
    beat(610, { headY: 0 }, 'snap', { mouth: 'X' }),
    beat(660, { headTilt: 6 * s, sy: 1.03, sparkle: 0.55, pupil: 1.1 }, 'pop', { expr: 'happy', mouth: 'grin', springs: { sparkle: 'snap' } }),
    beat(1050, { headTilt: 0, sy: 1, sparkle: 0, pupil: 1 }, 'float', { expr: 'idle', mouth: 'smile' }),
  ], 'pop');
}

/** Where the pet looks when its new detail arrives (it admires it), and where the one twinkle comes from. */
const LOOK_AT: Record<DetailName, { gaze: Partial<PoseTargets>; at: Anchor }> = {
  glint: { gaze: {}, at: 'eyeR' },
  pin: { gaze: { gazeX: -0.45, gazeY: 0.75 }, at: 'belly' },
  charm: { gaze: { gazeX: 0.55, gazeY: 0.6 }, at: 'cheekR' },
  keepsake: { gaze: { gazeX: -0.7, gazeY: 0.85 }, at: 'ground' },
  seasonal: { gaze: { gazeX: 0.7, gazeY: 0.85 }, at: 'ground' },
};

/**
 * Lighting a growth moment (§10.3, ~1.2 s): the pet looks up as if remembering (the eyes lead, the head follows, a
 * slow blink), a soft glow swells, the new detail arrives with one overshoot (the `litPeak` cue at 600 ms) and the
 * pet glances at it with one twinkle where it lands, then a small nod. Never confetti.
 */
export function growthLit(ctx: ReactionCtx, detail?: DetailName): Beat[] {
  const s = side(ctx), d = detail ? LOOK_AT[detail] : null;
  return end([
    beat(0, { gazeY: -0.65, gazeX: 0.3 * s }, 'eye'),
    beat(70, { headY: -1.4, headTilt: 3 * s }, 'float'),
    beat(150, { glow: 0.8 }, 'float'),
    cue(240, { blink: 'slow' }),
    beat(600, { sy: 1.04, pupil: 1.1, sparkle: 0.6 }, 'pop', { expr: 'happy', mouth: 'smile', springs: { sparkle: 'snap' }, ...(d ? { particles: burst('sparkle', 1, d.at) } : {}) }),
    ...(d && detail !== 'glint' ? [beat(680, { ...d.gaze, headTilt: 0, headY: 0.6 }, 'eye', { expr: 'idle', springs: { headY: 'float', headTilt: 'float' } })] : []),
    beat(880, { gazeX: 0, gazeY: 0, headTilt: 0, headY: 1.4, sy: 1 }, 'snap'),
    beat(1020, { headY: 0 }, 'pop'),
    beat(1070, { glow: 0, pupil: 1, sparkle: 0 }, 'sleepy', { expr: 'idle' }),
  ], 'pop');
}

/** The settle (§3.1 T9): a contented sigh, a slow blink, the body sinking soft into the content float. No words. */
export function settleFloat(ctx: ReactionCtx): Beat[] {
  const v = ctx.rng() < 0.5 ? 0 : 1;
  return end([
    beat(0, { sy: 1.03, lidL: 0.92, lidR: 0.92 }, 'float', { mouth: 'o' }),
    beat(600, { sy: 0.975 }, 'sleepy', { mouth: 'smile', expr: 'happy', blink: 'slow' }),
    ...(v === 1 ? [beat(700, { headTilt: 3 * side(ctx) }, 'sleepy')] : []),
    beat(1500, { sy: 1, lidL: 1, lidR: 1, headTilt: 0 }, 'sleepy', { expr: 'idle' }),
  ], 'sleepy');
}

/**
 * One cycle of the Garden's "breathe with me" (§4.5, design 6 s): in through the nose for 40 % (the body rises and
 * fills, ears lift, eyes open), out through a small "o" for 60 % (it sinks, the eyes half close). Exempt from
 * jitter, so the cycle keeps the period you follow; a last mark holds the pose into the next cycle (no dip).
 * Reduced motion: the face only (the CSS breath carries the body).
 */
export function breatheCycle(periodMs: number, inhale = 0.4, reduced = false): Beat[] {
  const out = periodMs * inhale;
  const body = (t: Partial<PoseTargets>) => (reduced ? {} : t);
  // a faint glow swells with the breath in and fades with the breath out, in steps so it follows the cycle on any
  // spring (reduced motion's 150 ms crossfades included: opacity only)
  const glow = (from: number, ms: number, a: number, b: number) => [1, 2, 3].map((i) => beat(from + (ms * (i - 1)) / 3, { glow: a + ((b - a) * i) / 3 }, 'sleepy', { fixed: true, springs: { glow: 'float' } }));
  return end([
    beat(0, { ...body({ sy: 1.055, y: -2.5, headY: -1, earL: 5, earR: -5 }), lidL: 1, lidR: 1 }, 'sleepy', { mouth: 'X', fixed: true }),
    beat(out, { ...body({ sy: 0.975, y: 0.5, headY: 0.6, earL: 0, earR: 0 }), lidL: 0.55, lidR: 0.55 }, 'sleepy', { mouth: 'o', fixed: true }),
    ...glow(0, out, BREATH_GLOW.low, BREATH_GLOW.high),
    ...glow(out, periodMs * 0.9 - out, BREATH_GLOW.high, BREATH_GLOW.low),
    cue(periodMs * 0.96, { fixed: true }),
  ], 'sleepy');
}
/** The guided breath's glow (the stage glow's opacity): faint at the bottom of the breath, a little more at the top. */
export const BREATH_GLOW = { low: 0.04, high: 0.22 } as const;

/**
 * The hands-free listening hold coming on (§8A.2): the ears and tuft lift slowly (float, never the focus perk's
 * snap), the body leans in a touch, a slow attentive blink, the eyes on you.
 */
export function attend(ctx: ReactionCtx): Beat[] {
  return end([
    beat(0, { sy: 1.02, pupil: 1.06, ...(eared(ctx) ? { earL: 9, earR: -9 } : {}) }, 'float', { look: 'user', blink: 'slow' }),
    beat(600, { sy: 1, pupil: 1, earL: 0, earR: 0 }, 'float'),
  ], 'float');
}

/** The small breath between queued sentences: the chest lifts a touch and the chin with it, then down. */
export function sentenceBreath(pauseMs: number): Beat[] {
  return end([beat(0, { sy: 1.012, headY: -0.4 }, 'float'), beat(Math.max(80, pauseMs), { sy: 1, headY: 0 }, 'float')], 'float');
}

/** The moves a lit growth moment unlocks (signature indices 6–9, §4.11). */
export function unlockedMove(index: number): Beat[] {
  switch (index % 4) {
    // a slow twirl that ends in a little bow
    case 2: return end([beat(0, { sy: 0.95 }, 'snap'), beat(100, { rot: 360, sy: 1.03 }, 'float', { springs: { rot: 'sleepy' }, expr: 'happy', mouth: 'smile' }), beat(1150, { sy: 1, headY: 1.8, lean: 3 }, 'snap'), beat(1400, { headY: 0, lean: 0 }, 'pop', { expr: 'idle' })], 'pop');
    // peek-a-boo: eyes squeezed shut, then wide open with a sparkle
    case 3: return end([beat(0, { lidL: 0.06, lidR: 0.06, sy: 0.94, headY: 1.5 }, 'snap', { mouth: 'w' }), beat(500, { lidL: 1, lidR: 1, sy: 1.06, headY: -1, sparkle: 0.8 }, 'snap', { expr: 'surprised', mouth: 'o' }), beat(750, { sy: 1, headY: 0, sparkle: 0 }, 'pop', { expr: 'happy', mouth: 'grin' }), cue(1200, { expr: 'idle', mouth: 'smile' })], 'pop');
    // bounce, bounce, float: two quick little hops and a long stretch up
    case 0: return end([beat(0, { sy: 0.95 }, 'snap'), beat(80, { sy: 1.03 }, 'snap', { hop: { h: 4, land: 0.07 } }), beat(260, { sy: 1 }, 'snap', { hop: { h: 4, land: 0.07 } }), beat(560, { sy: 1.08, headY: -1.2 }, 'float', { mouth: 'o' }), beat(1100, { sy: 1, headY: 0 }, 'pop', { mouth: 'smile' })], 'pop');
    // a happy shimmy
    default: return end([beat(0, {}, 'pop', { osc: [osc('x', 2, 5, 800), osc('headTilt', 3, 5, 800)], expr: 'happy', mouth: 'grin' }), cue(850, { expr: 'idle', mouth: 'smile' })], 'pop');
  }
}
