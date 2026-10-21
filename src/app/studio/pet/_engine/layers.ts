/**
 * Layer composition (brief §2.3): L0 pose state + L1 mood + L2 expression weights live in one spring bank (the
 * base), L4 one-shots in another (neutral at rest), L3 procedural motion (gaze, blink, lip-sync, hops, physics,
 * oscillations) is summed per frame, and L5 followers chase the final body. MULTIPLY channels compose as factors,
 * the rest as offsets. The result is one RigFrame: plain numbers and shapes that RigWriter writes into
 * CharacterView's RigBindings MotionValues (and poseToSvg draws for frame sheets).
 */

import { motionValue, type MotionStyle, type MotionValue } from 'framer-motion';
import { BEAK_DROP, beakLowerD, beakMouth, GROUND, INK, mouthD, type CharacterModel } from '@/lib/studio/character';
import type { RigBindings } from '../../_components/character/CharacterView';
import { BREATH_VARS } from './breath';
import { beakOpen, browsD, bulgePath, lerpPath, petEyeD, petMouthD, type Bulge, type PetEyeShape, type PetMouthShape } from './face';
import { follow, followerAtRest, makeFollower, resetFollower, retune } from './follower';
import type { Tuning } from './species';
import { atRest, makeSpring, settle, step } from './spring';
import { FOLLOWERS, MULTIPLY, NEUTRAL_POSE, TIER_BUDGET, type Channel, type Follower, type FollowerParams, type PoseTargets, type Spring, type SpringPreset, type Tier } from './types';

export const CHANNELS = Object.keys(NEUTRAL_POSE) as Channel[];
export const combine = (c: Channel, a: number, b: number) => (MULTIPLY.has(c) ? a * b : a + b);

/* ---------- spring banks (L0–L2 base, L4 one-shots) ---------- */

export type Bank = Record<Channel, Spring>;
export function makeBank(base: Readonly<PoseTargets> = NEUTRAL_POSE, preset: SpringPreset = 'float'): Bank {
  return Object.fromEntries(CHANNELS.map((c) => [c, makeSpring(base[c], preset)])) as Bank;
}
export function stepBank(b: Bank, dtMs: number, frozen?: ReadonlySet<Channel>): void {
  for (const c of CHANNELS) if (!frozen?.has(c)) step(b[c], dtMs);
}
/** At rest: every spring still. Settles each one exactly on its target as a side effect. */
export function bankAtRest(b: Bank): boolean {
  let rest = true;
  for (const c of CHANNELS) { const s = b[c]; if (atRest(s)) { if (s.x !== s.t) settle(s); } else rest = false; }
  return rest;
}
export const readBank = (b: Bank): PoseTargets => Object.fromEntries(CHANNELS.map((c) => [c, b[c].x])) as unknown as PoseTargets;

/** base ⊕ shot ⊕ procedural, channel by channel. */
export function compose(base: Bank, shot: Bank, proc: Partial<PoseTargets>): PoseTargets {
  const out = {} as PoseTargets;
  for (const c of CHANNELS) {
    const v = combine(c, base[c].x, shot[c].x);
    const p = proc[c];
    out[c] = p === undefined ? v : combine(c, v, p);
  }
  return out;
}

/** Body channels a hit-stop freezes (impact read). */
export const BODY: ReadonlySet<Channel> = new Set<Channel>(['x', 'y', 'sx', 'sy', 'rot', 'lean', 'headX', 'headY', 'headTilt']);

/* ---------- L5 followers ---------- */

/** Head height above the ground (px at 200): a stretch moves the head by (sy − 1)·this. */
const HEAD_H = 118;
/** Ear swing per px of vertical lag, per ° of rotation lag (floppy ears swing more). */
const EAR_GAIN = { v: 0.42, floppyV: 0.9, r: 0.9, rMax: 24 };

export interface SecondaryOut { earL: number; earR: number; tail: number; hairY: number; hairSy: number; accY: number; cheek: number; shadow: number; puff: number }

export class Secondary {
  private earL: Follower;
  private earR: Follower;
  private headV: Follower;
  private headR: Follower;
  private hairV: Follower;
  private tailR: Follower;
  private cheek: Follower = makeFollower(1, 'cheek');
  private puff: Follower = makeFollower(0, 'cheek');
  private shadow: Follower = makeFollower(1, 'shadow');
  private floppy = false;
  private acc = 0;
  out: SecondaryOut = { earL: 0, earR: 0, tail: 0, hairY: 0, hairSy: 1, accY: 0, cheek: 1, shadow: 1, puff: 0 };

  constructor(private t: Tuning) {
    const ear = t.ear ?? FOLLOWERS.ear;
    this.earL = makeFollower(0, ear); this.earR = makeFollower(0, ear);
    this.headV = makeFollower(0, ear); this.headR = makeFollower(0, ear);
    this.hairV = makeFollower(0, 'accessory'); this.tailR = makeFollower(0, 'accessory');
    this.floppy = t.ear !== null && t.ear.f < 2.5;
  }

  /** Asleep or droopy: bunny ears go floppy (dog ears are always floppy). Keeps position and velocity. */
  setSleepy(sleepy: boolean): void {
    const p: FollowerParams | null = sleepy ? this.t.sleepEar : this.t.ear;
    if (!p) return;
    for (const f of [this.earL, this.earR, this.headV, this.headR]) retune(f, p);
    this.floppy = p.f < 2.5;
  }

  /** Chase the final body. Lite steps at 30 Hz (§2.9). */
  update(p: PoseTargets, dtMs: number, tier: Tier): SecondaryOut {
    this.acc += dtMs;
    if (tier === 'lite' && this.acc < 1000 / 30) return this.out;
    const dt = this.acc;
    this.acc = 0;
    const v = p.y - (p.sy - 1) * HEAD_H;
    const rot = p.rot + p.lean + p.headTilt;
    // world-frame lag: positive when the head has moved up faster than the ears could follow
    const lagV = follow(this.headV, v, dt) - v;
    const lagR = follow(this.headR, rot, dt) - rot;
    const gv = this.floppy ? EAR_GAIN.floppyV : EAR_GAIN.v;
    const tl = follow(this.earL, p.earL - p.earDroop, dt), tr = follow(this.earR, p.earR + p.earDroop, dt);
    const lagH = follow(this.hairV, v, dt) - v;
    this.out = {
      // ears flop outward when the head leaves them behind, and trail the body's rotation
      // (a spin's rotation lag is capped: the ears trail it, they never wind round the head)
      earL: tl - gv * lagV + EAR_GAIN.r * Math.max(-EAR_GAIN.rMax, Math.min(EAR_GAIN.rMax, lagR)),
      earR: tr + gv * lagV + EAR_GAIN.r * Math.max(-EAR_GAIN.rMax, Math.min(EAR_GAIN.rMax, lagR)),
      tail: follow(this.tailR, rot + p.tail, dt) - rot + lagH * 0.4,
      hairY: p.hair + lagH * 0.16,
      hairSy: 1 + Math.max(-0.06, Math.min(0.06, lagH * 0.004)),
      accY: p.acc + lagH * 0.24,
      cheek: follow(this.cheek, p.cheek, dt),
      puff: follow(this.puff, p.puff, dt),
      // the contact shadow shrinks and fades as the body leaves the ground
      shadow: follow(this.shadow, p.shadow * (1 - Math.min(1, Math.max(0, -p.y / 120)) * 0.45), dt),
    };
    return this.out;
  }

  /** A full spin was let go from the same angle (rot − w): the followers that trail the rotation move with it. */
  unwind(w: number): void {
    for (const f of [this.headR, this.tailR]) { f.y -= w; f.xp -= w; }
  }

  atRest(): boolean {
    // every follower is checked (and settled) even after one is found moving
    return [this.earL, this.earR, this.headV, this.headR, this.hairV, this.tailR, this.cheek, this.shadow, this.puff].map((f) => followerAtRest(f)).every(Boolean);
  }

  reset(p: PoseTargets): void {
    const v = p.y - (p.sy - 1) * HEAD_H, rot = p.rot + p.lean + p.headTilt;
    resetFollower(this.earL, p.earL - p.earDroop); resetFollower(this.earR, p.earR + p.earDroop);
    resetFollower(this.headV, v); resetFollower(this.headR, rot); resetFollower(this.hairV, v); resetFollower(this.tailR, rot + p.tail);
    resetFollower(this.cheek, p.cheek); resetFollower(this.shadow, p.shadow); resetFollower(this.puff, p.puff);
    this.update(p, 0, 'full');
  }
}

/* ---------- the frame ---------- */

/** Everything one frame draws, as numbers (px at a 200 px character, degrees, view-box units). */
export interface RigFrame {
  body: { x: number; y: number; sx: number; sy: number; rot: number };
  /** CSS breath and sway (the wrapper's keyframes) */
  breath: { bx: number; by: number; period: number; sway: number; swayPeriod: number };
  face: { x: number; y: number; rot: number };
  accRigid: { x: number; y: number; rot: number };
  accSoft: { y: number };
  hair: { y: number; sy: number };
  fx: { y: number; o: number };
  shadow: { y: number; rot: number; s: number; o: number };
  earL: number;
  earR: number;
  tail: number;
  lids: number;
  blush: { o: number; s: number };
  cheeks: number;
  eyeL: PetEyeShape;
  eyeR: PetEyeShape;
  /** eye stroke weight (0 a filled oval … the model's stroke on a closed arc) and the catch-light opacity */
  eyeStroke: [number, number];
  glint: number;
  mouth: PetMouthShape;
  brows: { l: number; r: number; inner: number; arch: number };
  /** stage-up body tween 0 old … 1 new */
  morph: number;
  /** body outline bumps (puffed cheeks, a gulp travelling down); empty at rest */
  bulges: Bulge[];
  /** pet-only marks: the tongue (offset/scale of its base circle at the mouth centre), sparkle highlights (offset with
   *  the gaze), dizzy swirls (offset, turn); each opacity 0 at rest */
  tongue: { x: number; y: number; sx: number; sy: number; o: number };
  sparkle: { x: number; y: number; o: number };
  swirl: { x: number; y: number; rot: number; o: number };
  dim: number;
  glow: number;
}

/** What the writer needs from the model (the engine's own copy, built like Cloud's anchors). */
export interface Geom {
  model: CharacterModel;
  /** the body path at the stage being grown from (stage-up), else the model's */
  fromBodyD: string;
  /** glasses and specs move with the face; hats stay on the crown */
  lensed: boolean;
}

/* ---------- writer: RigFrame → MotionValues, inside the per-frame budget ---------- */

type Num = MotionValue<number>;
const mv = (v: number): Num => motionValue(v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Transform groups by priority: the first ones win when a frame is over budget (the rest go next frame). */
const GROUPS = ['face', 'lids', 'earL', 'earR', 'shadow', 'blush', 'cheeks', 'tongue', 'sparkle', 'swirl', 'hair', 'accSoft', 'accRigid', 'tail', 'fx'] as const;
type Group = (typeof GROUPS)[number];
const MORPHS = ['mouth', 'beak', 'eyeL', 'eyeR', 'brows', 'body'] as const;
type Morph = (typeof MORPHS)[number];

export interface WriteStats { morphs: number; transforms: number; deferred: number }

export class RigWriter {
  readonly rig: RigBindings;
  readonly body: MotionStyle;
  readonly dim: Num = mv(0);
  readonly glow: Num = mv(0);
  private v: Record<string, Num> = {};
  private s: Record<'eyeLD' | 'eyeRD' | 'mouthD' | 'beakD' | 'browsD' | 'bodyD', MotionValue<string>>;
  private last = new Map<string, number | string>();
  /** the most recent frame written (tests, sheets) */
  frame: RigFrame | null = null;

  constructor(geom: Geom) {
    const n = (key: string, v: number) => (this.v[key] = mv(v));
    const m = geom.model;
    this.s = {
      eyeLD: motionValue(''), eyeRD: motionValue(''), mouthD: motionValue(''), beakD: motionValue(''), browsD: motionValue(''), bodyD: motionValue(m.bodyD),
    };
    const eye = (side: 'L' | 'R'): MotionStyle => ({ fill: INK, stroke: INK, strokeWidth: n(`eye${side}SW`, 0), strokeLinecap: 'round', strokeLinejoin: 'round' });
    this.rig = {
      lids: { scaleY: n('lids', 1) },
      eyeLD: this.s.eyeLD, eyeRD: this.s.eyeRD, mouthD: this.s.mouthD, beakD: this.s.beakD, bodyD: this.s.bodyD, browsD: this.s.browsD,
      eyeStyle: { l: eye('L'), r: eye('R') },
      glint: { opacity: n('glint', 0.72) },
      blush: { opacity: n('blushO', 0), scale: n('blushS', 1) },
      cheeks: { scale: n('cheeks', 1) },
      tongue: { x: n('tgX', 0), y: n('tgY', 0), scaleX: n('tgSx', 1), scaleY: n('tgSy', 1), opacity: n('tgO', 0) },
      sparkle: { x: n('spX', 0), y: n('spY', 0), opacity: n('spO', 0) },
      swirl: { x: n('swX', 0), y: n('swY', 0), rotate: n('swR', 0), opacity: n('swO', 0) },
      earL: { rotate: n('earL', 0) },
      earR: { rotate: n('earR', 0) },
      tail: { rotate: n('tail', 0) },
      layer: {
        face: { x: n('faceX', 0), y: n('faceY', 0), rotate: n('faceR', 0) },
        'acc-rigid': { x: n('arX', 0), y: n('arY', 0), rotate: n('arR', 0) },
        'acc-soft': { y: n('asY', 0) },
        hair: { y: n('hairY', 0), scaleY: n('hairSy', 1) },
        fx: { y: n('fxY', 0), opacity: n('fxO', 1) },
        shadow: { y: n('shY', 0), rotate: n('shR', 0), scale: n('shS', 1), opacity: n('shO', 1) },
      },
    };
    this.body = {
      x: n('x', 0), y: n('y', 0), scaleX: n('sx', 1), scaleY: n('sy', 1), rotate: n('rot', 0),
      originX: '50%', originY: `${(GROUND / 200) * 100}%`,
      [BREATH_VARS.bx]: n('bx', 1), [BREATH_VARS.by]: n('by', 1), [BREATH_VARS.period]: n('bp', 4), [BREATH_VARS.sway]: n('sw', 0), [BREATH_VARS.swayPeriod]: n('swp', 8),
    } as MotionStyle;
  }

  private set(key: string, v: number, round = r3): boolean {
    const x = round(v);
    if (this.last.get(key) === x) return false;
    this.last.set(key, x);
    this.v[key].set(x);
    return true;
  }
  private dirty(key: string, v: number, round = r3): boolean { return this.last.get(key) !== round(v); }

  /**
   * Write a frame. k = px per unit (size / 200); growth is the model's stage scale (counter-transforms inside
   * the SVG are divided by it). Returns how many morph paths and SVG transforms changed (the budget tests count
   * these); anything over the tier's budget is deferred to the next frame, highest priority first.
   */
  write(f: RigFrame, geom: Geom, k: number, tier: Tier): WriteStats {
    this.frame = f;
    const m = geom.model;
    // the wrapper (an HTML div, composited: not an SVG transform)
    this.set('x', f.body.x * k, r2); this.set('y', f.body.y * k, r2);
    this.set('sx', f.body.sx, r3); this.set('sy', f.body.sy, r3); this.set('rot', f.body.rot, r2);
    this.set('bx', f.breath.bx, r3); this.set('by', f.breath.by, r3); this.set('bp', f.breath.period, r2);
    this.set('sw', f.breath.sway, r2); this.set('swp', f.breath.swayPeriod, r2);
    this.dim.set(r3(f.dim)); this.glow.set(r3(f.glow));

    // SVG transforms, as groups of values
    const g = m.growth;
    const groups: Record<Group, Array<[string, number]>> = {
      face: [['faceX', f.face.x], ['faceY', f.face.y], ['faceR', f.face.rot]],
      lids: [['lids', f.lids]],
      earL: [['earL', f.earL]],
      earR: [['earR', f.earR]],
      // the shadow stays on the ground while the body hops or is dragged up (decision 12)
      shadow: [['shY', -f.body.y / (f.body.sy * g)], ['shR', -f.body.rot], ['shS', f.shadow.s], ['shO', f.shadow.o]],
      blush: [['blushO', f.blush.o], ['blushS', f.blush.s]],
      cheeks: [['cheeks', f.cheeks]],
      // an invisible mark only writes its opacity (talking moves the mouth every frame: no hidden tongue work)
      tongue: f.tongue.o < 0.01 ? [['tgO', 0]] : [['tgX', f.tongue.x], ['tgY', f.tongue.y], ['tgSx', f.tongue.sx], ['tgSy', f.tongue.sy], ['tgO', f.tongue.o]],
      sparkle: f.sparkle.o < 0.01 ? [['spO', 0]] : [['spX', f.sparkle.x], ['spY', f.sparkle.y], ['spO', f.sparkle.o]],
      swirl: f.swirl.o < 0.01 ? [['swO', 0]] : [['swX', f.swirl.x], ['swY', f.swirl.y], ['swR', f.swirl.rot], ['swO', f.swirl.o]],
      hair: [['hairY', f.hair.y], ['hairSy', f.hair.sy]],
      accSoft: [['asY', f.accSoft.y]],
      accRigid: [['arX', f.accRigid.x], ['arY', f.accRigid.y], ['arR', f.accRigid.rot]],
      tail: [['tail', f.tail]],
      fx: [['fxY', f.fx.y], ['fxO', f.fx.o]],
    };
    const budget = tier === 'reduced' ? Infinity : TIER_BUDGET[tier].transforms;
    let transforms = 0, deferred = 0;
    for (const gr of GROUPS) {
      const vals = groups[gr];
      if (!vals.some(([key, v]) => this.dirty(key, v))) continue;
      if (transforms >= budget) { deferred++; continue; }
      for (const [key, v] of vals) this.set(key, v);
      transforms++;
    }
    // stroke weights and the glint are paint, not transforms
    this.set('eyeLSW', f.eyeStroke[0] * m.face.strokeW, r2); this.set('eyeRSW', f.eyeStroke[1] * m.face.strokeW, r2);
    this.set('glint', f.glint, r2);

    // morph paths
    const e = m.face.eyes, bk = m.face.beak;
    const mouth = bk ? beakMouth(f.mouth) : f.mouth;
    const paths: Record<Morph, string | null> = {
      mouth: bk ? mouthD(m.face.mouth.x, m.face.mouth.y, mouth) : petMouthD(m.face.mouth.x, m.face.mouth.y, mouth),
      beak: bk ? beakLowerD(bk.x, bk.top, bk.k, Math.round(beakOpen(f.mouth) * BEAK_DROP * bk.k * 10) / 10) : null,
      eyeL: petEyeD(e[0].cx, e[0].cy, f.eyeL, 1),
      eyeR: petEyeD(e[1].cx, e[1].cy, f.eyeR, -1),
      brows: browsD(e, f.brows.l, f.brows.r, f.brows.inner, f.brows.arch),
      body: bulgePath(lerpPath(geom.fromBodyD, m.bodyD, f.morph), m.pivots.body[0], f.bulges),
    };
    const key: Record<Morph, keyof typeof this.s> = { mouth: 'mouthD', beak: 'beakD', eyeL: 'eyeLD', eyeR: 'eyeRD', brows: 'browsD', body: 'bodyD' };
    const mBudget = tier === 'reduced' ? Infinity : TIER_BUDGET[tier].morphs;
    let morphs = 0;
    for (const mo of MORPHS) {
      const d = paths[mo];
      if (d === null || this.last.get(key[mo]) === d) continue;
      if (morphs >= mBudget) { deferred++; continue; }
      this.last.set(key[mo], d);
      this.s[key[mo]].set(d);
      morphs++;
    }
    return { morphs, transforms, deferred };
  }

  /** Forget what was written (a look change re-renders the SVG: write everything again). */
  invalidate(geom: Geom): void {
    this.last.clear();
    this.s.bodyD.set(geom.model.bodyD);
  }
}
