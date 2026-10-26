import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionValue } from 'framer-motion';
import { Bubble, clip, holdMs, pageBudget, paginate } from './Bubble';

/** What the bubble has said so far: its text less the laid-out part not said yet. */
const saidIn = (c: HTMLElement) => { const t = c.querySelector('.pet-bubble-text')!; return (t.textContent ?? '').slice(0, (t.textContent ?? '').length - (t.querySelector('.pet-bubble-rest')?.textContent?.length ?? 0)); };
import { loadStrings } from './strings';

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

  it('lays the whole page out from the first frame (the box never grows as it types), revealing inside it (P-28)', () => {
    const { container } = render(<Bubble msg={{ id: 7, text: 'We found the play room together' }} top={100} />);
    const node = container.querySelector('.pet-bubble-text')!;
    // the full line is in the box at once; the part not said yet is there but hidden
    expect(node.textContent).toBe('We found the play room together');
    expect((node.querySelector('.pet-bubble-rest') as HTMLElement).style.visibility).toBe('hidden');
    act(() => { vi.advanceTimersByTime(Math.ceil(1000 / 28) * 7 + 1); });
    expect(saidIn(container)).toBe('We foun');
    expect(node.textContent).toBe('We found the play room together');
  });

  it('never draws an empty or blank bubble, and lets its slot go at once (P-14)', () => {
    for (const text of ['', '   ']) {
      const onGone = vi.fn();
      const { container, unmount } = render(<Bubble msg={{ id: 9, text }} top={100} onGone={onGone} />);
      expect(container.querySelector('.pet-bubble')).toBeNull();
      expect(onGone).toHaveBeenCalledWith(9);
      unmount();
    }
  });

  it('follows the head while the pet travels, kept inside the stage (P-18)', () => {
    const x = motionValue(0);
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    Object.defineProperty(stage, 'clientWidth', { value: 390 });
    const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('pet-bubble') ? 80 : 0; } });
    const { container } = render(<Bubble msg={{ id: 4, text: 'Yum!' }} top={200} x={195} follow={x} />, { container: stage });
    const at = container.querySelector('.pet-bubble-at') as HTMLElement;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', was);
    expect(at.style.transform).toBe('');
    act(() => { x.set(60); });
    expect(at.style.transform).toBe('translate3d(60.0px,0,0)');
    // never past the stage's edge (half the bubble plus 8 px)
    act(() => { x.set(400); });
    expect(at.style.transform).toBe(`translate3d(${(390 - 40 - 8 - 195).toFixed(1)}px,0,0)`);
    stage.remove();
  });

  it('reveals at 28 chars/s, holds, then fades and reports gone', () => {
    const onGone = vi.fn();
    const { container } = render(<Bubble msg={{ id: 1, text: 'Hello there!' }} top={100} onGone={onGone} />);
    const text = () => saidIn(container);
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

  it('pages a long reply by sentences: dots, "more ›" turns at once, an unread page turns after its hold, never a scroll', async () => {
    const long = 'The garden is quiet today. I counted every cloud twice. Then I lost count and started again. '
      + 'Mochi says hi to the moon. We should plant a seed soon. That would be lovely, I think.';
    const back = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { BackButton: back } };
    const onGone = vi.fn();
    const { container } = render(<Bubble msg={{ id: 2, text: long }} top={300} lines={2} width={290} onGone={onGone} />);
    const pages = paginate(long, pageBudget(2, 290, 'en'));
    expect(pages.length).toBeGreaterThan(2);
    const shown = () => saidIn(container);
    const dots = () => [...container.querySelectorAll('.pet-dots i')].map((d) => d.hasAttribute('data-on'));
    act(() => { vi.advanceTimersByTime(Math.ceil(1000 / 28) * (pages[0].length + 1)); });
    expect(shown()).toBe(pages[0]);
    expect(dots()).toEqual(pages.map((_, i) => i === 0));
    // the whole reply stays readable for screen readers, the line budget is the class's
    expect(screen.getByRole('status')).toHaveTextContent(long.trim());
    expect((container.querySelector('.pet-bubble') as HTMLElement).style.getPropertyValue('--pet-lines')).toBe('2');
    expect(back.show).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'more ›' }));
    act(() => { vi.advanceTimersByTime(Math.ceil(1000 / 28) * (pages[1].length + 1)); });
    expect(shown()).toBe(pages[1]);
    expect(dots()[1]).toBe(true);
    // nobody taps: the page turns by itself after its hold, and the last page has no "more"
    for (let i = 2; i < pages.length; i++) {
      act(() => { vi.advanceTimersByTime(holdMs(pages[i - 1].length)); });
      act(() => { vi.advanceTimersByTime(Math.ceil(1000 / 28) * (pages[i].length + 1)); });
    }
    expect(shown()).toBe(pages.at(-1));
    expect(screen.queryByRole('button', { name: 'more ›' })).toBeNull();
    expect(container.querySelector('.pet-bubble')).not.toHaveAttribute('data-out');
    act(() => { vi.advanceTimersByTime(holdMs(pages.at(-1)!.length)); });
    expect(container.querySelector('.pet-bubble')).toHaveAttribute('data-out');
    delete (window as { Telegram?: unknown }).Telegram;
  });

  it("Telegram's BackButton closes a paged reply", () => {
    const back = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { BackButton: back } };
    const { container } = render(<Bubble msg={{ id: 3, text: `${'Clouds are soft. '.repeat(12)}` }} top={300} lines={2} />);
    act(() => { (back.onClick.mock.calls.at(-1)![0] as () => void)(); });
    expect(container.querySelector('.pet-bubble')).toHaveAttribute('data-out');
    expect(back.hide).toHaveBeenCalled();
    delete (window as { Telegram?: unknown }).Telegram;
  });

  it('a short line is one page with no dots and no "more"', () => {
    const { container } = render(<Bubble msg={{ id: 4, text: 'Yum!' }} top={300} lines={2} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.querySelector('.pet-pages')).toBeNull();
  });

  it('takes fewer lines than the class allows when the head is close to the top (never under Telegram’s row)', () => {
    const { container } = render(<Bubble msg={{ id: 5, text: 'Hello there, cloud friend.' }} top={80} room={70} lines={5} />);
    expect((container.querySelector('.pet-bubble') as HTMLElement).style.getPropertyValue('--pet-lines')).toBe('1');
  });

  it('a Persian reply reads right to left; the "more" turns in Persian on a Persian page', async () => {
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initDataUnsafe: { user: { id: 1, first_name: 'سارا', language_code: 'fa' } } } };
    vi.useRealTimers();
    await loadStrings('fa');
    vi.useFakeTimers();
    const fa = 'امروز با هم یه دونه کاشتیم. فردا یه کم بزرگ‌تر می‌شه. بعدش بارون می‌زنیم. آخرش گل می‌ده، ببین چی می‌شه!';
    const { container } = render(<Bubble msg={{ id: 6, text: fa }} top={300} lines={2} width={260} />);
    expect(container.querySelector('.pet-bubble')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'بیشتر ‹' })).toBeInTheDocument();
    delete (window as { Telegram?: unknown }).Telegram;
  });
});

describe('paginate', () => {
  const words = (s: string) => s.split(/\s+/).filter(Boolean);

  it('groups whole sentences while they fit, and never loses or reorders a word', () => {
    const text = 'One. Two two. Three three three! Four four four four? Five.';
    const pages = paginate(text, 24);
    expect(pages).toEqual(['One. Two two.', 'Three three three!', 'Four four four four?', 'Five.']);
    expect(words(pages.join(' '))).toEqual(words(text));
  });

  it('splits a sentence longer than a page at word boundaries, and a word longer than a page as is', () => {
    const text = 'a-very-long-unbroken-token-that-runs-on and then some short words follow here';
    const pages = paginate(text, 16);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(16);
    expect(pages.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('knows Persian sentence ends («؟», «!», «…») and keeps closing quotes with their sentence', () => {
    const fa = 'سلام! حالت خوبه؟ یه چیزی بگم… «باشه.» تمام.';
    const pages = paginate(fa, 18);
    expect(pages[0]).toBe('سلام! حالت خوبه؟');
    expect(pages).toContain('یه چیزی بگم…');
    expect(pages.some((p) => p.startsWith('«باشه.»'))).toBe(true);
    expect(words(pages.join(' '))).toEqual(words(fa));
  });

  it('fits every page in the line budget for every class (2-5 lines at 290 px)', () => {
    const reply = 'I keep a small garden of thoughts. '.repeat(20);
    for (const lines of [2, 3, 4, 5]) {
      const max = pageBudget(lines, 290, 'en');
      for (const p of paginate(reply, max)) expect(p.length).toBeLessThanOrEqual(max);
      expect(max).toBeLessThanOrEqual(lines * 34);
    }
  });
});
