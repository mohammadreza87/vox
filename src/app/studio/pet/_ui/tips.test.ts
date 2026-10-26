import { describe, expect, it } from 'vitest';
import { emptyPlay, care } from './host.fixture';
import { NO_SIGNALS, rankTips, readSignals, tipAllowed, TIPS, writeSignals, type TipMoment } from './tips';
import { EN } from './strings/en';
import { FA } from './strings/fa';

const moment = (o: Partial<TipMoment> = {}): TipMoment => ({ care: care(), hour: 12, micAvailable: true, openedAsleep: false, grown: false, settled: false, quickRounds: 0, ...o });

describe('tips v1 ranker (design §7)', () => {
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
