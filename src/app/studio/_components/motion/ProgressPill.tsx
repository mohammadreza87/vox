'use client';

import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DUR, EASE, SPRING } from '../../_lib/motion';
import { Icon, Spinner } from '../ui';
import { pageActive } from './activity';

/** Unknown-length progress (interaction §2.6): approaches 92 % with time constant τ, never stalls, never lies about finishing. */
export const progressAt = (seconds: number, tau: number) => 0.92 * (1 - Math.exp(-seconds / Math.max(0.1, tau)));
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Long-running work as a pill: narrative copy that steps through `labels` (every 3 s, the last one
 * holds), elapsed time, and a fill bar. `tau` is the operation's median duration in seconds; after
 * 2τ the copy admits it is slow. When `active` turns off with a `done` label, the bar fills, the
 * spinner becomes a check, and the label settles. `layoutId` lets a CTA morph into it.
 */
export function ProgressPill({ active, labels, tau = 8, done, layoutId, slow = 'Taking longer than usual · almost there', elapsed = true }: {
  active: boolean; labels: string[]; tau?: number; done?: string; layoutId?: string; slow?: string; elapsed?: boolean;
}) {
  const [secs, setSecs] = useState(0);
  const started = useRef(0);
  const fill = useMotionValue(0);
  useEffect(() => {
    if (!active) return;
    started.current = Date.now();
    setSecs(0);
    fill.set(0);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!pageActive()) return;
      fill.set(progressAt((Date.now() - started.current) / 1000, tau));
    };
    raf = requestAnimationFrame(tick);
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(t); };
  }, [active, tau, fill]);
  useEffect(() => { if (!active && done) void animate(fill, 1, { duration: 0.25, ease: EASE.standard }); }, [active, done, fill]);

  if (!active && !done) return null;
  const step = Math.min(Math.floor(secs / 3), Math.max(0, labels.length - 1));
  const text = !active ? done! : secs > 2 * tau ? slow : labels[step] ?? '';
  return (
    <motion.div layout layoutId={layoutId} transition={{ layout: SPRING.snappy }} className="vx-progress" role="status" aria-live="polite" data-done={!active || undefined}>
      <span className="vx-progress-icon" aria-hidden="true">
        {active ? <Spinner size={14} />
          : <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING.pop} style={{ display: 'flex' }}><Icon name="check" size={14} width={2.5} /></motion.span>}
      </span>
      <span className="vx-progress-label">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.base, ease: EASE.enter }}>{text}</motion.span>
        </AnimatePresence>
      </span>
      {elapsed && active && <span className="vx-progress-time vx-num" aria-hidden="true">{clock(secs)}</span>}
      <span className="vx-progress-bar" aria-hidden="true"><motion.span style={{ scaleX: fill }} /></span>
    </motion.div>
  );
}
