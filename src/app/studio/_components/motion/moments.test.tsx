import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESET_LOOKS } from '@/lib/studio/character';
import type { CharacterLook } from '@/lib/studio/types';
import { breakLocalStorage, setMediaQueries } from '@/test/browser';
import { diffLook } from '../character/moments';
import { openFromLevel, syllables } from '../character/rig';
import { Burst, particlesFor } from './Burst';
import { DoneCheck } from './DoneCheck';
import { ProgressPill, progressAt } from './ProgressPill';
import { Ticker } from './Ticker';
import { TierProvider } from './tier';
import { hasUnseenStage, markStageSeen, useStageUp } from './useStageUp';

afterEach(cleanup);

describe('useStageUp', () => {
  it('only records the first view of an agent (the hire celebration covers it)', () => {
    const { result } = renderHook(() => useStageUp('a1', 2, 'active'));
    expect(result.current.moment).toBeNull();
    expect(hasUnseenStage('a1', 2)).toBe(false);
    expect(hasUnseenStage('a1', 3)).toBe(true);
  });

  it('plays once per stage, from the last stage this device saw, and records it when done', () => {
    markStageSeen('a2', 2);
    const { result, rerender } = renderHook(({ stage }) => useStageUp('a2', stage, 'active', 'Aria'), { initialProps: { stage: 3 as 3 | 4 } });
    expect(result.current.moment).toMatchObject({ kind: 'evolve', fromStage: 2 });
    expect(result.current.pill).toBe('Aria grew · stage 3 of 4');
    act(() => result.current.done());
    expect(result.current.moment).toBeNull();
    rerender({ stage: 3 });
    expect(result.current.moment).toBeNull();
    rerender({ stage: 4 });
    expect(result.current.moment).toMatchObject({ kind: 'evolve', fromStage: 3 });
  });

  it('never plays for drafts or retired agents', () => {
    markStageSeen('a3', 1);
    expect(renderHook(() => useStageUp('a3', 3, 'draft')).result.current.moment).toBeNull();
    expect(renderHook(() => useStageUp('a3', 3, 'fired')).result.current.moment).toBeNull();
  });

  it('survives a throwing localStorage (private mode): nothing plays, nothing throws', () => {
    breakLocalStorage();
    const { result } = renderHook(() => useStageUp('a4', 3, 'active'));
    expect(result.current.moment).toBeNull();
    expect(() => act(() => result.current.done())).not.toThrow();
    expect(hasUnseenStage('a4', 3)).toBe(false);
  });
});

describe('ProgressPill', () => {
  it('approaches but never reaches the end on its own', () => {
    expect(progressAt(0, 8)).toBe(0);
    expect(progressAt(8, 8)).toBeCloseTo(0.92 * (1 - Math.exp(-1)));
    expect(progressAt(1000, 8)).toBeLessThanOrEqual(0.92);
  });

  it('steps through its copy, holds the last line, admits slowness after 2τ, then settles on done', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<ProgressPill active labels={['Reading…', 'Writing…']} tau={4} done="Ready" />);
      expect(screen.getByRole('status')).toHaveTextContent('Reading…');
      act(() => { vi.advanceTimersByTime(3300); });
      expect(screen.getByRole('status')).toHaveTextContent('Writing…');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.getByRole('status')).toHaveTextContent('Writing…');
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.getByRole('status')).toHaveTextContent(/longer than usual/);
      rerender(<ProgressPill active={false} labels={['Reading…', 'Writing…']} tau={4} done="Ready" />);
      expect(screen.getByRole('status')).toHaveTextContent('Ready');
      expect(screen.getByRole('status')).toHaveAttribute('data-done');
    } finally { vi.useRealTimers(); }
  });

  it('renders nothing when idle without a done label', () => {
    const { container } = render(<ProgressPill active={false} labels={['x']} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Ticker', () => {
  it('gives assistive tech the plain value and rolls one reel per digit', () => {
    const { container } = render(<Ticker value="02:14" />);
    expect(screen.getByText('02:14')).toHaveClass('vx-sr');
    expect(container.querySelectorAll('.vx-tick-col')).toHaveLength(4);
    expect(container.querySelector('.vx-tick-sym')?.textContent).toBe(':');
  });

  it('rolls Persian digits too, and is plain text under reduced motion', () => {
    const { container } = render(<Ticker value="۱۲" />);
    expect(container.querySelectorAll('.vx-tick-col')).toHaveLength(2);
    cleanup();
    const reduced = render(<TierProvider value="reduced"><Ticker value={42} /></TierProvider>);
    expect(reduced.container.querySelector('.vx-tick-col')).toBeNull();
    expect(reduced.container.textContent).toBe('42');
  });

  it('is an LTR run inside an RTL shell, so a Persian clock keeps its digit order', () => {
    const { container } = render(<div dir="rtl"><Ticker value="۰۱:۲۳" quick /></div>);
    const tick = container.querySelector<HTMLElement>('.vx-tick')!;
    expect(tick).toHaveAttribute('dir', 'ltr');
    // every reel resolves its direction from the ticker, not the RTL shell
    for (const part of tick.querySelectorAll('.vx-tick-col, .vx-tick-sym')) expect(part.closest('[dir]')).toBe(tick);
    const order = [...tick.querySelectorAll(':scope > .vx-tick-col, :scope > .vx-tick-sym')].map((el) => (el.classList.contains('vx-tick-sym') ? el.textContent : 'd'));
    expect(order).toEqual(['d', 'd', ':', 'd', 'd']);
    cleanup();
    const reduced = render(<div dir="rtl"><TierProvider value="reduced"><Ticker value="۰۱:۲۳" /></TierProvider></div>);
    expect(reduced.container.querySelector('.vx-tick')).toHaveAttribute('dir', 'ltr');
  });
});

describe('Burst and DoneCheck', () => {
  it('caps particles (≤ 18; lite halves them)', () => {
    const base = { id: 1, at: [0, 0] as [number, number], k: 1, light: '#fff', base: '#ccc' };
    expect(particlesFor({ ...base, kind: 'hire' })).toHaveLength(18);
    expect(particlesFor({ ...base, kind: 'hire', lite: true })).toHaveLength(9);
    expect(particlesFor({ ...base, kind: 'vapor' })).toHaveLength(7);
    expect(particlesFor({ ...base, kind: 'vapor', lite: true })).toHaveLength(4);
    expect(particlesFor({ ...base, kind: 'sparkle' }).filter((p) => p.color.includes('volt'))).toHaveLength(2);
  });

  it('plays a burst once and cleans it up; nothing under reduced motion', async () => {
    const done = vi.fn();
    const { container } = render(<div style={{ position: 'relative' }}><Burst kind="hire" onDone={done} /></div>);
    expect(container.querySelectorAll('.vx-particles > span').length).toBe(18);
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(container.querySelector('.vx-particles')).toBeNull();
    cleanup();
    setMediaQueries({ '(prefers-reduced-motion: reduce)': true });
    const quiet = render(<Burst kind="hire" />);
    expect(quiet.container.querySelector('.vx-particles')).toBeNull();
  });

  it('DoneCheck is an accessible success mark', () => {
    render(<DoneCheck label="Saved" silent />);
    expect(screen.getByRole('img', { name: 'Saved' })).toBeInTheDocument();
  });
});

describe('rig helpers', () => {
  it('maps audio level to mouth openness with a noise gate and a soft knee', () => {
    expect(openFromLevel(0.01)).toBe(0);
    expect(openFromLevel(0.11)).toBeGreaterThan(0.5);
    expect(openFromLevel(0.5)).toBe(1);
  });

  it('falls back to a syllable rhythm in 0..1 with phrase gaps', () => {
    const v = Array.from({ length: 400 }, (_, i) => syllables(i / 60));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    expect(v.filter((x) => x > 0.5).length).toBeGreaterThan(20);
  });

  it('classifies look changes: dice = several groups, hue-only is quiet', () => {
    const a: CharacterLook = PRESET_LOOKS[0];
    expect(diffLook(a, { ...a, hue: a.hue === 'sky' ? 'rose' : 'sky' })).toMatchObject({ quiet: true, count: 0, hue: true });
    expect(diffLook(a, { ...a, species: 'dog' })).toMatchObject({ structure: true, species: true, count: 1 });
    expect(diffLook(a, { ...a, hair: 'bun', accessory: 'cap', species: 'owl' }).count).toBe(3);
  });
});
