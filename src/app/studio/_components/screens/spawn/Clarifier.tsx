'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { RouteSuggestion } from '../../../_lib/client';
import { Spinner } from '../../ui';
import type { BriefCopy } from './copy';
import { textAttrs } from './routing';

export type Clarify = NonNullable<RouteSuggestion['clarify']>;

/**
 * The one question routing may ask, only after Draft and at most once.
 * Answering *is* the submit, so drafting starts right after.
 */
export function Clarifier({ t, clarify, subFor, pending, onAnswer }: {
  t: BriefCopy; clarify: Clarify; subFor: (value: string) => string | undefined; pending: string | null; onAnswer: (value: string) => void;
}) {
  const id = useId();
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const [roving, setRoving] = useState(0);

  useEffect(() => { options.current[0]?.focus({ preventScroll: true }); }, []);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
    const n = clarify.options.length;
    options.current[(i + (rtl ? -step : step) + n) % n]?.focus();
  };

  return (
    <section className="vx-ask" aria-labelledby={`${id}-q`}>
      <span className="vx-over">{t.clarifyOver}</span>
      <p id={`${id}-q`} className="vx-ask-q" {...textAttrs(clarify.question)}>{clarify.question || t.clarifyFallback}</p>
      <div className="vx-ask-options" role="radiogroup" aria-labelledby={`${id}-q`}>
        {clarify.options.map((o, i) => {
          const chosen = pending === o.value;
          const sub = subFor(o.value);
          return (
            <button key={o.value} ref={(el) => { options.current[i] = el; }} type="button" role="radio" className="vx-ask-option"
              aria-checked={chosen} aria-label={sub ? `${o.label}, ${sub}` : o.label} tabIndex={i === roving ? 0 : -1} onFocus={() => setRoving(i)}
              data-dim={pending && !chosen ? '' : undefined} aria-disabled={!!pending}
              onKeyDown={(e) => onKey(e, i)} onClick={() => { if (!pending) onAnswer(o.value); }}>
              {chosen ? <Spinner size={14} /> : <span {...textAttrs(o.label)}>{o.label}</span>}
              {sub && !chosen && <span className="vx-ask-sub" {...textAttrs(sub)}>{sub}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
