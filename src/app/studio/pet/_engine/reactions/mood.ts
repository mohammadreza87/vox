/**
 * Idle life and moods (brief §2.3 idle tiers, §2.4 ambient beats, §2.6): micro-fidgets (8–30 s of watching),
 * long fidgets (30–90 s), the mood's ambient beat every 9–16 s, Bond signature fidgets, boredom, wants (a
 * thought bubble with the toy and a glance at it) and sad-but-cute. Calm at rest: small, slow, never twitchy.
 */

import type { NeedKey } from '@/lib/pet/types';
import type { Beat, EventOf, LookTarget, Reaction, ReactionCtx } from '../types';
import { beat, browsOn, burst, cue, eared, end, hopMs, osc, rr, side, variant } from './util';

const TOY: Record<NeedKey, LookTarget> = { tummy: 'cookie', joy: 'ball', energy: 'moon' };

/* ---------- small pieces the moods share ---------- */

/** One ear flicks (cat: −12° in 60, back on pop); a cloud tilts instead. */
function earFlick(ctx: ReactionCtx): Beat[] {
  if (!eared(ctx)) return tilt(ctx);
  const s = side(ctx);
  const ch = s < 0 ? 'earL' : 'earR';
  const deg = ctx.species === 'cat' ? 12 : ctx.species === 'dog' ? 9 : 10;
  return end([beat(0, { [ch]: s * deg }, 'eye'), beat(70, { [ch]: 0 }, 'pop')], 'jelly');
}
function tilt(ctx: ReactionCtx, deg = 4): Beat[] {
  const d = Math.min(deg * (ctx.species === 'owl' ? 3 : 1), ctx.species === 'owl' ? 20 : 8) * side(ctx);
  return end([beat(0, { headTilt: d }, 'float'), beat(rr(ctx, 1000, 1400), { headTilt: 0 }, 'float')], 'float');
}
/** A saccade pair: glance one way, then the other, then home (a blink rides the first). */
function lookAround(ctx: ReactionCtx): Beat[] {
  const s = side(ctx);
  return end([
    beat(0, { gazeX: 0.65 * s, gazeY: -0.1 }, 'eye', { blink: 'once' }),
    beat(rr(ctx, 450, 650), { gazeX: -0.6 * s, gazeY: 0 }, 'eye'),
    beat(rr(ctx, 1000, 1250), { gazeX: 0, gazeY: 0 }, 'eye'),
  ], 'float');
}
function yawnLite(): Beat[] {
  return end([
    beat(0, { sy: 1.06, headY: -1 }, 'float', { mouth: 'yawn', expr: 'squeeze' }),
    beat(650, { sy: 0.99, headY: 0 }, 'float', { mouth: 'X', expr: 'idle' }),
  ], 'float');
}
function hum(ctx: ReactionCtx): Beat[] {
  // mouth F, two head bobs × 400 ms, a note or two
  return end([
    beat(0, {}, 'pop', { mouth: 'F', osc: osc('headY', 1.4, 2.5, 800, false), particles: burst('note', ctx.tier === 'full' ? 2 : 1, 'head') }),
    beat(0, { headTilt: 3 * side(ctx) }, 'float'),
    beat(820, { headTilt: 0 }, 'float', { mouth: 'X' }),
  ], 'float');
}
function smallHop(h = 6): Beat[] {
  return end([beat(0, { sy: 0.94 }, 'snap'), beat(110, { sy: 1.03 }, 'snap', { hop: { h, land: 0.08 } }), beat(110 + hopMs(h) + 60, { sy: 1 }, 'pop')], 'jelly');
}

/* ---------- idle tiers ---------- */

/** 8–30 s: an ear twitch / a 4° tilt / a look-around (species: owl wink, bunny nose twitch, chick double hop). */
export const fidgetSmall: Reaction<EventOf<'fidgetSmall'>> = (_e, ctx) => {
  const v = variant(ctx, 'fidgetSmall');
  if (v === 0) {
    if (ctx.species === 'owl') return end([beat(0, { lidL: 0.06 }, 'eye', { mouth: 'smile' }), beat(260, { lidL: 1 }, 'pop')], 'pop');
    if (ctx.species === 'bunny') return end([beat(0, {}, 'pop', { mouth: 'w', osc: osc('mouthWidth', 0.5, 6, 300) }), cue(320, { mouth: 'X' })], 'pop');
    if (ctx.species === 'chick') return end([beat(0, { sy: 1 }, 'snap', { hop: { h: 4, land: 0.07 } }), beat(150, { sy: 1 }, 'snap', { hop: { h: 4, land: 0.07 } })], 'jelly');
    return earFlick(ctx);
  }
  return v === 1 ? tilt(ctx) : lookAround(ctx);
};

/** 30–90 s: a yawn / a sit-squash (sy 0.92 hold 800) / a 360° spin (700, stretched) / a hum. */
export const fidgetLong: Reaction<EventOf<'fidgetLong'>> = (_e, ctx) => {
  // tired moods yawn more; the others pick among the four
  const v = ctx.mood.tone === 'tired' && ctx.rng() < 0.5 ? 0 : variant(ctx, 'fidgetLong', 4);
  if (v === 0) return yawnLite();
  if (v === 1) return end([beat(0, { sy: 0.92, y: 1 }, 'float', { mouth: 'smile' }), beat(800, { sy: 1.02, y: 0 }, 'pop'), beat(950, { sy: 1 }, 'jelly')], 'jelly');
  if (v === 2) return end([beat(0, { sy: 0.94 }, 'snap'), beat(100, { rot: 360 * side(ctx), sy: 1.05 }, 'pop', { springs: { rot: 'float' }, expr: 'happy' }), beat(700, { sy: 1 }, 'jelly', { expr: 'idle' })], 'jelly');
  return hum(ctx);
};

/** The mood's ambient beat (§2.4 row): content twitch/tilt, a tummy rumble, a yawn, a bored sigh, a happy hum. */
export const ambient: Reaction<EventOf<'ambient'>> = (e, ctx) => {
  const v = variant(ctx, 'ambient');
  switch (e.tone) {
    case 'hungry':
      // 3 × 40 ms sx jitter ±0.02 and a glance at the cookie
      return end([
        beat(0, {}, 'pop', { osc: osc('sx', 0.02, 12.5, 240, false), look: v === 2 ? 'user' : 'cookie' }),
        ...(v === 1 ? [beat(0, { headY: 1 }, 'float', { mouth: 'A' })] : []),
        beat(700, { headY: 0 }, 'float', { look: 'user', mouth: 'X' }),
      ], 'float');
    case 'tired': return v === 2 ? tilt(ctx, 3) : yawnLite();
    case 'bored': return bored({ type: 'bored' }, ctx);
    case 'happy': return v === 0 ? hum(ctx) : v === 1 ? smallHop(5) : ctx.species === 'cloud' ? end([cue(0, { particles: burst('wisp', 2, 'body') })], 'pop') : earFlick(ctx);
    default: return v === 0 ? earFlick(ctx) : v === 1 ? tilt(ctx) : lookAround(ctx);
  }
};

/** Signature moves: six Bond milestone fidgets (0–5); four more a lit growth moment can unlock (6–9, reactions/rooms.ts). */
export const SIGNATURE_MOVES = 10;
export const BOND_SIGNATURES = 6;

/** Bond milestone fidgets (one per milestone, six in v1). */
export const signature: Reaction<EventOf<'signature'>> = (e) => {
  switch (((e.index % BOND_SIGNATURES) + BOND_SIGNATURES) % BOND_SIGNATURES) {
    case 0: return end([beat(0, { sy: 0.93 }, 'snap'), beat(110, { rot: 360, sy: 1.05 }, 'pop', { springs: { rot: 'float' }, expr: 'happy' }), beat(700, { sy: 1 }, 'jelly', { expr: 'idle' })], 'jelly');
    case 1: return end([0, 1, 2].map((i) => beat(i * 260, { sy: 1 }, 'snap', { hop: { h: 6 - i, land: 0.08 } })), 'jelly');
    case 2: return end([beat(0, {}, 'pop', { osc: [osc('rot', 6, 3, 1200), osc('headTilt', 4, 3, 1200)], mouth: 'grin', expr: 'happy' }), cue(1250, { expr: 'idle', mouth: 'smile' })], 'pop');
    case 3: return end([beat(0, { lidL: 0.06, lidR: 0.06, headY: 2, sy: 0.95 }, 'snap'), beat(600, { lidL: 1, lidR: 1, headY: -1, sy: 1.06, pupil: 1.12 }, 'snap', { expr: 'surprised', mouth: 'o' }), beat(900, { headY: 0, sy: 1, pupil: 1 }, 'jelly', { expr: 'happy', mouth: 'grin' }), cue(1400, { expr: 'idle', mouth: 'smile' })], 'jelly');
    case 4: return end([beat(0, {}, 'pop', { osc: osc('x', 3, 6, 800), mouth: 'w' }), cue(820, { mouth: 'X' })], 'pop');
    default: return end([beat(0, { sy: 1.1 }, 'float', { mouth: 'o' }), beat(700, { sy: 0.97 }, 'pop', { particles: burst('sparkle', 4, 'head'), mouth: 'smile' }), beat(900, { sy: 1 }, 'jelly')], 'jelly');
  }
};

/** Boredom: a sigh (sy 1.03 inhale 500 → 0.96 exhale 700, float), a glance at the ball, inner brows up. */
export const bored: Reaction<EventOf<'bored'>> = (_e, ctx) => {
  const v = variant(ctx, 'bored');
  return end([
    beat(0, { sy: 1.03, lidL: 0.95, lidR: 0.95 }, 'float', { mouth: 'o', look: v === 1 ? 'away' : 'ball' }),
    ...(browsOn(ctx) ? [beat(0, { browInner: 1.5 }, 'float')] : []),
    beat(500, { sy: 0.96 }, 'float', { mouth: 'A' }),
    ...(v === 2 ? [beat(1310, { sy: 1 }, 'snap', { hop: { h: 4, land: 0.07 } })] : []),
    beat(1300, { sy: 1, lidL: 1, lidR: 1, browInner: 0 }, 'float', { mouth: 'X', look: 'user' }),
  ], 'float');
};

/**
 * A need in "wants" (30–54): a thought bubble with the toy, sparkly hopeful eyes on it (pupils 1.12), a perk and a
 * little eager bounce, a tilt or lean toward it (the toy wiggles in the UI). Still an ambient beat: friendly, small.
 */
export const wants: Reaction<EventOf<'wants'>> = (e, ctx) => {
  const v = variant(ctx, 'wants');
  const s = side(ctx);
  return end([
    cue(0, { thought: e.need, look: TOY[e.need], mouth: 'o' }),
    beat(0, { pupil: 1.12, sparkle: 0.8, sy: 1.05 }, 'snap'),
    beat(140, { sy: 1 }, 'jelly', { osc: osc('sy', 0.03, 3, 900) }),
    ...(eared(ctx) ? [beat(0, { earL: 8, earR: -8 }, 'snap'), beat(500, { earL: 0, earR: 0 }, 'jelly')] : []),
    ...(v === 0 ? [beat(100, { headTilt: 8 * s }, 'float')] : v === 1 ? [beat(100, { lean: 5 * s, headTilt: 4 * s }, 'float')] : [beat(80, { sy: 1 }, 'snap', { hop: { h: 7, land: 0.08 } })]),
    cue(700, { mouth: 'smile' }),
    beat(1500, { headTilt: 0, lean: 0, pupil: 1, sparkle: 0 }, 'float', { look: 'user' }),
  ], 'float');
};

/** Sad-but-cute: shrink 0.96, a 3 px slump, one slow blink, brows inner-up 2, mouth E; a brave hop after 1.5 s. */
export const sad: Reaction<EventOf<'sad'>> = (_e, ctx) => {
  const v = variant(ctx, 'sad');
  return end([
    beat(0, { sx: 0.96, sy: 0.96, y: 3, headY: 1 }, 'float', { expr: 'sad', mouth: 'E', blink: 'slow' }),
    ...(browsOn(ctx) ? [beat(0, { browInner: 2 }, 'float')] : []),
    ...(eared(ctx) ? [beat(0, { earDroop: 16 }, 'float')] : []),
    ...(v === 1 ? [beat(300, { headTilt: 5 * side(ctx) }, 'float')] : v === 2 ? [beat(300, { gazeY: 0.5 }, 'float')] : []),
    beat(1500, { sx: 1, sy: 1, y: 0, headY: 0, browInner: 0, earDroop: 0, headTilt: 0, gazeY: 0 }, 'snap', { expr: 'idle', mouth: 'smile', hop: { h: 8, land: 0.1 } }),
  ], 'jelly');
};
