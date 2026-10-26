import { afterEach, describe, expect, it } from 'vitest';
import { BUBBLE_LINES, bubbleWidth, heightClass, layoutOf } from './layout';
import { viewport } from './telegram';

describe('layout classes (design §9.2)', () => {
  it('keys off the available height: Peek < 480 ≤ Short < 620 ≤ Regular < 780 ≤ Tall', () => {
    expect([479, 480, 619, 620, 779, 780].map(heightClass)).toEqual(['peek', 'short', 'short', 'regular', 'regular', 'tall']);
  });

  it('Wide from 600 px wide keeps its height class (a landscape phone is wide and short, §9.4 rule 8)', () => {
    expect(layoutOf(600, 900)).toMatchObject({ cls: 'wide', h: 'tall' });
    expect(layoutOf(844, 360)).toMatchObject({ cls: 'wide', h: 'peek' });
    expect(layoutOf(599, 900).cls).toBe('tall');
  });

  it('the keyboard drops Regular and Tall to Short; the bubble keeps its budget (§9.4 rule 6)', () => {
    expect(layoutOf(390, 800, true)).toEqual({ cls: 'short', h: 'short', kb: true, bubble: 'tall' });
    expect(layoutOf(390, 400, true)).toMatchObject({ h: 'peek', kb: true });
    expect(BUBBLE_LINES).toEqual({ peek: 2, short: 3, regular: 4, tall: 5 });
    expect(bubbleWidth(320)).toBeCloseTo(249.6);
    expect(bubbleWidth(430)).toBe(320);
  });
});

describe('viewport()', () => {
  afterEach(() => { document.documentElement.style.removeProperty('--pet-vh'); document.documentElement.style.removeProperty('--pet-safe-top'); });

  it('reads the stable height and safe areas the page wrote, and the live height for the keyboard', () => {
    document.documentElement.style.setProperty('--pet-vh', '700px');
    document.documentElement.style.setProperty('--pet-safe-top', '47px');
    const v = viewport({ viewportHeight: 420 } as never);
    expect(v).toMatchObject({ w: window.innerWidth, h: 700, top: 47, bottom: 0, live: 420 });
    document.documentElement.style.removeProperty('--pet-vh');
    expect(viewport({ viewportStableHeight: 610 } as never).h).toBe(610);
    expect(viewport(null).h).toBe(window.innerHeight);
  });
});
