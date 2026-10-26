/**
 * Vox Pet engine contracts (brief §2, §3.1, §3.4). Data only: the spring vocabulary, the pose channels
 * the one rAF loop drives, and the pure reaction shape `(event, ctx) => Beat[]`. Reactions never touch
 * the DOM; the loop plays their beats into RigBindings MotionValues, so every reaction is testable and
 * renderable by scripts/pet-frames.ts without a device.
 *
 * Units: distances are px at a 200 px character (the loop multiplies by k = size / 200), angles are
 * degrees, times are ms, scales are multipliers. Body scales pivot on the ground point (100, GROUND).
 */

import type { CloudFamily, CloudSpecies, Stage } from '@/lib/studio/types';
import type { Expression } from '@/lib/studio/character';
import type { Mood, NeedKey } from '@/lib/pet/types';
import type { MotionTier } from '../../_lib/motion';
import type { haptic } from '../../_lib/haptics';

export type Species = CloudSpecies;
export type Family = CloudFamily;
/** detectTier(): Telegram Android LOW or deviceMemory ≤ 2 → lite; prefers-reduced-motion → reduced. */
export type Tier = MotionTier;
export type Rng = () => number;
export interface Point { x: number; y: number }

/* ---------- springs (§2.2): the only motion vocabulary ---------- */

export type SpringPreset = 'eye' | 'snap' | 'pop' | 'jelly' | 'float' | 'sleepy';
export interface SpringParams {
  /** seconds; k = (2π/d)², c = 4π(1 − bounce)/d, mass 1, damping ratio ζ = 1 − bounce */
  visualDuration: number;
  bounce: number;
  k: number;
  c: number;
}

export const SPRINGS: Readonly<Record<SpringPreset, SpringParams>> = {
  eye: { visualDuration: 0.1, bounce: 0, k: 3947.84, c: 125.66 }, // saccades, pupil snap on startle
  snap: { visualDuration: 0.2, bounce: 0.15, k: 986.96, c: 53.41 }, // contact squash, perk, startle
  pop: { visualDuration: 0.3, bounce: 0.45, k: 438.65, c: 23.04 }, // reaction poses, landing settle, hop
  jelly: { visualDuration: 0.55, bounce: 0.55, k: 130.51, c: 10.28 }, // wobble after impact, poke release
  float: { visualDuration: 0.8, bounce: 0.2, k: 61.69, c: 12.57 }, // lean, head follow, expression weights, shy
  sleepy: { visualDuration: 1.2, bounce: 0, k: 27.42, c: 10.47 }, // droops, sleep nods, dim lights
};

/** k/c for a scaled preset (species tuning: `jelly` ×0.85 on the bear, durations × jitter). */
export const springKC = (visualDuration: number, bounce: number) =>
  ({ k: (2 * Math.PI / visualDuration) ** 2, c: (4 * Math.PI * (1 - bounce)) / visualDuration });

/** One damped spring, mass 1: position x, velocity v, target t. Retargeting keeps v (interrupts never restart). */
export interface Spring { x: number; v: number; t: number; k: number; c: number }

/* ---------- second-order followers (§2.2, t3ssel8r form) ---------- */

export type FollowerPreset = 'ear' | 'floppy' | 'accessory' | 'cheek' | 'shadow';
/** k1 = z/(πf), k2 = 1/(2πf)², k3 = r·z/(2πf); r < 0 gives a free anticipation dip. */
export interface FollowerParams { f: number; z: number; r: number }

export const FOLLOWERS: Readonly<Record<FollowerPreset, FollowerParams>> = {
  ear: { f: 3, z: 0.35, r: -0.3 }, // cat, bear, bunny ears; owl tufts; chick sprout
  floppy: { f: 1.8, z: 0.3, r: 0 }, // dog's hanging ears, bunny ears asleep or droopy
  accessory: { f: 2.2, z: 0.45, r: 0 }, // acc-soft (bows, scarves), pony-tail hair
  cheek: { f: 4.5, z: 0.25, r: 0 }, // cheek puff and jiggle during chomp
  shadow: { f: 6, z: 0.9, r: 0 }, // ground shadow scale/opacity vs body height
};

/** Follower state: output y and its velocity yd, previous input xp (velocity of the input by difference). */
export interface Follower { y: number; yd: number; xp: number; k1: number; k2: number; k3: number }

/* ---------- loop (§3.1, §3.3) ---------- */

export const LOOP = {
  /** semi-implicit Euler substep (s) */
  substep: 1 / 120,
  /** a frame longer than this is clamped (a hitch never launches a spring) */
  maxDtMs: 64,
  /** rest when |v| and |x − t| are both under this for every spring: the loop sleeps */
  restEps: 1e-3,
  /** lite tier: L5 followers and particles update at this rate */
  liteHz: 30,
} as const;

/** Per-frame budgets (§3.3); tests count bindings touched per tick against these. */
export const TIER_BUDGET: Readonly<Record<Tier, { particles: number; morphs: number; transforms: number; hitStop: boolean; velocityStretch: boolean }>> = {
  full: { particles: 16, morphs: 6, transforms: 12, hitStop: true, velocityStretch: true },
  lite: { particles: 6, morphs: 3, transforms: 6, hitStop: false, velocityStretch: false },
  reduced: { particles: 0, morphs: 0, transforms: 0, hitStop: false, velocityStretch: false },
};

/** Ballistics for fling, hops and the ball (§2.6 drag/fling, §2.7). px/s and px/s² at a 200 px character. */
export const PHYSICS = {
  gravity: 2400,
  restitution: 0.45,
  /** release faster than this is a fling, else a drop */
  flingV: 900,
  /** landing faster than this: dizzy + heavy haptic */
  heavyV: 2500,
  /** spin in °/s per px/s of vx */
  spin: 0.15,
  /** drag follow (second-order, lags the finger) */
  drag: { f: 3, z: 0.6, r: 0 } satisfies FollowerParams,
  /** velocity stretch 1 + clamp(|v|·k, 0, max) while dragged or airborne */
  stretchK: 0.0004, stretchMax: 0.22,
} as const;

/* ---------- pose channels ---------- */

/**
 * Every channel the engine can drive. L0–L4 compose into these; L5 followers then chase the final body
 * (ears, hair, acc-soft, cheeks, shadow are never driven directly: a beat's value for those is the target
 * offset the follower chases). MULTIPLY channels compose by product (neutral 1), the rest by sum (neutral 0).
 */
export interface PoseTargets {
  /* body: the wrapper div (whole character), about the ground point */
  x: number;
  /** px, negative is up */
  y: number;
  sx: number;
  /** a beat that sets sy without sx gets sx = sy^(−α) (volume rule, α from species/family tuning) */
  sy: number;
  rot: number;
  /** lean toward a target (deg), composed into the wrapper rotation; usually on `float` */
  lean: number;

  /* head: the `face` rig layer (eyes, brows, mouth move together) */
  headX: number;
  headY: number;
  headTilt: number;

  /* eyes */
  /** per-eye openness over the expression's own lids (0 shut … 1 natural): winks, the poked eye, bliss 0.45 */
  lidL: number;
  lidR: number;
  /** gaze in eye range (−1 … 1 on each axis; range maps to 30°). Lids follow gaze down. */
  gazeX: number;
  gazeY: number;
  /** 1 rest, 1.12 interest/food/affection, 0.75 startle (scales the eye shape) */
  pupil: number;

  /* brows (stage ≥ 3; skipped automatically on dot-eyed stages), view-box units */
  /** + raises each brow */
  browL: number;
  browR: number;
  /** + lifts the inner ends (worried, "aww"), − furrows (offended, grumpy) */
  browInner: number;

  /* mouth: the shape is a Beat's `mouth`; these shape it continuously */
  /** 0 closed … 1 a full "ah" (talkMouth openness) */
  mouthOpen: number;
  /** −1 pucker (OO) … +1 wide (EE) */
  mouthWidth: number;
  /** the eating gape over the mouth: 0 none, 1 the 'aah' (with a tongue), 2 the widest (~45 % of the face) */
  gape: number;

  /* cheeks */
  /** puff scale about each cheek (bite 1.12); chased by the `cheek` follower */
  cheek: number;
  /** shy/bliss blush opacity 0 … 1 (shy grows the discs to 1.32) */
  blush: number;
  blushScale: number;
  /** chewing cheeks 0 … 1: the body outline bulges at the cheek line and the blush swells (chased by a `cheek` follower) */
  puff: number;

  /* pet-only eye marks */
  /** sparkly, wanting eyes 0 … 1: two white highlights per eye (pair with pupil 1.12+) */
  sparkle: number;

  /* secondary (L5 follower targets) */
  /** ear / tuft / sprout / wing rotation offsets (all draw in `ear-l` / `ear-r` groups) */
  earL: number;
  earR: number;
  /** droop of both ears (deg, tired bunny 20) */
  earDroop: number;
  /** pony tail (`tail` binding) rotation offset */
  tail: number;
  /** hair layer y offset (accessory follower) */
  hair: number;
  /** acc-soft layer y offset (accessory follower) */
  acc: number;
  /** ground shadow scale (1 grounded; drag 0.8; the shadow follower also tracks body height on its own) */
  shadow: number;

  /* scene */
  /** stage-up glow (gradient ellipse) 0 … 1 */
  glow: number;
  /** lights-off overlay opacity 0 … 0.55 (sleep) */
  dim: number;
  /** stage-up body path progress 0 old stage … 1 new stage (`bodyD` morph, `float` over ~900 ms) */
  morph: number;
  /** fx layer opacity (thought puffs, model Z marks) */
  fx: number;
}

export type Channel = keyof PoseTargets;
export type Pose = PoseTargets;

/** Channels that compose by product (neutral 1). Every other channel sums (neutral 0). */
export const MULTIPLY: ReadonlySet<Channel> = new Set<Channel>(['sx', 'sy', 'lidL', 'lidR', 'pupil', 'cheek', 'blushScale', 'shadow']);

/** The identity pose: a one-shot that ends here leaves no trace on the layers under it. */
export const NEUTRAL_POSE: Readonly<PoseTargets> = {
  x: 0, y: 0, sx: 1, sy: 1, rot: 0, lean: 0,
  headX: 0, headY: 0, headTilt: 0,
  lidL: 1, lidR: 1, gazeX: 0, gazeY: 0, pupil: 1,
  browL: 0, browR: 0, browInner: 0,
  mouthOpen: 0, mouthWidth: 0, gape: 0,
  cheek: 1, blush: 0, blushScale: 1, puff: 0, sparkle: 0,
  earL: 0, earR: 0, earDroop: 0, tail: 0, hair: 0, acc: 0, shadow: 1,
  glow: 0, dim: 0, morph: 0, fx: 0,
};

/* ---------- faces ---------- */

/**
 * Pet expressions: the character's own six (which CharacterView draws structurally: brows, fx puffs, Z)
 * plus pet-only faces the engine morphs from eye/mouth shapes. Dot-eyed stages (1–2) fall back to the
 * nearest drawable face.
 */
export type PetExpr = Expression
  | 'surprised' // wide round eyes (welcome back, notice the cookie)
  | 'squeeze' // >_< (poked in the eye, giggle fit, sneeze)
  | 'dizzy' // spiral eyes (over-poke, hard landing, shake)
  | 'bliss' // lids 0.45, being petted
  | 'shy' // gaze aside, blush (long-press)
  | 'sad' // brows inner-up, outer lid down (sad-but-cute, "aww")
  | 'offended' // brow down after a face poke, "hmph"
  | 'grumpy' // woken early with low Energy
  | 'wink'; // one eye shut (owl micro-fidget)

/** Rhubarb / Preston Blair visemes: X rest, A closed (MBP), B teeth (EE), C open (EH), D wide (AA), E round (AO), F pucker (OO). */
export type Viseme = 'X' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
/** Mouth targets a beat can name; lipsync.ts maps each to a talkMouth()/MOUTH shape. */
export type MouthKey = Viseme | 'smile' | 'grin' | 'o' | 'w' | 'yawn' | 'sleep' | 'smirk' | 'aah' | 'wide' | 'chew';

/* ---------- particles (§3.2 layer 3): HTML divs, transform + opacity only ---------- */

/** `drop`: a raindrop (the Garden's rain): falls from under the body, straight, no spin (fx.css `.pet-p[data-kind="drop"]`). */
export type ParticleKind = 'crumb' | 'heart' | 'z' | 'sparkle' | 'note' | 'wisp' | 'tear' | 'drop';
/** Where a burst or gaze anchors on the character (resolved from the model each frame). */
export type Anchor = 'head' | 'eyeL' | 'eyeR' | 'mouth' | 'cheekL' | 'cheekR' | 'belly' | 'body' | 'ground' | 'touch';
export interface ParticleBurst {
  kind: ParticleKind;
  /** count at full tier (lite halves it, max 6; reduced draws one static icon instead) */
  n: number;
  at: Anchor;
}

/* ---------- touch zones (§1.3) ---------- */

export type Zone = 'head' | 'eye' | 'cheek' | 'belly';
export type Side = -1 | 0 | 1;

/* ---------- beats ---------- */

export type HapticKind = keyof typeof haptic;
/** What the character looks at: scene anchors resolved by the loop, or a stage point in px. */
export type LookTarget = 'user' | 'pill' | 'cookie' | 'ball' | 'moon' | 'finger' | 'upSide' | 'away' | Point;
/** Bubble copy: a key the UI's copy table renders, or literal text (souvenir, the agent's own words). */
export type SayKey = 'hi' | 'achoo' | 'hmph' | 'okayOkay' | 'yum' | 'soFull' | 'napFirst' | 'fiveMore' | 'learned' | 'aww';
export type SayLine = SayKey | { text: string };

/** A sinusoid added on one channel: purr tremor, giggle fit, shake jiggle, belly-pat pulses, ear bounce. */
export interface Oscillation {
  channel: Channel;
  /** amplitude in the channel's units */
  amp: number;
  hz: number;
  ms: number;
  /** amplitude falls linearly to 0 over `ms` (default true) */
  decay?: boolean;
}

/** A parabolic hop on `y` under gravity × species/family tuning; landing squashes and hit-stops on its own. */
export interface Hop {
  /** apex height, px (positive) */
  h: number;
  /** landing sy = 1 − land (default 0.12), released on `jelly` */
  land?: number;
}

/**
 * One keyframe of a reaction. At `at` ms after the reaction starts, each channel in `target` retargets on
 * `spring` (velocity kept). The side effects fire at the same moment. Values are relative to the layers
 * under the one-shot (MULTIPLY channels as factors, the rest as offsets).
 */
export interface Beat {
  at: number;
  target: Partial<PoseTargets>;
  spring: SpringPreset;
  /** per-channel spring overrides for this beat */
  springs?: Partial<Record<Channel, SpringPreset>>;
  haptic?: HapticKind;
  particles?: ParticleBurst | ParticleBurst[];
  expr?: PetExpr;
  mouth?: MouthKey;
  say?: SayLine;
  /** thought bubble with that toy's icon */
  thought?: NeedKey;
  look?: LookTarget;
  hop?: Hop;
  osc?: Oscillation | Oscillation[];
  /** freeze body channels this long (impact read); off on lite and reduced */
  hitStop?: number;
  /** a swallow: a bulge travels down the body outline from the cheeks to the base over this many ms (off on reduced) */
  gulp?: number;
  blink?: 'once' | 'double' | 'slow' | 'suppress' | 'allow';
  /** exempt from the ±12 % time / ±15 % amplitude jitter (chomp rhythm) */
  fixed?: boolean;
  /** last beat only: the spring every touched channel releases to neutral on once the beats settle (default `pop`) */
  release?: SpringPreset;
}

/* ---------- reaction events (§2.6 rows, §2.4 ambient beats, §2.7 play, §1.4 talk) ---------- */

export type FeedPhase = 'notice' | 'approach' | 'bite' | 'chomp' | 'swallow' | 'satisfied';
export type CelebrateWhy = 'stage' | 'bond' | 'win';

export type ReactionEvent =
  /* open */
  | { type: 'hello'; firstName?: string }
  | { type: 'welcomeBack'; souvenir: string }
  | { type: 'stageUp'; from: Stage; to: Stage }
  /* idle tiers and moods (periodic events carry `cycle`, re-emitted by the scheduler) */
  | { type: 'fidgetSmall' }
  | { type: 'fidgetLong' }
  | { type: 'ambient'; tone: Mood['tone'] }
  | { type: 'signature'; index: number }
  | { type: 'bored' }
  | { type: 'wants'; need: NeedKey }
  /** touch while droopy: perk fully for 3 s */
  | { type: 'droopy' }
  | { type: 'sad' }
  | { type: 'doze' }
  /* touch */
  | { type: 'poke'; zone: Zone; side: Side; at: Point; hits: number; coolOff: boolean }
  | { type: 'pet'; speed: number; dir: -1 | 1; passes: number }
  | { type: 'tickle' }
  /** escalation in the 4 s window: mid = hits 4–6 (dizzy spin / giggle fit), max = 7+ (sneeze / hmph, then cool-off) */
  | { type: 'overpoke'; hits: number; level: 'mid' | 'max' }
  | { type: 'longPress'; at: Point }
  | { type: 'dragStart'; at: Point }
  | { type: 'drag'; vx: number; vy: number }
  | { type: 'fling'; vx: number; vy: number; thrown: boolean }
  | { type: 'wallHit'; nx: number; v: number }
  | { type: 'land'; v: number }
  | { type: 'shake' }
  /* feed */
  | { type: 'feed'; phase: FeedPhase; dist?: number; chomp?: number }
  | { type: 'tooFull' }
  /* play */
  | { type: 'playStart'; tired: boolean }
  | { type: 'ballNear' }
  | { type: 'bop'; nx: number; ny: number }
  | { type: 'miss'; misses: number }
  | { type: 'playEnd'; bops: number; won: boolean; misses: number }
  /* rest */
  | { type: 'yawn' }
  | { type: 'sleep' }
  | { type: 'dream' }
  | { type: 'sleepPoke' }
  | { type: 'wake'; from: 'sleep' | 'doze'; grumpy: boolean }
  /* talk */
  | { type: 'listen'; source: 'text' | 'mic' }
  | { type: 'typingPause' }
  | { type: 'ack' }
  | { type: 'think'; cycle: number }
  | { type: 'speakStart'; mode: 'text' | 'audio' }
  | { type: 'viseme'; v: Viseme; open: number }
  | { type: 'onset' }
  | { type: 'speakEnd' }
  | { type: 'nod' }
  | { type: 'wave' }
  /* moments */
  | { type: 'celebrate'; why: CelebrateWhy }
  | { type: 'refuse'; why: 'tired' | 'full' };

export type ReactionKind = ReactionEvent['type'];
export type EventOf<K extends ReactionKind> = Extract<ReactionEvent, { type: K }>;

/* ---------- priority (§2.3): a higher class pauses L4 one-shots below it, never L3 or L5 ---------- */

export type PriorityClass = 'drag' | 'eat' | 'touch' | 'talk' | 'play' | 'needs' | 'idle';
/** High → low. */
export const PRIORITY_ORDER: readonly PriorityClass[] = ['drag', 'eat', 'touch', 'talk', 'play', 'needs', 'idle'];

export const EVENT_PRIORITY: Readonly<Record<ReactionKind, PriorityClass>> = {
  hello: 'touch', welcomeBack: 'touch', stageUp: 'touch',
  fidgetSmall: 'idle', fidgetLong: 'idle', signature: 'idle', doze: 'idle',
  ambient: 'needs', bored: 'needs', wants: 'needs', yawn: 'needs', sleep: 'needs', dream: 'needs',
  droopy: 'touch', poke: 'touch', pet: 'touch', tickle: 'touch', overpoke: 'touch', longPress: 'touch', shake: 'touch',
  sleepPoke: 'touch', wake: 'touch', celebrate: 'touch',
  dragStart: 'drag', drag: 'drag', fling: 'drag', wallHit: 'drag', land: 'drag',
  feed: 'eat', tooFull: 'eat', refuse: 'eat',
  playStart: 'play', ballNear: 'play', bop: 'play', miss: 'play', playEnd: 'play',
  listen: 'talk', typingPause: 'talk', ack: 'talk', think: 'talk', speakStart: 'talk', viseme: 'talk', onset: 'talk',
  speakEnd: 'talk', nod: 'talk', wave: 'talk', sad: 'talk',
};

/* ---------- reactions ---------- */

/**
 * Variant memory (§2.1: three variants, never the same twice in a row). The loop owns it; a reaction
 * calls pick(kind, n) to get an index in [0, n) that differs from last(kind), and pick records it.
 */
export interface VariantHistory {
  last(kind: ReactionKind): number | undefined;
  pick(kind: ReactionKind, n: number): number;
}

export interface ReactionCtx {
  /** seeded, so frame sheets and property tests replay exactly */
  rng: Rng;
  species: Species;
  family: Family;
  stage: Stage;
  mood: Mood;
  tier: Tier;
  variantHistory: VariantHistory;
}

/**
 * A pure reaction: no DOM, no timers, no Math.random. The loop applies jitter (unless `fixed`), species
 * scaling, the volume rule and tier rules (reduced: translation, hops, wobbles and oscillations become
 * 150 ms crossfades; lite: no hit-stop), then plays the beats.
 */
export type Reaction<E extends ReactionEvent = ReactionEvent> = (event: E, ctx: ReactionCtx) => Beat[];
/** reactions/index.ts exports one of these: every event kind has exactly one reaction. */
export type ReactionTable = { [K in ReactionKind]: Reaction<EventOf<K>> };

/* ---------- species and family tuning (§2.8) ---------- */

export interface SpeciesTuning {
  /** volume exponent: sx = sy^(−α) (firm vinyl 0.6, cloud 0.8) */
  alpha: number;
  /** multipliers on breath peak, hop height, gravity, landing squash, jelly bounce */
  breath: number;
  hop: number;
  gravity: number;
  land: number;
  jelly: number;
  /** follower for the ear groups (null: no ears) and its overrides; `sleepEar` while asleep or droopy */
  ear: FollowerPreset | null;
  earParams?: Partial<FollowerParams>;
  sleepEar?: FollowerPreset;
  /** max head tilt (owl 20) and the listening tilt (dog 10) */
  tiltMax: number;
  listenTilt: number;
  /** blink close / open ms (owl 90 / 140; default 60 / 90) */
  blink?: { close: number; open: number };
  /**
   * Felt weight (1 the vinyl baseline): heavier bodies settle slower and lower after an impact, lighter ones flick
   * faster (scales the settle springs' duration by weight^0.5 and the flick springs' by weight^0.25).
   */
  weight?: number;
}

export interface FamilyTuning {
  /** overrides the species α (tower 0.5) */
  alpha?: number;
  /** multipliers on sway amplitude, sway period, hop height, gravity */
  sway: number;
  swayPeriod: number;
  hop: number;
  gravity: number;
  /** extra idle lean toward the silhouette's side (deg; drift +1.5) */
  leanBias: number;
  /** multiplier on the species weight (tower a little heavier, drift lighter) */
  weight?: number;
}

/* ---------- motion vocabulary beyond the reaction table (rooms, growth, settle) ---------- */

/** The rooms (design §4): one engine and one character across them; the room swaps the idle flavour. */
export type Room = 'home' | 'play' | 'garden' | 'closet' | 'bedroom' | 'book';
/** Left-to-right room order in English (design §4); a move to a higher index slides the backdrop left. */
export const ROOM_ORDER: readonly Room[] = ['home', 'play', 'garden', 'closet', 'bedroom', 'book'];

/**
 * Engine-owned motions that are not reaction events (the UI calls them through named methods, never fire()):
 * room transitions, per-room reactions (design §10.4, final names), lighting a growth moment (§10.3), the settle
 * float (§3.1), the room idles and the anticipated happy hop. Played on the same Player as reactions.
 */
export type RoomReaction =
  /* Play */ | 'catch' | 'nearMiss' | 'roundEnd'
  /* Garden */ | 'rain'
  /* Closet */ | 'admire'
  /* Bedroom */ | 'storyNod'
  /* Life Book */ | 'pageFlip' | 'ownDrawing';
/** Engine motions: `roomArrive` the room's hello after a transition, `breathe` one guided-breath cycle, `attend` the
 *  hands-free listening hold coming on, `breath` the small breath between queued sentences. */
export type MotionKind = 'roomLeave' | 'roomArrive' | 'roomIdle' | 'growthLit' | 'settle' | 'hopIdle' | 'breathe' | 'attend' | 'breath' | RoomReaction;
/** Options for a room reaction: a Play round's result, and Zen (one preset softer, nothing flashes, no round-end flourish). */
export interface RoomReactOpts { won?: boolean; zen?: boolean }
/** What the player plays: a reaction kind or an engine motion. */
export type PlayKind = ReactionKind | MotionKind;


/** Discrete motion cues for the UI (beyond EngineCue): subscribe with engine.onMotion(fn). */
export type MotionCue =
  /** about six minutes of continuous play: the pet floats content (the UI may show the T9 stopping cue) */
  | { type: 'settle' }
  /** mid room transition: swap the backdrop and the dock now (the character is at the top of its lean) */
  | { type: 'roomSwap'; room: Room }
  /**
   * the growth moment's detail should fade in now (the glow is at its peak): `detail` (and `id` for keepsakes and
   * the seasonal one) names it, `shown` false when this stage cannot wear it yet (it is kept for later)
   */
  | { type: 'litPeak'; detail?: 'glint' | 'pin' | 'charm' | 'keepsake' | 'seasonal'; id?: string; shown?: boolean }
  /** the details the character shows changed (after setDetails, or a lit detail): what this stage can wear */
  | { type: 'details'; details: { glint: boolean; pin: boolean; charm: boolean; keepsakes: string[]; seasonal: string | null } }
  /** the frame-budget guard stepped the tier down (slow device) */
  | { type: 'degraded'; tier: Tier; reason: 'frames' | 'script' };
