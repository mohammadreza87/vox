/**
 * Feeding (brief §2.6): notice → approach → bite → chomp ×3–4 → swallow → satisfied, and the "so full" belly pat.
 * The engine chains the phases and drives the continuous approach (mouth open = 1 − dist/120); the chomp keeps
 * its rhythm (`fixed`: no jitter beyond its own ±5 %).
 */

import type { Beat, EventOf, Reaction, ReactionCtx } from '../types';
import { beat, browsOn, burst, cue, eared, end, osc, rr, variant } from './util';

/** Cookie lifted: within 100 ms the eyes lock, pupils grow to 1.12 over 450, a perk. */
function notice(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return end([
    beat(0, { sy: 1.04, pupil: 1.12 }, 'snap', { springs: { pupil: 'float' }, look: 'cookie', expr: 'surprised', mouth: 'o', haptic: 'select' }),
    ...(v === 0 && eared(ctx) ? [beat(0, { earL: 10, earR: -10 }, 'snap')] : []),
    ...(v === 1 ? [beat(60, { sy: 1 }, 'snap', { hop: { h: 5, land: 0.07 } })] : []),
    ...(v === 2 ? [beat(60, { headTilt: 6 }, 'float')] : []),
    ...(browsOn(ctx) ? [beat(0, { browL: 1.6, browR: 1.6 }, 'snap')] : []),
    cue(260, { expr: 'happy', mouth: 'grin' }),
    beat(700, { sy: 1.02, earL: 0, earR: 0, headTilt: 0, browL: 0.6, browR: 0.6 }, 'float', { expr: 'idle', mouth: 'o' }),
  ], 'float');
}

/** In reach: lean and stretch toward it (up to sy 1.06), mouth D; the engine sets the openness from the distance. */
function approach(e: EventOf<'feed'>, ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  const o = Math.max(0, Math.min(1, 1 - (e.dist ?? 60) / 120));
  return [beat(0, { sy: 1 + 0.06 * o, pupil: 1.12, headY: -1.5 * o }, 'snap', { mouth: v === 2 ? 'o' : 'D', look: 'cookie', blink: 'suppress' }), beat(80, {}, 'snap', { release: 'pop' })];
}

/** Bite: the mouth snaps shut in 60, hit-stop 40, squash (sy 0.93), cheeks puff to 1.12, crumbs. */
function bite(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return [
    beat(0, { mouthOpen: 0, sy: 0.93, cheek: 1.12, pupil: 1 }, 'eye', { springs: { sy: 'snap', cheek: 'snap' }, mouth: 'smile', expr: 'happy', haptic: 'soft', hitStop: 40, blink: 'suppress', particles: burst('crumb', [3, 4, 3][v], 'mouth') }),
    beat(120, { sy: 1.02 }, 'jelly', v === 2 ? { osc: osc('rot', 2.5, 5, 300) } : {}),
    beat(200, {}, 'pop', { release: 'pop' }),
  ];
}

/** Chomp ×3–4: a 170 ms cycle (±5 %): open 0.35 in 80, close 60; sy 0.96 pulse + cheek jiggle; 4–6 crumbs. */
function chomp(e: EventOf<'feed'>, ctx: ReactionCtx): Beat[] {
  const n = e.chomp ?? (ctx.rng() < 0.5 ? 3 : 4);
  const beats: Beat[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const cycle = 170 * rr(ctx, 0.95, 1.05);
    beats.push(
      beat(t, { mouthOpen: 0.35, sy: 1.01, cheek: 1.06 }, 'snap', { fixed: true, mouth: 'smile', expr: 'happy', blink: 'suppress' }),
      beat(t + 80, { mouthOpen: 0, sy: 0.96, cheek: 1.12 }, 'eye', { fixed: true, springs: { cheek: 'snap' }, haptic: i < 3 ? 'soft' : undefined, particles: burst('crumb', Math.round(rr(ctx, 4, 6)), 'mouth') }),
    );
    t += cycle;
  }
  beats.push(beat(t, { cheek: 1.04, sy: 1 }, 'pop', { fixed: true, release: 'jelly' }));
  return beats;
}

/** Swallow: a ripple sx 1.05 from top → mid → base 80 ms apart (240), a 2 px dip; eyes open. */
function swallow(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return end([
    beat(0, { headY: -1, cheek: 1.08, mouthOpen: 0 }, 'snap', { expr: 'idle', mouth: 'A', blink: 'allow' }),
    beat(80, { headY: 0.6, cheek: 1, sx: 1.05, sy: 1 }, 'snap'),
    beat(160, { sy: 0.96, y: 2 }, 'snap'),
    beat(240, { sx: 1, sy: 1, y: 0 }, 'jelly', v === 1 ? { blink: 'once' } : {}),
    ...(v === 2 ? [beat(240, { headTilt: 3 }, 'float'), beat(500, { headTilt: 0 }, 'float')] : []),
  ], 'jelly');
}

/** Satisfied: "mmm" (mouth F), a hop, blush 0.6, "Yum!". */
function satisfied(ctx: ReactionCtx): Beat[] {
  const v = variant(ctx, 'feed');
  return end([
    beat(0, { blush: 0.6, sy: 1.03 }, 'float', { springs: { sy: 'snap' }, mouth: 'F', expr: 'happy', haptic: 'success' }),
    beat(120, { sy: 1 }, 'snap', { hop: { h: [9, 7, 11][v], land: 0.1 }, say: 'yum', particles: v === 0 ? burst('heart', 2, 'head') : v === 1 ? burst('sparkle', 3, 'head') : undefined }),
    ...(v === 1 ? [beat(500, {}, 'pop', { osc: osc('sx', 0.04, 3.1, 650) })] : []),
    beat(rr(ctx, 600, 900), { blush: 0 }, 'float', { mouth: 'smile', expr: 'idle' }),
  ], 'jelly');
}

export const feed: Reaction<EventOf<'feed'>> = (e, ctx) => {
  switch (e.phase) {
    case 'notice': return notice(ctx);
    case 'approach': return approach(e, ctx);
    case 'bite': return bite(ctx);
    case 'chomp': return chomp(e, ctx);
    case 'swallow': return swallow(ctx);
    default: return satisfied(ctx);
  }
};

/** Tummy ≥ 90: a belly pat (sx 1.04 pulses ×2), a head shake ±7° ×2 at 160, a lean back; "so full". */
export const tooFull: Reaction<EventOf<'tooFull'>> = (_e, ctx) => {
  const v = variant(ctx, 'tooFull');
  return end([
    beat(0, { lean: -4, pupil: 1 }, 'float', { mouth: 'A', haptic: 'warn', say: 'soFull', look: 'user', osc: [osc('sx', 0.04, 3.1, 650), osc('sy', -0.025, 3.1, 650)] }),
    beat(120, {}, 'pop', { osc: osc('headTilt', 7, 3.125, 640, v !== 1) }),
    ...(v === 2 ? [beat(200, { cheek: 1.1 }, 'snap'), beat(700, { cheek: 1 }, 'jelly')] : []),
    ...(v === 1 && browsOn(ctx) ? [beat(0, { browInner: 1.2 }, 'float')] : []),
    beat(900, { lean: 0, browInner: 0 }, 'float', { mouth: 'smile' }),
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
