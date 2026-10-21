import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { characterModel } from '@/lib/studio/character';
import type { CharacterLook, Stage } from '@/lib/studio/types';
import { Cloud, type CloudMoment } from '../Cloud';
import { TierProvider } from '../motion/tier';
import { SHY } from './poses';

/**
 * The live character's interaction and growth beats, with framer's skipAnimations on (src/test/setup.ts):
 * every animation lands on its target at the next frame, so these check where each beat ends up and that
 * it cleans up after itself. Real timers: framer's frame loop runs on jsdom's animation frames.
 */
const LOOK: CharacterLook = { hue: 'sky', family: 'puff', species: 'cloud', features: { cheeks: true, lashes: false, brows: false } };
const flush = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const hero = (p: Partial<Parameters<typeof Cloud>[0]> = {}) => <TierProvider value="full"><Cloud look={LOOK} size={200} label="Mo" {...p} /></TierProvider>;
const char = (c: HTMLElement) => c.querySelector('.vx-char') as HTMLElement;
const label = (c: HTMLElement) => c.querySelector('svg')!.getAttribute('aria-label');
/** framer writes an SVG element's opacity as the attribute */
const shyOpacity = (c: HTMLElement) => Number(c.querySelector('[data-part="shy"] ellipse')!.getAttribute('opacity') ?? '0');
const scales = (c: HTMLElement) => [...(c.querySelector('.vx-char-bob') as HTMLElement).style.transform.matchAll(/scale[XY]\(([\d.]+)\)/g)].map((m) => Number(m[1]));
const bodyD = (c: HTMLElement) => c.querySelector('[data-part="body"]')!.getAttribute('d');

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('touch', () => {
  it('a tap squishes and giggles (happy arcs), then the face comes home without a moment', async () => {
    const onEnd = vi.fn();
    const { container } = render(hero({ onMomentEnd: onEnd }));
    await flush();
    fireEvent.pointerDown(char(container), { button: 0 });
    fireEvent.pointerUp(char(container));
    await flush();
    expect(label(container)).toBe('Mo, happy');
    await waitFor(() => expect(label(container)).toBe('Mo, idle'), { timeout: 2000 });
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('a long-press grows a shy blush that fades on release', async () => {
    const { container } = render(hero());
    await flush();
    expect(shyOpacity(container)).toBe(0);
    fireEvent.pointerDown(char(container), { button: 0 });
    await flush(SHY.holdMs + 120);
    await flush(120);
    expect(shyOpacity(container)).toBe(1);
    // a long-press is not a tap: no giggle on release
    fireEvent.pointerUp(char(container));
    await flush(120);
    expect(label(container)).toBe('Mo, idle');
    expect(shyOpacity(container)).toBe(0);
  });

  it('leaving mid-press cancels the long-press, and an unmounted press leaves no timer behind', async () => {
    const { container, unmount } = render(hero());
    await flush();
    fireEvent.pointerDown(char(container), { button: 0 });
    fireEvent.pointerLeave(char(container));
    await flush(SHY.holdMs + 80);
    expect(shyOpacity(container)).toBe(0);
    const set = vi.spyOn(console, 'error');
    fireEvent.pointerDown(char(container), { button: 0 });
    unmount();
    await flush(SHY.holdMs + 80);
    expect(set).not.toHaveBeenCalled();
  });

  it('stays still under reduced motion and on cards (no touch reactions)', async () => {
    const { container } = render(<><TierProvider value="reduced"><Cloud look={LOOK} size={200} /></TierProvider><Cloud look={LOOK} size={100} /></>);
    const [a, b] = [...container.querySelectorAll('.vx-char')] as HTMLElement[];
    expect(a.hasAttribute('data-touch')).toBe(false);
    expect(b.hasAttribute('data-touch')).toBe(false);
    fireEvent.pointerDown(a, { button: 0 }); fireEvent.pointerUp(a);
    await flush();
    expect(a.querySelector('svg')!.getAttribute('aria-label')).toBe('Agent, idle');
    expect(a.querySelector('[data-part="shy"] ellipse')?.getAttribute('opacity')).toBe('0');
    expect(b.querySelector('[data-part="shy"]')).toBeFalsy();
  });

  it.each(['squish', 'shy'] as const)('plays %s as a scripted moment and reports its end once', async (kind) => {
    const onEnd = vi.fn();
    const moment: CloudMoment = { kind, key: 1 };
    const { container } = render(hero({ moment, onMomentEnd: onEnd }));
    await waitFor(() => expect(onEnd).toHaveBeenCalledWith(kind), { timeout: 4000 });
    await flush(120);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(shyOpacity(container)).toBe(0);
  });
});

describe('states', () => {
  it('leans in while listening (a touch bigger from the base) and lets go after', async () => {
    const { container, rerender } = render(hero({ expr: 'listening' }));
    await flush(200);
    expect(scales(container)[0]).toBeGreaterThan(1.015);
    expect(scales(container)[1]).toBeGreaterThan(1.025);
    rerender(hero({ expr: 'idle' }));
    await flush(1200);
    for (const v of scales(container)) expect(v).toBeCloseTo(1, 2);
  });

  it('thinks with two tiny cloud puffs, and sleeps with two z’s, each its own drifting part', () => {
    const { container, rerender } = render(hero({ expr: 'thinking' }));
    expect(container.querySelectorAll('[data-rig="fx"] [data-part^="puff-"]')).toHaveLength(2);
    rerender(hero({ expr: 'sleeping' }));
    expect(container.querySelectorAll('[data-rig="fx"] [data-part^="z-"]')).toHaveLength(2);
  });
});

describe('growth', () => {
  const still = (stage: Stage) => characterModel(LOOK, { uid: 's', mode: 'live', stage }).bodyD;

  it('the body path is the rig binding: it starts a stage-up on the old silhouette and grows into the new one', async () => {
    const onEnd = vi.fn();
    const { container } = render(hero({ stage: 3, moment: { kind: 'evolve', key: 'g', fromStage: 2 }, onMomentEnd: onEnd }));
    expect(bodyD(container)).toBe(still(2));
    await waitFor(() => expect(onEnd).toHaveBeenCalledWith('evolve'), { timeout: 5000 });
    await flush(120);
    expect(bodyD(container)).toBe(still(3));
    // the clip that hair and scarves use follows the same path
    expect(container.querySelector('clipPath path')?.getAttribute('d')).toBe(still(3));
    expect((container.querySelector('.vx-char-bob') as HTMLElement).style.transform).not.toMatch(/scale/);
  });

  it('born rewinds from the designed look to the newborn wisp silhouette', async () => {
    const onEnd = vi.fn();
    const { container } = render(hero({ stage: 1, moment: { kind: 'born', key: 'b' }, onMomentEnd: onEnd }));
    expect(bodyD(container)).toBe(still(4));
    await waitFor(() => expect(onEnd).toHaveBeenCalledWith('born'), { timeout: 5000 });
    await flush(120);
    expect(char(container).dataset.stage).toBe('1');
    expect(bodyD(container)).toBe(still(1));
  });

  it('a plain stage change (no moment) still lands on the new silhouette', async () => {
    const { container, rerender } = render(hero({ stage: 2 }));
    rerender(hero({ stage: 4 }));
    await flush(200);
    expect(bodyD(container)).toBe(still(4));
  });
});
