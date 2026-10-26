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
const clampAbs = (v: number, m: number) => (v < -m ? -m : v > m ? m : v);
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
export function compose(base: Bank, shot: Bank, proc: Partial<PoseTargets>, out = {} as PoseTargets): PoseTargets {
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
/**
 * Overlap on the soft parts (§10.2): the face slides a little after the body (view units per px of lag, capped),
 * the cheeks jiggle with the body's vertical lag (scale per px), soft accessories and hair swing behind the
 * body's rotation (degrees per degree of lag, capped). All chase the body on followers: nothing is keyframed.
 */
const SOFT = { faceY: 0.05, faceMax: 1.4, cheek: 0.006, cheekMax: 0.07, accRot: 0.45, accMax: 9, hairRot: 0.3, hairMax: 6 };

export interface SecondaryOut { earL: number; earR: number; tail: number; hairY: number; hairSy: number; hairRot: number; accY: number; accRot: number; faceY: number; cheek: number; shadow: number; puff: number }

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
  private accR: Follower = makeFollower(0, 'accessory');
  private faceV: Follower = makeFollower(0, 'cheek');
  private all: Follower[];
  private floppy = false;
  private acc = 0;
  /** written in place every update (no per-frame allocation) */
  readonly out: SecondaryOut = { earL: 0, earR: 0, tail: 0, hairY: 0, hairSy: 1, hairRot: 0, accY: 0, accRot: 0, faceY: 0, cheek: 1, shadow: 1, puff: 0 };

  constructor(private t: Tuning) {
    const ear = t.ear ?? FOLLOWERS.ear;
    this.earL = makeFollower(0, ear); this.earR = makeFollower(0, ear);
    this.headV = makeFollower(0, ear); this.headR = makeFollower(0, ear);
    this.hairV = makeFollower(0, 'accessory'); this.tailR = makeFollower(0, 'accessory');
    this.floppy = t.ear !== null && t.ear.f < 2.5;
    this.all = [this.earL, this.earR, this.headV, this.headR, this.hairV, this.tailR, this.cheek, this.shadow, this.puff, this.accR, this.faceV];
  }

  /** Asleep or droopy: bunny ears go floppy (dog ears are always floppy). Keeps position and velocity. */
  setSleepy(sleepy: boolean): void {
    const p: FollowerParams | null = sleepy ? this.t.sleepEar : this.t.ear;
    if (!p) return;
    retune(this.earL, p); retune(this.earR, p); retune(this.headV, p); retune(this.headR, p);
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
    const lagA = follow(this.accR, rot, dt) - rot;
    const lagF = follow(this.faceV, v, dt) - v;
    const o = this.out, rl = clampAbs(lagR, EAR_GAIN.rMax);
    // ears flop outward when the head leaves them behind, and trail the body's rotation
    // (a spin's rotation lag is capped: the ears trail it, they never wind round the head)
    o.earL = tl - gv * lagV + EAR_GAIN.r * rl;
    o.earR = tr + gv * lagV + EAR_GAIN.r * rl;
    o.tail = follow(this.tailR, rot + p.tail, dt) - rot + lagH * 0.4;
    o.hairY = p.hair + lagH * 0.16;
    o.hairSy = 1 + clampAbs(lagH * 0.004, 0.06);
    // hair and soft accessories swing behind a turn (the bow trails a spin, then catches up and settles)
    o.hairRot = clampAbs(lagA * SOFT.hairRot, SOFT.hairMax);
    o.accY = p.acc + lagH * 0.24;
    o.accRot = clampAbs(lagA * SOFT.accRot, SOFT.accMax);
    // the face (eyes, mouth, brows) lands a beat after the body: it sinks into a landing and lifts after a hop
    o.faceY = clampAbs(lagF * SOFT.faceY, SOFT.faceMax);
    // the cheeks jiggle with the body's vertical lag on top of their own puff
    o.cheek = follow(this.cheek, p.cheek, dt) * (1 + clampAbs(lagF * SOFT.cheek, SOFT.cheekMax));
    o.puff = follow(this.puff, p.puff, dt);
    // reduced motion: no overlap swing (the soft parts ride the body)
    if (tier === 'reduced') { o.hairRot = 0; o.accRot = 0; o.faceY = 0; o.cheek = this.cheek.y; }
    // the contact shadow shrinks and fades as the body leaves the ground
    o.shadow = follow(this.shadow, p.shadow * (1 - Math.min(1, Math.max(0, -p.y / 120)) * 0.45), dt);
    return o;
  }

  /** A full spin was let go from the same angle (rot − w): the followers that trail the rotation move with it. */
  unwind(w: number): void {
    for (const f of [this.headR, this.tailR, this.accR]) { f.y -= w; f.xp -= w; }
  }

  atRest(): boolean {
    // every follower is checked (and settled) even after one is found moving
    let rest = true;
    for (const f of this.all) if (!followerAtRest(f)) rest = false;
    return rest;
  }

  reset(p: PoseTargets): void {
    const v = p.y - (p.sy - 1) * HEAD_H, rot = p.rot + p.lean + p.headTilt;
    resetFollower(this.earL, p.earL - p.earDroop); resetFollower(this.earR, p.earR + p.earDroop);
    resetFollower(this.headV, v); resetFollower(this.headR, rot); resetFollower(this.hairV, v); resetFollower(this.tailR, rot + p.tail);
    resetFollower(this.cheek, p.cheek); resetFollower(this.shadow, p.shadow); resetFollower(this.puff, p.puff);
    resetFollower(this.accR, rot); resetFollower(this.faceV, v);
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
  accSoft: { y: number; rot: number };
  hair: { y: number; sy: number; rot: number };
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
/** each group's MotionValue keys, in the order fillGroups writes them (an opacity-only group's opacity is last) */
const GROUP_KEYS: ReadonlyArray<readonly string[]> = [
  ['faceX', 'faceY', 'faceR'], ['lids'], ['earL'], ['earR'], ['shY', 'shR', 'shS', 'shO'], ['blushO', 'blushS'], ['cheeks'],
  ['tgX', 'tgY', 'tgSx', 'tgSy', 'tgO'], ['spX', 'spY', 'spO'], ['swX', 'swY', 'swR', 'swO'], ['hairY', 'hairSy', 'hairR'], ['asY', 'asR'],
  ['arX', 'arY', 'arR'], ['tail'], ['fxY', 'fxO'],
];
const OPACITY_ONLY: readonly boolean[] = GROUPS.map((gr) => gr === 'tongue' || gr === 'sparkle' || gr === 'swirl');

/** One frame's transform values into the preallocated rows (same order as GROUP_KEYS). */
function row(r: number[], a: number, b = 0, c = 0, d = 0, e = 0): void { r[0] = a; r[1] = b; r[2] = c; r[3] = d; r[4] = e; }
function fillGroups(V: number[][], f: RigFrame, g: number): void {
  row(V[0], f.face.x, f.face.y, f.face.rot);
  row(V[1], f.lids); row(V[2], f.earL); row(V[3], f.earR);
  // the shadow stays on the ground while the body hops or is dragged up (decision 12)
  row(V[4], -f.body.y / (f.body.sy * g), -f.body.rot, f.shadow.s, f.shadow.o);
  row(V[5], f.blush.o, f.blush.s); row(V[6], f.cheeks);
  row(V[7], f.tongue.x, f.tongue.y, f.tongue.sx, f.tongue.sy, f.tongue.o);
  row(V[8], f.sparkle.x, f.sparkle.y, f.sparkle.o);
  row(V[9], f.swirl.x, f.swirl.y, f.swirl.rot, f.swirl.o);
  row(V[10], f.hair.y, f.hair.sy, f.hair.rot); row(V[11], f.accSoft.y, f.accSoft.rot);
  row(V[12], f.accRigid.x, f.accRigid.y, f.accRigid.rot); row(V[13], f.tail); row(V[14], f.fx.y, f.fx.o);
}
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
  private vals: number[][] = GROUP_KEYS.map(() => [0, 0, 0, 0, 0]);
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
        'acc-soft': { y: n('asY', 0), rotate: n('asR', 0) },
        hair: { y: n('hairY', 0), scaleY: n('hairSy', 1), rotate: n('hairR', 0) },
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

    // SVG transforms, as groups of values (filled into preallocated rows: no per-frame arrays)
    const g = m.growth;
    const V = this.vals;
    fillGroups(V, f, g);
    const budget = tier === 'reduced' ? Infinity : TIER_BUDGET[tier].transforms;
    let transforms = 0, deferred = 0;
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const keys = GROUP_KEYS[gi], vals = V[gi];
      // an invisible mark only writes its opacity (talking moves the mouth every frame: no hidden tongue work)
      const from = OPACITY_ONLY[gi] && vals[keys.length - 1] < 0.01 ? keys.length - 1 : 0;
      let dirty = false;
      for (let i = from; i < keys.length && !dirty; i++) dirty = this.dirty(keys[i], from ? 0 : vals[i]);
      if (!dirty) continue;
      if (transforms >= budget) { deferred++; continue; }
      for (let i = from; i < keys.length; i++) this.set(keys[i], from ? 0 : vals[i]);
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
