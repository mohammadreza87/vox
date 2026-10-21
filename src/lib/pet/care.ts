/**
 * Vox Pet care rules (brief §1.2, §1.6): three needs with floors, lazy decay from timestamps, quiet
 * hours in the user's zone, welcome-back floors, hourly/daily caps and the hidden Bond. Pure and
 * isomorphic (no Node imports): the server applies it on every read and action, the page applies the
 * same code for optimistic care and eases to the server's answer.
 *
 * Humane invariants (test-enforced): no code path takes a need below its floor or above 100, nothing
 * here can make the pet sick or dead, and a refused action is an outcome (`guard`), never an error.
 */

import {
  BOND_MILESTONE, FULL_AT, MOOD_BAND, NEED_FLOOR, NEED_KEYS, NEED_MAX, QUIET_HOURS, TIRED_BELOW, WELCOME_AWAY_MS, WELCOME_FLOOR,
  type Mood, type MoodTone, type NeedKey, type PetAction, type PetCare, type PetGuard, type Stage,
} from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Decay walks quiet-hour segments back this far at most; older absences end at the floors anyway. */
const MAX_SPAN = 60 * DAY;

/** Points per hour while awake outside quiet hours (§1.2). */
export const DECAY_PER_HOUR: Readonly<Record<NeedKey, number>> = { tummy: 5, joy: 4, energy: 3 };

/** What each action gives, and the caps on it (§1.2). */
export const CARE = {
  feedTummy: 35,
  playJoy: 25,
  playEnergy: 8,
  petJoyPerTap: 2,
  petJoyPerHour: 12,
  talkJoy: 6,
  talkJoyPerHour: 30,
  /** a nap refills 1 point a minute; overnight (quiet hours) refills 12 an hour */
  sleepEnergyPerHour: 60,
  quietEnergyPerHour: 12,
  careBondPerDay: 5,
  /** taps one pet/tickle flush may carry */
  maxTaps: 50,
} as const;

/** A first meeting starts content, not needy. */
export const NEW_PET: Readonly<Record<NeedKey, number>> = { tummy: 75, joy: 80, energy: 85 };

/** The six signature fidgets a Bond milestone unlocks (index 0–5). */
const SIGNATURE_FIDGETS = 6;

/** An action's outcome: the new care, why it did less (never a block), and a crossed Bond milestone. */
export interface CareResult { care: PetCare; guard?: PetGuard; bondMilestone?: number }

/** GET (the "open" event): what the page plays once. */
export interface Opened {
  care: PetCare;
  welcome?: { awayMs: number };
  stageUp?: { from: Stage; to: Stage };
  bondMilestone?: number;
}

/* ---------- time zones ---------- */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(tz, f);
  }
  return f;
}

/** The client's IANA zone if the runtime knows it, else UTC. Never throws. */
export function safeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return 'UTC';
  try { formatter(tz); return tz; } catch { return 'UTC'; }
}

/** Wall-clock parts of an instant in a zone. */
function wallClock(at: number, tz: string) {
  const parts = formatter(tz).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** Zone offset at an instant: local wall time read as UTC, minus the instant. */
function offsetAt(at: number, tz: string): number {
  const w = wallClock(at, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(at / 1000) * 1000;
}

const inQuiet = (hour: number, start: number, end: number) => start > end ? hour >= start || hour < end : hour >= start && hour < end;

/** Is this instant inside quiet hours in `tz`? Wraps midnight when start > end (22 → 8). */
export function isQuiet(at: number, tz: string, start: number = QUIET_HOURS.start, end: number = QUIET_HOURS.end): boolean {
  return inQuiet(wallClock(at, tz).h, start, end);
}

/** Quiet hours now, in the care's own zone. */
export function quietHours(care: PetCare, now: number): boolean {
  return isQuiet(now, care.tz, care.quietStart, care.quietEnd);
}

/**
 * The next instant quiet hours start or end after `at`. The local wall time is turned back into an
 * instant with the offset at that time, so DST days are 23 or 25 hours long, as the user lives them.
 */
function nextBoundary(at: number, tz: string, start: number, end: number): number {
  const w = wallClock(at, tz);
  const hour = inQuiet(w.h, start, end) ? end : start;
  const wall = Date.UTC(w.y, w.mo - 1, w.d + (w.h < hour ? 0 : 1), hour);
  const instant = wall - offsetAt(wall - offsetAt(at, tz), tz);
  // A wall time inside a DST gap lands up to an hour off; never stall.
  return Math.max(instant, at + 60_000);
}

/** Visits [from, to) as segments that are wholly inside or outside quiet hours. */
function eachSegment(from: number, to: number, tz: string, start: number, end: number, visit: (hours: number, quiet: boolean) => void) {
  let t = Math.max(from, to - MAX_SPAN);
  while (t < to) {
    const next = Math.min(to, nextBoundary(t, tz, start, end));
    visit((next - t) / HOUR, isQuiet(t, tz, start, end));
    t = next;
  }
}

/* ---------- needs ---------- */

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Every need inside [floor, 100] (a non-number becomes the floor). Mutates and returns `care`. */
export function clampNeeds(care: PetCare): PetCare {
  for (const key of NEED_KEYS) {
    const v = care[key];
    care[key] = round2(Math.min(NEED_MAX, Math.max(NEED_FLOOR[key], Number.isFinite(v) ? v : NEED_FLOOR[key])));
  }
  return care;
}

/** A first meeting. `lastSeenStage` is the current stage, so the first open never plays a stage-up. */
export function newCare(agentId: string, userId: number, now: number, tz: string, stage: Stage): PetCare {
  return {
    v: 1, agentId, userId, ...NEW_PET, bond: 0, seenBond: 0, asleep: false,
    lastUpdatedAt: now, lastSeenAt: now, firstMetAt: now, tz: safeZone(tz),
    quietStart: QUIET_HOURS.start, quietEnd: QUIET_HOURS.end, lastSeenStage: stage,
    caps: { hourStart: now, petJoy: 0, talkJoy: 0, careBond: 0, dayStart: now },
  };
}

function copy(care: PetCare): PetCare {
  return { ...care, caps: { ...care.caps } };
}

/**
 * Restart the hour and day windows once they have passed. A clock a little behind a window's start (a
 * slow request saving after a newer one opened the window) keeps the caps, so it can never refill
 * them; only a window more than its own length in the future (a reset or skewed clock) restarts.
 */
function rollCaps(care: PetCare, now: number): PetCare {
  const age = now - care.caps.hourStart;
  if (age >= HOUR || age < -HOUR) care.caps = { ...care.caps, hourStart: now, petJoy: 0, talkJoy: 0 };
  const dayAge = now - care.caps.dayStart;
  if (dayAge >= DAY || dayAge < -DAY) care.caps = { ...care.caps, dayStart: now, careBond: 0 };
  return care;
}

/**
 * Decay up to `now`, lazily from `lastUpdatedAt` (§1.2): awake outside quiet hours every need
 * drops; in quiet hours nothing drops and Energy refills 12/h; a nap refills Energy 1/min.
 * `tz` (refreshed from each request) becomes the care's zone. A clock behind `lastUpdatedAt` is a no-op.
 */
export function decay(care: PetCare, now: number, tz: string = care.tz): PetCare {
  const next = rollCaps({ ...copy(care), tz: safeZone(tz) }, now);
  eachSegment(care.lastUpdatedAt, now, next.tz, next.quietStart, next.quietEnd, (hours, quiet) => {
    if (quiet) next.energy += CARE.quietEnergyPerHour * hours;
    else if (next.asleep) next.energy += CARE.sleepEnergyPerHour * hours;
    else for (const key of NEED_KEYS) next[key] -= DECAY_PER_HOUR[key] * hours;
    clampNeeds(next);
  });
  next.lastUpdatedAt = Math.max(care.lastUpdatedAt, now);
  return clampNeeds(next);
}

/** Bond from care: +1 per action, at most CARE.careBondPerDay a day. */
function careBond(care: PetCare) {
  if (care.caps.careBond >= CARE.careBondPerDay) return;
  care.bond += 1;
  care.caps.careBond += 1;
}

/** A Bond milestone the user hasn't been shown yet (0-based, the six fidgets); marks it seen. */
function unseenMilestone(care: PetCare): number | undefined {
  const reached = Math.floor(care.bond / BOND_MILESTONE);
  if (reached <= Math.floor((care.seenBond ?? 0) / BOND_MILESTONE)) return undefined;
  care.seenBond = care.bond;
  return Math.min(reached, SIGNATURE_FIDGETS) - 1;
}

function result(care: PetCare, guard?: PetGuard): CareResult {
  const bondMilestone = unseenMilestone(clampNeeds(care));
  return { care, ...(guard ? { guard } : {}), ...(bondMilestone === undefined ? {} : { bondMilestone }) };
}

function wake(care: PetCare) {
  care.asleep = false;
  delete care.sleptAt;
}

/**
 * One care action on already-decayed care. Never throws and never blocks: an action that can't do
 * its full effect returns a `guard` and the page plays the matching cute reaction.
 * feed: +35 Tummy (≥ 90: `full`, no change) · play: +25 Joy, −8 Energy (Energy < 25: `tired`, no
 * change) · sleep/wake (`noop` when already so) · pet/tickle: +2 Joy per tap, ≤ +12 an hour (`capped`).
 * Feeding or playing wakes a sleeping pet; taps don't.
 */
export function apply(care: PetCare, action: PetAction, now: number, n?: number): CareResult {
  const next = rollCaps(copy(care), now);
  switch (action) {
    case 'feed':
      if (next.tummy >= FULL_AT) return result(next, 'full');
      wake(next);
      next.tummy += CARE.feedTummy;
      careBond(next);
      return result(next);
    case 'play':
      if (next.energy < TIRED_BELOW) return result(next, 'tired');
      wake(next);
      next.joy += CARE.playJoy;
      next.energy -= CARE.playEnergy;
      careBond(next);
      return result(next);
    case 'sleep':
      if (next.asleep) return result(next, 'noop');
      next.asleep = true;
      next.sleptAt = now;
      careBond(next);
      return result(next);
    case 'wake':
      if (!next.asleep) return result(next, 'noop');
      wake(next);
      return result(next);
    case 'pet':
    case 'tickle': {
      const taps = Math.min(CARE.maxTaps, Math.max(1, Math.floor(Number(n) || 1)));
      const wanted = taps * CARE.petJoyPerTap;
      const gain = Math.min(wanted, CARE.petJoyPerHour - next.caps.petJoy);
      if (gain <= 0) return result(next, 'capped');
      next.joy += gain;
      next.caps.petJoy += gain;
      careBond(next);
      return result(next, gain < wanted ? 'capped' : undefined);
    }
  }
}

/**
 * One talk exchange on the pet page: +6 Joy (≤ +30 an hour) and +1 Bond (talk Bond is not capped). Talking
 * wakes a sleeping pet, as feeding and playing do (the page wakes it on screen the moment you talk).
 */
export function talk(care: PetCare, now: number): CareResult {
  const next = rollCaps(copy(care), now);
  wake(next);
  const gain = Math.min(CARE.talkJoy, CARE.talkJoyPerHour - next.caps.talkJoy);
  next.joy += Math.max(0, gain);
  next.caps.talkJoy += Math.max(0, gain);
  next.bond += 1;
  return result(next, gain < CARE.talkJoy ? 'capped' : undefined);
}

/** Away longer than a day: every need becomes at least WELCOME_FLOOR (returning is a celebration). */
export function welcomeBack(care: PetCare, now: number): { care: PetCare; awayMs?: number } {
  const awayMs = now - care.lastSeenAt;
  if (awayMs <= WELCOME_AWAY_MS) return { care };
  const next = copy(care);
  for (const key of NEED_KEYS) next[key] = Math.max(next[key], WELCOME_FLOOR);
  return { care: next, awayMs };
}

/**
 * The page opened (GET), on already-decayed care: welcome-back floors, asleep during quiet hours,
 * awake again once a night has passed, stage-up and unseen Bond milestone. Records the visit.
 */
export function open(care: PetCare, now: number, stage: Stage): Opened {
  const back = welcomeBack(care, now);
  const next = copy(back.care);
  if (quietHours(next, now)) {
    if (!next.asleep) { next.asleep = true; next.sleptAt = now; }
  } else if (next.asleep) {
    let night = false;
    eachSegment(next.sleptAt ?? 0, now, next.tz, next.quietStart, next.quietEnd, (_, quiet) => { night ||= quiet; });
    if (night) wake(next);
  }
  const from = next.lastSeenStage;
  next.lastSeenStage = stage;
  next.lastSeenAt = Math.max(next.lastSeenAt, now);
  const { bondMilestone, care: done } = result(next);
  return {
    care: done,
    ...(back.awayMs === undefined ? {} : { welcome: { awayMs: back.awayMs } }),
    ...(stage > from ? { stageUp: { from, to: stage } } : {}),
    ...(bondMilestone === undefined ? {} : { bondMilestone }),
  };
}

/* ---------- mood ---------- */

/** Ties go tummy > energy > joy: the order a carer would fix them. */
const MOOD_ORDER: readonly NeedKey[] = ['tummy', 'energy', 'joy'];
const LOW_TONE: Readonly<Record<NeedKey, MoodTone>> = { tummy: 'hungry', energy: 'tired', joy: 'bored' };

/** Mood = the lowest need (§1.2): > 80 happy, ≥ 55 content, 30–54 wants, < 30 droopy. Never worse. */
export function mood(care: PetCare): Mood {
  const lowest = MOOD_ORDER.reduce((a, b) => (care[b] < care[a] ? b : a));
  const v = care[lowest];
  const level = v > MOOD_BAND.happyAbove ? 'happy' : v >= MOOD_BAND.wantsBelow ? 'content' : v >= MOOD_BAND.droopyBelow ? 'wants' : 'droopy';
  const tone: MoodTone = level === 'happy' || level === 'content' ? level : LOW_TONE[lowest];
  return { level, lowest, tone, asleep: care.asleep };
}
