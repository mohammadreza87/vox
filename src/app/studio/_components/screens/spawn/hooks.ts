'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { tg } from '../../../_lib/client';
import { useNav } from '../../StudioApp';
import type { Locale } from './copy';

/** Telegram's language, for content (examples, role titles). Chrome stays English in phase 1. */
export function useStudioLocale(): Locale {
  const code = (tg()?.initDataUnsafe?.user as { language_code?: unknown } | undefined)?.language_code;
  return typeof code === 'string' && code.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
};

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}

/**
 * While `active` (the composer has focus), reports whether the on-screen
 * keyboard is up and how far to lift the dock so it sits right above it.
 * Works whether or not the webview also shrinks its layout viewport.
 */
export function useKeyboard(active: boolean): { up: boolean; inset: number } {
  const [state, setState] = useState({ up: false, inset: 0 });
  const tallest = useRef(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const measure = () => {
      tallest.current = Math.max(tallest.current, vv.height);
      if (!active) { setState((s) => (s.up || s.inset ? { up: false, inset: 0 } : s)); return; }
      const up = tallest.current - vv.height > 120;
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setState((s) => (s.up === up && s.inset === inset ? s : { up, inset }));
    };
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => { vv.removeEventListener('resize', measure); vv.removeEventListener('scroll', measure); };
  }, [active]);
  return state;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Sheet a11y the shared Sheet doesn't do yet: focus the selected (or first)
 * control on open, close on Esc, and return focus to the opener on close.
 */
export function useSheetA11y(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, fallback?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // After the sheet's first paint, so the focus lands inside the dialog.
    const frame = setTimeout(() => {
      const root = ref.current;
      const target = root?.querySelector<HTMLElement>('[aria-selected="true"]') ?? root?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(frame);
      window.removeEventListener('keydown', onKey);
      // The opener may be gone (a pack chip replaced by the role card): land on what replaced it.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      // Read at close on purpose: the fallback is whatever replaced the opener by then.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      else fallback?.current?.focus({ preventScroll: true });
    };
  }, [open, ref, fallback]);
}

/**
 * While `active` (a sheet is open), Back (Telegram's button or the top bar) calls
 * `onBack` instead of leaving the screen, so closing a sheet never loses the brief.
 * The newest guard wins; it unregisters when `active` turns false or on unmount.
 * Driven by the real `open` prop, not the sheet body, which outlives it while it animates out.
 */
export function useBackGuard(active: boolean, onBack: () => void) {
  const { guardBack } = useNav();
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => (active ? guardBack(() => latest.current()) : undefined), [active, guardBack]);
}

/** True for `ms` after `key` changes to a truthy value (e.g. the cloud's happy beat). */
export function useBeat(key: string | null | undefined, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!key) { setOn(false); return; }
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return on;
}

/** True once `active` has stayed true for `ms`. */
export function useAfter(active: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) { setOn(false); return; }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return on;
}
