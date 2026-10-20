'use client';

import { useReducedMotion } from 'framer-motion';

type Bezier = [number, number, number, number];

/** Mirrors --ease, --ease-in and --ease-over in studio.css. */
export const EASE: Record<'standard' | 'enter' | 'over', Bezier> = {
  standard: [0.2, 0, 0, 1],
  enter: [0.05, 0.7, 0.1, 1],
  over: [0.34, 1.56, 0.64, 1],
};

/** Seconds. One calm family: 120–320 ms. */
export const DUR = { press: 0.12, state: 0.18, exit: 0.16, enter: 0.28, layout: 0.32, sweep: 0.7 } as const;

/** The same spring LookStep uses for its cloud. */
export const CLOUD_SPRING = { type: 'spring', stiffness: 420, damping: 16 } as const;

/**
 * Enter/exit presets for cards, the clarifier and collapsible rows. Under
 * reduced motion every one of them becomes a 120 ms opacity fade.
 */
export function useSpawnMotion() {
  const reduce = !!useReducedMotion();
  const fade = { duration: 0.12, ease: EASE.standard };
  return {
    reduce,
    card: {
      initial: { opacity: 0, y: reduce ? 0 : 8 },
      animate: { opacity: 1, y: 0, transition: reduce ? fade : { duration: DUR.enter, ease: EASE.enter } },
      exit: { opacity: 0, transition: reduce ? fade : { duration: DUR.exit, ease: EASE.standard } },
    },
    collapse: {
      initial: { opacity: 0, height: reduce ? 'auto' : 0 },
      animate: { opacity: 1, height: 'auto', transition: reduce ? fade : { duration: 0.24, ease: EASE.standard } },
      exit: { opacity: 0, height: reduce ? 'auto' : 0, transition: reduce ? fade : { duration: 0.24, ease: EASE.standard } },
    },
    label: {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: reduce ? 0.12 : DUR.exit } },
      exit: { opacity: 0, transition: { duration: reduce ? 0.12 : DUR.exit } },
    },
    chip: {
      initial: { opacity: 0, scale: reduce ? 1 : 0.9 },
      animate: { opacity: 1, scale: 1, transition: reduce ? fade : { duration: 0.24, ease: EASE.over } },
    },
  };
}
