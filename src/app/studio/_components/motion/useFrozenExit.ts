'use client';

import { useIsPresent, usePresenceData, type TargetAndTransition, type Variants } from 'framer-motion';
import { useState } from 'react';

/**
 * The exit a leaving child plays, resolved once, from the navigation that removed it, and then kept.
 *
 * AnimatePresence hands every leaving child the newest `custom` on each render, and framer re-resolves a
 * function `exit` variant against it. When a later navigation of another kind lands while a child is still
 * leaving (a push, then a cover), the running exit gets a new target: framer stops it without settling its
 * promise, so the child is never removed, and neither is anything that leaves after it. A frozen target is
 * the same object on every render, so nothing restarts and the exit finishes where it was heading.
 *
 * A child that comes back (Back to it while it leaves, or in the frame its exit ends) keeps that object
 * while present: swapping it for the `'exit'` label there would make framer play the label once more as
 * the exit switches off. Its next departure freezes a new target.
 */
export function useFrozenExit<C>(variants: Variants, own: C): TargetAndTransition | 'exit' {
  const present = useIsPresent();
  const removedBy = usePresenceData() as C | undefined;
  const [exit, setExit] = useState<{ to: TargetAndTransition; leaving: boolean } | null>(null);
  if (present) {
    if (exit?.leaving) setExit({ to: exit.to, leaving: false });
    return exit?.to ?? 'exit';
  }
  if (exit?.leaving) return exit.to;
  // Derived once per departure (React re-renders this component before committing, never after)
  const to = (variants.exit as (c: C) => TargetAndTransition)(removedBy ?? own);
  setExit({ to, leaving: true });
  return to;
}
