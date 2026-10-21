'use client';

import { createContext, useContext, useMemo } from 'react';
import { detectTier, type MotionTier } from '../../_lib/motion';
import { REDUCED_MOTION_QUERY, useMediaQuery } from './activity';

const TierContext = createContext<MotionTier | null>(null);

/** StudioApp provides the app's tier; the lab overrides it to preview lite and reduced on any device. */
export const TierProvider = TierContext.Provider;

/** Motion tier for JS-driven motion (rig loops, particles). CSS reads the same tier from `[data-motion]`. */
export function useTier(): MotionTier {
  const given = useContext(TierContext);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const detected = useMemo(() => detectTier(reduced), [reduced]);
  return given ?? detected;
}
