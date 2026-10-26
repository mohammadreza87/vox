/**
 * Vox Pet client seams: the API surface (api.ts implements PetApi), the engine handle the UI drives
 * (loop.ts implements PetEngine), how PetRig mounts the character, and the pointer → gesture types
 * gestures.ts classifies. Types and thresholds only.
 */

import type { MotionStyle, MotionValue } from 'framer-motion';
import type { Expression } from '@/lib/studio/character';
import type {
  CareRequest, CareResponse, CharacterLook, GrowthConfirmResponse, LookRequest, LookResponse, Mood, NeedKey, PetAction, PetErrorBody, PetErrorCode, PetPrivateView, PetView,
  Stage, TalkAction, TalkRequest, TalkResponse, TalkVoiceResponse, TalkVoiceStreamEvent,
} from '@/lib/pet/types';
import type { PetGrowthView } from '@/lib/pet/growth';
import type { PetCheckinsRequest, PetCheckinsView } from '@/lib/pet/checkins';
import type { AskId, GardenState, PetPlayView, PlayRequest as PlayMutationRequest, PlayResponse, SeedKind, WearableId, WearSlot } from '@/lib/pet/play';
import type { RigBindings } from '../../_components/character/CharacterView';
import type { MotionCue, Point, ReactionEvent, Room, RoomReaction, SayLine, Side, Tier, Zone } from '../_engine/types';

/* ---------- API (brief §3.8): every call sends X-Telegram-Init-Data and the x-pet-tz header ---------- */

/** The play record (design §3.4): `PetView.play` on open, and what POST …/play answers. */
export type { PetPlayView, PlayResponse };
/** One play mutation, plus `askAccepted` (Wave B server: the yes on a permission sheet, §6.1 rule 6) until play.ts carries it. */
export type PlayRequest = PlayMutationRequest | { op: 'askAccepted'; ask: AskId };

/** `keepalive`: the request outlives the page (care flushed on hide, before Telegram may close it). */
export interface PetRequestOpts { signal?: AbortSignal; keepalive?: boolean }

/* ---------- Wave B, optional until the server lands them (design §4.11, §8A) ---------- */

/** `PetView.growth` (pet/growth.ts, §4.11): every moment, its agent-wide `lit`, and `mine`, the ids lit only for this person. */
export type { PetGrowthView };
export type PetGrowthMoment = PetGrowthView['moments'][number];
/**
 * UX-02's launch facts (PRIVACY_AND_CONSENT.md §8, `PetView.voiceNotice`): who hears the audio, where, and the verified
 * retention line, with optional Persian spellings. Until all three are resolved the mic sheet says the providers are
 * listed in Privacy (never a brace, never a silent gap).
 */
export type PetVoiceNotice = NonNullable<PetView['voiceNotice']> & { retentionFa?: string; providersFa?: string; locationsFa?: string };
/** What lit moments add to the character (_engine/details.ts `Details`): taught a glint, task a pin, access a charm. */
export interface LitDetails { glint?: boolean; pin?: boolean; charm?: boolean; keepsakes?: string[]; seasonal?: string | null }
/* ---------- Wave C (design §5, §6.2, §8.4): the server's shapes (pet/checkins.ts, pet/types.ts) ---------- */

/** The check-in moment types (§5.2) and GET/POST …/checkins: the view answered, the requests (P1 yes with consent, resume, stop). */
export type { CheckinTypes, PetCheckinReplay } from '@/lib/pet/checkins';
export type CheckinPrefs = PetCheckinsView;
export type CheckinsRequest = PetCheckinsRequest;
/** pet_action (§8.4): the page acts only at confidence ≥ 0.75 (petAction.ts), after the reply. */
export type { PetActionKind, TalkAction } from '@/lib/pet/types';

/** PetView plus the Persian spellings of UX-02's facts (the server sends the providers; locations and retention are a legal to-do). */
export type PetViewB = PetView & { voiceNotice?: PetVoiceNotice };
/** A talk reply may say an explicit "remember this" save happened (UX-06), the cue for the growth confirm step. */
export type TalkReplyB = (TalkResponse | TalkVoiceResponse) & { savedNote?: boolean; memorySaved?: boolean; growthMoment?: string; action?: TalkAction };

/** talk-voice?stream=1 (§8A.3): NDJSON, one event per line: transcript, reply, sentences, then done (or a final error). */
export type VoiceStreamEvent = TalkVoiceStreamEvent;

export interface VoiceOpts extends PetRequestOpts {
  /** sent as `handsFree: true` (the server's per-turn voice line, §8A.1) */
  handsFree?: boolean;
}

export interface PetApi {
  /** GET /api/studio/pet/:agentId */
  get(agentId: string, o?: PetRequestOpts): Promise<PetView>;
  /** POST …/care. pet/tickle are flushed as tap counts every 2 s. */
  care(agentId: string, req: CareRequest, o?: PetRequestOpts): Promise<CareResponse>;
  /** POST …/play (design §3.4): one idempotent play mutation, sent with the care epoch like care. Optional until the client implements it. */
  play?(agentId: string, req: PlayRequest, o?: PetRequestOpts): Promise<PlayResponse>;
  /** POST …/talk */
  talk(agentId: string, req: TalkRequest, o?: PetRequestOpts): Promise<TalkResponse>;
  /** POST …/talk-voice, multipart `audio` (MediaRecorder blob) */
  talkVoice(agentId: string, audio: Blob, o?: VoiceOpts): Promise<TalkVoiceResponse>;
  /**
   * POST …/talk-voice?stream=1: events as they arrive (`onEvent`), resolving with the whole turn. A server that answers
   * plain JSON resolves with it (no events). Null: this server has no stream route and did not take the turn (post the
   * plain call instead); any other failure throws like talkVoice.
   */
  talkVoiceStream?(agentId: string, audio: Blob, onEvent: (e: VoiceStreamEvent) => void, o?: VoiceOpts): Promise<TalkVoiceResponse | null>;
  /** POST …/growth/confirm `{ momentId }` (§4.11): the person said yes to "Shall I keep this as …?" */
  growthConfirm?(agentId: string, momentId: string, o?: PetRequestOpts): Promise<GrowthConfirmResponse>;
  /** GET …/checkins (no request) or POST it (§5.2). Refusals come as `checkins_unavailable` / `consent_*` (never `pet_unavailable`: a server without the route is renamed). */
  checkins?(agentId: string, req?: CheckinsRequest, o?: PetRequestOpts): Promise<CheckinPrefs>;
  /** POST …/look (§4.3): the real look, pet-signed, for `view.canEditLook` only; 403 `look_forbidden` otherwise */
  look?(agentId: string, req: LookRequest, o?: PetRequestOpts): Promise<LookResponse>;
  /** Circles S4: GET circle | notes, POST circle/decision | circle/leave, DELETE notes/:copyId (no care epoch) */
  send?<T>(agentId: string, method: 'GET' | 'POST' | 'DELETE', action: string, body?: unknown, o?: PetRequestOpts): Promise<T>;
}

/** What api.ts throws: `network` for fetch failures and aborts, else the server's code. */
export interface PetApiError extends Error {
  status: number;
  code: PetErrorCode | 'network';
  /** 403 pet_private carries the look so the page can draw the character asleep */
  body?: PetErrorBody | PetPrivateView;
}

/** Legacy snapshot format/key, retained only for migration fixtures. Never read or persist private views. */
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

  /* the motion layer (loop.ts PetMotionControls, design §10): optional, so a page or a test double without it still runs */
  setStage?(stage: Stage): void;
  setRoom?(room: Room, o?: { dir?: -1 | 1; instant?: boolean }): void;
  roomReact?(kind: RoomReaction, o?: { won?: boolean; zen?: boolean }): void;
  loadRooms?(): Promise<void>;
  /** `detail` (and `id` for a keepsake or the seasonal one) fades in at the `litPeak` cue, which names it */
  lightMoment?(o?: { fidget?: string; detail?: 'glint' | 'pin' | 'charm' | 'keepsake' | 'seasonal'; id?: string }): void;
  /** steer the eyes to a stage point (Starfall's falling star), null to let go */
  setGaze?(p: Point | null): void;
  unlockFidget?(id: string): boolean;
  setReducedMotion?(on: boolean | null): void;
  setGuidedBreath?(periodS: number | null): void;
  onMotion?(fn: (c: MotionCue) => void): () => void;
  /** the lit moments' detail parts (eye glints, pins, charms, floor keepsakes), from the growth view (motion engineer, Wave B) */
  setDetails?(d: LitDetails): void;
  /** hold (or let go of) the listening pose for hands-free (motion engineer, Wave B) */
  setListening?(on: boolean): void;
  /** the person's closet overlay on the character (§4.3), this screen only (motion engineer, Wave C) */
  setWearing?(w: Partial<Record<WearSlot, WearableId>>): void;
  /** the Garden pot's floor state (§4.5); null clears it (motion engineer, Wave C) */
  setGarden?(g: { state: GardenState; seed: SeedKind } | null): void;
  /** Guess my word (§4.2): it has a word, a question heard, a right or wrong guess, the word told; Zen one preset softer (motion engineer, Wave C) */
  guessReact?(k: 'think' | 'heard' | 'right' | 'wrong' | 'reveal', o?: { zen?: boolean }): void;
  /** the Closet mirror (§4.3): a glance at the item, a turn to the mirror (same as roomReact('tryOn', { id })) */
  tryOn?(id: string): void;
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
