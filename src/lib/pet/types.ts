/**
 * Vox Pet: the shared vocabulary of the care page (brief §1.2, §3.7, §3.8). Isomorphic and pure:
 * the server (care.ts, pet-store.ts, pet-http.ts) and the client (engine, UI, optimistic care) import
 * the same types and thresholds. Decay rates and caps live in care.ts; only the numbers both sides
 * read (floors, mood bands, quiet hours) live here.
 */

import type { CharacterLook, Stage } from '../studio/types';

export type { CharacterLook, Stage };

/* ---------- needs ---------- */

/** The three visible needs (each has a toy and a ring). Bond is hidden and never decays. */
export type NeedKey = 'tummy' | 'joy' | 'energy';
export const NEED_KEYS: readonly NeedKey[] = ['tummy', 'joy', 'energy'];

/** Lowest value a need can reach (§1.2): the worst state is sleepy-droopy, never empty. */
export const NEED_FLOOR: Readonly<Record<NeedKey, number>> = { tummy: 25, joy: 30, energy: 20 };
export const NEED_MAX = 100;

/** Mood bands over the lowest need (§1.2): ≥ 55 content, 30–54 wants, < 30 droopy; all > 80 happy. */
export const MOOD_BAND = { wantsBelow: 55, droopyBelow: 30, happyAbove: 80 } as const;
/** Tummy at or over this answers a feed with the "so full" reaction (no penalty). */
export const FULL_AT = 90;
/** Energy under this turns a play into the half-hearted "Nap first?" bounce. */
export const TIRED_BELOW = 25;

/* ---------- care state (server is the source of truth) ---------- */

/** Fixed 22:00–08:00 in v1 (adjustable in v1.1); stored so a later change needs no migration. */
export const QUIET_HOURS = { start: 22, end: 8 } as const;
/** Away longer than this: every need becomes max(current, WELCOME_FLOOR) and welcome-back plays. */
export const WELCOME_AWAY_MS = 24 * 60 * 60 * 1000;
export const WELCOME_FLOOR = 60;
/** Bond milestones: a heart burst and one new signature fidget every 25 (six in v1). */
export const BOND_MILESTONE = 25;

/** One user's care state for one agent: `studio_pets/{agentId}_{userId}`. All times are epoch ms. */
export interface PetCare {
  v: 1;
  agentId: string;
  userId: number;
  tummy: number;
  joy: number;
  energy: number;
  /** hidden, only goes up */
  bond: number;
  /** the Bond the user was last shown a milestone for (absent on older docs = 0); milestones report once */
  seenBond?: number;
  asleep: boolean;
  sleptAt?: number;
  /** decay is applied lazily from here on every read and action */
  lastUpdatedAt: number;
  lastSeenAt: number;
  firstMetAt: number;
  /** IANA zone from the client (Intl.DateTimeFormat().resolvedOptions().timeZone), refreshed on each request */
  tz: string;
  quietStart: typeof QUIET_HOURS.start;
  quietEnd: typeof QUIET_HOURS.end;
  /** the stage the user last saw: a higher current stage plays the stage-up celebration once */
  lastSeenStage: Stage;
  /** rolling caps: hour window (pet/tickle Joy, talk Joy) and day window (Bond from care) */
  caps: { hourStart: number; petJoy: number; talkJoy: number; careBond: number; dayStart: number };
}

/** Care actions the page can post. pet/tickle are batched taps (`n`), the rest are single actions. */
export type PetAction = 'feed' | 'play' | 'sleep' | 'wake' | 'pet' | 'tickle';
export const PET_ACTIONS: readonly PetAction[] = ['feed', 'play', 'sleep', 'wake', 'pet', 'tickle'];

/**
 * Why an action did less than asked. Never a block: the page always plays a cute reaction.
 * full: Tummy ≥ FULL_AT · tired: Energy < TIRED_BELOW (play) · capped: hour/day cap reached ·
 * noop: already asleep (sleep) or awake (wake).
 */
export type PetGuard = 'full' | 'tired' | 'capped' | 'noop';

/* ---------- mood ---------- */

export type MoodLevel = 'happy' | 'content' | 'wants' | 'droopy';
/** The idle tone the motion bible tunes breath, lids, sway and ambient beats by (§2.4 columns). */
export type MoodTone = 'content' | 'hungry' | 'tired' | 'bored' | 'happy';

/** mood(care) in care.ts: the level from the lowest need, and which need that is. */
export interface Mood {
  level: MoodLevel;
  /** the lowest need (ties: tummy > energy > joy, the order a carer would fix them) */
  lowest: NeedKey;
  /** happy when level is happy; content when content; else hungry/tired/bored from `lowest` */
  tone: MoodTone;
  asleep: boolean;
}

/* ---------- roles ---------- */

/**
 * owner/member: canUseAgent passes (full page). guest: a public agent's non-member (look, touch and
 * care; talk opens the DM). A stranger on a private agent gets 403 `pet_private`, never a role.
 */
export type PetRole = 'owner' | 'member' | 'guest';

/* ---------- HTTP (brief §3.8) ---------- */

/** Every request carries the user's zone in this header (GET has no body). */
export const PET_TZ_HEADER = 'x-pet-tz';
/** `/api/studio/pet/:agentId` and `/export` (GET), `/care`, `/talk`, `/talk-voice`, `/forget` (POST). */
export const PET_API_BASE = '/api/studio/pet';
/** Page route: `/studio/pet/:agentId`. The menu button and the /start web_app button point here. */
export const PET_PAGE_BASE = '/studio/pet';
/** The bubble shows this many characters before "more" (§1.4). */
export const BUBBLE_MAX_CHARS = 220;

/** GET /api/studio/pet/:id: the trimmed agent view (no access lists, no blocked ids). */
export interface PetView {
  agentId: string;
  /** the agent's display name ("Talk to {name}") */
  name: string;
  look: CharacterLook;
  /** current stage, stageFor(formingDay, status) */
  stage: Stage;
  formingDay: number | null;
  /** for the guest "Chat in Telegram" link: t.me/{botUsername} */
  botUsername: string;
  /** the agent has a voice: hold-to-talk replies may come back as audio */
  voice: boolean;
  /** the server can hear (a transcription provider is configured): the pill shows the mic */
  listen: boolean;
  role: PetRole;
  /** decay applied up to `now`; welcome-back floors already applied when `welcome` is set */
  care: PetCare;
  /** server clock (ms): the client decays its optimistic copy from here, never from Date.now() alone */
  now: number;
  /** away > 24 h: the souvenir line (agent-generated from memory, or a canned fallback) */
  welcome?: { souvenir: string; awayMs: number };
  /** the stage grew since the last visit; the server has already saved lastSeenStage = stage */
  stageUp?: { from: Stage; to: Stage };
  /** a Bond milestone was crossed since the last visit (0-based index into the six signature fidgets) */
  bondMilestone?: number;
}

/** POST /care. `tz` rides in PET_TZ_HEADER. */
export interface CareRequest {
  action: PetAction;
  /** pet/tickle: taps since the last flush (the client flushes every 2 s), 1..50 */
  n?: number;
}
export interface CareResponse {
  care: PetCare;
  now: number;
  guard?: PetGuard;
  /** this action crossed a Bond milestone */
  bondMilestone?: number;
}

/** POST /talk. History is the DM's `private-${userId}` chat; the client never sends history. */
export interface TalkRequest { text: string }
export interface TalkResponse {
  reply: string;
  turnId?: string;
  /** Joy/Bond after the server applied the talk caps */
  care?: PetCare;
  /** the user said goodbye: play one wave and close the talk */
  goodbye?: boolean;
  /** this exchange crossed a Bond milestone */
  bondMilestone?: number;
}

/** POST /talk-voice (multipart: `audio` Blob). Audio is base64 speech as callTurn returns it. */
export interface TalkVoiceResponse {
  transcript: string;
  reply: string;
  audio?: string;
  turnId?: string;
  care?: PetCare;
  goodbye?: boolean;
  bondMilestone?: number;
}

/**
 * GET /export: this person's care for every agent (the self-service copy of what the rights export
 * carries). POST /forget: deletes it all; the next visit meets the pet anew. Anyone whose initData the
 * agent's bot signed may call both, whatever their role, so guests have their own rights path.
 */
export interface PetExportResponse { petCare: PetCare[] }
export interface PetForgetResponse { erased: number }

export type PetErrorCode =
  | 'authentication_required' // initData missing, stale, or signed by another bot
  | 'pet_private' // private agent, caller cannot use it (body is PetPrivateView)
  | 'pet_unavailable' // agent missing, not active, or no bot token
  | 'guest_talk' // guests talk in the DM
  | 'origin_denied'
  | 'json_required'
  | 'invalid_request'
  | 'rate_limited'
  | 'conversation_failed';

export interface PetErrorBody { error: PetErrorCode; message?: string }
/** 403 body for a private agent: enough to draw the character asleep on the "This one's private" screen. */
export interface PetPrivateView extends PetErrorBody { error: 'pet_private'; name: string; look: CharacterLook; stage: Stage }
