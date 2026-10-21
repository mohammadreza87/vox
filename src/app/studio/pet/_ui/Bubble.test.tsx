import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bubble, clip, holdMs } from './Bubble';

describe('Bubble', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clips at 220 characters on a word boundary', () => {
    const long = `${'word '.repeat(60)}end`;
    const c = clip(long);
    expect(c.clipped).toBe(true);
    expect(c.shown.length).toBeLessThanOrEqual(221);
    expect(c.shown.endsWith('…')).toBe(true);
    expect(clip('short')).toEqual({ shown: 'short', clipped: false });
    expect(holdMs(10)).toBe(2500);
    expect(holdMs(90)).toBe(5000);
  });

  it('reveals at 28 chars/s, holds, then fades and reports gone', () => {
    const onGone = vi.fn();
    const { container } = render(<Bubble msg={{ id: 1, text: 'Hello there!' }} top={100} onGone={onGone} />);
    const text = () => container.querySelector('.pet-bubble-text')!.textContent;
    expect(text()).toBe('');
    act(() => { vi.advanceTimersByTime(Math.ceil(1000 / 28) * 5 + 1); });
    expect(text()).toBe('Hello');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(text()).toBe('Hello there!');
    // the whole line stays readable for screen readers from the start
    expect(screen.getByRole('status')).toHaveTextContent('Hello there!');
    act(() => { vi.advanceTimersByTime(2500); });
    const bubble = container.querySelector('.pet-bubble')!;
    expect(bubble).toHaveAttribute('data-out');
    fireEvent.transitionEnd(bubble, { propertyName: 'opacity' });
    expect(onGone).toHaveBeenCalledWith(1);
  });

  it('expands a long reply in place with "more" and never fades while open', () => {
    const long = `${'lovely '.repeat(40)}clouds`;
    const { container } = render(<Bubble msg={{ id: 2, text: long }} top={100} />);
    act(() => { vi.advanceTimersByTime(20_000); });
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(container.querySelector('.pet-bubble')).toHaveAttribute('data-expanded');
    expect(container.querySelector('.pet-bubble-text')!.textContent).toBe(long);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(container.querySelector('.pet-bubble')).not.toHaveAttribute('data-out');
    fireEvent.click(screen.getByRole('button', { name: 'less' }));
    expect(container.querySelector('.pet-bubble-text')!.textContent).toBe(clip(long).shown);
  });
});
