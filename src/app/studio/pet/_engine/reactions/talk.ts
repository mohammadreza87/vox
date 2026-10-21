/**
 * Talk (brief §1.4, §2.5, §2.6): the perk into listening, micro-nods at typing pauses, the acknowledge nod and
 * hop on send, "hmm" cycles while thinking, the speaking onset (with a look-away on some sentence starts),
 * syllable bounces, the small smile when done, and the goodbye wave. The persistent poses (LISTEN lean, the
 * thinking sway and glances, lip-sync) are the engine's state; these are the one-shots on top.
 */

import type { Beat, EventOf, Reaction } from '../types';
import { VISEME_SHAPE } from '../face';
import { beat, browsOn, coin, cue, eared, end, osc, side, variant } from './util';

/** Pill focus / mic: a perk within 100 ms (snap) over the LISTEN lean, ears up, pupils 1.08. */
export const listen: Reaction<EventOf<'listen'>> = (e, ctx) => {
  const v = variant(ctx, 'listen');
  return end([
    beat(0, { sy: 1.03, pupil: 1.08 }, 'snap', { haptic: 'select', look: 'pill' }),
    ...(eared(ctx) ? [beat(0, { earL: 8, earR: -8 }, 'snap'), beat(260, { earL: 3, earR: -3 }, 'jelly')] : []),
    ...(browsOn(ctx) ? [beat(0, { browL: 1.2, browR: 1.2 }, 'snap')] : []),
    ...(v === 1 ? [beat(60, { headTilt: 3 * side(ctx) }, 'float')] : v === 2 && e.source === 'mic' ? [beat(60, { sy: 1 }, 'snap', { hop: { h: 3, land: 0.05 } })] : []),
    beat(180, { sy: 1, earL: 0, earR: 0, browL: 0, browR: 0, headTilt: 0 }, 'pop'),
  ], 'pop');
};

/** A typing pause > 700 ms: a 2° micro-nod. */
export const typingPause: Reaction<EventOf<'typingPause'>> = (_e, ctx) => {
  const v = variant(ctx, 'typingPause');
  return end([beat(0, { headY: 1.2, headTilt: [2, -2, 1][v] }, 'snap'), beat(160, { headY: 0, headTilt: 0 }, 'pop')], 'pop');
};

/** Send: nod rot +4 (snap) → back (pop), a −4 px hop, one blink. */
export const ack: Reaction<EventOf<'ack'>> = (_e, ctx) => {
  const v = variant(ctx, 'ack');
  return end([
    beat(0, { rot: [4, 3, 5][v], headY: 1 }, 'snap', { haptic: 'light', blink: 'once', mouth: 'smile' }),
    beat(80, { rot: 0, headY: 0, sy: 1 }, 'pop', { hop: { h: 4, land: 0.06 } }),
  ], 'pop');
};

/** Thinking: the first cycles shift the weight; after 4 s a "hmm" squash (sy 0.97 / 300) every 2 s. */
export const think: Reaction<EventOf<'think'>> = (e, ctx) => {
  const v = variant(ctx, 'think');
  if (e.cycle < 2) return end([beat(0, { headTilt: [3, -3, 2][v] }, 'float', { mouth: 'smirk' }), beat(900, { headTilt: 0 }, 'float')], 'float');
  return end([
    beat(0, { sy: 0.97, headY: 0.8 }, 'float', { mouth: v === 1 ? 'A' : 'smirk' }),
    ...(browsOn(ctx) && v === 2 ? [beat(0, { browR: 1 }, 'snap')] : []),
    beat(300, { sy: 1, headY: 0, browR: 0 }, 'float'),
  ], 'float');
};

/** The reply starts: a small perk, the eyes come back to you (sometimes a look-away), a brow flick. */
export const speakStart: Reaction<EventOf<'speakStart'>> = (_e, ctx) => {
  const v = variant(ctx, 'speakStart');
  const away = coin(ctx, 0.25);
  return end([
    beat(0, { sy: 1.025 }, 'snap', { look: away ? 'away' : 'user', blink: v === 2 ? 'once' : undefined }),
    ...(browsOn(ctx) ? [beat(0, { browL: 1, browR: 1 }, 'snap'), beat(200, { browL: 0, browR: 0 }, 'pop')] : []),
    ...(v === 1 ? [beat(40, { headTilt: 3 * side(ctx) }, 'float')] : []),
    beat(160, { sy: 1, headTilt: 0 }, 'pop', { look: 'user' }),
  ], 'pop');
};

/** One viseme on the mouth (the lab, tests; live lip-sync runs in the engine's L3 layer). */
export const viseme: Reaction<EventOf<'viseme'>> = (e) => [beat(0, { mouthOpen: e.open, mouthWidth: VISEME_SHAPE[e.v].width }, 'eye', { fixed: true }), beat(120, {}, 'eye', { fixed: true, release: 'eye' })];

/** A syllable onset: the TALK bounce (2.6 px lift, +0.022 stretch), ≥ 150 ms apart; a brow flick 1 in 8. */
export const onset: Reaction<EventOf<'onset'>> = (_e, ctx) => {
  const flick = browsOn(ctx) && coin(ctx, 1 / 8);
  return end([
    beat(0, { y: -2.6, sy: 1.022 }, 'snap', { fixed: true }),
    ...(flick ? [beat(0, { browL: 1.2, browR: 1.2 }, 'snap', { fixed: true })] : []),
    beat(70, { y: 0, sy: 1, browL: 0, browR: 0 }, 'pop', { fixed: true }),
  ], 'pop');
};

/** Done: the mouth is at rest within 110 ms, a small smile for 1.2 s. */
export const speakEnd: Reaction<EventOf<'speakEnd'>> = (_e, ctx) => {
  const v = variant(ctx, 'speakEnd');
  return end([
    beat(0, { mouthOpen: 0 }, 'eye', { mouth: 'smile' }),
    ...(v === 1 ? [beat(60, { rot: 3, headY: 0.8 }, 'snap'), beat(200, { rot: 0, headY: 0 }, 'pop')] : v === 2 ? [cue(120, { blink: 'once' })] : []),
    cue(1200, { mouth: 'X' }),
  ], 'pop');
};

/** A nod. */
export const nod: Reaction<EventOf<'nod'>> = (_e, ctx) => {
  const v = variant(ctx, 'nod');
  return end([beat(0, { headY: 1.6, rot: [3, 2, 4][v] }, 'snap'), beat(140, { headY: 0, rot: 0 }, 'pop'), ...(v === 2 ? [beat(300, { headY: 1 }, 'snap'), beat(420, { headY: 0 }, 'pop')] : [])], 'pop');
};

/** Goodbye: a wave (an ear, or the body rocking 6° × 2) and a small hop, happy. */
export const wave: Reaction<EventOf<'wave'>> = (_e, ctx) => {
  const v = variant(ctx, 'wave');
  const ear = eared(ctx) && v !== 1;
  // a big friendly wave: an ear (or the whole body rocking ±9°) swinging, the head swaying with it, a bounce, a hop
  const beats: Beat[] = [
    beat(0, { sy: 1.06 }, 'snap', { expr: 'happy', mouth: 'grin', haptic: 'light', look: 'user', osc: [ear ? osc('earR', -24, 2.4, 900, false) : osc('rot', 9, 2.2, 900, false), osc('headTilt', ear ? 5 : -4, 2.4, 900, false), osc('sy', 0.025, 4.8, 900)] }),
    beat(160, { sy: 1 }, 'jelly'),
    beat(820, { sy: 0.9 }, 'snap'),
    beat(920, { sy: 1.08 }, 'snap', { hop: { h: v === 2 ? 12 : 9, land: 0.12 } }),
    beat(1050, { sy: 1 }, 'pop'),
    cue(1400, { expr: 'idle', mouth: 'smile' }),
  ];
  return end(beats, 'jelly');
};
