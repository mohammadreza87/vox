/**
 * Design-system assertions for screen tests (test-only; never imported by app code).
 */
import { expect } from 'vitest';

/** Board rule: at most one volt element (the bottom CTA or the Home FAB) per rendered screen. */
export function expectOneVolt(container: HTMLElement) {
  const volts = container.querySelectorAll('.vx-btn-primary, .vx-fab');
  expect(volts.length, `volt elements: ${[...volts].map((v) => v.textContent).join(' | ')}`).toBeLessThanOrEqual(1);
}

/** No unstyled native controls: selects, checkboxes, radios, file inputs and <details> need a vx- class. */
export function expectNoRawControls(container: HTMLElement) {
  const raw = [...container.querySelectorAll<HTMLElement>('select, input[type="checkbox"], input[type="radio"], input[type="file"], details')]
    .filter((el) => ![...el.classList].some((c) => c.startsWith('vx-')) && !el.closest('label[class^="vx-"], label[class*=" vx-"]'));
  expect(raw.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
}
