/**
 * Species and family secondary motion (brief §2.8). The minimal character draws ears, tufts and a sprout only:
 * each gets a follower; hair and acc-soft always follow on `accessory`, acc-rigid moves with the head.
 */

import { FOLLOWERS, type Family, type FamilyTuning, type FollowerParams, type Species, type SpeciesTuning } from './types';

const BASE: SpeciesTuning = { alpha: 0.6, breath: 1, hop: 1, gravity: 1, land: 1, jelly: 1, ear: 'ear', tiltMax: 8, listenTilt: 4 };

export const SPECIES_TUNING: Readonly<Record<Species, SpeciesTuning>> = {
  // extra-soft body, breath ×1.2, hop 10 % floatier, wisp puffs when happy
  cloud: { ...BASE, alpha: 0.8, breath: 1.2, gravity: 0.85, ear: null },
  // ear flick micro-fidget; ears flatten 15° on a face poke
  cat: { ...BASE },
  // floppy ears flap on every hop and landing; the biggest listening tilt
  dog: { ...BASE, ear: 'floppy', listenTilt: 10 },
  // stiffer tall ears, floppy asleep or droopy; nose twitch
  bunny: { ...BASE, earParams: { f: 3.5 }, sleepEar: 'floppy' },
  // heavier: lower hops, bigger landing squash, less jelly
  bear: { ...BASE, hop: 0.85, land: 1.15, jelly: 0.85, earParams: { z: 0.5 } },
  // tufts; up to 20° head tilt; slower blink
  owl: { ...BASE, earParams: { f: 2.6 }, tiltMax: 20, listenTilt: 8, blink: { close: 90, open: 140 } },
  // a very springy sprout; tiny rapid double hops when happy
  chick: { ...BASE, earParams: { f: 4, z: 0.25 }, hop: 0.9 },
};

export const FAMILY_TUNING: Readonly<Record<Family, FamilyTuning>> = {
  puff: { sway: 1, swayPeriod: 1, hop: 1, gravity: 1, leanBias: 0 },
  // firmer and top-heavy
  tower: { alpha: 0.5, sway: 1.2, swayPeriod: 1, hop: 0.9, gravity: 1, leanBias: 0 },
  // floaty, leans toward its silhouette's side (the dome leans left)
  drift: { sway: 1, swayPeriod: 1.15, hop: 1, gravity: 0.9, leanBias: -1.5 },
};

/** One merged tuning for a look: what the beat preparer and the loop read. */
export interface Tuning {
  species: Species;
  family: Family;
  alpha: number;
  breath: number;
  hop: number;
  gravity: number;
  land: number;
  jelly: number;
  sway: number;
  swayPeriod: number;
  leanBias: number;
  tiltMax: number;
  listenTilt: number;
  /** null: no ears (cloud) */
  ear: FollowerParams | null;
  /** ear dynamics while asleep or droopy */
  sleepEar: FollowerParams | null;
  blink: { close: number; open: number };
}

export function tuningFor(species: Species = 'cloud', family: Family = 'puff'): Tuning {
  const s = SPECIES_TUNING[species] ?? SPECIES_TUNING.cloud, f = FAMILY_TUNING[family] ?? FAMILY_TUNING.puff;
  const ear = s.ear ? { ...FOLLOWERS[s.ear], ...s.earParams } : null;
  return {
    species, family,
    // a tower's firmness overrides the species' α (a tower cloud is firm vinyl too)
    alpha: f.alpha ?? s.alpha,
    breath: s.breath, hop: s.hop * f.hop, gravity: s.gravity * f.gravity, land: s.land, jelly: s.jelly,
    sway: f.sway, swayPeriod: f.swayPeriod, leanBias: f.leanBias, tiltMax: s.tiltMax, listenTilt: s.listenTilt,
    ear, sleepEar: s.sleepEar ? FOLLOWERS[s.sleepEar] : ear,
    blink: s.blink ?? { close: 60, open: 90 },
  };
}

/** α for a beat: `jelly` wobble after an impact is always the soft 0.8 (§2.1). */
export const alphaFor = (t: Tuning, spring: string) => (spring === 'jelly' ? Math.max(t.alpha, 0.8) : t.alpha);

/** sx for a squash or stretch sy, volume preserved: sx = sy^(−α). */
export const volumeSx = (sy: number, alpha: number) => Math.pow(sy, -alpha);
