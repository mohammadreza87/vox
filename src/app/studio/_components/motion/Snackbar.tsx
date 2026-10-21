'use client';

import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { forwardRef, useEffect, useRef } from 'react';
import { haptic } from '../../_lib/haptics';
import { snackVariants } from '../../_lib/motion';
import { Icon } from '../ui';
import { usePageActive } from './activity';

export type SnackTone = 'info' | 'success' | 'error';
export interface SnackItem {
  id: number;
  message: string;
  tone: SnackTone;
  action?: { label: string; run(): void };
  /** Auto-dismiss after this long; null = stays until tapped, swiped or the next navigation */
  ms: number | null;
}

/** Interaction §2.3: info 3.2 s, with an action 5 s, errors stay until dismissed. */
export const snackDuration = (tone: SnackTone, hasAction: boolean, ms?: number): number | null =>
  ms ?? (hasAction ? 5000 : tone === 'error' ? null : 3200);

const ICON: Partial<Record<SnackTone, string>> = { success: 'check', error: 'warn' };
const DISMISS_PX = 24;
const DISMISS_VELOCITY = 400;

/**
 * Bottom snackbar. StudioApp lifts it 12 px above the tab bar or the screen's dock.
 * A new snack replaces the old one with a crossfade. The timer pauses while it is held or dragged
 * and while the app is in the background, so nobody loses an Undo they were reaching for.
 */
export function Snackbar({ snack, onDismiss }: { snack: SnackItem | null; onDismiss(id: number): void }) {
  return (
    <div className="vx-snack-stage">
      <AnimatePresence initial={false} mode="popLayout">
        {snack && <SnackCard key={snack.id} snack={snack} onDismiss={onDismiss} />}
      </AnimatePresence>
    </div>
  );
}

/** Forwards its ref to the card: popLayout measures and lifts the outgoing card out of flow through it. */
const SnackCard = forwardRef<HTMLDivElement, { snack: SnackItem; onDismiss(id: number): void }>(function SnackCard({ snack, onDismiss }, ref) {
  const active = usePageActive();
  const held = useRef(false);
  const remaining = useRef(snack.ms);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const startedAt = useRef(0);

  const pause = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current); timer.current = undefined;
    if (remaining.current !== null) remaining.current = Math.max(0, remaining.current - (performance.now() - startedAt.current));
  };
  const resume = () => {
    if (held.current || timer.current !== undefined || remaining.current === null) return;
    startedAt.current = performance.now();
    timer.current = setTimeout(() => onDismiss(snack.id), Math.max(remaining.current, 900));
  };
  useEffect(() => {
    if (active) resume(); else pause();
    return pause;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const hold = () => { held.current = true; pause(); };
  const release = () => { held.current = false; resume(); };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_PX || info.velocity.y > DISMISS_VELOCITY) onDismiss(snack.id);
    else release();
  };

  const icon = ICON[snack.tone];
  return (
    <motion.div ref={ref} className="vx-snack" data-tone={snack.tone} role={snack.tone === 'error' ? 'alert' : 'status'}
      aria-live={snack.tone === 'error' ? 'assertive' : 'polite'}
      variants={snackVariants} initial="initial" animate="enter" exit="exit"
      drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.08, bottom: 0.9 }} dragSnapToOrigin
      onPointerDown={hold} onPointerUp={release} onPointerCancel={release} onDragStart={hold} onDragEnd={onDragEnd}
      onTap={() => { if (snack.ms === null) onDismiss(snack.id); }}>
      {icon && <span className="vx-snack-icon" aria-hidden="true"><Icon name={icon} size={18} width={2} /></span>}
      <span className="vx-snack-msg">{snack.message}</span>
      {snack.action ? (
        <button type="button" className="vx-snack-action" onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { haptic.light(); snack.action?.run(); onDismiss(snack.id); }}>
          {snack.action.label}
        </button>
      ) : snack.ms === null && (
        <button type="button" className="vx-snack-close" aria-label="Dismiss" onPointerDown={(e) => e.stopPropagation()} onClick={() => onDismiss(snack.id)}>
          <Icon name="close" size={16} width={2} />
        </button>
      )}
    </motion.div>
  );
});
