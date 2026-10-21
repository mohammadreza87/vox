'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SPRING } from '../../_lib/motion';

/** The shared-element flight (SPRING.hero settles visually in ~460 ms). */
export const HERO_FLIGHT_MS = Math.round(SPRING.hero.visualDuration * 1000);

/**
 * False while the screen holding `ref` is still arriving as a hero (Page marks it `data-arrive="hero"`),
 * true once the face has landed, and at once for every other arrival. Landing gestures (Call's perk, the
 * profile's stage-up) wait for this so they play on the landed face, not mid-flight (motion §3.3).
 * Decided the first time `ref` is attached, so a screen that renders a skeleton first still works.
 */
export function useLanded(ref: RefObject<HTMLElement | null>): boolean {
  const [landed, setLanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decided = useRef(false);
  // Runs after every commit until the ref attaches, then decides once (the guard stops any update chain)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (decided.current || !ref.current) return;
    decided.current = true;
    if (ref.current.closest('.vx-screen')?.getAttribute('data-arrive') !== 'hero') setLanded(true);
    else timer.current = setTimeout(() => setLanded(true), HERO_FLIGHT_MS);
  });
  // A cancelled wait re-decides on the next attach (StrictMode's simulated remount keeps the flight)
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; decided.current = false; } }, []);
  return landed;
}
