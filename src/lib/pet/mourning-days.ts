/**
 * Official Iranian mourning days (design PET_CARE_GAME_DESIGN_2026_10_26 §5.5, open decision 13): on these days no
 * seasonal check-in is sent and the in-app festival greeting falls back to `season.mourningFallback`.
 *
 * MAINTAINED BY THE HOOR TEAM. A small, reviewed, versioned table for the next two Persian years, checked against the
 * official Iranian calendar each year, never a live third-party feed. The lunar (Hijri) dates below were first
 * computed with the Umm al-Qura calendar and are marked `verified: false` until HOOR checks them against the official
 * calendar: Iran's moon sighting can move a date by a day, so an unverified date also quiets the day before and the
 * day after. A day outside the table's years is uncertain, and uncertain means quiet (no seasonal check-in): extend the
 * table before the next Persian year starts. Bump `MOURNING_TABLE_VERSION` on every change.
 *
 * Dates are Solar Hijri (`YYYY-MM-DD`, Farvardin = 01), compared in the person's own zone.
 */

import { persianDate } from './play';

export const MOURNING_TABLE_VERSION = '1405-1406.1';

export type MourningDayId = 'tasua' | 'ashura' | 'arbaeen' | 'prophet_hasan' | 'reza' | 'askari' | 'fatima' | 'ali' | 'sadiq' | 'khomeini';

export interface MourningDay {
  /** Solar Hijri date, YYYY-MM-DD */
  date: string;
  id: MourningDayId;
  /** checked by HOOR against the official calendar; false also quiets the neighbouring days */
  verified: boolean;
}

export interface MourningTable {
  version: string;
  /** Persian years the table covers completely; any other year is uncertain (quiet) */
  years: readonly number[];
  days: readonly MourningDay[];
}

export const MOURNING_TABLE: MourningTable = Object.freeze({
  version: MOURNING_TABLE_VERSION,
  years: Object.freeze([1405, 1406]),
  days: Object.freeze([
    // 1405 (21 March 2026 - 20 March 2027)
    { date: '1405-01-24', id: 'sadiq', verified: false },
    { date: '1405-03-14', id: 'khomeini', verified: true },
    { date: '1405-04-03', id: 'tasua', verified: false },
    { date: '1405-04-04', id: 'ashura', verified: false },
    { date: '1405-05-12', id: 'arbaeen', verified: false },
    { date: '1405-05-20', id: 'prophet_hasan', verified: false },
    { date: '1405-05-22', id: 'reza', verified: false },
    { date: '1405-05-30', id: 'askari', verified: false },
    { date: '1405-08-22', id: 'fatima', verified: false },
    { date: '1405-12-09', id: 'ali', verified: false },
    // 1406 (21 March 2027 - 19 March 2028)
    { date: '1406-01-13', id: 'sadiq', verified: false },
    { date: '1406-03-14', id: 'khomeini', verified: true },
    { date: '1406-03-24', id: 'tasua', verified: false },
    { date: '1406-03-25', id: 'ashura', verified: false },
    { date: '1406-05-02', id: 'arbaeen', verified: false },
    { date: '1406-05-10', id: 'prophet_hasan', verified: false },
    { date: '1406-05-11', id: 'reza', verified: false },
    { date: '1406-05-19', id: 'askari', verified: false },
    { date: '1406-08-11', id: 'fatima', verified: false },
    { date: '1406-11-28', id: 'ali', verified: false },
  ].map((d) => Object.freeze(d as MourningDay))),
});

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The Solar Hijri day of an instant in `tz` as YYYY-MM-DD, or null where the runtime has no Persian calendar. */
export function persianDay(at: number, tz: string): string | null {
  const p = persianDate(at, tz);
  return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : null;
}

/**
 * Is it a mourning day in `tz`? `mourning`: a listed day (or the neighbour of an unverified one); `uncertain`: outside
 * the table's years or no Persian calendar at all; `clear` otherwise. Callers treat anything but `clear` as quiet.
 */
export function mourningStatus(at: number, tz: string, table: MourningTable = MOURNING_TABLE): 'mourning' | 'uncertain' | 'clear' {
  const today = persianDay(at, tz);
  if (!today) return 'uncertain';
  const year = Number(today.slice(0, 4));
  if (!table.years.includes(year)) return 'uncertain';
  if (table.days.some((d) => d.date === today)) return 'mourning';
  const near = [persianDay(at - DAY, tz), persianDay(at + DAY, tz)];
  if (table.days.some((d) => !d.verified && near.includes(d.date))) return 'mourning';
  return 'clear';
}

/** No seasonal check-in today (§5.5): a mourning day, or a day the table cannot vouch for. */
export const seasonalQuiet = (at: number, tz: string, table: MourningTable = MOURNING_TABLE) => mourningStatus(at, tz, table) !== 'clear';
