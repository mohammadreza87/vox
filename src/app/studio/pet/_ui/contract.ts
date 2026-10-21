/**
 * Vox Pet client seams: the API surface (api.ts implements PetApi), the engine handle the UI drives
 * (loop.ts implements PetEngine), how PetRig mounts the character, and the pointer → gesture types
 * gestures.ts classifies. Types and thresholds only.
 */

import type { MotionStyle, MotionValue } from 'framer-motion';
import type { Expression } from '@/lib/studio/character';
import type {
  CareRequest, CareResponse, CharacterLook, Mood, NeedKey, PetAction, PetErrorBody, PetErrorCode, PetForgetResponse, PetPrivateView, PetView,
  Stage, TalkRequest, TalkResponse, TalkVoiceResponse,
} from '@/lib/pet/types';
import type { RigBindings } from '../../_components/character/CharacterView';
import type { Point, ReactionEvent, SayLine, Side, Tier, Zone } from '../_engine/types';

/* ---------- API (brief §3.8): every call sends X-Telegram-Init-Data and the x-pet-tz header ---------- */

/** `keepalive`: the request outlives the page (care flushed on hide, before Telegram may close it). */
export interface PetRequestOpts { signal?: AbortSignal; keepalive?: boolean }

export interface PetApi {
  /** GET /api/studio/pet/:agentId */
  get(agentId: string, o?: PetRequestOpts): Promise<PetView>;
  /** POST …/care. pet/tickle are flushed as tap counts every 2 s. */
  care(agentId: string, req: CareRequest, o?: PetRequestOpts): Promise<CareResponse>;
  /** POST …/talk */
  talk(agentId: string, req: TalkRequest, o?: PetRequestOpts): Promise<TalkResponse>;
  /** POST …/talk-voice, multipart `audio` (MediaRecorder blob) */
  talkVoice(agentId: string, audio: Blob, o?: PetRequestOpts): Promise<TalkVoiceResponse>;
  /** POST …/forget: erase this person's care for every agent (the next visit meets the pet anew) */
  forget(agentId: string, o?: PetRequestOpts): Promise<PetForgetResponse>;
}

/** What api.ts throws: `network` for fetch failures and aborts, else the server's code. */
export interface PetApiError extends Error {
  status: number;
  code: PetErrorCode | 'network';
  /** 403 pet_private carries the look so the page can draw the character asleep */
  body?: PetErrorBody | PetPrivateView;
}

/** First-paint cache in Telegram DeviceStorage (fallback localStorage, every access in try/catch). */
export const SNAPSHOT_KEY = (agentId: string) => `vox-pet:${agentId}`;
export interface PetSnapshot { v: 1; view: PetView; savedAt: number }

/* ---------- pointer input → gestures (§1.3, §2.6) ---------- */

/** One raw pointer sample in stage px (the page's coordinate space), as the UI receives it. */
export interface PointerSample {
  kind: 'down' | 'move' | 'up' | 'cancel';
  id: number;
  x: number;
  y: number;
  /** performance.now() ms */
  t: number;
}

/** A hit on the character: which zone and side, in character-local px at 200 (from the engine's model). */
export interface Hit { zone: Zone; side: Side; local: Point }

export const GESTURE = {
  /** a tap: up within this many ms and px of the down */
  tapMs: 220, tapPx: 10,
  /** a stroke (pet): moved ≥ px across the body at speed in [min, max] px/s for ≥ ms */
  strokePx: 10, strokeMinV: 40, strokeMaxV: 700, strokeMs: 250,
  /** a tickle: ≥ reversals within ms, or ≥ pokes within ms */
  tickleReversals: 3, tickleReversalMs: 600, ticklePokes: 4, ticklePokeMs: 1000,
  longPressMs: 420,
  /** a drag: moved ≥ px from the body with the pointer captured */
  dragPx: 10,
  /** escalation: hits per gesture kind in a sliding window; mid at 4–6, max at 7+ */
  escalationMs: 4000, escalationMid: 4, escalationMax: 7,
  /** after max: taps only get small squashes for coolOffMs; full reset after resetMs without touch */
  coolOffMs: 3000, resetMs: 6000,
  /** shake: |a| > threshold m/s² at least `count` times within ms (Accelerometer refresh 50 ms), once per cooldown */
  shakeA: 15, shakeCount: 3, shakeMs: 1000, shakeCooldownMs: 5000, accelRefreshMs: 50,
  /** feed: within this many px of the mouth the mouth opens 1 − dist/120 */
  feedReachPx: 120,
} as const;

/**
 * What gestures.ts emits. `contact` fires inside the pointerdown handler so the first deformation lands
 * on the same frame; the classified gesture follows on up/move/timer.
 */
export type GestureEvent =
  | { type: 'contact'; hit: Hit; at: Point }
  | { type: 'poke'; hit: Hit; at: Point; hits: number; coolOff: boolean }
  | { type: 'stroke'; speed: number; dir: -1 | 1; passes: number }
  | { type: 'tickle' }
  | { type: 'overpoke'; hits: number; level: 'mid' | 'max' }
  | { type: 'longPress'; hit: Hit; at: Point }
  | { type: 'dragStart'; at: Point }
  | { type: 'dragMove'; at: Point; vx: number; vy: number }
  | { type: 'release'; at: Point; vx: number; vy: number; fling: boolean }
  /** a finger down anywhere off the character: the eyes track it (Pou) */
  | { type: 'track'; at: Point }
  | { type: 'trackEnd' }
  | { type: 'shake' };

/** The classifier gestures.ts exports (pure: feed it samples and a clock, it answers gestures). */
export interface GestureClassifier {
  /** `hit` resolves a stage point on the character (null: off the character) */
  feed(p: PointerSample, hit: (at: Point) => Hit | null): GestureEvent[];
  /** timers (long-press, escalation decay) */
  tick(now: number): GestureEvent[];
  /** device acceleration sample (m/s²) */
  accel(a: { x: number; y: number; z: number }, now: number): GestureEvent[];
  reset(): void;
}

/* ---------- toys and talk (UI → engine) ---------- */

export type ToyKind = 'cookie' | 'ball' | 'moon';
export type ToyEvent =
  | { type: 'cookieLift'; at: Point }
  | { type: 'cookieMove'; at: Point }
  /** dropped (the engine decides whether it landed on the mouth) */
  | { type: 'cookieDrop'; at: Point }
  /** tap: the cookie arcs into the mouth (accessibility, desktop) */
  | { type: 'cookieTap' }
  /** `tired`: Energy is under TIRED_BELOW (the care rule, §1.3), so the round is the half-hearted "Nap first?" */
  | { type: 'ballTap'; at?: Point; tired?: boolean }
  | { type: 'moonTap' };

export type TalkState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Where things are on the page, in stage px, so gaze, feed reach and particles can aim. Updated on resize. */
export interface SceneAnchors {
  /** the character box (its square of `size` px), top-left */
  character: { x: number; y: number; size: number };
  toys: Record<ToyKind, Point>;
  pill: Point;
  viewport: { w: number; h: number };
}

/* ---------- engine → UI ---------- */

/** Rare, discrete things the UI renders with React state (never per frame). */
export type EngineCue =
  /** the structural expression CharacterView should draw (brows, fx puffs, Z); eyes and mouth morph in the rig */
  | { type: 'expr'; expr: Expression }
  | { type: 'say'; line: SayLine }
  | { type: 'thought'; need: NeedKey }
  /** a care action completed in motion (bite landed, round started, fell asleep, woke, taps): the UI posts it */
  | { type: 'care'; action: PetAction; n?: number }
  | { type: 'score'; bops: number; misses: number }
  | { type: 'playOver'; bops: number; won: boolean; misses: number }
  /** synthetic or audio lip-sync finished, mouth back at rest */
  | { type: 'spoken' };

/** DOM the loop writes transforms/opacity into directly (no React re-render); returned fn detaches. */
export interface EngineDom {
  /** fixed pool of particle divs (≤ 16) the UI renders once; the engine sets data-kind, transform, opacity */
  particles: HTMLElement[];
  ball: HTMLElement | null;
  /** the dragged cookie while it is in flight */
  cookie: HTMLElement | null;
}

export interface PetEngineOptions {
  look: CharacterLook;
  stage: Stage;
  size: number;
  tier: Tier;
  mood: Mood;
  seed?: number;
  onCue?: (cue: EngineCue) => void;
  /** injectable clock for tests and scripts/pet-frames.ts (default performance.now + rAF) */
  clock?: { now(): number; raf(cb: (t: number) => void): number; caf(id: number): void };
}

/** The engine handle: created once per page by createPetEngine(opts) (_engine/loop.ts). */
export interface PetEngine {
  /** pass to CharacterView's `rig` (stable identity) */
  readonly rig: RigBindings;
  /** the character wrapper div: x, y, scaleX, scaleY, rotate about the ground point (origin included) */
  readonly body: MotionStyle;
  /** lights-off overlay opacity (0 … 0.55) and the stage-up glow (0 … 1), for the backdrop */
  readonly dim: MotionValue<number>;
  readonly glow: MotionValue<number>;
  setLook(look: CharacterLook, stage: Stage): void;
  setSize(px: number): void;
  setTier(tier: Tier): void;
  /** eases breath, lids, sway and tempo to the new mood over 600 ms (never snaps) */
  setMood(mood: Mood): void;
  setScene(scene: SceneAnchors): void;
  /** the hidden Bond: each milestone unlocks one signature idle fidget (§1.2) */
  setBond(bond: number): void;
  /** raw pointer samples from the stage; returns true when the character took the pointer (capture it) */
  pointer(p: PointerSample): boolean;
  accel(a: { x: number; y: number; z: number }): void;
  toy(e: ToyEvent): void;
  /** entering `listening` plays the perk itself (once); `source` picks the mic variant */
  talk(state: TalkState, source?: 'text' | 'mic'): void;
  /** listening swell from the mic level (0 … 1) */
  micLevel(level: number): void;
  /** synthetic visemes at the bubble's reveal rate (chars/s, default 28) */
  speakText(text: string, cps?: number): void;
  /** amplitude lip-sync from the reply audio */
  speakAudio(analyser: AnalyserNode): void;
  stopSpeaking(): void;
  /** fire any reaction directly (open sequence, server outcomes, the lab) */
  fire(e: ReactionEvent): void;
  attach(dom: EngineDom): () => void;
  /** start/stop follow pageActive(); stop also releases sensors and lip-sync */
  start(): void;
  stop(): void;
  dispose(): void;
}

/* ---------- PetRig ---------- */

/**
 * PetRig mounts the character: a `will-change: transform` wrapper bound to `engine.body`, CharacterView
 * (lod 'hero', no `fit`) bound to `engine.rig`, and a CSS breathe layer. Pointer input is taken one level
 * up by Stage (the whole page, so a finger off the character is tracked too), which forwards every
 * sample to `engine.pointer` and captures the pointer when it returns true. PetRig never animates anything itself.
 */
export interface PetRigProps {
  engine: PetEngine;
  look: CharacterLook;
  stage: Stage;
  size: number;
  /** aria label (the agent's name) */
  label: string;
  /** structural expression from the last `expr` cue */
  expr: Expression;
}
