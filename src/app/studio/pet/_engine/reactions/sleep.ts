/**
 * Rest (brief §2.6): the yawn (0–900), the drift off (lids 0.6 → nod → catch 0.75 → 0.3 → 0, `sleepy` steps
 * 700 apart), dream twitches, a poke while asleep ("Five more minutes…"), waking (eyes open 120 ms apart, double
 * blink, a stretch and a mini yawn; grumpy brows when Energy is low), and dozing off after 90 s idle. The
 * asleep loop itself (deep breath, Z marks, floppy ears, dim lights) is the engine's state.
 */

import type { Beat, EventOf, Reaction } from '../types';
import { beat, browsOn, burst, coin, cue, eared, end, osc, side, variant } from './util';

/** Yawn: stretch sy 1.07 (float), mouth opens over 400, eyes squeezed, a tiny tear 30 % of the time. */
export const yawn: Reaction<EventOf<'yawn'>> = (_e, ctx) => {
  const v = variant(ctx, 'yawn');
  const tear = coin(ctx, 0.3);
  const beats: Beat[] = [
    beat(0, { sy: 1.07, headY: -1.5 }, 'float', { haptic: 'soft', blink: 'suppress' }),
    // the shiver at the top of the yawn
    beat(420, {}, 'float', { osc: osc('sx', 0.012, 9, 240) }),
    cue(60, { mouth: 'yawn', expr: 'squeeze' }),
    ...(tear ? [cue(500, { particles: burst('tear', 1, side(ctx) < 0 ? 'eyeL' : 'eyeR') })] : []),
    ...(v === 1 ? [beat(100, { headTilt: 6 * side(ctx) }, 'float')] : v === 2 && eared(ctx) ? [beat(100, { earDroop: 14 }, 'float')] : []),
    ...(v === 0 ? [beat(200, {}, 'float', { osc: osc('rot', 1.5, 1.2, 700) })] : []),
    // the exhale lets it all go: a slump, then back up slowly
    beat(650, { sy: 0.95, headY: 1 }, 'pop', { springs: { headY: 'float' }, mouth: 'sleep', expr: 'idle' }),
    beat(950, { sy: 1, headY: 0, headTilt: 0, earDroop: 0 }, 'sleepy', { mouth: 'X', blink: 'allow' }),
  ];
  return end(beats, 'sleepy');
};

/** Drift off (after the yawn, 900–3200): lids 0.6 → a 4° nod → catch at 0.75 → 0.3 → 0, 700 ms apart. */
export const sleep: Reaction<EventOf<'sleep'>> = (_e, ctx) => {
  const v = variant(ctx, 'sleep');
  const nod = v === 1 ? -4 : 4;
  const beats: Beat[] = [
    beat(0, { lidL: 0.6, lidR: 0.6 }, 'sleepy', { blink: 'suppress', mouth: 'X' }),
    beat(700, { headTilt: nod, headY: 1.5, y: 1 }, 'sleepy'),
    // the catch: a little jolt back up
    beat(1400, { lidL: 0.75, lidR: 0.75, headTilt: 0, headY: 0, sy: 1.02 }, 'snap'),
    beat(1500, { sy: 1 }, 'sleepy'),
    beat(2100, { lidL: 0.3, lidR: 0.3, headTilt: nod * 0.6, headY: 1 }, 'sleepy'),
    ...(v === 2 ? [beat(2400, { lidL: 0.5, lidR: 0.5 }, 'snap'), beat(2600, { lidL: 0.25, lidR: 0.25 }, 'sleepy')] : []),
    beat(2800, { lidL: 0.06, lidR: 0.06, headTilt: nod * 0.3 }, 'sleepy', { mouth: 'sleep' }),
    cue(3200, { expr: 'sleeping' }),
  ];
  return end(beats, 'sleepy');
};

/** Dream twitch (every 20–40 s asleep): an ear flick, a sleepy smile, or a tiny "mm". */
export const dream: Reaction<EventOf<'dream'>> = (_e, ctx) => {
  const v = variant(ctx, 'dream');
  if (v === 0 && eared(ctx)) return end([beat(0, { earR: -10 }, 'eye'), beat(90, { earR: 0 }, 'pop')], 'jelly');
  if (v === 1) return end([cue(0, { mouth: 'smile' }), beat(0, { blush: 0.35 }, 'float'), beat(1200, { blush: 0 }, 'sleepy', { mouth: 'sleep' })], 'sleepy');
  return end([beat(0, { sy: 0.98, headTilt: 2 * side(ctx) }, 'snap', { mouth: 'A' }), beat(160, { sy: 1 }, 'jelly'), beat(600, { headTilt: 0 }, 'sleepy', { mouth: 'sleep' })], 'sleepy');
};

/** Poked asleep (1st tap): one eye opens to 0.4 for 300 → closes, an "mm" squash, no hop; "Five more minutes…". */
export const sleepPoke: Reaction<EventOf<'sleepPoke'>> = (_e, ctx) => {
  const v = variant(ctx, 'sleepPoke');
  const open = v === 1 ? { lidL: 0.06, lidR: 0.4 } : { lidL: 0.4, lidR: 0.06 };
  return end([
    beat(0, { ...open, sy: 0.96 }, 'snap', { expr: 'idle', haptic: 'light', mouth: 'A', springs: { sy: 'eye' } }),
    beat(120, { sy: 1 }, 'jelly', { say: 'fiveMore' }),
    ...(v === 2 ? [beat(150, { headTilt: 4 * side(ctx) }, 'sleepy')] : []),
    beat(300, { lidL: 0.06, lidR: 0.06 }, 'sleepy'),
    cue(700, { expr: 'sleeping', mouth: 'sleep' }),
    beat(900, { headTilt: 0 }, 'sleepy'),
  ], 'sleepy');
};

/** Wake: eyes open 120 ms apart → double blink → stretch sy 1.06 (400) + a mini yawn; grumpy brows if tired. */
export const wake: Reaction<EventOf<'wake'>> = (e, ctx) => {
  const v = variant(ctx, 'wake');
  const first = v === 1 ? 'lidR' : 'lidL', second = v === 1 ? 'lidL' : 'lidR';
  const beats: Beat[] = e.from === 'doze'
    // a doze: startled awake (pupils snap small, a double blink)
    ? [
        beat(0, { lidL: 1.05, lidR: 1.05, pupil: 0.75, sy: 1.05 }, 'eye', { expr: 'surprised', haptic: 'light', blink: 'double', springs: { sy: 'snap' } }),
        beat(240, { pupil: 1, sy: 1 }, 'pop', { expr: 'idle' }),
        beat(600, { lidL: 1, lidR: 1 }, 'float'),
      ]
    : [
        beat(0, { lidL: 0.06, lidR: 0.06 }, 'eye', { expr: 'idle', haptic: 'light' }),
        beat(60, { [first]: 1 }, 'snap'),
        beat(180, { [second]: 1 }, 'snap'),
        cue(330, { blink: 'double' }),
        beat(400, { sy: 1.06, headY: -1 }, 'float', { mouth: 'yawn' }),
        beat(800, { sy: 1, headY: 0 }, 'float', { mouth: 'X' }),
        ...(v === 2 ? [beat(820, {}, 'pop', { osc: osc('rot', 2, 5, 400) })] : []),
      ];
  if (e.grumpy) {
    beats.push(cue(850, { expr: 'grumpy', mouth: 'A' }));
    if (browsOn(ctx)) beats.push(beat(850, { browInner: -2 }, 'float'), beat(2050, { browInner: 0 }, 'float'));
    beats.push(cue(2050, { expr: 'idle', mouth: 'X' }));
  }
  return end(beats, 'float');
};

/** 90 s without input: dozes (the sleeping face, not real sleep; no Energy change). */
export const doze: Reaction<EventOf<'doze'>> = (_e, ctx) => {
  const v = variant(ctx, 'doze');
  return end([
    beat(0, { lidL: 0.6, lidR: 0.6 }, 'sleepy', { blink: 'suppress' }),
    beat(800, { headTilt: [3, -3, 2][v], headY: 1, lidL: 0.3, lidR: 0.3 }, 'sleepy'),
    ...(v === 2 ? [beat(1300, { lidL: 0.55, lidR: 0.55 }, 'snap'), beat(1500, { lidL: 0.3, lidR: 0.3 }, 'sleepy')] : []),
    beat(1900, { lidL: 0.06, lidR: 0.06 }, 'sleepy'),
    cue(2300, { expr: 'sleeping', mouth: 'sleep' }),
  ], 'sleepy');
};
