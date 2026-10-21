/**
 * Scroll restoration for the screen stack (motion §3.2). Screens remount on pop, so StudioApp saves
 * each scroller's offset when it navigates away and puts it back when the screen returns. Screens
 * that load their content again get the offset as soon as it fits, until the person scrolls themselves.
 */

export const SCROLLERS = '.vx-scroll, [data-scroll-memory]';
const GIVE_UP_MS = 2000;

export function captureScroll(root: Element | null | undefined): number[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(SCROLLERS), (el) => el.scrollTop) : [];
}

/** Returns a cancel function. */
export function restoreScroll(root: Element, offsets: readonly number[]): () => void {
  const els = Array.from(root.querySelectorAll<HTMLElement>(SCROLLERS));
  const pending = new Map<HTMLElement, number>();
  els.forEach((el, i) => { if ((offsets[i] ?? 0) > 0) pending.set(el, offsets[i]); });
  if (!pending.size) return () => undefined;

  const apply = () => {
    for (const [el, top] of pending) {
      el.scrollTop = top;
      // Reached, or as far as this content allows: done once it can hold the full offset.
      if (Math.abs(el.scrollTop - top) <= 1 || el.scrollHeight - el.clientHeight >= top) pending.delete(el);
    }
    if (!pending.size) stop();
  };

  const observers: Array<MutationObserver | ResizeObserver> = [];
  const userEvents = ['touchstart', 'wheel', 'pointerdown', 'keydown'] as const;
  const onUser = (e: Event) => { pending.delete(e.currentTarget as HTMLElement); (e.currentTarget as HTMLElement).removeEventListener(e.type, onUser); if (!pending.size) stop(); };
  let stopped = false;
  const timer = setTimeout(() => stop(), GIVE_UP_MS);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    observers.forEach((o) => o.disconnect());
    for (const el of els) for (const t of userEvents) el.removeEventListener(t, onUser);
  }

  apply();
  if (stopped) return stop;
  for (const el of pending.keys()) {
    for (const t of userEvents) el.addEventListener(t, onUser, { passive: true });
    if (typeof MutationObserver !== 'undefined') { const m = new MutationObserver(apply); m.observe(el, { childList: true, subtree: true }); observers.push(m); }
    if (typeof ResizeObserver !== 'undefined') { const r = new ResizeObserver(apply); for (const c of Array.from(el.children)) r.observe(c); observers.push(r); }
  }
  return stop;
}
