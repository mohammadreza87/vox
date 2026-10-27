/**
 * The motion extras chunk (design §10.4, §10.5, §3.1, §4.11, §8A): rooms (their held pose and face, idle flavour,
 * transitions, arrivals, idle beats and reactions, Starfall's with Zen), the settle rule and its content float,
 * growth moments with their details and the moves they unlock, the Garden's guided breath (a breath cycle you can
 * follow), the hands-free listening hold, sentence-by-sentence speech, and following the OS reduced-motion switch.
 * The engine imports this lazily (its own chunk, preloaded a few seconds after start, §10.7) and calls it through
 * the narrow `Host` below; before it lands the pet is simply at Home with its ordinary idle, and any call that needs
 * it waits for it. State only this chunk uses lives here, per engine (never in PetCare).
 */

import type { Mood } from '@/lib/pet/types';
import { GROUND, type CharacterModel } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import type { TalkState } from '../_ui/contract';
import { REDUCED_MOTION_QUERY } from '../../_components/motion/activity';
import type { IdleParams } from './breath';
import { detailKey, fitDetails, gardenAt, type DetailName, type Details, type ShownDetails } from './details';
import { fitGarden, soilY, type GardenInput, type GardenShown } from './garden';
import { fitWearing, NO_WEARING, WEAR_SLOT, wearKey, type ShownWearing, type Wearing } from './outfits';
import { CLOSE_TAU, TextLipSync, type MouthSample } from './lipsync';
import type { StageMotion } from './motion';
import type { Playing } from './player';
import { attend, breatheCycle, growthLit, roomArrive, roomIdle, roomLeave, roomReaction, RT, sentenceBreath, settleFloat, unlockedMove } from './reactions/rooms';
import {
  MULTIPLY, ROOM_ORDER,
  type Beat, type Channel, type MotionCue, type MotionKind, type MouthKey, type Point, type PoseTargets, type PriorityClass, type ReactionCtx, type Room,
  type RoomReaction, type RoomReactOpts, type Tier,
} from './types';

export { roomIdle, unlockedMove };

/* ---------- data ---------- */

export interface RoomFlavour {
  /** the room's held pose, added to the state's base targets (body px at 200, degrees, eye-range, view-box units) */
  pose: Partial<PoseTargets>;
  /** the resting mouth there (awake, idle, not talking), or none for the mood's own */
  mouth?: MouthKey;
  /** breath period × and depth × */
  breath: number;
  depth: number;
  /** blink gap median × and the slow-blink share floor */
  blink: number;
  slowBlinks: number;
  /** resting lids × (bedroom: heavy) */
  lid: number;
  /** where idle glances lean (eye-range units, over the pose's own gaze), or null for the mood's own drift */
  look: { x: number; y: number } | null;
  /** fidget and ambient intervals × */
  fidget: number;
}

/**
 * Each room's held idle (§10.4), strong enough to read in a still (Wave B): Play crouched and bright-eyed, ready;
 * Garden hovering high, chin up to the sky; Closet in a three-quarter turn to the mirror (to the right), narrower;
 * Bedroom sunk low, heavy-lidded, the head drooping and the lean drifting to one side (it swaps side on each idle
 * beat); Life Book head down over the page, eyes on it. Home is the mood's own idle (its content float is the
 * content mood's beat). Reduced motion keeps only the face channels (gaze, pupils, lids, brows) and the mouth.
 */
export const ROOMS: Readonly<Record<Room, RoomFlavour>> = {
  home: { pose: {}, breath: 1, depth: 1, blink: 1, slowBlinks: 0, lid: 1, look: null, fidget: 1 },
  play: { pose: { sy: 0.95, sx: 1.035, headY: -2, pupil: 1.1, sparkle: 0.45, earL: 7, earR: -7 }, mouth: 'grin', breath: 0.85, depth: 1.15, blink: 1.1, slowBlinks: 0, lid: 1, look: { x: 0.3, y: 0.35 }, fidget: 0.7 },
  garden: { pose: { y: -12, headY: -4, headTilt: 3, gazeY: -0.55, earL: -4, earR: 4 }, mouth: 'o', breath: 1.15, depth: 1, blink: 1, slowBlinks: 0.1, lid: 1, look: { x: 0.15, y: -0.2 }, fidget: 1.1 },
  closet: { pose: { headX: 6, headTilt: 7, lean: 5, gazeX: 0.6, sx: 0.95, sy: 1.035, blush: 0.3 }, mouth: 'smile', breath: 1, depth: 1, blink: 1, slowBlinks: 0, lid: 1, look: { x: 0.25, y: -0.05 }, fidget: 0.9 },
  bedroom: { pose: { y: 2.5, sy: 0.955, sx: 1.03, headY: 4, lean: 6, headTilt: 6, gazeY: 0.3, earDroop: 16 }, breath: 1.4, depth: 1.15, blink: 1.5, slowBlinks: 0.45, lid: 0.5, look: { x: 0, y: 0.15 }, fidget: 1.6 },
  book: { pose: { headY: 5, headTilt: -5, lean: -3, sy: 0.98, sx: 1.012, gazeY: 0.6, gazeX: -0.15, pupil: 1.06 }, mouth: 'smile', breath: 1.05, depth: 1, blink: 1.2, slowBlinks: 0.1, lid: 0.8, look: { x: 0.1, y: 0.2 }, fidget: 1.3 },
};
/** The face channels a room pose keeps on reduced motion (no travel, no turn, no swing). */
const FACE: ReadonlySet<Channel> = new Set<Channel>(['gazeX', 'gazeY', 'pupil', 'lidL', 'lidR', 'browL', 'browR', 'blush', 'sparkle']);
/** The hands-free listening hold (§8A.2): leaning in (a touch bigger, closer), ears up, attentive eyes and brows. */
const HOLD: Partial<PoseTargets> = { sx: 1.02, sy: 1.035, headY: 1, earL: 11, earR: -11, pupil: 1.1, browL: 1.2, browR: 1.2 };

/** Room transition (§10.5): the backdrop swaps at the top of the lean, 150 ms in; the room's hello at 300 ms. */
export const ROOM_SWAP_MS = RT.swapMs;

/** The settle rule (§3.1 T9). */
export const SETTLE = {
  /** continuous play for this long → the content float */
  afterMs: 6 * 60_000,
  /** a gap without input this long ends the stretch (the next input starts a new one) */
  gapMs: 90_000,
  /** in the float: breath period ×, depth ×, sway ×, fidget and ambient intervals × */
  breath: 1.35, depth: 0.85, sway: 0.7, fidget: 2.2,
  /** how long the settle waits for a busy moment to pass before it tries again */
  retryMs: 2000,
} as const;

/** Queued speech (§8A.3): the pause closing each sentence (a share of its time, within these ms). */
export const SPEECH = { pause: 0.18, minPauseMs: 60, maxPauseMs: 180, minCps: 6, maxCps: 40 } as const;

export const MOTION_PRIORITY: Readonly<Record<MotionKind, PriorityClass>> = {
  roomLeave: 'touch', roomArrive: 'touch', growthLit: 'touch', settle: 'needs', roomIdle: 'idle', hopIdle: 'idle', breathe: 'needs', attend: 'talk', breath: 'talk',
  catch: 'play', nearMiss: 'play', roundEnd: 'play', rain: 'touch', admire: 'touch', storyNod: 'talk', pageFlip: 'needs', ownDrawing: 'touch',
  bloom: 'touch', tryOn: 'touch', guessThink: 'talk', guessHeard: 'talk', guessRight: 'talk', guessWrong: 'talk', guessReveal: 'talk',
};

/* ---------- the host: what the engine lends this chunk ---------- */

/** A mouth source the engine samples each frame (text, audio, or a queue of sentences). */
export interface LipSource { sample(now: number, dtMs: number): MouthSample }

export interface Host {
  readonly clock: { now(): number };
  readonly tier: Tier;
  readonly sm: StageMotion;
  readonly motion: { stage: Stage };
  readonly asleep: boolean;
  readonly sleeping: boolean;
  readonly dozing: boolean;
  readonly mood: Mood;
  readonly talkState: TalkState;
  /** where the eyes are steered (a finger off the character, or the page's setGaze point) */
  readonly finger: Point | null;
  readonly model: CharacterModel;
  readonly look: CharacterLook;
  /** where a `touch` burst lands (model units): the last touch, or what a reaction aims at (the Garden's pot) */
  touchAt: Point | null;
  room: Room;
  contentFloat: boolean;
  stretchStart: number | null;
  lastInput: number;
  guidedBreath: number | null;
  osReduced: boolean;
  unsubOS: (() => void) | null;
  guardTier: Tier;
  lip: LipSource | null;
  ctx(): ReactionCtx;
  canIdle(): boolean;
  playBeats(kind: Playing['kind'], cls: PriorityClass, beats: Beat[], now: number): Playing | null;
  schedule(tag: string, ms: number, fn: () => void): void;
  cancel(tag: string): void;
  applyMood(now: number): void;
  applyTier(): void;
  wake(): void;
  wakeUp(now: number, from: 'sleep' | 'doze'): void;
  startSpeaking(now: number, mode: 'text' | 'audio'): void;
  motionCue(c: MotionCue): void;
}

const play = (h: Host, kind: MotionKind, beats: Beat[], now: number) => h.playBeats(kind, MOTION_PRIORITY[kind], beats, now);

/** What only this chunk keeps, per engine. */
interface XState {
  /** everything lit for this person's view (a detail the stage cannot wear yet is kept) */
  details: Details;
  shown: ShownDetails;
  fitStage: number;
  /** the detail fading in after a litPeak, and when it started */
  fade: { key: string; at: number } | null;
  /** the hands-free listening hold, and the side its head tilts to */
  hold: boolean;
  holdSide: -1 | 1;
  /** the side the bedroom's drifting lean is on */
  bedSide: -1 | 1;
  /** what this person dressed the pet in (kept whole: an item the stage cannot show yet waits) and what it shows */
  wearing: Wearing;
  worn: ShownWearing;
  wornStage: number;
  /** the look the outfit was fitted to (null: never dressed) */
  wornLook: CharacterLook | null;
}
const states = new WeakMap<Host, XState>();
function state(h: Host): XState {
  let s = states.get(h);
  if (!s) states.set(h, (s = { details: {}, shown: fitDetails({}, 4), fitStage: 0, fade: null, hold: false, holdSide: 1, bedSide: 1, wearing: {}, worn: NO_WEARING, wornStage: 0, wornLook: null }));
  return s;
}

/* ---------- rooms ---------- */

export function setRoom(h: Host, room: Room, o: { dir?: -1 | 1; instant?: boolean }, input: (now: number) => void): void {
  if (room === h.room) return;
  const now = h.clock.now(), from = h.room;
  h.room = room;
  input(now);
  h.cancel('roomArrive');
  const swap = () => { h.motionCue({ type: 'roomSwap', room }); h.applyMood(h.clock.now()); h.wake(); };
  // reduced motion, asleep or told to cut: the UI crossfades (160 ms); the character only changes its idle flavour
  if (o.instant || h.tier === 'reduced' || h.asleep || h.sleeping) { h.cancel('roomSwap'); swap(); return; }
  const dir = o.dir ?? (ROOM_ORDER.indexOf(room) >= ROOM_ORDER.indexOf(from) ? 1 : -1);
  play(h, 'roomLeave', roomLeave(h.ctx(), dir), now);
  h.schedule('roomSwap', ROOM_SWAP_MS * h.sm.time, swap);
  // the room's hello as the settle lands: what tells you where you are
  h.schedule('roomArrive', RT.totalMs * h.sm.time, () => { if (h.room === room && !h.asleep && h.talkState === 'idle') play(h, 'roomArrive', roomArrive(h.ctx(), room), h.clock.now()); });
  h.wake();
}

export function roomReact(h: Host, kind: RoomReaction, o: RoomReactOpts): void {
  const now = h.clock.now();
  if (h.asleep || h.dozing) h.wakeUp(now, h.asleep ? 'sleep' : 'doze');
  // rain and a bloom aim at the Garden's pot when a seed is planted: the drops (and the sparkle) land on its soil
  const pot = kind === 'rain' || kind === 'bloom' ? potAim(h, kind) : null;
  if (pot) h.touchAt = pot.at;
  const slot = kind === 'tryOn' && o.id && o.id in WEAR_SLOT ? WEAR_SLOT[o.id as keyof typeof WEAR_SLOT] : undefined;
  play(h, kind, roomReaction(h.ctx(), kind, o, { aim: pot?.dx, slot }), now);
  h.wake();
}

/** The body's drift toward the pot while it rains (view units, rooms.ts reads the aim and drifts by this share). */
export const RAIN_DRIFT = 10;
export const driftFor = (dx: number) => Math.min(RAIN_DRIFT, dx * 0.2);

/**
 * How far right of the body the pot stands (view units) and the model point a `touch` burst spawns from: rain from
 * under the body over the pot (the body drifts toward it, so the point is set back by the drift), a bloom's sparkle
 * just over the flower (set back by the room's hover, which lifts every burst with the body). Null: no seed.
 */
export function potAim(h: Pick<Host, 'model' | 'room' | 'tier'>, kind: 'rain' | 'bloom', garden = gardens.get(h as Host)): { dx: number; at: Point } | null {
  if (!garden) return null;
  // the Garden room draws the pot as its hero (bigger, a step in front): aim where it is drawn
  const m = h.model, cx = m.pivots.body[0], g = m.growth, pot = gardenAt(m, h.room === 'garden'), dx = pot.x - cx;
  if (kind === 'rain') return { dx, at: { x: cx + (dx - driftFor(dx)) / g, y: GROUND - 2 } };
  const lift = h.tier === 'reduced' ? 0 : ROOMS[h.room].pose.y ?? 0, top = pot.y - GROUND + (soilY(garden.kind) - (garden.state === 'bloomed' ? 17 : 8)) * pot.k;
  return { dx, at: { x: cx + dx / g, y: GROUND + (top - lift) / g } };
}

/**
 * The room's idle beat (the scheduler plays it in place of most mood beats away from Home, and as the content
 * mood's beat at Home). The bedroom's lean drifts over to the other side with each one. Hands-free, the pet holds
 * still and attentive instead.
 */
export function idleBeat(h: Host, now: number): void {
  const st = state(h);
  if (st.hold || h.guidedBreath !== null) return;
  if (h.room === 'bedroom') { st.bedSide = st.bedSide > 0 ? -1 : 1; h.applyMood(now); }
  play(h, 'roomIdle', roomIdle(h.ctx(), h.room, { target: h.finger !== null }), now);
}

/** Where idle glances lean in this room (null: the mood's own drift); hands-free, back to you. */
export const roomLook = (h: Host) => (state(h).hold ? { x: 0, y: 0.05 } : ROOMS[h.room].look);

const addPose = (t: Partial<PoseTargets>, p: Partial<PoseTargets>, faceOnly: boolean, k: Partial<Record<Channel, number>> = {}) => {
  for (const c of Object.keys(p) as Channel[]) {
    if (faceOnly && !FACE.has(c)) continue;
    const v = p[c]! * (k[c] ?? 1);
    t[c] = MULTIPLY.has(c) ? (t[c] ?? 1) * v : (t[c] ?? 0) + v;
  }
};

/**
 * The held pose over the state's base targets (never asleep): the hands-free listening hold when it is on (awake,
 * not talking), else the room's (not while listening; Garden's guided breath keeps only the hover). Reduced motion:
 * face channels only.
 */
export function pose(h: Host, t: Partial<PoseTargets>, listening: boolean): void {
  const st = state(h), faceOnly = h.tier === 'reduced';
  if (st.hold) {
    if (!listening && h.talkState === 'idle') { addPose(t, HOLD, faceOnly); if (!faceOnly) t.headTilt = (t.headTilt ?? 0) + 6 * st.holdSide; }
    return;
  }
  if (listening) return;
  const rp = ROOMS[h.room].pose;
  if (h.guidedBreath !== null) { if (rp.y && !faceOnly) t.y = (t.y ?? 0) + rp.y; return; }
  addPose(t, rp, faceOnly, h.room === 'bedroom' ? { lean: st.bedSide, headTilt: st.bedSide } : undefined);
}

/** The resting mouth (awake, idle, not talking): hands-free a small attentive smile, else the room's. */
export function mouth(h: Host): MouthKey | undefined {
  if (h.talkState !== 'idle') return undefined;
  if (state(h).hold) return 'smile';
  return h.guidedBreath === null ? ROOMS[h.room].mouth : undefined;
}

/**
 * The idle parameters after the room (§10.4), the settle float (§3.1), the guided breath (Garden's "breathe with
 * me": the breath cycle plays as motion, so the CSS breath only keeps a trace of depth), the hands-free hold (slow,
 * attentive blinks, glances that come back to you, stiller) and the stage (a wisp's slow blinks). Asleep keeps its
 * own breath. Refits the growth details when the stage changed.
 */
export function flavour(h: Host, p: IdleParams): IdleParams {
  const st = state(h);
  if (st.fitStage !== h.motion.stage) refit(h, st);
  // an outfit waits for its part: a stage-up (or a new look) puts on what was kept
  if (st.wornLook && (st.wornStage !== h.motion.stage || st.wornLook !== h.look)) refitWear(h, st, false);
  if (h.asleep) return p;
  const r = ROOMS[h.room], fl = h.contentFloat;
  const depth = r.depth * (fl ? SETTLE.depth : 1);
  const q: IdleParams = {
    ...p,
    period: p.period * r.breath * (fl ? SETTLE.breath : 1),
    bx: 1 + (p.bx - 1) * depth, by: 1 + (p.by - 1) * depth,
    sway: p.sway * (fl ? SETTLE.sway : 1),
    swayPeriod: p.swayPeriod * (fl ? SETTLE.breath : 1),
    lid: p.lid * r.lid,
    blinkMedian: p.blinkMedian * r.blink,
    slowBlinks: Math.max(p.slowBlinks, r.slowBlinks, h.sm.slowBlinks),
  };
  if (st.hold) {
    q.lid = Math.max(p.lid, 0.96); q.blinkMedian = p.blinkMedian * 1.3; q.slowBlinks = Math.max(q.slowBlinks, 0.4);
    q.drift = [6000, 12000]; q.homeShare = 0.85; q.sway = p.sway * 0.5;
  }
  if (h.guidedBreath !== null) {
    // a slow, even breath you can follow (in 40 %, out 60 %); on reduced motion the CSS breath carries it deep
    q.period = h.guidedBreath; q.inhale = 0.4; q.sway = 0; q.blinkMedian = p.blinkMedian * 1.6;
    const k = h.tier === 'reduced' ? [1.6, 1.8] : [0.25, 0.25];
    q.bx = 1 + (p.bx - 1) * k[0]; q.by = 1 + (p.by - 1) * k[1];
  }
  return q;
}

/** Idle intervals × (the room, the content float, hands-free and the guided breath: rarer fidgets). */
export const idleScale = (h: Host) => ROOMS[h.room].fidget * (h.contentFloat ? SETTLE.fidget : 1) * (state(h).hold || h.guidedBreath !== null ? 3 : 1);

/* ---------- the Garden's guided breath ---------- */

/** "Breathe with me" (§4.5): one breath cycle as motion every period while it is on (the engine set the period). */
export function guide(h: Host): void {
  h.cancel('guide');
  const cycle = () => {
    const s = h.guidedBreath;
    if (s === null) return;
    // something more important is playing (a touch): the next cycle starts as soon as it is done
    const on = !h.asleep && !h.sleeping && !!play(h, 'breathe', breatheCycle(s * 1000, 0.4, h.tier === 'reduced'), h.clock.now());
    h.schedule('guide', on || h.asleep || h.sleeping ? s * 1000 : 400, cycle);
  };
  cycle();
  h.wake();
}

/* ---------- hands-free listening (§8A.2) ---------- */

/**
 * The open-mic hold: while hands-free is on the pet stays attentive (leaning in, ears up, slow blinks, eyes on you),
 * under the talk states (the listen perk still plays when speech starts; thinking and speaking take over). Distinct
 * from the one-shot perk on focus: it comes on slowly and holds.
 */
export function setListening(h: Host, on: boolean): void {
  const st = state(h);
  if (st.hold === on) return;
  const now = h.clock.now();
  st.hold = on;
  if (on) {
    if (h.asleep || h.dozing) h.wakeUp(now, h.asleep ? 'sleep' : 'doze');
    st.holdSide = h.ctx().rng() < 0.5 ? -1 : 1;
    play(h, 'attend', attend(h.ctx()), now);
  }
  h.applyMood(now);
  h.wake();
}

/** Is the hands-free hold on (tests, the lab)? */
export const listening = (h: Host) => state(h).hold;

/* ---------- sentence-by-sentence speech (§8A.3) ---------- */

/** One queued sentence: its text (the mouth follows its letters) and how long it plays, or just the ms. */
export type SpeakItem = number | { text?: string; ms: number };
/** Lip-sync for an item that has no text: a soft, even babble (deterministic). */
const BABBLE = 'mano bela tisa domi ';

/**
 * Sentences played one after another (the page's audio queue, or a bubble revealed sentence by sentence) drive one
 * continuous lip-sync: each sentence's visemes fill its time but for a short closing pause, the mouth rests in it
 * and the chest takes a small breath, and the next sentence starts where the last one ended (no drift, no
 * speakStart per sentence). `more`: further sentences are coming, so the queue holds the mouth at rest after its
 * last one instead of finishing (a later speakQueue appends and goes on; stopSpeaking ends it).
 */
export class QueueLip implements LipSource {
  private items: Array<{ text: string; ms: number }> = [];
  private i = -1;
  private cur: TextLipSync | null = null;
  private at = 0;
  private talkEnd = 0;
  private itemEnd = 0;
  private open = 0;
  private width = 0;
  private breathed = false;
  more: boolean;
  constructor(private h: Host, items: SpeakItem[], more: boolean, now: number) {
    this.more = more;
    this.itemEnd = now;
    this.push(items, more);
  }

  push(items: SpeakItem[], more: boolean): void {
    for (const it of items) {
      const ms = Math.max(120, typeof it === 'number' ? it : it.ms);
      const text = typeof it === 'number' || !it.text ? BABBLE.repeat(Math.ceil((ms / 1000) * 14 / BABBLE.length)).slice(0, Math.round((ms / 1000) * 14)) : it.text;
      this.items.push({ text, ms });
    }
    this.more = more;
  }

  /** Start the next sentence at `t` (where the last one ended, or now if the queue had run dry). */
  private next(t: number): boolean {
    if (this.i + 1 >= this.items.length) return false;
    const it = this.items[++this.i];
    const pause = Math.min(SPEECH.maxPauseMs, Math.max(SPEECH.minPauseMs, it.ms * SPEECH.pause));
    const talk = Math.max(60, it.ms - pause);
    const cps = Math.min(SPEECH.maxCps, Math.max(SPEECH.minCps, it.text.length / (talk / 1000)));
    this.at = t; this.talkEnd = t + talk; this.itemEnd = t + it.ms;
    this.cur = new TextLipSync(it.text, cps, t);
    this.breathed = false;
    return true;
  }

  sample(now: number, dtMs: number): MouthSample {
    let sentence = false;
    if (this.cur === null || now >= this.itemEnd) {
      // a queue that ran dry and got more starts now; otherwise the next sentence starts where the last one ended
      const from = this.cur === null || now - this.itemEnd > dtMs + 1 ? Math.max(now, this.itemEnd) : this.itemEnd;
      if (this.next(from)) sentence = true; else this.cur = null;
    }
    if (this.cur && now < this.talkEnd) {
      const s = this.cur.sample(now, dtMs);
      this.open = s.open; this.width = s.width;
      sentence = sentence || s.sentence;
    } else {
      // the closing pause (or waiting for more): the mouth rests; a small breath between sentences
      const k = 1 - Math.exp(-dtMs / CLOSE_TAU);
      this.open -= this.open * k; this.width -= this.width * k;
      if (this.cur && !this.breathed && (this.i + 1 < this.items.length || this.more)) {
        this.breathed = true;
        if (this.h.tier !== 'reduced') play(this.h, 'breath', sentenceBreath(this.itemEnd - now), now);
      }
    }
    const done = this.cur === null && !this.more && this.open < 0.03;
    return { open: this.open, width: this.width, done, sentence };
  }
}

/** Speak sentences in a row (appends while a queue is speaking); old speakText/speakAudio calls are untouched. */
export function speakQueue(h: Host, items: SpeakItem[], o: { more?: boolean }): void {
  const now = h.clock.now();
  if (h.lip instanceof QueueLip && h.talkState === 'speaking') { h.lip.push(items, !!o.more); h.wake(); return; }
  h.lip = new QueueLip(h, items, !!o.more, now);
  h.startSpeaking(now, 'text');
}

/* ---------- growth details (§4.11) ---------- */

function refit(h: Host, st: XState): void {
  st.fitStage = h.motion.stage;
  const was = st.shown;
  st.shown = fitDetails(st.details, h.motion.stage as Stage);
  if (JSON.stringify(was) !== JSON.stringify(st.shown)) h.motionCue({ type: 'details', details: st.shown });
}

/** The details this view has lit (§4.11); what the stage can wear shows now, the rest with its part. */
export function setDetails(h: Host, d: Details): void {
  const st = state(h);
  // the lit details replace the lit details only: the Garden's seed (setGarden) stays on the floor
  st.details = { ...d, keepsakes: [...(d.keepsakes ?? [])], ...('garden' in d ? {} : { garden: st.details.garden }) };
  st.fitStage = -1;
  refit(h, st);
  h.wake();
}

/* ---------- the Garden's seed and the Closet's outfit (§4.5, §4.3) ---------- */

/** What the floor shows of the seed, per engine (the details carry it to the page's floor layer). */
const gardens = new WeakMap<Host, GardenShown>();

/** The seed on the floor (planted, sprouted, bloomed), or null; every stage shows it (it is not worn). */
export function setGarden(h: Host, g: GardenInput | null): void {
  const st = state(h), fit = fitGarden(g);
  if (fit) gardens.set(h, fit); else gardens.delete(h);
  st.details = { ...st.details, garden: fit };
  st.fitStage = -1;
  refit(h, st);
  h.wake();
}

/** The outfit this person chose (§4.3), whole: a slot left out (or null) wears nothing. */
export function setWearing(h: Host, w: Wearing): void {
  const st = state(h);
  st.wearing = { ...w };
  refitWear(h, st, true);
  h.wake();
}

/** Refit the outfit to the stage and look; says what is worn when it changed (always after setWearing). */
function refitWear(h: Host, st: XState, force: boolean): void {
  const was = st.worn;
  st.wornStage = h.motion.stage;
  st.wornLook = h.look;
  st.worn = fitWearing(st.wearing, h.motion.stage as Stage, h.look);
  if (!force && JSON.stringify(was) === JSON.stringify(st.worn)) return;
  const put = (['head', 'neck', 'hand'] as const).find((k) => st.worn[k] && st.worn[k] !== was[k]);
  h.motionCue({ type: 'wearing', wearing: st.worn, ...(put ? { fresh: wearKey(put, st.worn[put]!) } : {}) });
}

/** What the character wears now (sheets, tests). */
export const wearingState = (h: Host): ShownWearing => state(h).worn;

/** Add one lit detail (at the litPeak); true when this stage shows it. */
function light(h: Host, st: XState, detail: DetailName, id?: string): boolean {
  const d = st.details;
  if (detail === 'keepsake') { if (id && !(d.keepsakes ?? []).includes(id)) d.keepsakes = [...(d.keepsakes ?? []), id]; }
  else if (detail === 'seasonal') d.seasonal = id ?? d.seasonal ?? 'season';
  else d[detail] = true;
  refit(h, st);
  const sh = st.shown, shown = detail === 'keepsake' ? !!id && sh.keepsakes.includes(id) : detail === 'seasonal' ? !!sh.seasonal : sh[detail];
  st.fade = shown ? { key: detailKey(detail, id), at: h.clock.now() } : null;
  return shown;
}

/** What the details look like now (frame sheets, tests): the shown set and the one fading in (u 0 … 1). */
export function detailState(h: Host, fadeMs: number): { shown: ShownDetails; fade: { key: string; u: number } | null } {
  const st = state(h);
  return { shown: st.shown, fade: st.fade ? { key: st.fade.key, u: Math.min(1, (h.clock.now() - st.fade.at) / fadeMs) } : null };
}

/**
 * Lighting a growth moment (§10.3): the detail's `litPeak` cue comes at the top of the glow (~600 ms), naming the
 * detail; the detail joins the shown set then (asleep or reduced, with no motion over it: a fade only).
 */
export function lightMoment(h: Host, o: { detail?: DetailName; id?: string }): void {
  const now = h.clock.now(), st = state(h);
  const peak = () => {
    const shown = o.detail ? light(h, st, o.detail, o.id) : undefined;
    h.motionCue({ type: 'litPeak', ...(o.detail ? { detail: o.detail, shown } : {}), ...(o.id ? { id: o.id } : {}) });
    h.wake();
  };
  // asleep, only the detail appears (no motion over a sleeping face)
  if (h.asleep || h.sleeping) { peak(); return; }
  if (h.dozing) h.wakeUp(now, 'doze');
  if (play(h, 'growthLit', growthLit(h.ctx(), o.detail), now)) h.schedule('litPeak', 600 * h.sm.time, peak);
  else peak();
  h.wake();
}

/* ---------- the settle rule ---------- */

/**
 * An input (a touch, a toy, talk, a room). Inputs no more than SETTLE.gapMs apart make one stretch of continuous
 * play; six minutes into it the pet settles into the content float (once per stretch). A gap ends the stretch and
 * the float with it.
 */
export function input(h: Host, now: number, gap: number): void {
  if (h.stretchStart !== null && gap <= SETTLE.gapMs) return;
  h.stretchStart = now;
  if (h.contentFloat) { h.contentFloat = false; h.applyMood(now); }
  h.schedule('settle', SETTLE.afterMs, () => checkSettle(h));
}

function checkSettle(h: Host): void {
  const now = h.clock.now();
  if (h.contentFloat || h.stretchStart === null) return;
  // the stretch ran out before six minutes: the next input starts a new one
  if (now - h.lastInput > SETTLE.gapMs) { h.stretchStart = null; return; }
  // never over a reaction, a game, talk or sleep: try again in a moment
  if (!h.canIdle()) { h.schedule('settle', SETTLE.retryMs, () => checkSettle(h)); return; }
  h.contentFloat = true;
  h.applyMood(now);
  play(h, 'settle', settleFloat(h.ctx()), now);
  h.motionCue({ type: 'settle' });
  h.wake();
}

/* ---------- the OS reduced-motion switch ---------- */

/** Follow prefers-reduced-motion live (the page passes it as the tier too; this covers any other host). */
export function followOS(h: Host): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || h.unsubOS) return;
  try {
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const on = () => { h.osReduced = mq.matches; h.applyTier(); };
    mq.addEventListener?.('change', on);
    h.unsubOS = () => mq.removeEventListener?.('change', on);
    on();
  } catch { /* an old WebView: the tier passed in decides */ }
}

/* ---------- the frame-budget guard (§10.7) ---------- */

/**
 * Busy frames are measured (frames that follow another busy frame; a wake from rest never counts). Over a window
 * of `window` busy frames, a mean interval above `slowFrameMs` (under ~40 fps) or a mean script cost above
 * `scriptMs` steps the tier down once: full → lite (lite drops hit-stops and velocity stretch, followers and
 * particles at 30 Hz, a 6-particle cap). Lite is the floor: reduced is an accessibility choice, never a speed one.
 * One step per session; setTier() starts the guard over.
 */
export const FRAME_GUARD = { window: 90, slowFrameMs: 25, scriptMs: 5, gapMs: 100 } as const;

export class FrameGuard {
  private n = 0;
  private sumDt = 0;
  private sumCost = 0;
  tripped = false;

  reset(): void { this.n = 0; this.sumDt = 0; this.sumCost = 0; this.tripped = false; }

  /** One busy frame: its interval (ms, unclamped) and script cost (ms, or NaN when not measured). Returns the reason to degrade, once. */
  frame(dtMs: number, costMs: number): 'frames' | 'script' | null {
    if (this.tripped || !(dtMs > 0) || dtMs > FRAME_GUARD.gapMs) return null;
    this.n++; this.sumDt += dtMs; this.sumCost += costMs > 0 ? costMs : 0;
    if (this.n < FRAME_GUARD.window) return null;
    const dt = this.sumDt / this.n, cost = this.sumCost / this.n;
    this.n = 0; this.sumDt = 0; this.sumCost = 0;
    if (dt > FRAME_GUARD.slowFrameMs) { this.tripped = true; return 'frames'; }
    if (cost > FRAME_GUARD.scriptMs) { this.tripped = true; return 'script'; }
    return null;
  }
}

const guards = new WeakMap<Host, FrameGuard>();

/** One measured busy frame from the engine; the first trip steps the tier down and says so. */
export function guardFrame(h: Host, dtMs: number, costMs: number): void {
  let g = guards.get(h);
  if (!g) guards.set(h, (g = new FrameGuard()));
  const why = g.frame(dtMs, costMs);
  if (!why) return;
  h.guardTier = 'lite';
  const was = h.tier;
  h.applyTier();
  if (h.tier !== was) h.motionCue({ type: 'degraded', tier: h.tier, reason: why });
}

/** A tier the page chooses starts the guard over. */
export function resetGuard(h: Host): void { guards.get(h)?.reset(); }
