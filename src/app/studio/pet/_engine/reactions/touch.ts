/**
 * Touch (brief §2.6): pokes by zone, pet/stroke, tickle, escalation, long-press, drag, fling, walls, landings,
 * a shaken phone, and the droopy perk. Contact squash already landed on pointerdown (same frame); these carry
 * the reaction on from wherever it is (retargets keep velocity). Escalations are never scary.
 */

import { landSquash } from '../physics';
import type { Beat, EventOf, Reaction, ReactionCtx } from '../types';
import { beat, browsOn, burst, coin, cue, eared, end, osc, rr, side, squashX, variant, wobble } from './util';

/* ---------- poke ---------- */

const pokeBelly = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = (e.side || side(ctx)) as -1 | 1;
  const more = 1 + 0.08 * Math.min(3, Math.max(0, e.hits - 1));
  const beats: Beat[] = [
    // squash at the touch point (70 ms, already started on contact), hold 40, then the giggle
    beat(0, { sy: 1 - 0.16 * more, x: -s * 1.5 }, 'eye', { expr: 'happy', mouth: 'grin', haptic: 'soft', blink: 'suppress' }),
    beat(110, { sy: 1.06, x: 0 }, 'snap'),
    beat(190, { sy: 1 }, 'jelly'),
  ];
  if (v === 0) beats.push(...wobble(110, [-4.5 * s, 3.6 * s, -2.4 * s, 1.2 * s, 0], 150, 'pop'), cue(215, { particles: burst('heart', 2, 'touch') }));
  if (v === 1) beats.push(beat(140, { sy: 1 }, 'snap', { hop: { h: 9, land: 0.1 } }), cue(240, { particles: burst('heart', 2, 'head') }), ...wobble(420, [3 * s, -2 * s, 0], 140));
  if (v === 2) beats.push(beat(120, {}, 'jelly', { osc: [osc('sx', 0.035, 8, 560), osc('headY', 1.2, 8, 560)], mouth: 'D' }), cue(215, { particles: burst('heart', 2, 'touch') }), ...wobble(300, [-2.5 * s, 2 * s, 0], 160));
  beats.push(cue(820, { expr: 'idle', mouth: 'smile', blink: 'allow' }));
  return end(beats, 'jelly');
};

const pokeEye = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = (e.side || side(ctx)) as -1 | 1;
  // the poked eye shuts in 40 ms, the face recoils 4 px away and rocks 6° (snap) → pop
  const shut = s < 0 ? { lidL: 0.06 } : { lidR: 0.06 };
  const beats: Beat[] = [
    beat(0, { ...shut, x: -s * 4, rot: -s * 6, headX: -s * 1.2, sy: 0.95 }, 'eye', { springs: { x: 'snap', rot: 'snap', sy: 'snap' }, haptic: 'rigid', blink: 'suppress' }),
    beat(60, {}, 'pop', { expr: v === 1 ? 'squeeze' : undefined, mouth: 'A' }),
    // a moving hold while the eye is shut: the body creeps back instead of freezing
    beat(150, { sy: 0.97, rot: -s * 4.5, x: -s * 3 }, 'float'),
    beat(300, { lidL: 1, lidR: 1, x: 0, rot: 0, headX: 0, sy: 1 }, 'pop', { expr: 'offended', blink: 'double' }),
  ];
  if (eared(ctx) && ctx.species === 'cat') beats.push(beat(0, { earDroop: 15 }, 'snap'), beat(700, { earDroop: 0 }, 'float'));
  if (browsOn(ctx)) beats.push(beat(300, { browInner: -2, browL: -0.6, browR: -0.6 }, 'snap'));
  if (v === 1) beats.push(beat(320, {}, 'pop', { osc: osc('headTilt', 5, 5, 420) }));
  if (v === 2) beats.push(beat(300, { cheek: 1.12 }, 'snap', { mouth: 'A' }), beat(700, { cheek: 1 }, 'jelly'));
  beats.push(cue(900, { expr: 'idle', mouth: 'X', blink: 'allow' }));
  return end(beats, 'pop');
};

const pokeHead = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = e.side || 0;
  // a head squish from the ground anchor, the ears kicked back by the follower, eyes up at the finger
  const beats: Beat[] = [
    beat(0, { sy: 0.9, headY: 1.5, rot: s * 2 }, 'eye', { haptic: 'light', look: 'finger', mouth: 'o' }),
    beat(0, { earL: -8, earR: 8 }, 'snap'),
    beat(140, { sy: 1.05, headY: 0, rot: 0 }, 'snap', { mouth: 'smile' }),
    beat(220, { sy: 1 }, 'jelly'),
    beat(160, { earL: 0, earR: 0 }, 'jelly'),
  ];
  if (v === 1) beats.push(cue(150, { blink: 'once' }), beat(200, { headTilt: s ? -s * 5 : 5 }, 'float'), beat(560, { headTilt: 0 }, 'float'));
  if (v === 2) beats.push(beat(160, { sy: 1 }, 'snap', { hop: { h: 6, land: 0.08 }, expr: 'happy' }));
  if (browsOn(ctx)) beats.push(beat(0, { browL: 1.4, browR: 1.4 }, 'snap'), beat(500, { browL: 0, browR: 0 }, 'pop'));
  beats.push(cue(520, { look: 'user' }));
  return end(beats, 'jelly');
};

const pokeCheek = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = (e.side || side(ctx)) as -1 | 1;
  // a squished cheek: lean into the finger, the blush comes up, a little giggle
  const beats: Beat[] = [
    beat(0, { sy: 0.93, lean: s * 3, headTilt: s * 5, cheek: 1.1, blush: 0.7 }, 'eye', { springs: { lean: 'snap', headTilt: 'snap', blush: 'float' }, haptic: 'soft', expr: 'happy', mouth: 'w' }),
    beat(130, { sy: 1, cheek: 1 }, 'jelly'),
    beat(500, { lean: 0, headTilt: 0 }, 'float', { expr: 'idle', mouth: 'smile' }),
  ];
  if (v === 1) beats.push(beat(150, {}, 'pop', { osc: osc('rot', 3, 6, 450) }));
  if (v === 2) beats.push(cue(200, { particles: burst('heart', 1, s < 0 ? 'cheekL' : 'cheekR') }));
  beats.push(beat(900, { blush: 0 }, 'float'));
  return end(beats, 'jelly');
};

/** A cooled-off tap: only a small squash (after the 7th hit, for 3 s). */
const pokeSoft = (_e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  variant(ctx, 'poke');
  return end([beat(0, { sy: 0.95 }, 'eye', { mouth: 'A' }), beat(90, { sy: 1 }, 'jelly')], 'jelly');
};

export const poke: Reaction<EventOf<'poke'>> = (e, ctx) => {
  if (e.coolOff) return pokeSoft(e, ctx);
  switch (e.zone) {
    case 'eye': return pokeEye(e, ctx);
    case 'head': return pokeHead(e, ctx);
    case 'cheek': return pokeCheek(e, ctx);
    default: return pokeBelly(e, ctx);
  }
};

/* ---------- pet, tickle, escalation ---------- */

/** Lean into the stroke 2–5° ∝ speed, an sx ripple per pass, bliss lids, the blush rising; purr after 1.2 s. */
export const pet: Reaction<EventOf<'pet'>> = (e, ctx) => {
  const v = variant(ctx, 'pet');
  const k = Math.max(0, Math.min(1, (e.speed - 40) / 660));
  const beats: Beat[] = [
    beat(0, { lean: e.dir * (2.5 + 3.5 * k) }, 'float', { expr: v === 1 ? 'happy' : 'bliss', mouth: 'w', blink: 'suppress', haptic: e.passes % 3 === 0 ? 'select' : undefined }),
    // the head follows the hand a beat later (overlap); the body melts a little under it
    beat(70, { headTilt: e.dir * [3, 5, 2][v] }, 'float'),
    beat(0, { sy: 0.95 }, 'snap'),
    beat(110, { sy: 0.965 }, 'float'),
    beat(0, { blush: Math.min(1, 0.35 + e.passes * 0.18), blushScale: 1.15 }, 'sleepy'),
  ];
  if (e.passes >= 3) beats.push(beat(0, {}, 'pop', { osc: osc('x', 0.4, 22, 1100, false) }));
  if (v === 2 && eared(ctx)) beats.push(beat(0, { earDroop: 10 }, 'float'));
  beats.push(beat(1100, { lean: 0, headTilt: 0, earDroop: 0, sy: 1 }, 'float', { mouth: 'smile' }), beat(1400, { blush: 0, blushScale: 1 }, 'float'));
  return end(beats, 'float');
};

/** Squash pulses (sy 0.92 × 90 each), a giggle fit (rot ±6° @ 7 Hz for 900, little −3 px hops), then happy. */
export const tickle: Reaction<EventOf<'tickle'>> = (_e, ctx) => {
  const v = variant(ctx, 'tickle');
  const hz = [7, 8, 6.5][v];
  const beats: Beat[] = [
    beat(0, { sy: 0.92 }, 'eye', { expr: 'squeeze', mouth: 'D', haptic: 'light', blink: 'suppress' }),
    beat(90, { sy: 1.03 }, 'eye'),
    beat(180, { sy: 0.92 }, 'eye', { haptic: 'light' }),
    beat(270, { sy: 1.02 }, 'eye', { osc: [osc('rot', 6, hz, 900), osc('y', -3, hz * 2, 900)] }),
    beat(390, { sy: 0.93 }, 'eye', { haptic: 'light' }),
    beat(480, { sy: 1 }, 'jelly', { particles: burst(v === 2 ? 'note' : 'heart', 2, 'head') }),
    cue(1170, { expr: 'happy', mouth: 'grin' }),
    cue(2200, { expr: 'idle', mouth: 'smile', blink: 'allow' }),
  ];
  if (v === 1) beats.push(beat(200, { blush: 0.8 }, 'float'), beat(1800, { blush: 0 }, 'float'));
  return end(beats, 'jelly');
};

/** 4–6 hits: a dizzy spin or a giggle fit (1200). 7+: a sneeze or a "hmph" puff, then the 3 s "okay okay". */
export const overpoke: Reaction<EventOf<'overpoke'>> = (e, ctx) => {
  const v = variant(ctx, 'overpoke');
  if (e.level === 'mid') {
    if (v === 1) {
      return end([
        beat(0, { sy: 0.92 }, 'eye', { expr: 'squeeze', mouth: 'D', haptic: 'medium', osc: [osc('rot', 7, 6, 1200), osc('y', -3, 12, 1000)] }),
        beat(120, { sy: 1.02 }, 'jelly', { particles: burst('heart', 3, 'head') }),
        cue(1200, { expr: 'happy', mouth: 'smile' }),
      ], 'jelly');
    }
    return end([
      beat(0, { sy: 0.94 }, 'snap', { haptic: 'medium', expr: 'dizzy', mouth: 'o' }),
      beat(80, { rot: v === 0 ? 360 : -360, sy: 1.05 }, 'pop', { springs: { rot: 'float' }, osc: [osc('gazeX', 0.45, 2.2, 1200, false), osc('gazeY', 0.45, 2.2, 1200, false)] }),
      beat(700, { sy: 1 }, 'jelly', { osc: osc('headTilt', 4, 1.6, 600) }),
      cue(1200, { expr: 'idle', mouth: 'X' }),
    ], 'jelly');
  }
  if (v === 1) {
    // "hmph": a puffed cheek, a turned-away little lean, brows down
    return end([
      beat(0, { cheek: 1.16, lean: -4, headTilt: -6, sy: 1.03 }, 'snap', { expr: 'offended', mouth: 'A', haptic: 'rigid', say: 'hmph', look: 'away' }),
      ...(browsOn(ctx) ? [beat(0, { browInner: -2.2 }, 'snap')] : []),
      beat(600, { cheek: 1, sy: 1 }, 'jelly'),
      cue(1500, { say: 'okayOkay', look: 'user', expr: 'idle', mouth: 'smile' }),
      beat(1600, { lean: 0, headTilt: 0, browInner: 0 }, 'float'),
    ], 'float');
  }
  // the sneeze: an inhale that stretches, then "Achoo!" squash 0.85 → stretch 1.15
  const twice = v === 2;
  const sneeze = (t: number): Beat[] => [
    beat(t, { sy: 1.06, headY: -1.5 }, 'float', { mouth: 'o', expr: 'surprised' }),
    beat(t + 160, { sy: 1.1, headY: -2.5 }, 'snap'),
    beat(t + 330, { sy: 0.85, headY: 2 }, 'eye', { expr: 'squeeze', mouth: 'D', haptic: 'rigid', say: t === 0 ? 'achoo' : undefined, hitStop: 40, particles: burst('sparkle', 3, 'mouth') }),
    beat(t + 420, { sy: 1.15, headY: 0 }, 'snap'),
    beat(t + 560, { sy: 1 }, 'jelly'),
  ];
  return end([
    ...sneeze(0), ...(twice ? sneeze(700) : []),
    cue(twice ? 1500 : 900, { expr: 'idle', mouth: 'X', blink: 'double' }),
    cue(twice ? 1900 : 1300, { say: 'okayOkay' }),
  ], 'jelly');
};

/* ---------- long-press ---------- */

/** SHY: sx 1.035 / sy 0.955, blush 0.5 → 1.32, gaze aside, a little tilt; held while the finger stays. */
export const longPress: Reaction<EventOf<'longPress'>> = (_e, ctx) => {
  const v = variant(ctx, 'longPress');
  const s = [-1, 1, -1][v];
  return end([
    beat(0, { sx: 1.035, sy: 0.955, blush: 1, blushScale: 0.5, lidL: 0.82, lidR: 0.82, headTilt: s * 5, gazeX: s * 0.55, gazeY: 0.5 }, 'float', { springs: { sx: 'snap', sy: 'snap' }, haptic: 'soft', expr: 'shy', mouth: v === 2 ? 'w' : 'smile' }),
    beat(80, { blushScale: 1.32 }, 'float'),
    // a bashful squirm while held (never a frozen pose under the finger)
    beat(200, {}, 'float', { osc: [osc('rot', [0.9, 1.4, 0.9][v], 0.8, 1300), osc('sy', 0.012, 1.6, 1300)] }),
    beat(1400, { blush: 0, blushScale: 1, lidL: 1, lidR: 1, headTilt: 0, gazeX: 0, gazeY: 0 }, 'float', { mouth: 'smile' }),
  ], 'float');
};

/* ---------- drag, fling, walls, landings ---------- */

/** Picked up: stretched along the pull, lifted 8 px, eyes wide, pupils 0.9, an "o". Held until release. */
export const dragStart: Reaction<EventOf<'dragStart'>> = (_e, ctx) => {
  const v = variant(ctx, 'dragStart');
  return [
    beat(0, { sy: 1.08, y: -8, pupil: 0.9, shadow: 0.8 }, 'snap', { expr: 'surprised', mouth: v === 1 ? 'grin' : 'o', haptic: 'light' }),
    ...(eared(ctx) ? [beat(0, { earL: v === 2 ? 10 : 6, earR: v === 2 ? -10 : -6 }, 'snap')] : []),
    ...(browsOn(ctx) ? [beat(0, { browL: 1.5, browR: 1.5 }, 'snap')] : []),
    beat(160, {}, 'pop', { release: 'jelly' }),
  ];
};

/** A fast swing while dragged: a quick "whee". */
export const drag: Reaction<EventOf<'drag'>> = (e, ctx) => {
  const v = variant(ctx, 'drag');
  const s = Math.sign(e.vx) || 1;
  return end([
    beat(0, { headTilt: -s * [4, 6, 3][v] }, 'snap', { mouth: v === 1 ? 'D' : 'grin' }),
    beat(260, { headTilt: 0 }, 'pop'),
  ], 'pop');
};

/** Mid-air: an "o" (a thrown one grins), gaze along the motion; the engine flies it and keeps this while airborne. */
export const fling: Reaction<EventOf<'fling'>> = (e, ctx) => {
  const v = variant(ctx, 'fling');
  return [
    beat(0, { pupil: e.thrown ? 1.08 : 1 }, 'snap', { expr: 'surprised', mouth: e.thrown && v !== 2 ? 'grin' : 'o', haptic: e.thrown ? 'light' : undefined }),
    ...(eared(ctx) ? [beat(0, { earL: 8 + v * 3, earR: -8 - v * 3 }, 'snap')] : []),
    beat(200, {}, 'pop', { release: 'jelly' }),
  ];
};

/** Wall hit: a squash along the normal (sx 0.85), knocked back a touch, eyes squeezed for a moment. */
export const wallHit: Reaction<EventOf<'wallHit'>> = (e, ctx) => {
  const v = variant(ctx, 'wallHit');
  const k = Math.min(1, e.v / 1800);
  return end([
    beat(0, { ...squashX(ctx, 1 - 0.15 * Math.max(0.4, k)), rot: e.nx * 8 * k }, 'eye', { haptic: 'medium', expr: 'squeeze', mouth: v === 2 ? 'o' : 'A', hitStop: 30 }),
    beat(100, { sx: 1, sy: 1, rot: 0 }, 'jelly', { expr: 'surprised' }),
  ], 'jelly');
};

/** Landing: sy = 1 − clamp(v/4000, 0.08, 0.3), a 50 ms hit-stop, jelly; dizzy after a hard one, else a giggle. */
export const land: Reaction<EventOf<'land'>> = (e, ctx) => {
  const v = variant(ctx, 'land');
  const hard = e.v > 2500;
  const beats: Beat[] = [
    beat(0, { sy: landSquash(e.v) }, 'eye', { haptic: hard ? 'heavy' : 'medium', hitStop: 50, expr: 'squeeze', mouth: 'A' }),
    beat(110, { sy: 1 }, 'jelly'),
    beat(220, {}, 'jelly', hard
      ? { expr: 'dizzy', mouth: 'o', osc: [osc('gazeX', 0.4, 2.4, 600, false), osc('gazeY', 0.4, 2.4, 600, false)], particles: burst('sparkle', 3, 'head') }
      : { expr: 'happy', mouth: 'grin', osc: osc('rot', [3, 4, 2.5][v], 6, 500) }),
  ];
  beats.push(cue(hard ? 800 : 640, { expr: 'idle', mouth: 'smile' }));
  return end(beats, 'jelly');
};

/** Shaken phone: jiggle opposite the device (±6 px, f 4 / z 0.2), eyes swirl after 1 s, jelly out, then "hmph". */
export const shake: Reaction<EventOf<'shake'>> = (_e, ctx) => {
  const v = variant(ctx, 'shake');
  return end([
    beat(0, { sy: 0.96 }, 'snap', { haptic: 'rigid', mouth: 'o', expr: 'surprised', osc: [osc('x', 6, 4, 1100), osc('rot', [3, 4, 2][v], 4, 1100), osc('sy', 0.03, 8, 1100)] }),
    beat(1000, { sy: 1.02 }, 'jelly', { expr: 'dizzy', osc: [osc('gazeX', 0.5, 2, 1200, false), osc('gazeY', 0.5, 2, 1200, false)] }),
    beat(2200, { sy: 1, cheek: v === 1 ? 1.14 : 1 }, 'jelly', { expr: 'offended', mouth: 'A', say: 'hmph' }),
    ...(browsOn(ctx) ? [beat(2200, { browInner: -2 }, 'snap')] : []),
    beat(2900, { cheek: 1, browInner: 0 }, 'float', { expr: 'idle', mouth: 'smile' }),
  ], 'float');
};

/** Touched while droopy: perks fully for 3 s (snap), a soft smile. */
export const droopy: Reaction<EventOf<'droopy'>> = (_e, ctx) => {
  const v = variant(ctx, 'droopy');
  return end([
    // the mood's droop is lids 0.7: ×1.43 opens them fully for the perk
    beat(0, { lidL: 1.43, lidR: 1.43, sy: 1.04, y: -1 }, 'snap', { mouth: 'smile', blink: 'double' }),
    ...(v === 0 ? [beat(80, { headTilt: 5 * side(ctx) }, 'float')] : v === 1 ? [beat(60, {}, 'pop', { osc: osc('rot', 2.5, 4, 500) })] : [beat(60, { sy: 1 }, 'snap', { hop: { h: 5, land: 0.08 } })]),
    beat(rr(ctx, 2900, 3100), { lidL: 1, lidR: 1, sy: 1, y: 0, headTilt: 0 }, 'sleepy', { mouth: coin(ctx, 0.5) ? 'X' : 'smile' }),
  ], 'sleepy');
};
