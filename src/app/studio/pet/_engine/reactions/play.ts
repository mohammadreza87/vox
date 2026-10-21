/**
 * Bop (brief §2.7): the round's start (or a tired half-hearted bounce), the crouch-and-jump when the ball comes
 * in reach, the head bop, a miss ("aww"), and the round's end (a win celebrates; three misses go sad-but-cute,
 * then a brave hop; a round that simply ran its 10 s is a happy "that was fun").
 */

import type { Beat, EventOf, Reaction } from '../types';
import { celebrate } from './celebrate';
import { sad } from './mood';
import { beat, browsOn, burst, cue, eared, end, jiggle, laugh, osc, squashX, variant } from './util';

export const playStart: Reaction<EventOf<'playStart'>> = (e, ctx) => {
  const v = variant(ctx, 'playStart');
  if (e.tired) {
    // half-hearted: a tiny bounce, a yawn, "Nap first?"
    return end([
      beat(0, { sy: 0.97, lidL: 0.8, lidR: 0.8 }, 'float', { look: 'ball' }),
      beat(120, { sy: 1 }, 'snap', { hop: { h: [4, 3, 5][v], land: 0.06 } }),
      beat(420, { sy: 1.06 }, 'float', { mouth: 'yawn', expr: 'squeeze', haptic: 'soft' }),
      beat(1000, { sy: 0.98 }, 'float', { mouth: 'smile', expr: 'idle', say: 'napFirst', look: 'user' }),
      beat(1500, { sy: 1, lidL: 1, lidR: 1 }, 'sleepy'),
    ], 'sleepy');
  }
  return end([
    beat(0, { sy: 1.05, pupil: 1.1 }, 'snap', { expr: 'surprised', mouth: 'o', look: 'ball', haptic: 'light' }),
    ...(eared(ctx) ? [beat(0, { earL: 10, earR: -10 }, 'snap')] : []),
    beat(220, { sy: 0.95 }, 'float', { expr: 'happy', mouth: 'grin' }),
    ...(v === 1 ? [beat(240, {}, 'pop', { osc: osc('rot', 2, 3, 600) })] : v === 2 ? [beat(240, { headTilt: 5 }, 'float')] : []),
    beat(700, { sy: 0.98, earL: 4, earR: -4, headTilt: 0 }, 'float', { expr: 'idle', mouth: 'o' }),
  ], 'pop');
};

/** Ball in reach: a deep crouch (sy 0.84, ears back), then a jump stretched tall (sy 1.18), eyes sparkling on it. */
export const ballNear: Reaction<EventOf<'ballNear'>> = (_e, ctx) => {
  const v = variant(ctx, 'ballNear');
  return end([
    beat(0, { sy: 0.84, pupil: 1.12, sparkle: 0.8 }, 'snap', { look: 'ball', mouth: 'o', expr: 'surprised' }),
    ...(eared(ctx) ? [beat(0, { earL: -10, earR: 10 }, 'snap'), beat(120, { earL: 12, earR: -12 }, 'snap'), beat(420, { earL: 0, earR: 0 }, 'jelly')] : []),
    beat(120, { sy: 1.18 }, 'snap', { hop: { h: [26, 30, 24][v], land: 0.14 }, mouth: 'grin' }),
    ...(v === 2 ? [beat(120, { headTilt: 8 }, 'snap'), beat(420, { headTilt: 0 }, 'pop')] : []),
    // round again by the apex (the hang); the fall's velocity stretch and the landing squash take it from there
    beat(220, { sy: 1 }, 'pop'),
    beat(700, { pupil: 1, sparkle: 0 }, 'float', { expr: 'idle' }),
  ], 'jelly');
};

/** Bop: a head squash 0.8 with a 50 ms hit-stop and stars, a rebound past round, a jelly ring-out, happy. */
export const bop: Reaction<EventOf<'bop'>> = (e, ctx) => {
  const v = variant(ctx, 'bop');
  return end([
    beat(0, { sy: 0.8, headY: 2, rot: -e.nx * 6 }, 'eye', { hitStop: 50, haptic: 'light', expr: 'squeeze', mouth: 'grin', particles: burst('sparkle', 4, 'head') }),
    beat(90, { sy: 1.12, headY: -1, rot: 0 }, 'snap', { expr: 'happy' }),
    beat(180, { sy: 1, headY: 0 }, 'jelly', { osc: jiggle(ctx, 0.06, 4.5, 650) }),
    ...laugh(90, 360, 8, 0.5),
    ...(eared(ctx) ? [beat(0, { earL: v === 1 ? -16 : -10, earR: v === 1 ? 16 : 10 }, 'eye'), beat(90, { earL: 0, earR: 0 }, 'jelly')] : []),
    ...(v === 2 ? [beat(60, { blush: 0.7 }, 'float'), beat(700, { blush: 0 }, 'float')] : []),
    cue(320, { look: 'ball' }),
  ], 'jelly');
};

/**
 * Miss: an exaggerated "oops!" (a jolt up, eyes huge on the ball as it gets away, brows shot up), then the "aww"
 * shrug (squashed wide, ears down, mouth E, brows up-in), a little head shake, back to it.
 */
export const miss: Reaction<EventOf<'miss'>> = (_e, ctx) => {
  const v = variant(ctx, 'miss');
  const beats: Beat[] = [
    beat(0, { sy: 1.12, headY: -2, pupil: 1.22 }, 'snap', { look: 'ball', mouth: 'o', expr: 'surprised', haptic: 'soft' }),
    ...(browsOn(ctx) ? [beat(0, { browL: 2.4, browR: 2.4 }, 'snap'), beat(220, { browL: 0, browR: 0, browInner: 2.4 }, 'float')] : []),
    ...(eared(ctx) ? [beat(0, { earL: 12, earR: -12 }, 'snap'), beat(220, { earL: 0, earR: 0, earDroop: 18 }, 'float')] : []),
    // the shrug: wide and low, the "aww"
    beat(220, { ...squashX(ctx, 1.1), headY: 1.5, pupil: 1.1 }, 'pop', { mouth: 'E', expr: 'sad', say: 'aww' }),
    ...(v === 0 ? [beat(320, {}, 'pop', { osc: osc('headTilt', 7, 3, 600) })] : v === 1 ? [beat(320, { headTilt: 8 }, 'float')] : [cue(360, { blink: 'slow' })]),
    beat(850, { sx: 1, sy: 1, headY: 0, browInner: 0, earDroop: 0, headTilt: 0, pupil: 1 }, 'float', { mouth: 'X', expr: 'idle' }),
  ];
  return end(beats, 'float');
};

/**
 * The round ends: ≥ 5 bops celebrate; three misses go sad-but-cute, then the brave little hop (the only time play
 * may look sad, §2.6). Anything else is the user doing just what was asked: a content "that was fun", a small
 * happy hop with a smile and a blush, never a guilt cue.
 */
export const playEnd: Reaction<EventOf<'playEnd'>> = (e, ctx) => {
  if (e.won) return celebrate({ type: 'celebrate', why: 'win' }, ctx);
  if (e.misses >= 3) return sad({ type: 'sad' }, ctx);
  const v = variant(ctx, 'playEnd');
  return end([
    beat(0, { sy: 0.88 }, 'snap', { expr: 'happy', mouth: 'grin', look: 'user' }),
    beat(110, { sy: 1.1 }, 'snap', { hop: { h: [14, 16, 12][v], land: 0.14 }, haptic: 'light' }),
    beat(160, { blush: 0.7 }, 'float'),
    beat(500, {}, 'jelly', { osc: jiggle(ctx, 0.05, 4.5, 600) }),
    ...(v === 1 ? [beat(420, { headTilt: 6 }, 'float')] : v === 2 ? [beat(380, {}, 'pop', { particles: burst('heart', 2, 'head') })] : [beat(380, {}, 'pop', { mouth: 'grin' })]),
    ...(eared(ctx) ? [beat(110, { earL: 8, earR: -8 }, 'snap'), beat(500, { earL: 0, earR: 0 }, 'jelly')] : []),
    beat(1000, { sy: 1, headTilt: 0, blush: 0 }, 'float', { expr: 'idle', mouth: 'X' }),
  ], 'jelly');
};
