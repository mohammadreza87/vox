import { describe, expect, it } from 'vitest';
import { barVariants, detectTier, gridStagger, kindFor, screenVariants, STAGGER, stagger, type NavCtx, type NavKind } from './motion';

type Resolver = (c: NavCtx) => Record<string, unknown>;
const variant = (name: 'initial' | 'enter' | 'exit', c: NavCtx, v = screenVariants) => (v[name] as Resolver)(c);
const ctx = (kind: NavKind, o: Partial<NavCtx> = {}): NavCtx => ({ kind, delta: 1, rtl: false, reduced: false, ...o });
const r = (name: string, id?: string) => (id ? { name, id } : { name });

describe('kindFor', () => {
  it.each([
    ['push', r('home'), r('agent', 'a'), {}, 'push'],
    ['push', r('home'), r('agent', 'a'), { hero: true }, 'hero'],
    ['push', r('agent', 'a'), r('call', 'a'), { hero: true }, 'hero'],
    ['push', r('agent', 'a'), r('memories', 'a'), { hero: true }, 'push'],
    ['push', r('home'), r('spawn'), { hero: true }, 'cover'],
    ['push', r('agent', 'a'), r('fire', 'a'), {}, 'cover'],
    ['back', r('agent', 'a'), r('home'), {}, 'pop'],
    ['back', r('agent', 'a'), r('home'), { hero: true }, 'hero-pop'],
    ['back', r('call', 'a'), r('agent', 'a'), { hero: true }, 'hero-pop'],
    ['back', r('spawn'), r('home'), {}, 'uncover'],
    ['back', r('fire', 'a'), r('agent', 'a'), { hero: true }, 'uncover'],
    ['reset', r('home'), r('org'), { fromDepth: 1, toDepth: 1 }, 'tab'],
    ['reset', r('home'), r('home'), { fromDepth: 1, toDepth: 1 }, 'replace'],
    ['reset', r('spawn'), r('agent', 'a'), { fromDepth: 2, toDepth: 2, hero: true }, 'hero'],
    ['reset', r('spawn'), r('agent', 'a'), { fromDepth: 2, toDepth: 2 }, 'uncover'],
    ['reset', r('fire', 'a'), r('home'), { fromDepth: 3, toDepth: 1 }, 'uncover'],
    ['reset', r('fire', 'a'), r('spawn'), { fromDepth: 3, toDepth: 2 }, 'replace'],
    ['reset', r('agent', 'a'), r('privacy'), { fromDepth: 2, toDepth: 1 }, 'replace'],
  ] as const)('%s %o → %o %o = %s', (op, from, to, o, kind) => {
    expect(kindFor(op, from, to, o).kind).toBe(kind);
  });

  it('gives tab switches the direction of the tab index change', () => {
    expect(kindFor('reset', r('home'), r('privacy'), { fromDepth: 1, toDepth: 1 }).delta).toBe(1);
    expect(kindFor('reset', r('org'), r('groups'), { fromDepth: 1, toDepth: 1 }).delta).toBe(-1);
    expect(kindFor('push', r('home'), r('agent', 'a')).delta).toBe(1);
    expect(kindFor('back', r('agent', 'a'), r('home')).delta).toBe(-1);
  });
});

describe('screenVariants', () => {
  it('mirrors every horizontal move in RTL', () => {
    for (const kind of ['push', 'pop', 'tab'] as const) {
      const ltr = variant('initial', ctx(kind)), rtl = variant('initial', ctx(kind, { rtl: true }));
      expect(String(rtl.x).replace(/^-/, '')).toBe(String(ltr.x).replace(/^-/, ''));
      expect(String(rtl.x).startsWith('-')).toBe(!String(ltr.x).startsWith('-'));
    }
    expect(variant('initial', ctx('push')).x).toBe('100%');
    expect(variant('initial', ctx('push', { rtl: true })).x).toBe('-100%');
    expect(variant('exit', ctx('push')).x).toBe('-28%');
    expect(variant('exit', ctx('push', { rtl: true })).x).toBe('28%');
    expect(variant('initial', ctx('tab', { delta: -1, rtl: true })).x).toBe(24);
  });

  it('is opacity-only under reduced motion, for screens and the tab bar', () => {
    for (const kind of ['push', 'pop', 'hero', 'hero-pop', 'cover', 'uncover', 'tab', 'replace'] as const) {
      for (const v of [screenVariants, barVariants]) {
        expect(Object.keys(variant('initial', ctx(kind, { reduced: true }), v))).toEqual(['opacity']);
        expect(Object.keys(variant('exit', ctx(kind, { reduced: true }), v)).filter((k) => k !== 'transition')).toEqual(['opacity']);
      }
    }
  });

  it('never animates box-shadow or filters, and releases z-index at rest', () => {
    for (const kind of ['push', 'pop', 'hero', 'hero-pop', 'cover', 'uncover', 'tab', 'replace'] as const) {
      for (const name of ['initial', 'enter', 'exit'] as const) {
        const keys = Object.keys(variant(name, ctx(kind)));
        expect(keys).not.toContain('boxShadow');
        expect(keys).not.toContain('filter');
      }
      expect(variant('enter', ctx(kind)).transitionEnd).toMatchObject({ zIndex: 'auto' });
    }
  });

  it('keeps a hero destination opaque, so the flying face is never see-through', () => {
    expect(variant('initial', ctx('hero')).opacity).toBe(1);
    expect(variant('initial', ctx('hero-pop')).opacity).toBe(1);
  });

  it('stacks the arriving screen above the leaving one', () => {
    const z = (name: 'initial' | 'exit', kind: NavKind) => variant(name, ctx(kind)).zIndex as number;
    expect(z('initial', 'push')).toBeGreaterThan(z('exit', 'push'));
    expect(z('exit', 'pop')).toBeGreaterThan(z('initial', 'pop'));
    expect(z('initial', 'cover')).toBeGreaterThan(z('exit', 'cover'));
    expect(z('exit', 'uncover')).toBeGreaterThan(z('initial', 'uncover'));
  });
});

describe('stagger', () => {
  it('steps 30 ms and caps at 240 ms', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(1)).toBeCloseTo(0.03);
    expect(stagger(8)).toBeCloseTo(0.24);
    expect(stagger(40)).toBe(STAGGER.max);
  });
  it('runs grids as a diagonal wave with the same cap', () => {
    expect(gridStagger(0)).toBe(0);
    expect(gridStagger(1)).toBeCloseTo(0.035);
    expect(gridStagger(2)).toBeCloseTo(0.035);
    expect(gridStagger(3)).toBeCloseTo(0.07);
    expect(gridStagger(99)).toBe(STAGGER.max);
  });
});

describe('detectTier', () => {
  const ua = (s: string, extra: { hardwareConcurrency?: number; deviceMemory?: number } = {}) =>
    ({ userAgent: s, hardwareConcurrency: 8, ...extra });
  const android = (cls: string) => `Mozilla/5.0 (Linux; Android 13; Pixel 4a) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Telegram-Android/11.4.2 (Google Pixel 4a; Android 13; SDK 33; ${cls})`;
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

  it('reads the Telegram Android performance class', () => {
    expect(detectTier(false, ua(android('LOW')))).toBe('lite');
    expect(detectTier(false, ua(android('AVERAGE')))).toBe('full');
    expect(detectTier(false, ua(android('HIGH'), { hardwareConcurrency: 4 }))).toBe('full');
  });
  it('falls back to memory, and to core count on Android only', () => {
    expect(detectTier(false, ua('Mozilla/5.0 (Linux; Android 10)', { deviceMemory: 2 }))).toBe('lite');
    expect(detectTier(false, ua('Mozilla/5.0 (Linux; Android 10)', { hardwareConcurrency: 4 }))).toBe('lite');
    expect(detectTier(false, ua(iphone, { hardwareConcurrency: 2 }))).toBe('full');
    expect(detectTier(false, ua(iphone))).toBe('full');
  });
  it('lets reduced motion win, and survives no navigator', () => {
    expect(detectTier(true, ua(android('HIGH')))).toBe('reduced');
    expect(detectTier(false, undefined)).toBe('full');
  });
});
