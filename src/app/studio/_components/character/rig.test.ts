import { act, renderHook } from '@testing-library/react';
import { motionValue, type MotionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const anim = vi.hoisted(() => ({ calls: [] as { value: number; done: () => void }[] }));
vi.mock('framer-motion', async (orig) => ({
  ...await orig<typeof import('framer-motion')>(),
  // each animation resolves when the test says so
  animate: (_mv: unknown, value: number) => new Promise<void>((done) => { anim.calls.push({ value, done }); }),
}));

const { onsetDetector, useGlance, useSyllableBounce, useTwitch } = await import('./rig');
const { TALK } = await import('./poses');

beforeEach(() => { anim.calls = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useTwitch', () => {
  const ears = (): [MotionValue<number>, MotionValue<number>] => [motionValue(0), motionValue(0)];

  it('twitches, settles and schedules the next twitch while live', async () => {
    const e = ears();
    renderHook(() => useTwitch(e, true));
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(anim.calls.map((c) => Math.abs(c.value))).toEqual([14]);
    await act(async () => { anim.calls[0].done(); });
    expect(anim.calls.map((c) => c.value)).toEqual([anim.calls[0].value, 0]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('leaves no timer behind when it unmounts mid-twitch', async () => {
    const e = ears();
    const { unmount } = renderHook(() => useTwitch(e, true));
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(anim.calls).toHaveLength(1);
    unmount();
    await act(async () => { anim.calls[0].done(); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(anim.calls.filter((c) => c.value !== 0)).toHaveLength(1);
  });

  it('runs a single loop when it is switched off and on again mid-twitch', async () => {
    const e = ears();
    const { rerender } = renderHook(({ on }) => useTwitch(e, on), { initialProps: { on: true } });
    act(() => { vi.advanceTimersByTime(12_000); });
    rerender({ on: false });
    rerender({ on: true });
    await act(async () => { anim.calls[0].done(); });
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('syllable onsets', () => {
  it('bounces once per syllable: a rise above the trough, never twice on one long vowel', () => {
    const hit = onsetDetector(TALK);
    const env = [0, 0.1, 0.3, 0.55, 0.7, 0.8, 0.85, 0.8, 0.6, 0.3, 0.1, 0.2, 0.5, 0.7, 0.4];
    const fired = env.map((v, i) => hit(v, i * 40)).flatMap((h, i) => (h ? [i] : []));
    expect(fired).toEqual([3, 12]);
  });

  it('ignores small flutter under the floor and keeps the minimum gap', () => {
    const hit = onsetDetector(TALK);
    expect([0, 0.3, 0.1, 0.35, 0.05, 0.38].some((v, i) => hit(v, i * 40))).toBe(false);
    const fast = onsetDetector(TALK);
    expect([fast(0, 0), fast(0.6, 10), fast(0.3, 40), fast(0, 60)]).toEqual([false, true, false, false]);
    expect(fast(0.7, 100)).toBe(false); // a second syllable inside the 150 ms gap waits
    expect(fast(0.75, 200)).toBe(true);
  });

  it('subscribes to the envelope while active and lets go when it stops', () => {
    const open = motionValue(0), bump = motionValue(0);
    const { rerender, unmount } = renderHook(({ on }) => useSyllableBounce(open, bump, on, TALK), { initialProps: { on: true } });
    act(() => { open.set(0.1); open.set(0.6); });
    expect(anim.calls.map((c) => c.value)).toContain(1);
    rerender({ on: false });
    const n = anim.calls.length;
    act(() => { open.set(0); open.set(0.9); });
    expect(anim.calls.filter((c, i) => i >= n && c.value === 1)).toHaveLength(0);
    unmount();
  });
});

describe('useGlance', () => {
  it('swings the face to the other side and back while thinking, and leaves no timer behind', async () => {
    const gx = motionValue(0);
    const { unmount } = renderHook(() => useGlance(gx, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(2900); });
    expect(anim.calls.some((c) => c.value < 0)).toBe(true);
    unmount();
    const n = anim.calls.length;
    expect(anim.calls[n - 1].value).toBe(0); // home on the way out
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(anim.calls.length).toBe(n);
  });
});
