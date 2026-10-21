/**
 * Bop (brief §2.7): the round's start (or a tired half-hearted bounce), the crouch-and-jump when the ball comes
 * in reach, the head bop, a miss ("aww"), and the round's end (a win celebrates; three misses go sad-but-cute,
 * then a brave hop; a round that simply ran its 10 s is a happy "that was fun").
 */

import type { Beat, EventOf, Reaction } from '../types';
import { celebrate } from './celebrate';
import { sad } from './mood';
import { beat, browsOn, burst, cue, eared, end, osc, squashX, variant } from './util';

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

/** Ball in reach: crouch 120 ms (sx 1.08 / sy 0.9, snap), then jump with a sy 1.1 stretch. */
export const ballNear: Reaction<EventOf<'ballNear'>> = (_e, ctx) => {
  const v = variant(ctx, 'ballNear');
  return end([
    beat(0, { sy: 0.9 }, 'snap', { look: 'ball', mouth: 'o' }),
    beat(120, { sy: 1.1 }, 'snap', { hop: { h: [24, 27, 22][v], land: 0.12 } }),
    ...(v === 2 ? [beat(120, { headTilt: 6 }, 'snap'), beat(420, { headTilt: 0 }, 'pop')] : []),
    beat(300, { sy: 1 }, 'pop'),
  ], 'jelly');
};

/** Bop: a head squash 0.88 with a 40 ms hit-stop, happy. */
export const bop: Reaction<EventOf<'bop'>> = (e, ctx) => {
  const v = variant(ctx, 'bop');
  return end([
    beat(0, { sy: 0.88, rot: -e.nx * 4 }, 'eye', { hitStop: 40, haptic: 'light', expr: 'happy', mouth: 'grin', particles: burst('sparkle', 2, 'head') }),
    beat(80, { sy: 1.05, rot: 0 }, 'jelly'),
    ...(v === 1 && eared(ctx) ? [beat(0, { earL: -10, earR: 10 }, 'eye'), beat(80, { earL: 0, earR: 0 }, 'jelly')] : []),
    ...(v === 2 ? [beat(60, { blush: 0.4 }, 'float'), beat(600, { blush: 0 }, 'float')] : []),
    beat(260, { sy: 1 }, 'jelly', { look: 'ball' }),
  ], 'jelly');
};

/** Miss: eyes follow the ball away, "aww" (brows up-in, mouth E, a shrug sx 1.04) 300 ms. */
export const miss: Reaction<EventOf<'miss'>> = (_e, ctx) => {
  const v = variant(ctx, 'miss');
  const beats: Beat[] = [
    beat(0, { ...squashX(ctx, 1.04), headY: 1 }, 'snap', { look: 'ball', mouth: 'E', expr: 'sad', say: 'aww' }),
    ...(browsOn(ctx) ? [beat(0, { browInner: 2 }, 'snap')] : []),
    ...(eared(ctx) ? [beat(0, { earDroop: 12 }, 'float')] : []),
    ...(v === 1 ? [beat(120, { headTilt: 6 }, 'float')] : v === 2 ? [cue(150, { blink: 'slow' })] : []),
    beat(300, { sx: 1, sy: 1, headY: 0, browInner: 0, earDroop: 0, headTilt: 0 }, 'float', { mouth: 'X', expr: 'idle' }),
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
    beat(0, { sy: 0.93 }, 'snap', { expr: 'happy', mouth: 'smile', look: 'user' }),
    beat(110, { sy: 1.05 }, 'snap', { hop: { h: [9, 11, 8][v], land: 0.1 }, haptic: 'light' }),
    beat(160, { blush: 0.6 }, 'float'),
    ...(v === 1 ? [beat(420, { headTilt: 6 }, 'float')] : v === 2 ? [beat(380, {}, 'pop', { particles: burst('heart', 2, 'head') })] : [beat(380, {}, 'pop', { mouth: 'grin' })]),
    ...(eared(ctx) ? [beat(110, { earL: 8, earR: -8 }, 'snap'), beat(500, { earL: 0, earR: 0 }, 'jelly')] : []),
    beat(1000, { sy: 1, headTilt: 0, blush: 0 }, 'float', { expr: 'idle', mouth: 'X' }),
  ], 'jelly');
};
