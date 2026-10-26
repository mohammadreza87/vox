/**
 * Vox Pet play: the per-person "Pou side" record (design PET_CARE_GAME_DESIGN_2026_10_26 §3.4), beside `PetCare`
 * and never inside it. `studio_pet_play/{agentId}_{userId}`, `v: 1`. Isomorphic and pure, like types.ts and care.ts:
 * the server store (pet-play-store.ts) and route (pet-http.ts) apply these rules; the page may apply the same code
 * optimistically.
 *
 * Content-free by construction: every stored value is a catalogue id, a timestamp, a small count or a flag. There is
 * no message text and no free text of any kind; the only client-chosen string (a game round id) is stored as a hash.
 *
 * Rules carried from the design: items are earned, never bought (§1, §4.3); one seed at a time that never wilts, one
 * counted watering a day, a bloom after a few waterings (§4.5); Life Book pages only for things that happened (§4.7);
 * game outcomes only as an enum, rounds kept as a bucket, a per-day cap (§4.2); one tip shown at most twice in its
 * life, three tips a day, a dismissed tip never returns (§7.1); the re-ask rule (§6.1); one celebration per festival
 * per person per Persian year (§4.10); first room visits light personal growth moments (§4.11, `litMine`).
 * Nothing here reads or writes a need, so the humane invariants of care.ts cannot be touched.
 */

import { safeZone } from './care';
import type { Stage } from './types';
import type { PetGrowthView } from './growth';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ---------- catalogues (ids match the copy keys, PET_COPY_KEYS_2026_10_26.md) ---------- */

/** Closet slots (§4.3). */
export type WearSlot = 'head' | 'neck' | 'hand';
export const WEAR_SLOTS: readonly WearSlot[] = ['head', 'neck', 'hand'];

/** Earned keepsakes (`item.*` keys). Each says how it is earned; none has a price. */
export type KeepsakeId = 'pomegranateCrown' | 'sparkScarf' | 'sabzehSprout' | 'starPin' | 'bloomPin';
export const KEEPSAKE_IDS: readonly KeepsakeId[] = ['pomegranateCrown', 'sparkScarf', 'sabzehSprout', 'starPin', 'bloomPin'];

/** The existing accessory vocabulary (src/lib/studio/types.ts `Accessory`), free for everyone's closet overlay. */
export type FreeAccessoryId = 'glasses' | 'specs' | 'beret' | 'cap' | 'beanie' | 'headphones' | 'headset' | 'bow' | 'flower' | 'star' | 'bowtie';
export type WearableId = KeepsakeId | FreeAccessoryId;

/** How a keepsake is earned (the closet's `closet.lock.*` line): a festival, the first bloom, or Bond 150+. */
export type EarnRule = { season: SeasonId } | { bloom: true } | { bond: number };

export const KEEPSAKES: Readonly<Record<KeepsakeId, { slot: WearSlot; earn: EarnRule }>> = {
  pomegranateCrown: { slot: 'head', earn: { season: 'yalda' } },
  sparkScarf: { slot: 'neck', earn: { season: 'suri' } },
  sabzehSprout: { slot: 'hand', earn: { season: 'nowruz' } },
  /** "Keepsakes after the sixth milestone (Bond 150+)" (§2) */
  starPin: { slot: 'neck', earn: { bond: 150 } },
  bloomPin: { slot: 'neck', earn: { bloom: true } },
};

export const FREE_ACCESSORIES: Readonly<Record<FreeAccessoryId, WearSlot>> = {
  glasses: 'head', specs: 'head', beret: 'head', cap: 'head', beanie: 'head', headphones: 'head', headset: 'head',
  bow: 'head', flower: 'head', star: 'head', bowtie: 'neck',
};
export const WEARABLE_IDS: readonly WearableId[] = [...KEEPSAKE_IDS, ...Object.keys(FREE_ACCESSORIES) as FreeAccessoryId[]];

/** Seeds (§4.5). `sabzeh` is the Nowruz seed and can be planted only while Nowruz is on (§4.10). */
export type SeedKind = 'flower' | 'sabzeh';
export const SEED_KINDS: readonly SeedKind[] = ['flower', 'sabzeh'];

/** Mini-games that report a round outcome (§4.2). Guess is talk, so it has no outcome here. */
export type GameId = 'bop' | 'starfall' | 'hum';
export const GAME_IDS: readonly GameId[] = ['bop', 'starfall', 'hum'];
/** The only thing the server records about a round (§4.2): finished, finished in zen, or a new personal best. */
export type RoundOutcome = 'finished' | 'zen' | 'best';
export const ROUND_OUTCOMES: readonly RoundOutcome[] = ['finished', 'zen', 'best'];

/** Tips T1-T14 (§7.3). */
export type TipId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12' | 'T13' | 'T14';
export const TIP_IDS: readonly TipId[] = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13', 'T14'];

/** Permission moments P1-P10 and P3b (§6.2, §8A.2). `asks` keeps only the re-ask timing; grants live with their purpose. */
export type AskId = 'P1' | 'P2' | 'P3' | 'P3b' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10';
export const ASK_IDS: readonly AskId[] = ['P1', 'P2', 'P3', 'P3b', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];

/** Festivals (§4.10), keyed like `season.*`. */
export type SeasonId = 'yalda' | 'suri' | 'nowruz';
export const SEASON_IDS: readonly SeasonId[] = ['yalda', 'suri', 'nowruz'];
const SEASON_KEEPSAKE: Readonly<Record<SeasonId, KeepsakeId>> = { yalda: 'pomegranateCrown', suri: 'sparkScarf', nowruz: 'sabzehSprout' };

/** Life Book pages (§4.7): first day, each stage-up, the day it formed, each Bond milestone, first bloom, festivals, best moments. */
export type BookMomentId = 'met' | 'stage2' | 'stage3' | 'stage4' | 'formed'
  | 'bond1' | 'bond2' | 'bond3' | 'bond4' | 'bond5' | 'bond6'
  | 'bloom' | 'yalda' | 'suri' | 'nowruz' | 'bestBop' | 'bestStarfall' | 'bestHum';
export const BOOK_MOMENT_IDS: readonly BookMomentId[] = ['met', 'stage2', 'stage3', 'stage4', 'formed',
  'bond1', 'bond2', 'bond3', 'bond4', 'bond5', 'bond6', 'bloom', 'yalda', 'suri', 'nowruz', 'bestBop', 'bestStarfall', 'bestHum'];
const BEST_PAGE: Readonly<Record<GameId, BookMomentId>> = { bop: 'bestBop', starfall: 'bestStarfall', hum: 'bestHum' };

/** Rooms whose first visit lights a personal `room` growth moment (§4.11). Home is where the pet starts, so it lights nothing. */
export type PlayRoom = 'play' | 'garden' | 'closet' | 'bedroom' | 'book';
export const PLAY_ROOMS: readonly PlayRoom[] = ['play', 'garden', 'closet', 'bedroom', 'book'];
/** A growth moment id: a stable slug (drafted ids come from the persona drafter, studio/growth.ts). */
export const MOMENT_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const roomMoment = (room: PlayRoom) => `room-${room}`;

/* ---------- limits ---------- */

export const PLAY_LIMITS = {
  /** a seed sprouts "over about a day" (§4.5) */
  sproutMs: 20 * HOUR,
  /** "blooms after a few waterings across different visits" (§4.5); one counted watering a local day */
  bloomWaterings: 3,
  /** rounds are kept as a bucket, never an exact count (§3.4); this is where counting stops */
  roundsCap: 20,
  /** rounds a game records per local day; more still play, they are just not recorded (§4.2 "rate limits") */
  roundsPerDay: 60,
  /** §7.1 */
  tipShowsPerLife: 2,
  tipsPerDay: 3,
  /** §6.1: after one decline, only after 30 days; after two, never on its own */
  reaskAfterMs: 30 * DAY,
  maxDeclines: 2,
  /** array caps (the catalogues are smaller; these hold even for a hand-edited record) */
  items: 32,
  book: 64,
  litMine: 64,
} as const;

/* ---------- the record ---------- */

export interface PlayGarden {
  seed: SeedKind;
  plantedAt: number;
  /** counted waterings (at most one a local day) */
  waterings: number;
  /** the local day (YYYY-MM-DD in the person's zone) of the last counted watering */
  wateredDay?: string;
  bloomedAt?: number;
}

export interface PlayGame {
  /** saturating at PLAY_LIMITS.roundsCap: a bucket, never shown as a number */
  rounds: number;
  /** a personal best happened at least once */
  best: boolean;
  /** the last round was played in zen mode (the person's preference) */
  zen: boolean;
  /** per-day cap window */
  day: string;
  today: number;
  /** hash of the last round id: a retried save is one round */
  lastRound?: string;
}

export interface PlayTip { shown: number; dismissed: boolean; lastShownAt?: number; lastDay?: string }
/** `acceptedAt`: the person said yes in context (askAccepted); the ask is never offered again and may light an `access` moment. */
export interface PlayAsk { lastAskedAt: number; declined: number; lastDeclinedAt?: number; lastDay?: string; acceptedAt?: number }

/** One person's play state for one agent: `studio_pet_play/{agentId}_{userId}`. All times are epoch ms. */
export interface PetPlay {
  v: 1;
  agentId: string;
  userId: number;
  createdAt: number;
  updatedAt: number;
  /** last open or play (the 90-day guest sweep reads this, like PetCare.lastSeenAt) */
  seenAt: number;
  items: { id: KeepsakeId; earnedAt: number }[];
  wearing: Partial<Record<WearSlot, WearableId>>;
  garden: PlayGarden | null;
  book: { id: BookMomentId; at: number }[];
  games: Partial<Record<GameId, PlayGame>>;
  tips: Partial<Record<TipId, PlayTip>>;
  asks: Partial<Record<AskId, PlayAsk>>;
  /** festival → the Persian year it was last celebrated with this agent */
  seasons: Partial<Record<SeasonId, number>>;
  /**
   * growth moments lit only for this person (§4.11). `ref`: a privately taught moment's opaque source-note hash
   * (studio/growth.ts noteRef), so erasing that note takes the moment back; never shown in the view.
   */
  litMine: { id: string; litAt: number; ref?: string }[];
}

export function newPlay(agentId: string, userId: number, now: number): PetPlay {
  return { v: 1, agentId, userId, createdAt: now, updatedAt: now, seenAt: now, items: [], wearing: {}, garden: null, book: [],
    games: {}, tips: {}, asks: {}, seasons: {}, litMine: [] };
}

/* ---------- calendar (the person's zone) ---------- */

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const persianFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local calendar day of an instant in `tz`, as YYYY-MM-DD. Per-day caps reset at the person's midnight. */
export function localDay(at: number, tz: string): string {
  const zone = safeZone(tz);
  let f = dayFormatters.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }); dayFormatters.set(zone, f); }
  const parts = f.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export interface PersianDate { year: number; month: number; day: number; weekday: number; hour: number }

/** The Solar Hijri date of an instant in `tz` (Intl `ca-persian`), or null where the runtime lacks it. weekday: 0 Sunday … 6 Saturday. */
export function persianDate(at: number, tz: string): PersianDate | null {
  const zone = safeZone(tz);
  try {
    let f = persianFormatters.get(zone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
      persianFormatters.set(zone, f);
    }
    const parts = f.formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    const year = Number.parseInt(get('year'), 10), month = Number.parseInt(get('month'), 10), day = Number.parseInt(get('day'), 10);
    const hour = Number.parseInt(get('hour'), 10) % 24;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    if (![year, month, day, hour].every(Number.isFinite) || weekday < 0 || month < 1 || month > 12) return null;
    return { year, month, day, weekday, hour };
  } catch { return null; }
}

/**
 * The festival on now in the person's zone (§4.10), or null. Yalda: 30 Azar, through the next morning (before noon on
 * 1 Dey). Chaharshanbe Suri: the Tuesday before the year's last Wednesday, through that Wednesday morning. Nowruz:
 * 1-13 Farvardin. Mourning-day quiet (§5.5) changes only the greeting, never whether the festival is on.
 */
export function activeSeason(at: number, tz: string): { season: SeasonId; year: number } | null {
  const p = persianDate(at, tz);
  if (!p) return null;
  if (p.month === 1 && p.day <= 13) return { season: 'nowruz', year: p.year };
  // Azar and Dey are in the same Persian year, so the night keeps one year.
  if ((p.month === 9 && p.day === 30) || (p.month === 10 && p.day === 1 && p.hour < 12)) return { season: 'yalda', year: p.year };
  if (p.month === 12) {
    // Esfand has 30 days in a leap year, else 29: probe the 30th.
    const probe = persianDate(at + (30 - p.day) * DAY, tz);
    const last = probe && probe.month === 12 ? 30 : 29;
    const tuesday = p.weekday === 2 && p.day + 8 > last && p.day + 1 <= last;
    const wednesday = p.weekday === 3 && p.day + 7 > last && p.hour < 12;
    if (tuesday || wednesday) return { season: 'suri', year: p.year };
  }
  return null;
}

/* ---------- derived views ---------- */

export type GardenState = 'empty' | 'seeded' | 'sprouting' | 'ready' | 'watered' | 'blooming' | 'bloomed';
export type RoundsBucket = 'none' | 'one' | 'few' | 'many';
export const roundsBucket = (n: number): RoundsBucket => n <= 0 ? 'none' : n === 1 ? 'one' : n < 10 ? 'few' : 'many';

/**
 * The garden as the page draws it (§4.5 states). seeded: planted, not yet a day old; sprouting: watered at least once
 * and not yet sprouted; ready: sprouted and not watered today; watered: watered today; blooming: bloomed within a day;
 * bloomed: after that, until a new seed. It never wilts: nothing here moves backwards with time away.
 */
export function gardenState(g: PlayGarden | null, now: number, tz: string): GardenState {
  if (!g) return 'empty';
  if (g.bloomedAt !== undefined) return now - g.bloomedAt < DAY ? 'blooming' : 'bloomed';
  if (g.wateredDay === localDay(now, tz)) return 'watered';
  if (now - g.plantedAt < PLAY_LIMITS.sproutMs) return g.waterings > 0 ? 'sprouting' : 'seeded';
  return 'ready';
}

/** What GET view / play and POST play return: the record without its identity, plus derived states. */
export interface PetPlayView {
  items: { id: KeepsakeId; earnedAt: number }[];
  wearing: Partial<Record<WearSlot, WearableId>>;
  garden: (Omit<PlayGarden, 'wateredDay'> & { state: GardenState }) | null;
  book: { id: BookMomentId; at: number }[];
  games: Partial<Record<GameId, { rounds: RoundsBucket; best: boolean; zen: boolean }>>;
  tips: Partial<Record<TipId, { shown: number; dismissed: boolean }>>;
  asks: Partial<Record<AskId, { lastAskedAt: number; declined: number; accepted?: true }>>;
  seasons: Partial<Record<SeasonId, number>>;
  litMine: { id: string; litAt: number }[];
  /** the festival on now in the person's zone, if any */
  season?: SeasonId;
  /** tips already shown today (the page offers none once this reaches PLAY_LIMITS.tipsPerDay) */
  tipsToday: number;
}

export function playView(play: PetPlay, now: number, tz: string): PetPlayView {
  const today = localDay(now, tz);
  const games: PetPlayView['games'] = {};
  for (const id of GAME_IDS) { const g = play.games[id]; if (g) games[id] = { rounds: roundsBucket(g.rounds), best: g.best, zen: g.zen }; }
  const tips: PetPlayView['tips'] = {};
  for (const id of TIP_IDS) { const t = play.tips[id]; if (t) tips[id] = { shown: t.shown, dismissed: t.dismissed }; }
  const asks: PetPlayView['asks'] = {};
  for (const id of ASK_IDS) { const a = play.asks[id]; if (a) asks[id] = { lastAskedAt: a.lastAskedAt, declined: a.declined, ...(a.acceptedAt !== undefined ? { accepted: true as const } : {}) }; }
  const season = activeSeason(now, tz)?.season;
  const g = play.garden;
  const garden: PetPlayView['garden'] = g ? { seed: g.seed, plantedAt: g.plantedAt, waterings: g.waterings,
    ...(g.bloomedAt !== undefined ? { bloomedAt: g.bloomedAt } : {}), state: gardenState(g, now, tz) } : null;
  return {
    items: play.items.map((i) => ({ ...i })), wearing: { ...play.wearing }, garden, book: play.book.map((b) => ({ ...b })),
    games, tips, asks, seasons: { ...play.seasons }, litMine: play.litMine.map((m) => ({ id: m.id, litAt: m.litAt })),
    ...(season ? { season } : {}), tipsToday: tipsShownOn(play, today),
  };
}

const tipsShownOn = (play: PetPlay, day: string) => TIP_IDS.filter((id) => play.tips[id]?.lastDay === day).length;

/** May this permission moment be offered now (§6.1 re-ask rule)? Session and timing rules stay on the page. */
export function askEligible(play: PetPlay, id: AskId, now: number): boolean {
  const a = play.asks[id];
  if (!a) return true;
  if (a.acceptedAt !== undefined || a.declined >= PLAY_LIMITS.maxDeclines) return false;
  return a.declined === 0 || now - a.lastAskedAt >= PLAY_LIMITS.reaskAfterMs;
}

/** May this tip be shown now (§7.1)? */
export function tipEligible(play: PetPlay, id: TipId, now: number, tz: string): boolean {
  const t = play.tips[id];
  if (t && (t.dismissed || t.shown >= PLAY_LIMITS.tipShowsPerLife)) return false;
  return tipsShownOn(play, localDay(now, tz)) < PLAY_LIMITS.tipsPerDay;
}

/* ---------- mutations ---------- */

/** POST play: one small, idempotent mutation. Repeating one never does more than doing it once. */
export type PlayMutation =
  | { op: 'lightItem'; item: KeepsakeId }
  | { op: 'wear'; slot: WearSlot; item: WearableId | null }
  | { op: 'plantSeed'; seed: SeedKind }
  | { op: 'waterSeed' }
  | { op: 'bookMoment'; moment: BookMomentId }
  /** `round`: a fresh client id per round (8-40 of [A-Za-z0-9_-]); a retried save carries the same id */
  | { op: 'gameRound'; game: GameId; outcome: RoundOutcome; round: string }
  | { op: 'tipSeen'; tip: TipId }
  | { op: 'tipDismissed'; tip: TipId }
  | { op: 'askSeen'; ask: AskId }
  | { op: 'askDeclined'; ask: AskId }
  /** the person said yes to this permission moment in context: lights the agent's next personal `access` growth moment */
  | { op: 'askAccepted'; ask: AskId }
  | { op: 'seasonCelebrated'; season: SeasonId }
  | { op: 'roomVisited'; room: PlayRoom };
export type PlayOp = PlayMutation['op'];
export const PLAY_OPS: readonly PlayOp[] = ['lightItem', 'wear', 'plantSeed', 'waterSeed', 'bookMoment', 'gameRound', 'tipSeen', 'tipDismissed',
  'askSeen', 'askDeclined', 'askAccepted', 'seasonCelebrated', 'roomVisited'];

/**
 * Why a mutation did less than asked. Never an error: the page plays a cute reaction or nothing.
 * noop: already so · locked: not earned yet (or not owned) · busy: a seed is already growing · capped: a per-day cap ·
 * spent: a tip shown its two times or dismissed, an ask declined twice · too_soon: an ask inside the re-ask window ·
 * out_of_season: that festival is not on now · elsewhere: celebrated with another agent this year.
 */
export type PlayGuard = 'noop' | 'locked' | 'busy' | 'capped' | 'spent' | 'too_soon' | 'out_of_season' | 'elsewhere';

/** What the server knows beside the record: the clock, the person's zone, and read-only facts from PetCare and the agent. */
export interface PlayContext {
  now: number;
  tz: string;
  stage: Stage;
  /** the forming week is over (formingDay is null for an active agent) */
  formed: boolean;
  /** PetCare.bond, read only */
  bond: number;
  /** festivals this person already celebrated this Persian year with another agent (§4.10 "across all their agents") */
  celebratedElsewhere?: ReadonlySet<SeasonId>;
  /** the agent's `access` growth moment ids in order (§4.11): askAccepted lights the first one not yet lit for this person */
  accessMoments?: readonly string[];
}

export interface PlayResult { play: PetPlay; guard?: PlayGuard }

/** FNV-1a, 32 bit: the stored form of a client round id (never the id itself). */
export function roundHash(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const hasItem = (play: PetPlay, id: KeepsakeId) => play.items.some((i) => i.id === id);
const hasPage = (play: PetPlay, id: BookMomentId) => play.book.some((b) => b.id === id);
const everBloomed = (play: PetPlay) => hasPage(play, 'bloom') || play.garden?.bloomedAt !== undefined;

function earned(play: PetPlay, id: KeepsakeId, ctx: PlayContext): boolean {
  const rule = KEEPSAKES[id].earn;
  if ('season' in rule) return play.seasons[rule.season] !== undefined;
  if ('bloom' in rule) return everBloomed(play);
  return ctx.bond >= rule.bond;
}

/** Has the moment behind this page happened? Pages are never granted ahead of it. */
function pageReached(play: PetPlay, id: BookMomentId, ctx: PlayContext): boolean {
  switch (id) {
    case 'met': return true;
    case 'stage2': return ctx.stage >= 2;
    case 'stage3': return ctx.stage >= 3;
    case 'stage4': return ctx.stage >= 4;
    case 'formed': return ctx.formed;
    case 'bloom': return everBloomed(play);
    case 'yalda': case 'suri': case 'nowruz': return play.seasons[id] !== undefined;
    case 'bestBop': return !!play.games.bop?.best;
    case 'bestStarfall': return !!play.games.starfall?.best;
    case 'bestHum': return !!play.games.hum?.best;
    default: return ctx.bond >= 25 * Number(id.slice(4));
  }
}

function addItem(play: PetPlay, id: KeepsakeId, at: number) {
  if (!hasItem(play, id) && play.items.length < PLAY_LIMITS.items) play.items.push({ id, earnedAt: at });
}
function addPage(play: PetPlay, id: BookMomentId, at: number) {
  if (!hasPage(play, id) && play.book.length < PLAY_LIMITS.book) play.book.push({ id, at });
}

/** Applies one mutation to a copy of `current` (or a new record). Pure: the input is never changed. */
export function applyPlay(current: PetPlay, m: PlayMutation, ctx: PlayContext): PlayResult {
  const { now } = ctx;
  const tz = safeZone(ctx.tz);
  const play: PetPlay = structuredClone(current);
  const today = localDay(now, tz);
  const done = (guard?: PlayGuard): PlayResult => {
    if (guard === undefined) play.updatedAt = Math.max(play.updatedAt, now);
    play.seenAt = Math.max(play.seenAt, now);
    return guard === undefined ? { play } : { play, guard };
  };

  switch (m.op) {
    case 'lightItem': {
      if (hasItem(play, m.item)) return done('noop');
      if (!earned(play, m.item, ctx)) return done('locked');
      addItem(play, m.item, now);
      return done();
    }
    case 'wear': {
      const worn = play.wearing[m.slot];
      if (m.item === null) {
        if (worn === undefined) return done('noop');
        delete play.wearing[m.slot];
        return done();
      }
      const keepsake = (KEEPSAKES as Record<string, { slot: WearSlot } | undefined>)[m.item];
      const slot = keepsake ? keepsake.slot : (FREE_ACCESSORIES as Record<string, WearSlot | undefined>)[m.item];
      if (slot !== m.slot || (keepsake && !hasItem(play, m.item as KeepsakeId))) return done('locked');
      if (worn === m.item) return done('noop');
      play.wearing[m.slot] = m.item;
      return done();
    }
    case 'plantSeed': {
      if (play.garden && play.garden.bloomedAt === undefined) return done(play.garden.seed === m.seed ? 'noop' : 'busy');
      if (m.seed === 'sabzeh' && activeSeason(now, tz)?.season !== 'nowruz') return done('out_of_season');
      play.garden = { seed: m.seed, plantedAt: now, waterings: 0 };
      return done();
    }
    case 'waterSeed': {
      const g = play.garden;
      if (!g || g.bloomedAt !== undefined || g.wateredDay === today) return done('noop');
      g.waterings = Math.min(g.waterings + 1, PLAY_LIMITS.bloomWaterings);
      g.wateredDay = today;
      if (g.waterings >= PLAY_LIMITS.bloomWaterings && now - g.plantedAt >= PLAY_LIMITS.sproutMs) {
        g.bloomedAt = now;
        addItem(play, 'bloomPin', now);
        addPage(play, 'bloom', now);
      }
      return done();
    }
    case 'bookMoment': {
      if (hasPage(play, m.moment)) return done('noop');
      if (!pageReached(play, m.moment, ctx)) return done('locked');
      addPage(play, m.moment, now);
      return done();
    }
    case 'gameRound': {
      const prior = play.games[m.game];
      const hash = roundHash(m.round);
      if (prior?.lastRound === hash) return done('noop');
      const g: PlayGame = prior ? { ...prior } : { rounds: 0, best: false, zen: false, day: today, today: 0 };
      if (g.day !== today) { g.day = today; g.today = 0; }
      if (g.today >= PLAY_LIMITS.roundsPerDay) return done('capped');
      g.today += 1;
      g.rounds = Math.min(g.rounds + 1, PLAY_LIMITS.roundsCap);
      g.zen = m.outcome === 'zen';
      g.lastRound = hash;
      if (m.outcome === 'best') { g.best = true; addPage(play, BEST_PAGE[m.game], now); }
      play.games[m.game] = g;
      return done();
    }
    case 'tipSeen': {
      const t = play.tips[m.tip];
      if (t?.lastDay === today) return done('noop');
      if (t && (t.dismissed || t.shown >= PLAY_LIMITS.tipShowsPerLife)) return done('spent');
      if (tipsShownOn(play, today) >= PLAY_LIMITS.tipsPerDay) return done('capped');
      play.tips[m.tip] = { shown: (t?.shown ?? 0) + 1, dismissed: false, lastShownAt: now, lastDay: today };
      return done();
    }
    case 'tipDismissed': {
      const t = play.tips[m.tip];
      if (t?.dismissed) return done('noop');
      play.tips[m.tip] = { ...(t ?? { shown: 0 }), dismissed: true };
      return done();
    }
    case 'askSeen': {
      const a = play.asks[m.ask];
      if (a?.lastDay === today) return done('noop');
      if (a && a.declined >= PLAY_LIMITS.maxDeclines) return done('spent');
      if (a && !askEligible(play, m.ask, now)) return done('too_soon');
      play.asks[m.ask] = { lastAskedAt: now, declined: a?.declined ?? 0, ...(a?.lastDeclinedAt !== undefined ? { lastDeclinedAt: a.lastDeclinedAt } : {}), lastDay: today };
      return done();
    }
    case 'askDeclined': {
      const a = play.asks[m.ask];
      // A decline answers the latest ask once: a double tap, or a decline with no ask, changes nothing.
      if (!a || (a.lastDeclinedAt !== undefined && a.lastDeclinedAt >= a.lastAskedAt)) return done('noop');
      play.asks[m.ask] = { ...a, declined: Math.min(a.declined + 1, PLAY_LIMITS.maxDeclines), lastDeclinedAt: Math.max(now, a.lastAskedAt) };
      return done();
    }
    case 'askAccepted': {
      const a = play.asks[m.ask];
      if (a?.acceptedAt !== undefined) return done('noop');
      play.asks[m.ask] = { ...(a ?? { lastAskedAt: now, declined: 0 }), acceptedAt: now };
      // A personal grant lights a personal moment (§4.11 "personal grants: that person"), never inferred from usage.
      const next = (ctx.accessMoments ?? []).find((id) => MOMENT_ID.test(id) && !play.litMine.some((l) => l.id === id));
      if (next && play.litMine.length < PLAY_LIMITS.litMine) play.litMine.push({ id: next, litAt: now });
      return done();
    }
    case 'seasonCelebrated': {
      const on = activeSeason(now, tz);
      if (!on || on.season !== m.season) return done('out_of_season');
      if (play.seasons[m.season] === on.year) return done('noop');
      if (ctx.celebratedElsewhere?.has(m.season)) return done('elsewhere');
      play.seasons[m.season] = on.year;
      addItem(play, SEASON_KEEPSAKE[m.season], now);
      addPage(play, m.season, now);
      return done();
    }
    case 'roomVisited': {
      const id = roomMoment(m.room);
      if (play.litMine.some((l) => l.id === id)) return done('noop');
      if (play.litMine.length >= PLAY_LIMITS.litMine) return done('capped');
      play.litMine.push({ id, litAt: now });
      return done();
    }
  }
}

/* ---------- stored records ---------- */

const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const count = (v: unknown, max: number) => Math.min(max, Math.max(0, Math.floor(num(v, 0))));
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dayKey = (v: unknown) => typeof v === 'string' && DAY_KEY.test(v) ? v : undefined;
const HASH = /^[0-9a-f]{8}$/;
const NOTE_REF = /^[0-9a-f]{16,64}$/;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/**
 * A stored record as PetPlay, or null if it is not one for this agent and person. Unknown ids, free text, negative or
 * oversized counts and over-long arrays are dropped, so a hand-edited or older record can never carry content.
 */
export function sanitizePlay(raw: unknown, agentId: string, userId: number): PetPlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.agentId !== agentId || r.userId !== userId) return null;
  const createdAt = num(r.createdAt, 0), updatedAt = num(r.updatedAt, createdAt);
  const play = newPlay(agentId, userId, createdAt);
  play.updatedAt = updatedAt;
  play.seenAt = num(r.seenAt, updatedAt);

  const seen = new Set<string>();
  for (const i of Array.isArray(r.items) ? r.items : []) {
    const o = obj(i);
    if (oneOf(KEEPSAKE_IDS, o.id) && !seen.has(o.id) && play.items.length < PLAY_LIMITS.items) { seen.add(o.id); play.items.push({ id: o.id, earnedAt: num(o.earnedAt, createdAt) }); }
  }
  const wearing = obj(r.wearing);
  for (const slot of WEAR_SLOTS) if (oneOf(WEARABLE_IDS, wearing[slot])) play.wearing[slot] = wearing[slot] as WearableId;

  const g = obj(r.garden);
  if (oneOf(SEED_KINDS, g.seed)) {
    const wateredDay = dayKey(g.wateredDay);
    play.garden = { seed: g.seed, plantedAt: num(g.plantedAt, createdAt), waterings: count(g.waterings, PLAY_LIMITS.bloomWaterings),
      ...(wateredDay ? { wateredDay } : {}), ...(typeof g.bloomedAt === 'number' && Number.isFinite(g.bloomedAt) ? { bloomedAt: g.bloomedAt } : {}) };
  }
  const pages = new Set<string>();
  for (const b of Array.isArray(r.book) ? r.book : []) {
    const o = obj(b);
    if (oneOf(BOOK_MOMENT_IDS, o.id) && !pages.has(o.id) && play.book.length < PLAY_LIMITS.book) { pages.add(o.id); play.book.push({ id: o.id, at: num(o.at, createdAt) }); }
  }
  const games = obj(r.games);
  for (const id of GAME_IDS) {
    const o = obj(games[id]);
    if (!Object.keys(o).length) continue;
    const day = dayKey(o.day) ?? '1970-01-01';
    play.games[id] = { rounds: count(o.rounds, PLAY_LIMITS.roundsCap), best: o.best === true, zen: o.zen === true, day, today: count(o.today, PLAY_LIMITS.roundsPerDay),
      ...(typeof o.lastRound === 'string' && HASH.test(o.lastRound) ? { lastRound: o.lastRound } : {}) };
  }
  const tips = obj(r.tips);
  for (const id of TIP_IDS) {
    const o = obj(tips[id]);
    if (!Object.keys(o).length) continue;
    const lastDay = dayKey(o.lastDay);
    play.tips[id] = { shown: count(o.shown, PLAY_LIMITS.tipShowsPerLife), dismissed: o.dismissed === true,
      ...(typeof o.lastShownAt === 'number' && Number.isFinite(o.lastShownAt) ? { lastShownAt: o.lastShownAt } : {}), ...(lastDay ? { lastDay } : {}) };
  }
  const asks = obj(r.asks);
  for (const id of ASK_IDS) {
    const o = obj(asks[id]);
    if (!Object.keys(o).length) continue;
    const lastDay = dayKey(o.lastDay);
    play.asks[id] = { lastAskedAt: num(o.lastAskedAt, 0), declined: count(o.declined, PLAY_LIMITS.maxDeclines),
      ...(typeof o.lastDeclinedAt === 'number' && Number.isFinite(o.lastDeclinedAt) ? { lastDeclinedAt: o.lastDeclinedAt } : {}), ...(lastDay ? { lastDay } : {}),
      ...(typeof o.acceptedAt === 'number' && Number.isFinite(o.acceptedAt) ? { acceptedAt: o.acceptedAt } : {}) };
  }
  const seasons = obj(r.seasons);
  for (const id of SEASON_IDS) {
    const year = seasons[id];
    if (typeof year === 'number' && Number.isSafeInteger(year) && year > 1300 && year < 1700) play.seasons[id] = year;
  }
  const lit = new Set<string>();
  for (const l of Array.isArray(r.litMine) ? r.litMine : []) {
    const o = obj(l);
    if (typeof o.id === 'string' && MOMENT_ID.test(o.id) && !lit.has(o.id) && play.litMine.length < PLAY_LIMITS.litMine) {
      lit.add(o.id);
      play.litMine.push({ id: o.id, litAt: num(o.litAt, createdAt), ...(typeof o.ref === 'string' && NOTE_REF.test(o.ref) ? { ref: o.ref } : {}) });
    }
  }
  return play;
}

/* ---------- HTTP ---------- */

/** POST …/play. `tz` rides in PET_TZ_HEADER and the care epoch in x-pet-care-epoch, as for care. */
export type PlayRequest = PlayMutation;
/** `growth`: the growth view after a roomVisited, seasonCelebrated or askAccepted op (it may have lit a moment). */
export interface PlayResponse { play: PetPlayView; now: number; guard?: PlayGuard; growth?: PetGrowthView }
