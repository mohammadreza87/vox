'use client';

import { motion, type TargetAndTransition } from 'framer-motion';
import { forwardRef } from 'react';
import { barVariants, SPRING, type NavCtx } from '../../_lib/motion';
import { Icon } from '../ui';

export interface TabItem<R extends string = string> { route: R; label: string; icon: string }

const POP: TargetAndTransition = { scale: [1, 0.86, 1.08, 1], transition: { duration: 0.36, times: [0, 0.25, 0.65, 1], ease: 'easeOut' } };
const REST: TargetAndTransition = { scale: 1 };

/**
 * Overlay tab bar (motion §3.5): glass over the content, owned by the root screen. Rendered inside
 * StudioApp's AnimatePresence so it leaves with pushes/covers and returns on pop.
 */
export const TabBar = forwardRef<HTMLElement, {
  tabs: ReadonlyArray<TabItem>; current: string; disabled?: boolean; ctx: NavCtx;
  /** The nav landmark's name (localized by the caller) */
  label?: string;
  onSelect(route: string): void;
}>(function TabBar({ tabs, current, disabled, ctx, label = 'Main', onSelect }, ref) {
  return (
    <motion.nav ref={ref} className="vx-tabbar" aria-label={label} custom={ctx} variants={barVariants} initial="initial" animate="enter" exit="exit"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => {
        const active = current === t.route;
        return (
          <button key={t.route} type="button" className="vx-tab" disabled={disabled} aria-current={active ? 'page' : undefined} onClick={() => onSelect(t.route)}>
            <span className="vx-tab-pill">
              {active && <motion.span className="vx-tab-pill-bg" layoutId="tabpill" transition={SPRING.snappy} />}
              <motion.span className="vx-tab-icon" initial={false} animate={active ? POP : REST}><Icon name={t.icon} /></motion.span>
            </span>
            <span className="vx-tab-label">{t.label}</span>
          </button>
        );
      })}
    </motion.nav>
  );
});
