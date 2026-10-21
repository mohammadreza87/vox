/**
 * Open moments (brief §1.1, §1.2, §2.6): hello after `ready()`, welcome back after a day away (a surprised
 * freeze, a double hop with sparkles, then the souvenir line), and the stage-up celebration (the engine tweens
 * the body path from the old stage while this plays).
 */

import type { Beat, EventOf, Reaction } from '../types';
import { celebrate } from './celebrate';
import { beat, burst, cue, end, eared, hopMs, osc, variant } from './util';

/** Pop-in: squash 0.85 → stretch 1.08 (snap, 80) → settle (pop), a hop, happy arcs ~600 ms, "Hi {name}!". */
export const hello: Reaction<EventOf<'hello'>> = (_e, ctx) => {
  const v = variant(ctx, 'hello');
  const beats: Beat[] = [
    beat(0, { sy: [0.85, 0.88, 0.86][v] }, 'eye', { haptic: 'light' }),
    beat(80, { sy: [1.08, 1.1, 1.06][v] }, 'snap', { expr: 'happy', mouth: 'grin', blink: 'suppress' }),
    // takes off on the stretch (not after holding it on the ground)
    beat(140, { sy: 1 }, 'pop', { hop: { h: [20, 16, 14][v], land: 0.12 }, say: 'hi' }),
  ];
  const land = 140 + hopMs([20, 16, 14][v]);
  if (v === 1) beats.push(beat(land + 60, {}, 'pop', { hop: { h: 8, land: 0.08 }, particles: burst('sparkle', 3, 'head') }), beat(land, {}, 'jelly', { osc: osc('rot', 4, 3.2, 700) }));
  if (v === 2) beats.push(beat(120, { headTilt: 6 }, 'float', { blink: 'allow' }), cue(land + 80, { blink: 'double' }), beat(land + 300, { headTilt: 0 }, 'float'));
  if (v === 0 && eared(ctx)) beats.push(beat(80, { earL: 10, earR: -10 }, 'snap'), beat(land, { earL: 0, earR: 0 }, 'jelly'));
  beats.push(cue(620, { expr: 'idle', mouth: 'smile' }));
  return end(beats, 'jelly');
};

/** Away > 24 h: surprised freeze 120 → double hop + 6 sparkles → souvenir bubble (total ~1200). */
export const welcomeBack: Reaction<EventOf<'welcomeBack'>> = (e, ctx) => {
  const v = variant(ctx, 'welcomeBack');
  const kind = v === 1 ? 'heart' : 'sparkle';
  const beats: Beat[] = [
    beat(0, { sy: 1.05, pupil: 1.12 }, 'eye', { expr: 'surprised', mouth: 'o', blink: 'suppress' }),
    beat(120, { sy: 0.9 }, 'snap', { haptic: 'success' }),
    beat(230, { sy: 1.06, pupil: 1.12 }, 'snap', { hop: { h: 16, land: 0.13 }, expr: 'happy', mouth: 'grin', particles: burst(kind, 6, 'head') }),
    beat(230 + hopMs(16) + 70, { sy: 1.04 }, 'snap', { hop: { h: 11, land: 0.1 } }),
    cue(1000, { say: { text: e.souvenir }, expr: 'idle', mouth: 'smile', blink: 'allow' }),
    beat(1200, { sy: 1, pupil: 1 }, 'jelly'),
  ];
  if (v === 0 && eared(ctx)) beats.push(beat(0, { earL: 12, earR: -12 }, 'eye'), beat(700, { earL: 0, earR: 0 }, 'jelly'));
  if (v === 2) beats.push(beat(230, { rot: 360 }, 'float'));
  return end(beats, 'jelly');
};

/** Stage-up: the celebration with the glow and "I learned something new!" (the body tween is the engine's). */
export const stageUp: Reaction<EventOf<'stageUp'>> = (_e, ctx) => celebrate({ type: 'celebrate', why: 'stage' }, ctx);
