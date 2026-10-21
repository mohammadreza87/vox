/**
 * Celebrate (brief §2.6): stage-up, a Bond milestone, a Bop win. Anticipation crouch (sx 1.08 / sy 0.9, 120 ms)
 * → two hops (the second at 70 %) → 5–8 sparkles or hearts → jelly. Happy arcs ~1000 ms, pupils 1.12.
 */

import type { Beat, EventOf, ParticleKind, Reaction } from '../types';
import { beat, burst, cue, doubleHop, end, eared, hopMs, osc, rr, variant } from './util';

const BURST: Record<EventOf<'celebrate'>['why'], ParticleKind> = { stage: 'sparkle', bond: 'heart', win: 'sparkle' };

export const celebrate: Reaction<EventOf<'celebrate'>> = (e, ctx) => {
  const v = variant(ctx, 'celebrate');
  const h = [20, 24, 18][v];
  const n = Math.round(rr(ctx, 5, 8));
  const kind = BURST[e.why];
  const apex = 120 + hopMs(h) / 2;
  const beats: Beat[] = [
    cue(0, { expr: 'happy', mouth: 'grin', blink: 'suppress', haptic: 'success' }),
    beat(0, { pupil: 1.12 }, 'float'),
    ...doubleHop(0, h),
    beat(apex, {}, 'pop', { particles: [burst(kind, n, 'head'), ...(e.why === 'win' ? [burst('note', 2, 'head')] : [])] }),
  ];
  // variants: a spin on the first hop, ears flung up, or a wiggle on landing
  if (v === 0) beats.push(beat(140, { rot: 360 }, 'float'));
  if (v === 1 && eared(ctx)) beats.push(beat(120, { earL: 14, earR: -14 }, 'snap'), beat(apex + 200, { earL: 0, earR: 0 }, 'jelly'));
  if (v === 2) beats.push(beat(apex + hopMs(h) + 200, {}, 'jelly', { osc: osc('rot', 5, 4, 600) }));
  if (e.why === 'stage') beats.push(beat(0, { glow: 1 }, 'float'), cue(900, { say: 'learned' }), beat(1300, { glow: 0 }, 'sleepy'));
  beats.sort((a, b) => a.at - b.at);
  beats.push(beat(1000, { sy: 1, pupil: 1 }, 'jelly', { mouth: 'smile', expr: 'idle', blink: 'allow' }));
  return end(beats, 'jelly');
};
