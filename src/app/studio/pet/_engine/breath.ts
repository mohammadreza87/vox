/**
 * Breath, sway and the mood's idle parameters (brief §2.3 L1, §2.4). Breath and sway run as CSS keyframes on the
 * character wrapper (compositor-driven, alive while JS streams a reply, and the rAF loop can sleep at rest, §3.3):
 * the engine only eases their CSS variables when the mood or the state changes. The keyframes animate the
 * individual `scale` and `rotate` properties, which compose with the engine's inline `transform` about the same
 * ground origin. `breathAt` is the same curve in JS for frame sheets and tests.
 */

import type { Mood, MoodTone } from '@/lib/pet/types';
import type { Stage } from '@/lib/studio/types';
import { BREATHE } from '../../_components/character/poses';
import type { Tuning } from './species';

/** Idle parameters for one mood: breath, sway, lids, pupils, blink and gaze-drift timing. */
export interface IdleParams {
  /** s per breath */
  period: number;
  /** breath peak scale (sx narrows a touch while sy rises from the base) */
  bx: number;
  by: number;
  /** inhale share of the breath (40 : 60 by default) */
  inhale: number;
  /** sway amplitude (±deg) and period (s) */
  sway: number;
  swayPeriod: number;
  /** resting lid (1 open) and pupil scale */
  lid: number;
  pupil: number;
  /** blink gap median (s, log-normal σ 0.45) and the share of slow blinks */
  blinkMedian: number;
  slowBlinks: number;
  /** gaze drift interval (ms) and how often a drift returns to the user */
  drift: [number, number];
  homeShare: number;
  /** brows: inner ends up (bored, sad) */
  browInner: number;
  /** reaction tempo (droopy 0.85: everything a little slower) */
  tempo: number;
}

const TONE: Record<MoodTone, { period: number; peak: [number, number]; inhale: number; sway: number; swayK: number; lid: number; pupil: number; blink: number; slow: number; drift: [number, number]; home: number; inner: number }> = {
  content: { period: 1, peak: [BREATHE.high.sx, BREATHE.high.sy], inhale: 0.4, sway: 1.2, swayK: 1, lid: 1, pupil: 1, blink: 3.5, slow: 0.05, drift: [3500, 8000], home: 0.5, inner: 0 },
  hungry: { period: 1.1, peak: [0.99, 1.02], inhale: 0.4, sway: 0.6, swayK: 1, lid: 0.9, pupil: 0.95, blink: 3.5, slow: 0.05, drift: [3500, 8000], home: 0.5, inner: 0.6 },
  tired: { period: 1.3, peak: [0.99, 1.018], inhale: 0.35, sway: 0.8, swayK: 1.3, lid: 0.7, pupil: 0.95, blink: 2.8, slow: 0.35, drift: [7000, 14000], home: 0.7, inner: 0.4 },
  bored: { period: 1, peak: [BREATHE.high.sx, BREATHE.high.sy], inhale: 0.4, sway: 2, swayK: 1, lid: 0.95, pupil: 0.95, blink: 3, slow: 0.05, drift: [1500, 3000], home: 0.3, inner: 1.5 },
  happy: { period: 0.9, peak: [0.98, 1.04], inhale: 0.45, sway: 1.5, swayK: 1, lid: 1, pupil: 1.06, blink: 3.2, slow: 0.03, drift: [3500, 8000], home: 0.75, inner: 0 },
};

/** The sleeper's breath: slow, deep, mostly sideways (§2.6 asleep loop). */
const ASLEEP = { period: BREATHE.period.sleeping, peak: [BREATHE.sleepHigh.sx, BREATHE.sleepHigh.sy] as [number, number], inhale: 0.45, sway: 1, swayPeriod: 9 };

export function idleParams(mood: Mood, stage: Stage, t: Tuning): IdleParams {
  const tone = TONE[mood.tone] ?? TONE.content;
  const droopy = mood.level === 'droopy';
  const amp = (droopy ? 0.7 : 1) * t.breath;
  const tempo = droopy ? 0.85 : 1;
  const base = BREATHE.period[stage] ?? BREATHE.period[4];
  const asleep = mood.asleep;
  const peak = asleep ? ASLEEP.peak : tone.peak;
  return {
    period: asleep ? ASLEEP.period : (base * tone.period) / tempo,
    bx: 1 + (peak[0] - 1) * amp, by: 1 + (peak[1] - 1) * amp,
    inhale: asleep ? ASLEEP.inhale : tone.inhale,
    sway: (asleep ? ASLEEP.sway : tone.sway) * t.sway * (droopy ? 0.7 : 1),
    swayPeriod: (asleep ? ASLEEP.swayPeriod : 8 * tone.swayK) * t.swayPeriod / tempo,
    lid: droopy ? Math.min(tone.lid, 0.7) : tone.lid,
    pupil: tone.pupil,
    blinkMedian: tone.blink, slowBlinks: tone.slow,
    drift: tone.drift, homeShare: tone.home,
    browInner: tone.inner,
    tempo,
  };
}

/** 0 at rest … 1 at the breath peak, for a phase in [0, 1): eased in on the inhale, out on the exhale. */
export function breathAt(phase: number, inhale = 0.4): number {
  const p = ((phase % 1) + 1) % 1;
  return p < inhale ? (1 - Math.cos((Math.PI * p) / inhale)) / 2 : (1 + Math.cos((Math.PI * (p - inhale)) / (1 - inhale))) / 2;
}

/** The CSS breath + sway at time t (s): what pet.css's `.pet-breathe` keyframes draw, for sheets and tests. */
export function breathPose(tSec: number, p: Pick<IdleParams, 'period' | 'bx' | 'by' | 'inhale' | 'sway' | 'swayPeriod'>, amp = 1): { sx: number; sy: number; rot: number } {
  const b = breathAt(tSec / p.period, p.inhale) * amp;
  return { sx: 1 + (p.bx - 1) * b, sy: 1 + (p.by - 1) * b, rot: p.sway * amp * Math.sin((2 * Math.PI * tSec) / p.swayPeriod) };
}

/**
 * CSS variables the engine writes on the wrapper (through `engine.body`). pet.css's `.pet-breathe` keyframes read
 * the peak and sway live; PetRig latches the two periods at a cycle boundary so a mood change never jumps the phase.
 */
export const BREATH_VARS = { bx: '--pet-bx', by: '--pet-by', period: '--pet-bp', sway: '--pet-sw', swayPeriod: '--pet-swp' } as const;

