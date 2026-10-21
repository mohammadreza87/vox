'use client';

import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { haptic } from '../../_lib/haptics';
import { DUR, EASE, SPRING } from '../../_lib/motion';
import { useTier } from './tier';

/**
 * Success mark (motion §5.6): a volt disc pops, the check draws in, and a ring breathes out once.
 * Fires the success haptic on mount unless `silent` (the caller already buzzed).
 * Reduced: no ring (framer would skip its scale but still fade it, flashing a 1.6x ring) and no pop;
 * the disc fades in and the check still draws.
 */
export function DoneCheck({ size = 56, label = 'Done', silent = false }: { size?: number; label?: string; silent?: boolean }) {
  const reduced = useTier() === 'reduced';
  useEffect(() => { if (!silent) haptic.success(); }, [silent]);
  return (
    <span className="vx-done" role="img" aria-label={label} style={{ width: size, height: size }}>
      {!reduced && (
        <motion.span className="vx-done-ring" aria-hidden="true" initial={{ scale: 1, opacity: 0.6 }} animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: DUR.slow, ease: EASE.enter, delay: 0.08 }} />
      )}
      <motion.svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true"
        initial={reduced ? { opacity: 0 } : { scale: 0 }} animate={reduced ? { opacity: 1 } : { scale: 1 }}
        transition={reduced ? { duration: DUR.fast } : SPRING.pop}>
        <circle cx="28" cy="28" r="28" fill="var(--volt)" />
        <motion.path d="M17 29l7 7 15-16" fill="none" stroke="var(--on-volt, #0E1013)" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, ease: EASE.standard, delay: 0.12 }} />
      </motion.svg>
    </span>
  );
}
