/**
 * The motion extras chunk (design §10.4, §10.5, §3.1, §4.11): rooms (their idle flavour, pose, transitions, idle
 * beats and reactions), the settle rule and its content float, growth moments and the moves they unlock, the
 * Garden's guided breath, and following the OS reduced-motion switch. The engine imports this lazily (its own
 * chunk, preloaded a few seconds after start, §10.7) and calls it through the narrow `Host` below; before it lands
 * the pet is simply at Home with its ordinary idle, and any call that needs it waits for it.
 */

import type { Mood } from '@/lib/pet/types';
import { REDUCED_MOTION_QUERY } from '../../_components/motion/activity';
import type { IdleParams } from './breath';
import type { StageMotion } from './motion';
import type { Playing } from './player';
import { growthLit, roomIdle, roomLeave, roomReaction, settleFloat, unlockedMove } from './reactions/rooms';
import {
  MULTIPLY, ROOM_ORDER,
  type Beat, type Channel, type MotionCue, type MotionKind, type PoseTargets, type PriorityClass, type ReactionCtx, type Room, type RoomReaction, type Tier,
} from './types';

export { roomIdle, unlockedMove };

/* ---------- data ---------- */

export interface RoomFlavour {
  /** the room's idle pose, added to the state's base targets (body px at 200, degrees, view-box units) */
  pose: Partial<PoseTargets>;
  /** breath period × and depth × */
  breath: number;
  depth: number;
  /** blink gap median × and the slow-blink share floor */
  blink: number;
  slowBlinks: number;
  /** resting lids × (bedroom: heavier) */
  lid: number;
  /** where idle glances lean (eye-range units), or null for the mood's own drift */
  look: { x: number; y: number } | null;
  /** fidget and ambient intervals × */
  fidget: number;
}

export const ROOMS: Readonly<Record<Room, RoomFlavour>> = {
  home: { pose: {}, breath: 1, depth: 1, blink: 1, slowBlinks: 0, lid: 1, look: null, fidget: 1 },
  // ready bounce, eyes on the toy
  play: { pose: { headY: -0.6 }, breath: 0.9, depth: 1.1, blink: 1.1, slowBlinks: 0, lid: 1, look: { x: 0.35, y: 0.35 }, fidget: 0.8 },
  // hovering over the pot, looking down at it (and up at the rain)
  garden: { pose: { y: -6, headY: 0.6 }, breath: 1.15, depth: 1, blink: 1, slowBlinks: 0.05, lid: 1, look: { x: 0.1, y: 0.45 }, fidget: 1.1 },
  // a three-quarter turn toward the mirror
  closet: { pose: { headX: 1.8, headTilt: 3, lean: 2 }, breath: 1, depth: 1, blink: 1, slowBlinks: 0, lid: 1, look: { x: 0.6, y: -0.05 }, fidget: 1 },
  // slower breath, heavier lids
  bedroom: { pose: { y: 0.6, headY: 0.6 }, breath: 1.3, depth: 1.1, blink: 1.4, slowBlinks: 0.3, lid: 0.82, look: { x: 0, y: 0.25 }, fidget: 1.6 },
  // the reading pose: head down a little, eyes on the page
  book: { pose: { headY: 1.2, headTilt: -2 }, breath: 1.05, depth: 1, blink: 1.2, slowBlinks: 0.1, lid: 0.92, look: { x: 0, y: 0.55 }, fidget: 1.3 },
};

/** Room transition (§10.5): the backdrop swaps at the top of the lean, 150 ms in. */
export const ROOM_SWAP_MS = 150;

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

export const MOTION_PRIORITY: Readonly<Record<MotionKind, PriorityClass>> = {
  roomLeave: 'touch', growthLit: 'touch', settle: 'needs', roomIdle: 'idle', hopIdle: 'idle',
  catch: 'play', nearMiss: 'play', roundEnd: 'play', rain: 'touch', admire: 'touch', storyNod: 'talk', pageFlip: 'needs', ownDrawing: 'touch',
};

/* ---------- the host: what the engine lends this chunk ---------- */

export interface Host {
  readonly clock: { now(): number };
  readonly tier: Tier;
  readonly sm: StageMotion;
  readonly asleep: boolean;
  readonly sleeping: boolean;
  readonly dozing: boolean;
  readonly mood: Mood;
  room: Room;
  contentFloat: boolean;
  stretchStart: number | null;
  lastInput: number;
  guidedBreath: number | null;
  osReduced: boolean;
  unsubOS: (() => void) | null;
  guardTier: Tier;
  ctx(): ReactionCtx;
  canIdle(): boolean;
  playBeats(kind: Playing['kind'], cls: PriorityClass, beats: Beat[], now: number): Playing | null;
  schedule(tag: string, ms: number, fn: () => void): void;
  cancel(tag: string): void;
  applyMood(now: number): void;
  applyTier(): void;
  wake(): void;
  wakeUp(now: number, from: 'sleep' | 'doze'): void;
  motionCue(c: MotionCue): void;
}

const play = (h: Host, kind: MotionKind, beats: Beat[], now: number) => h.playBeats(kind, MOTION_PRIORITY[kind], beats, now);

/* ---------- rooms ---------- */

export function setRoom(h: Host, room: Room, o: { dir?: -1 | 1; instant?: boolean }, input: (now: number) => void): void {
  if (room === h.room) return;
  const now = h.clock.now(), from = h.room;
  h.room = room;
  input(now);
  const swap = () => { h.motionCue({ type: 'roomSwap', room }); h.applyMood(h.clock.now()); h.wake(); };
  // reduced motion, asleep or told to cut: the UI crossfades (160 ms); the character only changes its idle flavour
  if (o.instant || h.tier === 'reduced' || h.asleep || h.sleeping) { h.cancel('roomSwap'); swap(); return; }
  const dir = o.dir ?? (ROOM_ORDER.indexOf(room) >= ROOM_ORDER.indexOf(from) ? 1 : -1);
  play(h, 'roomLeave', roomLeave(h.ctx(), dir), now);
  h.schedule('roomSwap', ROOM_SWAP_MS * h.sm.time, swap);
  h.wake();
}

export function roomReact(h: Host, kind: RoomReaction, o: { won?: boolean }): void {
  const now = h.clock.now();
  if (h.asleep || h.dozing) h.wakeUp(now, h.asleep ? 'sleep' : 'doze');
  play(h, kind, roomReaction(h.ctx(), kind, o), now);
  h.wake();
}

/** The room's idle beat (the scheduler plays it in place of most mood beats away from Home). */
export function idleBeat(h: Host, now: number): void { play(h, 'roomIdle', roomIdle(h.ctx(), h.room), now); }

/** Where idle glances lean in this room (null: the mood's own drift). */
export const roomLook = (h: Host) => ROOMS[h.room].look;

/** The room's idle pose over the state's base targets (never asleep, listening or on reduced motion). */
export function pose(h: Host, t: Partial<PoseTargets>): void {
  const rp = ROOMS[h.room].pose;
  for (const c of Object.keys(rp) as Channel[]) t[c] = MULTIPLY.has(c) ? (t[c] ?? 1) * rp[c]! : (t[c] ?? 0) + rp[c]!;
}

/**
 * The idle parameters after the room (§10.4), the settle float (§3.1), the guided breath (Garden's "breathe with
 * me") and the stage (a wisp's slow blinks). Asleep keeps its own breath.
 */
export function flavour(h: Host, p: IdleParams): IdleParams {
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
  if (h.guidedBreath !== null) {
    // a slow, deep, even breath you can follow (in 40 %, out 60 %)
    q.period = h.guidedBreath; q.inhale = 0.4;
    q.bx = 1 + (p.bx - 1) * 1.6; q.by = 1 + (p.by - 1) * 1.8;
  }
  return q;
}

/** Idle intervals × (the room, the content float): rarer fidgets when settled. */
export const idleScale = (h: Host) => ROOMS[h.room].fidget * (h.contentFloat ? SETTLE.fidget : 1);

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

/* ---------- growth moments ---------- */

/** Lighting a growth moment (§10.3): the detail's `litPeak` cue comes at the top of the glow (~600 ms). */
export function lightMoment(h: Host): void {
  const now = h.clock.now();
  // asleep, only the detail appears (no motion over a sleeping face)
  if (h.asleep || h.sleeping) { h.motionCue({ type: 'litPeak' }); return; }
  if (h.dozing) h.wakeUp(now, 'doze');
  if (play(h, 'growthLit', growthLit(h.ctx()), now)) h.schedule('litPeak', 600 * h.sm.time, () => h.motionCue({ type: 'litPeak' }));
  else h.motionCue({ type: 'litPeak' });
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
