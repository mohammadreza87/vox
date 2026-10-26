/**
 * Pet check-ins (design PET_CARE_GAME_DESIGN_2026_10_26 §5): the shared vocabulary of the proactive DM a pet may send
 * from its agent's own bot, under its own optional purpose `optional.pet_checkins` (PRIV-029). Isomorphic and pure: the
 * server planner, store and routes use it, and the page imports the types for the P1 sheet and "choose moments".
 *
 * Every stored value is content-free: catalogue ids, opaque random references, a keyed person hash, local days, times,
 * counts and flags. The DM text comes only from the generated templates (checkin-copy.ts); no model ever writes one.
 * Consent and moment choices are per agent (each pet asks for itself); the pause, the unopened streak, the sound choice
 * and the one-per-festival rule are per person, across every agent.
 */

import type { CheckinCopyKey, CheckinLang } from './checkin-copy';
import type { SeasonId } from './play';

export type { CheckinCopyKey, CheckinLang } from './checkin-copy';

export const CHECKIN_PURPOSE = 'optional.pet_checkins' as const;
export const CHECKIN_POLICY_VERSION = 'pet-checkins-v1' as const;

/* ---------- moment types (§5.2) ---------- */

export type CheckinMomentType = 'growingUp' | 'seasons' | 'garden' | 'hellos' | 'careNudges';
export const CHECKIN_MOMENT_TYPES: readonly CheckinMomentType[] = ['growingUp', 'seasons', 'garden', 'hellos', 'careNudges'];
export type CheckinTypes = Record<CheckinMomentType, boolean>;
/** Once check-ins are on: growing up, seasons and garden on; hellos and care nudges off until chosen. */
export const CHECKIN_TYPE_DEFAULTS: Readonly<CheckinTypes> = Object.freeze({ growingUp: true, seasons: true, garden: true, hellos: false, careNudges: false });
/** The reason line ("Why this?") and the category name of each type (keys file §Check-ins). */
export const CHECKIN_TYPE_COPY: Readonly<Record<CheckinMomentType, { why: CheckinCopyKey; category: CheckinCopyKey }>> = Object.freeze({
  growingUp: { why: 'ci.why.growing', category: 'ci.cat.growing' },
  seasons: { why: 'ci.why.seasons', category: 'ci.cat.seasons' },
  garden: { why: 'ci.why.garden', category: 'ci.cat.garden' },
  hellos: { why: 'ci.why.hellos', category: 'ci.cat.hellos' },
  careNudges: { why: 'ci.why.care', category: 'ci.cat.care' },
});

/* ---------- the catalogue (§5.3) ---------- */

export type CheckinMomentId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10' | 'C11';
export const CHECKIN_MOMENT_IDS: readonly CheckinMomentId[] = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'];

export interface CheckinMoment {
  type: CheckinMomentType;
  template: CheckinCopyKey;
  /** the local fallback (§8.2): stage-up > formed > season > bloom > milestone > care nudge > hello; lower first */
  priority: number;
  /** the festival a seasonal moment belongs to (one message per festival per person, from one agent) */
  season?: SeasonId;
  /** what Decisions reads about the option: observable and content-free (§8.1 "distinct descriptions") */
  description: string;
}

/**
 * There is no hunger moment, on purpose (§5.3): a hungry-pet push is the purest form of the guilt loop. C11 needs a
 * mid-game Guess record the server does not keep yet, so the planner never finds it eligible.
 */
export const CHECKIN_MOMENTS: Readonly<Record<CheckinMomentId, CheckinMoment>> = Object.freeze({
  C1: { type: 'growingUp', template: 'ci.C1.firstMorning', priority: 0, description: 'The first morning after the first meeting, and the pet has grown since the person last saw it.' },
  C2: { type: 'growingUp', template: 'ci.C2.stageUp', priority: 1, description: 'The pet grew to a new stage that the person has not seen yet.' },
  C3: { type: 'growingUp', template: 'ci.C3.formed', priority: 2, description: 'The last day of the forming week: the pet is fully formed and the person has not seen it.' },
  C7: { type: 'seasons', template: 'ci.C7.yalda', priority: 3, season: 'yalda', description: 'The evening of Yalda, the longest night.' },
  C8: { type: 'seasons', template: 'ci.C8.suri', priority: 3, season: 'suri', description: 'The Tuesday evening of Chaharshanbe Suri.' },
  C9: { type: 'seasons', template: 'ci.C9.nowruz', priority: 3, season: 'nowruz', description: 'The first morning of Nowruz.' },
  C5: { type: 'garden', template: 'ci.C5.bloom', priority: 4, description: 'The seed the person planted bloomed and they have not seen it yet.' },
  C6: { type: 'growingUp', template: 'ci.C6.newMove', priority: 5, description: 'A bond milestone the person has not been shown yet: the pet has a new little move.' },
  C10: { type: 'careNudges', template: 'ci.C10.sleepy', priority: 6, description: 'An early evening when the pet is getting sleepy, for someone who asked to hear about it.' },
  C4: { type: 'hellos', template: 'ci.C4.hello', priority: 7, description: 'A light hello after some days without a visit (at most twice per absence).' },
  C11: { type: 'hellos', template: 'ci.C11.guess', priority: 8, description: 'A guessing game the person left mid-way yesterday.' },
});

/* ---------- hard rules (§5.5) ---------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const CHECKIN_LIMITS = Object.freeze({
  perAgentPerDay: 1,
  perAgentPerWeek: 3,
  weekMs: 7 * DAY,
  /** no open within this long: the send counts as unopened (§8.5 `unopened`) */
  unopenedAfterMs: 48 * HOUR,
  /** two unopened in a row: the next eligible moment waits this long after the last send */
  coolingMs: 7 * DAY,
  coolingAfter: 2,
  /** three unopened in a row: the whole purpose pauses until a tap */
  pauseAfter: 3,
  /** the stricter union of the pet's 22-08 and the notification default 21-08 (open decision 8) */
  quietStart: 21,
  quietEnd: 8,
  /** at most two Hellos per absence: day 3 and day 10 */
  helloDays: [3, 10] as readonly number[],
  /** an open within this long after a send marks it opened (the page opened that agent's pet) */
  openWindowMs: 48 * HOUR,
  /** `?ci=` replays its moment only this long after the send */
  replayMs: 7 * DAY,
  /** sent rows kept per person (oldest go first); enough for the week caps and the streak */
  sentRows: 60,
});

/* ---------- the stored record ---------- */

/** The consent evidence of one P1 "Yes" (shaped like the circle ledger's CircleEvidence). */
export interface CheckinConsentEvidence {
  /** a client id per tap (8-40 of [A-Za-z0-9_-]): a double tap is one decision */
  eventId: string;
  /** which sheet: P1 (`perm.P1.*`) or its forming-week variant (`perm.P1.forming.*`) */
  noticeId: 'perm.P1' | 'perm.P1.forming';
  noticeVersion: typeof CHECKIN_POLICY_VERSION;
  /** sha256 of the exact sheet text and button labels shown, in its locale (server-computed from checkin-copy.ts) */
  copyHash: string;
  locale: CheckinLang;
  presentedAt: number;
  /** always after presentedAt */
  decidedAt: number;
  surface: 'mini_app';
  affirmative: true;
}

export interface CheckinConsent {
  purpose: typeof CHECKIN_PURPOSE;
  state: 'granted' | 'withdrawn';
  /** bumps on every grant and withdrawal */
  revision: number;
  effectiveAt: number;
  evidence: CheckinConsentEvidence;
  withdrawnAt?: number;
  withdrawnVia?: 'settings' | 'stop_all';
}

/** One agent's check-ins for one person. */
export interface PetCheckinAgent {
  enabled: boolean;
  types: CheckinTypes;
  consent?: CheckinConsent;
  lastSentAt?: number;
  /** send times inside the rolling week (sentThisWeek is its length) */
  week: number[];
}

export type CheckinSentState = 'reserved' | 'accepted' | 'unknown' | 'failed' | 'cancelled';

/** A content-free sent row: for the caps, the pause rules and the reward signals (§8.5). Never any text. */
export interface PetCheckinSent {
  /** opaque random reference: the Open button's `?ci=` and the callback buttons */
  ref: string;
  agentId: string;
  moment: CheckinMomentId;
  /** which occurrence of the moment (a stage, a festival year, an absence): each is sent at most once per agent */
  occurrence: string;
  /** the person's local day of the send (the per-agent daily cap and the per-run idempotency key) */
  day: string;
  /** keyed hash of the person (HMAC with the Studio secret): rows can be joined as labels without a Telegram id */
  personHash: string;
  at: number;
  state: CheckinSentState;
  lang: CheckinLang;
  variant: number;
  openedAt?: number;
  openedVia?: 'ref' | 'app';
  whyAt?: number;
  stoppedAt?: number;
  /** which ranker picked it: the local ranker or a calibrated Decisions answer */
  by?: 'local' | 'decisions';
}

/** `studio_pet_checkins/{userId}`: one per person, across agents. */
export interface PetCheckinRecord {
  v: 1;
  userId: number;
  createdAt: number;
  updatedAt: number;
  /** the language the DM is written in: the person's last choice on the pet page */
  lang: CheckinLang;
  /** the last valid IANA zone the pet page reported; absent = unknown (inbox-only, nothing is sent) */
  tz?: string;
  /** "with sound" (default silent) */
  sound: boolean;
  pausedAt?: number;
  /** the paused note was shown for this pause (once) */
  pausedNoteAt?: number;
  /** the last "Yes, send them" after a pause: the unopened streak counts only sends after it */
  resumedAt?: number;
  unopenedStreak: number;
  agents: Record<string, PetCheckinAgent>;
  /** festival → the Persian year a check-in for it was sent, from any agent */
  seasons: Partial<Record<SeasonId, number>>;
  sent: PetCheckinSent[];
}

export function newCheckinRecord(userId: number, now: number, lang: CheckinLang = 'en'): PetCheckinRecord {
  return { v: 1, userId, createdAt: now, updatedAt: now, lang, sound: false, unopenedStreak: 0, agents: {}, seasons: {}, sent: [] };
}

export const newCheckinAgent = (): PetCheckinAgent => ({ enabled: false, types: { ...CHECKIN_TYPE_DEFAULTS }, week: [] });

/** A sent row that counts toward the caps: everything except a refused or cancelled send. */
export const countsTowardCaps = (row: PetCheckinSent) => row.state !== 'failed' && row.state !== 'cancelled';

/**
 * Trailing unopened sends, newest first, across agents (§5.5): a send unopened after 48 h counts, an opened one ends
 * the run, a send still inside its 48 h is skipped. Refused and cancelled sends never count, nor do sends before
 * `since` (the person's "Yes, send them" after a pause starts a fresh count).
 */
export function unopenedStreak(sent: readonly PetCheckinSent[], now: number, since = 0): number {
  let streak = 0;
  for (const row of [...sent].filter((s) => countsTowardCaps(s) && s.at > since).sort((a, b) => b.at - a.at)) {
    if (row.openedAt !== undefined) break;
    if (now - row.at < CHECKIN_LIMITS.unopenedAfterMs) continue;
    streak++;
  }
  return streak;
}

/* ---------- HTTP: GET/POST /api/studio/pet/:agentId/checkins ---------- */

/** What GET …/checkins and every POST answer, for this person and this agent. */
export interface PetCheckinsView {
  /** check-ins from this agent are on (`optional.pet_checkins` granted for it) */
  enabled: boolean;
  /** the moment types; the §5.2 defaults until the person chose (meaningful once enabled) */
  types: CheckinTypes;
  /** with sound (default silent); one choice for every agent */
  sound: boolean;
  /** three went unopened: every check-in waits for a tap on "Yes, send them" (`{ op: 'resume' }`) */
  pausedAt?: number;
  /** show the paused note now; true once per pause (the view and GET mark it shown) */
  pausedNote?: true;
  /** the pet page has not reported a valid zone: nothing is sent to Telegram (inbox-only) */
  inboxOnly?: true;
  /** this agent's sends in the rolling week (0-3) */
  sentThisWeek: number;
  lastSentAt?: number;
  /** STUDIO_PET_CHECKINS is on: false means nothing is ever sent, even with consent */
  live: boolean;
}

/**
 * POST …/checkins (JSON, members only, the strict 1 h initData window):
 *  - `{ enabled: true, types?, sound?, consent }`: the P1 "Yes" (or "Choose moments"). `consent` is required when check-ins
 *    were off for this agent: it is the evidence (§6.1 rule 6, PRIV-029). `types` overrides the defaults.
 *  - `{ enabled: true, types?, sound? }` while already on: change moment types or sound.
 *  - `{ enabled: false }`: off for this agent (withdraws the purpose; queued sends are cancelled).
 *  - `{ op: 'stop', type? }`: stop one moment type, or all of this agent's check-ins without `type` (PRIV-031).
 *  - `{ op: 'resume' }`: the paused note's "Yes, send them"; `{ op: 'keepPaused' }`: "Keep paused".
 */
export type PetCheckinsRequest =
  | { enabled: true; types?: Partial<CheckinTypes>; sound?: boolean; consent?: PetCheckinsConsentInput }
  | { enabled: false }
  | { op: 'stop'; type?: CheckinMomentType }
  | { op: 'resume' }
  | { op: 'keepPaused' };

/** The P1 sheet the person saw and tapped: the server hashes the exact copy for that variant and language. */
export interface PetCheckinsConsentInput {
  variant: 'default' | 'forming';
  lang: CheckinLang;
  /** fresh per tap, 8-40 of [A-Za-z0-9_-] */
  eventId: string;
  /** when the sheet appeared (epoch ms, before now) */
  presentedAt: number;
}

/**
 * `PetView.checkin`: the page opened from a check-in's Open button (`?ci=<ref>`): replay this moment instead of the hello.
 * `momentId` is always a CheckinMomentId (`C1`…`C11`) and `type` is always present from this server; both are typed
 * loosely so the page's own optional draft of this field stays assignable.
 */
export interface PetCheckinReplay { ref: string; momentId: CheckinMomentId | (string & {}); type?: CheckinMomentType }

/** The Open button's query parameter and its shape (an opaque random reference, never an id or a time). */
export const CHECKIN_REF_PARAM = 'ci';
export const CHECKIN_REF = /^[A-Za-z0-9_-]{16,32}$/;
