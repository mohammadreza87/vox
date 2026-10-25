'use client';

import { PresenceContext } from 'framer-motion';
import { useContext, useMemo, useRef, useState, type ContextType } from 'react';

type Presence = NonNullable<ContextType<typeof PresenceContext>>;
type ExitId = Parameters<Presence['register']>[0];

export interface ExitWatch {
  /** Provide this around the child's motion nodes in place of AnimatePresence's own (same values) */
  context: ContextType<typeof PresenceContext>;
  /** Some exit of this departure has not finished yet (stable) */
  hung(): boolean;
  /** Count every unfinished exit as done, so AnimatePresence removes this child and nothing else (stable) */
  release(): void;
}

/**
 * Lets one AnimatePresence child see, and if need be end, its own exits.
 *
 * AnimatePresence removes a child once every motion node under it has reported its exit done, and keeps all
 * leaving children until each has. An exit framer stops without settling never reports, so one lost exit
 * keeps every later leaving screen too. This passes AnimatePresence's context through unchanged, noting
 * which nodes registered and which have reported; `release()` reports the rest for them. Only this child
 * goes: the others keep their own exits, the screen at rest included.
 */
export function useExitWatch(): ExitWatch {
  const presence = useContext(PresenceContext);
  const present = presence?.isPresent !== false;
  const latest = useRef(presence);
  latest.current = presence;
  // Stable across renders: AnimatePresence hands a leaving child a new context on every render of the app
  const [watch] = useState(() => {
    const ids = new Set<ExitId>(), done = new Set<ExitId>();
    return {
      ids, done, present,
      hung: () => [...ids].some((id) => !done.has(id)),
      release: () => {
        for (const id of [...ids]) {
          if (done.has(id)) continue;
          done.add(id);
          latest.current?.onExitComplete?.(id);
        }
      },
    };
  });
  // A new departure starts unreported, as AnimatePresence's own count does (PresenceChild resets on isPresent)
  if (watch.present !== present) { watch.present = present; watch.done.clear(); }
  const context = useMemo<ExitWatch['context']>(() => presence && {
    ...presence,
    register: (id) => {
      watch.ids.add(id);
      const off = presence.register(id);
      return () => { watch.ids.delete(id); off(); };
    },
    onExitComplete: presence.onExitComplete && ((id) => { watch.done.add(id); presence.onExitComplete?.(id); }),
  }, [presence, watch]);
  return { context, hung: watch.hung, release: watch.release };
}
