'use client';

/**
 * Telegram haptics. One helper for every moment (motion §6), throttled so two
 * moments that land together never buzz twice.
 */

type Impact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type Notice = 'error' | 'success' | 'warning';
interface HapticFeedback { impactOccurred(style: Impact): void; notificationOccurred(type: Notice): void; selectionChanged(): void }

export const HAPTIC_THROTTLE_MS = 100;

function feedback(): HapticFeedback | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: HapticFeedback } } }).Telegram?.WebApp?.HapticFeedback;
}

let last = -Infinity;
function fire(run: (h: HapticFeedback) => void) {
  const h = feedback();
  if (!h) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - last < HAPTIC_THROTTLE_MS) return;
  last = now;
  run(h);
}

export const haptic = {
  tap: () => fire((h) => h.impactOccurred('light')),
  light: () => fire((h) => h.impactOccurred('light')),
  soft: () => fire((h) => h.impactOccurred('soft')),
  medium: () => fire((h) => h.impactOccurred('medium')),
  heavy: () => fire((h) => h.impactOccurred('heavy')),
  rigid: () => fire((h) => h.impactOccurred('rigid')),
  select: () => fire((h) => h.selectionChanged()),
  success: () => fire((h) => h.notificationOccurred('success')),
  warn: () => fire((h) => h.notificationOccurred('warning')),
  error: () => fire((h) => h.notificationOccurred('error')),
};
