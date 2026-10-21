import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterLook } from '@/lib/studio/types';

/**
 * The wrapper's transform under framer's rules: each animation owns the values it targets until a
 * newer animation on the same element takes them; an animation that runs to the end commits the
 * values it still owns. Rig MotionValues complete at once (skipAnimations, as in every other test).
 */
const wrap = vi.hoisted(() => ({
  values: new Map<object, Record<string, number>>(),
  owner: new Map<object, Map<string, object>>(),
}));
vi.mock('framer-motion', async (orig) => {
  const fm = await orig<typeof import('framer-motion')>();
  const animate = ((target: unknown, kf: unknown, t?: Record<string, number>) => {
    if (!(target instanceof HTMLElement)) return (fm.animate as (...a: unknown[]) => unknown)(target, kf, t);
    const token = {};
    const owned = wrap.owner.get(target) ?? new Map<string, object>();
    wrap.owner.set(target, owned);
    const props = Object.entries(kf as Record<string, number | number[]>);
    for (const [prop] of props) owned.set(prop, token);
    const ms = 1000 * (t?.duration ?? t?.visualDuration ?? 0);
    return new Promise<void>((done) => setTimeout(() => {
      const v = wrap.values.get(target) ?? {};
      for (const [prop, to] of props) if (owned.get(prop) === token) v[prop] = Array.isArray(to) ? to[to.length - 1] : to;
      wrap.values.set(target, v);
      done();
    }, ms));
  }) as typeof fm.animate;
  return { ...fm, animate };
});

const { Cloud } = await import('./Cloud');
const { TierProvider } = await import('./motion/tier');

const plain: CharacterLook = { hue: 'lilac', family: 'puff', species: 'cloud', features: { cheeks: true, lashes: false, brows: false } };
const cat: CharacterLook = { ...plain, species: 'cat' };
const dressed: CharacterLook = { ...cat, hair: 'fringe', accessory: 'beret' };

function hero(look: CharacterLook) {
  return <TierProvider value="full"><Cloud look={look} size={200} stage={4} lod="hero" /></TierProvider>;
}
const atRest = (el: HTMLElement) => {
  const v = wrap.values.get(el) ?? {};
  return { x: v.x ?? 0, y: v.y ?? 0, scale: v.scale ?? 1, scaleX: v.scaleX ?? 1, scaleY: v.scaleY ?? 1 };
};
const REST = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1 };
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { wrap.values.clear(); wrap.owner.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Cloud look-change choreography', () => {
  it('a structure change, then hair and accessory within its squash, leaves the wrapper at rest', async () => {
    const { container, rerender } = render(hero(plain));
    const el = container.querySelector('.vx-char') as HTMLElement;
    await tick(0);
    rerender(hero(cat));        // species: squash 160 ms, swap, stretch
    await tick(100);
    rerender(hero(dressed));    // inside the squash: diffs from the old look, so the dice path runs
    await tick(3000);
    expect(atRest(el)).toEqual(REST);
    expect(el.style.willChange).toBe('');
  });

  it('a hair change during the stretch still lands the wrapper at rest', async () => {
    const { container, rerender } = render(hero(plain));
    const el = container.querySelector('.vx-char') as HTMLElement;
    await tick(0);
    rerender(hero(cat));
    await tick(200);            // swapped, mid-stretch
    rerender(hero({ ...cat, hair: 'fringe' }));
    await tick(3000);
    expect(atRest(el)).toEqual(REST);
  });

  it('an uninterrupted structure change lands at rest', async () => {
    const { container, rerender } = render(hero(plain));
    const el = container.querySelector('.vx-char') as HTMLElement;
    await tick(0);
    rerender(hero(cat));
    await tick(3000);
    expect(atRest(el)).toEqual(REST);
  });
});
