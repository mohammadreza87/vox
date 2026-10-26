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
}

export const NO_SIGNALS: TipSignals = { cookieTaps: 0, drags: 0, sessions: 0, touched: false, pokes: 0, strokes: 0, typed: 0, held: 0, playOpened: false, moonUsed: false, quietOpens: 0 };

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
}

export type TipPlace =
  | { kind: 'wiggle'; toy: ToyKind; then?: 'bubble' }
  | { kind: 'bubble' }
  | { kind: 'coach'; target: 'mic' | 'rail-play' | 'rail-book' };

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
 * The v1 catalogue (§7.3). Not here yet: T10 (a check-in opened: not visible to the page), T11 (the talk chips, their
 * own surface), T13 and T14 (the Garden and the Closet are still placeholders, so the tip would point at nothing).
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
];

/** The record says this tip may show (§7.1): not dismissed, under its two lifetime shows, under three today. */
export function tipAllowed(play: PetPlayView | undefined, id: TipId): boolean {
  if (!play) return false;
  const t = play.tips[id];
  if (t && (t.dismissed || t.shown >= PLAY_LIMITS.tipShowsPerLife)) return false;
  return play.tipsToday < PLAY_LIMITS.tipsPerDay;
}

/**
 * The tip to show now, or null. `shownThisSession`: one tip a session. Among the tips whose signal fits and the record
 * allows, the one shown fewer times first, then the catalogue's rank.
 */
export function rankTips(play: PetPlayView | undefined, s: TipSignals, m: TipMoment, shownThisSession: boolean, only?: readonly TipId[]): TipDef | null {
  if (shownThisSession || !play) return null;
  const fit = TIPS.filter((d) => (!only || only.includes(d.id)) && tipAllowed(play, d.id) && d.fits(s, m));
  fit.sort((a, b) => (play.tips[a.id]?.shown ?? 0) - (play.tips[b.id]?.shown ?? 0) || a.rank - b.rank);
  return fit[0] ?? null;
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
