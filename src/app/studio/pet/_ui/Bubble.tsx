'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BUBBLE_MAX_CHARS, type NeedKey } from '@/lib/pet/types';
import { BallIcon, CookieIcon, MoonIcon } from './Particles';
import { petLang, t, textDir, type PetLang } from './strings';
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

const SENTENCE_END = '.!?…؟';
const CLOSERS = '"\'»”’)';

/** Sentences, each with its end mark (and any closing quote): split where an end mark meets a space. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!SENTENCE_END.includes(text[i])) continue;
    let j = i + 1;
    while (j < text.length && (SENTENCE_END.includes(text[j]) || CLOSERS.includes(text[j]))) j++;
    if (j < text.length && !/\s/.test(text[j])) continue;
    out.push(text.slice(start, j).trim());
    start = j;
    i = j - 1;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** A sentence longer than a page, cut at word boundaries (a word longer than a page is cut as is). */
function words(s: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (let w of s.split(/\s+/)) {
    while (w.length > max) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
    if (!w) continue;
    if (line && line.length + 1 + w.length > max) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Pages of at most `max` characters (§9.4 rule 2): whole sentences grouped while they fit, a longer sentence split at
 * word boundaries. Never an empty page; the text is never cut short (every word lands on some page).
 */
export function paginate(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const cap = Math.max(8, Math.floor(max));
  if (clean.length <= cap) return [clean];
  const pages: string[] = [];
  let page = '';
  for (const s of sentences(clean)) {
    if (s.length > cap) {
      if (page) { pages.push(page); page = ''; }
      const parts = words(s, cap);
      page = parts.pop() ?? '';
      pages.push(...parts);
      continue;
    }
    if (page && page.length + 1 + s.length > cap) { pages.push(page); page = s; } else page = page ? `${page} ${s}` : s;
  }
  if (page) pages.push(page);
  return pages;
}

/** px per character of bubble text: Onest 15 px ≈ 7.6 (≈ 34 a line at 290 px, as the keys file counts), Vazirmatn 16 px runs longer. */
const GLYPH: Record<PetLang, number> = { en: 7.6, fa: 8.4 };
const LINE_PX: Record<PetLang, number> = { en: 21, fa: 24 };
/** bubble padding (11 + 12), the tail and the gap under it */
const CHROME_PX = 40;
/** the "more ›" row with its page dots */
const NAV_PX = 26;

/** Characters a page may hold: lines × characters a line, with slack for word wrap (and the "more ›" on the last line). */
export function pageBudget(lines: number, width: number, lang: PetLang): number {
  const perLine = Math.max(10, Math.floor((width - 32) / GLYPH[lang]));
  return Math.floor(lines * perLine * 0.86);
}

export interface BubbleMsg { id: number; text: string }

interface BubbleProps {
  msg: BubbleMsg | null;
  /** the head top in stage px: the bubble's tail points here */
  top: number;
  /** px between the head and the safe area: fewer lines a page when the class's budget would not fit */
  room?: number;
  /** the layout class's line budget (§9.2): Peek 2, Short 3, Regular 4, Tall and Wide 5 */
  lines?: number;
  /** the bubble's width in px (layout.ts bubbleWidth), for the page size */
  width?: number;
  cps?: number;
  /** faded out (or replaced) */
  onGone?: (id: number) => void;
  /** a long-press on the bubble (a tip's reason line, §3.6) */
  onHold?: () => void;
}

/**
 * The speech bubble (§1.4, §9.4): reveals at ~28 chars/s by writing the text node directly (no React render per
 * character), holds max(2.5 s, chars/18 s), then fades. A reply longer than the class's line budget is paged by
 * sentence groups: dots show where you are, "more ›" goes on at once, and an unread page also turns by itself after
 * its hold. Nothing inside scrolls. While a paged reply shows, Telegram's BackButton closes it.
 */
export const Bubble = memo(function Bubble({ msg, top, room, lines = 4, width = 290, cps = REVEAL_CPS, onGone, onHold }: BubbleProps) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const letGo = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  const textRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'reveal' | 'hold' | 'out'>('reveal');
  // the page belongs to its message: a new message starts on its first page in the same render
  const [at, setAt] = useState({ id: -1, page: 0 });
  const page = at.id === msg?.id ? at.page : 0;
  const turn = () => { if (msg) setAt({ id: msg.id, page: page + 1 }); };
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const lang = petLang();
  const tdir = msg ? textDir(msg.text) : 'ltr';
  const glyphLang: PetLang = tdir === 'rtl' ? 'fa' : 'en';
  // the class's budget, fewer lines when the head sits close to the top (the bubble never runs under Telegram's row)
  const fit = room === undefined ? lines : Math.floor((room - CHROME_PX - NAV_PX) / LINE_PX[glyphLang]);
  const budget = Math.max(1, Math.min(lines, fit));
  const pages = msg ? paginate(msg.text, pageBudget(budget, width, glyphLang)) : [];
  const shown = pages[Math.min(page, pages.length - 1)] ?? '';
  const last = page >= pages.length - 1;
  const paged = pages.length > 1;

  // reveal the page: one timer, text written straight into the node
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!msg || !el) return;
    setPhase('reveal');
    let i = 0;
    el.textContent = '';
    const timer = setInterval(() => {
      // a slow frame catches up instead of drifting behind the mouth
      i = Math.min(shown.length, i + 1);
      el.textContent = shown.slice(0, i);
      if (i >= shown.length) { clearInterval(timer); setPhase('hold'); }
    }, 1000 / cps);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg?.id, page, cps]);

  // hold, then the next page, or fade after the last
  useEffect(() => {
    if (!msg || phase !== 'hold') return;
    const tm = setTimeout(() => (last ? setPhase('out') : turn()), holdMs(shown.length));
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg, phase, last, page, shown.length]);

  useEffect(() => {
    if (!paged || phase === 'out') return;
    return backButton(() => setPhase('out'));
  }, [paged, phase]);

  if (!msg) return null;
  return (
    <div className="pet-bubble" role="status" aria-live="polite" dir={tdir} data-out={phase === 'out' ? '' : undefined}
      style={{ top, ['--pet-lines' as string]: budget }}
      onPointerDown={onHold && (() => { letGo(); hold.current = setTimeout(() => { hold.current = null; onHold(); }, 500); })} onPointerUp={letGo} onPointerCancel={letGo} onPointerLeave={letGo}
      onTransitionEnd={(e) => { if (phase === 'out' && e.propertyName === 'opacity') goneRef.current?.(msg.id); }}>
      <span className="pet-sr">{msg.text}</span>
      {/* written only by the reveal effect (never React children), so a page turn always has its node */}
      <span ref={textRef} className="pet-bubble-text" aria-hidden="true" />
      {paged && (
        <span className="pet-pages">
          <span className="pet-dots" aria-hidden="true">{pages.map((_, i) => <i key={i} data-on={i === page ? '' : undefined} />)}</span>
          {!last && <button type="button" className="pet-more" dir={lang === 'fa' ? 'rtl' : 'ltr'} onClick={turn}>{t('ui.more')}</button>}
        </span>
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
