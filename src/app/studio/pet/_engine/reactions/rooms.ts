/**
 * The engine's lazily loaded motion (design §10.3–§10.5, §3.1): the room transition, each room's idle beat and
 * reactions by their final names, lighting a growth moment, the settle float and the four moves lit moments
 * unlock. Its own chunk (§10.7): the engine preloads it a few seconds after start, off the first paint. Pure like
 * the reactions: `(ctx, …) → Beat[]`, randomness only through ctx.rng.
 */

import type { Beat, ReactionCtx, Room, RoomReaction } from '../types';
import { celebrate } from './celebrate';
import { beat, burst, cue, end, jiggle, osc, side, squashX } from './util';

/** Room transition timing (§10.5): counter-lean, then lean with the slide (the backdrop swaps at the top), settle. */
const RT = { counterMs: 60, swapMs: 150, settleMs: 200, totalMs: 300, counterDeg: 3, leanDeg: 6, lift: 2.5, reducedMs: 160 } as const;

/** Each room's idle beat (§10.4): what the scheduler plays there between the mood's own beats. */
export function roomIdle(ctx: ReactionCtx, room: Room): Beat[] {
  const s = side(ctx);
  switch (room) {
    // ready bounce, eyes on the toy
    case 'play': return end([
      beat(0, { sy: 0.97 }, 'snap', { look: 'ball' }),
      beat(110, { sy: 1.025 }, 'pop', { osc: osc('sy', 0.02, 3, 700) }),
      beat(260, { sy: 1 }, 'pop'),
      cue(900, { look: 'user' }),
    ], 'pop');
    // hovering over the pot, a slow bob; now and then it looks up at the sky (the rain to come)
    case 'garden': return end([
      beat(0, {}, 'float', { osc: osc('y', 1.6, 0.7, 1600) }),
      beat(200, { gazeY: -0.7, gazeX: 0.2 * s }, 'eye', { blink: 'slow' }),
      beat(260, { headY: -1.2 }, 'float'),
      beat(1300, { gazeY: 0, gazeX: 0, headY: 0 }, 'float'),
    ], 'float');
    // a glance at the mirror, a little preen
    case 'closet': return end([
      beat(0, { gazeX: 0.7 * s, gazeY: -0.1 }, 'eye'),
      beat(70, { headTilt: 4 * s }, 'float'),
      beat(450, {}, 'pop', { osc: osc('rot', 2.5, 4, 450), mouth: 'smile' }),
      beat(1100, { gazeX: 0, gazeY: 0, headTilt: 0 }, 'float', { mouth: 'X' }),
    ], 'float');
    // a slow yawn with heavy lids
    case 'bedroom': return end([
      beat(0, { sy: 1.05, headY: -1, lidL: 0.85, lidR: 0.85 }, 'float', { mouth: 'yawn', expr: 'squeeze' }),
      beat(700, { sy: 0.98, headY: 0.5 }, 'sleepy', { mouth: 'X', expr: 'idle' }),
      cue(900, { blink: 'slow' }),
      beat(1400, { sy: 1, headY: 0, lidL: 1, lidR: 1 }, 'sleepy'),
    ], 'sleepy');
    // reading: the eyes run along a line and back
    case 'book': return end([
      beat(0, { gazeX: -0.45, gazeY: 0.5 }, 'eye'),
      beat(500, { gazeX: 0.45 }, 'float'),
      beat(950, { gazeX: -0.45, gazeY: 0.6 }, 'eye', { blink: 'once' }),
      beat(1400, { gazeX: 0, gazeY: 0 }, 'float'),
    ], 'float');
    default: return end([beat(0, { headTilt: 3 * s }, 'float'), beat(1100, { headTilt: 0 }, 'float')], 'float');
  }
}

/** The room reactions (§10.4): final names; Play, Garden, Closet, Bedroom and Life Book call these. */
export function roomReaction(ctx: ReactionCtx, kind: RoomReaction, o: { won?: boolean } = {}): Beat[] {
  const s = side(ctx);
  switch (kind) {
    // Starfall: a catch is a chomp squash with a sparkle
    case 'catch': return end([
      beat(0, { sy: 0.86, puff: 0.6 }, 'eye', { mouth: 'chew', expr: 'happy', haptic: 'light', particles: burst('sparkle', 2, 'mouth'), blink: 'suppress' }),
      beat(90, { sy: 1.08 }, 'snap'),
      beat(180, { sy: 1, puff: 0 }, 'pop', { osc: jiggle(ctx, 0.04, 5, 400) }),
      cue(420, { expr: 'idle', mouth: 'smile', blink: 'allow' }),
    ], 'pop');
    // a miss is a glance after the star, never a frown
    case 'nearMiss': return end([
      beat(0, { gazeX: 0.65 * s, gazeY: 0.55, sy: 1.04 }, 'eye', { springs: { sy: 'snap' }, mouth: 'o', expr: 'surprised' }),
      beat(80, { headTilt: 5 * s }, 'float'),
      beat(500, { gazeX: 0, gazeY: 0, headTilt: 0, sy: 1 }, 'float', { expr: 'idle', mouth: 'smile', look: 'user' }),
    ], 'float');
    // round end: a win celebrates; otherwise a shrug-smile (wide, a tilt, a smile: never sad)
    case 'roundEnd':
      if (o.won) return celebrate({ type: 'celebrate', why: 'win' }, ctx);
      return end([
        beat(0, { ...squashX(ctx, 1.06), headTilt: 6 * s }, 'pop', { mouth: 'smile', expr: 'happy', look: 'user' }),
        beat(160, {}, 'pop', { osc: osc('headTilt', 3, 3, 500) }),
        beat(750, { sx: 1, sy: 1, headTilt: 0 }, 'float', { expr: 'idle' }),
      ], 'float');
    // Garden rain: rise and darken a little, drops fall, a relief shake, then lighter and fluffed
    case 'rain': return end([
      beat(0, { sy: 0.95 }, 'snap'),
      beat(90, { y: -10, sy: 1.04, dim: 0.12, lidL: 0.85, lidR: 0.85 }, 'float', { springs: { dim: 'sleepy' }, mouth: 'o' }),
      cue(420, { particles: burst('tear', 3, 'body') }),
      cue(700, { particles: burst('tear', 3, 'body') }),
      cue(980, { particles: burst('tear', 3, 'body') }),
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
      beat(0, { headY: 1.4, lidL: 0.85, lidR: 0.85 }, 'float', { mouth: 'smile' }),
      beat(420, { headY: 0 }, 'sleepy'),
      beat(800, { lidL: 1, lidR: 1 }, 'sleepy'),
    ], 'sleepy');
    // Life Book: the page turns, the eyes follow it over
    case 'pageFlip': return end([
      beat(0, { gazeX: 0.6 * s, gazeY: 0.3 }, 'eye', { blink: 'once' }),
      beat(60, { headX: 0.8 * s }, 'float'),
      beat(380, { gazeX: -0.3 * s, gazeY: 0.5 }, 'eye'),
      beat(800, { gazeX: 0, gazeY: 0, headX: 0 }, 'float'),
    ], 'float');
    // its own drawing: a little hop and a blush
    case 'ownDrawing': return end([
      beat(0, { pupil: 1.1, blush: 0.6 }, 'snap', { expr: 'happy', mouth: 'grin', springs: { blush: 'float' } }),
      beat(120, { sy: 1 }, 'snap', { hop: { h: 7, land: 0.1 } }),
      beat(900, { pupil: 1, blush: 0 }, 'float', { expr: 'idle', mouth: 'smile' }),
    ], 'jelly');
  }
}

/**
 * Room change (§10.5, 300 ms): the eyes lead toward where the room goes, a 60 ms counter-lean against the slide
 * (anticipation), then the lean with it on an arc (a little lift: never a straight line), a blink as the backdrop
 * swaps, and a settle with one overshoot. `dir` 1: the new room is to the right (the backdrop slides left).
 */
export function roomLeave(_ctx: ReactionCtx, dir: -1 | 1): Beat[] {
  const s = dir;
  return end([
    beat(0, { gazeX: s * 0.45, lean: -s * RT.counterDeg, sy: 0.97 }, 'snap', { springs: { gazeX: 'eye' } }),
    beat(RT.counterMs, { lean: s * RT.leanDeg, y: -RT.lift, sy: 1.03, headX: s * 0.8 }, 'snap', { springs: { y: 'pop', headX: 'float' } }),
    cue(RT.swapMs - 20, { blink: 'once' }),
    beat(RT.settleMs, { lean: 0, y: 0, sy: 1, headX: 0, gazeX: 0 }, 'pop'),
  ], 'pop');
}

/**
 * Lighting a growth moment (§10.3, ~1.2 s): the pet looks up as if remembering (the eyes lead, the head follows,
 * a slow blink), a soft glow swells, the new detail arrives with one overshoot (the UI fades it in on the
 * `litPeak` cue at 600 ms), then a small nod. Never confetti.
 */
export function growthLit(ctx: ReactionCtx): Beat[] {
  const s = side(ctx);
  return end([
    beat(0, { gazeY: -0.65, gazeX: 0.3 * s }, 'eye'),
    beat(70, { headY: -1.4, headTilt: 3 * s }, 'float'),
    beat(150, { glow: 0.8 }, 'float'),
    cue(240, { blink: 'slow' }),
    beat(600, { sy: 1.04, pupil: 1.1, sparkle: 0.6 }, 'pop', { expr: 'happy', mouth: 'smile', springs: { sparkle: 'snap' } }),
    beat(860, { gazeX: 0, gazeY: 0, headTilt: 0, headY: 1.4, sy: 1 }, 'snap'),
    beat(1000, { headY: 0 }, 'pop'),
    beat(1050, { glow: 0, pupil: 1, sparkle: 0 }, 'sleepy', { expr: 'idle' }),
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
