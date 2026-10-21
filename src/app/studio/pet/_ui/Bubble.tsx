'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUBBLE_MAX_CHARS, type NeedKey } from '@/lib/pet/types';
import { COPY } from './copy';
import { BallIcon, CookieIcon, MoonIcon } from './Particles';
import { backButton } from './telegram';

/** Reveal rate (§1.4): the mouth runs synthetic visemes at the same rate. */
export const REVEAL_CPS = 28;
/** Hold after the reveal: max(2.5 s, chars / 18 s). */
export const holdMs = (chars: number) => Math.max(2500, (chars / 18) * 1000);

/** The first ≤ 220 characters, cut at a word boundary when one is close, with an ellipsis. */
export function clip(text: string, max = BUBBLE_MAX_CHARS): { shown: string; clipped: boolean } {
  if (text.length <= max) return { shown: text, clipped: false };
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return { shown: `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`, clipped: true };
}

export interface BubbleMsg { id: number; text: string }

interface BubbleProps {
  msg: BubbleMsg | null;
  /** the head top in stage px: the bubble's tail points here */
  top: number;
  /** px between the head and the safe area: a long reply scrolls inside instead of running under Telegram's buttons */
  room?: number;
  cps?: number;
  /** faded out (or replaced) */
  onGone?: (id: number) => void;
}

/**
 * The speech bubble (§1.4): reveals at ~28 chars/s by writing the text node directly (no React render
 * per character), holds max(2.5 s, chars/18 s), then fades. Over 220 characters it shows the first 220
 * and a "more" that expands in place (the page's only expansion surface; Telegram's BackButton closes it).
 */
export const Bubble = memo(function Bubble({ msg, top, room, cps = REVEAL_CPS, onGone }: BubbleProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'reveal' | 'hold' | 'out'>('reveal');
  const [expanded, setExpanded] = useState(false);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const c = msg ? clip(msg.text) : null;

  // reveal: one timer, text written straight into the node
  useLayoutEffect(() => {
    if (!msg || !c) return;
    setPhase('reveal');
    setExpanded(false);
    const el = textRef.current;
    if (!el) return;
    const full = c.shown;
    let i = 0;
    el.textContent = '';
    const step = 1000 / cps;
    const timer = setInterval(() => {
      // a slow frame catches up instead of drifting behind the mouth
      i = Math.min(full.length, i + 1);
      el.textContent = full.slice(0, i);
      if (i >= full.length) { clearInterval(timer); setPhase('hold'); }
    }, step);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg?.id, cps]);

  // hold, then fade (never while expanded)
  useEffect(() => {
    if (!msg || phase !== 'hold' || expanded) return;
    const t = setTimeout(() => setPhase('out'), holdMs(clip(msg.text).shown.length));
    return () => clearTimeout(t);
  }, [msg, phase, expanded]);

  useEffect(() => {
    if (!expanded) return;
    return backButton(() => setExpanded(false));
  }, [expanded]);

  if (!msg || !c) return null;
  // padding, tail and the "more" line come off the room the text gets
  const textMax = room === undefined ? undefined : Math.max(42, room - 54);
  return (
    <div className="pet-bubble" role="status" aria-live="polite" data-out={phase === 'out' ? '' : undefined} data-expanded={expanded ? '' : undefined}
      style={{ top }} onTransitionEnd={(e) => { if (phase === 'out' && e.propertyName === 'opacity') goneRef.current?.(msg.id); }}>
      <span className="pet-sr">{msg.text}</span>
      {phase === 'reveal'
        ? <span ref={textRef} className="pet-bubble-text" aria-hidden="true" style={{ maxHeight: textMax }} />
        : <span className="pet-bubble-text" aria-hidden="true" style={{ maxHeight: textMax }}>{expanded ? msg.text : c.shown}</span>}
      {c.clipped && phase !== 'reveal' && (
        <button type="button" className="pet-more" onClick={() => setExpanded((v) => !v)}>{expanded ? COPY.less : COPY.more}</button>
      )}
    </div>
  );
});

const THOUGHT_ICON: Record<NeedKey, () => React.ReactElement> = { tummy: CookieIcon, joy: BallIcon, energy: MoonIcon };

/** The "wants" thought bubble (§1.1): that toy's icon in a little cloud by the head, ~2.4 s. */
export function Thought({ need, top, left }: { need: NeedKey | null; top: number; left: number }) {
  if (!need) return null;
  const Icon = THOUGHT_ICON[need];
  return (
    <div key={need} className="pet-thought" aria-hidden="true" style={{ top, left }}>
      <span className="pet-thought-dot" /><span className="pet-thought-dot" />
      <span className="pet-thought-cloud"><Icon /></span>
    </div>
  );
}
