import { describe, expect, it } from 'vitest';
import { emptyPlay, care } from './host.fixture';
import { NO_SIGNALS, openOver, rankTips, readSignals, TIP_OPEN_MS, tipAllowed, TIPS, writeSignals, type TipMoment } from './tips';
import { EN } from './strings/en';
import { FA } from './strings/fa';

const moment = (o: Partial<TipMoment> = {}): TipMoment => ({ care: care(), hour: 12, micAvailable: true, openedAsleep: false, grown: false, settled: false, quickRounds: 0, ...o });

describe('tips v1 ranker (design §7)', () => {
  it('the opening seconds are the hello\'s: no tip before the hello, then only after a first touch or 20 s (§7.1, P-16)', () => {
    expect(TIP_OPEN_MS).toBe(20_000);
    expect(openOver({ hello: false, touched: true, sinceHelloMs: 60_000 })).toBe(false);
    expect(openOver({ hello: true, touched: false, sinceHelloMs: 6_000 })).toBe(false);
    expect(openOver({ hello: true, touched: false, sinceHelloMs: 19_999 })).toBe(false);
    expect(openOver({ hello: true, touched: false, sinceHelloMs: 20_000 })).toBe(true);
    expect(openOver({ hello: true, touched: true, sinceHelloMs: 500 })).toBe(true);
  });

  it('fits a tip only when its content-free signal holds (T1: three cookie taps and never a drag)', () => {
    const play = emptyPlay();
    expect(rankTips(play, { ...NO_SIGNALS, cookieTaps: 2 }, moment(), false)).toBeNull();
    expect(rankTips(play, { ...NO_SIGNALS, cookieTaps: 3 }, moment(), false)?.id).toBe('T1');
    expect(rankTips(play, { ...NO_SIGNALS, cookieTaps: 3, drags: 1 }, moment(), false)).toBeNull();
  });

  it('one tip a session, three a day, a dismissed tip never returns, at most twice in a life (§7.1)', () => {
    const s = { ...NO_SIGNALS, cookieTaps: 5 };
    expect(rankTips(emptyPlay(), s, moment(), true)).toBeNull();
    expect(rankTips(emptyPlay({ tipsToday: 3 }), s, moment(), false)).toBeNull();
    expect(rankTips(emptyPlay({ tips: { T1: { shown: 1, dismissed: true } } }), s, moment(), false)).toBeNull();
    expect(rankTips(emptyPlay({ tips: { T1: { shown: 2, dismissed: false } } }), s, moment(), false)).toBeNull();
    expect(tipAllowed(emptyPlay({ tips: { T1: { shown: 1, dismissed: false } } }), 'T1')).toBe(true);
    // no play record (a Wave A server): no tips at all
    expect(rankTips(undefined, s, moment(), false)).toBeNull();
  });

  it('ranks the tip shown fewer times first, then by the catalogue (T9 settle leads; T6 after two quick rounds)', () => {
    const s = { ...NO_SIGNALS, cookieTaps: 3, sessions: 2 };
    expect(rankTips(emptyPlay(), s, moment({ settled: true }), false)?.id).toBe('T9');
    expect(rankTips(emptyPlay(), s, moment({ quickRounds: 2 }), false)?.id).toBe('T6');
    expect(rankTips(emptyPlay({ tips: { T1: { shown: 1, dismissed: false } } }), s, moment(), false)?.id).toBe('T2');
  });

  it('the evening moon (T7), rooms when Joy wants (T5), the mic after typing (T4), night rules on the first quiet open (T8)', () => {
    expect(rankTips(emptyPlay(), NO_SIGNALS, moment({ hour: 20, care: care({ energy: 30 }) }), false)?.id).toBe('T7');
    expect(rankTips(emptyPlay(), NO_SIGNALS, moment({ hour: 10, care: care({ energy: 30 }) }), false)).toBeNull();
    expect(rankTips(emptyPlay(), NO_SIGNALS, moment({ care: care({ joy: 40 }) }), false)?.id).toBe('T5');
    expect(rankTips(emptyPlay(), { ...NO_SIGNALS, typed: 5 }, moment(), false)?.id).toBe('T4');
    expect(rankTips(emptyPlay(), { ...NO_SIGNALS, typed: 5 }, moment({ micAvailable: false }), false)).toBeNull();
    expect(rankTips(emptyPlay(), { ...NO_SIGNALS, quietOpens: 1 }, moment({ openedAsleep: true }), false)?.id).toBe('T8');
    expect(rankTips(emptyPlay(), { ...NO_SIGNALS, quietOpens: 2 }, moment({ openedAsleep: true }), false)).toBeNull();
  });

  it('every tip line and reason line is in the catalogue in both languages; pet lines carry no digits', () => {
    for (const d of TIPS) {
      for (const k of [d.line, ...(d.why ? [d.why] : [])]) { expect(EN[k], k).toBeTruthy(); expect(FA[k], k).toBeTruthy(); }
      if (d.id !== 'T8') expect(`${EN[d.line]}${FA[d.line]}`).not.toMatch(/[0-9۰-۹]/);
    }
  });

  it('keeps its counters on this device only, and survives blocked storage', () => {
    localStorage.clear();
    writeSignals('a', { ...NO_SIGNALS, typed: 4, touched: true });
    expect(readSignals('a')).toMatchObject({ typed: 4, touched: true });
    localStorage.setItem('vox.pet.tips.b', '{"typed":-3,"touched":"yes","extra":"text"}');
    expect(readSignals('b')).toEqual(NO_SIGNALS);
    localStorage.setItem('vox.pet.tips.c', 'not json');
    expect(readSignals('c')).toEqual(NO_SIGNALS);
  });
});

describe('Wave C tips (§7.3: T10, T13, T14)', () => {
  const play = emptyPlay();
  it('T10 after a check-in opened; T13 on a second day with nothing ever planted; T14 once a keepsake is in an unopened closet', () => {
    expect(rankTips(play, NO_SIGNALS, moment({ checkinOpened: true }), false)?.id).toBe('T10');
    expect(rankTips(play, { ...NO_SIGNALS, days: 1 }, moment({ planted: false }), false)).toBeNull();
    expect(rankTips(play, { ...NO_SIGNALS, days: 2 }, moment({ planted: false }), false)?.id).toBe('T13');
    expect(rankTips(play, { ...NO_SIGNALS, days: 2 }, moment({ planted: true }), false)).toBeNull();
    // the record not read yet (planted unknown): T13 waits
    expect(rankTips(play, { ...NO_SIGNALS, days: 2 }, moment(), false)).toBeNull();
    const t14 = rankTips(play, NO_SIGNALS, moment({ keepsake: true }), false);
    expect(t14?.id).toBe('T14');
    expect(t14?.place).toEqual({ kind: 'coach', target: 'rail-closet' });
    expect(rankTips(play, { ...NO_SIGNALS, closetOpened: true }, moment({ keepsake: true }), false)).toBeNull();
  });

  it('the new counters survive a round trip and older stored counters read as zero', () => {
    writeSignals('w', { ...NO_SIGNALS, days: 3, lastDay: '2026-10-26', games: 5, gameDays: 2, lastGameDay: '2026-10-26', closetOpened: true });
    expect(readSignals('w')).toMatchObject({ days: 3, lastDay: '2026-10-26', games: 5, gameDays: 2, closetOpened: true });
    localStorage.setItem('vox.pet.tips.old', JSON.stringify({ cookieTaps: 2 }));
    expect(readSignals('old')).toMatchObject({ cookieTaps: 2, days: 0, lastDay: '', games: 0 });
  });
});

describe('Decisions\' tip hint (view.suggest.tip, design §8.2)', () => {
  it('a fitting, allowed tip goes first; one that does not fit is ignored; null means none; the hard rules still hold', () => {
    const s = { ...NO_SIGNALS, cookieTaps: 3, typed: 5 };
    expect(rankTips(emptyPlay(), s, moment(), false)?.id).toBe('T1');
    expect(rankTips(emptyPlay(), s, moment(), false, undefined, 'T4')?.id).toBe('T4');
    expect(rankTips(emptyPlay(), s, moment(), false, undefined, 'T13')?.id).toBe('T1');
    expect(rankTips(emptyPlay(), s, moment(), false, undefined, null)).toBeNull();
    expect(rankTips(emptyPlay({ tipsToday: 3 }), s, moment(), false, undefined, 'T4')).toBeNull();
    expect(rankTips(emptyPlay(), s, moment(), true, undefined, 'T4')).toBeNull();
    expect(rankTips(emptyPlay({ tips: { T4: { shown: 1, dismissed: true } } }), s, moment(), false, undefined, 'T4')?.id).toBe('T1');
  });
});
