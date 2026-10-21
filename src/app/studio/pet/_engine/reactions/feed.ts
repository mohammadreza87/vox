/**
 * Feeding (brief §2.6): notice → approach → bite → chomp ×3–4 → swallow → satisfied, and the "so full" belly pat.
 * The engine chains the phases and drives the continuous approach (mouth open = 1 − dist/120); the chomp keeps
 * its rhythm (`fixed`: no jitter beyond its own ±5 %).
 */

import type { Beat, EventOf, Reaction, ReactionCtx } from '../types';
import { beat, browsOn, burst, cue, doubleHop, eared, end, osc, rr, variant } from './util';

/**
 * Cookie lifted (or tapped): within 100 ms the eyes lock on and go sparkly (pupils 1.2, two white highlights), the
 * body perks up on its toes, ears perk, and an "ooh" mouth starts to open. The engine then takes the gape and the
 * stretch from the distance (closed → 'aah' → widest, sy up to 1.12) while the cookie comes in.
 */
function notice(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return end([
    beat(0, { sy: 1.1, pupil: 1.2, sparkle: 1, headY: -2 }, 'snap', { springs: { sparkle: 'eye' }, look: 'cookie', expr: 'surprised', mouth: 'o', haptic: 'select', blink: 'suppress' }),
    ...(eared(ctx) ? [beat(0, { earL: 14, earR: -14 }, 'snap')] : []),
    ...(browsOn(ctx) ? [beat(0, { browL: 2.4, browR: 2.4 }, 'snap')] : []),
    // "ooh!": the mouth starts to open toward the cookie
    beat(130, { sy: 1.05, gape: 0.75 }, 'pop'),
    // excitement: a tiny hop, a wiggle, or a head tilt
    ...(v === 0 ? [beat(150, {}, 'pop', { hop: { h: 7, land: 0.08 } })] : []),
    ...(v === 1 ? [beat(150, {}, 'pop', { osc: osc('rot', 3.5, 5.5, 420) })] : []),
    ...(v === 2 ? [beat(150, { headTilt: 8 }, 'float')] : []),
    beat(600, { sy: 1.03, gape: 0.55, headTilt: 0 }, 'float'),
  ], 'float');
}

/** In reach: the face for it (the engine sets the gape and the stretch from the distance, and holds this while in reach). */
function approach(ctx: ReactionCtx): Beat[] {
  return [
    beat(0, { pupil: 1.2, sparkle: 1 }, 'snap', { mouth: 'smile', expr: 'surprised', look: 'cookie', blink: 'suppress' }),
    ...(eared(ctx) ? [beat(0, { earL: 12, earR: -12 }, 'snap')] : []),
    ...(browsOn(ctx) ? [beat(0, { browL: 2.6, browR: 2.6 }, 'snap')] : []),
    beat(200, {}, 'snap', { release: 'pop' }),
  ];
}

/**
 * Bite: the mouth slams shut (the engine drops the gape on `eye`), a big squash (sy 0.84) with a hit-stop, eyes
 * squeezed >_<, cheeks puff full, crumbs fly; then a rebound stretch. Cat ears flatten on the chomp, then perk.
 */
function bite(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  const cat = ctx.species === 'cat';
  return [
    beat(0, { sy: 0.84, puff: 1, pupil: 1, sparkle: 0, headY: 1.5, browL: 0, browR: 0 }, 'eye', {
      springs: { puff: 'snap', sparkle: 'eye', pupil: 'snap' }, mouth: 'chew', expr: 'squeeze', haptic: 'medium', hitStop: 50, blink: 'suppress',
      particles: [burst('crumb', [7, 8, 6][v], 'mouth'), burst('sparkle', 2, 'mouth')],
    }),
    ...(eared(ctx) ? [beat(0, { earL: cat ? -22 : -8, earR: cat ? 22 : 8 }, 'snap')] : []),
    beat(120, { sy: 1.08, headY: -1 }, 'snap', { expr: 'happy' }),
    ...(eared(ctx) ? [beat(170, { earL: cat ? 8 : 0, earR: cat ? -8 : 0 }, 'pop')] : []),
    beat(240, { sy: 0.96, headY: 0 }, 'jelly', v === 2 ? { osc: osc('rot', 3, 5, 300) } : {}),
    beat(300, {}, 'pop', { release: 'pop' }),
  ];
}

/**
 * Chomp ×3–4 (fixed rhythm, 180 ms ±5 %): open-stretch (sy 1.06) / close-squash (sy 0.9) with puffed cheeks and
 * happy closed eyes, rocking side to side; crumbs on every close. Dog ears bounce, bunny nose (mouth) twitches,
 * the chick's beak pecks wider.
 */
function chomp(e: EventOf<'feed'>, ctx: ReactionCtx): Beat[] {
  const n = e.chomp ?? (ctx.rng() < 0.5 ? 3 : 4);
  const sp = ctx.species, beak = sp === 'chick' || sp === 'owl';
  const beats: Beat[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const cycle = 180 * rr(ctx, 0.95, 1.05), s = i % 2 ? 1 : -1;
    beats.push(
      beat(t, { mouthOpen: beak ? 0.75 : 0.65, sy: 1.07, puff: 0.7, rot: 2.6 * s, headX: 1.2 * s }, 'snap', { fixed: true, springs: { rot: 'pop' }, mouth: 'chew', expr: 'happy', blink: 'suppress' }),
      beat(t + 85, { mouthOpen: 0, sy: 0.89, puff: 1 }, 'eye', {
        fixed: true, springs: { puff: 'snap' }, haptic: i < 3 ? 'soft' : undefined, particles: burst('crumb', Math.round(rr(ctx, 2, 4)), 'mouth'),
        ...(sp === 'dog' ? { osc: [osc('earL', 10, 6, 170), osc('earR', -10, 6, 170)] } : sp === 'cat' ? { osc: osc(s < 0 ? 'earL' : 'earR', 5 * s, 7, 150) } : {}),
      }),
    );
    t += cycle;
  }
  if (sp === 'bunny') beats.push(beat(0, {}, 'snap', { fixed: true, osc: [osc('mouthWidth', 0.7, 8, t, false), osc('headY', 0.6, 8, t, false)] }));
  beats.push(beat(t, { sy: 1, rot: 0, headX: 0, puff: 0.85 }, 'pop', { fixed: true, release: 'jelly' }));
  return beats;
}

/**
 * Swallow: GULP. Cheeks deflate, chin up, eyes pop wide; a bump travels down the body outline from the cheeks to the
 * base (420 ms) while the body squashes after it; then a beat of stillness and a blink.
 */
function swallow(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return end([
    beat(0, { puff: 0, sy: 1.08, headY: -2.5, rot: 0, headX: 0, pupil: 1.12 }, 'snap', { springs: { puff: 'snap' }, expr: 'surprised', mouth: 'A', blink: 'suppress', gulp: 420 }),
    ...(browsOn(ctx) ? [beat(0, { browL: 2, browR: 2 }, 'snap'), beat(320, { browL: 0, browR: 0 }, 'float')] : []),
    beat(150, { sy: 0.93, y: 2, headY: 1 }, 'snap'),
    beat(330, { sy: 1.02, y: 0, headY: 0, pupil: 1 }, 'jelly'),
    // the pause: a blink, the mouth settles
    cue(430, { expr: 'idle', mouth: 'smile', blink: v === 1 ? 'double' : 'once' }),
    ...(v === 2 ? [beat(430, { headTilt: 4 }, 'float'), beat(650, { headTilt: 0 }, 'float')] : []),
    beat(700, {}, 'float'),
  ], 'jelly');
}

/** Satisfied: "mmm" with a belly-pat wiggle, blush up, hearts, then a happy hop (a double hop on one variant). */
function satisfied(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return end([
    beat(0, { blush: 0.95, sy: 0.95, puff: 0 }, 'snap', {
      springs: { blush: 'float' }, mouth: 'F', expr: 'happy', haptic: 'success', say: 'yum',
      osc: [osc('sx', 0.05, 3.4, 720), osc('sy', -0.03, 3.4, 720), osc('rot', 3.5, 2.6, 900)],
    }),
    cue(120, { particles: v === 1 ? [burst('heart', 2, 'head'), burst('sparkle', 3, 'head')] : burst('heart', 3, 'head') }),
    ...(eared(ctx) ? [beat(500, { earL: 10, earR: -10 }, 'snap'), beat(900, { earL: 0, earR: 0 }, 'pop')] : []),
    beat(560, { sy: 0.9 }, 'snap', { mouth: 'grin' }),
    ...(v === 1 ? doubleHop(660, 13) : [beat(660, { sy: 1.08 }, 'snap', { hop: { h: [15, 0, 12][v], land: 0.14 } })]),
    ...(v === 2 ? [beat(700, {}, 'pop', { osc: osc('headTilt', 6, 2.5, 600) })] : []),
    beat(1150, { blush: 0.6, sy: 1 }, 'float'),
    beat(1500, { blush: 0 }, 'float', { mouth: 'smile', expr: 'idle' }),
  ], 'jelly');
}

export const feed: Reaction<EventOf<'feed'>> = (e, ctx) => {
  switch (e.phase) {
    case 'notice': return notice(ctx);
    case 'approach': return approach(ctx);
    case 'bite': return bite(ctx);
    case 'chomp': return chomp(e, ctx);
    case 'swallow': return swallow(ctx);
    default: return satisfied(ctx);
  }
};

/** Tummy ≥ 90: "so full": a round belly squash with pats (sx pulses ×2), cheeks held puffed, >_< and a head shake ±9°, lean back. */
export const tooFull: Reaction<EventOf<'tooFull'>> = (_e, ctx) => {
  const v = variant(ctx, 'tooFull');
  return end([
    beat(0, { lean: -6, sy: 0.93, puff: 0.7, blush: 0.45, pupil: 1 }, 'float', {
      springs: { sy: 'snap', puff: 'snap' }, expr: 'squeeze', mouth: 'A', haptic: 'warn', say: 'soFull', look: 'user',
      osc: [osc('sx', 0.05, 3.2, 700), osc('sy', -0.03, 3.2, 700)],
    }),
    beat(160, {}, 'pop', { osc: osc('headTilt', 9, 3.2, 700, v !== 1) }),
    ...(eared(ctx) ? [beat(160, { earL: -10, earR: 10 }, 'snap'), beat(800, { earL: 0, earR: 0 }, 'pop')] : []),
    ...(v === 1 && browsOn(ctx) ? [beat(0, { browInner: 1.4 }, 'float')] : []),
    // "pff": the held cheeks let go
    beat(620, { puff: 0, sy: 1.02 }, 'snap', { mouth: 'F', ...(v === 2 ? { particles: burst('wisp', 2, 'mouth') } : {}) }),
    beat(950, { lean: 0, browInner: 0, sy: 1, blush: 0 }, 'float', { mouth: 'smile', expr: 'idle' }),
  ], 'float');
};

/** A refusal the server answered (the optimistic guess was wrong): tired → a yawn and "Nap first?"; full → so full. */
export const refuse: Reaction<EventOf<'refuse'>> = (e, ctx) => {
  if (e.why === 'full') return tooFull({ type: 'tooFull' }, ctx);
  const v = variant(ctx, 'refuse');
  return end([
    beat(0, { sy: 1.05, lidL: 0.8, lidR: 0.8 }, 'float', { mouth: 'yawn', expr: 'squeeze', haptic: 'soft' }),
    beat(500, { sy: 0.97 }, 'float', { mouth: 'smile', expr: 'idle', say: 'napFirst' }),
    ...(v === 1 ? [beat(600, {}, 'pop', { hop: { h: 3, land: 0.06 } })] : v === 2 ? [beat(600, { headTilt: 5 }, 'float')] : []),
    beat(1300, { sy: 1, lidL: 1, lidR: 1, headTilt: 0 }, 'sleepy'),
  ], 'sleepy');
};
