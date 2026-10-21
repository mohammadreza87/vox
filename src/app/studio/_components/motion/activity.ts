'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Is the Mini App on screen? False while the tab is hidden or Telegram has minimised / backgrounded
 * the app (Bot API 8.0 `activated`/`deactivated`). StudioApp mirrors it to `.vx[data-paused]`, which
 * pauses every CSS loop; JS loops (rAF meters, blink/gaze timers) read it through `usePageActive`.
 */

interface TelegramActivity { isActive?: boolean; onEvent?(e: string, cb: () => void): void; offEvent?(e: string, cb: () => void): void }

const listeners = new Set<() => void>();
let telegramActive = true;
let attached = 0;
let detach: (() => void) | null = null;

const telegram = (): TelegramActivity | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Telegram?: { WebApp?: TelegramActivity } }).Telegram?.WebApp;

export function pageActive(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden' && telegramActive;
}

const emit = () => { for (const l of listeners) l(); };

function attach() {
  const app = telegram();
  telegramActive = app?.isActive ?? true;
  const onVisibility = () => emit();
  const onActivated = () => { telegramActive = true; emit(); };
  const onDeactivated = () => { telegramActive = false; emit(); };
  document.addEventListener('visibilitychange', onVisibility);
  app?.onEvent?.('activated', onActivated);
  app?.onEvent?.('deactivated', onDeactivated);
  detach = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    app?.offEvent?.('activated', onActivated);
    app?.offEvent?.('deactivated', onDeactivated);
    telegramActive = true;
  };
}

export function subscribeActivity(l: () => void): () => void {
  listeners.add(l);
  if (attached++ === 0 && typeof document !== 'undefined') attach();
  return () => {
    listeners.delete(l);
    if (--attached === 0) { detach?.(); detach = null; }
  };
}

export function usePageActive(): boolean {
  return useSyncExternalStore(subscribeActivity, pageActive, () => true);
}

/** Live OS setting (framer's useReducedMotion caches its first answer for the whole session). */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((l: () => void) => {
    const m = typeof window === 'undefined' ? undefined : window.matchMedia?.(query);
    if (!m) return () => undefined;
    m.addEventListener?.('change', l);
    return () => m.removeEventListener?.('change', l);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof window !== 'undefined' && !!window.matchMedia?.(query)?.matches, () => false);
}
