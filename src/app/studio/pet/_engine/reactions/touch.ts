/**
 * Touch (brief §2.6): pokes by zone, pet/stroke, tickle, escalation, long-press, drag, fling, walls, landings,
 * a shaken phone, and the droopy perk. Contact squash already landed on pointerdown (same frame); these carry
 * the reaction on from wherever it is (retargets keep velocity). Escalations are never scary.
 */

import { landSquash } from '../physics';
import type { Beat, EventOf, Reaction, ReactionCtx } from '../types';
import { beat, browsOn, burst, coin, cue, eared, end, jiggle, laugh, osc, rr, side, squashX, variant, wobble } from './util';

/* ---------- poke ---------- */

const pokeBelly = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = (e.side || side(ctx)) as -1 | 1;
  const more = 1 + 0.06 * Math.min(3, Math.max(0, e.hits - 1));
  const beats: Beat[] = [
    // squash at the touch point (already started on contact) with a >_< flinch, then a rebound stretch past round
    // and the jelly ringing out (2–3 clear swings), the giggle on top
    beat(0, { sy: Math.max(0.8, 1 - 0.15 * more), x: -s * 2.5 }, 'eye', { expr: 'squeeze', mouth: 'D', haptic: 'soft', blink: 'suppress' }),
    beat(110, { sy: 1.1, x: 0 }, 'snap', { expr: 'happy', mouth: 'grin' }),
    beat(200, { sy: 1 }, 'jelly', { osc: jiggle(ctx, 0.07, 4.5, 760) }),
  ];
  if (v === 0) beats.push(...wobble(110, [-7 * s, 5.5 * s, -3.5 * s, 1.5 * s, 0], 140, 'pop'), cue(215, { particles: burst('heart', 3, 'touch') }));
  if (v === 1) beats.push(beat(150, { sy: 1 }, 'snap', { hop: { h: 13, land: 0.14 } }), cue(240, { particles: burst('heart', 3, 'head') }), ...wobble(460, [4.5 * s, -3 * s, 0], 140));
  if (v === 2) beats.push(beat(120, {}, 'jelly', { osc: osc('headY', 1.8, 8, 600) }), ...laugh(120, 600, 8, 0.6), cue(215, { particles: burst('heart', 3, 'touch') }), ...wobble(300, [-4 * s, 3 * s, 0], 150));
  beats.push(cue(900, { expr: 'idle', mouth: 'smile', blink: 'allow' }));
  return end(beats, 'jelly');
};

const pokeEye = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = (e.side || side(ctx)) as -1 | 1;
  // the poked eye shuts in 40 ms, the face recoils away and rocks (snap), the body flinches down and wobbles back
  const shut = s < 0 ? { lidL: 0.06 } : { lidR: 0.06 };
  const beats: Beat[] = [
    beat(0, { ...shut, x: -s * 7, rot: -s * 10, headX: -s * 2, sy: 0.88 }, 'eye', { springs: { x: 'snap', rot: 'snap', sy: 'snap' }, haptic: 'rigid', blink: 'suppress', mouth: v === 0 ? 'E' : 'A', expr: v === 1 ? 'squeeze' : undefined }),
    beat(60, {}, 'pop', { expr: v === 1 ? 'squeeze' : undefined }),
    beat(110, { sy: 1.06 }, 'snap'),
    // a moving hold while the eye is shut: the body creeps back, still ringing, instead of freezing
    beat(190, { sy: 1, rot: -s * 6, x: -s * 4.5 }, 'jelly', { osc: jiggle(ctx, 0.05, 5, 600) }),
    beat(360, { lidL: 1, lidR: 1, x: 0, rot: 0, headX: 0 }, 'pop', { expr: 'offended', blink: 'double', mouth: 'A' }),
  ];
  if (eared(ctx) && ctx.species === 'cat') beats.push(beat(0, { earDroop: 24 }, 'snap'), beat(760, { earDroop: 0 }, 'float'));
  else if (eared(ctx)) beats.push(beat(0, { earDroop: 14 }, 'snap'), beat(700, { earDroop: 0 }, 'float'));
  if (browsOn(ctx)) beats.push(beat(360, { browInner: -2.4, browL: -0.8, browR: -0.8 }, 'snap'));
  if (v === 1) beats.push(beat(380, {}, 'pop', { osc: osc('headTilt', 7, 5, 460) }));
  // "hmph": a cheek puffed out at the finger
  if (v === 2) beats.push(beat(360, { cheek: 1.16, puff: 0.7 }, 'snap', { mouth: 'chew' }), beat(760, { cheek: 1, puff: 0 }, 'jelly', { mouth: 'F' }));
  beats.push(cue(980, { expr: 'idle', mouth: 'X', blink: 'allow' }));
  return end(beats, 'pop');
};

const pokeHead = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = e.side || 0;
  // a head squish from the ground anchor (eyes up at the finger, round and surprised), the ears kicked flat by the
  // follower, then a spring back up past round and a jelly ring-out
  const beats: Beat[] = [
    beat(0, { sy: 0.85, headY: 2.5, rot: s * 3, pupil: 1.1 }, 'eye', { haptic: 'light', look: 'finger', mouth: 'o', expr: 'surprised' }),
    beat(0, { earL: -18, earR: 18 }, 'snap'),
    beat(130, { sy: 1.1, headY: -1, rot: 0 }, 'snap', { mouth: 'grin' }),
    beat(230, { sy: 1, headY: 0, pupil: 1 }, 'jelly', { osc: jiggle(ctx, 0.06, 4.5, 720) }),
    beat(170, { earL: 0, earR: 0 }, 'jelly'),
    cue(330, { expr: 'happy' }),
  ];
  if (v === 1) beats.push(cue(150, { blink: 'once' }), beat(200, { headTilt: s ? -s * 8 : 8 }, 'float'), beat(620, { headTilt: 0 }, 'float'));
  if (v === 2) beats.push(beat(170, { sy: 1 }, 'snap', { hop: { h: 9, land: 0.12 }, particles: burst('sparkle', 3, 'head') }));
  if (browsOn(ctx)) beats.push(beat(0, { browL: 2, browR: 2 }, 'snap'), beat(500, { browL: 0, browR: 0 }, 'pop'));
  beats.push(cue(560, { look: 'user' }), cue(900, { expr: 'idle', mouth: 'smile' }));
  return end(beats, 'jelly');
};

const pokeCheek = (e: EventOf<'poke'>, ctx: ReactionCtx): Beat[] => {
  const v = variant(ctx, 'poke');
  const s = (e.side || side(ctx)) as -1 | 1;
  // a squished cheek: the body leans into the finger, the cheeks puff out on the outline, the blush comes up full,
  // then it springs back and giggles
  const beats: Beat[] = [
    beat(0, { sy: 0.88, lean: s * 6, headTilt: s * 9, cheek: 1.16, puff: 0.6, blush: 1 }, 'eye', { springs: { lean: 'snap', headTilt: 'snap', blush: 'float' }, haptic: 'soft', expr: 'happy', mouth: 'w' }),
    beat(130, { sy: 1.06, cheek: 1, puff: 0 }, 'snap'),
    beat(220, { sy: 1 }, 'jelly', { osc: jiggle(ctx, 0.05, 5, 650) }),
    beat(520, { lean: 0, headTilt: 0 }, 'float', { mouth: 'smile' }),
    cue(800, { expr: 'idle' }),
  ];
  if (v === 1) beats.push(beat(150, {}, 'pop', { osc: osc('rot', 5, 6, 500) }));
  if (v === 2) beats.push(cue(200, { particles: burst('heart', 2, s < 0 ? 'cheekL' : 'cheekR') }));
  if (v !== 1) beats.push(cue(140, { mouth: 'grin' }));
  beats.push(beat(1000, { blush: 0 }, 'float'));
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

/**
 * Melting under the hand: lean into the stroke 4–8° ∝ speed (float), the body sinks and spreads (sy 0.88, volume
 * kept) with an sx ripple per pass, content closed eyes, the blush up full, ears laid back; purr after 3 passes.
 */
export const pet: Reaction<EventOf<'pet'>> = (e, ctx) => {
  const v = variant(ctx, 'pet');
  const k = Math.max(0, Math.min(1, (e.speed - 40) / 660));
  const melt = 0.885 - 0.012 * Math.min(2, Math.max(0, e.passes - 1));
  const beats: Beat[] = [
    beat(0, { lean: e.dir * (4 + 4 * k) }, 'float', { expr: v === 2 ? 'bliss' : 'happy', mouth: v === 1 ? 'grin' : 'w', blink: 'suppress', haptic: e.passes % 3 === 0 ? 'select' : undefined }),
    // the head follows the hand a beat later (overlap); the body melts under it, a ripple running across per pass
    beat(70, { headTilt: e.dir * [6, 8, 5][v] }, 'float'),
    beat(0, { sy: 0.93 }, 'snap', { osc: osc('sx', 0.035, 3.2, 700) }),
    beat(120, { sy: melt, y: 1 }, 'float'),
    beat(0, { blush: Math.min(1, 0.6 + e.passes * 0.15), blushScale: 1.25 }, 'float'),
  ];
  if (e.passes >= 3) beats.push(beat(0, {}, 'pop', { osc: [osc('x', 0.6, 22, 1100, false), osc('headY', 0.35, 18, 1100, false)] }));
  if (eared(ctx)) beats.push(beat(60, { earDroop: v === 2 ? 16 : 10 }, 'float'));
  if (v === 0) beats.push(cue(500, { particles: burst('heart', 1, 'head') }));
  beats.push(beat(1100, { lean: 0, headTilt: 0, earDroop: 0, sy: 1, y: 0 }, 'float', { mouth: 'smile' }), beat(1500, { blush: 0, blushScale: 1 }, 'float'));
  return end(beats, 'float');
};

/**
 * A laughing fit: squeezed >_< eyes and a wide laughing mouth that chatters ("ha-ha-ha"), squash pulses (sy 0.86
 * × 90 each), then a giggle shake (rot ±10° @ 7 Hz with little hops off the floor), the blush up, then happy.
 */
export const tickle: Reaction<EventOf<'tickle'>> = (_e, ctx) => {
  const v = variant(ctx, 'tickle');
  const hz = [7, 8, 6.5][v];
  const beats: Beat[] = [
    beat(0, { sy: 0.86 }, 'eye', { expr: 'squeeze', mouth: 'grin', haptic: 'light', blink: 'suppress' }),
    beat(90, { sy: 1.08 }, 'eye'),
    beat(180, { sy: 0.87 }, 'eye', { haptic: 'light' }),
    // the fit: it bounces on its base (y −4 ± 4: never through the floor), rocks and ripples
    beat(270, { sy: 1.06, y: -4 }, 'eye', { osc: [osc('rot', 10, hz, 1000), osc('y', 4, hz * 2, 1000), ...jiggle(ctx, 0.05, hz * 2, 1000)] }),
    ...laugh(60, 1150, hz * 1.4, 0.75),
    beat(390, { sy: 0.9 }, 'eye', { haptic: 'light' }),
    beat(480, { sy: 1 }, 'jelly', { particles: burst(v === 2 ? 'note' : 'heart', 3, 'head') }),
    beat(200, { blush: 0.9 }, 'float'),
    beat(1250, { y: 0 }, 'pop'),
    cue(1270, { expr: 'happy', mouth: 'grin' }),
    beat(1800, { blush: 0 }, 'float'),
    cue(2200, { expr: 'idle', mouth: 'smile', blink: 'allow' }),
  ];
  if (v === 1) beats.push(beat(300, { headTilt: 6 }, 'float'), beat(1200, { headTilt: 0 }, 'float'));
  if (eared(ctx)) beats.push(beat(0, { earDroop: 12 }, 'snap'), beat(1250, { earDroop: 0 }, 'jelly'));
  return end(beats, 'jelly');
};

/**
 * 4–6 hits: a dizzy spin (swirl eyes, a full turn, then a woozy wobble on the spot) or a giggle fit (1200).
 * 7+: a big sneeze (ah… ah… stretched tall, the mouth gaping, then a CHOO squash 0.8 → stretch 1.2 with a
 * hit-stop) or a puffed-up "hmph" that lets go with a "pff", then the 3 s "okay okay".
 */
export const overpoke: Reaction<EventOf<'overpoke'>> = (e, ctx) => {
  const v = variant(ctx, 'overpoke');
  if (e.level === 'mid') {
    if (v === 1) {
      return end([
        beat(0, { sy: 0.86 }, 'eye', { expr: 'squeeze', haptic: 'medium', osc: [osc('rot', 10, 6, 1200), osc('y', 4, 12, 1000), ...jiggle(ctx, 0.05, 12, 1000)] }),
        ...laugh(0, 1100, 9, 0.8),
        beat(0, { y: -4, blush: 0.8 }, 'snap'),
        beat(120, { sy: 1.04 }, 'jelly', { particles: burst('heart', 3, 'head') }),
        beat(1100, { y: 0, blush: 0 }, 'float'),
        cue(1200, { expr: 'happy', mouth: 'smile' }),
      ], 'jelly');
    }
    const dir = v === 0 ? 1 : -1;
    return end([
      beat(0, { sy: 0.86 }, 'snap', { haptic: 'medium', expr: 'dizzy', mouth: 'o' }),
      beat(80, { rot: 360 * dir, sy: 1.12 }, 'pop', { springs: { rot: 'float' } }),
      // round and round: the eyes keep turning, then a woozy wobble on its base as the head catches up
      beat(80, {}, 'pop', { osc: [osc('gazeX', 0.45, 2.2, 1500, false), osc('gazeY', 0.45, 2.2, 1500, false)] }),
      beat(700, { sy: 0.93 }, 'jelly', { mouth: 'E', osc: [osc('rot', 8 * dir, 1.5, 1100), osc('headTilt', -7 * dir, 1.2, 1100), ...jiggle(ctx, 0.04, 3, 900)] }),
      beat(1000, { sy: 1 }, 'jelly'),
      cue(1600, { expr: 'idle', mouth: 'X', blink: 'double' }),
    ], 'jelly');
  }
  if (v === 1) {
    // "hmph": puffed up (cheeks out on the outline, a little taller), turned away, brows down … then "pff"
    return end([
      // half-lidded and nose up, the air held behind pursed lips (the upturned 'chew' read as a smirk)
      beat(0, { cheek: 1.2, puff: 1, lean: -7, headTilt: -10, sy: 1.08, lidL: 0.4, lidR: 0.4, headY: -1.5 }, 'snap', { expr: 'offended', mouth: 'F', haptic: 'rigid', say: 'hmph', look: 'away' }),
      ...(browsOn(ctx) ? [beat(0, { browInner: -2.6 }, 'snap')] : []),
      ...(eared(ctx) ? [beat(0, { earDroop: 14 }, 'snap')] : []),
      beat(90, {}, 'pop', { osc: jiggle(ctx, 0.03, 6, 360) }),
      beat(750, { cheek: 1, puff: 0, sy: 0.93, lidL: 1, lidR: 1, headY: 0 }, 'snap', { mouth: 'o', particles: burst('wisp', 2, 'mouth') }),
      beat(860, { sy: 1 }, 'jelly', { osc: jiggle(ctx, 0.04, 5, 500) }),
      cue(1500, { say: 'okayOkay', look: 'user', expr: 'idle', mouth: 'smile' }),
      beat(1600, { lean: 0, headTilt: 0, browInner: 0, earDroop: 0 }, 'float'),
    ], 'float');
  }
  // the sneeze: ah… (stretch, head back, the mouth opening) AH… (tallest, gaping) CHOO (squash, hit-stop, sparkles)
  const twice = v === 2;
  const sneeze = (t: number): Beat[] => [
    beat(t, { sy: 1.08, headY: -2 }, 'float', { mouth: 'o', expr: 'surprised' }),
    beat(t + 110, { gape: 0.85 }, 'snap'),
    beat(t + 160, { sy: 1.16, headY: -3.5 }, 'snap'),
    beat(t + 330, { sy: 0.78, headY: 3, gape: 0 }, 'eye', { expr: 'squeeze', mouth: 'D', haptic: 'rigid', say: t === 0 ? 'achoo' : undefined, hitStop: 50, particles: burst('sparkle', 4, 'mouth') }),
    // a single sneeze blows it off the floor
    beat(t + 430, { sy: 1.2, headY: -1 }, 'snap', t === 0 && !twice ? { hop: { h: 8, land: 0.12 } } : {}),
    beat(t + 560, { sy: 1, headY: 0 }, 'jelly', { osc: jiggle(ctx, 0.06, 4.5, 700) }),
  ];
  return end([
    ...sneeze(0), ...(twice ? sneeze(760) : []),
    ...(eared(ctx) ? [beat(330, { earL: -14, earR: 14 }, 'eye'), beat(430, { earL: 0, earR: 0 }, 'jelly')] : []),
    cue(twice ? 1560 : 950, { expr: 'idle', mouth: 'X', blink: 'double' }),
    cue(twice ? 1960 : 1350, { say: 'okayOkay' }),
  ], 'jelly');
};

/* ---------- long-press ---------- */

/**
 * SHY: squished down bashfully (sy 0.92, volume kept), blush 0.5 → 1.32 and full, gaze aside, a big tilt, and a
 * squirm side to side while the finger stays (never a frozen pose under it).
 */
export const longPress: Reaction<EventOf<'longPress'>> = (_e, ctx) => {
  const v = variant(ctx, 'longPress');
  const s = [-1, 1, -1][v];
  return end([
    beat(0, { sy: 0.92, blush: 1, blushScale: 0.5, lidL: 0.82, lidR: 0.82, headTilt: s * 9, lean: s * 3, gazeX: s * 0.6, gazeY: 0.5 }, 'float', { springs: { sy: 'snap' }, haptic: 'soft', expr: 'shy', mouth: v === 2 ? 'w' : 'smile' }),
    beat(80, { blushScale: 1.32 }, 'float'),
    beat(120, {}, 'pop', { osc: jiggle(ctx, 0.04, 4.5, 500) }),
    // the bashful squirm: twisting on its base, the head swaying against it
    beat(250, {}, 'float', { osc: [osc('rot', [3, 4, 3][v], 1, 1800), osc('headTilt', -2.5, 1, 1800), osc('sy', 0.02, 2, 1800)] }),
    ...(eared(ctx) ? [beat(0, { earDroop: 10 }, 'float')] : []),
    ...(v === 1 ? [cue(400, { particles: burst('heart', 1, 'head') })] : []),
    beat(1900, { blush: 0, blushScale: 1, lidL: 1, lidR: 1, headTilt: 0, lean: 0, gazeX: 0, gazeY: 0, earDroop: 0 }, 'float', { mouth: 'smile' }),
  ], 'float');
};

/* ---------- drag, fling, walls, landings ---------- */

/** Picked up: stretched along the pull (sy 1.14), lifted 10 px, eyes wide (pupils 1.15), an "o", legs dangling. */
export const dragStart: Reaction<EventOf<'dragStart'>> = (_e, ctx) => {
  const v = variant(ctx, 'dragStart');
  return [
    beat(0, { sy: 1.14, y: -10, pupil: 1.15, shadow: 0.75 }, 'snap', { expr: 'surprised', mouth: v === 1 ? 'grin' : v === 2 ? 'E' : 'o', haptic: 'light' }),
    beat(60, {}, 'pop', { osc: jiggle(ctx, 0.04, 5, 600) }),
    // the pickup pop eases to a dangle (the velocity stretch adds on top while it swings)
    beat(220, { sy: 1.07 }, 'jelly'),
    ...(eared(ctx) ? [beat(0, { earL: v === 2 ? 16 : 10, earR: v === 2 ? -16 : -10 }, 'snap')] : []),
    ...(browsOn(ctx) ? [beat(0, { browL: 2, browR: 2 }, 'snap')] : []),
    beat(160, {}, 'pop', { release: 'jelly' }),
  ];
};

/** A fast swing while dragged: a quick "whee" (the head flung back against the swing, the mouth open). */
export const drag: Reaction<EventOf<'drag'>> = (e, ctx) => {
  const v = variant(ctx, 'drag');
  const s = Math.sign(e.vx) || 1;
  return end([
    beat(0, { headTilt: -s * [8, 11, 7][v] }, 'snap', { mouth: 'grin' }),
    ...laugh(0, 300, 7, v === 1 ? 0.8 : 0.55),
    beat(300, { headTilt: 0 }, 'pop'),
  ], 'pop');
};

/** Mid-air: wide eyes, an "o" (a thrown one shrieks a happy "wheee"), ears flung; the engine flies and stretches it. */
export const fling: Reaction<EventOf<'fling'>> = (e, ctx) => {
  const v = variant(ctx, 'fling');
  const happy = e.thrown && v !== 2;
  return [
    beat(0, { pupil: e.thrown ? 1.15 : 1.05 }, 'snap', { expr: 'surprised', mouth: happy ? 'grin' : 'o', haptic: e.thrown ? 'light' : undefined }),
    ...(happy ? [beat(0, { gape: 0.6 }, 'snap')] : []),
    ...(eared(ctx) ? [beat(0, { earL: 12 + v * 3, earR: -12 - v * 3 }, 'snap')] : []),
    beat(200, {}, 'pop', { release: 'jelly' }),
  ];
};

/**
 * Wall hit: a splat against the wall (sx 0.84 along the normal, taller across it, volume kept; the body slides
 * into the wall so the flat side stays on it), a 60 ms hit-stop, >_<, then it peels off, rebounds and wobbles.
 */
export const wallHit: Reaction<EventOf<'wallHit'>> = (e, ctx) => {
  const v = variant(ctx, 'wallHit');
  const k = Math.min(1, e.v / 1800);
  const sx = 1 - 0.16 * Math.max(0.5, k);
  return end([
    beat(0, { ...squashX(ctx, sx), x: -e.nx * (1 - sx) * 70, rot: e.nx * 9 * k }, 'eye', { haptic: 'medium', expr: 'squeeze', mouth: v === 2 ? 'o' : 'A', hitStop: 60 }),
    beat(130, { ...squashX(ctx, 1.06), x: 0, rot: -e.nx * 3 * k }, 'snap', { expr: 'surprised', mouth: 'o' }),
    beat(230, { sx: 1, sy: 1, rot: 0 }, 'jelly', { osc: jiggle(ctx, 0.06, 4.5, 650) }),
    ...(eared(ctx) ? [beat(0, { earL: e.nx * 14, earR: e.nx * 14 }, 'eye'), beat(130, { earL: 0, earR: 0 }, 'jelly')] : []),
    ...(k > 0.6 ? [cue(40, { particles: burst('sparkle', 3, 'head') })] : []),
  ], 'jelly');
};

/** Landing: sy = 1 − clamp(v/4000, 0.08, 0.3), a 50 ms hit-stop, jelly; dizzy and woozy after a hard one, else a giggle. */
export const land: Reaction<EventOf<'land'>> = (e, ctx) => {
  const v = variant(ctx, 'land');
  const hard = e.v > 2500;
  const beats: Beat[] = [
    beat(0, { sy: landSquash(e.v) }, 'eye', { haptic: hard ? 'heavy' : 'medium', hitStop: 50, expr: 'squeeze', mouth: 'A' }),
    beat(110, { sy: 1.08 }, 'snap'),
    beat(200, { sy: 1 }, 'jelly', { osc: jiggle(ctx, 0.06, 4.5, 700) }),
    beat(220, {}, 'jelly', hard
      ? { expr: 'dizzy', mouth: 'E', osc: [osc('gazeX', 0.4, 2.4, 900, false), osc('gazeY', 0.4, 2.4, 900, false), osc('rot', 6, 1.4, 1000), osc('headTilt', -5, 1.1, 1000)], particles: burst('sparkle', 3, 'head') }
      : { expr: 'happy', osc: osc('rot', [5, 6, 4][v], 6, 500) }),
    ...(hard ? [] : laugh(220, 420, 9, 0.6)),
  ];
  beats.push(cue(hard ? 1100 : 680, { expr: 'idle', mouth: 'smile' }));
  return end(beats, 'jelly');
};

/**
 * Shaken phone: jelly chaos (the body sloshes opposite the device ±10 px, rocks and squashes at three different
 * rates, so it never looks like a loop), eyes swirl after 1 s, a woozy wobble, then a puffed-up "hmph".
 */
export const shake: Reaction<EventOf<'shake'>> = (_e, ctx) => {
  const v = variant(ctx, 'shake');
  return end([
    // "wa-wa-wa": >_< (or wide-eyed) with the mouth gaping open and chattering against the slosh
    beat(0, { sy: 0.92, gape: 0.9 }, 'snap', {
      haptic: 'rigid', mouth: 'E', expr: v === 1 ? 'surprised' : 'squeeze',
      osc: [osc('x', 10, 4.2, 1100), osc('rot', [8, 10, 7][v], 3.3, 1100), osc('sy', 0.09, 7.5, 1100), osc('sx', -0.065, 7.5, 1100), osc('headTilt', 6, 5.1, 1100), osc('headY', 1.8, 9, 1100), osc('gape', 0.35, 6, 1000, false)],
    }),
    beat(1000, { sy: 0.94, gape: 0 }, 'jelly', { expr: 'dizzy', mouth: 'o', osc: [osc('gazeX', 0.5, 2, 1200, false), osc('gazeY', 0.5, 2, 1200, false), osc('rot', 7, 1.3, 1200), osc('headTilt', -6, 1, 1200)] }),
    beat(1300, { sy: 1 }, 'jelly'),
    beat(2200, { sy: 1.05, cheek: 1.16, puff: v === 1 ? 1 : 0.7, lidL: 0.4, lidR: 0.4 }, 'snap', { expr: 'offended', mouth: 'F', say: 'hmph' }),
    ...(browsOn(ctx) ? [beat(2200, { browInner: -2.2 }, 'snap')] : []),
    beat(2700, { sy: 0.96, cheek: 1, puff: 0, lidL: 1, lidR: 1 }, 'snap', { mouth: 'o', particles: burst('wisp', 2, 'mouth') }),
    beat(2850, { sy: 1 }, 'jelly'),
    beat(2950, { browInner: 0 }, 'float', { expr: 'idle', mouth: 'smile' }),
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
