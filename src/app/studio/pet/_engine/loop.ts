/**
 * The pet engine (brief §2, §3.1): one frame loop owns every reactive spring, follower, particle, the ball and the
 * cookie. It composes the layers (L0 state, L1 mood, L2 expression, L3 procedural face and physics, L4 one-shots,
 * L5 followers) into one RigFrame per tick and writes it into MotionValues, so React never re-renders per frame.
 * The tick runs inside framer's own frame batch, so those MotionValues render in the same frame as the particles,
 * ball and cookie the tick writes straight to the DOM. It sleeps when everything is at rest (one timer wakes it for
 * the next blink, glance or fidget) and stops while the page is hidden or Telegram is deactivated; on the way back
 * every timeline moves by the time away.
 */

import { cancelFrame, frame, type MotionStyle } from 'framer-motion';
import { BOND_MILESTONE, type Mood } from '@/lib/pet/types';
import { characterModel, GROUND, modelEye, stageGrowth, type CharacterModel } from '@/lib/studio/character';
import { TONGUE_R } from '@/lib/studio/character/petFace';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { LISTEN, TALK } from '../../_components/character/poses';
import { onsetDetector } from '../../_components/character/rig';
import { haptic } from '../../_lib/haptics';
import { pageActive, subscribeActivity } from '../../_components/motion/activity';
import type { EngineCue, EngineDom, GestureEvent, PetEngine, PetEngineOptions, PointerSample, SceneAnchors, TalkState, ToyEvent } from '../_ui/contract';
import { CROSSFADE, prepareBeats, type PreparedBeat } from './beats';
import { BLINK_MEDIAN, Blinker } from './blink';
import { idleParams, type IdleParams } from './breath';
import { CLOSED_EYES, eyeOpenness, gapeMouth, lidEye, mixMouth, petEye, petMouth, structural, tongueOf, type Bulge } from './face';
import { follow, makeFollower, resetFollower } from './follower';
import { Gaze } from './gaze';
import { createGestureClassifier } from './gestures';
import { BODY, Secondary, bankAtRest, compose, makeBank, stepBank, RigWriter, type Bank, type Geom, type RigFrame, type WriteStats } from './layers';
import { AudioLipSync, TextLipSync } from './lipsync';
import { Particles, park, place } from './particles';
import { Ball, Fling, Hop, velocityStretch, type Bounds } from './physics';
import { Player, type Playing } from './player';
import { REACTIONS } from './reactions';
import { chance, range, seeded, sign, variantHistory } from './rng';
import { anchorModel, bodyHull, defaultScene, gazeTo, toModel, toStage, zoneAt, type Placement } from './scene';
import { tuningFor, volumeSx, type Tuning } from './species';
import { atRest, jump, makeSpring, presetKC, retarget, step } from './spring';
import {
  EVENT_PRIORITY, LOOP, MULTIPLY, NEUTRAL_POSE, PHYSICS, PRIORITY_ORDER, TIER_BUDGET,
  type Channel, type LookTarget, type MouthKey, type Oscillation, type PetExpr, type Point, type PoseTargets, type ReactionCtx,
  type ReactionEvent, type Rng, type Spring, type SpringPreset, type Tier, type VariantHistory,
} from './types';

/** A hop never takes off sooner than this after a landing: the squash reads before the next stretch. */
const HOP_SQUASH_MS = 90;

/* ---------- options beyond the contract (tests, frame sheets) ---------- */

export interface EngineExtras {
  /** the idle scheduler (blinks, drift, fidgets, ambient beats, doze); off for frame sheets */
  ambient?: boolean;
  /** wake timers (default setTimeout); tests pass fakes */
  timers?: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
  /** follow pageActive() (default true; off in node scripts) */
  activity?: boolean;
  /** play reactions without the ±12 % / ±15 % jitter (frame sheets of the bare timeline) */
  exact?: boolean;
}

/** Read-only internals for tests and scripts/pet-frames.ts. */
export interface EngineDebug {
  /** drive one frame at clock time t (what the rAF callback does) */
  tick(t: number): void;
  readonly frame: RigFrame | null;
  readonly pose: PoseTargets;
  readonly stats: WriteStats;
  /** true while a frame is requested */
  readonly awake: boolean;
  readonly rafCalls: number;
  readonly model: CharacterModel;
  readonly tuning: Tuning;
  readonly playing: ReadonlyArray<Pick<Playing, 'kind' | 'cls' | 'start'>>;
  particles(): Array<{ kind: string; x: number; y: number; s: number; o: number }>;
  ball(): { x: number; y: number; r: number; active: boolean };
  /** the cookie as last written (stage px; o 0 when parked) */
  cookie(): { x: number; y: number; s: number; o: number };
  /** the spring preset most recently retargeted (frame-sheet overlay) */
  readonly lastSpring: string;
}

type DebugEngine = PetEngine & { readonly debug: EngineDebug };

export function createPetEngine(o: PetEngineOptions & EngineExtras): DebugEngine {
  return new Engine(o);
}

/* ---------- small helpers ---------- */

const EYE_KEYS = ['w', 't', 'b', 'dx', 'dy', 'v', 'sw'] as const;
const MOUTH_KEYS = ['w', 'lift', 'u', 'l', 'dx'] as const;
type ShapeSprings<K extends string> = Record<K, Spring>;
const shapeSprings = <K extends string>(keys: readonly K[], v: Record<K, number>, p: SpringPreset): ShapeSprings<K> =>
  Object.fromEntries(keys.map((k) => [k, makeSpring(v[k] ?? 0, p)])) as ShapeSprings<K>;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Gaze range → view units: the eyes move inside the face, the head moves the face layer and leans the body. */
const GAZE_UNITS = { eyeX: 2.4, eyeY: 1.8, headX: 2.2, headY: 1.4, lean: 2.5, lidDown: 0.18 } as const;

interface ActiveOsc extends Oscillation { start: number }
/** Swallow bulge: the bump's peak size (of the half-width) and spread (view-box units). */
const GULP = { a: 0.12, s: 12 } as const;
/** Chewing cheeks at puff 1: the outline bulge at the cheek line, its spread, and how much the blush swells. */
const PUFF = { a: 0.11, s: 11, blush: 0.4 } as const;
/** The tapped cookie's flight (ms) and where it hangs before the bite (u from the mouth, at a 200 px character). */
const FEED_FLY = { arc: 420, hover: 280, pop: 90, hoverAt: { x: -34, y: 30 }, stretch: 0.12 } as const;
/** Dizzy swirls turn this fast (°/s). */
const SWIRL_SPIN = 420;
interface Job { at: number; fn: () => void }

class Engine implements PetEngine {
  /* config */
  private look: CharacterLook;
  private stage: Stage;
  private size: number;
  private k: number;
  private tier: Tier;
  private mood: Mood;
  private tuning: Tuning;
  private idle: IdleParams;
  private rng: Rng;
  private history: VariantHistory;
  private onCue?: (c: EngineCue) => void;
  private extras: EngineExtras;
  private clock: NonNullable<PetEngineOptions['clock']>;

  /* geometry */
  private model: CharacterModel;
  private hull: Point[];
  private geom: Geom;
  private growthFrom = 1;
  private scene: SceneAnchors;

  /* layers */
  private writer: RigWriter;
  private base: Bank = makeBank(NEUTRAL_POSE, 'float');
  private shot: Bank = makeBank(NEUTRAL_POSE, 'pop');
  private eyes: [ShapeSprings<(typeof EYE_KEYS)[number]>, ShapeSprings<(typeof EYE_KEYS)[number]>];
  private mouth: ShapeSprings<(typeof MOUTH_KEYS)[number]>;
  private breath = { amp: makeSpring(1, 'float'), bx: makeSpring(1, 'float'), by: makeSpring(1, 'float'), sway: makeSpring(0, 'float') };
  private impact = makeSpring(1, 'eye');
  private swell = makeSpring(0, 'snap');
  private gaze: Gaze;
  private blink: Blinker;
  private secondary: Secondary;
  private player: Player;
  private particles: Particles;
  private oscs: ActiveOsc[] = [];
  private gulps: Array<{ start: number; ms: number }> = [];
  private hop = new Hop();
  private hopLand = 0.12;
  /** a hop asked for while still airborne: it takes off from the landing squash instead (never a mid-air jump) */
  private hopNext: { h: number; land: number } | null = null;
  private landedAt = -Infinity;
  private fling = new Fling();
  private dragF = { x: makeFollower(0, PHYSICS.drag), y: makeFollower(0, PHYSICS.drag) };
  /** reduced motion: a released drag eases home on the crossfade spring instead of flying */
  private settle: { x: Spring; y: Spring } | null = null;
  private drag: { from: Point; start: Point; target: Point; vx: number; vy: number; lastWhee: number } | null = null;
  private home: { x: number; y: number } | null = null;
  private freezeFrom = -Infinity;
  private freezeUntil = -Infinity;
  private pose: PoseTargets = { ...NEUTRAL_POSE };
  private sec = { earL: 0, earR: 0, tail: 0, hairY: 0, hairSy: 1, accY: 0, cheek: 1, shadow: 1, puff: 0 };

  /* faces and gaze overrides */
  private exprOv: { expr: PetExpr; id: number } | null = null;
  private mouthOv: { key: MouthKey; id: number } | null = null;
  private lookOv: { target: LookTarget; id: number; side: number } | null = null;
  private suppressBy: number | null = null;
  private lastExpr: PetExpr = 'idle';
  private shownStructural = 'idle';
  private eyeKey = '';
  private mouthKeyNow = '';
  private finger: Point | null = null;
  private drift = { x: 0, y: 0 };
  private glanceSide = 1;
  private lookAwayUntil = -Infinity;

  /* state */
  private talkState: TalkState = 'idle';
  private asleep = false;
  private dozing = false;
  private sleeping = false; // the yawn → drift sequence is under way
  private listenSide: -1 | 1 = 1;
  private signatures = 0;
  private thinkSince = 0;
  private thinkCycle = 0;
  private wakeTapAt = -Infinity;
  private lip: TextLipSync | AudioLipSync | null = null;
  private lipOut = { open: 0, width: 0 };
  private onset = onsetDetector(TALK);
  /** the cookie as last written (frame sheets draw it) */
  private cookieDrawn = { x: 0, y: 0, s: 1, o: 0 };
  private cookie: { el: HTMLElement | null; state: 'idle' | 'held' | 'flying' | 'back'; pos: Point; from: Point; t0: number; reach: boolean } = { el: null, state: 'idle', pos: { x: 0, y: 0 }, from: { x: 0, y: 0 }, t0: 0, reach: false };
  private bop: { ball: Ball; el: HTMLElement | null; on: boolean; t0: number; bops: number; misses: number; respawnAt: number; jumpAt: number; follow: Spring } = { ball: new Ball(), el: null, on: false, t0: 0, bops: 0, misses: 0, respawnAt: Infinity, jumpAt: -Infinity, follow: makeSpring(0, 'float') };

  /* loop */
  private classifier = createGestureClassifier();
  private ptr: number | null = null;
  private touchAt: Point | null = null;
  private lastInput = 0;
  private jobs = new Map<string, Job>();
  private running = false;
  private rafId: number | null = null;
  private timer: unknown = null;
  private lastT = 0;
  /** when the loop was paused (hidden, deactivated): start() moves every timeline by the time away */
  private pausedAt: number | null = null;
  private unsubActivity: (() => void) | null = null;
  private stats: WriteStats = { morphs: 0, transforms: 0, deferred: 0 };
  private rafCalls = 0;
  private lastSpring = 'pop';
  private detachDom: (() => void) | null = null;

  readonly rig;
  readonly body: MotionStyle;
  readonly dim;
  readonly glow;

  constructor(o: PetEngineOptions & EngineExtras) {
    this.look = o.look;
    this.stage = o.stage;
    this.size = o.size;
    this.k = o.size / 200;
    this.tier = o.tier;
    this.mood = o.mood;
    this.onCue = o.onCue;
    this.extras = { ambient: true, activity: true, ...o };
    this.rng = seeded(o.seed ?? 1);
    this.history = variantHistory(this.rng);
    const perf = typeof performance !== 'undefined' ? performance : { now: () => Date.now() };
    // framer's frame loop, not a raw rAF: a MotionValue set from a raw rAF callback renders in framer's next batch,
    // one frame behind what the tick writes straight to the DOM; from its update step it renders in this one
    const framed = new Map<number, (d: { timestamp: number }) => void>();
    let ids = 0;
    this.clock = o.clock ?? {
      now: () => perf.now(),
      raf: (cb) => {
        const id = ++ids;
        const run = ({ timestamp }: { timestamp: number }) => { framed.delete(id); cb(timestamp); };
        framed.set(id, run);
        frame.update(run);
        return id;
      },
      caf: (id) => { const run = framed.get(id); if (run) { framed.delete(id); cancelFrame(run); } },
    };
    this.tuning = tuningFor(o.look.species, o.look.family);
    this.model = this.build(o.look, o.stage);
    this.hull = bodyHull(this.model);
    this.geom = { model: this.model, fromBodyD: this.model.bodyD, lensed: o.look.accessory === 'glasses' || o.look.accessory === 'specs' };
    this.scene = defaultScene(o.size);
    this.writer = new RigWriter(this.geom);
    this.rig = this.writer.rig;
    this.body = this.writer.body;
    this.dim = this.writer.dim;
    this.glow = this.writer.glow;
    this.gaze = new Gaze(this.rng);
    this.blink = new Blinker(this.rng);
    this.secondary = new Secondary(this.tuning);
    this.particles = new Particles(this.rng, TIER_BUDGET.full.particles);
    this.player = new Player({
      set: (c, v, kc) => { retarget(this.shot[c], v, kc); },
      release: (c, kc) => {
        const s = this.shot[c];
        // a full spin releases from the same angle (360 ≡ 0), never back the way it came
        if (c === 'rot' && Math.abs(s.x) >= 180) { const w = 360 * Math.round(s.x / 360); s.x -= w; s.t -= w; this.secondary.unwind(w); }
        retarget(s, NEUTRAL_POSE[c], kc);
      },
      effects: (b, p, now) => this.effects(b, p, now),
      ended: (p) => this.ended(p),
    });
    const t0 = this.clock.now();
    this.idle = idleParams({ ...o.mood, asleep: o.mood.asleep }, o.stage, this.tuning);
    this.eyes = [0, 1].map(() => shapeSprings(EYE_KEYS, this.eyeTarget('idle'), 'snap')) as Engine['eyes'];
    this.mouth = shapeSprings(MOUTH_KEYS, { dx: 0, ...petMouth('X', o.stage) }, 'snap');
    this.lastInput = t0;
    if (o.mood.asleep) this.enterAsleep(t0, true);
    this.applyMood(t0, true);
    this.secondary.reset(this.pose);
    this.tick(t0, true);
  }

  /* ================= public API ================= */

  setLook(look: CharacterLook, stage: Stage): void {
    const now = this.clock.now();
    const prevGrowth = this.model.growth, prevBody = this.model.bodyD;
    const speciesChanged = look.species !== this.look.species || look.family !== this.look.family;
    this.look = look;
    this.stage = stage;
    this.model = this.build(look, stage);
    this.hull = bodyHull(this.model);
    // a stage change keeps the old silhouette and size until stageUp tweens them (or snaps on the next settle)
    this.geom = { model: this.model, fromBodyD: prevBody, lensed: look.accessory === 'glasses' || look.accessory === 'specs' };
    this.growthFrom = prevGrowth / this.model.growth;
    jump(this.base.morph, 0);
    if (prevBody === this.model.bodyD) { this.geom.fromBodyD = this.model.bodyD; this.growthFrom = 1; }
    else this.schedule('morph', 0, () => retarget(this.base.morph, 1, presetKC('float')));
    if (speciesChanged) { this.tuning = tuningFor(look.species, look.family); this.secondary = new Secondary(this.tuning); this.secondary.reset(this.pose); }
    this.writer.invalidate(this.geom);
    this.applyMood(now);
    this.wake();
  }

  setSize(px: number): void { this.size = px; this.k = px / 200; this.wake(); }

  setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.applyMood(this.clock.now());
    this.wake();
  }

  setMood(mood: Mood): void {
    const now = this.clock.now();
    const was = this.mood;
    this.mood = mood;
    // the server's sleep state wins when the engine is not mid-sequence
    if (mood.asleep && !was.asleep && !this.asleep && !this.sleeping) this.enterAsleep(now, false);
    else if (!mood.asleep && was.asleep && this.asleep) this.wakeUp(now, 'sleep', undefined, false);
    this.applyMood(now);
    this.wake();
  }

  setScene(scene: SceneAnchors): void { this.scene = scene; this.wake(); }

  /** Bond unlocks one signature fidget per milestone (§1.2); the long-fidget tier plays them. */
  setBond(bond: number): void { this.signatures = clamp(Math.floor(bond / BOND_MILESTONE), 0, 6); }

  pointer(p: PointerSample): boolean {
    const now = this.clock.now();
    if (p.kind === 'down') { this.lastInput = now; this.resetIdleJobs(now); }
    const hitAt = (at: Point) => {
      const local = toModel(at, this.scene, this.placement(), this.model.pivots.body[0]);
      // asleep, a tap anywhere is a poke (two wake it: §1.3); dozing, a near miss still counts
      if (this.asleep) return zoneAt(this.model, this.hull, local, 14) ?? { zone: 'belly' as const, side: 0 as const, local };
      if (this.dozing) return zoneAt(this.model, this.hull, local, 14);
      return zoneAt(this.model, this.hull, local);
    };
    const events = this.classifier.feed(p, hitAt);
    let took = false;
    for (const e of events) took = this.gesture(e, now) || took;
    if (p.kind === 'down' && took) {
      this.ptr = p.id;
      // a long-press needs a wake at 420 ms even if everything else is at rest
      this.schedule('longPress', 425, () => this.handleGestures(this.classifier.tick(this.clock.now()), this.clock.now()));
    }
    const mine = this.ptr === p.id;
    if ((p.kind === 'up' || p.kind === 'cancel') && mine) { this.ptr = null; this.cancel('longPress'); this.player.end('longPress'); }
    this.wake();
    return took || mine;
  }

  accel(a: { x: number; y: number; z: number }): void {
    const now = this.clock.now();
    this.handleGestures(this.classifier.accel(a, now), now);
  }

  toy(e: ToyEvent): void {
    const now = this.clock.now();
    this.lastInput = now;
    this.resetIdleJobs(now);
    switch (e.type) {
      case 'cookieLift': return this.cookieLift(e.at, now);
      case 'cookieMove': return this.cookieMove(e.at);
      case 'cookieDrop': return this.cookieDrop(e.at, now);
      case 'cookieTap': return this.cookieTap(now);
      case 'ballTap': return this.ballTap(e.at, now, e.tired);
      case 'moonTap': return this.moonTap(now);
    }
  }

  talk(state: TalkState, source: 'text' | 'mic' = 'text'): void {
    const now = this.clock.now();
    const prev = this.talkState;
    if (state === prev) return;
    this.lastInput = now;
    this.resetIdleJobs(now);
    if ((this.asleep || this.dozing) && state !== 'idle') this.wakeUp(now, this.asleep ? 'sleep' : 'doze');
    this.talkState = state;
    if (state === 'listening') { this.listenSide = sign(this.rng); this.fire({ type: 'listen', source }); }
    if (state === 'thinking') {
      this.fire({ type: 'ack' });
      this.thinkSince = now; this.thinkCycle = 0;
      this.scheduleThink(now);
    } else { this.cancel('think'); this.cancel('glance'); }
    this.blink.median = state === 'idle' ? this.idle.blinkMedian : BLINK_MEDIAN[state];
    this.blink.schedule(now);
    if (chance(this.rng, 0.4)) this.blink.force(now);
    this.applyState(now);
    this.wake();
  }

  micLevel(level: number): void {
    retarget(this.swell, clamp(level, 0, 1));
    this.wake();
  }

  speakText(text: string, cps = 28): void {
    const now = this.clock.now();
    this.lip = new TextLipSync(text, cps, now);
    this.startSpeaking(now, 'text');
  }

  speakAudio(analyser: AnalyserNode): void {
    const now = this.clock.now();
    this.lip = new AudioLipSync(analyser);
    this.startSpeaking(now, 'audio');
  }

  stopSpeaking(): void {
    if (this.lip instanceof AudioLipSync) this.lip.stop();
    else if (this.lip) this.lip = null;
    this.wake();
  }

  fire(e: ReactionEvent): void {
    const now = this.clock.now();
    switch (e.type) {
      case 'stageUp': this.stageUp(e.from, e.to); break;
      case 'yawn': if (!this.asleep) this.play(e, now); return this.wake();
      case 'sleep': this.goToSleep(now, false); return this.wake();
      case 'wake': this.wakeUp(now, e.from, e.grumpy); return this.wake();
      case 'doze': this.startDoze(now); return this.wake();
      default: break;
    }
    this.play(e, now);
    this.wake();
  }

  attach(dom: EngineDom): () => void {
    this.particles.attach(dom.particles);
    this.bop.el = dom.ball;
    this.cookie.el = dom.cookie;
    for (const el of [dom.ball, dom.cookie]) if (el) park(el);
    this.detachDom = () => { this.particles.attach([]); this.bop.el = null; this.cookie.el = null; };
    return this.detachDom;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.extras.activity !== false && typeof document !== 'undefined' && !this.unsubActivity) {
      this.unsubActivity = subscribeActivity(() => { if (pageActive()) { this.resume(this.clock.now()); this.wake(); } else this.pause(); });
    }
    this.resume(this.clock.now());
    this.lastT = this.clock.now();
    this.blink.schedule(this.lastT);
    this.resetIdleJobs(this.lastT);
    this.wake();
  }

  /**
   * Stop with the page (hidden, deactivated). A reply's lip-sync is kept, not dropped: the audio pauses with its
   * AudioContext and picks up again with it, and the mouth with it (dispose ends it for good).
   */
  stop(): void {
    this.running = false;
    this.pause();
    this.unsubActivity?.();
    this.unsubActivity = null;
  }

  dispose(): void {
    this.stop();
    this.lip = null;
    this.detachDom?.();
    this.jobs.clear();
    this.player.clear();
  }

  get debug(): EngineDebug {
    // getters read the live engine through an arrow (no aliasing of `this`)
    const me = () => this;
    return {
      tick: (t) => me().tick(t),
      get frame() { return me().writer.frame; },
      get pose() { return me().pose; },
      get stats() { return me().stats; },
      get awake() { return me().rafId !== null; },
      get rafCalls() { return me().rafCalls; },
      get model() { return me().model; },
      get tuning() { return me().tuning; },
      get playing() { return me().player.playing.map((p) => ({ kind: p.kind, cls: p.cls, start: p.start })); },
      particles: () => me().particles.snapshot(),
      cookie: () => ({ ...me().cookieDrawn }),
      ball: () => ({ x: me().bop.ball.x, y: me().bop.ball.y, r: me().bop.ball.r, active: me().bop.ball.active }),
      get lastSpring() { return me().lastSpring; },
    };
  }

  /* ================= the frame ================= */

  private tick(now: number, first = false): void {
    this.rafId = null;
    const dt = first ? 0 : clamp(now - this.lastT, 0, LOOP.maxDtMs);
    this.lastT = now;
    this.runJobs(now);
    if (this.ptr !== null) this.handleGestures(this.classifier.tick(now), now);
    this.player.update(now);
    const frozen = now >= this.freezeFrom && now < this.freezeUntil;
    stepBank(this.base, dt, frozen ? BODY : undefined);
    stepBank(this.shot, dt, frozen ? BODY : undefined);
    for (const s of Object.values(this.breath)) step(s, dt);
    step(this.swell, dt);
    if (!frozen) step(this.impact, dt);
    this.stepFace(now, dt);
    this.updateGaze(now, dt);

    // L3: procedural body (hops, the drag, the fling, the ball, lip-sync, oscillations)
    if (!frozen) this.stepBody(now, dt);
    this.stepLip(now, dt);
    this.stepCookie(now);
    this.stepBop(now, dt);
    this.particles.update(dt, this.k, this.tier);

    const proc = this.procedural(now);
    this.pose = compose(this.base, this.shot, proc);
    this.sec = this.secondary.update(this.pose, dt, this.tier);
    const frame = this.frame(now);
    this.stats = this.writer.write(frame, this.geom, this.k, this.tier);
    this.emitExpr();
    this.finishMorph();

    if (first) return;
    if (this.busy(now)) this.request();
    else this.sleep(now);
  }

  /** Is anything still moving (or due within a frame)? */
  private busy(now: number): boolean {
    if (!this.running) return false;
    if (this.player.playing.length || this.oscs.length || this.gulps.length || this.lip || this.drag || this.settle || this.hop.active || this.fling.active || this.home) return true;
    if (this.bop.on || this.cookie.state !== 'idle' || this.particles.live > 0 || now < this.freezeUntil) return true;
    if (this.talkState === 'thinking' || this.blink.busy(now) || this.blink.nextWake() <= now + 16) return true;
    if (!this.gaze.atRest() || !atRest(this.impact) || !atRest(this.swell) || !Object.values(this.breath).every((s) => atRest(s))) return true;
    for (const e of this.eyes) for (const k of EYE_KEYS) if (!atRest(e[k], 1e-3)) return true;
    for (const k of MOUTH_KEYS) if (!atRest(this.mouth[k], 1e-3)) return true;
    // bankAtRest settles each spring onto its target, so a sleeping frame never drifts by ε
    const banks = bankAtRest(this.base) && bankAtRest(this.shot);
    return !banks || !this.secondary.atRest();
  }

  private request(): void {
    if (this.rafId !== null || !this.running) return;
    if (this.timer !== null) { this.timers().clear(this.timer); this.timer = null; }
    this.rafCalls++;
    this.rafId = this.clock.raf((t) => this.tick(t));
  }

  /** Wake for input: the first frame after a sleep measures dt from now, not from the last frame. */
  private wake(): void {
    if (!this.running || this.rafId !== null) return;
    if (this.extras.activity !== false && !pageActive()) return;
    this.lastT = this.clock.now();
    this.request();
  }

  private pause(): void {
    this.pausedAt ??= this.clock.now();
    if (this.rafId !== null) this.clock.caf(this.rafId);
    this.rafId = null;
    if (this.timer !== null) this.timers().clear(this.timer);
    this.timer = null;
  }

  /**
   * Back from a pause: every timeline and scheduled job moves by the time away, so the beats, bursts, haptics,
   * words and chained phases that came due while hidden play on from where they were, never all in one frame.
   */
  private resume(now: number): void {
    if (this.pausedAt === null) return;
    const gap = Math.max(0, now - this.pausedAt);
    this.pausedAt = null;
    if (!gap) return;
    this.player.shift(gap);
    for (const j of this.jobs.values()) j.at += gap;
    for (const q of this.oscs) q.start += gap;
    this.freezeFrom += gap; this.freezeUntil += gap; this.landedAt += gap; this.lookAwayUntil += gap; this.thinkSince += gap;
    this.cookie.t0 += gap;
    this.bop.t0 += gap; this.bop.respawnAt += gap; this.bop.jumpAt += gap;
  }

  /** Asleep at rest: one timer for the next blink, glance, fidget or scheduled beat. */
  private sleep(now: number): void {
    let next = Math.min(this.blink.nextWake(), this.player.nextDue());
    for (const j of this.jobs.values()) next = Math.min(next, j.at);
    if (this.timer !== null) { this.timers().clear(this.timer); this.timer = null; }
    if (next === Infinity || !this.running) return;
    this.timer = this.timers().set(() => { this.timer = null; this.wake(); }, Math.max(0, next - now));
  }

  private timers() {
    return this.extras.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  }

  /* ================= layers ================= */

  private build(look: CharacterLook, stage: Stage): CharacterModel {
    return characterModel(look, { uid: 'pet', mode: 'live', stage, expr: 'idle', size: Math.max(120, this.size) });
  }

  private placement(): Placement {
    const f = this.writer.frame;
    return { x: f?.body.x ?? 0, y: f?.body.y ?? 0, sx: f?.body.sx ?? 1, sy: f?.body.sy ?? 1, growth: this.model.growth };
  }

  /** L0 + L1 + L2: the base targets for the current state and mood. */
  private applyState(now: number, instant = false): void {
    const p = this.idle;
    const listening = this.talkState === 'listening', thinking = this.talkState === 'thinking';
    const closed = this.asleep || this.dozing;
    const t: Partial<PoseTargets> = {
      sx: 1, sy: 1, x: 0, y: 0, lean: this.tuning.leanBias, headX: 0, headY: 0, headTilt: 0,
      lidL: p.lid, lidR: p.lid, pupil: p.pupil, browL: 0, browR: 0, browInner: p.browInner,
      earL: 0, earR: 0, earDroop: 0, blush: 0, dim: 0, fx: 1, shadow: 1, mouthOpen: 0,
    };
    if (listening) {
      Object.assign(t, { sx: LISTEN.sx, sy: LISTEN.sy, headY: LISTEN.faceLift, pupil: 1.08, browL: 1.5, browR: 1.5, lidL: 1, lidR: 1, earL: 6, earR: -6, headTilt: this.listenSide * this.tuning.listenTilt });
      const pill = this.scene.pill, c = this.scene.character;
      if (this.tier !== 'reduced') t.lean = (t.lean ?? 0) + clamp(((pill.x - (c.x + c.size / 2)) / c.size) * 6, -3, 3);
    }
    if (thinking) Object.assign(t, { browR: 2, browL: -0.5, lidL: Math.max(p.lid, 0.9), lidR: Math.max(p.lid, 0.9) });
    if (this.talkState === 'speaking') Object.assign(t, { lidL: Math.max(p.lid, 0.95), lidR: Math.max(p.lid, 0.95) });
    if (closed) Object.assign(t, { lidL: 1, lidR: 1, pupil: 1, browInner: 0, y: 1.5, headY: 1, sy: 0.985, earDroop: 10, dim: this.asleep ? 0.55 : 0 });
    if (this.mood.level === 'droopy' && !closed) t.earDroop = 8;
    if (this.mood.tone === 'tired' && this.look.species === 'bunny' && !closed) t.earDroop = 20;
    // the cookie is up: sparkly, dilated, wide-open eyes locked on it (wanting)
    t.sparkle = 0;
    if (this.cookie.state === 'held' || this.cookie.state === 'flying') Object.assign(t, { pupil: 1.16, lidL: 1, lidR: 1, sparkle: 1 });
    if (this.drag) t.shadow = 0.8;
    const perk: ReadonlySet<Channel> = new Set<Channel>(listening ? ['sx', 'sy', 'pupil', 'browL', 'browR', 'earL', 'earR'] : []);
    for (const c of Object.keys(t) as Channel[]) {
      const s = this.base[c];
      if (instant) { jump(s, t[c]!); continue; }
      const pre: SpringPreset = c === 'dim' || (closed && (c === 'lidL' || c === 'lidR' || c === 'y' || c === 'headY')) ? 'sleepy' : perk.has(c) ? 'snap' : 'float';
      retarget(s, t[c]!, presetKC(pre, 1 / this.idle.tempo));
    }
    // sway halves while talking, eased like everything else in the mood
    const sway = this.tier === 'reduced' ? 0 : this.idle.sway * (this.talkState === 'idle' ? 1 : 0.5);
    if (instant) jump(this.breath.sway, sway); else retarget(this.breath.sway, sway, presetKC('float'));
    this.secondary.setSleepy(closed || this.mood.level === 'droopy');
    if (closed) this.blink.suppress(true, now);
    else if (this.suppressBy === null) this.blink.suppress(false, now);
  }

  /** The mood's breath, sway, lids and blinks, eased over ~600 ms (never snaps). */
  private applyMood(now: number, instant = false): void {
    this.idle = idleParams({ ...this.mood, asleep: this.asleep }, this.stage, this.tuning);
    const amp = this.tier === 'reduced' ? 0 : this.talkState === 'speaking' || this.drag ? 0.3 : 1;
    const set = (s: Spring, v: number) => (instant ? jump(s, v) : retarget(s, v, presetKC('float')));
    set(this.breath.amp, amp);
    set(this.breath.bx, this.idle.bx);
    set(this.breath.by, this.idle.by);
    this.blink.median = this.talkState === 'idle' ? this.idle.blinkMedian : BLINK_MEDIAN[this.talkState];
    this.blink.slowShare = this.idle.slowBlinks;
    this.blink.doubleShare = this.stage >= 4 ? 0.12 : 0.1;
    this.blink.base = { close: this.tuning.blink.close, hold: 30, open: this.tuning.blink.open };
    this.applyState(now, instant);
    this.resetIdleJobs(now);
  }

  private eyeTarget(expr: PetExpr) {
    const pe = petEye(expr, this.stage), e = modelEye(this.model, pe);
    return { w: e.w, t: e.t, b: e.b, dx: e.dx ?? 0, dy: e.dy ?? 0, v: pe.v ?? 0, sw: pe.sw ?? 0 };
  }

  /** The current face: the reaction's override, else the state's. */
  private currentExpr(): PetExpr {
    if (this.exprOv) return this.exprOv.expr;
    if (this.asleep || this.dozing) return 'sleeping';
    switch (this.talkState) {
      case 'listening': return 'listening';
      case 'thinking': return 'thinking';
      case 'speaking': return 'speaking';
      default: return 'idle';
    }
  }
  private currentMouth(): MouthKey {
    if (this.mouthOv) return this.mouthOv.key;
    if (this.asleep || this.dozing) return 'sleep';
    if (this.talkState === 'listening') return 'o';
    if (this.talkState === 'thinking') return 'smirk';
    if (this.cookie.state === 'held' && this.cookie.reach) return 'smile';
    return 'X';
  }

  private stepFace(now: number, dt: number): void {
    const expr = this.currentExpr();
    // suppression first: a reaction that holds the eyes open (the cookie notice) never gets a face-change blink
    this.blink.suppress(CLOSED_EYES.has(expr) || this.suppressBy !== null || this.asleep || this.dozing, now);
    const key = `${expr}|${this.stage}`;
    if (key !== this.eyeKey) {
      this.eyeKey = key;
      const t = this.eyeTarget(expr);
      // falling asleep closes slowly; everything else morphs on the snap spring (~200 ms)
      const kc = presetKC(expr === 'sleeping' ? 'sleepy' : 'snap');
      for (const e of this.eyes) for (const k of EYE_KEYS) retarget(e[k], t[k], kc);
      if (this.tier === 'reduced') for (const e of this.eyes) for (const k of EYE_KEYS) jump(e[k], t[k]);
      // happy arcs, sleep and squeezed eyes never blink; a face change blinks 40 % of the time
      if (expr !== this.lastExpr && !CLOSED_EYES.has(expr) && chance(this.rng, 0.4)) this.blink.force(now);
      this.lastExpr = expr;
    }
    const mk = `${this.currentMouth()}|${this.stage}`;
    if (mk !== this.mouthKeyNow) {
      this.mouthKeyNow = mk;
      const m = petMouth(this.currentMouth(), this.stage);
      for (const k of MOUTH_KEYS) retarget(this.mouth[k], m[k] ?? 0, presetKC('snap'));
      if (this.tier === 'reduced') for (const k of MOUTH_KEYS) jump(this.mouth[k], m[k] ?? 0);
    }
    for (const e of this.eyes) for (const k of EYE_KEYS) step(e[k], dt);
    for (const k of MOUTH_KEYS) step(this.mouth[k], dt);
    this.blink.suppress(CLOSED_EYES.has(expr) || this.suppressBy !== null || this.asleep || this.dozing, now);
  }

  /** Where the eyes want to be, by priority: a reaction's look, the drag, the state, the finger, the drift. */
  private updateGaze(now: number, dt: number): void {
    let target: LookTarget | null = null, pursuit = false;
    if (this.lookOv) target = this.lookOv.target;
    else if (this.asleep || this.dozing) target = { x: 0, y: 0.3 } as Point;
    else if (now < this.lookAwayUntil) target = 'away';
    else if (this.drag) { target = 'finger'; pursuit = true; }
    else if (this.cookie.state === 'held' || this.cookie.state === 'flying') { target = 'cookie'; pursuit = true; }
    else if (this.bop.on && this.bop.ball.active) { target = 'ball'; pursuit = true; }
    else if (this.talkState === 'listening') target = 'pill';
    else if (this.talkState === 'thinking') target = 'upSide';
    else if (this.finger) { target = 'finger'; pursuit = true; }
    const g = target === null ? this.drift : this.resolveLook(target);
    if (target === 'finger' || target === 'cookie' || target === 'ball') pursuit = true;
    const jumpBy = this.gaze.look(g.x, g.y, now, pursuit);
    if (jumpBy > 0.6 && !pursuit && chance(this.rng, 0.25)) this.blink.force(now);
    this.gaze.update(now, dt);
  }

  private resolveLook(t: LookTarget): { x: number; y: number } {
    const eyes = toStage(anchorModel('eyeL', this.model, null), this.scene, this.placement());
    const eyes2 = toStage(anchorModel('eyeR', this.model, null), this.scene, this.placement());
    const mid = { x: (eyes.x + eyes2.x) / 2, y: (eyes.y + eyes2.y) / 2 };
    const at = (p: Point) => gazeTo(p, mid, this.size);
    switch (t) {
      case 'user': return { x: 0, y: 0 };
      case 'pill': { const g = at(this.scene.pill); return { x: g.x * 0.3, y: g.y * 0.3 }; }
      case 'cookie': return at(this.cookie.state === 'idle' ? this.scene.toys.cookie : this.cookie.pos);
      case 'ball': return this.bop.ball.active ? at(this.ballStage()) : at(this.scene.toys.ball);
      case 'moon': return at(this.scene.toys.moon);
      case 'finger': return this.drag ? { x: clamp(this.drag.vx / 1600, -0.8, 0.8), y: clamp(this.drag.vy / 1600, -0.8, 0.8) } : this.finger ? at(this.finger) : { x: 0, y: 0 };
      case 'upSide': return { x: 0.55 * this.glanceSide, y: -0.6 };
      case 'away': return { x: 0.8 * (this.lookOv?.side ?? this.glanceSide), y: 0.25 };
      default: return at(t);
    }
  }

  /** L3 procedural contributions (offsets and factors) for this frame. */
  private procedural(now: number): Partial<PoseTargets> {
    const p: Partial<PoseTargets> = {};
    const add = (c: Channel, v: number) => { p[c] = (p[c] ?? 0) + v; };
    const mul = (c: Channel, v: number) => { p[c] = (p[c] ?? 1) * v; };
    const al = this.tuning.alpha;
    const vs = TIER_BUDGET[this.tier].velocityStretch;

    // hops, the flight home, the drag and the fling
    let x = 0, y = 0, rot = 0, stretch = 1, vy = 0;
    if (this.hop.active || this.hop.y !== 0) { y += this.hop.y; vy = this.hop.vy; }
    if (this.drag) {
      x += this.dragF.x.y; y += this.dragF.y.y;
      if (vs) { const v = Math.hypot(this.dragF.x.yd, this.dragF.y.yd), e = v > 1 ? (this.dragF.y.yd ** 2 - this.dragF.x.yd ** 2) / (v * v) : 0; stretch *= 1 + (velocityStretch(v) - 1) * e; }
    } else if (this.settle) {
      x += this.settle.x.x; y += this.settle.y.x;
    } else if (this.fling.active || this.home || this.fling.x !== 0 || this.fling.y !== 0) {
      x += this.fling.x + (this.home ? this.hop.x : 0); y += this.fling.y; rot += this.fling.rot; vy = this.fling.vy;
    }
    // in flight the body stretches along its velocity (a sideways throw goes long and flat, a lob tall and thin)
    if (vs && !this.drag && this.fling.active) {
      const fx = this.fling.vx, fy = this.fling.vy, v = Math.hypot(fx, fy), e = v > 1 ? (fy * fy - fx * fx) / (v * v) : 0;
      stretch *= 1 + (velocityStretch(v * 0.5) - 1) * e;
    } else if (vs && vy !== 0 && !this.drag) stretch *= velocityStretch(vy * 0.5);
    // speaking: each syllable lifts the body a little and stretches it from the ground (TALK, existing rig numbers)
    const o = this.lipOut.open;
    if (o > 0.001) { y -= TALK.lift * o; stretch *= 1 + TALK.stretch * o; mul('sx', 1 - TALK.narrow * o); }
    // the impact squash after a landing, volume preserved
    stretch *= this.impact.x;
    if (stretch !== 1) { mul('sy', stretch); mul('sx', volumeSx(stretch, al)); }
    // the mic swells the listening body a little (uniform)
    if (this.swell.x > 0.001 && this.talkState === 'listening') { const s = 1 + this.swell.x * LISTEN.levelSwell; mul('sx', s); mul('sy', s); }
    // thinking sways slowly (±2°, 2.4 s)
    if (this.talkState === 'thinking' && this.tier !== 'reduced') rot += 2 * Math.sin(((now - this.thinkSince) / 2400) * Math.PI * 2);
    // the held "aaah": a tiny tremble of the wide-open mouth and body while the cookie is right there
    if (this.cookie.reach && this.tier !== 'reduced') {
      const g = clamp((this.base.gape.x - 1.3) / 0.6, 0, 1), ts = now / 1000;
      if (g > 0) { add('gape', 0.1 * g * Math.sin(2 * Math.PI * 11 * ts)); mul('sx', 1 + 0.012 * g * Math.sin(2 * Math.PI * 13 * ts)); add('headY', 0.35 * g * Math.sin(2 * Math.PI * 9 * ts)); }
    }
    // the Bop shuffle under the ball
    if (this.bop.on && this.tier !== 'reduced') x += this.bop.follow.x;
    if (x) add('x', x);
    if (y) add('y', y);
    if (rot) add('rot', rot);

    // the head follows the gaze (eyes lead, then counter-move: the VOR); reduced motion keeps the eyes only
    if (this.tier !== 'reduced') {
      add('headX', this.gaze.hx.x * GAZE_UNITS.headX);
      add('headY', this.gaze.hy.x * GAZE_UNITS.headY);
      add('lean', this.gaze.hx.x * GAZE_UNITS.lean);
    }

    // oscillations (purr, giggle fits, shakes, belly pats, ear waves)
    this.oscs = this.oscs.filter((q) => now - q.start < q.ms);
    for (const q of this.oscs) {
      const t = now - q.start, u = t / q.ms;
      const env = Math.min(1, t / 40) * (q.decay === false ? Math.min(1, (q.ms - t) / 80) : 1 - u);
      const v = q.amp * env * Math.sin(2 * Math.PI * q.hz * (t / 1000));
      if (MULTIPLY.has(q.channel)) mul(q.channel, 1 + v); else add(q.channel, v);
    }
    return p;
  }

  private stepBody(now: number, dt: number): void {
    const landV = this.hop.step(dt);
    if (landV > 0) this.landed(landV * 0.6, now, this.hopLand, !this.home);
    if (this.home && !this.hop.active) { this.home = null; this.fling.x = 0; this.hop.x = 0; }
    if (this.drag) {
      follow(this.dragF.x, this.drag.target.x, dt);
      follow(this.dragF.y, this.drag.target.y, dt);
    }
    if (this.settle) {
      step(this.settle.x, dt); step(this.settle.y, dt);
      if (atRest(this.settle.x, 0.05) && atRest(this.settle.y, 0.05)) this.settle = null;
    }
    if (this.fling.active) {
      for (const c of this.fling.step(dt, this.bounds())) {
        if (c.type === 'wall') this.play({ type: 'wallHit', nx: c.nx, v: c.v }, now);
        else this.play({ type: 'land', v: c.v }, now);
      }
      if (!this.fling.active) {
        // on the ground away from home: hop back once the landing has played
        this.player.end('fling');
        const dx = -this.fling.x;
        if (Math.abs(dx) > 2) this.schedule('home', 520, () => { this.home = { x: this.fling.x, y: 0 }; this.hop.x = 0; this.launchHop(Math.min(26, 10 + Math.abs(dx) * 0.08), 0.1, dx); this.wake(); });
        else this.fling.x = 0;
      }
    }
  }

  /** A landing: squash by speed, a short hit-stop on full tier, jelly back (ears and sprout flap on their own). */
  private landed(v: number, now: number, land: number, small: boolean): void {
    // reduced motion never hops, so nothing lands (an impact squash would be a bounce)
    if (this.tier === 'reduced') return;
    const sy = 1 - clamp(land * (0.6 + v / 1500), 0.04, 0.3) * this.tuning.land;
    // a takeoff stretch still held by the reaction lets go on contact, or it would cancel the squash out
    if (this.shot.sy.t > 1) { retarget(this.shot.sy, 1, presetKC('snap')); retarget(this.shot.sx, 1, presetKC('snap')); }
    // squash within two frames, hold through the hit-stop, rebound past round (the vinyl's stretch), then jelly
    // (half of it lands on the contact frame: the eye spring is the stiffest the 1/120 s substep keeps stable)
    this.impact.x = Math.min(this.impact.x, 1 - (1 - sy) * 0.5);
    retarget(this.impact, sy, presetKC('eye'));
    if (TIER_BUDGET[this.tier].hitStop && !small) { this.freezeFrom = now + 40; this.freezeUntil = now + 70; }
    this.landedAt = now;
    if (this.hopNext) this.relaunch(HOP_SQUASH_MS);
    this.schedule('impact', 70, () => {
      retarget(this.impact, 1 + (1 - sy) * 0.4, presetKC('snap', 0.6));
      this.schedule('impact', 80, () => retarget(this.impact, 1, presetKC('jelly', 0.8, this.tuning.jelly)));
    });
  }

  /** The queued hop takes off once the landing squash has bottomed out. */
  private relaunch(ms: number): void {
    this.schedule('hopNext', ms, () => {
      const n = this.hopNext;
      this.hopNext = null;
      if (n && !this.drag && !this.fling.active) this.launchHop(n.h, n.land);
    });
  }

  /** Leave the ground: a landing squash or an anticipation crouch turns into the takeoff stretch on this frame. */
  private launchHop(h: number, land: number, dx = 0): void {
    // reduced motion: no hops anywhere (reaction hops are already crossfades; this catches the loop's own)
    if (this.tier === 'reduced') { this.hopNext = null; return; }
    const since = this.clock.now() - this.landedAt;
    if (!dx && (this.hop.active || since < HOP_SQUASH_MS)) {
      this.hopNext = { h, land };
      if (!this.hop.active) this.relaunch(HOP_SQUASH_MS - since);
      return;
    }
    this.hopNext = null;
    this.hopLand = land;
    this.hop.g = PHYSICS.gravity * this.tuning.gravity;
    this.cancel('impact');
    retarget(this.impact, 1, presetKC('eye'));
    if (this.shot.sy.x < 1 && this.shot.sy.t >= 1) {
      const kc = presetKC('eye');
      retarget(this.shot.sy, this.shot.sy.t, kc);
      retarget(this.shot.sx, this.shot.sx.t, kc);
    }
    this.hop.launch(h, dx);
  }

  private stepLip(now: number, dt: number): void {
    if (!this.lip) { this.lipOut.open += (0 - this.lipOut.open) * (1 - Math.exp(-dt / 25)); if (this.lipOut.open < 1e-3) this.lipOut.open = 0; return; }
    const s = this.lip.sample(now, dt);
    this.lipOut = { open: this.tier === 'reduced' ? Math.round(s.open * 3) / 3 : s.open, width: s.width };
    // syllable onsets bounce the body (≥ 150 ms apart); some sentence starts look away
    if (this.onset(s.open, now) && this.tier !== 'reduced') this.play({ type: 'onset' }, now);
    if (s.sentence && chance(this.rng, 0.25)) { this.glanceSide = sign(this.rng); this.lookAwayUntil = now + range(this.rng, 400, 700); }
    if (s.done) {
      this.lip = null;
      this.lipOut = { open: 0, width: 0 };
      this.play({ type: 'speakEnd' }, now);
      this.cue({ type: 'spoken' });
      if (this.talkState === 'speaking') { this.talkState = 'idle'; this.applyState(now); this.applyMood(now); }
    }
  }

  /* ================= frame assembly ================= */

  /**
   * The body turns about its ground point (a toy rocking on its base), but a big turn (a spin, a tumble) or one in
   * the air turns about its middle: the pivot slides up with the angle, so a 360 is a spin, never a cartwheel
   * through the floor. Rocking under ~12° on the ground is untouched.
   */
  private spinAbout(p: PoseTargets, grow: number): { x: number; y: number } {
    const rot = p.rot + p.lean;
    const a = ((((rot + 180) % 360) + 360) % 360) - 180;
    const w = Math.max(clamp((Math.abs(a) - 12) / 40, 0, 1), clamp(-p.y / 12, 0, 1));
    if (w === 0 || rot === 0) return { x: p.x, y: p.y };
    const h = (GROUND - this.model.pivots.face[1]) * p.sy * grow * w, th = (rot * Math.PI) / 180;
    return { x: p.x - h * Math.sin(th), y: p.y - h * (1 - Math.cos(th)) };
  }

  /** The contact shadow hides through the middle of a spin (it lives inside the body group and would turn with it). */
  private spinShade(p: PoseTargets): number {
    const rot = p.rot + p.lean, a = Math.abs(((((rot + 180) % 360) + 360) % 360) - 180);
    return 1 - 0.85 * clamp((a - 20) / 40, 0, 1);
  }

  private frame(now: number): RigFrame {
    const p = this.pose, m = this.model, s = this.sec;
    const lid = this.blink.lid(now, this.talkState !== 'speaking' || this.lipOut.open < 0.15);
    const down = Math.max(0, this.gaze.y) * GAZE_UNITS.lidDown;
    const ex = this.gaze.ex.x + p.gazeX, ey = this.gaze.ey.x + p.gazeY;
    const eye = (i: 0 | 1) => {
      const sp = this.eyes[i];
      const base = { w: sp.w.x, t: sp.t.x, b: sp.b.x, dx: sp.dx.x + ex * GAZE_UNITS.eyeX, dy: sp.dy.x + ey * GAZE_UNITS.eyeY, v: sp.v.x, sw: sp.sw.x };
      return lidEye(base, (i ? p.lidR : p.lidL) * (1 - down), clamp(p.pupil, 0.6, 1.3));
    };
    const eL = eye(0), eR = eye(1);
    const oL = eyeOpenness(eL), oR = eyeOpenness(eR);
    const mouthBase = { w: this.mouth.w.x, lift: this.mouth.lift.x, u: this.mouth.u.x, l: this.mouth.l.x, dx: this.mouth.dx.x };
    const mouth = gapeMouth(mixMouth(mouthBase, clamp(p.mouthOpen + this.lipOut.open, 0, 1), p.mouthWidth + this.lipOut.width, this.stage), clamp(p.gape, 0, 2.3), this.stage);
    const mo = m.face.mouth, tg = m.face.mouthKind === 'lens' && this.stage >= 2 ? tongueOf(mouth, mo.x, mo.y) : null;
    const puff = Math.max(0, s.puff);
    // the cheeks puff out on the outline; a swallow's bump travels from the cheeks down to the base
    const bulges: Bulge[] = [];
    if (puff > 1e-3 && this.tier !== 'reduced') bulges.push({ y: m.face.cheeks.y + 2, a: PUFF.a * puff, s: PUFF.s });
    this.gulps = this.gulps.filter((g) => now - g.start < g.ms);
    for (const g of this.gulps) {
      const u = (now - g.start) / g.ms;
      bulges.push({ y: m.face.cheeks.y + 4 + (GROUND - 10 - m.face.cheeks.y - 4) * u * u * (3 - 2 * u), a: GULP.a * Math.sin(Math.PI * u), s: GULP.s });
    }
    const amp = this.breath.amp.x;
    const idle = this.idle;
    // the stage-up: the body grows from the old stage's size while its path tweens
    const grow = 1 + (this.growthFrom - 1) * (1 - clamp(p.morph, 0, 1));
    const f: RigFrame = {
      body: { ...this.spinAbout(p, grow), sx: p.sx * grow, sy: p.sy * grow, rot: p.rot + p.lean },
      breath: {
        bx: 1 + (this.breath.bx.x - 1) * amp, by: 1 + (this.breath.by.x - 1) * amp,
        period: idle.period, sway: this.breath.sway.x, swayPeriod: idle.swayPeriod,
      },
      face: { x: p.headX, y: p.headY, rot: clamp(p.headTilt, -this.tuning.tiltMax * 1.5, this.tuning.tiltMax * 1.5) },
      accRigid: this.geom.lensed ? { x: p.headX, y: p.headY, rot: p.headTilt } : { x: 0, y: 0, rot: p.headTilt * 0.5 },
      accSoft: { y: s.accY },
      hair: { y: s.hairY, sy: s.hairSy },
      fx: { y: this.talkState === 'thinking' ? Math.sin(now / 520) * 1.2 : 0, o: clamp(p.fx, 0, 1) },
      shadow: { y: 0, rot: 0, s: s.shadow, o: clamp(0.55 + 0.45 * s.shadow, 0, 1) * this.spinShade(p) },
      earL: s.earL, earR: s.earR, tail: s.tail,
      lids: lid,
      blush: { o: clamp(p.blush, 0, 1), s: p.blushScale * (1 + PUFF.blush * puff) },
      cheeks: s.cheek * (1 + PUFF.blush * puff),
      eyeL: eL, eyeR: eR,
      eyeStroke: [1 - oL, 1 - oR],
      glint: 0.72 * Math.min(oL, oR),
      mouth,
      brows: { l: p.browL, r: p.browR, inner: p.browInner, arch: this.asleep || this.dozing ? 0.3 : 1 },
      morph: clamp(p.morph, 0, 1),
      bulges,
      tongue: tg ? { x: tg.x - mo.x, y: tg.y - mo.y, sx: tg.rx / TONGUE_R, sy: tg.ry / TONGUE_R, o: tg.o } : { x: 0, y: 0, sx: 1, sy: 1, o: 0 },
      sparkle: { x: eL.dx ?? 0, y: eL.dy ?? 0, o: clamp(p.sparkle, 0, 1) * Math.min(oL, oR) },
      swirl: { x: eL.dx ?? 0, y: eL.dy ?? 0, rot: ((now / 1000) * SWIRL_SPIN) % 360, o: clamp(Math.min(eL.sw ?? 0, eR.sw ?? 0), 0, 1) },
      dim: clamp(p.dim, 0, 0.55),
      glow: clamp(p.glow, 0, 1),
    };
    if (m.face.mouthKind === 'beak' && this.stage <= 1) f.mouth = mouthBase;
    return f;
  }

  /** The structural Expression CharacterView should draw changed: one cue (never per frame). */
  private emitExpr(): void {
    const s = structural(this.currentExpr());
    if (s === this.shownStructural) return;
    this.shownStructural = s;
    this.cue({ type: 'expr', expr: s });
  }

  /** The stage-up tween reached the new body: it becomes the only body. */
  private finishMorph(): void {
    if (this.geom.fromBodyD === this.model.bodyD && this.growthFrom === 1) return;
    const m = this.base.morph;
    if (m.t === 1 && atRest(m, 2e-3)) { this.geom.fromBodyD = this.model.bodyD; this.growthFrom = 1; jump(m, 0); }
  }

  /* ================= reactions ================= */

  private ctx(): ReactionCtx {
    return { rng: this.rng, species: this.look.species ?? 'cloud', family: this.look.family ?? 'puff', stage: this.stage, mood: this.mood, tier: this.tier, variantHistory: this.history };
  }

  private play(e: ReactionEvent, now: number, onEnd?: () => void, onCancel?: () => void): Playing | null {
    const beats = (REACTIONS[e.type] as (e: ReactionEvent, c: ReactionCtx) => ReturnType<typeof REACTIONS.hello>)(e, this.ctx());
    const prepared = prepareBeats(beats, { rng: this.rng, tuning: this.tuning, tier: this.tier, tempo: this.idle.tempo, exact: this.extras.exact });
    const p = this.player.play(e.type, EVENT_PRIORITY[e.type], prepared, now, onEnd, onCancel);
    if (p) this.lastSpring = prepared[0]?.spring ?? 'pop';
    this.wake();
    return p;
  }

  private effects(b: PreparedBeat, p: Playing, now: number): void {
    this.lastSpring = b.spring;
    if (b.haptic) haptic[b.haptic]?.();
    if (b.particles) for (const q of Array.isArray(b.particles) ? b.particles : [b.particles]) {
      this.particles.burst(q.kind, q.n, toStage(anchorModel(q.at, this.model, this.touchAt), this.scene, this.placement()), this.k, this.tier);
    }
    if (b.expr) this.exprOv = { expr: b.expr, id: p.id };
    if (b.mouth) this.mouthOv = { key: b.mouth, id: p.id };
    if (b.say) this.cue({ type: 'say', line: b.say });
    if (b.thought) this.cue({ type: 'thought', need: b.thought });
    if (b.look) this.lookOv = { target: b.look, id: p.id, side: sign(this.rng) };
    if (b.hop) this.launchHop(b.hop.h, b.hop.land ?? 0.12);
    if (b.osc) for (const q of Array.isArray(b.osc) ? b.osc : [b.osc]) this.oscs.push({ ...q, start: now });
    // hit-stop: once the impact pose has (nearly) arrived, hold the body there (the impact read)
    if (b.gulp) this.gulps.push({ start: now, ms: b.gulp });
    if (b.hitStop) { this.freezeFrom = now + b.settleMs * 0.45; this.freezeUntil = this.freezeFrom + b.hitStop; }
    if (b.blink === 'suppress') this.suppressBy = p.id;
    else if (b.blink === 'allow') { if (this.suppressBy === p.id) this.suppressBy = null; }
    else if (b.blink) { this.blink.suppress(false, now); this.blink.force(now, b.blink); }
  }

  private ended(p: Playing): void {
    if (this.exprOv?.id === p.id) this.exprOv = null;
    if (this.mouthOv?.id === p.id) this.mouthOv = null;
    if (this.lookOv?.id === p.id) this.lookOv = null;
    if (this.suppressBy === p.id) this.suppressBy = null;
  }

  private cue(c: EngineCue): void { this.onCue?.(c); }

  /* ================= gestures ================= */

  private handleGestures(events: GestureEvent[], now: number): void { for (const e of events) this.gesture(e, now); this.wake(); }

  private gesture(e: GestureEvent, now: number): boolean {
    switch (e.type) {
      case 'contact': {
        this.touchAt = toModel(e.at, this.scene, this.placement(), this.model.pivots.body[0]);
        this.finger = null;
        this.blink.hold(now, 120);
        if (this.asleep) return true;
        if (this.dozing) { this.wakeUp(now, 'doze'); return true; }
        // the first deformation lands in this same handler: squash toward the ground, leaning off the finger
        const sideK = e.hit.side;
        const squash = e.hit.zone === 'head' ? 0.88 : e.hit.zone === 'eye' ? 0.92 : 0.87;
        this.player.play('poke', 'touch', prepareBeats([
          { at: 0, target: { sy: squash, x: -sideK * 1.2 }, spring: 'eye' },
          { at: 140, target: {}, spring: 'jelly', release: 'jelly' },
        ], { rng: this.rng, tuning: this.tuning, tier: this.tier, exact: true }), now);
        if (this.mood.level === 'droopy') this.play({ type: 'droopy' }, now);
        this.kick(now);
        return true;
      }
      case 'poke': {
        if (this.asleep) { this.sleepTap(now); return true; }
        this.play({ type: 'poke', zone: e.hit.zone, side: e.hit.side, at: e.hit.local, hits: e.hits, coolOff: e.coolOff }, now);
        return true;
      }
      case 'stroke':
        if (this.asleep) return true;
        this.play({ type: 'pet', speed: e.speed, dir: e.dir, passes: e.passes }, now);
        this.cue({ type: 'care', action: 'pet', n: 1 });
        return true;
      case 'tickle':
        if (this.asleep) return true;
        this.play({ type: 'tickle' }, now);
        this.cue({ type: 'care', action: 'tickle', n: 1 });
        return true;
      case 'overpoke':
        if (this.asleep) return true;
        this.play({ type: 'overpoke', hits: e.hits, level: e.level }, now);
        return true;
      case 'longPress':
        if (this.asleep) return true;
        this.play({ type: 'longPress', at: e.hit.local }, now);
        this.player.extend('longPress', now + 60000);
        return true;
      case 'dragStart': {
        if (this.asleep) return true;
        const o = this.placement();
        this.settle = null;
        this.drag = { from: e.at, start: { x: o.x, y: o.y }, target: { x: o.x, y: o.y }, vx: 0, vy: 0, lastWhee: now };
        resetFollower(this.dragF.x, o.x); resetFollower(this.dragF.y, o.y);
        this.fling.active = false; this.home = null; this.hop.active = false; this.hop.y = 0; this.hopNext = null;
        this.play({ type: 'dragStart', at: e.at }, now);
        this.player.extend('dragStart', now + 60000);
        this.applyMood(now);
        return true;
      }
      case 'dragMove': {
        const d = this.drag;
        if (!d) return false;
        const b = this.bounds();
        d.target = { x: clamp(d.start.x + (e.at.x - d.from.x) / this.k, b.minX, b.maxX), y: clamp(d.start.y + (e.at.y - d.from.y) / this.k, b.minY, 0) };
        d.vx = e.vx / this.k; d.vy = e.vy / this.k;
        if (Math.hypot(d.vx, d.vy) > 1400 && now - d.lastWhee > 700) { d.lastWhee = now; this.play({ type: 'drag', vx: d.vx, vy: d.vy }, now); }
        return true;
      }
      case 'release': {
        const d = this.drag;
        if (!d) return false;
        this.drag = null;
        this.player.end('dragStart');
        const x = this.dragF.x.y, y = this.dragF.y.y;
        const vx = clamp(e.vx / this.k, -4000, 4000), vy = clamp(e.vy / this.k, -4000, 4000);
        if (this.tier === 'reduced') {
          // reduced motion: no flight, spin or bounce; the body eases home from where it was let go
          this.settle = { x: makeSpring(x, 'snap'), y: makeSpring(y, 'snap') };
          retarget(this.settle.x, 0, CROSSFADE); retarget(this.settle.y, 0, CROSSFADE);
          this.applyMood(now);
          return true;
        }
        this.fling.g = PHYSICS.gravity * this.tuning.gravity;
        if (e.fling) this.fling.launch(x, y, vx, vy);
        else this.fling.launch(x, y, vx * 0.25, Math.max(0, vy * 0.3));
        this.play({ type: 'fling', vx, vy, thrown: e.fling }, now);
        this.player.extend('fling', now + 60000);
        this.applyMood(now);
        return true;
      }
      case 'track': this.finger = e.at; return false;
      case 'trackEnd': this.finger = null; return false;
      case 'shake':
        if (this.asleep) return false;
        this.play({ type: 'shake' }, now);
        return false;
    }
  }

  /** Step a few ms right now and write: the contact squash shows on the pointerdown frame itself. */
  private kick(now: number): void {
    const dt = 8;
    stepBank(this.shot, dt);
    this.pose = compose(this.base, this.shot, this.procedural(now));
    this.stats = this.writer.write(this.frame(now), this.geom, this.k, this.tier);
  }

  private bounds(): Bounds {
    const s = this.scene, c = s.character, k = this.k;
    // body offset limits (px at 200) that keep the character inside the viewport
    return {
      minX: -c.x / k - 25, maxX: (s.viewport.w - c.x) / k - 175,
      minY: -c.y / k - 30, floor: 0,
    };
  }

  /* ================= toys ================= */

  private mouthStage(): Point { return toStage(anchorModel('mouth', this.model, null), this.scene, this.placement()); }

  private writeCookie(p: Point, s: number, o: number): void {
    this.cookieDrawn = { x: p.x, y: p.y, s, o };
    const el = this.cookie.el;
    if (!el) return;
    if (o <= 0) { park(el); return; }
    place(el, `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`, o.toFixed(2));
  }

  private cookieLift(at: Point, now: number): void {
    if (this.asleep || this.dozing) this.wakeUp(now, this.asleep ? 'sleep' : 'doze');
    this.cookie = { ...this.cookie, state: 'held', pos: at, reach: false };
    this.play({ type: 'feed', phase: 'notice' }, now);
    this.applyState(now);
    this.wake();
  }

  private cookieMove(at: Point): void {
    if (this.cookie.state !== 'held') return;
    this.cookie.pos = at;
    this.wake();
  }

  private cookieDrop(at: Point, now: number): void {
    if (this.cookie.state !== 'held') return;
    this.cookie.pos = at;
    const d = Math.hypot(at.x - this.mouthStage().x, at.y - this.mouthStage().y) / this.k;
    if (d < 46) { this.eat(now); return; }
    // missed the mouth: it springs back to its slot
    this.cookie = { ...this.cookie, state: 'back', from: at, t0: now, reach: false };
    retarget(this.base.mouthOpen, 0, presetKC('snap'));
    retarget(this.base.gape, 0, presetKC('snap'));
    retarget(this.base.headY, 0, presetKC('snap'));
    this.applyState(now);
  }

  private cookieTap(now: number): void {
    if (this.asleep || this.dozing) this.wakeUp(now, this.asleep ? 'sleep' : 'doze');
    if (this.cookie.state !== 'idle' || this.player.top() === 'eat') return;
    this.cookie = { ...this.cookie, state: 'flying', from: this.scene.toys.cookie, pos: this.scene.toys.cookie, t0: now, reach: false };
    this.play({ type: 'feed', phase: 'notice' }, now);
    this.applyState(now);
    this.wake();
  }

  /**
   * The cookie in flight or held. Tapped, it arcs up to just under the chin (FEED_FLY.arc), hangs there while the
   * mouth holds its wide "aaah" (FEED_FLY.hover), then pops in (FEED_FLY.pop). In reach (120 u) the mouth gapes
   * with the distance: closed → 'aah' → widest by 45 u; the body stretches toward it (sy up to 1.12, volume kept)
   * and leans after it.
   */
  private stepCookie(now: number): void {
    const c = this.cookie;
    if (c.state === 'idle') return;
    const mouth = this.mouthStage();
    if (c.state === 'flying') {
      const t = now - c.t0, F = FEED_FLY;
      const hover = { x: mouth.x + F.hoverAt.x * this.k, y: mouth.y + F.hoverAt.y * this.k };
      if (t < F.arc) {
        const u = t / F.arc, e = u * u * (3 - 2 * u), apex = 60 * this.k;
        c.pos = { x: c.from.x + (hover.x - c.from.x) * e, y: c.from.y + (hover.y - c.from.y) * e - apex * 4 * u * (1 - u) };
        this.writeCookie(c.pos, 1 - 0.1 * u, 1);
      } else if (t < F.arc + F.hover) {
        // it hangs there, bobbing a little: the held breath before the bite
        const h = (t - F.arc) / 1000;
        c.pos = { x: hover.x, y: hover.y - Math.sin(2 * Math.PI * 3 * h) * 2 * this.k };
        this.writeCookie(c.pos, 0.9, 1);
      } else {
        const u = clamp((t - F.arc - F.hover) / F.pop, 0, 1), e = u * u;
        c.pos = { x: hover.x + (mouth.x - hover.x) * e, y: hover.y + (mouth.y - hover.y) * e };
        this.writeCookie(c.pos, 0.9 - 0.3 * e, 1);
        if (u >= 1) { this.eat(now); return; }
      }
    } else if (c.state === 'back') {
      const u = clamp((now - c.t0) / 320, 0, 1), e = 1 - (1 - u) ** 3;
      const slot = this.scene.toys.cookie;
      c.pos = { x: c.from.x + (slot.x - c.from.x) * e, y: c.from.y + (slot.y - c.from.y) * e };
      this.writeCookie(c.pos, 1, 1 - u * 0.3);
      if (u >= 1) { this.cookie.state = 'idle'; this.writeCookie(c.pos, 1, 0); this.applyState(now); }
      return;
    } else this.writeCookie(c.pos, 1.1, 1);
    const d = Math.hypot(c.pos.x - mouth.x, c.pos.y - mouth.y) / this.k;
    const reach = d < 120;
    // 0 at the edge of reach, 1 from 45 u in: the gape runs closed → 'aah' → widest along it
    const near = reach ? clamp((120 - d) / 75, 0, 1) : 0;
    const open = near * near * (3 - 2 * near);
    if (reach && !c.reach) this.play({ type: 'feed', phase: 'approach', dist: d }, now);
    // the wanting face holds for as long as the cookie stays in reach
    if (reach) this.player.extend('feed', now + 150);
    if (reach !== c.reach) { c.reach = reach; this.mouthKeyNow = ''; }
    // continuous: the mouth follows the distance, the body leans and stretches toward it
    const reduced = this.tier === 'reduced';
    retarget(this.base.gape, 2 * open, presetKC('snap'));
    const sy = 1 + (reduced ? 0.03 : FEED_FLY.stretch) * open;
    retarget(this.base.sy, sy, presetKC('snap'));
    retarget(this.base.sx, volumeSx(sy, this.tuning.alpha), presetKC('snap'));
    if (!reduced) {
      retarget(this.base.lean, this.tuning.leanBias + clamp((c.pos.x - mouth.x) / this.k / 12, -7, 7) * open, presetKC('float'));
      retarget(this.base.headY, -2.5 * open, presetKC('snap'));
    }
  }

  /** Bite → chomp ×3–4 → swallow → satisfied; the care cue goes out when the bite lands. */
  private eat(now: number): void {
    this.cookie = { ...this.cookie, state: 'idle', reach: false };
    this.writeCookie(this.mouthStage(), 0.6, 0);
    // the mouth snaps shut on the cookie and the reach stretch lets go at once (the bite's squash reads in full)
    retarget(this.base.mouthOpen, 0, presetKC('eye'));
    retarget(this.base.gape, 0, presetKC('eye'));
    for (const c of ['sy', 'sx', 'headY'] as const) retarget(this.base[c], NEUTRAL_POSE[c], presetKC('eye'));
    retarget(this.base.lean, this.tuning.leanBias, presetKC('snap'));
    this.applyState(now);
    const chain: Array<ReactionEvent> = [
      { type: 'feed', phase: 'bite' },
      { type: 'feed', phase: 'chomp', chomp: chance(this.rng, 0.5) ? 3 : 4 },
      { type: 'feed', phase: 'swallow' },
      { type: 'feed', phase: 'satisfied' },
    ];
    this.cue({ type: 'care', action: 'feed' });
    this.chain(chain, now);
  }

  /**
   * Play events one after another: each phase starts as the previous one's last beat lands (its channels are
   * handed over mid-flight, so the sequence flows instead of settling between phases). Anything more important
   * cancelling a phase ends the chain there.
   */
  private chain(events: ReactionEvent[], now: number, done?: () => void, aborted?: () => void): void {
    const [head, ...rest] = events;
    this.cancel('chain');
    if (!head) { done?.(); return; }
    let live = true;
    const p = this.play(head, now, undefined, () => { live = false; this.cancel('chain'); aborted?.(); });
    if (!p) { aborted?.(); return; }
    const last = p.beats.reduce((m, b) => Math.max(m, b.at), 0);
    this.schedule('chain', last + 60, () => { if (live) this.chain(rest, this.clock.now(), done, aborted); });
  }

  private ballStage(): Point {
    const c = this.scene.character, b = this.bop.ball;
    return { x: c.x + b.x * this.k, y: c.y + b.y * this.k };
  }

  private ballTap(at: Point | undefined, now: number, tired = false): void {
    if (this.asleep || this.dozing) this.wakeUp(now, this.asleep ? 'sleep' : 'doze');
    const b = this.bop;
    if (b.on) {
      if (b.ball.active) {
        const p = this.ballStage();
        const near = !at || Math.hypot(at.x - p.x, at.y - p.y) < (b.ball.r + 30) * this.k;
        if (near) { b.ball.tap(at ? Math.sign(p.x - at.x) * 0.5 : 0); haptic.select(); }
      }
      return;
    }
    // 'too tired' is the care rule (Energy < TIRED_BELOW), which the page reads from the care; the mood only tunes idle
    this.play({ type: 'playStart', tired }, now);
    if (tired) return;
    this.cue({ type: 'care', action: 'play' });
    Object.assign(b, { on: true, t0: now, bops: 0, misses: 0, respawnAt: now + 380 });
    b.ball.active = false;
    b.ball.g = PHYSICS.gravity;
    this.cue({ type: 'score', bops: 0, misses: 0 });
    this.wake();
  }

  /** Bop: the ball under gravity, the character tracking it, crouching and jumping to head it. */
  private stepBop(now: number, dt: number): void {
    const b = this.bop;
    if (!b.on) return;
    const ball = b.ball, k = this.k, c = this.scene.character;
    if (!ball.active && now >= b.respawnAt) {
      // from top-centre (in the character box's units)
      ball.r = 22;
      ball.spawn(100 + range(this.rng, -20, 20), -c.y / k + 30);
      b.respawnAt = Infinity;
    }
    const done = now - b.t0 > 10000 || b.misses >= 3;
    if (ball.active) {
      const head = this.headCircle();
      const r = ball.step(dt, { minX: -c.x / k, maxX: (this.scene.viewport.w - c.x) / k, minY: -c.y / k, floor: 186 }, head);
      if (r?.type === 'hit') {
        ball.bop(r.nx, r.ny, (range(this.rng, -15, 15) * Math.PI) / 180);
        b.bops++;
        this.play({ type: 'bop', nx: r.nx, ny: r.ny }, now);
        this.cue({ type: 'score', bops: b.bops, misses: b.misses });
      } else if (r?.type === 'floor') {
        b.misses++;
        this.cue({ type: 'score', bops: b.bops, misses: b.misses });
        if (b.misses < 3) this.play({ type: 'miss', misses: b.misses }, now);
        b.respawnAt = now + 700;
      }
      // in reach and coming down: crouch, then jump to meet it
      const hx = head.x, hy = head.y;
      const tReach = ball.vy > 0 ? (hy - 30 - ball.y) / Math.max(1, ball.vy) : Infinity;
      if (Math.abs(ball.x - hx) < 46 && tReach > 0.12 && tReach < 0.34 && !this.hop.active && now - b.jumpAt > 600) {
        b.jumpAt = now;
        this.play({ type: 'ballNear' }, now);
      }
      // shuffle under it (±45 px)
      retarget(b.follow, clamp(ball.x - 100, -45, 45), presetKC('float'));
    } else retarget(b.follow, 0, presetKC('float'));
    step(b.follow, dt);
    if (b.el) {
      const p = this.ballStage();
      if (ball.active) place(b.el, `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(-50%,-50%) rotate(${ball.rot.toFixed(0)}deg)`, '1');
      else park(b.el);
    }
    if (done) {
      b.on = false; ball.active = false;
      if (b.el) park(b.el);
      const won = b.bops >= 5;
      this.play({ type: 'playEnd', bops: b.bops, won, misses: b.misses }, now);
      this.cue({ type: 'playOver', bops: b.bops, won, misses: b.misses });
    }
  }

  /** The head as a circle in the character box's units (the dome, moved with the body). */
  private headCircle(): { x: number; y: number; r: number } {
    const m = this.model, g = m.growth, cx = m.pivots.body[0];
    const dome = { x: m.pivots.face[0], y: m.face.eyes[0].cy - 4 };
    const p = this.pose;
    return { x: cx + (dome.x - cx) * g + p.x, y: 166 + (dome.y - 166) * g * p.sy + p.y, r: 30 * g };
  }

  private moonTap(now: number): void {
    if (this.asleep) { this.sleepTap(now); return; }
    if (this.dozing) { this.wakeUp(now, 'doze'); return; }
    this.goToSleep(now, false);
  }

  /* ================= sleep ================= */

  /** Yawn (0–900) → drift (900–3200) → asleep; the care cue when it has fallen asleep. */
  private goToSleep(now: number, quiet: boolean, until = now + 3000): void {
    if (this.asleep || this.sleeping) return;
    // a more important reaction is playing (the hello, a touch): bedtime starts the moment it ends (within 3 s)
    const top = this.player.top();
    if (top !== null && PRIORITY_ORDER.indexOf(top) < PRIORITY_ORDER.indexOf('needs')) {
      if (now < until) this.schedule('bedtime', 120, () => this.goToSleep(this.clock.now(), quiet, until));
      return;
    }
    this.sleeping = true;
    this.dozing = false;
    this.bop.on = false;
    this.chain([{ type: 'yawn' }, { type: 'sleep' }], now, () => {
      this.sleeping = false;
      this.enterAsleep(this.clock.now(), false);
      if (!quiet) this.cue({ type: 'care', action: 'sleep' });
    }, () => { this.sleeping = false; });
  }

  private enterAsleep(now: number, instant: boolean): void {
    this.asleep = true;
    this.dozing = false;
    this.talkState = 'idle';
    this.applyMood(now, instant);
    this.scheduleSleepLife(now);
    this.wake();
  }

  /** First tap asleep: "five more minutes"; a second within 3 s wakes. */
  private sleepTap(now: number): void {
    if (now - this.wakeTapAt < 3000) { this.wakeTapAt = -Infinity; this.wakeUp(now, 'sleep'); return; }
    this.wakeTapAt = now;
    this.play({ type: 'sleepPoke' }, now);
  }

  /**
   * Awake. Every real wake from sleep (two taps, the talk pill or mic, a reply, the cookie, the ball) tells the
   * server, so its nap ends with the one on screen; `post` is false only when the server said so first.
   */
  private wakeUp(now: number, from: 'sleep' | 'doze', grumpy?: boolean, post = true): void {
    if (!this.asleep && !this.dozing && !this.sleeping) { this.play({ type: 'wake', from, grumpy: !!grumpy }, now); return; }
    const g = grumpy ?? (from === 'sleep' && this.mood.lowest === 'energy' && this.mood.level !== 'content' && this.mood.level !== 'happy');
    if (this.asleep && post) this.cue({ type: 'care', action: 'wake' });
    this.asleep = false; this.dozing = false; this.sleeping = false;
    this.cancel('dream'); this.cancel('z'); this.cancel('bedtime');
    this.player.clear();
    this.applyMood(now);
    this.play({ type: 'wake', from, grumpy: g }, now);
    this.blink.force(now, 'double');
    this.resetIdleJobs(now);
  }

  private startDoze(now: number): void {
    if (this.asleep || this.dozing || this.sleeping) return;
    this.play({ type: 'doze' }, now, () => { this.dozing = true; this.applyState(this.clock.now()); });
  }

  private stageUp(from: Stage, to: Stage): void {
    if (to !== this.stage) this.setLook(this.look, to);
    const fromModel = characterModel(this.look, { uid: 'pet-from', mode: 'live', stage: from, expr: 'idle', size: Math.max(120, this.size) });
    this.geom.fromBodyD = fromModel.bodyD;
    this.growthFrom = stageGrowth(from) / stageGrowth(to);
    jump(this.base.morph, 0);
    this.cancel('morph');
    this.schedule('morph', 200, () => retarget(this.base.morph, 1, presetKC('float', 1.1)));
  }

  private startSpeaking(now: number, mode: 'text' | 'audio'): void {
    if (this.asleep || this.dozing) this.wakeUp(now, this.asleep ? 'sleep' : 'doze');
    this.talkState = 'speaking';
    this.cancel('think'); this.cancel('glance');
    this.onset = onsetDetector(TALK);
    this.play({ type: 'speakStart', mode }, now);
    this.applyMood(now);
    this.wake();
  }

  /* ================= the idle scheduler ================= */

  private schedule(tag: string, ms: number, fn: () => void): void {
    this.jobs.set(tag, { at: this.clock.now() + ms, fn });
    if (this.rafId === null) this.sleep(this.clock.now());
  }
  private cancel(tag: string): void { this.jobs.delete(tag); }
  private runJobs(now: number): void {
    for (const [tag, j] of [...this.jobs]) if (j.at <= now && this.jobs.get(tag) === j) { this.jobs.delete(tag); j.fn(); }
  }

  /** Can an idle one-shot play now (nothing more important is going on)? */
  private canIdle(): boolean {
    const top = this.player.top();
    return this.talkState === 'idle' && !this.asleep && !this.dozing && !this.sleeping && !this.drag && !this.fling.active && !this.home
      && this.cookie.state === 'idle' && !this.bop.on && (top === null || top === 'idle' || top === 'needs');
  }

  /** Any input restarts the watch clock: fidgets after 8 s, long fidgets after 30, a doze at 90. */
  private resetIdleJobs(now: number): void {
    if (this.extras.ambient === false || !this.running) return;
    const at = (tag: string, ms: number, fn: () => void) => this.jobs.set(tag, { at: now + ms, fn });
    at('fidget', 8000 + range(this.rng, 0, 4000), () => this.fidget());
    at('doze', 90000, () => { if (this.canIdle()) this.startDoze(this.clock.now()); });
    at('ambient', range(this.rng, 9000, 16000), () => this.ambientBeat());
    at('drift', range(this.rng, this.idle.drift[0], this.idle.drift[1]), () => this.driftGaze());
    if (this.mood.level === 'wants') at('wants', range(this.rng, 6000, 12000), () => this.wantsBeat()); else this.jobs.delete('wants');
    if (this.mood.tone === 'happy') at('happyHop', range(this.rng, 12000, 20000), () => this.happyHop()); else this.jobs.delete('happyHop');
    if (this.asleep) this.scheduleSleepLife(now);
  }

  private fidget(): void {
    const now = this.clock.now(), watch = now - this.lastInput;
    // past 30 s a long fidget, a third of them an unlocked signature (the Bond reward)
    const signature = watch >= 30000 && this.signatures > 0 && chance(this.rng, 1 / 3);
    if (this.canIdle()) this.play(signature ? { type: 'signature', index: this.signatures > 1 ? this.history.pick('signature', this.signatures) : 0 } : { type: watch < 30000 ? 'fidgetSmall' : 'fidgetLong' }, now);
    this.jobs.set('fidget', { at: now + (watch < 30000 ? range(this.rng, 6000, 12000) : range(this.rng, 20000, 30000)), fn: () => this.fidget() });
  }

  private ambientBeat(): void {
    const now = this.clock.now();
    if (this.canIdle() && now - this.lastInput > 8000 && this.mood.tone !== 'content') {
      this.play(this.mood.tone === 'bored' ? { type: 'bored' } : { type: 'ambient', tone: this.mood.tone }, now);
    }
    this.jobs.set('ambient', { at: now + range(this.rng, 9000, 16000), fn: () => this.ambientBeat() });
  }

  private wantsBeat(): void {
    const now = this.clock.now();
    if (this.canIdle() && this.mood.level === 'wants') this.play({ type: 'wants', need: this.mood.lowest }, now);
    if (this.mood.level === 'wants') this.jobs.set('wants', { at: now + range(this.rng, 18000, 24000), fn: () => this.wantsBeat() });
  }

  private happyHop(): void {
    const now = this.clock.now();
    if (this.canIdle() && this.tier !== 'reduced') { this.launchHop(3, 0.06); this.wake(); }
    if (this.mood.tone === 'happy') this.jobs.set('happyHop', { at: now + range(this.rng, 12000, 20000), fn: () => this.happyHop() });
  }

  /** Gaze drift: a glance somewhere, then (often) back to you. */
  private driftGaze(): void {
    const now = this.clock.now();
    if (this.canIdle() && !this.lookOv && !this.finger) {
      const away = this.drift.x !== 0 || this.drift.y !== 0;
      const wide = this.mood.tone === 'bored' ? 0.85 : this.mood.tone === 'tired' ? 0.35 : 0.6;
      if (away && chance(this.rng, this.idle.homeShare + 0.25)) this.drift = { x: 0, y: 0 };
      else if (this.mood.tone === 'hungry' && chance(this.rng, 1 / 3)) this.drift = this.resolveLook('cookie');
      else this.drift = { x: range(this.rng, -wide, wide), y: this.mood.tone === 'tired' ? range(this.rng, 0.1, 0.4) : range(this.rng, -0.35, 0.3) };
      this.wake();
    }
    const [a, b] = this.drift.x || this.drift.y ? [900, 1800] : this.idle.drift;
    this.jobs.set('drift', { at: now + range(this.rng, a, b), fn: () => this.driftGaze() });
  }

  /** Thinking: "hmm" every 2 s after 4 s, the gaze glancing up one side and the other every 1.4–2.8 s. */
  private scheduleThink(now: number): void {
    this.jobs.set('think', { at: now + 2000, fn: () => {
      if (this.talkState !== 'thinking') return;
      const t = this.clock.now();
      this.thinkCycle++;
      this.play({ type: 'think', cycle: this.thinkCycle }, t);
      this.scheduleThink(t);
    } });
    if (!this.jobs.has('glance')) this.scheduleGlance();
  }
  private scheduleGlance(): void {
    this.jobs.set('glance', { at: this.clock.now() + range(this.rng, 1400, 2800), fn: () => {
      if (this.talkState !== 'thinking') return;
      this.glanceSide = -this.glanceSide;
      this.wake();
      this.scheduleGlance();
    } });
  }

  /** Asleep: a Z at each breath peak, a dream twitch every 20–40 s. */
  private scheduleSleepLife(now: number): void {
    if (this.extras.ambient === false) return;
    const period = this.idle.period * 1000;
    this.jobs.set('z', { at: now + period * this.idle.inhale, fn: () => this.zPeak() });
    this.jobs.set('dream', { at: now + range(this.rng, 20000, 40000), fn: () => this.dreamBeat() });
  }
  private zPeak(): void {
    if (!this.asleep) return;
    const now = this.clock.now();
    const at = toStage({ x: this.model.pivots.fx[0], y: this.model.pivots.fx[1] }, this.scene, this.placement());
    this.particles.burst('z', 1, at, this.k, this.tier);
    this.wake();
    this.jobs.set('z', { at: now + this.idle.period * 1000, fn: () => this.zPeak() });
  }
  private dreamBeat(): void {
    if (!this.asleep) return;
    const now = this.clock.now();
    this.play({ type: 'dream' }, now);
    this.jobs.set('dream', { at: now + range(this.rng, 20000, 40000), fn: () => this.dreamBeat() });
  }
}
