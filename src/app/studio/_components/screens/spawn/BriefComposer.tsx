'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSpawnMotion } from './motion';
import { hasPersian, textAttrs } from './routing';

const MAX = 600;
const COUNT_FROM = 500;
const ROTATE_MS = 3200;

/**
 * The hero input. Rotating examples sit in an overlay (the textarea keeps a
 * stable label), Cmd/Ctrl+Enter submits, and it grows from 3 to 6 lines.
 */
export function BriefComposer({ value, onChange, label, examples, describe, placeholder, onFocusChange, onSubmit, footer, readOnly }: {
  value: string; onChange: (v: string) => void; label: string; examples: string[]; describe: (example: string) => string;
  /** A fixed placeholder (picked role, successor) replaces the rotating examples. */
  placeholder?: string; onFocusChange: (focused: boolean) => void; onSubmit: () => void; footer?: ReactNode;
  /** While Draft resolves, the brief can't change under it. */
  readOnly?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [i, setI] = useState(0);
  const m = useSpawnMotion();
  const rotate = !placeholder && !value && !focused && !m.reduce && examples.length > 1;

  useEffect(() => {
    if (!rotate) return;
    const timer = setInterval(() => setI((n) => (n + 1) % examples.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotate, examples.length]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(144, Math.max(72, el.scrollHeight))}px`;
  }, [value]);

  const shown = placeholder ?? examples[i % Math.max(1, examples.length)] ?? '';
  const count = value.length >= COUNT_FROM;

  return (
    <div className={count || footer ? 'vx-composer' : 'vx-composer vx-composer-bare'} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) input.current?.focus(); }}>
      <textarea ref={input} id={id} className="vx-composer-input" dir="auto" rows={3} maxLength={MAX} value={value} readOnly={readOnly}
        lang={hasPersian(value) ? 'fa' : undefined}
        aria-label={label} aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { setFocused(true); onFocusChange(true); }}
        onBlur={() => { setFocused(false); onFocusChange(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }} />
      {!value && (
        <AnimatePresence initial={false} mode="wait">
          <motion.span key={shown} className="vx-composer-ph" {...textAttrs(shown)} aria-hidden="true"
            initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.24 } }} exit={{ opacity: 0, transition: { duration: 0.16 } }}>
            {shown}
          </motion.span>
        </AnimatePresence>
      )}
      <span id={`${id}-hint`} className="vx-sr">{placeholder ?? describe(examples[0] ?? '')}</span>
      {(count || footer) && (
        <div className="vx-composer-foot">
          <span className="vx-count" aria-hidden={!count}>{count ? `${value.length}/${MAX}` : ''}</span>
          {footer}
        </div>
      )}
    </div>
  );
}
