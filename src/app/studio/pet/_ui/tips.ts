/**
 * Tips v1 (design §7): a local ranker over the play record's tip state and the content-free signals the page can see.
 * Pure: the signals are counts and flags (never words), kept on this device per agent; the record's `tips` and
 * `tipsToday` carry the server's rules (§7.1: twice in a life, three a day, a dismissed tip never returns), and one
 * tip a session is the page's rule. Placements: a toy wiggle, the pet's bubble, or a coach chip under the UI.
 */

import { MOOD_BAND, type PetCare } from '@/lib/pet/types';
import { PLAY_LIMITS, type PetPlayView, type TipId } from '@/lib/pet/play';
import type { ToyKind } from './contract';
import type { PetStringKey } from './strings';

/** Device-local, content-free counters (per agent): what tips need to know about how the person plays. */
export interface TipSignals {
  cookieTaps: number;
  drags: number;
  /** sessions opened (this one included) */
  sessions: number;
  /** ever touched the body (any poke, stroke, tickle, drag) */
  touched: boolean;
  pokes: number;
  strokes: number;
  typed: number;
  held: number;
  playOpened: boolean;
  moonUsed: boolean;
  /** opens during quiet hours, this session included */
  quietOpens: number;
  /** Wave C: different local days with a session (P1 on the second, P8 on the third, T13), and the last one (YYYY-MM-DD) */
  days: number;
  lastDay: string;
  /** Wave C: the Closet was opened (T14 points at it until then) */
  closetOpened: boolean;
  /** Wave C (P9): which games were played (a bit per game: bop, starfall, guess, hum) and on how many different days */
  games: number;
  gameDays: number;
  lastGameDay: string;
}

export const NO_SIGNALS: TipSignals = { cookieTaps: 0, drags: 0, sessions: 0, touched: false, pokes: 0, strokes: 0, typed: 0, held: 0, playOpened: false, moonUsed: false, quietOpens: 0,
  days: 0, lastDay: '', closetOpened: false, games: 0, gameDays: 0, lastGameDay: '' };

/** The game bits in `TipSignals.games`. */
export const GAME_BIT = { bop: 1, starfall: 2, guess: 4, hum: 8 } as const;
/** How many different games the bits hold. */
export const gamesPlayed = (bits: number) => [1, 2, 4, 8].filter((b) => bits & b).length;

/** The person's local day, YYYY-MM-DD (device clock and zone: these counters are device-local too). */
export function today(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A session today: counts a new different day once. Returns the same object, updated. */
export function countDay(s: TipSignals, day = today()): TipSignals {
  if (s.lastDay !== day) { s.days = Math.min(99, s.days + 1); s.lastDay = day; }
  return s;
}

/** A game played today (P9's "several different games on several days"). */
export function countGame(s: TipSignals, game: keyof typeof GAME_BIT, day = today()): TipSignals {
  s.games |= GAME_BIT[game];
  if (s.lastGameDay !== day) { s.gameDays = Math.min(99, s.gameDays + 1); s.lastGameDay = day; }
  return s;
}

/** This session only. */
export interface TipMoment {
  care: PetCare | null;
  /** the person's local hour */
  hour: number;
  micAvailable: boolean;
  /** the page opened with the pet asleep (quiet hours) */
  openedAsleep: boolean;
  /** a stage-up has happened (now or before: the Life Book has a stage page) */
  grown: boolean;
  /** the engine's settle cue fired */
  settled: boolean;
  /** quick round ends in a row (Play) */
  quickRounds: number;
  /** Wave C: this open came from a check-in (T10) */
  checkinOpened?: boolean;
  /** Wave C: a seed was ever planted (T13 waits for none) */
  planted?: boolean;
  /** Wave C: a keepsake is in the closet (T14) */
  keepsake?: boolean;
}

export type TipPlace =
  | { kind: 'wiggle'; toy: ToyKind; then?: 'bubble' }
  | { kind: 'bubble' }
  | { kind: 'coach'; target: 'mic' | 'rail-play' | 'rail-book' | 'rail-closet' };

export interface TipDef {
  id: TipId;
  line: PetStringKey;
  /** the one-line reason (long-press or ⓘ, §3.6), where the keys file has one */
  why?: PetStringKey;
  place: TipPlace;
  /** lower shows first when several fit */
  rank: number;
  fits(s: TipSignals, m: TipMoment): boolean;
}

const wants = (v: number | undefined) => v !== undefined && v < MOOD_BAND.wantsBelow;

/**
 * The catalogue (§7.3). Not here: T11 (the talk chips, their own surface). T10 is a bubble (the Why this? button it
 * names is in the chat, not on the page); T13 is the Garden's bubble on a second day; T14 points at the Closet chip.
 */
export const TIPS: readonly TipDef[] = [
  { id: 'T9', line: 'tip.T9.rest', place: { kind: 'bubble' }, rank: 0, fits: (_s, m) => m.settled },
  { id: 'T6', line: 'tip.T6.zen', why: 'tip.why.T6', place: { kind: 'bubble' }, rank: 1, fits: (_s, m) => m.quickRounds >= 2 },
  { id: 'T8', line: 'tip.T8.night', place: { kind: 'bubble' }, rank: 2, fits: (s, m) => m.openedAsleep && s.quietOpens <= 1 },
  { id: 'T1', line: 'tip.T1.drag', why: 'tip.why.T1', place: { kind: 'wiggle', toy: 'cookie', then: 'bubble' }, rank: 3, fits: (s) => s.cookieTaps >= 3 && s.drags === 0 },
  { id: 'T7', line: 'tip.T7.moon', place: { kind: 'wiggle', toy: 'moon' }, rank: 4, fits: (s, m) => !s.moonUsed && m.hour >= 19 && wants(m.care?.energy) && !m.care?.asleep },
  { id: 'T5', line: 'tip.T5.rooms', place: { kind: 'coach', target: 'rail-play' }, rank: 5, fits: (s, m) => !s.playOpened && wants(m.care?.joy) },
  { id: 'T4', line: 'tip.T4.mic', why: 'tip.why.T4', place: { kind: 'coach', target: 'mic' }, rank: 6, fits: (s, m) => m.micAvailable && s.typed >= 5 && s.held === 0 },
  { id: 'T2', line: 'tip.T2.tickle', place: { kind: 'bubble' }, rank: 7, fits: (s) => s.sessions >= 2 && !s.touched },
  { id: 'T3', line: 'tip.T3.stroke', place: { kind: 'bubble' }, rank: 8, fits: (s) => s.pokes >= 3 && s.strokes === 0 },
  { id: 'T12', line: 'tip.T12.book', place: { kind: 'coach', target: 'rail-book' }, rank: 9, fits: (_s, m) => m.grown },
  { id: 'T10', line: 'tip.T10.why', place: { kind: 'bubble' }, rank: 2.5, fits: (_s, m) => !!m.checkinOpened },
  { id: 'T13', line: 'tip.T13.garden', place: { kind: 'bubble' }, rank: 9.5, fits: (s, m) => s.days >= 2 && m.planted === false },
  { id: 'T14', line: 'tip.T14.closet', place: { kind: 'coach', target: 'rail-closet' }, rank: 4.5, fits: (s, m) => !!m.keepsake && !s.closetOpened },
];

/** The opening seconds are the hello's (§7.1): its own tiny module, so the page reads it without the catalogue. */
export { openOver, TIP_OPEN_MS } from './tipOpen';

/** The record says this tip may show (§7.1): not dismissed, under its two lifetime shows, under three today. */
export function tipAllowed(play: PetPlayView | undefined, id: TipId): boolean {
  if (!play) return false;
  const t = play.tips[id];
  if (t && (t.dismissed || t.shown >= PLAY_LIMITS.tipShowsPerLife)) return false;
  return play.tipsToday < PLAY_LIMITS.tipsPerDay;
}

/**
 * The tip to show now, or null. `shownThisSession`: one tip a session. Among the tips whose signal fits and the record
 * allows, the one shown fewer times first, then the catalogue's rank. `hint` is Decisions' pick (`view.suggest.tip`,
 * only under STUDIO_PET_DECISIONS=on and calibrated): a tip id goes first only if it already fits and is allowed; null
 * means none this session. It never adds a tip the rules would not show.
 */
export function rankTips(play: PetPlayView | undefined, s: TipSignals, m: TipMoment, shownThisSession: boolean, only?: readonly TipId[], hint?: TipId | null): TipDef | null {
  if (shownThisSession || !play || hint === null) return null;
  const fit = TIPS.filter((d) => (!only || only.includes(d.id)) && tipAllowed(play, d.id) && d.fits(s, m));
  fit.sort((a, b) => (play.tips[a.id]?.shown ?? 0) - (play.tips[b.id]?.shown ?? 0) || a.rank - b.rank);
  return fit.find((d) => d.id === hint) ?? fit[0] ?? null;
}

/* ---------- the device-local counters ---------- */

const KEY = (agentId: string) => `vox.pet.tips.${agentId}`;

export function readSignals(agentId: string): TipSignals {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(agentId)) ?? 'null') as Partial<TipSignals> | null;
    if (!raw || typeof raw !== 'object') return { ...NO_SIGNALS };
    const out = { ...NO_SIGNALS };
    for (const k of Object.keys(NO_SIGNALS) as (keyof TipSignals)[]) {
      const v = raw[k];
      if (typeof v === typeof NO_SIGNALS[k] && (typeof v !== 'number' || (Number.isFinite(v) && v >= 0))) (out as Record<string, unknown>)[k] = typeof v === 'number' ? Math.min(99, Math.floor(v)) : v;
    }
    return out;
  } catch { return { ...NO_SIGNALS }; }
}

export function writeSignals(agentId: string, s: TipSignals) {
  try { localStorage.setItem(KEY(agentId), JSON.stringify(s)); } catch { /* private mode: the tips just learn less */ }
}
