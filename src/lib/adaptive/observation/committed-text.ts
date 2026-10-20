/** Browser-only observation seam. Two animation frames follow a React commit;
 * hidden, detached, empty and offscreen text never counts as rendered experience.
 * The callback receives no text or DOM details. */
export function observeCommittedText(element: HTMLElement, report: () => void, current: () => boolean): () => void {
  let cancelled = false, reported = false, frame = 0;
  const visible = () => {
    if (!element.isConnected || !element.textContent?.trim() || document.visibilityState !== 'visible') return false;
    const rect = element.getBoundingClientRect();
    let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom), left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
      if (node !== element) {
        const bounds = node.getBoundingClientRect();
        if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY || style.overflow)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
        if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX || style.overflow)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      }
    }
    return rect.width > 0 && rect.height > 0 && bottom > top && right > left;
  };
  const check = () => {
    if (cancelled || reported || !current() || !visible()) return;
    reported = true; try { report(); } catch { /* Optional diagnostics cannot break the rendered reply. */ }
  };
  const schedule = () => {
    if (cancelled || reported || frame) return;
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { frame = 0; check(); }); });
  };
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
  let observer: IntersectionObserver | undefined;
  try { if (typeof IntersectionObserver === 'function') { observer = new IntersectionObserver(schedule); observer.observe(element); } } catch { observer = undefined; }
  schedule();
  return () => { cancelled = true; cancelAnimationFrame(frame); observer?.disconnect(); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
}
