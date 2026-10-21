'use client';

import { motion } from 'framer-motion';
import { EASE, SPRING } from '../../_lib/motion';
import { useTier } from './tier';

const LATIN = '0123456789';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const digitOf = (c: string) => { const i = LATIN.indexOf(c); return i >= 0 ? { d: i, set: LATIN } : (PERSIAN.indexOf(c) >= 0 ? { d: PERSIAN.indexOf(c), set: PERSIAN } : null); };

function Column({ d, set, quick }: { d: number; set: string; quick: boolean }) {
  return (
    <span className="vx-tick-col" aria-hidden="true">
      <motion.span className="vx-tick-reel" initial={false} animate={{ y: `${-d}em` }}
        transition={quick ? { duration: 0.15, ease: EASE.standard } : SPRING.gentle}>
        {[...set].map((c) => <span key={c}>{c}</span>)}
      </motion.span>
    </span>
  );
}

/**
 * A number that rolls to its new value (motion §5.7): one reel per digit, only the digits that
 * change move. `quick` suits clocks (150 ms, so a timer never distracts). Latin and Persian digits
 * both roll; other characters stay put. Screen readers get the plain value; reduced motion is static.
 * Always an LTR run: each character is its own flex item, which bidi never reorders, so under
 * `dir="rtl"` a Persian clock would otherwise lay out backwards.
 */
export function Ticker({ value, className, quick = false, live = false }: { value: number | string; className?: string; quick?: boolean; live?: boolean }) {
  const reduced = useTier() === 'reduced';
  const text = String(value);
  const cls = ['vx-num', 'vx-tick', className].filter(Boolean).join(' ');
  if (reduced) return <span className={cls} dir="ltr" aria-live={live ? 'polite' : undefined}>{text}</span>;
  const chars = [...text];
  // reels are keyed from the right, so 9 → 10 grows a reel on the left instead of re-keying every one
  return (
    <span className={cls} dir="ltr" aria-live={live ? 'polite' : undefined}>
      <span className="vx-sr">{text}</span>
      {chars.map((c, i) => {
        const g = digitOf(c);
        const k = chars.length - i;
        return g ? <Column key={`d${k}`} d={g.d} set={g.set} quick={quick} /> : <span key={`c${k}`} className="vx-tick-sym" aria-hidden="true">{c}</span>;
      })}
    </span>
  );
}
