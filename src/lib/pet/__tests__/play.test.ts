import { describe, expect, it } from 'vitest';
import {
  activeSeason, applyPlay, askEligible, gardenState, localDay, newPlay, persianDate, PLAY_LIMITS, playView, roundHash, roundsBucket,
  sanitizePlay, tipEligible, type PetPlay, type PlayContext, type PlayMutation,
} from '../play';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 26 Oct 2026, 15:30 in Tehran: no festival. */
const T = Date.UTC(2026, 9, 26, 12);
const ctx = (over: Partial<PlayContext> = {}): PlayContext => ({ now: T, tz: 'Asia/Tehran', stage: 1, formed: false, bond: 0, ...over });
const fresh = () => newPlay('agent-a', 7, T - DAY);

/** Applies mutations in order, each at its own time; returns the last result. */
function run(start: PetPlay, steps: Array<[PlayMutation, Partial<PlayContext>?]>) {
  let play = start;
  let last: ReturnType<typeof applyPlay> = { play };
  for (const [m, over] of steps) { last = applyPlay(play, m, ctx(over)); play = last.play; }
  return last;
}

describe('the Persian calendar and festivals (§4.10)', () => {
  it('reads the Solar Hijri date in the person zone', () => {
    expect(persianDate(Date.UTC(2026, 2, 21, 8), 'Asia/Tehran')).toMatchObject({ year: 1405, month: 1, day: 1 });
    expect(persianDate(Date.UTC(2026, 11, 21, 8), 'Asia/Tehran')).toMatchObject({ year: 1405, month: 9, day: 30 });
  });

  it('knows Nowruz (1-13 Farvardin), Yalda night and Chaharshanbe Suri, and nothing on an ordinary day', () => {
    expect(activeSeason(T, 'Asia/Tehran')).toBeNull();
    expect(activeSeason(Date.UTC(2027, 2, 21, 9), 'Asia/Tehran')).toEqual({ season: 'nowruz', year: 1406 });
    expect(activeSeason(Date.UTC(2027, 3, 2, 9), 'Asia/Tehran')).toEqual({ season: 'nowruz', year: 1406 }); // 13 Farvardin
    expect(activeSeason(Date.UTC(2027, 3, 3, 9), 'Asia/Tehran')).toBeNull(); // 14 Farvardin
    // Yalda 1405: the evening of 30 Azar (21 Dec 2026) through the next morning
    expect(activeSeason(Date.UTC(2026, 11, 21, 15), 'Asia/Tehran')).toEqual({ season: 'yalda', year: 1405 });
    expect(activeSeason(Date.UTC(2026, 11, 22, 5), 'Asia/Tehran')).toEqual({ season: 'yalda', year: 1405 });
    expect(activeSeason(Date.UTC(2026, 11, 22, 12), 'Asia/Tehran')).toBeNull();
    // Suri 1405: Tuesday 25 Esfand (16 Mar 2027), the eve of the last Wednesday, through Wednesday morning
    expect(activeSeason(Date.UTC(2027, 2, 16, 15), 'Asia/Tehran')).toEqual({ season: 'suri', year: 1405 });
    expect(activeSeason(Date.UTC(2027, 2, 17, 5), 'Asia/Tehran')).toEqual({ season: 'suri', year: 1405 });
    expect(activeSeason(Date.UTC(2027, 2, 17, 12), 'Asia/Tehran')).toBeNull();
    expect(activeSeason(Date.UTC(2027, 2, 9, 15), 'Asia/Tehran')).toBeNull(); // an earlier Tuesday in Esfand
    // a 30-day Esfand (1403): Tuesday 28 Esfand, 18 Mar 2025
    expect(activeSeason(Date.UTC(2025, 2, 18, 15), 'Asia/Tehran')).toEqual({ season: 'suri', year: 1403 });
    expect(activeSeason(Date.UTC(2025, 2, 11, 15), 'Asia/Tehran')).toBeNull();
  });

  it('cuts days at the person midnight, and survives an unknown zone', () => {
    expect(localDay(Date.UTC(2026, 9, 26, 21), 'Asia/Tehran')).toBe('2026-10-27');
    expect(localDay(Date.UTC(2026, 9, 26, 21), 'UTC')).toBe('2026-10-26');
    expect(localDay(T, 'Nowhere/Land')).toBe('2026-10-26');
  });
});

describe('the garden never wilts (§4.5)', () => {
  it('plants one seed at a time, waters once a local day, and blooms after three days with a keepsake and a page', () => {
    let r = run(fresh(), [[{ op: 'plantSeed', seed: 'flower' }]]);
    expect(r.guard).toBeUndefined();
    expect(gardenState(r.play.garden, T, 'Asia/Tehran')).toBe('seeded');
    expect(applyPlay(r.play, { op: 'plantSeed', seed: 'flower' }, ctx()).guard).toBe('noop');
    expect(applyPlay(r.play, { op: 'plantSeed', seed: 'sabzeh' }, ctx()).guard).toBe('busy');
    r = run(r.play, [[{ op: 'waterSeed' }]]);
    expect(r.play.garden).toMatchObject({ waterings: 1 });
    expect(gardenState(r.play.garden, T, 'Asia/Tehran')).toBe('watered');
    expect(applyPlay(r.play, { op: 'waterSeed' }, ctx({ now: T + HOUR })).guard).toBe('noop');
    r = run(r.play, [[{ op: 'waterSeed' }, { now: T + DAY }]]);
    expect(r.play.garden?.bloomedAt).toBeUndefined();
    // away for a month: nothing is lost, it is simply ready
    expect(gardenState(r.play.garden, T + 30 * DAY, 'Asia/Tehran')).toBe('ready');
    r = run(r.play, [[{ op: 'waterSeed' }, { now: T + 30 * DAY }]]);
    expect(r.play.garden).toMatchObject({ waterings: 3, bloomedAt: T + 30 * DAY });
    expect(r.play.items.map((i) => i.id)).toEqual(['bloomPin']);
    expect(r.play.book.map((b) => b.id)).toEqual(['bloom']);
    expect(gardenState(r.play.garden, T + 30 * DAY + HOUR, 'Asia/Tehran')).toBe('blooming');
    expect(gardenState(r.play.garden, T + 32 * DAY, 'Asia/Tehran')).toBe('bloomed');
    expect(applyPlay(r.play, { op: 'waterSeed' }, ctx({ now: T + 31 * DAY })).guard).toBe('noop');
    // after a bloom a new seed may be planted; the keepsake and page stay, once
    r = run(r.play, [[{ op: 'plantSeed', seed: 'flower' }, { now: T + 31 * DAY }]]);
    expect(r.play.garden).toEqual({ seed: 'flower', plantedAt: T + 31 * DAY, waterings: 0 });
    expect(r.play.items).toHaveLength(1);
  });

  it('counts waterings by the person local day, not by 24 hours, and blooms once sprouted', () => {
    const planted = run(fresh(), [[{ op: 'plantSeed', seed: 'flower' }, { now: Date.UTC(2026, 9, 26, 20, 0) }]]).play; // 23:30 Tehran
    const r = run(planted, [
      [{ op: 'waterSeed' }, { now: Date.UTC(2026, 9, 26, 20, 10) }],
      [{ op: 'waterSeed' }, { now: Date.UTC(2026, 9, 26, 21, 0) }], // 00:30 the next local day
      [{ op: 'waterSeed' }, { now: Date.UTC(2026, 9, 27, 21, 0) }], // and the next
    ]);
    expect(r.play.garden).toMatchObject({ waterings: 3 });
    expect(r.play.garden?.bloomedAt).toBe(Date.UTC(2026, 9, 27, 21, 0));
  });

  it('the sabzeh seed is planted only during Nowruz', () => {
    expect(applyPlay(fresh(), { op: 'plantSeed', seed: 'sabzeh' }, ctx()).guard).toBe('out_of_season');
    expect(applyPlay(fresh(), { op: 'plantSeed', seed: 'sabzeh' }, ctx({ now: Date.UTC(2027, 2, 22, 9) })).guard).toBeUndefined();
  });
});

describe('earned, never bought (§4.3, §4.7)', () => {
  it('lights a keepsake only once it is earned, and wears only what is owned in its own slot', () => {
    expect(applyPlay(fresh(), { op: 'lightItem', item: 'starPin' }, ctx({ bond: 149 })).guard).toBe('locked');
    const lit = applyPlay(fresh(), { op: 'lightItem', item: 'starPin' }, ctx({ bond: 150 }));
    expect(lit.guard).toBeUndefined();
    expect(lit.play.items).toEqual([{ id: 'starPin', earnedAt: T }]);
    expect(applyPlay(lit.play, { op: 'lightItem', item: 'starPin' }, ctx({ bond: 150 })).guard).toBe('noop');
    expect(applyPlay(fresh(), { op: 'lightItem', item: 'pomegranateCrown' }, ctx()).guard).toBe('locked');
    expect(applyPlay(fresh(), { op: 'lightItem', item: 'bloomPin' }, ctx()).guard).toBe('locked');

    expect(applyPlay(fresh(), { op: 'wear', slot: 'neck', item: 'starPin' }, ctx()).guard).toBe('locked');
    expect(applyPlay(lit.play, { op: 'wear', slot: 'head', item: 'starPin' }, ctx()).guard).toBe('locked');
    const worn = applyPlay(lit.play, { op: 'wear', slot: 'neck', item: 'starPin' }, ctx());
    expect(worn.play.wearing).toEqual({ neck: 'starPin' });
    expect(applyPlay(worn.play, { op: 'wear', slot: 'neck', item: 'starPin' }, ctx()).guard).toBe('noop');
    const beret = applyPlay(worn.play, { op: 'wear', slot: 'head', item: 'beret' }, ctx());
    expect(beret.play.wearing).toEqual({ neck: 'starPin', head: 'beret' });
    const off = applyPlay(beret.play, { op: 'wear', slot: 'neck', item: null }, ctx());
    expect(off.play.wearing).toEqual({ head: 'beret' });
    expect(applyPlay(off.play, { op: 'wear', slot: 'neck', item: null }, ctx()).guard).toBe('noop');
  });

  it('adds a Life Book page only for a moment that happened, once', () => {
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'met' }, ctx()).play.book).toEqual([{ id: 'met', at: T }]);
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'stage3' }, ctx({ stage: 2 })).guard).toBe('locked');
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'stage3' }, ctx({ stage: 3 })).guard).toBeUndefined();
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'formed' }, ctx({ stage: 4 })).guard).toBe('locked');
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'formed' }, ctx({ stage: 4, formed: true })).guard).toBeUndefined();
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'bond2' }, ctx({ bond: 49 })).guard).toBe('locked');
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'bond2' }, ctx({ bond: 50 })).guard).toBeUndefined();
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'bloom' }, ctx()).guard).toBe('locked');
    expect(applyPlay(fresh(), { op: 'bookMoment', moment: 'bestBop' }, ctx()).guard).toBe('locked');
    const met = applyPlay(fresh(), { op: 'bookMoment', moment: 'met' }, ctx()).play;
    expect(applyPlay(met, { op: 'bookMoment', moment: 'met' }, ctx()).guard).toBe('noop');
  });
});

describe('games: outcomes only, rounds as a bucket (§4.2)', () => {
  it('a retried round id is one round; best sets the flag and adds the page; zen is the last mode', () => {
    let r = run(fresh(), [[{ op: 'gameRound', game: 'starfall', outcome: 'zen', round: 'round-0001' }]]);
    expect(r.play.games.starfall).toMatchObject({ rounds: 1, zen: true, best: false });
    expect(applyPlay(r.play, { op: 'gameRound', game: 'starfall', outcome: 'zen', round: 'round-0001' }, ctx()).guard).toBe('noop');
    r = run(r.play, [[{ op: 'gameRound', game: 'starfall', outcome: 'best', round: 'round-0002' }]]);
    expect(r.play.games.starfall).toMatchObject({ rounds: 2, zen: false, best: true });
    expect(r.play.book.map((b) => b.id)).toEqual(['bestStarfall']);
    // the round id itself is never stored
    expect(JSON.stringify(r.play)).not.toContain('round-0002');
    expect(r.play.games.starfall?.lastRound).toBe(roundHash('round-0002'));
  });

  it('records at most roundsPerDay rounds a local day, and counts only up to the bucket cap', () => {
    let play = fresh();
    for (let i = 0; i < PLAY_LIMITS.roundsPerDay; i++) play = applyPlay(play, { op: 'gameRound', game: 'bop', outcome: 'finished', round: `r-${String(i).padStart(8, '0')}` }, ctx()).play;
    expect(applyPlay(play, { op: 'gameRound', game: 'bop', outcome: 'finished', round: 'r-overflow' }, ctx()).guard).toBe('capped');
    expect(play.games.bop?.rounds).toBe(PLAY_LIMITS.roundsCap);
    expect(applyPlay(play, { op: 'gameRound', game: 'bop', outcome: 'finished', round: 'r-tomorrow' }, ctx({ now: T + DAY })).guard).toBeUndefined();
    expect(playView(play, T, 'Asia/Tehran').games.bop).toEqual({ rounds: 'many', best: false, zen: false });
    expect([0, 1, 5, 10].map(roundsBucket)).toEqual(['none', 'one', 'few', 'many']);
  });
});

describe('tips (§7.1) and asks (§6.1)', () => {
  it('a tip shows at most twice in its life, three tips a day, and a dismissed tip never returns', () => {
    let play = fresh();
    play = applyPlay(play, { op: 'tipSeen', tip: 'T1' }, ctx()).play;
    expect(applyPlay(play, { op: 'tipSeen', tip: 'T1' }, ctx({ now: T + HOUR })).guard).toBe('noop');
    play = applyPlay(play, { op: 'tipSeen', tip: 'T2' }, ctx()).play;
    play = applyPlay(play, { op: 'tipSeen', tip: 'T3' }, ctx()).play;
    expect(tipEligible(play, 'T4', T, 'Asia/Tehran')).toBe(false);
    expect(applyPlay(play, { op: 'tipSeen', tip: 'T4' }, ctx()).guard).toBe('capped');
    expect(playView(play, T, 'Asia/Tehran').tipsToday).toBe(3);
    play = applyPlay(play, { op: 'tipSeen', tip: 'T1' }, ctx({ now: T + DAY })).play;
    expect(play.tips.T1).toMatchObject({ shown: 2 });
    expect(applyPlay(play, { op: 'tipSeen', tip: 'T1' }, ctx({ now: T + 2 * DAY })).guard).toBe('spent');
    play = applyPlay(play, { op: 'tipDismissed', tip: 'T2' }, ctx({ now: T + 2 * DAY })).play;
    expect(applyPlay(play, { op: 'tipDismissed', tip: 'T2' }, ctx({ now: T + 2 * DAY })).guard).toBe('noop');
    expect(applyPlay(play, { op: 'tipSeen', tip: 'T2' }, ctx({ now: T + 3 * DAY })).guard).toBe('spent');
    expect(tipEligible(play, 'T2', T + 3 * DAY, 'Asia/Tehran')).toBe(false);
    expect(tipEligible(play, 'T5', T + 3 * DAY, 'Asia/Tehran')).toBe(true);
  });

  it('after one decline an ask returns only after 30 days; after two, never on its own; a double decline counts once', () => {
    let play = applyPlay(fresh(), { op: 'askSeen', ask: 'P1' }, ctx()).play;
    expect(applyPlay(fresh(), { op: 'askDeclined', ask: 'P1' }, ctx()).guard).toBe('noop');
    play = applyPlay(play, { op: 'askDeclined', ask: 'P1' }, ctx()).play;
    expect(applyPlay(play, { op: 'askDeclined', ask: 'P1' }, ctx({ now: T + 1000 })).guard).toBe('noop');
    expect(play.asks.P1).toMatchObject({ declined: 1, lastAskedAt: T });
    expect(askEligible(play, 'P1', T + 29 * DAY)).toBe(false);
    expect(applyPlay(play, { op: 'askSeen', ask: 'P1' }, ctx({ now: T + 29 * DAY })).guard).toBe('too_soon');
    expect(askEligible(play, 'P1', T + 30 * DAY)).toBe(true);
    play = applyPlay(play, { op: 'askSeen', ask: 'P1' }, ctx({ now: T + 30 * DAY })).play;
    play = applyPlay(play, { op: 'askDeclined', ask: 'P1' }, ctx({ now: T + 30 * DAY })).play;
    expect(play.asks.P1?.declined).toBe(2);
    expect(askEligible(play, 'P1', T + 400 * DAY)).toBe(false);
    expect(applyPlay(play, { op: 'askSeen', ask: 'P1' }, ctx({ now: T + 400 * DAY })).guard).toBe('spent');
    expect(askEligible(play, 'P8', T)).toBe(true);
  });
});

describe('festivals and personal growth moments', () => {
  const yalda = Date.UTC(2026, 11, 21, 15);
  it('celebrates once per Persian year, only while the festival is on, earning its keepsake and page', () => {
    expect(applyPlay(fresh(), { op: 'seasonCelebrated', season: 'yalda' }, ctx()).guard).toBe('out_of_season');
    expect(applyPlay(fresh(), { op: 'seasonCelebrated', season: 'nowruz' }, ctx({ now: yalda })).guard).toBe('out_of_season');
    const r = applyPlay(fresh(), { op: 'seasonCelebrated', season: 'yalda' }, ctx({ now: yalda }));
    expect(r.play.seasons).toEqual({ yalda: 1405 });
    expect(r.play.items.map((i) => i.id)).toEqual(['pomegranateCrown']);
    expect(r.play.book.map((b) => b.id)).toEqual(['yalda']);
    expect(applyPlay(r.play, { op: 'seasonCelebrated', season: 'yalda' }, ctx({ now: yalda + HOUR })).guard).toBe('noop');
    expect(applyPlay(fresh(), { op: 'seasonCelebrated', season: 'yalda' }, ctx({ now: yalda, celebratedElsewhere: new Set(['yalda']) })).guard).toBe('elsewhere');
    expect(applyPlay(r.play, { op: 'lightItem', item: 'pomegranateCrown' }, ctx()).guard).toBe('noop');
  });

  it('a first room visit lights a personal room moment once', () => {
    const r = applyPlay(fresh(), { op: 'roomVisited', room: 'garden' }, ctx());
    expect(r.play.litMine).toEqual([{ id: 'room-garden', litAt: T }]);
    expect(applyPlay(r.play, { op: 'roomVisited', room: 'garden' }, ctx()).guard).toBe('noop');
  });
});

describe('the record stays content-free (§3.4)', () => {
  it('never mutates its input', () => {
    const play = fresh();
    const before = structuredClone(play);
    applyPlay(play, { op: 'plantSeed', seed: 'flower' }, ctx());
    expect(play).toEqual(before);
  });

  it('sanitize drops unknown ids, free text, extra fields and bad counts, and keeps identity strict', () => {
    const raw = {
      ...fresh(), note: 'I feel lonely today', items: [{ id: 'starPin', earnedAt: T }, { id: 'starPin', earnedAt: T }, { id: 'goldenCoin', earnedAt: T }],
      wearing: { head: 'beret', neck: 'my secret', tail: 'bow' }, garden: { seed: 'flower', plantedAt: T, waterings: 99, wateredDay: 'yesterday', comment: 'hi' },
      book: [{ id: 'met', at: T, text: 'we met at the cafe' }, { id: 'diary' }], games: { bop: { rounds: -4, best: 'yes', zen: true, day: '2026-10-26', today: 1e9, lastRound: 'free text!' }, chess: {} },
      tips: { T1: { shown: 7, dismissed: true }, T99: { shown: 1 } }, asks: { P1: { lastAskedAt: T, declined: 5 }, X: {} },
      seasons: { yalda: 1405, christmas: 2026, nowruz: 'soon' }, litMine: [{ id: 'room-play', litAt: T }, { id: 'Taught: how Reza plans', litAt: T }],
    };
    const clean = sanitizePlay(raw, 'agent-a', 7)!;
    expect(clean).not.toHaveProperty('note');
    expect(clean.items).toEqual([{ id: 'starPin', earnedAt: T }]);
    expect(clean.wearing).toEqual({ head: 'beret' });
    expect(clean.garden).toEqual({ seed: 'flower', plantedAt: T, waterings: 3 });
    expect(clean.book).toEqual([{ id: 'met', at: T }]);
    expect(clean.games).toEqual({ bop: { rounds: 0, best: false, zen: true, day: '2026-10-26', today: PLAY_LIMITS.roundsPerDay } });
    expect(clean.tips).toEqual({ T1: { shown: 2, dismissed: true } });
    expect(clean.asks).toEqual({ P1: { lastAskedAt: T, declined: 2 } });
    expect(clean.seasons).toEqual({ yalda: 1405 });
    expect(clean.litMine).toEqual([{ id: 'room-play', litAt: T }]);
    expect(JSON.stringify(clean)).not.toMatch(/lonely|secret|cafe|Reza|free text/);
    expect(sanitizePlay(null, 'agent-a', 7)).toBeNull();
    expect(sanitizePlay({ ...raw, v: 2 }, 'agent-a', 7)).toBeNull();
    expect(sanitizePlay(raw, 'agent-b', 7)).toBeNull();
    expect(sanitizePlay(raw, 'agent-a', 8)).toBeNull();
  });

  it('the view hides identity and round hashes and derives the garden state and festival', () => {
    const play = applyPlay(fresh(), { op: 'gameRound', game: 'hum', outcome: 'finished', round: 'abcdefgh' }, ctx()).play;
    const view = playView(play, Date.UTC(2027, 2, 22, 9), 'Asia/Tehran');
    expect(view).not.toHaveProperty('agentId');
    expect(view).not.toHaveProperty('userId');
    expect(JSON.stringify(view)).not.toContain(roundHash('abcdefgh'));
    expect(view).toMatchObject({ garden: null, season: 'nowruz', games: { hum: { rounds: 'one', best: false, zen: false } }, tipsToday: 0 });
    expect(playView(play, T, 'Asia/Tehran')).not.toHaveProperty('season');
  });
});
