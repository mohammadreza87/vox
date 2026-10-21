'use client';

import { motion } from 'framer-motion';
import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { SPRING } from '../../_lib/motion';
import { arrowStep } from './OptionRail';

export interface Swatch<T extends string> { value: T; label: string; color: string; light?: string; shadow?: string; blocked?: string | null }

/**
 * Colour swatches as a radiogroup. `grid`: the body hues, 8 across at 44 px.
 * `row`: a scrolling strip of smaller chips (hair tone, accessory colour).
 * The selection ring slides between swatches on SPRING.snappy.
 */
export function SwatchGrid<T extends string>({ label, swatches, value, onPick, layout = 'grid', reduced }: {
  label: string; swatches: ReadonlyArray<Swatch<T>>; value: T; onPick: (v: T, index: number) => void; layout?: 'grid' | 'row'; reduced?: boolean;
}) {
  const ring = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const pick = (i: number) => {
    const s = swatches[i];
    if (s.value !== value && !s.blocked) onPick(s.value, i);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = arrowStep(e);
    if (!step) return;
    e.preventDefault();
    const n = (i + step + swatches.length) % swatches.length;
    refs.current[n]?.focus();
    pick(n);
  };
  const current = Math.max(0, swatches.findIndex((s) => s.value === value));
  return (
    <div className={`vx-swatches ${layout}`} role="radiogroup" aria-label={label}>
      {swatches.map((s, i) => {
        const on = s.value === value;
        return (
          <button key={s.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} aria-label={s.label}
            aria-disabled={s.blocked ? true : undefined} title={s.blocked ?? s.label} tabIndex={i === current ? 0 : -1}
            className="vx-swatch" onClick={() => pick(i)} onKeyDown={(e) => onKey(e, i)}
            style={{ '--sw': s.color, '--sw-light': s.light ?? s.color, '--sw-shadow': s.shadow ?? s.color } as CSSProperties}>
            {on && <motion.span layoutId={`sw-${ring}`} className="vx-swatch-ring" transition={reduced ? { duration: 0 } : SPRING.snappy} aria-hidden="true" />}
            <span className="vx-swatch-dot" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
